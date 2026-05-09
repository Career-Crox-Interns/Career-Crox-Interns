import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { getPollingLeaderSnapshot } from '../lib/tabLeader';

const arr = (x) => Array.isArray(x) ? x : [];
const fmt = (s = 0) => { const n = Number(s || 0); const m = Math.floor(n / 60); const x = n % 60; return m ? `${m}m ${x}s` : `${x}s`; };
const digits = (v = '') => String(v || '').replace(/\D+/g, '').slice(-10);
const openProfile = (id) => { if (!id || id === '-') return false; return Boolean(window.open(`/candidate/${encodeURIComponent(id)}`, '_blank')); };
const pick = (r = {}, keys = []) => { for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return '-'; };
const searchBlob = (r = {}) => Object.values(r || {}).map((v) => String(v || '').toLowerCase()).join(' ');
const card = { border: '1px solid rgba(92,142,255,.28)', borderRadius: 24, background: 'linear-gradient(135deg,#f8fcff,#eef7ff,#fff7fb)', boxShadow: '0 18px 50px rgba(37,99,235,.10)', padding: 16 };
const nameOf = (r = {}) => r.candidate_name || r.full_name || r.name || 'Candidate';
const cidOf = (r = {}) => r.candidate_id || r.id || '-';
const processOf = (r = {}) => r.process || r.jd_name || r.jd || r.client_name || '-';
const WHITE_BUTTON_TEXT_STYLE = { color: '#ffffff', WebkitTextFillColor: '#ffffff', textShadow: '0 1px 2px rgba(0,0,0,.18)' };
function StatCard({ label, value, note, tone = 'blue' }) {
  return <button type="button" className={`stat-card bucket-click-card ${tone} live-stat-match`} tabIndex={-1}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </button>;
}
function Btn({ children, onClick, danger, disabled, tone = '' }) { return <button className={`dialer-command-btn force-white-action ${danger?'danger':''} ${tone}`} disabled={disabled} onClick={onClick} style={WHITE_BUTTON_TEXT_STYLE}>{children}</button>; }
function LiveProfileDock({ item, status, queueCount }) {
  if (!item) return null;
  return <div className="live-profile-dock">
    <div>
      <span className="dock-label">Current Live Profile</span>
      <b>{nameOf(item)}</b>
      <small>{cidOf(item)} • {processOf(item)}</small>
    </div>
    <div className="live-profile-meta">
      <span className="dock-status">{status || 'Ready'}</span>
      <span className="dock-queue-pill">{queueCount || 0} profiles loaded from CRM selection</span>
    </div>
    <button type="button" className="mini-btn call bounceable dialer-dock-open modern-eye-btn" onClick={() => openProfile(cidOf(item))}><IconLink /> Open</button>
  </div>;
}
function IconSpark(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 10-13h-7V2Z" fill="currentColor"/></svg>}
function IconPause(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h3v14H7V5Zm7 0h3v14h-3V5Z" fill="currentColor"/></svg>}
function IconPlay(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.8v12.4c0 .8.9 1.3 1.6.9l9.7-6.2a1 1 0 0 0 0-1.8L9.6 4.9C8.9 4.5 8 5 8 5.8Z" fill="currentColor"/></svg>}
function IconStop(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 7h10v10H7V7Z" fill="currentColor"/></svg>}
function IconRefresh(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
function IconPhone(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4l-1.5 1.3a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor"/></svg>}
function IconLink(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5M10.8 6.8l1.4-1.4a4 4 0 0 1 5.7 5.7l-1.4 1.4M13.2 17.2l-1.4 1.4a4 4 0 0 1-5.7-5.7l1.4-1.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}

export default function LiveDialingRoomPage() {
  const [data, setData] = useState({ sessions: [], active_queue: [], recent_calls: [], summary: {} });
  const [section, setSection] = useState('Interviews');
  const [limit, setLimit] = useState(50);
  const [status, setStatus] = useState('Ready');
  const [manualPhone, setManualPhone] = useState('');
  const [pair, setPair] = useState(null);
  const [callSearch, setCallSearch] = useState('');
  const sessions = arr(data.sessions);
  const current = sessions[0] || null;
  const queue = arr(data.active_queue);
  const calls = arr(data.recent_calls);
  const summary = data.summary || {};
  const currentQueueId = current?.current_queue_item_id || '';
  const aht = (summary.dialed || 0) ? Math.round(Number(summary.talktime_seconds || 0) / Number(summary.dialed || 1)) : 0;
  const uniqueCalls = useMemo(() => new Set(calls.map((l) => digits(l.phone || l.number || l.mobile || '') || String(pick(l,['candidate_id','candidateId','cid']))).filter((v) => v && v !== '-')).size, [calls]);
  const callSearchText = callSearch.trim().toLowerCase();
  const filteredCalls = useMemo(() => {
    if (!callSearchText) return calls;
    return calls.filter((l) => searchBlob(l).includes(callSearchText));
  }, [calls, callSearchText]);
  const paused = /paused|pause/i.test(`${current?.status || ''} ${current?.mobile_command || ''}`);

  async function refresh(mode = 'full') {
    try {
      const lite = mode === 'lite';
      const d = await api.get(lite ? '/api/dialer/live-status?lite=1' : '/api/dialer/live-status', { cacheTtlMs: lite ? 3500 : 12000, allowStale: true, timeoutMs: 14000 });
      if (lite) {
        setData((old) => ({ ...old, sessions: arr(d.sessions), summary: { ...(old.summary || {}), ...(d.summary || {}) }, generated_at: d.generated_at }));
      } else {
        setData(d || {});
      }
      setStatus(d?.cached ? 'Showing cached status' : (lite ? 'Live state checked' : 'Updated'));
    }
    catch (e) { setStatus(e.message || 'Refresh failed'); }
  }
  useEffect(() => {
    const leader = getPollingLeaderSnapshot();
    const visibleLeader = Boolean(leader?.isLeader) && !(typeof document !== 'undefined' && document.hidden);
    if (visibleLeader) refresh('full');
    let active = true;
    let timer = null;
    const tick = async () => {
      if (!active) return;
      const snap = getPollingLeaderSnapshot();
      const ok = Boolean(snap?.isLeader) && !(typeof document !== 'undefined' && document.hidden);
      if (ok) await refresh('lite');
      timer = window.setTimeout(tick, ok ? 5000 : 60000);
    };
    timer = window.setTimeout(tick, 5000);
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, []);
  async function startDialing() {
    let profileTab = null;
    try { profileTab = window.open('about:blank', '_blank'); } catch { profileTab = null; }
    try {
      if (profileTab) profileTab.document.write('<title>Opening profile...</title><body style="font-family:Arial;padding:24px">Opening current profile before mobile call...</body>');
      const created = await api.post('/api/dialer/start-session', { section, limit: Number(limit || 50), next_call_gap_seconds: 5, start_from_crm: '0', mobile_auto_start: '0' });
      const cid = created?.session?.current_candidate_id || '';
      if (profileTab && cid) profileTab.location.href = `/candidate/${encodeURIComponent(cid)}`;
      else if (profileTab) profileTab.close();
      if (!created?.session?.session_id) throw new Error('Session created without session ID');
      const d = await api.post('/api/dialer/resume-session', { session_id: created.session.session_id });
      setStatus(profileTab ? 'Profile opened. Start command sent to mobile.' : 'Start command sent to mobile. Profile tab was not confirmed.');
      await refresh();
      return d;
    } catch (e) { try { if (profileTab) profileTab.close(); } catch {} setStatus(e.message || 'Start failed'); }
  }
  async function pause() { if (!current?.session_id) return; await api.post('/api/dialer/pause-session', { session_id: current.session_id }); setStatus('Paused'); refresh(); }
  async function resume() { if (!current?.session_id) return; await api.post('/api/dialer/resume-session', { session_id: current.session_id }); setStatus('Resume command sent'); refresh(); }
  async function stop() { if (!current?.session_id) return; await api.post('/api/dialer/stop-session', { session_id: current.session_id }); setStatus('Stopped'); refresh(); }
  async function manual() {
    const phone = digits(manualPhone);
    if (phone.length < 10) return setStatus('Enter a valid phone number');
    let profileTab = null;
    try { profileTab = window.open('about:blank', '_blank'); } catch { profileTab = null; }
    try {
      if (profileTab) profileTab.document.write('<title>Opening profile...</title><body style="font-family:Arial;padding:24px">Opening matched profile before manual call...</body>');
      const d = await api.post('/api/dialer/manual-call', { phone, next_call_gap_seconds: 5 });
      const cid = d?.session?.current_candidate_id || '';
      if (profileTab && cid && !String(cid).startsWith('MANUAL-')) profileTab.location.href = `/candidate/${encodeURIComponent(cid)}`;
      else if (profileTab) profileTab.close();
      setManualPhone(''); setStatus(profileTab ? 'Manual call sent' : 'Manual call sent. Profile tab was not confirmed.'); refresh();
    } catch (e) { try { if (profileTab) profileTab.close(); } catch {} setStatus(e.message || 'Manual call failed'); }
  }
  async function pairCode() { try { const d = await api.post('/api/dialer/pair-code', {}); setPair(d); } catch (e) { setStatus(e.message || 'Pair code failed'); } }

  const currentRow = useMemo(() => queue.find((q) => String(q.queue_item_id) === String(currentQueueId)) || queue[0] || null, [queue, currentQueueId]);

  return <Layout title="Live Dialing Room" subtitle="">
    <style>{`
      .live-stat-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin-top:6px}.live-stat-match{min-height:88px!important;border-radius:18px!important;padding:14px 14px 16px!important;pointer-events:none}.live-stat-match span{font-weight:900!important;line-height:1.1!important;white-space:normal!important;max-width:92%!important}.live-stat-match strong{display:block;font-size:34px!important;line-height:.95!important}.live-stat-match small{font-size:12px!important;font-weight:900!important;opacity:.92!important}.live-field{border:1px solid #bdd7ff;border-radius:15px;padding:12px 13px;font-weight:800;background:#fff;color:#132b4f}.dialer-command-btn{border:0;border-radius:18px;min-height:56px;padding:12px 14px;font-weight:1000;color:#fff!important;background:linear-gradient(135deg,#1b54ff,#2c7fff,#9148ff);box-shadow:0 14px 30px rgba(37,99,235,.22);display:inline-flex;align-items:center;justify-content:center;gap:9px;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;text-align:center}.dialer-command-btn *{color:#fff!important}.dialer-command-btn,.dialer-command-btn *,.dialer-command-btn span,.dialer-command-btn svg,.dialer-command-btn path,.force-white-action,.force-white-action *,.force-white-icon,.force-white-icon *{color:#fff!important;-webkit-text-fill-color:#fff!important;fill:#fff!important;stroke:#fff!important}.dialer-command-btn:hover{transform:translateY(-2px);box-shadow:0 18px 38px rgba(37,99,235,.30)}.dialer-command-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}.dialer-command-btn svg{width:18px;height:18px;flex:0 0 auto}.force-white-action,.force-white-action span,.force-white-action svg{color:#fff!important;-webkit-text-fill-color:#fff!important}.force-white-action path{fill:#fff!important;stroke:#fff!important;color:#fff!important;-webkit-text-fill-color:#fff!important}.dialer-command-btn,.dialer-command-btn span{color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 1px 1px rgba(0,0,0,.10)}.dialer-command-btn svg{color:#fff!important}.dialer-command-btn.green{background:linear-gradient(135deg,#0f8f76,#22bb63,#78d63f)}.dialer-command-btn.orange{background:linear-gradient(135deg,#ff7a21,#ff4b57,#ffb133)}.dialer-command-btn.danger{background:linear-gradient(135deg,#ff215e,#ff4e86,#ff8f5a)}.dialer-command-btn.blue{background:linear-gradient(135deg,#1b54ff,#2c7fff,#9148ff)}.live-profile-dock{position:sticky;top:72px;z-index:10;margin:0 0 12px 0;border:1px solid #b9d7ff;border-radius:20px;background:linear-gradient(135deg,#ffffff,#eef7ff,#fff7fb);box-shadow:0 12px 30px rgba(37,99,235,.14);padding:14px 16px;display:grid;grid-template-columns:minmax(280px,1.15fr) minmax(210px,.95fr) auto;gap:14px;align-items:center}.live-profile-dock b{display:block;font-size:19px;color:#132b4f}.live-profile-dock small{display:block;color:#4f6584;font-weight:800}.live-profile-meta{display:flex;flex-direction:column;gap:8px;align-items:flex-start}.dock-label{font-size:11px;font-weight:1000;text-transform:uppercase;color:#2563eb}.dock-status{font-weight:1000;color:#0e7490;background:#ecfeff;border:1px solid #b8f4ff;border-radius:999px;padding:8px 11px}.dock-queue-pill{display:inline-flex;align-items:center;padding:8px 12px;border-radius:999px;border:1px solid #bde7ef;background:linear-gradient(135deg,#e8fffb,#f0f9ff);font-weight:1000;color:#0f766e}.dialer-dock-open{width:auto!important;height:auto!important;min-height:46px!important;border-radius:15px!important;padding:10px 16px!important;color:#fff!important}.live-table{width:100%;border-collapse:separate;border-spacing:0 8px}.live-table th{text-align:left;font-size:12px;color:#36547a;text-transform:uppercase}.live-table td{background:#ffffffcc;border-top:1px solid #d8e7ff;border-bottom:1px solid #d8e7ff;padding:10px;font-weight:800;color:#14345a}.live-table td:first-child{border-left:1px solid #d8e7ff;border-radius:16px 0 0 16px}.live-table td:last-child{border-right:1px solid #d8e7ff;border-radius:0 16px 16px 0}.live-now td{background:linear-gradient(90deg,#e7f3ff,#fff3fb);outline:2px solid #3478ff}.live-link{border:0;background:transparent;color:#2563eb;font-weight:1000;cursor:pointer}.live-open-btn{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:7px 11px;background:linear-gradient(135deg,#eaf7ff,#eef2ff);box-shadow:0 8px 18px rgba(37,99,235,.12)}.live-scroll{overflow:auto;max-height:52vh}.live-search-row{display:grid;grid-template-columns:minmax(260px,1fr) 130px 140px;gap:10px;align-items:center;margin:12px 0}.muted-small{font-size:12px;font-weight:900;color:#64748b}.mode-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#eef7ff;color:#2563eb;font-weight:1000;font-size:12px}.record-pill{display:inline-flex;padding:7px 10px;border-radius:999px;background:#f0fdf4;color:#15803d;font-weight:1000;font-size:12px}.record-missing{background:#fff1f2;color:#be123c}.live-title{font-size:19px;font-weight:1000;color:#132b4f}.live-pill{display:inline-flex;padding:8px 12px;border-radius:999px;font-weight:900;font-size:12px;background:#ecfeff;color:#0e7490;margin-right:8px;margin-bottom:8px}@media(max-width:1280px){.live-stat-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.live-profile-dock{grid-template-columns:1fr}}@media(max-width:1100px){.bucket-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.live-stat-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `}</style>
    <div className="live-stat-grid top-gap-small fade-up"><StatCard label="Dialed" value={summary.dialed || 0} note="Mobile calls" tone="orange"/><StatCard label="Connected" value={summary.connected || 0} note="Picked calls" tone="green"/><StatCard label="Talktime" value={fmt(summary.talktime_seconds || 0)} note="Total duration" tone="purple"/><StatCard label="Not Connected" value={summary.not_connected || 0} note="No pickup or failed calls" tone="red"/><StatCard label="Average Handling Time" value={fmt(aht)} note="Average talktime" tone={aht && aht < 180 ? "red" : "teal"}/><StatCard label="Unique Calls" value={uniqueCalls} note="First-time numbers in log" tone="teal"/></div>
    <LiveProfileDock item={currentRow} status={paused ? 'Paused' : current?.live_status || status} queueCount={queue.length} />
    <div style={{display:'grid',gridTemplateColumns:'1.6fr .9fr',gap:14}}>
      <div style={card}>
        <div className="live-title">CRM Command Center</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginTop:12}}><select className="live-field" value={section} onChange={(e)=>setSection(e.target.value)}><option>Interviews</option><option>Candidates</option><option>Hot Leads</option></select><input className="live-field" value={limit} onChange={(e)=>setLimit(e.target.value)} /><select className="live-field" value="5 Seconds" readOnly><option>5 Seconds</option></select></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,minmax(120px,1fr))',gap:12,marginTop:12}}><Btn onClick={startDialing} tone="green"><IconSpark /> Start Mobile</Btn><Btn onClick={pause} disabled={!current?.session_id || paused} danger><IconPause /> Pause</Btn><Btn onClick={resume} disabled={!current?.session_id || !paused} tone="blue"><IconPlay /> Resume</Btn><Btn onClick={stop} disabled={!current?.session_id} danger><IconStop /> Stop</Btn><Btn onClick={refresh} tone="orange"><IconRefresh /> Refresh</Btn></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 160px',gap:10,marginTop:12}}><input className="live-field" placeholder="Paste manual number" value={manualPhone} onChange={(e)=>setManualPhone(e.target.value)} /><Btn onClick={manual} tone="green"><IconPhone /> Manual Call</Btn></div>
        <div style={{marginTop:12}}><span className="live-pill">Current: {current?.current_candidate_name || '-'}</span><span className="live-pill">Stage: {paused ? 'Paused' : current?.live_status || 'Ready'}</span><span className="live-pill">Gap: 5s</span></div>
        <div style={{fontWeight:900,color:'#36547a'}}>{status}</div>
      </div>
      <div style={card}><div className="live-title">Pair Mobile App</div><div style={{fontWeight:800,color:'#64748b',margin:'8px 0'}}>Generate a code when a phone needs pairing.</div><Btn onClick={pairCode}>Generate Pair Code</Btn>{pair ? <div style={{marginTop:14,fontSize:32,fontWeight:1000,color:'#2563eb'}}>{pair.pairing_code}</div> : null}</div>
    </div>
    <div style={{...card,marginTop:14}}>
      <div className="live-title">Active Dialing Table</div>
      <div className="live-scroll"><table className="live-table"><thead><tr><th>SR</th><th>Candidate ID</th><th>Profile No.</th><th>IMN ID</th><th>Profile</th><th>Name</th><th>Last Note</th><th>Interview Date</th><th>Process</th><th>Status</th></tr></thead><tbody>{queue.map((r,i)=>{const live=String(r.queue_item_id)===String(currentQueueId);return <tr key={r.queue_item_id||i} className={live?'live-now':''}><td>{i+1}</td><td><button className="live-link" onClick={()=>openProfile(r.candidate_id)}>{r.candidate_id||'-'}</button></td><td>{r.profile_number||'-'}</td><td>{r.imn_candidate_id||'-'}</td><td><button className="live-link live-open-btn" onClick={()=>openProfile(r.candidate_id)}><IconLink /> Open</button></td><td>{r.candidate_name||'-'}</td><td>{r.last_note||'-'}</td><td>{r.interview_date||'-'}</td><td>{r.process||'-'}</td><td>{r.status||'-'}</td></tr>})}{!queue.length?<tr><td colSpan="10">No active queue.</td></tr>:null}</tbody></table></div>
    </div>
    <div style={{...card,marginTop:14}} id="reports">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
        <div><div className="live-title">Recent Mobile Calls</div><div className="muted-small">Search by candidate ID, phone, name, status, employee, mode, note or recording.</div></div>
        <span className="live-pill">Showing {filteredCalls.slice(0,100).length} / {calls.length}</span>
      </div>
      <div className="live-search-row"><input className="live-field" value={callSearch} onChange={(e)=>setCallSearch(e.target.value)} placeholder="Search live calls: ID, phone, name, note, status"/><button className="live-field" type="button" onClick={()=>setCallSearch('')}>Clear</button><button className="live-field" type="button" onClick={()=>refresh('full')}>Refresh</button></div>
      <div className="live-scroll"><table className="live-table"><thead><tr><th>Time</th><th>Call ID</th><th>Candidate ID</th><th>Profile</th><th>Name</th><th>Phone</th><th>Employee</th><th>Status</th><th>Talktime</th><th>Mode</th><th>Notes</th><th>Recording</th></tr></thead><tbody>{filteredCalls.slice(0,100).map((l,i)=>{const candidateId=pick(l,['candidate_id','candidateId','cid']); const callId=pick(l,['call_log_id','id','log_id']); const recording=pick(l,['recording_status','recording_filename','recording_url','recording_file_id']); return <tr key={l.call_log_id||l.id||i}><td>{String(l.call_started_at||l.created_at||'').slice(11,19) || '-'}</td><td>{callId}</td><td><button className="live-link" onClick={()=>openProfile(candidateId)}>{candidateId}</button></td><td><button className="live-link live-open-btn" onClick={()=>openProfile(candidateId)}><IconLink /> Open</button></td><td>{l.candidate_name||l.full_name||'-'}</td><td>{l.phone||'-'}</td><td>{l.employee_name||l.employee_username||'-'}</td><td>{l.status||l.call_status||'-'}</td><td>{fmt(l.talktime_seconds||l.duration_seconds)}</td><td><span className="mode-pill">{l.call_source||l.source_mode||l.direction||'auto_dialer'}</span></td><td>{pick(l,['notes','note','call_note','feedback','outcome'])}</td><td><span className={`record-pill ${String(recording).toLowerCase().includes('missing')||recording==='-'?'record-missing':''}`}>{recording}</span></td></tr>})}{!filteredCalls.length?<tr><td colSpan="12">No matching calls found.</td></tr>:null}</tbody></table></div>
    </div>
  </Layout>;
}
