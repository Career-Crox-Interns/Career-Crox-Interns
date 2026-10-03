const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');
const { getSettingsMap } = require('../lib/settings');
const { aggregateCallRows, aggregateBreakRows, callMetricForRow, presenceMinutes, dayStatusFromMinutes, attendanceThresholds } = require('../lib/crmMetrics');
const { isLockExempt } = require('../lib/unlockPolicy');
const { ensureUnlockRequestForUser } = require('../lib/unlockService');

function basePresence(userId, page = '/attendance') {
  return {
    user_id: userId,
    last_seen_at: nowIso(),
    last_activity_at: nowIso(),
    last_activity_source: 'join_office',
    last_page: page,
    is_on_break: '0',
    break_reason: '',
    break_started_at: '',
    break_expected_end_at: '',
    total_break_minutes: '0',
    locked: '0',
    lock_reason: '',
    lock_message: '',
    unlock_grace_until: '',
    last_call_dial_at: '',
    last_call_candidate_id: '',
    last_call_alert_sent_at: '',
    meeting_joined: '1',
    meeting_joined_at: nowIso(),
    screen_sharing: '0',
    screen_frame_url: '',
    last_screen_frame_at: '',
    work_started_at: nowIso(),
    total_work_minutes: '0',
  };
}

function minutesBetween(a, b = new Date()) {
  if (!a) return 0;
  const ms = b.getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms / 60000);
}

function attendanceNormalizePhone(value = '') { return String(value || '').replace(/\D+/g, '').slice(-10); }
function attendanceCandidateDeleted(row = {}) {
  const low = (v) => String(v || '').trim().toLowerCase();
  return Boolean(String(row.deleted_at || '').trim())
    || ['deleted','__deleted__','archived'].includes(low(row.status))
    || ['deleted','__deleted__','archived'].includes(low(row.approval_status))
    || ['deleted','archived'].includes(low(row.all_details_sent))
    || low(row.data_notes).includes('[crm-deleted]');
}
function attendanceTrackedCalls(rows = [], candidates = []) {
  const active = (candidates || []).filter((c) => !attendanceCandidateDeleted(c));
  const ids = new Set(active.map((c) => String(c.candidate_id || '').trim()).filter(Boolean));
  const phones = new Set(active.map((c) => attendanceNormalizePhone(c.phone || c.number || c.mobile || c.candidate_phone || '')).filter(Boolean));
  return (rows || []).filter((row) => {
    const cid = String(row.candidate_id || row.current_candidate_id || '').trim();
    const phone = attendanceNormalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '');
    return Boolean((cid && ids.has(cid)) || (phone && phones.has(phone)));
  });
}

const ATTENDANCE_CRM_CALL_EXISTS_SQL = `exists (
  select 1 from public.candidates c
  where coalesce(c.deleted_at,'') = ''
    and lower(coalesce(c.status,'')) not in ('deleted','__deleted__','archived')
    and lower(coalesce(c.approval_status,'')) not in ('deleted','__deleted__','archived')
    and lower(coalesce(c.all_details_sent,'')) not in ('deleted','archived')
    and lower(coalesce(c.data_notes,'')) not like '%[crm-deleted]%'
    and (
      (coalesce(c.candidate_id,'') <> '' and c.candidate_id = coalesce(call_logs.candidate_id, call_logs.current_candidate_id, ''))
      or (
        right(regexp_replace(coalesce(c.phone,c.number,''), '\\D', '', 'g'), 10) <> ''
        and right(regexp_replace(coalesce(c.phone,c.number,''), '\\D', '', 'g'), 10) = right(regexp_replace(coalesce(call_logs.phone,''), '\\D', '', 'g'), 10)
      )
    )
)`;


function localDateKey(value = new Date()) {
  return dateKey(value);
}

function minutesToHoursLabel(minutes) {
  const mins = Math.max(0, Number(minutes || 0) || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

function reportCheck(label, actual, target, direction = 'min', unit = '') {
  const a = Number(actual || 0) || 0;
  const t = Number(target || 0) || 0;
  const pass = direction === 'max' ? a <= t : a >= t;
  return { label, actual: a, target: t, direction, unit, pass, text: `${a}${unit ? ` ${unit}` : ''} / ${t}${unit ? ` ${unit}` : ''}` };
}

function buildAttendanceReportPayload(user, summary = {}, settings = {}, notes = '') {
  const targets = {
    payable_work_minutes: Number(settings.attendance_full_day_work_minutes || settings.attendance_full_day_minutes || settings.full_day_minutes || 540) || 540,
    dialed_calls: Number(settings.attendance_report_min_dialed_calls || 100) || 100,
    connected_calls: Number(settings.attendance_report_min_connected_calls || 60) || 60,
    talktime_minutes: Number(settings.attendance_report_min_talktime_minutes || 180) || 180,
    submissions: Number(settings.attendance_report_min_submissions || 10) || 10,
    missed_interviews: 0,
  };
  const dialed = Number(summary.outgoing_calls_count || summary.dialed_calls_count || 0) || 0;
  const connected = Number(summary.connected_calls_count || 0) || 0;
  const talk = Number(summary.talktime_minutes || 0) || 0;
  const subs = Number(summary.submissions_count || 0) || 0;
  const active = Number(summary.productive_work_minutes || summary.active_work_minutes || 0) || 0;
  const idle = Number(summary.idle_minutes || 0) || 0;
  const breakMins = Number(summary.total_break_minutes || 0) || 0;
  const missedInterviews = Number(summary.missed_interviews_today || 0) || 0;
  const checks = [
    reportCheck('Payable Work', active, targets.payable_work_minutes, 'min', 'min'),
    reportCheck('Dialed Calls', dialed, targets.dialed_calls, 'min', ''),
    reportCheck('Connected Calls', connected, targets.connected_calls, 'min', ''),
    reportCheck('Talk Time', talk, targets.talktime_minutes, 'min', 'min'),
    reportCheck('Submissions', subs, targets.submissions, 'min', ''),
    reportCheck('Missed Interviews', missedInterviews, targets.missed_interviews, 'max', ''),
  ];
  const failed = checks.filter((item) => !item.pass);
  const productivity_status = failed.length ? 'Not up to the mark' : 'Up to the mark';
  return {
    employee: {
      user_id: user?.user_id || '',
      username: user?.username || '',
      full_name: user?.full_name || user?.username || '',
      recruiter_code: user?.recruiter_code || '',
      role: user?.role || '',
      designation: user?.designation || '',
    },
    work_date: localDateKey(),
    generated_at: nowIso(),
    notes: String(notes || '').trim(),
    productivity_status,
    recommended_day_status: summary.day_status || (failed.length ? 'Half Day' : 'Full Day'),
    manager_decision: '',
    manager_note: '',
    summary: {
      ...summary,
      work_time_label: minutesToHoursLabel(active),
      break_time_label: minutesToHoursLabel(breakMins),
      idle_time_label: minutesToHoursLabel(idle),
      talktime_label: minutesToHoursLabel(talk),
    },
    targets,
    checks,
    failed_checks: failed,
  };
}


function interviewEffectiveStamp(row = {}) {
  return String(row.interview_reschedule_date || row.interview_date || row.scheduled_at || '').trim();
}

function interviewCandidateKey(row = {}) {
  const candidateId = String(row.candidate_id || '').trim();
  if (candidateId) return `candidate:${candidateId}`;
  const interviewId = String(row.interview_id || '').trim();
  if (interviewId) return `interview:${interviewId}`;
  const phone = String(row.phone || row.mobile || row.number || '').replace(/\D+/g, '');
  if (phone.length >= 10) return `phone:${phone.slice(-10)}`;
  return `name:${String(row.full_name || row.candidate_name || '').trim().toLowerCase()}:${interviewEffectiveStamp(row)}`;
}

function isDeletedOrHiddenInterviewCandidate(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  const approval = String(row.approval_status || '').trim().toLowerCase();
  const details = String(row.all_details_sent || '').trim().toLowerCase();
  const notes = String(row.notes || row.data_notes || '').trim().toLowerCase();
  const removeStatus = String(row.interview_remove_status || '').trim().toLowerCase();
  return Boolean(String(row.deleted_at || '').trim())
    || ['deleted', '__deleted__', 'archived', 'not intrested', 'not interested', 'not responding', 'rejected'].includes(status)
    || ['deleted', '__deleted__', 'archived', 'rejected'].includes(approval)
    || ['deleted', 'archived'].includes(details)
    || removeStatus === 'approved'
    || notes.includes('[crm-deleted]');
}

function isCompletedInterviewStatus(row = {}) {
  const status = String(row.interview_status || row.status || row.all_details_sent || '').trim().toLowerCase();
  return ['completed','done','appeared','appeared in interview','selected','rejected','joined','cancelled','canceled','rescheduled','not interested','not intrested'].includes(status);
}

function interviewVisibleForAttendanceReport(row = {}, user = {}) {
  if (isDeletedOrHiddenInterviewCandidate(row)) return false;
  const role = String(user?.role || '').trim().toLowerCase();
  if (role === 'admin' || role === 'manager' || role === 'tl') return true;
  const userId = String(user?.user_id || '').trim();
  const code = String(user?.recruiter_code || user?.employee_code || '').trim().toLowerCase();
  const username = String(user?.username || '').trim().toLowerCase();
  const name = String(user?.full_name || '').trim().toLowerCase();
  const rowUser = String(row.user_id || row.assigned_user_id || row.recruiter_user_id || row.owner_user_id || row.employee_user_id || '').trim();
  const rowCode = String(row.recruiter_code || row.employee_code || row.assigned_recruiter_code || '').trim().toLowerCase();
  const rowName = String(row.recruiter_name || row.employee_name || row.assigned_recruiter_name || '').trim().toLowerCase();
  const rowUsername = String(row.username || row.employee_username || '').trim().toLowerCase();
  return (userId && rowUser === userId)
    || (code && rowCode === code)
    || (username && rowUsername === username)
    || (name && rowName === name);
}

async function missedInterviewsForUserNow(user) {
  const now = Date.now();
  const missed = new Map();
  try {
    const interviews = await table('interviews');
    const candidates = await table('candidates');
    const byCandidate = new Map((candidates || []).map((row) => [String(row.candidate_id || '').trim(), row]));
    for (const interview of interviews || []) {
      const candidate = byCandidate.get(String(interview.candidate_id || '').trim()) || {};
      const row = { ...candidate, ...interview };
      const stamp = interviewEffectiveStamp(row);
      if (!stamp) continue;
      const t = new Date(stamp).getTime();
      if (!Number.isFinite(t) || t >= now) continue;
      if (isCompletedInterviewStatus(row)) continue;
      if (!interviewVisibleForAttendanceReport(row, user)) continue;
      missed.set(interviewCandidateKey(row), row);
    }
    const interviewCandidateIds = new Set((interviews || []).map((row) => String(row.candidate_id || '').trim()).filter(Boolean));
    for (const candidate of candidates || []) {
      if (interviewCandidateIds.has(String(candidate.candidate_id || '').trim())) continue;
      const stamp = interviewEffectiveStamp(candidate);
      if (!stamp) continue;
      const t = new Date(stamp).getTime();
      if (!Number.isFinite(t) || t >= now) continue;
      if (isCompletedInterviewStatus(candidate)) continue;
      if (!interviewVisibleForAttendanceReport(candidate, user)) continue;
      missed.set(interviewCandidateKey(candidate), candidate);
    }
    return missed.size;
  } catch {
    return 0;
  }
}


async function createOrUpdateAttendanceReport(req, summary, notes = '') {
  const reports = await table('scheduled_reports');
  const settings = await getSettingsMap();
  const payload = buildAttendanceReportPayload(req.user, summary, settings, notes);
  const periodKey = `attendance:${payload.work_date}:${req.user.user_id}`;
  const existing = reports.find((row) => String(row.period_key || '') === periodKey && String(row.report_type || '').toLowerCase() === 'attendance-daily');
  const row = {
    user_id: req.user.user_id,
    title: `${payload.employee.full_name || 'Employee'} Attendance Report • ${payload.work_date}`,
    report_type: 'attendance-daily',
    filters_json: JSON.stringify({ work_date: payload.work_date, user_id: req.user.user_id, recruiter_code: payload.employee.recruiter_code }),
    file_format: 'live',
    frequency_minutes: '',
    status: 'Pending',
    next_run_at: '',
    last_run_at: payload.generated_at,
    last_file_name: '',
    period_key: periodKey,
    snapshot_json: JSON.stringify(payload),
    created_at: existing?.created_at || nowIso(),
  };
  if (existing?.report_id) return store.update('scheduled_reports', 'report_id', existing.report_id, row);
  return store.insert('scheduled_reports', { report_id: nextId('ATR', reports, 'report_id'), ...row });
}


function addMinutes(dateIso, minutes) {
  const d = new Date(dateIso || Date.now());
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  return d.toISOString();
}


function makeBreakId(user = {}, startedAt = '') {
  const key = String(user.user_id || user.username || 'user').replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 40) || 'user';
  const stamp = new Date(startedAt || Date.now()).getTime() || Date.now();
  return `BR-${key}-${stamp}`;
}

async function recordBreakSessionStart(user = {}, reason = 'Break', plannedMinutes = 0, startedAt = '', expectedEndAt = '') {
  const item = {
    break_id: makeBreakId(user, startedAt),
    user_id: String(user.user_id || ''),
    username: String(user.username || ''),
    full_name: String(user.full_name || user.name || user.username || ''),
    reason: String(reason || 'Break'),
    planned_minutes: String(Math.max(0, Number(plannedMinutes || 0) || 0)),
    started_at: String(startedAt || nowIso()),
    expected_end_at: String(expectedEndAt || ''),
    ended_at: '',
    actual_minutes: '0',
    status: 'Open',
    lock_triggered: '0',
    created_at: String(startedAt || nowIso()),
    updated_at: nowIso(),
  };
  try {
    const existing = await store.findById('break_sessions', 'break_id', item.break_id);
    if (existing) return await store.update('break_sessions', 'break_id', item.break_id, item);
    return await store.insert('break_sessions', item);
  } catch { return null; }
}

async function recordBreakSessionEnd(user = {}, startedAt = '', endedAt = '', usedMinutes = 0, exceeded = false, reason = '') {
  try {
    const userId = String(user.user_id || '');
    const username = String(user.username || '');
    let open = null;
    if (store.pool) {
      open = await store.one(`select * from public.break_sessions
        where (($1 <> '' and user_id = $1) or ($2 <> '' and lower(coalesce(username,'')) = lower($2)))
          and lower(coalesce(status,'')) in ('open','active','on break')
        order by coalesce(started_at, created_at, '') desc limit 1`, [userId, username]);
    } else {
      const rows = await table('break_sessions');
      open = (rows || []).filter((row) => ((userId && String(row.user_id || '') === userId) || (username && String(row.username || '').toLowerCase() === username.toLowerCase())) && ['open','active','on break'].includes(String(row.status || '').toLowerCase()))
        .sort((a,b) => String(b.started_at || b.created_at || '').localeCompare(String(a.started_at || a.created_at || '')))[0] || null;
    }
    const breakId = String(open?.break_id || makeBreakId(user, startedAt));
    const patch = {
      ...(open || {}),
      break_id: breakId,
      user_id: userId,
      username,
      full_name: String(open?.full_name || user.full_name || user.name || username || ''),
      reason: String(open?.reason || reason || 'Break'),
      started_at: String(open?.started_at || startedAt || endedAt || nowIso()),
      expected_end_at: String(open?.expected_end_at || ''),
      ended_at: String(endedAt || nowIso()),
      actual_minutes: String(Math.max(0, Number(usedMinutes || 0) || 0)),
      status: exceeded ? 'Exceeded' : 'Ended',
      lock_triggered: exceeded ? '1' : '0',
      created_at: String(open?.created_at || open?.started_at || startedAt || nowIso()),
      updated_at: nowIso(),
    };
    if (open?.break_id) return await store.update('break_sessions', 'break_id', open.break_id, patch);
    return await store.insert('break_sessions', patch);
  } catch { return null; }
}

function kolkataDateParts(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour || 0) * 60) + Number(parts.minute || 0),
  };
}

function isToday(dateIso) {
  if (!dateIso) return false;
  const left = kolkataDateParts(dateIso);
  const right = kolkataDateParts();
  return Boolean(left && right && left.date === right.date);
}

async function makeNotification(userId, title, message, category = 'attendance', metadata = '') {
  const rows = await table('notifications');
  const item = {
    notification_id: nextId('N', rows, 'notification_id'),
    user_id: userId,
    title,
    message,
    category,
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  };
  await store.insert('notifications', item);
  return item;
}

async function notifyLeadership(title, message, metadata = '') {
  const users = await table('users');
  const leaders = users.filter((u) => ['admin', 'manager', 'tl'].includes(String(u.role || '').toLowerCase()));
  for (const leader of leaders) {
    await makeNotification(leader.user_id, title, message, 'attendance', metadata);
  }
}

async function lockMobileAppForUser(user = {}, reason = 'crm_locked') {
  const userId = String(user?.user_id || '').trim();
  const username = String(user?.username || '').trim();
  if (!userId && !username) return { devices: 0, sessions: 0 };
  const stamp = nowIso();
  let devices = 0;
  let sessions = 0;
  try {
    if (store.pool) {
      const deviceRows = await store.query(`
        update public.mobile_devices
        set status = 'Logged Out', device_token = '', pairing_code = '', logout_reason = $3, revoked_at = $4, last_seen_at = $4, updated_at = $4
        where (user_id = $1 or lower(coalesce(username,'')) = lower($2))
          and lower(coalesce(status,'')) in ('active','paired','pending')
        returning device_id
      `, [userId, username, reason, stamp]);
      devices = Array.isArray(deviceRows) ? deviceRows.length : 0;
      const sessionRows = await store.query(`
        update public.dialer_sessions
        set status = 'Stopped', mobile_command = 'stop', command_type = 'stop', live_status = $3, stopped_at = $4, updated_at = $4
        where (assigned_user_id = $1 or owner_user_id = $1 or lower(coalesce(assigned_username,'')) = lower($2) or lower(coalesce(owner_username,'')) = lower($2))
          and lower(coalesce(status,'')) not in ('stopped','cancelled','completed','deleted')
        returning session_id
      `, [userId, username, `Mobile app locked: ${reason}`, stamp]);
      sessions = Array.isArray(sessionRows) ? sessionRows.length : 0;
    } else {
      const mobileRows = await table('mobile_devices');
      for (const row of mobileRows) {
        const same = String(row.user_id || '') === userId || String(row.username || '').toLowerCase() === username.toLowerCase();
        if (!same || !['active','paired','pending'].includes(String(row.status || '').toLowerCase())) continue;
        await store.update('mobile_devices', 'device_id', row.device_id, { status: 'Logged Out', device_token: '', pairing_code: '', logout_reason: reason, revoked_at: stamp, last_seen_at: stamp, updated_at: stamp });
        devices += 1;
      }
      const sessionRows = await table('dialer_sessions');
      for (const row of sessionRows) {
        const same = String(row.assigned_user_id || row.owner_user_id || '') === userId || [row.assigned_username, row.owner_username].some((v) => String(v || '').toLowerCase() === username.toLowerCase());
        if (!same || ['stopped','cancelled','completed','deleted'].includes(String(row.status || '').toLowerCase())) continue;
        await store.update('dialer_sessions', 'session_id', row.session_id, { status: 'Stopped', mobile_command: 'stop', command_type: 'stop', live_status: `Mobile app locked: ${reason}`, stopped_at: stamp, updated_at: stamp });
        sessions += 1;
      }
    }
    if (devices || sessions) {
      await makeNotification(userId, 'Mobile app locked', 'CRM lock triggered. Pair the Calling Assistant again after CRM unlock approval.', 'attendance', JSON.stringify({ open_path: '/mobile-app', reason }));
    }
  } catch {}
  return { devices, sessions };
}

async function activityLogCompatId() {
  // Some live databases still have a legacy NOT NULL `id` column in activity_log.
  // Read its type only when needed; no destructive schema change is performed.
  try {
    if (store.pool) {
      const row = await store.one(`
        select data_type, udt_name
        from information_schema.columns
        where table_schema = 'public' and table_name = 'activity_log' and column_name = 'id'
        limit 1
      `);
      const type = String(row?.data_type || row?.udt_name || '').toLowerCase();
      if (/uuid/.test(type)) {
        try { return require('crypto').randomUUID(); } catch {}
      }
      if (/(bigint|integer|smallint|numeric|decimal|int2|int4|int8)/.test(type)) {
        return Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`);
      }
    }
  } catch {}
  return `A${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

async function insertActivityLogCompat(item = {}) {
  try {
    return await store.insert('activity_log', item);
  } catch (error) {
    const message = String(error?.message || error || '');
    if (!/null value in column ["']?id["']?.*activity_log|activity_log.*column ["']?id["']?/i.test(message)) throw error;
    const legacyId = await activityLogCompatId();
    return store.insert('activity_log', { ...item, id: legacyId });
  }
}

async function logActivity(req, actionType, metadata = {}, candidateId = '') {
  // Keep the existing sequential ID scheme; calculate its latest value in Postgres
  // instead of transferring every historical activity row to the Render process.
  // Local JSON mode retains the original algorithm.
  const rows = store.pool
    ? await store.query("select activity_id from public.activity_log order by length(regexp_replace(coalesce(activity_id,''),'[^0-9]','','g')) desc, regexp_replace(coalesce(activity_id,''),'[^0-9]','','g') desc limit 1")
    : await table('activity_log');
  const item = {
    activity_id: nextId('A', rows, 'activity_id'),
    user_id: req.user.user_id,
    username: req.user.username,
    action_type: actionType,
    candidate_id: candidateId,
    metadata: JSON.stringify(metadata),
    created_at: nowIso(),
  };
  await insertActivityLogCompat(item);
  return item;
}

async function userMap() {
  const users = await table('users');
  const map = new Map();
  for (const user of users) map.set(String(user.user_id), user);
  return map;
}

function settingNumber(settings, key, fallback = 0) {
  const value = Number(settings?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function breakLimitMinutes(settings = {}) {
  // Single source for break lock/reporting: attendance_break_limit_minutes.
  // crm_lock_break_limit_minutes is treated as a legacy fallback only.
  return settingNumber(settings, 'attendance_break_limit_minutes', settingNumber(settings, 'crm_lock_break_limit_minutes', 60));
}

function normalizePlannedBreakMinutes(value, settings = {}) {
  // Custom break minutes can be typed from CRM. Keep the configured limit as a
  // reporting hint, but never cap planned custom breaks below 480 minutes.
  const configuredLimit = Math.max(1, breakLimitMinutes(settings));
  const limit = Math.max(configuredLimit, 480);
  const raw = Number(value || 10);
  if (!Number.isFinite(raw)) return 10;
  return Math.max(1, Math.min(Math.round(raw), limit));
}

function dateKey(value = new Date()) {
  return kolkataDateParts(value)?.date || kolkataDateParts()?.date || new Date().toISOString().slice(0, 10);
}

function timeMinutes(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return (Number(m[1]) * 60) + Number(m[2]);
}

function localMinutesOfDay(value) {
  return kolkataDateParts(value)?.minutes || 0;
}

function attendanceRulesActive(settings = {}, forDate = dateKey()) {
  const effective = String(settings.attendance_rules_effective_from || '').trim();
  if (!effective) return true;
  return String(forDate || dateKey()) >= effective;
}

function mergeMaxMetric(base = {}, extra = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    const current = Number(out[key] || 0) || 0;
    const next = Number(value || 0) || 0;
    out[key] = Math.max(current, next);
  }
  return out;
}

function isLateJoin(value, settings = {}) {
  if (!value) return false;
  const shiftStart = timeMinutes(settings.attendance_shift_login_time || '10:00');
  const grace = settingNumber(settings, 'attendance_late_grace_minutes', 10);
  return localMinutesOfDay(value) > (shiftStart + grace);
}

async function dailyStatsForUser(user = {}, settings = {}) {
  const statDate = dateKey();
  const todayBounds = rangeBounds('today');
  const start = todayBounds.from;
  const end = todayBounds.to;
  const recruiterCode = String(user.recruiter_code || user.employee_code || user.user_id || user.username || '').trim();
  const username = String(user.username || '').trim();
  const userId = String(user.user_id || '').trim();
  const fullName = String(user.full_name || user.name || user.employee_name || username || '').trim();
  const empty = {
    calls_count: 0,
    connected_calls_count: 0,
    not_connected_calls_count: 0,
    incoming_calls_count: 0,
    outgoing_calls_count: 0,
    missed_calls_count: 0,
    talktime_seconds: 0,
    outgoing_talktime_seconds: 0,
    incoming_talktime_seconds: 0,
    manual_calls_count: 0,
    auto_dialer_calls_count: 0,
    whatsapp_count: 0,
    submissions_count: 0,
    interviews_count: 0,
    selections_count: 0,
    joinings_count: 0,
  };
  let out = { ...empty };

  try {
    if (store.pool) {
      // CC26.217: raw call_logs are the single source for call cards/reports.
      // employee_daily_stats is only a write-behind cache and is deliberately not merged here,
      // because stale cache rows caused Attendance/Master Report mismatches.
      const metricRecords = await store.query(`
        select jsonb_build_object(
          'call_log_id', to_jsonb(call_logs)->>'call_log_id',
          'id', to_jsonb(call_logs)->>'id',
          'phone', to_jsonb(call_logs)->>'phone',
          'mobile', to_jsonb(call_logs)->>'mobile',
          'number', to_jsonb(call_logs)->>'number',
          'candidate_phone', to_jsonb(call_logs)->>'candidate_phone',
          'candidate_id', to_jsonb(call_logs)->>'candidate_id',
          'current_candidate_id', to_jsonb(call_logs)->>'current_candidate_id',
          'employee_user_id', to_jsonb(call_logs)->>'employee_user_id',
          'employee_username', to_jsonb(call_logs)->>'employee_username',
          'employee_name', to_jsonb(call_logs)->>'employee_name',
          'user_id', to_jsonb(call_logs)->>'user_id',
          'username', to_jsonb(call_logs)->>'username',
          'name', to_jsonb(call_logs)->>'name',
          'recruiter_name', to_jsonb(call_logs)->>'recruiter_name',
          'recruiter_code', to_jsonb(call_logs)->>'recruiter_code',
          'call_started_at', to_jsonb(call_logs)->>'call_started_at',
          'started_at', to_jsonb(call_logs)->>'started_at',
          'created_at', to_jsonb(call_logs)->>'created_at',
          'updated_at', to_jsonb(call_logs)->>'updated_at',
          'date', to_jsonb(call_logs)->>'date',
          'status', to_jsonb(call_logs)->>'status',
          'call_status', to_jsonb(call_logs)->>'call_status',
          'outcome', to_jsonb(call_logs)->>'outcome',
          'call_quality', to_jsonb(call_logs)->>'call_quality',
          'direction', to_jsonb(call_logs)->>'direction',
          'call_type', to_jsonb(call_logs)->>'call_type',
          'answered_at', to_jsonb(call_logs)->>'answered_at',
          'call_ended_at', to_jsonb(call_logs)->>'call_ended_at',
          'duration_seconds', to_jsonb(call_logs)->>'duration_seconds',
          'call_duration_seconds', to_jsonb(call_logs)->>'call_duration_seconds',
          'duration', to_jsonb(call_logs)->>'duration',
          'talktime_seconds', to_jsonb(call_logs)->>'talktime_seconds',
          'talk_time_seconds', to_jsonb(call_logs)->>'talk_time_seconds',
          'connected_seconds', to_jsonb(call_logs)->>'connected_seconds',
          'call_source', to_jsonb(call_logs)->>'call_source',
          'source_mode', to_jsonb(call_logs)->>'source_mode',
          'synced_from', to_jsonb(call_logs)->>'synced_from',
          'call_log_available', to_jsonb(call_logs)->>'call_log_available'
        ) as metric_row from public.call_logs
        where coalesce(call_started_at, created_at, updated_at, '') >= $1
          and coalesce(call_started_at, created_at, updated_at, '') <= $2
          and (
            coalesce(employee_user_id, '') = $3
            or lower(coalesce(employee_username, username, '')) = lower($4)
            or lower(coalesce(employee_name, recruiter_name, '')) = lower($5)
            or lower(coalesce(recruiter_code, '')) = lower($6)
          )
          and ${ATTENDANCE_CRM_CALL_EXISTS_SQL}
        order by coalesce(call_started_at, created_at, updated_at, '') desc
        limit 10000
      `, [start, end, userId, username, fullName, recruiterCode]);
      // Aggregate with the original crmMetrics source of truth: no rounding,
      // skipped calls or database-derived substitute totals.
      out = { ...out, ...aggregateCallRows((metricRecords || []).map(row => row.metric_row || {})) };

      const subAgg = await store.one(`
        select count(*)::int as submissions_count
        from public.submissions s
        left join public.candidates c on c.candidate_id = s.candidate_id
        where coalesce(s.submitted_at, s.created_at, s.approval_requested_at, '') >= $1
          and coalesce(s.submitted_at, s.created_at, s.approval_requested_at, '') <= $2
          and (
            coalesce(s.recruiter_code, '') = $3
            or coalesce(c.recruiter_code, '') = $3
            or coalesce(s.submitted_by_user_id, '') = $4
            or coalesce(c.created_by_user_id, '') = $4
            or lower(coalesce(s.submitted_by_name, '')) = lower($5)
            or lower(coalesce(c.recruiter_name, '')) = lower($5)
          )
      `, [start, end, recruiterCode, userId, fullName]);
      out.submissions_count = Number(subAgg?.submissions_count || 0) || 0;

      const actAgg = await store.one(`
        select
          count(*) filter (where lower(coalesce(action_type,'')) like '%whatsapp%')::int as whatsapp_count,
          count(*) filter (where lower(coalesce(action_type,'')) like '%selection%')::int as selections_count,
          count(*) filter (where lower(coalesce(action_type,'')) like '%joining%')::int as joinings_count,
          count(*) filter (where lower(coalesce(action_type,'')) like '%interview%')::int as interviews_count
        from public.activity_log
        where coalesce(created_at, '') >= $1
          and coalesce(created_at, '') <= $2
          and (user_id = $3 or lower(coalesce(username,'')) = lower($4))
      `, [start, end, userId, username]);
      out.whatsapp_count = Number(actAgg?.whatsapp_count || 0) || 0;
      out.selections_count = Number(actAgg?.selections_count || 0) || 0;
      out.joinings_count = Number(actAgg?.joinings_count || 0) || 0;
      out.interviews_count = Number(actAgg?.interviews_count || 0) || 0;
    } else {
      const calls = (await table('call_logs')).filter((row) => {
        const stamp = String(row.call_started_at || row.created_at || row.updated_at || '');
        const sameUser = String(row.employee_user_id || row.user_id || row.owner_user_id || row.assigned_user_id || '') === userId;
        const sameUsername = String(row.employee_username || row.username || row.owner_username || row.assigned_username || '').toLowerCase() === username.toLowerCase();
        const sameName = String(row.employee_name || row.recruiter_name || row.full_name || row.name || '').toLowerCase() === fullName.toLowerCase();
        const sameCode = String(row.recruiter_code || row.employee_code || '').toLowerCase() === recruiterCode.toLowerCase();
        return stamp >= start && stamp <= end && (sameUser || sameUsername || sameName || sameCode);
      });
      const localCandidates = await table('candidates');
      out = { ...out, ...aggregateCallRows(attendanceTrackedCalls(calls, localCandidates)) };
      const candidateById = new Map(localCandidates.map((row) => [String(row.candidate_id || ''), row]));
      out.submissions_count = (await table('submissions')).filter((row) => {
        const candidate = candidateById.get(String(row.candidate_id || '')) || {};
        const stamp = String(row.submitted_at || row.created_at || row.approval_requested_at || '');
        const codeMatch = String(row.recruiter_code || candidate.recruiter_code || '') === recruiterCode;
        const userMatch = String(row.submitted_by_user_id || candidate.created_by_user_id || '') === userId;
        const nameMatch = String(row.submitted_by_name || candidate.recruiter_name || '').toLowerCase() === fullName.toLowerCase();
        return stamp >= start && stamp <= end && (codeMatch || userMatch || nameMatch);
      }).length;
      const actRows = (await table('activity_log')).filter((row) => {
        const stamp = String(row.created_at || '');
        return stamp >= start && stamp <= end && (String(row.user_id) === userId || String(row.username || '').toLowerCase() === username.toLowerCase());
      });
      out.whatsapp_count = actRows.filter((row) => /whatsapp/i.test(String(row.action_type || ''))).length;
      out.selections_count = actRows.filter((row) => /selection/i.test(String(row.action_type || ''))).length;
      out.joinings_count = actRows.filter((row) => /joining/i.test(String(row.action_type || ''))).length;
      out.interviews_count = actRows.filter((row) => /interview/i.test(String(row.action_type || ''))).length;
    }
  } catch {}

  return out;
}

async function consecutiveLateCountForUser(user = {}, settings = {}) {
  try {
    const userId = String(user.user_id || '').trim();
    let logs = [];
    if (store.pool) {
      logs = await store.query(`
        select created_at from public.activity_log
        where user_id = $1 and lower(action_type) = 'join_work'
        order by created_at desc
        limit 10
      `, [userId]);
    } else {
      logs = (await table('activity_log')).filter((row) => String(row.user_id) === userId && String(row.action_type || '').toLowerCase() === 'join_work')
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 10);
    }
    const seen = new Set();
    let count = 0;
    for (const log of logs) {
      const day = String(log.created_at || '').slice(0, 10);
      if (!day || seen.has(day)) continue;
      seen.add(day);
      if (isLateJoin(log.created_at, settings)) count += 1;
      else break;
    }
    return count;
  } catch { return 0; }
}

function buildSummary(presence, settings = {}, metrics = {}, lateConsecutiveCount = 0) {
  const { fullDayMinutes, zeroDayMinutes } = attendanceThresholds(settings);
  const breakAllowanceMinutes = breakLimitMinutes(settings);
  const dailySalary = settingNumber(settings, 'attendance_daily_salary_amount', 0);
  const hasWorkStart = Boolean(presence?.work_started_at);
  const live = hasWorkStart && isToday(presence.work_started_at) ? presenceMinutes(presence) : { session_minutes: 0, total_break_minutes: 0, productive_work_minutes: 0 };
  const sessionMinutes = live.session_minutes;
  const breakMinutes = live.total_break_minutes;
  const hasSavedActiveMinutes = presence && Object.prototype.hasOwnProperty.call(presence, 'total_work_minutes') && String(presence.total_work_minutes ?? '').trim() !== '';
  const savedActiveMinutes = Math.max(0, Number(presence?.total_work_minutes || 0) || 0);
  const productiveMinutes = Math.max(0, Math.min(Math.max(0, sessionMinutes - breakMinutes), hasSavedActiveMinutes ? savedActiveMinutes : live.productive_work_minutes));
  const idleMinutes = Math.max(0, sessionMinutes - breakMinutes - productiveMinutes);
  const talktimeMinutes = Math.floor((Number(metrics.talktime_seconds || 0) || 0) / 60);
  const rulesActive = attendanceRulesActive(settings);
  const checks = rulesActive ? [
    ['Calling', Number(metrics.calls_count || 0), settingNumber(settings, 'attendance_min_calling_count', 0)],
    ['Outgoing calls', Number(metrics.outgoing_calls_count || 0), settingNumber(settings, 'attendance_min_outgoing_calls', 0)],
    ['Incoming calls', Number(metrics.incoming_calls_count || 0), settingNumber(settings, 'attendance_min_incoming_calls', 0)],
    ['Talktime', talktimeMinutes, settingNumber(settings, 'attendance_min_talktime_minutes', 0)],
    ['Submissions', Number(metrics.submissions_count || 0), settingNumber(settings, 'attendance_min_submissions', 0)],
    ['Selections', Number(metrics.selections_count || 0), settingNumber(settings, 'attendance_min_selections', 0)],
    ['Interviews', Number(metrics.interviews_count || 0), settingNumber(settings, 'attendance_min_interviews', 0)],
    ['Joinings', Number(metrics.joinings_count || 0), settingNumber(settings, 'attendance_min_joinings', 0)],
  ] : [];
  const failedRules = checks.filter(([, actual, required]) => required > 0 && actual < required).map(([label, actual, required]) => `${label}: ${actual}/${required}`);
  if (rulesActive && breakAllowanceMinutes > 0 && breakMinutes > breakAllowanceMinutes) failedRules.push(`Breaks: ${breakMinutes}/${breakAllowanceMinutes} min`);
  const lateThreshold = settingNumber(settings, 'attendance_late_half_day_after_count', 3);
  const lateHalfDay = rulesActive && lateThreshold > 0 && lateConsecutiveCount >= lateThreshold;
  if (lateHalfDay) failedRules.push(`Late coming streak: ${lateConsecutiveCount}/${lateThreshold}`);
  const joined = hasWorkStart && isToday(presence.work_started_at);
  let dayStatus = dayStatusFromMinutes(productiveMinutes, joined, settings, failedRules);
  if (joined && lateHalfDay && dayStatus === 'Full Day') dayStatus = 'Half Day';
  const payableRatio = dayStatus === 'Full Day' ? 1 : (dayStatus === 'Half Day' ? 0.5 : 0);
  return {
    joined_today: joined,
    joined_at: presence?.work_started_at || '',
    session_minutes: String(sessionMinutes),
    office_duration_minutes: String(sessionMinutes),
    active_work_minutes: String(productiveMinutes),
    idle_minutes: String(idleMinutes),
    total_break_minutes: String(breakMinutes),
    productive_work_minutes: String(productiveMinutes),
    remaining_work_minutes: String(Math.max(fullDayMinutes - productiveMinutes, 0)),
    remaining_break_minutes: String(Math.max(breakAllowanceMinutes - breakMinutes, 0)),
    locked: presence?.locked || '0',
    day_status: dayStatus,
    payable_ratio: String(payableRatio),
    today_pay_estimate: String(Math.round(dailySalary * payableRatio)),
    talktime_minutes: String(talktimeMinutes),
    outgoing_talktime_minutes: String(Math.floor((Number(metrics.outgoing_talktime_seconds || 0) || 0) / 60)),
    incoming_talktime_minutes: String(Math.floor((Number(metrics.incoming_talktime_seconds || 0) || 0) / 60)),
    manual_calls_count: String(metrics.manual_calls_count || 0),
    auto_dialer_calls_count: String(metrics.auto_dialer_calls_count || 0),
    connected_calls_count: String(metrics.connected_calls_count || 0),
    not_connected_calls_count: String(metrics.not_connected_calls_count || 0),
    missed_calls_count: String(metrics.missed_calls_count || 0),
    outgoing_calls_count: String(metrics.outgoing_calls_count || 0),
    incoming_calls_count: String(metrics.incoming_calls_count || 0),
    calls_count: String(metrics.calls_count || 0),
    submissions_count: String(metrics.submissions_count || 0),
    selections_count: String(metrics.selections_count || 0),
    interviews_count: String(metrics.interviews_count || 0),
    missed_interviews_today: String(metrics.missed_interviews_today || 0),
    joinings_count: String(metrics.joinings_count || 0),
    late_consecutive_count: String(lateConsecutiveCount || 0),
    attendance_failed_rules: failedRules,
    attendance_rules_effective_from: settings.attendance_rules_effective_from || '',
    attendance_rules_active: rulesActive ? '1' : '0',
  };
}


function attendanceRole(user = {}) {
  const raw = String(user?.role || user?.designation || '').trim().toLowerCase();
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'recruiter' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function isLeadershipRole(user) {
  return ['admin', 'manager', 'tl'].includes(attendanceRole(user));
}

function isAttendanceManager(user) {
  return ['admin', 'manager'].includes(attendanceRole(user));
}

function attendanceUserId(user = {}) {
  return String(user.user_id || user.id || '').trim();
}

function attendanceUserCode(user = {}) {
  return String(user.recruiter_code || user.employee_code || user.code || '').trim().toLowerCase();
}

function attendanceUserName(user = {}) {
  return String(user.full_name || user.name || user.username || user.user_id || '').trim().toLowerCase();
}

async function attendanceVisibleUserIds(viewer = {}) {
  const selfId = attendanceUserId(viewer);
  if (isAttendanceManager(viewer)) {
    const users = await table('users');
    return new Set((users || []).map(attendanceUserId).filter(Boolean));
  }
  if (attendanceRole(viewer) !== 'tl') return new Set(selfId ? [selfId] : []);

  const users = await table('users');
  const ids = new Set(selfId ? [selfId] : []);
  let state = {};
  try {
    const settings = await table('app_settings');
    const row = (settings || []).find((item) => String(item.key || '') === 'flowchart_team_map_json');
    state = row?.value ? JSON.parse(String(row.value)) : {};
  } catch { state = {}; }
  const map = state?.map && typeof state.map === 'object' ? state.map : (state && !state.version ? state : {});
  const tlId = selfId;
  const tlCode = attendanceUserCode(viewer);
  const tlName = attendanceUserName(viewer);

  for (const user of (users || [])) {
    if (attendanceRole(user) !== 'recruiter') continue;
    const uid = attendanceUserId(user);
    const code = attendanceUserCode(user);
    const name = attendanceUserName(user);
    const mapped = map?.[uid] || map?.[String(user.recruiter_code || '')] || null;
    const possibleId = String(mapped?.tl_user_id || user.tl_user_id || user.team_lead_user_id || user.reporting_tl_user_id || user.reports_to_user_id || user.reporting_manager_user_id || '').trim();
    const possibleCode = String(mapped?.tl_code || user.tl_code || user.team_lead_code || user.reporting_tl_code || user.reports_to_code || user.reporting_manager_code || '').trim().toLowerCase();
    const possibleName = String(mapped?.tl_name || user.tl_name || user.team_lead_name || user.reporting_tl_name || user.reports_to_name || user.reporting_manager_name || '').trim().toLowerCase();
    const matches = (possibleId && tlId && possibleId === tlId)
      || (possibleCode && tlCode && possibleCode === tlCode)
      || (possibleName && tlName && possibleName === tlName);
    if (matches && uid) ids.add(uid);
  }
  return ids;
}

// CC26_723: A timestamp from /presence is NOT evidence that a person clicked Join Office.
// Require an explicit, durable, per-day audit event (already supported by the current
// activity_log schema). This avoids new columns and extra Supabase schema migrations.
const CC723_MANUAL_JOIN_ACTION = 'office_join_confirmed_v723';
const cc723JoinWrites = new Map();
function cc723JoinProofRow(row, presence) {
  if (!row || !presence || !isToday(presence.work_started_at) || presence.last_activity_source === 'join_pending_v723') return null;
  let meta = {};
  try { meta = JSON.parse(String(row.metadata || '{}')); } catch { return null; }
  const stamp = String(meta.joined_at || '').trim();
  const a = Date.parse(stamp), b = Date.parse(String(presence.work_started_at || ''));
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 2000 || !isToday(stamp)) return null;
  return { joined_at: stamp, audit_at: String(row.created_at || '') };
}
async function cc723ManualJoinProof(userId, presence) {
  if (!userId || !presence || !isToday(presence.work_started_at)) return null;
  try {
    const from = rangeBounds('today').from;
    const rows = store.pool
      ? await store.query(`select created_at,metadata from public.activity_log
          where user_id=$1 and action_type=$2 and created_at >= $3
          order by created_at desc limit 2`, [String(userId), CC723_MANUAL_JOIN_ACTION, from])
      : (await table('activity_log')).filter(row => String(row.user_id || '') === String(userId)
          && String(row.action_type || '') === CC723_MANUAL_JOIN_ACTION && String(row.created_at || '') >= from)
        .sort((a,b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0,2);
    return rows.map(row => cc723JoinProofRow(row,presence)).find(Boolean) || null;
  } catch (_) { return null; } // Fail closed; never silently start an unverified timer.
}
function cc723SafePresence(presence, proof) {
  if (!presence || proof) return presence;
  // Response-only mask: preserve the original DB row and any historical values.
  // Other screens must not treat a pre-v723 automatic/legacy timestamp as joined.
  return { ...presence,work_started_at:'',meeting_joined:'0',meeting_joined_at:'',
    total_work_minutes:'0',total_break_minutes:'0',is_on_break:'0' };
}
function cc723VerifiedSummary(presence, proof, settings, metrics, lateCount) {
  return { ...buildSummary(cc723SafePresence(presence,proof),settings,metrics,lateCount),
    manual_join_confirmed:proof?'1':'0',manual_confirmed_at:proof?.joined_at || '' };
}

function wantsCompactResponse(req) {
  return String(req.query?.compact || req.body?.compact || '').trim() === '1' || req.body?.compact === true;
}

async function attendanceGateSnapshot(req, explicitPresence = null, explicitSettings = null) {
  const settings = explicitSettings || await getSettingsMap();
  const presence = explicitPresence || await store.findById('presence', 'user_id', req.user.user_id);
  const proof = await cc723ManualJoinProof(req.user.user_id,presence);
  // A login/Join Office gate needs only the confirmed session. Fetching every
  // call/interview/submission and late-streak row here blocked the gate for
  // seconds and wasted egress. Full counts remain on explicit Attendance
  // page/manual Refresh, never fabricated by this compact gate response.
  return {
    presence:cc723SafePresence(presence,proof),
    today_stats:{
      joined_today:Boolean(proof), joined_at:proof?.joined_at || '',
      manual_join_confirmed:proof?'1':'0', manual_confirmed_at:proof?.joined_at || '',
      ...(() => { const m=proof ? presenceMinutes(presence) : presenceMinutes({});
        return { session_minutes:String(m.session_minutes), office_duration_minutes:String(m.office_duration_minutes),
          active_work_minutes:String(m.active_work_minutes), productive_work_minutes:String(m.productive_work_minutes),
          total_break_minutes:String(m.total_break_minutes), idle_minutes:String(m.idle_minutes) }; })(),
      metrics_deferred:true,
    },
    settings: {
      break_limit_minutes: breakLimitMinutes(settings),
      crm_monitor_idle_warning_minutes: Number(settings.crm_monitor_idle_warning_minutes || 5),
      crm_monitor_no_call_warning_minutes: Number(settings.crm_monitor_no_call_warning_minutes || 15),
      crm_monitor_low_call_window_minutes: Number(settings.crm_monitor_low_call_window_minutes || 60),
      crm_monitor_low_call_min_calls: Number(settings.crm_monitor_low_call_min_calls || 5),
      crm_monitor_alert_repeat_minutes: Number(settings.crm_monitor_alert_repeat_minutes || 15),
      crm_lock_idle_minutes: Number(settings.crm_lock_idle_minutes || 10),
      crm_lock_no_call_minutes: Number(settings.crm_lock_no_call_minutes || 20),
      break_overrun_lock_grace_seconds: 0,
    },
  };
}

async function ensurePendingUnlockRequest(req, reason, employeeNote = '') {
  const cleanNote = String(employeeNote || req.body?.note || req.body?.employee_note || '').trim();
  const finalReason = cleanNote ? `${reason} | Employee note: ${cleanNote}` : reason;
  const result = await ensureUnlockRequestForUser(req.user, finalReason, { autoCreated: true, notifyExisting: false });
  if (result?.created) {
    await logActivity(req, 'unlock_requested', { reason: result.item?.reason || finalReason, auto_created: true, employee_note_added: Boolean(cleanNote) });
  }
  return result?.item || null;
}

async function attendanceSnapshot(req) {
  const settings = await getSettingsMap();
  const rawPresence = await store.findById('presence', 'user_id', req.user.user_id);
  const selfJoinProof = await cc723ManualJoinProof(req.user.user_id,rawPresence);
  const presence = cc723SafePresence(rawPresence,selfJoinProof);
  const visibleUserIds = await attendanceVisibleUserIds(req.user);
  const allRequests = await table('unlock_requests');
  const requests = allRequests
    .filter((r) => visibleUserIds.has(String(r.user_id || '')))
    .sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const usersById = await userMap();
  const allPresence = await table('presence');
  const activeSessions = await table('active_sessions').catch(() => []);
  const sessionByUsername = new Map(activeSessions.map((row) => [String(row.username || '').trim().toLowerCase(), row]));
  const scopedPresence = allPresence.filter((p) => visibleUserIds.has(String(p.user_id || '')));
  // One narrowly scoped proof read for leadership's visible staff.
  const teamProofRows = store.pool
    ? await store.query(`select distinct on (user_id) user_id,created_at,metadata
        from public.activity_log where user_id = any($1::text[]) and action_type=$2 and created_at >= $3
        order by user_id,created_at desc`,[[...visibleUserIds],CC723_MANUAL_JOIN_ACTION,rangeBounds('today').from]).catch(()=>[])
    : (await table('activity_log')).filter(r=>visibleUserIds.has(String(r.user_id||''))
        && r.action_type===CC723_MANUAL_JOIN_ACTION && isToday(r.created_at));
  const teamProofById = new Map();
  for(const row of teamProofRows){const id=String(row.user_id||'');
    if(!teamProofById.has(id))teamProofById.set(id,row);}
  const teamWorking = scopedPresence
    .map((p) => {
      const user = usersById.get(String(p.user_id)) || {};
      const session = sessionByUsername.get(String(user.username || '').trim().toLowerCase());
      const lastBeat = Date.parse(String(session?.last_seen_at || session?.updated_at || '')) || 0;
      const sessionValid = Boolean(session && String(session.session_token || '').trim()
        && !['logged out', 'revoked', 'expired'].includes(String(session.status || '').toLowerCase())
        && lastBeat && Date.now() - lastBeat >= 0 && Date.now() - lastBeat < 5 * 60 * 1000);
      const joinedToday = Boolean(cc723JoinProofRow(teamProofById.get(String(p.user_id||'')),p));
      const activity_status = !sessionValid ? 'Logged Out' : !joinedToday ? 'Not Joined'
        : String(p.locked || '0') === '1' && String(p.is_on_break || '0') !== '1' ? 'Locked'
        : String(p.is_on_break || '0') === '1' ? 'On Break' : 'Working';
      return {
        activity_status,
        is_logged_in: sessionValid ? '1' : '0',
        user_id: p.user_id,
        full_name: user.full_name || user.username || p.user_id,
        designation: user.designation || '',
        recruiter_code: user.recruiter_code || '',
        role: user.role || '',
        locked: p.locked || '0',
        is_on_break: p.is_on_break || '0',
        break_reason: p.break_reason || '',
        lock_reason: p.lock_reason || '',
        lock_message: p.lock_message || '',
        last_seen_at: p.last_seen_at || '',
        work_started_at: p.work_started_at || '',
        total_break_minutes: p.total_break_minutes || '0',
      };
    })
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const attendanceActions = ['join_work', 'break_started', 'break_ended', 'break_exceeded', 'crm_locked', 'crm_unlocked', 'unlock_requested', 'over_break_alert', 'no_call_lock', 'attendance_report_sent'];
  // Limit the attended user's/team's event history on the database side. The
  // former table('activity_log') downloaded every employee's entire CRM history
  // once each time the Attendance screen refreshed.
  const activity = store.pool
    ? await store.query(`select * from public.activity_log
        where user_id = any($1::text[]) and lower(coalesce(action_type,'')) = any($2::text[])
        order by created_at desc limit 500`, [[...visibleUserIds], attendanceActions])
    : (await table('activity_log')).filter(row => visibleUserIds.has(String(row.user_id || '')) && attendanceActions.includes(String(row.action_type || '').toLowerCase()))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const mine = activity.filter((row) => String(row.user_id) === String(req.user.user_id));
  const scopedActivity = activity;
  // Exact same-day break count, even for an unusually busy day with >500 logs.
  const breakCountToday = store.pool
    ? Number((await store.one(`select count(*)::int as count from public.activity_log
        where user_id = $1 and lower(coalesce(action_type,'')) = 'break_started'
        and created_at >= $2 and created_at <= $3`,
      [String(req.user.user_id), rangeBounds('today').from, rangeBounds('today').to]))?.count || 0)
    : mine.filter(row => String(row.action_type || '').toLowerCase() === 'break_started' && isToday(row.created_at)).length;
  const metrics = await dailyStatsForUser(req.user, settings);
  const lateCount = await consecutiveLateCountForUser(req.user, settings);
  const todayStats = cc723VerifiedSummary(rawPresence,selfJoinProof,settings,metrics,lateCount);
  let sessionCallStats = null;
  const requestedSessionFrom = String(req.query?.session_from || '').trim();
  if (requestedSessionFrom) {
    const sessionFromMs = new Date(requestedSessionFrom).getTime();
    if (Number.isFinite(sessionFromMs) && sessionFromMs > 0 && sessionFromMs <= Date.now() + 60000) {
      sessionCallStats = await callStatsForUserSince(req.user, new Date(sessionFromMs).toISOString());
    }
  }
  return {
    presence,
    requests,
    settings,
    session_call_stats: sessionCallStats,
    today_stats: {
      break_count: String(breakCountToday),
      ...todayStats,
    },
    team_working: teamWorking,
    logs: isAttendanceManager(req.user) ? scopedActivity.slice(0, 150) : attendanceRole(req.user) === 'tl' ? scopedActivity.slice(0, 120) : mine.slice(0, 60),
    all_logs: scopedActivity.slice(0, 150),
  };
}

async function getOne(req, res) {
  if (wantsCompactResponse(req)) return res.json(await attendanceGateSnapshot(req));
  return res.json(await attendanceSnapshot(req));
}

// CC26_724: one authoritative manual join. On PostgreSQL, the presence row and
// BOTH activity events commit in ONE transaction. A failed audit cannot leave
// a phantom shift. The POST returns a compact receipt without querying every
// metric/report table and without relying on background auto-join.
function cc724ActivityId() {
  const crypto = require('crypto');
  const letters = Array.from(crypto.randomBytes(7), n => String.fromCharCode(97 + (n % 26))).join('');
  return 'A' + Date.now() + letters;
}
async function cc724PgJoin(req) {
  const client = await store.pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    // Serialise concurrent clicks/retries on this user across Render instances.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [String(req.user.user_id)]);
    const present = await client.query('select * from public.presence where user_id=$1 for update', [req.user.user_id]);
    const existing = present.rows[0] || null;
    const proofRows = existing && isToday(existing.work_started_at)
      ? await client.query(`select created_at,metadata from public.activity_log
          where user_id=$1 and action_type=$2 and created_at >= $3
          order by created_at desc limit 2`,
          [String(req.user.user_id), CC723_MANUAL_JOIN_ACTION, rangeBounds('today').from])
      : { rows: [] };
    const proven = (proofRows.rows || []).map(row => cc723JoinProofRow(row, existing)).find(Boolean) || null;
    if (proven) {
      await client.query('COMMIT'); committed = true;
      return { presence: existing, proof: proven, fresh: false };
    }
    if (existing && isToday(existing.work_started_at) && String(existing.locked || '0') === '1' && !isLockExempt(req.user)) {
      const error = new Error('Your CRM is locked. Manager approval is needed before joining.');
      error.status = 423; throw error;
    }
    const joinedAt = nowIso();
    const prior = existing && isToday(existing.work_started_at) ? {
      work_started_at: existing.work_started_at || '',
      total_work_minutes: existing.total_work_minutes || '0',
      total_break_minutes: existing.total_break_minutes || '0'
    } : null;
    const patch = {
      ...basePresence(req.user.user_id, req.body?.last_page || '/attendance'),
      work_started_at: joinedAt, meeting_joined_at: joinedAt,
      last_seen_at: joinedAt, last_activity_at: joinedAt,
      last_activity_source: 'explicit_join_v724',
      locked: existing && String(existing.locked || '0') === '1' ? existing.locked : '0'
    };
    const columns = Object.keys(patch);
    const names = columns.map(n => '"' + n + '"').join(', ');
    const placeholders = columns.map((_, i) => '$' + (i + 1)).join(', ');
    const vals = Object.values(patch);
    const savedResult = existing
      ? await client.query(`update public.presence set ${columns.map((c,i) => '"'+c+'"=$'+(i+1)).join(', ')} where user_id=$${columns.length+1} returning *`, [...vals, req.user.user_id])
      : await client.query(`insert into public.presence (${names}) values (${placeholders}) returning *`, vals);
    const saved = savedResult.rows[0] || null;
    if (!saved || String(saved.work_started_at || '') !== joinedAt) {
      const error = new Error('Attendance could not be saved. Please try again.'); error.status = 503; throw error;
    }
    // Historic activity_log has both an auto-generated-id variant and a
    // required-id variant. Detect once per real join, not on every page read.
    const idInfo = await client.query(`select data_type,column_default,is_nullable,is_identity from information_schema.columns
      where table_schema='public' and table_name='activity_log' and column_name='id' limit 1`);
    const idCol = idInfo.rows[0] || null;
    let extra = {};
    if (idCol && idCol.is_nullable === 'NO' && !idCol.column_default && idCol.is_identity !== 'YES') {
      const kind = String(idCol.data_type || '').toLowerCase();
      if (kind === 'uuid') extra.id = require('crypto').randomUUID();
      else if (/(?:smallint|integer|bigint|numeric|decimal)/.test(kind))
        extra.id = kind === 'smallint' ? Math.floor(Math.random()*30000)+1
          : kind === 'integer' ? Math.floor(Math.random()*1800000000)+1
            : Number(Date.now()*100 + Math.floor(Math.random()*100));
      else extra.id = cc724ActivityId();
    }
    const auditItems = [
      { action_type: CC723_MANUAL_JOIN_ACTION, metadata: JSON.stringify({joined_at:joinedAt,explicit_button:true,session_login_at:String(req.body?.session_login_at||'').slice(0,64),prior_unconfirmed_session:prior}) },
      { action_type: 'join_work', metadata: JSON.stringify({joined_at:joinedAt,explicit_button:true,page:req.body?.last_page||'/attendance'}) }
    ];
    for (let i=0; i<auditItems.length; i++) {
      const record = { ...extra, activity_id:cc724ActivityId(), user_id:req.user.user_id,
        username:req.user.username, candidate_id:'',
        ...auditItems[i], created_at:joinedAt };
      if (i && extra.id != null) {
        if (typeof extra.id === 'number') record.id = extra.id + i;
        else if (idCol.data_type === 'uuid') record.id = require('crypto').randomUUID();
        else record.id = cc724ActivityId();
      }
      const keys = Object.keys(record);
      const inserted = await client.query(`insert into public.activity_log (${keys.map(k=>'"'+k+'"').join(',')})
        values (${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning action_type`, Object.values(record));
      if (inserted.rowCount !== 1) {
        const e = new Error('Attendance confirmation could not be saved.'); e.status = 503; throw e;
      }
    }
    await client.query('COMMIT'); committed = true;
    return { presence:saved, proof:{joined_at:joinedAt,audit_at:joinedAt}, fresh:true };
  } catch (error) {
    if (!committed) { try { await client.query('ROLLBACK'); } catch (_) {} }
    throw error;
  } finally { client.release(); }
}
async function cc724LocalJoin(req) {
  const existing = await store.findById('presence','user_id',req.user.user_id);
  const proof = await cc723ManualJoinProof(req.user.user_id,existing);
  if (proof) return {presence:existing,proof,fresh:false};
  if (existing && isToday(existing.work_started_at) && String(existing.locked||'0')==='1' && !isLockExempt(req.user)) {
    const err=new Error('Your CRM is locked. Manager approval is needed before joining.');err.status=423;throw err;
  }
  const joinedAt=nowIso();
  const prior=existing && isToday(existing.work_started_at) ? {work_started_at:existing.work_started_at,total_work_minutes:existing.total_work_minutes,total_break_minutes:existing.total_break_minutes}:null;
  // In local JSON mode record proof first. If the presence write fails the
  // orphan audit DOES NOT confirm a shift because proof requires matching time.
  await logActivity(req,CC723_MANUAL_JOIN_ACTION,{joined_at:joinedAt,explicit_button:true,prior_unconfirmed_session:prior});
  const patch={...basePresence(req.user.user_id,req.body?.last_page||'/attendance'),
    work_started_at:joinedAt,meeting_joined_at:joinedAt,last_seen_at:joinedAt,
    last_activity_at:joinedAt,last_activity_source:'explicit_join_v724',
    locked:existing && String(existing.locked||'0')==='1'?existing.locked:'0'};
  const saved=existing ? await store.update('presence','user_id',req.user.user_id,patch)
    : await store.upsert('presence','user_id',patch);
  if (!saved || String(saved.work_started_at||'')!==joinedAt) {
    const err=new Error('Attendance could not be saved. Please try again.');err.status=503;throw err;
  }
  try { await logActivity(req,'join_work',{joined_at:joinedAt,explicit_button:true,page:req.body?.last_page||'/attendance'}); } catch (_) {}
  return {presence:saved,proof:{joined_at:joinedAt,audit_at:joinedAt},fresh:true};
}
async function cc724ExplicitJoinWrite(req) {
  const result=store.pool?await cc724PgJoin(req):await cc724LocalJoin(req);
  if (result.fresh) {
    // This optional notification never blocks the verified attendance receipt.
    Promise.resolve().then(()=>notifyLeadership('Office joined',
      `${req.user.full_name || req.user.username} joined office at ${new Date(result.proof.joined_at).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})}.`,
      JSON.stringify({user_id:req.user.user_id,open_path:'/attendance'}))).catch(()=>{});
  }
  return result;
}
async function join(req,res) {
  if (req.body?.manual_confirmed !== true || req.body?.join_source !== 'user_button') {
    return res.status(409).json({message:'Please click Join Office to begin your shift.',manual_join_required:true});
  }
  const key=String(req.user.user_id||'');
  try {
    if (!cc723JoinWrites.has(key)) {
      const pending=cc724ExplicitJoinWrite(req);
      cc723JoinWrites.set(key,pending);
      pending.finally(()=>{if(cc723JoinWrites.get(key)===pending)cc723JoinWrites.delete(key)}).catch(()=>{});
    }
    const result=await cc723JoinWrites.get(key);
    if (!result?.proof || !isToday(result.presence?.work_started_at)) {
      return res.status(503).json({message:'Attendance confirmation is incomplete. Please retry.',manual_join_required:true});
    }
    // Return only the actual Join receipt; loading calls/reports is NOT
    // required before the employee can see a confirmed session.
    return res.json({presence:cc723SafePresence(result.presence,result.proof),
      today_stats:cc723VerifiedSummary(result.presence,result.proof,{}, {},0),
      settings:{},office_join_receipt:'confirmed',attendance_verified:true});
  } catch (error) {
    console.error('[CC724 office join]', {code:String(error?.code||'JOIN_FAILED'),message:String(error?.message||'unknown').slice(0,240)});
    const status=Number(error?.status)||(error?.code==='55P03'?503:503);
    return res.status(status).json({message: status===503 ? 'Unable to save attendance right now. Please try again.' : error.message,
      manual_join_required:true,error_code:String(error?.code||'JOIN_FAILED')});
  }
}

// CC26_725: break transitions are one transaction on Supabase. Presence,
// break_sessions and the reporting audit must agree or NONE of them change.
// Browser refresh and concurrent clicks are serialized on the presence row.
async function cc725BreakAudit(client, req, action, metadata, stamp) {
  const idInfo = await client.query(`select data_type,column_default,is_nullable,is_identity from information_schema.columns
    where table_schema='public' and table_name='activity_log' and column_name='id' limit 1`);
  const idCol = idInfo.rows[0] || null;
  const record = { activity_id:cc724ActivityId(),user_id:req.user.user_id,username:req.user.username,
    action_type:action,candidate_id:'',metadata:JSON.stringify(metadata),created_at:stamp };
  if (idCol && idCol.is_nullable==='NO' && !idCol.column_default && idCol.is_identity!=='YES') {
    const kind=String(idCol.data_type||'').toLowerCase();
    if(kind==='uuid')record.id=require('crypto').randomUUID();
    else if(kind==='smallint')record.id=Math.floor(Math.random()*30000)+1;
    else if(kind==='integer')record.id=Math.floor(Math.random()*1800000000)+1;
    else if(/^(?:bigint|numeric|decimal)$/.test(kind))record.id=Date.now()*100+Math.floor(Math.random()*100);
    else record.id=cc724ActivityId();
  }
  const keys=Object.keys(record);
  const saved=await client.query(`insert into public.activity_log (${keys.map(k=>'"'+k+'"').join(',')})
    values (${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning activity_id`,Object.values(record));
  if(saved.rowCount!==1)throw Object.assign(new Error('Break audit was not saved.'),{status:503});
}
async function cc725PgBreak(req, mode, reason='', plannedMinutes=0) {
  const client=await store.pool.connect();let committed=false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    const loaded=await client.query('select * from public.presence where user_id=$1 for update',[req.user.user_id]);
    const p=loaded.rows[0];
    if(!p || !isToday(p.work_started_at))throw Object.assign(new Error('Join Office before starting a break.'),{status:409});
    // Caller already verified the explicit join against its durable audit.
    const proof=await cc723ManualJoinProof(req.user.user_id,p);
    if(!proof || Math.abs(Date.parse(proof.joined_at)-Date.parse(p.work_started_at))>2000)
      throw Object.assign(new Error('Office Join is not verified.'),{status:409});
    const onBreak=String(p.is_on_break||'0')==='1';
    if ((mode==='start' && onBreak)||(mode==='end' && !onBreak)) {
      await client.query('COMMIT');committed=true;return {presence:p,changed:false};
    }
    if(mode==='start' && String(p.locked||'0')==='1' && !isLockExempt(req.user))
      throw Object.assign(new Error('CRM access is locked. Request manager approval.'),{status:423});
    const stamp=nowIso();const exempt=isLockExempt(req.user);
    if(mode==='start') {
      const deadline=new Date(Date.parse(stamp)+plannedMinutes*60000).toISOString();
      const result=await client.query(`update public.presence set is_on_break='1',break_reason=$2,
        break_started_at=$3,break_expected_end_at=$4,locked=$5,lock_reason=$6,lock_message=$7,
        last_seen_at=$3,last_activity_at=$3,last_activity_source='break_started'
        where user_id=$1 returning *`,[req.user.user_id,reason,stamp,deadline,exempt?'0':'1',exempt?'':'break',exempt?'':'Break started. End the break to resume CRM access.']);
      const row={break_id:makeBreakId(req.user,stamp),user_id:String(req.user.user_id),username:String(req.user.username||''),
        full_name:String(req.user.full_name||req.user.username||''),reason,planned_minutes:String(plannedMinutes),started_at:stamp,
        expected_end_at:deadline,ended_at:'',actual_minutes:'0',status:'Open',lock_triggered:'0',created_at:stamp,updated_at:stamp};
      const keys=Object.keys(row);
      await client.query(`insert into public.break_sessions (${keys.map(k=>'"'+k+'"').join(',')})
        values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row));
      await cc725BreakAudit(client,req,'break_started',{reason,planned_minutes:plannedMinutes,break_started_at:stamp,break_expected_end_at:deadline},stamp);
      await client.query('COMMIT');committed=true;
      return {presence:result.rows[0],changed:true,exceeded:false};
    }
    const startedAt=String(p.break_started_at||'');
    const used=minutesBetween(startedAt,new Date(stamp));
    const prev=Math.max(0,Number(p.total_break_minutes||0)||0);
    const exceeded=Boolean(p.break_expected_end_at) && Date.parse(stamp)>=Date.parse(p.break_expected_end_at);
    const shouldLock=exceeded&&!exempt;
    const updates=await client.query(`update public.presence set is_on_break='0',break_reason=$2,
      break_started_at='',break_expected_end_at=$3,locked=$4,lock_reason=$5,lock_message=$6,
      unlock_grace_until=$7,total_break_minutes=$8,last_seen_at=$9,
      last_call_alert_sent_at='' where user_id=$1 returning *`,[
      req.user.user_id,shouldLock?(p.break_reason||'Break limit exceeded'):'',shouldLock?(p.break_expected_end_at||''):'',
      shouldLock?'1':'0',shouldLock?'break_exceeded':'',shouldLock?employeeLockMessage():'',
      shouldLock?'':addMinutes(stamp,15),String(prev+used),stamp]);
    const open=await client.query(`select break_id,reason from public.break_sessions where user_id=$1
      and lower(coalesce(status,'')) in ('open','active','on break')
      order by coalesce(started_at,created_at,'') desc limit 1 for update`,[req.user.user_id]);
    const row={break_id:String(open.rows[0]?.break_id||makeBreakId(req.user,startedAt)),user_id:String(req.user.user_id),
      username:String(req.user.username||''),full_name:String(req.user.full_name||req.user.username||''),
      reason:String(open.rows[0]?.reason||p.break_reason||'Break'),planned_minutes:String(Math.max(1,Math.round((Date.parse(p.break_expected_end_at)-Date.parse(startedAt))/60000)||5)),
      started_at:startedAt,expected_end_at:String(p.break_expected_end_at||''),ended_at:stamp,
      actual_minutes:String(used),status:exceeded?'Exceeded':'Ended',lock_triggered:shouldLock?'1':'0',
      created_at:startedAt,updated_at:stamp};
    const keys=Object.keys(row);
    await client.query(`insert into public.break_sessions (${keys.map(k=>'"'+k+'"').join(',')})
      values (${keys.map((_,i)=>'$'+(i+1)).join(',')})
      on conflict (break_id) do update set ended_at=excluded.ended_at,actual_minutes=excluded.actual_minutes,
      status=excluded.status,lock_triggered=excluded.lock_triggered,updated_at=excluded.updated_at`,Object.values(row));
    await cc725BreakAudit(client,req,exceeded?'break_exceeded':'break_ended',{break_minutes:used,leadership_bypass:exempt&&exceeded},stamp);
    await client.query('COMMIT');committed=true;
    return {presence:updates.rows[0],changed:true,exceeded,shouldLock};
  }catch(error){if(!committed)try{await client.query('ROLLBACK')}catch(_){}throw error}
  finally{client.release()}
}

async function startBreak(req, res) {
  const compact = wantsCompactResponse(req);
  const presence = (await store.findById('presence', 'user_id', req.user.user_id)) || null;
  if (!presence || !isToday(presence.work_started_at) || !await cc723ManualJoinProof(req.user.user_id,presence))
    return res.status(400).json({ message: 'Tap Join Office before starting a break.' });
  if (String(presence.is_on_break || '0') === '1') return res.json(compact ? await attendanceGateSnapshot(req, presence) : await attendanceSnapshot(req));
  const settings = await getSettingsMap();
  const reason = String(req.body.reason || 'Break').trim() || 'Break';
  const plannedMinutes = normalizePlannedBreakMinutes(req.body.planned_minutes, settings);
  const lockExempt = isLockExempt(req.user);
  if(store.pool){
    try{
      const result=await cc725PgBreak(req,'start',reason,plannedMinutes);
      return res.json(compact?await attendanceGateSnapshot(req,result.presence,settings):await attendanceSnapshot(req));
    }catch(error){
      console.error('[CC725 start break]',String(error?.code||'BREAK_FAILED'),String(error?.message||'').slice(0,180));
      return res.status(error?.status||503).json({message:error?.status?error.message:'Break was not saved. Please retry.'});
    }
  }
  const startedAt = nowIso();
  const expectedEndAt = new Date(Date.parse(startedAt) + plannedMinutes * 60 * 1000).toISOString(); // CC26_579: fixed absolute deadline
  await store.upsert('presence', 'user_id', {
    ...presence,
    is_on_break: '1',
    break_reason: reason,
    break_started_at: startedAt,
    break_expected_end_at: expectedEndAt,
    locked: lockExempt ? '0' : '1',
    lock_reason: lockExempt ? '' : 'break',
    lock_message: lockExempt ? '' : 'Break started. End the break to resume CRM access.',
    last_seen_at: nowIso(),
  });
  await recordBreakSessionStart(req.user, reason, plannedMinutes, startedAt, expectedEndAt);
  await logActivity(req, 'break_started', { reason, planned_minutes: plannedMinutes, break_started_at: startedAt, break_expected_end_at: expectedEndAt });
  const nextPresence = await store.findById('presence', 'user_id', req.user.user_id);
  return res.json(compact ? await attendanceGateSnapshot(req, nextPresence) : await attendanceSnapshot(req));
}

async function endBreak(req, res) {
  const compact = wantsCompactResponse(req);
  const existing = await store.findById('presence', 'user_id', req.user.user_id);
  if (!existing || !await cc723ManualJoinProof(req.user.user_id,existing))
    return res.status(400).json({ message: 'Tap Join Office first.' });
  if (String(existing.is_on_break || '0') !== '1') return res.json(compact ? await attendanceGateSnapshot(req, existing) : await attendanceSnapshot(req));
  if(store.pool){
    try{
      const result=await cc725PgBreak(req,'end');
      if(result.shouldLock) {
        try{await ensurePendingUnlockRequest(req,'Break limit exceeded. Please approve CRM unlock.');}
        catch(error){console.warn('[CC725 unlock request pending]',String(error?.code||'RETRY_REQUIRED'));}
      }
      if(req.__cc579_finalize_only)return result.presence;
      return res.json(compact?await attendanceGateSnapshot(req,result.presence):await attendanceSnapshot(req));
    }catch(error){
      console.error('[CC725 end break]',String(error?.code||'BREAK_FAILED'),String(error?.message||'').slice(0,180));
      if(req.__cc579_finalize_only)throw error;
      return res.status(error?.status||503).json({message:error?.status?error.message:'Break was not saved. Please retry.'});
    }
  }
  const breakEndedAt = nowIso();
  const usedMinutes = minutesBetween(existing.break_started_at, new Date(breakEndedAt));
  const priorBreak = Number(existing?.total_break_minutes || '0');
  const overrunMs = existing?.break_expected_end_at ? Date.now() - new Date(existing.break_expected_end_at).getTime() : 0;
  const settings = await getSettingsMap();
  const overrunGraceSeconds = 0;
  const exceeded = overrunMs >= 0 && Boolean(existing?.break_expected_end_at);
  const updates = {
    is_on_break: '0',
    break_reason: '',
    break_started_at: '',
    break_expected_end_at: '',
    last_seen_at: nowIso(),
    total_break_minutes: String(priorBreak + usedMinutes),
    last_call_alert_sent_at: '',
    lock_reason: '',
    lock_message: '',
    unlock_grace_until: '',
  };
  const lockExempt = isLockExempt(req.user);
  if (exceeded && !lockExempt) {
    updates.locked = '1';
    updates.break_reason = existing.break_reason || 'Break limit exceeded';
    updates.break_expected_end_at = existing.break_expected_end_at || '';
    updates.lock_reason = 'break_exceeded';
    updates.lock_message = employeeLockMessage();
    updates.unlock_grace_until = '';
    await logActivity(req, 'break_exceeded', { break_minutes: usedMinutes });
    await ensurePendingUnlockRequest(req, 'Break limit exceeded. Please approve CRM unlock.');
  } else {
    updates.locked = '0';
    updates.lock_reason = '';
    updates.lock_message = '';
    updates.unlock_grace_until = addMinutes(nowIso(), 15);
    await logActivity(req, exceeded ? 'break_exceeded' : 'break_ended', { break_minutes: usedMinutes, leadership_bypass: lockExempt && exceeded });
  }
  await recordBreakSessionEnd(req.user, existing.break_started_at, breakEndedAt, usedMinutes, exceeded, existing.break_reason || 'Break');
  await store.update('presence', 'user_id', req.user.user_id, updates);
  const nextPresence = await store.findById('presence', 'user_id', req.user.user_id);
  if (req.__cc579_finalize_only) return nextPresence;
  return res.json(compact ? await attendanceGateSnapshot(req, nextPresence) : await attendanceSnapshot(req));
}


function minutesSince(value) {
  const t = new Date(value || 0).getTime();
  if (!t) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function employeeLockMessage() {
  return 'CRM Access Paused. Please request unlock approval.';
}

async function recentActivityLogExists(user = {}, actionType = '', repeatMinutes = 15) {
  const userId = String(user.user_id || '').trim();
  const username = String(user.username || '').trim();
  const sinceIso = new Date(Date.now() - Math.max(1, Number(repeatMinutes || 15)) * 60 * 1000).toISOString();
  const action = String(actionType || '').trim().toLowerCase();
  if (!action) return false;
  try {
    if (store.pool) {
      const row = await store.one(`
        select count(*)::int as count
        from public.activity_log
        where coalesce(created_at,'') >= $1
          and lower(coalesce(action_type,'')) = $2
          and (user_id = $3 or lower(coalesce(username,'')) = lower($4))
      `, [sinceIso, action, userId, username]);
      return Number(row?.count || 0) > 0;
    }
  } catch {}
  try {
    return (await table('activity_log')).some((row) => String(row.created_at || '') >= sinceIso && String(row.action_type || '').toLowerCase() === action && (String(row.user_id || '') === userId || String(row.username || '').toLowerCase() === username.toLowerCase()));
  } catch { return false; }
}

async function callStatsForUserSince(user = {}, sinceValue = '') {
  const parsedSince = new Date(sinceValue || 0).getTime();
  const sinceIso = Number.isFinite(parsedSince) && parsedSince > 0 ? new Date(parsedSince).toISOString() : new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const userId = String(user.user_id || '').trim();
  const username = String(user.username || '').trim();
  const fullName = String(user.full_name || user.name || username || '').trim();
  const recruiterCode = String(user.recruiter_code || user.employee_code || user.user_id || user.username || '').trim();
  try {
    if (store.pool) {
      const callRows = await store.query(`
        select * from public.call_logs
        where coalesce(call_started_at, created_at, updated_at, '') >= $1
          and (
            coalesce(employee_user_id, '') = $2
            or lower(coalesce(employee_username, username, '')) = lower($3)
            or lower(coalesce(employee_name, recruiter_name, '')) = lower($4)
            or lower(coalesce(recruiter_code, '')) = lower($5)
          )
          and ${ATTENDANCE_CRM_CALL_EXISTS_SQL}
        order by coalesce(call_started_at, created_at, updated_at, '') desc
        limit 500
      `, [sinceIso, userId, username, fullName, recruiterCode]);
      return aggregateCallRows(callRows || []);
    }
  } catch {}
  try {
    const calls = (await table('call_logs')).filter((row) => {
      const stamp = String(row.call_started_at || row.created_at || row.updated_at || '');
      const sameUser = String(row.employee_user_id || row.user_id || row.owner_user_id || row.assigned_user_id || '') === userId;
      const sameUsername = String(row.employee_username || row.username || row.owner_username || row.assigned_username || '').toLowerCase() === username.toLowerCase();
      const sameName = String(row.employee_name || row.recruiter_name || row.full_name || row.name || '').toLowerCase() === fullName.toLowerCase();
      const sameCode = String(row.recruiter_code || row.employee_code || '').toLowerCase() === recruiterCode.toLowerCase();
      return stamp >= sinceIso && (sameUser || sameUsername || sameName || sameCode);
    });
    const localCandidates = await table('candidates');
    return aggregateCallRows(attendanceTrackedCalls(calls, localCandidates));
  } catch { return { calls_count: 0, connected_calls_count: 0, talktime_seconds: 0 }; }
}

async function recentCallStatsForUser(user = {}, windowMinutes = 60) {
  const sinceIso = new Date(Date.now() - Math.max(1, Number(windowMinutes || 60)) * 60 * 1000).toISOString();
  return callStatsForUserSince(user, sinceIso);
}

async function sendPerformanceAlert(req, actionType, title, message, metadata = {}, repeatMinutes = 15) {
  const already = await recentActivityLogExists(req.user, actionType, repeatMinutes);
  if (already) return false;
  await logActivity(req, actionType, metadata);
  await notifyLeadership(title, message, JSON.stringify({ user_id: req.user.user_id, open_path: '/approvals', ...metadata }));
  return true;
}

async function requestUnlock(req, res) {
  const compact = wantsCompactResponse(req);
  const note = String(req.body.note || req.body.employee_note || req.body.reason || '').trim();
  if (note.length < 5 || note.length > 500) return res.status(400).json({ message: 'Please write your reason (5–500 characters) before requesting access.' });
  let presence = await store.findById('presence', 'user_id', req.user.user_id);
  if (!presence) return res.status(409).json({ message: 'No attendance session found. Please sign in again.' });
  if (String(presence.is_on_break || '0') === '1') {
    const deadline = Date.parse(String(presence.break_expected_end_at || '')) || 0;
    if (!deadline || Date.now() < deadline) return res.status(409).json({ message: 'Break is still running. Use Join Work Now before it expires.' });
    // An expired break must be finalized exactly once, retaining the original deadline and actual duration.
    await endBreak({ ...req, __cc579_finalize_only: true }, res);
    presence = await store.findById('presence', 'user_id', req.user.user_id);
  }
  if (String(presence?.locked || '0') !== '1') return res.status(409).json({ message: 'Your CRM is not locked. Refresh the attendance status.' });
  const reason = `Employee access request | Reason: ${note}`;
  // The earlier automatic lock may have created a pending request. Update it with the
  // employee's actual explanation and notify eligible approvers on THIS explicit click.
  const result = await ensureUnlockRequestForUser(req.user, reason, { autoCreated: false, notifyExisting: true });
  if (!result?.item?.request_id) return res.status(503).json({ message: 'Request could not be saved. Please retry; your reason is preserved.' });
  try {
    await logActivity(req, 'unlock_requested', { request_id: result.item.request_id, employee_reason: note, manual_request: true });
  } catch (error) {
    try { console.warn('Unlock request audit log skipped:', error?.message || error); } catch {}
  }
  return res.json({ ...(compact ? await attendanceGateSnapshot(req) : await attendanceSnapshot(req)), request_sent: true, request_id: result.item.request_id });
}

async function ping(req, res) {
  const compact = wantsCompactResponse(req);
  const settings = await getSettingsMap();
  const existing = await store.findById('presence', 'user_id', req.user.user_id);
  const lockExempt = isLockExempt(req.user);
  const idleWarnMinutes = settingNumber(settings, 'crm_monitor_idle_warning_minutes', 5);
  const noCallWarnMinutes = settingNumber(settings, 'crm_monitor_no_call_warning_minutes', 15);
  const lowCallWindowMinutes = settingNumber(settings, 'crm_monitor_low_call_window_minutes', 60);
  const lowCallMinCalls = settingNumber(settings, 'crm_monitor_low_call_min_calls', 5);
  const monitorRepeatMinutes = settingNumber(settings, 'crm_monitor_alert_repeat_minutes', 15);
  const activityWindowMinutes = settingNumber(settings, 'crm_activity_window_minutes', 2);
  const idleMinutes = 10; // CC26_602: 10-minute absence; existing break-specific approval rules remain separate.
  const noCallMinutes = Number(settings.crm_lock_no_call_minutes || 20);
  const breakWarnMinutes = Number(settings.crm_lock_break_warning_minutes || 1);
  const breakOverrunGraceSeconds = 0;
  const nextPage = req.body.last_page || '/candidates';
  const now = Date.now();
  if (!existing || !await cc723ManualJoinProof(req.user.user_id,existing)) {
    // A pre-v723 ghost shift must not accumulate active minutes through ping.
    return res.json(compact ? await attendanceGateSnapshot(req, existing, settings) : await attendanceSnapshot(req));
  }

  const lastSeen = new Date(existing.last_seen_at || 0).getTime();
  const lastCall = new Date(existing.last_call_dial_at || existing.work_started_at || 0).getTime();
  const unlockGraceUntil = new Date(existing.unlock_grace_until || 0).getTime();
  const onBreak = String(existing.is_on_break || '0') === '1';
  const hasActivity = String(req.body.has_activity ?? req.body.activity_detected ?? '1') === '1' || req.body.has_activity === true;
  const lastActivityAt = String(req.body.last_activity_at || '').trim();
  const priorActiveMinutes = Math.max(0, Number(existing.total_work_minutes || 0) || 0);
  const elapsedSinceLastSeen = Math.max(0, minutesBetween(existing.last_seen_at || existing.last_activity_at || existing.work_started_at));
  const clientActivityMs = lastActivityAt ? new Date(lastActivityAt).getTime() : 0;
  const withinActivityGrace = Boolean(clientActivityMs && Number.isFinite(clientActivityMs) && (now - clientActivityMs) < Math.max(1, activityWindowMinutes) * 60 * 1000);
  const activeCredit = (!onBreak && (hasActivity || withinActivityGrace)) ? Math.max(1, Math.min(elapsedSinceLastSeen || 1, Math.max(1, activityWindowMinutes))) : 0;
  const updates = {
    last_page: nextPage,
    total_work_minutes: String(priorActiveMinutes + activeCredit),
  };
  if (!onBreak && hasActivity) {
    updates.last_seen_at = lastActivityAt || nowIso();
    updates.last_activity_at = lastActivityAt || nowIso();
    updates.last_activity_source = 'crm_browser_interaction';
  }

  const withinUnlockGrace = unlockGraceUntil && now < unlockGraceUntil;
  const lastMeaningfulActivity = new Date(existing.last_activity_at || existing.last_seen_at || existing.work_started_at || 0).getTime();
  const idleDurationMinutes = lastMeaningfulActivity ? Math.floor((now - lastMeaningfulActivity) / 60000) : 0;
  const noCallDurationMinutes = lastCall ? Math.floor((now - lastCall) / 60000) : 0;

  if (!lockExempt && !onBreak && existing.locked !== '1' && idleWarnMinutes > 0 && idleDurationMinutes >= idleWarnMinutes) {
    await sendPerformanceAlert(
      req,
      'idle_performance_warning',
      'Low activity warning',
      `${req.user.full_name || req.user.username} has no meaningful CRM activity for ${idleDurationMinutes} minutes.`,
      { reason: 'low_activity', idle_minutes: idleDurationMinutes, warning_after_minutes: idleWarnMinutes, page: nextPage },
      monitorRepeatMinutes,
    );
  }
  if (!lockExempt && !onBreak && existing.locked !== '1' && noCallWarnMinutes > 0 && noCallDurationMinutes >= noCallWarnMinutes) {
    await sendPerformanceAlert(
      req,
      'no_call_performance_warning',
      'No-call warning',
      `${req.user.full_name || req.user.username} has not dialed a call for ${noCallDurationMinutes} minutes.`,
      { reason: 'no_call_activity', no_call_minutes: noCallDurationMinutes, warning_after_minutes: noCallWarnMinutes, page: nextPage },
      monitorRepeatMinutes,
    );
  }
  const officeDurationMinutes = minutesSince(existing.work_started_at || existing.created_at);
  const lowCallCheckReady = officeDurationMinutes >= Math.max(noCallWarnMinutes || 0, Math.min(lowCallWindowMinutes || 0, 20));
  if (!lockExempt && !onBreak && existing.locked !== '1' && lowCallWindowMinutes > 0 && lowCallMinCalls > 0 && lowCallCheckReady) {
    const windowStats = await recentCallStatsForUser(req.user, lowCallWindowMinutes);
    const recentCalls = Number(windowStats.calls_count || 0) || 0;
    if (recentCalls < lowCallMinCalls) {
      await sendPerformanceAlert(
        req,
        'low_call_ratio_warning',
        'Low call ratio warning',
        `${req.user.full_name || req.user.username} has ${recentCalls}/${lowCallMinCalls} calls in the last ${lowCallWindowMinutes} minutes.`,
        { reason: 'low_call_ratio', calls: recentCalls, required_calls: lowCallMinCalls, window_minutes: lowCallWindowMinutes, connected_calls: Number(windowStats.connected_calls_count || 0) || 0 },
        monitorRepeatMinutes,
      );
    }
  }

  const shouldLockIdle = !lockExempt && !onBreak && existing.locked !== '1' && !withinUnlockGrace && lastMeaningfulActivity && idleMinutes > 0 && idleDurationMinutes >= idleMinutes;
  const shouldLockNoCall = false; // CC26_434: no-call is reported/warned, but only real 15-minute inactivity may auto-lock CRM

  if (shouldLockIdle) {
    updates.locked = '1';
    updates.lock_reason = 'idle';
    updates.lock_message = employeeLockMessage();
    updates.unlock_grace_until = '';
    await logActivity(req, 'crm_locked', { idle_minutes: idleMinutes, page: nextPage });
    await ensurePendingUnlockRequest(req, `Inactivity lock after ${idleDurationMinutes} minutes. Last activity: ${existing.last_activity_at || existing.last_seen_at || '-'}.`);
    await lockMobileAppForUser(req.user, 'idle_inactivity_crm_lock');
  }
  if (shouldLockNoCall) {
    updates.locked = '1';
    updates.lock_reason = 'no_call';
    updates.lock_message = employeeLockMessage();
    updates.unlock_grace_until = '';
    await logActivity(req, 'no_call_lock', { no_call_minutes: noCallMinutes, page: nextPage });
    await ensurePendingUnlockRequest(req, `No-call lock after ${noCallDurationMinutes} minutes. Last call: ${existing.last_call_dial_at || '-'}.`);
    await lockMobileAppForUser(req.user, 'no_call_crm_lock');
  }
  if (!lockExempt && onBreak && existing.break_expected_end_at && now >= new Date(existing.break_expected_end_at).getTime()) {
    const overrunSeconds = Math.floor((now - new Date(existing.break_expected_end_at).getTime()) / 1000);
    const lastAlert = new Date(existing.last_call_alert_sent_at || 0).getTime();
    if (overrunSeconds < breakOverrunGraceSeconds) {
      updates.lock_reason = 'break';
      updates.lock_message = `Break over time by ${overrunSeconds}s. Return before approval lock starts.`;
      if (!lastAlert || (now - lastAlert) > breakWarnMinutes * 60 * 1000) {
        updates.last_call_alert_sent_at = nowIso();
        await logActivity(req, 'over_break_alert', { reason: existing.break_reason || 'Break', overrun_seconds: overrunSeconds, grace_seconds: breakOverrunGraceSeconds });
      }
    } else {
      updates.locked = '1';
      updates.lock_reason = 'break_exceeded';
      updates.lock_message = employeeLockMessage();
      updates.unlock_grace_until = '';
      if (!lastAlert || (now - lastAlert) > breakWarnMinutes * 60 * 1000) {
        updates.last_call_alert_sent_at = nowIso();
        await logActivity(req, 'break_exceeded_lock', { reason: existing.break_reason || 'Break', overrun_seconds: overrunSeconds });
        await ensurePendingUnlockRequest(req, 'Break limit exceeded. Please approve CRM unlock.');
        await lockMobileAppForUser(req.user, 'break_exceeded_crm_lock');
      }
    }
  }
  await store.update('presence', 'user_id', req.user.user_id, updates);
  if (compact) {
    const nextPresence = await store.findById('presence', 'user_id', req.user.user_id);
    return res.json(await attendanceGateSnapshot(req, nextPresence, settings));
  }
  return res.json(await attendanceSnapshot(req));
}


function rangeBounds(range = 'today', dateValue = '') {
  const cleanRange = String(range || 'today').toLowerCase();
  const now = new Date();
  const today = dateKey(now);
  const date = String(dateValue || today).slice(0, 10);
  if (cleanRange === 'hour' || cleanRange === '1h' || cleanRange === 'one_hour') {
    return { from: new Date(Date.now() - 60 * 60 * 1000).toISOString(), to: now.toISOString(), label: 'Last 1 Hour' };
  }
  if (cleanRange === 'month') {
    const monthKey = date.slice(0, 7) || today.slice(0, 7);
    const from = new Date(`${monthKey}-01T00:00:00+05:30`);
    const to = new Date(from.getTime());
    to.setMonth(to.getMonth() + 1);
    return { from: from.toISOString(), to: to.toISOString(), label: 'This Month' };
  }
  const from = new Date(`${date}T00:00:00+05:30`);
  const to = new Date(`${date}T23:59:59+05:30`);
  return { from: from.toISOString(), to: to.toISOString(), label: date === today ? 'Today' : date };
}

function callMetricsFromRows(rows = []) {
  return aggregateCallRows(rows);
}

function summaryFromRangeLogs(presence, logs = [], settings = {}, metrics = {}, lateConsecutiveCount = 0, bounds = {}, breakRows = []) {
  const today = dateKey();
  const label = String(bounds?.label || '').toLowerCase();
  const isTodayRange = label === 'today' || (String(bounds?.from || '').slice(0, 10) === today && String(bounds?.to || '').slice(0, 10) === today);
  if (isTodayRange) return buildSummary(presence, settings, metrics, lateConsecutiveCount);

  const { fullDayMinutes } = attendanceThresholds(settings);
  const breakAllowanceMinutes = breakLimitMinutes(settings);
  const dailySalary = settingNumber(settings, 'attendance_daily_salary_amount', 0);
  const groups = new Map();
  const uniqueDays = new Set();
  for (const row of logs || []) {
    const stamp = row.created_at || row.updated_at || '';
    const ts = new Date(stamp || 0).getTime();
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const day = dateKey(stamp);
    uniqueDays.add(day);
    const employeeKey = String(row.user_id || row.username || row.employee_user_id || row.employee_username || 'unknown').trim().toLowerCase() || 'unknown';
    const groupKey = `${employeeKey}|${day}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { firstJoin: 0, firstAny: ts, lastAny: ts, breakMinutes: 0, breakCount: 0 });
    const g = groups.get(groupKey);
    g.firstAny = Math.min(g.firstAny || ts, ts);
    g.lastAny = Math.max(g.lastAny || ts, ts);
    const action = String(row.action_type || '').toLowerCase();
    if (action === 'join_work' || action === 'join_office') g.firstJoin = g.firstJoin ? Math.min(g.firstJoin, ts) : ts;
    if (action === 'break_started') g.breakCount += 1;
    if (action === 'break_ended' || action === 'break_exceeded' || action === 'break_exceeded_lock') {
      let meta = {};
      try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
      const mins = Number(meta.break_minutes || meta.minutes || meta.duration_minutes || 0);
      if (Number.isFinite(mins) && mins > 0) g.breakMinutes += Math.round(mins);
    }
  }

  let sessionMinutes = 0;
  let breakMinutes = 0;
  let breakCount = 0;
  for (const g of groups.values()) {
    const start = g.firstJoin || g.firstAny;
    const end = g.lastAny || start;
    sessionMinutes += Math.max(0, Math.round((end - start) / 60000));
    breakMinutes += Math.max(0, Math.round(g.breakMinutes || 0));
    breakCount += Math.max(0, Math.round(g.breakCount || 0));
  }
  const exactBreaks = aggregateBreakRows(breakRows || [], bounds?.from || 0, bounds?.to || 0);
  if (exactBreaks.break_count > 0) {
    breakMinutes = exactBreaks.total_break_minutes;
    breakCount = exactBreaks.break_count;
  }
  const productiveMinutes = Math.max(0, sessionMinutes - breakMinutes);
  // Historical range logs do not contain continuous mouse/keyboard telemetry.
  // Do not invent idle minutes from sparse events; keep the accounting identity exact.
  const idleMinutes = Math.max(0, sessionMinutes - breakMinutes - productiveMinutes);
  const talktimeMinutes = Math.floor((Number(metrics.talktime_seconds || 0) || 0) / 60);
  const joined = groups.size > 0;
  const dayStatus = uniqueDays.size > 1 || groups.size > 1 ? 'Range' : dayStatusFromMinutes(productiveMinutes, joined, settings, []);
  const payableRatio = dayStatus === 'Full Day' ? 1 : (dayStatus === 'Half Day' ? 0.5 : 0);
  return {
    joined_today: false,
    joined_at: '',
    session_minutes: String(sessionMinutes),
    office_duration_minutes: String(sessionMinutes),
    active_work_minutes: String(productiveMinutes),
    idle_minutes: String(idleMinutes),
    total_break_minutes: String(breakMinutes),
    productive_work_minutes: String(productiveMinutes),
    remaining_work_minutes: String(Math.max((groups.size || 1) * fullDayMinutes - productiveMinutes, 0)),
    remaining_break_minutes: String(Math.max((groups.size || 1) * breakAllowanceMinutes - breakMinutes, 0)),
    locked: presence?.locked || '0',
    day_status: dayStatus,
    payable_ratio: String(payableRatio),
    today_pay_estimate: String(Math.round(dailySalary * payableRatio)),
    talktime_minutes: String(talktimeMinutes),
    outgoing_talktime_minutes: String(Math.floor((Number(metrics.outgoing_talktime_seconds || 0) || 0) / 60)),
    incoming_talktime_minutes: String(Math.floor((Number(metrics.incoming_talktime_seconds || 0) || 0) / 60)),
    manual_calls_count: String(metrics.manual_calls_count || 0),
    auto_dialer_calls_count: String(metrics.auto_dialer_calls_count || 0),
    connected_calls_count: String(metrics.connected_calls_count || 0),
    not_connected_calls_count: String(metrics.not_connected_calls_count || 0),
    missed_calls_count: String(metrics.missed_calls_count || 0),
    outgoing_calls_count: String(metrics.outgoing_calls_count || 0),
    incoming_calls_count: String(metrics.incoming_calls_count || 0),
    calls_count: String(metrics.calls_count || 0),
    submissions_count: '0', selections_count: '0', interviews_count: '0', joinings_count: '0',
    late_consecutive_count: String(lateConsecutiveCount || 0),
    attendance_failed_rules: [],
    attendance_rules_effective_from: settings.attendance_rules_effective_from || '',
    attendance_rules_active: attendanceRulesActive(settings) ? '1' : '0',
    break_count: String(breakCount),
    range_days_count: String(uniqueDays.size || 0),
    employee_days_count: String(groups.size || 0),
  };
}

async function history(req, res) {
  const settings = await getSettingsMap();
  const bounds = rangeBounds(req.query.range || 'today', req.query.date || '');
  const userId = String(req.query.user_id || req.user.user_id || '').trim();
  const username = String(req.query.username || req.user.username || '').trim();
  const leadership = isLeadershipRole(req.user);
  const scopedUserId = leadership ? userId : String(req.user.user_id || '');
  const scopedUsername = leadership ? username : String(req.user.username || '');
  let calls = [];
  let logs = [];
  let breakRows = [];
  try {
    if (store.pool) {
      const callParams = [bounds.from, bounds.to];
      let callWhere = `coalesce(call_started_at, created_at, '') >= $1 and coalesce(call_started_at, created_at, '') <= $2`;
      if (scopedUserId || scopedUsername) {
        callParams.push(scopedUserId);
        callParams.push(scopedUsername);
        callWhere += ` and (employee_user_id = $${callParams.length - 1} or employee_username = $${callParams.length})`;
      }
      calls = await store.query(`select * from public.call_logs where ${callWhere} and ${ATTENDANCE_CRM_CALL_EXISTS_SQL} order by coalesce(call_started_at, created_at, '') desc`, callParams);
      const logParams = [bounds.from, bounds.to];
      let logWhere = `coalesce(created_at, '') >= $1 and coalesce(created_at, '') <= $2`;
      if (scopedUserId || scopedUsername) {
        logParams.push(scopedUserId);
        logParams.push(scopedUsername);
        logWhere += ` and (user_id = $${logParams.length - 1} or username = $${logParams.length})`;
      }
      logs = await store.query(`select * from public.activity_log where ${logWhere} and lower(coalesce(action_type,'')) in ('join_work','break_started','break_ended','break_exceeded','break_exceeded_lock','crm_locked','crm_unlocked','unlock_requested','over_break_alert','no_call_lock','call_started','call_logged','missed_call_logged') order by coalesce(created_at, '') desc`, logParams);
      const breakParams = [bounds.from, bounds.to];
      let breakWhere = `coalesce(started_at, created_at, '') <= $2 and (coalesce(ended_at,'') = '' or coalesce(ended_at,'') >= $1)`;
      if (scopedUserId || scopedUsername) {
        breakParams.push(scopedUserId);
        breakParams.push(scopedUsername);
        breakWhere += ` and (user_id = $${breakParams.length - 1} or lower(coalesce(username,'')) = lower($${breakParams.length}))`;
      }
      breakRows = await store.query(`select * from public.break_sessions where ${breakWhere} order by coalesce(started_at, created_at, '') desc`, breakParams).catch(() => []);
    } else {
      const inRange = (stamp) => String(stamp || '') >= bounds.from && String(stamp || '') <= bounds.to;
      const localCallRows = (await table('call_logs')).filter((row) => inRange(row.call_started_at || row.created_at) && (!scopedUserId || String(row.employee_user_id) === scopedUserId || String(row.employee_username) === scopedUsername));
      calls = attendanceTrackedCalls(localCallRows, await table('candidates')).sort((a, b) => String(b.call_started_at || b.created_at || '').localeCompare(String(a.call_started_at || a.created_at || '')));
      logs = (await table('activity_log')).filter((row) => inRange(row.created_at) && (!scopedUserId || String(row.user_id) === scopedUserId || String(row.username) === scopedUsername)).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      breakRows = (await table('break_sessions').catch(() => [])).filter((row) => {
        const start = new Date(row.started_at || row.created_at || 0).getTime();
        const end = new Date(row.ended_at || Date.now()).getTime();
        const rangeStart = new Date(bounds.from).getTime();
        const rangeEnd = new Date(bounds.to).getTime();
        const userMatch = !scopedUserId || String(row.user_id || '') === scopedUserId || String(row.username || '').toLowerCase() === scopedUsername.toLowerCase();
        return userMatch && start <= rangeEnd && end >= rangeStart;
      });
    }
  } catch {}
  const metrics = aggregateCallRows(calls);
  const presence = await store.findById('presence', 'user_id', scopedUserId || req.user.user_id);
  const lateCount = await consecutiveLateCountForUser(req.user, settings);
  const rangeSummary = summaryFromRangeLogs(presence, logs, settings, metrics, lateCount, bounds, breakRows);
  return res.json({ ok: true, manual_refresh_only: true, generated_at: nowIso(), range: bounds, summary: rangeSummary, call_summary: metrics, calls: calls.slice(0, 120), breaks: breakRows.slice(0, 120), logs: logs.slice(0, 120) });
}

async function logoutSummary(req, res) {
  const settings = await getSettingsMap();
  const rawPresence = await store.findById('presence', 'user_id', req.user.user_id);
  const presence = cc723SafePresence(rawPresence,await cc723ManualJoinProof(req.user.user_id,rawPresence));
  const metrics = await dailyStatsForUser(req.user, settings);
  metrics.missed_interviews_today = await missedInterviewsForUserNow(req.user);
  const lateCount = await consecutiveLateCountForUser(req.user, settings);
  const summary = buildSummary(presence, settings, metrics, lateCount);
  summary.missed_interviews_today = String(metrics.missed_interviews_today || 0);
  summary.attendance_report = buildAttendanceReportPayload(req.user, summary, settings, '');
  return res.json({ summary, presence });
}

async function sendReport(req, res) {
  const settings = await getSettingsMap();
  const rawPresence = await store.findById('presence', 'user_id', req.user.user_id);
  const presence = cc723SafePresence(rawPresence,await cc723ManualJoinProof(req.user.user_id,rawPresence));
  const metrics = await dailyStatsForUser(req.user, settings);
  metrics.missed_interviews_today = await missedInterviewsForUserNow(req.user);
  const lateCount = await consecutiveLateCountForUser(req.user, settings);
  const summary = buildSummary(presence, settings, metrics, lateCount);
  summary.missed_interviews_today = String(metrics.missed_interviews_today || 0);
  const notes = String(req.body?.notes || req.body?.employee_note || '').trim();
  const report = await createOrUpdateAttendanceReport(req, summary, notes);
  const payload = buildAttendanceReportPayload(req.user, summary, settings, notes);
  const message = `${req.user.full_name || req.user.username} sent attendance report for manager approval. Status: ${payload.productivity_status}.`;
  await notifyLeadership('Attendance report approval pending', message, JSON.stringify({ user_id: req.user.user_id, report_id: report?.report_id || '', open_path: '/approvals' }));
  await makeNotification(req.user.user_id, 'Report sent', 'Your attendance report was sent for manager approval.', 'attendance', JSON.stringify({ open_path: '/attendance', report_id: report?.report_id || '' }));
  await logActivity(req, 'attendance_report_sent', { report_id: report?.report_id || '', notes, summary });
  return res.json({ ok: true, summary, report_id: report?.report_id || '', attendance_report: payload });
}

module.exports = {
  getOne,
  join,
  startBreak,
  endBreak,
  requestUnlock,
  ping,
  history,
  logoutSummary,
  sendReport,
};
