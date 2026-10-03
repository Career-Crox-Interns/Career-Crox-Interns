const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');
const { createTimedCache } = require('../lib/cache');
const { aggregateCallRows, dedupeCallRows, aggregateBreakRows } = require('../lib/crmMetrics');

const semiHourlyCache = createTimedCache(5 * 60 * 1000);
const WINDOW_MINUTES = 30;

const REPORT_ACTIVE_RETENTION_DAYS = Math.max(1, Number(process.env.CC_SEMI_HOURLY_REPORT_ACTIVE_DAYS || 7) || 7);
const REPORT_ACTIVE_LIMIT_PER_USER = Math.max(10, Number(process.env.CC_SEMI_HOURLY_REPORT_ACTIVE_LIMIT || 100) || 100);

function isArchivedReport(row = {}) {
  return ['archived', 'deleted', '__deleted__'].includes(lower(row.status || row.category || ''));
}

function reportTimeMs(row = {}) {
  return toMs(row.last_run_at || row.created_at || row.updated_at || row.generated_at);
}

function reportArchiveScope(row = {}) {
  return `${lower(row.report_type || '')}:${String(row.user_id || 'system')}`;
}

async function archiveOldSemiHourlySnapshots(reports = []) {
  const now = Date.now();
  const cutoff = now - (REPORT_ACTIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const semiHourly = (reports || [])
    .filter((row) => lower(row.report_type) === 'semi-hourly')
    .filter((row) => !isArchivedReport(row));

  const archiveIds = new Set();

  for (const row of semiHourly) {
    const stamp = reportTimeMs(row);
    if (stamp && stamp < cutoff) archiveIds.add(String(row.report_id));
  }

  const byScope = new Map();
  for (const row of semiHourly) {
    const scope = reportArchiveScope(row);
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope).push(row);
  }

  for (const group of byScope.values()) {
    group.sort((a, b) => reportTimeMs(b) - reportTimeMs(a));
    group.slice(REPORT_ACTIVE_LIMIT_PER_USER).forEach((row) => archiveIds.add(String(row.report_id)));
  }

  let archived_count = 0;
  for (const report_id of archiveIds) {
    if (!report_id || report_id === 'undefined') continue;
    try {
      await store.update('scheduled_reports', 'report_id', report_id, {
        status: 'Archived',
        archived_at: nowIso(),
        archive_reason: `Auto-archived: active retention ${REPORT_ACTIVE_RETENTION_DAYS} days and max ${REPORT_ACTIVE_LIMIT_PER_USER} active 30-minute reports per user.`,
      });
      archived_count += 1;
    } catch {
      try {
        await store.update('scheduled_reports', 'report_id', report_id, { status: 'Archived' });
        archived_count += 1;
      } catch {}
    }
  }
  return archived_count;
}



const TERMINAL_INTERVIEW_STATUSES = new Set([
  'completed', 'done', 'appeared', 'appeared in interview', 'selected', 'rejected',
  'joined', 'cancelled', 'canceled', 'rescheduled', 'not interested', 'not intrested',
]);

const MESSAGE_PRESETS = [
  { key: 'improve', label: 'Improve your performance', text: 'Please improve your performance in the next 30-minute cycle. Focus on calls, submissions, and pending interviews.' },
  { key: 'noticed', label: 'You are being noticed', text: 'Your performance is being noticed. Please stay active and keep your work updated in CRM.' },
  { key: 'warning', label: 'Performance warning', text: 'This is a performance warning. Please increase calling, profile work, and follow-up activity immediately.' },
  { key: 'calls', label: 'Focus on calls', text: 'Please increase dialed and connected calls. Keep call outcomes updated in CRM.' },
  { key: 'submissions', label: 'Focus on submissions', text: 'Please focus on quality submissions and update every profile status properly.' },
  { key: 'interviews', label: 'Follow interviews', text: 'Please call today’s pending and missed interview candidates and update or reschedule them.' },
];

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function roleOf(user = {}) {
  const raw = lower(user.role || user.user_role || user.access_role || user.designation);
  if (raw.includes('manager') || raw === 'admin') return raw === 'admin' ? 'admin' : 'manager';
  if (raw === 'tl' || raw.includes('team lead')) return 'tl';
  if (raw.includes('recruiter') || raw.includes('re ')) return 'recruiter';
  return raw;
}

function isManager(user) {
  return ['admin', 'manager'].includes(roleOf(user));
}

function isTl(user) {
  return roleOf(user) === 'tl';
}

function isRecruiter(user) {
  return roleOf(user) === 'recruiter';
}

function isReportRole(user) {
  return ['admin', 'manager', 'tl', 'recruiter'].includes(roleOf(user));
}

function userId(user = {}) {
  return String(user.user_id || user.id || '').trim();
}

function userCode(user = {}) {
  return String(user.recruiter_code || user.employee_code || user.code || '').trim();
}

function userName(user = {}) {
  return String(user.full_name || user.name || user.username || user.user_id || '').trim();
}

function isManagedReportUser(user = {}) {
  return ['tl', 'recruiter'].includes(roleOf(user));
}

function toMs(value) {
  const stamp = new Date(value || 0).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function safeJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function semiCandidateIsDeleted(row = {}) {
  const status = lower(row.status || row.candidate_status || '');
  const approval = lower(row.approval_status || '');
  const details = lower(row.all_details_sent || '');
  const notes = lower(row.data_notes || '');
  return Boolean(String(row.deleted_at || '').trim())
    || ['deleted', '__deleted__', 'archived'].includes(status)
    || ['deleted', '__deleted__', 'archived'].includes(approval)
    || ['deleted', 'archived'].includes(details)
    || notes.includes('[crm-deleted]');
}

function isSameTl(recruiter = {}, tl = {}) {
  const possibleId = String(recruiter.tl_user_id || recruiter.team_lead_user_id || recruiter.reporting_tl_user_id || recruiter.reports_to_user_id || recruiter.reporting_manager_user_id || '').trim();
  const possibleCode = String(recruiter.tl_code || recruiter.team_lead_code || recruiter.reporting_tl_code || recruiter.reports_to_code || recruiter.reporting_manager_code || '').trim();
  const possibleName = String(recruiter.tl_name || recruiter.team_lead_name || recruiter.reporting_tl_name || recruiter.reports_to_name || recruiter.reporting_manager_name || '').trim();
  const tlId = userId(tl);
  const tlCode = userCode(tl);
  const tlName = userName(tl);
  return (possibleId && tlId && possibleId === tlId)
    || (possibleCode && tlCode && lower(possibleCode) === lower(tlCode))
    || (possibleName && tlName && lower(possibleName) === lower(tlName));
}

function visibleUsersForViewer(viewer = {}, users = []) {
  const active = (Array.isArray(users) ? users : []).filter((u) => String(u.status || u.user_status || 'active').toLowerCase() !== 'deleted');
  if (isManager(viewer)) return active.filter(isReportRole);
  if (isTl(viewer)) return active.filter((u) => userId(u) === userId(viewer) || (roleOf(u) === 'recruiter' && isSameTl(u, viewer)));
  if (isRecruiter(viewer)) return active.filter((u) => userId(u) === userId(viewer));
  return [];
}

function canViewTarget(viewer, target, users) {
  return visibleUsersForViewer(viewer, users).some((u) => userId(u) === userId(target));
}

function floorToHalfHour(date) {
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() >= 30 ? 30 : 0);
  return next;
}

function startOfDay(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00+05:30`);
}

function windowBounds(req) {
  const now = new Date();
  const mode = lower(req.query?.window || req.query?.range || 'current');
  const dayStart = startOfDay(now);
  if (mode === 'day' || mode === 'all-day' || mode === 'all_day') {
    return { mode: 'day', start: dayStart, end: now, label: 'All Day Report' };
  }
  if (mode === 'previous' || mode === 'prev') {
    const end = floorToHalfHour(now);
    const start = new Date(end.getTime() - WINDOW_MINUTES * 60 * 1000);
    return { mode: 'previous', start, end, label: 'Previous 30 Minutes Report' };
  }
  const end = now;
  const start = new Date(end.getTime() - WINDOW_MINUTES * 60 * 1000);
  return { mode: 'current', start, end, label: 'Current 30 Minutes Report' };
}

function periodKeyFor(bounds) {
  return `${bounds.mode}:${floorToHalfHour(bounds.end).toISOString().slice(0, 16)}`;
}

function formatWindowLabel(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '30 Minutes Report';
  return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function inRange(stamp, startMs, endMs) {
  const t = toMs(stamp);
  return Boolean(t) && t >= startMs && t <= endMs;
}

function dateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function interviewStamp(row = {}) {
  return String(row.interview_reschedule_date || row.interview_date || row.scheduled_at || row.created_at || row.updated_at || '');
}

function submissionStamp(row = {}, candidate = null) {
  return String(row.submission_origin_at || row.submitted_at || row.approval_requested_at || candidate?.submission_date || row.created_at || row.updated_at || '');
}

function buildSubmissionIdentity(row, candidate = null) {
  const phone = normalizePhone(candidate?.phone || row?.phone || '');
  if (phone.length >= 10) return `phone:${phone.slice(-10)}`;
  const candidateId = String(row?.candidate_id || candidate?.candidate_id || '').trim().toLowerCase();
  if (candidateId) return `candidate:${candidateId}`;
  const fullName = lower(candidate?.full_name || row?.candidate_name || '');
  if (fullName) return `name:${fullName}`;
  return String(row?.submission_id || '').trim().toLowerCase();
}

function buildActorMaps(users = []) {
  return {
    byId: new Map(users.map((row) => [userId(row), row])),
    byName: new Map(users.map((row) => [lower(userName(row)), row])),
    byUsername: new Map(users.map((row) => [lower(row.username || ''), row])),
    byCode: new Map(users.map((row) => [lower(userCode(row)), row])),
  };
}

function submitterFor(row, candidate, maps) {
  const explicitName = row?.submitted_by_name || '';
  const byId = maps.byId.get(String(row?.submitted_by_user_id || '')) || {};
  const byName = maps.byName.get(lower(explicitName || candidate?.submitted_by || candidate?.recruiter_name || '')) || {};
  const byCode = maps.byCode.get(lower(row?.submitted_by_recruiter_code || row?.recruiter_code || candidate?.recruiter_code || '')) || {};
  return byId.user_id ? byId : (byName.user_id ? byName : byCode);
}

function userForCandidate(row, maps) {
  return maps.byId.get(String(row?.user_id || row?.assigned_user_id || row?.owner_user_id || row?.recruiter_user_id || ''))
    || maps.byCode.get(lower(row?.recruiter_code || row?.assigned_recruiter_code || ''))
    || maps.byName.get(lower(row?.recruiter_name || row?.assigned_recruiter_name || ''))
    || {};
}

function callStamp(row = {}) {
  return String(row.call_started_at || row.call_ended_at || row.created_at || '');
}

function activityStamp(row = {}) {
  return String(row.created_at || row.updated_at || '');
}

function currentSessionMinutes(presenceRow, startMs, endMs) {
  const started = toMs(presenceRow?.work_started_at);
  if (!started) return 0;
  const effectiveStart = Math.max(started, startMs);
  const effectiveEnd = Math.max(effectiveStart, endMs);
  return Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60000));
}

function activeWorkMinutes(presenceRow, startMs, endMs, breakMinutes = 0) {
  const session = currentSessionMinutes(presenceRow, startMs, endMs);
  const available = Math.max(0, session - Math.max(0, Number(breakMinutes || 0) || 0));
  const hasSaved = Object.prototype.hasOwnProperty.call(presenceRow || {}, 'total_work_minutes') && String(presenceRow.total_work_minutes ?? '').trim() !== '';
  const saved = Math.max(0, Number(presenceRow?.total_work_minutes || 0) || 0);
  // Never turn a real 0 active-work value into a fully-active window.
  // For a session that started inside this window, saved work is exact enough to cap here.
  if (hasSaved && toMs(presenceRow?.work_started_at) >= startMs) return Math.min(available, saved);
  // For an already-running session we cannot safely assign cumulative saved work to this 30m slice.
  // Meaningful activity below determines the window; default to 0 instead of inventing active time.
  return 0;
}

function breakStatsForWindow(actions = [], presence = {}, startMs = 0, endMs = Date.now()) {
  const events = (actions || [])
    .filter((row) => ['break_started','break_ended','break_exceeded','break_exceeded_lock'].includes(lower(row.action_type)))
    .sort((a,b) => toMs(activityStamp(a)) - toMs(activityStamp(b)));
  let open = null;
  const intervals = [];
  const close = (endEvent) => {
    if (!open) return;
    const actualStart = toMs(activityStamp(open));
    const actualEnd = endEvent ? toMs(activityStamp(endEvent)) : Math.min(Date.now(), endMs);
    if (actualStart && actualEnd >= actualStart) intervals.push([actualStart, actualEnd]);
    open = null;
  };
  for (const event of events) {
    const type = lower(event.action_type);
    if (type === 'break_started') open = event;
    else close(event);
  }
  if (open) close(null);

  if (String(presence.is_on_break || '0') === '1' && presence.break_started_at) {
    const ps = toMs(presence.break_started_at);
    if (ps && !intervals.some(([a,b]) => Math.abs(a - ps) < 60000 || (ps >= a && ps <= b))) {
      intervals.push([ps, Math.min(Date.now(), endMs)]);
    }
  }

  let minutes = 0;
  let count = 0;
  for (const [a,b] of intervals) {
    const from = Math.max(a, startMs);
    const to = Math.min(b, endMs);
    if (to < from) continue;
    count += 1;
    minutes += Math.max(0, Math.round((to - from) / 60000));
  }
  return { minutes, count };
}

function isLockAction(action) {
  return ['crm_locked', 'no_call_lock', 'break_exceeded_lock', 'break_exceeded'].includes(lower(action));
}

function isMeaningfulAction(action) {
  return [
    'profile_opened', 'profile_updated', 'candidate_updated', 'call_logged', 'whatsapp_opened',
    'submission_created', 'submission_updated', 'interview_updated', 'followup_updated',
    'task_completed', 'task_updated', 'break_started', 'break_ended',
  ].includes(lower(action));
}

function terminalInterview(row = {}) {
  const status = lower(row.status || row.interview_status || row.all_details_sent || '');
  return TERMINAL_INTERVIEW_STATUSES.has(status);
}

function scoreFor(metrics) {
  const ratioBoost = Math.min(25, Number(metrics.activity_ratio || 0) * 0.25);
  const score = (metrics.submissions * 10)
    + (metrics.connected_calls * 4)
    + (metrics.dialed_calls * 1.5)
    + (metrics.talk_time_minutes * 0.25)
    + (metrics.profiles_worked * 1.25)
    + ratioBoost
    - (metrics.idle_minutes * 0.7)
    - (metrics.crm_locks * 8)
    - (metrics.missed_interviews * 5)
    - (metrics.break_minutes * 0.08);
  return Number(score.toFixed(1));
}

function toneForScore(score) {
  if (score >= 28) return 'green';
  if (score <= 8) return 'red';
  return 'amber';
}

async function loadData(dayStartIso, nowIsoValue, preloadedUsers = null) {
  if (store.pool) {
    const todayKey = dateKey(new Date(nowIsoValue));
    return Promise.all([
      preloadedUsers || store.query(`select * from public.users`),
      store.query(`select * from public.activity_log where created_at >= $1 order by created_at desc`, [dayStartIso]),
      store.query(`select * from public.submissions where coalesce(submitted_at::text, approval_requested_at::text, updated_at::text, created_at::text, '') >= $1 order by coalesce(submitted_at::text, approval_requested_at::text, updated_at::text, created_at::text, '') desc`, [dayStartIso]),
      store.query(`select jsonb_build_object(
          'candidate_id', to_jsonb(c)->>'candidate_id',
          'phone', to_jsonb(c)->>'phone',
          'number', to_jsonb(c)->>'number',
          'mobile', to_jsonb(c)->>'mobile',
          'candidate_phone', to_jsonb(c)->>'candidate_phone',
          'status', to_jsonb(c)->>'status',
          'candidate_status', to_jsonb(c)->>'candidate_status',
          'approval_status', to_jsonb(c)->>'approval_status',
          'all_details_sent', to_jsonb(c)->>'all_details_sent',
          'deleted_at', to_jsonb(c)->>'deleted_at',
          'recruiter_code', to_jsonb(c)->>'recruiter_code',
          'recruiter_name', to_jsonb(c)->>'recruiter_name',
          'submitted_by', to_jsonb(c)->>'submitted_by',
          'submission_date', to_jsonb(c)->>'submission_date',
          'full_name', to_jsonb(c)->>'full_name',
          'data_notes', CASE WHEN strpos(coalesce(to_jsonb(c)->>'data_notes', ''), '[crm-deleted]') > 0 THEN '[crm-deleted]' ELSE '' END
        ) as candidate from public.candidates c`).then((rows) => rows.map((row) => row.candidate)),
      store.query(`select * from public.presence`),
      store.query(`select * from public.call_logs where coalesce(call_started_at::text, created_at::text, '') >= $1 order by coalesce(call_started_at::text, created_at::text, '') desc`, [dayStartIso]),
      // CC26_366: do not reference optional interview_reschedule_date/interview_date columns directly in SQL.
      // Some Supabase projects do not have those columns, so load rows safely and let JS interviewStamp() handle fallbacks.
      store.query(`select * from public.interviews`),
      // break_sessions already exists in supported schema. Keep this optional so an older database cannot block the report.
      store.query(`select * from public.break_sessions where started_at <= $2 and coalesce(ended_at, $2::timestamptz) >= $1 order by started_at desc`, [dayStartIso, nowIsoValue]).catch(() => []),
    ]);
  }
  return Promise.all([
    preloadedUsers || table('users'),
    table('activity_log'),
    table('submissions'),
    table('candidates'),
    table('presence'),
    table('call_logs'),
    table('interviews'),
    table('break_sessions').catch(() => []),
  ]);
}

function groupRowsByUser(rows, getUserId) {
  const out = new Map();
  for (const row of rows || []) {
    const id = String(getUserId(row) || '').trim();
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(row);
  }
  return out;
}

function buildRowsForScope({ viewer, users, activityRows, submissions, candidates, presenceRows, callRows, interviewRows, breakRows, bounds }) {
  const maps = buildActorMaps(users);
  const visibleUsers = visibleUsersForViewer(viewer, users);
  const visibleIds = new Set(visibleUsers.map(userId));
  const activeCandidates = (candidates || []).filter((row) => !semiCandidateIsDeleted(row));
  const candidatesById = new Map(activeCandidates.map((row) => [String(row.candidate_id || '').trim(), row]).filter(([id]) => id));
  const candidatePhones = new Set(activeCandidates.map((row) => normalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '').slice(-10)).filter(Boolean));
  const presenceByUserId = new Map((presenceRows || []).map((row) => [String(row.user_id), row]));
  const dayStartMs = startOfDay(bounds.end).getTime();
  const nowMs = bounds.end.getTime();
  const windowStartMs = bounds.start.getTime();
  const effectiveStartMs = bounds.mode === 'day' ? dayStartMs : windowStartMs;
  const effectiveEndMs = nowMs;

  const activityByUserId = groupRowsByUser((activityRows || []).filter((row) => visibleIds.has(String(row.user_id || ''))), (row) => row.user_id);

  const callRowsByUserId = new Map();
  for (const row of dedupeCallRows(callRows || [])) {
    const candidateId = String(row.candidate_id || row.current_candidate_id || '').trim();
    const candidatePhone = normalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '').slice(-10);
    if (!((candidateId && candidatesById.has(candidateId)) || (candidatePhone && candidatePhones.has(candidatePhone)))) continue;
    const matchedUser = maps.byId.get(String(row.employee_user_id || row.user_id || row.owner_user_id || ''))
      || maps.byUsername.get(lower(row.employee_username || row.username || ''))
      || maps.byName.get(lower(row.employee_name || row.recruiter_name || ''))
      || maps.byCode.get(lower(row.recruiter_code || row.employee_code || ''));
    const id = userId(matchedUser);
    if (!id || !visibleIds.has(id)) continue;
    if (!callRowsByUserId.has(id)) callRowsByUserId.set(id, []);
    callRowsByUserId.get(id).push(row);
  }

  const breakRowsByUserId = new Map();
  for (const row of breakRows || []) {
    const matchedUser = maps.byId.get(String(row.user_id || row.employee_user_id || ''))
      || maps.byUsername.get(lower(row.username || row.employee_username || ''))
      || maps.byName.get(lower(row.full_name || row.employee_name || ''))
      || maps.byCode.get(lower(row.recruiter_code || row.employee_code || ''));
    const id = userId(matchedUser);
    if (!id || !visibleIds.has(id)) continue;
    if (!breakRowsByUserId.has(id)) breakRowsByUserId.set(id, []);
    breakRowsByUserId.get(id).push(row);
  }

  const dedupedSubmissions = new Map();
  for (const row of submissions || []) {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    const actor = submitterFor(row, candidate, maps);
    const id = userId(actor);
    if (!id || !visibleIds.has(id)) continue;
    const stamp = submissionStamp(row, candidate);
    const identity = `${id}|${buildSubmissionIdentity(row, candidate)}`;
    const item = { ...row, actor_user_id: id, stamp };
    const current = dedupedSubmissions.get(identity);
    if (!current || toMs(item.stamp) >= toMs(current.stamp)) dedupedSubmissions.set(identity, item);
  }
  const submissionsByUserId = groupRowsByUser(Array.from(dedupedSubmissions.values()), (row) => row.actor_user_id);

  const interviewsByUserId = new Map();
  for (const row of interviewRows || []) {
    const user = userForCandidate(row, maps);
    const id = userId(user);
    if (!id || !visibleIds.has(id)) continue;
    if (!interviewsByUserId.has(id)) interviewsByUserId.set(id, []);
    interviewsByUserId.get(id).push(row);
  }

  return visibleUsers.map((user) => {
    const id = userId(user);
    const presence = presenceByUserId.get(id) || {};
    const actions = activityByUserId.get(id) || [];
    const calls = callRowsByUserId.get(id) || [];
    const subs = submissionsByUserId.get(id) || [];
    const interviews = interviewsByUserId.get(id) || [];

    const actionsInWindow = actions.filter((row) => inRange(activityStamp(row), effectiveStartMs, effectiveEndMs));
    const meaningfulWindow = actionsInWindow.filter((row) => isMeaningfulAction(row.action_type));
    const locksWindow = actionsInWindow.filter((row) => isLockAction(row.action_type));
    const breaksWindow = actionsInWindow.filter((row) => ['break_started', 'break_ended', 'break_exceeded', 'break_exceeded_lock'].includes(lower(row.action_type)));
    const callsWindow = dedupeCallRows(calls.filter((row) => inRange(callStamp(row), effectiveStartMs, effectiveEndMs)));
    const submissionsWindow = subs.filter((row) => inRange(row.stamp, effectiveStartMs, effectiveEndMs));

    const latestAction = Math.max(
      ...actions.map((row) => toMs(activityStamp(row))).filter(Boolean),
      toMs(presence.last_activity_at),
      toMs(presence.last_seen_at),
      toMs(presence.last_call_dial_at),
      toMs(presence.work_started_at),
      0,
    );
    const officeMinutes = currentSessionMinutes(presence, effectiveStartMs, effectiveEndMs);
    const exactBreakRows = breakRowsByUserId.get(id) || [];
    const exactBreakStats = aggregateBreakRows(exactBreakRows, effectiveStartMs, effectiveEndMs, effectiveEndMs);
    const fallbackBreakStats = breakStatsForWindow(actions, presence, effectiveStartMs, effectiveEndMs);
    const breakStats = exactBreakRows.length
      ? { minutes: Number(exactBreakStats.total_break_minutes || 0), count: Number(exactBreakStats.break_count || 0) }
      : fallbackBreakStats;
    const breakMinutes = Math.max(0, Number(breakStats.minutes || 0));
    const activeMinutes = activeWorkMinutes(presence, effectiveStartMs, effectiveEndMs, breakMinutes);
    const liveIdle = latestAction ? Math.max(0, Math.round((Math.min(Date.now(), effectiveEndMs) - latestAction) / 60000)) : officeMinutes;
    const residualIdle = Math.max(0, officeMinutes - Math.min(activeMinutes, officeMinutes) - Math.min(breakMinutes, officeMinutes));
    // Idle can never exceed office time and must not be counted twice.
    const idleMinutes = Math.max(0, Math.min(officeMinutes, Math.max(residualIdle, liveIdle > 2 ? Math.min(liveIdle, officeMinutes) : 0)));
    const callMetrics = aggregateCallRows(callsWindow);
    const talkSeconds = Number(callMetrics.talktime_seconds || 0);
    const connected = Number(callMetrics.connected_calls_count || 0);
    const pendingInterviews = interviews.filter((row) => {
      const stamp = interviewStamp(row);
      if (dateKey(stamp) !== dateKey(bounds.end)) return false;
      return !terminalInterview(row) && toMs(stamp) >= effectiveEndMs;
    }).length;
    const missedInterviews = interviews.filter((row) => {
      const stamp = interviewStamp(row);
      if (dateKey(stamp) !== dateKey(bounds.end)) return false;
      return !terminalInterview(row) && toMs(stamp) < effectiveEndMs;
    }).length;
    const profilesWorked = new Set(meaningfulWindow.map((row) => String(row.candidate_id || '').trim()).filter(Boolean)).size;
    const activityRatio = officeMinutes ? Math.round((Math.max(0, officeMinutes - idleMinutes - breakMinutes) / officeMinutes) * 100) : 0;

    const metrics = {
      idle_minutes: Math.max(0, Math.round(idleMinutes)),
      submissions: submissionsWindow.length,
      dialed_calls: Number(callMetrics.outgoing_calls_count || 0),
      connected_calls: connected,
      incoming_calls: Number(callMetrics.incoming_calls_count || 0),
      missed_calls: Number(callMetrics.missed_calls_count || 0),
      talk_time_minutes: Math.round(talkSeconds / 60),
      activity_ratio: Math.max(0, Math.min(100, activityRatio)),
      break_count: Number(breakStats.count || 0),
      break_minutes: Math.max(0, Math.round(breakMinutes)),
      crm_locks: locksWindow.length,
      pending_interviews: pendingInterviews,
      missed_interviews: missedInterviews,
      office_minutes: officeMinutes,
      active_work_minutes: Math.max(0, Math.min(officeMinutes, activeMinutes)),
      profiles_worked: profilesWorked,
      meaningful_actions: meaningfulWindow.length,
    };
    const score = scoreFor(metrics);
    return {
      user_id: id,
      username: user.username || '',
      full_name: userName(user),
      recruiter_code: userCode(user),
      role: roleOf(user),
      last_activity_at: latestAction ? new Date(latestAction).toISOString() : '',
      active_break: String(presence.is_on_break || '0') === '1',
      performance_score: score,
      tone: toneForScore(score),
      can_message: isManager(viewer) || (isTl(viewer) && id !== userId(viewer)),
      metrics,
    };
  }).sort((a, b) => {
    if (Number(b.performance_score || 0) !== Number(a.performance_score || 0)) return Number(b.performance_score || 0) - Number(a.performance_score || 0);
    return String(a.full_name || '').localeCompare(String(b.full_name || ''));
  });
}

async function saveSnapshot(payload, user, options = {}) {
  const reports = options.reports || await table('scheduled_reports');
  const archived_count = options.skipArchive ? 0 : await archiveOldSemiHourlySnapshots(reports);
  const periodKey = String(payload.period_key || '').trim();
  const roleKey = roleOf(user);
  const scopeKey = `${roleKey}:${userId(user) || 'system'}`;
  const existing = reports.find((row) => lower(row.report_type) === 'semi-hourly' && String(row.period_key || '') === `${scopeKey}:${periodKey}`);
  const now = nowIso();
  const row = {
    user_id: userId(user) || 'system',
    title: `${payload.scope_label || 'Performance'} • ${payload.window_label || formatWindowLabel(payload.window_end || payload.generated_at)}`,
    report_type: 'semi-hourly',
    filters_json: JSON.stringify({ period_key: payload.period_key, window_start: payload.window_start, window_end: payload.window_end, scope: payload.scope, archived_count }),
    file_format: 'live',
    frequency_minutes: '30',
    status: 'saved',
    next_run_at: '',
    last_run_at: payload.generated_at || now,
    last_file_name: '',
    period_key: `${scopeKey}:${periodKey}`,
    snapshot_json: JSON.stringify(payload),
    created_at: existing?.created_at || now,
  };
  if (existing?.report_id) {
    // Automatic snapshots for a completed window are immutable: no re-writing the
    // same JSON snapshot, no repeated DB writes or loss of old report history.
    if (options.automatic) return existing;
    return store.update('scheduled_reports', 'report_id', existing.report_id, row);
  }
  return store.insert('scheduled_reports', { report_id: nextId('SHR', reports, 'report_id'), ...row });
}

async function buildReport(req, sharedData = null) {
  const bounds = windowBounds(req);
  const dayStart = startOfDay(bounds.end);
  const [users, activityRows, submissions, candidates, presenceRows, callRows, interviewRows, breakRows] = sharedData || await loadData(dayStart.toISOString(), bounds.end.toISOString());
  const rows = buildRowsForScope({ viewer: req.user, users, activityRows, submissions, candidates, presenceRows, callRows, interviewRows, breakRows, bounds });
  const summary = rows.reduce((acc, row) => {
    acc.people += 1;
    acc.idle_minutes += Number(row.metrics.idle_minutes || 0);
    acc.submissions += Number(row.metrics.submissions || 0);
    acc.dialed_calls += Number(row.metrics.dialed_calls || 0);
    acc.connected_calls += Number(row.metrics.connected_calls || 0);
    acc.incoming_calls += Number(row.metrics.incoming_calls || 0);
    acc.missed_calls += Number(row.metrics.missed_calls || 0);
    acc.talk_time_minutes += Number(row.metrics.talk_time_minutes || 0);
    acc.break_count += Number(row.metrics.break_count || 0);
    acc.break_minutes += Number(row.metrics.break_minutes || 0);
    acc.crm_locks += Number(row.metrics.crm_locks || 0);
    acc.pending_interviews += Number(row.metrics.pending_interviews || 0);
    acc.missed_interviews += Number(row.metrics.missed_interviews || 0);
    acc.active_work_minutes += Number(row.metrics.active_work_minutes || 0);
    acc.office_minutes += Number(row.metrics.office_minutes || 0);
    return acc;
  }, { people: 0, idle_minutes: 0, submissions: 0, dialed_calls: 0, connected_calls: 0, incoming_calls: 0, missed_calls: 0, talk_time_minutes: 0, break_count: 0, break_minutes: 0, crm_locks: 0, pending_interviews: 0, missed_interviews: 0, active_work_minutes: 0, office_minutes: 0 });
  summary.activity_ratio = summary.office_minutes ? Math.round((summary.active_work_minutes / summary.office_minutes) * 100) : 0;
  return {
    generated_at: nowIso(),
    period_key: periodKeyFor(bounds),
    window_start: bounds.start.toISOString(),
    window_end: bounds.end.toISOString(),
    window_label: bounds.label,
    scope: roleOf(req.user),
    scope_label: isManager(req.user) ? 'Manager: TL + Recruiter Performance' : isTl(req.user) ? 'TL: Self + Team Performance' : 'Recruiter: My Performance',
    summary,
    presets: MESSAGE_PRESETS,
    rows,
  };
}

async function overview(req, res) {
  if (!isReportRole(req.user)) return res.status(403).json({ message: 'Performance report access denied.' });

  const requestedId = String(req.query?.report_id || req.query?.reportId || '').trim();
  if (requestedId) {
    const reports = await table('scheduled_reports');
    const match = reports.find((row) => String(row.report_id) === requestedId && lower(row.report_type) === 'semi-hourly');
    const systemAriaReport = String(match?.user_id || '').toUpperCase() === 'ARIA';
    if (!match || (String(match.user_id || '') && String(match.user_id || '') !== userId(req.user) && !isManager(req.user) && !(systemAriaReport && isReportRole(req.user)))) {
      return res.status(404).json({ message: 'Saved performance report not found.' });
    }
    const snapshot = safeJson(match.snapshot_json);
    return res.json({ ...snapshot, saved_report_id: match.report_id, saved_title: match.title || '30 Minutes Report', saved_at: match.last_run_at || match.created_at || '', is_saved_snapshot: true });
  }

  const generateMode = String(req.query?.generate || '') === '1' || String(req.query?.auto || '') === '1';
  if (!generateMode) {
    return res.json({
      manual_required: true,
      generated_at: '',
      period_key: '',
      summary: {},
      rows: [],
      presets: MESSAGE_PRESETS,
      message: 'Report is egress-safe. Use generate=1 to build a scoped snapshot only when needed.',
    });
  }

  const bounds = windowBounds(req);
  const cacheKey = `${userId(req.user)}:${roleOf(req.user)}:${periodKeyFor(bounds)}`;
  const cached = semiHourlyCache.get(cacheKey, 300000);
  if (cached) return res.json(cached);

  const payload = await buildReport(req);
  const saved = await saveSnapshot(payload, req.user || null);
  const enriched = {
    ...payload,
    saved_report_id: saved?.report_id || '',
    saved_title: saved?.title || payload.window_label || '30 Minutes Report',
    saved_at: saved?.last_run_at || saved?.created_at || payload.generated_at,
    is_saved_snapshot: false,
  };
  semiHourlyCache.set(cacheKey, enriched);
  return res.json(enriched);
}

async function sendMessage(req, res) {
  if (!isManager(req.user) && !isTl(req.user)) return res.status(403).json({ message: 'Only Manager/TL can send performance messages.' });
  const targetId = String(req.body?.target_user_id || '').trim();
  const presetKey = lower(req.body?.preset_key || 'improve');
  const custom = String(req.body?.message || '').trim();
  const users = await table('users');
  const target = users.find((u) => userId(u) === targetId);
  if (!target || !canViewTarget(req.user, target, users)) return res.status(404).json({ message: 'Employee not in your visible scope.' });
  const preset = MESSAGE_PRESETS.find((item) => item.key === presetKey) || MESSAGE_PRESETS[0];
  const message = custom || preset.text;
  const notifications = await table('notifications');
  const item = {
    notification_id: nextId('N', notifications, 'notification_id'),
    user_id: targetId,
    title: preset.label || 'Performance Message',
    message,
    category: 'performance',
    status: 'Unread',
    metadata: JSON.stringify({
      sender_user_id: userId(req.user),
      sender_name: userName(req.user),
      preset_key: preset.key,
      source: 'semi_hourly_performance_report',
      open_path: '/semi-hourly-report',
    }),
    created_at: nowIso(),
  };
  await store.insert('notifications', item);
  try {
    const logs = await table('activity_log');
    await store.insert('activity_log', {
      activity_id: nextId('A', logs, 'activity_id'),
      user_id: userId(req.user),
      username: req.user.username || '',
      action_type: 'performance_message_sent',
      candidate_id: '',
      metadata: JSON.stringify({ target_user_id: targetId, target_name: userName(target), preset_key: preset.key }),
      created_at: nowIso(),
    });
  } catch {}
  return res.json({ ok: true, item });
}

// A single completed period is shared between all managers and the ARIA feed.
// A saved ARIA snapshot also acts as the durable checkpoint after a restart;
// if message publication previously failed, reuse that same snapshot.
const ARIA_SYSTEM_USER = { user_id: 'ARIA', username: 'aria', full_name: 'ARIA', role: 'manager', designation: '30-Minute Report Assistant', recruiter_code: 'ARIA', is_active: 'true' };
// CC26_620: scheduled ARIA reports only during the India office shift.
// The 09:00-09:30 window is published at 09:30 IST, then every 30 minutes;
// the final 20:30-21:00 window publishes at about 21:00 IST (12s settle grace).
// India has a fixed UTC+05:30 offset. These calculations make ZERO DB calls.
const ARIA_IST_OFFSET_MS = 330 * 60 * 1000;
const ARIA_SLOT_MS = 30 * 60 * 1000;
const ARIA_SETTLE_MS = 12000;
const ARIA_LATE_GRACE_MS = 45000; // do not wake and publish old/night reports
// CC26_622: mutable, manager-controlled IST schedule (in RAM; persisted in existing settings rows).
let ariaShiftStart = 9 * 60, ariaShiftEnd = 21 * 60;
function setAriaShiftTimes(start = '09:00', end = '21:00') {
  const minutes = v => { const m=/^(\d{2}):(00|30)$/.exec(String(v || '')); return m && +m[1]<24 ? +m[1]*60 + +m[2] : NaN; };
  const a=minutes(start), b=minutes(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b-a < 30 || a>=b) throw new Error('Invalid IST ARIA reporting schedule.');
  ariaShiftStart=a; ariaShiftEnd=b;
  global.__CC622_RESCHEDULE_ARIA__?.();
  return { start: String(start), end: String(end) };
}
function ariaShiftSettings(){return { start: `${String(Math.floor(ariaShiftStart/60)).padStart(2,'0')}:${String(ariaShiftStart%60).padStart(2,'0')}`, end: `${String(Math.floor(ariaShiftEnd/60)).padStart(2,'0')}:${String(ariaShiftEnd%60).padStart(2,'0')}`};}
async function loadPersistedAriaShift() {
  // Exactly ONE narrow read on server startup, no periodic settings/table scan overnight.
  try {
    const { store, mode } = require('../lib/store');
    if (mode !== 'postgres' || !store?.query) return ariaShiftSettings();
    const found = await store.query('select setting_key,setting_value from public.settings where setting_key in ($1,$2) limit 2', ['aria_report_start_time','aria_report_end_time']);
    const cfg = Object.fromEntries((found || []).map(row => [row.setting_key, row.setting_value]));
    if (cfg.aria_report_start_time && cfg.aria_report_end_time) setAriaShiftTimes(cfg.aria_report_start_time,cfg.aria_report_end_time);
  } catch (error) { console.warn('ARIA schedule uses default until admin refresh:', error.message); }
  return ariaShiftSettings();
}
function ariaShiftSlot(nowMs = Date.now()) {
  const ms = Number(nowMs);
  if (!Number.isFinite(ms)) return null;
  const endMs = Math.floor((ms - ARIA_SETTLE_MS) / ARIA_SLOT_MS) * ARIA_SLOT_MS;
  if (ms - endMs - ARIA_SETTLE_MS > ARIA_LATE_GRACE_MS) return null;
  const ist = new Date(endMs + ARIA_IST_OFFSET_MS);
  const minuteOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (minuteOfDay < ariaShiftStart + 30 || minuteOfDay > ariaShiftEnd) return null;
  return { endMs, period: 'previous:' + new Date(endMs).toISOString().slice(0,16) };
}
function ariaShiftNextDelay(nowMs = Date.now()) {
  const ms = Number(nowMs);
  let endMs = (Math.floor(ms / ARIA_SLOT_MS) + 1) * ARIA_SLOT_MS;
  for (let i = 0; i < 51; i++, endMs += ARIA_SLOT_MS) {
    const ist = new Date(endMs + ARIA_IST_OFFSET_MS);
    const minuteOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    if (minuteOfDay >= ariaShiftStart + 30 && minuteOfDay <= ariaShiftEnd)
      return Math.max(1000, endMs + ARIA_SETTLE_MS - ms);
  }
  throw new Error('Unable to find next ARIA office-shift slot');
}
let automaticReportInFlight = null;

function automaticPeriodKey(now = new Date()) {
  const end = floorToHalfHour(now);
  return `previous:${end.toISOString().slice(0, 16)}`;
}

async function runAriaTeamSnapshot(shared = {}) {
  const period = automaticPeriodKey();
  const reports = shared.reports || await table('scheduled_reports');
  const savedExisting = reports.find((row) => lower(row.report_type) === 'semi-hourly'
    && String(row.period_key || '') === `manager:ARIA:${period}`);
  let saved = savedExisting;
  let payload;
  if (savedExisting?.snapshot_json) {
    payload = safeJson(savedExisting.snapshot_json);
  } else {
    const req = { user: ARIA_SYSTEM_USER, query: { window: 'previous', auto: '1' } };
    const raw = shared.data || await loadData(startOfDay(floorToHalfHour(new Date())).toISOString(), floorToHalfHour(new Date()).toISOString());
    payload = await buildReport(req, raw);
    payload.scope = 'aria';
    payload.scope_label = 'ARIA • Full Team Performance';
    saved = await saveSnapshot(payload, ARIA_SYSTEM_USER, { reports, skipArchive: true, automatic: true });
    if (saved?.report_id && !reports.some((row) => String(row.report_id) === String(saved.report_id))) reports.push(saved);
  }
  const reportId = String(saved?.report_id || '').trim();
  if (!reportId) throw new Error('ARIA snapshot was not saved; chat message was not published.');
  const { publishAriaReportMessage } = require('./chatController');
  const message = await publishAriaReportMessage({ ...payload, report_id: reportId, saved_report_id: reportId });
  if (!message?.id) throw new Error('ARIA report chat publication did not return a message id.');
  return { ok: true, period_key: payload.period_key, report_id: reportId, message_id: message.id, reused: Boolean(savedExisting) };
}

async function generateAutomaticSnapshots() {
  // A closed CRM must not generate a report or touch Supabase in the background.
  if (!require('../lib/recentHumanActivity').hasRecentHumanActivity()) return { ok: true, generated: 0, managers: 0, aria: { skipped: true, ok: true, reason: 'All CRM users are offline.' }, results: [] };
  // Run for ALL employees during the office shift, including users who are
  // logged out/idle. Their actual completed-window metrics may legitimately be 0.
  // Outside office hours return BEFORE reading even one Supabase table.
  const eligibleSlot = ariaShiftSlot();
  if (!eligibleSlot) return { ok: true, generated: 0, managers: 0,
    aria: { ok: true, skipped: true, reason: 'Outside the administrator-configured IST ARIA reporting schedule.' }, results: [] };
  // Re-check persisted state BEFORE collecting call/candidate datasets: old
  // periods should never cause 8 heavy table reads just because Render restarted.
  const period = eligibleSlot.period;
  const reports = await table('scheduled_reports');
  const ariaExisting = reports.find((row) => lower(row.report_type) === 'semi-hourly'
    && String(row.period_key || '') === `manager:ARIA:${period}`);
  const bounds = windowBounds({ query: { window: 'previous' } });
  // If every manager's report is already saved, no heavy aggregation is needed.
  // If ARIA was saved just before a restart, still finish any missing manager
  // report/notification rather than discarding the pending work.
  const allUsers = await table('users');
  const managers = allUsers.filter((u) => {
    const active = lower(u.is_active || u.status || 'active');
    return isManager(u) && !['0', 'false', 'inactive', 'disabled', 'deleted'].includes(active);
  });
  const missingManagerSnapshot = managers.some((manager) =>
    !reports.some((row) => lower(row.report_type) === 'semi-hourly'
      && String(row.period_key || '') === `${roleOf(manager)}:${userId(manager)}:${period}`));
  // Already saved snapshots are the durable checkpoint. Retry chat publish
  // without reading candidates/calls again whenever every scope is complete.
  const data = !ariaExisting?.snapshot_json || missingManagerSnapshot
    ? await loadData(startOfDay(bounds.end).toISOString(), bounds.end.toISOString(), allUsers)
    : null;

  // ARIA is the primary report. Send its message even if an individual manager
  // notification fails. One stored message is visible in both existing feeds.
  let aria = null;
  try { aria = await runAriaTeamSnapshot({ data, reports }); }
  catch (error) { aria = { ok: false, error: error?.message || String(error) }; }

  // Notifications retrieved once and verified before any extra message writes.
  const notices = managers.length ? await table('notifications') : [];
  const results = [];
  for (const manager of managers) {
    try {
      const key = `${roleOf(manager)}:${userId(manager)}:${period}`;
      let saved = reports.find((row) => lower(row.report_type) === 'semi-hourly' && String(row.period_key || '') === key);
      let payload = saved?.snapshot_json ? safeJson(saved.snapshot_json) : null;
      if (!payload) {
        const req = { user: manager, query: { window: 'previous', auto: '1' } };
        payload = await buildReport(req, data);
        saved = await saveSnapshot(payload, manager, { reports, skipArchive: true, automatic: true });
        if (saved?.report_id && !reports.some((row) => String(row.report_id) === String(saved.report_id))) reports.push(saved);
      }
      const reportId = String(saved?.report_id || '').trim();
      if (!reportId) throw new Error('Manager snapshot not saved.');
      const existingNotice = notices.find((row) => {
        if (String(row.user_id || '') !== userId(manager) || lower(row.category) !== 'performance') return false;
        const meta = safeJson(row.metadata);
        return meta.source === 'automatic_semi_hourly_manager_report' && String(meta.period_key || '') === period;
      });
      if (!existingNotice) {
        const summary = payload.summary || {};
        const message = `30-minute team report ready • Dialed ${summary.dialed_calls || 0} • Connected ${summary.connected_calls || 0} • Talk ${summary.talk_time_minutes || 0}m • Submissions ${summary.submissions || 0} • Break ${summary.break_minutes || 0}m • Idle ${summary.idle_minutes || 0}m`;
        const notice = await store.insert('notifications', {
          notification_id: nextId('N', notices, 'notification_id'), user_id: userId(manager),
          title: '30-Minute Team Report', message, category: 'performance', status: 'Unread',
          metadata: JSON.stringify({ source: 'automatic_semi_hourly_manager_report', period_key: period,
            report_id: reportId, open_path: `/semi-hourly-report?reportId=${encodeURIComponent(reportId)}` }), created_at: nowIso(),
        });
        notices.push(notice);
      }
      results.push({ user_id: userId(manager), period_key: period, report_id: reportId, ok: true });
    } catch (error) {
      results.push({ user_id: userId(manager), ok: false, error: error?.message || String(error) });
    }
  }
  return { ok: Boolean(aria?.ok) && results.every((r) => r.ok), generated: results.filter((r) => r.ok).length, managers: results.length, aria, results };
}

function runAutomaticManagerSnapshots() {
  if (automaticReportInFlight) return automaticReportInFlight;
  automaticReportInFlight = generateAutomaticSnapshots().finally(() => { automaticReportInFlight = null; });
  return automaticReportInFlight;
}

module.exports = { overview, sendMessage, runAutomaticManagerSnapshots, runAriaTeamSnapshot, ariaShiftSlot, ariaShiftNextDelay, setAriaShiftTimes, ariaShiftSettings, loadPersistedAriaShift };
