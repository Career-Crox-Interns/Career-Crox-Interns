const { store, table, mode } = require('../lib/store');
const { containsText, nextId, nowIso, ymd, calcExperienceRange, calcSalaryRange, recruiterCodeMatches, normalizeIndianPhone, phoneMatches } = require('../lib/helpers');
const { createTimedCache, clearAllCaches } = require('../lib/cache');
const { isManager, isTl, canViewCandidate } = require('../lib/visibility');

const PROCESS_OPTIONS = [
  'Air India', 'Airtel', 'UrbanClap', 'Kotak', 'Tata 1mg', 'Axis Bank', 'Samsung',
  'Tata Motors', 'Icegate', 'Icertate', 'Xiaomi', 'Xiaomi - Regional Language', 'American Express',
  'Razorpay', 'RBL / OLX', 'HDFC Back Office', 'Other',
];

const candidateListCache = createTimedCache(3500);
const candidateNavCache = createTimedCache(5000);
const MAX_FILE_BYTES = Number(process.env.CANDIDATE_FILE_MAX_BYTES || (12 * 1024 * 1024));
const ALLOWED_FILE_TYPES = new Set(['resume', 'call_recording']);


const PERSISTED_CANDIDATE_FIELDS = [
  'candidate_id','call_connected','looking_for_job','full_name','phone','location','qualification','recruiter_code',
  'preferred_location','in_hand_salary','relevant_experience','communication_skill','process','interview_reschedule_date',
  'virtual_onsite','notes','reference_details','follow_up_at','status','all_details_sent','submission_date','approval_status',
  'approved_at','approved_by_name','career_gap','recording_filename','resume_filename','documents_availability',
  'relevant_experience_range','relevant_in_hand_range','total_experience','manager_crm','interview_remove_request_id',
  'interview_remove_status','interview_remove_reason','interview_remove_approved_at','submitted_by','data_uploading_date',
  'data_notes','qualification_level','ctc_monthly','recruiter_name','recruiter_designation','interview_availability',
  'approval_requested_at','is_duplicate','follow_up_note','follow_up_status','bucket_assigned_at','created_at','updated_at',
  'experience','source_sr_no'
];

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

async function findPendingSubmissionCompat(candidateId) {
  if (mode === 'postgres' && store.pool) {
    try {
      return await store.one(`select submission_id, jd_id from public.submissions where candidate_id = $1 and lower(coalesce(approval_status, '')) = 'pending' order by coalesce(submitted_at, approval_requested_at, updated_at, '') desc limit 1`, [candidateId]);
    } catch (error) {
      if (!isUndefinedColumnError(error, ['updated_at'])) throw error;
      return store.one(`select submission_id, jd_id from public.submissions where candidate_id = $1 and lower(coalesce(approval_status, '')) = 'pending' order by coalesce(submitted_at, approval_requested_at, '') desc limit 1`, [candidateId]);
    }
  }
  const submissions = await table('submissions');
  const hit = submissions
    .filter((row) => String(row.candidate_id) === String(candidateId) && lower(row.approval_status) === 'pending')
    .sort((a, b) => String(b.submitted_at || b.approval_requested_at || b.updated_at || '').localeCompare(String(a.submitted_at || a.approval_requested_at || a.updated_at || '')))[0] || null;
  return hit ? { submission_id: hit.submission_id, jd_id: hit.jd_id } : null;
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
    .slice(0, 120) || 'file';
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
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  return fallback || 'application/octet-stream';
}

function invalidateCandidateCaches() {
  candidateListCache.clear();
  candidateNavCache.clear();
  clearAllCaches();
}

function sanitizeCandidateFile(file) {
  if (!file || typeof file !== 'object') return file;
  const clone = { ...file };
  delete clone.content_base64;
  return clone;
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
const TERMINAL_APPROVALS = new Set(['approved', 'rejected']);

function isLeadership(user) {
  return isManager(user) || isTl(user);
}
function canManageBucketOut(user) {
  return isManager(user);
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
  return TERMINAL_STATUSES.has(lower(row?.status)) || TERMINAL_APPROVALS.has(lower(row?.approval_status));
}
function isFreshCandidate(row) {
  if (isTerminalCandidate(row)) return false;
  return lower(row?.call_connected) !== 'yes' && !String(row?.follow_up_at || '').trim();
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
async function visibleCandidate(row, user) {
  if (!(await canViewCandidate(row, user))) return false;
  if (isManager(user) || isTl(user)) return true;
  return !computeBucketMeta(row).bucketOut;
}

function matchesBucketView(row, filters) {
  const view = lower(filters?.bucket_view || 'all');
  if (!view || view === 'all') return !row.bucket_is_bucket_out && !row.bucket_is_terminal;
  if (view === 'fresh') return row.bucket_is_fresh && !row.bucket_is_bucket_out;
  if (view === 'followup') return row.bucket_is_followup && !row.bucket_is_bucket_out;
  if (view === 'followup_due') return row.bucket_is_followup_due && !row.bucket_is_bucket_out;
  if (view === 'allocated') return !row.bucket_is_bucket_out && !row.bucket_is_terminal;
  if (view === 'warning') return row.bucket_stage === 'warning';
  if (view === 'last_day') return row.bucket_stage === 'last_day';
  if (view === 'safe' || view === 'days_4_plus') return row.bucket_days_left >= 4 && !row.bucket_is_bucket_out && !row.bucket_is_terminal && !row.bucket_is_fresh;
  if (view === 'days_3') return row.bucket_days_left === 3 && !row.bucket_is_bucket_out;
  if (view === 'days_2') return row.bucket_days_left === 2 && !row.bucket_is_bucket_out;
  if (view === 'days_1') return row.bucket_days_left === 1 && !row.bucket_is_bucket_out;
  if (view === 'bucket_out') return row.bucket_is_bucket_out;
  return !row.bucket_is_bucket_out;
}
function sortBucketRows(rows, bucketView = 'all') {
  const view = lower(bucketView || 'all');
  const copy = [...rows];
  copy.sort((a, b) => {
    const aFreshRank = a.bucket_is_fresh ? 0 : 1;
    const bFreshRank = b.bucket_is_fresh ? 0 : 1;
    if (view === 'fresh' && aFreshRank !== bFreshRank) return aFreshRank - bFreshRank;
    if (view === 'followup') {
      const aDate = parseMaybeDate(a.follow_up_at)?.getTime() || Number.MAX_SAFE_INTEGER;
      const bDate = parseMaybeDate(b.follow_up_at)?.getTime() || Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
    }
    if (view === 'bucket_out') {
      if (a.bucket_days_passed !== b.bucket_days_passed) return b.bucket_days_passed - a.bucket_days_passed;
    } else {
      const aLeft = Number.isFinite(Number(a.bucket_days_left)) ? Number(a.bucket_days_left) : Number.MAX_SAFE_INTEGER;
      const bLeft = Number.isFinite(Number(b.bucket_days_left)) ? Number(b.bucket_days_left) : Number.MAX_SAFE_INTEGER;
      if (aLeft !== bLeft) return aLeft - bLeft;
    }
    return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
  });
  return copy;
}
function buildBucketSummary(rows) {
  const activeRows = rows.filter((row) => !row.bucket_is_bucket_out && !row.bucket_is_terminal);
  return {
    total_visible: rows.length,
    active_bucket: activeRows.length,
    bucket_capacity_max: BUCKET_MAX_ACTIVE,
    fresh_profiles: activeRows.filter((row) => row.bucket_is_fresh).length,
    followup_profiles: activeRows.filter((row) => row.bucket_is_followup).length,
    pending_followups: activeRows.filter((row) => row.bucket_is_followup_due).length,
    allocated_profiles: activeRows.length,
    warning_profiles: activeRows.filter((row) => row.bucket_stage === 'warning').length,
    last_day_profiles: activeRows.filter((row) => row.bucket_stage === 'last_day').length,
    safe_profiles: activeRows.filter((row) => row.bucket_stage === 'safe').length,
    bucket_out_profiles: rows.filter((row) => row.bucket_is_bucket_out).length,
    days_1: activeRows.filter((row) => Number(row.bucket_days_left) === 1).length,
    days_2: activeRows.filter((row) => Number(row.bucket_days_left) === 2).length,
    days_3: activeRows.filter((row) => Number(row.bucket_days_left) === 3).length,
    days_4_plus: activeRows.filter((row) => Number(row.bucket_days_left) >= 4).length,
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
    metadata: JSON.stringify(metadata),
    created_at: nowIso(),
  };
  await store.insert('activity_log', item);
  return item;
}

async function notifyLeaders(title, message, metadata = '') {
  const users = await table('users');
  for (const user of users.filter((u) => ['admin', 'manager', 'tl'].includes(lower(u.role)))) {
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

function normalizeCandidate(payload, existing, user) {
  const merged = { ...pickCandidateFields(existing), ...pickCandidateFields(payload) };
  merged.call_connected = merged.call_connected || 'No';
  merged.looking_for_job = merged.looking_for_job || 'Yes';
  merged.phone = normalizeIndianPhone(merged.phone || '');
  merged.preferred_location = merged.preferred_location || 'Noida';
  merged.qualification_level = merged.qualification_level || merged.degree || 'Graduate';
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
  merged.recruiter_code = existing?.recruiter_code || user?.recruiter_code || merged.recruiter_code || '';
  merged.recruiter_name = existing?.recruiter_name || user?.full_name || merged.recruiter_name || '';
  merged.recruiter_designation = existing?.recruiter_designation || user?.designation || merged.recruiter_designation || '';
  merged.interview_availability = merged.interview_availability || '';
  merged.status = merged.status || 'In - Progress';
  merged.all_details_sent = merged.all_details_sent || 'Pending';
  merged.submission_date = merged.submission_date || nowLocalDateTime();
  merged.process = Array.isArray(merged.process) ? merged.process.join(', ') : String(merged.process || '');
  merged.bucket_assigned_at = existing?.bucket_assigned_at || merged.bucket_assigned_at || merged.created_at || nowIso();
  merged.updated_at = nowIso();
  return pickCandidateFields(merged);
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
    page: Math.max(1, Number(req.query.page || 1) || 1),
    page_size: Math.min(25, Math.max(5, Number(req.query.page_size || 10) || 10)),
    around_id: String(req.query.around_id || '').trim(),
    bucket_view: String(req.query.bucket_view || 'all').trim(),
    duplicate_only: String(req.query.duplicate_only || '').trim() === '1',
  };
}

function rowMatchesFilters(row, filters, user) {
  const duplicateFlag = String(row?.is_duplicate || '0') === '1';
  if (filters.duplicate_only) {
    if (!duplicateFlag) return false;
  } else if (duplicateFlag) {
    return false;
  }
  if (filters.q && !['candidate_id', 'full_name', 'phone', 'process', 'notes', 'location', 'preferred_location', 'recruiter_code'].some((key) => containsText(row[key], filters.q))) return false;
  if (filters.recruiter && !containsText(row.recruiter_name, filters.recruiter) && !containsText(row.recruiter_code, filters.recruiter)) return false;
  if (filters.recruiter_code_text && !containsText(row.recruiter_code, filters.recruiter_code_text)) return false;
  if (filters.name.length && !filters.name.includes(String(row.full_name || ''))) return false;
  if (filters.phone.length && !filters.phone.some((value) => phoneMatches(row.phone || '', value))) return false;
  if (filters.recruiter_code.length && !filters.recruiter_code.includes(String(row.recruiter_code || ''))) return false;
  if (filters.location.length && !splitCsv(row.location).some((item) => filters.location.includes(item))) return false;
  if (filters.preferred_location.length && !splitCsv(row.preferred_location).some((item) => filters.preferred_location.includes(item))) return false;
  if (filters.status.length && !filters.status.map(lower).includes(lower(row.status))) return false;
  if (filters.approval_status.length && !filters.approval_status.map(lower).includes(lower(row.approval_status))) return false;
  if (filters.qualification.length && !filters.qualification.includes(String(row.qualification || row.qualification_level || ''))) return false;
  if (filters.process.length && !splitCsv(row.process).some((item) => filters.process.includes(item))) return false;
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
  const interviewDate = String(row.interview_date || row.interview_reschedule_date || '');
  if (filters.interview_from && interviewDate < filters.interview_from) return false;
  if (filters.interview_to && interviewDate > filters.interview_to) return false;
  if ((filters.salary_from !== '' || filters.salary_to !== '') && !inNumericRange(row.in_hand_salary || row.ctc_monthly, filters.salary_from, filters.salary_to)) return false;
  if ((filters.total_exp_from !== '' || filters.total_exp_to !== '') && !inNumericRange(row.total_experience || row.experience, filters.total_exp_from, filters.total_exp_to)) return false;
  if ((filters.relevant_exp_from !== '' || filters.relevant_exp_to !== '') && !inNumericRange(row.relevant_experience, filters.relevant_exp_from, filters.relevant_exp_to)) return false;
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
    params.push(String(req.user.recruiter_code || ''));
    const codeRef = `$${params.length}`;
    params.push(String(req.user.full_name || ''));
    const nameRef = `$${params.length}`;
    clauses.push(`(lower(coalesce(recruiter_name, '')) = lower(${nameRef}) or (coalesce(recruiter_name, '') = '' and coalesce(recruiter_code, '') = ${codeRef}))`);
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
    clauses.push(`(lower(coalesce(qualification, '')) = any($${params.length}) or lower(coalesce(qualification_level, '')) = any($${params.length}))`);
  }
  applyLikeAnySql(clauses, params, `coalesce(process, '')`, filters.process);
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
  const rows = [];
  for (const row of await table('candidates')) {
    if (await visibleCandidate(row, user)) rows.push(row);
  }
  rows.sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) || String(b.candidate_id || '').localeCompare(String(a.candidate_id || '')));
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
    return res.json({ items: [], nav_items: navItems, process_options: PROCESS_OPTIONS, total: navItems.length, page: 1, page_size: 3, has_more: false, summary: buildBucketSummary([]) });
  }

  let baseRows = [];
  if (mode === 'postgres' && store.pool) {
    const { whereSql, params } = buildSqlFilter(req);
    const rawRows = await store.query(
      `select * from public.candidates ${whereSql} order by coalesce(updated_at, created_at, '') desc, candidate_id desc limit 5000`,
      params,
    );
    for (const row of rawRows) {
      if (await visibleCandidate(row, req.user)) baseRows.push(row);
    }
  } else {
    const rows = await table('candidates');
    for (const row of rows) {
      if (await visibleCandidate(row, req.user) && rowMatchesFilters(row, filters, req.user)) baseRows.push(row);
    }
    baseRows.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  const decoratedRows = baseRows.map((row) => enrichCandidate(row));
  const enrichedRows = decoratedRows.filter((row) => {
    if (!isLeadership(req.user) && row.bucket_is_bucket_out) return false;
    return matchesBucketView(row, filters);
  });
  const sortedRows = sortBucketRows(enrichedRows, filters.bucket_view);
  const offset = (filters.page - 1) * filters.page_size;
  const items = sortedRows.slice(offset, offset + filters.page_size);
  const summary = buildBucketSummary(decoratedRows.filter((row) => (isLeadership(req.user) ? true : !row.bucket_is_bucket_out)));
  const payload = {
    items,
    filter_source_rows: sortedRows.slice(0, 250),
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
  }, req.user);
  await store.insert('candidates', item);
  invalidateCandidateCaches();
  logActivity(req, item.candidate_id, 'candidate_created', { full_name: item.full_name || '' }).catch(() => {});
  return res.json({ item });
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
  return res.json({ items: created, count: created.length });
}


async function getOne(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).json({ message: 'Candidate not found' });
  if (!(await visibleCandidate(item, req.user))) return res.status(403).json({ message: 'Not allowed' });
  const prefetchOnly = String(req.query.prefetch || '').trim() === '1';
  let notesPromise = Promise.resolve([]);
  let timelinePromise = Promise.resolve([]);
  if (!prefetchOnly) {
    if (mode === 'postgres' && store.pool) {
      notesPromise = store.query(`select * from public.notes where candidate_id = $1 order by created_at desc limit 120`, [req.params.candidateId]);
      timelinePromise = store.query(`select * from public.activity_log where candidate_id = $1 order by created_at desc limit 140`, [req.params.candidateId]);
    } else {
      notesPromise = table('notes').then((rows) => rows.filter((n) => String(n.candidate_id) === String(req.params.candidateId)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 120));
      timelinePromise = table('activity_log').then((rows) => rows.filter((n) => String(n.candidate_id) === String(req.params.candidateId)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 140));
    }
  }
  const [notes, timeline, navItems, files] = await Promise.all([
    notesPromise,
    timelinePromise,
    getAroundNav(req.user, req.params.candidateId),
    prefetchOnly ? Promise.resolve([]) : listCandidateFiles(req.params.candidateId),
  ]);
  return res.json({ item: enrichCandidate(item), notes, timeline, files, nav_items: navItems, process_options: PROCESS_OPTIONS });
}

async function logOpen(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).json({ message: 'Candidate not found' });
  logActivity(req, req.params.candidateId, 'profile_opened', { full_name: item.full_name || '', section: 'candidate detail' }).catch(() => {});
  return res.json({ ok: true });
}

async function update(req, res) {
  const existing = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!existing) return res.status(404).json({ message: 'Candidate not found' });
  const dbPayload = { ...(req.body || {}) };
  delete dbPayload.jd_fit_summary;
  delete dbPayload.notes_list;
  delete dbPayload.timeline;
  delete dbPayload.nav_items;
  delete dbPayload.process_options;
  const normalized = normalizeCandidate(dbPayload, existing, req.user);
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
    return res.json({ item: decorateCandidateWithFit(item, jdRows) });
  }
  return res.json({ item: enrichCandidate(item) });
}

async function submitForApproval(req, res) {
  const existing = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!existing) return res.status(404).json({ message: 'Candidate not found' });
  if (!(await visibleCandidate(existing, req.user))) return res.status(403).json({ message: 'Not allowed' });
  const existingSubmission = await findPendingSubmissionCompat(req.params.candidateId);
  if (lower(existing.approval_status) === 'pending' && existingSubmission?.submission_id) {
    return res.json({
      item: enrichCandidate({ ...existing, status: 'In - Progress', all_details_sent: 'Pending' }),
      submission: existingSubmission,
      already_pending: true,
    });
  }
  const item = normalizeCandidate(req.body || {}, existing, req.user);
  if (lower(item.looking_for_job) !== 'yes') {
    return res.status(400).json({ message: 'Looking For Job is set to No. You can save draft, but submit is blocked.' });
  }
  const required = ['full_name', 'phone', 'qualification', 'location', 'preferred_location', 'qualification_level', 'total_experience', 'relevant_experience', 'in_hand_salary', 'ctc_monthly', 'career_gap', 'relevant_experience_range', 'relevant_in_hand_range', 'communication_skill', 'interview_reschedule_date', 'status', 'all_details_sent', 'submission_date', 'virtual_onsite', 'documents_availability'];
  const missing = required.filter((key) => !String(item[key] || '').trim());
  const candidateFiles = await listCandidateFiles(req.params.candidateId);
  const hasResume = candidateFiles.some((file) => String(file.file_kind || '').trim() === 'resume') || String(existing.resume_filename || item.resume_filename || '').trim();
  const hasRecording = candidateFiles.some((file) => String(file.file_kind || '').trim() === 'call_recording') || String(existing.recording_filename || item.recording_filename || '').trim();
  if (!hasResume) missing.push('resume_upload');
  if (!hasRecording) missing.push('recording_upload');
  if (missing.length) return res.status(400).json({ message: `Missing required fields: ${missing.join(', ')}` });

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
  return res.json({ item: enrichCandidate(updated), submission });
}

async function addNote(req, res) {
  const item = {
    id: makeFastBigIntId(),
    candidate_id: req.params.candidateId,
    username: req.user.username,
    note_type: req.body.note_type || 'public',
    body: req.body.body || '',
    created_at: nowIso(),
  };
  await store.insert('notes', item);
  invalidateCandidateCaches();
  logActivity(req, req.params.candidateId, 'note_added', { body: item.body, note_type: item.note_type }).catch(() => {});
  return res.json({ item });
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
    created_at: nowIso(),
  };
  await store.insert('notes', item);
  await store.update('candidates', 'candidate_id', candidateId, { updated_at: nowIso() });
  invalidateCandidateCaches();
  logActivity(req, candidateId, 'note_added', { body: item.body, note_type: item.note_type }).catch(() => {});
  return res.json({ item });
}

async function logCall(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).json({ message: 'Candidate not found' });
  await store.update('candidates', 'candidate_id', req.params.candidateId, { call_connected: 'Yes', updated_at: nowIso() });
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
  logActivity(req, item.candidate_id, 'call_logged', { phone: item.phone || '' }).catch(() => {});
  return res.json({ ok: true });
}

async function whatsapp(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).send('Not found');
  const text = String(req.query.text || '').trim();
  const clean = normalizeIndianPhone(item.phone || '');
  if (!clean) return res.status(400).send('Phone not available');
  const base = `https://wa.me/91${clean}`;
  return res.redirect(text ? `${base}?text=${encodeURIComponent(text)}` : base);
}

async function whatsappLog(req, res) {
  const item = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!item) return res.status(404).json({ message: 'Candidate not found' });
  logActivity(req, item.candidate_id, 'whatsapp_opened', { phone: item.phone || '', text: String(req.body?.text || '').trim() }).catch(() => {});
  return res.json({ ok: true });
}

async function followupUpcoming(req, res) {
  const visible = [];
  for (const row of (await table('candidates')).map(enrichCandidate)) {
    if (await visibleCandidate(row, req.user)) visible.push(row);
  }
  const items = visible
    .filter((row) => String(row.follow_up_at || '').trim())
    .filter((row) => lower(row.follow_up_status) !== 'done')
    .sort((a, b) => String(a.follow_up_at || '').localeCompare(String(b.follow_up_at || '')))
    .slice(0, 200);
  return res.json({ items });
}


async function followupAction(req, res) {
  const candidateId = String(req.body?.candidate_id || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'candidate_id required' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!(await visibleCandidate(candidate, req.user))) return res.status(403).json({ message: 'Not allowed' });
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
  return res.json({ item });
}

async function requestInterviewDateRemoval(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!(await visibleCandidate(candidate, req.user))) return res.status(403).json({ message: 'Not allowed' });
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
  if (!(await visibleCandidate(candidate, req.user))) return res.status(403).json({ message: 'Not allowed' });
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
  const visibleRows = [];
  for (const row of rows) { if (candidateIds.includes(String(row.candidate_id)) && await visibleCandidate(row, req.user)) visibleRows.push(row); }
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
  const rows = [];
  for (const row of await table('candidates')) { if (await visibleCandidate(row, req.user)) rows.push(row); }
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
  if (!(await visibleCandidate(candidate, req.user))) return res.status(403).json({ message: 'Not allowed' });
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
  return res.json({ item });
}

async function reassignTargets(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Leadership access only' });
  const users = await table('users');
  const items = users
    .filter((user) => ['recruiter', 'tl', 'manager', 'admin'].includes(lower(user.role)))
    .map((user) => ({
      user_id: user.user_id,
      full_name: user.full_name,
      role: user.role,
      recruiter_code: user.recruiter_code || '',
      designation: user.designation || '',
    }))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  return res.json({ items });
}

async function bulkReassign(req, res) {
  if (!canManageBucketOut(req.user)) return res.status(403).json({ message: 'Only manager/admin can bulk reassign bucket out profiles' });
  const candidateIds = Array.isArray(req.body?.candidate_ids) ? req.body.candidate_ids.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const targetUserId = String(req.body?.target_user_id || '').trim();
  if (!candidateIds.length) return res.status(400).json({ message: 'candidate_ids required' });
  if (!targetUserId) return res.status(400).json({ message: 'target_user_id required' });
  const users = await table('users');
  const targetUser = users.find((user) => String(user.user_id) === targetUserId);
  if (!targetUser) return res.status(404).json({ message: 'Target user not found' });
  const allCandidates = (await table('candidates')).map(enrichCandidate);
  const activeCount = allCandidates.filter((row) => !row.bucket_is_bucket_out && !row.bucket_is_terminal && (recruiterCodeMatches(row.recruiter_code, targetUser.recruiter_code) || String(row.recruiter_name || '') === String(targetUser.full_name || ''))).length;
  if (activeCount + candidateIds.length > BUCKET_MAX_ACTIVE) {
    return res.status(400).json({ message: `Bucket Full (${activeCount}/${BUCKET_MAX_ACTIVE}) for ${targetUser.full_name}` });
  }
  const updatedItems = [];
  for (const candidateId of candidateIds) {
    const existing = await store.findById('candidates', 'candidate_id', candidateId);
    if (!existing) continue;
    const existingEnriched = enrichCandidate(existing);
    if (!existingEnriched.bucket_is_bucket_out) continue;
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
      'Bucket Out profile reassigned',
      `${req.user.full_name} reassigned ${next.full_name || next.candidate_id} to your bucket.`,
      'candidate',
      JSON.stringify({ candidate_id: next.candidate_id, open_path: `/candidate/${next.candidate_id}` }),
    );
  }
  return res.json({ items: updatedItems, count: updatedItems.length });
}

async function uploadCandidateFile(req, res) {
  const candidate = await store.findById('candidates', 'candidate_id', req.params.candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
  if (!(await visibleCandidate(candidate, req.user))) return res.status(403).json({ message: 'Not allowed' });

  const fileKind = String(req.body?.file_kind || '').trim();
  if (!ALLOWED_FILE_TYPES.has(fileKind)) return res.status(400).json({ message: 'Unsupported file slot.' });

  const originalName = escapeFilename(req.body?.file_name || `${fileKind}.bin`);
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

  const fileId = makeFastId('F');
  const createdAt = nowIso();
  const item = {
    file_id: fileId,
    candidate_id: candidate.candidate_id,
    file_kind: fileKind,
    original_name: originalName,
    storage_name: `${candidate.candidate_id}_${fileKind}_${fileId}_${originalName}`.slice(0, 180),
    mime_type: candidateFileContentType(originalName, req.body?.mime_type || 'application/octet-stream'),
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
  if (!(await visibleCandidate(candidate, req.user))) return res.status(403).json({ message: 'Not allowed' });

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
  res.setHeader('Content-Type', candidateFileContentType(file.original_name, file.mime_type));
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Content-Disposition', `attachment; filename="${escapeFilename(file.original_name || 'candidate-file')}"`);
  return res.send(buffer);
}

module.exports = {
  list,
  create,
  bulkCreate,
  getOne,
  logOpen,
  update,
  submitForApproval,
  addNote,
  addQuickNote,
  logCall,
  whatsapp,
  whatsappLog,
  followupUpcoming,
  followupAction,
  requestInterviewDateRemoval,
  removeInterviewDate,
  bulkUpdate,
  recoveryBucket,
  reviveLostLead,
  reassignTargets,
  bulkReassign,
  uploadCandidateFile,
  downloadCandidateFile,
  PROCESS_OPTIONS,
};
