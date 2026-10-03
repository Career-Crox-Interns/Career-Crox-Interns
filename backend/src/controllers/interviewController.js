const { store, table, mode } = require('../lib/store');
const { nextId, nowIso, recruiterCodeMatches } = require('../lib/helpers');
const { sanitizeCandidateForUser } = require('../lib/dataLeakGuard');
const { createTimedCache, clearAllCaches } = require('../lib/cache');
const { userRole, isLeadership, candidateBelongsToUser, candidateBelongsToTeam, candidateScopeSql } = require('../lib/accessRules');

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
    || status === 'archived'
    || approval === 'deleted'
    || approval === '__deleted__'
    || approval === 'archived'
    || details === 'deleted'
    || details === 'archived'
    || notes.includes('[crm-deleted]');
}

function visibleToUser(candidate, user) {
  if (isDeletedCandidate(candidate)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager') return true;
  if (role === 'tl') return candidateBelongsToTeam(candidate, user);
  return candidateBelongsToUser(candidate, user);
}

function isInterviewEligible(candidate) {
  // Candidate status/approval is not an Interview visibility rule. If the profile is
  // visible and still carries an interview date, it belongs in the date bucket.
  return Boolean(effectiveInterviewDate(candidate));
}


async function hasRealApprovedSubmission(candidateId) {
  const id = String(candidateId || '').trim();
  if (!id) return false;
  const submissions = await table('submissions');
  return submissions.some((row) => String(row.candidate_id || '').trim() === id
    && lower(row.approval_status || '') === 'approved'
    && !['deleted', '__deleted__', 'archived', 'rejected', 'draft'].includes(lower(row.status || '')));
}

function effectiveInterviewDate(row) {
  return String(row?.interview_reschedule_date || row?.interview_date || row?.scheduled_at || '').trim();
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isLocalReminderValidation(req) {
  return process.env.CRM_LOCAL_VALIDATION_MODE === '1'
    && String(req?.query?.local_validation_row || req?.query?._local_validation || '') === '1';
}

function localInterviewValidationRow(req) {
  const stamp = nowIso();
  return {
    interview_id: 'LOCAL-VALIDATION-INTERVIEW-001',
    candidate_id: 'LOCAL-VALIDATION-CAND-INT',
    full_name: 'Validation Interview Reminder',
    recruiter_code: req?.user?.recruiter_code || 'TL-002',
    recruiter_name: req?.user?.full_name || 'Validation Recruiter',
    process: 'Interview Validation',
    job_title: 'Interview Reminder Validation',
    status: 'Scheduled',
    interview_status: 'Scheduled',
    scheduled_at: stamp,
    interview_date: stamp,
    notes: 'Validation note: interview confirmation requires action.',
    data_notes: 'Validation note: interview confirmation requires action.',
    last_note: 'Validation note: interview confirmation requires action.',
    last_notes: 'Validation note: interview confirmation requires action.',
    created_at: stamp,
    updated_at: stamp,
  };
}

function appendLocalInterviewValidation(items, req) {
  if (!isLocalReminderValidation(req)) return items;
  if ((items || []).some((row) => String(row.interview_id || '') === 'LOCAL-VALIDATION-INTERVIEW-001')) return items;
  return [localInterviewValidationRow(req), ...(items || [])];
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

function compareInterviewListOrder(a, b) {
  const dateCompare = String(effectiveInterviewDate(b) || '').localeCompare(String(effectiveInterviewDate(a) || ''));
  if (dateCompare) return dateCompare;
  const scheduledCompare = String(b?.scheduled_at || '').localeCompare(String(a?.scheduled_at || ''));
  if (scheduledCompare) return scheduledCompare;
  const interviewCompare = String(b?.interview_id || '').localeCompare(String(a?.interview_id || ''));
  if (interviewCompare) return interviewCompare;
  return String(b?.candidate_id || '').localeCompare(String(a?.candidate_id || ''));
}

function dedupeInterviewItems(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const candidateId = String(row?.candidate_id || '').trim();
    const interviewId = String(row?.interview_id || '').trim();
    const key = candidateId ? `candidate:${candidateId}` : `interview:${interviewId}`;
    if (!candidateId && !interviewId) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const existingScore = filledInterviewFieldScore(existing);
    const nextScore = filledInterviewFieldScore(row);
    if (existingScore !== nextScore) {
      map.set(key, nextScore > existingScore ? row : existing);
      continue;
    }
    map.set(key, interviewStamp(row) >= interviewStamp(existing) ? row : existing);
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

function latestInterviewByCandidate(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row?.candidate_id || '').trim();
    if (!key) continue;
    const current = map.get(key);
    const stamp = String(row?.scheduled_at || row?.created_at || '');
    const currentStamp = String(current?.scheduled_at || current?.created_at || '');
    if (!current || stamp.localeCompare(currentStamp) > 0) map.set(key, row);
  }
  return map;
}

function canonicalInterviewRow(candidate = {}, interview = null, jd = null) {
  const child = interview || {};
  const candidateId = String(candidate.candidate_id || child.candidate_id || '').trim();
  return {
    ...child,
    ...candidate,
    interview_id: String(child.interview_id || '').trim() || `CANONINT-${candidateId}`,
    candidate_id: candidateId,
    jd_id: child.jd_id || candidate.jd_id || '',
    scheduled_at: candidate.interview_reschedule_date || candidate.interview_date || child.scheduled_at || '',
    stage: child.stage || '',
    job_title: jd?.job_title || candidate.jd_name || '',
    created_at: child.created_at || candidate.created_at || candidate.updated_at || '',
  };
}

async function listFromPostgres(req) {
  const { scopeSql, params } = buildSqlScope(req.user, []);
  // Candidate-first: interview_date on the profile is the canonical workflow.
  // A missing interviews child row can never make the profile disappear.
  const sql = `
    select
      c.*,
      i.interview_id as __interview_id,
      i.candidate_id as __interview_candidate_id,
      i.jd_id as __interview_jd_id,
      i.stage as __interview_stage,
      i.scheduled_at as __interview_scheduled_at,
      i.status as __interview_status,
      i.created_at as __interview_created_at,
      coalesce(j.job_title, '') as __job_title
    from public.candidates c
    left join lateral (
      select ix.*
      from public.interviews ix
      where ix.candidate_id = c.candidate_id
      order by coalesce(ix.scheduled_at, ix.created_at, '') desc, coalesce(ix.interview_id, '') desc
      limit 1
    ) i on true
    left join public.jd_master j on j.jd_id = coalesce(i.jd_id, c.jd_id)
    where ${scopeSql}
      and coalesce(nullif(c.interview_reschedule_date, ''), nullif(c.interview_date, ''), i.scheduled_at, '') <> ''
    order by coalesce(nullif(c.interview_reschedule_date, ''), nullif(c.interview_date, ''), i.scheduled_at, c.updated_at, c.created_at, '') desc,
             coalesce(c.candidate_id, '') desc
  `;
  const rows = await store.query(sql, params);
  return rows.map((row) => {
    const interview = row.__interview_id ? {
      interview_id: row.__interview_id,
      candidate_id: row.__interview_candidate_id || row.candidate_id,
      jd_id: row.__interview_jd_id || '',
      stage: row.__interview_stage || '',
      scheduled_at: row.__interview_scheduled_at || '',
      status: row.__interview_status || '',
      created_at: row.__interview_created_at || '',
    } : null;
    const jd = { job_title: row.__job_title || '' };
    const candidate = { ...row };
    Object.keys(candidate).filter((key) => key.startsWith('__interview_') || key === '__job_title').forEach((key) => delete candidate[key]);
    return canonicalInterviewRow(candidate, interview, jd);
  });
}

async function fallbackInterviewRows(req) {
  const candidates = await table('candidates');
  const interviews = await table('interviews').catch(() => []);
  const jds = await table('jd_master').catch(() => []);
  const latest = latestInterviewByCandidate(interviews);
  const jdMap = new Map(jds.map((j) => [String(j.jd_id || '').trim(), j]));
  return candidates
    .filter((candidate) => visibleToUser(candidate, req.user))
    .map((candidate) => {
      const child = latest.get(String(candidate.candidate_id || '').trim()) || null;
      const effectiveDate = candidate.interview_reschedule_date || candidate.interview_date || child?.scheduled_at || '';
      if (!String(effectiveDate || '').trim()) return null;
      const jd = jdMap.get(String(child?.jd_id || candidate.jd_id || '').trim()) || null;
      return canonicalInterviewRow(candidate, child, jd);
    })
    .filter(Boolean);
}

async function list(req, res) {
  const cacheKey = buildInterviewCacheKey(req);
  const forceRefresh = Boolean(String(req.query?._refresh || '').trim());
  const cached = forceRefresh ? null : interviewListCache.get(cacheKey);
  if (cached) return res.json(cached);

  let rawItems = [];
  try {
    rawItems = mode === 'postgres' && store.pool
      ? await listFromPostgres(req)
      : await fallbackInterviewRows(req);
  } catch (error) {
    // In production do not hide SQL/schema failures by reading whole tables.
    // The candidate profile remains intact; UI should retry manually.
    if (mode === 'postgres' && store.pool) {
      try { console.error('Interview list query failed safely:', error?.message || error); } catch {}
      return res.status(503).json({ message: 'Interviews could not be loaded safely. Use Manual Refresh once.' });
    }
    rawItems = await fallbackInterviewRows(req);
  }

  const items = dedupeInterviewItems(rawItems)
    .map((row) => sanitizeCandidateForUser(row, req.user))
    .filter((row) => isInterviewEligible(row))
    .filter((row) => visibleToUser(row, req.user))
    .filter((row) => String(row.interview_remove_status || '').toLowerCase() !== 'approved')
    .filter((row) => effectiveInterviewDate(row))
    .sort(compareInterviewListOrder);

  const payload = { items: appendLocalInterviewValidation(items, req) };
  interviewListCache.set(cacheKey, payload);
  return res.json(payload);
}

function parseInterviewMsForReminder(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(`${raw}T09:00:00+05:30`);
    return Number.isFinite(t) ? t : 0;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function istDateOnlyFromMs(ms) {
  const date = new Date(Number(ms || 0));
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
  }
}

async function rescheduleNextDaySameTime(req, res) {
  const interviewId = String(req.body?.interview_id || '').trim();
  let interview = interviewId ? await store.findById('interviews', 'interview_id', interviewId).catch(() => null) : null;
  const candidateId = String(req.body?.candidate_id || interview?.candidate_id || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'Candidate is required for reschedule.' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });
  if (!visibleToUser(candidate, req.user)) return res.status(403).json({ message: 'You cannot reschedule this candidate.' });

  if (!interview && interviewId) return res.status(404).json({ message: 'Interview not found.' });
  if (!interview) {
    const rows = await table('interviews').catch(() => []);
    interview = rows
      .filter((row) => String(row.candidate_id || '').trim() === candidateId)
      .sort((a, b) => interviewStamp(b) - interviewStamp(a))[0] || null;
  }

  const source = interview?.scheduled_at || candidate.interview_reschedule_date || candidate.interview_date || '';
  const currentMs = parseInterviewMsForReminder(source);
  if (!currentMs) return res.status(400).json({ message: 'Current interview date/time is missing.' });
  const nextMs = currentMs + 24 * 60 * 60 * 1000;
  const nextIso = new Date(nextMs).toISOString();
  const nextDate = istDateOnlyFromMs(nextMs);

  if (interview?.interview_id) {
    await store.update('interviews', 'interview_id', interview.interview_id, {
      scheduled_at: nextIso,
      status: 'Scheduled',
      updated_at: nowIso(),
    });
  }
  await store.update('candidates', 'candidate_id', candidateId, {
    interview_reschedule_date: nextDate,
    updated_at: nowIso(),
  });
  clearAllCaches();
  return res.json({
    ok: true,
    candidate_id: candidateId,
    interview_id: interview?.interview_id || interviewId || '',
    scheduled_at: nextIso,
    interview_reschedule_date: nextDate,
    message: 'Interview scheduled for next day at the same time.',
  });
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
  rescheduleNextDaySameTime,
};
