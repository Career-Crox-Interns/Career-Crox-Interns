const {sortCrmRows,crmSortSql}=require('../lib/helpers');
const {matchesSelectedRecruiter,recruiterSelectionSql}=require('../lib/accessRules');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { store, table, mode, activeTransactionClient, afterCommit, withSavepoint, withTransaction } = require('../lib/store');
const { containsText, nextId, nowIso, ymd, calcExperienceRange, calcSalaryRange, recruiterCodeMatches, normalizeIndianPhone, phoneMatches, candidateIdentityKey } = require('../lib/helpers');
const { normalizeWhitespace, htmlToText } = require('../lib/extractors');
const { createTimedCache, clearAllCaches } = require('../lib/cache');
const { maskPhoneValue, sanitizeCandidateForUser, sanitizeCandidateListForUser } = require('../lib/dataLeakGuard');
const { reminderTriggerNowMs, dueInMinutes } = require('../lib/reminderWindow');
const { userRole, isLeadership: isAccessLeadership, isAdminOrManager, candidateBelongsToUser, candidateBelongsToTeam, candidateOwnerSql, candidateScopeSql, visibleCandidateForUser } = require('../lib/accessRules');
const { istDateKey, isTodayIst } = require('../lib/crmMetrics');
const { bumpCallChange } = require('../lib/callChange');
const bucketPolicy = require('../lib/bucketPolicy');

const PROCESS_OPTIONS = [
  'Air India', 'Airtel', 'UrbanClap', 'Urban Company', 'Urban Company Tech', 'UAE Customer Retention', 'Kotak', 'Tata 1mg', 'Axis Bank', 'Samsung',
  'Tata Motors', 'Icegate', 'Icertate', 'Xiaomi', 'Xiaomi - Regional Language', 'American Express', 'Nykaa',
  'Razorpay', 'RBL / OLX', 'HDFC Back Office', 'Zomato', 'LivPure', 'TVS', 'Other',
];

const PROCESS_OPTIONS_SETTING_KEY = 'candidate_process_options_v1';
const PREFERRED_LOCATION_OPTIONS_SETTING_KEY = 'candidate_preferred_location_options_v1';
const PREFERRED_LOCATION_OPTIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const sharedCandidateOptionCache = {
  process: { items: null, expires_at: 0 },
  preferred_location: { items: null, expires_at: 0 },
};

let sharedOptionRevision=0;
require('../lib/cache').registerCache({tags:new Set(['candidates','settings']),clear(){sharedOptionRevision++;for(const cache of Object.values(sharedCandidateOptionCache)){cache.items=null;cache.expires_at=0;}}});

function normalizeSharedOptions(baseValues = [], values = []) {
  const out = [];
  const seen = new Set();
  for (const raw of [...baseValues, ...(Array.isArray(values) ? values : [])]) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= 120) break;
  }
  return out;
}

function optionCatalog(kind = 'process') {
  if (kind === 'preferred_location') {
    return { kind, settingKey: PREFERRED_LOCATION_OPTIONS_SETTING_KEY, baseValues: PREFERRED_LOCATION_OPTIONS };
  }
  return { kind: 'process', settingKey: PROCESS_OPTIONS_SETTING_KEY, baseValues: PROCESS_OPTIONS };
}

async function readSharedCandidateOptions(kind = 'process') {
  const catalog = optionCatalog(kind);
  const revision=sharedOptionRevision;
  const cache = sharedCandidateOptionCache[catalog.kind];
  if (cache?.items && Date.now() < cache.expires_at) return [...cache.items];
  let custom = [];
  try {
    const row = await store.findById('settings', 'setting_key', catalog.settingKey);
    const parsed = JSON.parse(String(row?.setting_value || '[]'));
    if (Array.isArray(parsed)) custom = parsed;
  } catch (_error) {
    // Keep the profile instant even if the shared-option lookup is temporarily unavailable.
  }
  const items = normalizeSharedOptions(catalog.baseValues, custom);
  if(revision===sharedOptionRevision)sharedCandidateOptionCache[catalog.kind] = { items, expires_at: Date.now() + (5 * 60 * 1000) };
  return [...items];
}

async function readSharedProcessOptions() {
  return readSharedCandidateOptions('process');
}

async function listProcessOptions(req, res) {
  // One small request returns both dropdown catalogs, avoiding a second egress read.
  const [items, preferredLocationOptions] = await Promise.all([
    readSharedCandidateOptions('process'),
    readSharedCandidateOptions('preferred_location'),
  ]);
  return res.json({ ok: true, items, process_options: items, preferred_location_options: preferredLocationOptions });
}

async function saveSharedCandidateOption(kind, name) {
  const catalog=optionCatalog(kind),fresh=String(name||'').replace(/\s+/g,' ').trim().slice(0,120);
  if(!fresh)throw Object.assign(new Error('Option name is required.'),{status:400});
  return withTransaction(async()=>{
    if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['candidate-option:'+catalog.settingKey]);
    const row=await store.findById('settings','setting_key',catalog.settingKey);
    let custom=[];try{custom=JSON.parse(row?.setting_value||'[]');}catch{}
    const next=normalizeSharedOptions(catalog.baseValues,[...(Array.isArray(custom)?custom:[]),fresh]);
    if(!next.some(item=>item.toLowerCase()===fresh.toLowerCase()))throw Object.assign(new Error('Shared option catalog is full.'),{status:400});
    const baseKeys=new Set(catalog.baseValues.map(item=>item.toLowerCase()));
    const customOnly=next.filter(item=>!baseKeys.has(item.toLowerCase()));
    const changed=JSON.stringify(customOnly)!==JSON.stringify(custom);
    if(changed)await store.upsert('settings','setting_key',{
      setting_key:catalog.settingKey,setting_value:JSON.stringify(customOnly),notes:'Shared additive candidate options.',Instructions:''
    });
    if(changed)await afterCommit(()=>{sharedCandidateOptionCache[catalog.kind]={items:null,expires_at:0};clearAllCaches(['candidates','revenue']);require('../lib/approvalLive').publishReminderDirty({}, {source:'/candidates/process-options',at:Date.now()});});
    return next;
  });
}
async function addProcessOption(req,res){
 const kind=req.body?.kind==='preferred_location'?'preferred_location':'process';
 const fresh=String(req.body?.name||req.body?.process||'').replace(/\s+/g,' ').trim().slice(0,120);
 const next=await saveSharedCandidateOption(kind,fresh);
 return res.json({ok:true,kind,item:fresh,items:next,...(kind==='process'?{process_options:next}:{preferred_location_options:next})});
}

const candidateListCache = createTimedCache(60000,{maxEntries:160,tags:['candidates']});
// CC26_700: same filter + user, different page => reuse count/source/summary for 30s.
// Registered with clearAllCaches(), so any candidate write invalidates the metadata.
const candidateListMetaCache = createTimedCache(60000,{maxEntries:120,tags:['candidates']});
const candidateNavCache = createTimedCache(60000, {tags:["candidates"]});
const duplicateReviewCache = createTimedCache(45000, {tags:["candidates"]});
const MAX_FILE_BYTES = Number(process.env.CANDIDATE_FILE_MAX_BYTES || (25 * 1024 * 1024));
const STRICT_RESUME_MAX_BYTES = Number(process.env.CANDIDATE_RESUME_MAX_BYTES || (512 * 1024));
const STRICT_RECORDING_MAX_BYTES = Number(process.env.CANDIDATE_RECORDING_MAX_BYTES || (4 * 1024 * 1024));
const ALLOWED_FILE_TYPES = new Set(['resume', 'call_recording']);
const RESUME_ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.docm', '.dotx', '.dotm', '.odt', '.rtf', '.txt', '.html', '.htm', '.md']);
const RECORDING_ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm', '.mp4', '.amr', '.3gp', '.mov']);


const PERSISTED_CANDIDATE_FIELDS = [
  'candidate_id','project_id','email','last_working_date','course_name','client','jd_id','interview_date','created_by_user_id','created_by_name','recruiter_user_id','user_id','call_connected','looking_for_job','full_name','phone','location','qualification','recruiter_code',
  'preferred_location','in_hand_salary','relevant_experience','communication_skill','process','interview_reschedule_date',
  'virtual_onsite','notes','reference_details','follow_up_at','status','all_details_sent','submission_date','approval_status',
  'approved_at','approved_by_name','career_gap','recording_filename','resume_filename','documents_availability',
  'relevant_experience_range','relevant_in_hand_range','total_experience','manager_crm','interview_remove_request_id',
  'interview_remove_status','interview_remove_reason','interview_remove_approved_at','submitted_by','data_uploading_date',
  'data_notes','qualification_level','ctc_monthly','recruiter_name','recruiter_designation','interview_availability',
  'approval_requested_at','is_duplicate','follow_up_note','follow_up_status','profile_priority','bucket_assigned_at','bucket_state','created_at','updated_at',
  'experience','source_sr_no','last_dialed_at','last_dialed_by_name','dial_attempt_count','last_viewed_at','last_viewed_by_name',
  'duplicate_main_choice','duplicate_main_marked_at','duplicate_main_marked_by','deleted_at','deleted_by',
  'lead_source','hot_lead_status','profile_status','jd_name','jd_notes','employee_code','employee_no','employee_name','employee_file_url','employee_row_no','last_updated_at'
];
const CANDIDATE_SELECT_SQL = PERSISTED_CANDIDATE_FIELDS.map((field) => `"${field}"`).join(', ');
const candidateColumnCache = { fetched_at: 0, columns: null };
const submissionColumnCache = { fetched_at: 0, columns: null };

async function getCandidateColumnSet() {
  if (!store.pool) return new Set(PERSISTED_CANDIDATE_FIELDS);
  const now = Date.now();
  if (candidateColumnCache.columns && (now - candidateColumnCache.fetched_at) < 60000) return candidateColumnCache.columns;
  const rows = await store.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'candidates'`);
  const columns = new Set(rows.map((row) => String(row.column_name || '').trim()).filter(Boolean));
  candidateColumnCache.columns = columns;
  candidateColumnCache.fetched_at = now;
  return columns;
}

// CC26_679: Candidate writes must survive a temporarily older live Supabase schema.
// We only write columns that really exist in public.candidates. This is additive-safe:
// no row is deleted, replaced, or mass-read, and the tiny information_schema lookup is cached.
async function filterCandidateWritePayload(source = {}, { includeCandidateId = true } = {}) {
  const picked = pickCandidateFields(source || {});
  if (!store.pool) {
    if (!includeCandidateId) delete picked.candidate_id;
    return picked;
  }
  const columns = await getCandidateColumnSet();
  const missing = Object.keys(picked).filter(key => !columns.has(key) && !['jd_id','interview_availability','last_updated_at'].includes(key));
  if (missing.length) { const error = new Error(`CRM schema update required for: ${missing.slice(0,6).join(', ')}. Run the additive setup SQL; your draft is safe.`); error.status = 503; error.code = 'SCHEMA_MISSING'; throw error; }
  const safe = {};
  for (const [key, value] of Object.entries(picked)) {
    if (columns.has(key)) safe[key] = value;
  }
  if (!includeCandidateId) delete safe.candidate_id;
  return safe;
}

async function updateCandidateCompat(candidateId, updates = {}) {
  const safe = await filterCandidateWritePayload(updates, { includeCandidateId: false });
  if (!Object.keys(safe).length) return store.findById('candidates', 'candidate_id', candidateId);
  return store.update('candidates', 'candidate_id', candidateId, safe);
}

function pickCandidateFields(source = {}) {
  const result = {};
  for (const key of PERSISTED_CANDIDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) result[key] = source[key];
  }
  return result;
}

function numericTail(value) {
  const match = String(value || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
function stableCandidateOrderValue(row) {
  const sr = Number(String(row?.source_sr_no || '').replace(/[^\d]/g, ''));
  if (Number.isFinite(sr) && sr > 0) return sr;
  return numericTail(row?.candidate_id || '');
}

function hasDialAttempt(row) {
  return Boolean(String(row?.last_dialed_at || '').trim());
}

function detailsAreCompleted(row) {
  const details = lower(row?.all_details_sent || '');
  return details === 'completed' || details === 'complete' || details === 'yes' || details === 'done';
}

function approvalMovedBeyondDraft(row) {
  const approval = lower(row?.approval_status || '');
  return approval && approval !== 'draft';
}
function inNumericRange(value, minValue, maxValue) {
  const n = numericFilterValue(value);
  if (!Number.isFinite(n)) return false;
  if (minValue !== '' && Number.isFinite(Number(minValue)) && n < Number(minValue)) return false;
  if (maxValue !== '' && Number.isFinite(Number(maxValue)) && n > Number(maxValue)) return false;
  return true;
}
function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function crmDateTimeToIso(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  // HTML datetime-local values have no timezone. CRM business time is Asia/Kolkata.
  const localMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
  const normalized = localMatch
    ? `${localMatch[1]}T${localMatch[2]}:${localMatch[3] || '00'}.${String(localMatch[4] || '000').padEnd(3, '0').slice(0, 3)}+05:30`
    : text;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

function normalizeDetailsSentValue(value, fallback = 'Pending') {
  const raw = String(value || '').trim();
  const lowered = raw.toLowerCase();
  if (lowered === 'completed' || lowered === 'complete' || lowered === 'done' || lowered === 'yes') return 'Completed';
  if (['only resume pending','resume pending'].includes(lowered)) return 'Only Resume Pending';
  if (lowered === 'pending' || lowered === '') return fallback || 'Pending';
  if (lowered === 'deleted' || lowered === 'archived') return raw;
  return fallback || 'Pending';
}

function detailsCompletedAllowedByTime(row = {}) {
  const approval = lower(row.approval_status || '');
  const submittedFlow = ['pending', 'approved', 'rejected'].includes(approval) || Boolean(String(row.submission_id || '').trim());
  if (!submittedFlow) return false;
  const raw = String(row.approval_requested_at || row.submission_date || row.submitted_at || '').trim();
  if (!raw) return false;
  const ts = Date.parse(crmDateTimeToIso(raw, raw));
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts >= 10 * 60 * 1000;
}

function filledCandidateFieldScore(row) {
  let score = 0;
  const weightedFields = [
    ['full_name', 2],
    ['phone', 3],
    ['location', 1],
    ['preferred_location', 1],
    ['qualification', 1],
    ['qualification_level', 2],
    ['process', 1],
    ['communication_skill', 1],
    ['recruiter_code', 1],
    ['recruiter_name', 1],
    ['interview_reschedule_date', 2],
    ['interview_date', 2],
    ['submission_date', 2],
    ['status', 1],
    ['notes', 2],
    ['total_experience', 6],
    ['relevant_experience', 6],
    ['relevant_experience_range', 4],
    ['experience', 3],
    ['ctc_monthly', 5],
    ['in_hand_salary', 5],
    ['relevant_in_hand_range', 4],
    ['career_gap', 2],
    ['documents_availability', 2],
    ['resume_filename', 2],
    ['recording_filename', 2],
    ['follow_up_at', 1],
    ['reference_details', 1],
    ['last_viewed_at', 1],
  ];
  for (const [key, weight] of weightedFields) {
    if (String(row?.[key] || '').trim()) score += weight;
  }
  const details = lower(row?.all_details_sent || '');
  if (details === 'completed' || details === 'complete' || details === 'yes' || details === 'done') score += 18;
  else if (details) score += 4;

  const approval = lower(row?.approval_status || '');
  if (approval === 'approved') score += 10;
  else if (approval && approval !== 'draft' && approval !== 'rejected') score += 4;

  const callConnected = lower(row?.call_connected || '');
  if (callConnected === 'yes') score += 5;
  else if (callConnected === 'partially') score += 2;

  const lookingForJob = lower(row?.looking_for_job || '');
  if (lookingForJob === 'yes') score += 1;

  return score;
}

function candidateSortStamp(row) {
  const raw = String(row?.updated_at || row?.created_at || row?.submission_date || row?.interview_reschedule_date || '').trim();
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function hasStrongDuplicateReviewDetails(row) {
  return filledCandidateFieldScore(row) >= 18;
}

function duplicateReviewGroupKey(row) {
  const phone = normalizeIndianPhone(row?.phone || '');
  if (phone) return `phone:${phone}`;
  const name = lower(row?.full_name || '');
  return name ? `name:${name}` : '';
}

function manualDuplicateMain(row) {
  return String(row?.duplicate_main_choice || '').trim() === '1';
}

function buildDuplicateReviewGroups(rows = []) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = duplicateReviewGroupKey(row);
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }

  const groups = [];
  for (const [groupKey, items] of grouped.entries()) {
    if (items.length < 2) continue;
    const sortedItems = [...items].sort((a, b) => {
      const manualDiff = Number(manualDuplicateMain(b)) - Number(manualDuplicateMain(a));
      if (manualDiff) return manualDiff;
      const scoreDiff = filledCandidateFieldScore(b) - filledCandidateFieldScore(a);
      if (scoreDiff) return scoreDiff;
      const stampDiff = candidateSortStamp(b) - candidateSortStamp(a);
      if (stampDiff) return stampDiff;
      return String(b?.candidate_id || '').localeCompare(String(a?.candidate_id || ''));
    });
    const best = sortedItems[0] || null;
    const groupNumber = normalizeIndianPhone(best?.phone || '') || String(best?.phone || '').trim() || '';
    const groupName = String(best?.full_name || '').trim() || String(sortedItems.find((item) => String(item?.full_name || '').trim())?.full_name || '').trim() || '-';
    groups.push({
      group_key: groupKey,
      group_name: groupName,
      group_phone: groupNumber,
      total_profiles: sortedItems.length,
      best_candidate_id: String(best?.candidate_id || '').trim(),
      best_score: filledCandidateFieldScore(best),
      rows: sortedItems.map((row, index) => ({
        ...row,
        duplicate_group_key: groupKey,
        duplicate_group_name: groupName,
        duplicate_group_phone: groupNumber,
        duplicate_group_size: sortedItems.length,
        detail_score: filledCandidateFieldScore(row),
        duplicate_rank: index + 1,
        duplicate_is_main: manualDuplicateMain(row) ? '1' : (index === 0 ? '1' : '0'),
        duplicate_recommended_keep: index === 0 ? '1' : '0',
        auto_select_unfilled_duplicate: index > 0 && !hasStrongDuplicateReviewDetails(row) ? '1' : '0',
      })),
      latest_stamp: Math.max(...sortedItems.map((row) => candidateSortStamp(row)), 0),
    });
  }

  groups.sort((a, b) => {
    if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
    if (b.best_score !== a.best_score) return b.best_score - a.best_score;
    if (b.latest_stamp !== a.latest_stamp) return b.latest_stamp - a.latest_stamp;
    return String(a.group_name || '').localeCompare(String(b.group_name || ''));
  });

  let serial = 1;
  const flatRows = [];
  for (const group of groups) {
    for (const row of group.rows) {
      flatRows.push({ ...row, duplicate_serial_no: serial++ });
    }
  }

  return {
    groups: groups.map((group) => ({
      group_key: group.group_key,
      group_name: group.group_name,
      group_phone: group.group_phone,
      total_profiles: group.total_profiles,
      best_candidate_id: group.best_candidate_id,
      best_score: group.best_score,
    })),
    rows: flatRows,
  };
}

async function markDuplicateMain(req, res) {
  if (!canDeleteCandidate(req.user)) return res.status(403).json({ message: 'Only managers can choose the main duplicate profile' });
  const candidateId = String(req.params.candidateId || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'Candidate id is required' });
  const allRows = (await table('candidates')).map((row) => enrichCandidate(row));
  const target = allRows.find((row) => String(row.candidate_id || '') === candidateId);
  if (!target) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(target, req.user)) return res.status(404).json({ message: 'Candidate not found' });
  const groupKey = duplicateReviewGroupKey(target);
  if (!groupKey) return res.status(400).json({ message: 'This profile is not part of a duplicate group' });
  const groupRows = allRows.filter((row) => duplicateReviewGroupKey(row) === groupKey);
  if (groupRows.length < 2) return res.status(400).json({ message: 'This profile is not part of a duplicate group' });
  const markedAt = nowIso();
  const markedBy = String(req.user?.full_name || req.user?.username || '').trim();
  const columns = await getCandidateColumnSet().catch(() => new Set(PERSISTED_CANDIDATE_FIELDS));
  for (const row of groupRows) {
    const isMain = String(row.candidate_id || '') === candidateId ? '1' : '';
    const payload = { updated_at: nowIso() };
    if (columns.has('duplicate_main_choice')) payload.duplicate_main_choice = isMain;
    if (columns.has('duplicate_main_marked_at')) payload.duplicate_main_marked_at = isMain ? markedAt : '';
    if (columns.has('duplicate_main_marked_by')) payload.duplicate_main_marked_by = isMain ? markedBy : '';
    await store.update('candidates', 'candidate_id', row.candidate_id, payload);
  }
  clearAllCaches(['candidates','reminders','reports','revenue']);
  return res.json({ ok: true, candidate_id: candidateId, group_key: groupKey });
}

function candidateLogicalKey(row) {
  const logical = candidateIdentityKey(row);
  return logical || `candidate:${String(row?.candidate_id || '').trim()}`;
}

function choosePreferredCandidateRow(current, next, options = {}) {
  if (!current) return next;
  if (!next) return current;
  const preferInterview = options.preferInterview === true;
  const currentDuplicate = String(current?.is_duplicate || '0') === '1';
  const nextDuplicate = String(next?.is_duplicate || '0') === '1';
  if (currentDuplicate !== nextDuplicate) return currentDuplicate ? next : current;

  const currentPhone = normalizeIndianPhone(current?.phone || '');
  const nextPhone = normalizeIndianPhone(next?.phone || '');
  if (!!currentPhone !== !!nextPhone) return nextPhone ? next : current;

  const currentInterview = String(current?.interview_reschedule_date || current?.interview_date || current?.scheduled_at || '').trim();
  const nextInterview = String(next?.interview_reschedule_date || next?.interview_date || next?.scheduled_at || '').trim();
  if (preferInterview && (!!currentInterview !== !!nextInterview)) return nextInterview ? next : current;

  const currentScore = filledCandidateFieldScore(current);
  const nextScore = filledCandidateFieldScore(next);
  if (currentScore !== nextScore) return nextScore > currentScore ? next : current;

  const currentStamp = candidateSortStamp(current);
  const nextStamp = candidateSortStamp(next);
  if (currentStamp !== nextStamp) return nextStamp > currentStamp ? next : current;

  return String(next?.candidate_id || next?.interview_id || '').localeCompare(String(current?.candidate_id || current?.interview_id || '')) > 0 ? next : current;
}

function collapseLogicalDuplicateRows(rows, options = {}) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = candidateLogicalKey(row);
    const existing = map.get(key);
    map.set(key, choosePreferredCandidateRow(existing, row, options));
  }
  return Array.from(map.values());
}

function normalizeQualificationCategory(value, fallbackQualification = '') {
  const rawValue = String(value || '').trim();
  const rawFallback = String(fallbackQualification || '').trim();
  if (!rawValue && !rawFallback) return '';
  const current = lower(rawValue);
  if (current === 'non - graduate' || current === 'non-graduate' || current === 'nongraduate') return 'NON - Graduate';
  if (/^post[\s-]*graduate$/.test(current)) return 'Postgraduate';
  if (current === 'graduate') return 'Graduate';
  const combined = lower(`${rawValue} ${rawFallback}`);
  if (!rawValue && /\b(post[\s-]*grad|mba|mca|m\.?sc|m\.?com|m\.?tech|phd|master)\b/i.test(rawFallback)) return 'Postgraduate';
  if (/(^|\b)(non[\s-]*grad|under[\s-]*grad|undergraduate|ug pursuing|pursuing|appearing|final year|last year|12th|10th|intermediate|higher secondary|hsc|diploma|iti)(\b|$)/i.test(combined)) return 'NON - Graduate';
  if (/(^|\b)(post[\s-]*grad|graduate|b\.?a|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|mba|mca|m\.?a|m\.?com|m\.?sc|mtech|m\.?tech|phd|master|bachelor)(\b|$)/i.test(combined)) return 'Graduate';
  return '';
}

function qualificationCategorySql() {
  return `(
    case
      when lower(trim(coalesce(qualification_level,''))) ~ '^post[[:space:]-]*graduate$' then 'postgraduate'
      when lower(concat_ws(' ', coalesce(qualification_level, ''), coalesce(qualification, ''))) ~ '(\\mnon[[:space:]-]*grad\\M|\\munder[[:space:]-]*grad\\M|\\mundergraduate\\M|\\mug pursuing\\M|\\mpursuing\\M|\\mappearing\\M|\\mfinal year\\M|\\mlast year\\M|\\m12th\\M|\\m10th\\M|\\mintermediate\\M|\\mhigher secondary\\M|\\mhsc\\M|\\mdiploma\\M|\\miti\\M)'
        then 'non - graduate'
      when lower(concat_ws(' ', coalesce(qualification_level, ''), coalesce(qualification, ''))) ~ '(\\mpost[[:space:]-]*grad\\M|\\mgraduate\\M|\\mb\\.?a\\M|\\mb\\.?com\\M|\\mb\\.?sc\\M|\\mb\\.?tech\\M|\\mbtech\\M|\\mbca\\M|\\mbba\\M|\\mmba\\M|\\mmca\\M|\\mm\\.?a\\M|\\mm\\.?com\\M|\\mm\\.?sc\\M|\\mmtech\\M|\\mm\\.?tech\\M|\\mphd\\M|\\mmaster\\M|\\mbachelor\\M)'
        then 'graduate'
      else ''
    end
  )`;
}

function normalizeOptionalBigIntLike(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d-]/g, '');
  return cleaned || null;
}

function isUndefinedColumnError(error, columnNames = []) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  if (code !== '42703' && !(message.includes('column') && message.includes('does not exist'))) return false;
  if (!columnNames.length) return true;
  return columnNames.some((column) => message.includes(String(column || '').toLowerCase()));
}

async function getSubmissionColumnSet(forceRefresh = false) {
  if (!store.pool) return null;
  const now = Date.now();
  if (!forceRefresh && submissionColumnCache.columns && (now - submissionColumnCache.fetched_at) < (10 * 60 * 1000)) return submissionColumnCache.columns;
  const rows = await store.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'submissions'`);
  const columns = new Set(rows.map((row) => String(row.column_name || '').trim()).filter(Boolean));
  submissionColumnCache.columns = columns;
  submissionColumnCache.fetched_at = now;
  return columns;
}

function filterPayloadToColumnSet(payload = {}, columns = null) {
  if (!(columns instanceof Set) || !columns.size) return { ...(payload || {}) };
  const safe = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (columns.has(key)) safe[key] = value;
  }
  return safe;
}

function pickSubmissionCompatFields(source = {}, includeExtended = true) {
  const result = {
    submission_id: source.submission_id || '',
    candidate_id: source.candidate_id || '',
    jd_id: source.jd_id || '',
    recruiter_code: source.recruiter_code || '',
    status: source.status || '',
    approval_status: source.approval_status || '',
    decision_note: source.decision_note || '',
    approval_requested_at: source.approval_requested_at || '',
    approved_by_name: source.approved_by_name || '',
    approved_at: source.approved_at || '',
    approval_rescheduled_at: source.approval_rescheduled_at || '',
    submitted_at: source.submitted_at || '',
    next_follow_up_at: source.next_follow_up_at || '',
    reminder_snoozed_until: source.reminder_snoozed_until || '',
    reminder_note: source.reminder_note || '',
    reminder_due_at: source.reminder_due_at || '',
    approval_reminder_at: source.approval_reminder_at || '',
    updated_at: source.updated_at || '',
  };
  if (includeExtended) {
    result.effective_submission_at = source.effective_submission_at || '';
    result.submitted_by_user_id = source.submitted_by_user_id || '';
    result.submitted_by_name = source.submitted_by_name || '';
    result.submitted_by_recruiter_code = source.submitted_by_recruiter_code || '';
  }
  return result;
}

async function findSubmissionCompat(candidateId, allowedStatuses = []) {
  const normalizedStatuses = (Array.isArray(allowedStatuses) ? allowedStatuses : [])
    .map((value) => lower(value))
    .filter(Boolean);
  if (mode === 'postgres' && store.pool) {
    const columns = await getSubmissionColumnSet();
    for (const field of ['submission_id','candidate_id','approval_status']) {
      if (!columns.has(field)) throw Object.assign(new Error(`Submission schema missing ${field}. Run 05_SAVE_AND_SUBMIT_FIX.sql.`), { status:503, code:'SCHEMA_MISSING' });
    }
    const statusSql = normalizedStatuses.length
      ? `and lower(coalesce(approval_status::text, '')) = any($2::text[])`
      : '';
    const params = normalizedStatuses.length ? [candidateId, normalizedStatuses] : [candidateId];
    // Use the cached live column set instead of intentionally failing a query
    // and paying for a savepoint/fallback on every profile submission.
    const stamps = ['submitted_at','approval_requested_at','updated_at'].filter(field => columns.has(field));
    const order = stamps.length ? `coalesce(${stamps.map(field => `nullif(${field}::text, '')`).join(', ')}, '')` : 'submission_id';
    return store.one(`select * from public.submissions where candidate_id = $1 ${statusSql} order by ${order} desc limit 1`, params);
  }
  const submissions = await table('submissions');
  const hit = submissions
    .filter((row) => {
      if (String(row.candidate_id) !== String(candidateId)) return false;
      if (!normalizedStatuses.length) return true;
      return normalizedStatuses.includes(lower(row.approval_status));
    })
    .sort((a, b) => String(b.submitted_at || b.approval_requested_at || b.updated_at || '').localeCompare(String(a.submitted_at || a.approval_requested_at || a.updated_at || '')))[0] || null;
  return hit;
}

async function findPendingSubmissionCompat(candidateId) {
  return findSubmissionCompat(candidateId, ['pending']);
}

async function findLatestSubmittedSubmissionCompat(candidateId) {
  return findSubmissionCompat(candidateId, ['pending', 'approved', 'rejected']);
}

async function syncEffectiveSubmissionDate(candidateId, submissionDate) {
  const effectiveStamp = String(submissionDate || '').trim();
  const latest = await findLatestSubmittedSubmissionCompat(candidateId);
  if (!latest?.submission_id) return null;
  const columns = await getSubmissionColumnSet();
  if (columns && !columns.has('effective_submission_at')) throw Object.assign(new Error('Run 05_SAVE_AND_SUBMIT_FIX.sql to save the chosen submission date.'), { status:503, code:'SCHEMA_MISSING' });
  return store.update('submissions', 'submission_id', latest.submission_id, {
    effective_submission_at: effectiveStamp,
    ...(!columns || columns.has('updated_at') ? { updated_at:nowIso() } : {}),
  });
}

function submittedWorkflowResponseItem(candidate = {}, submission = null) {
  // CC26_682: the candidate row is the canonical profile/workflow record.
  // A temporarily missing/older submissions child row must NEVER rewrite a
  // genuinely submitted candidate back to Draft in the API response.
  const approval = lower(candidate?.approval_status || '');
  const candidateHasWorkflow = ['pending', 'approved', 'rejected'].includes(approval)
    || Boolean(String(candidate?.approval_requested_at || candidate?.submitted_by || '').trim());
  const hasSubmission = Boolean(submission?.submission_id);
  return {
    ...candidate,
    submission_exists: hasSubmission ? '1' : '0',
    workflow_incomplete: candidateHasWorkflow && !hasSubmission,
    submission_id: hasSubmission ? submission.submission_id : String(candidate?.submission_id || ''),
  };
}

async function writeSubmissionPayload(existingSubmissionId, payload) {
  return existingSubmissionId
    ? store.update('submissions', 'submission_id', existingSubmissionId, payload)
    : store.insert('submissions', payload);
}

async function saveSubmissionCompat(existingSubmissionId, submission) {
  const fullPayload = pickSubmissionCompatFields(submission, true);
  if (!(mode === 'postgres' && store.pool)) {
    return writeSubmissionPayload(existingSubmissionId, fullPayload);
  }

  // CC26_774: mirror the proven Intern CRM strategy. Read the live submissions
  // column set from PostgreSQL (cached for 10 minutes) BEFORE writing, then send
  // only columns that really exist. This avoids a failed first write/refresh loop
  // on older additive schemas and never deletes or rewrites historical rows.
  let compatiblePayload = fullPayload;
  try {
    const columns = await getSubmissionColumnSet();
    for (const key of ['submission_id','candidate_id','approval_status','submitted_at','reminder_due_at','approval_reminder_at']) if (!columns.has(key)) { const e = new Error(`Submission schema missing ${key}. Run additive setup SQL.`); e.status=503;e.code='SCHEMA_MISSING';throw e; }
    compatiblePayload = filterPayloadToColumnSet(fullPayload, columns);
  } catch (error) { throw error; }

  if (!String(compatiblePayload.submission_id || submission?.submission_id || '').trim()
      || !String(compatiblePayload.candidate_id || submission?.candidate_id || '').trim()) {
    throw new Error('Submission identity is missing. Candidate was kept safely; retry Submit.');
  }

  try {
    return await withSavepoint(() => writeSubmissionPayload(existingSubmissionId, compatiblePayload));
  } catch (error) {
    if (!isUndefinedColumnError(error)) throw error;
    const legacyPayload = pickSubmissionCompatFields(submission, false);
    let compatibleLegacyPayload = legacyPayload;
    try {
      const columns = await getSubmissionColumnSet(true);
      compatibleLegacyPayload = filterPayloadToColumnSet(legacyPayload, columns);
    } catch {}
    if (!String(compatibleLegacyPayload.submission_id || '').trim() || !String(compatibleLegacyPayload.candidate_id || '').trim()) {
      throw new Error('Submission table is missing required identity columns. Candidate is safe; check Supabase schema.');
    }
    return writeSubmissionPayload(existingSubmissionId, compatibleLegacyPayload);
  }
}

function escapeFilename(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'file';
}

function candidateFileLabel(kind) {
  return kind === 'call_recording' ? 'Call Recording' : 'Resume';
}

function candidateFileContentType(filename, fallback = 'application/octet-stream') {
  const lowerName = String(filename || '').toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName.endsWith('.wav')) return 'audio/wav';
  if (lowerName.endsWith('.m4a')) return 'audio/mp4';
  if (lowerName.endsWith('.ogg')) return 'audio/ogg';
  if (lowerName.endsWith('.aac')) return 'audio/aac';
  if (lowerName.endsWith('.webm')) return 'audio/webm';
  if (lowerName.endsWith('.amr')) return 'audio/amr';
  if (lowerName.endsWith('.3gp')) return 'audio/3gpp';
  if (lowerName.endsWith('.mov')) return 'video/quicktime';
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.docx') || lowerName.endsWith('.docm') || lowerName.endsWith('.dotx') || lowerName.endsWith('.dotm')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (lowerName.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (lowerName.endsWith('.rtf')) return 'application/rtf';
  if (lowerName.endsWith('.odt')) return 'application/vnd.oasis.opendocument.text';
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'text/html; charset=utf-8';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return fallback || 'application/octet-stream';
}

const commandExistsCache = new Map();

function commandExists(name) {
  if (commandExistsCache.has(name)) return commandExistsCache.get(name);
  const safeName = String(name || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const probe = spawnSync(checker, [safeName], { stdio: 'ignore' });
  const ok = !probe.error && probe.status === 0;
  commandExistsCache.set(name, ok);
  return ok;
}

function tempFilePath(ext = '') {
  return path.join(os.tmpdir(), `career_crox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
}

function fileBaseName(name, fallback = 'file') {
  return path.parse(String(name || fallback)).name || fallback;
}

function safeReadBuffer(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  } catch {
    return null;
  }
}

function safeCleanup(paths = []) {
  for (const filePath of paths) {
    if (!filePath) continue;
    try { fs.rmSync(filePath, { force: true, recursive: true }); } catch {}
  }
}

function formatUploadKb(bytes) {
  return Math.max(1, Math.ceil(Number(bytes || 0) / 1024));
}

function formatUploadSize(bytes) {
  const numeric = Number(bytes || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 KB';
  if (numeric >= 1024 * 1024) return `${(numeric / (1024 * 1024)).toFixed(numeric >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.ceil(numeric / 1024))} KB`;
}

function uploadPolicy(fileKind) {
  if (fileKind === 'call_recording') {
    return {
      finalMaxBytes: STRICT_RECORDING_MAX_BYTES,
      allowedExtensions: RECORDING_ALLOWED_EXTENSIONS,
      label: 'Call recording',
      friendlyTypes: 'MP3, WAV, M4A, AAC, OGG, WEBM, MP4, AMR, 3GP, MOV',
      compressorCommand: 'ffmpeg',
    };
  }
  return {
    finalMaxBytes: STRICT_RESUME_MAX_BYTES,
    allowedExtensions: RESUME_ALLOWED_EXTENSIONS,
    label: 'Resume',
    friendlyTypes: 'PDF, PNG, JPG, JPEG, WEBP',
    compressorCommand: 'gs / convert',
  };
}

function isAllowedCandidateUploadType(fileKind, originalName = '', mimeType = '') {
  const policy = uploadPolicy(fileKind);
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  if (fileKind === 'resume') {
    if (policy.allowedExtensions.has(ext)) return true;
    if (lowerMime === 'application/pdf' || lowerMime.startsWith('image/')) return true;
    if (lowerMime.includes('msword') || lowerMime.includes('officedocument.wordprocessingml') || lowerMime.includes('opendocument.text') || lowerMime.includes('rtf') || lowerMime.startsWith('text/')) return true;
    return false;
  }
  if (fileKind === 'call_recording') {
    if (policy.allowedExtensions.has(ext)) return true;
    if (lowerMime.startsWith('audio/') || lowerMime.startsWith('video/')) return true;
    return false;
  }
  return false;
}

function uploadSizeErrorMessage(fileKind, reason = '') {
  const policy = uploadPolicy(fileKind);
  const sizeLabel = formatUploadSize(policy.finalMaxBytes);
  const reasonPart = reason ? ` ${reason}` : '';
  if (fileKind === 'call_recording') {
    return `${policy.label} ko auto-compress karke maximum ${sizeLabel} ke andar save kiya jayega.${reasonPart}`;
  }
  return `${policy.label} ko auto-compress karke maximum ${sizeLabel} ke andar save kiya jayega.${reasonPart}`;
}

function compressPdfBuffer(buffer, originalName) {
  if (!commandExists('gs')) return null;
  const input = tempFilePath('.pdf');
  const outputs = [tempFilePath('.pdf'), tempFilePath('.pdf'), tempFilePath('.pdf')];
  const candidates = [];
  try {
    fs.writeFileSync(input, buffer);
    const profiles = ['/screen', '/ebook', '/screen'];
    const extraFlags = [[], [], ['-dColorImageDownsampleType=/Bicubic', '-dColorImageResolution=110', '-dGrayImageDownsampleType=/Bicubic', '-dGrayImageResolution=110', '-dMonoImageResolution=200']];
    for (let index = 0; index < profiles.length; index += 1) {
      const output = outputs[index];
      const profile = profiles[index];
      const run = spawnSync('gs', ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', `-dPDFSETTINGS=${profile}`, ...extraFlags[index], '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${output}`, input], { stdio: 'ignore' });
      if (run.error || run.status !== 0) continue;
      const compressed = safeReadBuffer(output);
      if (!compressed || !compressed.length) continue;
      candidates.push({ buffer: compressed, fileName: `${fileBaseName(originalName, 'resume')}.pdf`, mimeType: 'application/pdf' });
    }
    const best = candidates.filter((item) => item.buffer.length < buffer.length).sort((a, b) => a.buffer.length - b.buffer.length)[0] || null;
    return best;
  } finally {
    safeCleanup([input, ...outputs]);
  }
}

function extractPdfTextBuffer(buffer, originalName) {
  if (!commandExists('pdftotext')) return null;
  const input = tempFilePath('.pdf');
  const output = tempFilePath('.txt');
  try {
    fs.writeFileSync(input, buffer);
    const run = spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', input, output], { stdio: 'ignore' });
    if (run.error || run.status !== 0) return null;
    const extracted = safeReadBuffer(output);
    if (!extracted || !extracted.length) return null;
    const text = normalizeWhitespace(String(extracted.toString('utf8') || ''));
    if (!text) return null;
    const compactBuffer = Buffer.from(text.replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' '), 'utf8');
    if (!compactBuffer.length) return null;
    return {
      buffer: compactBuffer,
      fileName: `${fileBaseName(originalName, 'resume')}.txt`,
      mimeType: 'text/plain; charset=utf-8',
    };
  } finally {
    safeCleanup([input, output]);
  }
}

function compressImageBuffer(buffer, originalName) {
  if (!commandExists('convert')) return null;
  const ext = path.extname(String(originalName || '')).toLowerCase() || '.png';
  const input = tempFilePath(ext);
  const outputs = [tempFilePath('.jpg'), tempFilePath('.jpg'), tempFilePath('.jpg')];
  const candidates = [];
  try {
    fs.writeFileSync(input, buffer);
    const profiles = [
      ['-auto-orient', '-strip', '-resize', '1600x1600>', '-quality', '60', '-interlace', 'Plane'],
      ['-auto-orient', '-strip', '-resize', '1280x1280>', '-quality', '45', '-interlace', 'Plane'],
      ['-auto-orient', '-strip', '-resize', '1024x1024>', '-quality', '30', '-interlace', 'Plane'],
    ];
    for (let index = 0; index < profiles.length; index += 1) {
      const output = outputs[index];
      const args = [input, ...profiles[index], output];
      const run = spawnSync('convert', args, { stdio: 'ignore' });
      if (run.error || run.status !== 0) continue;
      const compressed = safeReadBuffer(output);
      if (!compressed || !compressed.length) continue;
      candidates.push({ buffer: compressed, fileName: `${fileBaseName(originalName, 'resume')}.jpg`, mimeType: 'image/jpeg' });
    }
    const best = candidates.filter((item) => item.buffer.length < buffer.length).sort((a, b) => a.buffer.length - b.buffer.length)[0] || null;
    return best;
  } finally {
    safeCleanup([input, ...outputs]);
  }
}

function compressAudioBuffer(buffer, originalName) {
  if (!commandExists('ffmpeg')) return null;
  const ext = path.extname(String(originalName || '')).toLowerCase() || '.bin';
  const input = tempFilePath(ext);
  const outputs = [tempFilePath('.ogg'), tempFilePath('.ogg'), tempFilePath('.ogg'), tempFilePath('.mp3'), tempFilePath('.mp3'), tempFilePath('.mp3')];
  const candidates = [];
  try {
    fs.writeFileSync(input, buffer);
    const profiles = [
      { args: ['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '16000', '-c:a', 'libopus', '-b:a', '8k', '-application', 'voip'], ext: '.ogg', mime: 'audio/ogg' },
      { args: ['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '12000', '-c:a', 'libopus', '-b:a', '6k', '-application', 'voip'], ext: '.ogg', mime: 'audio/ogg' },
      { args: ['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '8000', '-c:a', 'libopus', '-b:a', '5k', '-application', 'voip'], ext: '.ogg', mime: 'audio/ogg' },
      { args: ['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '16000', '-b:a', '16k'], ext: '.mp3', mime: 'audio/mpeg' },
      { args: ['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '12000', '-b:a', '12k'], ext: '.mp3', mime: 'audio/mpeg' },
      { args: ['-vn', '-map_metadata', '-1', '-ac', '1', '-ar', '8000', '-b:a', '8k'], ext: '.mp3', mime: 'audio/mpeg' },
    ];
    for (let index = 0; index < profiles.length; index += 1) {
      const output = outputs[index];
      const profile = profiles[index];
      const args = ['-y', '-i', input, ...profile.args, output];
      const run = spawnSync('ffmpeg', args, { stdio: 'ignore' });
      if (run.error || run.status !== 0) continue;
      const compressed = safeReadBuffer(output);
      if (!compressed || !compressed.length) continue;
      candidates.push({ buffer: compressed, fileName: `${fileBaseName(originalName, 'call-recording')}${profile.ext}`, mimeType: profile.mime });
    }
    const best = candidates.filter((item) => item.buffer.length < buffer.length).sort((a, b) => a.buffer.length - b.buffer.length)[0] || null;
    return best;
  } finally {
    safeCleanup([input, ...outputs]);
  }
}

function extractReadableChunks(binaryText) {
  return (String(binaryText || '').match(/[A-Za-z0-9@._%+\-/,:() ]{5,}/g) || []).join('\n');
}

function xmlResumeText(xml) {
  return normalizeWhitespace(String(xml || '')
    .replace(/<w:tab\/?\s*>/gi, ' ')
    .replace(/<text:tab\/?\s*>/gi, ' ')
    .replace(/<w:br\/?\s*>/gi, '\n')
    .replace(/<text:line-break\/?\s*>/gi, '\n')
    .replace(/<w:p[^>]*>/gi, '\n')
    .replace(/<text:p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

function extractTextResumeBuffer(buffer, originalName, mimeType = '') {
  const lowerName = String(originalName || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  let text = '';
  try {
    if (lowerMime.startsWith('text/') || ['.txt', '.md', '.csv'].some((ext) => lowerName.endsWith(ext))) {
      text = buffer.toString('utf8');
    } else if (lowerMime.includes('html') || ['.html', '.htm'].some((ext) => lowerName.endsWith(ext))) {
      text = htmlToText(buffer.toString('utf8'));
    } else if (lowerMime.includes('rtf') || lowerName.endsWith('.rtf')) {
      text = String(buffer.toString('utf8'))
        .replace(/\\par[d]?/gi, '\n')
        .replace(/\\tab/gi, ' ')
        .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
        .replace(/\\[a-z]+-?\d* ?/gi, ' ')
        .replace(/[{}]/g, ' ');
    } else if (lowerMime.includes('officedocument.wordprocessingml') || ['.docx', '.docm', '.dotx', '.dotm'].some((ext) => lowerName.endsWith(ext))) {
      if (commandExists('unzip')) {
        const input = tempFilePath('.docx');
        try {
          fs.writeFileSync(input, buffer);
          const run = spawnSync('unzip', ['-p', input, 'word/document.xml'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          if (!run.error && run.status === 0 && run.stdout) text = xmlResumeText(run.stdout);
        } finally { safeCleanup([input]); }
      }
      if (!text) text = extractReadableChunks(buffer.toString('latin1'));
    } else if (lowerMime.includes('opendocument.text') || lowerName.endsWith('.odt')) {
      if (commandExists('unzip')) {
        const input = tempFilePath('.odt');
        try {
          fs.writeFileSync(input, buffer);
          const run = spawnSync('unzip', ['-p', input, 'content.xml'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          if (!run.error && run.status === 0 && run.stdout) text = xmlResumeText(run.stdout);
        } finally { safeCleanup([input]); }
      }
      if (!text) text = extractReadableChunks(buffer.toString('latin1'));
    } else if (lowerMime.includes('msword') || lowerName.endsWith('.doc')) {
      if (commandExists('antiword')) {
        const input = tempFilePath('.doc');
        try {
          fs.writeFileSync(input, buffer);
          const run = spawnSync('antiword', [input], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
          if (!run.error && run.status === 0 && run.stdout) text = run.stdout;
        } finally { safeCleanup([input]); }
      }
      if (!text) text = extractReadableChunks(buffer.toString('latin1'));
    }
  } catch {}
  text = normalizeWhitespace(text);
  if (!text) return null;
  const compactText = text.replace(/\n{2,}/g, '\n').replace(/[ \t]{2,}/g, ' ');
  const compactBuffer = Buffer.from(compactText, 'utf8');
  if (!compactBuffer.length) return null;
  return {
    buffer: compactBuffer,
    fileName: `${fileBaseName(originalName, 'resume')}.txt`,
    mimeType: 'text/plain; charset=utf-8',
  };
}

function maybeOptimizeCandidateUpload({ fileKind, originalName, mimeType, buffer }) {
  const lowerName = String(originalName || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  if (!buffer?.length) return null;
  if (fileKind === 'call_recording') {
    if (lowerMime.startsWith('audio/') || lowerMime.startsWith('video/') || ['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm', '.mp4'].some((ext) => lowerName.endsWith(ext))) {
      return compressAudioBuffer(buffer, originalName);
    }
    return null;
  }
  if (fileKind === 'resume') {
    if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) return extractPdfTextBuffer(buffer, originalName) || compressPdfBuffer(buffer, originalName);
    if (lowerMime.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => lowerName.endsWith(ext))) return compressImageBuffer(buffer, originalName);
    if (['.doc', '.docx', '.docm', '.dotx', '.dotm', '.odt', '.rtf', '.txt', '.html', '.htm', '.md'].some((ext) => lowerName.endsWith(ext)) || lowerMime.includes('msword') || lowerMime.includes('officedocument.wordprocessingml') || lowerMime.includes('opendocument.text') || lowerMime.includes('rtf') || lowerMime.startsWith('text/')) {
      return extractTextResumeBuffer(buffer, originalName, mimeType);
    }
  }
  return null;
}

function invalidateCandidateCaches() {
  candidateListCache.clear();candidateListMetaCache.clear();candidateNavCache.clear();duplicateReviewCache.clear();
  // Candidate edits cannot flush settings, staff-directory or phone-session caches.
  clearAllCaches(['candidates','dashboard','revenue','approvals']);
}


function safeJsonStringify(value, fallback = '{}') {
  try {
    const json = JSON.stringify(value ?? {});
    return json === undefined ? fallback : json;
  } catch {
    return fallback;
  }
}

function safeRowObject(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) out[key] = '';
    else if (Array.isArray(value)) out[key] = value.map((item) => String(item ?? '')).filter(Boolean).join(', ');
    else if (typeof value === 'object') out[key] = safeJsonStringify(value, '');
    else out[key] = String(value);
  }
  return out;
}

function safeRows(rows, limit = 100) {
  return (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, Number(limit || 0) || 0)).map(safeRowObject);
}

function safeActivityRows(rows, limit = 80) {
  return safeRows(rows, limit).map((row, index) => ({
    ...row,
    activity_id: String(row.activity_id || row.id || `activity-${index}`),
    action_type: String(row.action_type || 'activity'),
    username: String(row.username || ''),
    metadata: typeof row.metadata === 'string' ? row.metadata : safeJsonStringify(row.metadata, '{}'),
    created_at: String(row.created_at || row.updated_at || ''),
  }));
}

function safeNoteRows(rows, limit = 60) {
  return safeRows(rows, limit).map((row, index) => ({
    ...row,
    id: String(row.id || row.note_id || `note-${index}`),
    username: String(row.username || row.created_by_name || row.user_name || 'Someone'),
    body: String(row.body || row.note || row.notes || ''),
    created_at: String(row.created_at || row.updated_at || ''),
    parent_note_id: String(row.parent_note_id || ''),
    reply_to_note_id: String(row.reply_to_note_id || ''),
    reply_to_username: String(row.reply_to_username || ''),
    reply_preview: String(row.reply_preview || ''),
  }));
}

function sanitizeCandidateFile(file) {
  if (!file || typeof file !== 'object') return file;
  const clone = { ...file };
  delete clone.content_base64;
  return clone;
}

function withSoftTimeout(task, fallback, timeoutMs = 6000) {
  return Promise.race([
    Promise.resolve().then(task).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function listCandidateFiles(candidateId) {
  if (mode === 'postgres' && store.pool) {
    const rows = await store.query(`select file_id, candidate_id, file_kind, original_name, mime_type, size_bytes, uploaded_by_user_id, uploaded_by_name, created_at from public.candidate_files where candidate_id = $1 order by created_at desc, file_id desc`, [candidateId]);
    return rows.map(sanitizeCandidateFile);
  }
  return (await table('candidate_files'))
    .filter((row) => String(row.candidate_id) === String(candidateId))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.file_id || '').localeCompare(String(a.file_id || '')))
    .map(sanitizeCandidateFile);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}
function nowLocalDateTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function cleanScheduledDate(value) {
  const raw = String(value || '').trim();
  if (!raw || /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const stamp = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(raw) ? raw : `${raw}+05:30`);
  return Number.isFinite(stamp.getTime()) ? stamp.toISOString() : raw;
}
function cleanDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}
const FILTER_ALL_MARKER = '__ALL__';
function splitCsv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}
function parseMultiValue(value) {
  const values = Array.isArray(value) ? value.flatMap((item) => splitCsv(item)) : splitCsv(value);
  if (values.some((item) => lower(item) === lower(FILTER_ALL_MARKER))) return [];
  const seen = new Set();
  return values.filter((item) => {
    const key = lower(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function normalizeLocationFilterValue(value) {
  return lower(value).replace(/\bgurugram\b/g, 'gurgaon').replace(/\s+/g, ' ').trim();
}
function csvMatchesAny(value, filters, options = {}) {
  if (!Array.isArray(filters) || !filters.length) return true;
  const normalizer = options.location ? normalizeLocationFilterValue : lower;
  const wanted = new Set(filters.map(normalizer).filter(Boolean));
  return splitCsv(value).some((item) => wanted.has(normalizer(item)));
}
function exactMatchesAny(value, filters) {
  if (!Array.isArray(filters) || !filters.length) return true;
  const target = lower(value);
  return filters.some((item) => lower(item) === target);
}
function dataNoteTokens(row = {}) {
  return candidateDataNotesSearchText(row).split(/[,|;]+/).map((item) => item.trim()).filter(Boolean);
}
function dataNotesMatchAny(row, filters) {
  if (!Array.isArray(filters) || !filters.length) return true;
  const wanted = new Set(filters.map(lower).filter(Boolean));
  return dataNoteTokens(row).some((item) => wanted.has(lower(item)));
}
function numericFilterValue(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
function candidateDataNotesSearchText(row = {}) {
  return String(row.data_notes || '').trim();
}

function candidateDataNotesSqlExpression() {
  return `coalesce(data_notes, '')`;
}

function phoneSearchSql(valueExpression, placeholder) {
  return `right(regexp_replace(coalesce(${valueExpression}, ''), '\D', '', 'g'), 10) like '%' || right(regexp_replace(${placeholder}, '\D', '', 'g'), 10) || '%'`;
}
const BUCKET_MAX_ACTIVE = bucketPolicy.MAX_ACTIVE;
const BUCKET_TOTAL_DAYS = bucketPolicy.TOTAL_DAYS;
const BUCKET_WARNING_DAYS = bucketPolicy.WARNING_DAYS;
const TERMINAL_STATUSES = new Set(['closed', 'joined', 'hired', 'rejected', 'not interested', 'not intrested', 'not_interested', 'completed', 'done']);
const TERMINAL_APPROVALS = new Set([]);

function isLeadership(user) {
  return isAccessLeadership(user);
}
function canManageBucketOut(user) {
  return isLeadership(user);
}
function canDeleteCandidate(user) {
  return isAdminOrManager(user);
}
function parseMaybeDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function startOfDay(value) {
  const parsed = parseMaybeDate(value);
  if (!parsed) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}
function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return 0;
  return Math.max(0, Math.floor((dateA.getTime() - dateB.getTime()) / 86400000));
}
function pickBucketAssignedAt(row) {
  return row?.bucket_assigned_at || row?.allocated_at || row?.assigned_on || row?.created_at || row?.submission_date || row?.updated_at || '';
}
function isTerminalCandidate(row) {
  return TERMINAL_STATUSES.has(lower(row?.status));
}
function isFreshCandidate(row) {
  if (isTerminalCandidate(row)) return false;
  if (detailsAreCompleted(row)) return false;
  if (approvalMovedBeyondDraft(row)) return false;
  if (String(row?.follow_up_at || '').trim()) return false;
  return true;
}
function isFollowupCandidate(row) {
  if (isTerminalCandidate(row)) return false;
  return Boolean(String(row?.follow_up_at || '').trim());
}
function isPendingFollowup(row) {
  if (!isFollowupCandidate(row)) return false;
  const followDate = parseMaybeDate(row?.follow_up_at);
  if (!followDate) return false;
  if (lower(row?.follow_up_status) === 'done') return false;
  return followDate.getTime() <= Date.now();
}
function computeBucketMeta(row) { return bucketPolicy.meta(row); }

function candidateProfileWorkStarted(row = {}) {
  if (String(row?.last_updated_at || '').trim()) return true;
  const status = lower(row?.status || '');
  const approval = lower(row?.approval_status || '');
  if (status && status !== 'draft') return true;
  if (approval && approval !== 'draft') return true;
  if (String(row?.call_connected || '').trim()) return true;
  if (String(row?.process || '').trim()) return true;
  if (String(row?.follow_up_at || '').trim()) return true;
  if (String(row?.interview_reschedule_date || row?.interview_date || '').trim()) return true;
  return ['total_experience','relevant_experience','ctc_monthly','in_hand_salary','relevant_experience_range','relevant_in_hand_range']
    .some((key) => {
      const value = String(row?.[key] ?? '').trim();
      return value !== '' && value !== '0' && lower(value) !== 'fresher';
    });
}

function maskUntouchedCandidateDefaults(row = {}) {
  if (candidateProfileWorkStarted(row)) return { ...(row || {}) };
  const next = { ...(row || {}) };
  // Old imports/frontends used to inject these values before anybody worked the profile.
  // Hide them without deleting or rewriting the old database row.
  next.preferred_location = '';
  const synthetic = {
    qualification_level: new Set(['graduate']),
    career_gap: new Set(['fresher']),
    communication_skill: new Set(['average','good']),
    profile_priority: new Set(['medium']),
    virtual_onsite: new Set(['walkin']),
    documents_availability: new Set(['yes']),
    looking_for_job: new Set(['yes']),
    all_details_sent: new Set(['pending']),
  };
  for (const [key, values] of Object.entries(synthetic)) {
    const current = lower(next[key] || '');
    if (current && values.has(current)) next[key] = '';
  }
  // CC865: preserve explicitly stored zero salary/experience values.
  if (lower(next.relevant_experience_range || '') === 'fresher') next.relevant_experience_range = '';

  return next;
}

function profileWorkStartedSql() {
  return `(
    trim(coalesce(last_updated_at,'')) <> ''
    or lower(trim(coalesce(status,''))) not in ('','draft')
    or lower(trim(coalesce(approval_status,''))) not in ('','draft')
    or trim(coalesce(call_connected,'')) <> ''
    or trim(coalesce(process,'')) <> ''
    or trim(coalesce(follow_up_at,'')) <> ''
    or trim(coalesce(interview_reschedule_date,'')) <> ''
    or trim(coalesce(total_experience,'')) not in ('','0')
    or trim(coalesce(relevant_experience,'')) not in ('','0')
    or trim(coalesce(ctc_monthly,'')) not in ('','0')
    or trim(coalesce(in_hand_salary,'')) not in ('','0')
  )`;
}

// Return an exact editable baseline separately from presentation-only defaults.
// It travels with the profile response, so Save/Submit needs no extra profile GET.
function candidateEditResponse(row, user, displayRow = row) {
  const base = Object.fromEntries(PERSISTED_CANDIDATE_FIELDS
    .filter(key => !['notes','resume_filename','recording_filename'].includes(key))
    .map(key => [key, row?.[key] ?? '']));
  return { ...sanitizeCandidateForUser(enrichCandidate(displayRow), user),
    _edit_base_json: JSON.stringify(base) };
}

function enrichCandidate(row) {
  const meta = computeBucketMeta(row);
  const displayRow = maskUntouchedCandidateDefaults(row);
  return {
    ...displayRow,
    qualification_level: displayRow?.qualification_level ? normalizeQualificationCategory(displayRow.qualification_level || displayRow.degree || '', displayRow.qualification || '') : '',
    bucket_assigned_at: row.bucket_assigned_at || meta.assignedRaw,
    bucket_days_passed: meta.daysPassed,
    bucket_days_left: meta.fresh ? '' : meta.daysLeft,
    bucket_stage: meta.stage,
    bucket_status_label: meta.statusLabel,
    bucket_priority_label: meta.priority,
    bucket_is_terminal: meta.terminal,
    bucket_is_fresh: meta.fresh,
    bucket_is_followup: meta.followup,
    bucket_is_followup_due: meta.pendingFollowup,
    bucket_is_bucket_out: meta.bucketOut,
    bucket_is_active: meta.active,
    bucket_is_allocated: bucketPolicy.hasAllocatedOwner(row) && !meta.terminal && !meta.bucketOut,
    bucket_expires_at: meta.expiresAt,
    bucket_date_invalid: meta.dateInvalid,
    bucket_capacity_max: BUCKET_MAX_ACTIVE,
  };
}
function inferCandidateOwnerRole(row) { return bucketPolicy.ownerRole(row); }
function isAssignedBucketOwner(row) { return bucketPolicy.isAssigned(row); }

function isUnallocatedCandidate(row) {
  return !bucketPolicy.hasAllocatedOwner(row);
}
function isDeletedCandidate(row) {
  const status = lower(row?.status || '');
  const approval = lower(row?.approval_status || '');
  const details = lower(row?.all_details_sent || '');
  const notes = lower(row?.data_notes || '');
  return Boolean(String(row?.deleted_at || '').trim())
    || status === 'deleted'
    || status === '__deleted__'
    || status === 'archived'
    || approval === 'deleted'
    || approval === '__deleted__'
    || approval === 'archived'
    || details === '__deleted__'
    || details === 'deleted'
    || details === 'archived'
    || notes.includes('[crm-deleted]');
}

function visibleCandidate(row, user) { return visibleCandidateForUser(row,user); }

function candidateNavVisibilitySql(alias = '') {
  const p = alias ? `${alias}.` : '';
  // CC26_681: All Profiles/navigation means every visible non-deleted candidate.
  // Duplicate-marked rows stay visible here; the dedicated duplicate review screen
  // remains available for duplicate-only work.
  return `coalesce(${p}deleted_at, '') = ''
    and lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}all_details_sent, '')) not in ('deleted', 'archived')
    and lower(coalesce(${p}data_notes, '')) not like '%[crm-deleted]%'`;
}

function resolveLastViewedMaxDays(filters) {
  const mode = lower(filters?.last_viewed_mode || '');
  if (mode === 'lt1') return 1;
  if (mode === 'lt2') return 2;
  if (mode === 'lt5') return 5;
  if (mode === 'custom') {
    const numeric = Number(filters?.last_viewed_days || 0) || 0;
    return numeric > 0 ? Math.min(365, numeric) : 0;
  }
  return 0;
}
function matchesLastViewedWindow(row, filters) {
  const mode = lower(filters?.last_viewed_mode || '');
  if (!mode) return true;
  const viewedAt = parseMaybeDate(row?.last_viewed_at);
  if (!viewedAt) return false;
  const now = new Date();
  if (mode === 'today') {
    const viewedDay = startOfDay(viewedAt);
    const today = startOfDay(now);
    return Boolean(viewedDay && today && viewedDay.getTime() === today.getTime());
  }
  const maxDays = resolveLastViewedMaxDays(filters);
  if (!maxDays) return true;
  return (now.getTime() - viewedAt.getTime()) <= (maxDays * 86400000);
}
function matchesBucketView(row, filters, user = null) {
  const view = lower(filters?.bucket_view || 'all');
  if (!view || view === 'all') return true;
  if (view === 'my_fresh') return Boolean(user && candidateBelongsToUser(row, user) && row.bucket_is_fresh && !row.bucket_is_bucket_out);
  if (view === 'my_working') return Boolean(user && candidateBelongsToUser(row, user) && row.bucket_is_active && !row.bucket_is_fresh && !row.bucket_is_followup_due && !row.bucket_is_bucket_out && !row.bucket_is_terminal);
  if (view === 'fresh') return row.bucket_is_fresh && !row.bucket_is_bucket_out;
  if (view === 'followup') return row.bucket_is_active && row.bucket_is_followup && !row.bucket_is_bucket_out;
  if (view === 'followup_due') return row.bucket_is_active && row.bucket_is_followup_due && !row.bucket_is_bucket_out;
  if (view === 'allocated') return Boolean(row.bucket_is_active);
  if (view === 'other') return !row.bucket_is_active;
  if (view === 'warning') return row.bucket_stage === 'warning';
  if (view === 'last_day') return row.bucket_stage === 'last_day';
  if(view==='safe')return row.bucket_stage==='safe';
  if (view === 'days_4_plus') return row.bucket_is_active && row.bucket_days_left >= 4 && !row.bucket_is_bucket_out && !row.bucket_is_terminal && !row.bucket_is_fresh;
  if (view === 'days_3') return row.bucket_is_active && row.bucket_days_left === 3 && !row.bucket_is_bucket_out;
  if (view === 'days_2') return row.bucket_is_active && row.bucket_days_left === 2 && !row.bucket_is_bucket_out;
  if (view === 'days_1') return row.bucket_is_active && row.bucket_days_left === 1 && !row.bucket_is_bucket_out;
  if (view === 'unallocated') return !row.bucket_is_active;
  if (view === 'bucket_out' || view === 'all_bucket_out_profiles') return row.bucket_is_bucket_out;
  return true;
}
function compareStableCandidateOrder(a, b) {
  const aOrder = stableCandidateOrderValue(a);
  const bOrder = stableCandidateOrderValue(b);
  if (aOrder !== bOrder) return bOrder - aOrder;
  return String(b.created_at || b.updated_at || '').localeCompare(String(a.created_at || a.updated_at || '')) || String(b.candidate_id || '').localeCompare(String(a.candidate_id || ''));
}

function sortBucketRows(rows, bucketView = 'all') {
  const view = lower(bucketView || 'all');
  const copy = [...rows];
  copy.sort((a, b) => {
    if (view === 'all') return compareStableCandidateOrder(a, b);
    if (view === 'fresh') {
      const aUntouched = hasDialAttempt(a) ? 1 : 0;
      const bUntouched = hasDialAttempt(b) ? 1 : 0;
      if (aUntouched !== bUntouched) return aUntouched - bUntouched;
      if (aUntouched === 0) return compareStableCandidateOrder(a, b);
      const aDial = parseMaybeDate(a.last_dialed_at)?.getTime() || 0;
      const bDial = parseMaybeDate(b.last_dialed_at)?.getTime() || 0;
      if (aDial !== bDial) return aDial - bDial;
      return compareStableCandidateOrder(a, b);
    }
    if (view === 'followup') {
      const aDate = parseMaybeDate(a.follow_up_at)?.getTime() || Number.MAX_SAFE_INTEGER;
      const bDate = parseMaybeDate(b.follow_up_at)?.getTime() || Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      return compareStableCandidateOrder(a, b);
    }
    if (view === 'bucket_out') {
      if (a.bucket_days_passed !== b.bucket_days_passed) return b.bucket_days_passed - a.bucket_days_passed;
      return compareStableCandidateOrder(a, b);
    }
    const aLeft = Number.isFinite(Number(a.bucket_days_left)) ? Number(a.bucket_days_left) : Number.MAX_SAFE_INTEGER;
    const bLeft = Number.isFinite(Number(b.bucket_days_left)) ? Number(b.bucket_days_left) : Number.MAX_SAFE_INTEGER;
    if (aLeft !== bLeft) return aLeft - bLeft;
    return compareStableCandidateOrder(a, b);
  });
  return copy;
}
function buildBucketSummary(rows, user = null) {
  const activeRows = rows.filter((row) => row.bucket_is_active);
  const unallocatedRows = rows.filter((row) => isUnallocatedCandidate(row));
  const allocatedRows = rows.filter((row) => !isUnallocatedCandidate(row) && !row.bucket_is_terminal && !row.bucket_is_bucket_out);
  // CC74: My Fresh is an OWNERSHIP counter, not an active-allocation counter.
  // Fresh rows are intentionally not in activeRows, so filtering activeRows first
  // made TL/recruiter owned fresh profiles show up in the table but count as zero.
  // Both counters now use exactly the same predicate as their clickable slices.
  const assignedToUser = user ? rows.filter((row) => candidateBelongsToUser(row, user)) : [];
  const myFreshRows = assignedToUser.filter((row) => row.bucket_is_fresh && !row.bucket_is_bucket_out);
  const myWorkingRows = assignedToUser.filter((row) => row.bucket_is_active && !row.bucket_is_fresh && !row.bucket_is_followup_due && !row.bucket_is_bucket_out && !row.bucket_is_terminal);

  return {
    total_visible: rows.length,
    active_bucket: activeRows.length,
    bucket_capacity_max: BUCKET_MAX_ACTIVE,
    fresh_profiles: rows.filter((row) => row.bucket_is_fresh && !row.bucket_is_bucket_out).length,
    followup_profiles: activeRows.filter((row) => row.bucket_is_followup).length,
    pending_followups: activeRows.filter((row) => row.bucket_is_bucket_out ? false : row.bucket_is_followup_due).length,
    allocated_profiles: activeRows.length,
    other_profiles: rows.length - activeRows.length,
    unallocated_profiles: rows.length-activeRows.length,
    warning_profiles: allocatedRows.filter((row) => row.bucket_stage === 'warning').length,
    last_day_profiles: allocatedRows.filter((row) => row.bucket_stage === 'last_day').length,
    safe_profiles: allocatedRows.filter((row) => row.bucket_stage === 'safe').length,
    bucket_out_profiles: rows.filter((row) => row.bucket_is_bucket_out).length,
    all_bucket_out_profiles: rows.filter((row) => row.bucket_is_bucket_out).length,
    days_1: allocatedRows.filter((row) => Number(row.bucket_days_left) === 1).length,
    days_2: allocatedRows.filter((row) => Number(row.bucket_days_left) === 2).length,
    days_3: allocatedRows.filter((row) => Number(row.bucket_days_left) === 3).length,
    days_4_plus: allocatedRows.filter((row) => Number(row.bucket_days_left) >= 4).length,
    my_fresh_profiles: myFreshRows.length,
    my_working_profiles: myWorkingRows.length,
  };
}
function makeFastId(prefix = 'X') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}
function makeFastBigIntId() {
  return Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`);
}

async function notifyNoteReply(req,item){
 const ref=item.reply_to_note_id||item.parent_note_id;if(!ref||lower(item.note_type)==='private')return;
 const parent=await store.findById('notes','id',ref);if(!parent||String(parent.candidate_id)!==String(item.candidate_id))return;
 const person=await store.findById('users','username',parent.username);
 const candidate=await store.findById('candidates','candidate_id',item.candidate_id);if(!candidate)return;
 await require('../lib/workflowNotifications').notify(candidate,req.user,(req.user.full_name||req.user.username)+' replied to a note',String(item.body).slice(0,500),{note_id:item.id,open_path:'/candidate/'+encodeURIComponent(item.candidate_id)+'?jump=notes'},person?[person.user_id]:[]);
}

async function makeNotification(userId, title, message, category = 'general', metadata = '') {
  const item = {
    notification_id: makeFastId('N'),
    user_id: userId,
    title,
    message,
    category,
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  };
  await store.insert('notifications', item);
  await afterCommit(()=>require('../lib/approvalLive').publishToUsers([userId],'notification',{item}));
  return item;
}

function logActivity(req, candidateId, actionType, metadata = {}) {
  return afterCommit(() => writeActivity(req, candidateId, actionType, metadata));
}
async function writeActivity(req, candidateId, actionType, metadata = {}) {
  const activityId = String(makeFastBigIntId());
  const item = {
    // Keep both columns populated. Older CRM databases have `id` as the primary key,
    // while newer code reads `activity_id`. Leaving `id` blank made timeline writes fail.
    id: activityId,
    activity_id: activityId,
    user_id: req.user?.user_id || '',
    username: req.user?.username || '',
    action_type: actionType,
    candidate_id: candidateId,
    metadata: safeJsonStringify(metadata),
    created_at: nowIso(),
  };
  try {
    await store.insert('activity_log', item);
  } catch (error) {
    // Compatibility with a rare newer table created with activity_id only.
    if (!isUndefinedColumnError(error, ['id'])) throw error;
    const activityIdOnly = { ...item };
    delete activityIdOnly.id;
    await store.insert('activity_log', activityIdOnly);
  }
  return item;
}

function noteSortStamp(row = {}) {
  const stamp = new Date(row.created_at || row.updated_at || 0).getTime();
  if (Number.isFinite(stamp) && stamp > 0) return stamp;
  const idNumber = Number(String(row.id || row.note_id || '').replace(/\D+/g, ''));
  return Number.isFinite(idNumber) ? idNumber : 0;
}

function latestCandidateNote(candidate = {}, notes = []) {
  const candidateId = String(candidate?.candidate_id || '').trim();
  const latest = (Array.isArray(notes) ? notes : [])
    .filter((note) => String(note?.candidate_id || '').trim() === candidateId)
    .sort((a, b) => noteSortStamp(b) - noteSortStamp(a))[0] || null;
  const body = String(latest?.body || latest?.note || latest?.notes || '').trim()
    || String(candidate.follow_up_note || '').trim()
    || String(candidate.notes || '').trim()
    || String(candidate.data_notes || '').trim()
    || '';
  return body.replace(/\s+/g, ' ').slice(0, 500);
}

async function maybeCreateFollowupDueNotification(req, candidate, lastNote = '') {
  try {
    const userId = String(req.user?.user_id || '').trim();
    const candidateId = String(candidate?.candidate_id || '').trim();
    const followUpAt = String(candidate?.follow_up_at || '').trim();
    const dueAt = new Date(followUpAt || 0).getTime();
    if (!userId || !candidateId || !dueAt || dueAt > Date.now()) return false;
    const reminderKey = `followup:${candidateId}:${followUpAt}`;
    const existing = (await table('notifications')).some((notification) => {
      if (String(notification.user_id || '') !== userId) return false;
      if (String(notification.category || '').toLowerCase() !== 'followup') return false;
      return String(notification.metadata || '').includes(reminderKey);
    });
    if (existing) return false;
    const candidateName = String(candidate.full_name || candidate.name || candidateId).trim();
    const noteText = String(lastNote || '').trim();
    const message = noteText
      ? `${candidateName} follow-up is due now. Last note: ${noteText}`
      : `${candidateName} follow-up is due now.`;
    await makeNotification(userId, 'Follow-up reminder', message, 'followup', safeJsonStringify({
      candidate_id: candidateId,
      open_path: `/candidate/${candidateId}`,
      follow_up_at: followUpAt,
      followup_reminder_key: reminderKey,
      last_note: noteText,
    }));
    return true;
  } catch {
    return false;
  }
}

function statDateKey(date = new Date()) {
  return istDateKey(date) || new Date().toISOString().slice(0, 10);
}

function incrementEmployeeDailyStat(req, counterName, amount = 1) {
  return afterCommit(() => writeEmployeeDailyStat(req, counterName, amount));
}
async function writeEmployeeDailyStat(req, counterName, amount = 1) {
  try {
    const allowed = new Set(['calls_count', 'whatsapp_count', 'jd_sent_count', 'submissions_count', 'connected_calls_count', 'not_connected_calls_count', 'incoming_calls_count', 'outgoing_calls_count', 'missed_calls_count', 'talktime_seconds']);
    if (!allowed.has(counterName)) return false;
    const recruiterCode = String(req.user?.recruiter_code || req.user?.user_id || req.user?.username || '').trim() || 'UNKNOWN';
    const statDate = statDateKey();
    const statId = `${statDate}|${recruiterCode}`;
    const existing = await store.findById('employee_daily_stats', 'stat_id', statId).catch(() => null);
    const nextCount = String((Number(existing?.[counterName] || 0) || 0) + Number(amount || 1));
    const payload = {
      stat_id: statId,
      stat_date: statDate,
      recruiter_code: recruiterCode,
      recruiter_name: String(req.user?.full_name || req.user?.username || recruiterCode || '').trim(),
      username: String(req.user?.username || '').trim(),
      updated_at: nowIso(),
      [counterName]: nextCount,
    };
    if (existing) await store.update('employee_daily_stats', 'stat_id', statId, payload);
    else await store.insert('employee_daily_stats', { ...payload, calls_count: payload.calls_count || '0', whatsapp_count: payload.whatsapp_count || '0', jd_sent_count: payload.jd_sent_count || '0', submissions_count: payload.submissions_count || '0', interviews_count: '0', selections_count: '0', joinings_count: '0', connected_calls_count: payload.connected_calls_count || '0', not_connected_calls_count: payload.not_connected_calls_count || '0', incoming_calls_count: payload.incoming_calls_count || '0', outgoing_calls_count: payload.outgoing_calls_count || '0', missed_calls_count: payload.missed_calls_count || '0', talktime_seconds: payload.talktime_seconds || '0' });
    return true;
  } catch {
    return false;
  }
}

function notifyLeaders(title, message, metadata = '') {
  return afterCommit(() => writeLeaderNotifications(title, message, metadata));
}
async function writeLeaderNotifications(title,message,metadata='') {
 let meta={};try{meta=JSON.parse(metadata||'{}');}catch{}
 const candidate=meta.candidate_id?await store.findById('candidates','candidate_id',meta.candidate_id):null;
 const users=await require('../lib/collaborationAccess').roster(),config=await require('../lib/collaborationAccess').state();
 for(const user of users.filter(u=>isLeadership(u))){
  if(meta.section==='submissions'&&meta.submitted_by_role==='tl'&&!isAdminOrManager(user))continue;
  if(candidate&&!isAdminOrManager(user)){
   const viewer=require('../lib/collaborationAccess').hydrateFrom(user,config,users),team=users.filter(u=>require('../lib/collaborationAccess').primaryTl(u,users)===user.user_id);
   viewer.__ccTeamUserIds=[user.user_id,...team.map(u=>u.user_id)];viewer.__ccTeamCodes=[user.recruiter_code,...team.map(u=>u.recruiter_code)];viewer.__ccTeamNames=[user.full_name,...team.flatMap(u=>[u.full_name,u.username])];
   if(!visibleCandidateForUser(candidate,viewer))continue;
  }
  await makeNotification(user.user_id,title,message,'approval',metadata);
 }
}

function notifyRecruiter(candidate, title, message) {
  return afterCommit(() => writeRecruiterNotification(candidate, title, message));
}
async function writeRecruiterNotification(candidate, title, message) {
  const users = await table('users');
  const user = users.find((u) => recruiterCodeMatches(candidate.recruiter_code, u.recruiter_code) || u.full_name === candidate.recruiter_name);
  if (user) {
    await makeNotification(
      user.user_id,
      title,
      message,
      'candidate',
      JSON.stringify({ candidate_id: candidate.candidate_id, open_path: `/candidate/${candidate.candidate_id}` }),
    );
  }
}

function canManagerReassignRecruiter(user) {
  return isAdminOrManager(user);
}

function recruiterOptionsFromUsers(users = []) {
  return (Array.isArray(users) ? users : [])
    .filter((row) => String(row?.recruiter_code || '').trim())
    .map((row) => ({
      user_id: row.user_id || '',
      recruiter_code: String(row.recruiter_code || '').trim(),
      full_name: row.full_name || row.username || String(row.recruiter_code || '').trim(),
      designation: row.designation || row.role || '',
      role: row.role || '',
    }))
    .sort((a, b) => String(a.full_name || a.recruiter_code).localeCompare(String(b.full_name || b.recruiter_code)));
}

function normalizeCandidate(payload, existing, user) {
  const merged = { ...pickCandidateFields(existing), ...pickCandidateFields(payload) };
  if(existing?.candidate_id)merged.candidate_id=existing.candidate_id;
  const canOverrideRecruiter = canManagerReassignRecruiter(user);
  const requestedRecruiterCode = String(merged.recruiter_code || '').trim();
  merged.call_connected = String(merged.call_connected || '').trim() || String(existing?.call_connected || '').trim() || '';
  merged.looking_for_job = String(merged.looking_for_job || '').trim();
  merged.phone = Object.prototype.hasOwnProperty.call(payload||{},'phone')
    ? require('../lib/candidatePhoneGuard').validateInput(payload.phone,{required:true})
    : String(existing?.phone||'');
  merged.preferred_location = Array.isArray(merged.preferred_location) ? merged.preferred_location.join(', ') : String(merged.preferred_location || '').trim();
  merged.qualification_level = String(merged.qualification_level || '').trim()
    ? normalizeQualificationCategory(merged.qualification_level || merged.degree || '', merged.qualification || '')
    : '';
  merged.total_experience = String(merged.total_experience ?? '');
  merged.relevant_experience = String(merged.relevant_experience ?? '');
  merged.in_hand_salary = String(merged.in_hand_salary ?? '');
  merged.ctc_monthly = String(merged.ctc_monthly ?? '');
  merged.career_gap = String(merged.career_gap || '').trim();
  if ((normalizeExperienceMonths(merged.total_experience) > 0 || normalizeExperienceMonths(merged.relevant_experience) > 0)
      && (!merged.career_gap || lower(merged.career_gap) === 'fresher')) merged.career_gap = 'No Gap';
  merged.virtual_onsite = String(merged.virtual_onsite || '').trim();
  if (/^(onsite|on-site|walk[ -]?in)$/i.test(merged.virtual_onsite)) merged.virtual_onsite = 'Walkin';
  merged.documents_availability = String(merged.documents_availability || '').trim();
  merged.communication_skill = String(merged.communication_skill || '').trim();
  const payloadHasOwn = (key) => Object.prototype.hasOwnProperty.call(payload || {}, key);
  const requestedRelevantRange = String(payload?.relevant_experience_range || '').trim();
  const requestedInHandRange = String(payload?.relevant_in_hand_range || '').trim();
  const relevantExperienceTouched = payloadHasOwn('relevant_experience');
  const relevantRangeTouched = payloadHasOwn('relevant_experience_range');
  const inHandSalaryTouched = payloadHasOwn('in_hand_salary');
  const inHandRangeTouched = payloadHasOwn('relevant_in_hand_range');
  if (relevantRangeTouched) {
    merged.relevant_experience_range = requestedRelevantRange;
  } else if (relevantExperienceTouched) {
    merged.relevant_experience_range = String(merged.relevant_experience || '').trim() ? calcExperienceRange(merged.relevant_experience) : '';
  } else {
    merged.relevant_experience_range = String(merged.relevant_experience_range || '').trim();
  }
  if (inHandRangeTouched) {
    merged.relevant_in_hand_range = requestedInHandRange;
  } else if (inHandSalaryTouched) {
    merged.relevant_in_hand_range = String(merged.in_hand_salary || '').trim() ? calcSalaryRange(merged.in_hand_salary) : '';
  } else {
    merged.relevant_in_hand_range = String(merged.relevant_in_hand_range || '').trim();
  }
  merged.recruiter_code = canOverrideRecruiter
    ? (requestedRecruiterCode || existing?.recruiter_code || user?.recruiter_code || '')
    : (existing?.recruiter_code || user?.recruiter_code || requestedRecruiterCode || '');
  merged.recruiter_name = canOverrideRecruiter
    ? (merged.recruiter_name || existing?.recruiter_name || user?.full_name || '')
    : (existing?.recruiter_name || user?.full_name || merged.recruiter_name || '');
  merged.recruiter_designation = canOverrideRecruiter
    ? (merged.recruiter_designation || existing?.recruiter_designation || user?.designation || user?.role || '')
    : (existing?.recruiter_designation || user?.designation || user?.role || merged.recruiter_designation || '');
  merged.interview_reschedule_date = cleanScheduledDate(merged.interview_reschedule_date);
  merged.interview_date = cleanScheduledDate(merged.interview_date);
  if (!merged.interview_reschedule_date && merged.interview_date) merged.interview_reschedule_date = merged.interview_date;
  merged.created_by_user_id = existing?.created_by_user_id || merged.created_by_user_id || user?.user_id || '';
  merged.created_by_name = existing?.created_by_name || merged.created_by_name || user?.full_name || user?.username || '';
  merged.recruiter_user_id = existing?.recruiter_user_id || merged.recruiter_user_id || user?.user_id || '';
  merged.user_id = existing?.user_id || merged.user_id || user?.user_id || '';
  merged.interview_availability = merged.interview_availability || '';
  const approvalStateForDefaults = lower(merged.approval_status || existing?.approval_status || 'Draft');
  const submittedFlowForDefaults = ['pending', 'approved', 'rejected'].includes(approvalStateForDefaults);
  if (submittedFlowForDefaults) {
    merged.status = merged.status || (approvalStateForDefaults === 'approved' ? 'Approved' : approvalStateForDefaults === 'rejected' ? 'Rejected' : 'In - Progress');
    merged.all_details_sent = normalizeDetailsSentValue(merged.all_details_sent, 'Pending');
    merged.submission_date = merged.submission_date || nowLocalDateTime();
  } else {
    merged.approval_status = 'Draft';
    // Approval/submission remains Draft, but an employee-selected candidate
    // status such as In - Progress must persist before Submit is pressed.
    merged.status = String(merged.status || existing?.status || 'Draft').trim() || 'Draft';
    merged.all_details_sent = 'Pending';
    // CC26_682: a Draft profile is not a Submission. Keep the workflow date
    // blank until the employee actually presses Submit (unless an older saved
    // draft already has a real value that must be preserved).
    merged.submission_date = Object.prototype.hasOwnProperty.call(payload, 'submission_date') ? String(payload.submission_date || '') : existing?.submission_date || '';
    merged.approval_requested_at = '';
    merged.approved_at = '';
    merged.approved_by_name = '';
  }
  const requestedProfilePriority = lower(merged.profile_priority || existing?.profile_priority || '');
  merged.profile_priority = requestedProfilePriority === 'high' ? 'High' : requestedProfilePriority === 'low' ? 'Low' : 'Medium';
  merged.process = Array.isArray(merged.process) ? merged.process.join(', ') : String(merged.process || '');
  merged.bucket_assigned_at = existing?.bucket_assigned_at || merged.bucket_assigned_at || merged.created_at || nowIso();
  merged.bucket_state = existing?.bucket_state || '';
  if(lower(merged.bucket_state)==='fresh'&&((String(payload.call_connected||'').trim()&&payload.call_connected!==existing?.call_connected)||(String(payload.last_dialed_at||'').trim()&&payload.last_dialed_at!==existing?.last_dialed_at)))merged.bucket_state='working';
  merged.updated_at = nowIso();
  return pickCandidateFields(merged);
}




function isDigitsOnlySalary(value) {
  return /^\d*$/.test(String(value || '').trim());
}

async function applyRecruiterAssignmentIfAllowed(nextItem, requestedCode, actingUser) {
  const item = { ...(nextItem || {}) };
  if (!canManagerReassignRecruiter(actingUser)) return item;
  const targetCode = String(requestedCode || item.recruiter_code || '').trim();
  if (!targetCode) return item;
  const users = await table('users');
  const matchedUser = users.find((row) => String(row?.recruiter_code || '').trim().toLowerCase() === targetCode.toLowerCase());
  item.recruiter_code = targetCode;
  if (matchedUser) {
    item.recruiter_name = matchedUser.full_name || matchedUser.username || item.recruiter_name || '';
    item.recruiter_designation = matchedUser.designation || matchedUser.role || item.recruiter_designation || '';
    item.recruiter_user_id = matchedUser.user_id || item.recruiter_user_id || '';
  }
  return item;
}

function validateChangedSalaryFields(existing, next) {
  const errors = [];
  const nextCtc = String(next?.ctc_monthly || '').trim();
  const prevCtc = String(existing?.ctc_monthly || '').trim();
  const nextInHand = String(next?.in_hand_salary || '').trim();
  const prevInHand = String(existing?.in_hand_salary || '').trim();
  if (nextCtc !== prevCtc && !isDigitsOnlySalary(nextCtc)) {
    errors.push('CTC Monthly must contain digits only, like 26000. Do not use 26K or symbols.');
  }
  if (nextInHand !== prevInHand && !isDigitsOnlySalary(nextInHand)) {
    errors.push('In-hand Monthly Salary must contain digits only, like 26000. Do not use 26K or symbols.');
  }
  return errors;
}

function numberFromText(value) {
  const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function extractRangeNumbers(value) {
  const nums = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/g) || [];
  return nums.map((n) => Number(n)).filter((n) => Number.isFinite(n));
}

function normalizeLakhsToMonthly(value) {
  const raw = String(value || '').toLowerCase();
  const nums = extractRangeNumbers(raw);
  if (!nums.length) return 0;
  let base = nums[0];
  if (raw.includes('lpa') || raw.includes('lac') || raw.includes('lakh')) {
    return Math.round((base * 100000) / 12);
  }
  if (base < 1000 && raw.includes('k')) return base * 1000;
  return base;
}

function normalizeExperienceMonths(value) {
  const raw = String(value || '').toLowerCase().replace(/,/g, ' ');
  if (!raw.trim()) return 0;
  let months = 0;
  const yearMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr|y)\b/);
  const monthMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?|mo|m)\b/);
  if (yearMatch) months += Math.round(Number(yearMatch[1]) * 12);
  if (monthMatch) months += Math.round(Number(monthMatch[1]));
  if (months > 0) return months;
  const nums = extractRangeNumbers(raw);
  if (!nums.length) return 0;
  const base = nums[0];
  if (raw.includes('month')) return Math.round(base);
  if (raw.includes('fresher')) return 0;
  return Math.round(base * 12);
}

function jdLocationKey(value) {
  const raw = lower(value).replace(/gurugram/g, 'gurgaon');
  if (raw.includes('gurgaon')) return 'gurgaon';
  if (raw.includes('noida')) return 'noida';
  if (raw.includes('mumbai') || raw.includes('thane')) return 'mumbai';
  return raw.replace(/[^a-z0-9]+/g, ' ').trim();
}

function communicationRank(value) {
  const raw = lower(value);
  if (raw.includes('more than excellent') || raw.includes('excellent')) return 4;
  if (raw.includes('good')) return 3;
  if (raw.includes('normal')) return 2;
  if (raw.includes('average')) return 1;
  if (raw.includes('below')) return 0;
  return -1;
}

function jdMinimumCommunication(rule) {
  const raw = lower(rule);
  if (raw.includes('more than excellent')) return 4;
  if (raw.includes('excellent')) return 4;
  if (raw.includes('good')) return 3;
  if (raw.includes('normal')) return 2;
  if (raw.includes('average')) return 1;
  return -1;
}

function candidateIsGraduate(candidate) {
  const raw = lower(`${candidate?.qualification_level || ''} ${candidate?.qualification || ''}`);
  return raw.includes('graduate') && !raw.includes('non - graduate') && !raw.includes('non-graduate') && !raw.includes('undergraduate');
}

function qualificationFit(candidate, rule) {
  const raw = lower(rule);
  if (!raw) return { applicable: false, ratio: 1, reason: '' };
  const grad = candidateIsGraduate(candidate);
  if (raw.includes('graduate mandatory') || (raw.includes('graduate') && !raw.includes('non') && !raw.includes('12th') && !raw.includes('undergraduate'))) {
    return grad
      ? { applicable: true, ratio: 1, reason: 'Qualification matched' }
      : { applicable: true, ratio: 0, reason: 'Graduate required' };
  }
  // 12th/undergraduate is a minimum qualification; a graduate is also eligible.
  if (raw.includes('12th') || raw.includes('undergraduate') || raw.includes('non - graduate') || raw.includes('non-graduate')) {
    return { applicable: true, ratio: 1, reason: 'Qualification eligible' };
  }
  return { applicable: true, ratio: 0.7, reason: 'Qualification needs review' };
}

function jdSalaryRange(jd) {
  const min = numberFromText(jd?.salary_min || '');
  const max = numberFromText(jd?.salary_max || '');
  if (min || max) return [min || max, max || min];
  const nums = extractRangeNumbers(String(jd?.salary || '').replace(/,/g, ''));
  if (!nums.length) return [0, 0];
  const converted = nums.map((n) => n < 1000 && /k/i.test(String(jd?.salary || '')) ? n * 1000 : n);
  return [Math.min(...converted), Math.max(...converted)];
}

function textTokens(value) {
  return lower(value)
    .replace(/gurugram/g, 'gurgaon')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !['process','executive','associate','customer','support','business','development'].includes(token));
}

function processFit(candidate, jd) {
  const candidateRaw = `${candidate?.process || ''} ${candidate?.client || ''}`.trim();
  if (!candidateRaw) return { applicable: false, ratio: 1, reason: '' };
  const candidateNorm = lower(candidateRaw).replace(/gurugram/g, 'gurgaon');
  const jdRaw = `${jd?.company || ''} ${jd?.process_name || ''} ${jd?.job_title || ''}`;
  const jdNorm = lower(jdRaw).replace(/gurugram/g, 'gurgaon');
  if (jdNorm.includes(candidateNorm) || candidateNorm.includes(lower(jd?.company || '')) || candidateNorm.includes(lower(jd?.process_name || ''))) {
    return { applicable: true, ratio: 1, reason: 'Process / client matched' };
  }
  const cTokens = textTokens(candidateRaw);
  const jTokens = new Set(textTokens(jdRaw));
  const overlap = cTokens.filter((token) => jTokens.has(token)).length;
  if (overlap >= 1) return { applicable: true, ratio: 0.65, reason: 'Related process match' };
  return { applicable: true, ratio: 0, reason: 'Different process / client' };
}

function locationFit(candidate, jd) {
  const target = jdLocationKey(jd?.location || jd?.preferred_location_rule || '');
  if (!target) return { applicable: false, ratio: 1, reason: '' };
  const preferred = splitCsv(candidate?.preferred_location || '').map(jdLocationKey).filter(Boolean);
  const current = jdLocationKey(candidate?.location || '');
  if (preferred.includes(target)) return { applicable: true, ratio: 1, reason: 'Preferred location matched' };
  if (current && (current === target || current.includes(target) || target.includes(current))) return { applicable: true, ratio: 0.85, reason: 'Current location matched' };
  if (!preferred.length && !current) return { applicable: true, ratio: 0, reason: 'Location not filled' };
  return { applicable: true, ratio: 0, reason: `Location needs ${jd?.location || 'review'}` };
}

function experienceFit(candidate, jd) {
  const raw = lower(jd?.relevant_experience_rule || jd?.experience || '');
  const minFromColumn = numberFromText(jd?.exp_min || '');
  let required = minFromColumn;
  if (!required && raw && !raw.includes('fresher')) required = normalizeExperienceMonths(raw);
  const candidateMonths = normalizeExperienceMonths(candidate?.relevant_experience || candidate?.total_experience || candidate?.experience || '');

  // Axis rule from the supplied JD: graduate fresher allowed; 12th requires 6 months.
  const axisRule = lower(`${jd?.company || ''} ${jd?.process_name || ''}`).includes('axis');
  if (axisRule && candidateIsGraduate(candidate)) required = 0;
  if (axisRule && !candidateIsGraduate(candidate)) required = Math.max(required, 6);

  if (required <= 0) return { applicable: true, ratio: 1, reason: 'Experience eligible (fresher accepted)' };
  if (candidateMonths >= required) return { applicable: true, ratio: 1, reason: `Experience matched (${required}+ months required)` };
  if (candidateMonths > 0 && required - candidateMonths <= 3) return { applicable: true, ratio: 0.55, reason: `Experience short by ${required - candidateMonths} month(s)` };
  return { applicable: true, ratio: 0, reason: `Minimum ${required} months relevant experience required` };
}

function salaryFit(candidate, jd) {
  const expected = numberFromText(candidate?.in_hand_salary || candidate?.ctc_monthly || '');
  const [minSalary, maxSalary] = jdSalaryRange(jd);
  if (!expected || (!minSalary && !maxSalary)) return { applicable: false, ratio: 1, reason: '' };
  const max = maxSalary || minSalary;
  if (max >= expected) return { applicable: true, ratio: 1, reason: 'In-hand salary expectation covered' };
  const gap = expected - max;
  if (gap <= 3000) return { applicable: true, ratio: 0.65, reason: `Salary close (₹${gap} gap)` };
  return { applicable: true, ratio: 0, reason: `JD in-hand below expectation by ₹${gap}` };
}

function communicationFit(candidate, jd) {
  const required = jdMinimumCommunication(jd?.communication_rule || '');
  if (required < 0) return { applicable: false, ratio: 1, reason: '' };
  const actual = communicationRank(candidate?.communication_skill || '');
  if (actual < 0) return { applicable: true, ratio: 0, reason: 'Communication level not filled' };
  if (actual >= required) return { applicable: true, ratio: 1, reason: 'Communication matched' };
  if (actual + 1 === required) return { applicable: true, ratio: 0.45, reason: 'Communication one level below requirement' };
  return { applicable: true, ratio: 0, reason: 'Communication below requirement' };
}

function evaluateJdMatch(candidate={},jd={}) {
  candidate=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate:{};
  jd=jd&&typeof jd==='object'&&!Array.isArray(jd)?jd:{};
  const text=v=>String(v??'').trim(), low=v=>text(v).toLowerCase(), norm=v=>low(v).replace(/[^a-z0-9]/g,''), split=v=>Array.isArray(v)?v.map(text).filter(Boolean):text(v).split(/[,;|/]|\s+(?:or|and|&)\s+/).map(text).filter(Boolean);
  const result=(eligible,reasons,score=0,parts={})=>({eligible,reasons,score:Math.max(0,Math.min(100,Math.round(score))),parts});
  if(['closed','inactive','disabled'].includes(low(jd.jd_status||jd.status))) return result(false,['Process closed'],0);
  if(low(candidate.looking_for_job)==='no') return result(false,['Not looking for a job'],0);
  const reasons=[], parts={}; let score=0, weight=0;
  const add=(name,points,max,label)=>{parts[name]={points,max};score+=points;weight+=max;if(label)reasons.push(label)};
  const city=v=>{const ss=low(v).replace(/gurugram/g,'gurgaon');for(const c of ['noida','gurgaon','mumbai','pune','bangalore','bengaluru','chennai','hyderabad','delhi','kolkata','kanpur'])if(ss.includes(c))return c==='bengaluru'?'bangalore':c;return ss.replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();};
  const targetLocations=split(jd.preferred_location_rule||jd.location).map(city).filter(Boolean);
  const preferred=split(candidate.preferred_location).map(city).filter(Boolean), available=preferred.length?preferred:[city(candidate.location)].filter(Boolean);
  if(targetLocations.length){ if(!available.some(v=>targetLocations.includes(v))) return result(false,['Preferred location mismatch'],0); add('location',22,22,'Location matched'); } else add('location',12,12,'Location flexible');

  const qRank=v=>{const q=low(v);if(!q)return -1;if(/phd|doctorate/.test(q))return 5;if(/post[\s-]*graduate|\bpg\b|master|mba|mca|m\.?(?:a|com|sc|tech)\b/.test(q))return 4;if(/non[\s-]*graduate|under[\s-]*graduate|\bug\b/.test(q))return 2;if(/graduate|bachelor|b\.?a\b|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|llb/.test(q))return 3;if(/12th|class\s*12|twelfth|higher secondary|senior secondary|hsc|intermediate/.test(q))return 2;if(/10th|class\s*10|tenth|matric|ssc/.test(q))return 1;return -1;};
  const explicitQ=[candidate.course_name,candidate.qualification,candidate.qualification_level].map(qRank);
  const candidateQ=Math.max(...explicitQ);
  const qualRule=low(jd.qualification_rule||jd.qualification_required);
  const qualificationRanks=qualRule.split(/[,;|]|\s+or\s+|\s*\/\s*/).map(v=>/non[\s-]*graduate|under[\s-]*graduate|\bug\b/.test(v)?2:qRank(v)).filter(v=>v>=0);
  const requiredQ=qualificationRanks.length?Math.min(...qualificationRanks):-1;
  if(requiredQ>=0&&candidateQ<requiredQ)return result(false,['Qualification below minimum'],Math.round((score/Math.max(weight+18,1))*100),parts);
  const qualificationKnown=requiredQ<0||candidateQ>=requiredQ;
  add('qualification',qualificationKnown?18:0,18,qualificationKnown?'Qualification meets minimum':'Qualification needs confirmation');

  const commRank=v=>{const q=low(v);if(/below[\s-]*average|poor|basic|weak/.test(q))return 0;if(/excellent|fluent/.test(q))return 3;if(/good/.test(q))return 2;if(/average|normal/.test(q))return 1;return -1;};
  const wantedComm=split(jd.communication_rule).map(commRank).filter(v=>v>=0);
  const requiredComm=wantedComm.length?Math.min(...wantedComm):-1,actualComm=commRank(candidate.communication_skill);
  if(requiredComm>=0&&actualComm<requiredComm)return result(false,['Communication below requirement'],Math.round(score/Math.max(weight+18,1)*100),parts);
  const communicationKnown=requiredComm<0||actualComm>=requiredComm;
  add('communication',communicationKnown?18:0,18,communicationKnown?(actualComm>requiredComm?'Communication above minimum':'Communication meets minimum'):'Communication needs confirmation');

  const months=v=>{const ss=low(v),numbers=(ss.match(/\d+(?:\.\d+)?/g)||[]).map(Number);if(/fresher/.test(ss)||!numbers.length)return 0;if(/year|\byr/.test(ss)){let n=numbers[0]*12;if(/month/.test(ss)&&numbers.length>1)n+=numbers[1];return n;}if(/month/.test(ss))return numbers[0];return numbers[0];};
  const expRule=low(jd.relevant_experience_rule||jd.experience);
  const relevant=months(candidate.relevant_experience),total=months(candidate.total_experience||candidate.experience);
  const actualExp=jd.relevant_experience_rule?relevant:Math.max(relevant,total);
  const nums=(expRule.match(/\d+(?:\.\d+)?/g)||[]).map(Number), factor=/month/.test(expRule)?1:12;
  let minExp=text(jd.exp_min)!==''?Number(jd.exp_min):0; let maxExp=text(jd.exp_max)!==''?Number(jd.exp_max):Infinity;
  if(!(minExp>0)&&nums.length&&!/fresher/.test(expRule)) minExp=nums[0]*factor;
  const strictMax=/^(?:1|true|yes)$/i.test(text(jd.strict_experience_max));
  if(!Number.isFinite(maxExp) && strictMax && nums.length>1) maxExp=nums[1]*factor;
  if(actualExp<minExp) return result(false,[`Experience requires ${minExp}+ months`],0);
  if(strictMax&&Number.isFinite(maxExp)&&actualExp>maxExp) return result(false,['Experience exceeds JD maximum'],0);
  const expCloseness=minExp<=0?1:Math.min(1,actualExp/Math.max(1,minExp)); add('experience',Math.round(17*expCloseness),17,minExp? 'Experience requirement met':'Fresher/experienced eligible');

  const amount=v=>{const ss=low(v).replace(/,/g,''),nums=(ss.match(/\d+(?:\.\d+)?/g)||[]).map(Number),n=Math.max(0,...nums);return /lpa|lakh|lac/.test(ss)?n*100000/12:/\bk\b|\d\s*k/.test(ss)?n*1000:n;};
  const jdPay=amount(jd.in_hand_max||jd.in_hand_min||jd.salary_max||jd.salary_min||jd.salary), expected=amount(candidate.in_hand_salary||candidate.ctc_monthly||candidate.relevant_in_hand_range);
  const tolerance=5000;
  if(jdPay&&expected>jdPay+tolerance)return result(false,[`Salary exceeds this JD by more than ₹${tolerance.toLocaleString('en-IN')}`],Math.round(score/Math.max(weight+15,1)*100),parts);
  const salaryKnown=text(candidate.in_hand_salary)!==''||text(candidate.ctc_monthly)!=='';
  let salaryPoints=jdPay&&salaryKnown?15:0;if(jdPay&&expected){const gap=Math.abs(expected-jdPay)/Math.max(jdPay,1);salaryPoints=Math.max(2,Math.round(15*(1-Math.min(.85,gap*.65))));}
  add('salary',salaryPoints,15,jdPay&&salaryKnown?(expected<=jdPay?'Salary aligned':'Salary expectation above JD; lower fit score'):'Salary needs confirmation');

  const exactRules=[['career_gap','career_gap_rule','Career gap'],['all_details_sent','all_details_sent_rule','Details sent'],['documents_availability','documents_rule','Documents']];
  let extras=0, extrasMax=0;
  for(const [field,rule,label] of exactRules){const wanted=split(jd[rule]);if(!wanted.length)continue;extrasMax+=3;const doc=v=>['yes','available'].includes(norm(v))?'yes':norm(v);const n=field==='documents_availability'?doc:norm;if(wanted.some(v=>n(v)===n(candidate[field]))){extras+=3;reasons.push(label+' matched');}else reasons.push(label+' needs review');}
  if(extrasMax){score+=extras;weight+=extrasMax;parts.extra={points:extras,max:extrasMax};}
  const process=norm(jd.process_name||jd.process), candidateProcess=norm(candidate.process); if(process&&candidateProcess&&process===candidateProcess){score+=5;weight+=5;parts.process={points:5,max:5};reasons.push('Process matched');}
  const percent=weight?score/weight*100:100;
  return result(true,reasons.length?reasons:['Open opportunity'],percent,parts);
}
function buildJdFitSummary(candidate,jds=[]) {
 const available=(Array.isArray(jds)?jds:[]).filter(jd=>jd&&typeof jd==='object'&&jd.jd_id);
  const suggestions=available.map(jd=>({jd,match:evaluateJdMatch(candidate,jd)})).filter(x=>x.match.eligible).map(({jd,match})=>({jd_id:jd.jd_id,job_title:jd.job_title||jd.title||'',company:jd.company||'',process_name:jd.process_name||jd.process||'',location:jd.location||'',salary:jd.salary||[jd.in_hand_min,jd.in_hand_max].filter(v=>String(v??'').trim()).join(' - '),in_hand_min:jd.in_hand_min,in_hand_max:jd.in_hand_max,qualification_required:jd.qualification_required||jd.qualification_rule||'',communication_rule:jd.communication_rule||'',experience:jd.experience||[jd.exp_min,jd.exp_max].filter(v=>String(v??'').trim()).join('–')+' months',interview_mode:jd.interview_mode||'',working_days:jd.working_days||'',shift:jd.shift||'',has_pdf:jd.has_pdf,score:match.score,reasons:match.reasons.slice(0,6)})).sort((a,b)=>b.score-a.score||a.company.localeCompare(b.company)).slice(0,8);
 return{score:suggestions[0]?.score||0,label:suggestions.length?'Matched':'No matching JD',best_match:suggestions[0]||null,suggestions};
}


function computeJdFitSummary(candidate,rows){return buildJdFitSummary(candidate,rows);}

function decorateCandidateWithFit(candidate, jdRows = []) {
  return { ...candidate, jd_fit_summary: computeJdFitSummary(candidate, jdRows) };
}

function candidateIsLostLead(candidate) {
  const status = lower(candidate.status || '');
  const approval = lower(candidate.approval_status || '');
  const looking = lower(candidate.looking_for_job || 'yes');
  const overdue = String(candidate.follow_up_at || '') && String(candidate.follow_up_at || '') < nowIso().slice(0, 10);
  return ['rejected', 'not interested', 'not intrested', 'not responding', 'rejected once, needs new interview'].includes(status)
    || approval === 'rejected'
    || looking === 'no'
    || overdue;
}

function lostLeadBucketName(candidate) {
  const status = lower(candidate.status || '');
  const approval = lower(candidate.approval_status || '');
  const looking = lower(candidate.looking_for_job || 'yes');
  const docs = lower(candidate.documents_availability || '');
  if (approval === 'rejected' || status === 'rejected' || status === 'rejected once, needs new interview') return 'Rejected but reusable';
  if (status === 'not responding' || String(candidate.follow_up_at || '') < nowIso().slice(0, 10)) return 'Stale follow-up';
  if (looking === 'no') return 'Not now, recover later';
  if (docs in { 'no':1, 'partially':1 }) return 'Docs pending';
  return 'Recovery pool';
}

function decorateLostLead(candidate) {
  return { ...candidate, recovery_bucket: lostLeadBucketName(candidate) };
}

function buildFilterState(req) {
  return {
    q: String(req.query.q || '').trim(),
    recruiter: String(req.query.recruiter || '').trim(),
    recruiter_code_text: String(req.query.recruiter_code_text || '').trim(),
    sr_text: String(req.query.sr_text || '').trim(),
    recruiter_code: parseMultiValue(req.query.recruiter_code),
    location: parseMultiValue(req.query.location),
    project_id:String(req.query.project_id||'').trim().slice(0,80),
    preferred_location: parseMultiValue(req.query.preferred_location),
    status: parseMultiValue(req.query.status),
    approval_status: parseMultiValue(req.query.approval_status),
    qualification: parseMultiValue(req.query.qualification),
    course_name: parseMultiValue(req.query.course_name),
    process: parseMultiValue(req.query.process),
    all_details_sent: parseMultiValue(req.query.all_details_sent),
    communication_skill: parseMultiValue(req.query.communication_skill),
    career_gap: parseMultiValue(req.query.career_gap),
    relevant_experience_range: parseMultiValue(req.query.relevant_experience_range),
    relevant_in_hand_range: parseMultiValue(req.query.relevant_in_hand_range),
    virtual_onsite: parseMultiValue(req.query.virtual_onsite),
    documents_availability: parseMultiValue(req.query.documents_availability),
    call_connected: parseMultiValue(req.query.call_connected),
    manager_crm: parseMultiValue(req.query.manager_crm),
    submitted_by: parseMultiValue(req.query.submitted_by),
    name: parseMultiValue(req.query.name),
    phone: parseMultiValue(req.query.phone),
    sr_from: req.query.sr_from ?? '',
    sr_to: req.query.sr_to ?? '',
    submission_from: String(req.query.submission_from || '').trim(),
    submission_to: String(req.query.submission_to || '').trim(),
    interview_from: String(req.query.interview_from || '').trim(),
    interview_to: String(req.query.interview_to || '').trim(),
    salary_from: req.query.salary_from ?? '',
    salary_to: req.query.salary_to ?? '',
    total_exp_from: req.query.total_exp_from ?? '',
    total_exp_to: req.query.total_exp_to ?? '',
    relevant_exp_from: req.query.relevant_exp_from ?? '',
    relevant_exp_to: req.query.relevant_exp_to ?? '',
    data_notes: parseMultiValue(req.query.data_notes),
    data_uploading_from: String(req.query.data_uploading_from || '').trim(),
    data_uploading_to: String(req.query.data_uploading_to || '').trim(),
    page: Math.max(1, Number(req.query.page || 1) || 1),
    page_size: Math.min(100, Math.max(5, Number(req.query.page_size || 10) || 10)),
    around_id: String(req.query.around_id || '').trim(),
    bucket_view: String(req.query.bucket_view || 'all').trim(),
    bucket_mode: String(req.query.bucket_mode || '').trim() === '1',
    last_viewed_mode: String(req.query.last_viewed_mode || '').trim(),
    last_viewed_days: String(req.query.last_viewed_days || '').trim(),
    duplicate_only: String(req.query.duplicate_only || '').trim() === '1',
  };
}

function rowMatchesFilters(row, filters, user) {
  if (!visibleCandidate(row, user)) return false;
  const profileDetailFilterActive = Boolean(
    filters.preferred_location.length || filters.qualification.length || filters.course_name.length || filters.process.length
    || filters.all_details_sent.length || filters.communication_skill.length || filters.career_gap.length
    || filters.relevant_experience_range.length || filters.relevant_in_hand_range.length || filters.virtual_onsite.length
    || filters.documents_availability.length || filters.call_connected.length
    || filters.salary_from !== '' || filters.salary_to !== '' || filters.total_exp_from !== '' || filters.total_exp_to !== ''
    || filters.relevant_exp_from !== '' || filters.relevant_exp_to !== ''
  );
  if (profileDetailFilterActive && !candidateProfileWorkStarted(row)) return false;
  const duplicateFlag = String(row?.is_duplicate || '0') === '1';
  // CC26_681: default All Profiles must not silently hide duplicate-marked rows.
  // Only the explicit duplicate-only filter narrows to duplicates.
  if (filters.duplicate_only && !duplicateFlag) return false;
  if (filters.q && !['candidate_id', 'full_name', 'phone', 'process', 'notes', 'location', 'preferred_location', 'recruiter_code', 'course_name'].some((key) => containsText(row[key], filters.q))) return false;
  if (filters.recruiter && !containsText(row.recruiter_name, filters.recruiter) && !containsText(row.recruiter_code, filters.recruiter)) return false;
  if (filters.recruiter_code_text && !containsText(row.recruiter_code, filters.recruiter_code_text)) return false;
  if (filters.sr_text) {
    const srQuery = String(filters.sr_text || '').trim().toLowerCase();
    const candidateCode = String(row.candidate_id || '').trim().toLowerCase();
    const candidateTail = String(numericTail(row.candidate_id) || '').trim().toLowerCase();
    if (!candidateCode.includes(srQuery) && !candidateTail.includes(srQuery)) return false;
  }
  if(filters.project_id && String(row.project_id||'')!==(filters.project_id==='__solo__'?'':filters.project_id))return false;
  if (filters.name.length && !exactMatchesAny(row.full_name, filters.name)) return false;
  if (filters.phone.length && !filters.phone.some((value) => phoneMatches(row.phone || '', value))) return false;
  if (filters.recruiter_code.length && !matchesSelectedRecruiter(row, filters.recruiter_code,filters._recruiter_users||[])) return false;
  if (filters.location.length && !csvMatchesAny(row.location, filters.location, { location: true })) return false;
  if (filters.preferred_location.length && !csvMatchesAny(row.preferred_location, filters.preferred_location, { location: true })) return false;
  if (filters.status.length && !filters.status.map(lower).includes(lower(row.status))) return false;
  if (filters.approval_status.length && !filters.approval_status.map(lower).includes(lower(row.approval_status))) return false;
  if (filters.course_name.length && !exactMatchesAny(row.course_name, filters.course_name)) return false;
  if (filters.qualification.length && !exactMatchesAny(normalizeQualificationCategory(row.qualification_level || '', row.qualification || ''), filters.qualification)) return false;
  if (filters.process.length && !csvMatchesAny(row.process, filters.process)) return false;
  if (filters.data_notes.length && !dataNotesMatchAny(row, filters.data_notes)) return false;
  if (filters.all_details_sent.length && !exactMatchesAny(row.all_details_sent, filters.all_details_sent)) return false;
  if (filters.communication_skill.length && !exactMatchesAny(row.communication_skill, filters.communication_skill)) return false;
  if (filters.career_gap.length && !exactMatchesAny(row.career_gap, filters.career_gap)) return false;
  if (filters.relevant_experience_range.length && !exactMatchesAny(row.relevant_experience_range, filters.relevant_experience_range)) return false;
  if (filters.relevant_in_hand_range.length && !exactMatchesAny(row.relevant_in_hand_range, filters.relevant_in_hand_range)) return false;
  if (filters.virtual_onsite.length && !exactMatchesAny(row.virtual_onsite, filters.virtual_onsite)) return false;
  if (filters.documents_availability.length && !exactMatchesAny(row.documents_availability, filters.documents_availability)) return false;
  if (filters.call_connected.length && !exactMatchesAny(row.call_connected, filters.call_connected)) return false;
  if (filters.manager_crm.length && !exactMatchesAny(row.manager_crm, filters.manager_crm)) return false;
  if (filters.submitted_by.length && !exactMatchesAny(row.submitted_by, filters.submitted_by)) return false;
  if ((filters.sr_from !== '' || filters.sr_to !== '') && !inNumericRange(numericTail(row.candidate_id), filters.sr_from, filters.sr_to)) return false;
  if (filters.submission_from && cleanDateOnly(row.submission_date || '') < cleanDateOnly(filters.submission_from)) return false;
  if (filters.submission_to && cleanDateOnly(row.submission_date || '') > cleanDateOnly(filters.submission_to)) return false;
  if (filters.data_uploading_from && cleanDateOnly(row.data_uploading_date || '') < cleanDateOnly(filters.data_uploading_from)) return false;
  if (filters.data_uploading_to && (!row.data_uploading_date || cleanDateOnly(row.data_uploading_date) > cleanDateOnly(filters.data_uploading_to))) return false;
  const interviewDate = cleanDateOnly(row.interview_date || row.interview_reschedule_date || '');
  if (filters.interview_from && interviewDate < cleanDateOnly(filters.interview_from)) return false;
  if (filters.interview_to && interviewDate > cleanDateOnly(filters.interview_to)) return false;
  if ((filters.salary_from !== '' || filters.salary_to !== '') && !inNumericRange(row.in_hand_salary || row.ctc_monthly, filters.salary_from, filters.salary_to)) return false;
  if ((filters.total_exp_from !== '' || filters.total_exp_to !== '') && !inNumericRange(row.total_experience || row.experience, filters.total_exp_from, filters.total_exp_to)) return false;
  if ((filters.relevant_exp_from !== '' || filters.relevant_exp_to !== '') && !inNumericRange(row.relevant_experience, filters.relevant_exp_from, filters.relevant_exp_to)) return false;
  if (!matchesLastViewedWindow(row, filters)) return false;
  return true;
}

function applyLikeAnySql(clauses, params, expression, values) {
  if (!values.length) return;
  const pieces = values.map((value) => {
    params.push(`%${String(value).trim()}%`);
    return `${expression} ilike $${params.length}`;
  }).filter(Boolean);
  if (pieces.length) clauses.push(`(${pieces.join(' or ')})`);
}

function applyExactAnySql(clauses, params, expression, values) {
  if (!values.length) return;
  params.push(values.map((value) => String(value).trim().toLowerCase()));
  clauses.push(`lower(coalesce(${expression}, '')) = any($${params.length})`);
}
function applyTokenAnySql(clauses, params, expression, values, options = {}) {
  if (!values.length) return;
  const normalizer = options.location ? normalizeLocationFilterValue : lower;
  params.push(values.map(normalizer).filter(Boolean));
  const delimiter = options.multiDelimiter ? `E'\\s*[,|;]\\s*'` : `E'\\s*,\\s*'`;
  const tokenExpr = options.location
    ? `regexp_replace(replace(lower(trim(cc_filter_token)), 'gurugram', 'gurgaon'), '\\s+', ' ', 'g')`
    : `lower(trim(cc_filter_token))`;
  clauses.push(`exists (select 1 from regexp_split_to_table(coalesce(${expression}, ''), ${delimiter}) as cc_filter_token where ${tokenExpr} = any($${params.length}::text[]))`);
}

function buildScopeWhere(user, clauses) {
  if (!isLeadership(user)) {
    return `(coalesce(recruiter_code, '') = ${store.pool ? '$SCOPE_CODE$' : "''"} or coalesce(recruiter_name, '') = ${store.pool ? '$SCOPE_NAME$' : "''"})`;
  }
  return '1=1';
}

function buildSqlFilter(req) {
  const filters = buildFilterState(req);
  const params = [];
  const clauses = [];
  // The manager bypasses ownership restrictions, never deleted-record rules.
  const scoped = candidateScopeSql('', req.user, params);
  clauses.push(scoped.sql);
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const ref = `$${params.length}`;
    params.push(filters.q);
    const phoneRef = `$${params.length}`;
    clauses.push(`(
      coalesce(candidate_id, '') ilike ${ref}
      or coalesce(full_name, '') ilike ${ref}
      or coalesce(phone, '') ilike ${ref}
      or ${phoneSearchSql('phone', phoneRef)}
      or coalesce(process, '') ilike ${ref}
      or coalesce(notes, '') ilike ${ref}
      or coalesce(location, '') ilike ${ref}
      or coalesce(preferred_location, '') ilike ${ref}
      or coalesce(course_name, '') ilike ${ref}
      or coalesce(recruiter_code, '') ilike ${ref}
    )`);
  }
  if (filters.recruiter) {
    params.push(`%${filters.recruiter}%`);
    const ref = `$${params.length}`;
    clauses.push(`(coalesce(recruiter_name, '') ilike ${ref} or coalesce(recruiter_code, '') ilike ${ref})`);
  }
  if (filters.recruiter_code_text) {
    params.push(`%${filters.recruiter_code_text}%`);
    clauses.push(`coalesce(recruiter_code, '') ilike $${params.length}`);
  }
  if (filters.sr_text) {
    params.push(`%${filters.sr_text}%`);
    const srRef = `$${params.length}`;
    clauses.push(`(coalesce(candidate_id, '') ilike ${srRef} or regexp_replace(coalesce(candidate_id, ''), '\\D', '', 'g') ilike ${srRef})`);
  }
  // CC26_681: no duplicate exclusion in the default candidate list.
  // All Profiles literally includes all visible non-deleted profiles.
  if(filters.project_id){params.push(filters.project_id==='__solo__'?'':filters.project_id);clauses.push(`coalesce(project_id,'')=$${params.length}::text`);}
  if (filters.duplicate_only) clauses.push(`coalesce(is_duplicate, '0') = '1'`);
  const profileDetailFilterActive = Boolean(
    filters.preferred_location.length || filters.qualification.length || filters.course_name.length || filters.process.length
    || filters.all_details_sent.length || filters.communication_skill.length || filters.career_gap.length
    || filters.relevant_experience_range.length || filters.relevant_in_hand_range.length || filters.virtual_onsite.length
    || filters.documents_availability.length || filters.call_connected.length
    || filters.salary_from !== '' || filters.salary_to !== '' || filters.total_exp_from !== '' || filters.total_exp_to !== ''
    || filters.relevant_exp_from !== '' || filters.relevant_exp_to !== ''
  );
  if (profileDetailFilterActive) clauses.push(profileWorkStartedSql());
  applyExactAnySql(clauses, params, 'full_name', filters.name);
  if (filters.phone.length) {
    const pieces = filters.phone.map((value) => {
      params.push(value);
      return `(${phoneSearchSql('phone', `$${params.length}`)})`;
    });
    clauses.push(`(${pieces.join(' or ')})`);
  }
  if(filters.recruiter_code.length)clauses.push(recruiterSelectionSql('candidates',filters.recruiter_code,params));
  applyTokenAnySql(clauses, params, 'location', filters.location, { location: true });
  applyTokenAnySql(clauses, params, 'preferred_location', filters.preferred_location, { location: true });
  applyExactAnySql(clauses, params, 'status', filters.status);
  applyExactAnySql(clauses, params, 'approval_status', filters.approval_status);
  applyExactAnySql(clauses, params, 'course_name', filters.course_name);
  const qualifications = filters.qualification;
  if (qualifications.length) {
    params.push(qualifications.map((value) => String(value).trim().toLowerCase()));
    clauses.push(`${qualificationCategorySql()} = any($${params.length})`);
  }
  applyTokenAnySql(clauses, params, 'process', filters.process);
  applyTokenAnySql(clauses, params, candidateDataNotesSqlExpression(), filters.data_notes, { multiDelimiter: true });
  applyExactAnySql(clauses, params, 'all_details_sent', filters.all_details_sent);
  applyExactAnySql(clauses, params, 'communication_skill', filters.communication_skill);
  applyExactAnySql(clauses, params, 'career_gap', filters.career_gap);
  applyExactAnySql(clauses, params, 'relevant_experience_range', filters.relevant_experience_range);
  applyExactAnySql(clauses, params, 'relevant_in_hand_range', filters.relevant_in_hand_range);
  applyExactAnySql(clauses, params, 'virtual_onsite', filters.virtual_onsite);
  applyExactAnySql(clauses, params, 'documents_availability', filters.documents_availability);
  applyExactAnySql(clauses, params, 'call_connected', filters.call_connected);
  applyExactAnySql(clauses, params, 'manager_crm', filters.manager_crm);
  applyExactAnySql(clauses, params, 'submitted_by', filters.submitted_by);
  if (filters.sr_from !== '') {
    params.push(Number(filters.sr_from));
    clauses.push(`coalesce(nullif(regexp_replace(candidate_id, '\\D', '', 'g'), ''), '0')::bigint >= $${params.length}`);
  }
  if (filters.sr_to !== '') {
    params.push(Number(filters.sr_to));
    clauses.push(`coalesce(nullif(regexp_replace(candidate_id, '\\D', '', 'g'), ''), '0')::bigint <= $${params.length}`);
  }
  if (filters.submission_from) {
    params.push(filters.submission_from);
    clauses.push(`left(coalesce(submission_date, ''), 10) >= $${params.length}`);
  }
  if (filters.submission_to) {
    params.push(filters.submission_to);
    clauses.push(`left(coalesce(submission_date, ''), 10) <= $${params.length}`);
  }
  if (filters.data_uploading_from) {
    params.push(filters.data_uploading_from);
    clauses.push(`left(coalesce(data_uploading_date, ''), 10) >= $${params.length}`);
  }
  if (filters.data_uploading_to) {
    params.push(filters.data_uploading_to);
    clauses.push(`coalesce(data_uploading_date,'') <> '' and left(data_uploading_date, 10) <= $${params.length}`);
  }
  if (filters.interview_from) {
    params.push(filters.interview_from);
    clauses.push(`left(coalesce(nullif(interview_date, ''), nullif(interview_reschedule_date, ''), ''), 10) >= $${params.length}`);
  }
  if (filters.interview_to) {
    params.push(filters.interview_to);
    clauses.push(`left(coalesce(nullif(interview_date, ''), nullif(interview_reschedule_date, ''), ''), 10) <= $${params.length}`);
  }
  if (filters.salary_from !== '') {
    params.push(Number(filters.salary_from));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(nullif(in_hand_salary, ''), nullif(ctc_monthly, ''), ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}`);
  }
  if (filters.salary_to !== '') {
    params.push(Number(filters.salary_to));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(nullif(in_hand_salary, ''), nullif(ctc_monthly, ''), ''), '[^0-9.]', '', 'g'), ''), '0')::numeric <= $${params.length}`);
  }
  if (filters.total_exp_from !== '') {
    params.push(Number(filters.total_exp_from));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(nullif(total_experience, ''), nullif(experience, ''), ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}`);
  }
  if (filters.total_exp_to !== '') {
    params.push(Number(filters.total_exp_to));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(nullif(total_experience, ''), nullif(experience, ''), ''), '[^0-9.]', '', 'g'), ''), '0')::numeric <= $${params.length}`);
  }
  if (filters.relevant_exp_from !== '') {
    params.push(Number(filters.relevant_exp_from));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(relevant_experience, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}`);
  }
  if (filters.relevant_exp_to !== '') {
    params.push(Number(filters.relevant_exp_to));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(relevant_experience, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric <= $${params.length}`);
  }
  return { filters, whereSql: clauses.length ? `where ${clauses.join(' and ')}` : '', params };
}

async function getAroundNav(user, candidateId) {
  const cacheKey = require('../lib/accessRules').dashboardCacheKey(user)+':'+candidateId;
  const cached = isLeadership(user) ? bucketPolicy.readCache(candidateNavCache,cacheKey) : null;
  if (cached) return cached;
  if (mode === 'postgres' && store.pool) {
    const params = [];
    const scopeClauses = [];
    // Admin/Manager may navigate all visible candidates. TL must stay inside own team; recruiter own only.
    if (!isAdminOrManager(user)) {
      const scoped = candidateScopeSql('', user, params);
      scopeClauses.push(scoped.sql);
    }
    params.push(candidateId);
    const currentRef = `$${params.length}`;
    scopeClauses.push(candidateNavVisibilitySql());
    const whereSql = scopeClauses.length ? `where ${scopeClauses.join(' and ')}` : '';
    const sql = `
      with scoped as (
        select candidate_id, full_name, row_number() over (order by coalesce(updated_at, created_at, '') desc, candidate_id desc) as rn
        from public.candidates
        ${whereSql}
      ), cur as (
        select rn from scoped where candidate_id = ${currentRef}
      )
      select candidate_id, full_name
      from scoped
      where rn between greatest(1, coalesce((select rn from cur), 1) - 1) and coalesce((select rn from cur), 1) + 1
      order by rn asc
    `;
    return candidateNavCache.set(cacheKey, await store.query(sql, params));
  }

  const rows = (await table('candidates'))
    .filter((row) => visibleCandidate(row, user))
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) || String(b.candidate_id || '').localeCompare(String(a.candidate_id || '')));
  const idx = rows.findIndex((row) => String(row.candidate_id) === String(candidateId));
  if (idx === -1) return [];
  return candidateNavCache.set(cacheKey, rows.slice(Math.max(0, idx - 1), idx + 2).map((row) => ({ candidate_id: row.candidate_id, full_name: row.full_name })));
}


function candidateSelectForColumns(columns) {
  const safeColumns = columns instanceof Set
    ? PERSISTED_CANDIDATE_FIELDS.filter((field) => columns.has(field))
    : [];
  return safeColumns.length ? safeColumns.map(qcol).join(', ') : '*';
}

function candidateOrderForColumns(columns,sortBy) {
  const custom=crmSortSql(columns,sortBy);if(custom)return custom;
  const parts = [];
  if (columns?.has?.('updated_at')) parts.push(`coalesce(updated_at, '') desc`);
  if (columns?.has?.('created_at')) parts.push(`coalesce(created_at, '') desc`);
  if (columns?.has?.('candidate_id')) parts.push(`candidate_id desc`);
  return parts.length ? ` order by ${parts.join(', ')}` : '';
}

async function readCandidateListRowsCompat(req, sqlFilter) {
  const { filters, whereSql, params } = sqlFilter;
  let columns = null;
  try { columns = await getCandidateColumnSet(); } catch {}
  const selectSql = candidateSelectForColumns(columns);
  const orderSql = candidateOrderForColumns(columns,req.query.sort_by);

  // Fast path: keep all normal filters inside Postgres so we transfer only
  // the rows the page needs. The selected column list is generated from the
  // live table, so additive schema rollout cannot break "All Profiles".
  try {
    const rows = await store.query(
      `select ${selectSql} from public.candidates ${whereSql}${orderSql}`,
      params,
    );
    return rows;
  } catch (primaryError) {
    // Production safety: never turn a schema/filter problem into a hidden large
    // candidate-table download. Surface the error so UI can keep its local shell
    // and offer Manual Refresh instead of showing a false empty list.
    throw primaryError;
  }
}

async function list(req, res) {
  const sqlFilter = buildSqlFilter(req);
  const { filters } = sqlFilter;
  if(!store.pool&&filters.recruiter_code.length)filters._recruiter_users=await table('users');
  const countOnly = String(req.query?.count_only || '') === '1';
  const skipListCache = Boolean(filters.bucket_mode) || countOnly;
  // CC26_681: _refresh is an explicit one-shot freshness request from the page.
  // Do not let it create a new cache key every time; bypass the old response, then
  // replace the normal cache entry with the fresh payload.
  const forceRefresh = Boolean(String(req.query?._refresh || '').trim());
  const cacheQuery = { ...(req.query || {}) };
  delete cacheQuery._refresh;
  const cacheKey = require('../lib/accessRules').dashboardCacheKey(req.user)+':'+JSON.stringify(cacheQuery);
  if (!skipListCache && !forceRefresh) {
    const cached = bucketPolicy.readCache(candidateListCache,cacheKey);
    if (cached) return res.json(cached);
  }
  if (filters.around_id) {
    const navItems = await getAroundNav(req.user, filters.around_id);
    return res.json({ items: [], nav_items: navItems, process_options: await readSharedProcessOptions(), total: navItems.length, page: 1, page_size: 3, has_more: false, summary: buildBucketSummary([], req.user) });
  }

  // CC26_683: Normal All Profiles is truly database-paginated. We still keep
  // complex bucket/last-viewed screens on the exact legacy path so their calculated
  // counters stay bit-for-bit correct.
  const canUseSqlPage = mode === 'postgres' && store.pool && !String(filters.last_viewed_mode || '').trim();
  if (canUseSqlPage) {
    try {
      const columns=await getCandidateColumnSet();
      const selectSql=candidateSelectForColumns(columns),orderSql=candidateOrderForColumns(columns,req.query.sort_by);
      const own=candidateOwnerSql('',{...req.user,role:'recruiter',designation:'Recruiter',__ccSharedScopes:[],__ccSoloPeers:{}},[...sqlFilter.params]);
      const facts=bucketPolicy.factsSql(sqlFilter.whereSql,own.sql,columns),params=own.params;
      const view=bucketPolicy.viewSql(filters.bucket_view);
      if(countOnly){const counts=await store.query(facts+`select count(*)::int as total from bucket_facts where ${view}`,params);const locations=req.query.include_distribution==='1'?await store.query(facts+`select coalesce(nullif(preferred_location,''),nullif(location,''),'Unspecified') as location,count(*)::int as count from bucket_facts where ${view} group by 1 order by count desc,location`,params):[];return res.json({ok:true,count_only:true,total:Number(counts[0]?.total||0),location_counts:locations});}
      const offset=(filters.page-1)*filters.page_size;
      const pageSql=facts+`select ${selectSql} from bucket_facts where ${view}${orderSql} limit $${params.length+1} offset $${params.length+2}`;
      const metadataQuery={...cacheQuery};delete metadataQuery.page;delete metadataQuery.page_size;delete metadataQuery.pageSize;
      const metadataKey=[req.user.user_id,req.user.role,req.user.__ccAccessRevision||0,(req.user.__ccTeamUserIds||[]).join(','),JSON.stringify(metadataQuery)].join(':');
      if(forceRefresh)candidateListMetaCache.delete(metadataKey);
      const cachedMeta=!forceRefresh?bucketPolicy.readCache(candidateListMetaCache,metadataKey):null;
      const metadataPromise=cachedMeta?Promise.resolve(cachedMeta):candidateListMetaCache.load(metadataKey,async()=>{
        const [summaryRows,countRows]=await Promise.all([store.query(facts+bucketPolicy.summarySql(),params),store.query(facts+`select count(*)::int as total from bucket_facts where ${view}`,params)]);
        const first=summaryRows[0]||{};const {bucket_refresh_at,...summary}=first;
        return {total:Number(countRows[0]?.total||0),summary:{...summary,bucket_capacity_max:BUCKET_MAX_ACTIVE},bucket_refresh_at:bucket_refresh_at?new Date(bucket_refresh_at).toISOString():''};
      });
      const [pageRows,metadata]=await Promise.all([require('../lib/versionedList').snapshotPage(pageSql,[...params,filters.page_size,offset],orderSql,'candidate-page'),metadataPromise]);
      const items=sanitizeCandidateListForUser(pageRows.map(enrichCandidate).filter(row=>visibleCandidate(row,req.user)),req.user);
      const payload={items,filter_source_rows:items,dialer_items:items,process_options:await readSharedProcessOptions(),total:metadata.total,page:filters.page,page_size:filters.page_size,has_more:offset+items.length<metadata.total,summary:metadata.summary,bucket_refresh_at:metadata.bucket_refresh_at};
      candidateListCache.set(cacheKey,payload);return res.json(payload);
    }catch(error){console.error('Scoped candidate page failed:',error.message);return res.status(503).json({message:'Apply the included SAFE_UPGRADE SQL, then refresh once. Your saved data is unchanged.'});}
  }

  let baseRows = [];
  if (mode === 'postgres' && store.pool) {
    baseRows = await readCandidateListRowsCompat(req, sqlFilter);
  } else {
    const rows = await table('candidates');
    baseRows = rows.filter((row) => rowMatchesFilters(row, filters, req.user))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  // CC26_681: never collapse or silently hide candidate rows in All Profiles.
  // Duplicate review remains a separate workflow; the canonical candidate row stays visible here.
  const logicalRows = baseRows;
  const decoratedRows = logicalRows.map((row) => enrichCandidate(row)).filter((row) => visibleCandidate(row, req.user));
  const lastViewedRows = decoratedRows.filter((row) => matchesLastViewedWindow(row, filters));
  const enrichedRows = lastViewedRows.filter((row) => matchesBucketView(row, filters, req.user));
  const sortedRows = sortCrmRows(sortBucketRows(enrichedRows, filters.bucket_view),req.query.sort_by);
  if (countOnly) {const locations=new Map();if(req.query.include_distribution==='1')for(const row of sortedRows){const k=row.preferred_location||row.location||'Unspecified';locations.set(k,(locations.get(k)||0)+1);}return res.json({ok:true,count_only:true,total:sortedRows.length,location_counts:[...locations].map(([location,count])=>({location,count}))});}
  const offset = (filters.page - 1) * filters.page_size;
  const items = sortedRows.slice(offset, offset + filters.page_size);
  const summary = buildBucketSummary(decoratedRows, req.user);
  const payload = {
    items: sanitizeCandidateListForUser(items, req.user),
    filter_source_rows: sanitizeCandidateListForUser(items, req.user),
    dialer_items: sanitizeCandidateListForUser(items, req.user),
    process_options: await readSharedProcessOptions(),
    total: sortedRows.length,
    page: filters.page,
    page_size: filters.page_size,
    has_more: offset + items.length < sortedRows.length,
    summary, bucket_refresh_at: bucketPolicy.nextRefresh(decoratedRows),
  };
  if (!skipListCache) candidateListCache.set(cacheKey, payload);
  return res.json(payload);
}



function isHotLeadRow(row) {
  // CC26_510: Hot Leads is a dedicated upload lane.
  // Only rows explicitly stamped by Admin -> Hot Leads Upload are allowed here.
  // Normal Bulk Candidate Load rows may legitimately have profile_status/JD/employee fields,
  // so those fields must never make a normal candidate appear inside Hot Leads.
  return lower(row?.lead_source || '') === 'hot_lead';
}

function countMissingHotLeadImportant(row) {
  const important = ['full_name','phone','location','qualification','preferred_location','qualification_level','total_experience','relevant_experience','ctc_monthly','in_hand_salary','communication_skill','interview_reschedule_date','profile_status','jd_name'];
  return important.reduce((count, key) => count + (String(row?.[key] || '').trim() ? 0 : 1), 0);
}

function hotLeadSearchMatches(row, q) {
  if (!String(q || '').trim()) return true;
  return ['candidate_id','full_name','phone','location','qualification','preferred_location','process','notes','data_notes','jd_notes','jd_name','profile_status','employee_code','employee_no','employee_name','recruiter_code'].some((key) => containsText(row?.[key], q));
}


function hotLeadRoleMaxPageSize(user) {
  const role = userRole(user);
  if (role === 'admin' || role === 'manager') return Number(process.env.CRM_HOT_LEADS_MANAGER_MAX_ROWS || 200);
  if (role === 'tl') return 50;
  return 10;
}

function hotLeadPageSizeFromRequest(user, value) {
  const maxRows = hotLeadRoleMaxPageSize(user);
  const raw = String(value || '').trim().toLowerCase();
  const requested = raw === 'all' ? maxRows : (Number(raw) || 10);
  return Math.min(maxRows, Math.max(1, requested));
}

function hotLeadRecruiterDisplay(row = {}) {
  return String(row.recruiter_name || row.employee_name || row.employee_code || row.recruiter_code || row.employee_no || '').trim();
}

function hotLeadRecruiterCode(row = {}) {
  return String(row.recruiter_code || row.employee_code || row.employee_no || '').trim();
}

function hotLeadMatchesRecruiter(row = {}, recruiterCode = '') {
  const target = String(recruiterCode || '').trim();
  if (!target) return true;
  return recruiterCodeMatches(row.recruiter_code, target)
    || recruiterCodeMatches(row.employee_code, target)
    || recruiterCodeMatches(row.employee_no, target)
    || lower(row.recruiter_name || '') === lower(target)
    || lower(row.employee_name || '') === lower(target);
}

function hotLeadMatchesView(row = {}, view = 'all', user = {}) {
  const key = lower(view || 'all');
  // CC74: hot leads and candidates use identical My Fresh/Working semantics.
  return matchesBucketView(row, { bucket_view: key || 'all' }, user);
}

function buildHotLeadRecruiterOptions(rows = [], users = []) {
  const map = new Map();
  const add = (code, name = '') => {
    const cleanCode = String(code || '').trim();
    if (!cleanCode || map.has(cleanCode)) return;
    const cleanName = String(name || '').trim();
    map.set(cleanCode, { value: cleanCode, label: cleanName || 'Unnamed employee' });
  };
  for (const user of users || []) add(user.recruiter_code || user.user_id, user.full_name || user.username);
  for (const row of rows || []) add(hotLeadRecruiterCode(row), hotLeadRecruiterDisplay(row));
  return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

async function sqlHotLeadPage(req,res,options) {
  const {q,page,pageSize,bucketView,recruiterFilter}=options;
  const scope=candidateScopeSql('',req.user,[]),params=scope.params;
  const clauses=[scope.sql,"lower(trim(coalesce(lead_source,'')))='hot_lead'"];
  if(q){params.push(q.toLowerCase());clauses.push(`position($${params.length} in lower(concat_ws(' ',candidate_id,full_name,phone,location,qualification,preferred_location,process,notes,data_notes,jd_notes,jd_name,profile_status,employee_code,employee_no,employee_name,recruiter_code)))>0`);}
  if(recruiterFilter){params.push(recruiterFilter.toLowerCase());const ref=`$${params.length}`;clauses.push(`(exists(select 1 from regexp_split_to_table(concat_ws(',',recruiter_code,employee_code,employee_no),',') code where lower(trim(code))=${ref}) or lower(coalesce(recruiter_name,''))=${ref} or lower(coalesce(employee_name,''))=${ref})`);}
  const own=candidateOwnerSql('',{...req.user,role:'recruiter',designation:'Recruiter',__ccSharedScopes:[],__ccSoloPeers:{}},params);
  const facts=bucketPolicy.factsSql('where '+clauses.join(' and '),own.sql,await getCandidateColumnSet()),view=bucketPolicy.viewSql(bucketView);
  const important=['full_name','phone','location','qualification','preferred_location','qualification_level','total_experience','relevant_experience','ctc_monthly','in_hand_salary','communication_skill','interview_reschedule_date','profile_status','jd_name'];
  const missing=important.map(key=>`trim(coalesce(${key},''))=''`).join(' or ');
  const summarySql=bucketPolicy.summarySql().replace(' from bucket_facts',`,count(*) filter(where ${missing})::int as missing_important_count from bucket_facts`);
  const columns=await getCandidateColumnSet(),select=candidateSelectForColumns(columns),order=candidateOrderForColumns(columns,req.query.sort_by);
  const pageLimit=pageSize,offset=(page-1)*pageSize;
  const args=own.params;
  const [pageRows,summaryRows,countRows,users]=await Promise.all([
    require('../lib/versionedList').snapshotPage(facts+`select ${select} from bucket_facts where ${view}${order} limit $${args.length+1} offset $${args.length+2}`,[...args,pageLimit,offset],order,'hot-lead-page'),
    store.query(facts+summarySql,args),store.query(facts+`select count(*)::int as total from bucket_facts where ${view}`,args),
    store.query(`select user_id,full_name,username,recruiter_code from public.users ${isAdminOrManager(req.user)?'':'where user_id=any($1::text[])'}`,isAdminOrManager(req.user)?[]:[[req.user.user_id,...(req.user.__ccTeamUserIds || []),...(req.user.__ccSharedScopes||[]).flatMap(scope=>scope.ids),...(req.user.__ccSoloPeers?.ids||[])]])
  ]);
  const {bucket_refresh_at,...summary}=summaryRows[0] || {},total=Number(countRows[0]?.total || 0);
  const items=pageRows.map(enrichCandidate).map(row=>({...row,hot_lead_missing_count:countMissingHotLeadImportant(row)}));
  return res.json({items:sanitizeCandidateListForUser(items,req.user),dialer_items:sanitizeCandidateListForUser(items,req.user),total,page,page_size:pageSize,max_page_size:hotLeadRoleMaxPageSize(req.user),has_more:offset+items.length<total,missing_important_count:Number(summary.missing_important_count || 0),recruiter_options:buildHotLeadRecruiterOptions([],users),summary:{...summary,bucket_capacity_max:BUCKET_MAX_ACTIVE,total:Number(summary.total_visible || 0),filtered_total:total},bucket_refresh_at:bucket_refresh_at?new Date(bucket_refresh_at).toISOString():''});
}

async function listHotLeads(req, res) {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = hotLeadPageSizeFromRequest(req.user, req.query.page_size || 10);
  const bucketView = lower(req.query.bucket_view || 'all');
  const recruiterFilter = isAccessLeadership(req.user) ? String(req.query.recruiter_code || '').trim() : '';
  const lastViewedMode = String(req.query.last_viewed_mode || '').trim();
  if (mode === 'postgres' && store.pool && !lastViewedMode) return sqlHotLeadPage(req,res,{q,page,pageSize,bucketView,recruiterFilter});
  let rawRows = [];
  if (mode === 'postgres' && store.pool) {
    const scope=candidateScopeSql('',req.user,[]);
    const columns=await getCandidateColumnSet();
    rawRows=await store.query(`select ${candidateSelectForColumns(columns)} from public.candidates where ${scope.sql} and lower(trim(coalesce(lead_source,'')))='hot_lead'${candidateOrderForColumns(columns)}`,scope.params);
  } else {
    rawRows = await table('candidates');
  }
  let users = [];
  try { users = await table('users'); } catch { users = []; }
  const visibleHotRows = rawRows
    .map((row) => enrichCandidate(row))
    .filter((row) => visibleCandidate(row, req.user))
    .filter(isHotLeadRow);
  const searchedRows = visibleHotRows
    .filter((row) => hotLeadSearchMatches(row, q))
    .filter((row) => hotLeadMatchesRecruiter(row, recruiterFilter))
    .filter((row) => matchesLastViewedWindow(row, { last_viewed_mode: lastViewedMode }));
  const filteredRows = searchedRows.filter((row) => hotLeadMatchesView(row, bucketView, req.user));
  const sortedRows = sortCrmRows(sortBucketRows(filteredRows, bucketView),req.query.sort_by);
  const offset = (page - 1) * pageSize;
  const items = sortedRows.slice(offset, offset + pageSize).map((row) => ({ ...row, hot_lead_missing_count: countMissingHotLeadImportant(row) }));
  const bucketSummary = buildBucketSummary(searchedRows, req.user);
  return res.json({
    items: sanitizeCandidateListForUser(items, req.user),
    dialer_items: sanitizeCandidateListForUser(items, req.user),
    total: sortedRows.length,
    page,
    page_size: pageSize,
    max_page_size: hotLeadRoleMaxPageSize(req.user),
    has_more: offset + items.length < sortedRows.length,
    missing_important_count: searchedRows.filter((row) => countMissingHotLeadImportant(row) > 0).length,
    recruiter_options: buildHotLeadRecruiterOptions(visibleHotRows, users),
    summary: {
      ...bucketSummary,
      total: searchedRows.length,
      filtered_total: sortedRows.length,
      missing_important_count: searchedRows.filter((row) => countMissingHotLeadImportant(row) > 0).length,
    },
  });
}



// CC26_644: one scalar result instead of transferring ALL candidate rows just to preview an ID.
const NEXT_CANDIDATE_NUMBER_SQL = `select nextval('public.crm_candidate_id_seq') as next_number`;
function formattedCandidateId(number) { return `C${String(number).padStart(3, '0')}`; }
async function nextCandidateId(client = null) {
  if (store.pool) {
    const result = await (client || activeTransactionClient() || store.pool).query(NEXT_CANDIDATE_NUMBER_SQL);
    return formattedCandidateId(result.rows?.[0]?.next_number);
  }
  // JSON fallback: include historical allocations, not only surviving candidates.
  const historical = await table('crm_command_receipts');
  const drafts = await table('crm_candidate_drafts');
  const registry = await table('crm_candidate_id_registry');
  const events = await table('activity_log');
  const allocated = [...await table('candidates'), ...historical, ...drafts, ...registry, ...events].map(row => String(row.candidate_id || '')).filter(Boolean);
  const max = Math.max(0, ...allocated.map(id => /^C(\d+)$/i.test(id) ? Number(id.slice(1)) : 0));
  return formattedCandidateId(max + 1); // JSON development mode; production must use PostgreSQL sequence
}
async function previewNextCandidateId(req, res) {
  try { return res.json({ candidate_id: '', provisional: true, message: 'A permanent Candidate ID is assigned only on successful Submit from New Candidate.' }); }
  catch (error) { return res.status(503).json({ message: 'Next candidate ID temporarily unavailable.' }); }
}
async function insertNewCandidateSafely(item) {
  if (!store.pool) {
    return withTransaction(async () => {
      item.candidate_id = await nextCandidateId();
      // Local development fallback also remembers an ID after candidate deletion.
      await store.insert('crm_candidate_id_registry', { candidate_id:item.candidate_id, allocated_at:nowIso() });
      return store.insert('candidates', item);
    });
  }
  // The same transaction reserves the next ID AND inserts the row. Multiple simultaneous
  // profile saves therefore cannot receive the same ID. No old record is updated or deleted.
  // CC26_679 also filters the INSERT to the columns that are actually present in the live
  // candidate table so an optional/new field (for example course_name during rollout) can
  // never make the entire new profile disappear.
  const liveColumns = await getCandidateColumnSet();
  if (!liveColumns.has('candidate_id')) throw new Error('Candidate table is missing candidate_id. No profile was changed.');
  const inheritedClient = activeTransactionClient();
  const client = inheritedClient || await store.pool.connect();
  let inTransaction = false;
  try {
    if (!inheritedClient) { await client.query('BEGIN'); inTransaction = true; }
    await client.query('select pg_advisory_xact_lock($1)', [2644001]);
    await require('../lib/candidatePhoneGuard').assertUnique(item.phone, '', client);
    item.candidate_id = await nextCandidateId(client);
    const safeItem = await filterCandidateWritePayload(pickCandidateFields(item));
    safeItem.candidate_id = item.candidate_id;
    const columns = Object.keys(safeItem);
    const quoted = columns.map((name) => `"${name.replace(/"/g,'""')}"`).join(', ');
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const response = await client.query(`insert into public.candidates (${quoted}) values (${placeholders}) returning *`, Object.values(safeItem));
    if (!inheritedClient) { await client.query('COMMIT'); inTransaction = false; }
    return response.rows?.[0] || safeItem;
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { if (!inheritedClient) client.release(); }
}

async function create(req, res) {
  require('../lib/candidatePhoneGuard').validateInput(req.body?.phone,{required:true});
  if (req.body) delete req.body.bucket_state;
  let item = normalizeCandidate(req.body, {
    candidate_id: '', // Actual unique ID generated atomically during insert.
    jd_id: req.body.jd_id || '',
    interview_date: req.body.interview_date || '',
    created_by_user_id: req.user.user_id || '',
    created_by_name: req.user.full_name || req.user.username || '',
    recruiter_user_id: req.user.user_id || '',
    user_id: req.user.user_id || '',
    call_connected: '',
    looking_for_job: '',
    full_name: '',
    phone: '',
    qualification: '',
    location: '',
    preferred_location: 'Gurgaon',
    qualification_level: '',
    total_experience: '',
    relevant_experience: '',
    in_hand_salary: '',
    ctc_monthly: '',
    career_gap: '',
    documents_availability: '',
    communication_skill: '',
    relevant_experience_range: '',
    relevant_in_hand_range: '',
    submission_date: '',
    process: '',
    recruiter_code: req.user.recruiter_code || '',
    recruiter_name: req.user.full_name || '',
    recruiter_designation: req.user.designation || req.user.role || '',
    status: 'Draft',
    all_details_sent: '',
    interview_availability: '',
    interview_reschedule_date: '',
    virtual_onsite: '',
    follow_up_at: '',
    follow_up_note: '',
    follow_up_status: '',
    approval_status: 'Draft',
    approval_requested_at: '',
    approved_at: '',
    approved_by_name: '',
    is_duplicate: '0',
    notes: req.body.notes || '',
    resume_filename: '',
    recording_filename: '',
    created_at: nowIso(),
    updated_at: nowIso(),
    experience: '',
    last_dialed_at: '',
    last_dialed_by_name: '',
    dial_attempt_count: '0',
    last_viewed_at: '',
    last_viewed_by_name: '',
  }, req.user);
  // New records cannot inherit approval/deletion state from a cached form.
  Object.assign(item,{approval_status:'Draft',approval_requested_at:'',approved_at:'',approved_by_name:'',submitted_by:'',submission_date:'',deleted_at:'',deleted_by:'',created_by_user_id:req.user.user_id||'',created_by_name:req.user.full_name||req.user.username||''});
  if (['approved','deleted','__deleted__','archived'].includes(lower(item.status))) item.status='Draft';
  item.data_notes=String(item.data_notes||'').replace(/\[crm-deleted\]/gi,'');
  item=await applyRecruiterAssignmentIfAllowed(item,req.body?.recruiter_code,req.user);
  await require('../lib/collaborationAccess').validateAssignment({},item,req.user);
  const savedItem = await insertNewCandidateSafely(item);
  invalidateCandidateCaches();
  logActivity(req, savedItem.candidate_id, 'candidate_created', { full_name: savedItem.full_name || item.full_name || '' }).catch(() => {});
  return res.json({ item: candidateEditResponse(savedItem, req.user) });
}


async function bulkCreate(req, res) {
  const inputItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 30) : [];
  if (!inputItems.length) return res.status(400).json({ message: 'Add at least one candidate row.' });
  // Validate the entire batch before allocating its first permanent Candidate ID.
  for(const source of inputItems)if(String(source.full_name||source.name||source.phone||source.primary_phone||source.mobile||'').trim())require('../lib/candidatePhoneGuard').validateInput(source.phone||source.primary_phone||source.mobile,{required:true});
  const created = [];
  for (const source of inputItems) {
    const cleanName = String(source.full_name || source.name || '').trim();
    const cleanPhone = require('../lib/candidatePhoneGuard').validateInput(source.phone || source.primary_phone || source.mobile || '');
    if (!cleanName && !cleanPhone) continue;
    const provisionalId = '';
    const notesBits = [String(source.notes || '').trim()];
    if (String(source.secondary_phone || '').trim()) notesBits.unshift(`Secondary Number: ${normalizeIndianPhone(source.secondary_phone) || String(source.secondary_phone).trim()}`);
    if (String(source.email || '').trim()) notesBits.unshift(`Email: ${String(source.email).trim()}`);
    if (String(source.linkedin_url || '').trim()) notesBits.push(`LinkedIn: ${String(source.linkedin_url).trim()}`);
    if (String(source.companies || '').trim()) notesBits.push(`Companies: ${String(source.companies).trim()}`);
    if (String(source.dob || '').trim()) notesBits.push(`DOB: ${String(source.dob).trim()}`);
    if (String(source.gender || '').trim()) notesBits.push(`Gender: ${String(source.gender).trim()}`);
    if (String(source.source_filename || '').trim()) notesBits.push(`Imported From: ${String(source.source_filename).trim()}`);
    const item = normalizeCandidate({
      ...source,
      candidate_id: provisionalId,
      phone: cleanPhone,
      notes: notesBits.filter(Boolean).join('\n'),
      recruiter_code: source.recruiter_code || req.user.recruiter_code || '',
      recruiter_name: source.recruiter_name || req.user.full_name || '',
      recruiter_designation: source.recruiter_designation || req.user.designation || '',
      status: 'Draft',
      all_details_sent: '',
      call_connected: source.call_connected || '',
      looking_for_job: source.looking_for_job || '',
      preferred_location: source.preferred_location || '',
      documents_availability: source.documents_availability || '',
      communication_skill: source.communication_skill || '',
      submission_date: '',
      approval_status: 'Draft',
      created_at: nowIso(),
      updated_at: nowIso(),
    }, {
      candidate_id: provisionalId,
      call_connected: '',
      looking_for_job: '',
      full_name: cleanName,
      phone: cleanPhone,
      qualification: '',
      location: '',
      preferred_location: '',
      qualification_level: '',
      total_experience: '',
      relevant_experience: '',
      in_hand_salary: '',
      ctc_monthly: '',
      career_gap: '',
      documents_availability: '',
      communication_skill: '',
      relevant_experience_range: '',
      relevant_in_hand_range: '',
      submission_date: '',
      process: '',
      recruiter_code: req.user.recruiter_code || '',
      recruiter_name: req.user.full_name || '',
      recruiter_designation: req.user.designation || req.user.role || '',
      status: 'Draft',
      all_details_sent: '',
      interview_availability: '',
      interview_reschedule_date: '',
      virtual_onsite: '',
      follow_up_at: '',
      follow_up_note: '',
      follow_up_status: '',
      approval_status: 'Draft',
      approval_requested_at: '',
      approved_at: '',
      approved_by_name: '',
      is_duplicate: '0',
      notes: '',
      resume_filename: '',
      recording_filename: '',
      created_at: nowIso(),
      updated_at: nowIso(),
      experience: '',
      last_dialed_at: '',
      last_dialed_by_name: '',
      dial_attempt_count: '0',
      last_viewed_at: '',
      last_viewed_by_name: '',
    }, req.user);
    const saved = await insertNewCandidateSafely(item);
    created.push(saved);
    await logActivity(req, saved.candidate_id, 'candidate_created', {
      full_name: saved.full_name || '',
      source: 'bulk_resume_import',
      imported_from: String(source.source_filename || '').trim(),
    }).catch(() => {});
  }
  if (!created.length) return res.status(400).json({ message: 'No usable candidate rows were found.' });
  invalidateCandidateCaches();
  return res.json({ items: sanitizeCandidateListForUser(created, req.user), count: created.length });
}



// The profile screen must display the PREVIOUS visit, not the visit that is happening now.
// Store a tiny in-memory snapshot per viewer/profile while this tab is loading. The DB still
// records the current visit immediately, so the next visit shows the correct prior timestamp.
const profilePreviousViewSnapshots = new Map();
const PROFILE_PREVIOUS_VIEW_TTL_MS = 2 * 60 * 1000;

function profileViewSnapshotKey(user = {}, candidateId = '') {
  return `${String(user.user_id || user.username || '').trim().toLowerCase()}::${String(candidateId || '').trim()}`;
}

function putProfilePreviousViewSnapshot(user, candidateId, item = {}) {
  const key = profileViewSnapshotKey(user, candidateId);
  if (!key || key.startsWith('::')) return null;
  const snapshot = {
    last_viewed_at: String(item.last_viewed_at || 'Never Opened'),
    last_viewed_by_name: String(item.last_viewed_by_name || ''),
    expires_at: Date.now() + PROFILE_PREVIOUS_VIEW_TTL_MS,
  };
  profilePreviousViewSnapshots.set(key, snapshot);
  while(profilePreviousViewSnapshots.size>5000)profilePreviousViewSnapshots.delete(profilePreviousViewSnapshots.keys().next().value);
  return snapshot;
}

function getProfilePreviousViewSnapshot(user, candidateId) {
  const key = profileViewSnapshotKey(user, candidateId);
  const snapshot = profilePreviousViewSnapshots.get(key);
  if (!snapshot) return null;
  if (Number(snapshot.expires_at || 0) <= Date.now()) {
    profilePreviousViewSnapshots.delete(key);
    return null;
  }
  return snapshot;
}

function legacyCandidateNotes(candidate = {}, limit = 60) {
  const candidateId = String(candidate.candidate_id || '').trim();
  const stamp = String(candidate.updated_at || candidate.created_at || nowIso());
  const username = String(candidate.recruiter_name || candidate.recruiter_code || 'Saved Profile').trim() || 'Saved Profile';
  const raw = [
    ['notes', candidate.notes],
    ['data_notes', candidate.data_notes],
    ['follow_up_note', candidate.follow_up_note],
  ];
  const seen = new Set();
  const rows = [];
  for (const [kind, value] of raw) {
    const body = String(value || '').trim();
    if (!body || seen.has(body.toLowerCase())) continue;
    seen.add(body.toLowerCase());
    rows.push({
      id: `legacy-${kind}-${candidateId}`,
      candidate_id: candidateId,
      username,
      note_type: kind === 'follow_up_note' ? 'followup' : 'legacy',
      body,
      created_at: stamp,
      updated_at: stamp,
    });
  }
  return rows.slice(0, Math.max(1, Number(limit || 60) || 60));
}

function legacyCandidateTimeline(candidate = {}, user = {}) {
  const candidateId = String(candidate.candidate_id || '').trim();
  const actor = String(candidate.recruiter_name || candidate.recruiter_code || user.full_name || user.username || 'CRM').trim() || 'CRM';
  const rows = [];
  const push = (type, stamp, metadata = {}) => {
    const createdAt = String(stamp || '').trim();
    if (!createdAt || Number.isNaN(new Date(createdAt).getTime())) return;
    rows.push({
      id: `legacy-${type}-${candidateId}-${createdAt}`,
      activity_id: `legacy-${type}-${candidateId}-${createdAt}`,
      candidate_id: candidateId,
      username: actor,
      action_type: type,
      metadata: safeJsonStringify(metadata),
      created_at: createdAt,
    });
  };
  push('candidate_created', candidate.created_at, { recovered_from: 'candidate_record' });
  if (String(candidate.updated_at || '') && String(candidate.updated_at || '') !== String(candidate.created_at || '')) {
    push('profile_updated', candidate.updated_at, { recovered_from: 'candidate_record' });
  }
  push('submitted_for_approval', candidate.approval_requested_at || candidate.submission_date, { recovered_from: 'candidate_record' });
  if (candidate.last_viewed_at) push('profile_opened', candidate.last_viewed_at, { section: 'candidate detail', recovered_from: 'candidate_record' });
  return rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 80);
}

function mergeCandidateNotes(candidate, rows, limit = 60) {
  const current = safeNoteRows(rows, limit);
  if (current.length) return current;
  return safeNoteRows(legacyCandidateNotes(candidate, limit), limit);
}

function mergeCandidateTimeline(candidate, rows, user, limit = 80) {
  const current = safeActivityRows(rows, limit);
  if (current.length) return current;
  return safeActivityRows(legacyCandidateTimeline(candidate, user), limit);
}



function candidateDetailCompatItem(row = {}, candidateId = '') {
  const source = safeRowObject(row);
  const next = { ...source };
  next.candidate_id = String(next.candidate_id || candidateId || '').trim();
  next.full_name = String(next.full_name || next.name || next.candidate_name || next.candidate_id || '').trim();
  next.location = String(next.location || next.current_location || '').trim();
  next.current_location = String(next.current_location || next.location || '').trim();
  next.in_hand_salary = String(next.in_hand_salary || next.inhand_salary || '').trim();
  next.inhand_salary = String(next.inhand_salary || next.in_hand_salary || '').trim();
  next.course_name = String(next.course_name || next.qualification || '').trim();
  next.qualification = String(next.qualification || next.course_name || '').trim();
  next.preferred_location = Array.isArray(next.preferred_location) ? next.preferred_location.join(', ') : String(next.preferred_location || '');
  next.process = Array.isArray(next.process) ? next.process.join(', ') : String(next.process || '');
  next.approval_status = String(next.approval_status || 'Draft');
  next.status = String(next.status || 'Draft');
  next.all_details_sent = String(next.all_details_sent || 'Pending');
  return next;
}

const profileBundleCache=createTimedCache(3000,{maxEntries:64,tags:['candidates','access']});
async function getOne(req, res) {
  try {
    const candidateId = String(req.params.candidateId || '').trim();
    if (!candidateId) return res.status(400).json({ message: 'Candidate id is required' });

    const rawItem = await withSoftTimeout(async()=>store.pool?(await require('../lib/versionedList').versionedList({key:'profile',select:'r.*',from:'public.candidates r',where:'r.candidate_id=$1',params:[candidateId],id:'candidate_id',idExpr:'r.candidate_id'}))[0]:store.findById('candidates','candidate_id',candidateId),null,10000);
    const item = safeRowObject(rawItem);
    if (!item || !item.candidate_id || isDeletedCandidate(item)) return res.status(404).json({ message: 'Candidate not found' });
    if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
    if (String(req.query.edit_only || '') === '1') {
      return res.json({ item: candidateEditResponse(item, req.user) });
    }
    const prefetchOnly = String(req.query.prefetch || '').trim() === '1';

    const skipFiles = true; // CC26_593: Candidate Files feature removed; never read file rows in profile requests.
    const notesLimit = prefetchOnly ? 15 : 60;

    const notesTask = () => {
      if (prefetchOnly) return [];
      if (mode === 'postgres' && store.pool) {
        return require('../lib/versionedList').versionedList({key:'profile-notes',select:'n.*',from:`(select * from public.notes where candidate_id=$1 order by created_at desc,id desc limit ${notesLimit}) n`,where:'true',params:[candidateId],id:'id',idExpr:'n.id'}).then(rows=>rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))));
      }
      return table('notes').then((rows) => rows.filter((n) => String(n.candidate_id) === String(candidateId)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, notesLimit));
    };

    const timelineTask = () => {
      if (prefetchOnly) return [];
      if (mode === 'postgres' && store.pool) {
        return require('../lib/versionedList').versionedList({key:'profile-timeline',select:'h.*',from:`(select a.*,u.full_name from public.activity_log a left join lateral(select full_name from public.users where user_id=nullif(a.user_id,'') or (coalesce(a.user_id,'')='' and lower(username)=lower(a.username)) limit 1) u on true where a.candidate_id=$1 order by a.created_at desc,a.id desc limit 80) h`,where:'true',params:[candidateId],id:'id',idExpr:'h.id'}).then(rows=>rows.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))));
      }
      return table('activity_log').then((rows) => rows.filter((n) => String(n.candidate_id) === String(candidateId)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 80));
    };

    const bundleKey=JSON.stringify([req.user.user_id,req.user.role,req.user.__ccAccessRevision,candidateId,item.updated_at,prefetchOnly]);
    const [rawNotes, rawTimeline, rawNavItems, rawFiles, rawUsers, rawSubmission] = await profileBundleCache.load(bundleKey,()=>Promise.all([
      prefetchOnly ? Promise.resolve([]) : withSoftTimeout(notesTask, [], 5000),
      prefetchOnly ? Promise.resolve([]) : withSoftTimeout(timelineTask, [], 5000),
      prefetchOnly ? Promise.resolve([]) : withSoftTimeout(() => getAroundNav(req.user, candidateId), [], 4000),
      skipFiles ? Promise.resolve([]) : withSoftTimeout(() => listCandidateFiles(candidateId), [], 5000),
      prefetchOnly ? Promise.resolve([]) : (canManagerReassignRecruiter(req.user) ? withSoftTimeout(() => require('../lib/collaborationAccess').roster(), [], 4000) : Promise.resolve([])),
      prefetchOnly ? Promise.resolve(null) : withSoftTimeout(() => findLatestSubmittedSubmissionCompat(candidateId), null, 4000),
    ]));

    const workflowItem = prefetchOnly ? item : submittedWorkflowResponseItem(item, rawSubmission);
    const safeItem = candidateDetailCompatItem(candidateEditResponse(item, req.user, workflowItem), candidateId);
    const previousView = getProfilePreviousViewSnapshot(req.user, candidateId);
    if (previousView) {
      safeItem.last_viewed_at = previousView.last_viewed_at || 'Never Opened';
      safeItem.last_viewed_by_name = previousView.last_viewed_by_name || '';
    } else {
      // Multi-instance safe fallback: if this user has just opened the profile, the DB's
      // last_viewed_at is the CURRENT visit. Display the persisted previous visit instead.
      const liveLastMs = Date.parse(item.last_viewed_at || '');
      const currentViewer = String(req.user?.full_name || req.user?.username || '').trim().toLowerCase();
      const liveViewer = String(item.last_viewed_by_name || '').trim().toLowerCase();
      const isCurrentVisit = Boolean(currentViewer && liveViewer === currentViewer && Number.isFinite(liveLastMs) && Date.now() - liveLastMs < 120000);
      if (isCurrentVisit && item.previous_last_viewed_at) {
        safeItem.last_viewed_at = String(item.previous_last_viewed_at || 'Never Opened');
        safeItem.last_viewed_by_name = String(item.previous_last_viewed_by_name || '');
      }
    }
    delete safeItem.previous_last_viewed_at;
    delete safeItem.previous_last_viewed_by_name;
    const notes = mergeCandidateNotes(item, rawNotes, 60);
    const timeline = mergeCandidateTimeline(item, rawTimeline, req.user, 80);
    const files = safeRows(rawFiles, 20).map(sanitizeCandidateFile);
    const navItems = safeRows(rawNavItems, 25).map((row) => ({ candidate_id: String(row.candidate_id || ''), full_name: String(row.full_name || '') })).filter((row) => row.candidate_id);
    const recruiterOptions = canManagerReassignRecruiter(req.user) ? recruiterOptionsFromUsers(safeRows(rawUsers, 150)) : [];

    return res.json({
      item: safeItem,
      notes,
      timeline,
      files,
      files_deferred: skipFiles,
      nav_items: navItems,
      process_options: await readSharedProcessOptions(),
      recruiter_options: recruiterOptions,
      submission: rawSubmission || null,
    });
  } catch (error) {
    try { console.error('Safe candidate detail failure:', error); } catch {}
    return res.status(500).json({ message: 'Candidate profile could not be loaded safely. Please retry once.' });
  }
}


async function listNotesForCandidate(req, res) {
  const candidateId = String(req.params.candidateId || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'Candidate id is required' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
  if (!candidate || isDeletedCandidate(candidate)) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const requested = Math.max(1, Math.min(60, Number(req.query?.limit || 60) || 60));
  let rows = [];
  try {
    if (mode === 'postgres' && store.pool) {
      rows = await store.query(`select * from public.notes where candidate_id = $1 order by created_at desc limit ${requested}`, [candidateId]);
    } else {
      rows = (await table('notes')).filter((row) => String(row.candidate_id || '') === candidateId)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, requested);
    }
  } catch (error) {
    try { console.warn('Candidate notes fallback used:', error?.message || error); } catch {}
    rows = [];
  }
  return res.json({ ok: true, candidate_id: candidateId, items: mergeCandidateNotes(candidate, rows, requested) });
}

async function listFilesForCandidate(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate || isDeletedCandidate(candidate)) return res.status(404).json({message:'Candidate not found.'});
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({message:'Not allowed.'});
  return res.json({ok:true, files:await listCandidateFiles(candidate.candidate_id)});
}

async function logOpen(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item || isDeletedCandidate(item)) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const viewedBy = req.user.full_name || req.user.username || '';
  const existingSnapshot = getProfilePreviousViewSnapshot(req.user, req.params.candidateId);
  const previousView = existingSnapshot || putProfilePreviousViewSnapshot(req.user, req.params.candidateId, item);
  const lastViewedAt = Date.parse(item.last_viewed_at || '');
  const sameViewer = String(item.last_viewed_by_name || '').trim().toLowerCase() === String(viewedBy || '').trim().toLowerCase();
  if (sameViewer && Number.isFinite(lastViewedAt) && (Date.now() - lastViewedAt) < 90000) {
    return res.json({
      ok: true,
      skipped: true,
      last_viewed_at: previousView?.last_viewed_at || item.last_viewed_at || 'Never Opened',
      last_viewed_by_name: previousView?.last_viewed_by_name || item.last_viewed_by_name || '',
    });
  }
  const viewedAt = nowIso();
  await store.update('candidates', 'candidate_id', req.params.candidateId, {
    previous_last_viewed_at: String(item.last_viewed_at || ''),
    previous_last_viewed_by_name: String(item.last_viewed_by_name || ''),
    last_viewed_at: viewedAt,
    last_viewed_by_name: viewedBy,
  }).catch(async (error) => {
    // Older DB before CC26_779: keep last-view recording working even if the two new
    // compatibility columns have not been added yet. Startup/SQL will add them safely.
    try {
      await store.update('candidates', 'candidate_id', req.params.candidateId, {
        last_viewed_at: viewedAt,
        last_viewed_by_name: viewedBy,
      });
    } catch {}
  });
  // Do not clear candidate list caches on profile-open. It was causing list refresh storms and disappearing rows during heavy use.
  logActivity(req, req.params.candidateId, 'profile_opened', { full_name: item.full_name || '', section: 'candidate detail' }).catch(() => {});
  return res.json({
    ok: true,
    last_viewed_at: previousView?.last_viewed_at || 'Never Opened',
    last_viewed_by_name: previousView?.last_viewed_by_name || '',
    recorded_current_view_at: viewedAt,
  });
}

function sqlIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function archiveThenDeleteCandidateChildRows(tableName, candidateId, actor = {}) {
  const safeTables = new Set(['notes', 'submissions', 'candidate_jd_feedback', 'interviews', 'interview_remove_requests', 'revenue_hub_entries']);
  if (!safeTables.has(tableName)) return false;
  try {
    let matchingRows = [];
    if (mode === 'postgres' && store.pool) {
      matchingRows = await store.query(`select * from public.${sqlIdent(tableName)} where candidate_id = $1`, [candidateId]);
    } else {
      const rows = await table(tableName);
      matchingRows = (rows || []).filter((row) => String(row.candidate_id) === String(candidateId));
    }

    const resetAt = nowIso();
    for (const row of matchingRows) {
      await store.insert('candidate_reset_archive', {
        archive_id: makeFastId('RST'),
        candidate_id: String(candidateId),
        source_table: tableName,
        source_row_json: JSON.stringify(row || {}),
        reset_at: resetAt,
        reset_by_user_id: String(actor.user_id || actor.username || ''),
        reset_by_name: String(actor.full_name || actor.username || ''),
      });
    }

    if (mode === 'postgres' && store.pool) {
      await store.query(`delete from public.${sqlIdent(tableName)} where candidate_id = $1`, [candidateId]);
      return true;
    }
    if (store.state && Array.isArray(store.state[tableName])) {
      store.state[tableName] = store.state[tableName].filter((row) => String(row.candidate_id) !== String(candidateId));
      store.save?.();
      return true;
    }
    return Boolean(matchingRows?.length) && await store.deleteWhere(tableName, 'candidate_id', candidateId);
  } catch (error) {
    // Safety first: if archival fails, do not delete the source rows.
    try { console.warn(`Candidate reset archive/cleanup skipped for ${tableName}:`, error?.message || error); } catch {}
    return false;
  }
}

async function resetFilledDetails(req, res) {
  const candidateId = String(req.params.candidateId || '').trim();
  const existing = await store.findById('candidates', 'candidate_id', candidateId);
  if (!existing || isDeletedCandidate(existing)) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(existing, req.user)) return res.status(403).json({ message: 'Not allowed' });

  // CC26_683: Reset is a destructive user action, so stale tabs are never allowed
  // to reset a profile that somebody else has changed after this screen loaded.
  const clientUpdatedAt = String(req.body?._client_updated_at || '').trim();
  const serverUpdatedAt = String(existing.updated_at || '').trim();
  if (clientUpdatedAt && serverUpdatedAt && clientUpdatedAt !== serverUpdatedAt) {
    return res.status(409).json({
      message: 'This profile changed after you opened it. Refresh once before Reset Filled Details.',
      code: 'PROFILE_VERSION_CONFLICT',
      server_updated_at: serverUpdatedAt,
    });
  }

  const stamp = nowIso();
  const resetPayload = pickCandidateFields({
    ...existing,
    call_connected: '', looking_for_job: 'Yes', preferred_location: existing.preferred_location || '',
    qualification_level: normalizeQualificationCategory(existing.qualification_level || '', existing.qualification || ''),
    total_experience: '', relevant_experience: '', in_hand_salary: '', ctc_monthly: '', career_gap: 'Fresher',
    relevant_experience_range: '', relevant_in_hand_range: '', communication_skill: '',
    interview_reschedule_date: '', interview_date: '', interview_remove_request_id: '', interview_remove_status: '',
    interview_remove_reason: '', interview_remove_approved_at: '', process: '', notes: '', follow_up_at: '',
    follow_up_status: '', follow_up_note: '', status: 'Draft', approval_status: 'Draft', all_details_sent: 'Pending',
    submission_date: '', approval_requested_at: '', approved_at: '', approved_by_name: '', submitted_by: '',
    submission_id: '', has_submission: '0', updated_at: stamp,
  });

  const childTables = ['notes', 'submissions', 'candidate_jd_feedback', 'interviews', 'interview_remove_requests', 'revenue_hub_entries'];
  let updated = null;

  if (mode === 'postgres' && store.pool) {
    const columns = await getCandidateColumnSet().catch(() => new Set(PERSISTED_CANDIDATE_FIELDS));
    const safePayload = Object.fromEntries(Object.entries(resetPayload).filter(([key]) => columns.has(key)));
    const client = await store.pool.connect();
    try {
      await client.query('BEGIN');
      // Lock this one candidate row so reset + child cleanup is one atomic operation.
      const locked = await client.query('select updated_at from public.candidates where candidate_id = $1 for update', [candidateId]);
      const lockedUpdatedAt = String(locked.rows?.[0]?.updated_at || '').trim();
      if (clientUpdatedAt && lockedUpdatedAt && clientUpdatedAt !== lockedUpdatedAt) {
        const err = new Error('PROFILE_VERSION_CONFLICT'); err.code = 'PROFILE_VERSION_CONFLICT'; throw err;
      }

      for (const tableName of childTables) {
        const rows = await client.query(`select * from public.${sqlIdent(tableName)} where candidate_id = $1`, [candidateId]);
        for (const row of rows.rows || []) {
          await client.query(
            `insert into public.candidate_reset_archive
             (archive_id, candidate_id, source_table, source_row_json, reset_at, reset_by_user_id, reset_by_name)
             values ($1,$2,$3,$4,$5,$6,$7)`,
            [makeFastId('RST'), candidateId, tableName, JSON.stringify(row || {}), stamp,
             String(req.user?.user_id || req.user?.username || ''), String(req.user?.full_name || req.user?.username || '')],
          );
        }
      }

      const keys = Object.keys(safePayload);
      if (keys.length) {
        const vals = Object.values(safePayload);
        const setSql = keys.map((key, idx) => `${sqlIdent(key)} = $${idx + 1}`).join(', ');
        const response = await client.query(
          `update public.candidates set ${setSql} where candidate_id = $${keys.length + 1} returning *`,
          [...vals, candidateId],
        );
        updated = response.rows?.[0] || null;
      }

      // Delete only after every source row has been archived inside the SAME transaction.
      for (const tableName of childTables) {
        await client.query(`delete from public.${sqlIdent(tableName)} where candidate_id = $1`, [candidateId]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error?.code === 'PROFILE_VERSION_CONFLICT' || error?.message === 'PROFILE_VERSION_CONFLICT') {
        return res.status(409).json({ message: 'This profile changed after you opened it. Refresh once before resetting.', code: 'PROFILE_VERSION_CONFLICT' });
      }
      throw error;
    } finally {
      client.release();
    }
  } else {
    // LOCAL TEST JSON mode gets the same all-or-nothing behavior by keeping an
    // in-memory snapshot and restoring it if any write fails.
    const snapshot = JSON.parse(JSON.stringify(store.state || {}));
    try {
      updated = await store.update('candidates', 'candidate_id', candidateId, resetPayload);
      store.state.candidate_reset_archive ||= [];
      for (const tableName of childTables) {
        const rows = (store.state[tableName] || []).filter((row) => String(row.candidate_id) === candidateId);
        for (const row of rows) store.state.candidate_reset_archive.push({
          archive_id: makeFastId('RST'), candidate_id: candidateId, source_table: tableName,
          source_row_json: JSON.stringify(row || {}), reset_at: stamp,
          reset_by_user_id: String(req.user?.user_id || req.user?.username || ''),
          reset_by_name: String(req.user?.full_name || req.user?.username || ''),
        });
        store.state[tableName] = (store.state[tableName] || []).filter((row) => String(row.candidate_id) !== candidateId);
      }
      store.save?.();
    } catch (error) {
      store.state = snapshot; store.save?.(); throw error;
    }
  }

  await logActivity(req, candidateId, 'profile_reset', { archived_child_rows: true, atomic: true }).catch(() => {});
  invalidateCandidateCaches();
  const item = sanitizeCandidateForUser(enrichCandidate(submittedWorkflowResponseItem({ ...(updated || resetPayload), approval_status: 'Draft', status: 'Draft', all_details_sent: 'Pending', submission_date: '', interview_date: '', interview_reschedule_date: '', approval_requested_at: '', approved_at: '', approved_by_name: '', submitted_by: '', submission_exists: '0', submission_id: '', has_submission: '0', notes: '' }, null)), req.user);
  return res.json({ ok: true, item, notes: [], timeline: [], submission: null });
}

async function update(req, res) {
  const existing = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!existing) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(existing, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const clientUpdatedAt = String(req.body?._client_updated_at || '').trim();
  const serverUpdatedAt = String(existing?.updated_at || '').trim();
  const changedFieldList = Array.isArray(req.body?._changed_fields)
    ? req.body._changed_fields.map((field) => String(field || '').trim()).filter(Boolean)
    : [];
  const clientBaseValues = req.body?._client_base_values && typeof req.body._client_base_values === 'object' && !Array.isArray(req.body._client_base_values)
    ? req.body._client_base_values
    : {};
  if (clientUpdatedAt && serverUpdatedAt && clientUpdatedAt !== serverUpdatedAt) {
    if (changedFieldList.length) {
      const conflictFields = changedFieldList.filter((field) => String(existing?.[field] ?? '') !== String(clientBaseValues?.[field] ?? ''));
      if (conflictFields.length) {
        return res.status(409).json({
          message: `Newer update found in ${conflictFields.slice(0, 5).join(', ')}. Refresh profile before saving those fields.`,
          code: 'PROFILE_FIELD_CONFLICT',
          conflict_fields: conflictFields,
          server_updated_at: serverUpdatedAt,
        });
      }
    } else {
      return res.status(409).json({
        message: 'Newer update found on this profile. Refresh profile before saving to avoid overwriting someone else.',
        code: 'PROFILE_VERSION_CONFLICT',
        server_updated_at: serverUpdatedAt,
      });
    }
  }
  const dbPayload = { ...(req.body || {}) };
  for (const key of ['approval_status','approval_requested_at','approved_at','approved_by_name','submitted_by','created_by_user_id','created_by_name','user_id','recruiter_user_id','deleted_at','deleted_by','deleted_by_name','deleted_by_user_id']) delete dbPayload[key];
  if (['deleted','__deleted__','archived'].includes(lower(dbPayload.status))) return res.status(400).json({message:'Use the manager Delete action to archive a profile. Normal Save keeps the profile.'});
  delete dbPayload.jd_fit_summary;
  delete dbPayload.notes_list;
  delete dbPayload.timeline;
  delete dbPayload.nav_items;
  delete dbPayload.process_options;
  delete dbPayload._client_updated_at;
  delete dbPayload._changed_fields;
  delete dbPayload._client_base_values;
  if (changedFieldList.length) {
    for (const key of Object.keys(dbPayload)) {
      if (!changedFieldList.includes(key)) delete dbPayload[key];
    }
  }
  let normalized = normalizeCandidate(dbPayload, existing, req.user);
  // CC847: prevents C005/Anushka becoming Om while retaining old notes/approval.
  // Only immutable identity attributes are checked, not legitimate TL/project transfers.
  try { require('../lib/candidateIdentityGuard').assertCandidateIdentityStable(existing, normalized); }
  catch (identityError) { return res.status(identityError.status || 409).json({ message: identityError.message, code: identityError.code || 'CANDIDATE_IDENTITY_LOCKED', candidate_id: existing.candidate_id }); }
  normalized = await applyRecruiterAssignmentIfAllowed(normalized, dbPayload.recruiter_code, req.user);
  await require('../lib/collaborationAccess').validateAssignment(existing,normalized,req.user);
  const salaryFieldErrors = validateChangedSalaryFields(existing, normalized);
  if (salaryFieldErrors.length) return res.status(400).json({ message: salaryFieldErrors[0] });
  const requestedDetailsSent = lower(dbPayload.all_details_sent || '');
  if (requestedDetailsSent === 'completed' && lower(existing.all_details_sent || '') !== 'completed' && !detailsCompletedAllowedByTime({ ...existing, ...normalized })) {
    return res.status(400).json({ message: 'All Details Sent can be marked completed only 10 minutes after submission.' });
  }
  if (Object.prototype.hasOwnProperty.call(dbPayload, 'all_details_sent')) {
    normalized.all_details_sent = normalizeDetailsSentValue(normalized.all_details_sent, 'Pending');
    const nextReadyStatus = require('../lib/candidateDetailsStatus').statusAfterDetailsCompletion(existing, normalized.all_details_sent, normalized.status);
    if (nextReadyStatus) normalized.status = nextReadyStatus;
  }
  // CC26_685: when a fresh interview date is saved after an approved removal,
  // clear only the old removal markers. Otherwise the new interview can stay hidden
  // even though the canonical candidate row has a valid interview date.
  const incomingInterviewDate = String(dbPayload.interview_reschedule_date || dbPayload.interview_date || '').trim();
  if (incomingInterviewDate) {
    normalized.interview_remove_request_id = '';
    normalized.interview_remove_status = '';
    normalized.interview_remove_reason = '';
    normalized.interview_remove_approved_at = '';
  }
  const trackableFields = {
    full_name: 'Name',
    phone: 'Number',
    location: 'Location',
    qualification: 'Qualification',
    preferred_location: 'Preferred Location',
    qualification_level: 'Degree / Qualification',
    total_experience: 'Total Experience',
    relevant_experience: 'Relevant Experience',
    relevant_experience_range: 'Relevant Experience Range',
    ctc_monthly: 'CTC Monthly',
    in_hand_salary: 'In-hand Salary',
    relevant_in_hand_range: 'In-hand Salary Range',
    career_gap: 'Career Gap',
    documents_availability: 'Documents Availability',
    communication_skill: 'Communication Skill',
    call_connected: 'Call Connected',
    looking_for_job: 'Looking for Job',
    follow_up_at: 'Follow-up',
    follow_up_status: 'Follow-up Status',
    follow_up_note: 'Follow-up Note',
    interview_reschedule_date: 'Interview Date',
    virtual_onsite: 'Interview Mode',
    status: 'Status',
    all_details_sent: 'All Details Sent',
    submission_date: 'Submission Date',
    client: 'Client',
    process: 'Process',
    notes: 'Notes',
  };
  const changedFields = Object.entries(trackableFields)
    .filter(([field]) => String(existing[field] || '') !== String(normalized[field] || ''))
    .map(([, label]) => label);
  const detailSignalLabels = new Set([
    'Name','Number','Location','Qualification','Preferred Location','Degree / Qualification','Qualification Type','Total Experience','Relevant Experience',
    'Relevant Experience Range','CTC','CTC Monthly','In-hand Salary','In-hand Salary Range','Career Gap','Documents Availability','Communication Skill','Client','Process','Interview Date','Interview Mode','Follow-up','Follow-up Status','Follow-up Note','Notes'
  ]);
  const detailsTouched = changedFields.some((label) => detailSignalLabels.has(label));
  if (detailsTouched && lower(normalized.call_connected) !== 'yes') {
    normalized.call_connected = 'Yes';
    if (!changedFields.includes('Call Connected')) changedFields.push('Call Connected');
  }
  const callConnectedRaised = String(existing.call_connected || '').trim() !== String(normalized.call_connected || '').trim()
    && lower(normalized.call_connected) === 'yes';
  const notesChanged = String(existing.notes || '') !== String(normalized.notes || '');
  const item = await updateCandidateCompat(req.params.candidateId, normalized);
  if (String(existing.status||'').trim().toLowerCase()!==String(item?.status||'').trim().toLowerCase()) {
    await require('./revenueHubController').syncCandidateStatusToRevenue(req.params.candidateId,item.status);
  }
  const submissionDateChanged = String(existing.submission_date || '') !== String(item?.submission_date || '');
  if (submissionDateChanged) {
    await syncEffectiveSubmissionDate(req.params.candidateId, item?.submission_date || '');
  }
  invalidateCandidateCaches();
  logActivity(req, req.params.candidateId, 'profile_updated', {
    full_name: item.full_name || '',
    status: item.status || '',
    approval_status: item.approval_status || '',
    changed_fields: changedFields,
    change_count: changedFields.length,
  }).catch(() => {});
  if (detailsTouched) {
    const detailFields = changedFields.filter((label) => detailSignalLabels.has(label));
    logActivity(req, req.params.candidateId, 'details_saved', {
      full_name: item.full_name || '',
      status: item.status || '',
      detail_fields: detailFields,
      detail_field_count: detailFields.length,
    }).catch(() => {});
  }
  if (callConnectedRaised) {
    logActivity(req, req.params.candidateId, 'call_connected_marked', {
      full_name: item.full_name || '',
      phone: maskPhoneValue(item.phone || ''),
      source: 'candidate_update',
    }).catch(() => {});
  }
  if (notesChanged && String(item.notes || '').trim()) {
    logActivity(req, req.params.candidateId, 'note_added', {
      body: String(item.notes || '').trim().slice(0, 240),
      note_type: 'profile_notes',
      source: 'candidate_details_form',
    }).catch(() => {});
  }
  if (isLeadership(req.user) && existing.recruiter_code && existing.recruiter_code !== req.user.recruiter_code) {
    // Detailed notification is committed below, including old/new values.
  }
  await require('../lib/workflowNotifications').updated(existing,item,req.user);
  const includeFit = String(req.query.include_fit || req.body?.include_fit || '').trim() === '1' || req.body?.include_fit === true;
  if (includeFit) {
    const jdRows = await table('jd_master');
    return res.json({ item: sanitizeCandidateForUser(decorateCandidateWithFit(item, jdRows), req.user) });
  }
  return res.json({ item: candidateEditResponse(item, req.user) });
}

async function jdFit(req, res) {
  const item=await store.findById('candidates','candidate_id',req.params.candidateId);
  if (!item) return res.status(404).json({message:'Candidate not found'});
  if (!visibleCandidate(item,req.user)) return res.status(403).json({message:'Not allowed'});
  const jds=await table('jd_master');
  return res.json({item:sanitizeCandidateForUser(decorateCandidateWithFit(item,jds),req.user)});
}

function buildSubmissionBlockMessage(item) {
  const required = [
    ['full_name', 'Name'],
    ['phone', 'Number'],
    ['qualification', 'Qualification'],
    ['location', 'Location'],
    ['preferred_location', 'Preferred Location'],
    ['qualification_level', 'Degree'],
    ['total_experience', 'Total Experience'],
    ['relevant_experience', 'Relevant Experience'],
    ['in_hand_salary', 'In-hand Monthly'],
    ['ctc_monthly', 'CTC Monthly'],
    ['career_gap', 'Career Gap'],
    ['relevant_experience_range', 'Relevant Experience Range'],
    ['relevant_in_hand_range', 'Relevant In-hand Range'],
    ['communication_skill', 'Communication Skill'],
    ['interview_reschedule_date', 'Interview Date'],
    ['submission_date', 'Submission Date'],
    ['virtual_onsite', 'Interview Mode'],
    ['documents_availability', 'All Documents Availability'],
  ];
  const missingLabels = required
    .filter(([key]) => !String(item?.[key] || '').trim())
    .map(([, label]) => label);
  const lookingForJobBlocked = lower(item?.looking_for_job) !== 'yes';
  const callConnectedIssue = lower(item?.call_connected) !== 'yes' && (missingLabels.length || lookingForJobBlocked);
  const issues = [];
  if (lookingForJobBlocked) issues.push('Looking For Job is set to No. Save is allowed, but submit is blocked.');
  if (callConnectedIssue) issues.push(`Call Connected is still ${String(item?.call_connected || 'blank')}. Complete the connected-call step or finish the pending details before submit.`);
  if (missingLabels.length) issues.push(`Missing fields: ${missingLabels.join(', ')}`);
  return issues;
}

async function submissionNoteForCandidate(candidate) {
  const id = String(candidate.candidate_id || '');
  const rows = store.pool
    ? await store.query(`select id, body, username, created_at from public.notes where candidate_id = $1 and trim(coalesce(body,'')) <> '' order by created_at desc limit 1`, [id])
    : (await table('notes')).filter(row => String(row.candidate_id) === id && String(row.body || '').trim())
      .sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0,1);
  return rows[0] || (String(candidate.notes || '').trim() ? {body:String(candidate.notes).trim()} : null);
}

async function submitForApproval(req, res) {
  const existing = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!existing) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(existing, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const submissionNote = await submissionNoteForCandidate(existing);
  if (!submissionNote) return res.status(400).json({message:'Add a profile note before Save & Submit. Save can keep a draft without notes.',code:'NOTE_REQUIRED'});
  const latestSubmittedSubmission = await findLatestSubmittedSubmissionCompat(req.params.candidateId);
  const existingSubmission = lower(latestSubmittedSubmission?.approval_status) === 'pending' ? latestSubmittedSubmission : null;
  const candidateApprovalState = lower(existing.approval_status);
  const submissionApprovalState = lower(latestSubmittedSubmission?.approval_status || '');
  const alreadySubmitted = Boolean(latestSubmittedSubmission?.submission_id)
    && ['pending', 'approved'].includes(submissionApprovalState);

  if (alreadySubmitted) {
    return res.json({
      item: candidateEditResponse(existing, req.user, submittedWorkflowResponseItem({
        ...existing,
        status: candidateApprovalState === 'approved' ? (existing.status || 'Approved') : 'In - Progress',
        all_details_sent: candidateApprovalState === 'approved' ? (existing.all_details_sent || 'Pending') : 'Pending',
      }, latestSubmittedSubmission)),
      submission: latestSubmittedSubmission || null,
      already_pending: candidateApprovalState === 'pending' || submissionApprovalState === 'pending',
      already_submitted: true,
    });
  }
  const item = normalizeCandidate(req.body || {}, existing, req.user);
  const salaryFieldErrors = validateChangedSalaryFields(existing, item);
  if (salaryFieldErrors.length) return res.status(400).json({ message: salaryFieldErrors[0] });
  const submitIssues = buildSubmissionBlockMessage(item);
  if (submitIssues.length) {
    return res.status(400).json({ message: submitIssues.join(' • ') });
  }

  item.call_connected = 'Yes';

  const stamp = nowIso();
  // CC26_387: submitted_at is the actual submit event timestamp. The user-entered submission_date remains
  // persisted on candidates separately. Today's Submission uses the editable candidate submission_date as workflow source of truth, while submitted_at remains the immutable audit timestamp.
  const submissionStamp = stamp;
  const {readApprovalDelay,reminderSubmissionDueAt}=require('./reportController');
  await readApprovalDelay();
  const committedReminderDue=reminderSubmissionDueAt({approval_requested_at:stamp,submitted_at:stamp});
  item.approval_status = 'Pending';
  item.approval_requested_at = stamp;
  item.status = 'In - Progress';
  item.all_details_sent = 'Pending';
  item.submitted_by = req.user.full_name || req.user.username || '';
  item.approved_at = '';
  item.approved_by_name = '';

  // CC849: Submission is not an identity-edit operation. Previously the entire
  // normalized candidate was written back here; that could trigger CC847's
  // immutable-identity DB guard when unrelated fields were reformatted, and
  // could overwrite concurrent details. Write only the workflow delta.
  const workflowPatch = require('../lib/candidateWorkflowPatch').candidateSubmissionWorkflowPatch(item);
  const updated = await updateCandidateCompat(req.params.candidateId, workflowPatch);
  if (!updated) return res.status(404).json({ message: 'Candidate not found' });
  invalidateCandidateCaches();

  const submission = pickSubmissionCompatFields({
    submission_id: existingSubmission?.submission_id || makeFastId('S'),
    candidate_id: req.params.candidateId,
    jd_id: req.body?.jd_id || existingSubmission?.jd_id || '',
    recruiter_code: updated.recruiter_code || '',
    status: 'In - Progress',
    approval_status: 'Pending',
    decision_note: '',
    approval_requested_at: stamp,
    approved_by_name: '',
    approved_at: '',
    approval_rescheduled_at: '',
    submitted_at: submissionStamp,
    reminder_due_at: committedReminderDue,
    approval_reminder_at: committedReminderDue,
    effective_submission_at: updated.submission_date || submissionStamp,
    submitted_by_user_id: req.user.user_id || '',
    submitted_by_name: req.user.full_name || req.user.username || '',
    submitted_by_recruiter_code: req.user.recruiter_code || '',
    next_follow_up_at: existingSubmission?.next_follow_up_at || '',
    reminder_snoozed_until: '',
    reminder_note: '',
    updated_at: stamp,
  }, true);

  const savedSubmission = await saveSubmissionCompat(existingSubmission?.submission_id || '', submission);
  if (!savedSubmission?.submission_id) throw new Error('Database did not save the submission. Retry Save & Submit.');

  logActivity(req, req.params.candidateId, 'submitted_for_approval', {
    recruiter_name: updated.recruiter_name || '',
    process: updated.process || '',
  }).catch(() => {});
  incrementEmployeeDailyStat(req, 'submissions_count').catch(() => {});
  notifyLeaders(
    'New profile submitted',
    `${updated.full_name} submitted by ${updated.recruiter_name}.`,
    JSON.stringify({ candidate_id: updated.candidate_id, submission_id: submission.submission_id, open_path: `/candidate/${updated.candidate_id}`, section: 'submissions', submitted_by_user_id: req.user.user_id || '', submitted_by_role: userRole(req.user) }),
  ).catch(() => {});
  return res.json({ item: candidateEditResponse(updated, req.user, submittedWorkflowResponseItem(updated, savedSubmission)), submission: savedSubmission });
}

async function addNote(req, res) {
  const candidateId = String(req.params.candidateId || '').trim();
  const body = String(req.body.body || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'candidate_id is required' });
  if (!body) return res.status(400).json({ message: 'Note cannot be empty' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId);
  if (!candidate || !visibleCandidate(candidate, req.user)) return res.status(404).json({ message: 'Candidate not found' });
  const intent = String(req.body.client_note_key || '').trim();
  const stableId = intent ? parseInt(require('crypto').createHash('sha256').update(`${req.user.user_id || req.user.username}:${candidateId}:${intent}`).digest('hex').slice(0,13),16) : null;
  if (stableId) { const prior = await store.findById('notes','id',stableId); if (prior) { if (prior.body !== body) return res.status(409).json({ message:'Note key already used for different text' }); return res.json({ item:prior }); } }
  const stamp = nowIso();
  const item = {
    id: stableId || makeFastBigIntId(),
    candidate_id: candidateId,
    username: req.user.username,
    note_type: req.body.note_type || 'public',
    body,
    parent_note_id: normalizeOptionalBigIntLike(req.body.parent_note_id),
    reply_to_note_id: normalizeOptionalBigIntLike(req.body.reply_to_note_id),
    reply_to_username: String(req.body.reply_to_username || '').trim(),
    created_at: stamp,
    updated_at: stamp,
  };
  let saved = item;
  try {
    saved = await withSavepoint(() => store.insert('notes', item));
  } catch (error) {
    if (!isUndefinedColumnError(error, ['parent_note_id', 'reply_to_note_id', 'reply_to_username', 'updated_at'])) throw error;
    const legacyItem = { ...item };
    delete legacyItem.parent_note_id;
    delete legacyItem.reply_to_note_id;
    delete legacyItem.reply_to_username;
    delete legacyItem.updated_at;
    saved = await store.insert('notes', legacyItem);
  }
  if (lower(item.note_type) !== 'private') await store.update('candidates', 'candidate_id', candidateId, {notes:body, updated_at:stamp});
  invalidateCandidateCaches();
  logActivity(req, req.params.candidateId, 'note_added', {
    note_type: item.note_type,
    parent_note_id: item.parent_note_id || '',
    reply_to_note_id: item.reply_to_note_id || '',
  }).catch(() => {});
  await notifyNoteReply(req,saved||item);
  if(lower(item.note_type)!=='private'&&!item.reply_to_note_id&&!item.parent_note_id)await require('../lib/workflowNotifications').notify(candidate,req.user,(req.user.full_name||req.user.username)+' added a note',String(body).slice(0,500),{open_path:'/candidate/'+encodeURIComponent(candidateId)+'?jump=notes',note_id:item.id});
  return res.json({ item: saved || item });
}


async function addQuickNote(req, res) {
  const candidateId = String(req.body.candidate_id || '').trim();
  const body = String(req.body.body || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'candidate_id is required' });
  if (!body) return res.status(400).json({ message: 'Note cannot be empty' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId);
  if (!candidate || !visibleCandidate(candidate, req.user)) return res.status(404).json({ message: 'Candidate not found' });
  const intent = String(req.body.client_note_key || '').trim();
  const stableId = intent ? parseInt(require('crypto').createHash('sha256').update(`${req.user.user_id || req.user.username}:${candidateId}:${intent}`).digest('hex').slice(0,13),16) : null;
  if (stableId) { const prior = await store.findById('notes','id',stableId); if (prior) { if (prior.body !== body) return res.status(409).json({ message:'Note key already used for different text' }); return res.json({ item:prior }); } }
  const stamp = nowIso();
  const item = {
    id: stableId || makeFastBigIntId(),
    candidate_id: candidateId,
    username: req.user.username,
    note_type: req.body.note_type || 'public',
    body,
    parent_note_id: normalizeOptionalBigIntLike(req.body.parent_note_id),
    reply_to_note_id: normalizeOptionalBigIntLike(req.body.reply_to_note_id),
    reply_to_username: String(req.body.reply_to_username || '').trim(),
    created_at: stamp,
    updated_at: stamp,
  };
  let saved = item;
  try {
    saved = await store.insert('notes', item);
  } catch (error) {
    if (!isUndefinedColumnError(error, ['parent_note_id', 'reply_to_note_id', 'reply_to_username', 'updated_at'])) throw error;
    const legacyItem = { ...item };
    delete legacyItem.parent_note_id;
    delete legacyItem.reply_to_note_id;
    delete legacyItem.reply_to_username;
    delete legacyItem.updated_at;
    saved = await store.insert('notes', legacyItem);
  }
  await store.update('candidates', 'candidate_id', candidateId, { updated_at: nowIso() });
  invalidateCandidateCaches();
  logActivity(req, candidateId, 'note_added', {
    note_type: item.note_type,
    parent_note_id: item.parent_note_id || '',
    reply_to_note_id: item.reply_to_note_id || '',
  }).catch(() => {});
  await notifyNoteReply(req,saved||item);
  if(lower(item.note_type)!=='private'&&!item.reply_to_note_id&&!item.parent_note_id)await require('../lib/workflowNotifications').notify(candidate,req.user,(req.user.full_name||req.user.username)+' added a note',String(body).slice(0,500),{open_path:'/candidate/'+encodeURIComponent(candidateId)+'?jump=notes',note_id:item.id});
  return res.json({ item: saved || item });
}


async function contactAccess(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const clean = normalizeIndianPhone(item.phone || '');
  if (!clean) return res.status(404).json({ message: 'Phone not available' });
  const channel = String(req.query?.channel || req.body?.channel || 'view').trim().toLowerCase() || 'view';
  logActivity(req, item.candidate_id, 'contact_revealed', { channel, phone: maskPhoneValue(clean) }).catch(() => {});
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  return res.json({ phone: clean, phone_masked: maskPhoneValue(clean), channel });
}

async function logCall(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const callSource = String(req.body?.source || req.query?.source || '').trim().toLowerCase();
  if (callSource === 'mobile_app_command_only') {
    // CC26.136: old cached browsers may still ping this legacy endpoint after /api/dialer/manual-call.
    // Do not create a second call log or increment dial/profile counters. Android app is the only source.
    return res.json({ ok: true, ignored: true, reason: 'mobile_app_command_already_counted_by_calling_assistant' });
  }
  await store.update('candidates', 'candidate_id', req.params.candidateId, {
    last_dialed_at: nowIso(),
    last_dialed_by_name: req.user.full_name || req.user.username || '',
    dial_attempt_count: String((Number(item.dial_attempt_count || 0) || 0) + 1),
  });
  invalidateCandidateCaches();
  const presence = await store.findById('presence', 'user_id', req.user.user_id);
  if (presence) {
    await store.update('presence', 'user_id', req.user.user_id, {
      last_call_dial_at: nowIso(),
      last_call_candidate_id: item.candidate_id,
      last_seen_at: nowIso(),
      locked: '0',
    });
  }
  logActivity(req, item.candidate_id, 'call_logged', { phone: maskPhoneValue(item.phone || '') }).catch(() => {});
  try {
    const phone = normalizeIndianPhone(item.phone || '');
    if (phone) {
      const savedCall = await store.insert('call_logs', {
        call_log_id: makeFastId('CL'), session_id: '', queue_item_id: '', candidate_id: item.candidate_id, candidate_name: item.full_name || item.name || '', phone,
        employee_user_id: req.user.user_id || '', employee_username: req.user.username || '', employee_name: req.user.full_name || req.user.username || '',
        direction: 'Outgoing', status: 'Dialed', call_started_at: nowIso(), call_ended_at: nowIso(), duration_seconds: 0, talktime_seconds: 0, idle_seconds: 0,
        notes: 'CRM call button clicked', call_source: 'crm_candidate_button', source_mode: 'crm_candidate_button', synced_from: 'crm', stats_counted: '1', created_at: nowIso(), updated_at: nowIso()
      });
      if (savedCall) bumpCallChange('crm_candidate_call_log_insert');
    }
  } catch {}
  incrementEmployeeDailyStat(req, 'calls_count').catch(() => {});
  incrementEmployeeDailyStat(req, 'outgoing_calls_count').catch(() => {});
  return res.json({ ok: true });
}

async function whatsapp(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).send('Not found');
  if (!visibleCandidate(item, req.user)) return res.status(403).send('Not allowed');
  const text = String(req.query.text || '').trim();
  const clean = normalizeIndianPhone(item.phone || '');
  if (!clean) return res.status(400).send('Phone not available');
  const base = `https://wa.me/91${clean}`;
  logActivity(req, item.candidate_id, 'whatsapp_opened', { phone: maskPhoneValue(clean), redirect: true, text }).catch(() => {});
  incrementEmployeeDailyStat(req, 'whatsapp_count').catch(() => {});
  return res.redirect(text ? `${base}?text=${encodeURIComponent(text)}` : base);
}

async function whatsappLog(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
  logActivity(req, item.candidate_id, 'whatsapp_opened', { phone: maskPhoneValue(item.phone || ''), text: String(req.body?.text || '').trim() }).catch(() => {});
  incrementEmployeeDailyStat(req, 'whatsapp_count').catch(() => {});
  return res.json({ ok: true });
}

async function followupNextReminder(req, res) {
  const now = Date.now();
  const triggerUntil = reminderTriggerNowMs(now);
  const exclude = new Set(String(req.query.exclude || '').split(',').map((value) => String(value || '').trim()).filter(Boolean));
  let notes=[],candidates;
  if(store.pool){
    const scope=candidateScopeSql('c',req.user,[]),own=candidateOwnerSql('c',{...req.user,role:'recruiter',designation:'Recruiter',__ccSharedScopes:[],__ccSoloPeers:{}},scope.params);
    const params=[...own.params,[...exclude],new Date(triggerUntil).toISOString()];
    candidates=await store.query(`select c.* from public.candidates c where ${scope.sql} and not(c.candidate_id=any($${params.length-1}::text[])) and lower(coalesce(c.follow_up_status,''))<>'done' and public.crm_safe_instant(c.follow_up_at)<=$${params.length}::timestamptz order by (${own.sql}) desc,public.crm_safe_instant(c.follow_up_at) asc limit 1`,params);
    if(candidates.length)notes=await store.query('select id,candidate_id,body,note_type,created_at,username from public.notes where candidate_id=$1 order by created_at desc limit 3',[candidates[0].candidate_id]);
  }else{candidates=await table('candidates');notes=await table('notes').catch(()=>[]);}
  const next = candidates
    .filter((row) => visibleCandidate(row, req.user))
    .filter((row) => !exclude.has(String(row.candidate_id || '').trim()))
    .filter((row) => String(row.follow_up_at || '').trim())
    .filter((row) => String(row.follow_up_status || '').toLowerCase() !== 'done')
    .map((row) => {
      const dueAt = bucketPolicy.instantMs(row.follow_up_at) || 0;
      const lastNote = latestCandidateNote(row, notes);
      return {
        ...row,
        due_in_minutes: dueInMinutes(row.follow_up_at, now),
        reminder_buffer_minutes: 20,
        is_due: dueAt ? dueAt <= now : false,
        is_today: dueAt ? isTodayIst(dueAt) : false,
        dueAt,
        last_note: lastNote,
        last_notes: lastNote,
      };
    })
    .filter((row) => row.dueAt && row.dueAt <= triggerUntil)
    .sort((a, b) => {
      const role = userRole(req.user);
      if (role === 'manager' || role === 'tl') {
        const personal = Number(candidateBelongsToUser(b, req.user)) - Number(candidateBelongsToUser(a, req.user));
        if (personal) return personal;
      }
      return a.dueAt - b.dueAt;
    })[0] || null;
  if (next && next.dueAt <= now) await maybeCreateFollowupDueNotification(req, next, next.last_note || next.last_notes || '');
  return res.json({ item: next ? sanitizeCandidateForUser(next, req.user) : null });
}

async function followupUpcoming(req, res) {
  const now = Date.now();
  let candidates = [];

  if (mode === 'postgres' && store.pool) {
    try {
      const columns = await getCandidateColumnSet();
      const selectSql = candidateSelectForColumns(columns);
      const params = [];
      const scoped = candidateScopeSql('', req.user, params);
      candidates=await require('../lib/versionedList').versionedList({key:JSON.stringify(['followups',req.user.user_id,req.user.__ccAccessRevision]),select:selectSql,from:'public.candidates',where:scoped.sql+" and coalesce(follow_up_at,'')<>''"+(req.query?.include_completed==='1'?'':" and lower(coalesce(follow_up_status,''))<>'done'"),params:scoped.params,idExpr:'candidates.candidate_id',version:"coalesce(nullif(updated_at,''),created_at,'')"});
    } catch (error) {
      // Production safety: do not replace a targeted follow-up query with a
      // full candidate-table read. Keep existing UI state and let Manual Refresh retry.
      try { console.error('Follow-up list query failed safely:', error?.message || error); } catch {}
      return res.status(503).json({ message: 'Follow-ups could not be loaded safely. Use Manual Refresh once.' });
    }
  } else {
    candidates = (await table('candidates'))
      .filter((row) => visibleCandidate(row, req.user))
      .filter((row) => String(row.follow_up_at || '').trim())
      .filter((row) => req.query?.include_completed === '1' || lower(row.follow_up_status || '') !== 'done');
  }

  candidates=candidates.filter(row=>visibleCandidateForUser(row,req.user));
  const candidateIds = candidates.map((row) => String(row.candidate_id || '').trim()).filter(Boolean);
  let notes = [];
  if (candidateIds.length) {
    if (mode === 'postgres' && store.pool) {
      try {
        notes = await store.query(
          `select distinct on (candidate_id) candidate_id, body, created_at
           from public.notes
           where candidate_id = any($1::text[])
           order by candidate_id, created_at desc`,
          [candidateIds],
        );
      } catch { notes = []; }
    } else {
      const idSet = new Set(candidateIds);
      notes = (await table('notes').catch(() => [])).filter((row) => idSet.has(String(row.candidate_id || '').trim()));
    }
  }

  const items = candidates
    .map((row) => {
      const dueAt = new Date(row.follow_up_at || 0).getTime() || 0;
      const lastNote = latestCandidateNote(row, notes);
      return {
        ...row,
        due_in_minutes: dueAt ? Math.round((dueAt - now) / 60000) : '',
        is_due: dueAt ? dueAt <= now : false,
        is_today: dueAt ? isTodayIst(dueAt) : false,
        last_note: lastNote,
        last_notes: lastNote,
      };
    })
    .sort((a, b) => String(a.follow_up_at || '').localeCompare(String(b.follow_up_at || '')) || String(a.candidate_id || '').localeCompare(String(b.candidate_id || '')));

  return res.json({ items: sanitizeCandidateListForUser(items, req.user) });
}

async function followupAction(req, res) {
  const candidateId = String(req.body?.candidate_id || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'candidate_id required' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const nextFollowUpAt = String(req.body?.follow_up_at || '').trim();
  const nextStatus = String(req.body?.follow_up_status || 'Done').trim() || 'Done';
  const item = await store.update('candidates', 'candidate_id', candidateId, {
    follow_up_status: nextStatus,
    follow_up_note: req.body?.follow_up_note || '',
    follow_up_at: nextFollowUpAt || candidate.follow_up_at || '',
    follow_up_completed_at: lower(nextStatus)==='done' ? nowIso() : '',
    updated_at: nowIso(),
  });
  logActivity(req, candidateId, 'follow_up_updated', {
    follow_up_status: nextStatus,
    follow_up_note: req.body?.follow_up_note || '',
    follow_up_at: nextFollowUpAt || '',
  }).catch(() => {});
  return res.json({ item: sanitizeCandidateForUser(item, req.user) });
}


async function requestInterviewDateRemoval(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ message: 'Reason required' });
  const requestId = makeFastId('IR');
  const item = {
    request_id: requestId,
    candidate_id: candidate.candidate_id,
    current_interview_date: candidate.interview_reschedule_date || '',
    reason,
    status: 'Pending',
    requested_by_user_id: req.user.user_id || '',
    requested_by_name: req.user.full_name || req.user.username || '',
    approved_by_user_id: '',
    approved_by_name: '',
    approved_at: '',
    requested_at: nowIso(),
    created_at: nowIso(),
  };
  await store.insert('interview_remove_requests', item);
  await store.update('candidates', 'candidate_id', candidate.candidate_id, {
    interview_remove_request_id: requestId,
    interview_remove_status: 'Pending',
    interview_remove_reason: reason,
    updated_at: nowIso(),
  });
  await logActivity(req, candidate.candidate_id, 'interview_date_removal_requested', { reason, request_id: requestId, current_interview_date: candidate.interview_reschedule_date || '' });
  await notifyLeaders('Interview date removal requested', `${candidate.full_name} interview date removal requested by ${req.user.full_name || req.user.username}.`, JSON.stringify({ candidate_id: candidate.candidate_id, request_id: requestId, open_path: `/candidate/${candidate.candidate_id}` }));
  return res.json({ ok: true, request_id: requestId });
}

async function removeInterviewDate(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Leadership access only' });
  await store.update('candidates', 'candidate_id', candidate.candidate_id, {
    interview_reschedule_date: '',
    follow_up_at: '',
    interview_remove_status: 'Approved',
    interview_remove_reason: '',
    interview_remove_approved_at: nowIso(),
    updated_at: nowIso(),
  });
  await logActivity(req, candidate.candidate_id, 'interview_date_removed', { removed_by: req.user.full_name || req.user.username || '', direct: true });
  return res.json({ ok: true });
}

async function bulkUpdate(req, res) {
  const candidateIds = Array.isArray(req.body?.candidate_ids) ? req.body.candidate_ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (!candidateIds.length) return res.status(400).json({ message: 'candidate_ids required' });
  if (candidateIds.length>500) return res.status(400).json({message:'Select at most 500 profiles per batch.'});
  const rows = store.pool ? await store.query('select * from candidates where candidate_id=any($1::text[])',[candidateIds]) : await table('candidates');
  const visibleRows = rows.filter((row) => candidateIds.includes(String(row.candidate_id)) && visibleCandidate(row, req.user));
  if (!visibleRows.length) return res.status(404).json({ message: 'No visible candidates found for bulk update' });
  const updates = {};
  if (String(req.body?.status || '').trim()) updates.status = String(req.body.status).trim();
  if (String(req.body?.follow_up_at || '').trim()) updates.follow_up_at = String(req.body.follow_up_at).trim();
  if (String(req.body?.process || '').trim()) updates.process = String(req.body.process).trim();
  if (String(req.body?.all_details_sent || '').trim()) updates.all_details_sent = String(req.body.all_details_sent).trim();
  if (String(req.body?.documents_availability || '').trim()) updates.documents_availability = String(req.body.documents_availability).trim();
  const assignRecruiterCode = String(req.body?.recruiter_code || '').trim();
  const assignRecruiterName = String(req.body?.recruiter_name || '').trim();
  let assignmentTarget=null;
  if(assignRecruiterCode){
    if(!isLeadership(req.user))return res.status(403).json({message:'Team leader access required to reassign profiles.'});
    assignmentTarget=store.pool?await store.one('select user_id,full_name,username,recruiter_code,designation,role from public.users where lower(recruiter_code)=lower($1) limit 1',[assignRecruiterCode]):(await table('users')).find(u=>lower(u.recruiter_code)===lower(assignRecruiterCode));
    if(!assignmentTarget)return res.status(400).json({message:'Choose a current team member.'});
    if(userRole(req.user)==='tl'&&!candidateBelongsToTeam({recruiter_user_id:assignmentTarget.user_id,recruiter_code:assignmentTarget.recruiter_code,recruiter_name:assignmentTarget.full_name},req.user))return res.status(403).json({message:'Choose a recruiter from your team.'});
  }
  const note = String(req.body?.note || '').trim();
  let changed = 0;
  // Bulk Complete follows the same time-lock as individual Save.
  if (lower(updates.all_details_sent || '')==='completed' && visibleRows.some(row =>
    lower(row.all_details_sent || '')!=='completed' && !detailsCompletedAllowedByTime(row))) {
    return res.status(400).json({message:'All Details Sent can be marked completed only 10 minutes after submission. No profiles changed.'});
  }
  for (const row of visibleRows) {
    const next = normalizeCandidate({ ...row, ...updates }, row, req.user);
    const nextReadyStatus = require('../lib/candidateDetailsStatus').statusAfterDetailsCompletion(row, updates.all_details_sent, next.status);
    if (nextReadyStatus) next.status = nextReadyStatus;
    if (assignRecruiterCode && isLeadership(req.user)) {
      next.recruiter_code=assignmentTarget.recruiter_code;next.recruiter_user_id=assignmentTarget.user_id;
      next.recruiter_name=assignmentTarget.full_name||assignmentTarget.username;next.recruiter_designation=assignmentTarget.designation||assignmentTarget.role;
    }
    next.updated_at = nowIso();
    await store.update('candidates', 'candidate_id', row.candidate_id, next);
    invalidateCandidateCaches();
    if (note) {
      await store.insert('notes', { id: makeFastBigIntId(), candidate_id: row.candidate_id, username: req.user.username, note_type: 'bulk', body: note, created_at: nowIso() });
      await logActivity(req, row.candidate_id, 'note_added', { body: note, note_type: 'bulk' });
    }
    await logActivity(req, row.candidate_id, 'profile_updated', { bulk: true, changed_keys: Object.keys(updates) });
    changed += 1;
  }
  return res.json({ ok: true, changed, affected_owners:visibleRows.map(row=>({candidate_id:row.candidate_id,recruiter_user_id:row.recruiter_user_id,recruiter_code:row.recruiter_code,recruiter_name:row.recruiter_name})),items:visibleRows.map(row=>({...row,...updates,...(assignRecruiterCode&&isLeadership(req.user)?{recruiter_code:assignmentTarget.recruiter_code,recruiter_name:assignmentTarget.full_name||assignmentTarget.username,recruiter_user_id:assignmentTarget.user_id}:{})})).map(row=>({candidate_id:row.candidate_id,recruiter_code:row.recruiter_code,recruiter_name:row.recruiter_name})) });
}

async function recoveryBucket(req, res) {
  const rows = collapseLogicalDuplicateRows((await table('candidates')).filter((row) => visibleCandidate(row, req.user)), { preferInterview: false });
  const lost = rows.filter(candidateIsLostLead).map(decorateLostLead).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const groups = {};
  for (const row of lost) {
    const key = row.recovery_bucket || 'Recovery pool';
    groups[key] ||= [];
    if (groups[key].length < 12) groups[key].push(row);
  }
  return res.json({
    total: lost.length,
    buckets: Object.entries(groups).map(([name, items]) => ({ name, count: lost.filter((row) => row.recovery_bucket === name).length, items })),
  });
}

async function reviveLostLead(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const note = String(req.body?.note || 'Recovered from lost leads bucket').trim();
  const item = await store.update('candidates', 'candidate_id', req.params.candidateId, {
    status: 'Draft',
    approval_status: 'Draft',
    looking_for_job: 'Yes',
    follow_up_status: 'Open',
    updated_at: nowIso(),
  });
  await store.insert('notes', { id: makeFastBigIntId(), candidate_id: req.params.candidateId, username: req.user.username, note_type: 'recovery', body: note, created_at: nowIso() });
  await logActivity(req, req.params.candidateId, 'profile_updated', { recovery: true, note });
  return res.json({ item: sanitizeCandidateForUser(item, req.user) });
}


function bucketTargetRole(user) {
  const roleValue = lower(user?.role || user?.designation || '');
  if (roleValue.includes('admin')) return 'admin';
  if (roleValue === 'tl' || roleValue.includes('team lead') || roleValue.includes('teamlead')) return 'tl';
  if (roleValue.includes('manager')) return 'manager';
  if (roleValue.includes('recruit')) return 'recruiter';
  return '';
}

function bucketTargetId(user) {
  return String(user?.user_id || user?.id || user?.username || user?.recruiter_code || '').trim();
}

async function reassignTargets(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Leadership access only' });
  const users = await table('users');
  const seen = new Set();
  const teamIds = new Set([req.user.user_id, ...(req.user.__ccTeamUserIds || []), ...(req.user.__ccSharedScopes||[]).flatMap(s=>s.ids)].map(String));
  const teamCodes = new Set([req.user.recruiter_code, ...(req.user.__ccTeamCodes || [])].map(lower).filter(Boolean));
  const items = users
    .filter(user => isAdminOrManager(req.user) || teamIds.has(String(user.user_id)) || teamCodes.has(lower(user.recruiter_code)))
    .filter(user => !['0','false','inactive','deleted'].includes(lower(user.is_active || user.status)))
    .map((user) => {
      const userId = bucketTargetId(user);
      const role = bucketTargetRole(user);
      if (!userId || !role) return null;
      const fullName = String(user.full_name || user.username || user.recruiter_code || userId).trim();
      const recruiterCode = String(user.recruiter_code || '').trim();
      const key = `${userId}__${role}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        user_id: userId,
        username: String(user.username || '').trim(),
        full_name: fullName,
        role,
        recruiter_code: recruiterCode,
        designation: String(user.designation || user.role || '').trim(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  return res.json({ items });
}



function duplicateCacheKey(req, view = 'duplicates') {
  return [
    view,
    req.user?.user_id || 'anon',
    req.user?.role || '',
    req.user?.recruiter_code || '',
    req.user?.full_name || '',
  ].map((value) => String(value || '').trim()).join(':');
}

function buildDuplicateSummary(grouped) {
  const rows = grouped.rows || [];
  return {
    totalGroups: Number(grouped.groups?.length || 0),
    totalRows: Number(rows.length || 0),
    autoRows: rows.filter((row) => String(row.auto_select_unfilled_duplicate || '0') === '1').length,
    keepRows: rows.filter((row) => String(row.duplicate_is_main || row.duplicate_recommended_keep || '0') === '1').length,
  };
}

function buildDeletedSummary(rows) {
  return {
    totalGroups: 0,
    totalRows: Number(rows.length || 0),
    autoRows: 0,
    keepRows: 0,
  };
}

function qcol(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function candidateReviewRowsForUser(req, options = {}) {
  const includeDeleted = options.includeDeleted === true;
  if (mode === 'postgres' && store.pool) {
    try {
      const columns = await getCandidateColumnSet();
      const fields = PERSISTED_CANDIDATE_FIELDS.filter((field) => columns.has(field));
      const selectSql = fields.length ? fields.map(qcol).join(', ') : '*';
      const params = [];
      const clauses = [];
      if (includeDeleted) {
        const deletedParts = [];
        if (columns.has('deleted_at')) deletedParts.push(`coalesce(trim(to_jsonb(candidates)->>'deleted_at'), '') <> ''`);
        if (columns.has('status')) deletedParts.push(`lower(trim(coalesce(status, ''))) in ('deleted', '__deleted__', 'archived')`);
        if (columns.has('approval_status')) deletedParts.push(`lower(trim(coalesce(approval_status, ''))) in ('deleted', '__deleted__', 'archived')`);
        if (columns.has('all_details_sent')) deletedParts.push(`lower(trim(coalesce(all_details_sent, ''))) in ('deleted', '__deleted__', 'archived')`);
        if (columns.has('data_notes')) deletedParts.push(`lower(coalesce(data_notes, '')) like '%[crm-deleted]%'`);
        clauses.push(`(${deletedParts.length ? deletedParts.join(' or ') : '1 = 0'})`);
      } else {
        if (columns.has('deleted_at')) clauses.push(`coalesce(trim(to_jsonb(candidates)->>'deleted_at'), '') = ''`);
        if (columns.has('status')) clauses.push(`lower(trim(coalesce(status, ''))) not in ('deleted', '__deleted__', 'archived')`);
        if (columns.has('approval_status')) clauses.push(`lower(trim(coalesce(approval_status, ''))) not in ('deleted', '__deleted__', 'archived')`);
        if (columns.has('all_details_sent')) clauses.push(`lower(trim(coalesce(all_details_sent, ''))) not in ('deleted', '__deleted__', 'archived')`);
        if (columns.has('data_notes')) clauses.push(`lower(coalesce(data_notes, '')) not like '%[crm-deleted]%'`);
      }
      if (!['admin', 'manager', 'tl'].includes(String(req.user?.role || '').toLowerCase())) {
        const scopeParts = [];
        if (columns.has('recruiter_name')) {
          params.push(String(req.user?.full_name || '').trim().toLowerCase());
          scopeParts.push(`lower(coalesce(recruiter_name, '')) = $${params.length}`);
        }
        if (columns.has('recruiter_code')) {
          params.push(String(req.user?.recruiter_code || '').trim().toLowerCase());
          scopeParts.push(`lower(coalesce(recruiter_code, '')) = $${params.length}`);
        }
        clauses.push(scopeParts.length ? `(${scopeParts.join(' or ')})` : '1 = 0');
      }
      const orderField = fields.includes('updated_at') ? 'updated_at' : (fields.includes('created_at') ? 'created_at' : 'candidate_id');
      const sql = `select ${selectSql} from public.candidates where ${clauses.length ? clauses.join(' and ') : '1 = 1'} order by coalesce(to_jsonb(candidates)->>'${orderField}', '') desc limit ${includeDeleted ? 8000 : 8000}`;
      return (await store.query(sql, params)).map((row) => enrichCandidate(row));
    } catch {}
  }
  return (await table('candidates')).map((row) => enrichCandidate(row));
}

async function listDuplicateReviewGroups(req, res) {
  const cacheKey = duplicateCacheKey(req, 'duplicates');
  const cached = req.query?.refresh ? null : duplicateReviewCache.get(cacheKey);
  res.set?.('Cache-Control','no-store');
  if (cached) return res.json(cached);
  const rows = (await candidateReviewRowsForUser(req, { includeDeleted: false }))
    .filter((row) => visibleCandidate(row, req.user));
  const grouped = buildDuplicateReviewGroups(rows);
  const payload = {
    items: grouped.rows,
    groups: grouped.groups,
    total_groups: grouped.groups.length,
    total_profiles: grouped.rows.length,
    summary: buildDuplicateSummary(grouped),
  };
  duplicateReviewCache.set(cacheKey, payload);
  return res.json(payload);
}

// CC865: metadata lives with the archived row. No schema migration is needed.
function readDeletionMeta(row={}) {
 const hit=String(row.data_notes||'').match(/\[CRM-DELETE-META:([A-Za-z0-9+/=]+)\]/);
 if(!hit)return {};
 try{const value=JSON.parse(Buffer.from(hit[1],'base64').toString('utf8'));return value&&typeof value==='object'?value:{};}catch{return {};}
}
function deletionReviewRow(row={}) {
 const meta=readDeletionMeta(row);
 return {...row,delete_reason:meta.reason||'',deleted_at:row.deleted_at||meta.at||row.updated_at||'',deleted_by:row.deleted_by||meta.by||''};
}
function deletionNotes(row,reason,at,by) {
 const meta={reason,at,by,status:row.status||'Draft',approval_status:row.approval_status||'Draft',all_details_sent:row.all_details_sent??''};
 const marker='[CRM-DELETE-META:'+Buffer.from(JSON.stringify(meta),'utf8').toString('base64')+']';
 return [String(row.data_notes||'').trim(),'[CRM-DELETED] '+at+' by '+by,marker].filter(Boolean).join(' | ');
}
function deleteReason(req) {
 const reason=String(req.body?.reason||'').trim();
 if(reason.length<3||reason.length>1000)throw Object.assign(new Error('Enter a delete reason between 3 and 1,000 characters. No profile was removed.'),{status:400,code:'DELETE_REASON_REQUIRED'});
 return reason;
}
function removeDeletedNotesMarker(value) {
  return String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !lower(part).includes('[crm-deleted]') && !part.includes('[CRM-DELETE-META:'))
    .join(' | ');
}

async function listDeletedProfiles(req, res) {
  if (!canDeleteCandidate(req.user)) return res.status(403).json({ message: 'Only managers can view deleted profiles' });
  const cacheKey = duplicateCacheKey(req, 'deleted');
  const cached = req.query?.refresh ? null : duplicateReviewCache.get(cacheKey);
  res.set?.('Cache-Control','no-store');
  if (cached) return res.json(cached);
  const rows = (await candidateReviewRowsForUser(req, { includeDeleted: true }))
    .filter((row) => isDeletedCandidate(row))
    .map(deletionReviewRow)
    .sort((a, b) => String(b.deleted_at || b.updated_at || '').localeCompare(String(a.deleted_at || a.updated_at || '')) || String(b.candidate_id || '').localeCompare(String(a.candidate_id || '')))
    .slice(0, 8000);
  const payload = {
    items: sanitizeCandidateListForUser(rows, req.user),
    total: rows.length,
    summary: buildDeletedSummary(rows),
  };
  duplicateReviewCache.set(cacheKey, payload);
  return res.json(payload);
}

async function restoreCandidate(req, res) {
  if (!canDeleteCandidate(req.user)) return res.status(403).json({ message: 'Only managers can restore profiles' });
  const candidateId = String(req.params.candidateId || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'Candidate id is required' });
  const existing = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
  if (!existing) return res.status(404).json({ message: 'Deleted profile not found' });
  if (!isDeletedCandidate(existing)) return res.status(400).json({ message: 'Profile is already active' });
  const restoredAt = nowIso(),meta=readDeletionMeta(existing);
  const activeValue=(value,fallback)=>['deleted','__deleted__','archived'].includes(lower(value))?fallback:String(value??fallback);
  const updates = {
    status: activeValue(meta.status,'Draft'),
    approval_status: activeValue(meta.approval_status,'Draft'),
    all_details_sent: activeValue(meta.all_details_sent,''),
    deleted_at: '',
    deleted_by: '',
    data_notes: removeDeletedNotesMarker(existing.data_notes || ''),
    updated_at: restoredAt,
  };
  let item = null;
  if (store.pool) {
    const columns = await getCandidateColumnSet().catch(() => new Set(PERSISTED_CANDIDATE_FIELDS));
    const safeUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (columns.has(key)) safeUpdates[key] = value;
    }
    item = await store.update('candidates', 'candidate_id', candidateId, safeUpdates);
  } else {
    item = await store.update('candidates', 'candidate_id', candidateId, updates);
  }
  if(!item||isDeletedCandidate(item))throw Object.assign(new Error('Restore was not confirmed. The profile remains in Deleted Profiles.'),{status:409});
  invalidateCandidateCaches();
  clearAllCaches(['candidates','reminders','reports','revenue']);
  logActivity(req, candidateId, 'profile_restored', { restored_by: req.user.full_name || req.user.username || '' }).catch(() => {});
  return res.json({ ok: true, item: sanitizeCandidateForUser(enrichCandidate(item), req.user) });
}

async function hardDeleteCandidateGraph(candidateId) {
  // CC26.211 safety: physical candidate removal is disabled.
  // Profiles may only be hidden/restored through the existing soft-hide flow.
  throw new Error('Hard delete is disabled. Use soft-hide only.');
}

async function softHideCandidate(candidateId, reqUser, reason) {
  const markedAt = nowIso();
  const markedBy = String(reqUser?.full_name || reqUser?.username || '').trim();
  const existing = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
  const nextNotes = deletionNotes(existing||{},reason,markedAt,markedBy);

  const payload = { updated_at: markedAt, status: '__deleted__', approval_status: '__deleted__', all_details_sent: 'Deleted' };

  if (store.pool) {
    const columns = await getCandidateColumnSet().catch(() => new Set());
    const safePayload = {};
    for (const [key, value] of Object.entries({
      ...payload,
      deleted_at: markedAt,
      deleted_by: markedBy,
      duplicate_main_choice: '',
      duplicate_main_marked_at: '',
      duplicate_main_marked_by: '',
      data_notes: nextNotes,
    })) {
      if (columns.has(key)) safePayload[key] = value;
    }
    const updated = await store.update('candidates', 'candidate_id', candidateId, safePayload).catch(() => null);
    return Boolean(updated);
  }

  const updated = await store.update('candidates', 'candidate_id', candidateId, {
    ...payload,
    deleted_at: markedAt,
    deleted_by: markedBy,
    duplicate_main_choice: '',
    duplicate_main_marked_at: '',
    duplicate_main_marked_by: '',
    data_notes: nextNotes,
  }).catch(() => null);
  return Boolean(updated);
}

async function deleteCandidatesBatch(req, candidateIds = []) {
  const reason=deleteReason(req);
  return withTransaction(()=>deleteCandidatesBatchInside(req,candidateIds,reason));
}
async function deleteCandidatesBatchInside(req, candidateIds = [], reason) {
  const ids = [...new Set((Array.isArray(candidateIds) ? candidateIds : []).map((item) => String(item || '').trim()).filter(Boolean))];
  if(ids.length>500)throw Object.assign(new Error('Select up to 500 profiles per action.'),{status:400});
  const soft_hidden_ids = [];
  const failed = [];

  // Selected CRM IDs only. One PostgreSQL update avoids waiting on several
  // round trips per checkbox, and never deletes by matching phone/name.
  if (store.pool && ids.length) {
    const rows = await store.query('select * from public.candidates where candidate_id=any($1::text[]) for update',[ids]);
    for(const row of rows)if(isDeletedCandidate(row))soft_hidden_ids.push(String(row.candidate_id));
    const valid = rows.filter(row=>!isDeletedCandidate(row) && visibleCandidate(enrichCandidate(row),req.user));
    const allowedIds = valid.map(row=>String(row.candidate_id));
    const allowedSet = new Set([...allowedIds,...soft_hidden_ids]);
    for (const id of ids) if (!allowedSet.has(id)) failed.push({candidate_id:id,reason:'Candidate not found or already removed from CRM view'});
    if (allowedIds.length) {
      const columns = await getCandidateColumnSet();
      if (!['status','approval_status','all_details_sent'].every(key=>columns.has(key))) throw Object.assign(new Error('Run 12_RESUME_AND_DUPLICATE_CONTROLS_FIX.sql before deleting profiles.'),{status:503});
      const stamp=nowIso(),by=String(req.user.full_name || req.user.username || '');
      const params=[allowedIds]; const assignments=[];
      const patch={status:'__deleted__',approval_status:'__deleted__',all_details_sent:'Deleted',updated_at:stamp,deleted_at:stamp,deleted_by:by,duplicate_main_choice:'',duplicate_main_marked_at:'',duplicate_main_marked_by:''};
      for (const [key,value] of Object.entries(patch)) if (columns.has(key)) {params.push(value);assignments.push(`"${key}"=$${params.length}`);}
      if (!columns.has('data_notes'))throw Object.assign(new Error('The profile audit field is missing. Nothing was removed.'),{status:503});
      params.push(JSON.stringify(Object.fromEntries(valid.map(row=>[String(row.candidate_id),deletionNotes(row,reason,stamp,by)]))));
      assignments.push(`data_notes=($${params.length}::jsonb->>candidate_id)`);
      const updated=await store.query(`update public.candidates set ${assignments.join(',')} where candidate_id=any($1::text[]) returning *`,params);
      const changed=new Set(updated.filter(isDeletedCandidate).map(row=>String(row.candidate_id)));
      for (const id of allowedIds) if (changed.has(id)) soft_hidden_ids.push(id); else failed.push({candidate_id:id,reason:'Database did not confirm removal.'});
    }
    clearAllCaches(['candidates','reminders','reports','revenue']);
    return {deleted_ids:[],soft_hidden_ids,failed,items:soft_hidden_ids.map(candidate_id=>({candidate_id,status:'__deleted__',approval_status:'__deleted__',deleted_at:nowIso()}))};
  }

  for (const candidateId of ids) {
    try {
      // CRITICAL SAFETY RULE: one request may affect only this exact candidate_id.
      // Never delete by phone, name, duplicate group, or any matching rule.
      const candidate = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
      if(candidate&&isDeletedCandidate(candidate)){soft_hidden_ids.push(candidateId);continue;}
      if (!candidate || !visibleCandidate(enrichCandidate(candidate), req.user)) {
        failed.push({ candidate_id: candidateId, reason: 'Candidate not found or already removed from CRM view' });
        continue;
      }

      const softHidden = await softHideCandidate(candidateId, req.user, reason);
      const checkAgain = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
      if (softHidden && checkAgain && isDeletedCandidate(checkAgain)) {
        soft_hidden_ids.push(candidateId);
        continue;
      }

      failed.push({ candidate_id: candidateId, reason: 'Delete safety check failed. Profile was not hidden.' });
    } catch (error) {
      failed.push({ candidate_id: candidateId, reason: error?.message || 'Delete failed' });
    }
  }

  clearAllCaches(['candidates','reminders','reports','revenue']);
  return { deleted_ids: [], soft_hidden_ids, failed };
}

async function deleteCandidate(req, res) {
  if (!canDeleteCandidate(req.user)) return res.status(403).json({ message: 'Only managers can delete profiles' });
  const candidateId = String(req.params.candidateId || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'Candidate id is required' });
  const result = await deleteCandidatesBatch(req, [candidateId]);
  const totalDone = result.deleted_ids.length + result.soft_hidden_ids.length;
  if (!totalDone) {
    return res.status(400).json({ message: result.failed[0]?.reason || 'Delete failed', failed: result.failed, deleted_ids: [], soft_hidden_ids: [] });
  }
  return res.json({ ok: true, items:result.items||[], candidate_id: candidateId, deleted_ids: result.deleted_ids, soft_hidden_ids: result.soft_hidden_ids, failed: result.failed });
}

async function bulkDeleteCandidates(req, res) {
  if (!canDeleteCandidate(req.user)) return res.status(403).json({ message: 'Only managers can delete profiles' });
  const candidateIds = Array.isArray(req.body?.candidate_ids) ? req.body.candidate_ids : [];
  const result = await deleteCandidatesBatch(req, candidateIds);
  return res.json({ ok: result.failed.length===0, items:result.items||[], deleted_ids: result.deleted_ids, soft_hidden_ids: result.soft_hidden_ids, failed: result.failed, requested_count: candidateIds.length });
}

async function bulkReassign(req, res) {
  if (!canManageBucketOut(req.user)) return res.status(403).json({ message: 'Only admin/manager/TL can reassign profiles' });
  const candidateIds = Array.isArray(req.body?.candidate_ids) ? req.body.candidate_ids.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const targetUserId = String(req.body?.target_user_id || '').trim();
  if (!candidateIds.length) return res.status(400).json({ message: 'candidate_ids required' });
  if (!targetUserId) return res.status(400).json({ message: 'target_user_id required' });
  const users = await require('../lib/collaborationAccess').roster();
  const targetUser = users.find((user) => {
    const userId = bucketTargetId(user);
    return userId === targetUserId
      || String(user.user_id || '').trim() === targetUserId
      || String(user.id || '').trim() === targetUserId
      || String(user.username || '').trim() === targetUserId
      || String(user.recruiter_code || '').trim() === targetUserId;
  });
  if (!targetUser || ['0','false','inactive','disabled','deleted'].includes(lower(targetUser.is_active))) return res.status(404).json({ message: 'Active target user not found' });
  const context=String(req.body?.assignment_context||'').trim();
  if(!['solo','project'].includes(context))return res.status(400).json({message:'Choose Solo team or Project before reassigning.'});
  const projectId=context==='project'?String(req.body.project_id||'').trim():'';
  if(context==='project'){const config=await require('../lib/collaborationAccess').state();const p=config.projects.find(p=>p.id===projectId&&p.active!==false);if(!p||![...p.tl_ids,...p.recruiter_ids].includes(String(targetUser.user_id))||(!isAdminOrManager(req.user)&&!p.tl_ids.includes(String(req.user.user_id))))return res.status(403).json({message:'Choose a project containing this owner and your TL account.'});}
  if (context==='solo' && userRole(req.user) === 'tl' && !candidateBelongsToTeam({recruiter_code:targetUser.recruiter_code,recruiter_user_id:targetUser.user_id,recruiter_name:targetUser.full_name},req.user)) return res.status(403).json({message:'TL can reassign only within their own team.'});
  if(candidateIds.length>5000||new Set(candidateIds).size!==candidateIds.length)return res.status(400).json({message:'Choose up to 5,000 unique profiles.'});
  let affectedOwners=[],count=0;
  const stamp=nowIso();
  if(store.pool){
    const scope=candidateScopeSql('c',req.user,[]),params=[...scope.params,candidateIds];
    const before=await store.query(`select c.candidate_id,c.recruiter_user_id,c.recruiter_code,c.recruiter_name,c.project_id from public.candidates c where (${scope.sql}) and c.candidate_id=any($${params.length}::text[]) for update`,params);
    if(before.length!==candidateIds.length)return res.status(409).json({message:'Some profiles are no longer accessible. Nothing was reassigned.'});
    const changed=await store.query(`with moved as (update public.candidates set recruiter_code=$1,recruiter_user_id=$2,recruiter_name=$3,recruiter_designation=$4,project_id=$5,bucket_assigned_at=$6,updated_at=$6 where candidate_id=any($7::text[]) returning candidate_id) select count(*)::int as n from moved`,[targetUser.recruiter_code||'',targetUser.user_id,targetUser.full_name||'',targetUser.designation||targetUser.role||'',projectId,stamp,candidateIds]);
    count=Number(changed[0]?.n||0);if(count!==candidateIds.length)throw Object.assign(new Error('Profiles changed while reassigning. Nothing was partially saved.'),{status:409});
    await store.query('update public.revenue_hub_entries set recruiter_code=$1,recruiter_user_id=$2,recruiter_name=$3,project_id=$4 where candidate_id=any($5::text[])',[targetUser.recruiter_code||'',targetUser.user_id,targetUser.full_name||'',projectId,candidateIds]);
    affectedOwners=before;
  }else{
    const before=await Promise.all(candidateIds.map(key=>store.findById('candidates','candidate_id',key)));
    if(before.some(row=>!row||!visibleCandidate(row,req.user)))return res.status(409).json({message:'Some profiles are no longer accessible. Nothing was reassigned.'});
    for(const existing of before){await store.update('candidates','candidate_id',existing.candidate_id,{recruiter_code:targetUser.recruiter_code||'',recruiter_user_id:targetUser.user_id,recruiter_name:targetUser.full_name||'',recruiter_designation:targetUser.designation||targetUser.role||'',project_id:projectId,bucket_assigned_at:stamp,updated_at:stamp});count++;}
    affectedOwners=before;
    for(const entry of (await table('revenue_hub_entries')).filter(row=>candidateIds.includes(String(row.candidate_id))))await store.update('revenue_hub_entries','revenue_id',entry.revenue_id,{recruiter_code:targetUser.recruiter_code||'',recruiter_user_id:targetUser.user_id,recruiter_name:targetUser.full_name||'',project_id:projectId});
  }
  // One summary notice and one compact entry per affected owner/context, rather than a full profile response per row.
  await makeNotification(targetUser.user_id,'Profiles reassigned',`${req.user.full_name||req.user.username} assigned ${count} profiles to you.`,'candidate',JSON.stringify({open_path:'/candidates'+(projectId?'?project='+encodeURIComponent(projectId):''),count,project_id:projectId}));
  const scopes=new Map();for(const row of [...affectedOwners,{recruiter_user_id:targetUser.user_id,recruiter_code:targetUser.recruiter_code,recruiter_name:targetUser.full_name,project_id:projectId}]){const key=[row.recruiter_user_id,row.recruiter_code,row.project_id].join(':');scopes.set(key,{recruiter_user_id:row.recruiter_user_id,recruiter_code:row.recruiter_code,recruiter_name:row.recruiter_name,project_id:row.project_id||''});}
  invalidateCandidateCaches();
  return res.json({ok:true,count,items:[],affected_owners:[...scopes.values()]});
}

// Preserve the original resume. Text extraction must never replace the stored PDF/Word file.
// A deterministic, candidate-scoped ID makes retried uploads idempotent.
async function uploadCandidateFile(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate || isDeletedCandidate(candidate)) return res.status(404).json({message:'Candidate not found.'});
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({message:'Not allowed.'});
  if (String(req.body?.file_kind || '') !== 'resume') return res.status(410).json({message:'Call recording uploads are disabled.'});
  const pickedName = path.basename(String(req.body?.file_name || 'resume.pdf').replace(/\\/g,'/'));
  const ext = path.extname(pickedName).toLowerCase();
  const originalName = `${escapeFilename(path.parse(pickedName).name).slice(0,50)}${ext}`;
  const allowed = new Set(['.pdf','.doc','.docx','.png','.jpg','.jpeg','.webp','.txt','.rtf','.odt']);
  if (!allowed.has(ext)) return res.status(400).json({message:'Choose a PDF, DOC/DOCX, PNG/JPG/WEBP, TXT, RTF or ODT resume.'});
  const limit = 6 * 1024 * 1024;
  const raw = String(req.body?.content_base64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (raw.length > Math.ceil(limit / 3) * 4) return res.status(413).json({message:'Resume must be 6 MB or smaller.'});
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) return res.status(400).json({message:'Resume file content is invalid.'});
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length || buffer.toString('base64') !== raw) return res.status(400).json({message:'Resume file content is invalid.'});
  if (buffer.length > limit) return res.status(413).json({message:'Resume must be 6 MB or smaller.'});
  const starts = bytes => buffer.subarray(0, bytes.length).equals(Buffer.from(bytes));
  const valid = ext === '.pdf' ? buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))
    : ext === '.png' ? starts([137,80,78,71,13,10,26,10])
    : ['.jpg','.jpeg'].includes(ext) ? starts([255,216,255])
    : ext === '.webp' ? buffer.toString('ascii',0,4)==='RIFF' && buffer.toString('ascii',8,12)==='WEBP'
    : ['.docx','.odt'].includes(ext) ? starts([80,75,3,4])
    : ext === '.doc' ? starts([208,207,17,224,161,177,26,225])
    : ext === '.rtf' ? /^\{\\rtf/.test(buffer.toString('ascii',0,8))
    : !buffer.includes(0);
  if (!valid) return res.status(400).json({message:'The selected file does not match its resume format. Choose the original file again.'});
  const mimeType = candidateFileContentType(originalName, 'application/octet-stream');
  const digest = require('crypto').createHash('sha256').update(String(candidate.candidate_id)).update('\0').update(originalName).update('\0').update(buffer).digest('hex');
  const fileId = `R-${digest.slice(0,40)}`;
  let existing = await store.findById('candidate_files','file_id',fileId);
  const createdAt = nowIso();
  if (existing && String(existing.candidate_id) !== String(candidate.candidate_id)) throw new Error('Resume identity mismatch.');
  if (existing && !String(existing.content_base64 || '').trim()) {
    await store.update('candidate_files','file_id',fileId,{content_base64:raw});
  } else if (!existing) {
    await store.insert('candidate_files', {
      file_id:fileId, candidate_id:candidate.candidate_id, file_kind:'resume',
      original_name:originalName, storage_name:`${fileId}_${originalName}`,
      mime_type:mimeType, size_bytes:String(buffer.length), content_base64:raw,
      uploaded_by_user_id:req.user.user_id || '', uploaded_by_name:req.user.full_name || req.user.username || '',
      created_at:createdAt, updated_at:createdAt, source:'candidate-profile',
    });
  }
  const updates = {resume_filename:originalName};
  if (candidate.resume_filename !== originalName) {
    updates.updated_at = createdAt;
    await store.update('candidates','candidate_id',candidate.candidate_id,updates);
  }
  const files = await listCandidateFiles(candidate.candidate_id);
  afterCommit(() => {
    invalidateCandidateCaches();
    if (!existing) return logActivity(req,candidate.candidate_id,'candidate_file_uploaded',{file_kind:'resume',file_name:originalName});
  }).catch(() => {});
  return res.json({ok:true,replayed:Boolean(existing),item:files.find(row=>row.file_id===fileId),files,candidate_updates:updates});
}

async function downloadCandidateFile(req, res) {
  const candidate = await store.findById('candidates','candidate_id',req.params.candidateId);
  if (!candidate || isDeletedCandidate(candidate)) return res.status(404).json({message:'Candidate not found.'});
  if (!visibleCandidate(candidate,req.user)) return res.status(403).json({message:'Not allowed.'});
  const file = await store.findById('candidate_files','file_id',req.params.fileId);
  if (!file || String(file.candidate_id) !== String(candidate.candidate_id) || file.file_kind !== 'resume') return res.status(404).json({message:'Resume not found.'});
  let content = String(file.content_base64 || '').trim();
  // Preserve access to older installations that separated binary content from metadata.
  if (!content) {
    const row = await store.findById('candidate_file_contents','file_id',file.file_id);
    if (row && (!row.candidate_id || String(row.candidate_id)===String(candidate.candidate_id))) content=String(row.content_base64 || row.content || '').trim();
  }
  if (!content) return res.status(404).json({message:'Stored resume content is unavailable. Upload the original resume again.'});
  const buffer = Buffer.from(content,'base64');
  if (!buffer.length) return res.status(404).json({message:'Stored resume content is empty. Upload the original resume again.'});
  const type = candidateFileContentType(file.original_name,'application/octet-stream');
  const preview = req.query?.download !== '1' && (type === 'application/pdf' || /^image\/(png|jpeg|webp)$/.test(type));
  res.setHeader('Content-Type',type);
  res.setHeader('Content-Length',buffer.length);
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
  res.setHeader('Content-Disposition',`${preview ? 'inline' : 'attachment'}; filename="${escapeFilename(file.original_name || 'resume')}"`);
  return res.send(buffer);
}

module.exports = {
  evaluateJdMatch,
  PERSISTED_CANDIDATE_FIELDS,
  findSubmissionCompat,
  candidateEditResponse,
  enrichCandidate,
  jdFit,
  previewNextCandidateId,
  listProcessOptions,
  addProcessOption,
  list,
  listHotLeads,
  create,
  allocateCandidateId: nextCandidateId,
  buildSqlFilter,
  bulkCreate,
  getOne,
  listNotesForCandidate,
  listFilesForCandidate,
  logOpen,
  update,
  resetFilledDetails,
  submitForApproval,
  submissionNoteForCandidate,
  addNote,
  addQuickNote,
  contactAccess,
  logCall,
  whatsapp,
  whatsappLog,
  followupUpcoming,
  followupNextReminder,
  followupAction,
  requestInterviewDateRemoval,
  removeInterviewDate,
  bulkUpdate,
  recoveryBucket,
  reviveLostLead,
  reassignTargets,
  bulkReassign,
  listDuplicateReviewGroups,
  listDeletedProfiles,
  markDuplicateMain,
  deleteCandidate,
  restoreCandidate,
  bulkDeleteCandidates,
  uploadCandidateFile,
  downloadCandidateFile,
  PROCESS_OPTIONS,
};

const { transactionalHandler } = require('../lib/store');
module.exports.update = transactionalHandler(update);
module.exports.submitForApproval = transactionalHandler(submitForApproval);
module.exports.addNote = transactionalHandler(addNote);
module.exports.addQuickNote = transactionalHandler(addQuickNote);
module.exports.bulkUpdate = transactionalHandler(bulkUpdate);
module.exports.bulkReassign = transactionalHandler(bulkReassign);

async function uploadFilterOptions(req,res){
 let data_notes=[],upload_dates=[];
 if(mode==='postgres'&&store.pool){
  const scope=candidateScopeSql('c',req.user,[]);
  const base=scope.sql;
  const tags=await store.query(`select distinct trim(tag) as value from public.candidates c cross join lateral regexp_split_to_table(coalesce(c.data_notes,''),'[,|;]+') tag where ${base} and trim(tag)<>'' order by value limit 500`,scope.params);
  const dates=await store.query(`select distinct left(c.data_uploading_date,10) as value from public.candidates c where ${base} and coalesce(c.data_uploading_date,'')<>'' order by value desc limit 180`,scope.params);
  data_notes=tags.map(x=>x.value);upload_dates=dates.map(x=>x.value);
 }else{const rows=(await table('candidates')).filter(c=>visibleCandidate(c,req.user)&&!isDeletedCandidate(c));data_notes=[...new Set(rows.flatMap(dataNoteTokens))].sort().slice(0,500);upload_dates=[...new Set(rows.map(c=>cleanDateOnly(c.data_uploading_date)).filter(Boolean))].sort().reverse().slice(0,180);}
 res.setHeader('Cache-Control','private, no-store');return res.json({data_notes,upload_dates});
}
// CC846: Manager-only, read-through PostgreSQL trace. Never uses the Candidate list,
// its UI cache, current pagination, project scope or soft-delete visibility rules.
// This is evidence collection, NOT a recovery or database-restore endpoint.
async function managerMissingCandidateTrace(req, res) {
  if (!isAdminOrManager(req.user)) return res.status(403).json({message:'Manager access required.'});
  if (mode !== 'postgres' || !store.pool) return res.status(503).json({message:'Direct PostgreSQL tracing is unavailable in local preview mode.'});
  const query=String(req.query?.q || '').trim().slice(0,80);
  if (query.length < 3) return res.status(400).json({message:'Enter at least 3 characters of the candidate name, ID or number.'});
  const digits=query.replace(/\D/g,'');
  // Keep private data inside manager-authenticated CRM. Never log the search term.
  res.setHeader('Cache-Control','private, no-store');
  const rows=await store.query(`
    select c.candidate_id,c.full_name,c.phone,c.created_at,c.updated_at,
           c.status,c.approval_status,c.deleted_at,
           to_jsonb(c)->>'recruiter_code' as recruiter_code,
           to_jsonb(c)->>'recruiter_user_id' as recruiter_user_id,
           to_jsonb(c)->>'project_id' as project_id
    from public.candidates c
    where position(lower($1) in lower(coalesce(c.candidate_id,'')))>0
       or position(lower($1) in lower(coalesce(c.full_name,'')))>0
       or ($2<>'' and right(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g'),length($2))=$2)
    order by c.created_at desc nulls last,c.candidate_id desc limit 30`,
    [query, digits.length>=6 ? digits.slice(-10) : '']);
  const warnings=[];
  const runOptional=async(sql,params,description)=>{
    try{return await store.query(sql,params);}catch(err){warnings.push(`${description} unavailable (schema or database permissions).`);return [];} 
  };
  // A receipt is returned only when the profile commit transaction reached COMMIT.
  // It is more reliable evidence than a local frontend optimistic row.
  const receipts=await runOptional(`
    select command_id,candidate_id,created_at from public.crm_command_receipts
    where position(lower($1) in lower(coalesce(receipt_json,'')))>0
       or position(lower($1) in lower(coalesce(candidate_id,'')))>0
    order by created_at desc nulls last limit 20`,[query], 'Commit receipts');
  const activity=await runOptional(`
    select candidate_id, action_type, created_at,username from public.activity_log
    where position(lower($1) in lower(coalesce(metadata,'')))>0
       or position(lower($1) in lower(coalesce(candidate_id,'')))>0
    order by created_at desc nulls last limit 20`,[query], 'Activity log');
  // Independent private-schema audit is available after safe SQL is installed.
  const evidence=await runOptional(`
    select candidate_id,event_type,event_at from cc_integrity.candidate_events
    where position(lower($1) in lower(coalesce(candidate_id,'')))>0
       or position(lower($1) in lower(coalesce(row_snapshot->>'full_name','')))>0
    order by event_at desc limit 20`,[query], 'Integrity audit');
  const identity=await runOptional(`select current_database() as database_name,
     current_user as database_role,inet_server_addr()::text as server_address`,[], 'Database identity');
  return res.json({ok:true,source:'direct_postgres_no_cache',query,found:rows.length,
    candidates:rows,commit_receipts:receipts,activities:activity,integrity_events:evidence,
    database_identity:identity[0]||null,warnings,
    advice:rows.length?'Record exists; inspect status, project and owner fields.':'No matching row in this backend database. Compare the Supabase SQL Editor project and inspect receipts/audit/backups; do not claim a deletion without evidence.'});
}
module.exports.managerMissingCandidateTrace=managerMissingCandidateTrace;

module.exports.uploadFilterOptions=uploadFilterOptions;

module.exports.evaluateJdMatch=evaluateJdMatch;
module.exports.buildJdFitSummary=buildJdFitSummary;

module.exports.validateImportedSubmission = buildSubmissionBlockMessage;

module.exports.deleteCandidate=transactionalHandler(deleteCandidate);
module.exports.bulkDeleteCandidates=transactionalHandler(bulkDeleteCandidates);

module.exports.readSharedProcessOptions=readSharedProcessOptions;
module.exports.saveSharedCandidateOption=saveSharedCandidateOption;


// CC872: distinct values are scoped in the database, independent of list pages.
const filterCatalogCache=createTimedCache(60000,{maxEntries:48,tags:['candidates','access','staff']});
const CATALOG_FIELDS=['status','location','preferred_location','qualification','course_name','relevant_experience_range','relevant_in_hand_range','communication_skill','career_gap','documents_availability','process','data_notes','virtual_onsite','all_details_sent','call_connected','submitted_by','approval_status'];
async function filterCatalog(req,res){
 const project=String(req.query.project_id||'');
 const key=require('../lib/accessRules').dashboardCacheKey(req.user)+':'+project;
 if(req.query.refresh)filterCatalogCache.delete(key);
 const payload=await filterCatalogCache.load(key,async()=>{
  let groups,total;
  if(store.pool){
   const scope=candidateScopeSql('c',req.user,[]);let where=scope.sql;
   if(project){scope.params.push(project==='__solo__'?'':project);where+=` and coalesce(c.project_id,'')=$${scope.params.length}`;}
   const pairs=CATALOG_FIELDS.map(k=>`'${k}',${k==='qualification'?qualificationCategorySql():`coalesce(to_jsonb(c)->>'${k}','')`}`).join(',');
   [groups,total]=await Promise.all([
    store.query(`select f.key,f.value,count(*)::int as n from public.candidates c cross join lateral jsonb_each_text(jsonb_build_object(${pairs})) f where ${where} and trim(f.value)<>'' group by f.key,f.value`,scope.params),
    store.query(`select count(*)::int as total from public.candidates c where ${where}`,scope.params).then(r=>Number(r[0]?.total||0))
   ]);
  }else{
   const rows=(await table('candidates')).filter(r=>visibleCandidate(r,req.user)&&(!project||String(r.project_id||'')===(project==='__solo__'?'':project)));
   total=rows.length;const map=new Map();for(const r of rows)for(const k of CATALOG_FIELDS){const value=String(k==='qualification'?normalizeQualificationCategory(r.qualification_level,r.qualification):r[k]??'').trim();if(!value)continue;const id=JSON.stringify([k,value]);const item=map.get(id)||{key:k,value,n:0};item.n++;map.set(id,item);}groups=[...map.values()];
  }
  let lookup;await require('./uiController').lookups({...req,query:{scope:'profile'}},{set(){return this;},json(v){lookup=v;return v;}});
  const users=(lookup?.users||[]).filter(u=>isLeadership(req.user)||String(u.user_id)===String(req.user.user_id));
  const rows=groups.map(g=>({[g.key]:g.key==='qualification'?normalizeQualificationCategory(g.value):g.value,count:Number(g.n)}));
  for(const process of lookup?.process_options||[])if(!rows.some(row=>String(row.process||'').toLowerCase()===String(process).toLowerCase()))rows.push({process});
  return {rows,users,total,complete:true};
 });
 res.set('Cache-Control','private, no-store');return res.json(payload);
}
module.exports.filterCatalog=filterCatalog;

// CC878: one shared, Manager-edited message catalog, independent of candidate pages.
const waCatalogCache=createTimedCache(10*60000,{maxEntries:1,tags:['settings','reset']});
const WA_CATALOG_KEY='cc878_whatsapp_templates';
async function whatsappTemplates(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method==='GET')return res.json(await waCatalogCache.load('catalog',async()=>{
  const row=await store.findById('settings','setting_key',WA_CATALOG_KEY);
  try{return {items:JSON.parse(row?.setting_value||'[]')};}catch{return {items:[]};}
 }));
 const actor=req.actorUser||req.user;
 if(!['manager','admin'].includes(lower(actor?.role))||actor?.impersonator)return res.status(403).json({message:'Only the Manager can edit shared WhatsApp messages.'});
 const {id,title,body,expected_revision}=req.body||{};
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(String(id||''))||!String(title||'').trim()||String(title).length>120||!String(body||'').trim()||String(body).length>8000)return res.status(400).json({message:'Enter a title and message (up to 8,000 characters).'});
 const result=await require('../lib/store').withTransaction(async()=>{
  if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',[WA_CATALOG_KEY]);
  const row=await store.findById('settings','setting_key',WA_CATALOG_KEY);let items=[];
  try{items=JSON.parse(row?.setting_value||'[]');}catch{}
  const prior=items.find(t=>t.id===id);
  if((prior?.revision||'')!==String(expected_revision||''))throw Object.assign(Error('This message was edited by another Manager. Reload it before saving.'),{status:409});
  const entry={id,title:String(title).trim(),body:String(body).trim(),revision:require('crypto').randomUUID(),updated_at:new Date().toISOString()};
  items=[...items.filter(t=>t.id!==id),entry];if(items.length>160)throw Object.assign(Error('Shared message catalog is full.'),{status:400});
  await store.upsert('settings','setting_key',{setting_key:WA_CATALOG_KEY,setting_value:JSON.stringify(items)});
  return {items};
 });
 waCatalogCache.clear();
 try{require('../lib/approvalLive').publishToUsers((await store.query('select user_id from users')).map(u=>u.user_id),'message-templates-changed',{});}catch{}
 return res.json(result);
}
module.exports.whatsappTemplates=whatsappTemplates;
