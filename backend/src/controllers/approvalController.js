const { store, table, mode } = require('../lib/store');
const { nowIso, recruiterCodeMatches } = require('../lib/helpers');

function lower(value) {
  return String(value || '').trim().toLowerCase();
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
  await store.insert('notifications', item);
}

async function notifyRecruiter(candidate, title, message) {
  const users = await table('users');
  const user = users.find((u) => recruiterCodeMatches(candidate.recruiter_code, u.recruiter_code) || u.full_name === candidate.recruiter_name);
  if (user) {
    await makeNotification(user.user_id, title, message, 'approval', JSON.stringify({ candidate_id: candidate.candidate_id, open_path: `/candidate/${candidate.candidate_id}` }));
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

async function list(req, res) {
  const scope = String(req.query?.scope || 'all').trim().toLowerCase();
  const users = await table('users');
  const userById = new Map(users.map((u) => [String(u.user_id), u]));
  const allCandidates = await table('candidates');
  const candidateById = new Map(allCandidates.map((c) => [String(c.candidate_id), c]));

  let candidates = [];
  if (mode === 'postgres' && store.pool) {
    candidates = await store.query(`
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
        and coalesce(c.candidate_id, '') <> ''
        and coalesce(c.full_name, '') <> ''
      order by coalesce(s.approval_requested_at, s.submitted_at, c.updated_at) desc
    `);
  } else {
    const submissions = await table('submissions');
    candidates = submissions
      .filter((s) => lower(s.approval_status) === 'pending')
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

  const interviewRemovals = (await table('interview_remove_requests')).filter((r) => lower(r.status) === 'pending').map((r) => {
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

  const unlocks = (await table('unlock_requests')).filter((r) => lower(r.status) === 'pending').map((r) => {
    const requester = userById.get(String(r.user_id)) || {};
    return {
      type: 'unlock',
      id: r.request_id,
      title: `${requester.full_name || requester.username || 'User'} unlock request`,
      status: r.status,
      requested_at: r.requested_at,
      candidate_id: '',
      recruiter_name: requester.full_name || requester.username || '',
      process: requester.recruiter_code || '',
    };
  });

  const suggestions = (await table('suggested_videos')).filter((r) => lower(r.status) === 'pending').map((r) => ({
    type: 'learning', id: r.suggestion_id, title: r.title, status: r.status, requested_at: r.created_at, candidate_id: '', recruiter_name: r.suggested_by_name, process: r.category,
  }));

  const submissionItems = [...candidates].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const opsItems = [...interviewRemovals, ...unlocks, ...suggestions].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const items = scope === 'submissions'
    ? submissionItems
    : scope === 'ops'
      ? opsItems
      : [...submissionItems, ...opsItems].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  return res.json({ items, counts: { submissions: submissionItems.length, ops: opsItems.length, total: submissionItems.length + opsItems.length } });
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
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, status: 'Approved', all_details_sent: candidate.all_details_sent || 'Pending', updated_at: nowIso() });
    if (submission) await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Approved', approved_by_name: req.user.full_name, approved_at: nowIso(), decision_note: '', status: 'Approved' });
    await logActivity(req, candidate.candidate_id, 'submission_approved', { approved_by: req.user.full_name || '' });
    await notifyRecruiter(candidate, 'Profile approved', `${candidate.full_name} has been approved by ${req.user.full_name}.`);
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
    await logActivity(req, candidate.candidate_id, 'interview_date_removed', { approved_by: req.user.full_name || '', request_id: id });
    await notifyRecruiter(candidate, 'Interview date removed', `${candidate.full_name} interview date removal was approved by ${req.user.full_name}.`);
    return res.json({ ok: true });
  }
  if (type === 'unlock') {
    const request = await store.findById('unlock_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Unlock request not found' });
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
    await logActivity(req, '', 'crm_unlocked', { unlocked_user_id: request.user_id, request_id: id });
    return res.json({ ok: true });
  }
  if (type === 'learning') {
    await store.update('suggested_videos', 'suggestion_id', id, { status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name });
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
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Rejected', approved_at: '', approved_by_name: '', status: 'Rejected', updated_at: nowIso() });
    if (submission) await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Rejected', decision_note: reason, approved_at: '', approved_by_name: '', status: 'Rejected' });
    await store.insert('notes', { id: makeFastBigIntId(), candidate_id: candidate.candidate_id, username: req.user.username, note_type: 'rejection', body: `Rejected: ${reason}`, created_at: nowIso() });
    await logActivity(req, candidate.candidate_id, 'submission_rejected', { reason });
    await notifyRecruiter(candidate, 'Profile rejected', `${candidate.full_name} was rejected. Reason: ${reason}`);
    return res.json({ ok: true });
  }
  if (type === 'interview_remove') {
    const request = await store.findById('interview_remove_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Interview remove request not found' });
    const candidate = await store.findById('candidates', 'candidate_id', request.candidate_id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    await store.update('interview_remove_requests', 'request_id', id, { status: 'Rejected', reason, approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { interview_remove_status: 'Rejected', updated_at: nowIso() });
    await logActivity(req, candidate.candidate_id, 'interview_date_removal_rejected', { reason, request_id: id });
    await notifyRecruiter(candidate, 'Interview date removal rejected', `${candidate.full_name} interview date removal request was rejected. Reason: ${reason}`);
    return res.json({ ok: true });
  }
  if (type === 'unlock') {
    const request = await store.findById('unlock_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Unlock request not found' });
    await store.update('unlock_requests', 'request_id', id, { status: 'Rejected', reason, approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await makeNotification(request.user_id, 'Unlock request rejected', `Unlock request was rejected by ${req.user.full_name}. Reason: ${reason}`, 'attendance', JSON.stringify({ open_path: '/attendance' }));
    return res.json({ ok: true });
  }
  if (type === 'learning') {
    await store.update('suggested_videos', 'suggestion_id', id, { status: 'Rejected', rejection_reason: reason, approved_at: nowIso(), approved_by_name: req.user.full_name });
    return res.json({ ok: true });
  }
  return res.status(400).json({ message: 'Unsupported approval type' });
}

async function approveAll(req, res) {
  const submissions = (await table('submissions')).filter((s) => lower(s.approval_status) === 'pending');
  for (const submission of submissions) {
    const candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id);
    if (!candidate) continue;
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, status: 'Approved', updated_at: nowIso() });
    await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Approved', approved_by_name: req.user.full_name, approved_at: nowIso(), decision_note: '', status: 'Approved' });
    await logActivity(req, candidate.candidate_id, 'submission_approved', { approved_by: req.user.full_name || '', bulk: true });
  }
  return res.json({ ok: true });
}

module.exports = { list, approve, reject, approveAll };
