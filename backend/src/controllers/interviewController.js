const { store, table } = require('../lib/store');
const { nextId, nowIso, recruiterCodeMatches } = require('../lib/helpers');
const { canViewCandidate } = require('../lib/visibility');

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

async function visibleToUser(candidate, user) {
  return canViewCandidate(candidate, user);
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

async function list(req, res) {
  const interviews = await table('interviews');
  const candidates = await table('candidates');
  const jds = await table('jd_master');
  const mapped = interviews.map((i) => {
    const candidate = candidates.find((c) => c.candidate_id === i.candidate_id) || {};
    return { ...i, ...candidate, job_title: (jds.find((j) => j.jd_id === i.jd_id) || {}).job_title || '' };
  });
  const items = [];
  for (const row of mapped) {
    if (!isInterviewEligible(row)) continue;
    if (String(row.interview_remove_status || '').toLowerCase() === 'approved') continue;
    if (!String(row.interview_reschedule_date || row.scheduled_at || '').trim()) continue;
    if (!(await visibleToUser(row, req.user))) continue;
    items.push(row);
  }
  items.sort((a, b) => String(b.interview_reschedule_date || b.scheduled_at || '').localeCompare(String(a.interview_reschedule_date || a.scheduled_at || '')));
  return res.json({ items });
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
