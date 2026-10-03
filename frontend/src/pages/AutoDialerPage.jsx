import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { getPollingLeaderSnapshot } from '../lib/tabLeader';
import { getWhatsAppTemplates } from '../lib/templateStore';
import { openWhatsAppWithLog } from '../lib/candidateAccess';
import { navigateSameTab } from '../lib/candidateNav';

const queueKey = 'careerCroxAutoDialerQueue:v1';
const COUNTDOWN_SECONDS = 10;
const fmt = (s = 0) => { const n = Number(s || 0); const m = Math.floor(n / 60); const x = n % 60; return m ? `${m}m ${x}s` : `${x}s`; };
const arr = (x) => Array.isArray(x) ? x : [];
const digits = (v = '') => String(v || '').replace(/\D+/g, '').slice(-10);
const phoneOfRow = (r = {}) => digits(r.phone || r.number || r.mobile || r.candidate_phone || '');
const nameOf = (r = {}) => r.full_name || r.candidate_name || r.name || r.candidate || 'Candidate';
const cidOf = (r = {}) => r.candidate_id || r.id || '-';
const qidOf = (r = {}) => r.queue_item_id || r.current_queue_item_id || '';
const rowKeyOf = (r = {}, i = 0) => `${i + 1}:${qidOf(r) || cidOf(r)}:${phoneOfRow(r) || '-'}`;
const lastNoteOf = (r = {}) => r.last_note || r.notes || r.data_notes || r.follow_up_note || r.feedback || '-';
const processOf = (r = {}) => r.process || r.jd_name || r.jd || r.client_name || '-';
const pick = (r = {}, keys = []) => { for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return '-'; };
const callStatusText = (row = {}) => String(row.status || row.call_status || row.outcome || row.call_quality || '').toLowerCase();
const callDirectionText = (row = {}) => String(row.direction || row.call_type || '').toLowerCase();
const isNegativeCall = (row = {}) => /not\s*connected|not\s*connect|miss|fail|busy|reject|cancel|decline|no answer|unanswered|switched off|invalid|wrong number|employee cut|cut suspect|early cut|short ring|ring window/.test(`${callStatusText(row)} ${callDirectionText(row)}`);
const isMissedCall = (row = {}) => /miss/.test(`${callStatusText(row)} ${callDirectionText(row)}`);
const isIncomingCall = (row = {}) => !isMissedCall(row) && /incoming|inbound/.test(callDirectionText(row));
const isDialedCall = (row = {}) => !isIncomingCall(row) && !isMissedCall(row);
const isConnectedCall = (row = {}) => !isNegativeCall(row) && (/connected|answered|completed|success/.test(callStatusText(row)) || Number(row.talktime_seconds || 0) > 0);
const callTalkSeconds = (row = {}) => isConnectedCall(row) ? Math.max(0, Math.round(Number(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0) || 0)) : 0;
const searchBlob = (r = {}) => Object.values(r || {}).map((v) => String(v || '').toLowerCase()).join(' ');
const openProfile = (id) => id && id !== '-' && navigateSameTab(`/candidate/${encodeURIComponent(id)}`);
const candidateUrl = (id) => `/candidate/${encodeURIComponent(id)}`;
const queueStartId = (payload = {}, items = []) => String(payload.start_candidate_id || payload.current_candidate_id || payload.focus_candidate_id || cidOf(items[0] || '') || '').trim();
const rotateQueueToStart = (items = [], startId = '') => {
  const list = arr(items).filter(Boolean);
  const sid = String(startId || '').trim();
  if (!sid) return list;
  const at = list.findIndex((r) => String(cidOf(r)) === sid);
  return at > 0 ? [...list.slice(at), ...list.slice(0, at)] : list;
};
const queueSignatureOf = (items = []) => arr(items).map((r, i) => `${i + 1}:${cidOf(r)}:${digits(r.phone || r.number || r.mobile || r.candidate_phone)}`).join('|');
const makeClientQueueId = () => `CQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeWaTemplate = (raw = {}, index = 0) => {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const body = String(raw.body || raw.message || raw.text || '').trim();
    return body ? { title: String(raw.title || raw.name || `WhatsApp Preset ${index + 1}`).trim(), body } : null;
  }
  const body = String(raw || '').trim();
  return body ? { title: body.split(/\r?\n/).find(Boolean)?.slice(0, 42) || `WhatsApp Preset ${index + 1}`, body } : null;
};
const renderAutoWaMessage = (body = '', row = {}) => {
  const name = nameOf(row);
  const firstName = String(name || 'Candidate').split(/\s+/).filter(Boolean)[0] || 'Candidate';
  const recruiter = String(row.recruiter_name || row.employee_name || row.assigned_recruiter_name || row.recruiter_code || 'Career Crox').trim();
  return String(body || '').replace(/\{\{first_name\}\}/g, firstName).replace(/\{\{candidate_name\}\}/g, name).replace(/\{\{recruiter_name\}\}/g, recruiter);
};

function EyeIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2.4 12s3.4-6 9.6-6 9.6 6 9.6 6-3.4 6-9.6 6-9.6-6-9.6-6Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>; }
function PhoneIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4L9.8 10.4a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>; }
function WhatsAppIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19.1 4.8A9.7 9.7 0 0 0 3.8 16.7L2.7 21.3l4.8-1.1a9.7 9.7 0 0 0 4.5 1.1h.1a9.7 9.7 0 0 0 7-16.5Zm-7 14.8h-.1a7.9 7.9 0 0 1-4-1.1l-.3-.2-2.8.7.7-2.7-.2-.3a7.9 7.9 0 1 1 6.7 3.6Z" fill="currentColor" /><path d="M16.5 13.8c-.2-.1-1.3-.7-1.5-.7-.2-.1-.3-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.5-1a5.5 5.5 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1 .8 2.1.9 2.3.1.1 1.7 2.6 4 3.6 2.4 1 2.4.7 2.8.7.4-.1 1.3-.5 1.5-1 .2-.4.2-.9.2-1 0-.1-.2-.2-.4-.3Z" fill="currentColor" /></svg>; }
function PrevIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function NextIcon() { return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function PlayIcon() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5.8v12.4c0 .8.9 1.3 1.6.9l9.7-6.2a1 1 0 0 0 0-1.8L9.6 4.9C8.9 4.5 8 5 8 5.8Z" fill="currentColor" /></svg>; }
function PauseIcon() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 5h3v14H7V5Zm7 0h3v14h-3V5Z" fill="currentColor" /></svg>; }
function StopIcon() { return <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>; }
function RefreshIcon() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function ReportIcon() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 4h14v16H5V4Zm4 4h6M9 12h6M9 16h3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function LightningIcon() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M13 2 4 14h7l-1 8 10-13h-7l0-7Z" fill="currentColor" /></svg>; }

const toneClass = (aht) => (aht && aht < 180 ? 'tone-red' : 'tone-blue');
const WHITE_BUTTON_TEXT_STYLE = { color: '#ffffff', WebkitTextFillColor: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,.18)' };
const INSTANT_CALL_MESSAGE = 'Instant command sent. Mobile app should start call in a few seconds if paired/open.';
function StatCard({ label, value, note, tone = 'blue' }) {
  return <button type="button" className={`stat-card bucket-click-card ${tone} auto-stat-match`} tabIndex={-1}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </button>;
}
function ActionIconButton({ icon, label, onClick, disabled, className = 'view' }) {
  return <button type="button" className={`dialer-command-btn ${className} force-white-action`} onClick={onClick} disabled={disabled} title={label} style={WHITE_BUTTON_TEXT_STYLE}>{icon}<span style={WHITE_BUTTON_TEXT_STYLE}>{label}</span></button>;
}
function ProfileDock({ item, status, loadedCount, onOpen }) {
  if (!item) return null;
  return <div className="auto-profile-dock">
    <div>
      <span className="dock-label">Mobile Current Call</span>
      <b>{nameOf(item)}</b>
      <small>{cidOf(item)} • {processOf(item)}</small>
    </div>
    <div className="auto-profile-meta">
      <span className="dock-status">{status || 'Ready'}</span>
      <span className="dock-queue-pill">{loadedCount || 0} loaded • mobile queue ready • no auto-open • ready</span>
    </div>
    <button className="mini-btn call bounceable dialer-dock-open modern-eye-btn" onClick={() => onOpen(cidOf(item))}><EyeIcon /> Open</button>
  </div>;
}

export default function AutoDialerPage() {
  const [rows, setRows] = useState([]);
  const [session, setSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [page, setPage] = useState(0);
  const [liveSearch, setLiveSearch] = useState('');
  const [queueSource, setQueueSource] = useState('CRM');
  const [loadedAt, setLoadedAt] = useState('');
  const openedRef = useRef(new Set());
  const profileSlotsRef = useRef({
    a: { win: null, candidateId: '' },
    b: { win: null, candidateId: '' },
  });
  const lastLiveProfileIdRef = useRef('');
  const lastNextProfileIdRef = useRef('');
  const prewarmedProfilesRef = useRef(new Set());
  const lastMobileProfileRequestRef = useRef('');
  const [disabledIds, setDisabledIds] = useState(() => new Set());
  const [pulse, setPulse] = useState({ show: false, seconds: 0, name: '', id: '', mode: 'Ready' });
  const [syncedSignature, setSyncedSignature] = useState('');
  const [clientQueueId, setClientQueueId] = useState(() => makeClientQueueId());
  const [waTemplates] = useState(() => getWhatsAppTemplates());
  const [autoWaPreset, setAutoWaPreset] = useState('');
  const [autoWhatsAppMode, setAutoWhatsAppMode] = useState(false);
  const waWindowRef = useRef(null);
  const lastWaCandidateRef = useRef('');

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(queueKey) || localStorage.getItem(queueKey);
      const parsed = JSON.parse(raw || '{}');
      const source = String(parsed.source || 'CRM selection');
      const startId = queueStartId(parsed, arr(parsed.items));
      const items = rotateQueueToStart(arr(parsed.items), startId);
      const orderedItems = items.map((r, i) => ({ ...r, __crm_sequence: i + 1, __dialer_order: i + 1, dialer_sequence: i + 1, queue_order: i + 1 }));
      setRows(orderedItems);
      setSyncedSignature('');
      setClientQueueId(makeClientQueueId());
      setDisabledIds(new Set(orderedItems.map((r, i) => ({ r, i })).filter(({ r }) => ['0','false','no','off','skip','skipped'].includes(String(r.call_enabled ?? r.enabled ?? '1').toLowerCase())).map(({ r, i }) => rowKeyOf(r, i))));
      setQueueSource(source);
      setLoadedAt(parsed.created_at || '');
      const startRow = items[0] || null;
      setStatus(items.length ? `${items.length} profiles loaded from ${source}. Start profile: ${startRow ? nameOf(startRow) : '-'}` : 'No queue loaded');
    } catch { setRows([]); }
  }, []);

  const currentId = session?.current_candidate_id || '';
  const liveText = `${session?.status || ''} ${session?.mobile_command || ''} ${session?.live_status || ''}`;
  const running = /running|start|prepare|calling/i.test(liveText) && !/paused|stopped|completed/i.test(liveText);
  const paused = /paused|pause/i.test(liveText);
  const enabledRows = useMemo(() => rows.filter((r, i) => !disabledIds.has(rowKeyOf(r, i))), [rows, disabledIds]);
  const currentRow = useMemo(() => {
    const currentQid = String(session?.current_queue_item_id || '');
    const currentPhone = digits(session?.current_phone || '');
    return rows.find((r) => currentQid && String(qidOf(r)) === currentQid)
      || rows.find((r) => String(cidOf(r)) === String(currentId) && (!currentPhone || phoneOfRow(r) === currentPhone))
      || enabledRows[0] || rows[0] || null;
  }, [rows, enabledRows, currentId, session?.current_queue_item_id, session?.current_phone]);
  const currentIndexInEnabled = useMemo(() => {
    const qid = String(session?.current_queue_item_id || '');
    const phone = digits(session?.current_phone || '');
    const id = String(currentId || cidOf(enabledRows[0] || '') || '');
    if (qid) {
      const byQid = enabledRows.findIndex((r) => String(qidOf(r)) === qid);
      if (byQid >= 0) return byQid;
    }
    if (id) return enabledRows.findIndex((r) => String(cidOf(r)) === id && (!phone || phoneOfRow(r) === phone));
    return -1;
  }, [enabledRows, currentId, session?.current_queue_item_id, session?.current_phone]);
  const nextRow = useMemo(() => {
    if (!enabledRows.length) return null;
    const at = currentIndexInEnabled >= 0 ? currentIndexInEnabled : 0;
    return enabledRows[Math.min(enabledRows.length - 1, at + 1)] || null;
  }, [enabledRows, currentIndexInEnabled]);
  const pageRows = useMemo(() => rows.slice(page * 20, page * 20 + 20), [rows, page]);
  const pages = Math.max(1, Math.ceil(rows.length / 20));
  const dialedLogs = useMemo(() => logs.filter(isDialedCall), [logs]);
  const connected = useMemo(() => logs.filter(isConnectedCall).length, [logs]);
  const talk = useMemo(() => logs.reduce((sum, row) => sum + callTalkSeconds(row), 0), [logs]);
  const aht = connected ? Math.round(talk / connected) : 0;
  const uniqueCalls = useMemo(() => new Set(logs.map((l) => digits(l.phone || l.number || l.mobile || '') || String(pick(l,['candidate_id','candidateId','cid']))).filter((v) => v && v !== '-')).size, [logs]);
  const liveSearchText = liveSearch.trim().toLowerCase();
  const filteredLogs = useMemo(() => !liveSearchText ? logs : logs.filter((l) => searchBlob(l).includes(liveSearchText)), [logs, liveSearchText]);

  function prewarmProfileBand(candidateId, scopeRows = rows) {
    // CC26_91: Auto-open/preload removed. Mobile app shows the calling profile; recruiter opens it manually from CRM only when needed.
    return false;
  }

  function profileSlotUrl(candidateId, tabRole = 'current', slot = 'a') {
    const cid = String(candidateId || '');
    const roleParam = tabRole === 'next' ? 'next_profile' : 'live_profile';
    return `${candidateUrl(cid)}?${roleParam}=1&dialer_lock=1&no_auto_refresh=1&dialer_slot=${slot}`;
  }

  function slotHoldingCandidate(candidateId) {
    const cid = String(candidateId || '');
    if (!cid) return '';
    const slots = profileSlotsRef.current || {};
    if (String(slots.a?.candidateId || '') === cid) return 'a';
    if (String(slots.b?.candidateId || '') === cid) return 'b';
    return '';
  }

  function hasAnyProfileSlotOpen() {
    const slots = profileSlotsRef.current || {};
    return Boolean((slots.a?.win && !slots.a.win.closed) || (slots.b?.win && !slots.b.win.closed));
  }

  function openProfileInSlot(slotKey, candidateId, tabRole = 'current', { focus = false, force = false } = {}) {
    // CC26_389: profile slots no longer create browser tabs. Keep this compatibility function same-tab only.
    if (!candidateId || candidateId === '-') return false;
    openCandidateProfileInNewTab(candidateId, rows, { sourcePath: '/auto-dialer', sourceKind: 'auto-dialer', totalRows: rows.length, hasMore: false });
    return true;
  }

  function openLiveProfileTab(candidateId, opts = {}) {
    // CC26_91: kept only for manual click compatibility. No automatic live-tab creation.
    return openCandidateTab(candidateId, 'manual');
  }

  function openDualProfileTabs(currentCandidateId, nextCandidateId = '', { focusCurrent = false, force = false } = {}) {
    // CC26_91: removed current + next auto tabs. Manual profile open remains enabled only.
    return false;
  }

  function openCandidateTab(candidateId, reason = 'manual') {
    if (!candidateId || candidateId === '-') return false;
    const row = rows.find((item) => String(cidOf(item)) === String(candidateId)) || { candidate_id: candidateId };
    openCandidateProfileInNewTab(row, rows, { sourcePath: '/auto-dialer', sourceKind: 'auto-dialer', totalRows: rows.length, hasMore: false });
    return true;
  }


  // Safety: the live profile tab is reused and updated at PREPARE/countdown time, not after call start.

  async function refresh(id = session?.session_id, mode = 'full') {
    try {
      const lite = mode === 'lite';
      const endpoint = lite ? `/api/dialer/live-status?lite=1&profile_watch=1` : `/api/dialer/live-status`; // CC26_79: no cache-buster spam
      const d = await api.get(endpoint, { cacheTtlMs: lite ? 0 : 2500, allowStale: true, timeoutMs: 14000 });
      const s = arr(d.sessions).find((x) => !id || String(x.session_id) === String(id)) || arr(d.sessions)[0] || null;
      setSession(s);
      if (!lite) setLogs(arr(d.recent_calls));
      setStatus(s?.live_status || s?.status || (lite ? 'Live state checked' : 'Refreshed'));
    } catch (e) { setStatus(e.message || 'Refresh failed'); }
  }

  useEffect(() => {
    // CC26_91: no background live-status polling from CRM. User presses Update Details/Status manually.
    return undefined;
  }, [session?.session_id]);

  useEffect(() => {
    // CC26_91: mobile no longer asks CRM to auto-open profile tabs. Recruiter opens clicked profile manually.
    return undefined;
  }, [session?.crm_open_profile_request_version, session?.next_candidate_id, nextRow]);

  useEffect(() => {
    // CC26_91: no automatic profile opening/preloading on call changes. The table highlights current call; click Open Profile when the candidate picks.
    return undefined;
  }, [currentId, session?.session_id, session?.command_version, session?.updated_at, session?.crm_open_profile_source, session?.next_candidate_id, rows.length]);

  useEffect(() => {
    if (!pulse.show) return undefined;
    if (pulse.seconds <= 0) {
      const done = window.setTimeout(() => setPulse((p) => ({ ...p, show: false })), 650);
      return () => window.clearTimeout(done);
    }
    const timer = window.setTimeout(() => setPulse((p) => ({ ...p, seconds: Math.max(0, Number(p.seconds || 0) - 1) })), 1000);
    return () => window.clearTimeout(timer);
  }, [pulse.show, pulse.seconds]);

  function selectedAutoWaMessage(row = currentRow) {
    const index = Number(autoWaPreset || -1);
    const tpl = Number.isInteger(index) && index >= 0 ? normalizeWaTemplate(waTemplates[index], index) : null;
    return tpl?.body ? renderAutoWaMessage(tpl.body, row || {}) : '';
  }

  function prepareReusableWhatsAppTab() {
    try {
      const win = window.open('about:blank', 'career_crox_whatsapp');
      if (win) { try { win.opener = null; } catch {} waWindowRef.current = win; }
      return win;
    } catch { return null; }
  }

  function openAutoWhatsAppForRow(row, preparedWindow = waWindowRef.current) {
    if (!row || !cidOf(row) || cidOf(row) === '-') return;
    const key = `${cidOf(row)}:${phoneOfRow(row)}`;
    if (lastWaCandidateRef.current === key) return;
    lastWaCandidateRef.current = key;
    const text = selectedAutoWaMessage(row);
    openWhatsAppWithLog(cidOf(row), phoneOfRow(row), text, { preparedWindow, targetName: 'career_crox_whatsapp' }).then((result) => {
      if (result?.window) waWindowRef.current = result.window;
    }).catch(() => {});
  }

  useEffect(() => {
    if (!autoWhatsAppMode || !running || !currentRow) return;
    openAutoWhatsAppForRow(currentRow);
  }, [autoWhatsAppMode, running, currentId, session?.current_queue_item_id, session?.current_phone]);

  useEffect(() => {
    if (!autoWhatsAppMode || !running || !session?.session_id) return undefined;
    // Only the active leader tab checks lightweight live status, once per call gap, to avoid egress waste.
    const timer = window.setInterval(() => {
      const leader = getPollingLeaderSnapshot();
      if ((leader?.isLeader || leader?.focused) && !leader?.hidden) refresh(session.session_id, 'lite');
    }, 10000);
    return () => window.clearInterval(timer);
  }, [autoWhatsAppMode, running, session?.session_id]);

  function buildQueueItems() {
    let callOrder = 0;
    return rows.map((r, realIndex) => ({ r, realIndex }))
      .filter(({ r, realIndex }) => !disabledIds.has(rowKeyOf(r, realIndex)))
      .map(({ r, realIndex }) => {
        callOrder += 1;
        return {
      candidate_id: cidOf(r), full_name: nameOf(r), name: nameOf(r), phone: phoneOfRow(r),
      client: pick(r, ['client','client_name','company','company_name']), role: pick(r, ['role','job_role','position','designation']),
      process: processOf(r), location: r.location || r.preferred_location || r.city || r.job_location || r.work_location || '', qualification: r.qualification || '',
      experience: pick(r, ['experience','exp','required_experience','total_experience']), source: pick(r, ['source','lead_source','data_source','list_name']),
      profile_number: r.profile_number || r.profile_no || r.sr_no || r.source_sr_no || '', imn_candidate_id: r.imn_candidate_id || r.imn_id || '',
      recruiter_name: pick(r, ['recruiter_name','employee_name','created_by_name','assigned_to_name']), recruiter_code: pick(r, ['recruiter_code','employee_no','employee_code','created_by_username','assigned_to']),
      profile_status: pick(r, ['profile_status','status','manager_crm','candidate_status']), jd_name: pick(r, ['jd_name','jd','process_name','requirement_name']),
      source_row_index: realIndex + 1, source_profile_key: `${realIndex + 1}:${cidOf(r)}:${phoneOfRow(r) || '-'}`,
      last_note: lastNoteOf(r), interview_date: r.interview_date || r.interview_datetime || r.interview_reschedule_date || '',
      queue_order: callOrder, dialer_sequence: callOrder, __dialer_order: callOrder, __crm_sequence: realIndex + 1,
      client_queue_id: clientQueueId
    };
      });
  }

  function mergeQueueIds(originalRows = rows, created = {}) {
    const qitems = arr(created.queue_items || created.queue_preview);
    if (!qitems.length) return originalRows;
    const byKey = new Map(qitems.map((q) => [`${q.queue_order || ''}:${String(q.candidate_id || '')}`, q]));
    let enabledCursor = 0;
    return originalRows.map((r, i) => {
      if (disabledIds.has(rowKeyOf(r, i))) return { ...r, queue_item_id: '', call_enabled: '0', status: 'Skipped' };
      const key = `${enabledCursor + 1}:${String(cidOf(r))}`;
      const q = byKey.get(key) || qitems[enabledCursor];
      enabledCursor += 1;
      return q ? { ...r, queue_item_id: q.queue_item_id, call_enabled: q.call_enabled ?? '1', status: q.status || r.status, queue_order: q.queue_order || enabledCursor, dialer_sequence: q.queue_order || enabledCursor, __dialer_order: q.queue_order || enabledCursor, __crm_sequence: q.queue_order || enabledCursor } : r;
    });
  }

  async function toggleDialerRow(row, realIndex) {
    const key = rowKeyOf(row, realIndex);
    const nextEnabled = disabledIds.has(key);
    setDisabledIds((prev) => { const n = new Set(prev); if (nextEnabled) n.delete(key); else n.add(key); return n; });
    setRows((prev) => prev.map((r, i) => i === realIndex ? { ...r, call_enabled: nextEnabled ? '1' : '0', status: nextEnabled ? (String(r.status || '').toLowerCase() === 'skipped' ? 'Queued' : r.status) : 'Skipped' } : r));
    if (row?.queue_item_id) {
      try {
        const d = await api.post('/api/dialer/queue-item-toggle', { queue_item_id: row.queue_item_id, enabled: nextEnabled ? '1' : '0', reason: nextEnabled ? '' : 'Unchecked from CRM table' }, { timeoutMs: 10000 });
        if (d?.session) setSession(d.session);
        setStatus(nextEnabled ? `${nameOf(row)} included in calling queue` : `${nameOf(row)} skipped. Mobile will not call this profile.`);
      } catch (e) {
        setStatus(e.message || 'Queue checkbox sync failed');
      }
    } else {
      setStatus(nextEnabled ? `${nameOf(row)} included locally. Sync Table to update mobile.` : `${nameOf(row)} unchecked locally. Sync Table before Start Mobile.`);
    }
  }

  async function syncTableToMobile() {
    if (!rows.length) return setStatus('Load profiles from Candidates/Hot Leads/Interviews first');
    setBusy(true);
    try {
      const items = buildQueueItems();
      if (!items.length) throw new Error('No checked profiles selected for mobile sync');
      const signature = queueSignatureOf(items);
      const created = await api.post('/api/dialer/start-session', { section: `${queueSource || 'Selected'} Table Sync`, items, next_call_gap_seconds: COUNTDOWN_SECONDS, start_from_crm: '0', mobile_auto_start: '0', command_source: 'crm_table_sync', strict_sequence: '1', replace_existing: '1', client_queue_id: clientQueueId, client_queue_signature: signature }, { timeoutMs: 30000 });
      setSession(created.session);
      setSyncedSignature(signature);
      setRows((prev) => mergeQueueIds(prev, created));
      setStatus(`${items.length} checked profiles synced to mobile. Open app will auto-load it within a few seconds. Now press Start Mobile Calling.`);
      await refresh(created.session?.session_id);
    } catch (e) { setStatus(e.message || 'Sync table failed'); }
    finally { setBusy(false); }
  }

  async function startQueue(options = {}) {
    const withWhatsApp = Boolean(options?.withWhatsApp);
    if (!rows.length) return setStatus('Load profiles from Candidates/Interviews first');
    if (!enabledRows.length) return setStatus('No checked profiles selected. Tick at least one profile.');
    let preparedWaWindow = null;
    if (withWhatsApp) {
      preparedWaWindow = prepareReusableWhatsAppTab();
      setAutoWhatsAppMode(true);
      lastWaCandidateRef.current = '';
      openAutoWhatsAppForRow(enabledRows[0], preparedWaWindow);
    } else {
      setAutoWhatsAppMode(false);
      lastWaCandidateRef.current = '';
    }
    setBusy(true);
    try {
      const items = buildQueueItems();
      const signature = queueSignatureOf(items);
      if (!items.length) throw new Error('No checked profiles selected for mobile dialing');
      const canReuseSynced = session?.session_id && rows.some((r) => r.queue_item_id) && syncedSignature && syncedSignature === signature;
      let startSessionId = session?.session_id || '';
      if (!canReuseSynced) {
        const synced = await api.post('/api/dialer/start-session', { section: `${queueSource || 'Selected'} Table Sync`, items, next_call_gap_seconds: COUNTDOWN_SECONDS, start_from_crm: '0', mobile_auto_start: '0', command_source: 'crm_table_sync', strict_sequence: '1', replace_existing: '1', client_queue_id: clientQueueId, client_queue_signature: signature }, { timeoutMs: 30000 });
        setSession(synced.session);
        setSyncedSignature(signature);
        setRows((prev) => mergeQueueIds(prev, synced));
        startSessionId = synced.session?.session_id || '';
      }
      if (!startSessionId) throw new Error('Sync session not created from CRM. Press Sync Mobile Queue once and try again.');
      const d = await api.post('/api/dialer/resume-session', { session_id: startSessionId, instant_start: '1', next_call_gap_seconds: COUNTDOWN_SECONDS, command_source: canReuseSynced ? 'crm_instant_start_exact_synced_queue' : 'crm_sync_then_start_exact_queue', client_queue_id: clientQueueId, client_queue_signature: signature }, { timeoutMs: 12000 });
      setSession(d.session || { ...(session || {}), session_id: startSessionId, status: 'Running', live_status: 'Start command sent', mobile_command: 'start', command_type: 'start' });
      setStatus(INSTANT_CALL_MESSAGE + (canReuseSynced ? ' Exact synced queue reused.' : ' Fresh CRM sync completed, then start command sent.'));
      await refresh(startSessionId);
    } catch (e) { setStatus(e.message || 'Start failed'); }
    finally { setBusy(false); }
  }
  async function pause() { if (!session?.session_id) return; setSession((x)=>x?{...x,status:'Paused',live_status:'Paused',mobile_command:'pause',command_type:'pause'}:x); await api.post('/api/dialer/pause-session', { session_id: session.session_id }); setStatus('Paused'); refresh(session.session_id); }
  async function resume() { if (!session?.session_id) return startQueue({ withWhatsApp: autoWhatsAppMode }); setSession((x)=>x?{...x,status:'Running',live_status:'Resume command sent',mobile_command:'resume',command_type:'resume'}:x); await api.post('/api/dialer/resume-session', { session_id: session.session_id }); setStatus('Resume command sent'); refresh(session.session_id); }

  async function stop() {
    if (!session?.session_id) return;
    const sid = session.session_id;
    setSession((x)=>x?{...x,status:'Stopped',live_status:'Stopped',mobile_command:'stop',command_type:'stop',current_candidate_id:'',current_queue_item_id:'',crm_open_profile_candidate_id:''}:x);
    setPulse((p)=>({...p,show:false,seconds:0}));
    setAutoWhatsAppMode(false);
    lastWaCandidateRef.current = '';
    setStatus('Stopped. No more calls will start.');
    try { await api.post('/api/dialer/stop-session', { session_id: sid }, { timeoutMs: 12000 }); } catch (e) { setStatus(e.message || 'Stop failed, refresh once'); return; }
    refresh(sid);
  }
  async function manualCall(row = null) {
    const p = digits(row ? (row.phone || row.number || row.mobile || row.candidate_phone) : manualPhone);
    if (!p || p.length < 10) return setStatus('Enter a valid phone number');
    const candidateId = row ? cidOf(row) : '';
    setBusy(true);
    try {
      const d = await api.post('/api/dialer/manual-call', { phone: p, candidate_name: row ? nameOf(row) : manualName, candidate_id: candidateId, process: row ? processOf(row) : 'Manual Dialer', client: row ? pick(row, ['client','client_name','company','company_name']) : '', role: row ? pick(row, ['role','job_role','position','designation']) : '', location: row ? (row.location || row.preferred_location || row.city || row.job_location || row.work_location || '') : '', source: row ? pick(row, ['source','lead_source','data_source','list_name']) : 'Manual Dialer', profile_number: row ? (row.profile_number || row.profile_no || row.sr_no || row.source_sr_no || '') : '', imn_candidate_id: row ? (row.imn_candidate_id || row.imn_id || '') : '', note: row ? lastNoteOf(row) : '', source_profile_key: row ? rowKeyOf(row, rows.findIndex((x) => x === row)) : '', next_call_gap_seconds: 0, instant_start: '1', command_source: 'crm_mobile_only_manual_instant', call_source: 'crm_manual_or_profile_icon', source_mode: 'crm_manual_or_profile_icon' }, { timeoutMs: 12000 });
      setSession(d.session);
      setStatus('Manual/profile call command sent. The paired app will start immediately.');
    } catch (e) { setStatus(e.message || 'Manual call failed'); }
    finally { setBusy(false); }
  }

  async function manualCallWithWhatsApp(row = null) {
    if (!row) return setStatus('Use a loaded candidate row for Call + WhatsApp.');
    const prepared = prepareReusableWhatsAppTab();
    const text = selectedAutoWaMessage(row);
    openWhatsAppWithLog(cidOf(row), phoneOfRow(row), text, { preparedWindow: prepared, targetName: 'career_crox_whatsapp' }).catch(() => {});
    await manualCall(row);
  }

  return <Layout title="Auto Dialer" subtitle="">
    <style>{`
      .auto-stat-match{min-height:84px!important;border-radius:18px!important;padding:14px 14px 16px!important;pointer-events:none}.auto-stat-match span{font-weight:900!important}.auto-stat-match strong{display:block;font-size:34px!important;line-height:.95!important}.auto-stat-match small{font-size:12px!important;font-weight:900!important;opacity:.92!important}.auto-stat-match{background:linear-gradient(135deg,#f8fbff,#eaf3ff)!important;border:1px solid rgba(145,176,225,.35)!important;box-shadow:0 10px 24px rgba(41,74,136,.10)!important}.auto-stat-match,.auto-stat-match *{color:#14345a!important;-webkit-text-fill-color:#14345a!important;text-shadow:none!important}.auto-stat-match strong{color:#0f172a!important;-webkit-text-fill-color:#0f172a!important}.auto-stat-match small{color:#526b8f!important;-webkit-text-fill-color:#526b8f!important}.auto-stat-match.blue{background:linear-gradient(135deg,#eef7ff,#dbeafe)!important}.auto-stat-match.orange{background:linear-gradient(135deg,#fff7ed,#ffedd5)!important}.auto-stat-match.green{background:linear-gradient(135deg,#f0fdf4,#dcfce7)!important}.auto-stat-match.purple{background:linear-gradient(135deg,#f5f3ff,#ede9fe)!important}.auto-stat-match.red{background:linear-gradient(135deg,#fff1f2,#ffe4e6)!important}.auto-stat-match.teal{background:linear-gradient(135deg,#ecfeff,#ccfbf1)!important}
      .auto-stat-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin-top:6px;align-items:stretch}.auto-panel{border:1px solid rgba(92,142,255,.28);border-radius:22px;background:linear-gradient(135deg,#f8fcff,#eef7ff,#fff7fb);box-shadow:0 16px 42px rgba(37,99,235,.10);padding:16px;margin-bottom:12px}.auto-command-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:2px}.dialer-command-btn{border:0;border-radius:18px;min-height:56px;padding:12px 14px;font-weight:1000;color:#fff!important;background:linear-gradient(135deg,#2f7bff,#6d5dfc);box-shadow:0 14px 30px rgba(37,99,235,.22);display:inline-flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;text-align:center}.dialer-command-btn *{color:#fff!important}.dialer-command-btn,.dialer-command-btn *,.dialer-command-btn span,.dialer-command-btn svg,.dialer-command-btn path,.force-white-action,.force-white-action *,.force-white-icon,.force-white-icon *{color:#fff!important;-webkit-text-fill-color:#fff!important;fill:#fff!important;stroke:#fff!important}.dialer-command-btn:hover{transform:translateY(-2px);box-shadow:0 18px 38px rgba(37,99,235,.30)}.dialer-command-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}.dialer-command-btn svg{width:18px;height:18px;flex:0 0 auto}.dialer-command-btn span{font-size:13px;font-weight:1000;color:#fff!important;-webkit-text-fill-color:#fff!important;white-space:nowrap}.force-white-action,.force-white-action span,.force-white-action svg{color:#fff!important;-webkit-text-fill-color:#fff!important}.force-white-action path{fill:#fff!important;stroke:#fff!important;color:#fff!important;-webkit-text-fill-color:#fff!important}.dialer-command-btn,.dialer-command-btn span{color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 1px 1px rgba(0,0,0,.10)}.dialer-command-btn svg{color:#fff!important}.dialer-command-btn.call{background:linear-gradient(135deg,#0f8f76,#22bb63,#78d63f)}.dialer-command-btn.view{background:linear-gradient(135deg,#1b54ff,#2c7fff,#9148ff)}.dialer-command-btn.edit{background:linear-gradient(135deg,#ff7a21,#ff4b57,#ffb133)}.dialer-command-btn.danger{background:linear-gradient(135deg,#ff215e,#ff4e86,#ff8f5a)}.auto-wa-mode-row{display:grid;grid-template-columns:minmax(240px,1fr) minmax(260px,1.2fr);gap:10px;margin-top:12px;align-items:center}.auto-wa-mode-hint{font-size:12px;font-weight:850;color:#516987}.auto-manual-row{display:grid;grid-template-columns:minmax(220px,1.1fr) minmax(220px,1.1fr) 180px;gap:12px;margin-top:12px}.auto-input{border:1px solid #bdd7ff;border-radius:15px;padding:11px 13px;font-weight:850;background:#fff;color:#132b4f;min-height:44px;display:inline-flex;align-items:center;gap:8px}.auto-manual-btn{min-height:46px!important;color:#fff!important;-webkit-text-fill-color:#fff!important}.auto-manual-btn *{color:#fff!important;-webkit-text-fill-color:#fff!important;fill:#fff!important;stroke:#fff!important}.auto-state-row{margin-top:11px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}.auto-chip{display:inline-flex;align-items:center;gap:7px;padding:8px 11px;border-radius:999px;font-weight:1000;font-size:12px;background:#ecfeff;color:#0e7490;border:1px solid #b8f4ff}.auto-countdown-chip{background:linear-gradient(135deg,#fff7ed,#ffedd5);color:#c2410c;border-color:#fed7aa}.auto-status-line{font-weight:900;color:#36547a;margin-top:10px;padding-left:2px}
      .auto-profile-dock{position:sticky;top:72px;z-index:10;margin:0 0 12px 0;border:1px solid #b9d7ff;border-radius:20px;background:linear-gradient(135deg,#ffffff,#eef7ff,#fff7fb);box-shadow:0 12px 30px rgba(37,99,235,.14);padding:14px 16px;display:grid;grid-template-columns:minmax(280px,1.15fr) minmax(210px,.95fr) auto;gap:14px;align-items:center}.auto-profile-dock b{display:block;font-size:19px;color:#132b4f}.auto-profile-dock small{display:block;color:#4f6584;font-weight:800}.auto-profile-meta{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.dock-label{font-size:11px;font-weight:1000;text-transform:uppercase;color:#2563eb}.dock-status{font-weight:1000;color:#0e7490;background:#ecfeff;border:1px solid #b8f4ff;border-radius:999px;padding:8px 11px;display:inline-flex;align-items:center}.dock-queue-pill{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;border:1px solid #bde7ef;background:linear-gradient(135deg,#e8fffb,#f0f9ff);font-weight:1000;color:#0f766e}.dialer-dock-open{width:auto!important;height:auto!important;min-height:46px!important;border-radius:15px!important;padding:10px 16px!important;color:#fff!important}.dialer-row-call{width:auto!important;height:auto!important;min-height:38px!important;border-radius:14px!important;padding:9px 13px!important;color:#fff!important;display:inline-flex;align-items:center;gap:7px}
      .auto-table{width:100%;border-collapse:separate;border-spacing:0 7px}.auto-table th{text-align:left;font-size:12px;color:#36547a;text-transform:uppercase;letter-spacing:.45px}.auto-table td{background:#ffffffd8;border-top:1px solid #d8e7ff;border-bottom:1px solid #d8e7ff;padding:9px 10px;font-weight:850;color:#14345a}.auto-table td:first-child{border-left:1px solid #d8e7ff;border-radius:15px 0 0 15px}.auto-table td:last-child{border-right:1px solid #d8e7ff;border-radius:0 15px 15px 0}.auto-live-row td{background:linear-gradient(90deg,#e7f3ff,#fff3fb);outline:2px solid #3478ff}.auto-link{border:0;background:transparent;color:#2563eb;font-weight:1000;cursor:pointer}.auto-table-wrap{overflow:auto;max-height:52vh}.auto-search-row{display:grid;grid-template-columns:minmax(260px,1fr) 120px 130px;gap:8px;align-items:center;margin:10px 0}.muted-small{font-size:12px;font-weight:900;color:#64748b}.mode-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eef7ff;color:#2563eb;font-weight:1000;font-size:12px}.record-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#f0fdf4;color:#15803d;font-weight:1000;font-size:12px}.record-missing{background:#fff1f2;color:#be123c}.dialer-pulse-popup{position:fixed;right:24px;top:94px;z-index:99999;min-width:300px;max-width:430px;border-radius:26px;padding:16px 18px;background:linear-gradient(135deg,#081a3a,#116dff,#22c55e);box-shadow:0 22px 55px rgba(15,23,42,.34);color:#fff!important;-webkit-text-fill-color:#fff!important;border:1px solid rgba(255,255,255,.28);animation:pulsePop .78s ease-in-out infinite alternate}.dialer-pulse-popup *{color:#fff!important;-webkit-text-fill-color:#fff!important}.pulse-kicker{font-size:12px;font-weight:1000;text-transform:uppercase;letter-spacing:.7px;opacity:.9}.pulse-name{font-size:21px;font-weight:1000;line-height:1.1;margin-top:4px}.pulse-id{font-size:13px;font-weight:900;opacity:.9;margin-top:3px}.pulse-seconds{position:absolute;right:16px;top:16px;width:58px;height:58px;border-radius:999px;display:grid;place-items:center;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.45);font-size:28px;font-weight:1000}.pulse-note{font-size:12px;font-weight:900;margin-top:8px;opacity:.95}@keyframes pulsePop{from{transform:translateY(0) scale(1);filter:saturate(1)}to{transform:translateY(-4px) scale(1.018);filter:saturate(1.35)}}.force-white-action,.force-white-action *,.dialer-command-btn,.dialer-command-btn *{color:#fff!important;-webkit-text-fill-color:#fff!important}.force-white-action svg,.dialer-command-btn svg{color:#fff!important;fill:#fff!important;stroke:#fff!important}@media(max-width:1280px){.auto-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.auto-command-row{grid-template-columns:repeat(3,minmax(0,1fr))}.auto-manual-row{grid-template-columns:1fr}.auto-profile-dock{grid-template-columns:1fr}.auto-profile-meta{align-items:flex-start}}@media(max-width:1100px){.bucket-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.auto-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.auto-command-row{grid-template-columns:repeat(2,minmax(0,1fr))}}

      /* CC26_398 final visual layer: Gen-Z premium, high-contrast, fast-readable */
      html body .auto-stat-grid{gap:12px!important}
      html body .auto-stat-grid .auto-stat-match{position:relative!important;overflow:hidden!important;min-height:82px!important;padding:12px 14px 13px!important;border:1px solid rgba(255,255,255,.34)!important;border-radius:18px!important;box-shadow:0 14px 30px rgba(30,64,175,.17),inset 0 1px 0 rgba(255,255,255,.28)!important;isolation:isolate!important}
      html body .auto-stat-grid .auto-stat-match::after{content:"";position:absolute;right:-30px;top:-42px;width:105px;height:105px;border-radius:50%;background:rgba(255,255,255,.13);filter:blur(1px);z-index:-1}
      html body .auto-stat-grid .auto-stat-match.blue{background:linear-gradient(135deg,#1d4ed8 0%,#3b82f6 45%,#7c3aed 100%)!important}
      html body .auto-stat-grid .auto-stat-match.orange{background:linear-gradient(135deg,#f97316 0%,#fb4b5d 48%,#ffae42 100%)!important}
      html body .auto-stat-grid .auto-stat-match.green{background:linear-gradient(135deg,#059669 0%,#22c55e 52%,#84cc16 100%)!important}
      html body .auto-stat-grid .auto-stat-match.purple{background:linear-gradient(135deg,#2563eb 0%,#38bdf8 48%,#8b5cf6 100%)!important}
      html body .auto-stat-grid .auto-stat-match.red{background:linear-gradient(135deg,#ef4444 0%,#f43f5e 50%,#fb7185 100%)!important}
      html body .auto-stat-grid .auto-stat-match.teal{background:linear-gradient(135deg,#0891b2 0%,#14b8a6 48%,#2dd4bf 100%)!important}
      html body .auto-stat-grid .auto-stat-match,html body .auto-stat-grid .auto-stat-match *,html body .auto-stat-grid .auto-stat-match span,html body .auto-stat-grid .auto-stat-match strong,html body .auto-stat-grid .auto-stat-match small{color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 1px 2px rgba(15,23,42,.26)!important}
      html body .auto-stat-grid .auto-stat-match span{font-size:12.5px!important;line-height:1.05!important;font-weight:950!important;letter-spacing:-.01em!important;opacity:.98!important}
      html body .auto-stat-grid .auto-stat-match strong{font-size:31px!important;line-height:1!important;font-weight:1000!important;letter-spacing:-.035em!important;margin-top:3px!important;font-variant-numeric:tabular-nums!important}
      html body .auto-stat-grid .auto-stat-match small{font-size:11.5px!important;line-height:1.1!important;font-weight:850!important;opacity:.92!important;margin-top:2px!important}
      html body .auto-panel{border:1px solid rgba(94,129,255,.19)!important;border-radius:20px!important;background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(241,247,255,.95) 52%,rgba(255,244,251,.92))!important;box-shadow:0 14px 34px rgba(56,85,150,.09),inset 0 1px 0 #fff!important}
      html body .auto-profile-dock{border:1px solid rgba(99,102,241,.22)!important;background:linear-gradient(120deg,#ffffff 0%,#eff6ff 48%,#f5f3ff 100%)!important;box-shadow:0 12px 28px rgba(67,56,202,.12)!important}
      html body .auto-command-row .dialer-command-btn{border-radius:15px!important;min-height:52px!important;font-size:13.5px!important;letter-spacing:-.01em!important;box-shadow:0 10px 20px rgba(37,99,235,.17)!important}
      html body .auto-input{border-color:#c4d7fb!important;background:rgba(255,255,255,.95)!important;box-shadow:0 5px 14px rgba(37,99,235,.05)!important}
      html body .auto-table td{background:rgba(255,255,255,.92)!important}
    `}</style>
    {pulse.show ? <div className="dialer-pulse-popup"><div className="pulse-kicker">{pulse.mode}</div><div className="pulse-name">{pulse.name || 'Candidate'}</div><div className="pulse-id">{pulse.id || currentId} • manual-open mode</div><div className="pulse-seconds">{pulse.seconds}</div><div className="pulse-note">Mobile shows the active call. Open Profile jumps straight to the matched candidate.</div></div> : null}
    <div className="auto-stat-grid top-gap-small fade-up"><StatCard label="Loaded" value={enabledRows.length} note={`Checked of ${rows.length}`} tone="blue"/><StatCard label="Dialed" value={dialedLogs.length} note="Today outgoing calls" tone="orange"/><StatCard label="Connected" value={connected} note="Today picked calls" tone="green"/><StatCard label="Talktime" value={fmt(talk)} note="Today talktime" tone="purple"/><StatCard label="Average Handling Time" value={fmt(aht)} note="Today average" tone={aht && aht < 180 ? "red" : "teal"}/><StatCard label="Unique Calls" value={uniqueCalls} note="Today unique numbers" tone="teal"/></div>
    {rows.length ? <div className="auto-panel" style={{padding:'12px 16px'}}><b style={{color:'#132b4f'}}>Loaded from {queueSource}: {enabledRows.length}/{rows.length} checked profiles</b><div className="muted-small">Start profile: {enabledRows[0] ? nameOf(enabledRows[0]) : '-'} • {enabledRows[0] ? cidOf(enabledRows[0]) : '-'}{loadedAt ? ` • Loaded ${String(loadedAt).slice(0,19).replace('T',' ')}` : ''}</div><div className="muted-small">{enabledRows.slice(0,6).map((r)=>nameOf(r)).join(' → ')}{rows.length > 6 ? ' → ...' : ''}</div></div> : null}
    <ProfileDock item={currentRow} status={session?.live_status || status} loadedCount={rows.length} onOpen={(id)=>openCandidateTab(id, 'manual')} />
    <div className="auto-panel">
      <div className="auto-command-row">
        <ActionIconButton icon={<RefreshIcon />} label="Sync Mobile Queue" className="view" onClick={syncTableToMobile} disabled={busy || running || !enabledRows.length}/>
        <ActionIconButton icon={<LightningIcon />} label="Start Calling" className="call" onClick={() => startQueue({ withWhatsApp: false })} disabled={busy || !enabledRows.length}/>
        <ActionIconButton icon={<><PhoneIcon /><WhatsAppIcon /></>} label="Start Calling + WhatsApp" className="view" onClick={() => startQueue({ withWhatsApp: true })} disabled={busy || !enabledRows.length}/>
        <ActionIconButton icon={<PauseIcon />} label="Pause" className="edit" onClick={pause} disabled={!session?.session_id || paused}/>
        <ActionIconButton icon={<PlayIcon />} label="Resume" className="view" onClick={resume} disabled={!session?.session_id || running}/>
        <ActionIconButton icon={<StopIcon />} label="Stop" className="danger" onClick={stop} disabled={!session?.session_id || (!running && !paused)}/>
        <ActionIconButton icon={<EyeIcon />} label="Live Status" className="call" onClick={() => window.open('/live-dialing', '_blank')}/>
        <ActionIconButton icon={<ReportIcon />} label="Reports" className="edit" onClick={() => window.open('/reports', '_blank')}/>
      </div>
      <div className="auto-wa-mode-row">
        <select className="auto-input" value={autoWaPreset} onChange={(e) => setAutoWaPreset(e.target.value)}>
          <option value="">WhatsApp Preset (optional)</option>
          {waTemplates.slice(0,80).map((raw,index)=>{const tpl=normalizeWaTemplate(raw,index);return tpl?<option key={`${tpl.title}-${index}`} value={String(index)}>{tpl.title}</option>:null})}
        </select>
        <div className="auto-wa-mode-hint">Combined mode keeps one WhatsApp tab live and updates it with the selected preset.</div>
      </div>
      <div className="auto-manual-row">
        <input className="auto-input" value={manualPhone} onChange={(e)=>setManualPhone(e.target.value)} placeholder="Paste manual phone number" />
        <input className="auto-input" value={manualName} onChange={(e)=>setManualName(e.target.value)} placeholder="Optional candidate name" />
        <button className="dialer-command-btn call auto-manual-btn force-white-action" type="button" onClick={()=>manualCall()} disabled={busy} style={WHITE_BUTTON_TEXT_STYLE}><PhoneIcon /><span style={WHITE_BUTTON_TEXT_STYLE}>Call Now</span></button>
      </div>
      <div className="auto-state-row"><span className="auto-chip">Stage: {paused ? 'Paused' : running ? 'Running' : session?.session_id ? 'Updated' : 'Ready'}</span><span className="auto-chip auto-countdown-chip">On-demand reports • focused profile open</span><span className="auto-chip">Current: {session?.current_candidate_name || '-'}</span></div>
      <div className="auto-status-line">{status}</div>
    </div>
    <div className="auto-panel">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:10}}><div><div style={{fontSize:18,fontWeight:1000,color:'#132b4f'}}>Loaded Dialer Table</div><div style={{fontWeight:800,color:'#64748b'}}>Unticked profiles are skipped on CRM and mobile.</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="auto-input" onClick={()=>setDisabledIds(new Set())}>Check All</button><button className="auto-input" onClick={()=>setDisabledIds(new Set(rows.map((r, i)=>rowKeyOf(r, i))))}>Uncheck All</button><button className="auto-input" onClick={()=>setPage(Math.max(0,page-1))}><PrevIcon /> Prev 20</button><button className="auto-input" onClick={()=>setPage(Math.min(pages-1,page+1))}>Next 20 <NextIcon /></button></div></div>
      <div className="auto-table-wrap"><table className="auto-table"><thead><tr><th>Call?</th><th>SR</th><th>Candidate ID</th><th>Profile No.</th><th>IMN ID</th><th>Profile</th><th>Name</th><th>Last Note</th><th>Interview Date</th><th>Process</th><th>Actions</th></tr></thead><tbody>{pageRows.map((r,i)=>{const real=page*20+i;const cid=cidOf(r);const key=rowKeyOf(r, real);const live=(session?.current_queue_item_id&&qidOf(r)===session.current_queue_item_id)||(String(cid)===String(currentId)&&(!session?.current_phone||phoneOfRow(r)===digits(session.current_phone)));const checked=!disabledIds.has(key);return <tr key={`${key}-${real}`} className={live?'auto-live-row':checked?'':'auto-skip-row'}><td><button className={`auto-check-btn ${checked?'on':'off'}`} type="button" onClick={()=>toggleDialerRow(r,real)}>{checked?'☑':'☐'}</button></td><td>{real+1}</td><td><button className="auto-link" onClick={()=>openCandidateTab(cid, 'manual')}>{cid}</button></td><td>{r.profile_number||r.profile_no||r.sr_no||r.source_sr_no||'-'}</td><td>{r.imn_candidate_id||r.imn_id||'-'}</td><td><button className="mini-btn call bounceable modern-icon-btn modern-eye-btn" onClick={()=>openCandidateTab(cid, 'manual')}><EyeIcon /></button></td><td>{nameOf(r)}</td><td>{lastNoteOf(r)}</td><td>{r.interview_date||r.interview_datetime||'-'}</td><td>{processOf(r)}</td><td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="mini-btn view bounceable dialer-row-call modern-call-btn" onClick={()=>manualCall(r)}><PhoneIcon /> Call</button><button className="mini-btn edit bounceable dialer-row-call modern-wa-btn" onClick={()=>manualCallWithWhatsApp(r)}><PhoneIcon /><WhatsAppIcon /> Call + WA</button></div></td></tr>})}{!rows.length?<tr><td colSpan="11">No profiles loaded.</td></tr>:null}</tbody></table></div>
    </div>
    <div className="auto-panel">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}><div><div style={{fontSize:18,fontWeight:1000,color:'#132b4f'}}>Live Call Table</div><div className="muted-small">Search by candidate ID, phone, name, status, employee, mode, note or recording.</div></div><span className="auto-chip">Showing {filteredLogs.slice(0,80).length} / {logs.length}</span></div>
      <div className="auto-search-row"><input className="auto-input" value={liveSearch} onChange={(e)=>setLiveSearch(e.target.value)} placeholder="Search live calls: ID, phone, name, note, status" /><button className="auto-input" type="button" onClick={()=>setLiveSearch('')}>Clear</button><button className="auto-input" type="button" onClick={()=>refresh(session?.session_id)}>Update Details</button></div>
      <div className="auto-table-wrap"><table className="auto-table"><thead><tr><th>Time</th><th>Call ID</th><th>Candidate ID</th><th>Profile</th><th>Name</th><th>Phone</th><th>Employee</th><th>Status</th><th>Talktime</th><th>Mode</th><th>Notes</th><th>Recording</th></tr></thead><tbody>{filteredLogs.slice(0,80).map((l,i)=>{const candidateId = pick(l,['candidate_id','candidateId','cid']); const callId = pick(l,['call_log_id','id','log_id']); const recording = pick(l,['recording_status','recording_filename','recording_url','recording_file_id']); return <tr key={l.call_log_id||l.id||i}><td>{String(l.call_started_at||l.created_at||'').slice(11,19) || '-'}</td><td>{callId}</td><td><button className="auto-link" onClick={()=>openCandidateTab(candidateId, 'manual')}>{candidateId}</button></td><td><button className="mini-btn call bounceable modern-icon-btn modern-eye-btn" onClick={()=>openCandidateTab(candidateId, 'manual')}><EyeIcon /></button></td><td>{l.candidate_name||l.full_name||'-'}</td><td>{l.phone||'-'}</td><td>{l.employee_name||l.employee_username||'-'}</td><td>{l.status||l.call_status||'-'}</td><td>{fmt(callTalkSeconds(l))}</td><td><span className="mode-pill">{l.call_source||l.source_mode||l.direction||'auto_dialer'}</span></td><td>{pick(l,['notes','note','call_note','feedback','outcome'])}</td><td><span className={`record-pill ${String(recording).toLowerCase().includes('missing')||recording==='-'?'record-missing':''}`}>{recording}</span></td></tr>})}{!filteredLogs.length?<tr><td colSpan="12">No matching calls found.</td></tr>:null}</tbody></table></div>
    </div>
  </Layout>;
}
