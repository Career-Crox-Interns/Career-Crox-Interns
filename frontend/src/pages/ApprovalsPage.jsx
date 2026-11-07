import React, { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import {useAuth} from '../lib/auth';
import { usePolling } from '../lib/usePolling';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';


function DecisionIcon({reject=false}){return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={reject?'M6 6l12 12M18 6L6 18':'M5 12l4 4L19 6'}/></svg>;}
function requestKey(row){return row.type+':'+row.id;}
function requestedAt(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):safeCellText(value);}
function RequestHistory({items=[]}){
 const [open,setOpen]=useState(false);
 return <section className="panel top-gap-small cc123-request-history"><button type="button" className="ghost-btn" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Requests & recent decisions · {items.length} {open?'⌃':'⌄'}</button>{open?<div style={{maxHeight:'45vh',overflow:'auto',fontSize:14}}>{items.map(item=><article key={item.type+item.id} style={{padding:10,borderBottom:'1px solid #dce4ef',display:'flex',gap:10,alignItems:'start'}}><div style={{flex:1}}><strong>{item.candidate_id?<a href={'/candidate/'+encodeURIComponent(item.candidate_id)} target="_blank" rel="noopener noreferrer">{item.type} · {item.title}</a>:item.type+' · '+item.title}</strong><p style={{margin:'4px 0'}}>{item.note}</p><small>{item.requested_by} · {requestedAt(item.at)}</small></div><b style={{color:item.status==='Approved'?'#287a58':'#7b638c'}}>{item.status}</b></article>)}{!items.length?<p>No access or unlock requests yet.</p>:null}</div>:null}</section>;
}
function formatLate(minutes){const m=Math.max(0,Math.floor(Number(minutes)||0));const h=Math.floor(m/60);return (h?`${h}h `:'')+`${m%60}m`;}
function candidateLabel(row){const id=String(row?.candidate_id||'').trim();const name=String(row?.candidate_name||row?.full_name||((row?.type==='candidate')?row?.title:'')||'').trim();return name?name+(id?` · ${id}`:''):id;}
function openPendingProfile(row,rows){if(!row?.candidate_id)return;openCandidateProfileInNewTab(row, rows.filter(item=>item.candidate_id), {sourceKind:'approvals',sourcePath:'/approvals',hasMore:false});}
function safeRows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function safeCellText(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCellText(item, '')).filter(Boolean).join(', ') || fallback;
  try {
    const compact = JSON.stringify(value);
    return compact === undefined ? fallback : compact;
  } catch {
    return fallback;
  }
}

export default function ApprovalsPage() {
  const {user}=useAuth();
  const canReview=['manager','admin','tl'].includes(String(user?.role||'').toLowerCase());
  const [rows, setRows] = useState([]);
  const [requestStates,setRequestStates]=useState([]);
  const readEpoch=useRef(0);
  const [activeReject, setActiveReject] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState('idle');

  async function load() {
    const epoch=++readEpoch.current;
    const [pending,statuses]=await Promise.allSettled([canReview?api.get('/api/approvals?scope=all', { cacheTtlMs: 0, timeoutMs: 12000,allowStale:false }):Promise.resolve({items:[],counts:{ops:0,submissions:0,total:0}}),api.get('/api/approvals/status',{cacheTtlMs:0,allowStale:false,retries:0,headers:{'X-CC-Dashboard-User':'global'}})]);
    if(epoch!==readEpoch.current)return;
    if(statuses.status==='fulfilled')setRequestStates(statuses.value.items||[]);
    if(pending.status!=='fulfilled')throw pending.reason;
    const data=pending.value;
    setRows(data.items || []);
    window.dispatchEvent(new CustomEvent('career-crox-approval-counts',{detail:data.counts}));
  }

  async function manualRefreshApprovals() {
    setSyncState('saving');
    setMessage('Refreshing approvals...');
    try {
      await load();
      setSyncState('saved');
      setMessage('Approvals refreshed.');
    } catch (err) {
      setSyncState('error');
      setMessage(err.message || 'Refresh failed.');
    }
  }

  useEffect(() => { load().catch(error=>setMessage(error.message||'Approvals could not load.')); }, [canReview]);
  useEffect(() => {
    const onRequest = () => { if (!document.hidden && !window.__CC602_NETWORK_PAUSED__) load().catch(() => {}); };
    window.addEventListener('cc609:approval-request', onRequest);
    window.addEventListener('career-crox-approval-changed', onRequest);
    return () => {readEpoch.current++;window.removeEventListener('cc609:approval-request', onRequest);window.removeEventListener('career-crox-approval-changed', onRequest);};
  }, []);
  // CC26_603: approvals update only on explicit Check / Refresh button.
  useEffect(() => {
    if (syncState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSyncState('idle'), 1200);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  async function approve(item, decision = '') {
    const beforeRows = [...rows];
    setRows((current) => current.filter((row) => !(row.type === item.type && row.id === item.id)));
    setMessage(`${item.title || item.id}: saving approval…`);
    setSyncState('saving');
    try {
      await api.post('/api/approvals/approve', { type: item.type, id: item.id, decision });
      setSyncState('saved');setMessage('Decision saved.');await load();
      // CC26_604: no automatic full approval re-read after each write; manual refresh is available.
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Approval failed. UI rolled back.');
      setSyncState('error');
    }
  }

  async function reject(item) {
    if (!reason.trim()) return;
    const beforeRows = [...rows];
    const reasonText = reason.trim();
    setRows((current) => current.filter((row) => !(row.type === item.type && row.id === item.id)));
    setActiveReject('');
    setReason('');
    setMessage(`${item.title || item.id}: saving rejection…`);
    setSyncState('saving');
    try {
      await api.post('/api/approvals/reject', { type: item.type, id: item.id, reason: reasonText });
      setSyncState('saved');setMessage('Decision saved.');await load();
      // CC26_604: no automatic full approval re-read after each write; manual refresh is available.
    } catch (err) {
      setRows(beforeRows);
      setActiveReject(requestKey(item));
      setReason(reasonText);
      setMessage(err.message || 'Reject failed. UI rolled back.');
      setSyncState('error');
    }
  }

  async function approveAll() {
    const beforeRows = [...rows];
    setRows([]);
    setMessage('All visible operational approvals cleared.');
    setSyncState('saving');
    try {
      await api.post('/api/approvals/approve-all', {});
      setSyncState('saved');setMessage('Decision saved.');await load();
      // CC26_604: no automatic full approval re-read after each write; manual refresh is available.
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Approve all failed. UI rolled back.');
      setSyncState('error');
    }
  }

  if(!canReview)return <Layout title="Approvals"><section className="panel" role="status"><h2>Your requests & decisions</h2><p>Your TL or Manager reviews your requests here.</p><button type="button" className="ghost-btn" onClick={manualRefreshApprovals}>Refresh</button>{message?<p>{message}</p>:null}</section><RequestHistory items={requestStates}/></Layout>;
  return (
    <Layout title="Approvals" subtitle="">
      <div className="table-panel top-gap-small glassy-card fade-up cc604-approval-page-hero"><div className="table-toolbar"><div className="table-title">Approvals <span className="cc604-approval-count">{rows.length} pending</span></div><div className="toolbar-actions compact-pills"><span className={`mini-chip ${syncState === 'saving' ? 'live-chip' : syncState === 'saved' ? 'sync-chip saved' : syncState === 'error' ? 'sync-chip error' : ''}`}>{syncState === 'saving' ? 'Saving…' : syncState === 'saved' ? 'Updated' : syncState === 'error' ? 'Update failed' : 'Manual mode'}</span><button className="mini-btn view bounceable" type="button" disabled={syncState === 'saving'} onClick={manualRefreshApprovals}>{'Refresh Now'}</button></div></div></div>
      {rows.some((item) => item.type === 'attendance_report') ? <div className="helper-text cc628-day-status-help">Attendance decisions: <strong>Short shift</strong> = joined office, but active work was below the required minimum. <strong>Did not join</strong> = no recorded office session. Both count as 0-day credit; they have different attendance reasons. Reports stay pending until you choose a decision, even after closing your laptop.</div> : null}
      {message ? <div className={`helper-text top-gap-small sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</div> : null}
      <div className="panel top-gap cc604-approval-page-table"><div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr><th>Type</th><th>Title / Candidate</th><th>Requested By</th><th>Extra</th><th>Requested At</th><th>Actions</th></tr></thead><tbody>{safeRows(rows).map((row) => <tr key={`${safeCellText(row.type, '-')}_${safeCellText(row.id, '-')}`} style={row.candidate_id?{cursor:'pointer'}:undefined} onClick={event=>{if(event.target.closest('button,a,input,textarea,select'))return;openPendingProfile(row,rows);}}><td>{safeCellText(row.type, '-')}</td><td><div style={{display:'grid',gap:3}}>{row.candidate_id?<><a className="cc170-approval-candidate" href={'/candidate/'+encodeURIComponent(row.candidate_id)} target="_blank" rel="noopener noreferrer" onClick={event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();openPendingProfile(row,rows);}}>{candidateLabel(row)}</a>{row.type!=='candidate'?<span className="helper-text">{safeCellText(row.title)}</span>:null}</>:<strong>{safeCellText(row.title)}</strong>}</div></td><td>{safeCellText(row.recruiter_name, '-')}</td><td>{row.type==='unlock'?<><div className="cc930-unlock-note" style={{padding:8,borderRadius:10,background:'#fff2c7',color:'#654105',fontWeight:750}}>{row.employee_note||row.process}</div><strong className="cc790-late-label">Late by {formatLate(row.late_minutes)}</strong><div className="helper-text">Break: {row.break_started_at?new Date(row.break_started_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Not recorded'} → {row.break_active?'Still running':row.break_ended_at?new Date(row.break_ended_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Not recorded'}</div><div className="helper-text">Today's unlock: {row.unlock_number_today?'#'+row.unlock_number_today:'Not recorded'}</div></>:null}{safeCellText(row.process, '-')}</td><td>{requestedAt(row.requested_at)}</td><td>{row.type === 'attendance_report' ? <div className="row-actions compact-pills"><button className="mini-btn call bounceable cc609-full-day" type="button" onClick={() => approve(row, 'Full Day')}>Full Day</button><button className="mini-btn view bounceable cc609-half-day" type="button" onClick={() => approve(row, 'Half Day')}>Half Day</button><button className="mini-btn edit bounceable cc609-zero-day" type="button" title="Employee joined office but recorded fewer than 5 productive work hours; 0-day attendance credit." onClick={() => approve(row, 'Zero Day')}>Short shift · 0 day</button><button className="ghost-btn bounceable cc609-no-work" type="button" title="Employee did not join office or has no recorded office session; 0-day attendance credit." onClick={() => approve(row, 'No Work Day')}>Did not join · 0 day</button></div> : <div className="row-actions">{!row.candidate_id&&row.type==='unlock'?<button className="mini-btn view bounceable cc609-open" type="button" title="View unlock request" aria-label="View unlock request" onClick={() => window.dispatchEvent(new CustomEvent('cc609:show-note', { detail: row }))}>ⓘ</button>:null}<button className="mini-btn call bounceable cc609-approve" type="button" onClick={() => approve(row)} title="Approve request" aria-label="Approve request"><DecisionIcon/></button>{row.type==='unlock'&&row.manager_review&&<button type="button" className="cc837-danger-action" onClick={async()=>{const reason=window.prompt('Why are you flagging this self-unlock?');if(!reason?.trim())return;try{await api.post('/api/approvals/reject',{type:'unlock',id:row.id,reason:reason.trim(),flag_session:true});load();}catch(e){setMessage(e.message)}}}>Flag & suspend session</button>}<button className="mini-btn edit bounceable cc609-reject" type="button" onClick={() => setActiveReject(activeReject === requestKey(row) ? '' : requestKey(row))} title="Reject request" aria-label="Reject request"><DecisionIcon reject/></button></div>}{activeReject === requestKey(row) && <div className="field top-gap-small"><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reject note required"></textarea><button className="ghost-btn bounceable top-gap-small" type="button" onClick={() => reject(row)}>Save Reject Note</button></div>}</td></tr>)}{rows.length === 0 && <tr><td colSpan="6" className="helper-text">No approval requests pending.</td></tr>}</tbody></table></div></div>
      <style>{`.cc170-approval-candidate{font-size:14px;font-weight:800;color:#234876;text-decoration:none}.cc170-approval-candidate:hover{text-decoration:underline}.cc170-approval-candidate:focus-visible{outline:2px solid #674acb;outline-offset:3px;border-radius:3px}.cc604-approval-page-table .cc609-approve,.cc604-approval-page-table .cc609-reject{display:inline-grid;place-items:center;min-width:32px;min-height:32px;padding:6px;color:#fff!important}.cc604-approval-page-table .cc609-approve{background:linear-gradient(130deg,#07825e,#159a75)!important}.cc604-approval-page-table .cc609-reject{background:linear-gradient(130deg,#c22e49,#e04b62)!important}`}</style>
      <RequestHistory items={requestStates}/>
    </Layout>
  );
}
