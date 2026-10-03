import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { canAccessFeature, resolveUserRole } from '../lib/roleAccess';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { getPollingLeaderSnapshot } from '../lib/tabLeader';
import { notificationTarget } from '../lib/notificationLink';
import { defaultCustomTheme } from '../lib/theme';
import { openCandidateProfileInPopupTab } from '../lib/candidateNav';
import { crmDateParts, crmTodayYmd, crmYmd } from '../lib/timeFormat';

const themes = [
  ['crimson-noir', 'Crimson Noir'],
  ['burgundy', 'Managers Only'],
  ['orange', 'Orange'],
  ['blue', 'Blue'],
  ['green', 'Green'],
  ['pink', 'Rose'],
  ['purple', 'Purple'],
  ['gold', 'Gold'],
  ['rose', 'Pink'],
  ['dark-navy', 'Dark Navy'],
  ['midnight', 'Midnight'],
  ['dark-midnight', 'Dark Sapphire'],
  ['cosmic-berry', 'Cosmic Berry'],
  ['magenta-pop', 'Magenta Pop'],
  ['neon-ink', 'Neon Ink'],
  ['berry-chrome', 'Berry Chrome'],
  ['ice-lilac', 'Ice Lilac']
];

const BACKGROUND_PRESETS = [
  { value: '#d9ebff', label: 'Ocean Blue Background' },
  { value: '#73d9c8', label: 'Card Green Background' },
  { value: '#6db7ff', label: 'Card Blue Background' },
  { value: '#ffb36b', label: 'Coral Glow Background' },
  { value: '#b79cff', label: 'Violet Mist Background' },
];

const TASK_SNOOZE_OPTIONS = [
  { label: '5m', minutes: 5 },
  { label: '30m', minutes: 30 },
  { label: '1H', minutes: 60 },
  { label: '2H', minutes: 120 },
];

const FOLLOWUP_SNOOZE_OPTIONS = [
  { label: '5m', minutes: 5 },
  { label: '30m', minutes: 30 },
  { label: '1H', minutes: 60 },
  { label: '2H', minutes: 120 },
];


const SUBMISSION_REMINDER_SNOOZE_OPTIONS = [
  { label: '5m', minutes: 5 },
  { label: '30m', minutes: 30 },
  { label: '1H', minutes: 60 },
  { label: '2H', minutes: 120 },
];

function globalSubmissionReminderKey(row = {}) {
  return String(row.submission_id || row.candidate_id || '').trim();
}

function globalSubmissionReminderStamp(row = {}) {
  const snoozed = String(row.reminder_snoozed_until || '').trim();
  if (snoozed) return snoozed;
  const queued = String(row.next_follow_up_at || row.follow_up_at || '').trim();
  if (queued) return queued;
  const approval = lowerText(row.approval_status);
  const details = lowerText(row.all_details_sent);
  const base = row.approval_requested_at || row.submission_date || row.effective_submission_at || row.submission_origin_at || row.submitted_at || row.updated_at || row.created_at || '';
  const baseMs = new Date(base || 0).getTime();
  if (!baseMs) return '';
  const offsetMinutes = 3;
  return new Date(baseMs + offsetMinutes * 60000).toISOString();
}

function isGlobalSubmissionReminderDue(row = {}) {
  const stamp = globalSubmissionReminderStamp(row);
  const time = new Date(stamp || 0).getTime();
  if (!time) return false;
  return time <= Date.now() + CRM_REMINDER_LOOKAHEAD_MS;
}

function isGlobalSubmissionReminderPending(row = {}) {
  const approval = lowerText(row.approval_status);
  const details = lowerText(row.all_details_sent);
  const status = lowerText(row.status || row.candidate_status || row.profile_status);
  if (['deleted', '__deleted__', 'archived', 'rejected', 'draft'].includes(status)) return false;
  if (['deleted', '__deleted__', 'archived', 'rejected', 'draft', ''].includes(approval)) return false;
  return approval === 'pending' || (approval === 'approved' && details === 'pending');
}

function isGlobalSubmissionReminderSnoozed(row = {}) {
  const key = globalSubmissionReminderKey(row);
  if (!key) return true;
  try {
    return Date.now() < Number(localStorage.getItem(`cc_global_submission_reminder_snooze_${key}`) || 0);
  } catch {
    return false;
  }
}


function globalSubmissionReminderNote(row = {}) {
  return String(row.last_note || row.last_notes || row.reminder_note || row.follow_up_note || row.notes || row.note || row.data_notes || '').trim();
}

function pickGlobalSubmissionReminder(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && isGlobalSubmissionReminderPending(row) && isGlobalSubmissionReminderDue(row) && !isGlobalSubmissionReminderSnoozed(row))
    .sort((a, b) => new Date(globalSubmissionReminderStamp(a) || 0).getTime() - new Date(globalSubmissionReminderStamp(b) || 0).getTime())[0] || null;
}

function pickUpcomingGlobalSubmissionReminder(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && isGlobalSubmissionReminderPending(row) && !isGlobalSubmissionReminderSnoozed(row))
    .sort((a, b) => new Date(globalSubmissionReminderStamp(a) || 0).getTime() - new Date(globalSubmissionReminderStamp(b) || 0).getTime())[0] || null;
}

const APPROVAL_SNOOZE_OPTIONS = [
  { label: '5m', minutes: 5 },
  { label: '30m', minutes: 30 },
  { label: '1H', minutes: 60 },
  { label: '2H', minutes: 120 },
];

const NOTIFICATION_TUNE_STORAGE_KEY = 'careerCroxNotificationTune';

const NOTIFICATION_TUNE_PRESETS = [
  { id: 'soft-hop', label: 'Soft Hop', notes: [659, 784, 988], wave: 'sine', spacing: 0.08, hold: 0.16, glide: 1.01 },
  { id: 'desk-bell', label: 'Desk Bell', notes: [523, 659, 784], wave: 'triangle', spacing: 0.11, hold: 0.22, accent: 1.18 },
  { id: 'mint-pop', label: 'Mint Pop', notes: [784, 932, 1175], wave: 'triangle' },
  { id: 'metro-chip', label: 'Metro Chip', notes: [587, 659, 880], wave: 'square', spacing: 0.045, hold: 0.1, detune_step: 6 },
  { id: 'peppy-ring', label: 'Peppy Ring', notes: [740, 988, 1244], wave: 'sine' },
  { id: 'comic-bloop', label: 'Comic Bloop', notes: [440, 659, 523, 784], wave: 'triangle', spacing: 0.07, hold: 0.14, glide: 1.03 },
  { id: 'glass-pop', label: 'Glass Pop', notes: [988, 1319, 1568], wave: 'sine' },
  { id: 'tiny-trumpet', label: 'Tiny Trumpet', notes: [392, 523, 659], wave: 'square', spacing: 0.09, hold: 0.2, accent: 1.2 },
  { id: 'happy-zing', label: 'Happy Zing', notes: [659, 831, 988, 1319], wave: 'triangle' },
  { id: 'office-fizz', label: 'Office Fizz', notes: [523, 698, 880, 988], wave: 'sine' },
  { id: 'spark-loop', label: 'Spark Loop', notes: [784, 698, 784, 1047], wave: 'triangle' },
  { id: 'smart-ping', label: 'Smart Ping', notes: [622, 831, 1244], wave: 'sine' },
  { id: 'lift-up', label: 'Lift Up', notes: [494, 587, 740, 988], wave: 'triangle' },
  { id: 'mini-marimba', label: 'Mini Marimba', notes: [523, 659, 523, 784], wave: 'sine' },
  { id: 'arcade-lite', label: 'Arcade Lite', notes: [784, 1047, 784, 1319], wave: 'square' },
  { id: 'paper-plane', label: 'Paper Plane', notes: [523, 587, 784, 1175], wave: 'triangle' },
  { id: 'quick-wink', label: 'Quick Wink', notes: [988, 880, 1175], wave: 'sine' },
  { id: 'bubble-step', label: 'Bubble Step', notes: [523, 784, 698, 1047], wave: 'triangle' },
  { id: 'ping-puff', label: 'Ping Puff', notes: [698, 880, 698, 988], wave: 'sine' },
  { id: 'sunny-tap', label: 'Sunny Tap', notes: [587, 784, 988, 1175], wave: 'triangle' },
  { id: 'chime-roll', label: 'Chime Roll', notes: [523, 659, 784, 988, 1319], wave: 'sine', spacing: 0.055, hold: 0.12, glide: 1.02, accent: 1.1 },
  { id: 'soft-robot', label: 'Soft Robot', notes: [440, 523, 659, 523], wave: 'square' },
  { id: 'cheer-dot', label: 'Cheer Dot', notes: [659, 880, 1109], wave: 'triangle' },
  { id: 'wink-bell', label: 'Soft Bell', notes: [784, 1175, 988], wave: 'sine' },
  { id: 'office-tone', label: 'Office Tone', notes: [523, 659, 831, 1047], wave: 'triangle' },
];

const POPUP_POLL_MS = 900000;
const CRM_REMINDER_LOOKAHEAD_MS = 20 * 60 * 1000;
const internalReminderStartMs = (stamp) => Math.max(Date.now(), Number(stamp || 0) - CRM_REMINDER_LOOKAHEAD_MS);
const META_POLL_MS = 900000;
const APPROVAL_POLL_MS = 60000; // urgent leadership approval checks only
const GOLD_REMINDER_POLL_MS = 900000;
const PRESENCE_POLL_MS = 60000; // lightweight heartbeat only; not every second
const ATTENDANCE_GATE_POLL_MS = 120000;
const DISABLED_ARCHIVE_FEATURES = new Set(['data-extractor', 'quality-analyst', 'hr-head']);
const DISABLED_SLICES_ROUTE = '/disabled-slices';
const BASIC_CRM_MODE = true;

const DAILY_WORKFLOW_SNOOZE_MINUTES = 15;
const DAILY_TERMINAL_STATUSES = new Set(['selected', 'rejected', 'joined', 'not intrested', 'not interested', 'not responding', 'closed']);
const DAILY_RESOLVED_TOMORROW_STATUSES = new Set(['all set for interview', 'appeared in interview', 'selected', 'joined']);

function lowerText(value) {
  return String(value || '').trim().toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLocalYmd(value) {
  return crmYmd(value);
}

function parseInterviewStamp(row) {
  const scheduled = String(row?.scheduled_at || '').trim();
  if (scheduled) {
    const parsed = new Date(scheduled);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallbackDate = String(row?.interview_reschedule_date || row?.interview_date || '').slice(0, 10);
  if (!fallbackDate) return null;
  const parsed = new Date(`${fallbackDate}T09:00:00+05:30`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function interviewDateKey(row) {
  const dateOnly = String(row?.interview_reschedule_date || row?.interview_date || '').slice(0, 10);
  if (dateOnly) return dateOnly;
  const parsed = parseInterviewStamp(row);
  return parsed ? formatLocalYmd(parsed) : '';
}

function isPastInterview(row, now) {
  const parsed = parseInterviewStamp(row);
  if (parsed) return parsed.getTime() <= now.getTime();
  const dateKey = interviewDateKey(row);
  return Boolean(dateKey) && dateKey < formatLocalYmd(now);
}

function dailyWorkflowSnoozeKey(userId, kind, dateKey) {
  return `dailyInterviewWorkflow:snooze:${userId}:${kind}:${dateKey}`;
}

function threeMinuteGate(dateValue) {
  const t = new Date(dateValue || 0).getTime();
  if (!t) return false;
  return Date.now() - t >= 3 * 60 * 1000;
}

function formatMinutes(total) {
  const mins = Number(total || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}


function breakMeterSnapshot(presence = {}) {
  const startedAt = new Date(presence.break_started_at || 0).getTime();
  const expectedAt = new Date(presence.break_expected_end_at || 0).getTime();
  const now = Date.now();
  const plannedMs = startedAt && expectedAt && expectedAt > startedAt ? expectedAt - startedAt : 0;
  const elapsedMs = plannedMs ? Math.max(0, now - startedAt) : 0;
  const rawPercent = plannedMs ? Math.round((elapsedMs / plannedMs) * 100) : (expectedAt && now > expectedAt ? 100 : 0);
  const percent = Math.max(0, Math.min(130, rawPercent));
  const overdueSeconds = expectedAt && now > expectedAt ? Math.floor((now - expectedAt) / 1000) : 0;
  const left = Math.max(0, 180 - overdueSeconds);
  const level = percent >= 100 ? 'exceeded' : percent >= 95 ? 'critical' : percent >= 90 ? 'warning' : 'safe';
  return { percent, level, leftText: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` };
}

function LockedRequestModal({ reasonDefault, refreshAttendanceGate, navigate, breakExpiryAt = 0, overrunText = "" }) {
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestError, setRequestError] = useState('');
  // Keep the typed reason during background presence/lock refreshes (never discard it).
  async function sendRequest() {
    const note = String(reason || '').trim();
    if (sending || requestSent) return;
    if (note.length < 5) { setRequestError('Please enter the reason for your delay (at least 5 characters).'); return; }
    setSending(true); setRequestError('');
    try {
      const result = await api.post('/api/attendance/request-unlock', { reason: note, note, employee_note: note, compact: true }, { timeoutMs: 20000 });
      if (!result?.request_sent) throw new Error('Request was not confirmed. Please retry.');
      setRequestSent(true);
      await refreshAttendanceGate(true).catch(() => {});
    } catch (error) {
      const message = String(error?.message || 'Request could not be sent. Please retry.');
      setRequestError(/activity_log|null value in column|violates not-null/i.test(message) ? 'Request could not be saved. Please retry.' : message);
    } finally { setSending(false); }
  }
  return <div className="crm-modal-backdrop crm-lock-backdrop"><div className={`crm-premium-modal crm-lock-modal danger premium-crm-lock-request-modal ${breakExpiryAt ? 'cc556-expired-request' : ''}`}><div className="lock-premium-chip">Manager Approval Required</div><div className="panel-title">CRM Access Paused</div>{breakExpiryAt ? <div className="cc556-negative-clock" data-break-expiry={breakExpiryAt} aria-live="off">{overrunText}</div> : null}<div className="helper-text top-gap-small">{breakExpiryAt ? 'Your break allowance has ended. Explain why you were late; approval is required to resume.' : 'Explain why access is needed; approval is required to resume.'}</div><div className="field top-gap"><label htmlFor="cc579-access-reason">{breakExpiryAt ? 'Reason for late return (required)' : 'Reason for access (required)'}</label><textarea id="cc579-access-reason" rows="4" maxLength={500} required value={reason} onChange={(e) => { setReason(e.target.value); setRequestError(''); }} placeholder="Why were you late returning from break?" /></div>{requestError && <div className="helper-text cc579-error" role="alert">{requestError}</div>}{requestSent && <div className="helper-text cc579-success" role="status">Request sent to the approver. Wait for approval.</div>}<div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={sending || requestSent || reason.trim().length < 5} onClick={sendRequest}>{requestSent ? 'Request Sent' : sending ? 'Sending...' : 'Request for Access'}</button><button className="mini-btn view bounceable" type="button" onClick={() => refreshAttendanceGate(true)}>Check Approval</button></div></div></div>;
}

export default function Layout({ title, subtitle, children }) {
  const { user, logout, theme, setTheme, customTheme, setCustomTheme, resetCustomTheme, persistTheme } = useAuth();
  const effectiveCustomTheme = customTheme || defaultCustomTheme;
  const [notifications, setNotifications] = useState(0);
  const [approvals, setApprovals] = useState(0);
  const [showTheme, setShowTheme] = useState(false);
  const [notificationTune, setNotificationTune] = useState(() => {
    try {
      const stored = localStorage.getItem(NOTIFICATION_TUNE_STORAGE_KEY);
      return NOTIFICATION_TUNE_PRESETS.some((item) => item.id === stored) ? stored : 'office-tone';
    } catch {
      return 'office-tone';
    }
  });
  const [previewingTuneId, setPreviewingTuneId] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [lastNotificationId, setLastNotificationId] = useState('');
  const [approvalPopup, setApprovalPopup] = useState(null);
  const [taskPopup, setTaskPopup] = useState(null);
  const [followUpPopup, setFollowUpPopup] = useState(null);
  const [globalSubmissionReminderPopup, setGlobalSubmissionReminderPopup] = useState(null);
  const [taskPopupAnimatingOut, setTaskPopupAnimatingOut] = useState(false);
  const [revenuePopup, setRevenuePopup] = useState(null);
  const [dailyWorkflowPopup, setDailyWorkflowPopup] = useState(null);
  const [semiHourlyPopup, setSemiHourlyPopup] = useState(null);
  const [goalPostReminderPopup, setGoalPostReminderPopup] = useState(null);
  const [goalPostLogoutChoice, setGoalPostLogoutChoice] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalReminderForm, setApprovalReminderForm] = useState({ exact_time: '' });
  const [savingApproval, setSavingApproval] = useState(false);
  const [showJoinOffice, setShowJoinOffice] = useState(false);
  const [sendingJoin, setSendingJoin] = useState(false);
  const [officeJoinError, setOfficeJoinError] = useState('');
  const [attendanceGate, setAttendanceGate] = useState(null);
  const [breakCountdownNow, setBreakCountdownNow] = useState(() => Date.now());
  const [showLogoutSummary, setShowLogoutSummary] = useState(false);
  const [logoutSummary, setLogoutSummary] = useState(null);
  const logoutTargets = logoutSummary?.attendance_report?.targets || {};
  const logoutWorkTarget = Number(logoutTargets.payable_work_minutes || 540) || 540;
  const logoutDialedTarget = Number(logoutTargets.dialed_calls || 100) || 100;
  const logoutConnectedTarget = Number(logoutTargets.connected_calls || 60) || 60;
  const logoutTalkTarget = Number(logoutTargets.talktime_minutes || 180) || 180;
  const logoutSubmissionTarget = Number(logoutTargets.submissions || 10) || 10;
  const [sendingReport, setSendingReport] = useState(false);
  const [logoutReportNotes, setLogoutReportNotes] = useState('');
  const [writeBusy, setWriteBusy] = useState(false);
  const [manualDialerOpen, setManualDialerOpen] = useState(false);
  const [manualDialerPhone, setManualDialerPhone] = useState('');
  const [manualDialerName, setManualDialerName] = useState('');
  const [manualDialerBusy, setManualDialerBusy] = useState(false);
  const [manualDialerMessage, setManualDialerMessage] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const normalizedRole = resolveUserRole(user);
  const leadership = ['admin', 'manager', 'tl'].includes(normalizedRole);
  const approvalLockExempt = BASIC_CRM_MODE || ['admin', 'manager'].includes(normalizedRole);
  const AUTO_SYSTEM_POPUPS_ENABLED = String(import.meta.env?.VITE_AUTO_SYSTEM_POPUPS || 'false').toLowerCase() === 'true';
  const AUTO_SEMI_HOURLY_POPUPS_ENABLED = String(import.meta.env?.VITE_AUTO_SEMI_HOURLY_POPUPS || 'false').toLowerCase() === 'true';
  const quickAddRef = useRef(null);
  const lastMobileProfileRequestRef = useRef('');
  const lastMobileNextProfileRef = useRef('');
  const liveProfileSlotRef = useRef({ opened: {}, slots: {}, lastTouched: 0 });
  const lastHumanActivityAtRef = useRef(0);
  const humanActivitySincePingRef = useRef(false);
  const taskPopupCloseTimerRef = useRef(null);
  const scheduledReminderTimersRef = useRef(new Map());
  const hadVisibleTaskPopupRef = useRef(false);
  const sidebarRef = useRef(null);
  const pageScrollRef = useRef(null);
  const officeJoinInFlightRef = useRef(false);
  const notificationCountRef = useRef(0);
  const approvalCountRef = useRef(0);
  const approvalPopupSeenRef = useRef('');
  const followupPopupSeenRef = useRef('');
  const dailyPopupSeenRef = useRef('');
  const semiHourlySeenRef = useRef('');
  const SIDEBAR_SCROLL_KEY = 'career-crox:sidebar-scroll-top';
  const PAGE_SCROLL_KEY_PREFIX = 'career-crox:page-scroll:';
  const OFFICE_JOIN_SESSION_KEY = 'careerCroxOfficeJoinedSession';

  function officeSessionMarker() {
    try { return String(localStorage.getItem('careerCroxSessionLoginAt') || '').trim(); } catch { return ''; }
  }
  function officeIdentity() {
    return String(user?.user_id || user?.recruiter_code || user?.username || '').trim();
  }
  function istDay(value = Date.now()) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? new Date(ms + 19800000).toISOString().slice(0, 10) : '';
  }
  function hasJoinedThisLogin() {
    try {
      const saved = JSON.parse(localStorage.getItem(OFFICE_JOIN_SESSION_KEY) || 'null');
      return Boolean(saved && saved.identity === officeIdentity() && String(saved.login_marker || '') === officeSessionMarker() && saved.joined_at && saved.manual_confirmed_at && istDay(saved.joined_at) === istDay() && istDay(saved.manual_confirmed_at) === istDay());
    } catch { return false; }
  }
  function rememberOfficeJoin(joinedAt = '') {
    const stamp = String(joinedAt || '').trim();
    if (!stamp || istDay(stamp) !== istDay()) return;
    try {
      localStorage.setItem(OFFICE_JOIN_SESSION_KEY, JSON.stringify({ identity: officeIdentity(), login_marker: officeSessionMarker(), joined_at: stamp, manual_confirmed_at: stamp, day_key: istDay(stamp), join_version: 726 }));
      window.dispatchEvent(new CustomEvent('career-crox-office-joined'));
    } catch {}
  }
  function clearOfficeJoin() {
    try {
      const saved = JSON.parse(localStorage.getItem(OFFICE_JOIN_SESSION_KEY) || 'null');
      if (saved && saved.identity === officeIdentity()) localStorage.removeItem(OFFICE_JOIN_SESSION_KEY);
    } catch {}
  }

  const currentPath = String(location.pathname || '');
  const isFocusRoute = useMemo(() => {
    return currentPath.startsWith('/disabled-archive-section-never');
  }, [currentPath]);



  useEffect(() => {
    const LIVE_PROFILE_AUTO_WATCH = String(import.meta.env?.VITE_LIVE_PROFILE_AUTO_WATCH || 'false').toLowerCase() === 'true';
    if (!LIVE_PROFILE_AUTO_WATCH) return undefined; // CC26_79: global live-status auto-watch off. Use Auto Dialer / Update Details.
    if (!user?.user_id) return undefined;
    let active = true;
    let timer = null;
    const tick = async () => {
      if (!active) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      const leader = getPollingLeaderSnapshot();
      if (leader?.isLeader || !hidden) {
        try {
          const d = await api.get(`/api/dialer/live-status?lite=1&profile_watch=1&mobile_open_watch=1`, { cacheTtlMs: 10000, allowStale: true, timeoutMs: 9000 });
          const sessions = Array.isArray(d?.sessions) ? d.sessions : [];
          const allowedSources = new Set(['mobile_button', 'prepare_call', 'next_call_prepare', 'session_start']);
          const myUserId = String(user?.user_id || '');
          const myUsername = String(user?.username || user?.name || '').trim().toLowerCase();
          const belongsToMe = (s) => {
            const ids = [s?.assigned_user_id, s?.owner_user_id, s?.employee_user_id].map((v) => String(v || ''));
            const names = [s?.assigned_username, s?.owner_username, s?.employee_username].map((v) => String(v || '').trim().toLowerCase());
            return (myUserId && ids.includes(myUserId)) || (myUsername && names.includes(myUsername));
          };
          const isFresh = (s) => {
            const raw = String(s?.crm_open_profile_requested_at || s?.updated_at || '');
            const t = Date.parse(raw);
            return Number.isFinite(t) && Date.now() - t < 45000;
          };
          const isLive = (s) => {
            const text = `${s?.status || ''} ${s?.live_status || ''} ${s?.mobile_command || ''} ${s?.command_type || ''}`.toLowerCase();
            return !/(stop|stopped|completed|cancel|queued|wait|table_sync)/.test(text);
          };
          const hit = sessions.find((s) => allowedSources.has(String(s?.crm_open_profile_source || '')) && String(s?.crm_open_profile_request_version || '').trim() && belongsToMe(s) && isFresh(s) && isLive(s));
          const ver = String(hit?.crm_open_profile_request_version || '');
          const cid = String(hit?.crm_open_profile_candidate_id || '');
          if (cid && ver && ver !== lastMobileProfileRequestRef.current) {
            const globalKey = `career_crox_live_profile_opened:${ver}`;
            let shouldProcess = true;
            try {
              shouldProcess = localStorage.getItem(globalKey) !== '1';
              if (shouldProcess) { try { localStorage.setItem(globalKey, '1'); } catch {} }
            } catch {}
            lastMobileProfileRequestRef.current = ver;
            if (shouldProcess) {
              const nextCid = String(hit?.next_candidate_id || hit?.next_profile_candidate_id || '');
              const openedKey = 'career_crox_dialer_opened_profiles_v3_once_per_candidate';
              const state = liveProfileSlotRef.current || { opened: {}, slots: {}, lastTouched: 0 };
              try {
                const stored = JSON.parse(localStorage.getItem(openedKey) || '{}');
                if (stored && typeof stored === 'object') {
                  state.opened = stored.opened && typeof stored.opened === 'object' ? stored.opened : state.opened;
                  state.slots = stored.slots && typeof stored.slots === 'object' ? stored.slots : state.slots;
                }
              } catch {}
              const persist = () => {
                liveProfileSlotRef.current = state;
                try { localStorage.setItem(openedKey, JSON.stringify({ opened: state.opened || {}, slots: state.slots || {}, saved_at: Date.now() })); } catch {}
              };
              const candidateAlreadyOpen = (candidateId) => {
                const rec = state.opened?.[candidateId];
                return Boolean(rec && Date.now() - Number(rec.at || 0) < 8 * 60 * 60 * 1000);
              };
              const safeTabName = (candidateId) => `career_crox_profile_${String(candidateId || '').replace(/[^a-z0-9_]/gi, '_').slice(0, 64)}`;
              const openOnce = (candidateId, mode) => {
                const id = String(candidateId || '');
                if (!id || candidateAlreadyOpen(id)) return false;
                const tabName = safeTabName(id);
                const url = `/candidate/${encodeURIComponent(id)}?dialer_lock=1&${mode}=1&no_auto_refresh=1`;
                state.opened[id] = { slot: tabName, at: Date.now(), mode };
                state.slots[tabName] = id;
                persist();
                // Unique candidate tab: never reuses another candidate's tab, so no refresh/data-loss extra flow.
                window.open(url, tabName);
                return true;
              };
              openOnce(cid, 'mobile_open');
              const nextVer = `${ver}:${nextCid}`;
              if (nextCid && nextCid !== cid && nextVer !== lastMobileNextProfileRef.current) {
                lastMobileNextProfileRef.current = nextVer;
                openOnce(nextCid, 'next_profile');
              }
            }
          }
        } catch {}
      }
      timer = window.setTimeout(tick, hidden ? 300000 : 30000);
    };
    timer = window.setTimeout(tick, 30000);
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [user?.user_id]);


  useEffect(() => {
    if (typeof window === 'undefined' || !window.history || !('scrollRestoration' in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      try { window.history.scrollRestoration = previous || 'auto'; } catch {}
    };
  }, []);

  useEffect(() => {
    function handleWriteBusy(event) {
      setWriteBusy(Boolean(event?.detail?.busy));
    }
    window.addEventListener('career-crox-write-busy', handleWriteBusy);
    return () => window.removeEventListener('career-crox-write-busy', handleWriteBusy);
  }, []);

  const canShowInterruptPopup = useMemo(() => {
    const path = currentPath;
    if (path.startsWith('/candidate/')) return false;
    if (path.startsWith('/quick-add')) return false;
    if (path.startsWith('/interviews')) return false;
    if (path.startsWith('/chat')) return false;
    if (path.startsWith('/tasks')) return false;
    if (path.startsWith('/daily-interview-workflow')) return false;
    return true;
  }, [currentPath]);


  const activeNotificationTune = useMemo(() => {
    return NOTIFICATION_TUNE_PRESETS.find((item) => item.id === notificationTune) || NOTIFICATION_TUNE_PRESETS[NOTIFICATION_TUNE_PRESETS.length - 1];
  }, [notificationTune]);

  useEffect(() => {
    try { localStorage.setItem(NOTIFICATION_TUNE_STORAGE_KEY, notificationTune); } catch {}
  }, [notificationTune]);

  function selectNotificationTune(tuneId, preview = false) {
    const next = NOTIFICATION_TUNE_PRESETS.some((item) => item.id === tuneId) ? tuneId : 'office-tone';
    setNotificationTune(next);
    if (preview) {
      setPreviewingTuneId(next);
      window.setTimeout(() => playTaskReminderSound('preview', next), 20);
      window.setTimeout(() => setPreviewingTuneId((current) => current === next ? '' : current), 900);
    }
  }


  const rememberSidebarScroll = () => {
    if (typeof window === 'undefined') return;
    const el = sidebarRef.current;
    if (!el) return;
    try { window.sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(el.scrollTop || 0)); } catch {}
  };

  useLayoutEffect(() => {
    const el = sidebarRef.current;
    if (!el || typeof window === 'undefined') return undefined;
    const raw = window.sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
    const next = Number(raw || 0);
    if (Number.isFinite(next) && next > 0) {
      // Restore immediately, then once more after layout settles. This prevents a
      // route remount from snapping the sidebar back to the top.
      el.scrollTop = next;
      window.requestAnimationFrame(() => {
        if (sidebarRef.current) sidebarRef.current.scrollTop = next;
      });
    }
    const save = () => {
      try { window.sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(el.scrollTop || 0)); } catch {}
    };
    el.addEventListener('scroll', save, { passive: true });
    window.addEventListener('beforeunload', save);
    return () => {
      save(); // layout-effect cleanup runs before the next route layout-effect restore
      el.removeEventListener('scroll', save);
      window.removeEventListener('beforeunload', save);
    };
  }, [location.pathname]);

  useLayoutEffect(() => {
    const el = pageScrollRef.current;
    if (!el || typeof window === 'undefined') return;
    const key = `${PAGE_SCROLL_KEY_PREFIX}${location.pathname}${location.search || ''}`;

    // CC26_654: a fresh candidate must open at the absolute top even while the long form
    // is still expanding. Chrome scroll anchoring previously pulled the viewport back to Notes.
    if (String(location.pathname || '').replace(/\/+$/, '') === '/candidate/new') {
      try {
        for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
          const storageKey = window.sessionStorage.key(i) || '';
          if (storageKey.startsWith(`${PAGE_SCROLL_KEY_PREFIX}/candidate/new`)) window.sessionStorage.removeItem(storageKey);
        }
      } catch {}
      const forceTop = () => {
        const current = pageScrollRef.current;
        if (current) { current.style.overflowAnchor = 'none'; current.scrollTop = 0; try { current.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch {} }
        try { document.scrollingElement.scrollTop = 0; } catch {}
        try { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; window.scrollTo(0, 0); } catch {}
      };
      forceTop();
      const rafOne = window.requestAnimationFrame(forceTop);
      const rafTwo = window.requestAnimationFrame(() => window.requestAnimationFrame(forceTop));
      const timers = [40, 100, 220, 450, 800, 1300, 2000].map((ms) => window.setTimeout(forceTop, ms));
      let resizeObserver;
      try {
        resizeObserver = new ResizeObserver(forceTop);
        if (pageScrollRef.current?.firstElementChild) resizeObserver.observe(pageScrollRef.current.firstElementChild);
        window.setTimeout(() => resizeObserver?.disconnect(), 2100);
      } catch {}
      return () => {
        try { window.cancelAnimationFrame(rafOne); window.cancelAnimationFrame(rafTwo); } catch {}
        timers.forEach((timer) => window.clearTimeout(timer));
        try { resizeObserver?.disconnect(); } catch {}
        if (pageScrollRef.current) pageScrollRef.current.style.removeProperty('overflow-anchor');
      };
    }

    const raw = window.sessionStorage.getItem(key);
    const next = Number(raw || 0);
    if (!Number.isFinite(next) || next <= 0) return;
    const apply = () => {
      if (pageScrollRef.current) pageScrollRef.current.scrollTop = next;
      try { window.scrollTo(0, 0); } catch {}
    };
    window.requestAnimationFrame(apply);
    const fastTimer = window.setTimeout(apply, 120);
    const slowTimer = window.setTimeout(apply, 420);
    return () => {
      window.clearTimeout(fastTimer);
      window.clearTimeout(slowTimer);
    };
  }, [location.pathname, location.search]);

  useEffect(() => {
    const el = pageScrollRef.current;
    if (!el || typeof window === 'undefined') return undefined;
    const key = `${PAGE_SCROLL_KEY_PREFIX}${location.pathname}${location.search || ''}`;
    const save = () => {
      window.sessionStorage.setItem(key, String(el.scrollTop || 0));
    };
    save();
    el.addEventListener('scroll', save, { passive: true });
    window.addEventListener('beforeunload', save);
    return () => {
      el.removeEventListener('scroll', save);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [location.pathname, location.search]);

  function playTaskReminderSound(kind = 'soft', forcedTuneId = '') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const selected = NOTIFICATION_TUNE_PRESETS.find((item) => item.id === forcedTuneId)
        || NOTIFICATION_TUNE_PRESETS.find((item) => item.id === notificationTune)
        || NOTIFICATION_TUNE_PRESETS[NOTIFICATION_TUNE_PRESETS.length - 1];
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const notes = Array.isArray(selected?.notes) && selected.notes.length ? selected.notes : [523, 659, 831];
      const wave = selected?.wave || 'sine';
      const volumeMap = {
        soft: 0.018,
        notify: 0.024,
        popup: 0.028,
        preview: 0.03,
      };
      const ampBase = volumeMap[kind] || volumeMap.soft;
      const spacing = Number(selected?.spacing) || (kind === 'preview' ? 0.065 : kind === 'popup' ? 0.058 : 0.05);
      const hold = Number(selected?.hold) || (kind === 'preview' ? 0.18 : kind === 'popup' ? 0.15 : 0.13);
      const glide = Number(selected?.glide || 0);
      const accent = Number(selected?.accent || 1);
      const detuneStep = Number(selected?.detune_step || 0);
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const noteTime = now + (index * spacing);
        const finalFreq = Number(freq) || 660;
        const noteAmp = ampBase * (index === notes.length - 1 ? Math.max(1, accent) : 1);
        osc.type = wave;
        osc.frequency.setValueAtTime(finalFreq, noteTime);
        if (detuneStep) osc.detune.setValueAtTime(detuneStep * index, noteTime);
        if (glide) {
          osc.frequency.linearRampToValueAtTime(finalFreq * glide, noteTime + Math.min(hold * 0.6, 0.08));
        } else if (kind === 'notify' || kind === 'preview') {
          osc.frequency.linearRampToValueAtTime(finalFreq * 1.015, noteTime + 0.03);
        }
        gain.gain.setValueAtTime(0.0001, noteTime);
        gain.gain.exponentialRampToValueAtTime(noteAmp, noteTime + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + hold);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(noteTime);
        osc.stop(noteTime + hold + 0.03);
      });
      window.setTimeout(() => {
        if (typeof ctx.close === 'function') ctx.close().catch(() => {});
      }, Math.max(420, notes.length * 120));
    } catch {}
  }

  function clearTaskPopupCloseTimer() {
    if (taskPopupCloseTimerRef.current) {
      window.clearTimeout(taskPopupCloseTimerRef.current);
      taskPopupCloseTimerRef.current = null;
    }
  }

  function dismissTaskPopup(afterClose) {
    if (!taskPopup) {
      if (typeof afterClose === 'function') afterClose();
      return;
    }
    clearTaskPopupCloseTimer();
    setTaskPopupAnimatingOut(true);
    taskPopupCloseTimerRef.current = window.setTimeout(() => {
      setTaskPopup(null);
      setTaskPopupAnimatingOut(false);
      taskPopupCloseTimerRef.current = null;
      if (typeof afterClose === 'function') afterClose();
    }, 220);
  }

  function snoozeTaskPopup(minutes) {
    if (!taskPopup?.task_id) return;
    try { localStorage.setItem(`task_snooze_${taskPopup.task_id}`, String(Date.now() + Number(minutes || 0) * 60 * 1000)); } catch {}
    dismissTaskPopup();
  }

  function snoozeFollowUpPopup(minutes = 5) {
    if (!followUpPopup?.candidate_id) return;
    try { localStorage.setItem(`followup_snooze_${followUpPopup.candidate_id}`, String(Date.now() + Number(minutes || 0) * 60 * 1000)); } catch {}
    setFollowUpPopup(null);
  }

  async function completeFollowUpFromPopup() {
    const active = followUpPopup || {};
    const candidateId = String(active.candidate_id || '').trim();
    if (!candidateId) {
      setFollowUpPopup(null);
      return;
    }
    try {
      await api.post('/api/followups/action', {
        candidate_id: candidateId,
        follow_up_status: 'Done',
        follow_up_note: active.follow_up_note ? `${active.follow_up_note} • Closed from popup` : 'Closed from popup',
        follow_up_at: '',
      });
      setFollowUpPopup(null);
    } catch (err) {
      setToast({
        title: 'Follow-up not closed',
        message: err?.message || 'Please open the profile and close the follow-up manually.',
      });
      window.setTimeout(() => setToast(null), 2600);
    }
  }

  function snoozeDailyWorkflowPopup(kind, dateKey, minutes = DAILY_WORKFLOW_SNOOZE_MINUTES) {
    if (!user?.user_id || !kind || !dateKey) return;
    try { localStorage.setItem(dailyWorkflowSnoozeKey(user.user_id, kind, dateKey), String(Date.now() + Number(minutes || 0) * 60 * 1000)); } catch {}
    setDailyWorkflowPopup(null);
  }

  function openDailyWorkflowFromPopup() {
    if (!dailyWorkflowPopup) return;
    if (['previous', 'tomorrow'].includes(dailyWorkflowPopup.kind)) {
      snoozeDailyWorkflowPopup(dailyWorkflowPopup.kind, dailyWorkflowPopup.dateKey, DAILY_WORKFLOW_SNOOZE_MINUTES);
    } else {
      setDailyWorkflowPopup(null);
    }
    const path = dailyWorkflowPopup.kind === 'previous'
      ? '/daily-interview-workflow?view=previous&tab=pending'
      : dailyWorkflowPopup.kind === 'tomorrow'
        ? '/daily-interview-workflow?view=tomorrow'
        : '/daily-interview-workflow?view=today';
    window.open(path, '_blank', 'noopener,noreferrer');
  }

  function currentSemiHourlyKey() {
    const parts = crmDateParts(Date.now());
    if (!parts) return '';
    const minute = Number(parts.minute || 0) >= 30 ? '30' : '00';
    return `${parts.ymd}T${parts.hour}:${minute}`;
  }

  function openSemiHourlyReport() {
    const key = currentSemiHourlyKey();
    try { localStorage.setItem(`semi_hourly_opened_${user?.user_id}_${key}`, '1'); } catch {}
    setSemiHourlyPopup(null);
    const reportId = semiHourlyPopup?.reportId ? `?reportId=${encodeURIComponent(semiHourlyPopup.reportId)}` : '';
    window.open(`/semi-hourly-report${reportId}`, '_blank', 'noopener,noreferrer');
  }

  async function loadSemiHourlyPopup() {
    if (!AUTO_SYSTEM_POPUPS_ENABLED || !AUTO_SEMI_HOURLY_POPUPS_ENABLED) {
      setSemiHourlyPopup(null);
      return;
    }
    if (String(location.pathname || '').startsWith('/semi-hourly-report')) {
      setSemiHourlyPopup(null);
      return;
    }
    if (!user?.user_id || !['admin','manager','tl','recruiter'].includes(normalizedRole)) {
      setSemiHourlyPopup(null);
      return;
    }
    const key = currentSemiHourlyKey();
    const alreadyOpened = localStorage.getItem(`semi_hourly_opened_${user.user_id}_${key}`) === '1';
    if (alreadyOpened) {
      setSemiHourlyPopup(null);
      return;
    }

    let reportId = '';
    const savedMarker = `semi_hourly_saved_${user.user_id}_${key}`;
    try {
      if (localStorage.getItem(savedMarker) !== '1') {
        const snapshot = await api.get('/api/reports/semi-hourly?generate=1&auto=1&window=current', { cacheTtlMs: 0, background: true });
        reportId = snapshot?.saved_report_id || '';
        try { localStorage.setItem(savedMarker, '1'); } catch {}
        if (reportId) { try { localStorage.setItem(`${savedMarker}_id`, reportId); } catch {} }
        if (snapshot?.summary) { try { localStorage.setItem(`${savedMarker}_summary`, JSON.stringify(snapshot.summary)); } catch {} }
      } else {
        reportId = localStorage.getItem(`${savedMarker}_id`) || '';
      }
    } catch {
      reportId = localStorage.getItem(`${savedMarker}_id`) || '';
    }

    setSemiHourlyPopup({
      key,
      reportId,
      summary: (() => {
        try {
          const raw = localStorage.getItem(`${savedMarker}_summary`);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      })(),
      title: '30-Minute Performance Report',
      message: 'Open the 30-minute performance snapshot in a new tab.',
    });
  }

  async function loadDailyWorkflowPopup() {
    if (!AUTO_SYSTEM_POPUPS_ENABLED) {
      setDailyWorkflowPopup(null);
      return;
    }
    if (!user?.user_id || !canShowInterruptPopup) {
      setDailyWorkflowPopup(null);
      return;
    }
    try {
      const data = await api.get('/api/interviews', { background: true, cacheTtlMs: 60000, timeoutMs: 12000 });
      const rows = (data.items || []).filter((row) => !DAILY_TERMINAL_STATUSES.has(lowerText(row?.status)));
      const now = new Date();
      const nowParts = crmDateParts(now);
      const minutesNow = Number(nowParts?.hour || 0) * 60 + Number(nowParts?.minute || 0);
      const todayKey = crmTodayYmd();
      const tomorrowKey = crmYmd(Date.now() + 24 * 60 * 60 * 1000);
      const todayRows = rows.filter((row) => interviewDateKey(row) === todayKey);
      const previousPending = rows.filter((row) => isPastInterview(row, now) && lowerText(row?.all_details_sent) === 'pending');
      const previousCompleted = rows.filter((row) => isPastInterview(row, now) && lowerText(row?.all_details_sent) !== 'pending');
      const tomorrowPending = rows.filter((row) => interviewDateKey(row) === tomorrowKey && !DAILY_RESOLVED_TOMORROW_STATUSES.has(lowerText(row?.status)));

      let nextPopup = null;
      if (minutesNow >= 17 * 60 && tomorrowPending.length) {
        nextPopup = {
          kind: 'tomorrow',
          dateKey: tomorrowKey,
          title: 'Next Day Interview Follow-up',
          message: `${tomorrowPending.length} candidates still need confirmation for tomorrow's interview schedule. Open the list and update the status to All Set For Interview.`,
          primaryLabel: 'Open Pending',
          secondaryLabel: 'Later 15m',
        };
      } else if (minutesNow >= 13 * 60 && (previousPending.length || previousCompleted.length)) {
        nextPopup = {
          kind: 'previous',
          dateKey: todayKey,
          title: 'Follow Your Previous Candidate',
          message: `${previousPending.length} pending-detail rows and ${previousCompleted.length} completed-detail rows are ready for review. Open both workflow tabs to complete the follow-up check.`,
          primaryLabel: 'Open 2 Tabs',
          secondaryLabel: 'Later 15m',
        };
      } else if (minutesNow < 13 * 60 && todayRows.length) {
        nextPopup = {
          kind: 'today',
          dateKey: todayKey,
          title: "Today's Interviews",
          message: `${todayRows.length} interviews are scheduled for today. Open the list and contact every candidate.`,
          primaryLabel: 'Open List',
          secondaryLabel: 'Hide',
        };
      }

      if (!nextPopup) {
        setDailyWorkflowPopup(null);
        return;
      }

      const snoozeUntil = Number(localStorage.getItem(dailyWorkflowSnoozeKey(user.user_id, nextPopup.kind, nextPopup.dateKey)) || 0);
      if (Date.now() < snoozeUntil) {
        setDailyWorkflowPopup(null);
        return;
      }

      setDailyWorkflowPopup((current) => {
        if (current && current.kind === nextPopup.kind && current.dateKey === nextPopup.dateKey && current.message === nextPopup.message) return current;
        return nextPopup;
      });
    } catch {}
  }


  async function loadMeta(silent = false) {
    try {
      const meta = await api.get('/api/ui/meta', { cacheTtlMs: 30000, timeoutMs: 12000, background: true });
      const nextNotifications = Number(meta.unread_notifications || 0) || 0;
      const nextApprovals = (Number(meta.pending_approvals || 0) || 0) + (Number(meta.pending_submission_approvals || 0) || 0);
      if (!silent && (nextNotifications > notificationCountRef.current || nextApprovals > approvalCountRef.current)) {
        playTaskReminderSound('notify');
      }
      notificationCountRef.current = nextNotifications;
      approvalCountRef.current = nextApprovals;
      setNotifications(nextNotifications);
      setApprovals(nextApprovals);
      const newest = meta.latest_notification || null;
      if (newest && newest.notification_id !== lastNotificationId) {
        if (lastNotificationId && String(newest.status || '').toLowerCase() === 'unread' && !silent) {
          setToast({ title: newest.title, message: newest.message, item: newest });
          window.setTimeout(() => setToast(null), String(newest.category || '').toLowerCase() === 'attendance' ? 1800 : (String(newest.category || '').toLowerCase() === 'chat' ? 1000 : 3000));
        }
        setLastNotificationId(newest.notification_id);
      }
    } catch {}
  }

  async function loadApprovalReminder() {
    if (!AUTO_SYSTEM_POPUPS_ENABLED || !user?.user_id || !leadership || isFocusRoute || !canShowInterruptPopup) {
      setApprovalPopup(null);
      return;
    }
    try {
      const data = await api.get('/api/approvals', { background: true, cacheTtlMs: 30000, timeoutMs: 12000 });
      const available = (data.items || []).filter((item) => {
        const snoozeUntil = Number(localStorage.getItem(`approval_snooze_${item.id}`) || 0);
        return Date.now() > snoozeUntil;
      });
      const next = available.find((item) => item.type === 'unlock') || available[0] || null;
      setApprovalPopup((current) => {
        if (!next) return null;
        if (current && current.id === next.id && current.type === next.type && current.requested_at === next.requested_at) return current;
        return next;
      });
    } catch {
      setApprovalPopup(null);
    }
  }

  async function loadRevenueReminder() {
    if (!user?.user_id) {
      setRevenuePopup(null);
      return;
    }
    try {
      if (!canAccessFeature(normalizedRole, 'revenue-hub')) {
        setRevenuePopup(null);
        return;
      }
      const data = await api.get('/api/revenue-hub/reminders', { background: true, cacheTtlMs: 120000, timeoutMs: 12000 });
      const item = data.item || null;
      if (!item) {
        setRevenuePopup(null);
        return;
      }
      const snoozeUntil = Number(localStorage.getItem(`revenue_snooze_${item.revenue_id}`) || 0);
      if (Date.now() < snoozeUntil) return;
      setRevenuePopup(item);
    } catch {}
  }

  function snoozeRevenuePopup(minutes = 120) {
    if (!revenuePopup?.revenue_id) return;
    try { localStorage.setItem(`revenue_snooze_${revenuePopup.revenue_id}`, String(Date.now() + minutes * 60 * 1000)); } catch {}
    setRevenuePopup(null);
  }


  function scheduleReminderAtOriginalTime(key, item, dueValue, setter) {
    const dueAt = Number(dueValue || 0) || new Date(dueValue || 0).getTime() || 0;
    const now = Date.now();
    if (!key || !dueAt || !Number.isFinite(dueAt)) return false;
    if (dueAt <= now + 3000) {
      const oldTimer = scheduledReminderTimersRef.current.get(key);
      if (oldTimer) window.clearTimeout(oldTimer);
      scheduledReminderTimersRef.current.delete(key);
      return false;
    }
    if (!scheduledReminderTimersRef.current.has(key)) {
      const delayMs = Math.min(dueAt - now, CRM_REMINDER_LOOKAHEAD_MS);
      const timer = window.setTimeout(() => {
        scheduledReminderTimersRef.current.delete(key);
        setter(item);
      }, delayMs);
      scheduledReminderTimersRef.current.set(key, timer);
    }
    return true;
  }

  function clearScheduledReminder(key) {
    const timer = scheduledReminderTimersRef.current.get(key);
    if (timer) window.clearTimeout(timer);
    scheduledReminderTimersRef.current.delete(key);
  }

  async function loadTaskReminder() {
    if (!user?.user_id || !canShowInterruptPopup) {
      if (taskPopup) dismissTaskPopup();
      return;
    }
    try {
      const data = await api.get('/api/tasks/reminders/next', { background: true, cacheTtlMs: 60000, timeoutMs: 12000 });
      const next = data.item || null;
      if (next) {
        const snoozeUntil = Number(localStorage.getItem(`task_snooze_${next.task_id}`) || 0);
        if (Date.now() <= snoozeUntil) {
          if (taskPopup) dismissTaskPopup();
          return;
        }
      }

      if (!next) {
        if (taskPopup) dismissTaskPopup();
        return;
      }

      const taskKey = `task:${next.task_id}`;
      if (scheduleReminderAtOriginalTime(taskKey, next, next.dueAt || next.due_date, (item) => {
        clearTaskPopupCloseTimer();
        setTaskPopupAnimatingOut(false);
        setTaskPopup((current) => {
          if (!current) return item;
          return current.task_id === item.task_id ? { ...current, ...item } : item;
        });
      })) {
        return;
      }
      clearScheduledReminder(taskKey);
      clearTaskPopupCloseTimer();
      setTaskPopupAnimatingOut(false);
      setTaskPopup((current) => {
        if (!current) return next;
        return current.task_id === next.task_id ? { ...current, ...next } : next;
      });
    } catch {}
  }



  async function loadFollowUpPopup() {
    if (!user?.user_id) {
      setFollowUpPopup(null);
      return;
    }
    try {
      const data = await api.get('/api/followups/reminders/next', { background: true, cacheTtlMs: 60000, timeoutMs: 12000 });
      const now = Date.now();
      const next = (() => {
        const item = data.item || null;
        if (!item) return null;
        const snoozeUntil = Number(localStorage.getItem(`followup_snooze_${item.candidate_id}`) || 0);
        return now > snoozeUntil ? item : null;
      })();
      if (!next) {
        setFollowUpPopup(null);
        return;
      }
      const followupKey = `followup:${next.candidate_id}`;
      if (scheduleReminderAtOriginalTime(followupKey, next, next.dueAt || next.follow_up_at, (item) => setFollowUpPopup(item))) {
        return;
      }
      clearScheduledReminder(followupKey);
      setFollowUpPopup(next);
    } catch {}
  }


  async function loadGlobalSubmissionReminderPopup() {
    if (!AUTO_SYSTEM_POPUPS_ENABLED || !user?.user_id || (!BASIC_CRM_MODE && !hasJoinedThisLogin())) {
      setGlobalSubmissionReminderPopup(null);
      return;
    }
    try {
      const query = new URLSearchParams();
      query.set('view', 'all_pending');
      query.set('_global_reminder', String(Date.now()));
      const data = await api.get(`/api/submissions?${query.toString()}`, { background: true, cacheTtlMs: 0, timeoutMs: 15000, retries: 0, allowStale: false });
      const rows = data?.items || [];
      const dueNow = pickGlobalSubmissionReminder(rows);
      const nearest = pickUpcomingGlobalSubmissionReminder(rows);
      if (nearest && !dueNow) {
        const reminderKey = `submission:${globalSubmissionReminderKey(nearest)}`;
        if (scheduleReminderAtOriginalTime(reminderKey, nearest, globalSubmissionReminderStamp(nearest), (item) => setGlobalSubmissionReminderPopup(item))) {
          return;
        }
        clearScheduledReminder(reminderKey);
      }
      setGlobalSubmissionReminderPopup((current) => {
        if (!dueNow) return null;
        return current?.submission_id === dueNow.submission_id ? { ...current, ...dueNow } : dueNow;
      });
    } catch {
      setGlobalSubmissionReminderPopup(null);
    }
  }

  function snoozeGlobalSubmissionReminderPopup(minutes = 5) {
    const active = globalSubmissionReminderPopup || {};
    const key = globalSubmissionReminderKey(active);
    if (key) {
      try { localStorage.setItem(`cc_global_submission_reminder_snooze_${key}`, String(Date.now() + Number(minutes || 5) * 60 * 1000)); } catch {}
    }
    setGlobalSubmissionReminderPopup(null);
  }

  async function refreshAttendanceGate(forceFresh = false) {
    if (!user?.user_id) return null;
    try {
      const data = await api.get('/api/attendance?compact=1', {
        cacheTtlMs: 0,
        timeoutMs: 10000,
        background: true,
      });
      setAttendanceGate(data);
      // The server owns today's join timestamp. Refresh restores it without a second JOIN POST.
      const claimedJoined = data?.today_stats?.joined_today === true;
      const confirmed = claimedJoined && data?.today_stats?.manual_join_confirmed === '1' && window.__CC723_OFFICE_RESTORE__?.(data) === true;
      if (!claimedJoined) window.__CC722_OFFICE_SERVER_UNJOINED__?.();
      setShowJoinOffice(!confirmed && !hasJoinedThisLogin());
      return data;
    } catch {
      // Attendance read failure must not create an endless loader. Keep the single Join Office action available.
      setShowJoinOffice(!hasJoinedThisLogin());
      return null;
    }
  }

  async function pingPresence() {
    if (!hasJoinedThisLogin()) return;
    try {
      const hadActivity = humanActivitySincePingRef.current;
      humanActivitySincePingRef.current = false;
      const data = await api.post('/api/attendance/ping', {
        last_page: location.pathname,
        compact: true,
        has_activity: hadActivity ? '1' : '0',
        last_activity_at: lastHumanActivityAtRef.current ? new Date(lastHumanActivityAtRef.current).toISOString() : '',
      }, { timeoutMs: 8000, background: true });
      if (data?.presence || data?.today_stats) setAttendanceGate(data);
    } catch {}
  }


  // Local countdown only while a break is active; no additional polling or egress.
  useEffect(() => {
    if (approvalLockExempt || (String(attendanceGate?.presence?.is_on_break || '0') !== '1' && String(attendanceGate?.presence?.lock_reason || '') !== 'break_exceeded')) return undefined;
    const id = window.setInterval(() => setBreakCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [attendanceGate?.presence?.is_on_break, attendanceGate?.presence?.lock_reason, approvalLockExempt]);
  // CC26_609: event-only unlock, a single compact attendance read after actual approval.
  // Never poll the unlock table; the deployed SPA also handles this via SecureLink sidebar.
  useEffect(() => {
    const handle = (event) => {
      if (String(event.detail?.status || '').toLowerCase() === 'approved' && !window.__CC602_NETWORK_PAUSED__ && !document.querySelector('.premium-crm-lock-request-modal')) {
        refreshAttendanceGate(true).catch(() => {});
      }
    };
    window.addEventListener('cc609:unlock-resolved', handle);
    return () => window.removeEventListener('cc609:unlock-resolved', handle);
  }, [user?.user_id]);
  // CC26_556: the single visible break gate handles expiration via one existing
  // /attendance/end-break action. Do NOT launch a second independent React expiry request.
  // The API determines break approval locks; managers remain exempt.
  useEffect(() => {
    if (isFocusRoute) {
      setRevenuePopup(null);
    }
  }, [user?.user_id, location.pathname, isFocusRoute]);
  useEffect(() => {
    if (isFocusRoute) {
      setDailyWorkflowPopup(null);
    }
  }, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute]);
  useEffect(() => {
    if (isFocusRoute) {
      setSemiHourlyPopup(null);
    }
  }, [user?.user_id, location.pathname, isFocusRoute]);
  usePolling(loadRevenueReminder, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : POPUP_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  useEffect(() => {
    function handleClickOutside(event) {
      if (quickAddRef.current && !quickAddRef.current.contains(event.target)) setShowAddMenu(false);
    }
    function handleEscape(event) {
      if (event.key === 'Escape') setShowAddMenu(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);
  useEffect(() => { setShowAddMenu(false); }, [location.pathname]);

  useEffect(() => {
    if (isFocusRoute) {
      setTaskPopup(null);
      setFollowUpPopup(null);
    }
  }, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute]);
  usePolling(loadMeta, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : META_POLL_MS, [user?.user_id, isFocusRoute, writeBusy]);
  usePolling(loadApprovalReminder, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : APPROVAL_POLL_MS, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadTaskReminder, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : POPUP_POLL_MS, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadFollowUpPopup, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : POPUP_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadGlobalSubmissionReminderPopup, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy || (!BASIC_CRM_MODE && (showJoinOffice || !hasJoinedThisLogin()))) ? 0 : POPUP_POLL_MS, [user?.user_id, location.pathname, writeBusy, showJoinOffice]);
  usePolling(loadDailyWorkflowPopup, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : POPUP_POLL_MS, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadSemiHourlyPopup, (AUTO_SYSTEM_POPUPS_ENABLED && AUTO_SEMI_HOURLY_POPUPS_ENABLED) ? POPUP_POLL_MS : 0, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(pingPresence, BASIC_CRM_MODE || writeBusy ? 0 : PRESENCE_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(refreshAttendanceGate, BASIC_CRM_MODE || !AUTO_SYSTEM_POPUPS_ENABLED || writeBusy ? 0 : ATTENDANCE_GATE_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);

  useEffect(() => {
    if (!user?.user_id) return;
    if (BASIC_CRM_MODE) { setShowJoinOffice(false); setAttendanceGate(null); return; }
    setShowJoinOffice(!hasJoinedThisLogin());
    refreshAttendanceGate(true);
  }, [user?.user_id]);

  useEffect(() => {
    if (!taskPopup) {
      hadVisibleTaskPopupRef.current = false;
      return undefined;
    }
    if (!hadVisibleTaskPopupRef.current) {
      hadVisibleTaskPopupRef.current = true;
      playTaskReminderSound('popup');
    }
    return undefined;
  }, [taskPopup]);

  useEffect(() => {
    const key = `${approvalPopup?.type || ''}:${approvalPopup?.id || ''}`;
    if (!String(key).replace(':', '')) {
      approvalPopupSeenRef.current = '';
      return;
    }
    if (approvalPopupSeenRef.current !== key) {
      approvalPopupSeenRef.current = key;
      playTaskReminderSound('soft');
    }
  }, [approvalPopup]);

  useEffect(() => {
    if (!approvalPopup) {
      setApprovalReminderForm({ exact_time: '' });
    }
  }, [approvalPopup]);

  useEffect(() => {
    const key = String(followUpPopup?.candidate_id || '');
    if (!key) {
      followupPopupSeenRef.current = '';
      return;
    }
    if (followupPopupSeenRef.current !== key) {
      followupPopupSeenRef.current = key;
      playTaskReminderSound('popup');
    }
  }, [followUpPopup]);

  useEffect(() => {
    const key = `${dailyWorkflowPopup?.kind || ''}:${dailyWorkflowPopup?.dateKey || ''}`;
    if (!String(key).replace(':', '')) {
      dailyPopupSeenRef.current = '';
      return;
    }
    if (dailyPopupSeenRef.current !== key) {
      dailyPopupSeenRef.current = key;
      playTaskReminderSound('soft');
    }
  }, [dailyWorkflowPopup]);

  useEffect(() => {
    const key = String(semiHourlyPopup?.summary || semiHourlyPopup?.generated_at || '');
    if (!key) {
      semiHourlySeenRef.current = '';
      return;
    }
    if (semiHourlySeenRef.current !== key) {
      semiHourlySeenRef.current = key;
      playTaskReminderSound('soft');
    }
  }, [semiHourlyPopup]);

  useEffect(() => () => {
    clearTaskPopupCloseTimer();
    for (const timer of scheduledReminderTimersRef.current.values()) window.clearTimeout(timer);
    scheduledReminderTimersRef.current.clear();
  }, []);

  const canRenderTaskPopup = useMemo(() => Boolean(taskPopup) && !approvalPopup && !followUpPopup && !dailyWorkflowPopup && !revenuePopup && !goalPostReminderPopup, [taskPopup, approvalPopup, followUpPopup, dailyWorkflowPopup, revenuePopup, goalPostReminderPopup]);

  const baseNav = useMemo(() => {
    const items = [
      { key: 'candidates', label: 'Candidates', href: '/candidates' },
      { key: 'quick-add', label: 'Quick Add', href: '/quick-add' },
      { key: 'submissions', label: 'Submissions', href: '/submissions' },
      { key: 'interviews', label: 'Interviews', href: '/interviews' },
      { key: 'followups', label: 'FollowUps', href: '/followups' },
      { key: 'tasks', label: 'Tasks', href: '/tasks' },
      { key: 'live-dialing', label: 'Call Assistant', href: '/live-dialing' },
      { key: 'team-chat', label: 'Team Chat', href: '/chat' },
      { key: 'goal-post', label: 'Goal Post', href: '/goal-post' },
      { key: 'revenue-hub', label: 'Revenue Hub', href: '/revenue-hub' },
      { key: 'bucket', label: 'Bucket', href: '/bucket-out' },
      { key: 'duplicate-profiles', label: 'Duplicate Profiles', href: '/duplicate-profiles' },
      { key: 'approvals', label: 'Approvals', href: '/approvals' },
      { key: 'recent-activity', label: 'CRM Logs', href: '/recent-activity' },
      { key: 'admin-control', label: 'Admin Control', href: '/admin' },
    ];
    return items.filter((item) => canAccessFeature(normalizedRole, item.key));
  }, [normalizedRole]);

  const navStorageKey = `careerCroxSidebarOrder:${normalizedRole || 'guest'}`;
  const [navOrder, setNavOrder] = useState([]);
  const [dragKey, setDragKey] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(navStorageKey) || '[]');
      setNavOrder(Array.isArray(saved) ? saved : []);
    } catch {
      setNavOrder([]);
    }
  }, [navStorageKey]);

  const nav = useMemo(() => {
    if (!baseNav.length) return [];
    const byKey = new Map(baseNav.map((item) => [item.key, item]));
    const ordered = [];
    for (const key of navOrder) {
      if (byKey.has(key)) ordered.push(byKey.get(key));
    }
    for (const item of baseNav) {
      if (!ordered.find((row) => row.key === item.key)) ordered.push(item);
    }
    return ordered;
  }, [baseNav, navOrder]);

  useEffect(() => {
    if (!nav.length) return;
    try { localStorage.setItem(navStorageKey, JSON.stringify(nav.map((item) => item.key))); } catch {}
  }, [nav, navStorageKey]);

  function reorderNav(targetKey) {
    if (!dragKey || !targetKey || dragKey === targetKey) return;
    setNavOrder((current) => {
      const currentOrder = current.length ? current.filter((key) => nav.some((item) => item.key === key)) : nav.map((item) => item.key);
      const filtered = currentOrder.filter((key) => key !== dragKey);
      const targetIndex = filtered.indexOf(targetKey);
      if (targetIndex < 0) return [...filtered, dragKey];
      filtered.splice(targetIndex, 0, dragKey);
      return filtered;
    });
  }

  async function applyTheme(nextTheme) {
    if ((nextTheme === 'burgundy' || nextTheme === 'crimson-noir') && normalizedRole !== 'manager') return;
    // CC26_522: a preset is a complete CRM look. Clear old custom overrides so
    // the selected gradient/theme is visible across every slice immediately.
    setTheme(nextTheme);
    setCustomTheme(null);
    try { await persistTheme(nextTheme, null); } catch {}
    setToast({ title: 'Theme applied', message: `${themes.find(([key]) => key === nextTheme)?.[1] || 'Theme'} is now active across the CRM.` });
  }

  async function fetchGoldReminder() {
    try {
      const data = await api.get('/api/goal-post/reminders', { background: true, cacheTtlMs: 120000, retries: 0, timeoutMs: 12000 });
      setGoalPostReminderPopup(data?.popup || null);
    } catch {}
  }

  usePolling(fetchGoldReminder, AUTO_SYSTEM_POPUPS_ENABLED ? GOLD_REMINDER_POLL_MS : 0, [user?.user_id, currentPath]);

  useEffect(() => {
    if (!user?.user_id) return undefined;
    const markHumanActivity = () => {
      lastHumanActivityAtRef.current = Date.now();
      humanActivitySincePingRef.current = true;
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'click', 'wheel', 'scroll']; // CC26_455: cursor movement alone is not meaningful work
    events.forEach((name) => window.addEventListener(name, markHumanActivity, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, markHumanActivity));
  }, [user?.user_id]);

  async function openLogoutSummaryOrLogout() {
    if (BASIC_CRM_MODE) {
      await logout();
      navigate('/login', { replace: true });
      return;
    }
    try {
      const data = await api.get('/api/attendance/logout-summary', { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 });
      setLogoutSummary(data.summary || null);
      setShowLogoutSummary(true);
    } catch {
      await logout();
      navigate('/login', { replace: true });
    }
  }

  async function logoutWithoutGoalPostUpdate() {
    setGoalPostLogoutChoice(null);
    await openLogoutSummaryOrLogout();
  }

  async function onLogout() {
    const shouldRunManagerLogoutChecks = ['admin', 'manager'].includes(normalizedRole);
    if (shouldRunManagerLogoutChecks) {
      try {
        const goalPostCheck = await api.get('/api/goal-post/logout-check', { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 });
        if (goalPostCheck?.blocked) {
          setGoalPostLogoutChoice(goalPostCheck || {});
          setToast({ title: 'Goal Post Reminder', message: 'You can update Goal Post now or continue logout without updating it.', item: null, category: 'goal-post' });
          return;
        }
        if (!BASIC_CRM_MODE) {
          const revenueCheck = await api.get('/api/revenue-hub/logout-check', { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 });
          if (revenueCheck?.blocked) {
            setToast({ title: 'Pipeline Hub update required', message: `${revenueCheck.count} interview items still need status update before logout.`, item: null });
            navigate('/revenue-hub');
            return;
          }
        }
      } catch {}
    }
    await openLogoutSummaryOrLogout();
  }

  async function sendReportAndLogout() {
    setSendingReport(true);
    try {
      try {
        await api.post('/api/attendance/send-report', { notes: logoutReportNotes }, { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 });
      } catch {}
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setSendingReport(false);
      setShowLogoutSummary(false);
      setLogoutReportNotes('');
    }
  }

  function onSearch(e) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(query)}`);
  }

  async function sendManualDialerCall() {
    const phone = String(manualDialerPhone || '').replace(/\D+/g, '').slice(-10);
    if (phone.length !== 10) {
      setManualDialerMessage('Enter a valid 10 digit phone number. Even CRM needs basic survival rules.');
      return;
    }
    setManualDialerBusy(true);
    setManualDialerMessage('Sending call command to mobile app...');
    try {
      await api.post('/api/dialer/manual-call', { phone, candidate_name: manualDialerName, command_source: 'global_manual_dialer', next_call_gap_seconds: 1, instant_start: '1' }, { timeoutMs: 18000 });
      setManualDialerMessage('Mobile app call command sent. This call will count in daily performance.');
      setManualDialerPhone('');
      setManualDialerName('');
      window.setTimeout(() => setManualDialerOpen(false), 900);
    } catch (error) {
      setManualDialerMessage(error?.message || 'Manual dialer failed. Mobile pairing or session may be missing.');
    } finally {
      setManualDialerBusy(false);
    }
  }

  function updateCustomTheme(patch) {
    const next = { ...effectiveCustomTheme, ...patch };
    setCustomTheme(next);
    persistTheme(theme, next).catch(() => {});
  }

  function saveCurrentLook() {
    persistTheme(theme, effectiveCustomTheme).catch(() => {});
    setToast({ title: 'Theme saved', message: 'Current colours and background strength were saved for this user.' });
  }

  async function handleResetTheme() {
    const originalTheme = 'peach-sky';
    resetCustomTheme();
    setTheme(originalTheme);
    setCustomTheme(null);
    try {
      localStorage.setItem('careerCroxTheme', originalTheme);
      localStorage.removeItem('careerCroxApprovedV12Theme');
      localStorage.removeItem('careerCroxCustomTheme');
    } catch {}
    try { await persistTheme(originalTheme, null); } catch {}
    setToast({ title: 'CC26_526 theme restored', message: 'Original CC26_526 CRM theme restored. Layout, cards, buttons and sizes stay unchanged.' });
  }

  async function openNotification(item) {
    try { await api.post(`/api/notifications/${item.notification_id}/read`, {}); } catch {}
    setToast(null);
    const target = notificationTarget(item);
    if (!target) return;
    window.open(target, '_blank', 'noopener,noreferrer');
  }

  async function approveFromPopup() {
    if (!approvalPopup) return;
    setSavingApproval(true);
    try {
      await api.post('/api/approvals/approve', { type: approvalPopup.type, id: approvalPopup.id });
      setApprovalPopup(null);
      setRejectReason('');
      await loadMeta();
    } finally { setSavingApproval(false); }
  }

  async function rejectFromPopup() {
    if (!approvalPopup || !rejectReason.trim()) return;
    setSavingApproval(true);
    try {
      await api.post('/api/approvals/reject', { type: approvalPopup.type, id: approvalPopup.id, reason: rejectReason.trim() });
      setApprovalPopup(null);
      setRejectReason('');
      await loadMeta();
    } finally { setSavingApproval(false); }
  }

  function snoozeApprovalPopup(minutes = 15) {
    if (!approvalPopup) return;
    try { localStorage.setItem(`approval_snooze_${approvalPopup.id}`, String(Date.now() + Number(minutes || 0) * 60 * 1000)); } catch {}
    setApprovalPopup(null);
    setRejectReason('');
    setApprovalReminderForm({ exact_time: '' });
  }

  function saveApprovalExactTime() {
    if (!approvalPopup || !approvalReminderForm.exact_time) return;
    const at = new Date(approvalReminderForm.exact_time).getTime();
    if (!Number.isFinite(at) || at <= Date.now()) {
      setToast({ title: 'Choose a future time', message: 'Approval reminder time must be later than the current time.', item: null, category: 'general' });
      window.setTimeout(() => setToast(null), 2200);
      return;
    }
    try { localStorage.setItem(`approval_snooze_${approvalPopup.id}`, String(internalReminderStartMs(at))); } catch {}
    setApprovalPopup(null);
    setRejectReason('');
    setApprovalReminderForm({ exact_time: '' });
  }

  function remindLater() {
    snoozeApprovalPopup(15);
  }

  function openProfileNewTab() {
    if (!approvalPopup?.candidate_id) return;
    setApprovalPopup(null);
    openCandidateProfileInPopupTab(approvalPopup.candidate_id);
  }

  function openApprovalCenterFromPopup() {
    setApprovalPopup(null);
    setRejectReason('');
    window.open('/approvals', '_blank', 'noopener,noreferrer');
  }

  function openTaskFromPopup(event) {
    if (event?.stopPropagation) event.stopPropagation();
    if (!taskPopup?.task_id) return;
    const taskId = taskPopup.task_id;
    window.open(`/tasks?task_id=${encodeURIComponent(taskId)}`, '_blank', 'noopener,noreferrer');
    dismissTaskPopup();
  }

  async function handleJoinOffice(event) {
    if (!event?.nativeEvent?.isTrusted || officeJoinInFlightRef.current || sendingJoin) return;
    officeJoinInFlightRef.current = true;
    setOfficeJoinError('');
    setSendingJoin(true);
    // Render the screen immediately but never claim Join Office until the API confirms.
    try {
      const data = await api.post('/api/attendance/join', {
        last_page: location.pathname || '/candidates',
        compact: true,
        session_login_at: officeSessionMarker(),
        manual_confirmed: true,
        join_source: 'user_button',
      }, { timeoutMs: 24000, retries: 0, background: false });
      let joinedToday = window.__CC723_OFFICE_RESTORE__?.(data, true) === true;
      if (!joinedToday) {
        const stamp = String(data?.today_stats?.joined_at || data?.presence?.work_started_at || '').trim();
        const explicitLegacyReceipt = data?.today_stats?.joined_today === true && stamp && istDay(stamp) === istDay();
        if (explicitLegacyReceipt) {
          rememberOfficeJoin(stamp);
          joinedToday = hasJoinedThisLogin();
        }
      }
      if (!joinedToday) throw new Error('Join Office could not be confirmed. Please try again.');
      setShowJoinOffice(false);
      setAttendanceGate(data || null);
      lastHumanActivityAtRef.current = 0;
      humanActivitySincePingRef.current = false;
    } catch (error) {
      setOfficeJoinError(String(error?.message || 'Attendance could not be saved. Please try again.'));
      if (!hasJoinedThisLogin()) setShowJoinOffice(true);
    } finally {
      officeJoinInFlightRef.current = false;
      setSendingJoin(false);
    }
  }

  return (
    <div className="app-shell">
      {!BASIC_CRM_MODE && showJoinOffice && !hasJoinedThisLogin() && <div className="crm-modal-backdrop cc724-office-overlay" style={{ zIndex: 100004 }}>
        <div className="crm-premium-modal join-office-modal cc724-office-panel" onClick={(event) => event.stopPropagation()}>
          <div className="cc724-office-brand"><span className="cc724-office-mark"><img src="/assets/img/career-crox-brand-icon.png" alt="" /></span><span><strong className="cc724-brand-title">CAREER CROX</strong><small className="cc724-brand-sub">Employee workspace</small></span></div>
          <span className="cc724-join-kicker">Daily attendance</span>
          <div className="cc724-office-title">Join <span>Office</span></div>
          <p className="cc724-office-description">Begin your shift with one click. Your attendance and work time will be recorded from the moment you join.</p>
          <div className="cc724-office-detail"><span className="cc724-office-detail-icon">✓</span><span>Refresh will not restart your confirmed office session.</span></div>
          <button className="cc724-join-button" type="button" disabled={sendingJoin} onClick={handleJoinOffice}>{sendingJoin ? 'Joining Office…' : 'Join Office →'}</button>
          {officeJoinError && <p className="cc451-join-msg" role="alert">{officeJoinError}</p>}
        </div>
      </div>}
      <aside className="sidebar" ref={sidebarRef}>
        <div className="brand-box glassy-card compact-brand-box clean-brand-box">
          <div className="compact-brand-row clean-brand-row">
            <img className="sidebar-brand-full-logo" src="/assets/img/career-crox-logo.svg?v=CC26_676_EXACT_4K" alt="Career Crox" />
          </div>
        </div>
        <nav className="sidebar-nav">
          {nav.map((item, index) => (
            item.disabled || DISABLED_ARCHIVE_FEATURES.has(item.key) ? (
              <div
                key={item.href}
                className="nav-item nav-item-disabled"
                aria-disabled="true"
                title="Disabled to stop unnecessary Supabase network load"
                style={{ cursor: 'not-allowed', opacity: 0.58 }}
              >
                <span className="nav-serial">{pad2(index + 1)}</span><span>{item.label}</span>
              </div>
            ) : (
              item.key === 'securelink' ? <a key={item.href} className="nav-item bounceable cc-securelink-slice" href="/securelink" aria-label="SecureLink — Remote Support" title="SecureLink — Remote Support"><span className="nav-serial">{pad2(index + 1)}</span><span>🔐 SecureLink</span></a> : <NavLink
                key={item.href}
                to={item.href}
                draggable
                onPointerDown={rememberSidebarScroll}
                onMouseDown={rememberSidebarScroll}
                onDragStart={() => setDragKey(item.key)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorderNav(item.key)}
                onDragEnd={() => setDragKey('')}
                className={({ isActive }) => `nav-item bounceable ${isActive ? 'active' : ''} ${dragKey === item.key ? 'dragging' : ''}`}
              >
                <span className="nav-serial">{pad2(index + 1)}</span><span>{item.label}</span>
              </NavLink>
            )
          ))}
        </nav>
        <div className="theme-panel glassy-card prominent-theme-box">
          <div className="theme-heading-row"><div className="theme-heading">Appearance</div><button className="ghost-btn bounceable" type="button" onClick={() => setShowTheme((s) => !s)}>Display Options</button></div>
          {showTheme && <div className="theme-panel-body">
            <div className="theme-choice-grid">{themes.map(([key, label], index) => <button key={key} type="button" className={`theme-choice-card theme-${key} ${theme === key ? 'active-theme' : ''}`} title={(key === 'burgundy' || key === 'crimson-noir') && normalizedRole !== 'manager' ? 'Managers Only' : `${label} gradient theme`} aria-disabled={(key === 'burgundy' || key === 'crimson-noir') && normalizedRole !== 'manager' ? 'true' : undefined} data-manager-only={(key === 'burgundy' || key === 'crimson-noir') && normalizedRole !== 'manager' ? '1' : undefined} onClick={() => applyTheme(key)}><span className="theme-choice-number">{index + 1}</span><span className="theme-choice-copy"><strong>{label}</strong><small>{(key === 'burgundy' || key === 'crimson-noir') && normalizedRole !== 'manager' ? 'Managers Only' : theme === key ? 'Active gradient' : 'Apply gradient'}</small></span><span className="theme-choice-status">{(key === 'burgundy' || key === 'crimson-noir') && normalizedRole !== 'manager' ? 'Locked' : theme === key ? 'Active' : 'Choose'}</span></button>)}</div>
            <div className="custom-theme-box">
              <div className="theme-select-row" style={{ marginTop: 10 }}>
                <label className="theme-select-shell" style={{ width: '100%' }}>
                  <span>Notification Tune</span>
                  <select value={notificationTune} onChange={(e) => selectNotificationTune(e.target.value, true)}>
                    {NOTIFICATION_TUNE_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="helper-text top-gap-small">Notification sound is separate from the colour theme.</div>
              <div className="row-actions top-gap-small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="selection-count-chip">Current: {activeNotificationTune.label}</span>
                <button className="ghost-btn bounceable" type="button" onClick={() => selectNotificationTune(notificationTune, true)}>{previewingTuneId === notificationTune ? 'Playing...' : 'Preview Current Tune'}</button>
              </div>
              <div className="theme-action-row">
                <button className="ghost-btn bounceable custom-theme-reset" type="button" onClick={handleResetTheme}>Reset Original Theme</button>
              </div>
            </div>
          </div>}
        </div>
      </aside>
      <main className="main-wrap">
        <header className="topbar">
          <div className="topbar-left"><div className="topbar-title topbar-brand-title"><img className="topbar-logo" src="/assets/img/career-crox-brand-icon.png" alt="Career Crox" /><span>{title}</span></div></div>
          <div className="topbar-center" />
          <div className="topbar-right">
            <button className="manual-dialer-top-icon bounceable" type="button" onClick={() => { setManualDialerOpen(true); setManualDialerMessage(''); }} title="Manual Dialer" aria-label="Manual Dialer"><span className="manual-dialer-symbol manual-dialer-symbol-gold" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2Z" fill="currentColor"/></svg></span><span className="manual-dialer-text sr-only">Manual Dialer</span></button>
            <div className="top-action-wrap" ref={quickAddRef}>
              <button className="add-profile-btn bounceable" type="button" onClick={() => setShowAddMenu((s) => !s)}>+ Add Profile</button>
              {showAddMenu && <div className="add-menu show glassy-card professional-add-menu"><Link onClick={() => setShowAddMenu(false)} to="/candidate/new">Add Candidate</Link><Link onClick={() => setShowAddMenu(false)} to="/tasks">Open Tasks</Link><Link onClick={() => setShowAddMenu(false)} to="/interviews">Open Interviews</Link><Link onClick={() => setShowAddMenu(false)} to="/submissions">Open Submissions</Link><Link onClick={() => setShowAddMenu(false)} to="/live-dialing">Call Assistant</Link></div>}
            </div>
            {leadership && <Link className="top-pill bounceable" data-pill="approvals" to="/approvals">Approvals <span className="pill-count">{approvals}</span></Link>}
            <div className="user-chip glassy-card user-chip-menu" title={`${user?.full_name || ''} ${user?.designation || ''} ${user?.recruiter_code || ''}`.trim()}>
              <div className="user-chip-copy">
                <div className="user-name" title={user?.full_name || ''}>{user?.full_name}</div>
                <div className="user-role" title={user?.designation || ''}>{user?.designation}</div>
                <div className="user-code" title={user?.recruiter_code || '-'}>{user?.recruiter_code || '-'}</div>
              </div>
              <div className="user-chip-actions"><button className="mini-btn edit bounceable logout-mini" type="button" onClick={onLogout}>Logout</button></div>
            </div>
          </div>
        </header>
        {manualDialerOpen && <div className="crm-modal-backdrop" style={{ zIndex: 100000 }}>
          <div className="crm-premium-modal" style={{ maxWidth: 460 }}>
            <div className="panel-title">Manual Mobile Dialer</div>
            <div className="helper-text top-gap-small">Paste a number to start the call through your paired mobile app.</div>
            <div className="field top-gap"><label>Phone Number</label><input value={manualDialerPhone} onChange={(e) => setManualDialerPhone(e.target.value)} placeholder="Paste 10 digit number" autoFocus /></div>
            <div className="field top-gap-small"><label>Candidate Name optional</label><input value={manualDialerName} onChange={(e) => setManualDialerName(e.target.value)} placeholder="Optional name" /></div>
            {manualDialerMessage ? <div className="helper-text top-gap-small">{manualDialerMessage}</div> : null}
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" disabled={manualDialerBusy} onClick={sendManualDialerCall}>{manualDialerBusy ? 'Sending...' : 'Call on Mobile'}</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => setManualDialerOpen(false)}>Close</button>
            </div>
          </div>
        </div>}
        <style>{`.manual-dialer-top-icon{border:0;border-radius:13px;padding:0;font-weight:1000;color:#fff!important;-webkit-text-fill-color:#fff!important;background:linear-gradient(135deg,#0f8f76,#22bb63,#78d63f);box-shadow:0 10px 22px rgba(34,197,94,.2);white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:0;min-height:38px;height:38px;width:40px;min-width:40px;max-width:40px;line-height:1;flex:0 0 40px}.manual-dialer-top-icon *{color:#fff!important;-webkit-text-fill-color:#fff!important}.manual-dialer-symbol{display:inline-grid;place-items:center}.manual-dialer-symbol-gold{width:25px;height:25px;border-radius:999px;background:radial-gradient(circle at 30% 30%,#ffe46b 0%,#ffd24f 35%,#ffb327 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 5px 12px rgba(255,179,39,.32);flex:0 0 25px}.manual-dialer-symbol svg{display:block;fill:#fff!important;width:15px!important;height:15px!important}.manual-dialer-text{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}.break-top-pill,.topbar-right a[data-pill="break"]{background:linear-gradient(135deg,#ffb020 0%,#ff6a3d 56%,#ef4444 100%)!important;color:#111827!important;-webkit-text-fill-color:#111827!important;text-shadow:none!important;font-weight:1000!important}.topbar-right .break-top-pill *,.topbar-right a[data-pill="break"] *{color:#111827!important;-webkit-text-fill-color:#111827!important}.break-overdue-modal{border:2px solid rgba(239,68,68,.65)!important;box-shadow:0 0 0 6px rgba(239,68,68,.12),0 24px 80px rgba(185,28,28,.38)!important}.overdue-blink{color:#fff!important;background:linear-gradient(135deg,#dc2626,#991b1b)!important;animation:ccBreakBlink .75s infinite alternate}@keyframes ccBreakBlink{from{filter:brightness(1);transform:scale(1)}to{filter:brightness(1.35);transform:scale(1.025)}}
/* CC26_225_TOPBAR_NAME_EMPLOYEE_SPACE_FIX */
body:not(.login-body) .main-wrap>.topbar{height:64px!important;min-height:64px!important;max-height:64px!important;display:flex!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:flex-start!important;overflow:visible!important;padding:7px 9px!important;gap:7px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-left{flex:1 1 auto!important;min-width:250px!important;max-width:none!important;width:auto!important;overflow:hidden!important}
body:not(.login-body) .main-wrap>.topbar .topbar-title,body:not(.login-body) .main-wrap>.topbar .topbar-brand-title,body:not(.login-body) .main-wrap>.topbar .candidate-top-title-wrap{display:flex!important;align-items:center!important;gap:7px!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;white-space:nowrap!important;flex-wrap:nowrap!important}
body:not(.login-body) .main-wrap>.topbar .topbar-logo{width:30px!important;height:30px!important;flex:0 0 30px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-title span{font-size:16px!important;font-weight:1000!important;color:var(--cc549-top-title,#102a4f)!important;-webkit-text-fill-color:var(--cc549-top-title,#102a4f)!important;opacity:1!important;line-height:1!important;min-width:0!important;text-shadow:0 1px 0 rgba(255,255,255,.42)!important}
body:not(.login-body) .main-wrap>.topbar .candidate-top-title-kicker{font-size:13px!important;line-height:1!important;flex:0 0 auto!important;white-space:nowrap!important;color:#102a4f!important;font-weight:1000!important}
body:not(.login-body) .main-wrap>.topbar .candidate-top-title-name{font-size:15px!important;line-height:1!important;padding:5px 10px!important;max-width:220px!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;border-radius:12px!important;display:inline-block!important;background:#ffe448!important;color:#0d2b55!important;font-weight:1000!important;box-shadow:0 6px 14px rgba(241,196,15,.2)!important}
body:not(.login-body) .main-wrap>.topbar .topbar-center{flex:0 0 218px!important;min-width:218px!important;max-width:218px!important;width:218px!important;margin:0!important}
body:not(.login-body) .main-wrap>.topbar .search-box{width:100%!important;max-width:218px!important;min-height:38px!important;height:38px!important;border-radius:13px!important;gap:4px!important;padding:4px!important;display:flex!important;align-items:center!important;overflow:hidden!important}
body:not(.login-body) .main-wrap>.topbar .search-box input{height:30px!important;font-size:12px!important;font-weight:800!important;padding:0 8px!important;min-width:0!important;flex:1 1 auto!important;color:#17365f!important}
body:not(.login-body) .main-wrap>.topbar .search-box input::placeholder{font-size:12px!important;font-weight:800!important;color:#476385!important;opacity:1!important}
body:not(.login-body) .main-wrap>.topbar .search-box .ghost-btn{min-height:30px!important;height:30px!important;padding:0 12px!important;font-size:11.5px!important;font-weight:1000!important;border-radius:10px!important;flex:0 0 auto!important;color:#12335e!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right{flex:0 0 auto!important;min-width:0!important;max-width:none!important;display:flex!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:flex-end!important;gap:5px!important;position:relative!important;z-index:6!important;overflow:visible!important;margin-left:0!important}
body:not(.login-body) .main-wrap>.topbar .manual-dialer-top-icon{width:40px!important;min-width:40px!important;max-width:40px!important;flex:0 0 40px!important;height:38px!important;min-height:38px!important;padding:0!important;border-radius:13px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .add-profile-btn{min-height:38px!important;height:38px!important;width:78px!important;min-width:78px!important;max-width:78px!important;padding:0 7px!important;font-size:11.3px!important;font-weight:1000!important;line-height:1!important;border-radius:12px!important;gap:4px!important;white-space:nowrap!important;flex:0 0 78px!important;overflow:hidden!important;text-overflow:ellipsis!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill{min-height:38px!important;height:38px!important;padding:0 8px!important;font-size:11.3px!important;font-weight:1000!important;line-height:1!important;border-radius:12px!important;gap:4px!important;white-space:nowrap!important;flex:0 0 auto!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="approvals"]{width:82px!important;min-width:82px!important;max-width:82px!important;padding-left:7px!important;padding-right:7px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="notifications"]{width:96px!important;min-width:96px!important;max-width:96px!important;padding-left:7px!important;padding-right:7px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="break"]{width:60px!important;min-width:60px!important;max-width:60px!important;padding-left:6px!important;padding-right:6px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="team-chat"]{width:100px!important;min-width:100px!important;max-width:100px!important;padding-left:7px!important;padding-right:7px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="aaria"]{width:52px!important;min-width:52px!important;max-width:52px!important;padding-left:6px!important;padding-right:6px!important}
body:not(.login-body) .main-wrap>.topbar .pill-count{min-width:16px!important;height:16px!important;padding:0 3px!important;font-size:9.5px!important;font-weight:1000!important;line-height:16px!important}
body:not(.login-body) .main-wrap>.topbar .user-chip-menu{flex:0 0 158px!important;max-width:158px!important;min-width:158px!important;width:158px!important;min-height:46px!important;height:46px!important;padding:5px 6px!important;gap:5px!important;border-radius:14px!important;display:flex!important;align-items:center!important;overflow:hidden!important}
body:not(.login-body) .main-wrap>.topbar .user-chip-copy{min-width:0!important;overflow:hidden!important;line-height:1.08!important;flex:1 1 auto!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:1px!important}
body:not(.login-body) .main-wrap>.topbar .user-name,body:not(.login-body) .main-wrap>.topbar .user-role,body:not(.login-body) .main-wrap>.topbar .user-code{display:block!important;max-width:94px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#14345d!important}.topbar .user-name{font-weight:1000!important}
body:not(.login-body) .main-wrap>.topbar .user-name{font-size:11.3px!important;font-weight:1000!important}
body:not(.login-body) .main-wrap>.topbar .user-role{font-size:10.3px!important;font-weight:800!important}
body:not(.login-body) .main-wrap>.topbar .user-code{font-size:11px!important;font-weight:1000!important;letter-spacing:.01em!important;color:#16406f!important}
body:not(.login-body) .main-wrap>.topbar .user-chip-actions{display:flex!important;align-items:center!important;justify-content:flex-end!important;flex:0 0 auto!important}
body:not(.login-body) .main-wrap>.topbar .logout-mini{min-height:30px!important;height:30px!important;padding:0 8px!important;font-size:10.8px!important;font-weight:1000!important;border-radius:10px!important;flex:0 0 auto!important}
@media(max-width:1240px){body:not(.login-body) .main-wrap>.topbar{height:auto!important;max-height:none!important;flex-wrap:wrap!important}body:not(.login-body) .main-wrap>.topbar .topbar-left{flex-basis:100%!important;min-width:0!important}body:not(.login-body) .main-wrap>.topbar .topbar-center{flex:1 1 260px!important;max-width:none!important;width:auto!important}body:not(.login-body) .main-wrap>.topbar .topbar-right{flex-basis:100%!important;flex-wrap:wrap!important;justify-content:flex-start!important}}
.goalpost-logout-choice-modal,.join-office-modal.premium-join-office-v2{background:radial-gradient(circle at top left,rgba(59,130,246,.16),transparent 34%),linear-gradient(135deg,#ffffff 0%,#eef6ff 58%,#fff7ed 100%)!important;border:1px solid rgba(59,130,246,.24)!important;box-shadow:0 34px 90px rgba(15,23,42,.24)!important;border-radius:28px!important}
.join-office-modal.premium-join-office-v2 .panel-title,.goalpost-logout-choice-modal .panel-title{font-size:24px!important;font-weight:1000!important;letter-spacing:-.02em!important;color:#10233f!important}
.premium-modal-kicker{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff!important;font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
.premium-modal-points{display:grid;gap:8px;margin-top:14px}
.premium-modal-point{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:14px;background:rgba(255,255,255,.72);border:1px solid rgba(148,163,184,.22);font-size:12px;font-weight:850;color:#334155}
.premium-modal-point::before{content:"";width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#22c55e,#2563eb);box-shadow:0 0 0 4px rgba(37,99,235,.10)}
.goalpost-logout-choice-modal .danger-choice{background:linear-gradient(135deg,#ef4444,#f97316)!important;color:#fff!important;border:0!important}
.premium-attendance-report-modal.cc350-daily-report-modal{width:min(96vw,760px)!important;max-width:760px!important;background:radial-gradient(circle at top left,rgba(59,130,246,.16),transparent 34%),linear-gradient(135deg,#ffffff 0%,#eef6ff 58%,#fff7ed 100%)!important;border:1px solid rgba(59,130,246,.24)!important;box-shadow:0 34px 90px rgba(15,23,42,.28)!important;border-radius:28px!important}.premium-attendance-report-modal .logout-report-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}.premium-attendance-report-modal .presence-stat{min-height:76px!important}@media(max-width:760px){.premium-attendance-report-modal .logout-report-grid{grid-template-columns:1fr!important}}
.daily-attendance-report-table-wrap{margin-top:14px;border-radius:20px;overflow:hidden;border:1px solid rgba(148,163,184,.26);background:rgba(255,255,255,.82);box-shadow:0 18px 44px rgba(15,23,42,.10)}
.daily-attendance-report-table{width:100%;border-collapse:collapse}
.daily-attendance-report-table th,.daily-attendance-report-table td{padding:11px 13px;border-bottom:1px solid rgba(226,232,240,.84);text-align:left;font-size:12px;vertical-align:middle}
.daily-attendance-report-table th{font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:#64748b;background:linear-gradient(180deg,#f8fbff,#eef6ff);font-weight:1000}
.daily-attendance-report-table td:first-child{font-weight:1000;color:#10233f}
.daily-attendance-report-table .status-good{display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(34,197,94,.13);color:#15803d;font-weight:1000}
.daily-attendance-report-table .status-warn{display:inline-flex;padding:5px 9px;border-radius:999px;background:rgba(239,68,68,.12);color:#b91c1c;font-weight:1000}

/* CC26_372_LIGHT_GRADIENT_ATTENDANCE_LOGOUT_UI */
.join-office-modal.premium-join-office-v2{
  width:min(94vw,560px)!important;
  max-width:560px!important;
  padding:26px!important;
  border-radius:32px!important;
  background:
    radial-gradient(circle at 4% 0%,rgba(59,130,246,.24),transparent 34%),
    radial-gradient(circle at 100% 10%,rgba(16,185,129,.16),transparent 30%),
    linear-gradient(135deg,#ffffff 0%,#eff6ff 46%,#f5f3ff 72%,#fff7ed 100%)!important;
  border:1px solid rgba(96,165,250,.34)!important;
  box-shadow:0 36px 110px rgba(15,23,42,.28)!important;
  overflow:hidden!important;
}
.join-office-modal.premium-join-office-v2::after{
  content:"";
  position:absolute;
  right:-58px;
  top:-78px;
  width:190px;
  height:190px;
  border-radius:999px;
  background:linear-gradient(135deg,rgba(37,99,235,.16),rgba(16,185,129,.14),rgba(249,115,22,.14));
  pointer-events:none;
}
.join-office-modal.premium-join-office-v2 .premium-modal-kicker,
.logout-report-modal .premium-modal-kicker,
.premium-attendance-report-modal .premium-modal-kicker{
  background:linear-gradient(135deg,#2563eb,#14b8a6,#f97316)!important;
  box-shadow:0 14px 32px rgba(37,99,235,.22)!important;
  color:#fff!important;
}
.join-office-modal.premium-join-office-v2 .panel-title{
  font-size:30px!important;
  line-height:1.05!important;
  color:#0f2a4f!important;
  letter-spacing:-.045em!important;
}
.join-office-modal.premium-join-office-v2 .helper-text{
  font-size:13.5px!important;
  line-height:1.6!important;
  color:#506782!important;
  font-weight:850!important;
}
.join-office-modal.premium-join-office-v2 .premium-modal-points{
  grid-template-columns:1fr 1fr!important;
  gap:10px!important;
}
.join-office-modal.premium-join-office-v2 .premium-modal-point{
  padding:13px 13px!important;
  border-radius:18px!important;
  background:linear-gradient(135deg,rgba(255,255,255,.88),rgba(239,246,255,.88))!important;
  border:1px solid rgba(147,197,253,.38)!important;
  box-shadow:0 14px 28px rgba(37,99,235,.08)!important;
  color:#1d3b63!important;
  font-size:12.5px!important;
  font-weight:950!important;
}
.join-office-modal.premium-join-office-v2 .add-profile-btn{
  min-height:48px!important;
  padding:0 20px!important;
  border-radius:16px!important;
  background:linear-gradient(135deg,#2563eb,#14b8a6,#f97316)!important;
  color:#fff!important;
  -webkit-text-fill-color:#fff!important;
  text-shadow:0 1px 1px rgba(0,0,0,.18)!important;
  box-shadow:0 18px 38px rgba(37,99,235,.26)!important;
  font-size:13px!important;
}

.logout-report-modal.premium-attendance-report-modal,
.premium-attendance-report-modal.cc353-table-attendance-report-modal,
.premium-attendance-report-modal.cc350-daily-report-modal{
  width:min(96vw,850px)!important;
  max-width:850px!important;
  padding:24px!important;
  border-radius:34px!important;
  background:
    radial-gradient(circle at 5% -5%,rgba(37,99,235,.25),transparent 35%),
    radial-gradient(circle at 105% 0%,rgba(236,72,153,.15),transparent 32%),
    linear-gradient(135deg,#ffffff 0%,#eff6ff 44%,#f5f3ff 72%,#fff7ed 100%)!important;
  border:1px solid rgba(96,165,250,.34)!important;
  box-shadow:0 38px 115px rgba(15,23,42,.30)!important;
  color:#10233f!important;
}
.logout-report-modal .panel-title,
.premium-attendance-report-modal .panel-title{
  font-size:30px!important;
  line-height:1.05!important;
  color:#0f2a4f!important;
  letter-spacing:-.045em!important;
}
.logout-report-modal .helper-text,
.premium-attendance-report-modal .helper-text{
  font-size:13px!important;
  color:#526b88!important;
  font-weight:850!important;
}
.daily-attendance-report-table-wrap{
  border-radius:24px!important;
  border:1px solid rgba(147,197,253,.38)!important;
  background:rgba(255,255,255,.88)!important;
  box-shadow:0 22px 55px rgba(15,23,42,.13)!important;
}
.daily-attendance-report-table{
  border-collapse:separate!important;
  border-spacing:0!important;
}
.daily-attendance-report-table th{
  padding:14px 14px!important;
  background:linear-gradient(135deg,#dbeafe,#ede9fe 52%,#fff7ed)!important;
  color:#334a68!important;
  font-size:11px!important;
  letter-spacing:.08em!important;
}
.daily-attendance-report-table td{
  padding:13px 14px!important;
  font-size:13px!important;
  font-weight:900!important;
  color:#203a5d!important;
  border-bottom:1px solid rgba(203,213,225,.80)!important;
}
.daily-attendance-report-table tbody tr:nth-child(odd) td{
  background:linear-gradient(135deg,rgba(239,246,255,.82),rgba(255,255,255,.72))!important;
}
.daily-attendance-report-table tbody tr:nth-child(even) td{
  background:linear-gradient(135deg,rgba(245,243,255,.78),rgba(255,247,237,.58))!important;
}
.daily-attendance-report-table tbody tr:hover td{
  background:linear-gradient(135deg,rgba(219,234,254,.95),rgba(237,233,254,.82))!important;
}
.daily-attendance-report-table .status-good{
  background:linear-gradient(135deg,#dcfce7,#bbf7d0)!important;
  color:#166534!important;
  border:1px solid rgba(34,197,94,.24)!important;
}
.daily-attendance-report-table .status-warn{
  background:linear-gradient(135deg,#ffedd5,#fecaca)!important;
  color:#b45309!important;
  border:1px solid rgba(249,115,22,.24)!important;
}
.logout-report-modal textarea,
.premium-attendance-report-modal textarea{
  border-radius:18px!important;
  border:1px solid rgba(147,197,253,.46)!important;
  background:linear-gradient(135deg,#ffffff,#f8fbff)!important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 12px 28px rgba(37,99,235,.08)!important;
  color:#10233f!important;
  font-weight:850!important;
}
.logout-report-modal .add-profile-btn,
.premium-attendance-report-modal .add-profile-btn{
  min-height:48px!important;
  padding:0 20px!important;
  border-radius:16px!important;
  background:linear-gradient(135deg,#2563eb,#14b8a6,#f97316)!important;
  color:#fff!important;
  box-shadow:0 18px 38px rgba(37,99,235,.26)!important;
  font-size:13px!important;
}
.logout-report-modal .ghost-btn,
.premium-attendance-report-modal .ghost-btn{
  min-height:46px!important;
  border-radius:16px!important;
  background:linear-gradient(135deg,#ffffff,#eff6ff)!important;
  border:1px solid rgba(147,197,253,.42)!important;
  color:#1e3a5f!important;
  font-weight:1000!important;
}
@media(max-width:760px){
  .join-office-modal.premium-join-office-v2 .premium-modal-points{grid-template-columns:1fr!important}
  .logout-report-modal.premium-attendance-report-modal,.premium-attendance-report-modal.cc353-table-attendance-report-modal{width:96vw!important;padding:18px!important}
}

`}</style>
        <style>{`/* CC26_229_TOPBAR_SPACING_READABILITY_ONLY */
body:not(.login-body) .main-wrap>.topbar{height:68px!important;min-height:68px!important;max-height:68px!important;padding:7px 12px!important;gap:9px!important;align-items:center!important;flex-wrap:nowrap!important;overflow:visible!important}
body:not(.login-body) .main-wrap>.topbar .topbar-left{flex:1 1 auto!important;min-width:220px!important;max-width:none!important;overflow:hidden!important}
body:not(.login-body) .main-wrap>.topbar .topbar-title,body:not(.login-body) .main-wrap>.topbar .topbar-brand-title,body:not(.login-body) .main-wrap>.topbar .candidate-top-title-wrap{gap:9px!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;white-space:nowrap!important;flex-wrap:nowrap!important}
body:not(.login-body) .main-wrap>.topbar .topbar-logo{width:32px!important;height:32px!important;flex:0 0 32px!important}
body:not(.login-body) .main-wrap>.topbar .candidate-top-title-name{font-size:16px!important;max-width:280px!important;padding:6px 12px!important;border-radius:13px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-center{flex:0 0 202px!important;min-width:202px!important;max-width:202px!important;width:202px!important;margin:0!important}
body:not(.login-body) .main-wrap>.topbar .search-box{height:40px!important;min-height:40px!important;max-width:202px!important;border-radius:14px!important;padding:4px!important;gap:5px!important}
body:not(.login-body) .main-wrap>.topbar .search-box input{height:32px!important;font-size:12.5px!important;padding:0 8px!important}
body:not(.login-body) .main-wrap>.topbar .search-box .ghost-btn{height:32px!important;min-height:32px!important;padding:0 13px!important;font-size:12px!important;border-radius:11px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right{gap:8px!important;align-items:center!important;flex-wrap:nowrap!important;justify-content:flex-end!important;margin-left:0!important;overflow:visible!important}
body:not(.login-body) .main-wrap>.topbar .manual-dialer-top-icon{width:42px!important;min-width:42px!important;max-width:42px!important;flex:0 0 42px!important;height:40px!important;min-height:40px!important;border-radius:14px!important}
body:not(.login-body) .main-wrap>.topbar .manual-dialer-symbol-gold{width:27px!important;height:27px!important;flex-basis:27px!important}
body:not(.login-body) .main-wrap>.topbar .manual-dialer-symbol svg{width:16px!important;height:16px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .add-profile-btn{height:40px!important;min-height:40px!important;width:66px!important;min-width:66px!important;max-width:66px!important;font-size:11.5px!important;border-radius:13px!important;padding:0 7px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill{height:40px!important;min-height:40px!important;font-size:11.6px!important;border-radius:13px!important;padding:0 8px!important;gap:5px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="approvals"]{width:84px!important;min-width:84px!important;max-width:84px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="notifications"]{width:98px!important;min-width:98px!important;max-width:98px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="break"]{width:62px!important;min-width:62px!important;max-width:62px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="team-chat"]{width:104px!important;min-width:104px!important;max-width:104px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="aaria"]{width:54px!important;min-width:54px!important;max-width:54px!important}
body:not(.login-body) .main-wrap>.topbar .pill-count{min-width:17px!important;height:17px!important;font-size:10px!important;line-height:17px!important}
body:not(.login-body) .main-wrap>.topbar .user-chip-menu{flex:0 0 170px!important;max-width:170px!important;min-width:170px!important;width:170px!important;height:50px!important;min-height:50px!important;padding:6px 7px!important;gap:6px!important;border-radius:15px!important}
body:not(.login-body) .main-wrap>.topbar .user-name,body:not(.login-body) .main-wrap>.topbar .user-role,body:not(.login-body) .main-wrap>.topbar .user-code{max-width:102px!important}
body:not(.login-body) .main-wrap>.topbar .user-name{font-size:12px!important}
body:not(.login-body) .main-wrap>.topbar .user-role{font-size:10.8px!important}
body:not(.login-body) .main-wrap>.topbar .user-code{font-size:11.5px!important}
body:not(.login-body) .main-wrap>.topbar .logout-mini{height:32px!important;min-height:32px!important;font-size:11px!important;padding:0 9px!important;border-radius:11px!important}
@media(max-width:1280px){body:not(.login-body) .main-wrap>.topbar{height:auto!important;max-height:none!important;flex-wrap:wrap!important}body:not(.login-body) .main-wrap>.topbar .topbar-left{flex-basis:100%!important;min-width:0!important}body:not(.login-body) .main-wrap>.topbar .topbar-center{flex:1 1 260px!important;max-width:360px!important;width:auto!important}body:not(.login-body) .main-wrap>.topbar .topbar-right{flex-basis:100%!important;flex-wrap:wrap!important;justify-content:flex-start!important}}`}</style>

        <style>{`/* CC26_231_TOPBAR_SEARCH_BUTTON_READABILITY_ONLY */
body:not(.login-body) .main-wrap>.topbar{height:68px!important;min-height:68px!important;max-height:68px!important;padding:7px 10px!important;gap:8px!important;align-items:center!important;flex-wrap:nowrap!important;overflow:visible!important}
body:not(.login-body) .main-wrap>.topbar .topbar-left{flex:0 1 auto!important;min-width:165px!important;max-width:275px!important;width:auto!important;overflow:hidden!important}
body:not(.login-body) .main-wrap>.topbar .topbar-title,body:not(.login-body) .main-wrap>.topbar .topbar-brand-title,body:not(.login-body) .main-wrap>.topbar .candidate-top-title-wrap{gap:8px!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;white-space:nowrap!important;flex-wrap:nowrap!important}
body:not(.login-body) .main-wrap>.topbar .topbar-logo{width:32px!important;height:32px!important;flex:0 0 32px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-title span{font-size:16px!important;font-weight:1000!important;line-height:1.05!important;color:var(--cc549-top-title,#0f2e56)!important;-webkit-text-fill-color:var(--cc549-top-title,#0f2e56)!important;opacity:1!important;text-shadow:0 1px 0 rgba(255,255,255,.42)!important}
body:not(.login-body) .main-wrap>.topbar .candidate-top-title-kicker{font-size:13px!important;font-weight:1000!important;color:#0f2e56!important;flex:0 0 auto!important}
body:not(.login-body) .main-wrap>.topbar .candidate-top-title-name{font-size:16px!important;font-weight:1000!important;max-width:185px!important;min-width:0!important;padding:6px 12px!important;border-radius:13px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#0d2b55!important;background:#ffe448!important;box-shadow:0 6px 14px rgba(241,196,15,.22)!important}
body:not(.login-body) .main-wrap>.topbar .topbar-center{flex:0 0 244px!important;min-width:244px!important;max-width:244px!important;width:244px!important;margin:0!important}
body:not(.login-body) .main-wrap>.topbar .search-box{width:244px!important;max-width:244px!important;min-height:40px!important;height:40px!important;border-radius:14px!important;gap:5px!important;padding:4px!important;display:flex!important;align-items:center!important;overflow:hidden!important;background:linear-gradient(135deg,rgba(255,255,255,.94),rgba(220,237,255,.96))!important;border:1px solid rgba(83,147,230,.38)!important;box-shadow:0 8px 22px rgba(54,104,190,.08)!important}
body:not(.login-body) .main-wrap>.topbar .search-box input{display:block!important;height:32px!important;font-size:13px!important;font-weight:850!important;padding:0 9px!important;min-width:0!important;flex:1 1 auto!important;color:#163861!important;background:#eef7ff!important;border:1px solid rgba(91,147,221,.35)!important;border-radius:11px!important}
body:not(.login-body) .main-wrap>.topbar .search-box input::placeholder{font-size:13px!important;font-weight:850!important;color:#476385!important;opacity:1!important}
body:not(.login-body) .main-wrap>.topbar .search-box .ghost-btn{height:32px!important;min-height:32px!important;min-width:70px!important;padding:0 12px!important;font-size:12px!important;font-weight:1000!important;border-radius:11px!important;flex:0 0 auto!important;color:#12335e!important;-webkit-text-fill-color:#12335e!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right{flex:1 1 auto!important;min-width:0!important;max-width:none!important;display:flex!important;flex-wrap:nowrap!important;align-items:center!important;justify-content:flex-end!important;gap:6px!important;overflow:visible!important;margin-left:0!important}
body:not(.login-body) .main-wrap>.topbar .manual-dialer-top-icon{width:40px!important;min-width:40px!important;max-width:40px!important;height:40px!important;min-height:40px!important;flex:0 0 40px!important;border-radius:14px!important}
body:not(.login-body) .main-wrap>.topbar .manual-dialer-symbol-gold{width:27px!important;height:27px!important;flex-basis:27px!important}
body:not(.login-body) .main-wrap>.topbar .manual-dialer-symbol svg{width:16px!important;height:16px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .add-profile-btn,body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill{height:40px!important;min-height:40px!important;font-size:12px!important;font-weight:1000!important;line-height:1!important;border-radius:13px!important;padding:0 7px!important;gap:5px!important;white-space:nowrap!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 1px 0 rgba(0,0,0,.12)!important;overflow:visible!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .add-profile-btn{width:72px!important;min-width:72px!important;max-width:72px!important;flex:0 0 72px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="approvals"]{width:88px!important;min-width:88px!important;max-width:88px!important;flex:0 0 88px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="notifications"]{width:104px!important;min-width:104px!important;max-width:104px!important;flex:0 0 104px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="break"]{width:68px!important;min-width:68px!important;max-width:68px!important;flex:0 0 68px!important;color:#fff!important;-webkit-text-fill-color:#fff!important;background:linear-gradient(135deg,#ff9d24 0%,#ff6b3d 55%,#ef4444 100%)!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="team-chat"]{width:108px!important;min-width:108px!important;max-width:108px!important;flex:0 0 108px!important}
body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="aaria"]{width:58px!important;min-width:58px!important;max-width:58px!important;flex:0 0 58px!important}
body:not(.login-body) .main-wrap>.topbar .pill-count{min-width:17px!important;height:17px!important;padding:0 4px!important;font-size:10px!important;font-weight:1000!important;line-height:17px!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
body:not(.login-body) .main-wrap>.topbar .user-chip-menu{flex:0 0 160px!important;max-width:160px!important;min-width:160px!important;width:160px!important;height:50px!important;min-height:50px!important;padding:6px 7px!important;gap:5px!important;border-radius:15px!important;display:flex!important;align-items:center!important;overflow:hidden!important}
body:not(.login-body) .main-wrap>.topbar .user-chip-copy{min-width:0!important;overflow:hidden!important;line-height:1.08!important;flex:1 1 auto!important;display:flex!important;flex-direction:column!important;justify-content:center!important;gap:1px!important}
body:not(.login-body) .main-wrap>.topbar .user-name,body:not(.login-body) .main-wrap>.topbar .user-role,body:not(.login-body) .main-wrap>.topbar .user-code{display:block!important;max-width:106px!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#14345d!important;-webkit-text-fill-color:#14345d!important}
body:not(.login-body) .main-wrap>.topbar .user-name{font-size:11.8px!important;font-weight:1000!important}
body:not(.login-body) .main-wrap>.topbar .user-role{font-size:10.6px!important;font-weight:850!important}
body:not(.login-body) .main-wrap>.topbar .user-code{font-size:11.2px!important;font-weight:1000!important;letter-spacing:.01em!important;color:#16406f!important;-webkit-text-fill-color:#16406f!important}
body:not(.login-body) .main-wrap>.topbar .logout-mini{height:32px!important;min-height:32px!important;min-width:52px!important;padding:0 8px!important;font-size:11px!important;font-weight:1000!important;border-radius:11px!important;flex:0 0 auto!important}
@media(max-width:1320px){body:not(.login-body) .main-wrap>.topbar .topbar-left{min-width:150px!important;max-width:230px!important}body:not(.login-body) .main-wrap>.topbar .topbar-center{flex-basis:220px!important;min-width:220px!important;max-width:220px!important;width:220px!important}body:not(.login-body) .main-wrap>.topbar .search-box{width:220px!important;max-width:220px!important}body:not(.login-body) .main-wrap>.topbar .topbar-right{gap:5px!important}body:not(.login-body) .main-wrap>.topbar .topbar-right .add-profile-btn{width:68px!important;min-width:68px!important;max-width:68px!important;flex-basis:68px!important}body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill{font-size:11.6px!important}body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="approvals"]{width:84px!important;min-width:84px!important;max-width:84px!important;flex-basis:84px!important}body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="notifications"]{width:98px!important;min-width:98px!important;max-width:98px!important;flex-basis:98px!important}body:not(.login-body) .main-wrap>.topbar .topbar-right .top-pill[data-pill="team-chat"]{width:102px!important;min-width:102px!important;max-width:102px!important;flex-basis:102px!important}body:not(.login-body) .main-wrap>.topbar .user-chip-menu{width:150px!important;min-width:150px!important;max-width:150px!important;flex-basis:150px!important}body:not(.login-body) .main-wrap>.topbar .user-name,body:not(.login-body) .main-wrap>.topbar .user-role,body:not(.login-body) .main-wrap>.topbar .user-code{max-width:98px!important}}
@media(max-width:1180px){body:not(.login-body) .main-wrap>.topbar{height:auto!important;max-height:none!important;flex-wrap:wrap!important}body:not(.login-body) .main-wrap>.topbar .topbar-left{flex-basis:auto!important;min-width:0!important}body:not(.login-body) .main-wrap>.topbar .topbar-center{flex:1 1 260px!important;max-width:360px!important;width:auto!important}body:not(.login-body) .main-wrap>.topbar .search-box{width:100%!important;max-width:360px!important}body:not(.login-body) .main-wrap>.topbar .topbar-right{flex-basis:100%!important;flex-wrap:wrap!important;justify-content:flex-start!important}}`}</style>
        {toast && <button type="button" className={`mini-toast toast-${String(toast.item?.category || toast.category || 'general').toLowerCase()}`} onClick={() => (toast.item ? openNotification(toast.item) : setToast(null))}><div className="mini-toast-title">{toast.title}</div><div className="mini-toast-body">{toast.message}</div></button>}
        {approvalPopup && <div style={{ position: 'fixed', right: 14, bottom: 14, width: 'min(390px, calc(100vw - 28px))', maxHeight: 'calc(100dvh - 28px)', zIndex: 60 }}>
          <div className="panel approval-popup-panel cc604-approval-popup" role="dialog" aria-label="Approval request" style={{ maxWidth: 'min(390px, calc(100vw - 28px))' }}>
            <div className="cc604-approval-eyebrow">ACTION REQUIRED</div><div className="panel-title">{approvalPopup.type === 'unlock' ? 'Employee Unlock Approval' : 'Pending Submission Approval'}</div>
            <div className="helper-text">{approvalPopup.type === 'unlock' ? `${approvalPopup.title}${approvalPopup.process ? ` • ${approvalPopup.process}` : ''}` : `${approvalPopup.title} • ${approvalPopup.recruiter_name || '-'} • ${approvalPopup.process || '-'}`}</div>
            <div className="helper-text top-gap-small">{approvalPopup.type === 'unlock' ? 'Employee CRM is locked. Approve to restore access immediately.' : 'Approve here or jump to the Approval Center.'}</div>
            <div className="row-actions top-gap">
              {approvalPopup.type === 'candidate' && <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={openProfileNewTab}>Open Profile</button>}
              <button className="mini-btn call bounceable highlight-choice highlight-strong" type="button" disabled={savingApproval} onClick={approveFromPopup}>{approvalPopup.type === 'unlock' ? 'Approve Unlock' : 'Approve'}</button>
              <button className="mini-btn edit bounceable highlight-choice highlight-strong" type="button" disabled={savingApproval} onClick={rejectFromPopup}>Reject</button>
              <button className="ghost-btn bounceable" type="button" onClick={openApprovalCenterFromPopup}>Open Center</button>
            </div>
            <div className="compact-chip-row compact-chip-wrap top-gap-small">
              {APPROVAL_SNOOZE_OPTIONS.map((option) => (
                <button key={`approval-${option.minutes}`} className="ghost-btn bounceable" type="button" onClick={() => snoozeApprovalPopup(option.minutes)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="task-modal-grid top-gap-small compact-reminder-modal-grid">
              <div className="field field-span-2"><label>Set Exact Time</label><input className="inline-input" type="datetime-local" value={approvalReminderForm.exact_time} onChange={(e) => setApprovalReminderForm({ exact_time: e.target.value })} /></div>
            </div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" onClick={saveApprovalExactTime} disabled={!approvalReminderForm.exact_time}>Save Time</button>
            </div>
            <div className="field top-gap-small"><label>Reject Note (required for reject)</label><textarea rows="3" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason is added to the profile audit trail."></textarea></div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && AUTO_SEMI_HOURLY_POPUPS_ENABLED && semiHourlyPopup && <div className="revenue-reminder-wrap" style={{ bottom: revenuePopup ? 232 : 24 }}>
          <div className="panel approval-popup-panel revenue-reminder-popup glassy-card popup-info popup-dock-right" role="button" tabIndex={0} title="Open 30-minute report in a new tab" onClick={openSemiHourlyReport} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openSemiHourlyReport(); } }}>
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">{semiHourlyPopup.title}</div>
                <div className="helper-text">Performance Summary</div>
              </div>
            </div>
            <div className="task-reminder-title">{semiHourlyPopup.message}</div>
            {semiHourlyPopup.summary ? <div className="top-gap-small" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="mini-chip">Submissions: {semiHourlyPopup.summary.submissions || semiHourlyPopup.summary.submissions_30 || 0}</span>
              <span className="mini-chip">Calls: {semiHourlyPopup.summary.dialed_calls || semiHourlyPopup.summary.calls_30 || 0}</span>
              <span className="mini-chip">Breaks: {semiHourlyPopup.summary.break_count || semiHourlyPopup.summary.break_count_30 || 0}</span>
              <span className="mini-chip">Break mins: {semiHourlyPopup.summary.break_minutes || semiHourlyPopup.summary.break_minutes_30 || 0}</span>
              <span className="mini-chip">Idle mins: {semiHourlyPopup.summary.idle_minutes || semiHourlyPopup.summary.idle_minutes_30 || 0}</span>
              <span className="mini-chip">Connected: {semiHourlyPopup.summary.connected_calls || 0}</span>
            </div> : null}
            <div className="helper-text top-gap-small"></div>
            <div className="row-actions top-gap">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={(event) => { event.stopPropagation(); openSemiHourlyReport(); }}>Open Report</button>
            </div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && revenuePopup && <div className="revenue-reminder-wrap">
          <div className="panel approval-popup-panel revenue-reminder-popup glassy-card popup-info popup-dock-left">
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">{revenuePopup.title || 'Pipeline follow-up due'}</div>
                <div className="helper-text">{revenuePopup.full_name || '-'} • {revenuePopup.candidate_id || '-'}</div>
              </div>
              <button className="task-reminder-close" type="button" onClick={() => setRevenuePopup(null)} aria-label="Close pipeline reminder">×</button>
            </div>
            <div className="task-reminder-body">
              <div className="revenue-reminder-title">{revenuePopup.message || 'Update candidate journey in Pipeline Hub.'}</div>
              <div className="helper-text top-gap-small">Status: {String(revenuePopup.status || '').replaceAll('_', ' ')}{revenuePopup.joining_date ? ` • Joining: ${revenuePopup.joining_date}` : ''}</div>
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable" type="button" onClick={() => { setRevenuePopup(null); window.open('/revenue-hub', '_blank', 'noopener,noreferrer'); }}>Open Pipeline Hub</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozeRevenuePopup(120)}>Remind Later</button>
            </div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && dailyWorkflowPopup && <div className="daily-workflow-wrap">
          <div className="panel approval-popup-panel daily-workflow-popup glassy-card popup-info popup-dock-left">
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">📌 {dailyWorkflowPopup.title}</div>
                <div className="helper-text">Daily Workflow</div>
              </div>
              <button className="task-reminder-close" type="button" onClick={() => snoozeDailyWorkflowPopup(dailyWorkflowPopup.kind, dailyWorkflowPopup.dateKey, dailyWorkflowPopup.kind === 'today' ? 180 : DAILY_WORKFLOW_SNOOZE_MINUTES)} aria-label="Close daily workflow popup">×</button>
            </div>
            <div className="task-reminder-body">
              <div className="task-reminder-title">{dailyWorkflowPopup.message}</div>
              <div className="helper-text top-gap-small">Your scheduled interview and follow-up queue is ready.</div>
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={openDailyWorkflowFromPopup}>{dailyWorkflowPopup.primaryLabel}</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozeDailyWorkflowPopup(dailyWorkflowPopup.kind, dailyWorkflowPopup.dateKey, dailyWorkflowPopup.kind === 'today' ? 180 : DAILY_WORKFLOW_SNOOZE_MINUTES)}>{dailyWorkflowPopup.secondaryLabel}</button>
            </div>
          </div>
        </div>}
        {(BASIC_CRM_MODE || hasJoinedThisLogin()) && globalSubmissionReminderPopup && <div className="global-submission-reminder-wrap cc-global-source-wrap">
          <div className="panel approval-popup-panel global-submission-reminder-card cc-global-source-card">
            <div className="task-reminder-head cc-global-source-head">
              <div className="cc-global-source-titlebox">
                <div className="panel-title">Submission Reminder</div>
                <div className="helper-text cc-global-source-subtitle">{globalSubmissionReminderPopup.full_name || '-'} • {globalSubmissionReminderPopup.recruiter_code || '-'}</div>
              </div>
              <div className="cc-global-source-window-actions"><button className="task-reminder-close cc-global-source-minimize" type="button" onClick={() => setGlobalSubmissionReminderPopup((current) => current ? { ...current, __minimized: !current.__minimized } : current)} aria-label="Minimize submission reminder">−</button><button className="task-reminder-close" type="button" onClick={() => setGlobalSubmissionReminderPopup(null)} aria-label="Close submission reminder">×</button></div>
            </div>
            <div className="task-reminder-body cc-global-source-body">
              <div className="task-reminder-title">Submission ready for your next move.</div>
              {globalSubmissionReminderNote(globalSubmissionReminderPopup) ? <div className="cc-global-source-note"><strong>Last Notes:</strong> {globalSubmissionReminderNote(globalSubmissionReminderPopup)}</div> : null}
              <div className="helper-text cc-global-source-time">Reminder: {globalSubmissionReminderStamp(globalSubmissionReminderPopup) ? new Date(globalSubmissionReminderStamp(globalSubmissionReminderPopup)).toLocaleString() : '-'}</div>
            </div>
            <div className="row-actions task-reminder-actions cc-global-source-actions">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={() => { if (globalSubmissionReminderPopup?.candidate_id) openCandidateProfileInPopupTab(globalSubmissionReminderPopup.candidate_id); setGlobalSubmissionReminderPopup(null); }}>Open Profile</button>
              <button className="mini-btn call bounceable" type="button" onClick={() => { window.open(`/submissions?submission_id=${encodeURIComponent(globalSubmissionReminderPopup?.submission_id || '')}`, '_blank', 'noopener,noreferrer'); setGlobalSubmissionReminderPopup(null); }}>Open Queue</button>
              {SUBMISSION_REMINDER_SNOOZE_OPTIONS.map((option) => (
                <button key={`global-submission-${option.minutes}`} className="ghost-btn bounceable task-snooze-btn" type="button" onClick={() => snoozeGlobalSubmissionReminderPopup(option.minutes)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>}
        {followUpPopup && <div className="task-reminder-wrap is-entering">
          <div className="panel approval-popup-panel task-reminder-popup glassy-card popup-warning popup-dock-left">
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">📌 FollowUp Reminder</div>
                <div className="helper-text">{followUpPopup.full_name || '-'} • {followUpPopup.candidate_id || '-'}</div>
              </div>
              <button className="task-reminder-close" type="button" onClick={() => setFollowUpPopup(null)} aria-label="Close followup reminder">×</button>
            </div>
            <div className="task-reminder-body">
              <div className="task-reminder-title">Follow-up is due — reconnect while the lead is warm.</div>
              <div className="helper-text">Time: {followUpPopup.follow_up_at ? new Date(followUpPopup.follow_up_at).toLocaleString() : '-'}</div>
              {String(followUpPopup.last_note || followUpPopup.last_notes || followUpPopup.follow_up_note || '').trim() ? <div className="task-reminder-note-card top-gap-small"><strong>Last Note:</strong> {followUpPopup.last_note || followUpPopup.last_notes || followUpPopup.follow_up_note}</div> : null}
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={() => { if (followUpPopup?.candidate_id) openCandidateProfileInPopupTab(followUpPopup.candidate_id); setFollowUpPopup(null); }}>Open Profile</button>
              <button className="mini-btn call bounceable" type="button" onClick={completeFollowUpFromPopup}>Done</button>
            </div>
            <div className="task-snooze-row top-gap-small">
              {FOLLOWUP_SNOOZE_OPTIONS.map((option) => (
                <button key={option.minutes} className="ghost-btn bounceable task-snooze-btn" type="button" onClick={() => snoozeFollowUpPopup(option.minutes)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>}
        {canRenderTaskPopup && taskPopup && <div className={`task-reminder-wrap ${taskPopupAnimatingOut ? 'is-leaving' : 'is-entering'}`}>
          <div className="panel approval-popup-panel task-reminder-popup task-popup-dock-left glassy-card popup-warning popup-dock-left" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={(e) => openTaskFromPopup(e)} onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openTaskFromPopup(e);
            }
          }}>
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">⏰ Task Reminder</div>
                <div className="helper-text">Action ready.</div>
              </div>
              <button className="task-reminder-close" type="button" onClick={(e) => { e.stopPropagation(); dismissTaskPopup(); }} aria-label="Close task reminder">×</button>
            </div>
            <div className="task-reminder-body">
              <div className="task-reminder-title">{taskPopup.title}</div>
              <div className="helper-text">{taskPopup.assigned_to_name || '-'} • {taskPopup.priority || '-'}</div>
              <div className="helper-text top-gap-small">Due: {taskPopup.due_date ? new Date(taskPopup.due_date).toLocaleString() : '-'}</div>
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={(e) => openTaskFromPopup(e)}>Open Task</button>
            </div>
            <div className="task-snooze-row top-gap-small">
              {TASK_SNOOZE_OPTIONS.map((option) => (
                <button key={option.minutes} className="ghost-btn bounceable task-snooze-btn" type="button" onClick={(e) => { e.stopPropagation(); snoozeTaskPopup(option.minutes); }}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>}
        {(() => {
          if (BASIC_CRM_MODE) return null;
          const presence = attendanceGate?.presence;
          const joined = Boolean(attendanceGate?.today_stats?.joined_today);
          const onBreak = String(presence?.is_on_break || '0') === '1';
          const locked = String(presence?.locked || '0') === '1';
          const approvalLocked = locked && String(presence?.lock_reason || '') !== 'break';
          const endAt = presence?.break_expected_end_at ? new Date(presence.break_expected_end_at).getTime() : 0;
          const diff = endAt ? endAt - breakCountdownNow : 0;
          const abs = Math.abs(diff);
          const hrs = String(Math.floor(abs / 3600000)).padStart(2, '0');
          const mins = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
          const secs = String(Math.floor((abs % 60000) / 1000)).padStart(2, '0');
          const timerText = `${hrs}:${mins}:${secs}`;
          const overdue = onBreak && endAt && diff < 0;
          if (approvalLockExempt || !joined || !locked) return null;
          if (onBreak && !approvalLocked && overdue) {
            return <LockedRequestModal reasonDefault={presence?.lock_message || 'Break time exceeded'} refreshAttendanceGate={refreshAttendanceGate} navigate={navigate} breakExpiryAt={endAt} overrunText="00:00:00" />;
          }
          if (onBreak && !approvalLocked) {
            const breakMeter = breakMeterSnapshot(presence || {});
            return <div className="crm-modal-backdrop crm-lock-backdrop"><div className={`crm-premium-modal crm-lock-modal ${overdue ? 'break-overdue-modal' : ''}`}><div className="lock-premium-chip">{overdue ? 'Break Exceeded' : 'Break Mode'}</div><div className="panel-title">{overdue ? 'Break Time Exceeded' : 'Break In Progress'}</div><div className="helper-text top-gap-small">{overdue ? 'Break time expired. Request for Access and wait for manager approval.' : 'Join work before the timer finishes. After that, manager approval is required.'}</div><div className={`lock-overlay-timer ${overdue ? 'overdue-blink' : diff <= 60000 ? 'cc555-break-warning' : ''}`}>{overdue ? `-${timerText}` : timerText}</div><div className={`premium-break-lock-meter ${breakMeter.level}`}><div className="premium-break-lock-track"><div className="premium-break-lock-fill" style={{ width: `${Math.min(100, breakMeter.percent)}%` }} /></div><div className="helper-text top-gap-small">Break used: {breakMeter.percent}% {breakMeter.level === 'exceeded' ? `• Lock in ${breakMeter.leftText}` : ''}</div></div><div className="helper-text top-gap-small">{presence?.break_reason || 'Break'} {overdue ? 'over time' : 'running'}</div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={async () => { try { const data = await api.post('/api/attendance/end-break', { compact: true }, { timeoutMs: 20000 }); setAttendanceGate(data || null); setShowJoinOffice(false); } catch {} }}>{overdue ? 'Request for Access' : 'Join Work Now'}</button></div></div></div>;
          }
          return <LockedRequestModal reasonDefault={presence?.lock_message || presence?.break_reason || 'Please contact your reporting lead and request CRM unlock approval.'} refreshAttendanceGate={refreshAttendanceGate} navigate={navigate} breakExpiryAt={String(presence?.lock_reason || '') === 'break_exceeded' && endAt && diff <= 0 ? endAt : 0} overrunText={String(presence?.lock_reason || '') === 'break_exceeded' && endAt && diff <= 0 ? '00:00:00' : ''} />;
        })()}
        {goalPostLogoutChoice && <div className="crm-modal-backdrop" style={{ zIndex: 100002 }} onClick={() => setGoalPostLogoutChoice(null)}><div className="crm-premium-modal goalpost-logout-choice-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}><div className="premium-modal-kicker">Logout Choice</div><div className="panel-title">Goal Post Update Pending</div><div className="helper-text top-gap-small">Goal Post is still pending for this session. Update now or continue logout.</div><div className="premium-modal-points"><div className="premium-modal-point">Your existing Goal Post data stays untouched.</div><div className="premium-modal-point">The reminder returns next session until updated.</div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={() => { const nextPage = goalPostLogoutChoice?.page || '/goal-post'; setGoalPostLogoutChoice(null); navigate(nextPage); }}>Update Goal Post</button><button className="mini-btn edit bounceable danger-choice" type="button" onClick={logoutWithoutGoalPostUpdate}>Logout Without Update</button><button className="ghost-btn bounceable" type="button" onClick={() => setGoalPostLogoutChoice(null)}>Cancel</button></div></div></div>}
        {goalPostReminderPopup && <div style={{ position: 'fixed', right: 22, bottom: 24, width: 360, zIndex: 60 }}>
          <div className="panel approval-popup-panel goalpost-reminder-panel goalpost-logout-choice-modal" style={{ boxShadow: '0 28px 70px rgba(15,23,42,0.24)', maxWidth: '380px' }}>
            <div className="premium-modal-kicker">Goal Post</div><div className="panel-title">{goalPostReminderPopup.title}</div>
            <div className="helper-text">{goalPostReminderPopup.message}</div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" onClick={() => { setGoalPostReminderPopup(null); navigate('/goal-post'); }}>Open Goal Post</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => setGoalPostReminderPopup(null)}>Dismiss</button>
            </div>
          </div>
        </div>}
        {!BASIC_CRM_MODE && showLogoutSummary && <div className="crm-modal-backdrop" onClick={() => !sendingReport && setShowLogoutSummary(false)}><div className="crm-premium-modal logout-report-modal premium-attendance-report-modal cc353-table-attendance-report-modal" onClick={(e) => e.stopPropagation()}><div className="premium-modal-kicker">Daily Attendance Report</div><div className="panel-title">Session Summary</div><div className="helper-text top-gap-small">Review your day before logout. The report moves to leadership approval.</div><div className="daily-attendance-report-table-wrap"><table className="daily-attendance-report-table"><thead><tr><th>Metric</th><th>Actual / Target</th><th>Status</th></tr></thead><tbody><tr><td>Work Time</td><td>{formatMinutes(logoutSummary?.productive_work_minutes)} / {formatMinutes(logoutWorkTarget)}</td><td><span className={(Number(logoutSummary?.productive_work_minutes || 0) >= logoutWorkTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.productive_work_minutes || 0) >= logoutWorkTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Idle Time</td><td>{formatMinutes(logoutSummary?.idle_minutes)}</td><td><span className={Number(logoutSummary?.idle_minutes || 0) ? 'status-warn' : 'status-good'}>{Number(logoutSummary?.idle_minutes || 0) ? 'Review' : 'Clear'}</span></td></tr><tr><td>Break Time</td><td>{formatMinutes(logoutSummary?.total_break_minutes)}</td><td><span className="status-good">Tracked</span></td></tr><tr><td>Dialed Calls</td><td>{logoutSummary?.outgoing_calls_count || logoutSummary?.dialed_calls_count || 0} / {logoutDialedTarget}</td><td><span className={(Number(logoutSummary?.outgoing_calls_count || logoutSummary?.dialed_calls_count || 0) >= logoutDialedTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.outgoing_calls_count || logoutSummary?.dialed_calls_count || 0) >= logoutDialedTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Connected Calls</td><td>{logoutSummary?.connected_calls_count || 0} / {logoutConnectedTarget}</td><td><span className={(Number(logoutSummary?.connected_calls_count || 0) >= logoutConnectedTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.connected_calls_count || 0) >= logoutConnectedTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Talk Time</td><td>{formatMinutes(logoutSummary?.talktime_minutes)} / {formatMinutes(logoutTalkTarget)}</td><td><span className={(Number(logoutSummary?.talktime_minutes || 0) >= logoutTalkTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.talktime_minutes || 0) >= logoutTalkTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Submissions</td><td>{logoutSummary?.submissions_count || 0} / {logoutSubmissionTarget}</td><td><span className={(Number(logoutSummary?.submissions_count || 0) >= logoutSubmissionTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.submissions_count || 0) >= logoutSubmissionTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Missed Interviews</td><td>{logoutSummary?.missed_interviews_today || 0} / 0</td><td><span className={(Number(logoutSummary?.missed_interviews_today || 0) === 0) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.missed_interviews_today || 0) === 0 ? 'Clear' : 'Needs action'}</span></td></tr><tr><td>Productivity</td><td>{logoutSummary?.attendance_report?.productivity_status || logoutSummary?.day_status || '-'}</td><td><span className={(logoutSummary?.attendance_report?.productivity_status === 'Up to the mark') ? 'status-good' : 'status-warn'}>Manager review</span></td></tr></tbody></table></div><div className="field top-gap"><label>Employee Notes</label><textarea rows="3" value={logoutReportNotes} onChange={(e) => setLogoutReportNotes(e.target.value)} placeholder="Add context for low calls, missed interviews, meetings, technical issues, or approved delays." /></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={sendingReport} onClick={sendReportAndLogout}>{sendingReport ? 'Sending...' : 'Send Report'}</button><button className="ghost-btn bounceable" type="button" disabled={sendingReport} onClick={() => setShowLogoutSummary(false)}>Back</button></div></div></div>}
        <section className="page-scroll" ref={pageScrollRef}>{children}</section>
      </main>
    </div>
  );
}

/* CC26_350_SOURCE_LOGOUT_REPORT_HARD_APPLIED */
