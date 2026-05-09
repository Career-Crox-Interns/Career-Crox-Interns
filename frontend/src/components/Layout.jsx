import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { canAccessFeature, resolveUserRole } from '../lib/roleAccess';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { notificationTarget } from '../lib/notificationLink';
import { defaultCustomTheme } from '../lib/theme';

const themes = [
  ['corporate-light', 'Default'],
  ['peach-sky', 'Orange Glow'],
  ['ocean', 'Ocean Blue'],
  ['emerald-glow', 'Green Flow'],
  ['violet-frost', 'Violet Frost']
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
  { id: 'wink-bell', label: 'Wink Bell', notes: [784, 1175, 988], wave: 'sine' },
  { id: 'fun-office', label: 'Fun Office', notes: [523, 659, 831, 1047], wave: 'triangle' },
];

const POPUP_POLL_MS = 900000;
const CRM_REMINDER_LOOKAHEAD_MS = 10 * 60 * 1000;
const internalReminderStartMs = (stamp) => Math.max(Date.now(), Number(stamp || 0) - CRM_REMINDER_LOOKAHEAD_MS);
const META_POLL_MS = 900000;
const GOLD_REMINDER_POLL_MS = 900000;
const PRESENCE_POLL_MS = 900000;
const ATTENDANCE_GATE_POLL_MS = 900000;
const DISABLED_ARCHIVE_FEATURES = new Set(['data-extractor', 'quality-analyst', 'hr-head']);
const DISABLED_SLICES_ROUTE = '/disabled-slices';

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
  const effectiveCustomTheme = customTheme || defaultCustomTheme;
  const [notifications, setNotifications] = useState(0);
  const [approvals, setApprovals] = useState(0);
  const [showTheme, setShowTheme] = useState(false);
  const [notificationTune, setNotificationTune] = useState(() => {
    try {
      const stored = localStorage.getItem(NOTIFICATION_TUNE_STORAGE_KEY);
      return NOTIFICATION_TUNE_PRESETS.some((item) => item.id === stored) ? stored : 'fun-office';
    } catch {
      return 'fun-office';
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
  const [taskPopupAnimatingOut, setTaskPopupAnimatingOut] = useState(false);
  const [revenuePopup, setRevenuePopup] = useState(null);
  const [dailyWorkflowPopup, setDailyWorkflowPopup] = useState(null);
  const [semiHourlyPopup, setSemiHourlyPopup] = useState(null);
  const [goalPostReminderPopup, setGoalPostReminderPopup] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalReminderForm, setApprovalReminderForm] = useState({ exact_time: '' });
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
  const normalizedRole = resolveUserRole(user);
  const leadership = ['admin', 'manager', 'tl'].includes(normalizedRole);
  const AUTO_SYSTEM_POPUPS_ENABLED = String(import.meta.env?.VITE_AUTO_SYSTEM_POPUPS || 'false').toLowerCase() === 'true';
  const AUTO_SEMI_HOURLY_POPUPS_ENABLED = String(import.meta.env?.VITE_AUTO_SEMI_HOURLY_POPUPS || 'false').toLowerCase() === 'true';
  const quickAddRef = useRef(null);
  const taskPopupCloseTimerRef = useRef(null);
  const scheduledReminderTimersRef = useRef(new Map());
  const hadVisibleTaskPopupRef = useRef(false);
  const sidebarRef = useRef(null);
  const pageScrollRef = useRef(null);
  const [securityMarkAt, setSecurityMarkAt] = useState(() => new Date());
  const notificationCountRef = useRef(0);
  const approvalCountRef = useRef(0);
  const approvalPopupSeenRef = useRef('');
  const followupPopupSeenRef = useRef('');
  const dailyPopupSeenRef = useRef('');
  const semiHourlySeenRef = useRef('');
  const SIDEBAR_SCROLL_KEY = 'career-crox:sidebar-scroll-top';
  const PAGE_SCROLL_KEY_PREFIX = 'career-crox:page-scroll:';

  const currentPath = String(location.pathname || '');
  const isFocusRoute = useMemo(() => {
    return currentPath.startsWith('/candidate/')
      || currentPath.startsWith('/disabled-archive-section-never');
  }, [currentPath]);



  useEffect(() => {
    const timer = window.setInterval(() => setSecurityMarkAt(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.history || !('scrollRestoration' in window.history)) return undefined;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      try { window.history.scrollRestoration = previous || 'auto'; } catch {}
    };
  }, []);

  const securityMarkText = useMemo(() => {
    const label = [user?.full_name || user?.username || 'User', user?.recruiter_code || user?.user_id || ''].filter(Boolean).join(' • ');
    const stamp = securityMarkAt.toLocaleString('en-IN', { hour12: true });
    return `${label} • ${stamp}`;
  }, [securityMarkAt, user?.full_name, user?.username, user?.recruiter_code, user?.user_id]);

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
    const next = NOTIFICATION_TUNE_PRESETS.some((item) => item.id === tuneId) ? tuneId : 'fun-office';
    setNotificationTune(next);
    if (preview) {
      setPreviewingTuneId(next);
      window.setTimeout(() => playTaskReminderSound('preview', next), 20);
      window.setTimeout(() => setPreviewingTuneId((current) => current === next ? '' : current), 900);
    }
  }


  useLayoutEffect(() => {
    const el = sidebarRef.current;
    if (!el || typeof window === 'undefined') return;
    const raw = window.sessionStorage.getItem(SIDEBAR_SCROLL_KEY);
    const next = Number(raw || 0);
    if (Number.isFinite(next) && next > 0) {
      window.requestAnimationFrame(() => {
        if (sidebarRef.current) sidebarRef.current.scrollTop = next;
      });
    }
  }, [location.pathname]);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el || typeof window === 'undefined') return undefined;
    const save = () => {
      window.sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(el.scrollTop || 0));
    };
    save();
    el.addEventListener('scroll', save, { passive: true });
    window.addEventListener('beforeunload', save);
    return () => {
      el.removeEventListener('scroll', save);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [location.pathname]);

  useLayoutEffect(() => {
    const el = pageScrollRef.current;
    if (!el || typeof window === 'undefined') return;
    const key = `${PAGE_SCROLL_KEY_PREFIX}${location.pathname}${location.search || ''}`;
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
    window.open(path, '_blank', 'noopener,noreferrer');
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
    if (!AUTO_SYSTEM_POPUPS_ENABLED || !AUTO_SEMI_HOURLY_POPUPS_ENABLED) {
      setSemiHourlyPopup(null);
      return;
    }
    if (String(location.pathname || '').startsWith('/semi-hourly-report')) {
      setSemiHourlyPopup(null);
      return;
    }
    if (!user?.user_id || !['admin','manager','tl'].includes(normalizedRole)) {
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
    if (!user?.user_id || !canShowInterruptPopup) {
      setDailyWorkflowPopup(null);
      return;
    }
    try {
      const data = await api.get('/api/interviews', { background: true, cacheTtlMs: 60000, timeoutMs: 12000 });
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
      const data = await api.get('/api/approvals?scope=submissions', { background: true, cacheTtlMs: 60000, timeoutMs: 12000 });
      const next = (data.items || []).find((item) => {
        const snoozeUntil = Number(localStorage.getItem(`approval_snooze_${item.id}`) || 0);
        return Date.now() > snoozeUntil;
      }) || null;
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
    localStorage.setItem(`revenue_snooze_${revenuePopup.revenue_id}`, String(Date.now() + minutes * 60 * 1000));
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

  async function refreshAttendanceGate(forceFresh = false) {
    if (!user?.user_id) return null;
    try {
      const data = await api.get('/api/attendance?compact=1', {
        cacheTtlMs: forceFresh ? 0 : (isFocusRoute ? 120000 : 60000),
        timeoutMs: 10000,
        background: true,
      });
      const joinedToday = Boolean(data?.today_stats?.joined_today);
      setAttendanceGate(data);
      setShowJoinOffice(!joinedToday);
      return data;
    } catch {
      return null;
    }
  }

  async function pingPresence() {
    try { await api.post('/api/attendance/ping', { last_page: location.pathname, compact: true }, { timeoutMs: 8000, background: true }); } catch {}
  }


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
  usePolling(loadRevenueReminder, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : (isFocusRoute ? 0 : POPUP_POLL_MS), [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
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
  usePolling(loadApprovalReminder, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : (isFocusRoute ? 0 : POPUP_POLL_MS), [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadTaskReminder, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : (isFocusRoute ? 0 : POPUP_POLL_MS), [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadFollowUpPopup, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : (isFocusRoute ? 0 : POPUP_POLL_MS), [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadDailyWorkflowPopup, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : (isFocusRoute ? 0 : POPUP_POLL_MS), [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadSemiHourlyPopup, (AUTO_SYSTEM_POPUPS_ENABLED && AUTO_SEMI_HOURLY_POPUPS_ENABLED) ? POPUP_POLL_MS : 0, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(pingPresence, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : PRESENCE_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(refreshAttendanceGate, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : ATTENDANCE_GATE_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);

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
      { key: 'hot-leads', label: 'Hot Leads', href: '/hot-leads' },
      { key: 'submissions', label: 'Submissions', href: '/submissions' },
      { key: 'interviews', label: 'Interviews', href: '/interviews' },
      { key: 'followups', label: 'FollowUps', href: '/followups' },
      { key: 'tasks', label: 'Tasks', href: '/tasks' },
      { key: 'live-dialing', label: 'Live Dialing', href: '/live-dialing' },
      { key: 'bucket', label: 'Bucket', href: '/bucket-out' },
      { key: 'client-pipeline', label: 'Client Pipeline', href: '/client-pipeline' },
      { key: 'disabled-slices', label: 'Disabled Slices', href: DISABLED_SLICES_ROUTE },
      { key: 'revenue-hub', label: 'Pipeline Hub', href: '/revenue-hub' },
      { key: 'performance-centre', label: 'Performance Centre', href: '/performance-centre' },
      { key: 'timing-insights', label: 'Prime Time', href: '/prime-time-insights' },
      { key: 'recent-activity', label: 'Recent Activity', href: '/recent-activity' },
      { key: 'bda', label: 'BDA', href: '/bda' },
      { key: 'duplicate-profiles', label: 'Duplicate Profiles', href: '/duplicate-profiles' },
      { key: 'attendance', label: 'Attendance & Break Time', href: '/attendance' },
      { key: 'goal-post', label: 'Goal Post', href: '/goal-post' },
      { key: 'reports', label: 'Reports', href: '/reports' },
      { key: 'mail-centre', label: 'Mail Centre', href: '/mail-centre' },
      { key: 'jd-centre', label: 'JD Centre', href: '/jds' },
      { key: 'learning-hub', label: 'YT Hub', href: '/learning-hub' },
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

  async function fetchGoldReminder() {
    try {
      const data = await api.get('/api/goal-post/reminders', { background: true, cacheTtlMs: 120000, retries: 0, timeoutMs: 12000 });
      setGoalPostReminderPopup(data?.popup || null);
    } catch {}
  }

  usePolling(fetchGoldReminder, AUTO_SYSTEM_POPUPS_ENABLED ? GOLD_REMINDER_POLL_MS : 0, [user?.user_id, currentPath]);

  async function onLogout() {
    const shouldRunManagerLogoutChecks = ['admin', 'manager'].includes(normalizedRole);
    if (shouldRunManagerLogoutChecks) {
      try {
        const goalPostCheck = await api.get('/api/goal-post/logout-check', { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 });
        if (goalPostCheck?.blocked) {
          setToast({ title: 'Goal update required', message: goalPostCheck.message || 'Update the Goal Post tracker before logout.', item: null, category: 'goal-post' });
          if (goalPostCheck.page) navigate(goalPostCheck.page);
          return;
        }
        const revenueCheck = await api.get('/api/revenue-hub/logout-check');
        if (revenueCheck?.blocked) {
          setToast({ title: 'Pipeline Hub update required', message: `${revenueCheck.count} interview items still need status update before logout.`, item: null });
          navigate('/revenue-hub');
          return;
        }
      } catch {}
    }
    try {
      const data = await api.get('/api/attendance/logout-summary');
      setLogoutSummary(data.summary || null);
      setShowLogoutSummary(true);
    } catch {
      await logout();
      navigate('/login', { replace: true });
    }
  }

  async function sendReportAndLogout() {
    setSendingReport(true);
    try {
      try {
        await api.post('/api/attendance/send-report', {}, { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 });
      } catch {}
      await logout();
      navigate('/login', { replace: true });
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
    const next = { ...effectiveCustomTheme, ...patch };
    setCustomTheme(next);
    persistTheme(theme, next).catch(() => {});
  }

  function saveCurrentLook() {
    persistTheme(theme, effectiveCustomTheme).catch(() => {});
    setToast({ title: 'Theme saved', message: 'Current colours and background strength were saved for this user.' });
  }

  function handleResetTheme() {
    resetCustomTheme();
    persistTheme(theme, null).catch(() => {});
    setToast({ title: 'Theme reset', message: 'Custom page tint was cleared. The normal CRM look will stay the same across slices.' });
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
    localStorage.setItem(`approval_snooze_${approvalPopup.id}`, String(Date.now() + Number(minutes || 0) * 60 * 1000));
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
    localStorage.setItem(`approval_snooze_${approvalPopup.id}`, String(internalReminderStartMs(at)));
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
    window.open(`/candidate/${approvalPopup.candidate_id}`, '_blank', 'noopener,noreferrer');
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

  async function handleJoinOffice() {
    setSendingJoin(true);
    try {
      setShowJoinOffice(false);
      const data = await api.post('/api/attendance/join', { last_page: location.pathname || '/candidates', compact: true }, { timeoutMs: 20000 });
      const joinedToday = Boolean(data?.today_stats?.joined_today);
      setAttendanceGate(data || null);
      setShowJoinOffice(!joinedToday);
      if (!joinedToday) {
        const fresh = await refreshAttendanceGate(true);
        const resolvedJoined = Boolean(fresh?.today_stats?.joined_today);
        setShowJoinOffice(!resolvedJoined);
      }
    } catch {
      const fresh = await refreshAttendanceGate(true);
      const resolvedJoined = Boolean(fresh?.today_stats?.joined_today);
      setShowJoinOffice(!resolvedJoined);
    } finally {
      setSendingJoin(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" ref={sidebarRef}>
        <div className="brand-box glassy-card compact-brand-box clean-brand-box">
          <div className="compact-brand-row clean-brand-row">
            <img className="sidebar-brand-full-logo" src="/assets/img/career-crox-logo.svg" alt="Career Crox" />
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
                <span className="nav-order-badge">{index + 1}</span>
                <span>{item.label}</span>
              </div>
            ) : (
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
            )
          ))}
        </nav>
        <div className="theme-panel glassy-card prominent-theme-box">
          <div className="theme-heading-row"><div className="theme-heading">Appearance</div><button className="ghost-btn bounceable" type="button" onClick={() => setShowTheme((s) => !s)}>Display Options</button></div>
          {showTheme && <div className="theme-panel-body">
            <div className="theme-grid">{themes.map(([key, label]) => <button key={key} className={`theme-dot theme-${key} ${theme === key ? 'active-theme' : ''}`} title={label} onClick={() => applyTheme(key)} />)}</div>
            <div className="theme-labels"><span>Pick a theme</span><span>Saved look</span></div>
            <div className="custom-theme-box">
              <div className="custom-theme-title">Background and Theme Controls</div>
              <div className="theme-select-row">
                <label className="theme-select-shell">
                  <span>Background Colour</span>
                  <select value={effectiveCustomTheme.background || defaultCustomTheme.background} onChange={(e) => updateCustomTheme({ background: e.target.value })}>
                    {BACKGROUND_PRESETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="theme-slider-row"><span>Background Saturation</span><input type="range" min="0" max="100" value={effectiveCustomTheme.surface ?? 44} onChange={(e) => updateCustomTheme({ surface: Number(e.target.value) })} /><span>{effectiveCustomTheme.surface ?? 44}%</span></div>
              <div className="theme-slider-row"><span>Background Hue</span><input type="range" min="-180" max="180" value={effectiveCustomTheme.hue || 0} onChange={(e) => updateCustomTheme({ hue: Number(e.target.value) })} /><span>{effectiveCustomTheme.hue || 0}°</span></div>
              <div className="custom-theme-grid">
                <label>Background Base Tint<input type="color" value={effectiveCustomTheme.background || defaultCustomTheme.background} onChange={(e) => updateCustomTheme({ background: e.target.value })} /></label>
                <label>Card Colour A<input type="color" value={effectiveCustomTheme.primary} onChange={(e) => updateCustomTheme({ primary: e.target.value })} /></label>
                <label>Card Colour B<input type="color" value={effectiveCustomTheme.secondary} onChange={(e) => updateCustomTheme({ secondary: e.target.value })} /></label>
                <label>Form / Panel Tint<input type="color" value={effectiveCustomTheme.accent} onChange={(e) => updateCustomTheme({ accent: e.target.value })} /></label>
                <label>Buttons / Top Pills<input type="color" value={effectiveCustomTheme.button} onChange={(e) => updateCustomTheme({ button: e.target.value })} /></label>
              </div>
              <div className="theme-select-row" style={{ marginTop: 10 }}>
                <label className="theme-select-shell" style={{ width: '100%' }}>
                  <span>Notification Tune</span>
                  <select value={notificationTune} onChange={(e) => selectNotificationTune(e.target.value, true)}>
                    {NOTIFICATION_TUNE_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="helper-text top-gap-small">Choose one tiny fun-professional tune for reminders, popups, approvals, and notification bumps.</div>
              <div className="row-actions top-gap-small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="selection-count-chip">Current: {activeNotificationTune.label}</span>
                <button className="ghost-btn bounceable" type="button" onClick={() => selectNotificationTune(notificationTune, true)}>{previewingTuneId === notificationTune ? 'Playing...' : 'Preview Current Tune'}</button>
              </div>
              <div className="row-actions top-gap-small" style={{ gap: 8, flexWrap: 'wrap' }}>
                {NOTIFICATION_TUNE_PRESETS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`bucket-quick-pill bounceable ${notificationTune === item.id ? 'active' : ''}`}
                    onClick={() => selectNotificationTune(item.id, true)}
                    title={`Preview ${item.label}`}
                  >
                    {previewingTuneId === item.id ? `♪ ${item.label}` : item.label}
                  </button>
                ))}
              </div>
              <div className="theme-action-row">
                <button className="ghost-btn bounceable custom-theme-save" type="button" onClick={saveCurrentLook}>Save This Look</button>
                <button className="ghost-btn bounceable custom-theme-reset" type="button" onClick={handleResetTheme}>Reset Theme</button>
              </div>
            </div>
          </div>}
        </div>
      </aside>
      <main className="main-wrap">
        <header className="topbar">
          <div className="topbar-left"><div className="topbar-title topbar-brand-title"><img className="topbar-logo" src="/assets/img/career-crox-brand-icon.png" alt="Career Crox" /><span>{title}</span></div></div>
          <div className="topbar-center"><form className="search-box glassy-card" onSubmit={onSearch}><input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search candidate, task, JD, phone, approval" /><button className="ghost-btn bounceable" type="submit">Search</button></form></div>
          <div className="topbar-right">
            <div className="top-action-wrap" ref={quickAddRef}>
              <button className="add-profile-btn bounceable" type="button" onClick={() => setShowAddMenu((s) => !s)}>Quick Add</button>
              {showAddMenu && <div className="add-menu show glassy-card professional-add-menu"><Link onClick={() => setShowAddMenu(false)} to="/quick-add/candidate">Add Candidate</Link><Link onClick={() => setShowAddMenu(false)} to="/quick-add/task">Add Task</Link><Link onClick={() => setShowAddMenu(false)} to="/quick-add/note">Add Note</Link>{leadership && <Link onClick={() => setShowAddMenu(false)} to="/quick-add/jd">Add JD</Link>}<Link onClick={() => setShowAddMenu(false)} to="/quick-add/interview">Add Interview</Link><Link onClick={() => setShowAddMenu(false)} to="/submissions">Open Submissions</Link>{canAccessFeature(normalizedRole, 'attendance') && <Link onClick={() => setShowAddMenu(false)} to="/attendance">Attendance & Break Time</Link>}{canAccessFeature(normalizedRole, 'bda') && <Link onClick={() => setShowAddMenu(false)} to="/bda">Open BDA</Link>}{canAccessFeature(normalizedRole, 'learning-hub') && <Link onClick={() => setShowAddMenu(false)} to="/learning-hub">YT Hub</Link>}</div>}
            </div>
            {leadership && <Link className="top-pill bounceable" data-pill="approvals" to="/approvals">Approvals <span className="pill-count">{approvals}</span></Link>}
            <Link className="top-pill bounceable" data-pill="notifications" to="/notifications">Notifications <span className="pill-count">{notifications}</span></Link>
            <Link className="top-pill bounceable" data-pill="team-chat" to="/chat">Team Chat</Link>
            <Link className="top-pill bounceable" data-pill="aaria" to="/aaria">Aaria</Link>
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
        {toast && <button type="button" className={`mini-toast toast-${String(toast.item?.category || toast.category || 'general').toLowerCase()}`} onClick={() => (toast.item ? openNotification(toast.item) : setToast(null))}><div className="mini-toast-title">{toast.title}</div><div className="mini-toast-body">{toast.message}</div></button>}
        {approvalPopup && <div style={{ position: 'fixed', right: 22, bottom: 24, width: 360, zIndex: 60 }}>
          <div className="panel approval-popup-panel" style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.22)', maxWidth: '360px' }}>
            <div className="panel-title">Pending Submission Approval</div>
            <div className="helper-text">{approvalPopup.title} • {approvalPopup.recruiter_name || '-'} • {approvalPopup.process || '-'}</div>
            <div className="helper-text top-gap-small">Take the action here or open the approval center. The popup will not redirect the page unless you choose to open it.</div>
            <div className="row-actions top-gap">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={openProfileNewTab}>Open Profile</button>
              <button className="mini-btn call bounceable highlight-choice highlight-strong" type="button" disabled={savingApproval} onClick={approveFromPopup}>Approve</button>
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
            <div className="field top-gap-small"><label>Reject Note (required for reject)</label><textarea rows="3" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason will be saved on the profile notes as well."></textarea></div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && AUTO_SEMI_HOURLY_POPUPS_ENABLED && semiHourlyPopup && <div className="revenue-reminder-wrap" style={{ bottom: revenuePopup ? 232 : 24 }}>
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
              {String(followUpPopup.follow_up_note || '').trim() ? <div className="task-reminder-note-card top-gap-small"><strong>Note:</strong> {followUpPopup.follow_up_note}</div> : null}
            </div>
            <div className="row-actions top-gap task-reminder-actions">
              <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={() => { if (followUpPopup?.candidate_id) window.open(`/candidate/${followUpPopup.candidate_id}`, '_blank', 'noopener,noreferrer'); setFollowUpPopup(null); }}>Open Profile</button>
              <button className="mini-btn call bounceable" type="button" onClick={async () => { await api.post('/api/followups/action', { candidate_id: followUpPopup.candidate_id, follow_up_status: 'Done', follow_up_note: followUpPopup.follow_up_note ? `${followUpPopup.follow_up_note} • Closed from popup` : 'Closed from popup', follow_up_at: '' }); setFollowUpPopup(null); }}>Done</button>
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
        {goalPostReminderPopup && <div style={{ position: 'fixed', right: 22, bottom: 24, width: 360, zIndex: 60 }}>
          <div className="panel approval-popup-panel goalpost-reminder-panel" style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.28)', maxWidth: '360px' }}>
            <div className="panel-title">{goalPostReminderPopup.title}</div>
            <div className="helper-text">{goalPostReminderPopup.message}</div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" onClick={() => { setGoalPostReminderPopup(null); navigate('/goal-post'); }}>Open Goal Post</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => setGoalPostReminderPopup(null)}>Dismiss</button>
            </div>
          </div>
        </div>}
        {showLogoutSummary && <div className="crm-modal-backdrop" onClick={() => !sendingReport && setShowLogoutSummary(false)}><div className="crm-premium-modal logout-report-modal" onClick={(e) => e.stopPropagation()}><div className="panel-title">Session Summary</div><div className="helper-text top-gap-small">Review the day summary before ending the session. Send the report to complete logout.</div><div className="logout-report-grid top-gap"><div className="presence-stat premium-glow-card"><span>Work Time</span><strong>{formatMinutes(logoutSummary?.productive_work_minutes)}</strong></div><div className="presence-stat premium-glow-card"><span>Break Time</span><strong>{formatMinutes(logoutSummary?.total_break_minutes)}</strong></div><div className="presence-stat premium-glow-card"><span>Remaining Time</span><strong>{formatMinutes(logoutSummary?.remaining_work_minutes)}</strong></div><div className="presence-stat premium-glow-card"><span>Status</span><strong>{logoutSummary?.day_status || '-'}</strong></div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={sendingReport} onClick={sendReportAndLogout}>{sendingReport ? 'Sending...' : 'Send Report & Logout'}</button><button className="ghost-btn bounceable" type="button" disabled={sendingReport} onClick={() => setShowLogoutSummary(false)}>Back</button></div></div></div>}
        <div className="crm-security-mark" aria-hidden="true">{securityMarkText}</div>
        <section className="page-scroll" ref={pageScrollRef}>{children}</section>
      </main>
    </div>
  );
}
