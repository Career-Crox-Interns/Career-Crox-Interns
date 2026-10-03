const IST_OFFSET_MS = 330 * 60 * 1000;

function low(value) {
  return String(value || '').trim().toLowerCase();
}

function int(value, fallback = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

function parseTs(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? t : 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function istDateKey(value = Date.now()) {
  const t = typeof value === 'number' ? value : parseTs(value);
  if (!t) return '';
  const d = new Date(t + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isTodayIst(value) {
  return Boolean(value && istDateKey(value) === istDateKey(Date.now()));
}

function istDayBounds(value = Date.now()) {
  const key = istDateKey(value);
  if (!key) return { key: '', startMs: 0, endMs: 0, startIso: '', endIso: '' };
  const startMs = Date.parse(`${key}T00:00:00.000+05:30`);
  const endMs = Number.isFinite(startMs) ? startMs + 24 * 60 * 60 * 1000 : 0;
  return {
    key,
    startMs,
    endMs,
    startIso: Number.isFinite(startMs) ? new Date(startMs).toISOString() : '',
    endIso: endMs ? new Date(endMs).toISOString() : '',
  };
}

function minutesBetween(from, to = Date.now()) {
  const start = parseTs(from);
  const end = typeof to === 'number' ? to : parseTs(to);
  if (!start || !end || end < start) return 0;
  return Math.round((end - start) / 60000);
}

function settingsNumber(settings = {}, key, fallback) {
  const n = Number(settings?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function attendanceThresholds(settings = {}) {
  return {
    fullDayMinutes: settingsNumber(settings, 'attendance_full_day_work_minutes', 540),
    zeroDayMinutes: settingsNumber(settings, 'attendance_zero_day_work_minutes', 300),
    // Business rule: 9h full day; below 5h zero; every worked time from 5h to below 9h is half day.
    halfDayMinutes: settingsNumber(settings, 'attendance_min_half_day_work_minutes', settingsNumber(settings, 'attendance_half_day_work_minutes', settingsNumber(settings, 'attendance_zero_day_work_minutes', 300))),
  };
}

function normalizedStatusText(value = '') {
  return low(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function missedStatus(value = '') {
  const s = normalizedStatusText(value);
  if (!s) return false;
  return s === 'miss' || s === 'missed' || s.includes('missed call') || s.includes('call missed') || s.includes('missed');
}

function negativeStatus(value = '') {
  const s = normalizedStatusText(value);
  if (!s) return false;
  return (
    s.includes('not connected') || s.includes('not connect') || s.includes('disconnect') ||
    s.includes('employee cut') || s.includes('cut suspect') || s.includes('cut suspected') ||
    s.includes('early cut') || s.includes('short ring') || s.includes('ring window') ||
    missedStatus(s) || s.includes('fail') || s.includes('busy') || s.includes('reject') ||
    s.includes('cancel') || s.includes('decline') || s.includes('no answer') || s.includes('unanswered') ||
    s.includes('switched off') || s.includes('invalid') || s.includes('wrong number')
  );
}

function connectedStatus(value) {
  const s = normalizedStatusText(value);
  if (!s || negativeStatus(s)) return false;
  return s === 'connected' || s === 'answered' || s === 'completed' || s === 'success' || s.includes('answered') || s.includes('completed') || s.includes('success') || s.includes('connected');
}

function callDirection(row = {}) {
  const s = normalizedStatusText(`${row.direction || ''} ${row.call_type || ''} ${row.status || ''} ${row.call_status || ''}`);
  // A missed/rejected phone call is still an incoming call. Keep missed as a
  // separate status metric, but count it inside Incoming so Total = Incoming + Outgoing.
  if (missedStatus(s) || s.includes('incoming') || s.includes('inbound')) return 'incoming';
  return 'outgoing';
}

function talkDurationSeconds(row = {}, status = '') {
  const explicitTalk = int(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0);
  if (explicitTalk > 0) return explicitTalk;
  if (status !== 'connected') return 0;
  return int(row.duration_seconds || row.call_duration_seconds || row.duration || 0);
}

function callStatus(row = {}) {
  const statusText = `${row.status || ''} ${row.call_status || ''} ${row.outcome || ''} ${row.call_quality || ''}`;
  const dir = callDirection(row);
  const statusLow = normalizedStatusText(statusText);
  const explicitTalk = int(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0);
  const totalDuration = int(row.duration_seconds || row.call_duration_seconds || row.duration || 0);
  const answeredAt = String(row.answered_at || '').trim();
  const negative = negativeStatus(statusText);

  if (missedStatus(statusLow) || missedStatus(`${row.direction || ''} ${row.call_type || ''}`)) return 'missed';
  // A live dial is already an outgoing call, but it is not a failed/not-connected call yet.
  if ((statusLow.includes('calling') || statusLow === 'dialing' || statusLow === 'dialled' || statusLow === 'dialed') && !String(row.call_ended_at || '').trim()) return 'calling';
  if (connectedStatus(statusText)) return 'connected';
  if (explicitTalk > 0) return 'connected';
  // duration_seconds can be ring duration for Not Connected rows, so never promote a negative status.
  if (!negative && (answeredAt || totalDuration > 0) && !statusLow.includes('dialed')) return 'connected';
  if (dir === 'incoming') return 'incoming_unanswered';
  return 'not_connected';
}

function callMetricForRow(row = {}) {
  const dir = callDirection(row);
  const status = callStatus(row);
  const talktime = talkDurationSeconds(row, status);
  const sourceText = low(`${row.call_source || ''} ${row.source_mode || ''} ${row.synced_from || ''}`);
  return {
    calls_count: 1,
    connected_calls_count: status === 'connected' ? 1 : 0,
    not_connected_calls_count: (dir === 'outgoing' && status !== 'connected' && status !== 'missed' && status !== 'calling') ? 1 : 0,
    incoming_calls_count: dir === 'incoming' ? 1 : 0,
    outgoing_calls_count: dir === 'outgoing' ? 1 : 0,
    missed_calls_count: status === 'missed' ? 1 : 0,
    talktime_seconds: talktime,
    outgoing_talktime_seconds: (dir === 'outgoing' && status === 'connected') ? talktime : 0,
    incoming_talktime_seconds: (dir === 'incoming' && status === 'connected') ? talktime : 0,
    manual_calls_count: sourceText.includes('manual') ? 1 : 0,
    auto_dialer_calls_count: sourceText.includes('auto') ? 1 : 0,
  };
}

function emptyCallMetrics() {
  return {
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
  };
}

function addCallMetrics(target = emptyCallMetrics(), patch = {}) {
  const out = target;
  for (const key of Object.keys(emptyCallMetrics())) out[key] = int(out[key]) + int(patch[key]);
  return out;
}

function stableCallKey(row = {}) {
  const id = String(row.call_log_id || row.id || '').trim();
  if (id) return `id:${id}`;
  const phone = String(row.phone || row.mobile || row.number || row.candidate_phone || '').replace(/\D+/g, '').slice(-10);
  const stamp = String(row.call_started_at || row.started_at || row.created_at || row.date || '').trim();
  const user = String(row.employee_user_id || row.employee_username || row.employee_name || row.user_id || row.username || '').trim().toLowerCase();
  return phone && stamp ? `fallback:${user}:${phone}:${stamp}` : '';
}

function normalizePhone10(value = '') {
  return String(value || '').replace(/\D+/g, '').slice(-10);
}

function callEmployeeKey(row = {}) {
  return low(row.employee_user_id || row.employee_username || row.employee_name || row.user_id || row.username || row.recruiter_code || '');
}

function callTimestampMs(row = {}) {
  return parseTs(row.call_started_at || row.started_at || row.created_at || row.updated_at || row.call_ended_at || '');
}

function isAndroidPhoneLog(row = {}) {
  return String(row.call_log_id || '').startsWith('PHONELOG-') || low(`${row.synced_from || ''} ${row.call_source || ''} ${row.source_mode || ''}`).includes('android_phone_call_log');
}

function isLiveCallPlaceholder(row = {}) {
  const status = normalizedStatusText(`${row.status || ''} ${row.call_status || ''}`);
  return status.includes('calling') && !String(row.call_ended_at || '').trim() && !isAndroidPhoneLog(row);
}

function callRowScore(row = {}) {
  let score = 0;
  if (isAndroidPhoneLog(row)) score += 100;
  if (String(row.call_log_available || '') === '1') score += 35;
  if (String(row.call_ended_at || '').trim()) score += 20;
  if (!normalizedStatusText(row.status || '').includes('calling')) score += 16;
  if (int(row.duration_seconds || row.talktime_seconds || 0) > 0) score += 12;
  if (String(row.candidate_id || '').trim()) score += 5;
  return score;
}

function samePhysicalCall(a = {}, b = {}) {
  const ap = normalizePhone10(a.phone || a.mobile || a.number || a.candidate_phone || '');
  const bp = normalizePhone10(b.phone || b.mobile || b.number || b.candidate_phone || '');
  if (!ap || ap !== bp) return false;
  const ae = callEmployeeKey(a);
  const be = callEmployeeKey(b);
  if (ae && be && ae !== be) return false;
  const at = callTimestampMs(a);
  const bt = callTimestampMs(b);
  if (!at || !bt) return false;
  const diff = Math.abs(at - bt);
  const aid = String(a.call_log_id || a.id || '').trim();
  const bid = String(b.call_log_id || b.id || '').trim();
  if (aid && bid && aid === bid) return true;
  // Two Android phone-log rows are separate physical calls even if very close together.
  if (isAndroidPhoneLog(a) && isAndroidPhoneLog(b)) return false;
  // Merge app-side placeholder/finish rows with the later authoritative Android CallLog proof.
  if ((isLiveCallPlaceholder(a) || isLiveCallPlaceholder(b)) && diff <= 90000) return true;
  if ((isAndroidPhoneLog(a) || isAndroidPhoneLog(b)) && diff <= 45000) return true;
  return false;
}

function dedupeCallRows(inputRows = []) {
  const byId = new Map();
  for (const row of inputRows || []) {
    const id = String(row.call_log_id || row.id || '').trim();
    if (!id) continue;
    const old = byId.get(id);
    if (!old || callRowScore(row) >= callRowScore(old)) byId.set(id, row);
  }
  const rows = (inputRows || []).filter((row) => {
    const id = String(row.call_log_id || row.id || '').trim();
    return !id || byId.get(id) === row;
  }).sort((a, b) => callTimestampMs(a) - callTimestampMs(b));
  const out = [];
  for (const row of rows) {
    const idx = out.findIndex((old) => samePhysicalCall(old, row));
    if (idx >= 0) {
      if (callRowScore(row) >= callRowScore(out[idx])) out[idx] = { ...out[idx], ...row };
    } else {
      out.push(row);
    }
  }
  return out.sort((a, b) => callTimestampMs(b) - callTimestampMs(a));
}

function aggregateCallRows(rows = []) {
  const out = emptyCallMetrics();
  for (const row of dedupeCallRows(rows)) addCallMetrics(out, callMetricForRow(row));
  return out;
}

function presenceMinutes(row = {}, nowMs = Date.now()) {
  // CC26_725: login/heartbeat must NEVER masquerade as a human-confirmed
  // office join. The attendance controller masks work_started_at until the
  // durable explicit-join audit exists; respect that mask in every report.
  // `total_work_minutes` is meaningful work, not the office/session duration.
  const start = parseTs(row.work_started_at || '');
  if (!start) return {
    session_minutes: 0, office_duration_minutes: 0, total_work_minutes: 0,
    active_work_minutes: 0, productive_work_minutes: 0, productive_minutes: 0,
    total_break_minutes: 0, active_break_minutes: 0, grace_minutes: 0,
    idle_minutes: 0,
  };
  const safeEnd = Math.max(start || 0, Number(nowMs || Date.now()));
  const hasSavedActive = Object.prototype.hasOwnProperty.call(row || {}, 'total_work_minutes')
    && String(row.total_work_minutes ?? '').trim() !== '';
  const savedActive = Math.max(0, int(row.total_work_minutes || 0));
  const session = Math.max(0, Math.round((safeEnd - start) / 60000));

  const savedBreak = Math.max(0, int(row.total_break_minutes || 0));
  const activeBreak = String(row.is_on_break || '0') === '1'
    ? Math.max(0, minutesBetween(row.break_started_at, safeEnd))
    : 0;
  const totalBreak = Math.min(session, Math.max(0, savedBreak + activeBreak));
  const available = Math.max(0, session - totalBreak);
  const productive = Math.max(0, Math.min(available, hasSavedActive ? savedActive : available));
  const unaccounted = Math.max(0, available - productive);
  const graceMinutes = Math.min(Math.max(0, int(row.activity_grace_minutes || 2)), unaccounted);
  const idle = Math.max(0, unaccounted - graceMinutes);

  return {
    session_minutes: session,
    office_duration_minutes: session,
    total_work_minutes: productive,
    active_work_minutes: productive,
    productive_work_minutes: productive,
    productive_minutes: productive, // compatibility alias used by Performance/OPS.
    total_break_minutes: totalBreak,
    active_break_minutes: Math.min(totalBreak, activeBreak),
    grace_minutes: graceMinutes,
    idle_minutes: idle,
  };
}

function aggregateBreakRows(rows = [], rangeFrom = 0, rangeTo = 0, nowMs = Date.now()) {
  const from = typeof rangeFrom === 'number' ? rangeFrom : parseTs(rangeFrom);
  const toParsed = typeof rangeTo === 'number' ? rangeTo : parseTs(rangeTo);
  const to = toParsed || nowMs;
  const byId = new Map();
  const loose = [];
  for (const row of rows || []) {
    const id = String(row.break_id || row.id || '').trim();
    if (id) byId.set(id, row); else loose.push(row);
  }
  const unique = [...byId.values(), ...loose];
  let totalMinutes = 0;
  let count = 0;
  const windows = [];
  for (const row of unique) {
    const start = parseTs(row.started_at || row.break_started_at || row.created_at || '');
    if (!start) continue;
    let end = parseTs(row.ended_at || row.break_ended_at || '');
    if (!end) end = Math.min(nowMs, to);
    const overlapStart = Math.max(start, from || start);
    const overlapEnd = Math.min(end, to || end);
    if (!overlapEnd || overlapEnd <= overlapStart) continue;
    const mins = Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
    totalMinutes += mins;
    count += 1;
    windows.push({
      break_id: String(row.break_id || row.id || ''),
      started_at: new Date(overlapStart).toISOString(),
      ended_at: new Date(overlapEnd).toISOString(),
      actual_minutes: mins,
      reason: String(row.reason || row.break_reason || ''),
      status: String(row.status || ''),
    });
  }
  return { total_break_minutes: totalMinutes, break_count: count, windows };
}

function dayStatusFromMinutes(productiveMinutes, joined, settings = {}, failedRules = []) {
  if (!joined) return 'No Work Day';
  const { fullDayMinutes, halfDayMinutes, zeroDayMinutes } = attendanceThresholds(settings);
  const mins = int(productiveMinutes);
  if (mins < zeroDayMinutes) return 'Zero Day';
  if (mins >= fullDayMinutes && !(failedRules || []).length) return 'Full Day';
  if (mins >= halfDayMinutes) return 'Half Day';
  return 'Zero Day';
}

module.exports = {
  low,
  int,
  parseTs,
  istDateKey,
  isTodayIst,
  istDayBounds,
  minutesBetween,
  settingsNumber,
  attendanceThresholds,
  missedStatus,
  negativeStatus,
  connectedStatus,
  callDirection,
  callStatus,
  callMetricForRow,
  emptyCallMetrics,
  addCallMetrics,
  dedupeCallRows,
  aggregateCallRows,
  aggregateBreakRows,
  presenceMinutes,
  dayStatusFromMinutes,
};
