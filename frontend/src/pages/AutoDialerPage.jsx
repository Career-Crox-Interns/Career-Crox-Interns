import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { getPollingLeaderSnapshot } from '../lib/tabLeader';

const queueKey = 'careerCroxAutoDialerQueue:v1';
const arr = (x) => Array.isArray(x) ? x : [];
const fmt = (s = 0) => { const n = Number(s || 0); const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60); const x = n % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : m ? `${m}m ${x}s` : `${x}s`; };
const digits = (v = '') => String(v || '').replace(/\D+/g, '').slice(-10);
const pick = (r = {}, keys = []) => { for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return '-'; };
const nameOf = (r = {}) => pick(r, ['full_name', 'candidate_name', 'name', 'candidate']) || 'Candidate';
const cidOf = (r = {}) => pick(r, ['candidate_id', 'id']) || '-';
const noteOf = (r = {}) => pick(r, ['last_note', 'notes', 'data_notes', 'follow_up_note', 'feedback']);
const processOf = (r = {}) => pick(r, ['process', 'jd_name', 'jd', 'client_name']);
const searchBlob = (r = {}) => Object.values(r || {}).map((v) => String(v || '').toLowerCase()).join(' ');
const directProfileUrl = (id) => `/candidate/${encodeURIComponent(id)}`;

function IconPhone() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7.3 3.8h2.2c.5 0 .9.3 1.1.8l1.1 3.2c.2.5.1 1-.3 1.4l-1.4 1.3a13.4 13.4 0 0 0 3.7 3.7l1.3-1.4c.4-.4.9-.5 1.4-.3l3.2 1.1c.5.2.8.6.8 1.1v2.2c0 .7-.6 1.3-1.3 1.3A16.1 16.1 0 0 1 6 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>; }
function IconEye() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2"/></svg>; }
function IconWhatsApp() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M19.1 4.9A9.7 9.7 0 0 0 3.9 16.8L2.8 21.2l4.6-1.1a9.7 9.7 0 0 0 4.7 1.2h.1a9.7 9.7 0 0 0 6.9-16.4Zm-7 14.5h-.1a7.7 7.7 0 0 1-3.9-1.1l-.3-.2-2.7.7.7-2.6-.2-.3a7.7 7.7 0 1 1 6.5 3.5Z" fill="currentColor"/><path d="M16.4 13.7c-.2-.1-1.2-.6-1.4-.7-.2-.1-.4-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.4-.9a5.1 5.1 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4c.1-.1.1-.3 0-.4L9 8.9c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.8s.8 2.1.9 2.2c.1.1 1.6 2.5 3.9 3.5 2.3 1 2.3.7 2.7.6.4-.1 1.3-.5 1.5-1 .2-.4.2-.8.1-1 0-.1-.2-.2-.4-.3Z" fill="currentColor"/></svg>; }
function IconPlay() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" /></svg>; }
function IconPause() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M7 5h3.5v14H7V5Zm6.5 0H17v14h-3.5V5Z" fill="currentColor" /></svg>; }
function IconRefresh() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M20 12a8 8 0 0 1-13.7 5.6M4 12A8 8 0 0 1 17.7 6.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IconStop() { return <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>; }
function IconNote() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 4h9l3 3v13H6V4Z" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M9 11h6M9 15h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>; }
function IconNext() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function IconPrev() { return <svg viewBox="0 0 24 24" width="18" height="18"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>; }

function StatCard({ icon, label, value, note, tone }) {
  return <div className={`cc-stat ${tone}`}><span className="cc-stat-icon">{icon}</span><div><b>{label}</b><strong>{value}</strong><small>{note}</small></div></div>;
}
function IconButton({ icon, label, tone = 'blue', onClick, disabled }) {
  return <button type="button" className={`cc-icon-btn ${tone}`} onClick={onClick} disabled={disabled}>{icon}<span>{label}</span></button>;
}
function MiniOpenButton({ onClick, children = 'Open' }) {
  return <button type="button" className="mini-btn call bounceable modern-icon-btn modern-eye-btn cc-mini-open" onClick={onClick}><IconEye /> {children}</button>;
}

export default function AutoDialerPage() {
  const [rows, setRows] = useState([]);
  const [session, setSession] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [manualPhone, setManualPhone] = useState('');
  const [manualName, setManualName] = useState('');
  const [queueSearch, setQueueSearch] = useState('');
  const [liveSearch, setLiveSearch] = useState('');
  const [page, setPage] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [countdown, setCountdown] = useState(5);
  const openedTabsRef = useRef(new Set());

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(queueKey) || localStorage.getItem(queueKey);
      const parsed = JSON.parse(raw || '{}');
      const items = arr(parsed.items);
      setRows(items);
      setStatus(items.length ? `${items.length} profiles loaded from CRM selection` : 'No queue loaded');
    } catch { setRows([]); }
  }, []);

  const currentId = String(session?.current_candidate_id || '');
  const liveText = `${session?.status || ''} ${session?.mobile_command || ''} ${session?.command_type || ''} ${session?.live_status || ''}`;
  const running = /running|start|prepare|calling/i.test(liveText) && !/paused|stopped|completed/i.test(liveText);
  const paused = /paused|pause/i.test(liveText);
  const currentRow = useMemo(() => rows.find((r) => String(cidOf(r)) === currentId) || rows[0] || null, [rows, currentId]);
  const connected = logs.filter((x) => String(x.status || '').toLowerCase().includes('connect')).length;
  const talk = logs.reduce((s, x) => s + Number(x.talktime_seconds || x.duration_seconds || 0), 0);
  const aht = logs.length ? Math.round(talk / logs.length) : 0;
  const uniqueCalls = useMemo(() => new Set(logs.map((l) => digits(l.phone || l.number || l.mobile || '') || String(pick(l, ['candidate_id', 'candidateId', 'cid']))).filter((v) => v && v !== '-')).size, [logs]);
  const queueFiltered = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return q ? rows.filter((r) => searchBlob(r).includes(q)) : rows;
  }, [rows, queueSearch]);
  const pageRows = useMemo(() => queueFiltered.slice(page * 20, page * 20 + 20), [queueFiltered, page]);
  const pages = Math.max(1, Math.ceil(queueFiltered.length / 20));
  const liveQ = liveSearch.trim().toLowerCase();
  const filteredLogs = useMemo(() => liveQ ? logs.filter((l) => searchBlob(l).includes(liveQ)) : logs, [logs, liveQ]);

  useEffect(() => { setPage(0); }, [queueSearch]);
  useEffect(() => {
    if (!running) { setCountdown(5); return undefined; }
    const t = window.setInterval(() => setCountdown((v) => (v <= 1 ? 5 : v - 1)), 1000);
    return () => window.clearInterval(t);
  }, [running, currentId]);

  function openCandidateTab(candidateId, reason = 'manual') {
    if (!candidateId || candidateId === '-') return false;
    const key = `${candidateId}:${reason}`;
    if (reason !== 'manual' && openedTabsRef.current.has(key)) return true;
    try {
      const win = window.open(directProfileUrl(candidateId), '_blank', 'noopener,noreferrer');
      if (win) { openedTabsRef.current.add(key); return true; }
    } catch {}
    return false;
  }
  function openWhatsApp(row = currentRow) {
    const p = digits(row?.phone || row?.number || row?.mobile || row?.candidate_phone || session?.current_phone || '');
    if (!p) return setStatus('Phone number not available');
    window.open(`https://wa.me/91${p}`, '_blank', 'noopener,noreferrer');
  }

  async function refresh(id = session?.session_id, mode = 'full') {
    try {
      const lite = mode === 'lite';
      const endpoint = lite ? '/api/dialer/live-status?lite=1' : '/api/dialer/live-status';
      const d = await api.get(endpoint, { cacheTtlMs: lite ? 3500 : 12000, allowStale: true, timeoutMs: 14000 });
      const s = arr(d.sessions).find((x) => !id || String(x.session_id) === String(id)) || arr(d.sessions)[0] || null;
      setSession(s);
      if (!lite) setLogs(arr(d.recent_calls));
      setStatus(s?.live_status || s?.status || (lite ? 'Live state checked' : 'Refreshed'));
      const nextId = s?.current_candidate_id;
      if (nextId && nextId !== currentId && running) openCandidateTab(nextId, `auto-${s?.command_version || Date.now()}`);
    } catch (e) { setStatus(e.message || 'Refresh failed'); }
  }

  useEffect(() => {
    if (!session?.session_id) return undefined;
    let active = true;
    let timer = null;
    const tick = async () => {
      if (!active) return;
      const leader = getPollingLeaderSnapshot();
      const visibleLeader = Boolean(leader?.isLeader) && !(typeof document !== 'undefined' && document.hidden);
      if (visibleLeader) await refresh(session.session_id, 'lite');
      timer = window.setTimeout(tick, visibleLeader ? 5000 : 60000);
    };
    timer = window.setTimeout(tick, 5000);
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [session?.session_id, running, currentId]);

  async function startQueue() {
    if (!rows.length) return setStatus('Load profiles from Candidates or Interviews first');
    const first = rows[0];
    openCandidateTab(cidOf(first), 'start-click');
    setBusy(true);
    try {
      const items = rows.map((r) => ({
        candidate_id: cidOf(r), full_name: nameOf(r), name: nameOf(r), phone: digits(r.phone || r.number || r.mobile || r.candidate_phone),
        process: processOf(r), location: r.location || r.preferred_location || '', qualification: r.qualification || '',
        profile_number: r.profile_number || r.profile_no || r.sr_no || r.source_sr_no || '', imn_candidate_id: r.imn_candidate_id || r.imn_id || '',
        last_note: noteOf(r), interview_date: r.interview_date || r.interview_datetime || ''
      }));
      const created = await api.post('/api/dialer/start-session', { section: 'Selected Profiles', items, next_call_gap_seconds: 5, start_from_crm: '0', mobile_auto_start: '0' }, { timeoutMs: 24000 });
      setSession(created.session);
      const sessionId = created.session?.session_id;
      if (!sessionId) throw new Error('Session created without session ID');
      const d = await api.post('/api/dialer/resume-session', { session_id: sessionId }, { timeoutMs: 18000 });
      setSession(d.session || created.session);
      setStatus('Profile opened and mobile command sent');
      await refresh(sessionId);
    } catch (e) { setStatus(e.message || 'Start failed'); }
    finally { setBusy(false); }
  }
  async function pause() { if (!session?.session_id) return; await api.post('/api/dialer/pause-session', { session_id: session.session_id }); setStatus('Paused'); refresh(session.session_id); }
  async function resume() { if (!session?.session_id) return startQueue(); await api.post('/api/dialer/resume-session', { session_id: session.session_id }); setStatus('Resume command sent'); refresh(session.session_id); }
  async function stop() { if (!session?.session_id) return; await api.post('/api/dialer/stop-session', { session_id: session.session_id }); setStatus('Stopped'); refresh(session.session_id); }
  async function manualCall(row = null) {
    const p = digits(row ? (row.phone || row.number || row.mobile || row.candidate_phone) : manualPhone);
    if (!p || p.length < 10) return setStatus('Enter a valid phone number');
    const candidateId = row ? cidOf(row) : '';
    if (candidateId && candidateId !== '-') openCandidateTab(candidateId, 'manual-call-click');
    setBusy(true);
    try {
      const d = await api.post('/api/dialer/manual-call', { phone: p, candidate_name: row ? nameOf(row) : manualName, candidate_id: candidateId, process: row ? processOf(row) : 'Manual Dialer', next_call_gap_seconds: 5 }, { timeoutMs: 18000 });
      setSession(d.session);
      const cid = d.session?.current_candidate_id;
      if (cid && cid !== '-' && !candidateId) openCandidateTab(cid, 'manual-match-click');
      setStatus('Profile opened and mobile call command sent');
      await refresh(d.session?.session_id);
    } catch (e) { setStatus(e.message || 'Manual call failed'); }
    finally { setBusy(false); }
  }
  async function saveNote(body = noteText) {
    const id = cidOf(currentRow || {});
    const text = String(body || '').trim();
    if (!id || id === '-' || !text) return;
    try { await api.post('/api/notes', { candidate_id: id, body: text, note: text, source: 'auto_dialer' }); setNoteText(''); setStatus('Note saved'); }
    catch (e) { setStatus(e.message || 'Note save failed'); }
  }

  return <Layout title="Auto Dialer" subtitle="">
    <style>{`
      .cc-page{display:flex;flex-direction:column;gap:14px}.cc-panel{background:linear-gradient(135deg,#ffffff,#f7fbff);border:1px solid #d8e7ff;border-radius:22px;box-shadow:0 14px 40px rgba(37,99,235,.08);padding:14px}.cc-panel-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}.cc-title{font-size:20px;font-weight:1000;color:#15294b;letter-spacing:.1px}.cc-sub{font-size:12px;font-weight:850;color:#64748b}.cc-search{border:1px solid #cfe2ff;border-radius:16px;background:#fff;color:#162f55;font-weight:850;min-height:42px;padding:10px 14px;outline:none}.cc-table-wrap{overflow:auto}.cc-table{width:100%;border-collapse:separate;border-spacing:0}.cc-table th{font-size:12px;text-transform:uppercase;letter-spacing:.45px;color:#36547a;text-align:left;background:#f8fbff;border-top:1px solid #dce9ff;border-bottom:1px solid #dce9ff;padding:12px}.cc-table td{font-weight:850;color:#14345a;border-bottom:1px solid #e6f0ff;padding:12px;background:#fff}.cc-table tr:hover td{background:#f4f9ff}.cc-link{border:0;background:transparent;color:#155eef;font-weight:1000;cursor:pointer}.cc-name{display:flex;align-items:center;gap:10px}.cc-avatar{width:34px;height:34px;border-radius:999px;background:linear-gradient(135deg,#e0e7ff,#dbeafe);display:grid;place-items:center;font-weight:1000;color:#3156cc}.cc-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.cc-stat{display:flex;gap:13px;align-items:center;border:1px solid #e0e9fb;border-radius:20px;background:#fff;box-shadow:0 10px 26px rgba(37,99,235,.07);padding:13px}.cc-stat-icon{width:52px;height:52px;border-radius:16px;display:grid;place-items:center}.cc-stat b{display:block;font-size:13px;color:#2c3f62}.cc-stat strong{display:block;font-size:24px;color:#132b4f;line-height:1.05}.cc-stat small{display:block;color:#64748b;font-size:11px;font-weight:850}.cc-stat.orange .cc-stat-icon{background:#fff0df;color:#f97316}.cc-stat.green .cc-stat-icon{background:#e6f8ed;color:#16a34a}.cc-stat.red .cc-stat-icon{background:#ffe9e9;color:#ef4444}.cc-stat.blue .cc-stat-icon{background:#eaf2ff;color:#2563eb}.cc-stat.purple .cc-stat-icon{background:#f1e9ff;color:#7c3aed}.cc-main-grid{display:grid;grid-template-columns:1.1fr .75fr;gap:14px}.cc-profile{display:grid;grid-template-columns:96px 1fr auto;gap:14px;align-items:center}.cc-photo{width:82px;height:82px;border-radius:999px;background:linear-gradient(135deg,#c7d2fe,#dbeafe);display:grid;place-items:center;font-size:28px;font-weight:1000;color:#2957df;position:relative}.cc-photo:after{content:'';position:absolute;right:7px;bottom:7px;width:14px;height:14px;background:#22c55e;border:3px solid #fff;border-radius:999px}.cc-meta-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:10px}.cc-meta-label{font-size:11px;color:#64748b;font-weight:850}.cc-meta-value{font-size:13px;color:#14345a;font-weight:1000}.cc-opened{display:inline-flex;align-items:center;gap:7px;border:1px solid #c9f4d4;background:#eefcf1;color:#15803d;padding:8px 12px;border-radius:12px;font-weight:1000}.cc-countdown{display:grid;place-items:center;border:1px solid #d8e7ff;border-radius:18px;background:linear-gradient(135deg,#f8fbff,#eef6ff);min-height:102px}.cc-countdown small{font-weight:900;color:#36547a}.cc-countdown strong{font-size:34px;color:#155eef}.cc-controls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cc-icon-btn{border:1px solid #d8e7ff;border-radius:14px;min-height:48px;background:#fff;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:1000;cursor:pointer;box-shadow:0 8px 20px rgba(37,99,235,.06);transition:transform .15s ease,box-shadow .15s ease}.cc-icon-btn:hover{transform:translateY(-1px);box-shadow:0 12px 24px rgba(37,99,235,.12)}.cc-icon-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}.cc-icon-btn.blue{color:#155eef;background:#f7fbff}.cc-icon-btn.green{color:#16a34a;background:#f2fff6}.cc-icon-btn.orange{color:#f97316;background:#fff8f0}.cc-icon-btn.red{color:#ef4444;background:#fff5f5}.cc-upload-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}.cc-file-line{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #e1ecff;border-radius:14px;padding:10px 12px;font-weight:900}.cc-file-line.good{color:#15803d;background:#f0fdf4}.cc-preset{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cc-preset button{border:1px solid #d8e7ff;border-radius:999px;background:#fff;padding:8px 11px;font-weight:900;color:#2f4d79;cursor:pointer}.cc-live-row td{background:#edf6ff!important;outline:1px solid #86b7ff}.cc-mini-open{display:inline-flex!important;align-items:center!important;gap:6px!important;width:auto!important;min-height:34px!important;border-radius:12px!important;padding:8px 11px!important}.cc-state-line{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cc-chip{display:inline-flex;border:1px solid #cde8ff;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:1000;color:#0e7490;background:#ecfeff}.cc-status{font-weight:900;color:#36547a;margin-top:8px}@media(max-width:1280px){.cc-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.cc-main-grid{grid-template-columns:1fr}.cc-profile{grid-template-columns:80px 1fr}.cc-controls{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:800px){.cc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-meta-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cc-upload-row{grid-template-columns:1fr}}
    `}</style>
    <div className="cc-page">
      <div className="cc-panel">
        <div className="cc-panel-head"><div><div className="cc-title">Candidates</div><div className="cc-sub">Candidate ID, interview ID, notes, interview date and process</div></div><input className="cc-search" value={queueSearch} onChange={(e)=>setQueueSearch(e.target.value)} placeholder="Search by Candidate ID, Interview ID or Name..." /></div>
        <div className="cc-table-wrap"><table className="cc-table"><thead><tr><th>SR</th><th>Candidate ID</th><th>Interview ID</th><th>Notes</th><th>Interview Date</th><th>Process</th><th>Name</th><th>Resume</th><th>Recording</th><th>Action</th></tr></thead><tbody>{pageRows.slice(0,5).map((r,i)=>{const real=page*20+i; const cid=cidOf(r); return <tr key={`${cid}-${real}`} className={String(cid)===currentId?'cc-live-row':''}><td>{real+1}</td><td><button className="cc-link" onClick={()=>openCandidateTab(cid,'manual')}>{cid}</button></td><td>{pick(r,['interview_id','imn_candidate_id','imn_id'])}</td><td>{noteOf(r)}</td><td>{pick(r,['interview_date','interview_datetime'])}</td><td>{processOf(r)}</td><td><div className="cc-name"><span className="cc-avatar">{String(nameOf(r)).split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}</span>{nameOf(r)}</div></td><td><span className="record-pill">{pick(r,['resume_filename','resume']) !== '-' ? 'Ready' : '-'}</span></td><td><span className="record-pill record-missing">{pick(r,['recording_filename','recording']) !== '-' ? 'Ready' : '-'}</span></td><td><IconButton icon={<IconPhone/>} label="Mobile" tone="blue" onClick={()=>manualCall(r)} disabled={busy}/></td></tr>})}{!pageRows.length?<tr><td colSpan="10">No profiles loaded.</td></tr>:null}</tbody></table></div>
      </div>

      <div className="cc-stats"><StatCard icon={<IconPhone/>} label="Dialed" value={logs.length} note="Mobile calls" tone="orange"/><StatCard icon={<IconPhone/>} label="Connected" value={connected} note="Picked calls" tone="green"/><StatCard icon={<IconStop/>} label="Not Connected" value={Math.max(0, logs.length-connected)} note="No pickup" tone="red"/><StatCard icon={<IconRefresh/>} label="Talk Time" value={fmt(talk)} note="Total duration" tone="blue"/><StatCard icon={<IconNote/>} label="AHT" value={fmt(aht)} note="Average handling" tone="purple"/></div>

      <div className="cc-main-grid">
        <div className="cc-panel">
          <div className="cc-panel-head"><div><div className="cc-title">Current Profile <span className="cc-sub">(Opened Automatically)</span></div></div><span className="cc-opened">✓ CRM Profile Ready</span></div>
          {currentRow ? <div className="cc-profile"><div className="cc-photo">{String(nameOf(currentRow)).split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}</div><div><h2 style={{margin:'0 0 4px',color:'#132b4f'}}>{nameOf(currentRow)}</h2><div className="cc-meta-grid"><div><div className="cc-meta-label">Candidate ID</div><div className="cc-meta-value">{cidOf(currentRow)}</div></div><div><div className="cc-meta-label">Interview ID</div><div className="cc-meta-value">{pick(currentRow,['interview_id','imn_candidate_id','imn_id'])}</div></div><div><div className="cc-meta-label">Interview Date</div><div className="cc-meta-value">{pick(currentRow,['interview_date','interview_datetime'])}</div></div><div><div className="cc-meta-label">Status</div><div className="cc-meta-value">{session?.live_status || 'Open'}</div></div></div><div style={{marginTop:10}}><div className="cc-meta-label">Notes</div><div className="cc-meta-value">{noteOf(currentRow)}</div></div><div style={{marginTop:10}}><div className="cc-meta-label">Process</div><div className="cc-meta-value">{processOf(currentRow)}</div></div></div><MiniOpenButton onClick={()=>openCandidateTab(cidOf(currentRow),'manual')}>View Profile</MiniOpenButton></div> : <div>No profile selected.</div>}
          <div className="cc-preset">{['Interested','Call back','Busy','Not reachable','Wrong number','Follow up','Not interested'].map((x)=><button key={x} onClick={()=>saveNote(x)}>{x}</button>)}</div>
          <div style={{display:'flex',gap:8,marginTop:10}}><input className="cc-search" style={{flex:1}} value={noteText} onChange={(e)=>setNoteText(e.target.value)} placeholder="Add CRM note for current profile"/><IconButton icon={<IconNote/>} label="Save Note" onClick={()=>saveNote()} disabled={!noteText.trim()} tone="blue"/></div>
        </div>

        <div style={{display:'grid',gap:14}}>
          <div className="cc-panel cc-countdown"><small>Next call in</small><strong>{String(countdown).padStart(2,'0')}s</strong><span className="cc-chip">{running ? 'Running' : paused ? 'Paused' : 'Ready'}</span></div>
          <div className="cc-panel"><div className="cc-title" style={{marginBottom:10}}>Dialer Controls</div><div className="cc-controls"><IconButton icon={<IconRefresh/>} label="Sync" onClick={()=>refresh(session?.session_id)} disabled={busy} tone="blue"/><IconButton icon={<IconPlay/>} label="Start" onClick={startQueue} disabled={busy || running || !rows.length} tone="green"/><IconButton icon={<IconPause/>} label="Pause" onClick={pause} disabled={!session?.session_id || paused} tone="orange"/><IconButton icon={<IconStop/>} label="Stop" onClick={stop} disabled={!session?.session_id} tone="red"/></div><div className="cc-controls" style={{marginTop:10}}><IconButton icon={<IconEye/>} label="Profile" onClick={()=>openCandidateTab(cidOf(currentRow),'manual')} disabled={!currentRow} tone="blue"/><IconButton icon={<IconWhatsApp/>} label="WhatsApp" onClick={()=>openWhatsApp(currentRow)} disabled={!currentRow} tone="green"/><IconButton icon={<IconPrev/>} label="Prev" onClick={()=>setPage(Math.max(0,page-1))} disabled={page<=0} tone="blue"/><IconButton icon={<IconNext/>} label="Next" onClick={()=>setPage(Math.min(pages-1,page+1))} disabled={page>=pages-1} tone="blue"/></div><div className="cc-state-line"><span className="cc-chip">Stage: {paused?'Paused':running?'Running':session?.session_id?'Synced':'Ready'}</span><span className="cc-chip">Current: {currentRow?nameOf(currentRow):'-'}</span><span className="cc-chip">Queue: {rows.length}</span></div><div className="cc-status">{status}</div></div>
          <div className="cc-panel"><div className="cc-title">Manual Call</div><div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:10,marginTop:10}}><input className="cc-search" value={manualPhone} onChange={(e)=>setManualPhone(e.target.value)} placeholder="Paste manual phone number"/><input className="cc-search" value={manualName} onChange={(e)=>setManualName(e.target.value)} placeholder="Optional candidate name"/><IconButton icon={<IconPhone/>} label="Call" onClick={()=>manualCall()} disabled={busy} tone="green"/></div></div>
        </div>
      </div>

      <div className="cc-panel"><div className="cc-panel-head"><div><div className="cc-title">Live Call Table</div><div className="cc-sub">Search by Candidate ID, phone number, name, note, status or employee.</div></div><input className="cc-search" value={liveSearch} onChange={(e)=>setLiveSearch(e.target.value)} placeholder="Search live calls..."/></div><div className="cc-table-wrap"><table className="cc-table"><thead><tr><th>Time</th><th>Call ID</th><th>Employee</th><th>Candidate</th><th>Candidate ID</th><th>Phone</th><th>Status</th><th>Talk Time</th><th>Mode</th><th>Notes</th><th>Recording</th></tr></thead><tbody>{filteredLogs.slice(0,80).map((l,i)=>{const candidateId=pick(l,['candidate_id','candidateId','cid']); const recording=pick(l,['recording_status','recording_filename','recording_url','recording_file_id']); return <tr key={l.call_log_id||l.id||i}><td>{String(l.call_started_at||l.created_at||'').slice(11,19)||'-'}</td><td>{pick(l,['call_log_id','id','log_id'])}</td><td>{l.employee_name||l.employee_username||'-'}</td><td>{l.candidate_name||l.full_name||'-'}</td><td><button className="cc-link" onClick={()=>openCandidateTab(candidateId,'manual')}>{candidateId}</button></td><td>{l.phone||'-'}</td><td>{l.status||l.call_status||'-'}</td><td>{fmt(l.talktime_seconds||l.duration_seconds)}</td><td><span className="mode-pill">{l.call_source||l.source_mode||l.direction||'auto_dialer'}</span></td><td>{pick(l,['notes','note','call_note','feedback','outcome'])}</td><td><span className={`record-pill ${String(recording).toLowerCase().includes('missing')||recording==='-'?'record-missing':''}`}>{recording}</span></td></tr>})}{!filteredLogs.length?<tr><td colSpan="11">No matching calls found.</td></tr>:null}</tbody></table></div></div>
    </div>
  </Layout>;
}
