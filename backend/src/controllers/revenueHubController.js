const { store, table, mode } = require('../lib/store');
const { containsText, nowIso, ymd, normalizeIndianPhone, buildCsv } = require('../lib/helpers');

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
const PAYOUT_OPTIONS = ['none', 'payout_pending', 'payout_received'];
const DEFAULT_MONTH_TARGET = 100000;
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
function toDateOnly(value) {
  return String(value || '').slice(0, 10);
}
function toDateTimeText(value) {
  return String(value || '').trim().slice(0, 16);
}
function parseMoney(value) {
  const cleaned = String(value ?? '').replace(/[^\d.\-]/g, '').trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}
function moneyText(value) {
  const amount = parseMoney(value);
  return amount ? String(Math.round(amount)) : '';
}
function dateDiffDays(fromValue, toValue) {
  const a = new Date(`${toDateOnly(fromValue)}T00:00:00`);
  const b = new Date(`${toDateOnly(toValue)}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}
function genId() {
  return `REV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}
function shiftDate(dateString, days) {
  const date = new Date(`${toDateOnly(dateString)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}
function isoMonth(value) {
  return toDateOnly(value).slice(0, 7);
}
function weekRange(dateValue = ymd()) {
  const date = new Date(`${toDateOnly(dateValue)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return { start: '', end: '' };
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  const start = date.toISOString().slice(0, 10);
  date.setDate(date.getDate() + 6);
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
    retained: ['completed_60_days'].includes(status) || entry.completed_60_days ? 1 : 0,
    interviews: entry.interview_date ? 1 : 0,
    revenue: ['joined', 'completed_60_days'].includes(status) ? parseMoney(entry.payout_amount) : 0,
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
    full_name: entry.full_name || candidate.full_name || candidate.candidate_id || '',
    phone: entry.phone || normalizeIndianPhone(candidate.phone || candidate.number || ''),
    process: entry.process || candidate.process || '',
    client_name: entry.client_name || candidate.client_name || candidate.company_name || candidate.process || '',
    location: entry.location || candidate.preferred_location || candidate.location || '',
    qualification: entry.qualification || candidate.qualification_level || candidate.qualification || '',
    recruiter_name: entry.recruiter_name || candidate.recruiter_name || '',
    recruiter_code: entry.recruiter_code || candidate.recruiter_code || '',
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
  const today = ymd();
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
  const joiningPendingDue = ['selected', 'pending_joining'].includes(status) && joiningDate && daysToJoining !== null && daysToJoining <= 3;
  const completed60 = daysFromJoined !== null && daysFromJoined >= 60;
  const payoutPending = (status === 'joined' || status === 'completed_60_days' || completed60) && payoutStatus !== 'payout_received' && daysFromJoined !== null && daysFromJoined >= 55;
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
    interview_mode: normalizeInterviewMode(entry.interview_mode),
    days_to_joining: daysToJoining,
    days_from_joined: daysFromJoined,
    completed_60_days: completed60,
    payout_pending: payoutPending,
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
  return {
    will_come_for_interview: entries.filter((item) => lower(item.status) === 'will_come_for_interview').length,
    appeared_for_interview: entries.filter((item) => lower(item.status) === 'appeared_for_interview').length,
    rejected: entries.filter((item) => lower(item.status) === 'rejected').length,
    selected: entries.filter((item) => lower(item.status) === 'selected').length,
    pending_joining: entries.filter((item) => lower(item.status) === 'pending_joining').length,
    joined: entries.filter((item) => lower(item.status) === 'joined').length,
    not_joined: entries.filter((item) => lower(item.status) === 'not_joined').length,
    completed_60_days: entries.filter((item) => item.completed_60_days || lower(item.status) === 'completed_60_days').length,
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
    return store.one('select * from public.candidates where upper(candidate_id) = upper($1) limit 1', [candidateId]);
  }
  const rows = await table('candidates');
  return rows.find((row) => normalizeCandidateCode(row.candidate_id) === normalizeCandidateCode(candidateId)) || null;
}

async function findRevenueEntryByCandidateId(candidateId) {
  if (mode === 'postgres') {
    return store.one('select * from public.revenue_hub_entries where upper(candidate_id) = upper($1) limit 1', [candidateId]);
  }
  const rows = await table('revenue_hub_entries');
  return rows.find((row) => normalizeCandidateCode(row.candidate_id) === normalizeCandidateCode(candidateId)) || null;
}

async function getVisibleEntries(user) {
  const [rows, candidates] = await Promise.all([table('revenue_hub_entries'), table('candidates')]);
  const candidateMap = new Map(candidates.map((row) => [normalizeCandidateCode(row.candidate_id), row]));
  return rows
    .filter((row) => (isLeadership(user) ? true : userOwnsCandidate(user, row)))
    .map((row) => mergeCandidateSnapshot(row, candidateMap.get(normalizeCandidateCode(row.candidate_id))))
    .map(hydrateEntry)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

async function buildVisibleCandidateSearchFallback(user, query = '') {
  const trimmedQuery = String(query || '').trim();
  const rows = await table('candidates');
  const existingIds = new Set((await table('revenue_hub_entries')).map((row) => String(row.candidate_id || '')));
  return rows
    .filter((row) => (isLeadership(user) ? true : userOwnsCandidate(user, row)))
    .map((row) => ({ ...row, already_in_pipeline: existingIds.has(String(row.candidate_id || '')), _score: candidateSearchScore(row, trimmedQuery) }))
    .filter((row) => !trimmedQuery || row._score > 0)
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
    })
    .slice(0, 250)
    .map(({ _score, ...row }) => row);
}

async function getVisibleCandidateProcessOptions(user) {
  const rows = await table('candidates');
  return Array.from(new Set([
    ...PIPELINE_PROCESS_OPTIONS,
    ...rows.filter((row) => (isLeadership(user) ? true : userOwnsCandidate(user, row))).map((row) => String(row.process || '').trim()).filter(Boolean),
  ])).sort((a, b) => a.localeCompare(b));
}

async function getVisibleCandidates(user, query = '') {
  const trimmedQuery = String(query || '').trim();
  if (mode === 'postgres') {
    try {
      const params = [];
      const where = [];
      const orderChunks = [];
      if (!isLeadership(user)) {
        const ownName = String(user?.full_name || '').trim();
        const ownCode = String(user?.recruiter_code || '').trim();
        if (ownName || ownCode) {
          params.push(ownName || null);
          const ownNameRef = `$${params.length}`;
          params.push(ownCode || null);
          const ownCodeRef = `$${params.length}`;
          where.push(`((coalesce(${ownNameRef}, '') <> '' and lower(coalesce(c.recruiter_name,'')) = lower(${ownNameRef})) or (coalesce(${ownCodeRef}, '') <> '' and lower(coalesce(c.recruiter_code,'')) like '%' || lower(${ownCodeRef}) || '%'))`);
        }
      }
      if (trimmedQuery) {
        const meta = candidateSearchIntent(trimmedQuery);
        if (meta.kind === 'phone') {
          params.push(meta.digits || null);
          const digitExactRef = `$${params.length}`;
          params.push(meta.digits ? `${meta.digits}%` : null);
          const digitPrefixRef = `$${params.length}`;
          params.push(meta.digits ? `%${meta.digits}%` : null);
          const digitLikeRef = `$${params.length}`;
          where.push(`(${digitLikeRef} is not null and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like ${digitLikeRef})`);
          orderChunks.push(`case
            when ${digitExactRef} is not null and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = ${digitExactRef} then 400
            when ${digitPrefixRef} is not null and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like ${digitPrefixRef} then 300
            else 0 end desc`);
        } else if (meta.kind === 'candidate_id') {
          params.push(meta.target);
          const exactRef = `$${params.length}`;
          params.push(`${meta.target}%`);
          const prefixRef = `$${params.length}`;
          params.push(`%${trimmedQuery}%`);
          const likeRef = `$${params.length}`;
          where.push(`c.candidate_id ilike ${likeRef}`);
          orderChunks.push(`case
            when lower(coalesce(c.candidate_id,'')) = ${exactRef} then 400
            when lower(coalesce(c.candidate_id,'')) like ${prefixRef} then 300
            else 0 end desc`);
        } else {
          const nameQuery = normalizeNameSearch(trimmedQuery);
          params.push(nameQuery);
          const exactRef = `$${params.length}`;
          params.push(`${nameQuery}%`);
          const prefixRef = `$${params.length}`;
          params.push(`% ${nameQuery}%`);
          const tokenRef = `$${params.length}`;
          params.push(nameQuery.length >= 3 ? `%${nameQuery}%` : null);
          const containsRef = `$${params.length}`;
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
        select c.*, case when r.candidate_id is null then false else true end as already_in_pipeline
        from public.candidates c
        left join public.revenue_hub_entries r on upper(r.candidate_id) = upper(c.candidate_id)
        ${whereSql}
        order by ${orderSql} coalesce(c.updated_at, c.created_at, now()::text) desc
        limit 250
      `, params);
    } catch (error) {
      console.error('Pipeline candidate search fallback engaged:', error?.message || error);
      return buildVisibleCandidateSearchFallback(user, trimmedQuery);
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
    process: payload.process || candidate.process || '',
    client_name: payload.client_name || candidate.client_name || candidate.company_name || '',
    location: payload.preferred_location || payload.location || candidate.preferred_location || candidate.location || '',
    qualification: payload.qualification || candidate.qualification_level || candidate.qualification || '',
    recruiter_name: candidate.recruiter_name || '',
    recruiter_code: candidate.recruiter_code || '',
    communication_skill: payload.communication_skill || candidate.communication_skill || '',
    experience_range: payload.experience_range || candidate.relevant_experience_range || '',
    salary_range: payload.salary_range || candidate.relevant_in_hand_range || '',
    submission_date: toDateOnly(payload.submission_date || candidate.submission_date || ''),
    interview_datetime: interviewDateTime,
    interview_date: toDateOnly(interviewDateTime || payload.interview_date || candidate.interview_date || candidate.interview_reschedule_date || ymd()),
    interview_mode: normalizeInterviewMode(payload.interview_mode || candidate.virtual_onsite || ''),
    selection_date: '',
    joining_date: '',
    joined_date: '',
    status: lower(payload.status || 'will_come_for_interview') || 'will_come_for_interview',
    payout_status: lower(payload.payout_status || 'none') || 'none',
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
  const finalValue = Math.round(sanitized || DEFAULT_MONTH_TARGET);
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

function buildWindowSummary(entries) {
  const today = ymd();
  const { start: weekStart, end: weekEnd } = weekRange(today);
  const month = isoMonth(today);
  const eligibleJoinedStatuses = new Set(['joined', 'completed_60_days']);
  const thisMonthJoined = entries.filter((item) => eligibleJoinedStatuses.has(lower(item.status)) && item.joined_date && isoMonth(item.joined_date) === month);
  const monthIncome = thisMonthJoined.reduce((sum, item) => sum + parseMoney(item.payout_amount), 0);
  return {
    today_interviews: entries.filter((item) => item.interview_date === today).length,
    week_interviews: entries.filter((item) => item.interview_date && item.interview_date >= weekStart && item.interview_date <= weekEnd).length,
    month_interviews: entries.filter((item) => item.interview_date && isoMonth(item.interview_date) === month).length,
    month_joined: thisMonthJoined.length,
    month_income: monthIncome,
  };
}

function buildAnalytics(entries, monthTarget) {
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
      bucket.revenue += counts.revenue;
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
    topRevenueClient ? `${topRevenueClient.label} se sabse zyada paisa aa raha hai: ₹${Math.round(topRevenueClient.revenue)}.` : '',
    topSelectionClient ? `${topSelectionClient.label} ka selection rate sabse strong hai: ${topSelectionClient.selection_rate}%.` : '',
    topRetentionClient ? `${topRetentionClient.label} ka retention sabse better hai: ${topRetentionClient.retention_rate}%.` : '',
    topRecruiter ? `${topRecruiter.label} ne sabse zyada joinings close ki hain: ${topRecruiter.joined}.` : '',
  ].filter(Boolean);

  return {
    summary: {
      ...windowSummary,
      month_target: monthTarget,
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
  const visibleEntries = await getVisibleEntries(req.user);
  const filteredRows = visibleEntries.filter((item) => matchesFilter(item, req.query || {}));
  const cardBaseRows = visibleEntries.filter((item) => matchesFilter(item, withoutStageFilters(req.query || {})));
  const monthTarget = await getMonthlyTarget();
  const analyticsPack = buildAnalytics(cardBaseRows, monthTarget);
  const candidateProcessOptions = await getVisibleCandidateProcessOptions(req.user);
  return res.json({
    items: filteredRows,
    cards: cardSummary(cardBaseRows),
    summary: analyticsPack.summary,
    analytics: analyticsPack.analytics,
    leaderboard: analyticsPack.leaderboard,
    lookups: {
      clients: Array.from(new Set(cardBaseRows.map((item) => item.client_name).filter(Boolean))).sort(),
      processes: Array.from(new Set([...candidateProcessOptions, ...cardBaseRows.map((item) => item.process).filter(Boolean)])).sort((a, b) => a.localeCompare(b)),
      recruiters: Array.from(new Set(cardBaseRows.map((item) => item.recruiter_name).filter(Boolean))).sort(),
      communication_skills: Array.from(new Set(cardBaseRows.map((item) => item.communication_skill).filter(Boolean))).sort(),
      experience_ranges: Array.from(new Set(cardBaseRows.map((item) => item.experience_range).filter(Boolean))).sort(),
      salary_ranges: Array.from(new Set(cardBaseRows.map((item) => item.salary_range).filter(Boolean))).sort(),
      statuses: STATUS_OPTIONS,
      payout_statuses: PAYOUT_OPTIONS,
    },
  });
}

async function searchCandidates(req, res) {
  const items = await getVisibleCandidates(req.user, req.query.q || '');
  return res.json({ items });
}

async function updateTarget(req, res) {
  if (!isManager(req.user)) {
    return res.status(403).json({ message: 'Only manager-level users can update this target.' });
  }
  const nextTarget = Math.max(0, parseMoney(req.body?.target_amount || req.body?.month_target || req.body?.target || ''));
  if (!nextTarget) {
    return res.status(400).json({ message: 'Enter a valid target amount.' });
  }
  const saved = await setMonthlyTarget(nextTarget);
  return res.json({ ok: true, month_target: saved });
}

async function addCandidate(req, res) {
  const candidateId = normalizeCandidateCode(req.body?.candidate_id || '');
  if (!candidateId) return res.status(400).json({ message: 'Candidate code is required.' });
  const candidate = await findCandidateById(candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });
  const payload = { ...req.body, candidate_id: candidateId, created_by_user_id: req.user?.user_id || '' };
  const requiredFields = [
    ['status', 'Status'],
    ['client_name', 'Client'],
    ['process', 'Process'],
    ['interview_datetime', 'Interview date and time'],
    ['interview_mode', 'Interview mode'],
    ['preferred_location', 'Preferred location'],
    ['qualification', 'Degree / Qualification'],
    ['communication_skill', 'Communication skill'],
    ['experience_range', 'Experience range'],
    ['salary_range', 'Salary range'],
  ];
  const missing = requiredFields.filter(([key]) => !String(payload?.[key] || '').trim()).map(([, label]) => label);
  if (missing.length) {
    return res.status(400).json({ message: `${missing[0]} is required.` });
  }
  const existing = await findRevenueEntryByCandidateId(candidateId);
  const interviewDateTime = toDateTimeText(payload.interview_datetime || payload.interview_date || candidate.interview_date || candidate.interview_reschedule_date || ymd());
  if (existing) {
    const existingUpdates = {
      full_name: candidate.full_name || existing.full_name || '',
      phone: normalizeIndianPhone(candidate.phone || candidate.number || existing.phone || ''),
      process: payload.process || candidate.process || existing.process || '',
      client_name: payload.client_name || candidate.client_name || candidate.company_name || existing.client_name || '',
      location: payload.preferred_location || payload.location || candidate.preferred_location || candidate.location || existing.location || '',
      qualification: payload.qualification || candidate.qualification_level || candidate.qualification || existing.qualification || '',
      recruiter_name: candidate.recruiter_name || existing.recruiter_name || '',
      recruiter_code: candidate.recruiter_code || existing.recruiter_code || '',
      communication_skill: payload.communication_skill || candidate.communication_skill || existing.communication_skill || '',
      experience_range: payload.experience_range || candidate.relevant_experience_range || existing.experience_range || '',
      salary_range: payload.salary_range || candidate.relevant_in_hand_range || existing.salary_range || '',
      submission_date: toDateOnly(payload.submission_date || candidate.submission_date || existing.submission_date || ''),
      interview_datetime: interviewDateTime || existing.interview_datetime || '',
      interview_date: toDateOnly(interviewDateTime || existing.interview_date || ymd()),
      interview_mode: normalizeInterviewMode(payload.interview_mode || existing.interview_mode || candidate.virtual_onsite || ''),
      payout_amount: moneyText(payload.payout_amount || existing.payout_amount || ''),
      resume_filename: candidate.resume_filename || existing.resume_filename || '',
      recording_filename: candidate.recording_filename || existing.recording_filename || '',
      notes: String(payload.notes ?? existing.notes ?? ''),
      status: STATUS_OPTIONS.includes(lower(payload.status || existing.status)) ? lower(payload.status || existing.status) : existing.status || 'will_come_for_interview',
      payout_status: PAYOUT_OPTIONS.includes(lower(payload.payout_status || existing.payout_status)) ? lower(payload.payout_status || existing.payout_status) : existing.payout_status || 'none',
      updated_at: nowIso(),
    };
    let refreshed;
    try {
      refreshed = await store.update('revenue_hub_entries', 'revenue_id', existing.revenue_id, existingUpdates);
    } catch (error) {
      if (!isMissingColumnError(error, 'interview_mode')) throw error;
      const fallbackUpdates = { ...existingUpdates };
      delete fallbackUpdates.interview_mode;
      refreshed = await store.update('revenue_hub_entries', 'revenue_id', existing.revenue_id, fallbackUpdates);
    }
    return res.json({ item: hydrateEntry(mergeCandidateSnapshot(refreshed, candidate)), already_existed: true });
  }
  const item = shapeFromCandidate(candidate, payload);
  let inserted;
  try {
    inserted = await store.insert('revenue_hub_entries', item);
  } catch (error) {
    if (!isMissingColumnError(error, 'interview_mode')) throw error;
    const fallbackItem = { ...item };
    delete fallbackItem.interview_mode;
    inserted = await store.insert('revenue_hub_entries', fallbackItem);
  }
  return res.json({ item: hydrateEntry(mergeCandidateSnapshot(inserted, candidate)), already_existed: false });
}

async function deleteEntry(req, res) {
  if (!canDeletePipelineEntry(req.user)) {
    return res.status(403).json({ message: 'Only managers can delete pipeline entries.' });
  }
  const revenueId = String(req.params.revenueId || '').trim();
  const existing = await store.findById('revenue_hub_entries', 'revenue_id', revenueId);
  if (!existing) return res.status(404).json({ message: 'Pipeline entry not found.' });
  await store.delete('revenue_hub_entries', 'revenue_id', revenueId);
  return res.json({ ok: true, revenue_id: revenueId });
}

async function updateStatus(req, res) {
  const revenueId = String(req.params.revenueId || '').trim();
  const existing = await store.findById('revenue_hub_entries', 'revenue_id', revenueId);
  if (!existing) return res.status(404).json({ message: 'Pipeline entry not found.' });
  const nextStatus = lower(req.body?.status || existing.status);
  if (!STATUS_OPTIONS.includes(nextStatus)) return res.status(400).json({ message: 'Invalid status.' });
  const nextPayout = lower(req.body?.payout_status || existing.payout_status || 'none');
  if (!PAYOUT_OPTIONS.includes(nextPayout)) return res.status(400).json({ message: 'Invalid payout status.' });
  const interviewDateTime = toDateTimeText(req.body?.interview_datetime || existing.interview_datetime || req.body?.interview_date || existing.interview_date || '');
  const updates = {
    status: nextStatus,
    payout_status: nextPayout,
    client_name: String(req.body?.client_name ?? existing.client_name ?? ''),
    process: String(req.body?.process ?? existing.process ?? ''),
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
    interview_mode: normalizeInterviewMode(req.body?.interview_mode || existing.interview_mode || ''),
    updated_at: nowIso(),
  };
  if (nextStatus === 'selected' && !updates.selection_date) updates.selection_date = ymd();
  if (nextStatus === 'pending_joining' && !updates.selection_date) updates.selection_date = ymd();
  if (nextStatus === 'joined' && !updates.joined_date) updates.joined_date = ymd();
  if (nextStatus === 'completed_60_days' && !updates.joined_date) updates.joined_date = existing.joined_date || ymd();
  if (!['joined', 'completed_60_days'].includes(nextStatus)) updates.joined_date = '';
  if (!['selected', 'pending_joining', 'joined', 'completed_60_days'].includes(nextStatus)) updates.selection_date = '';
  if (!['pending_joining', 'joined', 'completed_60_days'].includes(nextStatus)) updates.joining_date = '';
  if (nextStatus === 'rejected' || nextStatus === 'not_joined') updates.payout_status = 'none';
  if (nextPayout === 'payout_received' && nextStatus === 'joined') updates.status = 'completed_60_days';
  let item;
  try {
    item = await store.update('revenue_hub_entries', 'revenue_id', revenueId, updates);
  } catch (error) {
    if (!isMissingColumnError(error, 'interview_mode')) throw error;
    const fallbackUpdates = { ...updates };
    delete fallbackUpdates.interview_mode;
    item = await store.update('revenue_hub_entries', 'revenue_id', revenueId, fallbackUpdates);
  }
  return res.json({ item: hydrateEntry(item) });
}

async function reminders(req, res) {
  if (!isLeadership(req.user)) return res.json({ item: null });
  const now = new Date();
  const hour = now.getHours();
  const today = ymd();
  const tomorrow = shiftDate(today, 1);
  const items = (await getVisibleEntries(req.user)).filter((item) => {
    const status = lower(item.status);
    if (status === 'will_come_for_interview' && item.interview_date === tomorrow) return true;
    if (status === 'will_come_for_interview' && item.interview_date === today) return true;
    if (['will_come_for_interview', 'appeared_for_interview'].includes(status) && item.interview_date && item.interview_date <= today) return true;
    if (['selected', 'pending_joining'].includes(status) && item.joining_date && (item.days_to_joining ?? 99) <= 3) return true;
    if ((status === 'joined' || status === 'completed_60_days') && item.payout_pending) return true;
    return false;
  });
  const first = items[0] || null;
  if (!first) return res.json({ item: null });
  let title = 'Pipeline follow-up due';
  let message = 'Update candidate status in Pipeline Hub.';
  if (lower(first.status) === 'will_come_for_interview' && first.interview_date === tomorrow) {
    title = 'Interview scheduled tomorrow';
    message = `${first.full_name} is lined up for interview tomorrow. Review movement before the rush starts.`;
  } else if (lower(first.status) === 'will_come_for_interview' && first.interview_date === today) {
    title = 'Interview scheduled today';
    message = `${first.full_name} is due for interview today. Confirm movement and status.`;
  } else if (['will_come_for_interview', 'appeared_for_interview'].includes(lower(first.status))) {
    title = hour >= 17 ? 'Interview status pending before logout' : 'Interview result pending';
    message = `${first.full_name} still needs interview outcome update.`;
  } else if (['selected', 'pending_joining'].includes(lower(first.status))) {
    title = 'Joining follow-up pending';
    message = `${first.full_name} has joining follow-up due${first.joining_date ? ` on ${first.joining_date}` : ''}.`;
  } else if (first.payout_pending) {
    title = 'Payout action pending';
    message = `${first.full_name} is in payout follow-up stage.`;
  }
  return res.json({ item: { ...first, title, message } });
}

async function logoutCheck(req, res) {
  if (!isLeadership(req.user)) return res.json({ blocked: false, count: 0, items: [] });
  const hour = new Date().getHours();
  if (hour < 17) return res.json({ blocked: false, count: 0, items: [] });
  const items = (await getVisibleEntries(req.user)).filter((item) => ['will_come_for_interview', 'appeared_for_interview'].includes(lower(item.status)) && item.interview_date && item.interview_date <= ymd());
  return res.json({ blocked: items.length > 0, count: items.length, items: items.slice(0, 12) });
}

async function exportCsv(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can export Pipeline Hub data.' });
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
  res.setHeader('Content-Disposition', 'attachment; filename="pipeline_hub_export.csv"');
  return res.send(buildCsv(items));
}

module.exports = {
  STATUS_OPTIONS,
  PAYOUT_OPTIONS,
  list,
  searchCandidates,
  updateTarget,
  addCandidate,
  updateStatus,
  deleteEntry,
  reminders,
  logoutCheck,
  exportCsv,
};
