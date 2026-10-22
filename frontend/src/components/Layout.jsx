import {readPersonalSettings} from '../lib/personalSettings';
import {DashboardViewBanner,DashboardSwitcher,useDashboardScope} from '../lib/dashboardScope';
import { parseDateInput } from '../lib/workspaceHelpers';
import { CrmDateTimeInput } from './PremiumSelect';
import { installDialerProfileBridge, openDialerProfile } from '../lib/candidateNav';
import { readMobileAppearance } from '../lib/theme';
import { ActionGlyph } from './EmojiGlyph';
import PremiumSelect from './PremiumSelect';
import React, { createContext, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { freshCandidateUrl } from './ContactTextExtractor';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { canAccessFeature, resolveUserRole } from '../lib/roleAccess';
import { api,rememberStaffNames } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { getPollingLeaderSnapshot } from '../lib/tabLeader';
import { notificationTarget } from '../lib/workspaceHelpers';
import { defaultCustomTheme } from '../lib/theme';
import { openCandidateProfileInPopupTab } from '../lib/candidateNav';
import HeaderSearch from './HeaderSearch';
import { playNotificationSound } from '../lib/notificationSound';
import {installSubmissionReviewRuntime} from '../lib/compactReminderRuntime';
import { crmDateParts, crmTodayYmd, crmYmd } from '../lib/workspaceHelpers';

// Semantic reminder colours stay distinct from the selected workspace accent.
function reminderKind(value, fallback = 'general') {
  const text = typeof value === 'object'
    ? [value?.kind, value?.category, value?.type, value?.title, value?.message, value?.item?.category, value?.item?.title].filter(Boolean).join(' ').toLowerCase()
    : String(value || '').toLowerCase();
  if (/feedback|result/.test(text)) return 'feedback';
  if (/invoice|payout|payment|revenue/.test(text)) return 'revenue';
  if (/joining|joined/.test(text)) return 'joining';
  if (/interview/.test(text)) return 'interview';
  if (/follow.?up|callback/.test(text)) return 'followup';
  if (/approv|unlock/.test(text)) return 'approval';
  if (/submission|details.sent/.test(text)) return 'submission';
  if (/task/.test(text)) return 'task';
  if (/report|goal/.test(text)) return 'report';
  if (/break|attendance|activity|office/.test(text)) return 'attendance';
  return fallback;
}

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
  return String(row.submission_note || row.submission_notes || row.reminder_note || row.last_note || row.last_notes || row.notes || row.note || '').trim();
}

function pickGlobalSubmissionReminder(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && isGlobalSubmissionReminderPending(row) && isGlobalSubmissionReminderDue(row) && !isGlobalSubmissionReminderSnoozed(row))
    .sort((a, b) => {
      const personal = Number(Boolean(b.personal_owner)) - Number(Boolean(a.personal_owner));
      if (personal) return personal;
      return new Date(globalSubmissionReminderStamp(a) || 0).getTime() - new Date(globalSubmissionReminderStamp(b) || 0).getTime();
    })[0] || null;
}

function pickUpcomingGlobalSubmissionReminder(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && isGlobalSubmissionReminderPending(row) && !isGlobalSubmissionReminderSnoozed(row))
    .sort((a, b) => {
      const personal = Number(Boolean(b.personal_owner)) - Number(Boolean(a.personal_owner));
      if (personal) return personal;
      return new Date(globalSubmissionReminderStamp(a) || 0).getTime() - new Date(globalSubmissionReminderStamp(b) || 0).getTime();
    })[0] || null;
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
const APPROVAL_POLL_MS = 300000; // optional recovery only; event stream handles urgent approvals
const GOLD_REMINDER_POLL_MS = 900000;
const PRESENCE_POLL_MS = 60000; // lightweight heartbeat only; not every second
const ATTENDANCE_GATE_POLL_MS = 120000;
const DISABLED_ARCHIVE_FEATURES = new Set();
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

function LockedRequestModal({ role, managerSuspended=false, reasonDefault, refreshAttendanceGate, navigate, breakExpiryAt = 0, overrunText = "" }) {
  async function resumeSelf(){const note=reason.trim();if(note.length<5||sending)return;setSending(true);setRequestError('');try{const result=await api.post('/api/attendance/self-unlock',{reason:note},{retries:0});if(!result?.ok)throw new Error('CRM resume was not confirmed. Please retry.');await refreshAttendanceGate(true);}catch(e){setRequestError(e.message);}finally{setSending(false);}}
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
  return <div className="crm-modal-backdrop crm-lock-backdrop"><div className={`crm-premium-modal crm-lock-modal danger premium-crm-lock-request-modal ${breakExpiryAt ? 'cc556-expired-request' : ''}`}><div className="lock-premium-chip">{managerSuspended?'Manager approval required':role==='tl'?'Resume with manager review':'TL approval required'}</div><div className="panel-title">CRM Access Paused</div>{breakExpiryAt ? <div className="cc556-negative-clock" data-break-expiry={breakExpiryAt} aria-live="off">{overrunText}</div> : null}<div className="helper-text top-gap-small">{role==='tl'&&!managerSuspended?'Enter a reason and resume your workspace. Manager review follows; you do not need to wait.':breakExpiryAt ? 'Your break allowance has ended. Explain why you were late; approval is required to resume.' : 'Explain why access is needed; approval is required to resume.'}</div><div className="field top-gap"><label htmlFor="cc579-access-reason">{breakExpiryAt ? 'Reason for late return (required)' : 'Reason for access (required)'}</label><textarea id="cc579-access-reason" rows="4" maxLength={500} required value={reason} onChange={(e) => { setReason(e.target.value); setRequestError(''); }} placeholder="Why were you late returning from break?" /></div>{requestError && <div className="helper-text cc579-error" role="alert">{requestError}</div>}{requestSent && <div className="helper-text cc579-success" role="status">Request sent to the approver. Wait for approval.</div>}<div className="row-actions top-gap">{role==='tl'&&!managerSuspended&&<button type="button" className="add-profile-btn" disabled={sending||reason.trim().length<5} onClick={resumeSelf}>{sending?'Resuming…':'Resume work · notify manager'}</button>}{(role!=='tl'||managerSuspended)&&<button className="add-profile-btn bounceable" type="button" disabled={sending || requestSent || reason.trim().length < 5} onClick={sendRequest}>{requestSent ? 'Request Sent' : sending ? 'Sending...' : 'Request for Access'}</button>}<button className="mini-btn view bounceable" type="button" onClick={() => refreshAttendanceGate(true)}>Check Approval</button></div></div></div>;
}


// CC876: standby safety banner and independent, non-blocking Excel reminder.
function MultipleCrmGate(){
 const {user}=useAuth(),navigate=useNavigate();
 const [data,setData]=useState(null);const manager=['manager','admin'].includes(String(user?.role||'').toLowerCase());
 useEffect(()=>{let active=true;const load=async()=>{try{const s=await api.get('/api/multiple-crm/status',{cacheTtlMs:0,allowStale:false,retries:0,background:true});if(active){setData(s);window.__CC874_INSTANCE_MODE__=s.mode;}}catch{}};load();return()=>{active=false;};},[user?.user_id]);
 if(!data?.available||['ACTIVE','LOCAL','UNCONFIGURED'].includes(data.mode))return null;
 return <div className="cc874-standby-banner" style={{position:'fixed',top:0,left:0,right:0,zIndex:100030}}>This CRM is {String(data.mode).toLowerCase()}. {manager?'Manager recovery workspace remains available.':'Continue on your active CRM.'}<button className="ghost-btn" onClick={()=>navigate('/data-backup')}>Backup workspace</button></div>;
}
function ExcelBackupReminderGate(){
 const {user}=useAuth(),location=useLocation(),navigate=useNavigate(),manager=['manager','admin'].includes(String(user?.role||'').toLowerCase());
 const [reminder,setReminder]=useState(null),[error,setError]=useState(''),[backupNow,setBackupNow]=useState(Date.now());
 useEffect(()=>{if(!manager)return;const clock=setInterval(()=>setBackupNow(Date.now()),15000);return()=>clearInterval(clock);},[manager]);
 useEffect(()=>{if(!manager)return;let live=true;const update=async()=>{try{const result=await api.get('/api/data-backup/full-excel/reminder',{cacheTtlMs:0,retries:0,allowStale:false,background:true});if(live)setReminder({...result.reminder,__received:Date.now()});}catch{}};update();window.addEventListener('focus',update);window.addEventListener('cc876-backup-state',update);return()=>{live=false;window.removeEventListener('focus',update);window.removeEventListener('cc876-backup-state',update);};},[manager,user?.user_id]);
 const offset=reminder?.server_now&&reminder?.__received?Date.parse(reminder.server_now)-reminder.__received:0;
 const due=Boolean(reminder)&&backupNow+offset>=Date.parse(reminder.next_due_at)&&!(Date.parse(reminder.snooze_until||'')>backupNow+offset)&&!location.pathname.startsWith('/data-backup')&&!location.pathname.startsWith('/admin');
 const postpone=async()=>{try{const result=await api.post('/api/data-backup/full-excel/remind-later',{hours:6},{retries:0});setReminder({...result.reminder,__received:Date.now()});setError('');}catch(e){setError(e.message);}};
 if(!manager||!due)return null;
 return <div className="cc874-backup-overlay" style={{zIndex:100020}}><section className="cc874-backup-dialog" role="dialog" aria-modal="true" aria-label="Download full CRM Excel reminder"><span className="cc874-kicker">CAREER CROX · MANAGER BACKUP REMINDER</span><h3>Download Full CRM Excel</h3><p>{reminder.days_without_backup} days since the last saved backup. Save candidates, staff allocations, notes, tasks and reminders. Resume and recording files are never included.</p><div className="row-actions"><button className="add-profile-btn" onClick={()=>navigate('/data-backup')}>Download Full CRM Excel</button><button className="ghost-btn" onClick={postpone}>Remind after 6 hours</button></div>{error?<p role="alert">{error}</p>:null}<p className="helper-text">You can postpone even after three days; staff work is never locked by this reminder.</p></section></div>;
}

function PopupMinimizeControl(){
 const [until,setUntil]=useState(0);
 useEffect(()=>{if(!until)return;document.documentElement.classList.add('cc878-popups-paused');window.__CC878_POPUPS_MINIMIZED_UNTIL__=until;const t=setTimeout(()=>{document.documentElement.classList.remove('cc878-popups-paused');window.__CC878_POPUPS_MINIMIZED_UNTIL__=0;setUntil(0);},Math.max(0,until-Date.now()));return()=>{clearTimeout(t);document.documentElement.classList.remove('cc878-popups-paused');window.__CC878_POPUPS_MINIMIZED_UNTIL__=0;};},[until]);
 return <button type="button" className="cc878-minimize-popups" aria-label="Minimize all popups for 5 seconds" title={until?'Popups return after 5 seconds':'Minimize all popups for 5 seconds'} disabled={!!until} onClick={()=>setUntil(Date.now()+5000)}><span aria-hidden="true">⊟</span><small>{until?'5s':''}</small></button>;
}

function WorkspaceLayout({ title, subtitle, children }) {
  const dashboardScope=useDashboardScope();
  const [popupPrefs,setPopupPrefs]=useState(readPersonalSettings);
  useEffect(()=>{const changed=()=>setPopupPrefs(readPersonalSettings());window.addEventListener('cc787-settings-changed',changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener('cc787-settings-changed',changed);window.removeEventListener('storage',changed);};},[]);
  const { user, logout, theme, setTheme, customTheme, setCustomTheme, resetCustomTheme, persistTheme } = useAuth();
  const [quickPair,setQuickPair]=useState(null);
  const quickPairRef = useRef(null);
  const quickPairButtonRef = useRef(null);
  const quickPairRequestRef = useRef(false);
  const quickPairSeqRef = useRef(0);
  const quickPairInFlightSeqRef = useRef(0);
  const quickPairProposalRef = useRef('');
  function closeQuickPair() { quickPairSeqRef.current += 1; setQuickPair(null); }
  const [blockedProfile,setBlockedProfile]=useState(null);
  useEffect(()=>installDialerProfileBridge(user),[user?.user_id]);
  useEffect(()=>{const h=e=>setBlockedProfile(e.detail);window.addEventListener('career-crox-profile-popup-blocked',h);return()=>window.removeEventListener('career-crox-profile-popup-blocked',h);},[]);
  // CC815: show the four digits synchronously, then confirm the exact code was stored.
  // Clicking elsewhere closes the popover, without another API request.
  function makeVisiblePairCode() {
    const buffer = new Uint32Array(1);
    if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(buffer);
      return String(1000 + (buffer[0] % 9000));
    }
    return String(1000 + Math.floor(Math.random() * 9000));
  }
  async function showQuickPair() {
    if (quickPairRequestRef.current) {
      // Reopen the pending single request without triggering a second DB write.
      quickPairSeqRef.current = quickPairInFlightSeqRef.current;
      setQuickPair({ pairing_code: quickPairProposalRef.current, loading: true, confirmed: false });
      return;
    }
    quickPairRequestRef.current = true;
    const requestSeq = ++quickPairSeqRef.current;
    quickPairInFlightSeqRef.current = requestSeq;
    const proposed = makeVisiblePairCode();
    quickPairProposalRef.current = proposed;
    setQuickPair({ pairing_code: proposed, loading: true, confirmed: false });
    try {
      const data = await api.post('/api/dialer/pair-code', {
        appearance: readMobileAppearance(), client_pairing_code: proposed,
      }, { timeoutMs: 14000, retries: 0, background: false });
      if (!data?.ok || !/^\d{4}$/.test(String(data.pairing_code || ''))) {
        throw new Error('Pair code was not confirmed by CRM. Click Pair Phone again.');
      }
      if (requestSeq === quickPairSeqRef.current) setQuickPair({ ...data, loading: false, confirmed: true });
    } catch (error) {
      if (requestSeq === quickPairSeqRef.current) setQuickPair({ pairing_code: '', loading: false, confirmed: false,
        error: String(error?.message || 'Pairing unavailable. Try once more.') });
    } finally { quickPairRequestRef.current = false; }
  }
  useEffect(() => {
    if (!quickPair) return undefined;
    const onOutside = (event) => {
      if (quickPairRef.current?.contains(event.target) || quickPairButtonRef.current?.contains(event.target)) return;
      closeQuickPair();
    };
    const onKey = (event) => { if (event.key === 'Escape') closeQuickPair(); };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onOutside); document.removeEventListener('keydown', onKey); };
  }, [Boolean(quickPair)]);
  const effectiveCustomTheme = customTheme || defaultCustomTheme;
  const [notifications, setNotifications] = useState(0);
  useEffect(()=>{const manager=['manager','admin'].includes(String(user?.role||'').toLowerCase());const scan=node=>{if(!node?.querySelectorAll)return;const candidates=[...(node.matches?.('button,a,[role=button]')?[node]:[]),...node.querySelectorAll('button,a,[role=button]')];for(const element of candidates){const label=String(element.textContent||element.getAttribute('aria-label')||'').trim();if(label.length<120&&/\b(export|download)\b/i.test(label)){element.dataset.cc831NoExport=manager?'false':'true';}}};scan(document.body);const observer=new MutationObserver(changes=>{for(const change of changes)for(const node of change.addedNodes)if(node.nodeType===1)scan(node);});observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[user?.role]);

  const [approvals, setApprovals] = useState(0);
  useEffect(()=>{const receive=e=>{const item=e.detail;if(!item?.notification_id)return;setToast({title:item.title,message:item.message,item});setNotifications(n=>n+1);playNotificationSound('', '', 'notice:'+item.notification_id).catch(()=>{});};window.addEventListener('career-crox-notification',receive);return()=>window.removeEventListener('career-crox-notification',receive);},[]);

  useEffect(()=>installSubmissionReviewRuntime(user),[user?.user_id,user?.role]);
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(()=>{let cancelled=false;const names=(force=false)=>api.get('/api/ui/lookups?scope=profile',{cacheTtlMs:force?0:60000,allowStale:!force,timeoutMs:10000,retries:0}).then(p=>{if(!cancelled)rememberStaffNames(p.users||[]);}).catch(()=>{});names();const changed=e=>{if(/flowchart|users/.test(e.detail?.source||e.detail?.path||'')){names(true);window.dispatchEvent(new Event('career-crox-team-changed'));}};window.addEventListener('career-crox-manager-reminder-dirty',changed);window.addEventListener('career-crox-data-written',changed);return()=>{cancelled=true;window.removeEventListener('career-crox-manager-reminder-dirty',changed);window.removeEventListener('career-crox-data-written',changed);};},[user?.user_id]);
  const [toast, setToast] = useState(null);
  const [toastClosing,setToastClosing]=useState(false),toastExitTimer=useRef(null);
  function dismissToast(){const current=toast;if(!current)return;setToastClosing(true);clearTimeout(toastExitTimer.current);toastExitTimer.current=setTimeout(()=>{setToast(value=>value===current?null:value);},220);}
  useEffect(()=>{setToastClosing(false);clearTimeout(toastExitTimer.current);if(!toast||!popupPrefs.popupAutoHide)return;const timer=setTimeout(dismissToast,popupPrefs.popupSeconds*1000);return()=>{clearTimeout(timer);clearTimeout(toastExitTimer.current);};},[toast,popupPrefs.popupAutoHide,popupPrefs.popupSeconds]);
  const attendanceReadSequence=useRef(0),attendanceUnlockedAt=useRef(0),lastUnlockEvent=useRef('');
  const [lastNotificationId, setLastNotificationId] = useState('');
  const chatToastSeen=useRef(new Set());
  // CC84: The complete ARIA scorecard belongs in Team Chat / its report page,
  // never inside the tiny notification. Show a compact, top-docked notice only.
  useEffect(() => {
    window.__CC814_CHAT_TOAST_OWNER__ = true;
    const incoming = (event) => {
      const message = event.detail;
      if (!message || message.sender_username === user?.username) return;
      const key = String(message.id || message.message_id || '');
      if (!key || chatToastSeen.current.has(key)) return;
      chatToastSeen.current.add(key);
      if (chatToastSeen.current.size > 200) chatToastSeen.current.delete(chatToastSeen.current.values().next().value);
      const fullBody = String(message.body || message.message || message.text || 'New message');
      const isAriaReport = String(message.sender_username || message.sender_name || '').toLowerCase() === 'aria'
        && (String(message.reference_type || '') === 'semi_hourly_report' || /^30-minute team performance/i.test(fullBody));
      const reportId = String(message.reference_id || '').trim();
      const reportMatch = fullBody.match(/(?:^|\n)Chart:\s*\/semi-hourly-report\?reportId=([^\s]+)/i);
      const reportPath = isAriaReport && (reportId || reportMatch)
        ? `/semi-hourly-report?reportId=${encodeURIComponent(reportId || reportMatch[1])}`
        : '';
      setToast(isAriaReport ? {
        title: 'ARIA · Performance Report',
        message: '30-minute team report is ready. Click to view.',
        category: 'aria',
        href: reportPath || '/chat',
      } : {
        title: message.sender_name || message.sender_full_name || 'Team Chat',
        message: fullBody,
        item: { category: 'chat', metadata: JSON.stringify({ thread_key: message.thread_key || 'team' }) },
      });

      playNotificationSound('', false, 'chat:' + key).catch(() => {});
    };
    window.addEventListener('career-crox-chat-message', incoming);
    return () => {
      window.__CC814_CHAT_TOAST_OWNER__ = false;
      window.removeEventListener('career-crox-chat-message', incoming);
    };
  }, [user?.username]);

  const [approvalPopup, setApprovalPopup] = useState(null);
  const [taskChangeToast,setTaskChangeToast] = useState(null);
  const taskChangeSeenRef = useRef(new Set());
  useEffect(()=>{
    if(!user?.user_id)return;
    const received=event=>{
      const payload=event.detail||{},task=payload.task;
      if(!task?.task_id||String(payload.recipient_user_id||task.assigned_to_user_id||'')!==String(user.user_id))return;
      const key=[task.task_id,payload.kind,task.status,task.due_at||task.due_date,payload.at].join(':');
      if(taskChangeSeenRef.current.has(key))return;
      taskChangeSeenRef.current.add(key);if(taskChangeSeenRef.current.size>120)taskChangeSeenRef.current.delete(taskChangeSeenRef.current.values().next().value);
      setTaskChangeToast({task,kind:payload.kind,key});
      playTaskReminderSound('popup','','task-change:'+key);
    };
    window.addEventListener('career-crox-task-changed',received);
    return()=>window.removeEventListener('career-crox-task-changed',received);
  },[user?.user_id]);
  useEffect(()=>{if(!taskChangeToast||!popupPrefs.popupAutoHide)return;const t=window.setTimeout(()=>setTaskChangeToast(null),popupPrefs.popupSeconds*1000);return()=>window.clearTimeout(t);},[taskChangeToast,popupPrefs.popupAutoHide,popupPrefs.popupSeconds]);
  const [taskPopup, setTaskPopup] = useState(null);
  const [followUpPopup, setFollowUpPopup] = useState(null);
  const [globalSubmissionReminderPopup, setGlobalSubmissionReminderPopup] = useState(null);
  const [taskPopupAnimatingOut, setTaskPopupAnimatingOut] = useState(false);
  const [revenuePopup, setRevenuePopup] = useState(null);
  const [dailyWorkflowPopup, setDailyWorkflowPopup] = useState(null);
  const [semiHourlyPopup, setSemiHourlyPopup] = useState(null);
  const [goalPostReminderPopup, setGoalPostReminderPopup] = useState(null);
  useEffect(()=>{if(!popupPrefs.popupAutoHide)return;const timer=setTimeout(()=>{setApprovalPopup(null);setTaskPopup(null);setFollowUpPopup(null);setGlobalSubmissionReminderPopup(null);setRevenuePopup(null);setDailyWorkflowPopup(null);setSemiHourlyPopup(null);setGoalPostReminderPopup(null);},popupPrefs.popupSeconds*1000);return()=>clearTimeout(timer);},[approvalPopup,taskPopup,followUpPopup,globalSubmissionReminderPopup,revenuePopup,dailyWorkflowPopup,semiHourlyPopup,goalPostReminderPopup,popupPrefs.popupAutoHide,popupPrefs.popupSeconds]);
  const [goalPostLogoutChoice, setGoalPostLogoutChoice] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [approvalReminderForm, setApprovalReminderForm] = useState({ exact_time: '' });
  const [savingApproval, setSavingApproval] = useState(false);
  const pendingApprovalKeysRef=useRef(new Set());
  const [showJoinOffice, setShowJoinOffice] = useState(false);
  const [sendingJoin, setSendingJoin] = useState(false);
  const [officeJoinError, setOfficeJoinError] = useState('');
  const [attendanceGate, setAttendanceGate] = useState(()=>window.__CC836_ATTENDANCE__?.()||null);
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
  useLayoutEffect(() => {
    const host = document.querySelector('.cc785-route-content');
    if (!host) return;
    const markMetrics = () => {
      const cards = host.querySelectorAll('.stat-card,.metric-card,.bda-stat-card,.goalpost-summary-card,.goalpost-metric-card,.mail-top-card,.assistant-stat-card');
      const parents = new Set([...cards].map(card => card.parentElement));
      for (const parent of parents) {
        const count = parent.children.length;
        if (count < 2 || count > 10 || ![...parent.children].every(child => child.matches('.stat-card,.metric-card,.bda-stat-card,.goalpost-summary-card,.goalpost-metric-card,.mail-top-card,.assistant-stat-card'))) continue;
        parent.dataset.cc785Stats = String(count);
        parent.style.setProperty('--cc785-stat-count', String(count));
      }
    };
    markMetrics();
    const observer = new MutationObserver(markMetrics);
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location.pathname]);
  const normalizedRole = resolveUserRole(user);
  const leadership = ['admin', 'manager', 'tl'].includes(normalizedRole);
  const approvalLockExempt = ['admin', 'manager'].includes(normalizedRole);
  const AUTO_SYSTEM_POPUPS_ENABLED = String(import.meta.env?.VITE_AUTO_SYSTEM_POPUPS || 'false').toLowerCase() === 'true';
  const AUTO_SEMI_HOURLY_POPUPS_ENABLED = String(import.meta.env?.VITE_AUTO_SEMI_HOURLY_POPUPS || 'false').toLowerCase() === 'true';
  const quickAddRef = useRef(null);
  const [chatUnread,setChatUnread]=useState(false);
  useEffect(()=>{document.querySelectorAll('.sidebar-nav a[href="/chat"]').forEach(el=>el.classList.toggle('cc790-unread-nav',chatUnread));},[chatUnread,location.pathname]);
  useEffect(()=>{const receive=e=>{const m=e.detail;if(m&&m.sender_username!==user?.username&&location.pathname!=='/chat')setChatUnread(true);};const read=e=>setChatUnread(Boolean(e.detail?.unread));window.addEventListener('career-crox-chat-message',receive);window.addEventListener('cc790-chat-read',read);return()=>{window.removeEventListener('career-crox-chat-message',receive);window.removeEventListener('cc790-chat-read',read);};},[user?.username,location.pathname]);
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
    let raw = null;
    try { raw = window.sessionStorage.getItem(SIDEBAR_SCROLL_KEY); } catch {}
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
    const fresh = String(location.pathname || '').replace(/\/+$/, '') === '/candidate/new';
    let stored = 0;
    try {
      if (fresh) window.sessionStorage.removeItem(key);
      else stored = Number(window.sessionStorage.getItem(key) || 0);
    } catch {}
    const target = Number.isFinite(stored) && stored > 0 ? stored : 0;
    let restoring = target > 0;
    let lastTop = target;
    let resizeObserver;
    let mutationObserver;
    const persist = () => { try { window.sessionStorage.setItem(key, String(lastTop)); } catch {} };
    const stopRestore = () => {
      restoring = false;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
    const save = () => { if (!restoring) { lastTop = el.scrollTop || 0; persist(); } };
    const userIntent = (event) => {
      if (event.type === 'keydown' && !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
      stopRestore();
      save();
    };
    const apply = () => {
      if (!restoring) return;
      el.scrollTop = Math.min(target, Math.max(0, el.scrollHeight - el.clientHeight));
      if (Math.abs(el.scrollTop - target) <= 1) { stopRestore(); lastTop = el.scrollTop; }
    };
    // One React-owned reset. The user's first scroll always wins over hydration.
    // Retain the outgoing page's last scroll event, not its already-replaced DOM height.
    el.style.overflowAnchor = 'none';
    el.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch {}
    if (restoring) {
      resizeObserver = new ResizeObserver(apply);
      const observeChildren = () => { for (const child of el.children) resizeObserver.observe(child); apply(); };
      mutationObserver = new MutationObserver(observeChildren);
      mutationObserver.observe(el, { childList: true });
      observeChildren();
    }
    el.addEventListener('scroll', save, { passive: true });
    for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.addEventListener(name, userIntent, { passive: true });
    window.addEventListener('beforeunload', persist);
    const timer = window.setTimeout(() => { stopRestore(); el.style.removeProperty('overflow-anchor'); }, 4000);
    return () => {
      persist();
      stopRestore();
      window.clearTimeout(timer);
      el.removeEventListener('scroll', save);
      for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.removeEventListener(name, userIntent);
      window.removeEventListener('beforeunload', persist);
      el.style.removeProperty('overflow-anchor');
    };
  }, [location.pathname, location.search]);

  function playTaskReminderSound(kind = 'soft', forcedTuneId = '', eventKey = '') {
    playNotificationSound(forcedTuneId,kind === 'preview',eventKey).catch(() => {});
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
        if(item.type === 'unlock') return false; // Top-bar presenter only.
        if(pendingApprovalKeysRef.current.has(item.type+':'+item.id))return false;
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
    if (!AUTO_SYSTEM_POPUPS_ENABLED || !user?.user_id || !hasJoinedThisLogin()) {
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
    const sequence=++attendanceReadSequence.current;
    try {
      const data = await api.get('/api/attendance?compact=1', {
        cacheTtlMs: 0,
        timeoutMs: 8000,
        retries:0,
        background: false,
        allowStale: false,
      });
      if(sequence!==attendanceReadSequence.current)return data;
      const gateStamp=Math.max(...['locked_at','break_started_at','updated_at','last_seen_at'].map(k=>Date.parse(data?.presence?.[k]||'')||0));
      if(String(data?.presence?.locked||'0')==='1'&&gateStamp<attendanceUnlockedAt.current)return data;
      setAttendanceGate(data);
      // The server owns today's join timestamp. Refresh restores it without a second JOIN POST.
      const claimedJoined = data?.today_stats?.joined_today === true;
      let confirmed = claimedJoined && data?.today_stats?.manual_join_confirmed === '1' && window.__CC723_OFFICE_RESTORE__?.(data) === true;
      // A verified server receipt is enough even when the legacy restore hook is not mounted yet.
      if (!confirmed && claimedJoined && data?.today_stats?.manual_join_confirmed === '1') {
        const joinedAt = String(data?.today_stats?.manual_confirmed_at || data?.today_stats?.joined_at || '').trim();
        if (joinedAt && istDay(joinedAt) === istDay()) {
          rememberOfficeJoin(joinedAt);
          confirmed = hasJoinedThisLogin();
        }
      }
      if (!claimedJoined) window.__CC722_OFFICE_SERVER_UNJOINED__?.();
      setShowJoinOffice(String(data?.presence?.locked||'0')!=='1'&&!confirmed&&!hasJoinedThisLogin());
      return data;
    } catch {
      if(sequence!==attendanceReadSequence.current)return null;
      // Never silently hide Join Office if the first attendance GET times out.
      // No polling: the employee can click Join Office or manually refresh attendance.
      setShowJoinOffice(!hasJoinedThisLogin());
      return null;
    }
  }

  useEffect(() => {
    const hydrate = e => {const p=e.detail?.presence;const stamp=p?Math.max(...['locked_at','break_started_at','updated_at','last_seen_at'].map(k=>Date.parse(p[k]||'')||0)):0;if(p&&!window.__CC602_NETWORK_PAUSED__&&!(String(p.locked)==='1'&&stamp<attendanceUnlockedAt.current))setAttendanceGate(e.detail);};
    window.addEventListener('career-crox-attendance-live',hydrate);
    return () => window.removeEventListener('career-crox-attendance-live',hydrate);
  }, []);

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
      const stamp=Math.max(...['locked_at','break_started_at','updated_at','last_seen_at'].map(k=>Date.parse(data?.presence?.[k]||'')||0));
      if(String(data?.presence?.locked||'0')==='1'&&stamp<attendanceUnlockedAt.current)return;
      if (data?.presence || data?.today_stats) setAttendanceGate(data);
    } catch {}
  }


  // Local countdown only while a break is active; no additional polling or egress.
  useEffect(() => {
    if (approvalLockExempt || (String(attendanceGate?.presence?.is_on_break || '0') !== '1' && String(attendanceGate?.presence?.lock_reason || '') !== 'break_exceeded')) return undefined;
    const id = window.setInterval(() => setBreakCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [attendanceGate?.presence?.is_on_break, attendanceGate?.presence?.lock_reason, approvalLockExempt]);
  // Approval is published after COMMIT; update this user's visible gate even when the lock modal is mounted.
  useEffect(()=>{const handle=event=>{const data=event.detail||{};if(String(data.status).toLowerCase()!=='approved'||String(data.requester_user_id)!==String(user?.user_id)||window.__CC602_NETWORK_PAUSED__)return;const key=[data.id,data.status,data.unlocked_at,data.review_only].join(':');if(lastUnlockEvent.current===key)return;lastUnlockEvent.current=key;if(!data.review_only){window.__CC840_RESUME_APPROVED__?.(data);attendanceUnlockedAt.current=Date.parse(data.unlocked_at||'')||Date.now();attendanceReadSequence.current++;setAttendanceGate(current=>({...current,presence:{...current?.presence,locked:'0',lock_reason:'',lock_message:'',locked_at:''}}));}refreshAttendanceGate(true).catch(()=>{});};let source=null,retry=null,tries=0;const pushed=event=>{try{handle({detail:JSON.parse(event.data||'{}')});}catch{}};const connect=()=>{if(window.__CC602_NETWORK_PAUSED__)return;if(typeof window.__CC819_WORKSPACE_SOURCE__!=='function'){if(tries++<25)retry=setTimeout(connect,80);return;}source=window.__CC819_WORKSPACE_SOURCE__('/api/approvals/stream');source.addEventListener('unlock-resolved',pushed);};connect();window.addEventListener('career-crox-unlock-resolved',handle);window.addEventListener('cc609:unlock-resolved',handle);return()=>{clearTimeout(retry);source?.removeEventListener('unlock-resolved',pushed);source?.close();window.removeEventListener('career-crox-unlock-resolved',handle);window.removeEventListener('cc609:unlock-resolved',handle);};},[user?.user_id]);
  // Break expiry can lock access, but only the employee's End Break action closes the break.
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
  useEffect(() => { setShowAddMenu(false); setManualDialerOpen(false); }, [location.pathname]);

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
  usePolling(loadGlobalSubmissionReminderPopup, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy || showJoinOffice || !hasJoinedThisLogin()) ? 0 : POPUP_POLL_MS, [user?.user_id, location.pathname, writeBusy, showJoinOffice]);
  usePolling(loadDailyWorkflowPopup, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : POPUP_POLL_MS, [user?.user_id, canShowInterruptPopup, location.pathname, isFocusRoute, writeBusy]);
  usePolling(loadSemiHourlyPopup, (AUTO_SYSTEM_POPUPS_ENABLED && AUTO_SEMI_HOURLY_POPUPS_ENABLED) ? POPUP_POLL_MS : 0, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(pingPresence, writeBusy ? 0 : PRESENCE_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);
  usePolling(refreshAttendanceGate, (!AUTO_SYSTEM_POPUPS_ENABLED || writeBusy) ? 0 : ATTENDANCE_GATE_POLL_MS, [user?.user_id, location.pathname, isFocusRoute, writeBusy]);

  useEffect(() => {
    if (!user?.user_id) return;
    // CC26_451: login -> Join Office once -> timer/attendance/presence begin.
    // The same login marker survives route changes and refreshes, so the gate does not repeat.
    // Draw the Join Office gate immediately; the one server check can dismiss it
    // if this login already has a verified manual-join receipt.
    setShowJoinOffice(!hasJoinedThisLogin());
    refreshAttendanceGate(true);
  }, [user?.user_id]); // CC815_JOIN_GATE_IMMEDIATE_NO_POLL

  useEffect(() => {
    if (!taskPopup) {
      hadVisibleTaskPopupRef.current = false;
      return undefined;
    }
    if (!hadVisibleTaskPopupRef.current) {
      hadVisibleTaskPopupRef.current = true;
      playTaskReminderSound('popup', '', `task:${taskPopup.task_id}:${taskPopup.due_at || taskPopup.due_date || ''}`);
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
      playTaskReminderSound('soft', '', `approval:${key}`);
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
      playTaskReminderSound('popup', '', `followup:${key}:${followUpPopup.follow_up_at || ''}`);
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
      playTaskReminderSound('soft', '', `workflow:${key}`);
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
      playTaskReminderSound('soft', '', `report:${key}`);
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
      { key: 'securelink', label: 'SecureLink', href: '/securelink' },
      { key: 'hot-leads', label: 'Hot Leads', href: '/hot-leads' },
      { key: 'submissions', label: 'Submissions', href: '/submissions' },
      { key: 'interviews', label: 'Interviews', href: '/interviews' },
      { key: 'followups', label: 'FollowUps', href: '/followups' },
      { key: 'tasks', label: 'Tasks', href: '/tasks' },
      { key: 'flowchart', label: 'Flowchart', href: '/flowchart' },
      { key: 'live-dialing', label: 'Call Assistant', href: '/live-dialing' },
      { key: 'bucket', label: 'Bucket', href: '/bucket-out' },
      { key: 'client-pipeline', label: 'Client Pipeline', href: '/client-pipeline' },
      { key: 'data-extractor', label: 'Data Extractor', href: '/data-extractor' },
      { key: 'quality-analyst', label: 'Quality Analyst', href: '/quality-analyst' },
      { key: 'hr-head', label: 'HR Head', href: '/hr-head' },
      { key: 'revenue-hub', label: 'Pipeline Hub', href: '/revenue-hub' },
      { key: 'bda', label: 'BDA', href: '/bda' },
      { key: 'duplicate-profiles', label: 'Duplicate Profiles', href: '/duplicate-profiles' },
      { key: 'goal-post', label: 'Goal Post', href: '/goal-post' },
      { key: 'reports', label: 'Reports Hub', href: '/reports' },
      { key: 'mail-centre', label: 'Mail Centre', href: '/mail-centre' },
      { key: 'jd-centre', label: 'JD Centre', href: '/jds' },
      { key: 'learning-hub', label: 'YT Hub', href: '/learning-hub' },
      { key: 'admin-control', label: 'Admin Control', href: '/admin' },
      { key: 'data-backup', label: 'CRM Transfer', href: '/data-backup' },
      { key: 'settings', label: 'Settings', href: '/settings' },
    ];
    return items.filter((item) => canAccessFeature(normalizedRole, item.key));
  }, [normalizedRole]);

  const navStorageKey = `careerCroxSidebarOrder:cc837:${normalizedRole || 'guest'}`;
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
    if(navOrder.length)return ordered.filter(x=>x.key!=='securelink'&&x.key!=='settings').concat(ordered.filter(x=>x.key==='settings'),ordered.filter(x=>x.key==='securelink'));
    const first=['candidates','submissions','interviews','live-dialing','revenue-hub','bucket'];
    return first.map(key=>ordered.find(x=>x.key===key)).filter(Boolean).concat(ordered.filter(x=>!first.includes(x.key)&&!['settings','securelink'].includes(x.key)),ordered.filter(x=>x.key==='settings'),ordered.filter(x=>x.key==='securelink'));
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
    const markHumanActivity = (event) => {
      if(event?.isTrusted===false || window.__CC602_NETWORK_PAUSED__)return;
      lastHumanActivityAtRef.current = Date.now();
      humanActivitySincePingRef.current = true;
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'click', 'wheel', 'scroll']; // CC26_455: cursor movement alone is not meaningful work
    events.forEach((name) => window.addEventListener(name, markHumanActivity, { passive: true }));
    return () => events.forEach((name) => window.removeEventListener(name, markHumanActivity));
  }, [user?.user_id]);

  async function openLogoutSummaryOrLogout() {
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
        const revenueCheck = await api.get('/api/revenue-hub/logout-check', { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 });
        if (revenueCheck?.blocked) {
          setToast({ title: 'Pipeline Hub update required', message: `${revenueCheck.count} interview items still need status update before logout.`, item: null });
          window.open('/revenue-hub','_blank','noopener,noreferrer');
          return;
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
    const target=notificationTarget(item);if(target)window.open(target,'_blank','noopener,noreferrer');
    dismissToast();void api.post(`/api/notifications/${item.notification_id}/read`,{}).catch(()=>{});
  }

  const selectedKey=item=>item.type+':'+item.id;
  async function resolveApprovalFromPopup(action) {
    if (!approvalPopup || savingApproval || (action==='reject' && !rejectReason.trim())) return;
    const selected={...approvalPopup},note=rejectReason.trim(),key=selectedKey(approvalPopup);
    if(pendingApprovalKeysRef.current.has(key))return;
    pendingApprovalKeysRef.current.add(key);
    setSavingApproval(true);setApprovalPopup(null);setRejectReason('');
    setToast({title:action==='approve'?'Approval queued':'Rejection queued',message:'Saving your decision. You can keep working.'});
    try {
      const result=await api.post('/api/approvals/'+action,{type:selected.type,id:selected.id,...(action==='reject'?{reason:note}:{})},{detachedWrite:true});
      if(result?.ok!==true)throw new Error('Decision was not confirmed. Please retry.');
      setToast({title:action==='approve'?'Approved':'Rejected',message:selected.title||'Decision saved'});
      loadMeta().catch(()=>{});
    } catch(error) {
      setApprovalPopup(selected);setRejectReason(note);
      setToast({title:'Decision not saved',message:error.message||'Please retry this decision.'});
    } finally {pendingApprovalKeysRef.current.delete(key);setSavingApproval(false);}
  }
  function approveFromPopup(){return resolveApprovalFromPopup('approve');}
  function rejectFromPopup(){return resolveApprovalFromPopup('reject');}

  function snoozeApprovalPopup(minutes = 15) {
    if (!approvalPopup) return;
    try { localStorage.setItem(`approval_snooze_${approvalPopup.id}`, String(Date.now() + Number(minutes || 0) * 60 * 1000)); } catch {}
    setApprovalPopup(null);
    setRejectReason('');
    setApprovalReminderForm({ exact_time: '' });
  }

  function saveApprovalExactTime() {
    if (!approvalPopup || !approvalReminderForm.exact_time) return;
    const at = parseDateInput(approvalReminderForm.exact_time)?.getTime();
    if (!Number.isFinite(at) || at <= Date.now()) {
      setToast({ title: 'Choose a future time', message: 'Approval reminder time must be later than the current time.', item: null, category: 'general' });

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
    <div id="cc838-shell" className={`app-shell ${mobileNavOpen ? 'cc783-nav-open' : ''}`}><MultipleCrmGate/><ExcelBackupReminderGate/>
      {mobileNavOpen ? <button type="button" className="cc783-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}/> : null}
      {showJoinOffice && !hasJoinedThisLogin() && String(attendanceGate?.presence?.locked||'0')!=='1' && <div className="crm-modal-backdrop cc724-office-overlay" style={{ zIndex: 100004 }}>
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
            <img className="sidebar-brand-full-logo" src="/assets/img/career-crox-logo.svg?v=CC821_VECTOR_BRAND" alt="Career Crox" />
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
              item.key === 'securelink' ? <a key={item.href} className="nav-item bounceable cc-securelink-slice" href="/securelink" aria-label="SecureLink — Remote Support" title="SecureLink — Remote Support"><span className="nav-serial">{pad2(index + 1)}</span><span className="cc837-securelink-label"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2 21 6v6c0 5-9 10-9 10S3 17 3 12V6Z M8 12l3 3 5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>SecureLink</span></a> : <NavLink
                key={item.href}
                to={item.href}
                draggable
                onPointerDown={rememberSidebarScroll}
                onClick={() => setMobileNavOpen(false)}
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

      </aside>
      <main className="main-wrap">
        <header className="topbar" data-cc886-header="true">
          <button type="button" className="cc783-mobile-nav-toggle" aria-label="Open navigation" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((v) => !v)}>☰</button>
          <div className="topbar-left"><div className="topbar-title topbar-brand-title"><img className="topbar-logo" src="/assets/img/career-crox-brand-icon.png" alt="Career Crox" /><span>{title}</span></div><DashboardSwitcher/></div>
          <div className="topbar-center"><HeaderSearch /></div>
          <div className="cc781-header-session">
            <div className="user-chip glassy-card user-chip-menu" title={`${user?.full_name || ''} ${user?.designation || ''}`.trim()}>
              <div className="user-chip-copy">
                <div className="user-name" title={user?.full_name || user?.username || ''}>{user?.full_name || user?.username || 'Team member'}</div>
                <div className="user-role" title={user?.designation || user?.role || ''}>{user?.designation || ({tl:'Team Leader',manager:'Manager',recruiter:'Recruiter',admin:'Admin'})[normalizedRole] || 'Team member'}</div>
              </div>
              <div className="user-chip-actions"><button className="mini-btn edit bounceable logout-mini" type="button" onClick={onLogout}>Logout</button></div>
            </div>
          </div>
          <div className="topbar-right"><PopupMinimizeControl/>
            <button ref={quickPairButtonRef} type="button" className="cc813-pair-shortcut cc815-gloss-pair-button" onClick={showQuickPair} title="Pair Call Assistant">▦ Pair Phone</button>
            {quickPair && <div ref={quickPairRef} role="dialog" aria-label="Connect your phone" className="cc813-pair-popup cc815-premium-pair-popup">
              <button className="cc815-pair-close" type="button" aria-label="Close pair code" onClick={closeQuickPair}>×</button>
              <span className="cc815-pair-eyebrow">CAREER CROX • SECURE CONNECTION</span>
              <strong>Connect your phone</strong>
              {quickPair.pairing_code ? <b className="cc815-pair-code">{quickPair.pairing_code}</b> : <b className="cc815-pair-code-error">Try again</b>}
              <span className="cc815-pair-status" role="status">{quickPair.error || (quickPair.loading ? 'Verifying code with CRM… wait before entering.' : '✓ Code ready. Enter it in Career Crox Call Assistant.')}</span>
              {quickPair.error && <button type="button" className="cc815-pair-retry" onClick={showQuickPair}>Generate new code ↻</button>}
              <small>Tap anywhere outside this box to close.</small>
            </div>}
            {blockedProfile&&<button type="button" className="cc813-popup-fallback" onClick={()=>{if(openDialerProfile(blockedProfile.row,blockedProfile.requestId,true))setBlockedProfile(null);}}>Open {blockedProfile.row?.full_name||'calling profile'} ↗</button>}
            <button className="manual-dialer-top-icon bounceable" type="button" onClick={() => { setManualDialerOpen(true); setManualDialerMessage(''); }} title="Manual Dialer" aria-label="Manual Dialer"><span className="manual-dialer-symbol manual-dialer-symbol-gold" aria-hidden="true"><ActionGlyph/></span><span className="manual-dialer-text sr-only">Manual Dialer</span></button>
            <button type="button" className="cc844-new-candidate" aria-label="Add new candidate" title="New candidate" onClick={() => navigate(freshCandidateUrl())}>+</button>
            <div className="top-action-wrap" ref={quickAddRef}>
              <button className="add-profile-btn bounceable" type="button" onClick={() => setShowAddMenu((s) => !s)}>Quick Action</button>
              {showAddMenu && <div className="add-menu show glassy-card professional-add-menu"><Link onClick={() => setShowAddMenu(false)} to={freshCandidateUrl()}>Add Candidate</Link><button className="cc-distance-menu-item cc-distance-menu-item-green" type="button" title="Distance Tracker" onClick={() => { setShowAddMenu(false); window.dispatchEvent(new CustomEvent('career-crox-open-distance-tracker')); }}>Distance Tracker</button><Link onClick={() => setShowAddMenu(false)} to="/tasks?create=1">Add Task</Link><Link onClick={() => setShowAddMenu(false)} to="/candidates?add-note=1">Add Note</Link>{leadership && <Link onClick={() => setShowAddMenu(false)} to="/jds?create=1">Add JD</Link>}<Link onClick={() => setShowAddMenu(false)} to="/interviews?create=1">Add Interview</Link><Link onClick={() => setShowAddMenu(false)} to="/submissions">Open Submissions</Link>{canAccessFeature(normalizedRole, 'attendance') && <Link onClick={() => setShowAddMenu(false)} to="/attendance">Attendance & Break Time</Link>}{canAccessFeature(normalizedRole, 'bda') && <Link onClick={() => setShowAddMenu(false)} to="/bda">Open BDA</Link>}{canAccessFeature(normalizedRole, 'learning-hub') && <Link onClick={() => setShowAddMenu(false)} to="/learning-hub">YT Hub</Link>}</div>}
            </div>
            {leadership && <Link className="top-pill bounceable" data-pill="approvals" to="/approvals">Approvals <span className="pill-count">{approvals}</span></Link>}
            <Link className="top-pill bounceable" data-pill="notifications" to="/notifications">Notifications <span className="pill-count">{notifications}</span></Link>
            <Link className="top-pill bounceable break-top-pill" data-pill="break" to="/attendance" title="Break Timer & Attendance">⏱ Break</Link>
            <Link className="top-pill bounceable" data-pill="team-chat" to="/chat">Team Chat</Link>
            <Link className="top-pill bounceable" data-pill="aaria" to="/aaria">Aaria</Link>

          </div>
        </header>
        {manualDialerOpen && <div className="crm-modal-backdrop" style={{ zIndex: 100000 }}>
          <div className="crm-premium-modal cc787-dialer-modal" style={{ maxWidth: 460 }}>
            <div className="cc791-dialog-hero"><span className="cc791-dialog-symbol"><ActionGlyph size={27}/></span><div><small>MOBILE CONNECT</small><h2 className="panel-title">Manual Mobile Dialer</h2></div></div>
            <div className="helper-text top-gap-small">Paste a number to start the call through your paired mobile app.</div>
            <div className="field top-gap"><label htmlFor="cc791-dial-phone">Phone Number</label><div className="cc791-dial-input"><span>+91</span><input id="cc791-dial-phone" type="tel" inputMode="tel" value={manualDialerPhone} onChange={(e) => setManualDialerPhone(e.target.value)} placeholder="Paste 10 digit number" autoFocus /></div></div>
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
        {toast && <aside data-reminder-kind={reminderKind(toast)} role="status" aria-live="polite" className={`mini-toast cc835-notice ${toastClosing?'cc835-notice-out':''} toast-${String(toast.item?.category || toast.category || 'general').toLowerCase()}`}><button type="button" className="cc835-notice-open" onClick={() => { if (toast.href) { window.open(toast.href, '_blank', 'noopener,noreferrer'); dismissToast(); } else if (toast.item) { openNotification(toast.item); } else { dismissToast(); } }}><div className="mini-toast-title">{toast.title}</div><div className="mini-toast-body">{toast.message}</div></button><button type="button" className="cc835-notice-close" aria-label="Dismiss notification" title="Dismiss notification" onClick={dismissToast}>×</button></aside>}
        {approvalPopup && <div className="cc841-approval-center" style={{ position: 'fixed', right: 14, bottom: 14, width: 'min(390px, calc(100vw - 28px))', maxHeight: 'calc(100dvh - 28px)', zIndex: 60 }}>
          <div data-reminder-kind="approval" className="panel approval-popup-panel cc604-approval-popup" role="dialog" aria-label="Approval request" style={{ maxWidth: 'min(390px, calc(100vw - 28px))' }}>
            <div className="cc604-approval-eyebrow">ACTION REQUIRED</div><div className="panel-title">{approvalPopup.manager_review?'TL Self-unlock Review':approvalPopup.type === 'youtube' ? 'YouTube Access Approval' : approvalPopup.type === 'unlock' ? 'Employee Unlock Approval' : 'Pending Submission Approval'}</div>
            <div className="helper-text">{approvalPopup.type === 'unlock' ? `${approvalPopup.title}${approvalPopup.process ? ` • ${approvalPopup.process}` : ''}` : `${approvalPopup.title} • ${approvalPopup.recruiter_name || '-'} • ${approvalPopup.process || '-'}`}</div>
            <div className="helper-text top-gap-small">{approvalPopup.manager_review?'This TL resumed work. Approve the review or flag and suspend the session.':approvalPopup.type === 'unlock' ? 'Employee CRM is locked. Approve to restore access immediately.' : 'Approve here or jump to the Approval Center.'}</div>
            <div className="row-actions top-gap">
              {approvalPopup.type === 'candidate' && <button className="mini-btn view bounceable highlight-choice highlight-strong" type="button" onClick={openProfileNewTab}>Open Profile</button>}
              {['manager','admin'].includes(normalizedRole)&&approvalPopup.type==='unlock'&&(approvalPopup.manager_review||String(approvalPopup.title||'').includes('self-unlocked'))&&<button type="button" className="cc837-danger-action" disabled={savingApproval} onClick={async()=>{const reason=window.prompt('Why are you flagging this self-unlock?');if(!reason?.trim())return;setSavingApproval(true);try{await api.post('/api/approvals/reject',{type:'unlock',id:approvalPopup.id,reason:reason.trim(),flag_session:true});setApprovalPopup(null);}catch(e){window.alert(e.message);}finally{setSavingApproval(false)}}}>Flag & suspend session</button>}
              <button className="mini-btn call bounceable highlight-choice highlight-strong" type="button" disabled={savingApproval} onClick={approveFromPopup}>{approvalPopup.manager_review?'Approve Review':approvalPopup.type === 'youtube' ? 'Approve Access' : approvalPopup.type === 'unlock' ? 'Approve Unlock' : 'Approve'}</button>
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
              <div className="field field-span-2"><label>Set Exact Time</label><CrmDateTimeInput className="inline-input" type="datetime-local" value={approvalReminderForm.exact_time} onChange={(e) => setApprovalReminderForm({ exact_time: e.target.value })} /></div>
            </div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" onClick={saveApprovalExactTime} disabled={!approvalReminderForm.exact_time}>Save Time</button>
            </div>
            <div className="field top-gap-small"><label>Reject Note (required for reject)</label><textarea rows="3" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason is added to the profile audit trail."></textarea></div>
          </div>
        </div>}
        {AUTO_SYSTEM_POPUPS_ENABLED && AUTO_SEMI_HOURLY_POPUPS_ENABLED && semiHourlyPopup && <div className="revenue-reminder-wrap" style={{ bottom: revenuePopup ? 232 : 24 }}>
          <div data-reminder-kind="report" className="panel approval-popup-panel revenue-reminder-popup glassy-card popup-info popup-dock-right" role="button" tabIndex={0} title="Open 30-minute report in a new tab" onClick={openSemiHourlyReport} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openSemiHourlyReport(); } }}>
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
          <div data-reminder-kind={reminderKind(revenuePopup, 'revenue')} className="panel approval-popup-panel revenue-reminder-popup glassy-card popup-info popup-dock-left">
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
          <div data-reminder-kind={reminderKind(dailyWorkflowPopup, 'interview')} className="panel approval-popup-panel daily-workflow-popup glassy-card popup-info popup-dock-left">
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
        {hasJoinedThisLogin() && globalSubmissionReminderPopup && <div className="global-submission-reminder-wrap cc-global-source-wrap">
          <div data-reminder-kind="submission" className="panel approval-popup-panel global-submission-reminder-card cc-global-source-card">
            <div className="task-reminder-head cc-global-source-head">
              <div className="cc-global-source-titlebox">
                <div className="panel-title">Submission Reminder</div>
                <div className="helper-text cc-global-source-subtitle">{globalSubmissionReminderPopup.full_name || '-'} • {globalSubmissionReminderPopup.recruiter_name || 'Team member'}</div>
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
          <div data-reminder-kind="followup" className="panel approval-popup-panel task-reminder-popup glassy-card popup-warning popup-dock-left">
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
              {String(followUpPopup.follow_up_note || followUpPopup.followup_note || followUpPopup.callback_note || '').trim() ? <div className="task-reminder-note-card top-gap-small"><strong>Follow-up note:</strong> {followUpPopup.follow_up_note || followUpPopup.followup_note || followUpPopup.callback_note}</div> : null}
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
        {taskChangeToast ? <aside data-reminder-kind="task" className="cc808-task-toast" role="status" aria-live="polite">
          <span className="cc808-task-toast-icon">✓</span><div><small>{taskChangeToast.kind==='assigned'?'NEW TASK':'TASK UPDATED'}</small><strong>{taskChangeToast.task.title||'Task'}</strong><span>{taskChangeToast.task.status||'Open'} · {taskChangeToast.task.priority||'Normal'}</span></div>
          <button type="button" onClick={()=>{window.open('/tasks?task_id='+encodeURIComponent(taskChangeToast.task.task_id),'_blank','noopener,noreferrer');setTaskChangeToast(null);}}>View task ↗</button><button type="button" aria-label="Close task notification" onClick={()=>setTaskChangeToast(null)}>×</button>
        </aside> : null}
        {canRenderTaskPopup && taskPopup && <div className={`task-reminder-wrap ${taskPopupAnimatingOut ? 'is-leaving' : 'is-entering'}`}>
          <div data-reminder-kind="task" className="panel approval-popup-panel task-reminder-popup task-popup-dock-left glassy-card popup-warning popup-dock-left" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={(e) => openTaskFromPopup(e)} onKeyDown={(e) => {
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
              {String(taskPopup.task_note || taskPopup.description || taskPopup.notes || '').trim() ? <div className="task-reminder-note-card top-gap-small"><strong>Task note:</strong> {taskPopup.task_note || taskPopup.description || taskPopup.notes}</div> : null}
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
          const approvalLocked = locked && String(presence?.lock_reason || '') !== 'break';
          const endAt = presence?.break_expected_end_at ? new Date(presence.break_expected_end_at).getTime() : 0;
          const diff = endAt ? endAt - breakCountdownNow : 0;
          const abs = Math.abs(diff);
          const hrs = String(Math.floor(abs / 3600000)).padStart(2, '0');
          const mins = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
          const secs = String(Math.floor((abs % 60000) / 1000)).padStart(2, '0');
          const timerText = `${hrs}:${mins}:${secs}`;
          const overdue = onBreak && endAt && diff < 0;
          if (approvalLockExempt || !locked) return null;
          if(onBreak&&!overdue&&!approvalLocked&&location.pathname==='/learning-hub')return null;
          if (onBreak && !approvalLocked && overdue) {
            return <LockedRequestModal role={normalizedRole} managerSuspended={presence?.lock_reason==='manager_flag'} reasonDefault={presence?.lock_message || 'Break time exceeded'} refreshAttendanceGate={refreshAttendanceGate} navigate={navigate} breakExpiryAt={endAt} overrunText="00:00:00" />;
          }
          if (onBreak && !approvalLocked) {
            const breakMeter = breakMeterSnapshot(presence || {});
            return <div className="crm-modal-backdrop crm-lock-backdrop"><div className={`crm-premium-modal crm-lock-modal ${overdue ? 'break-overdue-modal' : ''}`}><div className="lock-premium-chip">{overdue ? 'Break Exceeded' : 'Break Mode'}</div><div className="panel-title">{overdue ? 'Break Time Exceeded' : 'Break In Progress'}</div><div className="helper-text top-gap-small">{overdue ? 'Break time expired. Request for Access and wait for manager approval.' : 'Join Office opens your workspace. Your break keeps running until you choose End Break.'}</div><div className={`lock-overlay-timer ${overdue ? 'overdue-blink' : diff <= 60000 ? 'cc555-break-warning' : ''}`}>{overdue ? `-${timerText}` : timerText}</div><div className={`premium-break-lock-meter ${breakMeter.level}`}><div className="premium-break-lock-track"><div className="premium-break-lock-fill" style={{ width: `${Math.min(100, breakMeter.percent)}%` }} /></div><div className="helper-text top-gap-small">Break used: {breakMeter.percent}% {breakMeter.level === 'exceeded' ? `• Lock in ${breakMeter.leftText}` : ''}</div></div><div className="helper-text top-gap-small">{presence?.break_reason || 'Break'} {overdue ? 'over time' : 'running'}</div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={async () => { try { const data = await api.post('/api/attendance/join', { compact: true, manual_confirmed:true, join_source:'user_button', last_page:location.pathname }, { timeoutMs: 20000 }); setAttendanceGate(data || null); window.__CC723_OFFICE_RESTORE__?.(data,true); setShowJoinOffice(false); } catch(error) { setToast({title:'Join Office',message:error.message}); } }}>Join Office</button><button className="ghost-btn" type="button" onClick={async()=>{try{const data=await api.post('/api/attendance/end-break',{compact:true});setAttendanceGate(data);setShowJoinOffice(false);}catch(error){setToast({title:'End Break',message:error.message});}}}>End Break</button>{!overdue?<button className="ghost-btn" onClick={()=>navigate('/learning-hub')}>YouTube access</button>:null}</div></div></div>;
          }
          return <LockedRequestModal role={normalizedRole} managerSuspended={presence?.lock_reason==='manager_flag'} reasonDefault={presence?.lock_message || presence?.break_reason || 'Please contact your reporting lead and request CRM unlock approval.'} refreshAttendanceGate={refreshAttendanceGate} navigate={navigate} breakExpiryAt={String(presence?.lock_reason || '') === 'break_exceeded' && endAt && diff <= 0 ? endAt : 0} overrunText={String(presence?.lock_reason || '') === 'break_exceeded' && endAt && diff <= 0 ? '00:00:00' : ''} />;
        })()}
        {goalPostLogoutChoice && <div className="crm-modal-backdrop" style={{ zIndex: 100002 }} onClick={() => setGoalPostLogoutChoice(null)}><div className="crm-premium-modal goalpost-logout-choice-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}><div className="premium-modal-kicker">Logout Choice</div><div className="panel-title">Goal Post Update Pending</div><div className="helper-text top-gap-small">Goal Post is still pending for this session. Update now or continue logout.</div><div className="premium-modal-points"><div className="premium-modal-point">Your existing Goal Post data stays untouched.</div><div className="premium-modal-point">The reminder returns next session until updated.</div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={() => { const nextPage = goalPostLogoutChoice?.page || '/goal-post'; setGoalPostLogoutChoice(null); navigate(nextPage); }}>Update Goal Post</button><button className="mini-btn edit bounceable danger-choice" type="button" onClick={logoutWithoutGoalPostUpdate}>Logout Without Update</button><button className="ghost-btn bounceable" type="button" onClick={() => setGoalPostLogoutChoice(null)}>Cancel</button></div></div></div>}
        {goalPostReminderPopup && <div style={{ position: 'fixed', right: 22, bottom: 24, width: 360, zIndex: 60 }}>
          <div data-reminder-kind="report" className="panel approval-popup-panel goalpost-reminder-panel goalpost-logout-choice-modal" style={{ boxShadow: '0 28px 70px rgba(15,23,42,0.24)', maxWidth: '380px' }}>
            <div className="premium-modal-kicker">Goal Post</div><div className="panel-title">{goalPostReminderPopup.title}</div>
            <div className="helper-text">{goalPostReminderPopup.message}</div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" onClick={() => { setGoalPostReminderPopup(null); window.open('/goal-post','_blank','noopener,noreferrer'); }}>Open Goal Post</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => setGoalPostReminderPopup(null)}>Dismiss</button>
            </div>
          </div>
        </div>}
        {showLogoutSummary && <div className="crm-modal-backdrop" onClick={() => !sendingReport && setShowLogoutSummary(false)}><div className="crm-premium-modal logout-report-modal premium-attendance-report-modal cc353-table-attendance-report-modal" onClick={(e) => e.stopPropagation()}><div className="premium-modal-kicker">Daily Attendance Report</div><div className="panel-title">Session Summary</div><div className="helper-text top-gap-small">Review your day before logout. The report moves to leadership approval.</div><div className="daily-attendance-report-table-wrap"><table className="daily-attendance-report-table"><thead><tr><th>Metric</th><th>Actual / Target</th><th>Status</th></tr></thead><tbody><tr><td>Work Time</td><td>{formatMinutes(logoutSummary?.productive_work_minutes)} / {formatMinutes(logoutWorkTarget)}</td><td><span className={(Number(logoutSummary?.productive_work_minutes || 0) >= logoutWorkTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.productive_work_minutes || 0) >= logoutWorkTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Idle Time</td><td>{formatMinutes(logoutSummary?.idle_minutes)}</td><td><span className={Number(logoutSummary?.idle_minutes || 0) ? 'status-warn' : 'status-good'}>{Number(logoutSummary?.idle_minutes || 0) ? 'Review' : 'Clear'}</span></td></tr><tr><td>Break Time</td><td>{formatMinutes(logoutSummary?.total_break_minutes)}</td><td><span className="status-good">Tracked</span></td></tr><tr><td>Dialed Calls</td><td>{logoutSummary?.outgoing_calls_count || logoutSummary?.dialed_calls_count || 0} / {logoutDialedTarget}</td><td><span className={(Number(logoutSummary?.outgoing_calls_count || logoutSummary?.dialed_calls_count || 0) >= logoutDialedTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.outgoing_calls_count || logoutSummary?.dialed_calls_count || 0) >= logoutDialedTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Connected Calls</td><td>{logoutSummary?.connected_calls_count || 0} / {logoutConnectedTarget}</td><td><span className={(Number(logoutSummary?.connected_calls_count || 0) >= logoutConnectedTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.connected_calls_count || 0) >= logoutConnectedTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Talk Time</td><td>{formatMinutes(logoutSummary?.talktime_minutes)} / {formatMinutes(logoutTalkTarget)}</td><td><span className={(Number(logoutSummary?.talktime_minutes || 0) >= logoutTalkTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.talktime_minutes || 0) >= logoutTalkTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Submissions</td><td>{logoutSummary?.submissions_count || 0} / {logoutSubmissionTarget}</td><td><span className={(Number(logoutSummary?.submissions_count || 0) >= logoutSubmissionTarget) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.submissions_count || 0) >= logoutSubmissionTarget ? 'Clear' : 'Below target'}</span></td></tr><tr><td>Missed Interviews</td><td>{logoutSummary?.missed_interviews_today || 0} / 0</td><td><span className={(Number(logoutSummary?.missed_interviews_today || 0) === 0) ? 'status-good' : 'status-warn'}>{Number(logoutSummary?.missed_interviews_today || 0) === 0 ? 'Clear' : 'Needs action'}</span></td></tr><tr><td>Productivity</td><td>{logoutSummary?.attendance_report?.productivity_status || logoutSummary?.day_status || '-'}</td><td><span className={(logoutSummary?.attendance_report?.productivity_status === 'Up to the mark') ? 'status-good' : 'status-warn'}>Manager review</span></td></tr></tbody></table></div><div className="field top-gap"><label>Employee Notes</label><textarea rows="3" value={logoutReportNotes} onChange={(e) => setLogoutReportNotes(e.target.value)} placeholder="Add context for low calls, missed interviews, meetings, technical issues, or approved delays." /></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={sendingReport} onClick={sendReportAndLogout}>{sendingReport ? 'Sending...' : 'Send Report'}</button><button className="ghost-btn bounceable" type="button" disabled={sendingReport} onClick={() => setShowLogoutSummary(false)}>Back</button></div></div></div>}
        <section className="page-scroll" ref={pageScrollRef}><DashboardViewBanner/><div className="cc785-route-content" data-route-content={location.pathname} key={location.pathname+dashboardScope}>{children}</div></section>
      </main>
    </div>
  );
}

/* CC26_350_SOURCE_LOGOUT_REPORT_HARD_APPLIED */

// CC783: one authenticated shell survives lazy route changes. Page wrappers publish
// metadata and render their content; timers, alerts and the sidebar never remount.
const WorkspaceContext = createContext(null);
function RecoveryLayout({children}){const {logout}=useAuth();return <div className="app-shell cc874-recovery-shell"><main className="app-main"><header className="cc877-backup-topbar"><div className="cc877-backup-brand"><strong>Career Crox · CRM Backup</strong></div><a className="ghost-btn" href="/candidates">Open workspace</a><button className="ghost-btn" onClick={()=>logout()}>Sign out</button></header><MultipleCrmGate/><ExcelBackupReminderGate/><section className="page-scroll">{children}</section></main></div>;}
export function PersistentWorkspaceShell({ children }) {
  const location = useLocation();
  const [meta, setMeta] = useState({ pathname: '', title: '', subtitle: '' });
  const publish = useCallback((next) => setMeta((prev) => prev.pathname === next.pathname && prev.title === next.title && prev.subtitle === next.subtitle ? prev : next), []);
  const context = useMemo(() => ({ pathname: location.pathname, publish }), [location.pathname, publish]);
  const fallbackTitle = location.pathname.startsWith('/candidate/') ? 'Candidate' : ({ '/bda': 'Lead Studio', '/bda-head': 'Lead Studio', '/goal-post': 'Goal Post', '/learning-hub': 'Learning Hub', '/chat': 'Team Chat', '/performance-centre': 'Performance', '/mail-centre': 'Mail Centre' }[location.pathname] || location.pathname.slice(1).split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' '));
  if(location.pathname==='/data-backup')return <WorkspaceContext.Provider value={context}><RecoveryLayout>{children}</RecoveryLayout></WorkspaceContext.Provider>;
  return <WorkspaceContext.Provider value={context}><WorkspaceLayout title={meta.pathname === location.pathname ? meta.title : fallbackTitle} subtitle={meta.pathname === location.pathname ? meta.subtitle : ''}>{children}</WorkspaceLayout></WorkspaceContext.Provider>;
}
export default function Layout({ title, subtitle, children }) {
  const workspace = useContext(WorkspaceContext);
  useLayoutEffect(() => { if (workspace) workspace.publish({ pathname: workspace.pathname, title, subtitle }); }, [workspace, title, subtitle]);
  if(window.location.pathname==='/data-backup'&&!workspace)return <RecoveryLayout>{children}</RecoveryLayout>;
  return workspace ? <>{children}</> : <WorkspaceLayout title={title} subtitle={subtitle}>{children}</WorkspaceLayout>;
}
