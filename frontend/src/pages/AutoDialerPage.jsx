import {isInactiveProfile} from '../lib/candidateAccess';
import { DIALER_LIVE_EVENT, armDialerProfileTab } from '../lib/candidateNav';
import { ActionGlyph } from '../components/EmojiGlyph';
import PremiumSelect from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { getPollingLeaderSnapshot } from '../lib/tabLeader';
import { getWhatsAppTemplates } from '../lib/templateStore';
import { openWhatsAppWithLog } from '../lib/candidateAccess';
import { openCandidateProfileInPopupTab } from '../lib/candidateNav';
import { readDialerQueue, waitForDialerQueue, validDialerQueue } from '../lib/workspaceHelpers';

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
const callTimeText=value=>{let text=String(value||'');if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(text))text=text.replace(' ','T')+'+05:30';const date=new Date(text);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'short',timeStyle:'short',hour12:true}).format(date)+' IST';};
const callStatusText = (row = {}) => String(row.status || row.call_status || row.outcome || row.call_quality || '').toLowerCase();
const callDirectionText = (row = {}) => String(row.direction || row.call_type || '').toLowerCase();
const isNegativeCall = (row = {}) => /not\s*connected|not\s*connect|miss|fail|busy|reject|cancel|decline|no answer|unanswered|switched off|invalid|wrong number|employee cut|cut suspect|early cut|short ring|ring window/.test(`${callStatusText(row)} ${callDirectionText(row)}`);
const isMissedCall = (row = {}) => /miss/.test(`${callStatusText(row)} ${callDirectionText(row)}`);
const isIncomingCall = (row = {}) => /incoming|inbound|^(1|3)$/.test(callDirectionText(row)) || (!/outgoing|outbound|^2$/.test(callDirectionText(row)) && isMissedCall(row));
const isDialedCall = (row = {}) => !isIncomingCall(row);
const isNotConnectedCall=(row={})=>isDialedCall(row)&&!isMissedCall(row)&&(!/calling|dialing|ringing/.test(callStatusText(row))||Boolean(row.call_ended_at))&&!isConnectedCall(row);
const isConnectedCall = (row={})=>!isNegativeCall(row)&&Number(row.talktime_seconds||row.talk_time_seconds||0)>=15;
const callTalkSeconds = (row = {}) => Math.max(0, Math.round(Number(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0) || 0));
const searchBlob = (r = {}) => Object.values(r || {}).map((v) => String(v || '').toLowerCase()).join(' ');
const openProfile = (id) => id && id !== '-' && openCandidateProfileInPopupTab(id, [], { sourcePath: '/auto-dialer', sourceKind: 'auto-dialer' });
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
function PhoneIcon() { return <ActionGlyph kind="phone"/>; }
function WhatsAppIcon() { return <ActionGlyph kind="whatsapp"/>; }
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
function StatCard({ label, value, note, tone = 'blue',onClick }) {
  return <button type="button" className={`stat-card bucket-click-card ${tone} auto-stat-match`} onClick={onClick}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </button>;
}
function ActionIconButton({ icon, label, onClick, disabled, className = 'view' }) {
  return <button type="button" className={`dialer-command-btn ${className}`} onClick={onClick} disabled={disabled} title={label} style={WHITE_BUTTON_TEXT_STYLE}>{icon}<span style={WHITE_BUTTON_TEXT_STYLE}>{label}</span></button>;
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
      <span className="dock-queue-pill">{loadedCount || 0} loaded • ready • answered calls open a profile tab</span>
    </div>
    <button className="mini-btn call bounceable dialer-dock-open modern-eye-btn" onClick={() => onOpen(cidOf(item))}><EyeIcon /> Open</button>
  </div>;
}

export default function AutoDialerPage() {
  const [rows, setRows] = useState([]);
  const [session, setSession] = useState(null);
  const actionGeneration=useRef(0),stoppedSessions=useRef(new Set());
  const [livePhone,setLivePhone]=useState(null);
  useEffect(()=>{function changed(e){const p=e.detail||{};if(p.team_only)return;if(p.session)setSession(old=>stoppedSessions.current.has(String(p.session.session_id))&&!/stop|cancel|completed/i.test(String(p.session.status))?old:(!old||old.session_id===p.session.session_id?p.session:old));if(p.command_ack?.applied)setStatus(p.command_ack.active_call?(p.command_ack.disconnect_requested?'Phone stopped · ending the CRM call':'Queue stopped · end current call on the phone'):'Phone stopped · no next call');if(p.call)setLivePhone(p.call);if(p.summary)setTodaySummary(p.summary);if(p.call)setLogs(old=>historyPageRef.current>1&&!old.some(r=>r.call_log_id===p.call.call_log_id)?old:[p.call,...old.filter(r=>r.call_log_id!==p.call.call_log_id&&!(String(r.call_log_id).startsWith('LIVE-')&&digits(r.phone)===digits(p.call.phone)&&Math.abs(Date.parse(r.call_started_at)-Date.parse(p.call.call_started_at))<10000))].slice(0,80));}window.addEventListener(DIALER_LIVE_EVENT,changed);return()=>window.removeEventListener(DIALER_LIVE_EVENT,changed);},[]);

  const historyPageRef=useRef(1);
  const [logs, setLogs] = useState([]);
  const [unknown,setUnknown]=useState(null),[logCategory,setLogCategory]=useState('');
  const historyLoaded=useRef(false);
  const [historyPage,setHistoryPage]=useState(1),[historyTotal,setHistoryTotal]=useState(0),[historyMore,setHistoryMore]=useState(false);
  const isCountedCall=r=>Boolean(r);
  async function reviewUnknown(){try{setUnknown((await api.get('/api/dialer/unknown-calls',{cacheTtlMs:0})).items||[]);}catch(e){setStatus(e.message);}}
  async function classify(row,usage){const reason=usage==='work'?window.prompt('Candidate name or work purpose (required):'): 'Personal call';if(!reason)return;try{await api.post('/api/dialer/unknown-calls/'+encodeURIComponent(row.call_log_id),{usage,reason},{retries:0});await reviewUnknown();refresh();}catch(e){setStatus(e.message);}}
  const [todaySummary,setTodaySummary]=useState(null);
  const [clock,setClock]=useState(Date.now());
  useEffect(()=>{const t=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(t);},[]);
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
    // CC59: token distinguishes this selection from any stale CRM queue in another tab.
    const requestedId = new URLSearchParams(window.location.search).get('queue_id') || '';
    let mounted = true;
    let loaded = false;
    const usePayload = (payload) => {
      if (!mounted || loaded || !validDialerQueue(payload, requestedId)) return;
      const source = String(payload.source || 'CRM selection');
      const items = rotateQueueToStart(arr(payload.items), queueStartId(payload, arr(payload.items)));
      if (!items.length) return;
      const ordered = items.map((row, index) => ({ ...row, __crm_sequence: index + 1, __dialer_order: index + 1, dialer_sequence: index + 1, queue_order: index + 1 }));
      loaded = true;
      setRows(ordered);
      setPage(0);
      setSyncedSignature('');
      setClientQueueId(makeClientQueueId());
      setDisabledIds(new Set(ordered.map((row, index) => ({row, index})).filter(({row}) => ['0','false','no','off','skip','skipped'].includes(String(row.call_enabled ?? row.enabled ?? '1').toLowerCase())).map(({row, index}) => rowKeyOf(row, index))));
      setQueueSource(source);
      setLoadedAt(payload.created_at || '');
      setStatus(`${items.length} profiles loaded from ${source}. Start profile: ${nameOf(items[0])}`);
    };
    const stored = readDialerQueue(requestedId);
    if (stored) usePayload(stored);
    // New tab can request the queue directly from Candidates without any server read/egress.
    const stopListening = loaded ? () => {} : waitForDialerQueue(requestedId, '', usePayload);
    if (!loaded) setStatus(requestedId ? 'Waiting for selected profiles from Candidates tab…' : 'No queue loaded. Select candidates, then click Load to Auto Dialer.');
    const timeout = requestedId ? window.setTimeout(() => {
      if (mounted && !loaded) setStatus('Selected profiles could not be transferred. Keep the Candidates tab open, select rows and click Load to Auto Dialer again.');
    }, 3500) : null;
    return () => { mounted = false; stopListening(); if (timeout) window.clearTimeout(timeout); };
  }, []);

  const currentId=livePhone&&!livePhone.call_ended_at?(livePhone.candidate_id||''):session?.current_candidate_id||'';
  const liveText = `${session?.status || ''} ${session?.mobile_command || ''} ${session?.live_status || ''}`;
  const running = /running|start|prepare|calling/i.test(liveText) && !/paused|stopped|completed/i.test(liveText);
  const paused = /paused|pause/i.test(liveText);
  const enabledRows = useMemo(() => rows.filter((r, i) => !isInactiveProfile(r) && !disabledIds.has(rowKeyOf(r, i))), [rows, disabledIds]);
  const currentRow = useMemo(() => {
    if(livePhone&&!livePhone.call_ended_at){const cached=rows.find(r=>String(cidOf(r))===String(livePhone.candidate_id)&&phoneOfRow(r)===digits(livePhone.phone));return cached||{candidate_id:livePhone.candidate_id||'',full_name:livePhone.candidate_name||'Not in CRM',phone:livePhone.phone};}
    const currentQid = String(session?.current_queue_item_id || '');
    const currentPhone = digits(session?.current_phone || '');
    return rows.find((r) => currentQid && String(qidOf(r)) === currentQid)
      || rows.find((r) => String(cidOf(r)) === String(currentId) && (!currentPhone || phoneOfRow(r) === currentPhone))
      || enabledRows[0] || rows[0] || null;
  }, [rows, enabledRows, currentId, session?.current_queue_item_id, session?.current_phone,livePhone]);
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
  useEffect(()=>{const at=rows.findIndex(r=>String(cidOf(r))===String(currentId));if(at>=0)setPage(Math.floor(at/20));},[currentId,rows]);
  const dialedLogs = useMemo(() => logs.filter(isCountedCall).filter(isDialedCall), [logs]);
  const activeLog=logs.find(r=>isCountedCall(r)&&!r.call_ended_at&&r.answered_at);
  const liveTalk=activeLog?Math.max(0,Math.floor((clock-Date.parse(activeLog.answered_at))/1000)):0;
  const connected = Number(todaySummary?.connected ?? logs.filter(isCountedCall).filter(isConnectedCall).length)+(liveTalk>=15?1:0);
  const talk = Number(todaySummary?.talktime_seconds ?? logs.filter(isCountedCall).reduce((sum,row)=>sum+callTalkSeconds(row),0))+liveTalk;
  const validTalk=Number(todaySummary?.valid_talktime_seconds ?? logs.filter(isCountedCall).filter(isConnectedCall).reduce((sum,row)=>sum+callTalkSeconds(row),0))+(liveTalk>=15?liveTalk:0);
  const aht=connected?Math.round(validTalk/connected):0;
  const uniqueCalls=Number(todaySummary?.total_calls ?? logs.filter(isCountedCall).length);
  const liveSearchText = liveSearch.trim().toLowerCase();
  const filteredLogs = useMemo(() => logs.filter(isCountedCall).filter(l=>(!liveSearchText||searchBlob(l).includes(liveSearchText))&&(!logCategory||logCategory==='connected'&&isConnectedCall(l)||logCategory==='dialed'&&isDialedCall(l)||logCategory==='incoming'&&isIncomingCall(l)||logCategory==='missed'&&isMissedCall(l)||logCategory==='not_connected'&&isNotConnectedCall(l)||logCategory==='long_calls'&&callTalkSeconds(l)>600)),[logs,liveSearchText,logCategory]);
  async function loadHistory(category=logCategory,page=1){const data=await api.get(`/api/dialer/calls?scope=self&category=${category||'all'}&page=${page}&limit=80`,{cacheTtlMs:0,retries:0,timeoutMs:12000});historyLoaded.current=true;historyPageRef.current=page;setLogs(arr(data.items));setHistoryTotal(Number(data.total||0));setHistoryMore(Boolean(data.has_more));setHistoryPage(page);}
  useEffect(()=>{loadHistory(logCategory,1).catch(()=>{});},[logCategory]);
  useEffect(()=>{const field={dialed:'dialed',connected:'connected',not_connected:'not_connected',incoming:'incoming',missed:'missed'}[logCategory]||'total_calls';const n=todaySummary?.[field];if(n!=null&&historyLoaded.current){setHistoryTotal(Number(n));setHistoryMore(historyPage*80<Number(n));}},[todaySummary,logCategory,historyPage]);


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
    openCandidateProfileInPopupTab(candidateId, rows, { sourcePath: '/auto-dialer', sourceKind: 'auto-dialer', totalRows: rows.length, hasMore: false });
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
    openCandidateProfileInPopupTab(row, rows, { sourcePath: '/auto-dialer', sourceKind: 'auto-dialer', totalRows: rows.length, hasMore: false });
    return true;
  }


  // Safety: the live profile tab is reused and updated at PREPARE/countdown time, not after call start.

  async function refresh(id = session?.session_id, mode = 'full') {
    const generation=actionGeneration.current;
    try {
      const lite = mode === 'lite';
      const endpoint = lite ? `/api/dialer/live-status?lite=1&profile_watch=1` : `/api/dialer/live-status`; // CC26_79: no cache-buster spam
      const d = await api.get(endpoint, { cacheTtlMs: lite ? 0 : 2500, allowStale: true, timeoutMs: 14000 });
      if(generation!==actionGeneration.current)return;
      const s = arr(d.sessions).find((x) => !id || String(x.session_id) === String(id)) || arr(d.sessions)[0] || null;
      if(s&&stoppedSessions.current.has(String(s.session_id))&&!/stop|cancel|completed/i.test(String(s.status)))return;
      setSession(s);
      if (!lite) {if(!historyLoaded.current)setLogs([...(d.live_calls||[]),...arr(d.recent_calls)]);setTodaySummary(d.own_summary||d.summary||null);if(historyLoaded.current)loadHistory(logCategory,historyPageRef.current).catch(()=>{});}
      setStatus(s?.live_status || s?.status || (lite ? 'Live state checked' : 'Refreshed'));
    } catch (e) { setStatus(e.message || 'Refresh failed'); }
  }

  useEffect(()=>{refresh();},[]);

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

  // Call-state push drives automatic WhatsApp selection; clock ticks do not poll.

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
    if (!rows.length) return setStatus('Load one or more profiles from Candidates/Hot Leads/Interviews first');
    setBusy(true);
    try {
      const items = buildQueueItems();
      if (!items.length) throw new Error('No checked profiles selected for mobile sync');
      const bad = items.filter(item => !phoneOfRow(item));
      if (bad.length) throw new Error(`${bad.length} selected profile(s) have no valid phone. Fix their phone fields before syncing.`);
      const signature = queueSignatureOf(items);
      const created = await api.post('/api/dialer/start-session', { section: `${queueSource || 'Selected'} Table Sync`, items, next_call_gap_seconds: COUNTDOWN_SECONDS, start_from_crm: '0', mobile_auto_start: '0', command_source: 'crm_table_sync', strict_sequence: '1', replace_existing: '1', client_queue_id: clientQueueId, client_queue_signature: signature }, { timeoutMs: 30000 });
      setSession(created.session);
      // Keep the exact queue visible in the browser; the mobile app downloads the same items.
      setSyncedSignature(signature);
      setRows((prev) => mergeQueueIds(prev, created));
      setStatus(`${items.length} checked profiles synced to mobile. Open app will auto-load it within a few seconds. Now press Start Mobile Calling.`);
      await refresh(created.session?.session_id);
    } catch (e) { setStatus(e.message || 'Sync table failed'); }
    finally { setBusy(false); }
  }

  const autoQueueSignature=queueSignatureOf(enabledRows);
  const attemptedSync=useRef('');
  useEffect(()=>{if(!loadedAt||!enabledRows.length||running||busy||autoQueueSignature===syncedSignature||attemptedSync.current===autoQueueSignature)return;const t=setTimeout(()=>{attemptedSync.current=autoQueueSignature;syncTableToMobile();},150);return()=>clearTimeout(t);},[autoQueueSignature,loadedAt,running,busy,syncedSignature]);

  async function startQueue(options = {}) {
    armDialerProfileTab();
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
    const generation=++actionGeneration.current;
    setBusy(true);
    try {
      const items = buildQueueItems();
      const signature = queueSignatureOf(items);
      if (!items.length) throw new Error('No checked profiles selected for mobile dialing');
      const canReuseSynced = session?.session_id && rows.some((r) => r.queue_item_id) && syncedSignature && syncedSignature === signature;
      let startSessionId = session?.session_id || '';
      if (!canReuseSynced) {
        const synced = await api.post('/api/dialer/start-session', { section: `${queueSource || 'Selected'} Table Sync`, items, next_call_gap_seconds: COUNTDOWN_SECONDS, start_from_crm: '0', mobile_auto_start: '0', command_source: 'crm_table_sync', strict_sequence: '1', replace_existing: '1', client_queue_id: clientQueueId, client_queue_signature: signature }, { timeoutMs: 30000 });
        if(generation!==actionGeneration.current){if(synced.session?.session_id)await api.post('/api/dialer/stop-session',{session_id:synced.session.session_id},{timeoutMs:12000,retries:0,detachedWrite:true});return;}
        setSession(synced.session);
        setSyncedSignature(signature);
        setRows((prev) => mergeQueueIds(prev, synced));
        startSessionId = synced.session?.session_id || '';
      }
      if (!startSessionId) throw new Error('Sync session not created from CRM. Press Sync Mobile Queue once and try again.');
      if(generation!==actionGeneration.current)return;
      const d = await api.post('/api/dialer/resume-session', { session_id: startSessionId, instant_start: '1', next_call_gap_seconds: COUNTDOWN_SECONDS, command_source: canReuseSynced ? 'crm_instant_start_exact_synced_queue' : 'crm_sync_then_start_exact_queue', client_queue_id: clientQueueId, client_queue_signature: signature }, { timeoutMs: 12000 });
      if(generation!==actionGeneration.current)return;
      setSession(d.session || { ...(session || {}), session_id: startSessionId, status: 'Running', live_status: 'Start command sent', mobile_command: 'start', command_type: 'start' });
      setStatus(INSTANT_CALL_MESSAGE + (canReuseSynced ? ' Exact synced queue reused.' : ' Fresh CRM sync completed, then start command sent.'));
      await refresh(startSessionId);
    } catch (e) { if(generation===actionGeneration.current)setStatus(e.message || 'Start failed'); }
    finally { setBusy(false); }
  }
  async function pause() { if (!session?.session_id) return; setSession((x)=>x?{...x,status:'Paused',live_status:'Paused',mobile_command:'pause',command_type:'pause'}:x); await api.post('/api/dialer/pause-session', { session_id: session.session_id }); setStatus('Paused'); refresh(session.session_id); }
  async function resume() { if (!session?.session_id) return startQueue({ withWhatsApp: autoWhatsAppMode }); setSession((x)=>x?{...x,status:'Running',live_status:'Resume command sent',mobile_command:'resume',command_type:'resume'}:x); await api.post('/api/dialer/resume-session', { session_id: session.session_id }); setStatus('Resume command sent'); refresh(session.session_id); }

  async function stop() {
    ++actionGeneration.current;
    const sid=session?.session_id||'';if(sid)stoppedSessions.current.add(String(sid));
    setSession(x=>x?{...x,status:'Stopped',live_status:'Stopping phone…',mobile_command:'stop',command_type:'stop',current_candidate_id:'',current_queue_item_id:'',crm_open_profile_candidate_id:''}:x);
    setPulse(p=>({...p,show:false,seconds:0}));setAutoWhatsAppMode(false);lastWaCandidateRef.current='';setSyncedSignature('');
    setStatus('Sending priority Stop to phone…');
    try {
      const reply=await api.post('/api/dialer/stop-session',{session_id:sid},{timeoutMs:15000,retries:0,detachedWrite:true});
      if(reply.session)setSession(reply.session);
      setStatus(reply.phone_acknowledged?'Phone received Stop · no next call':'Stop sent. Waiting for phone confirmation.');
    }catch(error){setStatus('Stop not confirmed: '+(error.message||'Check phone connection and press Stop again.'));}
  }
  async function manualCall(row = null) {
    armDialerProfileTab();
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

  return <Layout title="Auto Dialer" subtitle=""><div className="cc828-auto-workspace"><header className="cc828-auto-header"><div><h2>Auto Dialer</h2><span>{rows.length?`${enabledRows.length} selected · ${rows.length} loaded`:'Add profiles from Candidates'}</span></div><span className="cc828-call-badge">{session?.status||'Queue ready'}</span></header>
    <style>{`
      .auto-stat-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.auto-stat-match{min-height:88px!important;border-radius:18px!important;padding:15px!important;box-shadow:0 8px 22px #4b246b10!important;border:1px solid #ffffff80!important;pointer-events:auto!important;text-align:left;transition:transform .16s}.auto-stat-match:hover{transform:translateY(-2px)}.auto-stat-match strong{display:block;font-size:28px;font-weight:700}.auto-stat-match small{font-size:11px}.auto-stat-match.blue{background:linear-gradient(135deg,#ffe0bc,#ffc6a7)!important}.auto-stat-match.orange{background:linear-gradient(135deg,#ffdcad,#ffd66e)!important}.auto-stat-match.green{background:linear-gradient(135deg,#b6edd1,#daf8b0)!important}.auto-stat-match.purple{background:linear-gradient(135deg,#e8d6ff,#dcd5fc)!important}.auto-stat-match.teal{background:linear-gradient(135deg,#bceee9,#d1f4cd)!important}.auto-stat-match.red{background:linear-gradient(135deg,#ffd2e0,#ffdfca)!important}.auto-stat-match,.auto-stat-match *{color:#263044!important;-webkit-text-fill-color:#263044!important}.auto-panel{margin-top:12px;border:1px solid #eadaca;border-radius:20px;padding:16px;background:linear-gradient(145deg,#fff9ee,#f3fcf6)}.auto-command-row{display:flex;gap:10px;flex-wrap:wrap}.dialer-command-btn{display:flex;gap:9px;align-items:center;border:0;border-radius:14px;padding:12px 16px;font-size:14px;font-weight:600;color:white}.dialer-command-btn.call{background:linear-gradient(135deg,#12895b,#30bd88)}.dialer-command-btn.edit{background:linear-gradient(135deg,#bb5f10,#f09e2f)}.dialer-command-btn.danger{background:linear-gradient(135deg,#c32d54,#ec6371)}.dialer-command-btn.view{background:linear-gradient(135deg,#7650b8,#a66dd2)}.dialer-command-btn svg{width:20px;height:20px;fill:none;stroke:currentColor}.auto-command-icon{display:flex;gap:4px}.auto-input{padding:10px;border:1px solid #d9dce3;border-radius:12px;background:#fff9f4}.auto-table-wrap{overflow:auto;max-height:54vh}.auto-table{width:100%;border-collapse:collapse}.auto-table td,.auto-table th{padding:9px 12px;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}.auto-table tr.auto-current-row td{background:#d7f5df!important}.auto-profile-dock{display:flex;justify-content:space-between;gap:16px;padding:20px;margin:12px 0;background:linear-gradient(135deg,#e4dbfc,#ffe4bc);border-radius:20px}.auto-profile-name{font-size:24px;font-weight:650}.auto-profile-meta{display:flex;gap:8px;flex-wrap:wrap}.auto-search-row,.auto-manual-row{display:flex;gap:10px;flex-wrap:wrap}.auto-wa-mode-row{display:flex;gap:12px;margin-top:12px}.dialer-pulse-popup{position:fixed;right:20px;top:85px;background:linear-gradient(135deg,#c9f1d9,#f9e09e);border-radius:20px;padding:18px;box-shadow:0 10px 30px #22473325;z-index:100}.pulse-name{font-size:22px;font-weight:700}.pulse-seconds{font-size:25px}.muted-small{font-size:12px;color:#536174}@media(max-width:900px){.auto-stat-grid{grid-template-columns:repeat(3,1fr)}.auto-profile-dock{flex-direction:column}}
    `}</style>
    {unknown&&<div className="modal-backdrop"><section className="cc814-modal"><header><h2>Calls without a CRM profile</h2><button className="ghost-btn" onClick={()=>setUnknown(null)}>×</button></header><div className="cc814-modal-body"><p>Every call is counted. Work and Personal labels are optional. Calls over 10 minutes are flagged for review.</p>{unknown.map(r=><div className="cc814-rank peach" key={r.call_log_id}><span><b>{r.candidate_name||'Unknown caller'}</b><small>{r.phone} · {r.call_started_at} · {fmt(r.talktime_seconds)} · {r.call_usage||'pending'}</small></span>{callTalkSeconds(r)>600&&<span className="cc844-call-review-flag">⚑ Review · 10m+</span>}</div>)}{!unknown.length&&<p>No unknown calls to review.</p>}</div></section></div>}
    {pulse.show ? <div className="dialer-pulse-popup"><div className="pulse-kicker">{pulse.mode}</div><div className="pulse-name">{pulse.name || 'Candidate'}</div><div className="pulse-id">{pulse.id || currentId}</div><div className="pulse-seconds">{pulse.seconds}</div></div> : null}
    <div className="auto-stat-grid top-gap-small fade-up"><StatCard label="Loaded" value={enabledRows.length} note={`Checked of ${rows.length}`} tone="blue"/><StatCard label="Dialed" onClick={()=>setLogCategory(logCategory==='dialed'?'':'dialed')} value={todaySummary?.dialed ?? dialedLogs.length} note="Today outgoing calls" tone="orange"/><StatCard label="Connected" onClick={()=>setLogCategory(logCategory==='connected'?'':'connected')} value={connected} note="15 seconds or more of talk" tone="green"/><StatCard label="Talktime" value={fmt(talk)} note="Today talktime" tone="purple"/><StatCard label="Average Handling Time" value={fmt(aht)} note="Today average" tone={aht && aht < 180 ? "red" : "teal"}/><StatCard label="Total calls" value={uniqueCalls} note="Incoming + outgoing today" tone="teal"/></div>
    {rows.length ? <div className="auto-panel" style={{padding:'12px 16px'}}><b style={{color:'#132b4f'}}>Loaded from {queueSource}: {enabledRows.length}/{rows.length} checked profiles</b><div className="muted-small">Start profile: {enabledRows[0] ? nameOf(enabledRows[0]) : '-'} • {enabledRows[0] ? cidOf(enabledRows[0]) : '-'}{loadedAt ? ` • Loaded ${String(loadedAt).slice(0,19).replace('T',' ')}` : ''}</div><div className="muted-small">{enabledRows.slice(0,6).map((r)=>nameOf(r)).join(' → ')}{rows.length > 6 ? ' → ...' : ''}</div></div> : null}
    <ProfileDock item={currentRow} status={session?.live_status || status} loadedCount={rows.length} onOpen={(id)=>openCandidateTab(id, 'manual')} />
    <div className="auto-panel">
      <div className="auto-command-row">
        <ActionIconButton icon={<LightningIcon />} label={paused?'Resume':'Start calling'} className="call" onClick={() => paused?resume():startQueue({withWhatsApp:autoWhatsAppMode})} disabled={busy||running||!enabledRows.length}/>
        <ActionIconButton icon={<PauseIcon />} label="Pause" className="edit" onClick={pause} disabled={!running}/>
        <ActionIconButton icon={<StopIcon />} label="Stop" className="danger" onClick={stop} disabled={false}/>
        <ActionIconButton icon={<EyeIcon />} label="Unknown calls" className="view" onClick={reviewUnknown}/>
        <ActionIconButton icon={<ReportIcon />} label="Team calls ↗" className="view" onClick={()=>window.open('/live-dialing','_blank','noopener,noreferrer')}/>
        <label className="mode-pill"><input type="checkbox" checked={autoWhatsAppMode} onChange={e=>setAutoWhatsAppMode(e.target.checked)}/>WhatsApp after dial</label>
      </div>
      <div className="auto-wa-mode-row">
        <PremiumSelect className="auto-input" value={autoWaPreset} onChange={(e) => setAutoWaPreset(e.target.value)}>
          <option value="">WhatsApp Preset (optional)</option>
          {waTemplates.slice(0,80).map((raw,index)=>{const tpl=normalizeWaTemplate(raw,index);return tpl?<option key={`${tpl.title}-${index}`} value={String(index)}>{tpl.title}</option>:null})}
        </PremiumSelect>
      </div>
      <div className="auto-manual-row">
        <input className="auto-input" value={manualPhone} onChange={(e)=>setManualPhone(e.target.value)} placeholder="Paste manual phone number" />
        <input className="auto-input" value={manualName} onChange={(e)=>setManualName(e.target.value)} placeholder="Optional candidate name" />
        <button className="dialer-command-btn call auto-manual-btn force-white-action" type="button" onClick={()=>manualCall()} disabled={busy} style={WHITE_BUTTON_TEXT_STYLE}><PhoneIcon /><span style={WHITE_BUTTON_TEXT_STYLE}>Call Now</span></button>
      </div>
      <div className="auto-state-row"><span className="auto-chip">Stage: {paused ? 'Paused' : running ? 'Running' : session?.session_id ? 'Updated' : 'Ready'}</span><span className="auto-chip">Current: {session?.current_candidate_name || '-'}</span></div>
      <div className="auto-status-line">{status}</div>
    </div>
    <div className="auto-panel">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,marginBottom:10}}><div><div style={{fontSize:18,fontWeight:1000,color:'#132b4f'}}>Loaded Dialer Table</div><div style={{fontWeight:800,color:'#64748b'}}>Unticked profiles are skipped on CRM and mobile.</div></div><div className="cc824-selection-controls"><span className="cc824-selection-count" role="status">{enabledRows.length} / {rows.length} selected</span><button type="button" className="auto-input" aria-pressed={rows.length>0&&enabledRows.length===rows.length} disabled={!rows.length} onClick={()=>setDisabledIds(new Set())}>Select all</button><button type="button" className="auto-input" aria-pressed={rows.length>0&&enabledRows.length===0} disabled={!rows.length} onClick={()=>setDisabledIds(new Set(rows.map((r, i)=>rowKeyOf(r, i))))}>Clear selection</button><button className="auto-input" onClick={()=>setPage(Math.max(0,page-1))}><PrevIcon /> Prev 20</button><button className="auto-input" onClick={()=>setPage(Math.min(pages-1,page+1))}>Next 20 <NextIcon /></button></div></div>
      <div className="auto-table-wrap"><table className="auto-table auto-queue-table"><thead><tr><th><button type="button" className="auto-check-btn" role="checkbox" aria-label="Include all loaded profiles" aria-checked={rows.length&&enabledRows.length===rows.length?true:enabledRows.length?'mixed':false} disabled={!rows.length} onClick={()=>setDisabledIds(enabledRows.length===rows.length?new Set(rows.map((r,i)=>rowKeyOf(r,i))):new Set())}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={enabledRows.length&&enabledRows.length!==rows.length?'M4 10h12':'m4 10 4 4 8-9'} strokeLinecap="round" strokeLinejoin="round"/></svg></button></th><th>SR</th><th>Candidate ID</th><th>Profile No.</th><th>IMN ID</th><th>Profile</th><th>Name</th><th>Phone</th><th>Last Note</th><th>Interview Date</th><th>Process</th><th>Actions</th></tr></thead><tbody>{pageRows.map((r,i)=>{const real=page*20+i;const cid=cidOf(r);const key=rowKeyOf(r, real);const live=livePhone&&!livePhone.call_ended_at?(String(cid)===String(livePhone.candidate_id)&&phoneOfRow(r)===digits(livePhone.phone)):(session?.current_queue_item_id&&qidOf(r)===session.current_queue_item_id)||(String(cid)===String(currentId)&&(!session?.current_phone||phoneOfRow(r)===digits(session.current_phone)));const checked=!disabledIds.has(key);return <tr key={`${key}-${real}`} className={live?'auto-live-row':checked?'':'auto-skip-row'}><td><button className={`auto-check-btn ${checked?'on':'off'}`} type="button" role="checkbox" aria-checked={checked} aria-label={`Include ${nameOf(r)} in calling queue`} title={checked?'Included in calling queue':'Skipped from calling queue'} onClick={()=>toggleDialerRow(r,real)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9" strokeLinecap="round" strokeLinejoin="round"/></svg></button></td><td>{real+1}</td><td><button className="auto-link" onClick={()=>openCandidateTab(cid, 'manual')}>{cid}</button></td><td>{r.profile_number||r.profile_no||r.sr_no||r.source_sr_no||'-'}</td><td>{r.imn_candidate_id||r.imn_id||'-'}</td><td><button className="mini-btn call bounceable modern-icon-btn modern-eye-btn" onClick={()=>openCandidateTab(cid, 'manual')}><EyeIcon /></button></td><td>{nameOf(r)}</td><td>{phoneOfRow(r) || <span style={{color:'#b91c1c',fontWeight:700}}>Missing phone</span>}</td><td>{lastNoteOf(r)}</td><td>{r.interview_date||r.interview_datetime||'-'}</td><td>{processOf(r)}</td><td><div style={{display:'flex',gap:6,flexWrap:'wrap'}}><button className="mini-btn view bounceable dialer-row-call modern-call-btn" onClick={()=>manualCall(r)}><PhoneIcon /> Call</button><button className="mini-btn edit bounceable dialer-row-call modern-wa-btn" onClick={()=>manualCallWithWhatsApp(r)}><PhoneIcon /><WhatsAppIcon /> Call + WA</button></div></td></tr>})}{!rows.length?<tr><td colSpan="12">No profiles loaded. Select candidates, then click Load to Auto Dialer.</td></tr>:null}</tbody></table></div>
    </div>
    <div className="auto-panel">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}><div><div style={{fontSize:18,fontWeight:1000,color:'#132b4f'}}>Live Call Table</div><div className="muted-small">Search by candidate ID, phone, name, status, employee, mode, note or recording.</div></div><span className="auto-chip">Showing {filteredLogs.length} / {historyTotal||logs.length}</span></div>
      <div className="auto-search-row"><input className="auto-input" value={liveSearch} onChange={(e)=>setLiveSearch(e.target.value)} placeholder="Search live calls: ID, phone, name, note, status" /><button className="auto-input" type="button" onClick={()=>setLiveSearch('')}>Clear</button><button className="auto-input" type="button" onClick={()=>refresh(session?.session_id)}>Update Details</button><button className="auto-input" type="button" aria-pressed={logCategory==='long_calls'} onClick={()=>setLogCategory(logCategory==='long_calls'?'':'long_calls')}>⚑ Calls over 10m</button></div>
      <div className="auto-table-wrap"><table className="auto-table"><thead><tr><th>Time</th><th>Call ID</th><th>Candidate ID</th><th>Profile</th><th>Name</th><th>Phone</th><th>Employee</th><th>Status</th><th>Talktime</th><th>Mode</th><th>Notes</th><th>Recording</th></tr></thead><tbody>{filteredLogs.map((l,i)=>{const candidateId = pick(l,['candidate_id','candidateId','cid']); const callId = pick(l,['call_log_id','id','log_id']); const recording = pick(l,['recording_status','recording_filename','recording_url','recording_file_id']); return <tr key={l.call_log_id||l.id||i} className={callTalkSeconds(l)>600?'cc844-long-call':''}><td>{callTimeText(l.call_started_at||l.created_at)}</td><td>{callId}</td><td><button className="auto-link" onClick={()=>openCandidateTab(candidateId, 'manual')}>{candidateId}</button></td><td><button className="mini-btn call bounceable modern-icon-btn modern-eye-btn" onClick={()=>openCandidateTab(candidateId, 'manual')}><EyeIcon /></button></td><td>{l.candidate_name||l.full_name||'-'}</td><td>{l.phone||'-'}</td><td>{l.employee_name||l.employee_username||'-'}</td><td>{l.status||l.call_status||'-'}</td><td>{fmt(callTalkSeconds(l))}{callTalkSeconds(l)>600&&<span className="cc844-call-review-flag" title="Talk time is over 10 minutes">⚑ Review · 10m+</span>}</td><td><span className="mode-pill">{l.call_source||l.source_mode||l.direction||'auto_dialer'}</span></td><td>{pick(l,['notes','note','call_note','feedback','outcome'])}</td><td><span className={`record-pill ${String(recording).toLowerCase().includes('missing')||recording==='-'?'record-missing':''}`}>{recording}</span></td></tr>})}{!filteredLogs.length?<tr><td colSpan="12">No matching calls found.</td></tr>:null}</tbody></table></div>
      <div className="row-actions"><button type="button" className="ghost-btn" disabled={historyPage<=1} onClick={()=>loadHistory(logCategory,historyPage-1).catch(e=>setStatus(e.message))}>← Previous calls</button><span>Page {historyPage} · {historyTotal} calls</span><button type="button" className="ghost-btn" disabled={!historyMore} onClick={()=>loadHistory(logCategory,historyPage+1).catch(e=>setStatus(e.message))}>Next calls →</button></div>
    </div>
  </div></Layout>;
}
