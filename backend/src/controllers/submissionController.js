const { table, store } = require('../lib/store');
const { recruiterCodeMatches, nowIso } = require('../lib/helpers');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function visibleToUser(row, candidate, user) {
  if (['admin', 'manager', 'tl'].includes(String(user.role || '').toLowerCase())) return true;
  return recruiterCodeMatches(row.recruiter_code, user.recruiter_code)
    || recruiterCodeMatches(candidate?.recruiter_code, user.recruiter_code)
    || String(candidate?.recruiter_name || '') === String(user.full_name || '');
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

function hasReminder(row) {
  return Boolean(String(row.next_follow_up_at || '').trim());
}

function reminderState(row) {
  const followUpAt = new Date(row.next_follow_up_at || 0).getTime();
  if (!followUpAt) return 'none';
  const snoozeUntil = new Date(row.reminder_snoozed_until || 0).getTime();
  if (snoozeUntil && snoozeUntil > Date.now()) return 'scheduled';
  if (followUpAt <= Date.now()) return 'due';
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

async function rolloverPendingSubmissions(submissions, candidatesById) {
  const now = nowIso();
  for (const row of submissions) {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    if (lower(candidate.all_details_sent) !== 'pending') continue;
    const anchor = row.submitted_at || candidate.submission_date || row.updated_at || row.created_at;
    if (ageHoursFrom(anchor) < 24) continue;
    await store.update('submissions', 'submission_id', row.submission_id, {
      submitted_at: now,
      status: row.status || candidate.status || 'In Progress',
      updated_at: now,
    });
    row.submitted_at = now;
    if (String(candidate.candidate_id || '').trim()) {
      try {
        await store.update('candidates', 'candidate_id', candidate.candidate_id, {
          submission_date: now,
          updated_at: now,
        });
        candidate.submission_date = now;
      } catch {}
    }
  }
}

function buildRow(row, candidate) {
  return {
    ...row,
    full_name: candidate.full_name || '',
    phone: candidate.phone || '',
    location: candidate.location || '',
    process: candidate.process || '',
    candidate_status: candidate.status || '',
    recruiter_name: candidate.recruiter_name || row.recruiter_code || '',
    recruiter_code: candidate.recruiter_code || row.recruiter_code || '',
    all_details_sent: candidate.all_details_sent || 'Pending',
    submission_comms: candidate.communication_skill || row.submission_comms || '',
    next_follow_up_at: row.next_follow_up_at || '',
    reminder_snoozed_until: row.reminder_snoozed_until || '',
    reminder_note: row.reminder_note || '',
  };
}

async function list(req, res) {
  const submissions = await table('submissions');
  const candidates = await table('candidates');
  const candidatesById = new Map(candidates.map((c) => [String(c.candidate_id), c]));
  await rolloverPendingSubmissions(submissions, candidatesById);

  const leaders = isManager(req.user) || isTl(req.user);
  const showOld = String(req.query.show_old || '0') === '1';
  const days = Math.max(1, Number(req.query.days || 1));
  const recruiterCodeFilter = leaders ? String(req.query.recruiter_code || '').trim().toLowerCase() : '';
  const detailsFilter = lower(req.query.all_details_sent || '');
  const reminderFilter = lower(req.query.reminder || '');
  const commsFilter = lower(req.query.comms || '');
  const submittedFrom = String(req.query.submitted_from || '').trim();
  const submittedTo = String(req.query.submitted_to || '').trim();

  const items = [];
  for (const row of submissions) {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    const built = buildRow(row, candidate);
    if (!(await visibleToUser(row, candidate, req.user))) continue;
    if (!showOld && !withinRecentWindow(built.submitted_at, 1)) continue;
    if (showOld && !withinRecentWindow(built.submitted_at, days)) continue;
    if (recruiterCodeFilter && !String(built.recruiter_code || '').toLowerCase().includes(recruiterCodeFilter)) continue;
    if (detailsFilter && lower(built.all_details_sent) !== detailsFilter) continue;
    if (reminderFilter) {
      const state = reminderState(built);
      if (reminderFilter === 'has' && !hasReminder(built)) continue;
      if (reminderFilter === 'none' && hasReminder(built)) continue;
      if (['due', 'scheduled'].includes(reminderFilter) && state !== reminderFilter) continue;
    }
    if (commsFilter && !String(built.submission_comms || '').toLowerCase().includes(commsFilter)) continue;
    if ((submittedFrom || submittedTo) && !matchesDateTimeRange(built.submitted_at, submittedFrom, submittedTo)) continue;
    items.push(built);
  }
  items.sort((a, b) => String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));

  return res.json({ items, leaders });
}

async function updateReminder(req, res) {
  const submission = await store.findById('submissions', 'submission_id', req.params.submissionId);
  if (!submission) return res.status(404).json({ message: 'Submission not found' });
  const candidates = await table('candidates');
  const candidate = candidates.find((c) => String(c.candidate_id) === String(submission.candidate_id)) || {};
  if (!(await visibleToUser(submission, candidate, req.user))) return res.status(403).json({ message: 'Not allowed' });

  const nextFollowUpAt = String(req.body.next_follow_up_at || '').trim();
  const reminderSnoozedUntil = String(req.body.reminder_snoozed_until || '').trim();
  const reminderNote = String(req.body.reminder_note || '').trim();

  const updated = await store.update('submissions', 'submission_id', submission.submission_id, {
    next_follow_up_at: nextFollowUpAt,
    reminder_snoozed_until: reminderSnoozedUntil,
    reminder_note: reminderNote,
    updated_at: nowIso(),
  });
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
  return res.json({ ok: true });
}

module.exports = { list, updateReminder, bulkApprove };
