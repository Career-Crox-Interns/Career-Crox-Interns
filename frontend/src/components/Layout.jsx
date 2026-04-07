import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { notificationTarget } from '../lib/notificationLink';

const themes = [
  ['corporate-light', 'Brand Standard'], ['peach-sky', 'Premium Peach Sky'], ['ocean', 'Blue Flow'],
  ['mint', 'Mint Glass'], ['sunset', 'Warm Light'], ['lavender', 'Skyline'],
  ['rose', 'Rose Bloom'], ['silver-pro', 'Silver Pro'], ['mac-glass', 'Glass Frost'],
  ['neon-slate', 'Slate Blue'], ['dark-pro', 'Dark Pro'], ['dark-midnight', 'Midnight'],
  ['dark-vscode', 'VS Code Dark'], ['sunrise-pop', 'Sunrise Pop'], ['aqua-luxe', 'Aqua Luxe'],
  ['violet-frost', 'Violet Frost'], ['candy-blush', 'Candy Blush'], ['emerald-glow', 'Emerald Glow'],
  ['gold-sand', 'Gold Sand'], ['berry-night', 'Berry Night']
];

const TASK_SNOOZE_OPTIONS = [
  { label: '3m', minutes: 3 },
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
];

const FOLLOWUP_SNOOZE_OPTIONS = [
  { label: '5m', minutes: 5 },
  { label: '10m', minutes: 10 },
];


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
  const date = value instanceof Date ? value : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function parseInterviewStamp(row) {
  const scheduled = String(row?.scheduled_at || '').trim();
  if (scheduled) {
    const parsed = new Date(scheduled);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallbackDate = String(row?.interview_reschedule_date || row?.interview_date || '').slice(0, 10);
  if (!fallbackDate) return null;
  const parsed = new Date(`${fallbackDate}T09:00:00`);
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

function LockedRequestModal({ reasonDefault, refreshAttendanceGate, navigate }) {
  const [reason, setReason] = useState(reasonDefault || 'Request CRM unlock approval.');
  const [sending, setSending] = useState(false);
  useEffect(() => { setReason(reasonDefault || 'Request CRM unlock approval.'); }, [reasonDefault]);
  async function sendRequest() {
    if (!String(reason || '').trim()) return;
    setSending(true);
    try {
      await api.post('/api/attendance/request-unlock', { reason: reason.trim() });
      await refreshAttendanceGate();
    } finally {
      setSending(false);
    }
  }
  return <div className="crm-modal-backdrop crm-lock-backdrop"><div className="crm-premium-modal crm-lock-modal danger"><div className="panel-title">CRM Access Locked</div><div className="helper-text top-gap-small">A lock rule was triggered. Contact your reporting lead and request CRM unlock approval to continue working.</div><div className="field top-gap"><label>Reason</label><textarea rows="4" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for unlock request" /></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={sending || !String(reason || '').trim()} onClick={sendRequest}>{sending ? 'Requesting...' : 'Request Approval'}</button></div></div></div>;
}

export default function Layout({ title, subtitle, children }) {
  const { user, logout, theme, setTheme, customTheme, setCustomTheme, resetCustomTheme, persistTheme } = useAuth();
  const [notifications, setNotifications] = useState(0);
  const [approvals, setApprovals] = useState(0);
  const [showTheme, setShowTheme] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);
  const [lastNotificationId, setLastNotificationId] = useState('');
  const [approvalPopup, setApprovalPopup] = useState(null);
  const [taskPopup, setTaskPopup] = useState(null);
  const [followUpPopup, setFollowUpPopup] = useState(null);
  const [taskPopupAnimatingOut, setTaskPopupAnimatingOut] = useState(false);
  const [revenuePopup, setRevenuePopup] = useState(null);
  const [dailyWorkflowPopup, setDailyWorkflowPopup] = useState(null);
  const [semiHourlyPopup, setSemiHourlyPopup] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingApproval, setSavingApproval] = useState(false);
  const [showJoinOffice, setShowJoinOffice] = useState(false);
  const [sendingJoin, setSendingJoin] = useState(false);
  const [attendanceGate, setAttendanceGate] = useState(null);
  const [showLogoutSummary, setShowLogoutSummary] = useState(false);
  const [logoutSummary, setLogoutSummary] = useState(null);
  const [sendingReport, setSendingReport] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const leadership = ['admin', 'manager', 'tl'].includes(user?.role);
  const AUTO_SYSTEM_POPUPS_ENABLED = true;
  const quickAddRef = useRef(null);
  const taskPopupCloseTimerRef = useRef(null);
  const hadVisibleTaskPopupRef = useRef(false);

  const currentPath = String(location.pathname || '');
  const isFocusRoute = useMemo(() => {
    return currentPath.startsWith('/candidate/')
      || currentPath.startsWith('/quality-analyst')
      || currentPath.startsWith('/data-extractor');
  }, [currentPath]);


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


  function playTaskReminderSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const notes = [740, 988, 1318];
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = index === 1 ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06, now + 0.03 + (index * 0.04));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + (index * 0.06));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + (index * 0.07));
        osc.stop(now + 0.24 + (index * 0.08));
      });
      window.setTimeout(() => {
        if (typeof ctx.close === 'function') ctx.close().catch(() => {});
      }, 520);
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
    localStorage.setItem(`task_snooze_${taskPopup.task_id}`, String(Date.now() + Number(minutes || 0) * 60 * 1000));
    dismissTaskPopup();
  }

  function snoozeFollowUpPopup(minutes = 5) {
    if (!followUpPopup?.candidate_id) return;
    localStorage.setItem(`followup_snooze_${followUpPopup.candidate_id}`, String(Date.now() + Number(minutes || 0) * 60 * 1000));
    setFollowUpPopup(null);
  }

  function snoozeDailyWorkflowPopup(kind, dateKey, minutes = DAILY_WORKFLOW_SNOOZE_MINUTES) {
    if (!user?.user_id || !kind || !dateKey) return;
    localStorage.setItem(dailyWorkflowSnoozeKey(user.user_id, kind, dateKey), String(Date.now() + Number(minutes || 0) * 60 * 1000));
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
    navigate(path);
  }

  function currentSemiHourlyKey() {
    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(now.getMinutes() >= 30 ? 30 : 0);
    return now.toISOString().slice(0, 16);
  }

  function openSemiHourlyReport() {
    const key = currentSemiHourlyKey();
    localStorage.setItem(`semi_hourly_opened_${user?.user_id}_${key}`, '1');
    setSemiHourlyPopup(null);
    const reportId = semiHourlyPopup?.reportId ? `?reportId=${encodeURIComponent(semiHourlyPopup.reportId)}` : '';
    window.open(`/semi-hourly-report${reportId}`, '_blank', 'noopener,noreferrer');
  }

  async function loadSemiHourlyPopup() {
    if (!AUTO_SYSTEM_POPUPS_ENABLED) {
      setSemiHourlyPopup(null);
      return;
    }
    if (String(location.pathname || '').startsWith('/semi-hourly-report')) {
      setSemiHourlyPopup(null);
      return;
    }
    if (!user?.user_id || !['admin','manager','tl'].includes(String(user?.role || '').toLowerCase())) {
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
        const snapshot = await api.get('/api/reports/semi-hourly', { cacheTtlMs: 0, background: true });
        reportId = snapshot?.saved_report_id || '';
        localStorage.setItem(savedMarker, '1');
        if (reportId) localStorage.setItem(`${savedMarker}_id`, reportId);
        if (snapshot?.summary) localStorage.setItem(`${savedMarker}_summary`, JSON.stringify(snapshot.summary));
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
      title: 'Semi-Hourly report generated',
      message: 'Open the 30 minutes report in a new tab. Current page will stay here. Key watch points are included below.',
    });
  }

  async function loadDailyWorkflowPopup() {
    if (!AUTO_SYSTEM_POPUPS_ENABLED) {
      setDailyWorkflowPopup(null);
      return;
    }
    if (!user?.user_id || leadership || !canShowInterruptPopup) {
      setDailyWorkflowPopup(null);
      return;
    }
    try {
      const data = await api.get('/api/interviews', { background: true });
      const rows = (data.items || []).filter((row) => !DAILY_TERMINAL_STATUSES.has(lowerText(row?.status)));
      const now = new Date();
      const minutesNow = now.getHours() * 60 + now.getMinutes();
      const todayKey = formatLocalYmd(now);
      const tomorrowKey = formatLocalYmd(addDays(now, 1));
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
      const meta = await api.get('/api/ui/meta', { cacheTtlMs: isFocusRoute ? 2500 : 1200, timeoutMs: 12000, background: true });
      setNotifications(meta.unread_notifications || 0);
      setApprovals(meta.pending_approvals || 0);
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
    setApprovalPopup(null);
  }

  async function loadRevenueReminder() {
    if (!user?.user_id) {
      setRevenuePopup(null);
      return;
    }
    try {
      const data = await api.get('/api/revenue-hub/reminders', { background: true });
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
    localStorage.setItem(`revenue_snooze_${revenuePopup.revenue_id}`, String(Date.now() + minutes * 60 * 1000));
    setRevenuePopup(null);
  }

  async function loadTaskReminder() {
    if (!user?.user_id || !canShowInterruptPopup) {
      if (taskPopup) dismissTaskPopup();
      return;
    }
    try {
      const data = await api.get('/api/tasks', { background: true });
      const items = (data.items || [])
        .filter((item) => ['open', 'in progress'].includes(String(item.status || '').toLowerCase()))
        .map((item) => ({ ...item, dueAt: new Date(item.due_date || 0).getTime() }))
        .filter((item) => Number.isFinite(item.dueAt) && item.dueAt > 0 && item.dueAt <= Date.now())
        .sort((a, b) => a.dueAt - b.dueAt);
      const next = items.find((item) => {
        const snoozeUntil = Number(localStorage.getItem(`task_snooze_${item.task_id}`) || 0);
        return Date.now() > snoozeUntil;
      }) || null;

      if (!next) {
        if (taskPopup) dismissTaskPopup();
        return;
      }

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
      const data = await api.get('/api/followups/upcoming', { background: true });
      const now = Date.now();
      const next = (data.items || [])
        .filter((item) => String(item.follow_up_at || '').trim())
        .filter((item) => String(item.follow_up_status || '').toLowerCase() !== 'done')
        .map((item) => ({ ...item, dueAt: new Date(item.follow_up_at || 0).getTime() }))
        .filter((item) => Number.isFinite(item.dueAt) && item.dueAt > 0 && item.dueAt <= now)
        .sort((a, b) => a.dueAt - b.dueAt)
        .find((item) => {
          const snoozeUntil = Number(localStorage.getItem(`followup_snooze_${item.candidate_id}`) || 0);
          return now > snoozeUntil;
        }) || null;
      setFollowUpPopup(next);
    } catch {}
  }

  async function refreshAttendanceGate() {
    if (!user?.user_id) return;
    try {
      const data = await api.get('/api/attendance?compact=1', { cacheTtlMs: isFocusRoute ? 2200 : 1200, timeoutMs: 10000, background: true });
      const joinedToday = Boolean(data?.today_stats?.joined_today);
      setAttendanceGate(data);
      setShowJoinOffice(!joinedToday);
    } catch {}
  }

  async function pingPresence() {
    try { await api.post('/api/attendance/ping', { last_page: location.pathname, compact: true }, { timeoutMs: 8000, background: true }); } catch {}
  }

  useEffect(() => { loadMeta(true); }, []);
  useEffect(() => {
    if (isFocusRoute) {
      setRevenuePopup(null);
      return;
    }
    loadRevenueReminder();
  }, [user?.user_id, location.pathname, isFocusRoute]);
  useEffect(() => {
    if (isFocusRoute) {
      setDailyWorkflowPopup(null);
      return;
    }
    loadDailyWorkflowPopup();
  }, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute]);
  useEffect(() => {
    if (isFocusRoute) {
      setSemiHourlyPopup(null);
      return;
    }
    loadSemiHourlyPopup();
  }, [user?.user_id, location.pathname, isFocusRoute]);
  usePolling(loadRevenueReminder, writeBusy ? 0 : (isFocusRoute ? 0 : 120000), [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
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
    if (writeBusy) return;
    pingPresence();
    refreshAttendanceGate();
  }, [location.pathname, user?.user_id, writeBusy]);
  useEffect(() => {
    if (isFocusRoute) {
      setTaskPopup(null);
      setFollowUpPopup(null);
      return;
    }
    loadApprovalReminder();
    loadTaskReminder();
    loadFollowUpPopup();
  }, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute]);
  usePolling(loadMeta, writeBusy ? 0 : (isFocusRoute ? 60000 : 12000), [user?.user_id, isFocusRoute, writeBusy]);
  usePolling(loadApprovalReminder, writeBusy ? 0 : (isFocusRoute ? 0 : 10000), [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadTaskReminder, writeBusy ? 0 : (isFocusRoute ? 0 : 10000), [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadFollowUpPopup, writeBusy ? 0 : (isFocusRoute ? 0 : 7000), [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadDailyWorkflowPopup, writeBusy ? 0 : (isFocusRoute ? 0 : 60000), [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadSemiHourlyPopup, writeBusy ? 0 : (isFocusRoute ? 0 : 30000), [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(pingPresence, writeBusy ? 0 : (isFocusRoute ? 90000 : 15000), [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(refreshAttendanceGate, writeBusy ? 0 : (isFocusRoute ? 60000 : 12000), [user?.user_id, location.pathname, isFocusRoute, writeBusy]);

  useEffect(() => {
    if (!taskPopup) {
      hadVisibleTaskPopupRef.current = false;
      return undefined;
    }
    if (!hadVisibleTaskPopupRef.current) {
      hadVisibleTaskPopupRef.current = true;
      playTaskReminderSound();
    }
    return undefined;
  }, [taskPopup]);

  useEffect(() => () => clearTaskPopupCloseTimer(), []);

  const baseNav = useMemo(() => {
    const items = [
      { key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
      { key: 'candidates', label: 'Candidates', href: '/candidates' },
      { key: 'submissions', label: 'Submissions', href: '/submissions' },
      { key: 'interviews', label: 'Interviews', href: '/interviews' },
      { key: 'followups', label: 'FollowUps', href: '/followups' },
      { key: 'tasks', label: 'Tasks', href: '/tasks' },
    ];
    if (['admin', 'manager', 'tl'].includes(String(user?.role || '').toLowerCase())) {
      items.push({ key: 'my-team', label: 'My Team', href: '/my-team' });
    }
    return items;
  }, [user]);

  const navStorageKey = `careerCroxSidebarOrder:${String(user?.role || 'guest').toLowerCase()}`;
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
    localStorage.setItem(navStorageKey, JSON.stringify(nav.map((item) => item.key)));
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
    setTheme(nextTheme);
    try { await persistTheme(nextTheme, customTheme); } catch {}
  }

  async function onLogout() {
    try {
      const revenueCheck = await api.get('/api/revenue-hub/logout-check');
      if (revenueCheck?.blocked) {
        setToast({ title: 'Revenue Hub update required', message: `${revenueCheck.count} interview items still need status update before logout.`, item: null });
        navigate('/revenue-hub');
        return;
      }
    } catch {}
    try {
      const data = await api.get('/api/attendance/logout-summary');
      setLogoutSummary(data.summary || null);
      setShowLogoutSummary(true);
    } catch {
      await logout();
      navigate('/login');
    }
  }

  async function sendReportAndLogout() {
    setSendingReport(true);
    try {
      await api.post('/api/attendance/send-report', {});
      await logout();
      navigate('/login');
    } finally {
      setSendingReport(false);
      setShowLogoutSummary(false);
    }
  }

  function onSearch(e) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(query)}`);
  }

  function updateCustomTheme(patch) {
    const next = { ...customTheme, ...patch };
    setCustomTheme(next);
    persistTheme(theme, next).catch(() => {});
  }

  async function openNotification(item) {
    try { await api.post(`/api/notifications/${item.notification_id}/read`, {}); } catch {}
    setToast(null);
    navigate(notificationTarget(item));
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

  function remindLater() {
    if (!approvalPopup) return;
    localStorage.setItem(`approval_snooze_${approvalPopup.id}`, String(Date.now() + 3 * 60 * 1000));
    setApprovalPopup(null);
    setRejectReason('');
  }

  function openProfileNewTab() {
    if (!approvalPopup?.candidate_id) return;
    setApprovalPopup(null);
    window.open(`/candidate/${approvalPopup.candidate_id}`, '_blank', 'noopener,noreferrer');
  }

  function openApprovalCenterFromPopup() {
    setApprovalPopup(null);
    setRejectReason('');
    navigate('/approvals');
  }

  function openTaskFromPopup(event) {
    if (event?.stopPropagation) event.stopPropagation();
    if (!taskPopup?.task_id) return;
    const taskId = taskPopup.task_id;
    window.open(`/tasks?task_id=${encodeURIComponent(taskId)}`, '_blank', 'noopener,noreferrer');
    dismissTaskPopup();
  }

  async function handleJoinOffice() {
    setSendingJoin(true);
    try {
      const data = await api.post('/api/attendance/join', { last_page: location.pathname || '/dashboard', compact: true }, { timeoutMs: 20000 });
      setAttendanceGate(data || null);
      setShowJoinOffice(false);
    } finally {
      setSendingJoin(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box glassy-card compact-brand-box clean-brand-box">
          <div className="compact-brand-row clean-brand-row">
            <img className="sidebar-brand-full-logo" src="/assets/img/career-crox-logo.svg" alt="Career Crox" />
          </div>
        </div>
        <nav className="sidebar-nav">
          {nav.map((item, index) => (
            <NavLink
              key={item.href}
              to={item.href}
              draggable
              onDragStart={() => setDragKey(item.key)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => reorderNav(item.key)}
              onDragEnd={() => setDragKey('')}
              className={({ isActive }) => `nav-item bounceable ${isActive ? 'active' : ''} ${dragKey === item.key ? 'dragging' : ''}`}
            >
              <span className="nav-order-badge">{index + 1}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="theme-panel glassy-card prominent-theme-box">
          <div className="theme-heading-row"><div className="theme-heading">Theme</div><button className="ghost-btn bounceable" type="button" onClick={() => setShowTheme((s) => !s)}>Theme Options</button></div>
          {showTheme && <div className="theme-panel-body">
            <div className="theme-grid">{themes.map(([key, label]) => <button key={key} className={`theme-dot theme-${key} ${theme === key ? 'active-theme' : ''}`} title={label} onClick={() => applyTheme(key)} />)}</div>
            <div className="theme-labels"><span>Theme selection</span><span>Saved per user</span></div>
            <div className="custom-theme-box">
              <div className="custom-theme-title">Brand Colors</div>
              <div className="theme-slider-row"><span>Hue</span><input type="range" min="-180" max="180" value={customTheme.hue || 0} onChange={(e) => updateCustomTheme({ hue: Number(e.target.value) })} /><span>{customTheme.hue || 0}°</span></div>
              <div className="custom-theme-grid">
                <label>Primary<input type="color" value={customTheme.primary} onChange={(e) => updateCustomTheme({ primary: e.target.value })} /></label>
                <label>Secondary<input type="color" value={customTheme.secondary} onChange={(e) => updateCustomTheme({ secondary: e.target.value })} /></label>
                <label>Accent<input type="color" value={customTheme.accent} onChange={(e) => updateCustomTheme({ accent: e.target.value })} /></label>
                <label>Button<input type="color" value={customTheme.button} onChange={(e) => updateCustomTheme({ button: e.target.value })} /></label>
              </div>
              <button className="ghost-btn bounceable custom-theme-reset" type="button" onClick={resetCustomTheme}>Reset Brand Colors</button>
            </div>
          </div>}
        </div>
      </aside>
      <main className="main-wrap">
        <header className="topbar">
          <div className="topbar-left"><div className="topbar-title topbar-brand-title"><img className="topbar-logo" src="/assets/img/career-crox-brand-icon.png" alt="Career Crox" /><span>{title}</span></div><div className="topbar-sub">{subtitle}</div></div>
          <div className="topbar-center"><form className="search-box glassy-card" onSubmit={onSearch}><input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search candidate, task, JD, phone, approval" /><button className="ghost-btn bounceable" type="submit">Search</button></form></div>
          <div className="topbar-right">
            <div className="top-action-wrap" ref={quickAddRef}>
              <button className="add-profile-btn bounceable" type="button" onClick={() => setShowAddMenu((s) => !s)}>Quick Add</button>
              {showAddMenu && <div className="add-menu show glassy-card professional-add-menu"><Link onClick={() => setShowAddMenu(false)} to="/quick-add/candidate">Add Candidate</Link><Link onClick={() => setShowAddMenu(false)} to="/quick-add/task">Add Task</Link><Link onClick={() => setShowAddMenu(false)} to="/quick-add/note">Add Note</Link><Link onClick={() => setShowAddMenu(false)} to="/quick-add/interview">Add Interview</Link><Link onClick={() => setShowAddMenu(false)} to="/submissions">Open Submissions</Link></div>}
            </div>
            <div className="user-chip glassy-card user-chip-menu">
              <div>
                <div className="user-name">{user?.full_name}</div>
                <div className="user-role">{user?.designation}</div>
                <div className="user-code">{user?.recruiter_code || '-'}</div>
              </div>
              <div className="user-chip-actions"><button className="mini-btn edit bounceable logout-mini" type="button" onClick={onLogout}>Logout</button></div>
            </div>
          </div>
        </header>
        {toast && <button type="button" className={`mini-toast toast-${String(toast.item?.category || toast.category || 'general').toLowerCase()}`} onClick={() => (toast.item ? openNotification(toast.item) : setToast(null))}><div className="mini-toast-title">{toast.title}</div><div className="mini-toast-body">{toast.message}</div></button>}
        {false && approvalPopup && <div style={{ position: 'fixed', right: 22, bottom: taskPopup ? 188 : 24, width: 320, zIndex: 60 }}>
          <div className="panel approval-popup-panel" style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.22)' }}>
            <div className="panel-title">Pending Submission Approval</div>
            <div className="helper-text">{approvalPopup.title} • {approvalPopup.recruiter_name || '-'} • {approvalPopup.process || '-'}</div>
            <div className="helper-text top-gap-small">Take the action here or open the approval center. The popup will not redirect the page unless you choose to open it.</div>
            <div className="row-actions top-gap">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={openProfileNewTab}>Open Profile</button>
              <button className="mini-btn call bounceable highlight-choice highlight-strong" type="button" disabled={savingApproval} onClick={approveFromPopup}>Approve</button>
              <button className="mini-btn edit bounceable highlight-choice highlight-strong" type="button" disabled={savingApproval} onClick={rejectFromPopup}>Reject</button>
              <button className="ghost-btn bounceable" type="button" onClick={remindLater}>Remind Later</button>
              <button className="ghost-btn bounceable" type="button" onClick={openApprovalCenterFromPopup}>Open Center</button>
            </div>
            <div className="field top-gap-small"><label>Reject Note (required for reject)</label><textarea rows="3" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason will be saved on the profile notes as well."></textarea></div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && semiHourlyPopup && <div className="revenue-reminder-wrap" style={{ bottom: revenuePopup ? 232 : 24 }}>
          <div className="panel approval-popup-panel revenue-reminder-popup glassy-card popup-info popup-dock-right">
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">{semiHourlyPopup.title}</div>
                <div className="helper-text">Leadership performance popup</div>
              </div>
            </div>
            <div className="task-reminder-title">{semiHourlyPopup.message}</div>
            {semiHourlyPopup.summary ? <div className="top-gap-small" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="mini-chip">Submissions: {semiHourlyPopup.summary.submissions_30 || 0}</span>
              <span className="mini-chip">Calls: {semiHourlyPopup.summary.calls_30 || 0}</span>
              <span className="mini-chip">Breaks: {semiHourlyPopup.summary.break_count_30 || 0}</span>
              <span className="mini-chip">Break mins: {semiHourlyPopup.summary.break_minutes_30 || 0}</span>
              <span className="mini-chip">Idle 15m+: {semiHourlyPopup.summary.idle_people_15 || 0}</span>
              <span className="mini-chip">No call 30m: {semiHourlyPopup.summary.no_call_30 || 0}</span>
            </div> : null}
            <div className="helper-text top-gap-small">This popup stays visible until the report is opened for the current half-hour cycle.</div>
            <div className="row-actions top-gap">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={openSemiHourlyReport}>Open Report</button>
            </div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && revenuePopup && <div className="revenue-reminder-wrap">
          <div className="panel approval-popup-panel revenue-reminder-popup glassy-card popup-info popup-dock-left">
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">{revenuePopup.title || 'Revenue follow-up due'}</div>
                <div className="helper-text">{revenuePopup.full_name || '-'} • {revenuePopup.candidate_id || '-'}</div>
              </div>
              <button className="task-reminder-close" type="button" onClick={() => setRevenuePopup(null)} aria-label="Close revenue reminder">×</button>
            </div>
            <div className="task-reminder-body">
              <div className="revenue-reminder-title">{revenuePopup.message || 'Update candidate journey in Revenue Hub.'}</div>
              <div className="helper-text top-gap-small">Status: {String(revenuePopup.status || '').replaceAll('_', ' ')}{revenuePopup.joining_date ? ` • Joining: ${revenuePopup.joining_date}` : ''}</div>
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable" type="button" onClick={() => { setRevenuePopup(null); navigate('/revenue-hub'); }}>Open Revenue Hub</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozeRevenuePopup(120)}>Remind Later</button>
            </div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && dailyWorkflowPopup && <div className="daily-workflow-wrap">
          <div className="panel approval-popup-panel daily-workflow-popup glassy-card popup-info popup-dock-left">
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">📌 {dailyWorkflowPopup.title}</div>
                <div className="helper-text">Daily recruiter workflow popup</div>
              </div>
              <button className="task-reminder-close" type="button" onClick={() => snoozeDailyWorkflowPopup(dailyWorkflowPopup.kind, dailyWorkflowPopup.dateKey, dailyWorkflowPopup.kind === 'today' ? 180 : DAILY_WORKFLOW_SNOOZE_MINUTES)} aria-label="Close daily workflow popup">×</button>
            </div>
            <div className="task-reminder-body">
              <div className="task-reminder-title">{dailyWorkflowPopup.message}</div>
              <div className="helper-text top-gap-small">The morning login list, 1 PM previous follow-up review, and 5 PM next-day all-set queue can all be opened from here.</div>
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={openDailyWorkflowFromPopup}>{dailyWorkflowPopup.primaryLabel}</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozeDailyWorkflowPopup(dailyWorkflowPopup.kind, dailyWorkflowPopup.dateKey, dailyWorkflowPopup.kind === 'today' ? 180 : DAILY_WORKFLOW_SNOOZE_MINUTES)}>{dailyWorkflowPopup.secondaryLabel}</button>
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
              <div className="task-reminder-title">Follow-up is due now. Keep this profile in the active follow-up queue.</div>
              <div className="helper-text">Time: {followUpPopup.follow_up_at ? new Date(followUpPopup.follow_up_at).toLocaleString() : '-'}</div>
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={() => { setFollowUpPopup(null); navigate(`/candidate/${followUpPopup.candidate_id}`); }}>Open Profile</button>
              <button className="mini-btn call bounceable" type="button" onClick={async () => { await api.post('/api/followups/action', { candidate_id: followUpPopup.candidate_id, follow_up_status: 'Done', follow_up_note: 'Closed from popup', follow_up_at: '' }); setFollowUpPopup(null); }}>Done</button>
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
        {taskPopup && <div className={`task-reminder-wrap ${taskPopupAnimatingOut ? 'is-leaving' : 'is-entering'}`}>
          <div className="panel approval-popup-panel task-reminder-popup glassy-card" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={(e) => openTaskFromPopup(e)} onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openTaskFromPopup(e);
            }
          }}>
            <div className="task-reminder-head">
              <div>
                <div className="panel-title">⏰ Task Reminder</div>
                <div className="helper-text">Open the task and take action from the task page.</div>
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
          const presence = attendanceGate?.presence;
          const joined = Boolean(attendanceGate?.today_stats?.joined_today);
          const onBreak = String(presence?.is_on_break || '0') === '1';
          const locked = String(presence?.locked || '0') === '1';
          const endAt = presence?.break_expected_end_at ? new Date(presence.break_expected_end_at).getTime() : 0;
          const diff = endAt ? endAt - Date.now() : 0;
          const abs = Math.abs(diff);
          const hrs = String(Math.floor(abs / 3600000)).padStart(2, '0');
          const mins = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
          const secs = String(Math.floor((abs % 60000) / 1000)).padStart(2, '0');
          const timerText = `${hrs}:${mins}:${secs}`;
          const overdue = onBreak && endAt && diff < 0;
          if (leadership || !joined || !locked) return null;
          if (onBreak && !overdue) {
            return <div className="crm-modal-backdrop crm-lock-backdrop"><div className="crm-premium-modal crm-lock-modal"><div className="panel-title">Break In Progress</div><div className="helper-text top-gap-small">CRM access is paused during break. End break to resume work.</div><div className="lock-overlay-timer">{timerText}</div><div className="helper-text top-gap-small">{presence?.break_reason || 'Break'} running</div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={async () => { try { const data = await api.post('/api/attendance/end-break', { compact: true }, { timeoutMs: 20000 }); setAttendanceGate(data || null); setShowJoinOffice(!Boolean(data?.today_stats?.joined_today)); } catch {} }}>End Break</button></div></div></div>;
          }
          return <LockedRequestModal reasonDefault={presence?.lock_message || presence?.break_reason || 'Please contact your reporting lead and request CRM unlock approval.'} refreshAttendanceGate={refreshAttendanceGate} navigate={navigate} />;
        })()}
        {showJoinOffice && <div className="crm-modal-backdrop"><div className="crm-premium-modal join-office-modal"><div className="panel-title">Start Workday</div><div className="helper-text top-gap-small">Start the workday to enable attendance tracking and controlled break handling.</div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={sendingJoin} onClick={handleJoinOffice}>{sendingJoin ? 'Joining...' : 'Start Workday'}</button></div></div></div>}
        {showLogoutSummary && <div className="crm-modal-backdrop" onClick={() => !sendingReport && setShowLogoutSummary(false)}><div className="crm-premium-modal logout-report-modal" onClick={(e) => e.stopPropagation()}><div className="panel-title">Session Summary</div><div className="helper-text top-gap-small">Review the day summary before ending the session. Send the report to complete logout.</div><div className="logout-report-grid top-gap"><div className="presence-stat premium-glow-card"><span>Work Time</span><strong>{formatMinutes(logoutSummary?.productive_work_minutes)}</strong></div><div className="presence-stat premium-glow-card"><span>Break Time</span><strong>{formatMinutes(logoutSummary?.total_break_minutes)}</strong></div><div className="presence-stat premium-glow-card"><span>Remaining Time</span><strong>{formatMinutes(logoutSummary?.remaining_work_minutes)}</strong></div><div className="presence-stat premium-glow-card"><span>Status</span><strong>{logoutSummary?.day_status || '-'}</strong></div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={sendingReport} onClick={sendReportAndLogout}>{sendingReport ? 'Sending...' : 'Send Report & Logout'}</button><button className="ghost-btn bounceable" type="button" disabled={sendingReport} onClick={() => setShowLogoutSummary(false)}>Back</button></div></div></div>}
        <section className="page-scroll">{children}</section>
      </main>
    </div>
  );
}
