import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const BREAK_TYPES = ['Tea Break', 'Washroom Break', 'Lunch Break', 'Meeting Break', 'Custom Break'];
const PRESET_MINUTES = ['5', '10', '15', '20', '30', '45', '60'];
const HISTORY_RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'hour', label: 'Last 1 Hour' },
  { value: 'month', label: 'This Month' },
  { value: 'day', label: 'Selected Day' },
];

const SESSION_TIMER_KEY = 'cc456_session_activity_state';
const SESSION_ACTIVITY_KEY = 'cc434_work_activity_at';
const SESSION_LOGIN_AT_KEY = 'careerCroxSessionLoginAt';
const OFFICE_JOIN_SESSION_KEY = 'careerCroxOfficeJoinedSession';
const SESSION_IDLE_GRACE_MS = 2 * 60 * 1000;

function readLocalJson(key) {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function currentSessionMeta(user = {}) {
  if (typeof window === 'undefined') return null;
  try {
    const identity = String(user?.user_id || user?.recruiter_code || user?.username || '').trim();
    const loginMarker = String(window.localStorage.getItem(SESSION_LOGIN_AT_KEY) || '').trim();
    const joined = readLocalJson(OFFICE_JOIN_SESSION_KEY);
    if (!identity || !loginMarker || !joined || joined.identity !== identity || !joined.joined_at || !joined.manual_confirmed_at) return null;
    const loginMs = Number(loginMarker || 0) || 0;
    const joinedMs = new Date(joined.joined_at || 0).getTime() || 0;
    const officeMs = joinedMs;
    if (!officeMs || !Number.isFinite(officeMs)) return null;
    return { identity, loginMarker, loginMs: loginMs || officeMs, joinedMs: joinedMs || officeMs, officeMs, joinedAt: new Date(officeMs).toISOString() };
  } catch { return null; }
}

function rememberCurrentOfficeJoin(user = {}) {
  if (typeof window === 'undefined') return '';
  try {
    const identity = String(user?.user_id || user?.recruiter_code || user?.username || '').trim();
    const loginMarker = String(window.localStorage.getItem(SESSION_LOGIN_AT_KEY) || '').trim();
    if (!identity || !loginMarker) return '';
    const joinedAt = new Date().toISOString();
    window.localStorage.setItem(OFFICE_JOIN_SESSION_KEY, JSON.stringify({ identity, login_marker: loginMarker, joined_at: joinedAt }));
    window.localStorage.removeItem(SESSION_ACTIVITY_KEY);
    window.localStorage.removeItem(SESSION_TIMER_KEY);
    window.dispatchEvent(new CustomEvent('career-crox-office-joined'));
    return joinedAt;
  } catch { return ''; }
}

function sessionCallOverlay(raw = {}) {
  const call = raw && typeof raw === 'object' ? raw : {};
  return {
    calls_count: String(Number(call.calls_count || 0) || 0),
    connected_calls_count: String(Number(call.connected_calls_count || 0) || 0),
    not_connected_calls_count: String(Number(call.not_connected_calls_count || 0) || 0),
    incoming_calls_count: String(Number(call.incoming_calls_count || 0) || 0),
    outgoing_calls_count: String(Number(call.outgoing_calls_count || 0) || 0),
    missed_calls_count: String(Number(call.missed_calls_count || 0) || 0),
    manual_calls_count: String(Number(call.manual_calls_count || 0) || 0),
    auto_dialer_calls_count: String(Number(call.auto_dialer_calls_count || 0) || 0),
    talktime_minutes: String(Math.floor((Number(call.talktime_seconds || 0) || 0) / 60)),
    outgoing_talktime_minutes: String(Math.floor((Number(call.outgoing_talktime_seconds || 0) || 0) / 60)),
    incoming_talktime_minutes: String(Math.floor((Number(call.incoming_talktime_seconds || 0) || 0) / 60)),
  };
}

function currentSessionAttendanceStats(stats = {}, presence = {}, user = {}, liveTracker = null, sessionCallStats = null) {
  const meta = currentSessionMeta(user);
  if (!meta) {
    return {
      ...stats,
      ...sessionCallOverlay(sessionCallStats || {}),
      joined_today: false,
      joined_at: '',
      login_at: '',
      session_minutes: '0',
      office_duration_minutes: '0',
      active_work_minutes: '0',
      idle_minutes: '0',
      grace_minutes: '0',
      total_work_minutes: '0',
      total_break_minutes: '0',
      productive_work_minutes: '0',
      remaining_work_minutes: '540',
      day_status: 'No Work Day',
      session_scope: 'daily_office_session',
    };
  }

  const nowMs = Date.now();
  const officeElapsedMs = Math.max(0, nowMs - meta.officeMs);
  const loginElapsedMs = Math.max(0, nowMs - meta.loginMs);
  const stored = liveTracker && typeof liveTracker === 'object' ? liveTracker : readLocalJson(SESSION_TIMER_KEY);
  const trackerValid = Boolean(stored && String(stored.identity || '') === meta.identity && Number(stored.version || 0) >= 456);
  let activeMs = trackerValid ? Math.max(0, Number(stored.active_ms || 0) || 0) : 0;
  let idleMs = trackerValid ? Math.max(0, Number(stored.idle_ms || 0) || 0) : 0;
  let breakMs = trackerValid ? Math.max(0, Number(stored.break_ms || 0) || 0) : 0;
  let graceMs = trackerValid ? Math.max(0, Number(stored.grace_ms || 0) || 0) : Math.min(officeElapsedMs, SESSION_IDLE_GRACE_MS);

  if (trackerValid) {
    const lastTick = Math.max(meta.officeMs, Math.min(nowMs, Number(stored.last_tick_at || nowMs) || nowMs));
    const pendingMs = Math.max(0, nowMs - lastTick);
    if (pendingMs > 0) {
      const onBreakNow = String(presence?.is_on_break || '0') === '1';
      const lockedNow = String(presence?.locked || '0') === '1' && !onBreakNow;
      let lastActivityMs = Math.max(0, Number(stored.last_activity_at || 0) || 0);
      try {
        const localActivity = Number(window.localStorage.getItem(SESSION_ACTIVITY_KEY) || 0) || 0;
        if (localActivity >= meta.officeMs) lastActivityMs = Math.max(lastActivityMs, localActivity);
      } catch {}
      const recentActivity = Boolean(lastActivityMs && nowMs - lastActivityMs < SESSION_IDLE_GRACE_MS);
      if (onBreakNow) breakMs += pendingMs;
      else if (lockedNow) idleMs += pendingMs;
      else if (recentActivity) activeMs += pendingMs;
      else if (officeElapsedMs <= SESSION_IDLE_GRACE_MS) graceMs += pendingMs;
      else idleMs += pendingMs;
    }
  } else {
    const activeBreakStart = String(presence?.is_on_break || '0') === '1' ? Math.max(meta.officeMs, new Date(presence?.break_started_at || nowMs).getTime() || nowMs) : 0;
    if (activeBreakStart) breakMs = Math.max(0, nowMs - activeBreakStart);
    idleMs = Math.max(0, officeElapsedMs - graceMs - breakMs);
  }

  const maxNonBreakMs = Math.max(0, officeElapsedMs - breakMs);
  activeMs = Math.min(activeMs, maxNonBreakMs);
  graceMs = Math.min(graceMs, Math.max(0, maxNonBreakMs - activeMs));
  idleMs = Math.max(0, Math.min(idleMs, Math.max(0, officeElapsedMs - breakMs - activeMs - graceMs)));
  const accountedMs = activeMs + idleMs + breakMs + graceMs;
  if (accountedMs < officeElapsedMs) idleMs += officeElapsedMs - accountedMs;

  const officeMinutes = Math.floor(officeElapsedMs / 60000);
  const activeMinutes = Math.floor(activeMs / 60000);
  const idleMinutes = Math.floor(idleMs / 60000);
  const breakMinutes = Math.floor(breakMs / 60000);
  const graceMinutes = Math.floor(graceMs / 60000);
  const hasFailedRules = Array.isArray(stats?.attendance_failed_rules) && stats.attendance_failed_rules.length > 0;
  const dayStatus = activeMinutes >= 540 && !hasFailedRules ? 'Full Day' : activeMinutes >= 300 ? 'Half Day' : 'Zero Day';

  return {
    ...stats,
    ...sessionCallOverlay(sessionCallStats || {}),
    joined_today: true,
    joined_at: meta.joinedAt,
    login_at: new Date(meta.loginMs).toISOString(),
    login_elapsed_minutes: String(Math.floor(loginElapsedMs / 60000)),
    session_minutes: String(officeMinutes),
    office_duration_minutes: String(officeMinutes),
    active_work_minutes: String(activeMinutes),
    idle_minutes: String(idleMinutes),
    grace_minutes: String(graceMinutes),
    total_work_minutes: String(activeMinutes),
    total_break_minutes: String(breakMinutes),
    productive_work_minutes: String(activeMinutes),
    remaining_work_minutes: String(Math.max(0, 540 - activeMinutes)),
    day_status: dayStatus,
    session_scope: 'daily_office_session',
  };
}

function formatMinutes(total) {
  const mins = Math.max(0, Number(total || 0) || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatBreakDurationLabel(total) {
  const mins = Math.max(1, Number(total || 0) || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return m ? `${h}h ${m}m` : `${h}h`;
  return `${mins}m`;
}

function clampCustomBreakMinutes(value) {
  const raw = Math.round(Number(value || 0));
  if (!Number.isFinite(raw)) return 10;
  return Math.max(1, Math.min(raw, 480));
}

function formatSeconds(total) {
  return formatMinutes(Math.floor((Number(total || 0) || 0) / 60));
}

function formatClock(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { hour12: true, year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function todayLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function buildTimer(targetIso) {
  if (!targetIso) return { overdue: false, text: '00:00:00' };
  const diff = new Date(targetIso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const hrs = String(Math.floor(abs / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((abs % 60000) / 1000)).padStart(2, '0');
  return { overdue: diff < 0, text: `${hrs}:${mins}:${secs}` };
}



function buildBreakMeter(presence = {}, timer = {}) {
  const startedAt = new Date(presence.break_started_at || 0).getTime();
  const expectedAt = new Date(presence.break_expected_end_at || 0).getTime();
  const now = Date.now();
  const plannedMs = startedAt && expectedAt && expectedAt > startedAt ? expectedAt - startedAt : 0;
  const elapsedMs = plannedMs ? Math.max(0, now - startedAt) : 0;
  const rawPercent = plannedMs ? Math.round((elapsedMs / plannedMs) * 100) : (timer.overdue ? 100 : 0);
  const percent = Math.max(0, Math.min(130, rawPercent));
  const overdueSeconds = expectedAt && now > expectedAt ? Math.floor((now - expectedAt) / 1000) : 0;
  const lockAfterSeconds = 0;
  const lockLeftSeconds = Math.max(0, lockAfterSeconds - overdueSeconds);
  const level = percent >= 100 ? 'exceeded' : expectedAt && expectedAt - now <= 60000 ? 'critical' : percent >= 90 ? 'warning' : 'safe';
  const leftMins = Math.floor(lockLeftSeconds / 60);
  const leftSecs = String(lockLeftSeconds % 60).padStart(2, '0');
  return {
    percent,
    level,
    overdueSeconds,
    lockAfterSeconds,
    lockLeftText: `${leftMins}:${leftSecs}`,
    label: level === 'exceeded'
      ? 'Break expired. Approval needed to return'
      : level === 'critical'
        ? 'Critical: break time is almost over'
        : level === 'warning'
          ? 'Warning: 90% break time used'
          : 'Break timer running normally',
  };
}

function MetricCard({ label, value, tone = 'blue', helper }) {
  return (
    <div className={`metric-card colorful-card fade-up attendance-metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}

function safeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

const EMPTY_TODAY_STATS = {
  joined_today: false,
  joined_at: '',
  session_minutes: '0',
  office_duration_minutes: '0',
  active_work_minutes: '0',
  idle_minutes: '0',
  total_break_minutes: '0',
  productive_work_minutes: '0',
  remaining_work_minutes: '540',
  remaining_break_minutes: '60',
  locked: '0',
  day_status: 'No Work Day',
  payable_ratio: '0',
  today_pay_estimate: '0',
  talktime_minutes: '0',
  outgoing_talktime_minutes: '0',
  incoming_talktime_minutes: '0',
  manual_calls_count: '0',
  auto_dialer_calls_count: '0',
  connected_calls_count: '0',
  not_connected_calls_count: '0',
  missed_calls_count: '0',
  outgoing_calls_count: '0',
  incoming_calls_count: '0',
  calls_count: '0',
  submissions_count: '0',
  selections_count: '0',
  interviews_count: '0',
  joinings_count: '0',
  break_count: '0',
  attendance_failed_rules: [],
};

const EMPTY_ATTENDANCE_STATE = {
  presence: { locked: '0', is_on_break: '0', lock_reason: '', lock_message: '', break_reason: '', break_expected_end_at: '', work_started_at: '' },
  requests: [],
  team_working: [],
  logs: [],
  all_logs: [],
  settings: { break_limit_minutes: 60, crm_lock_idle_minutes: 5, crm_lock_no_call_minutes: 10 },
  today_stats: EMPTY_TODAY_STATS,
};

function safeObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function readableMeta(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function historyFallback(range = 'today') {
  const item = HISTORY_RANGES.find((row) => row.value === range);
  return {
    ok: false,
    manual_refresh_only: true,
    range: { label: item?.label || 'Today' },
    summary: EMPTY_TODAY_STATS,
    call_summary: {},
    calls: [],
    logs: [],
  };
}

export default function AttendancePage() {
  const { user } = useAuth();
  const leadership = ['admin', 'manager', 'tl'].includes(String(user?.role || '').toLowerCase());
  const [state, setState] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyRange, setHistoryRange] = useState('today');
  const [historyDate, setHistoryDate] = useState(todayLocal());
  const [breakReason, setBreakReason] = useState('Tea Break');
  const [presetMinutes, setPresetMinutes] = useState('5');
  const selectedBreakMinutesRef = useRef('5');
  const [customBreakOpen, setCustomBreakOpen] = useState(false);
  const [customBreakMinutes, setCustomBreakMinutes] = useState('5');
  const [busy, setBusy] = useState('');
  const [lastError, setLastError] = useState('');
  const [message, setMessage] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [showPresence, setShowPresence] = useState(false);
  const [tick, setTick] = useState(0);
  const [sessionLive, setSessionLive] = useState(null);

  async function loadAttendance() {
    const sessionMeta = currentSessionMeta(user);
    const suffix = sessionMeta?.joinedAt ? `?session_from=${encodeURIComponent(sessionMeta.joinedAt)}` : '';
    const data = await api.get(`/api/attendance${suffix}`, { cacheTtlMs: 0, timeoutMs: 20000, allowStale: true });
    return applyAttendanceSnapshot(data);
  }


  function applyAttendanceSnapshot(data) {
    const nextState = safeObject(data, EMPTY_ATTENDANCE_STATE);
    setState({ ...EMPTY_ATTENDANCE_STATE, ...nextState, today_stats: { ...EMPTY_TODAY_STATS, ...safeObject(nextState.today_stats) }, team_working: safeRows(nextState.team_working), requests: safeRows(nextState.requests), logs: safeRows(nextState.logs) });
    return nextState;
  }

  async function updateDetails(range = historyRange, date = historyDate) {
    const params = new URLSearchParams({ range });
    if (range === 'day' && date) params.set('date', date);
    const data = await api.get(`/api/attendance/history?${params.toString()}`, { cacheTtlMs: 0, timeoutMs: 25000, allowStale: true });
    const nextHistory = safeObject(data, historyFallback(range));
    setHistory({ ...historyFallback(range), ...nextHistory, calls: safeRows(nextHistory.calls), logs: safeRows(nextHistory.logs), summary: { ...EMPTY_TODAY_STATS, ...safeObject(nextHistory.summary) } });
    return nextHistory;
  }

  async function refreshAll(showDone = false) {
    setBusy((v) => v || 'refresh');
    setMessage('');
    try {
      const attendanceResult = await loadAttendance().catch((err) => {
        setState((current) => current || EMPTY_ATTENDANCE_STATE);
        return { __error: err?.message || 'Attendance dashboard could not load.' };
      });
      const historyResult = await updateDetails().catch((err) => {
        const fallback = historyFallback(historyRange);
        setHistory(fallback);
        return { ...fallback, __error: err?.message || 'Attendance history could not load.' };
      });
      const errors = [attendanceResult?.__error, historyResult?.__error].filter(Boolean);
      setLastError(errors.join(' | '));
      if (showDone && !errors.length) setMessage(`Updated manually: ${historyResult?.range?.label || 'Today'} • ${safeRows(historyResult?.calls).length} call rows • ${safeRows(historyResult?.logs).length} activity rows.`);
      return { attendanceData: attendanceResult, historyData: historyResult };
    } finally {
      setBusy('');
    }
  }

  useEffect(() => { refreshAll(false); }, []);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const readNow = () => setSessionLive(readLocalJson(SESSION_TIMER_KEY));
    const onTick = (event) => setSessionLive(event?.detail && typeof event.detail === 'object' ? event.detail : readLocalJson(SESSION_TIMER_KEY));
    readNow();
    window.addEventListener('career-crox-work-session-tick', onTick);
    window.addEventListener('career-crox-office-joined', readNow);
    return () => {
      window.removeEventListener('career-crox-work-session-tick', onTick);
      window.removeEventListener('career-crox-office-joined', readNow);
    };
  }, [user?.user_id]);

  // CC26_692: Attendance data is manual-refresh only. The 1s timer above is UI-only and makes no network request.

  async function doAction(type, path, payload = {}) {
    if (type === 'start-break' || type === 'end-break') {
      applyOptimisticBreakAction(type, payload);
      setBusy(type);
      setLastError('');
      api.post(path, { ...payload, compact: false }, { timeoutMs: 12000, cacheTtlMs: 0 })
        .then((data) => {
          applyAttendanceSnapshot(data);
          updateDetails(historyRange, historyDate).catch(() => {});
        })
        .catch((err) => {
          setLastError((err?.message || 'Backend save is pending. Please retry if the server does not confirm shortly.'));
        })
        .finally(() => setBusy(''));
      return;
    }
    try {
      setBusy(type);
      setLastError('');
      const data = await api.post(path, { ...payload, compact: false }, { timeoutMs: 12000, cacheTtlMs: 0 });
      applyAttendanceSnapshot(data);
      if (type === 'join') {
        if (data?.today_stats?.manual_join_confirmed !== '1' || window.__CC723_OFFICE_RESTORE__?.(data,true) !== true) {
          throw new Error('Office Join is not verified yet. Please try again.');
        }
      }
      setMessage(type === 'join' ? 'Office joined. Current login session tracking started.' : 'Attendance updated.');
      updateDetails(historyRange, historyDate).catch(() => {});
    } catch (err) {
      setLastError(err?.message || 'Action failed');
      loadAttendance().catch(() => {});
    } finally {
      setBusy('');
    }
  }

  async function manualUpdate() {
    await refreshAll(true);
  }

  const viewState = state || EMPTY_ATTENDANCE_STATE;
  const rawTodayStats = useMemo(() => ({ ...EMPTY_TODAY_STATS, ...safeObject(viewState?.today_stats) }), [viewState]);
  const presence = safeObject(viewState?.presence, EMPTY_ATTENDANCE_STATE.presence);
  const todayStats = currentSessionAttendanceStats(rawTodayStats, presence, user, sessionLive, viewState?.session_call_stats);
  void tick;
  const historySummary = { ...EMPTY_TODAY_STATS, ...safeObject(history?.summary || todayStats) };
  const joined = Boolean(todayStats.joined_today);
  const onBreak = String(presence?.is_on_break || '0') === '1';
  const locked = String(presence?.locked || '0') === '1';
  const approvalLocked = locked && String(presence?.lock_reason || '') !== 'break';
  const timer = buildTimer(presence?.break_expected_end_at);
  const plannedMinutes = String(clampCustomBreakMinutes(presetMinutes));
  const customSelected = !PRESET_MINUTES.includes(String(plannedMinutes));
  const customLabel = customSelected ? formatBreakDurationLabel(plannedMinutes) : 'Custom';
  function applyCustomBreakMinutes(value) {
    const next = String(clampCustomBreakMinutes(value));
    setCustomBreakMinutes(next);
    selectedBreakMinutesRef.current = next;
    setPresetMinutes(next);
    setCustomBreakOpen(true);
  }
  function nudgeCustomBreakMinutes(step) {
    applyCustomBreakMinutes(Number(customBreakMinutes || plannedMinutes || 10) + step);
  }

  function applyOptimisticBreakAction(type, payload = {}) {
    const now = new Date();
    const nowIsoValue = now.toISOString();
    const planned = Math.max(1, Number(payload.planned_minutes || plannedMinutes || 5) || 5);
    setState((current) => {
      const base = { ...EMPTY_ATTENDANCE_STATE, ...(current || viewState || {}) };
      const currentPresence = safeObject(base.presence, EMPTY_ATTENDANCE_STATE.presence);
      const startedAt = currentPresence.break_started_at || nowIsoValue;
      const usedBreakMinutes = type === 'end-break'
        ? Math.max(0, Math.round((now.getTime() - new Date(startedAt || nowIsoValue).getTime()) / 60000))
        : 0;
      const nextPresence = type === 'start-break'
        ? {
            ...currentPresence,
            is_on_break: '1',
            break_reason: String(payload.reason || breakReason || 'Break'),
            break_started_at: nowIsoValue,
            break_expected_end_at: new Date(now.getTime() + planned * 60000).toISOString(),
            locked: leadership ? '0' : '1',
            lock_reason: leadership ? '' : 'break',
            lock_message: leadership ? '' : 'Break started. End the break to resume CRM access.',
            last_seen_at: nowIsoValue,
          }
        : {
            ...currentPresence,
            is_on_break: '0',
            break_reason: '',
            break_started_at: '',
            break_expected_end_at: '',
            locked: '0',
            lock_reason: '',
            lock_message: '',
            last_seen_at: nowIsoValue,
            total_break_minutes: String(Math.max(0, Number(currentPresence.total_break_minutes || 0) || 0) + usedBreakMinutes),
          };
      return {
        ...base,
        presence: nextPresence,
        today_stats: { ...EMPTY_TODAY_STATS, ...safeObject(base.today_stats) },
        team_working: safeRows(base.team_working).map((row) => String(row.user_id || '') === String(user?.user_id || '') ? { ...row, ...nextPresence } : row),
      };
    });
    if (type === 'start-break') {
      try {
        localStorage.setItem('cc376_work_timer', JSON.stringify({ mode: 'break', break_started_at: nowIsoValue, break_expected_end_at: new Date(now.getTime() + planned * 60000).toISOString(), at: Date.now() }));
      } catch {}
      setMessage('Break started instantly. Backend save is completing in the background.');
    }
    if (type === 'end-break') {
      try {
        const previous = JSON.parse(localStorage.getItem('cc376_work_timer') || '{}');
        localStorage.setItem('cc376_work_timer', JSON.stringify({ ...previous, mode: 'work', break_started_at: '', break_expected_end_at: '', at: Date.now() }));
      } catch {}
      setMessage('Break ended instantly. Work timer resumed while backend save completes.');
    }
  }
  const canStartBreak = joined && !onBreak && !locked;
  const canEndBreak = joined && onBreak;
  const team = safeRows(viewState?.team_working);
  const requests = safeRows(viewState?.requests);
  const logs = safeRows(history?.logs).length ? safeRows(history?.logs) : safeRows(viewState?.logs);
  const calls = safeRows(history?.calls);
  const lockedCount = team.filter((row) => String(row.locked || '0') === '1').length;
  const onBreakCount = team.filter((row) => String(row.is_on_break || '0') === '1').length;
  const activeCount = team.filter((row) => row.activity_status === 'Working').length;
  const progressPercent = Math.min(100, Math.round((Number(todayStats.office_duration_minutes || todayStats.session_minutes || 0) / 540) * 100));

  return (
    <Layout title="Attendance & Breaks" subtitle="">
      <style>{`/* CC26_231_ATTENDANCE_CUSTOM_BREAK_ONLY */
.premium-custom-minute-trigger{gap:7px!important;min-width:108px!important;font-weight:1000!important}
.premium-custom-minute-trigger span{font-size:16px!important;line-height:1!important}
.premium-custom-minute-card{width:min(100%,560px);display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 14px;border:1px solid rgba(128,169,225,.65);border-radius:18px;background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(229,241,255,.98));box-shadow:0 12px 28px rgba(57,99,170,.10)}
.custom-minute-copy{display:flex;flex-direction:column;gap:3px;color:#12345d}.custom-minute-copy strong{font-size:14px;font-weight:1000}.custom-minute-copy span{font-size:12px;font-weight:850;color:#496482}
.custom-minute-controls{display:flex;align-items:center;gap:8px;flex-wrap:nowrap}.custom-minute-step,.custom-minute-apply{height:38px;min-width:38px;border:0;border-radius:12px;font-weight:1000;color:#fff;background:linear-gradient(135deg,#2d62ff,#4da3ff);box-shadow:0 9px 18px rgba(45,98,255,.18);cursor:pointer}.custom-minute-apply{min-width:58px;padding:0 12px}.custom-minute-input{width:96px;height:38px;border:1px solid rgba(77,127,205,.35);border-radius:12px;background:#fff;color:#12345d;font-size:14px;font-weight:1000;text-align:center;padding:0 8px}
@media(max-width:720px){.premium-custom-minute-card{align-items:flex-start;flex-direction:column}.custom-minute-controls{width:100%;flex-wrap:wrap}.custom-minute-input{flex:1 1 110px}}
/* CC26_342_PREMIUM_BREAK_METER */
.premium-break-meter-card{position:relative;overflow:hidden;border:1px solid rgba(37,99,235,.18)!important;background:linear-gradient(135deg,#f8fbff,#eef7ff 58%,#fff7ed)!important;box-shadow:0 22px 48px rgba(15,23,42,.12)!important}
.premium-break-meter-card.break-meter-warning{border-color:rgba(249,115,22,.42)!important;background:linear-gradient(135deg,#fff7ed,#ffedd5 55%,#fff)!important}
.premium-break-meter-card.break-meter-critical{border-color:rgba(239,68,68,.54)!important;background:linear-gradient(135deg,#fff1f2,#fee2e2 60%,#fff)!important}
.premium-break-meter-card.break-meter-exceeded{border-color:rgba(220,38,38,.72)!important;background:linear-gradient(135deg,#7f1d1d,#dc2626 58%,#f97316)!important;color:#fff!important;animation:ccBreakExceededPulse .72s infinite alternate}
.premium-break-meter-card.break-meter-exceeded *{color:#fff!important;-webkit-text-fill-color:#fff!important}
.break-meter-track{height:12px;width:100%;border-radius:999px;background:rgba(148,163,184,.24);overflow:hidden;margin-top:12px;box-shadow:inset 0 1px 3px rgba(15,23,42,.18)}
.break-meter-fill{height:100%;border-radius:999px;background:linear-gradient(90deg,#22c55e,#3b82f6);transition:width .3s ease,background .3s ease}
.break-meter-warning .break-meter-fill{background:linear-gradient(90deg,#f59e0b,#f97316)}
.break-meter-critical .break-meter-fill{background:linear-gradient(90deg,#f97316,#dc2626)}
.break-meter-exceeded .break-meter-fill{background:linear-gradient(90deg,#fff,#fecaca)}
.break-meter-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;font-weight:900;font-size:12px;color:#475569}
.break-meter-percent{font-size:18px;font-weight:1000;color:#0f172a}
@keyframes ccBreakExceededPulse{from{filter:brightness(1);transform:scale(1)}to{filter:brightness(1.12);transform:scale(1.01)}}
`}</style>
      {lastError && <div className="helper-text top-gap sync-message is-error">{lastError}</div>}
      {message && <div className="helper-text top-gap-small sync-message is-success">{message}</div>}

      <div className="table-toolbar top-gap-small">
        <div>
          <div className="table-title">Current Login Session</div>
        </div>
        <div className="toolbar-actions compact-pills">
          <select className="inline-input" value={historyRange} onChange={(e) => setHistoryRange(e.target.value)}>
            {HISTORY_RANGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          {historyRange === 'day' ? <input className="inline-input" type="date" value={historyDate} onChange={(e) => setHistoryDate(e.target.value)} /> : null}
          <button className="mini-btn success bounceable" type="button" disabled={Boolean(busy) || joined} onClick={(event) => { if (event.nativeEvent?.isTrusted) doAction('join', '/api/attendance/join', { last_page: '/attendance', manual_confirmed: true, join_source: 'user_button' }); }}>{joined ? 'Joined Today' : 'Join Office'}</button>
          <button className="add-profile-btn bounceable" type="button" disabled={Boolean(busy)} onClick={manualUpdate}>{'Update Details'}</button>
        </div>
      </div>

      <div className="small-grid five top-gap attendance-card-grid">
        <MetricCard label="Office Duration" value={formatMinutes(todayStats.remaining_work_minutes)} tone="blue" helper={`9h target • ${formatMinutes(todayStats.active_work_minutes || todayStats.productive_work_minutes)} active completed`} />
        <MetricCard label="Active Work" value={formatMinutes(todayStats.active_work_minutes || todayStats.productive_work_minutes)} tone="green" helper={`Real active work only • ${todayStats.day_status || 'No Work Day'}`} />
        <MetricCard label="Idle Time" value={formatMinutes(todayStats.idle_minutes)} tone="cyan" helper={`No meaningful work after 2m grace • Grace ${formatMinutes(todayStats.grace_minutes)}`} />
        <MetricCard label="Break Taken" value={formatMinutes(todayStats.total_break_minutes)} tone="orange" helper="Current login break total" />
        <MetricCard label="Talk Time" value={formatMinutes(todayStats.talktime_minutes)} tone="purple" helper={`Incoming + Outgoing • Out ${formatMinutes(todayStats.outgoing_talktime_minutes)} • In ${formatMinutes(todayStats.incoming_talktime_minutes)}`} />
      </div>

      <div className="attendance-progress-band top-gap single-band">
        <div className="attendance-progress-card">
          <div>
            <div className="panel-title">Work Progress</div>
            <div className="helper-text top-gap-small">Login: {formatClock(todayStats.login_at)} • Joined: {formatClock(todayStats.joined_at)} • Remaining to 9h: {formatMinutes(todayStats.remaining_work_minutes)} • Session elapsed: {formatMinutes(todayStats.office_duration_minutes || todayStats.session_minutes)} • Active: {formatMinutes(todayStats.active_work_minutes || todayStats.productive_work_minutes)} • Idle: {formatMinutes(todayStats.idle_minutes)} • Grace: {formatMinutes(todayStats.grace_minutes)} • Break: {formatMinutes(todayStats.total_break_minutes)} • Talktime: {formatMinutes(todayStats.talktime_minutes)} • Connected: {todayStats.connected_calls_count || '0'} • Status: {todayStats.day_status || 'No Work Day'}</div>
            {Array.isArray(todayStats.attendance_failed_rules) && todayStats.attendance_failed_rules.length ? <div className="helper-text top-gap-small">Missing rules: {todayStats.attendance_failed_rules.join(' | ')}</div> : null}
          </div>
          <div className="attendance-progress-bar"><span style={{ width: `${progressPercent}%` }} /></div>
        </div>
      </div>

      <div className="small-grid five top-gap attendance-card-grid">
        <MetricCard label="Session Outgoing" value={String(todayStats.outgoing_calls_count || '0')} tone="green" helper={`Timing ${formatMinutes(todayStats.outgoing_talktime_minutes)}`} />
        <MetricCard label="Session Incoming" value={String(todayStats.incoming_calls_count || '0')} tone="blue" helper={`Timing ${formatMinutes(todayStats.incoming_talktime_minutes)}`} />
        <MetricCard label="Session Missed" value={String(todayStats.missed_calls_count || '0')} tone="orange" helper="From mobile logs" />
        <MetricCard label="Session Manual" value={String(todayStats.manual_calls_count || '0')} tone="purple" helper="Manual dialer/app" />
        <MetricCard label="Session Auto Dialer" value={String(todayStats.auto_dialer_calls_count || '0')} tone="cyan" helper="Auto queue calls" />
      </div>

      <div className="attendance-ref-grid top-gap">
        <div className="panel premium-break-panel ref-break-panel">
          <div className="panel-heading-row">
            <div>
              <div className="panel-title">Break Control</div>
            </div>
            <div className="break-mode-chip">{leadership ? 'Leadership view' : approvalLocked ? 'Approval required' : onBreak ? 'Break running' : joined ? 'Ready' : 'Join Office first'}</div>
          </div>

          {onBreak ? (() => {
            const breakMeter = buildBreakMeter(presence, timer);
            return (
              <div className={`attendance-lock-status-card top-gap premium-break-meter-card break-meter-${breakMeter.level}`}>
                <div className="attendance-lock-status-label">Break Timer</div>
                <div className="attendance-lock-status-value">{timer.text}</div>
                <div className="break-meter-track"><div className="break-meter-fill" style={{ width: `${Math.min(100, breakMeter.percent)}%` }} /></div>
                <div className="break-meter-meta">
                  <span>{breakMeter.label}</span>
                  <strong className="break-meter-percent">{breakMeter.percent}%</strong>
                </div>
                <div className="attendance-lock-status-sub">{breakMeter.level === 'exceeded' ? 'Break expired. Manager or TL approval is required before resuming.' : `${presence.break_reason || 'Break'} in progress`}</div>
              </div>
            );
          })() : null}

          <div className="attendance-form-grid attendance-break-type-only top-gap-small">
            <div className="field accent-field">
              <label>Break Type</label>
              <select className="inline-input" value={breakReason} onChange={(e) => setBreakReason(e.target.value)} disabled={!joined || onBreak}>
                {BREAK_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
          </div>

          <div className="premium-minute-row top-gap-small">
            {PRESET_MINUTES.map((item) => (
              <button key={item} type="button" className={`premium-minute-chip ${plannedMinutes === item ? 'active' : ''}`} onClick={() => { selectedBreakMinutesRef.current = item; setPresetMinutes(item); setCustomBreakOpen(false); }} disabled={!joined || onBreak}>{item}m</button>
            ))}
            <button type="button" className={`premium-minute-chip premium-custom-minute-trigger ${customSelected || customBreakOpen ? 'active' : ''}`} onClick={() => setCustomBreakOpen((v) => !v)} disabled={!joined || onBreak} title="Custom break minutes" aria-label="Custom break minutes"><span aria-hidden="true">＋</span>{customLabel}</button>
          </div>

          {customBreakOpen ? (
            <div className="premium-custom-minute-card top-gap-small">
              <div className="custom-minute-copy">
                <strong>Custom Break</strong>
                <span>{formatBreakDurationLabel(customBreakMinutes || plannedMinutes)} selected</span>
              </div>
              <div className="custom-minute-controls">
                <button type="button" className="custom-minute-step" onClick={() => nudgeCustomBreakMinutes(-5)} disabled={!joined || onBreak}>−</button>
                <input className="custom-minute-input" type="number" min="1" max="480" step="1" value={customBreakMinutes} onChange={(e) => setCustomBreakMinutes(e.target.value)} onBlur={(e) => applyCustomBreakMinutes(e.target.value)} disabled={!joined || onBreak} aria-label="Custom break minutes" />
                <button type="button" className="custom-minute-step" onClick={() => nudgeCustomBreakMinutes(5)} disabled={!joined || onBreak}>＋</button>
                <button type="button" className="custom-minute-apply" onClick={() => applyCustomBreakMinutes(customBreakMinutes)} disabled={!joined || onBreak}>Use</button>
              </div>
            </div>
          ) : null}

          <div className="attendance-break-cta-row top-gap">
            <button className={`premium-cta-btn break-start ${busy === 'start-break' ? 'is-busy' : ''}`} disabled={!canStartBreak} onClick={() => doAction('start-break', '/api/attendance/start-break', { reason: breakReason, planned_minutes: plannedMinutes })}>{`Start Break · ${plannedMinutes}m`}</button>
            <button className={`premium-cta-btn break-end ${busy === 'end-break' ? 'is-busy' : ''}`} disabled={!canEndBreak} onClick={() => doAction('end-break', '/api/attendance/end-break', {})}>End Break</button>
          </div>
        </div>

        <div className="panel premium-unlock-panel break-unlock-panel">
          <div className="panel-title">CRM Lock Status</div>
          <div className={`attendance-lock-status-card ${approvalLocked ? 'locked' : locked ? 'open' : 'open'}`}>
            <div className="attendance-lock-status-label">CRM</div>
            <div className="attendance-lock-status-value">{approvalLocked ? 'APPROVAL LOCKED' : locked ? 'BREAK TIMER LOCK' : 'OPEN'}</div>
            <div className="attendance-lock-status-sub">{presence?.lock_message || (locked ? 'Break timer active' : 'Ready for work')}</div>
          </div>
          <div className="small-grid two top-gap-small">
            <MetricCard label="Working Now" value={String(activeCount)} tone="blue" helper={leadership ? 'Team active' : 'You are active'} />
            <MetricCard label="On Break" value={String(onBreakCount)} tone="orange" helper="Live snapshot" />
          </div>
        </div>
      </div>

      <div className="attendance-expand-grid top-gap">
        <div className="panel glassy-card fade-up no-scroll-panel">
          <div className="table-toolbar attendance-card-toolbar"><div className="table-title">{leadership ? 'Team Working Snapshot' : 'My Working Snapshot'}</div><button className="mini-btn view bounceable" type="button" onClick={() => setShowPresence((v) => !v)}>{showPresence ? 'Hide Details' : 'Show Details'}</button></div>
          <div className="attendance-mini-card-row top-gap-small">
            {(leadership ? team : team.slice(0, 1)).slice(0, 4).map((row) => (
              <div key={row.user_id} className={`attendance-person-card ${String(row.locked || '0') === '1' ? 'locked' : String(row.is_on_break || '0') === '1' ? 'break' : 'active'}`}>
                <div className="attendance-person-name">{row.full_name}</div>
                <div className="attendance-person-sub">{row.recruiter_code || row.role || '-'}</div>
                <div className="attendance-person-meta">{row.activity_status || (String(row.is_on_break || '0') === '1' ? (row.break_reason || 'On Break') : (String(row.locked || '0') === '1' ? 'Locked' : 'Logged Out'))}</div>
                <div className="attendance-person-time">{formatClock(row.last_seen_at)}</div>
              </div>
            ))}
            {!team.length && <div className="helper-text">No active users right now.</div>}
          </div>
          {showPresence && (
            <div className="crm-table-wrap dense-wrap top-gap-small">
              <table className="crm-table colorful-table dense-table compact-attendance-table">
                <thead><tr><th>Name</th><th>Recruiter Code</th><th>Role</th><th>Status</th><th>Last Seen</th></tr></thead>
                <tbody>
                  {team.map((row) => <tr key={row.user_id}><td>{row.full_name}</td><td>{row.recruiter_code || '-'}</td><td>{row.role || '-'}</td><td>{row.activity_status || (String(row.is_on_break || '0') === '1' ? (row.break_reason || 'Break') : String(row.locked || '0') === '1' ? 'Locked' : 'Logged Out')}</td><td>{formatClock(row.last_seen_at)}</td></tr>)}
                  {!team.length && <tr><td colSpan="5" className="helper-text">No rows.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel glassy-card fade-up no-scroll-panel">
          <div className="table-toolbar attendance-card-toolbar"><div className="table-title">Manual Performance Summary</div><button className="mini-btn view bounceable" type="button" onClick={() => setShowLogs((v) => !v)}>{showLogs ? 'Hide Details' : 'Show Details'}</button></div>
          <div className="small-grid three top-gap-small">
            <MetricCard label="Range" value={history?.range?.label || 'Today'} tone="blue" helper="Manual refresh" />
            <MetricCard label="Range Talktime" value={formatMinutes(historySummary.talktime_minutes)} tone="purple" helper={`Calls ${historySummary.calls_count || 0}`} />
            <MetricCard label="Range Connected" value={String(historySummary.connected_calls_count || 0)} tone="green" helper={`Missed ${historySummary.missed_calls_count || 0}`} />
          </div>
          {showLogs && (
            <div className="crm-table-wrap dense-wrap top-gap-small">
              <table className="crm-table colorful-table dense-table compact-attendance-table">
                <thead><tr><th>When</th><th>Action</th><th>Meta</th></tr></thead>
                <tbody>{safeRows(logs).map((row) => <tr key={row.activity_id || row.id || `${row.created_at}_${row.action_type}`}><td>{formatClock(row.created_at)}</td><td>{row.action_type}</td><td>{readableMeta(row.metadata)}</td></tr>)}{!safeRows(logs).length && <tr><td colSpan="3" className="helper-text">No logs.</td></tr>}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar"><div><div className="table-title">Call Assistant History ({history?.range?.label || 'Today'})</div></div><div className="toolbar-actions compact-pills"><button className="mini-btn view bounceable" type="button" onClick={() => updateDetails(historyRange, historyDate)}>Refresh History</button></div></div>
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table compact-attendance-table">
            <thead><tr><th>Time</th><th>Candidate</th><th>Phone</th><th>Status</th><th>Direction</th><th>Mode</th><th>Talktime</th></tr></thead>
            <tbody>{safeRows(calls).map((row) => <tr key={row.call_log_id || `${row.phone}_${row.call_started_at}`}><td>{formatClock(row.call_started_at || row.created_at)}</td><td>{row.candidate_name || '-'}</td><td>{row.phone || '-'}</td><td>{row.status || '-'}</td><td>{row.direction || '-'}</td><td>{row.call_source || row.source_mode || '-'}</td><td>{formatSeconds(row.talktime_seconds || row.duration_seconds)}</td></tr>)}{!safeRows(calls).length && <tr><td colSpan="7" className="helper-text">No call rows for selected range. Click Update Details after mobile calls are synced.</td></tr>}</tbody>
          </table>
        </div>
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar"><div className="table-title">{leadership ? 'All Unlock Requests' : 'My Unlock Requests'}</div></div>
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table compact-attendance-table">
            <thead><tr><th>Request ID</th><th>Status</th><th>Reason</th><th>Requested At</th><th>Approved By</th></tr></thead>
            <tbody>{requests.map((row) => <tr key={row.request_id}><td>{row.request_id}</td><td>{row.status}</td><td>{row.reason}</td><td>{formatClock(row.requested_at)}</td><td>{row.approved_by_name || '-'}</td></tr>)}{!requests.length && <tr><td colSpan="5" className="helper-text">No unlock requests yet.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
