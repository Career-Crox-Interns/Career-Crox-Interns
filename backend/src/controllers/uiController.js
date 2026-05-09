const { table, store, mode } = require('../lib/store');
const { ymd, recruiterCodeMatches } = require('../lib/helpers');
const { getSettingsMap } = require('../lib/settings');
const { sanitizeCandidateListForUser } = require('../lib/dataLeakGuard');
const { PROCESS_OPTIONS } = require('./candidateController');
const { isLeadership: isAccessLeadership, candidateScopeSql: centralCandidateScopeSql } = require('../lib/accessRules');

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

function lowerText(value) {
  return String(value || '').trim().toLowerCase();
}

function isLeadershipUser(user) {
  return isAccessLeadership(user);
}

function dashboardUserKey(user) {
  return [user?.user_id || 'anon', user?.role || '', user?.recruiter_code || '', user?.full_name || '']
    .map((value) => String(value || '').trim())
    .join(':');
}

function candidateIsDeleted(row) {
  const status = lowerText(row?.status || '');
  const approval = lowerText(row?.approval_status || '');
  const details = lowerText(row?.all_details_sent || '');
  const notes = lowerText(row?.data_notes || '');
  return Boolean(String(row?.deleted_at || '').trim())
    || status === 'deleted'
    || status === '__deleted__'
    || approval === 'deleted'
    || approval === '__deleted__'
    || details === 'deleted'
    || notes.includes('[crm-deleted]');
}

function candidateNotDeletedSql(alias = 'c') {
  return `lower(coalesce(${alias}.status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${alias}.approval_status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${alias}.all_details_sent, '')) <> 'deleted'
    and lower(coalesce(${alias}.data_notes, '')) not like '%[crm-deleted]%'`;
}

function candidateScopeSql(user, alias = 'c', params = []) {
  return centralCandidateScopeSql(alias, user, params);
}

function validPendingSubmission(submission, candidate) {
  if (!submission || !candidate || candidateIsDeleted(candidate)) return false;
  if (lowerText(submission.approval_status) !== 'pending') return false;
  const candidateApproval = lowerText(candidate.approval_status);
  if (candidateApproval && candidateApproval !== 'pending') return false;
  return String(candidate.candidate_id || '').trim() && String(candidate.full_name || '').trim();
}

async function uiMeta(user) {
  const cacheKey = dashboardUserKey(user);
  const cached = cacheGet(uiMetaCache, cacheKey, 45000);
  if (cached) return cached;
  const settings = await getSettingsMap();
  if (mode === 'postgres' && store.pool) {
    const unreadRows = await store.query(`select count(*)::int as total from public.notifications where user_id = $1 and lower(coalesce(status, '')) = 'unread'`, [user.user_id]);
    const latestRows = await store.query(`select * from public.notifications where user_id = $1 and lower(coalesce(status, '')) = 'unread' order by created_at desc limit 1`, [user.user_id]);
    let pendingApprovals = 0;
    let pendingSubmissionApprovals = 0;
    if (isLeadershipUser(user)) {
      const [submissions, interviewRemovals, unlocks, suggestions] = await Promise.all([
        store.query(`select count(*)::int as total from public.submissions s join public.candidates c on c.candidate_id = s.candidate_id where ${candidateNotDeletedSql('c')} and lower(coalesce(s.approval_status, '')) = 'pending' and lower(coalesce(c.approval_status, 'pending')) = 'pending' and coalesce(c.candidate_id, '') <> '' and coalesce(c.full_name, '') <> ''`),
        store.query(`select count(*)::int as total from public.interview_remove_requests where lower(coalesce(status, '')) = 'pending'`),
        store.query(`select count(*)::int as total from public.unlock_requests where lower(coalesce(status, '')) = 'pending'`),
        store.query(`select count(*)::int as total from public.suggested_videos where lower(coalesce(status, '')) = 'pending'`),
      ]);
      pendingSubmissionApprovals = Number(submissions[0]?.total || 0);
      pendingApprovals = Number(interviewRemovals[0]?.total || 0) + Number(unlocks[0]?.total || 0) + Number(suggestions[0]?.total || 0);
    }
    return cacheSet(uiMetaCache, cacheKey, {
      unread_notifications: Number(unreadRows[0]?.total || 0),
      pending_approvals: pendingApprovals,
      pending_submission_approvals: pendingSubmissionApprovals,
      latest_notification: latestRows[0] || null,
      settings,
    });
  }

  const notifications = (await table('notifications')).filter((n) => String(n.user_id) === String(user.user_id) && lowerText(n.status) === 'unread');
  const candidates = (await table('candidates')).filter((row) => !candidateIsDeleted(row));
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id), row]));
  const pendingSubmissions = isLeadershipUser(user)
    ? (await table('submissions')).filter((s) => validPendingSubmission(s, candidatesById.get(String(s.candidate_id))))
    : [];
  const pendingInterviewRemovals = isLeadershipUser(user) ? (await table('interview_remove_requests')).filter((r) => lowerText(r.status) === 'pending') : [];
  const pendingUnlocks = isLeadershipUser(user) ? (await table('unlock_requests')).filter((r) => lowerText(r.status) === 'pending') : [];
  const pendingSuggestions = isLeadershipUser(user) ? (await table('suggested_videos')).filter((r) => lowerText(r.status) === 'pending') : [];
  return cacheSet(uiMetaCache, cacheKey, {
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

function candidateIsUntouched(candidate, lastTouchedAt, hasInterview, nowMs) {
  if (!candidate) return false;
  const status = lowerText(candidate.status || '');
  if (['non-interested', 'non interested', 'not intrested', 'not interested', 'not responding', 'rejected', 'joined', 'selected'].includes(status)) return false;
  if (!hasInterview) return false;
  const detailsReady = [candidate.full_name, candidate.phone, candidate.location, candidate.qualification, candidate.preferred_location].every((value) => String(value || '').trim());
  if (!detailsReady) return false;
  if (lowerText(candidate.all_details_sent) === 'pending') return false;
  const touchedMs = toMs(lastTouchedAt || candidate.updated_at || candidate.created_at);
  if (!touchedMs) return false;
  return (nowMs - touchedMs) >= 48 * 60 * 60 * 1000;
}

function emptyDashboardPayload() {
  return {
    total_profiles: 0,
    today_calls: 0,
    interviews_today: 0,
    pending_approvals: 0,
    today_submissions: 0,
    lost_leads_total: 0,
    lost_leads_items: [],
    untouched_profiles_total: 0,
    untouched_profiles: [],
    recent_activity: [],
    due_tasks: [],
    unread_notes: [],
    manager_monitoring: [],
    active_workers: 0,
    active_managers: 0,
  };
}

async function dashboardDataPostgres(user) {
  const today = ymd();
  const todayStart = `${today}T00:00:00.000Z`;
  const todayEnd = `${today}T23:59:59.999Z`;
  const leadership = isLeadershipUser(user);
  const scope = candidateScopeSql(user, 'c', []);
  const scopeSql = scope.sql;
  const baseParams = scope.params;

  const countSql = `
    select
      count(*)::int as total_profiles,
      count(*) filter (where coalesce(c.updated_at, '') >= $${baseParams.length + 1} and coalesce(c.updated_at, '') < $${baseParams.length + 2})::int as today_calls,
      count(*) filter (where coalesce(c.interview_reschedule_date, c.interview_date, '') >= $${baseParams.length + 1} and coalesce(c.interview_reschedule_date, c.interview_date, '') < $${baseParams.length + 2})::int as interviews_today
    from public.candidates c
    where ${scopeSql}`;

  const pendingSql = `
    select count(*)::int as total
    from public.submissions s
    join public.candidates c on c.candidate_id = s.candidate_id
    where ${scopeSql}
      and lower(coalesce(s.approval_status, '')) = 'pending'
      and lower(coalesce(c.approval_status, 'pending')) = 'pending'
      and coalesce(c.candidate_id, '') <> ''
      and coalesce(c.full_name, '') <> ''`;

  const submissionsTodaySql = `
    select count(*)::int as total
    from public.submissions s
    join public.candidates c on c.candidate_id = s.candidate_id
    where ${scopeSql}
      and coalesce(s.submitted_at, s.approval_requested_at, s.created_at, '') >= $${baseParams.length + 1}
      and coalesce(s.submitted_at, s.approval_requested_at, s.created_at, '') < $${baseParams.length + 2}`;

  const recentSql = `
    select c.candidate_id, c.full_name, c.phone, c.status, c.recruiter_name, c.recruiter_code, c.location, c.updated_at, c.process
    from public.candidates c
    where ${scopeSql}
    order by coalesce(c.updated_at, c.created_at, '') desc
    limit 8`;

  const lostCondition = `(
    lower(coalesce(c.status, '')) in ('rejected', 'not intrested', 'not interested', 'not responding', 'rejected once, needs new interview')
    or lower(coalesce(c.approval_status, '')) = 'rejected'
    or lower(coalesce(c.looking_for_job, 'yes')) = 'no'
    or (coalesce(c.follow_up_at, '') <> '' and c.follow_up_at < $${baseParams.length + 1})
  )`;
  const lostSql = `
    select c.candidate_id, c.full_name, c.phone, c.status, c.recruiter_name, c.recruiter_code, c.location, c.updated_at, c.process, c.follow_up_at, c.approval_status, c.looking_for_job
    from public.candidates c
    where ${scopeSql} and ${lostCondition}
    order by coalesce(c.updated_at, c.created_at, '') desc
    limit 8`;
  const lostCountSql = `select count(*)::int as total from public.candidates c where ${scopeSql} and ${lostCondition}`;

  const untouchedSql = `
    with latest_activity as (
      select candidate_id, max(created_at) as last_touched_at
      from public.activity_log
      group by candidate_id
    ), interview_candidates as (
      select distinct candidate_id from public.interviews where coalesce(scheduled_at, '') <> '' or coalesce(status, '') <> ''
      union
      select candidate_id from public.candidates where coalesce(interview_reschedule_date, interview_date, '') <> ''
    ), eligible as (
      select c.candidate_id, c.full_name, c.recruiter_name, c.process, c.location,
        coalesce(c.interview_reschedule_date, c.interview_date, '') as interview_reschedule_date,
        coalesce(la.last_touched_at, c.updated_at, c.created_at, '') as last_touched_at
      from public.candidates c
      left join latest_activity la on la.candidate_id = c.candidate_id
      join interview_candidates ic on ic.candidate_id = c.candidate_id
      where ${scopeSql}
        and lower(coalesce(c.status, '')) not in ('non-interested', 'non interested', 'not intrested', 'not interested', 'not responding', 'rejected', 'joined', 'selected')
        and coalesce(c.full_name, '') <> ''
        and coalesce(c.phone, '') <> ''
        and coalesce(c.location, '') <> ''
        and coalesce(c.qualification, '') <> ''
        and coalesce(c.preferred_location, '') <> ''
        and lower(coalesce(c.all_details_sent, '')) <> 'pending'
        and coalesce(la.last_touched_at, c.updated_at, c.created_at, '') <> ''
        and coalesce(la.last_touched_at, c.updated_at, c.created_at, '') < $${baseParams.length + 1}
    )
    select *, count(*) over()::int as total_count
    from eligible
    order by last_touched_at asc
    limit 12`;

  const monitoringSql = leadership ? `
    select u.user_id, u.full_name, u.designation, u.recruiter_code,
      (select count(*)::int from public.candidates c where ${candidateNotDeletedSql('c')} and (lower(coalesce(c.recruiter_name, '')) = lower(coalesce(u.full_name, '')) or lower(coalesce(c.recruiter_code, '')) = lower(coalesce(u.recruiter_code, '')))) as candidate_count,
      (select count(*)::int from public.tasks t where (t.assigned_to_user_id = u.user_id or t.assigned_to_name = u.full_name) and lower(coalesce(t.status, '')) not in ('closed', 'done', 'completed')) as open_tasks
    from public.users u
    order by coalesce(u.full_name, u.username, '') asc
    limit 10` : null;

  const dueTasksSql = `
    select t.* from public.tasks t
    where ${leadership ? '1=1' : `(t.assigned_to_user_id = $1 or lower(coalesce(t.assigned_to_name, '')) = lower($2))`}
    order by coalesce(t.due_date, '') asc
    limit 8`;
  const dueTaskParams = leadership ? [] : [user.user_id || '', user.full_name || ''];

  const [counts, pendingRows, todaySubmissionRows, recentRows, lostRows, lostCountRows, untouchedRows, unreadRows, dueTaskRows, activeWorkersRows, activeManagersRows, monitoringRows] = await Promise.all([
    store.query(countSql, [...baseParams, todayStart, todayEnd]),
    store.query(pendingSql, baseParams),
    store.query(submissionsTodaySql, [...baseParams, todayStart, todayEnd]),
    store.query(recentSql, baseParams),
    store.query(lostSql, [...baseParams, today]),
    store.query(lostCountSql, [...baseParams, today]),
    store.query(untouchedSql, [...baseParams, new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()]),
    store.query(`select notification_id, title, message, created_at from public.notifications where user_id = $1 and lower(coalesce(status, '')) = 'unread' order by created_at desc limit 8`, [user.user_id]),
    store.query(dueTasksSql, dueTaskParams),
    store.query(`select count(*)::int as total from public.presence where coalesce(locked, '0') <> '1'`, []),
    store.query(`select count(*)::int as total from public.users where lower(coalesce(role, '')) in ('admin', 'manager', 'tl')`, []),
    monitoringSql ? store.query(monitoringSql, []) : Promise.resolve([]),
  ]);

  const first = counts[0] || {};
  return {
    ...emptyDashboardPayload(),
    total_profiles: Number(first.total_profiles || 0),
    today_calls: Number(first.today_calls || 0),
    interviews_today: Number(first.interviews_today || 0),
    pending_approvals: Number(pendingRows[0]?.total || 0),
    today_submissions: Number(todaySubmissionRows[0]?.total || 0),
    lost_leads_total: Number(lostCountRows[0]?.total || 0),
    lost_leads_items: sanitizeCandidateListForUser(lostRows, user),
    untouched_profiles_total: Number(untouchedRows[0]?.total_count || 0),
    untouched_profiles: untouchedRows.map((row) => ({
      candidate_id: row.candidate_id,
      full_name: row.full_name,
      recruiter_name: row.recruiter_name || 'Unassigned',
      process: row.process || '-',
      location: row.location || '-',
      interview_reschedule_date: row.interview_reschedule_date || '',
      last_touched_at: row.last_touched_at || '',
    })),
    recent_activity: sanitizeCandidateListForUser(recentRows, user),
    due_tasks: dueTaskRows,
    unread_notes: unreadRows,
    manager_monitoring: leadership ? monitoringRows.map((member) => ({
      user_id: member.user_id,
      full_name: member.full_name,
      designation: member.designation,
      candidate_count: Number(member.candidate_count || 0),
      open_tasks: Number(member.open_tasks || 0),
    })) : [],
    active_workers: Number(activeWorkersRows[0]?.total || 0),
    active_managers: Number(activeManagersRows[0]?.total || 0),
  };
}

async function dashboardDataFallback(user) {
  const users = await table('users');
  const candidates = (await table('candidates')).filter((row) => !candidateIsDeleted(row));
  const interviews = await table('interviews');
  const tasks = await table('tasks');
  const notifications = await table('notifications');
  const presence = await table('presence');
  const submissions = await table('submissions');
  const activityLog = await table('activity_log');
  const today = ymd();
  const nowMs = Date.now();
  const scoped = isLeadershipUser(user)
    ? candidates
    : candidates.filter((c) => String(c.recruiter_name || '').trim().toLowerCase() === String(user.full_name || '').trim().toLowerCase() || recruiterCodeMatches(c.recruiter_code, user.recruiter_code));
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id), row]));
  const scopedCandidateIds = new Set(scoped.map((row) => String(row.candidate_id || '')).filter(Boolean));
  const scopedSubmissions = submissions.filter((s) => scopedCandidateIds.has(String(s.candidate_id || '')));
  const validPendingCount = scopedSubmissions.filter((s) => validPendingSubmission(s, candidatesById.get(String(s.candidate_id)))).length;

  const lostLeads = scoped.filter((c) => {
    const status = lowerText(c.status);
    const approval = lowerText(c.approval_status);
    const looking = lowerText(c.looking_for_job || 'yes');
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
  const interviewsByCandidate = new Set([
    ...interviews.filter((row) => String(row.scheduled_at || row.interview_reschedule_date || '').trim() || String(row.status || '').trim()).map((row) => String(row.candidate_id || '').trim()).filter(Boolean),
    ...candidates.filter((row) => String(row.interview_reschedule_date || row.interview_date || '').trim()).map((row) => String(row.candidate_id || '').trim()).filter(Boolean),
  ]);
  const untouchedAll = scoped
    .filter((candidate) => candidateIsUntouched(candidate, activityByCandidate.get(String(candidate.candidate_id || '')), interviewsByCandidate.has(String(candidate.candidate_id || '')) || String(candidate.interview_reschedule_date || candidate.interview_date || '').trim(), nowMs))
    .sort((a, b) => String(activityByCandidate.get(String(a.candidate_id || '')) || a.updated_at || a.created_at || '').localeCompare(String(activityByCandidate.get(String(b.candidate_id || '')) || b.updated_at || b.created_at || '')));

  return {
    ...emptyDashboardPayload(),
    total_profiles: scoped.length,
    today_calls: scoped.filter((c) => String(c.updated_at || '').startsWith(today)).length,
    interviews_today: scoped.filter((c) => String(c.interview_reschedule_date || c.interview_date || '').startsWith(today)).length,
    pending_approvals: validPendingCount,
    today_submissions: scopedSubmissions.filter((s) => String(s.submitted_at || s.approval_requested_at || s.created_at || '').startsWith(today)).length,
    lost_leads_total: lostLeads.length,
    lost_leads_items: sanitizeCandidateListForUser(lostLeads.slice(0, 8), user),
    untouched_profiles_total: untouchedAll.length,
    untouched_profiles: untouchedAll.slice(0, 12).map((candidate) => ({
      candidate_id: candidate.candidate_id,
      full_name: candidate.full_name,
      recruiter_name: candidate.recruiter_name || 'Unassigned',
      process: candidate.process || '-',
      location: candidate.location || '-',
      interview_reschedule_date: candidate.interview_reschedule_date || candidate.interview_date || '',
      last_touched_at: activityByCandidate.get(String(candidate.candidate_id || '')) || candidate.updated_at || candidate.created_at || '',
    })),
    recent_activity: sanitizeCandidateListForUser(scoped.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 8), user),
    due_tasks: (isLeadershipUser(user) ? tasks : tasks.filter((t) => (t.assigned_to_user_id === user.user_id || String(t.assigned_to_name || '').trim().toLowerCase() === String(user.full_name || '').trim().toLowerCase()))).slice().sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))).slice(0, 8),
    unread_notes: notifications.filter((n) => String(n.user_id) === String(user.user_id) && lowerText(n.status) === 'unread').slice(0, 8),
    manager_monitoring: isLeadershipUser(user) ? users.map((member) => ({
      user_id: member.user_id,
      full_name: member.full_name,
      designation: member.designation,
      candidate_count: candidates.filter((c) => String(c.recruiter_name || '').trim().toLowerCase() === String(member.full_name || '').trim().toLowerCase() || recruiterCodeMatches(c.recruiter_code, member.recruiter_code)).length,
      open_tasks: tasks.filter((t) => (t.assigned_to_user_id === member.user_id || t.assigned_to_name === member.full_name) && !['closed', 'done', 'completed'].includes(lowerText(t.status))).length,
    })).slice(0, 10) : [],
    active_workers: presence.filter((p) => String(p.locked || '0') !== '1').length,
    active_managers: users.filter((u) => ['admin', 'manager', 'tl'].includes(lowerText(u.role))).length,
  };
}

async function dashboardData(user) {
  const cacheKey = dashboardUserKey(user);
  const cached = cacheGet(dashboardCache, cacheKey, 45000);
  if (cached) return cached;
  if (mode === 'postgres' && store.pool) {
    try {
      const optimized = await dashboardDataPostgres(user);
      return cacheSet(dashboardCache, cacheKey, optimized);
    } catch (error) {
      console.warn('Dashboard optimized query fallback:', error?.message || error);
    }
  }
  return cacheSet(dashboardCache, cacheKey, await dashboardDataFallback(user));
}

async function meta(req, res) { return res.json(await uiMeta(req.user)); }
async function dashboard(req, res) { return res.status(410).json({ ok: false, disabled: true, message: 'Dashboard removed from CRM.' }); }
async function lookups(req, res) {
  const users = (await table('users')).map((u) => ({ user_id: u.user_id, username: u.username, full_name: u.full_name, designation: u.designation, role: u.role, recruiter_code: u.recruiter_code }));
  const candidates = sanitizeCandidateListForUser((await table('candidates'))
    .filter((row) => !candidateIsDeleted(row))
    .slice()
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, 120)
    .map((c) => ({ candidate_id: c.candidate_id, full_name: c.full_name, phone: c.phone, process: c.process, recruiter_name: c.recruiter_name })), req.user);
  const jds = (await table('jd_master')).map((j) => ({ jd_id: j.jd_id, job_title: j.job_title, company: j.company, location: j.location }));
  return res.json({ users, candidates, jds, process_options: PROCESS_OPTIONS });
}

module.exports = { meta, dashboard, lookups };
