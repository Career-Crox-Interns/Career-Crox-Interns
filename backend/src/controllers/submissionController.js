const { table, store, mode } = require('../lib/store');
const { recruiterCodeMatches, nowIso } = require('../lib/helpers');
const { sanitizeCandidateForUser } = require('../lib/dataLeakGuard');
const { createTimedCache, clearAllCaches } = require('../lib/cache');
const { reminderTriggerNowMs, dueInMinutes } = require('../lib/reminderWindow');
const { userRole, isLeadership, candidateBelongsToUser, candidateScopeSql } = require('../lib/accessRules');

const submissionListCache = createTimedCache(20000);

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isDeletedCandidate(candidate) {
  const status = lower(candidate?.status || candidate?.candidate_status || '');
  const approval = lower(candidate?.approval_status || '');
  const details = lower(candidate?.all_details_sent || '');
  const notes = lower(candidate?.data_notes || '');
  return Boolean(String(candidate?.deleted_at || '').trim())
    || status === 'deleted'
    || status === '__deleted__'
    || approval === 'deleted'
    || approval === '__deleted__'
    || details === 'deleted'
    || notes.includes('[crm-deleted]');
}

function visibleToUser(row, candidate, user) {
  if (isDeletedCandidate(candidate || row)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager' || role === 'tl') return true;
  return candidateBelongsToUser({ ...(candidate || {}), ...(row || {}) }, user);
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
  return String(row?.submitted_at || row?.approval_requested_at || '');
}

function submissionOriginStamp(row) {
  return trueSubmissionStamp(row);
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
  return String(row?.submission_origin_at || row?.submitted_at || row?.approval_requested_at || row?.updated_at || row?.created_at || '');
}

function isPendingQueueRow(row) {
  return lower(row?.all_details_sent) === 'pending' || lower(row?.approval_status) === 'pending';
}

function isSameLocalDay(value, base = new Date()) {
  const stamp = new Date(value || 0);
  if (Number.isNaN(stamp.getTime())) return false;
  return stamp.getFullYear() === base.getFullYear()
    && stamp.getMonth() === base.getMonth()
    && stamp.getDate() === base.getDate();
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
    all_details_sent: safeCandidate.all_details_sent || 'Pending',
    submission_comms: safeCandidate.communication_skill || row.submission_comms || '',
    next_follow_up_at: row.next_follow_up_at || '',
    reminder_snoozed_until: row.reminder_snoozed_until || '',
    reminder_note: row.reminder_note || '',
    submission_origin_at: submissionOriginStamp(row, safeCandidate),
  };
}

function buildSubmissionCacheKey(req) {
  return `${req.user?.user_id || 'anon'}:${JSON.stringify(req.query || {})}`;
}

function buildSqlScope(user, params = []) {
  const scoped = candidateScopeSql('c', user, params, ['s']);
  return { scopeSql: scoped.sql, params: scoped.params };
}

async function listFromPostgres(req, options = {}) {
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

  const { scopeSql, params } = buildSqlScope(req.user, []);
  const clauses = [scopeSql];
  if (view === 'all_pending' || view === 'today') {
    clauses.push(`(lower(coalesce(c.all_details_sent, '')) = 'pending' or lower(coalesce(s.approval_status, '')) = 'pending')`);
  }
  if (view === 'legacy_recent') {
    params.push(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    clauses.push(`coalesce(s.submitted_at, s.approval_requested_at, s.updated_at, s.created_at, '') >= $${params.length}`);
  }
  if (view === 'legacy_days') {
    params.push(new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString());
    clauses.push(`coalesce(s.submitted_at, s.approval_requested_at, s.updated_at, s.created_at, '') >= $${params.length}`);
  }
  if (recruiterCodeFilter) {
    params.push(`%${recruiterCodeFilter}%`);
    clauses.push(`lower(coalesce(c.recruiter_code, s.recruiter_code, '')) like $${params.length}`);
  }
  if (detailsFilter) {
    params.push(detailsFilter);
    clauses.push(`lower(coalesce(c.all_details_sent, '')) = $${params.length}`);
  }
  if (commsFilter) {
    params.push(`%${commsFilter}%`);
    clauses.push(`lower(coalesce(c.communication_skill, s.submission_comms, '')) like $${params.length}`);
  }
  if (submittedFrom) {
    params.push(submittedFrom);
    clauses.push(`coalesce(s.submitted_at, s.approval_requested_at, '') >= $${params.length}`);
  }
  if (submittedTo) {
    params.push(submittedTo);
    clauses.push(`coalesce(s.submitted_at, s.approval_requested_at, '') <= $${params.length}`);
  }
  if (reminderFilter === 'has') clauses.push(`coalesce(s.next_follow_up_at, '') <> ''`);
  if (reminderFilter === 'none') clauses.push(`coalesce(s.next_follow_up_at, '') = ''`);

  const sql = `
    select
      s.*,
      c.full_name,
      c.phone,
      c.location,
      c.preferred_location,
      c.process,
      c.status as candidate_status,
      coalesce(c.recruiter_name, s.recruiter_code, '') as recruiter_name,
      coalesce(c.recruiter_code, s.recruiter_code, '') as recruiter_code,
      coalesce(c.all_details_sent, 'Pending') as all_details_sent,
      coalesce(c.communication_skill, s.submission_comms, '') as submission_comms,
      coalesce(s.submitted_at, s.approval_requested_at, '') as submission_origin_at
    from public.submissions s
    left join public.candidates c on c.candidate_id = s.candidate_id
    where ${clauses.join(' and ')}
    order by coalesce(s.submitted_at, s.approval_requested_at, s.updated_at, s.created_at, '') desc
    limit 5000
  `;
  let rows = await store.query(sql, params);
  if (view === 'today') {
    rows = rows.filter((row) => isSameLocalDay(trueSubmissionStamp(row)));
  }
  if (reminderFilter === 'due' || reminderFilter === 'scheduled') {
    rows = rows.filter((row) => reminderState(row) === reminderFilter);
  }
  return { rows, leaders, view, days };
}

async function list(req, res) {
  const cacheKey = buildSubmissionCacheKey(req);
  const cached = submissionListCache.get(cacheKey);
  if (cached) return res.json(cached);

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

  let rows = [];
  try {
    if (mode === 'postgres' && store.pool) {
      const sqlResult = await listFromPostgres(req);
      rows = sqlResult.rows;
    } else {
      const submissions = await table('submissions');
      const candidates = await table('candidates');
      const candidatesById = new Map(candidates.map((c) => [String(c.candidate_id), c]));
      await rolloverPendingSubmissions(submissions, candidatesById);
      rows = submissions
        .map((row) => {
          const candidate = candidatesById.get(String(row.candidate_id)) || {};
          return buildRow(row, candidate, req.user);
        })
        .filter((row) => {
          const candidate = candidatesById.get(String(row.candidate_id)) || {};
          if (!visibleToUser(row, candidate, req.user)) return false;
          if (view === 'all_pending' && !isPendingQueueRow(row)) return false;
          if (view === 'today') {
            if (!isPendingQueueRow(row)) return false;
            if (!isSameLocalDay(trueSubmissionStamp(row))) return false;
          }
          if (view === 'legacy_recent' && !withinRecentWindow(row.submission_origin_at, 1)) return false;
          if (view === 'legacy_days' && !withinRecentWindow(row.submission_origin_at, days)) return false;
          if (recruiterCodeFilter && !String(row.recruiter_code || '').toLowerCase().includes(recruiterCodeFilter)) return false;
          if (detailsFilter && lower(row.all_details_sent) !== detailsFilter) return false;
          if (reminderFilter) {
            const state = reminderState(row);
            if (reminderFilter === 'has' && !hasReminder(row)) return false;
            if (reminderFilter === 'none' && hasReminder(row)) return false;
            if (['due', 'scheduled'].includes(reminderFilter) && state !== reminderFilter) return false;
          }
          if (commsFilter && !String(row.submission_comms || '').toLowerCase().includes(commsFilter)) return false;
          if ((submittedFrom || submittedTo) && !matchesDateTimeRange(row.submitted_at, submittedFrom, submittedTo)) return false;
          return true;
        });
    }
  } catch {
    const submissions = await table('submissions');
    const candidates = await table('candidates');
    const candidatesById = new Map(candidates.map((c) => [String(c.candidate_id), c]));
    rows = submissions
      .map((row) => {
        const candidate = candidatesById.get(String(row.candidate_id)) || {};
        return buildRow(row, candidate, req.user);
      })
      .filter((row) => {
        const candidate = candidatesById.get(String(row.candidate_id)) || {};
        if (!visibleToUser(row, candidate, req.user)) return false;
        if (view === 'all_pending' && !isPendingQueueRow(row)) return false;
        if (view === 'today') {
          if (!isPendingQueueRow(row)) return false;
          if (!isSameLocalDay(trueSubmissionStamp(row))) return false;
        }
        if (view === 'legacy_recent' && !withinRecentWindow(row.submission_origin_at, 1)) return false;
        if (view === 'legacy_days' && !withinRecentWindow(row.submission_origin_at, days)) return false;
        if (recruiterCodeFilter && !String(row.recruiter_code || '').toLowerCase().includes(recruiterCodeFilter)) return false;
        if (detailsFilter && lower(row.all_details_sent) !== detailsFilter) return false;
        if (reminderFilter) {
          const state = reminderState(row);
          if (reminderFilter === 'has' && !hasReminder(row)) return false;
          if (reminderFilter === 'none' && hasReminder(row)) return false;
          if (['due', 'scheduled'].includes(reminderFilter) && state !== reminderFilter) return false;
        }
        if (commsFilter && !String(row.submission_comms || '').toLowerCase().includes(commsFilter)) return false;
        if ((submittedFrom || submittedTo) && !matchesDateTimeRange(row.submitted_at, submittedFrom, submittedTo)) return false;
        return true;
      });
  }

  const items = dedupeRowsByCandidate(rows).sort((a, b) => latestSubmissionStamp(b).localeCompare(latestSubmissionStamp(a)));
  const payload = { items, leaders };
  submissionListCache.set(cacheKey, payload);
  return res.json(payload);
}

async function updateReminder(req, res) {
  const submission = await store.findById('submissions', 'submission_id', req.params.submissionId);
  if (!submission) return res.status(404).json({ message: 'Submission not found' });
  const candidates = await table('candidates');
  const candidate = candidates.find((c) => String(c.candidate_id) === String(submission.candidate_id)) || {};
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
