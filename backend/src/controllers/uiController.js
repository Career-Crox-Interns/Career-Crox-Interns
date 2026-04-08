const { table, store, mode } = require('../lib/store');
const { ymd, recruiterCodeMatches } = require('../lib/helpers');
const { getSettingsMap } = require('../lib/settings');
const { isManager, isTl, canViewCandidate, canViewTask, visibleUsersForAssignments } = require('../lib/visibility');
const { PROCESS_OPTIONS } = require('./candidateController');

const uiMetaCache = new Map();
const dashboardCache = new Map();

function cacheGet(map, key, ttlMs) {
  const hit = map.get(key);
  if (!hit) return null;
  if ((Date.now() - hit.at) > ttlMs) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(map, key, value) {
  map.set(key, { at: Date.now(), value });
  return value;
}

function validPendingSubmission(submission, candidate) {
  if (!submission || !candidate) return false;
  if (String(submission.approval_status || '').toLowerCase() !== 'pending') return false;
  const candidateApproval = String(candidate.approval_status || '').toLowerCase();
  if (candidateApproval && candidateApproval !== 'pending') return false;
  return String(candidate.candidate_id || '').trim() && String(candidate.full_name || '').trim();
}

async function uiMeta(user) {
  const cached = cacheGet(uiMetaCache, `${user.user_id}:${user.role || ''}`, 5000);
  if (cached) return cached;
  const settings = await getSettingsMap();
  if (mode === 'postgres' && store.pool) {
    const unreadRows = await store.query(`select count(*)::int as total from public.notifications where user_id = $1 and lower(coalesce(status, '')) = 'unread'`, [user.user_id]);
    const latestRows = await store.query(`select * from public.notifications where user_id = $1 and lower(coalesce(status, '')) = 'unread' order by created_at desc limit 1`, [user.user_id]);
    let pendingApprovals = 0;
    let pendingSubmissionApprovals = 0;
    if (isManager(user) || isTl(user)) {
      const [submissions, interviewRemovals, unlocks, suggestions] = await Promise.all([
        store.query(`select count(*)::int as total from public.submissions s join public.candidates c on c.candidate_id = s.candidate_id where lower(coalesce(s.approval_status, '')) = 'pending' and lower(coalesce(c.approval_status, 'pending')) = 'pending' and coalesce(c.candidate_id, '') <> '' and coalesce(c.full_name, '') <> ''`),
        store.query(`select count(*)::int as total from public.interview_remove_requests where lower(coalesce(status, '')) = 'pending'`),
        store.query(`select count(*)::int as total from public.unlock_requests where lower(coalesce(status, '')) = 'pending'`),
        store.query(`select count(*)::int as total from public.suggested_videos where lower(coalesce(status, '')) = 'pending'`),
      ]);
      pendingSubmissionApprovals = Number(submissions[0]?.total || 0);
      pendingApprovals = Number(interviewRemovals[0]?.total || 0) + Number(unlocks[0]?.total || 0) + Number(suggestions[0]?.total || 0);
    }
    return cacheSet(uiMetaCache, `${user.user_id}:${user.role || ''}`, {
      unread_notifications: Number(unreadRows[0]?.total || 0),
      pending_approvals: pendingApprovals,
      pending_submission_approvals: typeof pendingSubmissionApprovals === 'number' ? pendingSubmissionApprovals : 0,
      latest_notification: latestRows[0] || null,
      settings,
    });
  }

  const notifications = (await table('notifications')).filter(
    (n) => String(n.user_id) === String(user.user_id) && String(n.status || '').toLowerCase() === 'unread',
  );
  const candidates = await table('candidates');
  for (const task of tasks) {
    if (await canViewTask(task, user)) scopedTasks.push(task);
  }
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id), row]));
  const pendingSubmissions = (isManager(user) || isTl(user))
    ? (await table('submissions')).filter((s) => validPendingSubmission(s, candidatesById.get(String(s.candidate_id))))
    : [];
  const pendingInterviewRemovals = (isManager(user) || isTl(user)) ? (await table('interview_remove_requests')).filter((r) => String(r.status || '').toLowerCase() === 'pending') : [];
  const pendingUnlocks = (isManager(user) || isTl(user)) ? (await table('unlock_requests')).filter((r) => String(r.status || '').toLowerCase() === 'pending') : [];
  const pendingSuggestions = (isManager(user) || isTl(user)) ? (await table('suggested_videos')).filter((r) => String(r.status || '').toLowerCase() === 'pending') : [];
  return cacheSet(uiMetaCache, `${user.user_id}:${user.role || ''}`, {
    unread_notifications: notifications.length,
    pending_approvals: pendingInterviewRemovals.length + pendingUnlocks.length + pendingSuggestions.length,
    pending_submission_approvals: pendingSubmissions.length,
    latest_notification: notifications.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null,
    settings,
  });
}


function toMs(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? time : 0;
}

function lowerText(value) {
  return String(value || '').trim().toLowerCase();
}

function candidateIsUntouched(candidate, lastTouchedAt, hasInterview, nowMs) {
  if (!candidate) return false;
  const status = lowerText(candidate.status || '');
  if (['non-interested', 'non interested', 'not intrested', 'not interested', 'not responding', 'rejected', 'joined', 'selected'].includes(status)) return false;
  if (!hasInterview) return false;
  const detailsReady = [candidate.full_name, candidate.phone, candidate.location, candidate.qualification, candidate.preferred_location].every((value) => String(value || '').trim());
  if (!detailsReady) return false;
  const detailState = lowerText(candidate.all_details_sent || '');
  if (detailState === 'pending') return false;
  const touchedMs = toMs(lastTouchedAt || candidate.updated_at || candidate.created_at);
  if (!touchedMs) return false;
  return (nowMs - touchedMs) >= 48 * 60 * 60 * 1000;
}

async function dashboardData(user) {
  const cached = cacheGet(dashboardCache, `${user.user_id}:${user.role || ''}`, 5000);
  if (cached) return cached;
  const users = await table('users');
  const candidates = await table('candidates');
  const interviews = await table('interviews');
  const tasks = await table('tasks');
  const scopedTasks = [];
  const notifications = await table('notifications');
  const presence = await table('presence');
  const submissions = await table('submissions');
  const activityLog = await table('activity_log');
  const today = ymd();
  const nowMs = Date.now();
  const scoped = [];
  for (const candidate of candidates) {
    if (await canViewCandidate(candidate, user)) scoped.push(candidate);
  }
  for (const task of tasks) {
    if (await canViewTask(task, user)) scopedTasks.push(task);
  }
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id), row]));
  const scopedCandidateIds = new Set(scoped.map((row) => String(row.candidate_id || '')));
  const validPendingCount = submissions.filter((s) => scopedCandidateIds.has(String(s.candidate_id || '')) && validPendingSubmission(s, candidatesById.get(String(s.candidate_id)))).length;

  const lostLeads = scoped.filter((c) => {
    const status = String(c.status || '').toLowerCase();
    const approval = String(c.approval_status || '').toLowerCase();
    const looking = String(c.looking_for_job || 'yes').toLowerCase();
    const overdue = String(c.follow_up_at || '') && String(c.follow_up_at || '') < today;
    return ['rejected', 'not intrested', 'not interested', 'not responding', 'rejected once, needs new interview'].includes(status) || approval === 'rejected' || looking === 'no' || overdue;
  }).slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  const activityByCandidate = new Map();
  for (const row of activityLog) {
    const key = String(row.candidate_id || '').trim();
    if (!key) continue;
    const stamp = row.created_at || '';
    const prev = activityByCandidate.get(key) || '';
    if (String(stamp).localeCompare(String(prev)) > 0) activityByCandidate.set(key, stamp);
  }
  const interviewsByCandidate = new Set(
    interviews
      .filter((row) => String(row.scheduled_at || row.interview_reschedule_date || '').trim() || String(row.status || '').trim())
      .map((row) => String(row.candidate_id || '').trim())
      .filter(Boolean),
  );
  const untouchedProfiles = scoped
    .filter((candidate) => candidateIsUntouched(candidate, activityByCandidate.get(String(candidate.candidate_id || '')), interviewsByCandidate.has(String(candidate.candidate_id || '')) || String(candidate.interview_reschedule_date || '').trim(), nowMs))
    .sort((a, b) => String(activityByCandidate.get(String(a.candidate_id || '')) || a.updated_at || a.created_at || '').localeCompare(String(activityByCandidate.get(String(b.candidate_id || '')) || b.updated_at || b.created_at || '')))
    .slice(0, 12)
    .map((candidate) => ({
      candidate_id: candidate.candidate_id,
      full_name: candidate.full_name,
      recruiter_name: candidate.recruiter_name || 'Unassigned',
      process: candidate.process || '-',
      location: candidate.location || '-',
      interview_reschedule_date: candidate.interview_reschedule_date || '',
      last_touched_at: activityByCandidate.get(String(candidate.candidate_id || '')) || candidate.updated_at || candidate.created_at || '',
    }));
  return cacheSet(dashboardCache, `${user.user_id}:${user.role || ''}`, {
    total_profiles: scoped.length,
    today_calls: scoped.filter((c) => String(c.updated_at || '').startsWith(today)).length,
    interviews_today: interviews.filter((i) => scopedCandidateIds.has(String(i.candidate_id || '')) && String(i.scheduled_at || '').startsWith(today)).length,
    pending_approvals: validPendingCount,
    today_submissions: submissions.filter((s) => scopedCandidateIds.has(String(s.candidate_id || '')) && String(s.submitted_at || '').startsWith(today)).length,
    lost_leads_total: lostLeads.length,
    lost_leads_items: lostLeads.slice(0, 8),
    untouched_profiles_total: untouchedProfiles.length,
    untouched_profiles: untouchedProfiles,
    recent_activity: scoped.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 8),
    due_tasks: scopedTasks.slice().sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))).slice(0, 8),
    unread_notes: notifications.filter((n) => String(n.user_id) === String(user.user_id) && String(n.status || '').toLowerCase() === 'unread').slice(0, 8),
    manager_monitoring: users.map((member) => ({
      user_id: member.user_id,
      full_name: member.full_name,
      designation: member.designation,
      candidate_count: candidates.filter((c) => String(c.recruiter_name || '').trim().toLowerCase() === String(member.full_name || '').trim().toLowerCase() || (!String(c.recruiter_name || '').trim() && recruiterCodeMatches(c.recruiter_code, member.recruiter_code))).length,
      open_tasks: tasks.filter((t) => (t.assigned_to_user_id === member.user_id || t.assigned_to_name === member.full_name) && !['closed', 'done', 'completed'].includes(String(t.status || '').toLowerCase())).length,
    })).slice(0, 10),
    active_workers: presence.filter((p) => String(p.locked || '0') !== '1').length,
    active_managers: users.filter((u) => ['admin', 'manager', 'tl'].includes(u.role)).length,
  });
}

async function meta(req, res) { return res.json(await uiMeta(req.user)); }
async function dashboard(req, res) { return res.json(await dashboardData(req.user)); }
async function lookups(req, res) {
  const users = (await visibleUsersForAssignments(req.user)).map((u) => ({ user_id: u.user_id, username: u.username, full_name: u.full_name, designation: u.designation, role: u.role, recruiter_code: u.recruiter_code, assigned_tl_user_id: u.assigned_tl_user_id || '', assigned_tl_name: u.assigned_tl_name || '' }));
  const visibleCandidates = [];
  for (const candidate of await table('candidates')) {
    if (await canViewCandidate(candidate, req.user)) visibleCandidates.push(candidate);
  }
  const candidates = visibleCandidates.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 120).map((c) => ({ candidate_id: c.candidate_id, full_name: c.full_name, phone: c.phone, process: c.process, recruiter_name: c.recruiter_name }));
  const jds = (await table('jd_master')).map((j) => ({ jd_id: j.jd_id, job_title: j.job_title, company: j.company, location: j.location }));
  return res.json({ users, candidates, jds, process_options: PROCESS_OPTIONS });
}

module.exports = { meta, dashboard, lookups };
