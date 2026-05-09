const { store, table, mode } = require('../lib/store');
const { nextId, nowIso, recruiterCodeMatches, candidateIdentityKey, normalizeIndianPhone } = require('../lib/helpers');
const { sanitizeCandidateForUser } = require('../lib/dataLeakGuard');
const { createTimedCache, clearAllCaches } = require('../lib/cache');
const { userRole, isLeadership, candidateBelongsToUser, candidateScopeSql } = require('../lib/accessRules');

const interviewListCache = createTimedCache(20000);

async function makeNotification(userId, title, message, metadata = '') {
  const rows = await table('notifications');
  await store.insert('notifications', {
    notification_id: nextId('N', rows, 'notification_id'),
    user_id: userId,
    title,
    message,
    category: 'interview',
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  });
}

function isDeletedCandidate(candidate) {
  const status = String(candidate?.status || '').trim().toLowerCase();
  const approval = String(candidate?.approval_status || '').trim().toLowerCase();
  const details = String(candidate?.all_details_sent || '').trim().toLowerCase();
  const notes = String(candidate?.data_notes || '').trim().toLowerCase();
  return Boolean(String(candidate?.deleted_at || '').trim())
    || status === 'deleted'
    || status === '__deleted__'
    || approval === 'deleted'
    || approval === '__deleted__'
    || details === 'deleted'
    || notes.includes('[crm-deleted]');
}

function visibleToUser(candidate, user) {
  if (isDeletedCandidate(candidate)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager' || role === 'tl') return true;
  return candidateBelongsToUser(candidate, user);
}

const ALWAYS_HIDDEN_STATUSES = new Set(['not intrested', 'not interested', 'not responding', 'rejected']);
const ALWAYS_HIDDEN_APPROVALS = new Set(['rejected']);

function isInterviewEligible(candidate) {
  const status = String(candidate?.status || '').trim().toLowerCase();
  const approvalStatus = String(candidate?.approval_status || '').trim().toLowerCase();
  if (ALWAYS_HIDDEN_STATUSES.has(status)) return false;
  if (ALWAYS_HIDDEN_APPROVALS.has(approvalStatus)) return false;
  return true;
}

function effectiveInterviewDate(row) {
  return String(row?.interview_reschedule_date || row?.interview_date || row?.scheduled_at || '').trim();
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function filledInterviewFieldScore(row) {
  let score = 0;
  const weightedFields = [
    ['full_name', 2],
    ['phone', 3],
    ['process', 1],
    ['recruiter_code', 1],
    ['preferred_location', 1],
    ['communication_skill', 1],
    ['location', 1],
    ['qualification', 1],
    ['qualification_level', 2],
    ['interview_reschedule_date', 3],
    ['interview_date', 3],
    ['scheduled_at', 3],
    ['submission_date', 2],
    ['notes', 2],
    ['total_experience', 6],
    ['relevant_experience', 6],
    ['relevant_experience_range', 4],
    ['ctc_monthly', 5],
    ['in_hand_salary', 5],
    ['relevant_in_hand_range', 4],
    ['resume_filename', 2],
    ['recording_filename', 2],
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

  return score;
}

function interviewStamp(row) {
  const raw = String(row?.updated_at || row?.created_at || row?.scheduled_at || row?.interview_reschedule_date || row?.interview_date || '').trim();
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function dedupeInterviewItems(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const phone = normalizeIndianPhone(row?.phone || '');
    const logical = candidateIdentityKey(row);
    const key = logical || (phone ? `phone:${phone}` : `candidate:${String(row?.candidate_id || row?.interview_id || '').trim()}`);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const existingInterview = effectiveInterviewDate(existing);
    const nextInterview = effectiveInterviewDate(row);
    if (!!existingInterview !== !!nextInterview) {
      map.set(key, nextInterview ? row : existing);
      continue;
    }
    const existingScore = filledInterviewFieldScore(existing);
    const nextScore = filledInterviewFieldScore(row);
    if (existingScore !== nextScore) {
      map.set(key, nextScore > existingScore ? row : existing);
      continue;
    }
    const existingStamp = interviewStamp(existing);
    const nextStamp = interviewStamp(row);
    if (existingStamp !== nextStamp) {
      map.set(key, nextStamp > existingStamp ? row : existing);
      continue;
    }
    map.set(key, String(row?.candidate_id || row?.interview_id || '').localeCompare(String(existing?.candidate_id || existing?.interview_id || '')) > 0 ? row : existing);
  }
  return Array.from(map.values());
}

function buildInterviewCacheKey(req) {
  return `${req.user?.user_id || 'anon'}:${userRole(req.user)}:${String(req.user?.recruiter_code || '')}:${String(req.user?.full_name || '')}`;
}

function buildSqlScope(user, params = []) {
  const scoped = candidateScopeSql('c', user, params);
  return { scopeSql: scoped.sql, params: scoped.params };
}

async function listFromPostgres(req) {
  const { scopeSql, params } = buildSqlScope(req.user, []);
  const sql = `
    with interview_backed as (
      select
        c.*,
        i.interview_id,
        coalesce(i.jd_id, c.jd_id) as jd_id,
        coalesce(i.scheduled_at, c.interview_reschedule_date, c.interview_date, '') as scheduled_at,
        coalesce(i.stage, '') as stage,
        coalesce(j.job_title, '') as job_title,
        coalesce(i.created_at, c.created_at, c.updated_at, '') as created_at
      from public.interviews i
      join public.candidates c on c.candidate_id = i.candidate_id
      left join public.jd_master j on j.jd_id = coalesce(i.jd_id, c.jd_id)
      where ${scopeSql}
    ),
    candidate_backed as (
      select
        c.*,
        ''::text as interview_id,
        c.jd_id,
        coalesce(c.interview_reschedule_date, c.interview_date, '') as scheduled_at,
        ''::text as stage,
        coalesce(j.job_title, '') as job_title,
        coalesce(c.created_at, c.updated_at, '') as created_at
      from public.candidates c
      left join public.jd_master j on j.jd_id = c.jd_id
      where ${scopeSql}
        and coalesce(c.interview_reschedule_date, c.interview_date, '') <> ''
        and not exists (
          select 1 from public.interviews i where i.candidate_id = c.candidate_id
        )
    )
    select * from interview_backed
    union all
    select * from candidate_backed
    order by coalesce(interview_reschedule_date, interview_date, scheduled_at, updated_at, created_at, '') desc
    limit 5000
  `;
  return store.query(sql, params);
}

async function list(req, res) {
  const cacheKey = buildInterviewCacheKey(req);
  const cached = interviewListCache.get(cacheKey);
  if (cached) return res.json(cached);

  let rawItems = [];
  try {
    if (mode === 'postgres' && store.pool) {
      rawItems = await listFromPostgres(req);
    } else {
      const interviews = await table('interviews');
      const candidates = await table('candidates');
      const jds = await table('jd_master');
      const interviewCandidateIds = new Set(interviews.map((row) => String(row?.candidate_id || '').trim()).filter(Boolean));

      const interviewBackedItems = interviews.map((i) => {
        const candidate = candidates.find((c) => c.candidate_id === i.candidate_id) || {};
        return {
          ...i,
          ...candidate,
          job_title: (jds.find((j) => j.jd_id === (i.jd_id || candidate.jd_id)) || {}).job_title || '',
        };
      });

      const candidateBackedItems = candidates
        .filter((candidate) => !interviewCandidateIds.has(String(candidate?.candidate_id || '').trim()))
        .map((candidate) => ({
          ...candidate,
          interview_id: '',
          scheduled_at: candidate.interview_reschedule_date || candidate.interview_date || '',
          job_title: (jds.find((j) => j.jd_id === candidate.jd_id) || {}).job_title || '',
        }));

      rawItems = [...interviewBackedItems, ...candidateBackedItems];
    }
  } catch {
    const interviews = await table('interviews');
    const candidates = await table('candidates');
    const jds = await table('jd_master');
    const interviewCandidateIds = new Set(interviews.map((row) => String(row?.candidate_id || '').trim()).filter(Boolean));
    const interviewBackedItems = interviews.map((i) => {
      const candidate = candidates.find((c) => c.candidate_id === i.candidate_id) || {};
      return {
        ...i,
        ...candidate,
        job_title: (jds.find((j) => j.jd_id === (i.jd_id || candidate.jd_id)) || {}).job_title || '',
      };
    });
    const candidateBackedItems = candidates
      .filter((candidate) => !interviewCandidateIds.has(String(candidate?.candidate_id || '').trim()))
      .map((candidate) => ({
        ...candidate,
        interview_id: '',
        scheduled_at: candidate.interview_reschedule_date || candidate.interview_date || '',
        job_title: (jds.find((j) => j.jd_id === candidate.jd_id) || {}).job_title || '',
      }));
    rawItems = [...interviewBackedItems, ...candidateBackedItems];
  }

  const items = dedupeInterviewItems(rawItems.map((row) => sanitizeCandidateForUser(row, req.user)))
    .filter((row) => isInterviewEligible(row))
    .filter((row) => visibleToUser(row, req.user))
    .filter((row) => String(row.interview_remove_status || '').toLowerCase() !== 'approved')
    .filter((row) => effectiveInterviewDate(row))
    .sort((a, b) => effectiveInterviewDate(b).localeCompare(effectiveInterviewDate(a)));

  const payload = { items };
  interviewListCache.set(cacheKey, payload);
  return res.json(payload);
}

async function create(req, res) {
  const rows = await table('interviews');
  const item = {
    interview_id: nextId('I', rows, 'interview_id'),
    candidate_id: req.body.candidate_id || '',
    jd_id: req.body.jd_id || '',
    stage: req.body.stage || 'Screening',
    scheduled_at: req.body.scheduled_at || nowIso(),
    status: 'Scheduled',
    created_at: nowIso(),
  };
  await store.insert('interviews', item);
  clearAllCaches();
  const candidate = await store.findById('candidates', 'candidate_id', item.candidate_id);
  if (candidate) {
    const users = await table('users');
    const target = users.find((u) => recruiterCodeMatches(candidate.recruiter_code, u.recruiter_code) || u.full_name === candidate.recruiter_name);
    if (target) {
      await makeNotification(
        target.user_id,
        'Interview scheduled',
        `${candidate.full_name} interview set for ${item.scheduled_at}`,
        JSON.stringify({ candidate_id: candidate.candidate_id, interview_id: item.interview_id, open_path: '/interviews' }),
      );
    }
  }
  return res.json({ item });
}

module.exports = {
  list,
  create,
};
