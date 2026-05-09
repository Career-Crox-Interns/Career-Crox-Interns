const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { store, table, mode } = require('../lib/store');
const { containsText, nextId, nowIso, ymd, calcExperienceRange, calcSalaryRange, recruiterCodeMatches, normalizeIndianPhone, phoneMatches, candidateIdentityKey } = require('../lib/helpers');
const { normalizeWhitespace, htmlToText } = require('../lib/extractors');
const { createTimedCache, clearAllCaches } = require('../lib/cache');
const { maskPhoneValue, sanitizeCandidateForUser, sanitizeCandidateListForUser } = require('../lib/dataLeakGuard');
const { reminderTriggerNowMs, dueInMinutes } = require('../lib/reminderWindow');
const { userRole, isLeadership: isAccessLeadership, isAdminOrManager, candidateBelongsToUser, candidateScopeSql } = require('../lib/accessRules');

const PROCESS_OPTIONS = [
  'Air India', 'Airtel', 'UrbanClap', 'Kotak', 'Tata 1mg', 'Axis Bank', 'Samsung',
  'Tata Motors', 'Icegate', 'Icertate', 'Xiaomi', 'Xiaomi - Regional Language', 'American Express',
  'Razorpay', 'RBL / OLX', 'HDFC Back Office', 'Other',
];

const candidateListCache = createTimedCache(30000);
const candidateNavCache = createTimedCache(60000);
const duplicateReviewCache = createTimedCache(45000);
const MAX_FILE_BYTES = Number(process.env.CANDIDATE_FILE_MAX_BYTES || (25 * 1024 * 1024));
const STRICT_RESUME_MAX_BYTES = Number(process.env.CANDIDATE_RESUME_MAX_BYTES || (512 * 1024));
const STRICT_RECORDING_MAX_BYTES = Number(process.env.CANDIDATE_RECORDING_MAX_BYTES || (4 * 1024 * 1024));
const ALLOWED_FILE_TYPES = new Set(['resume', 'call_recording']);
const RESUME_ALLOWED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.docm', '.dotx', '.dotm', '.odt', '.rtf', '.txt', '.html', '.htm', '.md']);
const RECORDING_ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm', '.mp4', '.amr', '.3gp', '.mov']);


const PERSISTED_CANDIDATE_FIELDS = [
  'candidate_id','call_connected','looking_for_job','full_name','phone','location','qualification','recruiter_code',
  'preferred_location','in_hand_salary','relevant_experience','communication_skill','process','interview_reschedule_date',
  'virtual_onsite','notes','reference_details','follow_up_at','status','all_details_sent','submission_date','approval_status',
  'approved_at','approved_by_name','career_gap','recording_filename','resume_filename','documents_availability',
  'relevant_experience_range','relevant_in_hand_range','total_experience','manager_crm','interview_remove_request_id',
  'interview_remove_status','interview_remove_reason','interview_remove_approved_at','submitted_by','data_uploading_date',
  'data_notes','qualification_level','ctc_monthly','recruiter_name','recruiter_designation','interview_availability',
  'approval_requested_at','is_duplicate','follow_up_note','follow_up_status','profile_priority','bucket_assigned_at','created_at','updated_at',
  'experience','source_sr_no','last_dialed_at','last_dialed_by_name','dial_attempt_count','last_viewed_at','last_viewed_by_name',
  'duplicate_main_choice','duplicate_main_marked_at','duplicate_main_marked_by','deleted_at','deleted_by',
  'lead_source','hot_lead_status','profile_status','jd_name','jd_notes','employee_code','employee_no','employee_name','employee_file_url','employee_row_no','last_updated_at'
];
const CANDIDATE_SELECT_SQL = PERSISTED_CANDIDATE_FIELDS.map((field) => `"${field}"`).join(', ');
const candidateColumnCache = { fetched_at: 0, columns: null };

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
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (minValue !== '' && Number.isFinite(Number(minValue)) && n < Number(minValue)) return false;
  if (maxValue !== '' && Number.isFinite(Number(maxValue)) && n > Number(maxValue)) return false;
  return true;
}
function lower(value) {
  return String(value || '').trim().toLowerCase();
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
  clearAllCaches();
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
  const current = lower(rawValue);
  if (current === 'non - graduate' || current === 'non-graduate' || current === 'nongraduate') return 'NON - Graduate';
  if (current === 'graduate') return 'Graduate';
  const combined = lower(`${rawValue} ${rawFallback}`);
  if (/(^|\b)(non[\s-]*grad|under[\s-]*grad|undergraduate|ug pursuing|pursuing|appearing|final year|last year|12th|10th|intermediate|higher secondary|hsc|diploma|iti)(\b|$)/i.test(combined)) return 'NON - Graduate';
  if (/(^|\b)(post[\s-]*grad|graduate|b\.?a|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|mba|mca|m\.?a|m\.?com|m\.?sc|mtech|m\.?tech|phd|master|bachelor)(\b|$)/i.test(combined)) return 'Graduate';
  return 'Graduate';
}

function qualificationCategorySql() {
  return `(
    case
      when lower(concat_ws(' ', coalesce(qualification_level, ''), coalesce(qualification, ''))) ~ '(\mnon[[:space:]-]*grad\M|\munder[[:space:]-]*grad\M|\mundergraduate\M|\mug pursuing\M|\mpursuing\M|\mappearing\M|\mfinal year\M|\mlast year\M|\m12th\M|\m10th\M|\mintermediate\M|\mhigher secondary\M|\mhsc\M|\mdiploma\M|\miti\M)'
        then 'non - graduate'
      when lower(concat_ws(' ', coalesce(qualification_level, ''), coalesce(qualification, ''))) ~ '(\mpost[[:space:]-]*grad\M|\mgraduate\M|\mb\.?a\M|\mb\.?com\M|\mb\.?sc\M|\mb\.?tech\M|\mbtech\M|\mbca\M|\mbba\M|\mmba\M|\mmca\M|\mm\.?a\M|\mm\.?com\M|\mm\.?sc\M|\mmtech\M|\mm\.?tech\M|\mphd\M|\mmaster\M|\mbachelor\M)'
        then 'graduate'
      else 'graduate'
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
    updated_at: source.updated_at || '',
  };
  if (includeExtended) {
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
    const statusSql = normalizedStatuses.length
      ? `and lower(coalesce(approval_status, '')) = any($2::text[])`
      : '';
    const params = normalizedStatuses.length ? [candidateId, normalizedStatuses] : [candidateId];
    try {
      return await store.one(`select submission_id, jd_id, approval_status from public.submissions where candidate_id = $1 ${statusSql} order by coalesce(submitted_at, approval_requested_at, updated_at, '') desc limit 1`, params);
    } catch (error) {
      if (!isUndefinedColumnError(error, ['updated_at'])) throw error;
      return store.one(`select submission_id, jd_id, approval_status from public.submissions where candidate_id = $1 ${statusSql} order by coalesce(submitted_at, approval_requested_at, '') desc limit 1`, params);
    }
  }
  const submissions = await table('submissions');
  const hit = submissions
    .filter((row) => {
      if (String(row.candidate_id) !== String(candidateId)) return false;
      if (!normalizedStatuses.length) return true;
      return normalizedStatuses.includes(lower(row.approval_status));
    })
    .sort((a, b) => String(b.submitted_at || b.approval_requested_at || b.updated_at || '').localeCompare(String(a.submitted_at || a.approval_requested_at || a.updated_at || '')))[0] || null;
  return hit ? { submission_id: hit.submission_id, jd_id: hit.jd_id, approval_status: hit.approval_status || '' } : null;
}

async function findPendingSubmissionCompat(candidateId) {
  return findSubmissionCompat(candidateId, ['pending']);
}

async function findLatestSubmittedSubmissionCompat(candidateId) {
  return findSubmissionCompat(candidateId, ['pending', 'approved']);
}

async function saveSubmissionCompat(existingSubmissionId, submission) {
  const fullPayload = pickSubmissionCompatFields(submission, true);
  if (!(mode === 'postgres' && store.pool)) {
    return existingSubmissionId
      ? store.update('submissions', 'submission_id', existingSubmissionId, fullPayload)
      : store.insert('submissions', fullPayload);
  }
  try {
    return existingSubmissionId
      ? await store.update('submissions', 'submission_id', existingSubmissionId, fullPayload)
      : await store.insert('submissions', fullPayload);
  } catch (error) {
    if (!isUndefinedColumnError(error, ['submitted_by_user_id', 'submitted_by_name', 'submitted_by_recruiter_code'])) throw error;
    const legacyPayload = pickSubmissionCompatFields(submission, false);
    return existingSubmissionId
      ? store.update('submissions', 'submission_id', existingSubmissionId, legacyPayload)
      : store.insert('submissions', legacyPayload);
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
  candidateListCache.clear();
  candidateNavCache.clear();
  duplicateReviewCache.clear();
  clearAllCaches();
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
    else out[key] = value;
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
function cleanDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}
function splitCsv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}
function parseMultiValue(value) {
  if (Array.isArray(value)) return value.flatMap((item) => splitCsv(item));
  return splitCsv(value);
}
function phoneSearchSql(valueExpression, placeholder) {
  return `right(regexp_replace(coalesce(${valueExpression}, ''), '\D', '', 'g'), 10) like '%' || right(regexp_replace(${placeholder}, '\D', '', 'g'), 10) || '%'`;
}
const BUCKET_MAX_ACTIVE = 70;
const BUCKET_TOTAL_DAYS = 7;
const BUCKET_WARNING_DAYS = 3;
const TERMINAL_STATUSES = new Set(['closed', 'joined', 'hired', 'rejected', 'not interested', 'not_interested', 'completed', 'done']);
const TERMINAL_APPROVALS = new Set([]);

function isLeadership(user) {
  return isAccessLeadership(user);
}
function canManageBucketOut(user) {
  return isAdminOrManager(user);
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
function computeBucketMeta(row) {
  const assignedRaw = pickBucketAssignedAt(row);
  const today = startOfDay(new Date()) || new Date();
  const assignedDay = startOfDay(assignedRaw) || today;
  const daysPassed = daysBetween(today, assignedDay);
  const daysLeft = Math.max(0, BUCKET_TOTAL_DAYS - daysPassed);
  const terminal = isTerminalCandidate(row);
  const fresh = isFreshCandidate(row);
  const followup = isFollowupCandidate(row);
  const pendingFollowup = isPendingFollowup(row);
  const bucketOut = !terminal && daysPassed >= BUCKET_TOTAL_DAYS;
  let stage = 'safe';
  let statusLabel = 'Active';
  let priority = 'Normal';
  if (terminal) {
    stage = 'closed';
    statusLabel = 'Closed';
    priority = 'Done';
  } else if (bucketOut) {
    stage = 'bucket_out';
    statusLabel = 'Bucket Out';
    priority = 'Expired';
  } else if (fresh) {
    stage = 'fresh';
    statusLabel = 'Fresh';
    priority = '';
  } else if (daysLeft <= 1) {
    stage = 'last_day';
    statusLabel = 'Last Day';
    priority = 'Urgent';
  } else if (daysLeft <= BUCKET_WARNING_DAYS) {
    stage = 'warning';
    statusLabel = 'Warning';
    priority = 'High';
  }
  return {
    assignedRaw,
    daysPassed,
    daysLeft,
    terminal,
    fresh,
    followup,
    pendingFollowup,
    bucketOut,
    stage,
    statusLabel,
    priority,
  };
}
function enrichCandidate(row) {
  const meta = computeBucketMeta(row);
  return {
    ...row,
    qualification_level: normalizeQualificationCategory(row?.qualification_level || row?.degree || '', row?.qualification || ''),
    bucket_assigned_at: meta.assignedRaw,
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
    bucket_capacity_max: BUCKET_MAX_ACTIVE,
  };
}
function inferCandidateOwnerRole(row) {
  const designation = lower(row?.recruiter_designation || row?.role || '');
  if (designation.includes('admin')) return 'admin';
  if (designation === 'tl' || designation.includes('team lead') || designation.includes('teamlead')) return 'tl';
  if (designation.includes('manager')) return 'manager';
  if (designation.includes('recruit')) return 'recruiter';
  const code = String(row?.recruiter_code || '').trim().toUpperCase();
  if (code.startsWith('ADM')) return 'admin';
  if (code.startsWith('MGR')) return 'manager';
  if (code.startsWith('TL')) return 'tl';
  if (code.startsWith('CC') || code.startsWith('REC')) return 'recruiter';
  return '';
}
function isUnallocatedCandidate(row) {
  return !String(row?.recruiter_code || '').trim() && !String(row?.recruiter_name || '').trim();
}
function isDeletedCandidate(row) {
  const status = lower(row?.status || '');
  const approval = lower(row?.approval_status || '');
  const details = lower(row?.all_details_sent || '');
  const notes = lower(row?.data_notes || '');
  return Boolean(String(row?.deleted_at || '').trim())
    || status === 'deleted'
    || status === '__deleted__'
    || approval === 'deleted'
    || approval === '__deleted__'
    || details === 'deleted'
    || notes.includes('[crm-deleted]');
}

function visibleCandidate(row, user) {
  if (isDeletedCandidate(row)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager' || role === 'tl') return true;
  return candidateBelongsToUser(row, user);
}

function candidateNavVisibilitySql(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `coalesce(${p}is_duplicate, '0') <> '1'
    and coalesce(${p}deleted_at, '') = ''
    and lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${p}all_details_sent, '')) <> 'deleted'
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
function matchesBucketView(row, filters) {
  const view = lower(filters?.bucket_view || 'all');
  if (!view || view === 'all') return !row.bucket_is_terminal;
  if (view === 'fresh') return row.bucket_is_fresh && !row.bucket_is_bucket_out;
  if (view === 'followup') return row.bucket_is_followup && !row.bucket_is_bucket_out;
  if (view === 'followup_due') return row.bucket_is_followup_due && !row.bucket_is_bucket_out;
  if (view === 'allocated') return !row.bucket_is_bucket_out && !row.bucket_is_terminal && !isUnallocatedCandidate(row);
  if (view === 'warning') return row.bucket_stage === 'warning';
  if (view === 'last_day') return row.bucket_stage === 'last_day';
  if (view === 'safe' || view === 'days_4_plus') return row.bucket_days_left >= 4 && !row.bucket_is_bucket_out && !row.bucket_is_terminal && !row.bucket_is_fresh;
  if (view === 'days_3') return row.bucket_days_left === 3 && !row.bucket_is_bucket_out;
  if (view === 'days_2') return row.bucket_days_left === 2 && !row.bucket_is_bucket_out;
  if (view === 'days_1') return row.bucket_days_left === 1 && !row.bucket_is_bucket_out;
  if (view === 'unallocated') return !row.bucket_is_bucket_out && !row.bucket_is_terminal && isUnallocatedCandidate(row);
  if (view === 'bucket_out' || view === 'all_bucket_out_profiles') return row.bucket_is_bucket_out;
  return !row.bucket_is_bucket_out;
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
  const activeRows = rows.filter((row) => !row.bucket_is_bucket_out && !row.bucket_is_terminal);
  const unallocatedRows = activeRows.filter((row) => isUnallocatedCandidate(row));
  const allocatedRows = activeRows.filter((row) => !isUnallocatedCandidate(row));
  const assignedToUser = !user
    ? []
    : activeRows.filter((row) => candidateBelongsToUser(row, user));
  const myFreshRows = assignedToUser.filter((row) => row.bucket_is_fresh);
  const myWorkingRows = assignedToUser.filter((row) => !row.bucket_is_fresh && !row.bucket_is_followup_due && !row.bucket_is_bucket_out && !row.bucket_is_terminal);

  return {
    total_visible: rows.length,
    active_bucket: activeRows.length,
    bucket_capacity_max: BUCKET_MAX_ACTIVE,
    fresh_profiles: activeRows.filter((row) => row.bucket_is_fresh).length,
    followup_profiles: activeRows.filter((row) => row.bucket_is_followup).length,
    pending_followups: activeRows.filter((row) => row.bucket_is_bucket_out ? false : row.bucket_is_followup_due).length,
    allocated_profiles: allocatedRows.length,
    unallocated_profiles: unallocatedRows.length,
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
  return item;
}

async function logActivity(req, candidateId, actionType, metadata = {}) {
  const item = {
    activity_id: makeFastId('A'),
    user_id: req.user?.user_id || '',
    username: req.user?.username || '',
    action_type: actionType,
    candidate_id: candidateId,
    metadata: safeJsonStringify(metadata),
    created_at: nowIso(),
  };
  await store.insert('activity_log', item);
  return item;
}

function statDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function incrementEmployeeDailyStat(req, counterName, amount = 1) {
  try {
    const allowed = new Set(['calls_count', 'whatsapp_count', 'jd_sent_count']);
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
    else await store.insert('employee_daily_stats', { ...payload, calls_count: payload.calls_count || '0', whatsapp_count: payload.whatsapp_count || '0', jd_sent_count: payload.jd_sent_count || '0', submissions_count: '0', interviews_count: '0', selections_count: '0', joinings_count: '0' });
    return true;
  } catch {
    return false;
  }
}

async function notifyLeaders(title, message, metadata = '') {
  const users = await table('users');
  for (const user of users.filter((u) => isLeadership(u))) {
    await makeNotification(user.user_id, title, message, 'approval', metadata);
  }
}

async function notifyRecruiter(candidate, title, message) {
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
  const canOverrideRecruiter = canManagerReassignRecruiter(user);
  const requestedRecruiterCode = String(merged.recruiter_code || '').trim();
  merged.call_connected = String(merged.call_connected || '').trim() || String(existing?.call_connected || '').trim() || 'No';
  merged.looking_for_job = merged.looking_for_job || 'Yes';
  merged.phone = normalizeIndianPhone(merged.phone || '');
  merged.preferred_location = merged.preferred_location || 'Noida';
  merged.qualification_level = normalizeQualificationCategory(merged.qualification_level || merged.degree || '', merged.qualification || '');
  merged.total_experience = String(merged.total_experience || '');
  merged.relevant_experience = String(merged.relevant_experience || '');
  merged.in_hand_salary = String(merged.in_hand_salary || '');
  merged.ctc_monthly = String(merged.ctc_monthly || '');
  merged.career_gap = merged.career_gap || 'Fresher';
  merged.virtual_onsite = merged.virtual_onsite || 'Walkin';
  merged.documents_availability = merged.documents_availability || 'Yes';
  merged.communication_skill = merged.communication_skill || 'Average';
  merged.relevant_experience_range = calcExperienceRange(merged.relevant_experience);
  merged.relevant_in_hand_range = calcSalaryRange(merged.in_hand_salary);
  merged.recruiter_code = canOverrideRecruiter
    ? (requestedRecruiterCode || existing?.recruiter_code || user?.recruiter_code || '')
    : (existing?.recruiter_code || user?.recruiter_code || requestedRecruiterCode || '');
  merged.recruiter_name = canOverrideRecruiter
    ? (merged.recruiter_name || existing?.recruiter_name || user?.full_name || '')
    : (existing?.recruiter_name || user?.full_name || merged.recruiter_name || '');
  merged.recruiter_designation = canOverrideRecruiter
    ? (merged.recruiter_designation || existing?.recruiter_designation || user?.designation || '')
    : (existing?.recruiter_designation || user?.designation || merged.recruiter_designation || '');
  merged.interview_reschedule_date = cleanDateOnly(merged.interview_reschedule_date);
  merged.interview_availability = merged.interview_availability || '';
  merged.status = merged.status || 'In - Progress';
  const requestedProfilePriority = lower(merged.profile_priority || existing?.profile_priority || '');
  merged.profile_priority = requestedProfilePriority === 'high' ? 'High' : requestedProfilePriority === 'low' ? 'Low' : 'Medium';
  merged.all_details_sent = merged.all_details_sent || 'Pending';
  merged.submission_date = merged.submission_date || nowLocalDateTime();
  merged.process = Array.isArray(merged.process) ? merged.process.join(', ') : String(merged.process || '');
  merged.bucket_assigned_at = existing?.bucket_assigned_at || merged.bucket_assigned_at || merged.created_at || nowIso();
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
  const raw = String(value || '').toLowerCase();
  const nums = extractRangeNumbers(raw);
  if (!nums.length) return 0;
  const base = nums[0];
  if (raw.includes('month')) return Math.round(base);
  return Math.round(base * 12);
}

function computeJdFitSummary(candidate, jdRows = []) {
  const preferred = splitCsv(candidate.preferred_location || candidate.location || '').map(lower);
  const candidateSalary = numberFromText(candidate.in_hand_salary || candidate.ctc_monthly || '');
  const candidateExpMonths = normalizeExperienceMonths(candidate.relevant_experience || candidate.total_experience || candidate.experience || '');
  const qualification = lower(candidate.qualification_level || candidate.qualification || '');
  const processText = lower(candidate.process || '');
  const suggestions = jdRows.map((jd) => {
    let score = 20;
    const reasons = [];
    const jdLocation = lower(jd.location || '');
    const jdTitle = lower(jd.job_title || '');
    const jdCompany = lower(jd.company || '');
    const jdProcess = lower(jd.process_name || '');
    const jdSalary = normalizeLakhsToMonthly(jd.salary || '');
    const jdExp = normalizeExperienceMonths(jd.experience || '');

    const processTokens = splitCsv(candidate.process || '').map(lower).filter(Boolean);
    if (processTokens.length && processTokens.some((token) => [jdTitle, jdCompany, jdProcess].some((value) => value && (value.includes(token) || token.includes(value))))) {
      score += 28;
      reasons.push('Process match');
    } else if (processText && [jdTitle, jdCompany, jdProcess].some((value) => value && (value.includes(processText) || processText.includes(value)))) {
      score += 28;
      reasons.push('Process match');
    }
    if (preferred.length && preferred.some((loc) => jdLocation.includes(loc) || loc.includes(jdLocation))) {
      score += 22;
      reasons.push('Location fit');
    }
    if (candidateSalary && jdSalary) {
      const diff = Math.abs(candidateSalary - jdSalary);
      if (diff <= 5000) {
        score += 18;
        reasons.push('Salary close');
      } else if (diff <= 12000) {
        score += 10;
        reasons.push('Salary workable');
      }
    }
    if (candidateExpMonths && jdExp) {
      const diff = Math.abs(candidateExpMonths - jdExp);
      if (diff <= 6) {
        score += 18;
        reasons.push('Experience fit');
      } else if (diff <= 12) {
        score += 10;
        reasons.push('Experience nearby');
      }
    }
    if (qualification.includes('graduate') && !qualification.includes('non')) {
      score += 8;
      reasons.push('Graduate profile');
    }
    score = Math.max(0, Math.min(100, score));
    return {
      jd_id: jd.jd_id,
      job_title: jd.job_title || '',
      company: jd.company || '',
      location: jd.location || '',
      salary: jd.salary || '',
      experience: jd.experience || '',
      score,
      reasons,
    };
  }).sort((a, b) => b.score - a.score);
  const top = suggestions.slice(0, 4);
  return {
    score: top[0]?.score || 0,
    label: top[0]?.score >= 75 ? 'Best Fit' : top[0]?.score >= 55 ? 'Possible Fit' : top.length ? 'Low Fit' : 'No JD Linked',
    best_match: top[0] || null,
    suggestions: top,
  };
}

function decorateCandidateWithFit(candidate, jdRows = []) {
  return { ...candidate, jd_fit_summary: computeJdFitSummary(candidate, jdRows) };
}

function candidateIsLostLead(candidate) {
  const status = lower(candidate.status || '');
  const approval = lower(candidate.approval_status || '');
  const looking = lower(candidate.looking_for_job || 'yes');
  const overdue = String(candidate.follow_up_at || '') && String(candidate.follow_up_at || '') < nowIso().slice(0, 10);
  return ['rejected', 'not intrested', 'not interested', 'not responding', 'rejected once, needs new interview'].includes(status)
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
    preferred_location: parseMultiValue(req.query.preferred_location),
    status: parseMultiValue(req.query.status),
    approval_status: parseMultiValue(req.query.approval_status),
    qualification: parseMultiValue(req.query.qualification),
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
    page_size: Math.min(25, Math.max(5, Number(req.query.page_size || 10) || 10)),
    around_id: String(req.query.around_id || '').trim(),
    bucket_view: String(req.query.bucket_view || 'all').trim(),
    last_viewed_mode: String(req.query.last_viewed_mode || '').trim(),
    last_viewed_days: String(req.query.last_viewed_days || '').trim(),
    duplicate_only: String(req.query.duplicate_only || '').trim() === '1',
  };
}

function rowMatchesFilters(row, filters, user) {
  if (!visibleCandidate(row, user)) return false;
  const duplicateFlag = String(row?.is_duplicate || '0') === '1';
  if (filters.duplicate_only) {
    if (!duplicateFlag) return false;
  } else if (duplicateFlag) {
    return false;
  }
  if (filters.q && !['candidate_id', 'full_name', 'phone', 'process', 'notes', 'location', 'preferred_location', 'recruiter_code'].some((key) => containsText(row[key], filters.q))) return false;
  if (filters.recruiter && !containsText(row.recruiter_name, filters.recruiter) && !containsText(row.recruiter_code, filters.recruiter)) return false;
  if (filters.recruiter_code_text && !containsText(row.recruiter_code, filters.recruiter_code_text)) return false;
  if (filters.sr_text) {
    const srQuery = String(filters.sr_text || '').trim().toLowerCase();
    const candidateCode = String(row.candidate_id || '').trim().toLowerCase();
    const candidateTail = String(numericTail(row.candidate_id) || '').trim().toLowerCase();
    if (!candidateCode.includes(srQuery) && !candidateTail.includes(srQuery)) return false;
  }
  if (filters.name.length && !filters.name.includes(String(row.full_name || ''))) return false;
  if (filters.phone.length && !filters.phone.some((value) => phoneMatches(row.phone || '', value))) return false;
  if (filters.recruiter_code.length && !filters.recruiter_code.includes(String(row.recruiter_code || ''))) return false;
  if (filters.location.length && !splitCsv(row.location).some((item) => filters.location.includes(item))) return false;
  if (filters.preferred_location.length && !splitCsv(row.preferred_location).some((item) => filters.preferred_location.includes(item))) return false;
  if (filters.status.length && !filters.status.map(lower).includes(lower(row.status))) return false;
  if (filters.approval_status.length && !filters.approval_status.map(lower).includes(lower(row.approval_status))) return false;
  if (filters.qualification.length && !filters.qualification.includes(normalizeQualificationCategory(row.qualification_level || '', row.qualification || ''))) return false;
  if (filters.process.length && !splitCsv(row.process).some((item) => filters.process.includes(item))) return false;
  if (filters.data_notes.length && !filters.data_notes.some((value) => containsText(row.data_notes || row.notes || '', value))) return false;
  if (filters.all_details_sent.length && !filters.all_details_sent.map(lower).includes(lower(row.all_details_sent))) return false;
  if (filters.communication_skill.length && !filters.communication_skill.includes(String(row.communication_skill || ''))) return false;
  if (filters.career_gap.length && !filters.career_gap.includes(String(row.career_gap || ''))) return false;
  if (filters.relevant_experience_range.length && !filters.relevant_experience_range.includes(String(row.relevant_experience_range || ''))) return false;
  if (filters.relevant_in_hand_range.length && !filters.relevant_in_hand_range.includes(String(row.relevant_in_hand_range || ''))) return false;
  if (filters.virtual_onsite.length && !filters.virtual_onsite.includes(String(row.virtual_onsite || ''))) return false;
  if (filters.documents_availability.length && !filters.documents_availability.includes(String(row.documents_availability || ''))) return false;
  if (filters.call_connected.length && !filters.call_connected.includes(String(row.call_connected || ''))) return false;
  if (filters.manager_crm.length && !filters.manager_crm.includes(String(row.manager_crm || ''))) return false;
  if (filters.submitted_by.length && !filters.submitted_by.includes(String(row.submitted_by || ''))) return false;
  if ((filters.sr_from !== '' || filters.sr_to !== '') && !inNumericRange(numericTail(row.candidate_id), filters.sr_from, filters.sr_to)) return false;
  if (filters.submission_from && String(row.submission_date || '') < filters.submission_from) return false;
  if (filters.submission_to && String(row.submission_date || '') > filters.submission_to) return false;
  if (filters.data_uploading_from && String(row.data_uploading_date || '') < filters.data_uploading_from) return false;
  if (filters.data_uploading_to && String(row.data_uploading_date || '') > filters.data_uploading_to) return false;
  const interviewDate = String(row.interview_date || row.interview_reschedule_date || '');
  if (filters.interview_from && interviewDate < filters.interview_from) return false;
  if (filters.interview_to && interviewDate > filters.interview_to) return false;
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
  if (!isLeadership(req.user)) {
    const scoped = candidateScopeSql('', req.user, params);
    clauses.push(scoped.sql);
  }
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
  if (filters.duplicate_only) clauses.push(`coalesce(is_duplicate, '0') = '1'`);
  else clauses.push(`coalesce(is_duplicate, '0') <> '1'`);
  applyExactAnySql(clauses, params, 'full_name', filters.name);
  if (filters.phone.length) {
    const pieces = filters.phone.map((value) => {
      params.push(value);
      return `(${phoneSearchSql('phone', `$${params.length}`)})`;
    });
    clauses.push(`(${pieces.join(' or ')})`);
  }
  applyExactAnySql(clauses, params, 'recruiter_code', filters.recruiter_code);
  applyLikeAnySql(clauses, params, `coalesce(location, '')`, filters.location);
  applyLikeAnySql(clauses, params, `coalesce(preferred_location, '')`, filters.preferred_location);
  applyExactAnySql(clauses, params, 'status', filters.status);
  applyExactAnySql(clauses, params, 'approval_status', filters.approval_status);
  const qualifications = filters.qualification;
  if (qualifications.length) {
    params.push(qualifications.map((value) => String(value).trim().toLowerCase()));
    clauses.push(`${qualificationCategorySql()} = any($${params.length})`);
  }
  applyLikeAnySql(clauses, params, `coalesce(process, '')`, filters.process);
  applyLikeAnySql(clauses, params, `coalesce(data_notes, notes, '')`, filters.data_notes);
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
    clauses.push(`coalesce(submission_date, '') >= $${params.length}`);
  }
  if (filters.submission_to) {
    params.push(filters.submission_to);
    clauses.push(`coalesce(submission_date, '') <= $${params.length}`);
  }
  if (filters.data_uploading_from) {
    params.push(filters.data_uploading_from);
    clauses.push(`coalesce(data_uploading_date, '') >= $${params.length}`);
  }
  if (filters.data_uploading_to) {
    params.push(filters.data_uploading_to);
    clauses.push(`coalesce(data_uploading_date, '') <= $${params.length}`);
  }
  if (filters.interview_from) {
    params.push(filters.interview_from);
    clauses.push(`coalesce(interview_reschedule_date, '') >= $${params.length}`);
  }
  if (filters.interview_to) {
    params.push(filters.interview_to);
    clauses.push(`coalesce(interview_reschedule_date, '') <= $${params.length}`);
  }
  if (filters.salary_from !== '') {
    params.push(Number(filters.salary_from));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(in_hand_salary, ctc_monthly, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}`);
  }
  if (filters.salary_to !== '') {
    params.push(Number(filters.salary_to));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(in_hand_salary, ctc_monthly, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric <= $${params.length}`);
  }
  if (filters.total_exp_from !== '') {
    params.push(Number(filters.total_exp_from));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(total_experience, experience, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric >= $${params.length}`);
  }
  if (filters.total_exp_to !== '') {
    params.push(Number(filters.total_exp_to));
    clauses.push(`coalesce(nullif(regexp_replace(coalesce(total_experience, experience, ''), '[^0-9.]', '', 'g'), ''), '0')::numeric <= $${params.length}`);
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
  const cacheKey = `${user?.user_id || 'anon'}:${candidateId}`;
  const cached = candidateNavCache.get(cacheKey);
  if (cached) return cached;
  if (mode === 'postgres' && store.pool) {
    const params = [];
    const scopeClauses = [];
    if (!isLeadership(user)) {
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

  const rows = collapseLogicalDuplicateRows((await table('candidates'))
    .filter((row) => visibleCandidate(row, user))
    .slice(), { preferInterview: false })
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) || String(b.candidate_id || '').localeCompare(String(a.candidate_id || '')));
  const idx = rows.findIndex((row) => String(row.candidate_id) === String(candidateId));
  if (idx === -1) return [];
  return candidateNavCache.set(cacheKey, rows.slice(Math.max(0, idx - 1), idx + 2).map((row) => ({ candidate_id: row.candidate_id, full_name: row.full_name })));
}

async function list(req, res) {
  const cacheKey = `${req.user?.user_id || 'anon'}:${JSON.stringify(req.query || {})}`;
  const cached = candidateListCache.get(cacheKey);
  if (cached) return res.json(cached);
  const { filters } = buildSqlFilter(req);
  if (filters.around_id) {
    const navItems = await getAroundNav(req.user, filters.around_id);
    return res.json({ items: [], nav_items: navItems, process_options: PROCESS_OPTIONS, total: navItems.length, page: 1, page_size: 3, has_more: false, summary: buildBucketSummary([], req.user) });
  }

  let baseRows = [];
  if (mode === 'postgres' && store.pool) {
    const { whereSql, params } = buildSqlFilter(req);
    try {
      baseRows = await store.query(
        `select ${CANDIDATE_SELECT_SQL} from public.candidates ${whereSql} order by coalesce(updated_at, created_at, '') desc, candidate_id desc limit 3000`,
        params,
      );
    } catch (error) {
      if (!isUndefinedColumnError(error)) throw error;
      const fallbackRows = await store.query(`select * from public.candidates order by coalesce(updated_at, created_at, '') desc, candidate_id desc limit 3000`);
      baseRows = fallbackRows.filter((row) => rowMatchesFilters(row, filters, req.user));
    }
  } else {
    const rows = await table('candidates');
    baseRows = rows.filter((row) => rowMatchesFilters(row, filters, req.user))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  const logicalRows = filters.duplicate_only ? baseRows : collapseLogicalDuplicateRows(baseRows, { preferInterview: false });
  const decoratedRows = logicalRows.map((row) => enrichCandidate(row)).filter((row) => visibleCandidate(row, req.user));
  const lastViewedRows = decoratedRows.filter((row) => matchesLastViewedWindow(row, filters));
  const enrichedRows = lastViewedRows.filter((row) => matchesBucketView(row, filters));
  const sortedRows = sortBucketRows(enrichedRows, filters.bucket_view);
  const offset = (filters.page - 1) * filters.page_size;
  const items = sortedRows.slice(offset, offset + filters.page_size);
  const summary = buildBucketSummary(decoratedRows, req.user);
  const payload = {
    items: sanitizeCandidateListForUser(items, req.user),
    filter_source_rows: sanitizeCandidateListForUser(sortedRows.slice(0, 250), req.user),
    dialer_items: sanitizeCandidateListForUser(sortedRows.slice(0, Number(process.env.CRM_DIALER_MAX_SELECTION || 200)), req.user),
    process_options: PROCESS_OPTIONS,
    total: sortedRows.length,
    page: filters.page,
    page_size: filters.page_size,
    has_more: offset + items.length < sortedRows.length,
    summary,
  };
  candidateListCache.set(cacheKey, payload);
  return res.json(payload);
}



function isHotLeadRow(row) {
  const leadSource = lower(row?.lead_source || '');
  if (['hot_lead', 'hot leads', 'hot-lead', 'hotlead'].includes(leadSource)) return true;
  return Boolean(
    String(row?.hot_lead_status || '').trim()
    || String(row?.profile_status || '').trim()
    || String(row?.jd_name || '').trim()
    || String(row?.employee_code || '').trim()
    || String(row?.employee_no || '').trim()
    || String(row?.employee_name || '').trim()
  );
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
  if (key === 'my_fresh') return candidateBelongsToUser(row, user) && row.bucket_is_fresh && !row.bucket_is_bucket_out;
  if (key === 'my_working') return candidateBelongsToUser(row, user) && !row.bucket_is_fresh && !row.bucket_is_followup_due && !row.bucket_is_bucket_out && !row.bucket_is_terminal;
  return matchesBucketView(row, { bucket_view: key || 'all' });
}

function buildHotLeadRecruiterOptions(rows = [], users = []) {
  const map = new Map();
  const add = (code, name = '') => {
    const cleanCode = String(code || '').trim();
    if (!cleanCode || map.has(cleanCode)) return;
    const cleanName = String(name || '').trim();
    map.set(cleanCode, { value: cleanCode, label: cleanName ? `${cleanName} • ${cleanCode}` : cleanCode });
  };
  for (const user of users || []) add(user.recruiter_code || user.user_id, user.full_name || user.username);
  for (const row of rows || []) add(hotLeadRecruiterCode(row), hotLeadRecruiterDisplay(row));
  return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

async function listHotLeads(req, res) {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = hotLeadPageSizeFromRequest(req.user, req.query.page_size || 10);
  const bucketView = lower(req.query.bucket_view || 'all');
  const recruiterFilter = isAccessLeadership(req.user) ? String(req.query.recruiter_code || '').trim() : '';
  const lastViewedMode = String(req.query.last_viewed_mode || '').trim();
  let rawRows = [];
  if (mode === 'postgres' && store.pool) {
    try {
      rawRows = await store.query(`select ${CANDIDATE_SELECT_SQL} from public.candidates where coalesce(lead_source, '') ilike 'hot%' or coalesce(hot_lead_status, '') <> '' or coalesce(profile_status, '') <> '' or coalesce(jd_name, '') <> '' or coalesce(employee_code, '') <> '' or coalesce(employee_no, '') <> '' order by coalesce(updated_at, created_at, '') desc, candidate_id desc limit ${Math.max(200, hotLeadRoleMaxPageSize(req.user))}`);
    } catch (error) {
      rawRows = await store.query(`select * from public.candidates order by coalesce(updated_at, created_at, '') desc, candidate_id desc limit ${Math.max(200, hotLeadRoleMaxPageSize(req.user))}`);
    }
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
  const sortedRows = sortBucketRows(filteredRows, bucketView).sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) || String(b.candidate_id || '').localeCompare(String(a.candidate_id || '')));
  const offset = (page - 1) * pageSize;
  const items = sortedRows.slice(offset, offset + pageSize).map((row) => ({ ...row, hot_lead_missing_count: countMissingHotLeadImportant(row) }));
  const bucketSummary = buildBucketSummary(searchedRows, req.user);
  return res.json({
    items: sanitizeCandidateListForUser(items, req.user),
    dialer_items: sanitizeCandidateListForUser(sortedRows.slice(0, hotLeadRoleMaxPageSize(req.user)), req.user),
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


async function create(req, res) {
  const rows = await table('candidates');
  const item = normalizeCandidate(req.body, {
    candidate_id: nextId('C', rows, 'candidate_id'),
    call_connected: 'No',
    looking_for_job: 'Yes',
    full_name: '',
    phone: '',
    qualification: '',
    location: '',
    preferred_location: 'Noida',
    qualification_level: 'Graduate',
    total_experience: '',
    relevant_experience: '',
    in_hand_salary: '',
    ctc_monthly: '',
    career_gap: 'Fresher',
    documents_availability: 'Yes',
    communication_skill: 'Average',
    relevant_experience_range: '',
    relevant_in_hand_range: '',
    submission_date: nowLocalDateTime(),
    process: '',
    recruiter_code: req.user.recruiter_code || '',
    recruiter_name: req.user.full_name || '',
    recruiter_designation: req.user.designation || '',
    status: 'In - Progress',
    all_details_sent: 'Pending',
    interview_availability: '',
    interview_reschedule_date: '',
    virtual_onsite: 'Walkin',
    follow_up_at: '',
    follow_up_note: '',
    follow_up_status: 'Open',
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
  await store.insert('candidates', item);
  invalidateCandidateCaches();
  logActivity(req, item.candidate_id, 'candidate_created', { full_name: item.full_name || '' }).catch(() => {});
  return res.json({ item: sanitizeCandidateForUser(item, req.user) });
}


async function bulkCreate(req, res) {
  const inputItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 30) : [];
  if (!inputItems.length) return res.status(400).json({ message: 'Add at least one candidate row.' });
  const rows = await table('candidates');
  const created = [];
  for (const source of inputItems) {
    const cleanName = String(source.full_name || source.name || '').trim();
    const cleanPhone = normalizeIndianPhone(source.phone || source.primary_phone || source.mobile || '');
    if (!cleanName && !cleanPhone) continue;
    const nextCandidateId = nextId('C', [...rows, ...created], 'candidate_id');
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
      candidate_id: nextCandidateId,
      phone: cleanPhone,
      notes: notesBits.filter(Boolean).join('\n'),
      recruiter_code: source.recruiter_code || req.user.recruiter_code || '',
      recruiter_name: source.recruiter_name || req.user.full_name || '',
      recruiter_designation: source.recruiter_designation || req.user.designation || '',
      status: source.status || 'In - Progress',
      all_details_sent: source.all_details_sent || 'Pending',
      call_connected: source.call_connected || 'No',
      looking_for_job: source.looking_for_job || 'Yes',
      preferred_location: source.preferred_location || source.location || 'Noida',
      documents_availability: source.documents_availability || 'Yes',
      communication_skill: source.communication_skill || 'Average',
      submission_date: source.submission_date || nowLocalDateTime(),
      approval_status: source.approval_status || 'Draft',
      created_at: nowIso(),
      updated_at: nowIso(),
    }, {
      candidate_id: nextCandidateId,
      call_connected: 'No',
      looking_for_job: 'Yes',
      full_name: cleanName,
      phone: cleanPhone,
      qualification: '',
      location: '',
      preferred_location: source.location || 'Noida',
      qualification_level: 'Graduate',
      total_experience: '',
      relevant_experience: '',
      in_hand_salary: '',
      ctc_monthly: '',
      career_gap: 'Fresher',
      documents_availability: 'Yes',
      communication_skill: 'Average',
      relevant_experience_range: '',
      relevant_in_hand_range: '',
      submission_date: nowLocalDateTime(),
      process: '',
      recruiter_code: req.user.recruiter_code || '',
      recruiter_name: req.user.full_name || '',
      recruiter_designation: req.user.designation || '',
      status: 'In - Progress',
      all_details_sent: 'Pending',
      interview_availability: '',
      interview_reschedule_date: '',
      virtual_onsite: 'Walkin',
      follow_up_at: '',
      follow_up_note: '',
      follow_up_status: 'Open',
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
    const saved = await store.insert('candidates', item);
    created.push(saved);
    logActivity(req, saved.candidate_id, 'candidate_created', {
      full_name: saved.full_name || '',
      source: 'bulk_resume_import',
      imported_from: String(source.source_filename || '').trim(),
    }).catch(() => {});
  }
  if (!created.length) return res.status(400).json({ message: 'No usable candidate rows were found.' });
  invalidateCandidateCaches();
  return res.json({ items: sanitizeCandidateListForUser(created, req.user), count: created.length });
}



async function getOne(req, res) {
  try {
    const candidateId = String(req.params.candidateId || '').trim();
    if (!candidateId) return res.status(400).json({ message: 'Candidate id is required' });

    const rawItem = await withSoftTimeout(() => store.findById('candidates', 'candidate_id', candidateId), null, 10000);
    const item = safeRowObject(rawItem);
    if (!item || !item.candidate_id || isDeletedCandidate(item)) return res.status(404).json({ message: 'Candidate not found' });
    if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
    const prefetchOnly = String(req.query.prefetch || '').trim() === '1';

    const skipFiles = String(req.query.no_files || '').trim() === '1' || prefetchOnly;
    const notesLimit = prefetchOnly ? 15 : 60;

    const notesTask = () => {
      if (mode === 'postgres' && store.pool) {
        return store.query(`select * from public.notes where candidate_id = $1 order by created_at desc limit ${notesLimit}`, [candidateId]);
      }
      return table('notes').then((rows) => rows.filter((n) => String(n.candidate_id) === String(candidateId)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, notesLimit));
    };

    const timelineTask = () => {
      if (prefetchOnly) return [];
      if (mode === 'postgres' && store.pool) {
        return store.query(`select * from public.activity_log where candidate_id = $1 order by created_at desc limit 80`, [candidateId]);
      }
      return table('activity_log').then((rows) => rows.filter((n) => String(n.candidate_id) === String(candidateId)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 80));
    };

    const [rawNotes, rawTimeline, rawNavItems, rawFiles, rawUsers] = await Promise.all([
      withSoftTimeout(notesTask, [], 5000),
      withSoftTimeout(timelineTask, [], 5000),
      prefetchOnly ? Promise.resolve([]) : withSoftTimeout(() => getAroundNav(req.user, candidateId), [], 4000),
      skipFiles ? Promise.resolve([]) : withSoftTimeout(() => listCandidateFiles(candidateId), [], 5000),
      prefetchOnly ? Promise.resolve([]) : (canManagerReassignRecruiter(req.user) ? withSoftTimeout(() => table('users'), [], 4000) : Promise.resolve([])),
    ]);

    const safeItem = sanitizeCandidateForUser(enrichCandidate(item), req.user);
    const notes = safeNoteRows(rawNotes, 60);
    const timeline = safeActivityRows(rawTimeline, 80);
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
      process_options: PROCESS_OPTIONS,
      recruiter_options: recruiterOptions,
    });
  } catch (error) {
    try { console.error('Safe candidate detail failure:', error); } catch {}
    return res.status(500).json({ message: 'Candidate profile could not be loaded safely. Please retry once.' });
  }
}


async function listFilesForCandidate(req, res) {
  const candidateId = String(req.params.candidateId || '').trim();
  const item = await store.findById('candidates', 'candidate_id', candidateId);
  if (!item || isDeletedCandidate(item)) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const files = safeRows(await withSoftTimeout(() => listCandidateFiles(candidateId), [], 7000), 20).map(sanitizeCandidateFile);
  return res.json({ files });
}

async function logOpen(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item || isDeletedCandidate(item)) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(item, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const viewedBy = req.user.full_name || req.user.username || '';
  const lastViewedAt = Date.parse(item.last_viewed_at || '');
  const sameViewer = String(item.last_viewed_by_name || '').trim().toLowerCase() === String(viewedBy || '').trim().toLowerCase();
  if (sameViewer && Number.isFinite(lastViewedAt) && (Date.now() - lastViewedAt) < 90000) {
    return res.json({ ok: true, skipped: true, last_viewed_at: item.last_viewed_at });
  }
  const viewedAt = nowIso();
  await store.update('candidates', 'candidate_id', req.params.candidateId, {
    last_viewed_at: viewedAt,
    last_viewed_by_name: viewedBy,
  }).catch(() => {});
  // Do not clear candidate list caches on profile-open. It was causing list refresh storms and disappearing rows during heavy use.
  logActivity(req, req.params.candidateId, 'profile_opened', { full_name: item.full_name || '', section: 'candidate detail' }).catch(() => {});
  return res.json({ ok: true, last_viewed_at: viewedAt });
}

async function update(req, res) {
  const existing = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!existing) return res.status(404).json({ message: 'Candidate not found' });
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
  delete dbPayload.jd_fit_summary;
  delete dbPayload.notes_list;
  delete dbPayload.timeline;
  delete dbPayload.nav_items;
  delete dbPayload.process_options;
  delete dbPayload._client_updated_at;
  delete dbPayload._changed_fields;
  delete dbPayload._client_base_values;
  let normalized = normalizeCandidate(dbPayload, existing, req.user);
  normalized = await applyRecruiterAssignmentIfAllowed(normalized, dbPayload.recruiter_code, req.user);
  const salaryFieldErrors = validateChangedSalaryFields(existing, normalized);
  if (salaryFieldErrors.length) return res.status(400).json({ message: salaryFieldErrors[0] });
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
    process: 'Process',
    notes: 'Notes',
  };
  const changedFields = Object.entries(trackableFields)
    .filter(([field]) => String(existing[field] || '') !== String(normalized[field] || ''))
    .map(([, label]) => label);
  const detailSignalLabels = new Set([
    'Name','Number','Location','Qualification','Preferred Location','Qualification Type','Total Experience','Relevant Experience',
    'CTC','In-hand Salary','Career Gap','Documents Availability','Communication Skill','Process','Interview Date','Interview Mode'
  ]);
  const detailsTouched = changedFields.some((label) => detailSignalLabels.has(label));
  const callConnectedRaised = String(existing.call_connected || '').trim() !== String(normalized.call_connected || '').trim()
    && lower(normalized.call_connected) === 'yes';
  const notesChanged = String(existing.notes || '') !== String(normalized.notes || '');
  const item = await store.update('candidates', 'candidate_id', req.params.candidateId, normalized);
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
    notifyRecruiter(existing, 'Profile Updated', `${req.user.full_name} updated candidate ${existing.full_name}.`).catch(() => {});
  }
  const includeFit = String(req.query.include_fit || req.body?.include_fit || '').trim() === '1' || req.body?.include_fit === true;
  if (includeFit) {
    const jdRows = await table('jd_master');
    return res.json({ item: sanitizeCandidateForUser(decorateCandidateWithFit(item, jdRows), req.user) });
  }
  return res.json({ item: sanitizeCandidateForUser(enrichCandidate(item), req.user) });
}

function buildSubmissionBlockMessage(item, options = {}) {
  const hasCandidateNotes = options.hasCandidateNotes !== false;
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
    ['status', 'Status'],
    ['all_details_sent', 'All Details Sent'],
    ['submission_date', 'Submission Date'],
    ['virtual_onsite', 'Interview Mode'],
    ['documents_availability', 'All Documents Availability'],
  ];
  const missingLabels = required
    .filter(([key]) => !String(item?.[key] || '').trim())
    .map(([, label]) => label);
  const lookingForJobBlocked = lower(item?.looking_for_job) !== 'yes';
  const callConnectedIssue = lower(item?.call_connected) !== 'yes' && (missingLabels.length || lookingForJobBlocked || !hasCandidateNotes);
  const issues = [];
  if (!hasCandidateNotes) issues.push('Add note first. Profile cannot be submitted without notes.');
  if (lookingForJobBlocked) issues.push('Looking For Job is set to No. Save is allowed, but submit is blocked.');
  if (callConnectedIssue) issues.push(`Call Connected is still ${String(item?.call_connected || 'No')}. Complete the connected-call step or finish the pending details before submit.`);
  if (missingLabels.length) issues.push(`Missing fields: ${missingLabels.join(', ')}`);
  return issues;
}

async function hasCandidateNotesCompat(candidateId) {
  if (mode === 'postgres' && store.pool) {
    try {
      const rows = await store.query(`select id from public.notes where candidate_id = $1 order by created_at desc limit 1`, [candidateId]);
      return Array.isArray(rows) && rows.length > 0;
    } catch (error) {
      return false;
    }
  }
  const rows = await table('notes');
  return rows.some((row) => String(row.candidate_id) === String(candidateId));
}

async function submitForApproval(req, res) {
  const existing = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!existing) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(existing, req.user)) return res.status(403).json({ message: 'Not allowed' });
  const existingSubmission = await findPendingSubmissionCompat(req.params.candidateId);
  const latestSubmittedSubmission = existingSubmission?.submission_id
    ? existingSubmission
    : await findLatestSubmittedSubmissionCompat(req.params.candidateId);
  const candidateApprovalState = lower(existing.approval_status);
  const submissionApprovalState = lower(latestSubmittedSubmission?.approval_status || '');
  const alreadySubmitted = ['pending', 'approved'].includes(candidateApprovalState)
    || ['pending', 'approved'].includes(submissionApprovalState);

  if (alreadySubmitted) {
    return res.json({
      item: sanitizeCandidateForUser(enrichCandidate({
        ...existing,
        status: candidateApprovalState === 'approved' ? (existing.status || 'Approved') : 'In - Progress',
        all_details_sent: candidateApprovalState === 'approved' ? (existing.all_details_sent || 'Pending') : 'Pending',
      }), req.user),
      submission: latestSubmittedSubmission || null,
      already_pending: candidateApprovalState === 'pending' || submissionApprovalState === 'pending',
      already_submitted: true,
    });
  }
  const item = normalizeCandidate(req.body || {}, existing, req.user);
  const salaryFieldErrors = validateChangedSalaryFields(existing, item);
  if (salaryFieldErrors.length) return res.status(400).json({ message: salaryFieldErrors[0] });
  const hasCandidateNotes = await hasCandidateNotesCompat(req.params.candidateId);
  const submitIssues = buildSubmissionBlockMessage(item, { hasCandidateNotes });
  if (submitIssues.length) {
    return res.status(400).json({ message: submitIssues.join(' • ') });
  }

  item.call_connected = 'Yes';

  const stamp = nowIso();
  item.approval_status = 'Pending';
  item.approval_requested_at = stamp;
  item.status = 'In - Progress';
  item.all_details_sent = 'Pending';
  item.submitted_by = req.user.full_name || req.user.username || '';
  item.approved_at = '';
  item.approved_by_name = '';

  const updated = await store.update('candidates', 'candidate_id', req.params.candidateId, item);
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
    submitted_at: stamp,
    submitted_by_user_id: req.user.user_id || '',
    submitted_by_name: req.user.full_name || req.user.username || '',
    submitted_by_recruiter_code: req.user.recruiter_code || '',
    next_follow_up_at: existingSubmission?.next_follow_up_at || '',
    reminder_snoozed_until: '',
    reminder_note: '',
    updated_at: stamp,
  }, true);

  try {
    await saveSubmissionCompat(existingSubmission?.submission_id || '', submission);
  } catch (error) {
    await store.update('candidates', 'candidate_id', req.params.candidateId, {
      approval_status: existing.approval_status || 'Draft',
      approval_requested_at: existing.approval_requested_at || '',
      approved_at: existing.approved_at || '',
      approved_by_name: existing.approved_by_name || '',
      status: existing.status || '',
      all_details_sent: existing.all_details_sent || '',
      submitted_by: existing.submitted_by || '',
      updated_at: nowIso(),
    }).catch(() => {});
    invalidateCandidateCaches();
    throw error;
  }

  logActivity(req, req.params.candidateId, 'submitted_for_approval', {
    recruiter_name: updated.recruiter_name || '',
    process: updated.process || '',
  }).catch(() => {});
  notifyLeaders(
    'New profile submitted',
    `${updated.full_name} submitted by ${updated.recruiter_name}.`,
    JSON.stringify({ candidate_id: updated.candidate_id, submission_id: submission.submission_id, open_path: `/candidate/${updated.candidate_id}`, section: 'submissions' }),
  ).catch(() => {});
  return res.json({ item: sanitizeCandidateForUser(enrichCandidate(updated), req.user), submission });
}

async function addNote(req, res) {
  const item = {
    id: makeFastBigIntId(),
    candidate_id: req.params.candidateId,
    username: req.user.username,
    note_type: req.body.note_type || 'public',
    body: req.body.body || '',
    parent_note_id: normalizeOptionalBigIntLike(req.body.parent_note_id),
    reply_to_note_id: normalizeOptionalBigIntLike(req.body.reply_to_note_id),
    reply_to_username: String(req.body.reply_to_username || '').trim(),
    created_at: nowIso(),
  };
  let saved = item;
  try {
    saved = await store.insert('notes', item);
  } catch (error) {
    if (!isUndefinedColumnError(error, ['parent_note_id', 'reply_to_note_id', 'reply_to_username'])) throw error;
    const legacyItem = { ...item };
    delete legacyItem.parent_note_id;
    delete legacyItem.reply_to_note_id;
    delete legacyItem.reply_to_username;
    saved = await store.insert('notes', legacyItem);
  }
  invalidateCandidateCaches();
  logActivity(req, req.params.candidateId, 'note_added', {
    note_type: item.note_type,
    parent_note_id: item.parent_note_id || '',
    reply_to_note_id: item.reply_to_note_id || '',
  }).catch(() => {});
  return res.json({ item: saved || item });
}


async function addQuickNote(req, res) {
  const candidateId = req.body.candidate_id || '';
  if (!candidateId) return res.status(400).json({ message: 'candidate_id is required' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  const item = {
    id: makeFastBigIntId(),
    candidate_id: candidateId,
    username: req.user.username,
    note_type: req.body.note_type || 'public',
    body: req.body.body || '',
    parent_note_id: normalizeOptionalBigIntLike(req.body.parent_note_id),
    reply_to_note_id: normalizeOptionalBigIntLike(req.body.reply_to_note_id),
    reply_to_username: String(req.body.reply_to_username || '').trim(),
    created_at: nowIso(),
  };
  let saved = item;
  try {
    saved = await store.insert('notes', item);
  } catch (error) {
    if (!isUndefinedColumnError(error, ['parent_note_id', 'reply_to_note_id', 'reply_to_username'])) throw error;
    const legacyItem = { ...item };
    delete legacyItem.parent_note_id;
    delete legacyItem.reply_to_note_id;
    delete legacyItem.reply_to_username;
    saved = await store.insert('notes', legacyItem);
  }
  await store.update('candidates', 'candidate_id', candidateId, { updated_at: nowIso() });
  invalidateCandidateCaches();
  logActivity(req, candidateId, 'note_added', {
    note_type: item.note_type,
    parent_note_id: item.parent_note_id || '',
    reply_to_note_id: item.reply_to_note_id || '',
  }).catch(() => {});
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
  incrementEmployeeDailyStat(req, 'calls_count').catch(() => {});
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
  const next = (await table('candidates'))
    .filter((row) => visibleCandidate(row, req.user))
    .filter((row) => !exclude.has(String(row.candidate_id || '').trim()))
    .filter((row) => String(row.follow_up_at || '').trim())
    .filter((row) => String(row.follow_up_status || '').toLowerCase() !== 'done')
    .map((row) => {
      const dueAt = new Date(row.follow_up_at || 0).getTime() || 0;
      return {
        ...row,
        due_in_minutes: dueInMinutes(row.follow_up_at, now),
        reminder_buffer_minutes: 10,
        is_due: dueAt ? dueAt <= triggerUntil : false,
        is_today: dueAt ? new Date(dueAt).toDateString() === new Date(now).toDateString() : false,
        dueAt,
      };
    })
    .filter((row) => row.dueAt && row.dueAt <= triggerUntil)
    .sort((a, b) => a.dueAt - b.dueAt)[0] || null;
  return res.json({ item: next ? sanitizeCandidateForUser(next, req.user) : null });
}

async function followupUpcoming(req, res) {
  const now = Date.now();
  const items = (await table('candidates'))
    .filter((row) => visibleCandidate(row, req.user))
    .filter((row) => String(row.follow_up_at || '').trim())
    .filter((row) => String(row.follow_up_status || '').toLowerCase() !== 'done')
    .map((row) => {
      const dueAt = new Date(row.follow_up_at || 0).getTime() || 0;
      return {
        ...row,
        due_in_minutes: dueAt ? Math.round((dueAt - now) / 60000) : '',
        is_due: dueAt ? dueAt <= now : false,
        is_today: dueAt ? new Date(dueAt).toDateString() === new Date(now).toDateString() : false,
      };
    })
    .sort((a, b) => String(a.follow_up_at || '').localeCompare(String(b.follow_up_at || '')));
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
    follow_up_at: nextFollowUpAt || (String(nextStatus).toLowerCase() === 'done' ? '' : candidate.follow_up_at || ''),
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
  const rows = await table('candidates');
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
  const note = String(req.body?.note || '').trim();
  let changed = 0;
  for (const row of visibleRows) {
    const next = normalizeCandidate({ ...row, ...updates }, row, req.user);
    if (assignRecruiterCode && isLeadership(req.user)) {
      next.recruiter_code = assignRecruiterCode;
      if (assignRecruiterName) next.recruiter_name = assignRecruiterName;
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
  return res.json({ ok: true, changed });
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
    status: 'In - Progress',
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
  const items = users
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
        if (columns.has('deleted_at')) deletedParts.push(`coalesce(deleted_at, '') <> ''`);
        if (columns.has('status')) deletedParts.push(`lower(coalesce(status, '')) in ('deleted', '__deleted__')`);
        if (columns.has('approval_status')) deletedParts.push(`lower(coalesce(approval_status, '')) in ('deleted', '__deleted__')`);
        if (columns.has('all_details_sent')) deletedParts.push(`lower(coalesce(all_details_sent, '')) = 'deleted'`);
        if (columns.has('data_notes')) deletedParts.push(`lower(coalesce(data_notes, '')) like '%[crm-deleted]%'`);
        clauses.push(`(${deletedParts.length ? deletedParts.join(' or ') : '1 = 0'})`);
      } else {
        if (columns.has('deleted_at')) clauses.push(`coalesce(deleted_at, '') = ''`);
        if (columns.has('status')) clauses.push(`lower(coalesce(status, '')) not in ('deleted', '__deleted__')`);
        if (columns.has('approval_status')) clauses.push(`lower(coalesce(approval_status, '')) not in ('deleted', '__deleted__')`);
        if (columns.has('all_details_sent')) clauses.push(`lower(coalesce(all_details_sent, '')) <> 'deleted'`);
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
      const sql = `select ${selectSql} from public.candidates where ${clauses.length ? clauses.join(' and ') : '1 = 1'} order by coalesce(${qcol(orderField)}, '') desc limit ${includeDeleted ? 1200 : 8000}`;
      return (await store.query(sql, params)).map((row) => enrichCandidate(row));
    } catch {}
  }
  return (await table('candidates')).map((row) => enrichCandidate(row));
}

async function listDuplicateReviewGroups(req, res) {
  const cacheKey = duplicateCacheKey(req, 'duplicates');
  const cached = duplicateReviewCache.get(cacheKey);
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

function removeDeletedNotesMarker(value) {
  return String(value || '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !lower(part).includes('[crm-deleted]'))
    .join(' | ');
}

async function listDeletedProfiles(req, res) {
  if (!canDeleteCandidate(req.user)) return res.status(403).json({ message: 'Only managers can view deleted profiles' });
  const cacheKey = duplicateCacheKey(req, 'deleted');
  const cached = duplicateReviewCache.get(cacheKey);
  if (cached) return res.json(cached);
  const rows = (await candidateReviewRowsForUser(req, { includeDeleted: true }))
    .filter((row) => isDeletedCandidate(row))
    .sort((a, b) => String(b.deleted_at || b.updated_at || '').localeCompare(String(a.deleted_at || a.updated_at || '')) || String(b.candidate_id || '').localeCompare(String(a.candidate_id || '')))
    .slice(0, 800);
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
  const restoredAt = nowIso();
  const updates = {
    status: 'In - Progress',
    approval_status: 'Draft',
    all_details_sent: '',
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
  invalidateCandidateCaches();
  clearAllCaches();
  logActivity(req, candidateId, 'profile_restored', { restored_by: req.user.full_name || req.user.username || '' }).catch(() => {});
  return res.json({ ok: true, item: sanitizeCandidateForUser(enrichCandidate(item), req.user) });
}

async function hardDeleteCandidateGraph(candidateId) {
  const linkedFiles = (await listCandidateFiles(candidateId)).map((item) => String(item.file_id || '')).filter(Boolean);
  if (store.pool) {
    const client = await store.pool.connect();
    try {
      await client.query('begin');
      const childDeletes = [
        ['notes', 'candidate_id'],
        ['activity_log', 'candidate_id'],
        ['submissions', 'candidate_id'],
        ['interviews', 'candidate_id'],
        ['followups', 'candidate_id'],
        ['interview_remove_requests', 'candidate_id'],
        ['candidate_jd_feedback', 'candidate_id'],
        ['revenue_hub_entries', 'candidate_id'],
      ];
      for (const [tableName, fieldName] of childDeletes) {
        await client.query(`delete from public.${tableName} where ${fieldName} = $1`, [candidateId]);
      }
      if (linkedFiles.length) {
        await client.query('delete from public.candidate_file_contents where file_id = any($1::text[])', [linkedFiles]).catch(() => {});
      }
      await client.query('delete from public.candidate_files where candidate_id = $1', [candidateId]);
      const deleted = await client.query('delete from public.candidates where candidate_id = $1 returning candidate_id', [candidateId]);
      await client.query('commit');
      return deleted.rows.some((row) => String(row?.candidate_id || '') === String(candidateId));
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  const cleanupSteps = [
    ['notes', 'candidate_id'],
    ['activity_log', 'candidate_id'],
    ['submissions', 'candidate_id'],
    ['interviews', 'candidate_id'],
    ['followups', 'candidate_id'],
    ['candidate_files', 'candidate_id'],
    ['interview_remove_requests', 'candidate_id'],
    ['candidate_jd_feedback', 'candidate_id'],
    ['revenue_hub_entries', 'candidate_id'],
  ];
  for (const [tableName, fieldName] of cleanupSteps) {
    await store.deleteWhere(tableName, fieldName, candidateId).catch(() => {});
  }
  for (const fileId of linkedFiles) {
    await store.deleteWhere('candidate_file_contents', 'file_id', fileId).catch(() => {});
  }
  return store.delete('candidates', 'candidate_id', candidateId);
}

async function softHideCandidate(candidateId, reqUser) {
  const markedAt = nowIso();
  const markedBy = String(reqUser?.full_name || reqUser?.username || '').trim();
  const existing = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
  const notesMarker = `[CRM-DELETED] ${markedAt} by ${markedBy || 'system'}`;
  const nextNotes = String(existing?.data_notes || '').includes('[CRM-DELETED]')
    ? String(existing?.data_notes || '')
    : [String(existing?.data_notes || '').trim(), notesMarker].filter(Boolean).join(' | ');

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
  const ids = [...new Set((Array.isArray(candidateIds) ? candidateIds : []).map((item) => String(item || '').trim()).filter(Boolean))];
  const soft_hidden_ids = [];
  const failed = [];

  for (const candidateId of ids) {
    try {
      // CRITICAL SAFETY RULE: one request may affect only this exact candidate_id.
      // Never delete by phone, name, duplicate group, or any matching rule.
      const candidate = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
      if (!candidate || isDeletedCandidate(candidate) || !visibleCandidate(enrichCandidate(candidate), req.user)) {
        failed.push({ candidate_id: candidateId, reason: 'Candidate not found or already removed from CRM view' });
        continue;
      }

      const softHidden = await softHideCandidate(candidateId, req.user);
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

  clearAllCaches();
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
  return res.json({ ok: true, candidate_id: candidateId, deleted_ids: result.deleted_ids, soft_hidden_ids: result.soft_hidden_ids, failed: result.failed });
}

async function bulkDeleteCandidates(req, res) {
  if (!canDeleteCandidate(req.user)) return res.status(403).json({ message: 'Only managers can delete profiles' });
  const candidateIds = Array.isArray(req.body?.candidate_ids) ? req.body.candidate_ids : [];
  const result = await deleteCandidatesBatch(req, candidateIds);
  return res.json({ ok: true, deleted_ids: result.deleted_ids, soft_hidden_ids: result.soft_hidden_ids, failed: result.failed, requested_count: candidateIds.length });
}

async function bulkReassign(req, res) {
  if (!canManageBucketOut(req.user)) return res.status(403).json({ message: 'Only manager/admin can reassign profiles' });
  const candidateIds = Array.isArray(req.body?.candidate_ids) ? req.body.candidate_ids.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const targetUserId = String(req.body?.target_user_id || '').trim();
  if (!candidateIds.length) return res.status(400).json({ message: 'candidate_ids required' });
  if (!targetUserId) return res.status(400).json({ message: 'target_user_id required' });
  const users = await table('users');
  const targetUser = users.find((user) => {
    const userId = bucketTargetId(user);
    return userId === targetUserId
      || String(user.user_id || '').trim() === targetUserId
      || String(user.id || '').trim() === targetUserId
      || String(user.username || '').trim() === targetUserId
      || String(user.recruiter_code || '').trim() === targetUserId;
  });
  if (!targetUser) return res.status(404).json({ message: 'Target user not found' });
  const updatedItems = [];
  for (const candidateId of candidateIds) {
    const existing = await store.findById('candidates', 'candidate_id', candidateId);
    if (!existing) continue;
    if (!visibleCandidate(existing, req.user)) continue;
    const next = await store.update('candidates', 'candidate_id', candidateId, {
      recruiter_code: targetUser.recruiter_code || '',
      recruiter_name: targetUser.full_name || '',
      recruiter_designation: targetUser.designation || targetUser.role || '',
      bucket_assigned_at: nowIso(),
      updated_at: nowIso(),
    });
    invalidateCandidateCaches();
    updatedItems.push(enrichCandidate(next));
    await makeNotification(
      targetUser.user_id,
      'Profile reassigned',
      `${req.user.full_name} reassigned ${next.full_name || next.candidate_id} to you.`,
      'candidate',
      JSON.stringify({ candidate_id: next.candidate_id, open_path: `/candidate/${next.candidate_id}` }),
    );
  }
  return res.json({ items: updatedItems, count: updatedItems.length });
}

async function uploadCandidateFile(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });

  const fileKind = String(req.body?.file_kind || '').trim();
  if (!ALLOWED_FILE_TYPES.has(fileKind)) return res.status(400).json({ message: 'Unsupported file slot.' });

  let originalName = escapeFilename(req.body?.file_name || `${fileKind}.bin`);
  const rawBase64 = String(req.body?.content_base64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!rawBase64) return res.status(400).json({ message: 'File content is missing.' });

  let buffer = null;
  try {
    buffer = Buffer.from(rawBase64, 'base64');
  } catch {
    return res.status(400).json({ message: 'File content is invalid.' });
  }
  if (!buffer?.length) return res.status(400).json({ message: 'File content is empty.' });
  if (buffer.length > MAX_FILE_BYTES) return res.status(400).json({ message: `File is too large. Max ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB allowed.` });

  let effectiveMimeType = candidateFileContentType(originalName, req.body?.mime_type || 'application/octet-stream');
  const policy = uploadPolicy(fileKind);
  if (!isAllowedCandidateUploadType(fileKind, originalName, effectiveMimeType)) {
    return res.status(400).json({ message: `${policy.label} upload only supports ${policy.friendlyTypes}.` });
  }

  const originalSize = buffer.length;
  try {
    const optimized = maybeOptimizeCandidateUpload({ fileKind, originalName, mimeType: effectiveMimeType, buffer });
    if (optimized?.buffer?.length) {
      buffer = optimized.buffer;
      originalName = escapeFilename(optimized.fileName || originalName);
      effectiveMimeType = optimized.mimeType || effectiveMimeType;
    }
  } catch {}

  const finalLimitBytes = Number(policy.finalMaxBytes || 0);
  const compressorRequired = originalSize > finalLimitBytes;
  if (buffer.length > finalLimitBytes) {
    const compressorMissing = fileKind === 'resume'
      ? (!commandExists('gs') && !commandExists('convert'))
      : !commandExists('ffmpeg');
    const reason = compressorMissing
      ? ` Server compressor unavailable hai aur final size ${formatUploadSize(buffer.length)} hai.`
      : compressorRequired
        ? ` Compress karne ke baad bhi size ${formatUploadSize(buffer.length)} raha.`
        : ` Size ${formatUploadSize(buffer.length)} hai.`;
    return res.status(400).json({ message: uploadSizeErrorMessage(fileKind, reason) });
  }

  const fileId = makeFastId('F');
  const createdAt = nowIso();
  const item = {
    file_id: fileId,
    candidate_id: candidate.candidate_id,
    file_kind: fileKind,
    original_name: originalName,
    storage_name: `${candidate.candidate_id}_${fileKind}_${fileId}_${originalName}`.slice(0, 180),
    mime_type: effectiveMimeType,
    size_bytes: String(buffer.length),
    content_base64: buffer.toString('base64'),
    uploaded_by_user_id: req.user.user_id || '',
    uploaded_by_name: req.user.full_name || req.user.username || '',
    created_at: createdAt,
  };
  await store.insert('candidate_files', item);
  const updates = {
    updated_at: createdAt,
    resume_filename: fileKind === 'resume' ? originalName : candidate.resume_filename || '',
    recording_filename: fileKind === 'call_recording' ? originalName : candidate.recording_filename || '',
  };
  await store.update('candidates', 'candidate_id', candidate.candidate_id, updates);
  invalidateCandidateCaches();
  logActivity(req, candidate.candidate_id, 'candidate_file_uploaded', { file_kind: fileKind, file_name: originalName }).catch(() => {});
  const files = await listCandidateFiles(candidate.candidate_id);
  return res.json({
    item: {
      file_id: item.file_id,
      candidate_id: item.candidate_id,
      file_kind: item.file_kind,
      original_name: item.original_name,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      uploaded_by_user_id: item.uploaded_by_user_id,
      uploaded_by_name: item.uploaded_by_name,
      created_at: item.created_at,
    },
    files,
    candidate_updates: updates,
  });
}

async function downloadCandidateFile(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!visibleCandidate(candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });

  let file = null;
  if (mode === 'postgres' && store.pool) {
    file = await store.one(`select * from public.candidate_files where candidate_id = $1 and file_id = $2 limit 1`, [req.params.candidateId, req.params.fileId]);
  } else {
    file = (await table('candidate_files')).find((row) => String(row.candidate_id) === String(req.params.candidateId) && String(row.file_id) === String(req.params.fileId)) || null;
  }
  if (!file) return res.status(404).json({ message: 'File not found' });
  const content = String(file.content_base64 || '').trim();
  if (!content) return res.status(404).json({ message: 'Stored file content is empty.' });

  const buffer = Buffer.from(content, 'base64');
  logActivity(req, candidate.candidate_id, 'candidate_file_downloaded', { file_kind: file.file_kind || '', file_name: file.original_name || '' }).catch(() => {});
  res.setHeader('Content-Type', candidateFileContentType(file.original_name, file.mime_type));
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Content-Disposition', `attachment; filename="${escapeFilename(file.original_name || 'candidate-file')}"`);
  return res.send(buffer);
}

module.exports = {
  list,
  listHotLeads,
  create,
  bulkCreate,
  getOne,
  listFilesForCandidate,
  logOpen,
  update,
  submitForApproval,
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
