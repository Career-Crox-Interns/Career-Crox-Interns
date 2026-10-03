const { store, table, mode } = require('../lib/store');
const { nowIso, recruiterCodeMatches } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');
const { canApproveUnlock, eligibleApprovers, canonicalRole } = require('../lib/unlockPolicy');
const approvalLive = require('../lib/approvalLive');
const { approvalPayload } = require('../lib/unlockService');

function lower(value) {
  return String(value || '').trim().toLowerCase();
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
function makeFastId(prefix = 'X') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}
function makeFastBigIntId() {
  return Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`);
}

async function makeNotification(userId, title, message, category = 'approval', metadata = '') {
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
  try {
    await store.insert('notifications', item);
    return item;
  } catch (err) {
    try { console.warn('Notification insert skipped:', err?.message || err); } catch {}
    return null;
  }
}

function compactLower(value) {
  return String(value || '').trim().toLowerCase();
}

function userMatchesCandidateOrSubmission(user, candidate = {}, submission = {}) {
  const userId = String(user?.user_id || '').trim();
  const userCode = compactLower(user?.recruiter_code || '');
  const userName = compactLower(user?.full_name || user?.username || '');
  const directIds = [submission?.submitted_by_user_id, candidate?.created_by_user_id, candidate?.recruiter_user_id, candidate?.user_id]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (userId && directIds.includes(userId)) return true;

  const codes = [submission?.submitted_by_recruiter_code, candidate?.recruiter_code, candidate?.employee_code]
    .map(compactLower)
    .filter(Boolean);
  if (userCode && codes.some((code) => recruiterCodeMatches(code, userCode) || code === userCode)) return true;

  const names = [submission?.submitted_by_name, candidate?.recruiter_name, candidate?.employee_name, candidate?.submitted_by]
    .map(compactLower)
    .filter(Boolean);
  if (userName && names.includes(userName)) return true;
  return false;
}

async function notifyRecruiter(candidate, title, message, submission = null, extraMetadata = {}) {
  try {
    const users = await table('users').catch(() => []);
    const targets = users.filter((user) => userMatchesCandidateOrSubmission(user, candidate, submission || {}));
    const uniqueTargets = targets.filter((user, index, arr) => arr.findIndex((item) => String(item.user_id) === String(user.user_id)) === index);
    const metadata = JSON.stringify({
      candidate_id: candidate.candidate_id,
      submission_id: submission?.submission_id || '',
      open_path: `/candidate/${candidate.candidate_id}`,
      ...extraMetadata,
    });
    for (const user of uniqueTargets) {
      await makeNotification(user.user_id, title, message, 'approval', metadata);
    }
    return uniqueTargets.length;
  } catch (err) {
    try { console.warn('Recruiter notification skipped:', err?.message || err); } catch {}
    return 0;
  }
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
}


async function safeLogActivity(req, candidateId, actionType, metadata = {}) {
  try {
    await logActivity(req, candidateId, actionType, metadata);
  } catch (err) {
    try { console.warn('Activity log skipped:', err?.message || err); } catch {}
  }
}


function parseSnapshot(row = {}) {
  try { return JSON.parse(row.snapshot_json || '{}'); } catch { return {}; }
}

function attendanceReportDecisionPayload(row = {}, decision = 'Full Day', note = '', approver = {}) {
  const snapshot = parseSnapshot(row);
  return {
    ...snapshot,
    manager_decision: decision,
    manager_note: String(note || '').trim(),
    approved_by_name: approver?.full_name || approver?.username || '',
    approved_by_user_id: approver?.user_id || '',
    approved_at: nowIso(),
  };
}


function approvalAlreadyCompleted(candidate = {}, submission = {}) {
  return lower(candidate.approval_status) === 'approved' || lower(candidate.status) === 'approved' || lower(submission.approval_status) === 'approved' || lower(submission.status) === 'approved';
}
async function resolveLatestSubmission(candidateId) {
  const submissions = await table('submissions');
  return submissions
    .filter((s) => String(s.candidate_id) === String(candidateId))
    .sort((a, b) => String(b.approval_requested_at || b.submitted_at || '').localeCompare(String(a.approval_requested_at || a.submitted_at || '')))[0] || null;
}

async function resolvePendingSubmission(candidateId) {
  const submissions = await table('submissions');
  return submissions.find((s) => String(s.candidate_id) === String(candidateId) && lower(s.approval_status) === 'pending') || null;
}

function candidateApprovalIsPending(candidate = {}, submission = {}) {
  return lower(candidate?.approval_status) === 'pending' && lower(submission?.approval_status) === 'pending';
}

async function list(req, res) {
  const scope = String(req.query?.scope || 'all').trim().toLowerCase();
  const users = await table('users');
  const userById = new Map(users.map((u) => [String(u.user_id), u]));
  // CC26_604: the ops approval page only needs names for pending interview-remove requests.
  // In Postgres never scan/load the entire candidates table just to render a few rows.
  const relatedCandidates = (mode === 'postgres' && store.pool)
    ? await store.query(`select c.candidate_id, c.full_name, c.recruiter_name
        from public.candidates c
        where c.candidate_id in (
          select ir.candidate_id from public.interview_remove_requests ir
          where lower(coalesce(ir.status, '')) = 'pending'
        )`)
    : await table('candidates');
  const candidateById = new Map(relatedCandidates.map((c) => [String(c.candidate_id), c]));

  let candidates = [];
  if (mode === 'postgres' && store.pool) {
    if (scope !== 'ops') candidates = await store.query(`
      select
        'candidate'::text as type,
        s.submission_id as id,
        c.full_name as title,
        s.approval_status as status,
        coalesce(s.approval_requested_at, s.submitted_at, c.updated_at) as requested_at,
        c.candidate_id,
        c.recruiter_name,
        c.process
      from public.submissions s
      join public.candidates c on c.candidate_id = s.candidate_id
      where lower(coalesce(s.approval_status, '')) = 'pending'
        and lower(coalesce(c.approval_status, 'pending')) = 'pending'
        and ${deletedCandidateWhereSql('c')}
        and ${deletedSubmissionWhereSql('s')}
        and coalesce(c.candidate_id, '') <> ''
        and coalesce(c.full_name, '') <> ''
      order by coalesce(s.approval_requested_at, s.submitted_at, c.updated_at) desc
    `);
  } else {
    const submissions = await table('submissions');
    candidates = submissions
      .filter((s) => lower(s.approval_status) === 'pending' && !['deleted', '__deleted__', 'archived'].includes(lower(s.status)))
      .map((s) => {
        const c = candidateById.get(String(s.candidate_id)) || {};
        return {
          type: 'candidate', id: s.submission_id, title: c.full_name, status: s.approval_status,
          requested_at: s.approval_requested_at || s.submitted_at || c.updated_at,
          candidate_id: c.candidate_id || s.candidate_id, recruiter_name: c.recruiter_name || '', process: c.process || '', candidate_status: c.approval_status || '',
        };
      })
      .filter((item) => item.candidate_id && item.title && lower(item.candidate_status || 'pending') === 'pending');
  }

  const pendingInterviewRows = (mode === 'postgres' && store.pool)
    ? await store.query(`select * from public.interview_remove_requests where lower(coalesce(status, '')) = 'pending'`)
    : (await table('interview_remove_requests')).filter((r) => lower(r.status) === 'pending');
  const interviewRemovals = pendingInterviewRows.map((r) => {
    const candidate = candidateById.get(String(r.candidate_id)) || {};
    return {
      type: 'interview_remove',
      id: r.request_id,
      title: `${candidate.full_name || r.candidate_id || 'Candidate'} interview date remove request`,
      status: r.status,
      requested_at: r.requested_at || r.created_at,
      candidate_id: r.candidate_id || '',
      recruiter_name: candidate.recruiter_name || r.requested_by_name || '',
      process: r.reason || '',
    };
  });

  const pendingUnlockRows = (mode === 'postgres' && store.pool)
    ? await store.query(`select * from public.unlock_requests where lower(coalesce(status, '')) = 'pending'`)
    : (await table('unlock_requests')).filter((r) => lower(r.status) === 'pending');
  const unlocks = pendingUnlockRows.map((r) => {
    const requester = userById.get(String(r.user_id)) || {};
    if (!canApproveUnlock(req.user, requester)) return null;
    return {
      type: 'unlock',
      id: r.request_id,
      title: `${requester.full_name || requester.username || 'User'} unlock request`,
      status: r.status,
      requested_at: r.requested_at,
      candidate_id: '',
      recruiter_name: requester.full_name || requester.username || '',
      process: r.reason || requester.recruiter_code || '',
      requester_role: canonicalRole(requester),
      requester_user_id: requester.user_id || r.user_id || '',
    };
  }).filter(Boolean);

  const pendingSuggestions = (mode === 'postgres' && store.pool)
    ? await store.query(`select * from public.suggested_videos where lower(coalesce(status, '')) = 'pending'`)
    : (await table('suggested_videos')).filter((r) => lower(r.status) === 'pending');
  const suggestions = pendingSuggestions.map((r) => ({
    type: 'learning', id: r.suggestion_id, title: r.title, status: r.status, requested_at: r.created_at, candidate_id: '', recruiter_name: r.suggested_by_name, process: r.category,
  }));

  const pendingAttendanceReports = (mode === 'postgres' && store.pool)
    ? await store.query(`select * from public.scheduled_reports where lower(coalesce(report_type, '')) = 'attendance-daily' and lower(coalesce(status, '')) = 'pending'`)
    : (await table('scheduled_reports')).filter((r) => lower(r.report_type) === 'attendance-daily' && lower(r.status) === 'pending');
  const attendanceReports = pendingAttendanceReports
    .map((r) => {
      const snapshot = parseSnapshot(r);
      return {
        type: 'attendance_report',
        id: r.report_id,
        title: r.title || `${snapshot.employee?.full_name || 'Employee'} Attendance Report`,
        status: r.status,
        requested_at: r.last_run_at || r.created_at,
        candidate_id: '',
        recruiter_name: snapshot.employee?.full_name || '',
        process: `${snapshot.productivity_status || '-'} • ${snapshot.recommended_day_status || '-'}`,
        attendance_report: snapshot,
      };
    });

  const submissionItems = [...candidates].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const opsItems = [...interviewRemovals, ...unlocks, ...suggestions, ...attendanceReports].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const items = scope === 'submissions'
    ? submissionItems
    : scope === 'ops'
      ? opsItems
      : [...submissionItems, ...opsItems].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const submissionCount = scope === 'ops' && mode === 'postgres' && store.pool
    ? Number(await store.scalar(`select count(*)::int as value from public.submissions s
          join public.candidates c on c.candidate_id = s.candidate_id
          where lower(coalesce(s.approval_status, '')) = 'pending'
            and lower(coalesce(c.approval_status, 'pending')) = 'pending'
            and ${deletedCandidateWhereSql('c')}
            and ${deletedSubmissionWhereSql('s')}
            and coalesce(c.candidate_id, '') <> '' and coalesce(c.full_name, '') <> ''`, [], 'value') || 0)
    : submissionItems.length;
  return res.json({ items, counts: { submissions: submissionCount, ops: opsItems.length, total: submissionCount + opsItems.length } });
}

async function approve(req, res) {
  const { type, id } = req.body || {};
  if (type === 'candidate') {
    let submission = await store.findById('submissions', 'submission_id', id);
    let candidate = null;
    if (submission) candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id);
    if (!candidate) {
      candidate = await store.findById('candidates', 'candidate_id', id);
      submission = candidate ? await resolveLatestSubmission(candidate.candidate_id) : null;
    }
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!submission || !candidateApprovalIsPending(candidate, submission)) {
      if (approvalAlreadyCompleted(candidate, submission || {})) {
        clearAllCaches();
        return res.json({ ok: true, already_approved: true });
      }
      return res.status(409).json({ message: 'Approve allowed only after profile is submitted and pending.' });
    }
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, status: 'Approved', all_details_sent: candidate.all_details_sent || 'Pending', updated_at: nowIso() });
    await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Approved', approved_by_name: req.user.full_name, approved_at: nowIso(), decision_note: '', status: 'Approved' });
    await safeLogActivity(req, candidate.candidate_id, 'submission_approved', { approved_by: req.user.full_name || '' });
    await notifyRecruiter(candidate, 'Profile approved', `${candidate.full_name} has been approved by ${req.user.full_name}.`, submission, { approval_status: 'Approved' });
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'interview_remove') {
    const request = await store.findById('interview_remove_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Interview remove request not found' });
    const candidate = await store.findById('candidates', 'candidate_id', request.candidate_id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    await store.update('interview_remove_requests', 'request_id', id, { status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await store.update('candidates', 'candidate_id', candidate.candidate_id, {
      interview_reschedule_date: '',
      follow_up_at: '',
      interview_remove_status: 'Approved',
      interview_remove_approved_at: nowIso(),
      updated_at: nowIso(),
    });
    await safeLogActivity(req, candidate.candidate_id, 'interview_date_removed', { approved_by: req.user.full_name || '', request_id: id });
    await notifyRecruiter(candidate, 'Interview date removed', `${candidate.full_name} interview date removal was approved by ${req.user.full_name}.`, null, { approval_status: 'Approved', request_type: 'interview_remove' });
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'unlock') {
    const request = await store.findById('unlock_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Unlock request not found' });
    const requester = await store.findById('users', 'user_id', request.user_id) || {};
    if (!canApproveUnlock(req.user, requester)) {
      const targetRole = canonicalRole(requester);
      return res.status(403).json({ message: targetRole === 'tl' ? 'TL unlock can be approved only by Manager.' : 'You are not allowed to approve this unlock request.' });
    }
    await store.update('unlock_requests', 'request_id', id, { status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await store.update('presence', 'user_id', request.user_id, {
      locked: '0',
      is_on_break: '0',
      break_reason: '',
      break_started_at: '',
      break_expected_end_at: '',
      lock_reason: '',
      lock_message: '',
      unlock_grace_until: new Date(Date.now() + (15 * 60 * 1000)).toISOString(),
      last_seen_at: nowIso(),
      last_call_alert_sent_at: '',
      last_call_dial_at: nowIso(),
    });
    await makeNotification(request.user_id, 'CRM unlocked', `CRM access was restored by ${req.user.full_name}. You can continue working normally.`, 'attendance', JSON.stringify({ open_path: '/attendance' }));
    await safeLogActivity(req, '', 'crm_unlocked', { unlocked_user_id: request.user_id, request_id: id });
    try {
      const users = await table('users');
      approvalLive.publishToUsers([...eligibleApprovers(users, requester).map((u) => u.user_id), request.user_id], 'unlock-resolved', { id, status: 'Approved', requester_user_id: request.user_id });
    } catch {}
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'attendance_report') {
    const report = await store.findById('scheduled_reports', 'report_id', id);
    if (!report) return res.status(404).json({ message: 'Attendance report not found' });
    const decision = String(req.body?.decision || 'Full Day').trim();
    const note = String(req.body?.note || req.body?.reason || '').trim();
    const snapshot = attendanceReportDecisionPayload(report, decision, note, req.user);
    await store.update('scheduled_reports', 'report_id', id, {
      status: 'Approved',
      last_run_at: nowIso(),
      snapshot_json: JSON.stringify(snapshot),
    });
    await makeNotification(report.user_id, 'Attendance report approved', `Attendance report marked as ${decision} by ${req.user.full_name || req.user.username}.`, 'attendance', JSON.stringify({ open_path: '/attendance', report_id: id, decision }));
    await safeLogActivity(req, '', 'attendance_report_approved', { report_id: id, decision, note });
    clearAllCaches();
    return res.json({ ok: true, decision });
  }
  if (type === 'attendance_report') {
    const report = await store.findById('scheduled_reports', 'report_id', id);
    if (!report) return res.status(404).json({ message: 'Attendance report not found' });
    const decision = String(req.body?.decision || 'Half Day').trim();
    const note = String(reason || '').trim();
    const snapshot = attendanceReportDecisionPayload(report, decision, note, req.user);
    await store.update('scheduled_reports', 'report_id', id, {
      status: 'Rejected',
      last_run_at: nowIso(),
      snapshot_json: JSON.stringify(snapshot),
    });
    await makeNotification(report.user_id, 'Attendance report reviewed', `Attendance report was reviewed as ${decision}. Reason: ${note}`, 'attendance', JSON.stringify({ open_path: '/attendance', report_id: id, decision, reason: note }));
    await safeLogActivity(req, '', 'attendance_report_rejected', { report_id: id, decision, reason: note });
    clearAllCaches();
    return res.json({ ok: true, decision });
  }
  if (type === 'learning') {
    await store.update('suggested_videos', 'suggestion_id', id, { status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name });
    clearAllCaches();
    return res.json({ ok: true });
  }
  return res.status(400).json({ message: 'Unsupported approval type' });
}

async function reject(req, res) {
  const { type, id, reason } = req.body || {};
  if (!String(reason || '').trim()) return res.status(400).json({ message: 'Reason required' });
  if (type === 'candidate') {
    let submission = await store.findById('submissions', 'submission_id', id);
    let candidate = null;
    if (submission) candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id);
    if (!candidate) {
      candidate = await store.findById('candidates', 'candidate_id', id);
      submission = candidate ? await resolveLatestSubmission(candidate.candidate_id) : null;
    }
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!submission || !candidateApprovalIsPending(candidate, submission)) return res.status(409).json({ message: 'Reject allowed only after profile is submitted and pending.' });
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Rejected', approved_at: '', approved_by_name: '', status: 'Rejected', all_details_sent: 'Pending', updated_at: nowIso() });
    await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Rejected', decision_note: reason, approved_at: '', approved_by_name: '', status: 'Rejected' });
    await store.insert('notes', { id: makeFastBigIntId(), candidate_id: candidate.candidate_id, username: req.user.username, note_type: 'rejection', body: `Rejected: ${reason}`, created_at: nowIso() });
    await safeLogActivity(req, candidate.candidate_id, 'submission_rejected', { reason });
    await notifyRecruiter(candidate, 'Approval rejected', `${candidate.full_name} approval was rejected. Reason: ${reason}`, submission, { approval_status: 'Rejected', reason });
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'interview_remove') {
    const request = await store.findById('interview_remove_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Interview remove request not found' });
    const candidate = await store.findById('candidates', 'candidate_id', request.candidate_id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    await store.update('interview_remove_requests', 'request_id', id, { status: 'Rejected', reason, approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { interview_remove_status: 'Rejected', updated_at: nowIso() });
    await safeLogActivity(req, candidate.candidate_id, 'interview_date_removal_rejected', { reason, request_id: id });
    await notifyRecruiter(candidate, 'Interview date removal rejected', `${candidate.full_name} interview date removal request was rejected. Reason: ${reason}`, null, { approval_status: 'Rejected', request_type: 'interview_remove', reason });
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'unlock') {
    const request = await store.findById('unlock_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Unlock request not found' });
    const requester = await store.findById('users', 'user_id', request.user_id) || {};
    if (!canApproveUnlock(req.user, requester)) {
      const targetRole = canonicalRole(requester);
      return res.status(403).json({ message: targetRole === 'tl' ? 'TL unlock can be rejected only by Manager.' : 'You are not allowed to reject this unlock request.' });
    }
    await store.update('unlock_requests', 'request_id', id, { status: 'Rejected', reason, approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await makeNotification(request.user_id, 'Unlock request rejected', `Unlock request was rejected by ${req.user.full_name}. Reason: ${reason}`, 'attendance', JSON.stringify({ open_path: '/attendance' }));
    try {
      const users = await table('users');
      approvalLive.publishToUsers([...eligibleApprovers(users, requester).map((u) => u.user_id), request.user_id], 'unlock-resolved', { id, status: 'Rejected', requester_user_id: request.user_id });
    } catch {}
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'learning') {
    await store.update('suggested_videos', 'suggestion_id', id, { status: 'Rejected', rejection_reason: reason, approved_at: nowIso(), approved_by_name: req.user.full_name });
    clearAllCaches();
    return res.json({ ok: true });
  }
  return res.status(400).json({ message: 'Unsupported approval type' });
}


// CC26_628: manager-only, one scoped query on a new login; never load candidates,
// employee credentials, old messages, or the complete approvals table.
async function attendancePending(req, res) {
  const role = canonicalRole(req.user);
  if (role !== 'manager' && role !== 'admin') return res.status(403).json({ message: 'Manager access required' });
  let pending = [];
  if (mode === 'postgres' && store.pool) {
    pending = await store.query(`select report_id, title from public.scheduled_reports
      where lower(coalesce(report_type, '')) = 'attendance-daily'
        and lower(coalesce(status, '')) = 'pending'
      order by last_run_at desc nulls last, created_at desc nulls last limit 51`);
  } else {
    pending = (await table('scheduled_reports'))
      .filter(r => lower(r.report_type) === 'attendance-daily' && lower(r.status) === 'pending')
      .slice(0, 51).map(r => ({ report_id: r.report_id, title: r.title }));
  }
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, count: Math.min(50, pending.length), has_more: pending.length > 50,
    items: pending.slice(0, 3).map(r => ({ id: String(r.report_id || ''), title: String(r.title || 'Attendance report') })) });
}

async function stream(req, res) {
  // CC26_760: establish one push connection, then send at most one already-pending
  // unlock item on that same stream. No recurring approval polling is required.
  approvalLive.attach(req, res);
  try {
    const pending = (store.pool && typeof store.query === 'function')
      ? await store.query(`select * from public.unlock_requests where lower(coalesce(status,'')) = 'pending' order by requested_at desc nulls last, created_at desc nulls last limit 30`)
      : (await table('unlock_requests')).filter((row) => lower(row.status) === 'pending').sort((a,b) => String(b.requested_at || b.created_at || '').localeCompare(String(a.requested_at || a.created_at || ''))).slice(0, 30);
    if (!pending.length || res.writableEnded) return;
    const users = await table('users');
    const byId = new Map(users.map((u) => [String(u.user_id || ''), u]));
    const row = pending.find((item) => canApproveUnlock(req.user, byId.get(String(item.user_id || '')) || {}));
    if (!row || res.writableEnded) return;
    const requester = byId.get(String(row.user_id || '')) || { user_id: row.user_id, username: row.username, full_name: row.full_name };
    res.write(`event: unlock\ndata: ${JSON.stringify(approvalPayload(requester, row))}\n\n`);
  } catch (error) {
    try { console.warn('Approval stream initial snapshot skipped:', error?.message || error); } catch {}
  }
}

async function approveAll(req, res) {
  const submissions = (await table('submissions')).filter((s) => lower(s.approval_status) === 'pending');
  for (const submission of submissions) {
    const candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id);
    if (!candidate || !candidateApprovalIsPending(candidate, submission)) continue;
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, status: 'Approved', updated_at: nowIso() });
    await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Approved', approved_by_name: req.user.full_name, approved_at: nowIso(), decision_note: '', status: 'Approved' });
    await safeLogActivity(req, candidate.candidate_id, 'submission_approved', { approved_by: req.user.full_name || '', bulk: true });
  }
  clearAllCaches();
  return res.json({ ok: true });
}

module.exports = { list, approve, reject, approveAll, stream, attendancePending };
