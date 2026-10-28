const { store, table, mode, transactionalHandler, callController, afterCommit } = require('../lib/store');
const { containsText, nowIso, ymd, normalizeIndianPhone, buildCsv } = require('../lib/helpers');

const { candidateBelongsToTeam, candidateBelongsToUser, visibleCandidateForUser, candidateScopeSql, candidateOwnerSql } = require('../lib/accessRules');
const { istDateKey } = require('../lib/crmMetrics');
const {createTimedCache}=require('../lib/cache');
const crypto=require('crypto');
const targetAllocation=require('../lib/targetAllocation');
const pipelineCatalog=require('../lib/pipelineCatalog');
const revenueConfigCache=createTimedCache(5*60000,{tags:['revenue']});
const revenueRosterCache=createTimedCache(60000,{tags:['staff']});
const todayIst = () => istDateKey(Date.now());

const STATUS_OPTIONS = [
  'will_come_for_interview',
  'appeared_for_interview',
  'rejected',
  'selected',
  'pending_joining',
  'joined',
  'not_joined',
  'completed_60_days',
];
const PAYOUT_OPTIONS = ['none', 'payout_pending', 'payout_received']; // legacy 'none' accepted for existing rows; new records default pending
const DEFAULT_MONTH_TARGET = 100000;
// CC86: Approved office presets, older candidate/financial rows are never altered.
const CC86_OFFICE_CLIENTS = ["1Point1", "Globiva", "Vertex Group", "Eureka", "iEnergizer", "Alturist"];
const CC86_OFFICE_LOCATIONS = ["Noida Sector 62", "Noida Sector 58", "Noida Sector 127", "Gurgaon Sector 18", "Gurgaon Sector 20", "Gurgaon Sector 17", "Thane, Mumbai", "Navi Mumbai", "Panchkula", "Pune", "Jaipur"];

const PIPELINE_PROCESS_OPTIONS = [
  'Air India', 'Airtel', 'UrbanClap', 'Kotak', 'Tata 1mg', 'Axis Bank', 'Samsung',
  'Tata Motors', 'Icegate', 'Icertate', 'Xiaomi', 'Xiaomi - Regional Language', 'American Express',
  'Razorpay', 'RBL / OLX', 'HDFC Back Office', 'Other',
];

function lower(value) {
  return String(value || '').trim().toLowerCase();
}
function normalizeCandidateCode(value) {
  return String(value || '').trim().toUpperCase();
}
function isLeadership(user) {
  return ['admin', 'manager', 'tl'].includes(lower(user?.role));
}
function isManager(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
}
function canDeletePipelineEntry(user) {
  return lower(user?.role) === 'manager';
}
function isActiveRevenueEntry(row = {}) {
  const status = lower(row.status);
  return status !== 'deleted' && !String(row.deleted_at || row.archived_at || '').trim();
}
function toDateOnly(value) {
  const raw=String(value || '').trim();
  return raw.length>10 && /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? istDateKey(raw) : raw.slice(0,10);
}
function toDateTimeText(value) {
  const raw=String(value||'').trim();
  const t=Date.parse(raw);return raw.length>16 && /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) && Number.isFinite(t) ? new Date(t+330*60000).toISOString().slice(0,16) : raw.slice(0,16);
}
function moneyValue(value) {
  const raw=String(value ?? '').trim().replace(/^(?:₹|INR)\s*/i,'').replace(/,/g,'');
  if (!raw) return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return NaN;
  const amount=Number(raw);
  return Number.isFinite(amount) && amount <= Number.MAX_SAFE_INTEGER/100 ? amount : NaN;
}
function parseMoney(value) { const n=moneyValue(value); return Number.isFinite(n)?n:0; }
function moneyText(value) {
  if (value===undefined || value===null || String(value).trim()==='') return '';
  const amount=moneyValue(value);return Number.isFinite(amount)?String(amount):String(value);
}
function invalidMoney(body,key='payout_amount') {
  return Object.prototype.hasOwnProperty.call(body||{},key) && !Number.isFinite(moneyValue(body[key]));
}
function entryVisible(row,user) {
  return visibleCandidateForUser(row.current_owner_user_id!==undefined?{...row,recruiter_user_id:row.current_owner_user_id,recruiter_code:row.current_owner_code,recruiter_name:row.current_owner_name,project_id:row.current_project_id||''}:row,user);
}
function singleProcess(value){return String(value||'').split(',')[0].trim();}
function invalidStage(body, existing={}) {
  if(body?.process!==undefined&&String(body.process).split(',').filter(x=>x.trim()).length>1)return 'Choose only one process for this interview.';
  const status=lower(body?.status || existing.status || 'will_come_for_interview');
  const payout=lower(body?.payout_status || existing.payout_status || 'none');
  if (!STATUS_OPTIONS.includes(status)) return 'Invalid status.';
  if (!PAYOUT_OPTIONS.includes(payout)) return 'Invalid payout status.';
  if (payout==='payout_received' && !['joined','completed_60_days'].includes(status)) return 'Payout received requires a joined profile.';
  if (status==='completed_60_days') {
    const joined=toDateOnly(body?.joined_date || existing.joined_date);
    if (!joined || (dateDiffDays(todayIst(),joined) ?? -1)<60) return '60 days are not complete from the joined date.';
  }
  for (const key of ['joined_date','joining_date','selection_date','submission_date','interview_datetime']) {
    const value=String(body?.[key] ?? '').trim();
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return 'Invalid '+key.replaceAll('_',' ')+'.';
    const day=value.slice(0,10), instant=Date.parse(day+'T00:00:00Z');
    if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0,10)!==day) return 'Invalid '+key.replaceAll('_',' ')+'.';
    if (value.length>10 && (Number(value.slice(11,13))>23 || Number(value.slice(14,16))>59)) return 'Invalid interview time.';
  }
  return '';
}
function dateDiffDays(fromValue, toValue) {
  const a = new Date(`${toDateOnly(fromValue)}T00:00:00Z`);
  const b = new Date(`${toDateOnly(toValue)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}
function genId() {
  return `REV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}
function shiftDate(dateString, days) {
  const date = new Date(`${toDateOnly(dateString)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function isoMonth(value) {
  return toDateOnly(value).slice(0, 7);
}
function weekRange(dateValue = todayIst()) {
  const date = new Date(`${toDateOnly(dateValue)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { start: '', end: '' };
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  const start = date.toISOString().slice(0, 10);
  date.setUTCDate(date.getUTCDate() + 6);
  const end = date.toISOString().slice(0, 10);
  return { start, end };
}
function sameMonth(a, b) {
  return isoMonth(a) && isoMonth(a) === isoMonth(b);
}
function clampPercent(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  const capped = Math.max(0, Math.min(999, num));
  const rounded = Math.round(capped * 10) / 10;
  return Number.isInteger(rounded) ? Number(rounded.toFixed(0)) : Number(rounded.toFixed(1));
}
function safeLabel(value, fallback = '-') {
  return String(value || '').trim() || fallback;
}
function normalizeInterviewMode(value) {
  const raw = lower(value);
  if (!raw) return '';
  if (raw.includes('walk') || raw.includes('onsite') || raw.includes('on-site') || raw.includes('office')) return 'Walk-in';
  if (raw.includes('virtual') || raw.includes('online') || raw.includes('remote')) return 'Virtual';
  return '';
}
function isMissingColumnError(error, columnName) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes(String(columnName || '').toLowerCase()) && (message.includes('column') || message.includes('schema cache'));
}
function statusCounts(entry) {
  const status = lower(entry.status);
  return {
    interviewed: ['appeared_for_interview', 'selected', 'pending_joining', 'joined', 'completed_60_days', 'rejected', 'not_joined'].includes(status) ? 1 : 0,
    selected: ['selected', 'pending_joining', 'joined', 'completed_60_days'].includes(status) ? 1 : 0,
    joined: ['joined', 'completed_60_days'].includes(status) ? 1 : 0,
    retained:entry.completed_60_days?1:0,
    interviews: entry.interview_date ? 1 : 0,
    revenue: ['joined', 'completed_60_days'].includes(status) && entry.joined_date ? parseMoney(entry.payout_amount) : 0,
  };
}
function buildRank(rows, metric) {
  return [...rows].sort((a, b) => {
    const av = Number(a?.[metric] || 0);
    const bv = Number(b?.[metric] || 0);
    if (bv !== av) return bv - av;
    return String(a.label || '').localeCompare(String(b.label || ''));
  });
}

function userOwnsCandidate(user, row) {
  return entryVisible(row,user);
}
function legacyUserOwnsCandidate(user, row) {
  if (isLeadership(user)) return true;
  const ownName = lower(user?.full_name);
  const ownCode = lower(user?.recruiter_code);
  const rowName = lower(row?.recruiter_name);
  const codes = String(row?.recruiter_code || '').split(',').map((item) => lower(item.trim())).filter(Boolean);
  return rowName === ownName || codes.includes(ownCode);
}

function mergeCandidateSnapshot(entry, candidate) {
  if (!candidate) return entry;
  return {
    ...entry,
    full_name: candidate.full_name || entry.full_name || candidate.candidate_id || '',
    phone: normalizeIndianPhone(candidate.phone || candidate.number || '') || entry.phone || '',
    email:entry.email || candidate.email || '',
    candidate_email:candidate.email||'',
    process: entry.process || candidate.process || '',
    client_name: entry.client_name || candidate.client_name || candidate.company_name || '',
    location: entry.location || candidate.preferred_location || candidate.location || '',
    qualification: entry.qualification || candidate.qualification_level || candidate.qualification || '',
    recruiter_name: entry.recruiter_name || candidate.recruiter_name || '',
    recruiter_code: entry.recruiter_code || candidate.recruiter_code || '',
    recruiter_user_id: entry.recruiter_user_id || candidate.recruiter_user_id || '',
    current_owner_user_id: candidate.recruiter_user_id || '',
    current_owner_code: candidate.recruiter_code || '',
    current_owner_name: candidate.recruiter_name || '',
    communication_skill: entry.communication_skill || candidate.communication_skill || '',
    experience_range: entry.experience_range || candidate.relevant_experience_range || '',
    salary_range: entry.salary_range || candidate.relevant_in_hand_range || '',
    submission_date: entry.submission_date || toDateOnly(candidate.submission_date || ''),
    interview_datetime: entry.interview_datetime || toDateTimeText(candidate.interview_reschedule_date || ''),
    interview_mode: entry.interview_mode || normalizeInterviewMode(candidate.virtual_onsite) || '',
    resume_filename: entry.resume_filename || candidate.resume_filename || '',
    recording_filename: entry.recording_filename || candidate.recording_filename || '',
  };
}

function hydrateEntry(entry) {
  entry={...entry,process:singleProcess(entry.process),full_name:require('../lib/helpers').normalizeCandidateName(entry.full_name)};
  const today = todayIst();
  const interviewDate = toDateOnly(entry.interview_datetime || entry.interview_date);
  const selectionDate = toDateOnly(entry.selection_date);
  const joiningDate = toDateOnly(entry.joining_date);
  const joinedDate = toDateOnly(entry.joined_date);
  const submissionDate = toDateOnly(entry.submission_date);
  const daysToJoining = joiningDate ? dateDiffDays(joiningDate, today) : null;
  const daysFromJoined = joinedDate ? dateDiffDays(today, joinedDate) : null;
  const payoutStatus = lower(entry.payout_status) || 'none';
  const status = lower(entry.status) || 'will_come_for_interview';
  const overdueInterview = ['will_come_for_interview', 'appeared_for_interview'].includes(status) && interviewDate && interviewDate <= today;
  const joiningPendingDue = ['selected', 'pending_joining'].includes(status) && (!joiningDate || daysToJoining !== null && daysToJoining <= 3);
  const completed60=['joined','completed_60_days'].includes(status) && daysFromJoined!==null && daysFromJoined>=60;
  const payoutDays=Math.max(1,Number(entry.payout_days || 60));
  const payoutDuration=[45,60,90].includes(Number(entry.payout_duration_days))?Number(entry.payout_duration_days):60;
  const payoutEligible= ['joined','completed_60_days'].includes(status) && daysFromJoined!==null && daysFromJoined>=payoutDuration;
  const invoiceLead=Math.max(0,Number(entry.invoice_lead_days ?? 5));
  const payoutPending = (status === 'joined' || status === 'completed_60_days' || completed60) && payoutStatus !== 'payout_received' && daysFromJoined !== null && daysFromJoined >= Math.max(0,payoutDays-invoiceLead);
  const missed = overdueInterview && today > interviewDate;
  let stageColor = 'blue';
  if (['rejected', 'not_joined'].includes(status) || missed) stageColor = 'red';
  else if (['selected', 'joined', 'completed_60_days'].includes(status) || payoutStatus === 'payout_received') stageColor = 'green';
  else if (['pending_joining', 'appeared_for_interview'].includes(status) || joiningPendingDue || payoutPending) stageColor = 'orange';
  return {
    ...entry,
    interview_date: interviewDate,
    interview_datetime: toDateTimeText(entry.interview_datetime || entry.interview_date || ''),
    submission_date: submissionDate,
    selection_date: selectionDate,
    joining_date: joiningDate,
    joined_date: joinedDate,
    payout_amount: moneyText(entry.payout_amount),
    // Display earned payout; keep negotiated per-joining rate unchanged in storage.
    recognized_payout: ['joined','completed_60_days'].includes(status) && joinedDate ? parseMoney(entry.payout_amount) : 0,
    interview_mode: normalizeInterviewMode(entry.interview_mode),
    days_to_joining: daysToJoining,
    days_from_joined: daysFromJoined,
    completed_60_days:completed60,
    payout_duration_complete:payoutEligible,
    payout_eligibility_date:joinedDate?shiftDate(joinedDate,payoutDuration):'',
    retention_inconsistent:status==='completed_60_days'&&!completed60,
    invalid_payout:!Number.isFinite(moneyValue(entry.payout_amount)),
    payout_pending: payoutPending,
    payout_due_date: joinedDate ? shiftDate(joinedDate,payoutDays) : '',
    invoice_due_date: joinedDate ? shiftDate(joinedDate,Math.max(0,payoutDays-invoiceLead)) : '',
    missed,
    overdue_interview: overdueInterview,
    joining_pending_due: joiningPendingDue,
    stage_color: stageColor,
  };
}

function matchesFilter(entry, query) {
  if (query.status && lower(entry.status) !== lower(query.status)) return false;
  if (query.payout_status && lower(entry.payout_status) !== lower(query.payout_status)) return false;
  if (query.client_name && lower(entry.client_name) !== lower(query.client_name)) return false;
  if (query.process && lower(entry.process) !== lower(query.process)) return false;
  if (query.recruiter_name && lower(entry.recruiter_name) !== lower(query.recruiter_name)) return false;
  if (query.communication_skill && lower(entry.communication_skill) !== lower(query.communication_skill)) return false;
  if (query.experience_range && lower(entry.experience_range) !== lower(query.experience_range)) return false;
  if (query.salary_range && lower(entry.salary_range) !== lower(query.salary_range)) return false;
  if (query.candidate_id && !containsText(entry.candidate_id, query.candidate_id)) return false;
  if (query.candidate_name && !containsText(entry.full_name, query.candidate_name)) return false;
  if (query.interview_date_from && String(entry.interview_date || '') < String(query.interview_date_from)) return false;
  if (query.interview_date_to && String(entry.interview_date || '') > String(query.interview_date_to)) return false;
  if (query.selection_date_from && String(entry.selection_date || '') < String(query.selection_date_from)) return false;
  if (query.selection_date_to && String(entry.selection_date || '') > String(query.selection_date_to)) return false;
  if (query.joining_date_from && String(entry.joining_date || '') < String(query.joining_date_from)) return false;
  if (query.joining_date_to && String(entry.joining_date || '') > String(query.joining_date_to)) return false;
  if (query.joined_date_from && String(entry.joined_date || '') < String(query.joined_date_from)) return false;
  if (query.joined_date_to && String(entry.joined_date || '') > String(query.joined_date_to)) return false;
  return true;
}

function cardSummary(entries) {
  // CC871: stage cards count interview attempts by revenue_id.
  // Conflicting finance values still remain excluded by financialRows() analytics.
  const seen=new Set();
  entries=entries.filter(row=>{const key=String(row.revenue_id||'')||normalizeCandidateCode(row.candidate_id);if(!key)return true;if(seen.has(key))return false;seen.add(key);return true;});
  return {
    will_come_for_interview: entries.filter((item) => lower(item.status) === 'will_come_for_interview').length,
    appeared_for_interview: entries.filter((item) => lower(item.status) === 'appeared_for_interview').length,
    rejected: entries.filter((item) => lower(item.status) === 'rejected').length,
    selected: entries.filter((item) => lower(item.status) === 'selected').length,
    pending_joining: entries.filter((item) => lower(item.status) === 'pending_joining').length,
    joined: entries.filter((item) => lower(item.status) === 'joined').length,
    not_joined: entries.filter((item) => lower(item.status) === 'not_joined').length,
    completed_60_days: entries.filter((item) => item.completed_60_days).length,
    payout_pending: entries.filter((item) => item.payout_pending || lower(item.payout_status) === 'payout_pending').length,
    payout_received: entries.filter((item) => lower(item.payout_status) === 'payout_received').length,
    all_profiles: entries.length,
  };
}

function candidateSearchFields(row) {
  return [
    row.candidate_id,
    row.full_name,
    row.phone,
    row.number,
    row.process,
    row.client_name,
    row.company_name,
    row.recruiter_name,
    row.recruiter_code,
    row.location,
    row.preferred_location,
    row.qualification,
    row.qualification_level,
    row.interview_date,
    row.interview_reschedule_date,
    row.communication_skill,
    row.relevant_experience_range,
    row.relevant_in_hand_range,
  ];
}

function normalizeNameSearch(value) {
  return lower(value).replace(/\s+/g, ' ').trim();
}

function candidateSearchIntent(query) {
  const raw = String(query || '').trim();
  const target = lower(raw);
  const digits = normalizeIndianPhone(raw);
  const compact = raw.replace(/\s+/g, '');
  const hasLetters = /[a-z]/i.test(raw);
  const hasDigits = /\d/.test(raw);
  let kind = 'name';
  if (digits && digits.length >= 4 && (!hasLetters || digits.length >= 6)) kind = 'phone';
  else if (hasDigits && /^[a-z]{0,4}\d+$/i.test(compact)) kind = 'candidate_id';
  return { raw, target, digits, kind };
}

function candidateNameScore(fullName, query) {
  const normalizedName = normalizeNameSearch(fullName);
  const normalizedQuery = normalizeNameSearch(query);
  if (!normalizedQuery || !normalizedName) return 0;
  const tokens = normalizedName.split(' ').filter(Boolean);
  let score = 0;
  if (normalizedName === normalizedQuery) score += 320;
  if (tokens.includes(normalizedQuery)) score += 280;
  if (normalizedName.startsWith(normalizedQuery)) score += 250;
  if (tokens.some((token) => token.startsWith(normalizedQuery))) score += 220;
  if (normalizedName.includes(` ${normalizedQuery}`)) score += 180;
  if (normalizedQuery.length >= 3 && normalizedName.includes(normalizedQuery)) score += 90;
  return score;
}

function candidateSearchScore(row, query) {
  const meta = candidateSearchIntent(query);
  if (!meta.target) return 0;
  const candidateId = lower(row.candidate_id);
  const fullName = String(row.full_name || '');
  const phone = normalizeIndianPhone(row.phone || row.number || '');
  if (meta.kind === 'phone') {
    let score = 0;
    if (meta.digits && phone === meta.digits) score += 340;
    if (meta.digits && phone.startsWith(meta.digits)) score += 260;
    if (meta.digits && phone.includes(meta.digits)) score += 160;
    return score;
  }
  if (meta.kind === 'candidate_id') {
    let score = 0;
    if (candidateId === meta.target) score += 340;
    if (candidateId.startsWith(meta.target)) score += 260;
    if (candidateId.includes(meta.target)) score += 150;
    return score;
  }
  return candidateNameScore(fullName, meta.raw);
}

function withoutStageFilters(query = {}) {
  const next = { ...query };
  delete next.status;
  delete next.payout_status;
  return next;
}

async function findCandidateById(candidateId) {
  if (mode === 'postgres') {
    return store.one("select * from public.candidates where upper(candidate_id) = upper($1) and coalesce(deleted_at,'')='' and lower(coalesce(status,'')) not in ('deleted','archived','__deleted__') order by candidate_id limit 1 for update", [candidateId]);
  }
  const rows = await table('candidates');
  return rows.find((row) => normalizeCandidateCode(row.candidate_id) === normalizeCandidateCode(candidateId) && isActiveRevenueEntry(row)) || null;
}

function pipelineAttemptTime(row={}) {
  let value=String(row.interview_datetime||row.interview_date||row.created_at||'').trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))value+='T00:00:00+05:30';
  else if(value&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(value))value+='+05:30';
  return Date.parse(value)||Date.parse(row.created_at)||0;
}
function latestAttemptFirst(a,b){return pipelineAttemptTime(b)-pipelineAttemptTime(a)||(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||String(b.revenue_id||'').localeCompare(String(a.revenue_id||''));}
async function findRevenueEntryByCandidateId(candidateId) {
  if(store.pool)return store.one(`select r.* from public.revenue_hub_entries r
    where upper(candidate_id)=upper($1) and coalesce(deleted_at,'')='' and lower(coalesce(status,''))<>'deleted'
    order by coalesce(public.crm_due_instant(coalesce(nullif(to_jsonb(r)->>'interview_datetime',''),nullif(to_jsonb(r)->>'interview_date',''),r.created_at)),public.crm_safe_instant(r.created_at)) desc nulls last,
      public.crm_safe_instant(r.created_at) desc nulls last,r.revenue_id desc limit 1 for update`,[candidateId]);
  return (await table('revenue_hub_entries')).filter(row=>normalizeCandidateCode(row.candidate_id)===normalizeCandidateCode(candidateId)&&isActiveRevenueEntry(row)).sort(latestAttemptFirst)[0]||null;
}
async function syncLatestInterviewToCandidate(candidateId){
  const latest=await findRevenueEntryByCandidateId(candidateId);
  if(!latest)return null;
  const candidate=await store.findById('candidates','candidate_id',candidateId);
  if(!candidate)return null;
  const desired={status:REVENUE_TO_CANDIDATE_STAGE[lower(latest.status)]||candidate.status};
  const when=latest.interview_datetime||latest.interview_date;
  if(when){desired.interview_date=toDateOnly(when);desired.interview_reschedule_date=toDateTimeText(when);}
  const patch=Object.fromEntries(Object.entries(desired).filter(([key,value])=>String(candidate[key]||'')!==String(value||'')));
  return Object.keys(patch).length?store.update('candidates','candidate_id',candidateId,{...patch,updated_at:nowIso()}):candidate;
}
async function savePipelineNote(req,entry,previousNote=''){
  const body=String(entry.notes||'').trim();
  if(!body||body===String(previousNote||'').trim())return null;
  const client_note_key='pipeline:'+entry.revenue_id+':'+crypto.createHash('sha256').update(String(req.body?.expected_updated_at||'create')+'|'+body).digest('hex');
  const result=await callController(require('./candidateController').addNote,{...req,params:{...req.params,candidateId:entry.candidate_id},body:{body,note_type:'public',client_note_key}});
  return result.item;
}
function pipelineCandidateReply(candidate){return candidate?require('../lib/approvalLive').compactLiveRow(candidate):null;}
function pipelineChanged(){return afterCommit(()=>require('../lib/cache').clearAllCaches(['candidates','revenue','reminders','reports']));}

async function revenueConfig(fresh=false){const load=async()=>{const row=await store.findById('app_settings','key','revenue_hub_config');try{return JSON.parse(row?.value||'{}');}catch{return {};}};return fresh?load():structuredClone(await revenueConfigCache.load('config',load));}
async function visibleRoster(user){const ids=[...new Set([user.user_id,...(user.__ccTeamUserIds||[])].map(String))],key=[user.user_id,user.role,ids.join(',')].join(':');return revenueRosterCache.load(key,async()=>{const users=store.pool?await store.query(`select user_id,username,full_name,recruiter_code,role,designation,tl_user_id,tl_code,is_active from public.users ${isManager(user)?'':'where user_id=any($1::text[])'}`,isManager(user)?[]:[ids]):await table('users');return users.filter(u=>!['0','false','inactive'].includes(lower(u.is_active))&&(isManager(user)||ids.includes(String(u.user_id))));});}
// CC886: own-dashboard reads keep recruiter-style analytics, while the actor's
// visible Client input must match the real write validator. No extra query.
function pipelineEditorContext(req,catalog,entries=[]) {
 const actor=req.actorUser||req.user;
 const own=String(actor.user_id)===String(req.user.user_id);
 if(!isLeadership(actor)||!own&&!isManager(actor))return {can_choose_client:false};
 if(!req.user.__ccDashboardOwn)return {can_choose_client:true};
 return {can_choose_client:true,clients:catalog.map(c=>c.name),client_catalog:catalog,
  entry_clients:Object.fromEntries(entries.map(row=>[row.revenue_id,String(row.client_name||'')]))};
}
function publicEntry(entry,user){if(isLeadership(user))return entry;const clean={...entry};for(const k of ['client_name','client','company_name','client_email','client_phone','payout_amount','recognized_payout','payout_status','payout_received_at','payout_pending','payout_days','payout_duration_days','invoice_lead_days','payout_due_date','invoice_due_date','invoice_status'])delete clean[k];return clean;}
const visibleEntriesCache=createTimedCache(60000,{maxEntries:48,tags:['revenue','access']});
async function getVisibleEntries(user){
 // Cache only a verified, versioned ACL. Unknown callers always compute a fresh scoped view.
 if(!user?.user_id||!Number.isFinite(user.__ccAccessRevision))return loadVisibleEntries(user);
 const key=JSON.stringify([user.user_id,user.role,user.__ccAccessRevision,user.__ccTeamUserIds,user.__ccSharedScopes,user.__ccSoloPeers]);
 return visibleEntriesCache.load(key,()=>loadVisibleEntries(user));
}
const candidateSnapshotCache=new Map();
async function loadVisibleEntries(user) {
  let rows,candidates;
  if(store.pool){const scope=candidateOwnerSql('c',user,[]);rows=await require('../lib/versionedList').versionedList({key:JSON.stringify([user.user_id,user.__ccAccessRevision]),select:(await require('../lib/sqlProjection').projection('revenue_hub_entries','r',["revenue_id", "candidate_id", "full_name", "phone", "email", "client_name", "process", "location", "qualification", "recruiter_name", "recruiter_code", "recruiter_user_id", "communication_skill", "experience_range", "salary_range", "interview_datetime", "interview_date", "interview_mode", "submission_date", "selection_date", "joining_date", "joined_date", "status", "payout_status", "payout_amount", "payout_days", "payout_duration_days", "invoice_lead_days", "invoice_status", "payout_received_at", "notes", "resume_filename", "recording_filename", "updated_at", "created_at", "deleted_at", "archived_at"]))+",c.updated_at as __candidate_version",from:'public.revenue_hub_entries r left join public.candidates c on c.candidate_id=r.candidate_id',where:"lower(coalesce(r.status,''))<>'deleted' and coalesce(r.deleted_at,'')='' and "+scope.sql,params:scope.params,id:'revenue_id',idExpr:'r.revenue_id',version:"greatest(coalesce(r.updated_at,r.created_at,''),coalesce(c.updated_at,c.created_at,''))"});const ids=[...new Set(rows.filter(r=>!candidateSnapshotCache.has(r.candidate_id)||candidateSnapshotCache.get(r.candidate_id).version!==r.__candidate_version).map(r=>r.candidate_id))];// CC88: Only the columns needed for the Revenue candidate snapshot move
    // from Supabase to Render. Never download resume blobs, long notes,
    // full candidate histories, etc. for this read-only listing.
    const snapshotColumns=['candidate_id','project_id','full_name','phone','number','process','client_name','company_name',
      'preferred_location','location','qualification_level','qualification','recruiter_name','recruiter_code',
      'recruiter_user_id','email','interview_date','communication_skill','relevant_experience_range','relevant_in_hand_range',
      'submission_date','interview_reschedule_date','virtual_onsite','resume_filename','recording_filename','status','approval_status'];
    const snapshotSql=`select ${await require('../lib/sqlProjection').projection('candidates','c',snapshotColumns)} from public.candidates c where candidate_id=any($1::text[])`;
    candidates=[];
    if(ids.length){const changed=await store.query(snapshotSql,[ids]);for(const candidate of changed){const entry=rows.find(r=>r.candidate_id===candidate.candidate_id);candidateSnapshotCache.set(candidate.candidate_id,{version:entry?.__candidate_version,row:candidate});}}candidates=rows.map(r=>candidateSnapshotCache.get(r.candidate_id)?.row).filter(Boolean);while(candidateSnapshotCache.size>20000)candidateSnapshotCache.delete(candidateSnapshotCache.keys().next().value);}

  else [rows,candidates]=await Promise.all([table('revenue_hub_entries'),table('candidates')]);
  const config=await revenueConfig(),roster=await visibleRoster(user);
  const candidateMap=new Map(candidates.map(row=>[normalizeCandidateCode(row.candidate_id),row]));
  const latestIds=new Map();for(const row of [...rows].filter(isActiveRevenueEntry).sort(latestAttemptFirst)){const id=normalizeCandidateCode(row.candidate_id);if(!latestIds.has(id))latestIds.set(id,row.revenue_id);}
  return rows.filter(isActiveRevenueEntry).map(row=>{const c=candidateMap.get(normalizeCandidateCode(row.candidate_id));const merged={...mergeCandidateSnapshot(row,c),is_latest_interview:latestIds.get(normalizeCandidateCode(row.candidate_id))===row.revenue_id,candidate_status:c?.status||'',candidate_approval_status:c?.approval_status||'',project_id:row.project_id||'',current_project_id:c?.project_id||''};const owner=roster.find(u=>String(u.user_id)===String(merged.recruiter_user_id)||lower(u.recruiter_code)===lower(merged.recruiter_code));if(owner){merged.recruiter_name=owner.full_name||owner.username;merged.recruiter_user_id=owner.user_id;}const rule=config.rules?.[(owner?.tl_user_id||'')+':'+lower(merged.client_name)]||config.rules?.[lower(merged.client_name)]||{};return {...merged,candidate_missing:!c,payout_days:row.payout_days||rule.payout_days||60,payout_duration_days:row.payout_duration_days||rule.payout_duration_days||60,invoice_lead_days:row.invoice_lead_days??rule.invoice_lead_days??5};}).filter(row=>entryVisible(row,user)).map(hydrateEntry).sort(latestAttemptFirst);
}
// CC815: Revenue Hub follows an explicitly saved candidate status. A status
// change is written in the SAME DB transaction as the candidate profile Save;
// read-only profile opens, notes and unrelated edits do not touch revenue.
const CANDIDATE_TO_REVENUE_STAGE = Object.freeze({
  'draft':'will_come_for_interview',
  'in - progress':'will_come_for_interview',
  'all set for interview':'will_come_for_interview',
  'appeared in interview':'appeared_for_interview',
  'selected':'selected',
  'joining due':'pending_joining',
  'joined':'joined',
  'backout':'not_joined',
  'not joined':'not_joined',
  'not intrested':'not_joined',
  'not interested':'not_joined',
  'rejected once, needs new interview':'rejected',
  'rejected':'rejected',
  'completed 60 days':'completed_60_days',
});
const REVENUE_TO_CANDIDATE_STAGE = Object.freeze({
  will_come_for_interview:'All set for Interview',
  appeared_for_interview:'Appeared in Interview',
  selected:'Selected',
  pending_joining:'Joining Due',
  joined:'Joined',
  not_joined:'Backout',
  rejected:'Rejected',
  completed_60_days:'Completed 60 Days',
});
function revenueStageFromCandidateStatus(status) {
  return CANDIDATE_TO_REVENUE_STAGE[lower(status)] || '';
}
async function syncCandidateStatusToRevenue(candidateId,candidateStatus){
 const id=normalizeCandidateCode(candidateId),stage=revenueStageFromCandidateStatus(candidateStatus);if(!id||!stage)return 0;
 const row=await findRevenueEntryByCandidateId(id);if(!row||lower(row.status)===stage)return 0;
 if(stage==='completed_60_days'&&(!row.joined_date||(dateDiffDays(todayIst(),row.joined_date)??-1)<60))throw Object.assign(new Error('60 days have not passed since joining.'),{status:400});
 const joined=['joined','completed_60_days'].includes(stage),selected=['selected','pending_joining','joined','completed_60_days'].includes(stage);
 await store.update('revenue_hub_entries','revenue_id',row.revenue_id,{status:stage,joined_date:joined?(row.joined_date||todayIst()):(row.joined_date||''),selection_date:selected?(row.selection_date||todayIst()):(row.selection_date||''),payout_status:!joined&&lower(row.payout_status)!=='payout_received'?'payout_pending':row.payout_status,updated_at:nowIso()});return 1;
}

async function updateConfig(req,res){
 if(store.pool){await store.query(`insert into public.app_settings(key,value,updated_at) values('revenue_hub_config','{}',$1) on conflict(key) do nothing`,[nowIso()]);await store.query(`select key from public.app_settings where key='revenue_hub_config' for update`);}
 const roster=await visibleRoster(req.user),config=await revenueConfig(true),body=req.body||{},month=String(body.month||isoMonth(todayIst()));
 if(!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))return res.status(400).json({message:'Choose a month.'});
 if(body.type==='target_flow'||body.type==='joining_flow'){
  if(!isLeadership(req.user))return res.status(403).json({message:'Leadership access required.'});
  const flow=body.type==='joining_flow'?targetAllocation.buildJoiningFlow(roster,req.user,config,month):targetAllocation.buildFlow(roster,req.user,config,month,isManager(req.user)?await getMonthlyTarget():0);
  if(String(body.expected_revision??'')!==flow.revision)return res.status(409).json({message:'Targets changed in another session. Refresh before saving.'});
  const node=flow.nodes.find(n=>n.id===String(body.user_id));
  if(!node||!isManager(req.user)&&node.role!=='recruiter')return res.status(403).json({message:'TLs can distribute only their own recruiter budgets.'});
  const balanced=targetAllocation.editFlow(flow,body.user_id,body.amount,{release:body.release_fixed===true});if(body.type==='joining_flow')targetAllocation.saveJoiningFlow(config,balanced);else targetAllocation.saveFlow(config,balanced);
 }else if(body.type==='target'||body.type==='joining_target'){
  const member=roster.find(u=>String(u.user_id)===String(body.user_id));if(!member)return res.status(403).json({message:'Employee is outside your team.'});
  const joining=lower(member.role)==='recruiter';if(!isManager(req.user)&&!joining)return res.status(403).json({message:'Only the manager sets team revenue targets.'});
  const amount=Number(body.amount);if(!Number.isFinite(amount)||amount<0||amount>1000000000||joining&&!Number.isInteger(amount))return res.status(400).json({message:'Enter a valid target.'});
  const kind=joining?'joining_targets':'targets';config[kind]||={};config[kind][month]||={};config[kind][month][member.user_id]=amount;
 }else if(body.type==='share_default'){
  if(!isManager(req.user))return res.status(403).json({message:'Only the manager sets the shared destination.'});
  const type=body.destination_type,value=String(body.destination||'').trim();
  if(type==='number'?!/^\+?[0-9 ]{10,16}$/.test(value):type!=='group'||!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+(?:\?[^\s]*)?$/.test(value))return res.status(400).json({message:'Enter a valid office number or WhatsApp group invite link.'});
  // CC864: Keep the existing destination/message until the manager saves changes.
  // Older clients that send only a group must not erase the saved message.
  const updatesMessage=Object.prototype.hasOwnProperty.call(body,'message_template');
  if(updatesMessage&&(typeof body.message_template!=='string'||!body.message_template.trim()||body.message_template.length>4000))return res.status(400).json({message:'Enter a message template between 1 and 4,000 characters.'});
  config.share_default={...config.share_default,type,value,group_label:type==='group'?String(body.group_label||'').trim().slice(0,100):'',...(updatesMessage?{message_template:body.message_template.trim()}:{})};
 }else if(body.type==='client'){
  const client=String(body.client_name||'').trim();if(!client)return res.status(400).json({message:'Enter the client name.'});
  const days=Number(body.payout_days),lead=Number(body.invoice_lead_days),amount=Number(body.payout_amount),duration=Number(body.payout_duration_days??60);if(!Number.isInteger(days)||days<1||days>365||!Number.isInteger(lead)||lead<0||lead>days||!Number.isFinite(amount)||amount<0||![45,60,90].includes(duration))return res.status(400).json({message:'Check payout amount, payment days and reminder lead days.'});
  config.rules||={};config.rules[(isManager(req.user)?'':req.user.user_id+':')+lower(client)]={client_name:client,payout_days:days,payout_duration_days:duration,invoice_lead_days:lead,payout_amount:amount};
 }else return res.status(400).json({message:'Unknown configuration action.'});
 await store.upsert('app_settings','key',{key:'revenue_hub_config',value:JSON.stringify(config),updated_at:nowIso()});
 require('../lib/cache').clearAllCaches();await require('../lib/store').afterCommit(()=>require('../lib/approvalLive').publishReminderDirty({}, {source:'/revenue-hub/config',at:Date.now()}));
 return res.json({ok:true});
}

async function buildVisibleCandidateSearchFallback(user, query = '') {
  const trimmedQuery = String(query || '').trim();
  const rows = await table('candidates');
  const existingIds = new Set((await table('revenue_hub_entries')).filter(isActiveRevenueEntry).map((row) => String(row.candidate_id || '')));
  return rows
    .filter(isActiveRevenueEntry)
    .filter((row) => entryVisible(row,user))
    .map((row) => ({ ...row, already_in_pipeline: existingIds.has(String(row.candidate_id || '')), _score: candidateSearchScore(row, trimmedQuery) }))
    .filter((row) => !trimmedQuery || row._score > 0)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
    })
    .slice(0, 250)
    .map(({ _score, ...row }) => row);
}

async function getVisibleCandidateProcessOptions(user){
 return require('./candidateController').readSharedProcessOptions();
}

async function getVisibleCandidates(user, query = '') {
  const trimmedQuery = String(query || '').trim();
  if (mode === 'postgres') {
    try {
      const params = [];
      const where = [];
      const orderChunks = [];
      const scoped=candidateScopeSql('c',user,params);
      where.push(scoped.sql);
      if (trimmedQuery) {
        const meta = candidateSearchIntent(trimmedQuery);
        if (meta.kind === 'phone') {
          params.push(meta.digits || null);
          const digitExactRef = `$${params.length}::text`;
          params.push(meta.digits ? `${meta.digits}%` : null);
          const digitPrefixRef = `$${params.length}::text`;
          params.push(meta.digits ? `%${meta.digits}%` : null);
          const digitLikeRef = `$${params.length}::text`;
          where.push(`(${digitLikeRef} is not null and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like ${digitLikeRef})`);
          orderChunks.push(`case
            when ${digitExactRef} is not null and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = ${digitExactRef} then 400
            when ${digitPrefixRef} is not null and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like ${digitPrefixRef} then 300
            else 0 end desc`);
        } else if (meta.kind === 'candidate_id') {
          params.push(meta.target);
          const exactRef = `$${params.length}::text`;
          params.push(`${meta.target}%`);
          const prefixRef = `$${params.length}::text`;
          params.push(`%${trimmedQuery}%`);
          const likeRef = `$${params.length}::text`;
          where.push(`c.candidate_id ilike ${likeRef}`);
          orderChunks.push(`case
            when lower(coalesce(c.candidate_id,'')) = ${exactRef} then 400
            when lower(coalesce(c.candidate_id,'')) like ${prefixRef} then 300
            else 0 end desc`);
        } else {
          const nameQuery = normalizeNameSearch(trimmedQuery);
          params.push(nameQuery);
          const exactRef = `$${params.length}::text`;
          params.push(`${nameQuery}%`);
          const prefixRef = `$${params.length}::text`;
          params.push(`% ${nameQuery}%`);
          const tokenRef = `$${params.length}::text`;
          params.push(nameQuery.length >= 3 ? `%${nameQuery}%` : null);
          const containsRef = `$${params.length}::text`;
          where.push(`(
            lower(coalesce(c.full_name,'')) = ${exactRef}
            or lower(coalesce(c.full_name,'')) like ${prefixRef}
            or lower(coalesce(c.full_name,'')) like ${tokenRef}
            or (${containsRef} is not null and lower(coalesce(c.full_name,'')) like ${containsRef})
          )`);
          orderChunks.push(`case
            when lower(coalesce(c.full_name,'')) = ${exactRef} then 420
            when lower(coalesce(c.full_name,'')) like ${prefixRef} then 340
            when lower(coalesce(c.full_name,'')) like ${tokenRef} then 280
            when ${containsRef} is not null and lower(coalesce(c.full_name,'')) like ${containsRef} then 180
            else 0 end desc`);
        }
      }
      const whereSql = where.length ? `where ${where.join(' and ')}` : '';
      const orderSql = orderChunks.length ? `${orderChunks.join(', ')}, ` : '';
      return await store.query(`
        select ${['candidate_id','full_name','phone','number','email','project_id','client_name','company_name','process','preferred_location','location','qualification','qualification_level','recruiter_name','recruiter_code','recruiter_user_id','interview_reschedule_date','interview_date','virtual_onsite','submission_date','communication_skill','relevant_experience_range','relevant_in_hand_range','tl_id','tl_name','created_at','updated_at'].map(f=>`to_jsonb(c)->>'${f}' as "${f}"`).join(', ')},exists(select 1 from public.revenue_hub_entries r where upper(r.candidate_id)=upper(c.candidate_id) and coalesce(r.deleted_at,'')='' and lower(coalesce(r.status,''))<>'deleted') as already_in_pipeline
        from public.candidates c
        ${whereSql}
        order by ${orderSql} coalesce(c.updated_at, c.created_at, now()::text) desc
        limit 100
      `, params);
    } catch (error) {
      // Never turn a failed indexed search into a full-database download.
      throw error;
    }
  }
  return buildVisibleCandidateSearchFallback(user, trimmedQuery);
}

function shapeFromCandidate(candidate, payload = {}) {
  const interviewDateTime = toDateTimeText(payload.interview_datetime || candidate.interview_datetime || candidate.interview_reschedule_date || '');
  return {
    revenue_id: genId(),
    candidate_id: candidate.candidate_id,
    full_name: candidate.full_name || candidate.candidate_id || '',
    phone: normalizeIndianPhone(candidate.phone || candidate.number || ''),
    process: singleProcess(payload.process || candidate.process),
    project_id:candidate.project_id||'',
      client_name: payload.client_name || candidate.client_name || candidate.company_name || '',
    location: payload.preferred_location || payload.location || candidate.preferred_location || candidate.location || '',
    qualification: payload.qualification || candidate.qualification_level || candidate.qualification || '',
    recruiter_name: candidate.recruiter_name || '',
    recruiter_code: candidate.recruiter_code || '',
    recruiter_user_id: candidate.recruiter_user_id || '',
    email: payload.email || candidate.email || '',
    payout_days: String(payload.payout_days||60),
    payout_duration_days: String(payload.payout_duration_days||60),
    invoice_lead_days: String(payload.invoice_lead_days??1),
    invoice_status: 'pending',
    communication_skill: payload.communication_skill || candidate.communication_skill || '',
    experience_range: payload.experience_range || candidate.relevant_experience_range || '',
    salary_range: payload.salary_range || candidate.relevant_in_hand_range || '',
    submission_date: toDateOnly(payload.submission_date || candidate.submission_date || ''),
    interview_datetime: interviewDateTime,
    interview_date: toDateOnly(interviewDateTime || payload.interview_date || candidate.interview_date || candidate.interview_reschedule_date || todayIst()),
    interview_mode: normalizeInterviewMode(payload.interview_mode || candidate.virtual_onsite || ''),
    selection_date: toDateOnly(payload.selection_date || (['selected','pending_joining'].includes(lower(payload.status)) ? todayIst() : '')),
    joining_date: toDateOnly(payload.joining_date || ''),
    joined_date: ['joined','completed_60_days'].includes(lower(payload.status)) ? toDateOnly(payload.joined_date || todayIst()) : '',
    payout_received_at: lower(payload.payout_status)==='payout_received' ? nowIso() : '',
    status: lower(payload.status || 'will_come_for_interview') || 'will_come_for_interview',
    payout_status: lower(payload.payout_status || 'payout_pending') === 'payout_received' ? 'payout_received' : 'payout_pending',
    payout_amount: moneyText(payload.payout_amount),
    resume_filename: candidate.resume_filename || '',
    recording_filename: candidate.recording_filename || '',
    notes: payload.notes || '',
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by_user_id: payload.created_by_user_id || '',
  };
}

async function getMonthlyTarget() {
  try {
    const settings = await table('settings');
    const row = settings.find((item) => lower(item.setting_key) === 'pipeline_monthly_target');
    const value = parseMoney(row?.setting_value || row?.notes || '');
    return value || DEFAULT_MONTH_TARGET;
  } catch {
    return DEFAULT_MONTH_TARGET;
  }
}

async function setMonthlyTarget(value) {
  const sanitized = Math.max(0, parseMoney(value));
  const finalValue = sanitized || DEFAULT_MONTH_TARGET;
  const payload = {
    setting_key: 'pipeline_monthly_target',
    setting_value: String(finalValue),
    notes: 'Pipeline monthly target',
    Instructions: '',
  };
  if (mode === 'postgres') {
    const existing = await store.one(`select setting_key from public.settings where lower(setting_key) = 'pipeline_monthly_target' limit 1`);
    if (existing) await store.update('settings', 'setting_key', existing.setting_key, payload);
    else await store.insert('settings', payload);
    return finalValue;
  }
  const settings = await table('settings');
  const existing = settings.find((item) => lower(item.setting_key) === 'pipeline_monthly_target');
  if (existing) await store.update('settings', 'setting_key', existing.setting_key, payload);
  else await store.insert('settings', payload);
  return finalValue;
}

function financialRows(entries=[]) {
  const groups=new Map(),safe=[],issues=[];
  for(const row of entries){const key=row.revenue_id||normalizeCandidateCode(row.candidate_id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
  for(const [id,rows] of groups) {
    if(rows.some(r=>r.invalid_payout||r.retention_inconsistent||r.candidate_missing)){issues.push({candidate_id:id,reason:'Invalid amount, retention date, or missing candidate.'});continue}
    const signature=r=>JSON.stringify([r.client_name,r.process,r.recruiter_code,r.recruiter_name,r.status,r.payout_status,moneyValue(r.payout_amount),r.joined_date,r.payout_received_at||'']);
    if(new Set(rows.map(signature)).size>1){issues.push({candidate_id:id,reason:'Conflicting duplicate revenue records.'});continue}
    safe.push(rows[0]);
    if(lower(rows[0].payout_status)==='payout_received' && !['joined','completed_60_days'].includes(lower(rows[0].status))) issues.push({candidate_id:id,reason:'Payment was already received but candidate later left/backed out: check refund or adjustment. Cash receipt remains in history; recognized joining income is excluded.'});
    if(rows.length>1)issues.push({candidate_id:id,reason:'Identical duplicate revenue records counted once; originals retained.'});
  }
  return {safe,issues};
}
function sumMoney(rows=[]) {return rows.reduce((sum,row)=>sum+Math.round(parseMoney(row.payout_amount)*100),0)/100;}

function buildWindowSummary(entries) {
  const today = todayIst();
  const { start: weekStart, end: weekEnd } = weekRange(today);
  const month = isoMonth(today);
  const eligibleJoinedStatuses = new Set(['joined', 'completed_60_days']);
  const thisMonthJoined = entries.filter((item) => eligibleJoinedStatuses.has(lower(item.status)) && item.joined_date && isoMonth(item.joined_date) === month);
  const received=entries.filter(item=>lower(item.payout_status)==='payout_received' && isoMonth(item.payout_received_at)===month);
  const monthIncome=sumMoney(received);
  const monthExpected=sumMoney(thisMonthJoined.filter(item=>lower(item.payout_status)!=='payout_received'));
  return {
    today_interviews: entries.filter((item) => item.interview_date === today).length,
    week_interviews: entries.filter((item) => item.interview_date && item.interview_date >= weekStart && item.interview_date <= weekEnd).length,
    month_interviews: entries.filter((item) => item.interview_date && isoMonth(item.interview_date) === month).length,
    month_joined: thisMonthJoined.length,
    month_income: sumMoney(thisMonthJoined),
    month_cash_received: monthIncome,
    month_expected_payout: monthExpected,
    legacy_receipt_dates_unknown: entries.filter(item=>lower(item.payout_status)==='payout_received'&&!item.payout_received_at).length,
  };
}

function buildAnalytics(entries,monthTarget) {
  const finance=financialRows(entries);entries=finance.safe;
  const byClientMap = new Map();
  const byRecruiterMap = new Map();
  const byCommunicationMap = new Map();

  function touch(map, label) {
    const key = safeLabel(label);
    if (!map.has(key)) map.set(key, { label: key, interviewed: 0, selected: 0, joined: 0, retained: 0, interviews: 0, revenue: 0 });
    return map.get(key);
  }

  entries.forEach((entry) => {
    const counts = statusCounts(entry);
    const client = touch(byClientMap, entry.client_name);
    const recruiter = touch(byRecruiterMap, entry.recruiter_name);
    const communication = touch(byCommunicationMap, entry.communication_skill || 'Not Updated');
    [client, recruiter, communication].forEach((bucket) => {
      bucket.interviewed += counts.interviewed;
      bucket.selected += counts.selected;
      bucket.joined += counts.joined;
      bucket.retained += counts.retained;
      bucket.interviews += counts.interviews;
      bucket.revenue=Math.round((bucket.revenue+counts.revenue)*100)/100;
    });
  });

  function finalize(list) {
    return list.map((item) => ({
      ...item,
      selection_rate: clampPercent(item.interviewed ? (item.selected / item.interviewed) * 100 : 0),
      joining_rate: clampPercent(item.selected ? (item.joined / item.selected) * 100 : 0),
      retention_rate: clampPercent(item.joined ? (item.retained / item.joined) * 100 : 0),
    }));
  }

  const byClient = finalize([...byClientMap.values()]);
  const byRecruiter = finalize([...byRecruiterMap.values()]);
  const byCommunication = finalize([...byCommunicationMap.values()]);
  const topRevenueClient = buildRank(byClient, 'revenue')[0] || null;
  const topSelectionClient = buildRank(byClient, 'selection_rate')[0] || null;
  const topRetentionClient = buildRank(byClient, 'retention_rate')[0] || null;
  const topRecruiter = buildRank(byRecruiter, 'joined')[0] || null;

  const windowSummary = buildWindowSummary(entries);
  const monthAchievementPercent = clampPercent(monthTarget ? (windowSummary.month_income / monthTarget) * 100 : 0);
  const insights = [
    topRevenueClient ? `${topRevenueClient.label} earned the most revenue: ₹${Math.round(topRevenueClient.revenue)}.` : '',
    topSelectionClient ? `${topSelectionClient.label} has the highest selection rate: ${topSelectionClient.selection_rate}%.` : '',
    topRetentionClient ? `${topRetentionClient.label} has the highest retention rate: ${topRetentionClient.retention_rate}%.` : '',
    topRecruiter ? `${topRecruiter.label} closed the most joinings: ${topRecruiter.joined}.` : '',
  ].filter(Boolean);

  return {
    summary: {
      ...windowSummary,
      month_target:monthTarget,
      financial_review_count:finance.issues.length,
      financial_review:finance.issues,
      financial_totals_complete:!finance.issues.some(i=>!i.reason.startsWith('Identical')),
      month_achievement_percent: monthAchievementPercent,
    },
    analytics: {
      by_client: buildRank(byClient, 'revenue'),
      by_recruiter: buildRank(byRecruiter, 'joined'),
      by_communication: buildRank(byCommunication, 'selection_rate'),
      insights,
    },
    leaderboard: {
      by_revenue: buildRank(byClient, 'revenue').slice(0, 8),
      by_selection_rate: buildRank(byClient, 'selection_rate').slice(0, 8),
      by_joinings: buildRank(byClient, 'joined').slice(0, 8),
      by_retention: buildRank(byClient, 'retention_rate').slice(0, 8),
      by_interviews: buildRank(byClient, 'interviews').slice(0, 8),
    },
  };
}

async function list(req, res) {
  // The selected employee still determines row access. An authenticated manager
  // retains field visibility so editing that scoped row cannot reset hidden money.
  const viewer=isManager(req.actorUser)?req.actorUser:req.user;
  const visibleEntries = await getVisibleEntries(req.user);
  const filteredRows = visibleEntries.filter((item) => matchesFilter(item, req.query || {}));
  const cardBaseRows = visibleEntries.filter((item) => matchesFilter(item, withoutStageFilters(req.query || {})));
  // Single small settings-row lookup; no extra frontend request or live polling.
  const officePresetRow = await store.findById('app_settings','key','revenue_hub_office_choices_v86').catch(()=>null);
  let officePresets = { clients: CC86_OFFICE_CLIENTS, locations: CC86_OFFICE_LOCATIONS };
  if (officePresetRow?.value) { try { const parsed=JSON.parse(officePresetRow.value); if(Array.isArray(parsed.clients)&&parsed.clients.length&&Array.isArray(parsed.locations)&&parsed.locations.length) officePresets=parsed; }catch{} }
  const config=await revenueConfig(),roster=await visibleRoster(req.user),month=isoMonth(todayIst());
  const monthTarget = isManager(req.user)?Number(config.targets?.[month]?.[req.user.user_id]??await getMonthlyTarget()):Number(config.targets?.[month]?.[req.user.user_id]||0);
  const analyticsPack = buildAnalytics(cardBaseRows, monthTarget);
  const financialSafeRows=financialRows(cardBaseRows).safe;
  const allFinancialSafeRows=financialRows(visibleEntries).safe;
  const candidateProcessOptions = await getVisibleCandidateProcessOptions(req.user);
  const clientCatalog=pipelineCatalog.catalog(config);
  const defaultRules=clientCatalog.map(c=>pipelineCatalog.terms(c.name));
  const personalJoined=financialSafeRows.filter(row=>['joined','completed_60_days'].includes(lower(row.status))&&isoMonth(row.joined_date)===month&&candidateBelongsToUser(row,req.user)).length;
  const teamJoinings=financialSafeRows.filter(row=>['joined','completed_60_days'].includes(lower(row.status))&&isoMonth(row.joined_date)===month&&[req.user.user_id,...(req.user.__ccTeamUserIds||[])].map(String).includes(String(row.recruiter_user_id))).length;
  analyticsPack.summary.personal_month_joined=isManager(req.user)?analyticsPack.summary.month_joined:lower(req.user.role)==='tl'?teamJoinings:personalJoined;
  analyticsPack.summary.joining_target=Number(config.joining_targets?.[month]?.[req.user.user_id]||0);analyticsPack.summary.joining_remaining=Math.max(0,analyticsPack.summary.joining_target-analyticsPack.summary.personal_month_joined);
  if(!isLeadership(viewer)){
    for(const key of Object.keys(analyticsPack.summary))if(/income|cash|payout|financial|target|achievement/.test(key))delete analyticsPack.summary[key];
    const goal=Number(config.joining_targets?.[month]?.[req.user.user_id]||0);
    analyticsPack.summary.joining_target=goal;analyticsPack.summary.joining_remaining=Math.max(0,goal-personalJoined);analyticsPack.summary.month_achievement_percent=goal?clampPercent(personalJoined/goal*100):0;
    for(const [key,val] of Object.entries(analyticsPack.analytics)){
      if(/revenue|insights|client/.test(key)){delete analyticsPack.analytics[key];continue;}
      if(Array.isArray(val))analyticsPack.analytics[key]=val.map(({revenue,...rest})=>rest);
    }
    // Client labels also occur in rankings whose keys do not contain "client".
    // Build recruiter rankings from the already scoped, money-free recruiter rows.
    const people=analyticsPack.analytics.by_recruiter||[];
    analyticsPack.leaderboard={by_joinings:buildRank(people,'joined').slice(0,8),by_interviews:buildRank(people,'interviews').slice(0,8)};
  }
  const targetMonth=/^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(req.query?.target_month||''))?String(req.query.target_month):month;
  const targetFlow=isLeadership(req.user)?targetAllocation.publicFlow(targetAllocation.buildFlow(roster,req.user,config,targetMonth,isManager(req.user)?await getMonthlyTarget():0),allFinancialSafeRows):null;
  const joiningFlow=isLeadership(req.user)?targetAllocation.publicJoiningFlow(targetAllocation.buildJoiningFlow(roster,req.user,config,targetMonth),allFinancialSafeRows):null;
  const targetRows=isLeadership(req.user)?roster.map(u=>({user_id:u.user_id,name:u.full_name||u.username,role:u.role,target:Number((lower(u.role)==='recruiter'?config.joining_targets:config.targets)?.[targetMonth]?.[u.user_id]||0),kind:lower(u.role)==='recruiter'?'joinings':'revenue'})):[];
  return res.json({
    share_default:config.share_default||{type:'number',value:'',group_label:''},share_group:'',joining_flow:joiningFlow,targets:targetRows, target_flow:targetFlow, target_month:targetMonth, client_rules:isLeadership(req.user)?[...defaultRules,...Object.entries(config.rules||{}).filter(([key])=>isManager(req.user)||!key.includes(':')||key.startsWith(req.user.user_id+':')).map(([,value])=>value)]:[],
    items: filteredRows.map(row=>publicEntry(row,viewer)),
    editor:pipelineEditorContext(req,clientCatalog,filteredRows),
    cards: Object.fromEntries(Object.entries(cardSummary(cardBaseRows)).filter(([key])=>isLeadership(viewer)||!key.includes('payout'))),
    summary: analyticsPack.summary,
    analytics: analyticsPack.analytics,
    leaderboard: analyticsPack.leaderboard,
    lookups: {
      clients: isLeadership(viewer)?[...new Set([...clientCatalog.map(c=>c.name),...officePresets.clients])]:[],
      client_catalog:isLeadership(viewer)?clientCatalog:[],
      locations:[...new Set([...clientCatalog.flatMap(c=>c.locations),...officePresets.locations])],
      processes: Array.from(new Set([...candidateProcessOptions, ...visibleEntries.map((item) => item.process).filter(Boolean)])).sort((a, b) => a.localeCompare(b)),
      recruiters: Array.from(new Set([...roster.map(u=>u.full_name||u.username),...visibleEntries.map(item=>item.recruiter_name)].filter(Boolean))).sort(),
      communication_skills: Array.from(new Set(visibleEntries.map((item) => item.communication_skill).filter(Boolean))).sort(),
      experience_ranges: Array.from(new Set(visibleEntries.map((item) => item.experience_range).filter(Boolean))).sort(),
      salary_ranges: Array.from(new Set(visibleEntries.map((item) => item.salary_range).filter(Boolean))).sort(),
      statuses: STATUS_OPTIONS,
      payout_statuses: PAYOUT_OPTIONS,
    },
  });
}

async function searchCandidates(req, res) {
  const items = await getVisibleCandidates(req.user, req.query.q || '');
  const users=await require('../lib/collaborationAccess').roster();
  return res.json({ items:items.map(c=>{const owner=users.find(u=>u.user_id===c.recruiter_user_id||lower(u.recruiter_code)===lower(c.recruiter_code));const tl=users.find(u=>u.user_id===require('../lib/collaborationAccess').primaryTl(owner||{},users));const out={...c,recruiter_id:owner?.recruiter_code||c.recruiter_code||'',tl_id:tl?.recruiter_code||'',tl_name:tl?.full_name||'',recruiter_user_id:owner?.user_id||c.recruiter_user_id||''};if(pipelineEditorContext(req,[]).can_choose_client)out.editor_client_name=String(c.client_name||c.company_name||'');if(!isLeadership(req.user))for(const key of ['client_name','client','company_name'])delete out[key];return out;}) });
}

async function updateTarget(req, res) {
  if (!isManager(req.user)) {
    return res.status(403).json({ message: 'Only manager-level users can update this target.' });
  }
  if (invalidMoney(req.body,'target_amount') || invalidMoney(req.body,'month_target') || invalidMoney(req.body,'target')) return res.status(400).json({message:'Enter a positive numeric amount with up to two decimal places.'});
  const nextTarget = Math.max(0, parseMoney(req.body?.target_amount || req.body?.month_target || req.body?.target || ''));
  if (!nextTarget) {
    return res.status(400).json({ message: 'Enter a valid target amount.' });
  }
  const saved = await setMonthlyTarget(nextTarget);
  return res.json({ ok: true, month_target: saved });
}

async function addCandidate(req,res){
 const candidateId=normalizeCandidateCode(req.body?.candidate_id),candidate=await findCandidateById(candidateId);
 if(!candidate)return res.status(404).json({message:'Candidate not found.'});
 if(!visibleCandidateForUser(candidate,req.user))return res.status(403).json({message:'Profile is outside your team.'});
 const command=String(req.body?.command_id||'');
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(command))return res.status(400).json({message:'Refresh Pipeline Hub before adding an interview.'});
 const actor=String(req.user.user_id||req.user.username),receiptId='pipeline:'+actor+':'+command;
 const body={...req.body};delete body.command_id;
 const hash=crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
 if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',[receiptId]);
 const receipt=await store.findById('crm_command_receipts','command_id',receiptId);
 if(receipt){
  if(receipt.payload_hash!==hash)return res.status(409).json({message:'This interview was already saved with different details. Reopen it or add another interview.'});
  const previous=JSON.parse(receipt.receipt_json),row=await store.findById('revenue_hub_entries','revenue_id',previous.revenue_id);
  if(!row||!isActiveRevenueEntry(row))return res.status(409).json({message:'This saved interview was removed. Add another interview to create a new attempt.'});
  return res.json({item:publicEntry(hydrateEntry(mergeCandidateSnapshot(row,candidate)),req.user),candidate_item:pipelineCandidateReply(candidate),replayed:true});
 }
 const safeBody={...req.body};if(!isLeadership(req.user))for(const name of ['client_name','client','company_name','payout_amount','payout_status','payout_days','payout_duration_days','invoice_lead_days','invoice_status','payout_received_at'])delete safeBody[name];
 const payload={...safeBody,candidate_id:candidateId,created_by_user_id:actor};
 const config=await revenueConfig(),defaults=pipelineCatalog.terms(payload.client_name,payload.preferred_location,payload.process);
 const rule=config.rules?.[(isManager(req.user)?'':String(req.user.tl_user_id||req.user.user_id)+':')+lower(defaults.client_name)]||config.rules?.[lower(defaults.client_name)]||{};
 for(const name of ['payout_amount','payout_days','payout_duration_days','invoice_lead_days'])if(payload[name]===undefined||payload[name]==='')payload[name]=String(name==='payout_amount'&&defaults[name]===4000||['payout_days','payout_duration_days'].includes(name)&&defaults[name]===90?defaults[name]:rule[name]??defaults[name]);
 if(payload.client_name)payload.client_name=defaults.client_name;
 payload.interview_datetime=payload.interview_datetime||toDateTimeText(nowIso());
 for(const [name,title] of [['status','Status'],['client_name','Client'],['process','Process'],['interview_mode','Interview mode'],['preferred_location','Client location']])if((name!=='client_name'||isLeadership(req.user))&&!String(payload[name]??'').trim())return res.status(400).json({message:title+' is required.'});
 const email=String(payload.email??candidate.email??'').trim();
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({message:'Invalid candidate email.'});
 if(Object.hasOwn(payload,'expected_candidate_email')&&String(payload.expected_candidate_email??'')!==String(candidate.email??'')&&email!==String(candidate.email??''))return res.status(409).json({message:'Candidate email changed in another session. Refresh and review before saving.'});
 if(invalidMoney(payload))return res.status(400).json({message:'Enter a non-negative payout amount with up to two decimal places.'});
 if(![45,60,90].includes(Number(payload.payout_duration_days)))return res.status(400).json({message:'Payout duration must be 45, 60 or 90 days.'});
 if(!Number.isInteger(Number(payload.payout_days))||Number(payload.payout_days)<1||Number(payload.payout_days)>365)return res.status(400).json({message:'Payment after joining must be 1-365 days.'});
 const stageError=invalidStage(payload);if(stageError)return res.status(400).json({message:stageError});
 const item=shapeFromCandidate(candidate,{...payload,email});
 item.revenue_id='REV'+crypto.createHash('sha256').update(receiptId).digest('hex').slice(0,28).toUpperCase();
 const inserted=await store.insert('revenue_hub_entries',item);
 if(email!==String(candidate.email||'')){await store.update('candidates','candidate_id',candidate.candidate_id,{email,updated_at:nowIso()});candidate.email=email;}
 await require('./candidateController').saveSharedCandidateOption('process',payload.process);
 await syncLatestInterviewToCandidate(candidateId);
 const note=await savePipelineNote(req,inserted);
 const current=await store.findById('candidates','candidate_id',candidateId);
 const response={item:publicEntry(hydrateEntry(mergeCandidateSnapshot(inserted,current)),req.user),candidate_item:pipelineCandidateReply(current),note,already_existed:false};
 await pipelineChanged();
 await store.insert('crm_command_receipts',{command_id:receiptId,user_id:actor,candidate_id:candidateId,payload_hash:hash,receipt_json:JSON.stringify({revenue_id:item.revenue_id}),created_at:nowIso()});
 return res.json(response);
}

async function shareOpened(req,res){const row=await findCandidateById(String(req.body.candidate_id||''));if(!row||!visibleCandidateForUser(row,req.user))return res.status(404).json({message:'Candidate not found.'});await require('../lib/workflowNotifications').notify(row,req.user,(req.user.full_name||req.user.username)+' opened an arrival share',row.full_name+' · '+(row.process||'')+' · WhatsApp draft opened. Send confirmation remains in WhatsApp.',{open_path:'/revenue-hub?candidate='+encodeURIComponent(row.candidate_id)});return res.json({ok:true});}
async function deleteEntry(req, res) {
  if (!canDeletePipelineEntry(req.user)) {
    return res.status(403).json({ message: 'Only managers can delete pipeline entries.' });
  }
  const revenueId = String(req.params.revenueId || '').trim();
  if (!revenueId || revenueId.length > 128) return res.status(400).json({message:'Choose one Revenue Hub entry to remove.'});
  // CC858: row-level lock inside transactionalHandler prevents two concurrent
  // actions from silently modifying the same revenue entry. No candidate write.
  const existing = store.pool
    ? await store.one('select * from public.revenue_hub_entries where revenue_id=$1 for update',[revenueId])
    : await store.findById('revenue_hub_entries','revenue_id',revenueId);
  if (!existing) return res.status(404).json({ message: 'Revenue Hub entry not found.' });
  if (!isActiveRevenueEntry(existing)) return res.status(409).json({message:'This entry has already been removed. Refresh Revenue Hub.'});
  const expected=String(req.query?.expected_updated_at||'').trim();
  if(expected && expected!==String(existing.updated_at||''))return res.status(409).json({message:'This Revenue Hub entry changed in another session. Reload and review it before removing.'});
  const stamp=nowIso();
  // Soft-delete this revenue_id ONLY. Never update/delete candidates, notes,
  // submissions, interviews, candidate assets, or any other table.
  // CC859: Use only existing Revenue Hub columns. CC858 wrote deleted_by_name
  // and deleted_by_user_id, which are not guaranteed in older Supabase schemas;
  // an undefined-column error prevented the delete entirely. The original
  // revenue row is preserved (soft-delete); no unrelated record is touched.
  const removed = await store.update('revenue_hub_entries', 'revenue_id', revenueId, {
    status: 'Deleted', deleted_at: stamp, updated_at: stamp,
  });
  if (!removed) return res.status(409).json({message:'Could not mark this Revenue Hub entry as removed. Reload and retry.'});
  return res.json({ ok: true, revenue_id: revenueId });
}

async function updateStatus(req, res) {
  const revenueId = String(req.params.revenueId || '').trim();
  // Lock candidate FIRST, then revenue: same lock order as candidate Save avoids deadlocks.
  const candidateLink=store.pool ? await store.one('select candidate_id from public.revenue_hub_entries where revenue_id=$1',[revenueId]) : await store.findById('revenue_hub_entries','revenue_id',revenueId);
  if(candidateLink?.candidate_id && store.pool) await store.query('select candidate_id from public.candidates where candidate_id=$1 for update',[candidateLink.candidate_id]);
  const existing = store.pool ? await store.one('select * from public.revenue_hub_entries where revenue_id=$1 for update',[revenueId]) : await store.findById('revenue_hub_entries','revenue_id',revenueId);
  if (!existing) return res.status(404).json({ message: 'Pipeline entry not found.' });
  if (!isActiveRevenueEntry(existing)) return res.status(409).json({message:'This entry was removed. Reload the Revenue Hub.'});
  const linkedProfile=existing.candidate_id?await store.findById('candidates','candidate_id',existing.candidate_id):null;
  if(!linkedProfile||!visibleCandidateForUser(linkedProfile,req.user))return res.status(403).json({message:'Revenue entry is outside your team.'});
  // The linked candidate's current owner permissions also apply to revenue edits.
  if (existing.candidate_id) {
    const candidate=await store.findById('candidates','candidate_id',existing.candidate_id);
    if (candidate && !visibleCandidateForUser(candidate,req.user)) return res.status(403).json({message:'Candidate profile is outside your team.'});
  }
  if(!isLeadership(req.user)){req.body={...req.body};for(const key of ['client_name','client','company_name','payout_amount','payout_status','payout_received_at','payout_days','payout_duration_days','invoice_lead_days','invoice_status'])delete req.body[key];}
  for(const [field,stored] of [['client_name','client_name'],['process','process'],['preferred_location','location'],['location','location']])if(Object.hasOwn(req.body||{},field)&&(field==='process'?singleProcess(req.body[field])!==singleProcess(existing[stored]):String(req.body[field]??'').trim()!==String(existing[stored]??'').trim()))return res.status(409).json({message:'Use Add another interview to change client, process or client location. The saved interview history is kept.',code:'PIPELINE_NEW_INTERVIEW_REQUIRED'});
  if(req.body?.expected_updated_at && req.body.expected_updated_at !== existing.updated_at) return res.status(409).json({message:'This row changed in another session. Reload it before saving.'});
  if(Object.prototype.hasOwnProperty.call(req.body||{},'email') && String(req.body.email??'').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(req.body.email).trim()))return res.status(400).json({message:'Invalid candidate email.'});
  if(Object.prototype.hasOwnProperty.call(req.body||{},'expected_candidate_email') && String(req.body.expected_candidate_email??'')!==String(linkedProfile.email??'') && String(req.body.email??'')!==String(linkedProfile.email??'')) return res.status(409).json({message:'Candidate email changed in another session. Refresh and review before saving.'});
  if(invalidMoney(req.body)) return res.status(400).json({message:'Enter a non-negative payout amount with up to two decimal places.'});
  if(isLeadership(req.user)&&req.body?.payout_duration_days!==undefined&&![45,60,90].includes(Number(req.body.payout_duration_days))) return res.status(400).json({message:'Payout duration must be 45, 60 or 90 days.'});
  if(isLeadership(req.user)&&req.body?.payout_days!==undefined&&(!Number.isInteger(Number(req.body.payout_days))||Number(req.body.payout_days)<1||Number(req.body.payout_days)>365)) return res.status(400).json({message:'Payment after joining must be 1-365 days.'});
  const nextStatus = lower(req.body?.status || existing.status);
  const previousRevenueStatus = lower(existing.status);
  // A real received payment is kept as history on backout, never silently reversed.
  // When not yet received, clear the active payout state on exit.
  const stageBody=(!['joined','completed_60_days'].includes(nextStatus) && lower(existing.payout_status)!=='payout_received')
    ? {...req.body,payout_status:'payout_pending'} : req.body;
  const stageError=invalidStage(stageBody,existing);
  if(stageError && !(stageError==='Payout received requires a joined profile.' && lower(existing.payout_status)==='payout_received' && !['joined','completed_60_days'].includes(nextStatus))) return res.status(400).json({message:stageError});
  if (!STATUS_OPTIONS.includes(nextStatus)) return res.status(400).json({ message: 'Invalid status.' });
  const nextPayout = lower(stageBody?.payout_status || existing.payout_status || 'payout_pending');
  if (!PAYOUT_OPTIONS.includes(nextPayout)) return res.status(400).json({ message: 'Invalid payout status.' });
  const interviewDateTime = toDateTimeText(req.body?.interview_datetime || existing.interview_datetime || req.body?.interview_date || existing.interview_date || '');
  const updates = {
    status: nextStatus,
    payout_status: nextPayout,
    client_name: String(req.body?.client_name ?? existing.client_name ?? ''),
    process: String(req.body?.process ?? existing.process ?? ''),
    location: String(req.body?.preferred_location ?? req.body?.location ?? existing.location ?? ''),
    qualification: String(req.body?.qualification ?? existing.qualification ?? ''),
    interview_datetime: interviewDateTime,
    interview_date: toDateOnly(interviewDateTime || req.body?.interview_date || existing.interview_date),
    submission_date: toDateOnly(req.body?.submission_date || existing.submission_date),
    joining_date: toDateOnly(req.body?.joining_date || existing.joining_date),
    selection_date: toDateOnly(req.body?.selection_date || existing.selection_date),
    joined_date: toDateOnly(req.body?.joined_date || existing.joined_date),
    communication_skill: String(req.body?.communication_skill ?? existing.communication_skill ?? ''),
    experience_range: String(req.body?.experience_range ?? existing.experience_range ?? ''),
    salary_range: String(req.body?.salary_range ?? existing.salary_range ?? ''),
    payout_amount: moneyText(req.body?.payout_amount ?? existing.payout_amount ?? ''),
    notes: String(req.body?.notes ?? existing.notes ?? ''),
    email: String(req.body?.email ?? existing.email ?? ''),
    interview_mode: normalizeInterviewMode(req.body?.interview_mode || existing.interview_mode || ''),
    arrived_at: existing.arrived_at || (nextStatus === 'appeared_for_interview' ? nowIso() : ''),
    updated_at: new Date(Math.max(Date.now(),(Date.parse(existing.updated_at)||0)+1)).toISOString(),
  };
  if (nextStatus === 'selected' && !updates.selection_date) updates.selection_date = todayIst();
  if (nextStatus === 'pending_joining' && !updates.selection_date) updates.selection_date = todayIst();
  if (nextStatus === 'joined' && !updates.joined_date) updates.joined_date = todayIst();
  if (nextStatus === 'completed_60_days' && !updates.joined_date) updates.joined_date = existing.joined_date || todayIst();
  // Historical dates survive reversals; current status controls recognition.


  if (!['joined','completed_60_days'].includes(nextStatus) && lower(existing.payout_status) !== 'payout_received') updates.payout_status = 'payout_pending';
  updates.payout_received_at = updates.payout_status === 'payout_received' ? (existing.payout_received_at || (lower(existing.payout_status)==='payout_received' ? '' : nowIso())) : ''; 
  if(['joined','completed_60_days'].includes(nextStatus)&&!updates.joined_date)updates.joined_date=todayIst();
  for(const key of ['payout_days','payout_duration_days','invoice_lead_days','invoice_status'])if(isLeadership(req.user)&&req.body?.[key]!==undefined)updates[key]=String(req.body[key]);
  // Payment and retention are separate facts; payout never advances the 60-day clock.
  let item;
  try {
    item = await store.update('revenue_hub_entries', 'revenue_id', revenueId, updates);
  } catch (error) {
    if (isMissingColumnError(error, 'payout_duration_days')) return res.status(503).json({message:'Revenue Hub needs the included 62 safe ADD COLUMN SQL before payout duration can be saved. No status or payout was changed.'});
    if (!isMissingColumnError(error, 'interview_mode')) throw error;
    const fallbackUpdates = { ...updates };
    delete fallbackUpdates.interview_mode;
    item = await store.update('revenue_hub_entries', 'revenue_id', revenueId, fallbackUpdates);
  }
  if(Object.prototype.hasOwnProperty.call(req.body||{},'email')&&String(req.body.email??'')!==String(linkedProfile.email??''))await store.update('candidates','candidate_id',existing.candidate_id,{email:String(req.body.email??'').trim(),updated_at:nowIso()});
  // Only the latest interview drives the current profile; old attempts remain history.
  const latest=await findRevenueEntryByCandidateId(existing.candidate_id);
  if(latest?.revenue_id===revenueId)await syncLatestInterviewToCandidate(existing.candidate_id);
  const note=await savePipelineNote(req,item,existing.notes);
  const current=await store.findById('candidates','candidate_id',existing.candidate_id);
  if(String(updates.process||'').trim())await require('./candidateController').saveSharedCandidateOption('process',updates.process);
  await require('../lib/workflowNotifications').updated(linkedProfile,current,req.user);
  await pipelineChanged();
  return res.json({item:publicEntry(hydrateEntry({...mergeCandidateSnapshot(item,current),is_latest_interview:latest?.revenue_id===revenueId}),req.user),candidate_item:pipelineCandidateReply(current),note});
}

function pipelineReminderTime(value){let raw=String(value||'').trim();if(/^\d{4}-\d{2}-\d{2}$/.test(raw))raw+='T09:00:00+05:30';else if(raw&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw))raw+='+05:30';return Date.parse(raw)||Date.now();}
async function reminderItems(user){
 const items=(await getVisibleEntries(user)).filter(item=>{
  const status=lower(item.status);if(require('../lib/bucketPolicy').isInactiveProfile(item)||['rejected','not_joined'].includes(status))return false;
  if(['joined','completed_60_days'].includes(status)&&lower(item.payout_status)==='payout_received')return false;
  if(isLeadership(user)&&(!String(item.client_name||'').trim()||['joined','completed_60_days'].includes(status)&&!Number(item.payout_amount)))return true;
  if(['will_come_for_interview','appeared_for_interview'].includes(status)&&item.interview_date&&item.interview_date<=shiftDate(todayIst(),1))return true;
  if(['selected','pending_joining'].includes(status)&&item.joining_pending_due)return true;
  return isLeadership(user)&&item.payout_pending;
 }).map(row=>{const status=lower(row.status);let title=lower(row.status)==='appeared_for_interview'?'EG okay or not? · Feedback due':'Interview arrival confirmation due',interval=7200;if(['selected','pending_joining'].includes(status))title=row.joining_date?'Joining confirmation pending':'Add the joining date';if(row.payout_pending){title=row.invoice_status==='sent'?'Payout pending':'Invoice / payout reminder';interval=86400;}if(isLeadership(user)&&!String(row.client_name||'').trim())title='Add the client details';else if(isLeadership(user)&&['joined','completed_60_days'].includes(status)&&!Number(row.payout_amount))title='Set the payout per joining';return {...publicEntry(row,user),title,message:row.full_name+' · '+(row.joining_date||row.interview_date||row.payout_due_date||''),reminder_due_at:new Date(status==='will_come_for_interview'?pipelineReminderTime(row.interview_datetime||row.interview_date):interval===7200?(Date.parse(row.arrived_at||row.updated_at||row.created_at)||Date.now())+7200000:pipelineReminderTime(row.payout_due_date||row.joining_date||row.updated_at||row.created_at)).toISOString(),repeat_after_seconds:interval,reminder_id:'revenue:'+row.revenue_id+':'+status,open_url:'/revenue-hub?entry='+encodeURIComponent(row.revenue_id)};});
 return items;
}

async function reminders(req,res){const items=await reminderItems(req.user);return res.json({items,item:items[0]||null});}

async function logoutCheck(req, res) {
  if (!isLeadership(req.user)) return res.json({ blocked: false, count: 0, items: [] });
  const hour = new Date(Date.now()+330*60000).getUTCHours();
  if (hour < 17) return res.json({ blocked: false, count: 0, items: [] });
  const items = (await getVisibleEntries(req.user)).filter((item) => ['will_come_for_interview', 'appeared_for_interview'].includes(lower(item.status)) && item.interview_date && item.interview_date <= todayIst());
  return res.json({ blocked: items.length > 0, count: items.length, items: items.slice(0, 12) });
}

async function exportCsv(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can export Revenue Hub data.' });
  const items = (await getVisibleEntries(req.user)).filter((item) => matchesFilter(item, req.query || {})).map((item) => ({
    candidate_code: item.candidate_id,
    name: item.full_name,
    number: item.phone,
    client: item.client_name,
    process: item.process,
    recruiter: item.recruiter_name,
    communication_skill: item.communication_skill,
    experience_range: item.experience_range,
    salary_range: item.salary_range,
    submission_date: item.submission_date,
    interview_datetime: item.interview_datetime || item.interview_date,
    selection_date: item.selection_date,
    joining_date: item.joining_date,
    joined_date: item.joined_date,
    status: item.status,
    payout_status: item.payout_status,
    payout_amount: item.payout_amount,
    resume_filename: item.resume_filename,
    recording_filename: item.recording_filename,
    notes: item.notes,
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="revenue_hub_export.csv"');
  return res.send(buildCsv(items));
}


// CC851: Two distinct, durable candidate-scoped Revenue Hub assets. Never store a
// photograph as the extraction source or return original resume bytes in list API.
const REVENUE_ASSET_KINDS={client_image:'revenue_client_image',original_resume:'revenue_original_resume'};
async function authorizedAssetCandidate(req,res){
 const candidateId=normalizeCandidateCode(req.params.candidateId);
 const candidate=await findCandidateById(candidateId);
 if(!candidate||String(candidate.deleted_at||'').trim()){res.status(404).json({message:'Candidate not found.'});return null;}
 if(!visibleCandidateForUser(candidate,req.user)){res.status(403).json({message:'Profile is outside your access.'});return null;}
 return candidate;
}
const safeAssetMeta=row=>({file_id:row.file_id,kind:Object.keys(REVENUE_ASSET_KINDS).find(k=>REVENUE_ASSET_KINDS[k]===row.file_kind)||'',file_name:row.original_name,mime_type:row.mime_type,size_bytes:row.size_bytes,created_at:row.created_at});
async function listRevenueAssets(req,res){
 const candidate=await authorizedAssetCandidate(req,res);if(!candidate)return;
 const files=store.pool?await store.query("select file_id,candidate_id,file_kind,original_name,mime_type,size_bytes,created_at from public.candidate_files where candidate_id=$1 and file_kind in ('revenue_client_image','revenue_original_resume') order by created_at desc limit 50",[candidate.candidate_id]):(await table('candidate_files')).filter(row=>String(row.candidate_id)===String(candidate.candidate_id)&&Object.values(REVENUE_ASSET_KINDS).includes(row.file_kind));
 files.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
 const assets={};for(const row of files){const kind=safeAssetMeta(row).kind;if(kind&&!assets[kind])assets[kind]=safeAssetMeta(row);}
 res.set('Cache-Control','no-store');return res.json({ok:true,assets});
}
async function uploadRevenueAsset(req,res){
 // CC852: Never persist a new resume or client-image into candidate_files,
 // Supabase Storage, server disk, JSON state or any other durable location.
 // Existing historic rows are deliberately untouched (no destructive migration).
 res.set('Cache-Control','private, no-store');
 return res.status(410).json({message:'Permanent Revenue Hub file uploads are disabled. Select the resume in the form for transient extraction/device sharing only.'});
}

async function getRevenueAsset(req,res){
 const candidate=await authorizedAssetCandidate(req,res);if(!candidate)return;
 const row=await store.findById('candidate_files','file_id',String(req.params.fileId||''));
 if(!row||String(row.candidate_id)!==String(candidate.candidate_id)||!Object.values(REVENUE_ASSET_KINDS).includes(row.file_kind))return res.status(404).json({message:'Resume asset not found.'});
 if(!String(row.content_base64||''))return res.status(404).json({message:'File content unavailable.'});
 res.set('Cache-Control','no-store');return res.json({ok:true,file_name:row.original_name,mime_type:row.mime_type,content_base64:row.content_base64});
}
module.exports = {
  reminderItems,
  publicEntry,
  getVisibleEntries,
  listRevenueAssets, uploadRevenueAsset:transactionalHandler(uploadRevenueAsset), getRevenueAsset,
  shareOpened:require('../lib/store').transactionalHandler(shareOpened),
  STATUS_OPTIONS,
  PAYOUT_OPTIONS,
  syncCandidateStatusToRevenue,
  revenueStageFromCandidateStatus,
  pipelineAttemptTime, latestAttemptFirst, syncLatestInterviewToCandidate,
  list,
  updateConfig:transactionalHandler(updateConfig),
  searchCandidates,
  updateTarget,
  addCandidate:transactionalHandler(addCandidate),
  updateStatus:transactionalHandler(updateStatus),
  deleteEntry:transactionalHandler(deleteEntry),
  reminders,
  logoutCheck,
  exportCsv,
};
