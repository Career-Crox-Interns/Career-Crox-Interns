const { table, store, mode } = require('../lib/store');
const { recruiterCodeMatches, nowIso } = require('../lib/helpers');
const { sanitizeCandidateForUser } = require('../lib/dataLeakGuard');
const { createTimedCache, clearAllCaches } = require('../lib/cache');
const { reminderTriggerNowMs, dueInMinutes } = require('../lib/reminderWindow');
const { userRole, isLeadership, candidateBelongsToUser, candidateBelongsToTeam, candidateScopeSql } = require('../lib/accessRules');
const { istDateKey, istDayBounds } = require('../lib/crmMetrics');

const submissionListCache = createTimedCache(20000);

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isLocalReminderValidation(req) {
  return process.env.CRM_LOCAL_VALIDATION_MODE === '1'
    && String(req?.query?.local_validation_row || req?.query?._local_validation || '') === '1';
}

function localSubmissionValidationRow(req) {
  const stamp = nowIso();
  const userCode = req?.user?.recruiter_code || 'TL-002';
  return {
    submission_id: 'LOCAL-VALIDATION-SUBMISSION-001',
    candidate_id: 'LOCAL-VALIDATION-CAND-SUB',
    full_name: 'Validation Submission Reminder',
    recruiter_code: userCode,
    recruiter_name: req?.user?.full_name || 'Validation Recruiter',
    process: 'Validation Reminder',
    location: 'Validation',
    status: 'In - Progress',
    approval_status: 'Pending',
    all_details_sent: 'Pending',
    submission_comms: 'Good',
    next_follow_up_at: stamp,
    reminder_snoozed_until: '',
    reminder_note: 'Validation note: submission details are pending for reminder review.',
    notes: 'Validation note: submission details are pending for reminder review.',
    data_notes: 'Validation note: submission details are pending for reminder review.',
    last_note: 'Validation note: submission details are pending for reminder review.',
    last_notes: 'Validation note: submission details are pending for reminder review.',
    submitted_at: stamp,
    updated_at: stamp,
    created_at: stamp,
    submission_origin_at: stamp,
  };
}

function appendLocalSubmissionValidation(items, req) {
  if (!isLocalReminderValidation(req)) return items;
  if ((items || []).some((row) => String(row.submission_id || '') === 'LOCAL-VALIDATION-SUBMISSION-001')) return items;
  return [localSubmissionValidationRow(req), ...(items || [])];
}


function isDeletedCandidate(candidate) {
  const status = lower(candidate?.status || candidate?.candidate_status || candidate?.profile_status || '');
  const approval = lower(candidate?.approval_status || '');
  const details = lower(candidate?.all_details_sent || '');
  const notes = lower(candidate?.data_notes || '');
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

function deletedCandidateWhereSql(alias = 'c') {
  const p = alias ? `${alias}.` : '';
  return `coalesce(${p}deleted_at, '') = ''
    and lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}all_details_sent, '')) not in ('deleted', 'archived')
    and lower(coalesce(${p}data_notes, '')) not like '%[crm-deleted]%'`;
}

function deletedSubmissionWhereSql(alias = 's') {
  const p = alias ? `${alias}.` : '';
  return `lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__', 'archived')`;
}

function visibleToUser(row, candidate, user) {
  if (isDeletedCandidate(candidate || row)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager') return true;
  const merged = candidate && Object.keys(candidate || {}).length
    ? { ...(row || {}), ...(candidate || {}) }
    : { ...(row || {}) };
  if (role === 'tl') return candidateBelongsToTeam(merged, user);
  return candidateBelongsToUser(merged, user);
}

function ageHoursFrom(value) {
  const stamp = new Date(value || 0).getTime();
  if (!Number.isFinite(stamp) || stamp <= 0) return Number.POSITIVE_INFINITY;
  return (Date.now() - stamp) / 3600000;
}

function withinRecentWindow(submittedAt, days) {
  const submitted = new Date(submittedAt || 0).getTime();
  if (!Number.isFinite(submitted) || submitted <= 0) return false;
  return (Date.now() - submitted) <= (Math.max(1, Number(days || 1)) * 24 * 60 * 60 * 1000);
}

function trueSubmissionStamp(row) {
  // CC26_391: Candidate-edited Submission Date is always the workflow source of truth.
  // submitted_at remains the audit event and must never override an edited workflow date.
  return String(row?.candidate_submission_date || row?.submission_date || row?.effective_submission_at || row?.submission_origin_at || row?.submitted_at || row?.approval_requested_at || '');
}

function submissionOriginStamp(row, candidate = {}) {
  return String(candidate?.submission_date || row?.effective_submission_at || row?.submission_origin_at || row?.submitted_at || row?.approval_requested_at || row?.created_at || '');
}

function hasReminder(row) {
  return Boolean(String(row.next_follow_up_at || '').trim());
}

function reminderState(row) {
  const now = Date.now();
  const followUpAt = new Date(row.next_follow_up_at || 0).getTime();
  if (!followUpAt) return 'none';
  const snoozeUntil = new Date(row.reminder_snoozed_until || 0).getTime();
  if (snoozeUntil && snoozeUntil > now) return 'scheduled';
  if (followUpAt <= reminderTriggerNowMs(now)) return 'due';
  return 'scheduled';
}

function matchesDateTimeRange(value, from, to) {
  if (!value) return false;
  const t = new Date(value).getTime();
  if (!t) return false;
  if (from) {
    const start = new Date(from).getTime();
    if (start && t < start) return false;
  }
  if (to) {
    const end = new Date(to).getTime();
    if (end && t > end) return false;
  }
  return true;
}

function latestSubmissionStamp(row) {
  return String(row?.submission_origin_at || row?.effective_submission_at || row?.submitted_at || row?.approval_requested_at || row?.updated_at || row?.created_at || '');
}

function stableSubmissionStamp(row) {
  return String(row?.submission_origin_at || row?.effective_submission_at || row?.submitted_at || row?.approval_requested_at || row?.created_at || '');
}

function compareSubmissionListOrder(a, b) {
  const stampCompare = stableSubmissionStamp(b).localeCompare(stableSubmissionStamp(a));
  if (stampCompare) return stampCompare;
  const idCompare = String(b?.submission_id || '').localeCompare(String(a?.submission_id || ''));
  if (idCompare) return idCompare;
  return String(b?.candidate_id || '').localeCompare(String(a?.candidate_id || ''));
}

function isPendingQueueRow(row) {
  const status = lower(row?.status);
  const approval = lower(row?.approval_status);
  const details = lower(row?.all_details_sent);
  if (['deleted', '__deleted__', 'archived', 'rejected'].includes(status)) return false;
  if (['deleted', '__deleted__', 'archived', 'rejected'].includes(approval)) return false;
  return approval === 'pending' || (approval === 'approved' && details === 'pending');
}

function submissionIstDateKey(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  // Legacy submission rows can contain HTML datetime-local text without timezone.
  // Such values were entered in CRM IST, so their YYYY-MM-DD is already the IST day.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(text)) return text.slice(0, 10);
  return istDateKey(text);
}

function isSameLocalDay(value, base = new Date()) {
  const stampKey = submissionIstDateKey(value);
  const baseKey = istDateKey(base);
  return Boolean(stampKey && baseKey && stampKey === baseKey);
}

function dedupeRowsByCandidate(rows = []) {
  const winners = new Map();
  for (const row of rows) {
    const key = String(row?.candidate_id || '').trim();
    if (!key) continue;
    const current = winners.get(key);
    if (!current || latestSubmissionStamp(row).localeCompare(latestSubmissionStamp(current)) > 0) {
      winners.set(key, row);
    }
  }
  return Array.from(winners.values());
}

async function rolloverPendingSubmissions() {
  return;
}

function buildRow(row, candidate, user) {
  const safeCandidate = sanitizeCandidateForUser(candidate, user);
  return {
    ...row,
    full_name: safeCandidate.full_name || '',
    phone: safeCandidate.phone || '',
    phone_masked: safeCandidate.phone_masked || '',
    phone_redacted: Boolean(safeCandidate.phone_redacted),
    location: safeCandidate.location || '',
    preferred_location: safeCandidate.preferred_location || '',
    process: safeCandidate.process || '',
    candidate_status: safeCandidate.status || '',
    recruiter_name: safeCandidate.recruiter_name || row.recruiter_code || '',
    recruiter_code: safeCandidate.recruiter_code || row.recruiter_code || '',
    all_details_sent: safeCandidate.all_details_sent || (lower(row.approval_status) === 'approved' ? 'Pending' : ''),
    submission_comms: safeCandidate.communication_skill || row.submission_comms || '',
    notes: safeCandidate.notes || safeCandidate.note || safeCandidate.data_notes || row.notes || row.note || row.data_notes || '',
    data_notes: safeCandidate.data_notes || row.data_notes || '',
    last_note: safeCandidate.last_note || safeCandidate.notes || safeCandidate.note || safeCandidate.data_notes || row.last_note || row.notes || row.note || row.data_notes || row.reminder_note || '',
    last_notes: safeCandidate.last_notes || safeCandidate.notes || safeCandidate.note || safeCandidate.data_notes || row.last_notes || row.notes || row.note || row.data_notes || row.reminder_note || '',
    next_follow_up_at: row.next_follow_up_at || '',
    reminder_snoozed_until: row.reminder_snoozed_until || '',
    reminder_note: row.reminder_note || '',
    submission_origin_at: submissionOriginStamp(row, safeCandidate),
    // Leadership keeps full visibility, but this already-loaded ownership flag lets
    // Manager/TL see recruiter-style reminders for profiles they personally own.
    // No extra database query or egress is added.
    personal_owner: candidateBelongsToUser(candidate && Object.keys(candidate || {}).length ? candidate : row, user),
  };
}

function buildSubmissionCacheKey(req) {
  const query = { ...(req.query || {}) };
  delete query._refresh;
  delete query._fresh;
  delete query._summary;
  delete query._check;
  return `${req.user?.user_id || 'anon'}:${JSON.stringify(query)}`;
}

function buildSqlScope(user, params = []) {
  // CC26_682: submissions are candidate-backed, so role scope is evaluated
  // only from candidate ownership columns. Do not reference legacy/nonexistent
  // ownership columns on public.submissions.
  const scoped = candidateScopeSql('c', user, params);
  return { scopeSql: scoped.sql, params: scoped.params };
}

function isCanonicalSubmittedCandidate(candidate = {}, submission = null) {
  if (isDeletedCandidate(candidate)) return false;
  const approval = lower(candidate.approval_status || '');
  const hasCandidateWorkflow = ['pending', 'approved', 'rejected'].includes(approval)
    || Boolean(String(candidate.approval_requested_at || candidate.submitted_by || '').trim());
  const subApproval = lower(submission?.approval_status || '');
  const hasRealSubmission = Boolean(String(submission?.submission_id || '').trim())
    && !['deleted', '__deleted__', 'archived', 'draft'].includes(subApproval);
  return hasCandidateWorkflow || hasRealSubmission;
}

function canonicalSubmissionRow(candidate = {}, submission = null, user = {}) {
  const sub = submission || {};
  const candidateId = String(candidate.candidate_id || sub.candidate_id || '').trim();
  const candidateApproval = lower(candidate.approval_status || '');
  const canonicalApproval = ['pending', 'approved', 'rejected'].includes(candidateApproval)
    ? (candidate.approval_status || '')
    : (sub.approval_status || candidate.approval_status || 'Pending');
  const workflowStamp = String(
    candidate.submission_date
    || candidate.approval_requested_at
    || sub.effective_submission_at
    || sub.submitted_at
    || sub.approval_requested_at
    || ''
  ).trim();
  const base = {
    ...sub,
    // Stable synthetic id only when an older/broken child row is absent.
    // This keeps the page usable while the candidate remains the source of truth.
    submission_id: String(sub.submission_id || '').trim() || `CANON-${candidateId}`,
    candidate_id: candidateId,
    jd_id: sub.jd_id || candidate.jd_id || '',
    recruiter_code: candidate.recruiter_code || sub.recruiter_code || '',
    status: candidate.status || sub.status || 'In - Progress',
    approval_status: canonicalApproval,
    approval_requested_at: sub.approval_requested_at || candidate.approval_requested_at || workflowStamp,
    submitted_at: sub.submitted_at || candidate.approval_requested_at || workflowStamp,
    effective_submission_at: candidate.submission_date || sub.effective_submission_at || workflowStamp,
    next_follow_up_at: sub.next_follow_up_at || candidate.follow_up_at || '',
    reminder_snoozed_until: sub.reminder_snoozed_until || '',
    reminder_note: sub.reminder_note || candidate.follow_up_note || '',
    updated_at: sub.updated_at || candidate.updated_at || '',
  };
  return {
    ...buildRow(base, candidate, user),
    candidate_submission_date: candidate.submission_date || '',
    submission_date: candidate.submission_date || '',
    submission_origin_at: workflowStamp,
  };
}

function latestSubmissionByCandidate(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const key = String(row?.candidate_id || '').trim();
    if (!key) continue;
    const current = map.get(key);
    if (!current || latestSubmissionStamp(row).localeCompare(latestSubmissionStamp(current)) > 0) map.set(key, row);
  }
  return map;
}

async function canonicalSubmissionRowsFromPostgres(req) {
  const { scopeSql, params } = buildSqlScope(req.user, []);
  const view = lower(req.query.view || 'all_pending');
  const extra = [];
  if (view === 'all_pending') {
    extra.push(`(lower(coalesce(c.approval_status,'')) = 'pending' or (lower(coalesce(c.approval_status,'')) = 'approved' and lower(coalesce(c.all_details_sent,'')) = 'pending') or lower(coalesce(s.approval_status,'')) = 'pending')`);
  } else if (view === 'today') {
    extra.push(`left(coalesce(nullif(c.submission_date,''), nullif(s.effective_submission_at,''), nullif(s.submitted_at,''), nullif(s.approval_requested_at,''), ''), 10) = to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')`);
  }
  if (String(req.query.recruiter_code || '').trim() && isLeadership(req.user)) {
    params.push(`%${String(req.query.recruiter_code).trim()}%`);
    extra.push(`coalesce(c.recruiter_code,'') ilike $${params.length}`);
  }
  const extraSql = extra.length ? ` and ${extra.join(' and ')}` : '';
  // Candidate-first remains the source of truth, but the common Today/Pending views
  // are filtered inside Postgres so old submission history is not transferred needlessly.
  const sql = `
    select
      c.*,
      s.submission_id as __submission_id,
      s.candidate_id as __submission_candidate_id,
      s.jd_id as __submission_jd_id,
      s.recruiter_code as __submission_recruiter_code,
      s.approval_status as __submission_approval_status,
      s.status as __submission_status,
      s.submitted_at as __submission_submitted_at,
      s.approval_requested_at as __submission_approval_requested_at,
      s.approved_at as __submission_approved_at,
      s.approved_by_name as __submission_approved_by_name,
      s.decision_note as __submission_decision_note,
      s.reminder_note as __submission_reminder_note,
      s.reminder_snoozed_until as __submission_reminder_snoozed_until,
      s.next_follow_up_at as __submission_next_follow_up_at,
      s.approval_rescheduled_at as __submission_approval_rescheduled_at,
      s.updated_at as __submission_updated_at,
      s.effective_submission_at as __submission_effective_submission_at
    from public.candidates c
    left join lateral (
      select sx.*
      from public.submissions sx
      where sx.candidate_id = c.candidate_id
      order by coalesce(sx.submitted_at, sx.approval_requested_at, sx.updated_at, '') desc,
               coalesce(sx.submission_id, '') desc
      limit 1
    ) s on true
    where ${scopeSql}
      and (
        coalesce(s.submission_id, '') <> ''
        or lower(coalesce(c.approval_status, '')) in ('pending', 'approved', 'rejected')
        or coalesce(c.approval_requested_at, '') <> ''
        or coalesce(c.submitted_by, '') <> ''
      )${extraSql}
    order by coalesce(nullif(c.submission_date, ''), s.submitted_at, s.approval_requested_at, c.updated_at, c.created_at, '') desc,
             coalesce(c.candidate_id, '') desc
  `;
  const rows = await store.query(sql, params);
  return rows.map((row) => {
    const submission = {
      submission_id: row.__submission_id || '', candidate_id: row.__submission_candidate_id || row.candidate_id || '', jd_id: row.__submission_jd_id || '',
      recruiter_code: row.__submission_recruiter_code || '', approval_status: row.__submission_approval_status || '', status: row.__submission_status || '',
      submitted_at: row.__submission_submitted_at || '', approval_requested_at: row.__submission_approval_requested_at || '', approved_at: row.__submission_approved_at || '',
      approved_by_name: row.__submission_approved_by_name || '', decision_note: row.__submission_decision_note || '', reminder_note: row.__submission_reminder_note || '',
      reminder_snoozed_until: row.__submission_reminder_snoozed_until || '', next_follow_up_at: row.__submission_next_follow_up_at || '',
      approval_rescheduled_at: row.__submission_approval_rescheduled_at || '', updated_at: row.__submission_updated_at || '', effective_submission_at: row.__submission_effective_submission_at || '',
    };
    const candidate = { ...row };
    Object.keys(candidate).filter((key) => key.startsWith('__submission_')).forEach((key) => delete candidate[key]);
    return canonicalSubmissionRow(candidate, submission.submission_id ? submission : null, req.user);
  });
}

async function canonicalSubmissionRowsFallback(req) {
  const candidates = await table('candidates');
  const submissions = await table('submissions');
  const latestMap = latestSubmissionByCandidate(submissions);
  const candidateIds = new Set(candidates.map((row) => String(row.candidate_id || '').trim()).filter(Boolean));
  const rows = candidates
    .filter((candidate) => visibleToUser({}, candidate, req.user))
    .map((candidate) => {
      const submission = latestMap.get(String(candidate.candidate_id || '').trim()) || null;
      return isCanonicalSubmittedCandidate(candidate, submission)
        ? canonicalSubmissionRow(candidate, submission, req.user)
        : null;
    })
    .filter(Boolean);

  // Preserve legacy/orphan rows for historical visibility; they are never used
  // to hide or replace a real candidate profile.
  for (const submission of submissions) {
    const cid = String(submission.candidate_id || '').trim();
    if (!cid || candidateIds.has(cid)) continue;
    if (!visibleToUser(submission, {}, req.user)) continue;
    if (['deleted', '__deleted__', 'archived', 'draft'].includes(lower(submission.approval_status || ''))) continue;
    rows.push(buildRow(submission, {}, req.user));
  }
  return rows;
}

function filterCanonicalSubmissionRows(rows, req) {
  const leaders = isLeadership(req.user);
  const rawView = lower(req.query.view || '');
  const legacyShowOld = String(req.query.show_old || '0') === '1';
  const days = Math.max(1, Number(req.query.days || 1));
  const view = rawView || (legacyShowOld ? 'today' : 'all_pending');
  const recruiterCodeFilter = leaders ? String(req.query.recruiter_code || '').trim().toLowerCase() : '';
  const detailsFilter = lower(req.query.all_details_sent || '');
  const reminderFilter = lower(req.query.reminder || '');
  const commsFilter = lower(req.query.comms || '');
  const submittedFrom = String(req.query.submitted_from || '').trim();
  const submittedTo = String(req.query.submitted_to || '').trim();

  const filtered = (rows || []).filter((row) => {
    if (view === 'all_pending' && !isPendingQueueRow(row)) return false;
    if (view === 'today' && !isSameLocalDay(trueSubmissionStamp(row))) return false;
    if (view === 'legacy_recent' && !withinRecentWindow(trueSubmissionStamp(row), 1)) return false;
    if (view === 'legacy_days' && !withinRecentWindow(trueSubmissionStamp(row), days)) return false;
    if (recruiterCodeFilter && !String(row.recruiter_code || '').toLowerCase().includes(recruiterCodeFilter)) return false;
    if (detailsFilter && lower(row.all_details_sent) !== detailsFilter) return false;
    if (reminderFilter) {
      const state = reminderState(row);
      if (reminderFilter === 'has' && !hasReminder(row)) return false;
      if (reminderFilter === 'none' && hasReminder(row)) return false;
      if (['due', 'scheduled'].includes(reminderFilter) && state !== reminderFilter) return false;
    }
    if (commsFilter && !String(row.submission_comms || '').toLowerCase().includes(commsFilter)) return false;
    if ((submittedFrom || submittedTo) && !matchesDateTimeRange(trueSubmissionStamp(row), submittedFrom, submittedTo)) return false;
    return true;
  });

  // CC26_774: TL/Manager can also work as recruiters. The shell sends
  // _global_reminder only for automatic Submission reminder popup selection.
  // If one of the leader's personally owned/uploaded candidates is actionable
  // in the normal 20-minute window, serve those rows first so the leader gets
  // the same personal reminder behavior as a recruiter. The normal Submissions
  // page and wider team visibility remain unchanged.
  const role = userRole(req.user);
  if ((role === 'tl' || role === 'manager') && String(req.query?._global_reminder || '').trim()) {
    const lookAhead = Date.now() + (20 * 60 * 1000);
    const ownActionable = filtered.filter((row) => {
      if (!row.personal_owner && !candidateBelongsToUser(row, req.user)) return false;
      const snoozed = String(row.reminder_snoozed_until || '').trim();
      const base = snoozed || row.approval_requested_at || row.submitted_at || row.effective_submission_at || row.submission_origin_at || row.created_at || row.updated_at || row.submission_date || '';
      const baseMs = new Date(base || 0).getTime();
      if (!Number.isFinite(baseMs) || baseMs <= 0) return false;
      const dueMs = snoozed ? baseMs : (baseMs + (5 * 60 * 1000));
      return dueMs <= lookAhead;
    });
    if (ownActionable.length) return ownActionable;
  }
  return filtered;
}

async function listFromPostgres(req) {
  const rows = await canonicalSubmissionRowsFromPostgres(req);
  return { rows: filterCanonicalSubmissionRows(rows, req), leaders: isLeadership(req.user) };
}

async function list(req, res) {
  const cacheKey = buildSubmissionCacheKey(req);
  const forceRefresh = Boolean(String(req.query?._refresh || req.query?._fresh || req.query?._summary || req.query?._check || '').trim());
  const cached = forceRefresh ? null : submissionListCache.get(cacheKey);
  if (cached) return res.json(cached);

  let rows = [];
  try {
    rows = mode === 'postgres' && store.pool
      ? (await listFromPostgres(req)).rows
      : filterCanonicalSubmissionRows(await canonicalSubmissionRowsFallback(req), req);
  } catch (error) {
    if (mode === 'postgres' && store.pool) {
      try { console.error('Submission list query failed:', error?.message || error); } catch {}
      return res.status(503).json({ message: 'Submission data could not be loaded safely. Please use Refresh once.' });
    }
    rows = filterCanonicalSubmissionRows(await canonicalSubmissionRowsFallback(req), req);
  }

  const items = appendLocalSubmissionValidation(
    dedupeRowsByCandidate(rows).sort(compareSubmissionListOrder),
    req,
  );
  const payload = { items, leaders: isLeadership(req.user) };
  submissionListCache.set(cacheKey, payload);
  return res.json(payload);
}

async function updateReminder(req, res) {
  const requestedId = String(req.params.submissionId || '').trim();
  let submission = await store.findById('submissions', 'submission_id', requestedId).catch(() => null);
  let candidate = null;

  // CC26_682: candidate-backed fallback rows use CANON-<candidate_id>.
  // Keep reminder actions working even if an older live schema failed to create
  // the child submission row. This is an explicit user write, never a GET-side write.
  if (!submission && requestedId.startsWith('CANON-')) {
    const candidateId = requestedId.slice('CANON-'.length);
    candidate = await store.findById('candidates', 'candidate_id', candidateId).catch(() => null);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!visibleToUser({}, candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });
    const nextFollowUpAt = String(req.body.next_follow_up_at || '').trim();
    const reminderNote = String(req.body.reminder_note || '').trim();
    const updatedCandidate = await store.update('candidates', 'candidate_id', candidateId, {
      follow_up_at: nextFollowUpAt,
      follow_up_note: reminderNote,
      follow_up_status: nextFollowUpAt ? 'Open' : (candidate.follow_up_status || 'Open'),
      updated_at: nowIso(),
    });
    clearAllCaches();
    return res.json({ ok: true, item: canonicalSubmissionRow(updatedCandidate || candidate, null, req.user) });
  }

  if (!submission) return res.status(404).json({ message: 'Submission not found' });
  if (!candidate) candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id).catch(() => null) || {};
  if (!visibleToUser(submission, candidate, req.user)) return res.status(403).json({ message: 'Not allowed' });

  const nextFollowUpAt = String(req.body.next_follow_up_at || '').trim();
  const reminderSnoozedUntil = String(req.body.reminder_snoozed_until || '').trim();
  const reminderNote = String(req.body.reminder_note || '').trim();

  const updated = await store.update('submissions', 'submission_id', submission.submission_id, {
    next_follow_up_at: nextFollowUpAt,
    reminder_snoozed_until: reminderSnoozedUntil,
    reminder_note: reminderNote,
    updated_at: nowIso(),
  });
  clearAllCaches();
  return res.json({ ok: true, item: updated });
}

async function bulkApprove(req, res) {
  for (const row of (await table('submissions')).filter((r) => String(r.approval_status || '').toLowerCase() === 'pending')) {
    await store.update('submissions', 'submission_id', row.submission_id, {
      approval_status: 'Approved',
      approved_by_name: req.user.full_name,
      approved_at: nowIso(),
    });
  }
  clearAllCaches();
  return res.json({ ok: true });
}

module.exports = { list, updateReminder, bulkApprove };
