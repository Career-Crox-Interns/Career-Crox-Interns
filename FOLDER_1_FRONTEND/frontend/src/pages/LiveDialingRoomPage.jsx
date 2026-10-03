import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';

const arr = (x) => Array.isArray(x) ? x : [];
const COUNTDOWN_SECONDS = 5;
const fmt = (s = 0) => { const n = Math.max(0, Number(s || 0)); const m = Math.floor(n / 60); const x = n % 60; return m ? `${m}m ${x}s` : `${x}s`; };
const digits = (v = '') => String(v || '').replace(/\D+/g, '').slice(-10);
const candidateUrl = (id) => `/candidate/${encodeURIComponent(id)}`;
const pick = (r = {}, keys = []) => { for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return '-'; };
const low = (v = '') => String(v || '').toLowerCase();
const searchBlob = (r = {}) => Object.values(r || {}).map((v) => String(v || '').toLowerCase()).join(' ');
const isConnectedCall = (row = {}) => {
  const statusText = `${row.status || ''} ${row.call_status || ''} ${row.disposition || ''} ${row.call_result || ''} ${row.outcome || ''}`.toLowerCase();
  return /(connected|picked|answered|completed|success)/.test(statusText) || Number(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0) > 0;
};
const callTalkSeconds = (row = {}) => isConnectedCall(row) ? Math.max(0, Math.round(Number(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0) || 0)) : 0;
const card = { border: '1px solid rgba(92,142,255,.28)', borderRadius: 24, background: 'linear-gradient(135deg,#f8fcff,#eef7ff,#fff7fb)', boxShadow: '0 18px 50px rgba(37,99,235,.10)', padding: 16 };
const nameOf = (r = {}) => r.candidate_name || r.full_name || r.name || 'Candidate';
const cidOf = (r = {}) => r.candidate_id || r.id || '-';
const processOf = (r = {}) => r.process || r.jd_name || r.jd || r.client_name || '-';
const Icon = ({ path }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={path} fill="currentColor"/></svg>;
const I = {
  spark: 'M13 2 4 14h7l-1 8 10-13h-7V2Z', pause: 'M7 5h3v14H7V5Zm7 0h3v14h-3V5Z', play: 'M8 5.8v12.4c0 .8.9 1.3 1.6.9l9.7-6.2a1 1 0 0 0 0-1.8L9.6 4.9C8.9 4.5 8 5 8 5.8Z', stop: 'M7 7h10v10H7V7Z', phone: 'M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4l-1.5 1.3a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z', refresh: 'M17.7 6.3A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L13 11h8V3l-3.3 3.3Z'
};
function StatCard({ label, value, note, tone = 'blue' }) { return <button type="button" className={`stat-card bucket-click-card ${tone} assistant-stat-card`} tabIndex={-1}><span>{label}</span><strong>{value}</strong><small>{note}</small></button>; }
function Btn({ children, onClick, danger, disabled, tone = '' }) { return <button className={`assistant-command-btn ${danger?'danger':''} ${tone}`} disabled={disabled} onClick={onClick} style={{color:'#fff',WebkitTextFillColor:'#fff'}}>{children}</button>; }
function openProfile(id, winRef = null, force = false) {
  if (!id || id === '-') return false;
  openCandidateProfileInNewTab(id);
  return true;
}

export default function LiveDialingRoomPage() {
  const [live, setLive] = useState({ sessions: [], active_queue: [], summary: {} });
  const [report, setReport] = useState({ items: [], summary: {}, performers: [], leaders: {}, loaded: false });
  const [section, setSection] = useState('Interviews');
  const [limit, setLimit] = useState(50);
  const [manualPhone, setManualPhone] = useState('');
  const [pair, setPair] = useState(null);
  const [status, setStatus] = useState('Call Assistant uses Manual Refresh to reduce unnecessary data usage.');
  const [busy, setBusy] = useState(false);
  const [syncToast, setSyncToast] = useState('');
  const pairWatchRef = useRef(null);
  const callRevisionRef = useRef('');
  const callRefreshBusyRef = useRef(false);
  const [filters, setFilters] = useState({ q: '', phone: '', name: '', employee: '', status: '', source: '', date_from: '', date_to: '', duration_min: '', duration_max: '', hours: '' });
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const liveProfileWindowRef = useRef(null);
  const lastRequestRef = useRef('');
  const prewarmedProfilesRef = useRef(new Set());
  const current = arr(live.sessions)[0] || null;
  const appSynced = Boolean(live?.mobile_pair_active || live?.persistent_pairing) || /application_sync|Application Sync/i.test(`${current?.call_source || ''} ${current?.source_mode || ''} ${current?.section || ''} ${current?.live_status || ''}`);
  const queue = arr(live.active_queue);
  const rows = arr(report.items);
  const summary = report.loaded ? (report.summary || {}) : (live.summary || {});
  const employeeOptions = arr(report.employee_options).length ? arr(report.employee_options) : arr(report.performers).map((x) => ({ value: x.employee || x.employee_username || x.employee_user_id || '', label: x.employee || x.employee_name || x.employee_username || 'Employee' })).filter((x) => x.value);
  const currentQueueId = current?.current_queue_item_id || '';
  const currentRow = useMemo(() => queue.find((q) => String(q.queue_item_id) === String(currentQueueId)) || queue[0] || null, [queue, currentQueueId]);
  const paused = /paused|pause/i.test(`${current?.status || ''} ${current?.mobile_command || ''}`);
  const stopped = /stop|stopped|completed|cancel|deleted/i.test(`${current?.status || ''} ${current?.mobile_command || ''} ${current?.command_type || ''}`);
  const uniqueCalls = useMemo(() => new Set(rows.map((l) => digits(l.phone) || String(l.candidate_id || '')).filter(Boolean)).size || Number(summary.unique_numbers || 0), [rows, summary.unique_numbers]);
  const aht = (summary.dialed || 0) ? Math.round(Number(summary.talktime_seconds || 0) / Number(summary.dialed || 1)) : 0;

  function prewarmProfileBand(candidateId, scopeRows = queue) {
    // CC26_91: no CRM profile prefetch. Mobile shows call; recruiter opens profile manually from table.
    return false;
  }

  async function refreshLive(mode = 'lite', fresh = false) {
    try {
      const base = mode === 'full' ? `/api/dialer/live-status` : `/api/dialer/live-status?lite=1&profile_watch=1`;
      const url = fresh ? `${base}${base.includes('?') ? '&' : '?'}_call=${Date.now()}` : base;
      const d = await api.get(url, { cacheTtlMs: fresh ? 0 : (mode === 'full' ? 15000 : 10000), allowStale: !fresh, timeoutMs: 12000, background: fresh });
      if (mode === 'full') setLive(d || {}); else setLive((old) => ({ ...old, sessions: arr(d.sessions), summary: { ...(old.summary || {}), ...(d.summary || {}) } }));
    } catch {}
  }

  useEffect(() => {
    refreshLive('full');
  }, []);

  // CC26_603: reports and Call Assistant update ONLY after a user action.
  // No 1.5-second revision checks; use the existing Update Details/Update Table buttons.

  useEffect(() => {
    // CC26_91: no automatic laptop tab opening from mobile/prepare events. Manual Open button only.
    return undefined;
  }, [current?.crm_open_profile_request_version, current?.current_candidate_id, stopped]);

  async function updateReportTable(options = {}) {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setBusy(true);
      setStatus('Updating Call Assistant table...');
    }
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (String(v || '').trim()) params.set(k, String(v).trim()); });
      if (!params.get('date_from') && !params.get('date_to') && !params.get('hours') && !params.get('minutes')) params.set('today', '1');
      const d = await api.get(`/api/dialer/reports?${params.toString()}`, { cacheTtlMs: 0, allowStale: false, timeoutMs: 30000 });
      setReport({ ...d, loaded: true });
      if (!silent) setStatus(`Updated ${arr(d.items).length} deduped call row(s). Recruiter filter and totals are now applied.`);
    } catch (e) {
      if (!silent) setStatus(e.message || 'Update table failed');
    } finally { if (!silent) setBusy(false); }
  }

  async function startDialing() {
    setBusy(true);
    try {
      const created = await api.post('/api/dialer/start-session', { section, limit: Number(limit || 50), next_call_gap_seconds: COUNTDOWN_SECONDS, instant_start: '1', start_from_crm: '1', mobile_auto_start: '1', command_source: 'crm_mobile_queue_only' }, { timeoutMs: 30000 });
      const cid = created?.session?.current_candidate_id || '';
      setStatus(cid ? 'Mobile calling started. CRM will not auto-open tabs. Click Open only if candidate picks.' : 'Mobile calling command sent.');
      await refreshLive('full');
    } catch (e) { setStatus(e.message || 'Start failed'); }
    finally { setBusy(false); }
  }
  async function pause() { if (!current?.session_id) return; await api.post('/api/dialer/pause-session', { session_id: current.session_id }); setStatus('Paused'); refreshLive('full'); }
  async function resume() { if (!current?.session_id) return; await api.post('/api/dialer/resume-session', { session_id: current.session_id }); setStatus('Resume command sent'); refreshLive('full'); }
  async function stop() { if (!current?.session_id) return; await api.post('/api/dialer/stop-session', { session_id: current.session_id }); setStatus('Stopped. Stopped. No auto profile opening is enabled.'); refreshLive('full'); }
  async function manual() {
    const phone = digits(manualPhone);
    if (phone.length !== 10) return setStatus('Enter a valid 10 digit phone number');
    setBusy(true);
    try {
      await api.post('/api/dialer/manual-call', { phone, next_call_gap_seconds: 0, instant_start: '1', command_source: 'call_assistant_manual_dialer_instant', call_source: 'crm_manual_or_profile_icon', source_mode: 'crm_manual_or_profile_icon' }, { timeoutMs: 12000 });
      setManualPhone(''); setStatus('Manual mobile call command sent. Paired phone will start immediately.'); refreshLive('full');
    } catch (e) { setStatus(e.message || 'Manual call failed'); }
    finally { setBusy(false); }
  }
  function showSyncToast(message = 'Application synced successfully') {
    setSyncToast(message);
    window.clearTimeout(showSyncToast._timer);
    showSyncToast._timer = window.setTimeout(() => setSyncToast(''), 2200);
  }
  function instantPairCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  // Explicit one-shot pairing check. The phone itself receives the paired code confirmation.
  async function checkMobilePairing() {
    try {
      const d = await api.get('/api/dialer/live-status?lite=1', { cacheTtlMs: 0, timeoutMs: 9000 });
      const sessions = arr(d.sessions);
      const synced = Boolean(d?.mobile_pair_active || d?.persistent_pairing) || sessions.some((row) => /application_sync/i.test(`${row.call_source || ''} ${row.source_mode || ''} ${row.live_status || ''}`));
      if (synced) { setLive((old) => ({ ...old, ...d, sessions })); setStatus('Application synced successfully.'); showSyncToast(); }
      else setStatus('Not paired yet. Enter the code on the phone and click Check Phone Pairing again.');
    } catch (error) { setStatus(error?.message || 'Pair check failed. Try manually again.'); }
  }
  async function pairCode() {
    const instantCode = instantPairCode();
    const provisional = { ok: true, pairing_code: instantCode, device_id: 'Connected', expires_at: '', cc26_371_frontend_instant: true };
    setPair(provisional);
    setStatus('Pair code shown instantly. Backend pairing save is completing in the background.');
    try {
      const d = await api.post('/api/dialer/pair-code', { client_pairing_code: instantCode });
      setPair({ ...d, pairing_code: d?.pairing_code || instantCode });
      setStatus('Pair code confirmed. Enter it in the Android app. The app will auto-sync immediately after pairing.');
      setStatus('Pair code saved. Enter it on the Android phone, then click Check Phone Pairing.');
    } catch (e) { setStatus(e.message || 'Pair code save failed. Generate a fresh code.'); }
  }

  return <Layout title="Call Assistant" subtitle="">
    <div className="row-actions top-gap-small"><button type="button" className="ghost-btn bounceable" onClick={checkMobilePairing}>Check Phone Pairing</button><button type="button" className="ghost-btn bounceable" onClick={async () => { await refreshLive('full', true); await updateReportTable(); }}>↻ Update Call Details</button><span className="mini-chip">Manual sync · no background refresh</span></div>
    <style>{`
      .assistant-stat-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin-top:6px}.assistant-stat-card{min-height:86px!important;border-radius:18px!important;padding:14px!important;pointer-events:none}.assistant-stat-card strong{display:block;font-size:34px!important;line-height:.95!important}.assistant-stat-card span,.assistant-stat-card small{font-weight:1000!important}.assistant-field{border:1px solid #bdd7ff;border-radius:15px;padding:12px 13px;font-weight:900;background:#fff;color:#132b4f;min-width:0}.assistant-command-btn{border:0;border-radius:18px;min-height:54px;padding:12px 14px;font-weight:1000;color:#fff!important;background:linear-gradient(135deg,#1b54ff,#2c7fff,#9148ff);box-shadow:0 14px 30px rgba(37,99,235,.22);display:inline-flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;text-align:center}.assistant-command-btn *{color:#fff!important;-webkit-text-fill-color:#fff!important;fill:#fff!important;stroke:#fff!important}.assistant-command-btn svg,.assistant-command-btn path{color:#fff!important;fill:#fff!important;stroke:#fff!important}.assistant-command-btn:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}.assistant-command-btn.green{background:linear-gradient(135deg,#0f8f76,#22bb63,#78d63f)}.assistant-command-btn.orange{background:linear-gradient(135deg,#ff7a21,#ff4b57,#ffb133)}.assistant-command-btn.danger{background:linear-gradient(135deg,#ff215e,#ff4e86,#ff8f5a)}.assistant-command-btn.blue{background:linear-gradient(135deg,#1b54ff,#2c7fff,#9148ff)}.assistant-stable-dock{min-height:74px;border:1px solid #b9d7ff;border-radius:20px;background:linear-gradient(135deg,#fff,#eef7ff,#fff7fb);box-shadow:0 12px 30px rgba(37,99,235,.10);padding:14px 16px;display:grid;grid-template-columns:minmax(260px,1fr) auto;gap:14px;align-items:center;margin-top:12px}.assistant-stable-dock b{display:block;font-size:18px;color:#132b4f}.assistant-stable-dock small{display:block;color:#4f6584;font-weight:900}.assistant-pill{display:inline-flex;padding:8px 12px;border-radius:999px;font-weight:1000;font-size:12px;background:#ecfeff;color:#0e7490;margin-right:8px;margin-bottom:8px}.assistant-title{font-size:19px;font-weight:1000;color:#132b4f}.assistant-table-wrap{overflow:auto;max-height:52vh}.assistant-table{width:100%;border-collapse:separate;border-spacing:0 8px;min-width:1150px}.assistant-table th{text-align:left;font-size:12px;color:#36547a;text-transform:uppercase;white-space:nowrap}.assistant-table td{background:#ffffffcc;border-top:1px solid #d8e7ff;border-bottom:1px solid #d8e7ff;padding:10px;font-weight:850;color:#14345a;white-space:nowrap}.assistant-table td:first-child{border-left:1px solid #d8e7ff;border-radius:16px 0 0 16px}.assistant-table td:last-child{border-right:1px solid #d8e7ff;border-radius:0 16px 16px 0}.assistant-link{border:0;background:transparent;color:#2563eb;font-weight:1000;cursor:pointer}.assistant-open-btn{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:7px 11px;background:linear-gradient(135deg,#eaf7ff,#eef2ff);box-shadow:0 8px 18px rgba(37,99,235,.12)}.assistant-filter-grid{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin-top:12px}.assistant-update-btn{border:0;border-radius:18px;padding:14px 18px;min-height:54px;font-weight:1000;color:#fff;background:linear-gradient(135deg,#ff7a21,#ff315f,#7c3aed);box-shadow:0 18px 42px rgba(236,72,153,.28);animation:assistantGlow 1.8s ease-in-out infinite alternate;cursor:pointer}.assistant-update-btn:disabled{opacity:.6}.record-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#f0fdf4;color:#15803d;font-weight:1000;font-size:12px}.record-missing{background:#fff1f2;color:#be123c}.mode-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eef7ff;color:#2563eb;font-weight:1000;font-size:12px}.pair-premium-card{position:relative;overflow:hidden;border-radius:28px!important;background:radial-gradient(circle at 8% 0%,rgba(37,99,235,.20),transparent 28%),radial-gradient(circle at 92% 0%,rgba(16,185,129,.18),transparent 30%),linear-gradient(135deg,#ffffff,#eef7ff,#f8fbff)!important;border:1px solid rgba(37,99,235,.24)!important;box-shadow:0 22px 60px rgba(15,23,42,.12)!important}.pair-premium-card:before{content:"";position:absolute;inset:-80px auto auto -70px;width:220px;height:220px;background:rgba(14,165,233,.12);border-radius:999px;pointer-events:none;z-index:0}.pair-premium-card>*{position:relative;z-index:1}.pair-premium-card .assistant-command-btn{position:relative;z-index:2;pointer-events:auto}.pair-premium-head{display:flex;align-items:center;justify-content:space-between;gap:14px;position:relative}.pair-premium-badge{display:inline-flex;align-items:center;gap:8px;background:#ecfeff;color:#0e7490;border:1px solid #bae6fd;border-radius:999px;padding:9px 13px;font-weight:1000}.pair-premium-sub{font-weight:900;color:#526b8c;margin-top:8px;line-height:1.45;position:relative}.pair-code-box{margin-top:16px;border:1px solid rgba(37,99,235,.18);background:linear-gradient(135deg,#f8fbff,#ffffff);border-radius:22px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;position:relative}.pair-code-digits{font-size:38px;letter-spacing:7px;font-weight:1000;color:#1d4ed8;text-shadow:0 8px 18px rgba(37,99,235,.12)}.pair-auto-status{margin-top:13px;padding:12px 14px;border-radius:18px;background:linear-gradient(135deg,#ecfdf5,#eff6ff);border:1px solid #bfdbfe;color:#1e3a8a;font-weight:1000;position:relative}.sync-toast{position:fixed;left:50%;top:96px;z-index:9999;transform:translateX(-50%) scale(.92);background:linear-gradient(135deg,#10b981,#22c55e,#0ea5e9);color:#fff;padding:17px 24px;border-radius:24px;box-shadow:0 25px 60px rgba(16,185,129,.34);font-weight:1000;animation:syncPop 2.15s ease forwards}.sync-toast small{display:block;font-weight:900;opacity:.92;margin-top:2px}.sync-live-pill{background:${appSynced?'#dcfce7':'#fff7ed'};color:${appSynced?'#15803d':'#c2410c'};border:1px solid ${appSynced?'#86efac':'#fed7aa'};border-radius:999px;padding:8px 12px;font-weight:1000}.assistant-stat-card small{display:none!important}.assistant-simple-card{padding:14px 16px!important;border-radius:22px!important}.assistant-simple-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.assistant-simple-copy{display:flex;align-items:center;gap:10px;min-width:0}.assistant-simple-icon{width:42px;height:42px;border-radius:15px;background:linear-gradient(135deg,#e0f2fe,#dcfce7);display:grid;place-items:center;color:#0877c9;font-size:20px;flex:0 0 auto}.assistant-simple-title{font-size:18px;font-weight:1000;color:#132b4f}.assistant-simple-sub{font-size:12px;font-weight:850;color:#64748b;margin-top:2px}.assistant-toolbar{display:grid;grid-template-columns:minmax(220px,1.4fr) minmax(160px,.75fr) minmax(140px,.6fr) auto auto;gap:9px;align-items:center;margin-top:12px}.assistant-toolbar .assistant-field{min-height:46px}.assistant-more-btn{border:1px solid #bfd8ff;background:#fff;color:#1d4ed8;border-radius:14px;min-height:46px;padding:0 14px;font-weight:1000;cursor:pointer}.assistant-advanced{margin-top:10px;padding:12px;border-radius:16px;background:#f8fbff;border:1px dashed #bfd8ff}.assistant-history-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}.assistant-table.simple{min-width:900px}.assistant-table.simple th{font-size:11.5px}.assistant-table.simple td{padding:9px 10px}.assistant-empty{padding:22px!important;text-align:center!important;color:#64748b!important}@media(max-width:980px){.assistant-toolbar{grid-template-columns:1fr 1fr}.assistant-toolbar .assistant-search-main{grid-column:1/-1}}@keyframes syncPop{0%{opacity:0;transform:translateX(-50%) scale(.82) translateY(-12px)}12%{opacity:1;transform:translateX(-50%) scale(1.05) translateY(0)}75%{opacity:1;transform:translateX(-50%) scale(1)}100%{opacity:0;transform:translateX(-50%) scale(.88) translateY(-8px)}}@keyframes assistantGlow{from{filter:saturate(1);transform:translateY(0)}to{filter:saturate(1.35);transform:translateY(-1px)}}@media(max-width:1280px){.assistant-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.assistant-filter-grid{grid-template-columns:repeat(3,minmax(120px,1fr))}}@media(max-width:760px){.assistant-stat-grid,.assistant-filter-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.assistant-stable-dock{grid-template-columns:1fr}}
    `}</style>
    <div className="assistant-stat-grid fade-up"><StatCard label="Dialed Calls" value={summary.dialed_calls || summary.dialed || 0} note="Deduped outgoing attempts" tone="orange"/><StatCard label="Connected Calls" value={summary.connected_calls || summary.connected || 0} note="Answered calls" tone="green"/><StatCard label="Talk Time" value={fmt(summary.talktime_seconds || 0)} note="Total talktime" tone="purple"/><StatCard label="Missed Calls" value={summary.missed_calls || summary.missed || 0} note="Missed incoming calls" tone="red"/><StatCard label="Incoming Calls" value={summary.incoming_calls || summary.incoming || 0} note="Incoming proof" tone="teal"/><StatCard label="Outgoing Calls" value={summary.outgoing_calls || summary.outgoing || 0} note="Outgoing proof" tone="orange"/><StatCard label="Unique Calls" value={summary.unique_calls || uniqueCalls} note="Unique phone numbers" tone="teal"/></div>
    {syncToast ? <div className="sync-toast">{syncToast}<small>Manual/profile calls are ready on the paired phone.</small></div> : null}

    <div style={{...card,marginTop:14}} className="assistant-simple-card">
      <div className="assistant-simple-head">
        <div className="assistant-simple-copy">
          <div className="assistant-simple-icon">📱</div>
          <div><div className="assistant-simple-title">Phone Connection</div><div className="assistant-simple-sub">{appSynced ? 'Connected — calls will sync automatically.' : 'Pair once. It stays connected until logout.'}</div></div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:9,flexWrap:'wrap'}}>
          <div className="sync-live-pill">{appSynced ? '● Connected' : '○ Not connected'}</div>
          <Btn onClick={pairCode} disabled={busy}>{appSynced ? 'New Pair Code' : 'Pair Phone'}</Btn>
        </div>
      </div>
      {pair ? <div className="pair-code-box"><div><div style={{fontSize:11,fontWeight:1000,color:'#64748b'}}>PAIR CODE</div><div className="pair-code-digits">{pair.pairing_code}</div></div><div className="pair-premium-badge">Enter in app once</div></div> : null}
    </div>

    <div style={{...card,marginTop:14}} className="assistant-simple-card">
      <div className="assistant-simple-head">
        <div><div className="assistant-simple-title">Calls</div><div className="assistant-simple-sub">Search or filter only when you need it.</div></div>
        <span className="record-pill">{rows.length} shown</span>
      </div>
      <div className="assistant-toolbar">
        <input className="assistant-field assistant-search-main" placeholder="Search candidate, phone or ID" value={filters.q} onChange={(e)=>setFilters({...filters,q:e.target.value})}/>
        <select className="assistant-field" value={filters.employee} onChange={(e)=>setFilters({...filters,employee:e.target.value})}><option value="">Everyone</option>{employeeOptions.map((x,i)=><option key={`${x.value || x.username || i}`} value={x.value || x.username || x.user_id || x.label}>{x.label || x.full_name || x.username || x.value}</option>)}</select>
        <select className="assistant-field" value={filters.status} onChange={(e)=>setFilters({...filters,status:e.target.value})}><option value="">Any status</option><option>Connected</option><option>Not Connected</option><option>Calling</option><option>Missed</option></select>
        <button className="assistant-more-btn" type="button" onClick={()=>setAdvancedFilters((v)=>!v)}>{advancedFilters ? 'Less' : 'More filters'}</button>
        <button className="assistant-update-btn" disabled={busy} onClick={updateReportTable}>{'Refresh'}</button>
      </div>
      {advancedFilters ? <div className="assistant-advanced"><div className="assistant-filter-grid">
        <input className="assistant-field" placeholder="Phone number" value={filters.phone} onChange={(e)=>setFilters({...filters,phone:e.target.value})}/>
        <input className="assistant-field" placeholder="Candidate name" value={filters.name} onChange={(e)=>setFilters({...filters,name:e.target.value})}/>
        <select className="assistant-field" value={filters.source} onChange={(e)=>setFilters({...filters,source:e.target.value})}><option value="">Any call mode</option><option value="crm_auto_dialer">Auto Dialer</option><option value="manual_dialer">Manual Dialer</option><option value="global_manual_dialer">Global Manual</option></select>
        <input className="assistant-field" type="date" value={filters.date_from} onChange={(e)=>setFilters({...filters,date_from:e.target.value})}/>
        <input className="assistant-field" type="date" value={filters.date_to} onChange={(e)=>setFilters({...filters,date_to:e.target.value})}/>
        <input className="assistant-field" placeholder="Last hours e.g. 1" value={filters.hours} onChange={(e)=>setFilters({...filters,hours:e.target.value})}/>
        <button className="assistant-field" type="button" onClick={()=>setFilters({ q:'', phone:'', name:'', employee:'', status:'', source:'', date_from:'', date_to:'', duration_min:'', duration_max:'', hours:'' })}>Clear all</button>
      </div></div> : null}
    </div>

    <div style={{...card,marginTop:14}} className="assistant-simple-card">
      <div className="assistant-history-head"><div className="assistant-simple-title">Call History</div><div className="assistant-simple-sub">Live phone records</div></div>
      <div className="assistant-table-wrap"><table className="assistant-table simple"><thead><tr><th>Time</th><th>Candidate</th><th>Phone</th><th>Employee</th><th>Status</th><th>Talk Time</th><th>Count</th><th>Mode</th><th></th></tr></thead><tbody>{rows.slice(0,500).map((l,i)=>{const candidateId=pick(l,['candidate_id','candidateId','cid']); return <tr key={l.call_log_id||l.id||i}><td>{String(l.call_started_at||l.created_at||'').replace('T',' ').slice(0,19) || '-'}</td><td>{l.candidate_name||l.full_name||candidateId||'-'}</td><td>{l.phone||'-'}</td><td>{l._employee||l.employee_name||l.employee_username||'-'}</td><td>{l._status||l.status||l.call_status||'-'}</td><td>{fmt(callTalkSeconds(l))}</td><td>{l.number_call_count || 1}</td><td><span className="mode-pill">{l.call_source||l.source_mode||l.direction||'call'}</span></td><td><button className="assistant-link assistant-open-btn" onClick={()=>openProfile(candidateId)}>Open</button></td></tr>})}{!rows.length?<tr><td colSpan="9" className="assistant-empty">No calls yet. New mobile calls will appear automatically.</td></tr>:null}</tbody></table></div>
    </div>
  </Layout>;
}
