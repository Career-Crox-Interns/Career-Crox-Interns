import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { dialCandidateWithLog, openWhatsAppWithLog } from '../lib/candidateAccess';
import { openCandidateProfileInPopupTab } from '../lib/candidateNav';
import { openCandidateProfileInSameTab } from '../lib/candidateNav';

export function SearchCandidateRow({row,rows=[],onChoose=fn=>fn()}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const call=async()=>{setBusy(true);setMessage('');try{await dialCandidateWithLog(row.candidate_id,row.phone,row);setMessage('Call sent to your phone');}catch(e){setMessage(e.message||'Call could not start');}finally{setBusy(false)}};
 return <div className="cc837-search-row">
  <button type="button" className="cc837-search-profile" onClick={()=>onChoose(()=>openCandidateProfileInSameTab(row,rows,{sourceKind:'search'}))}>
   <span className="cc785-search-avatar">{String(row.full_name||'C').slice(0,1)}</span><span><strong>{row.full_name||row.candidate_id}</strong><small>{row.phone_masked||row.phone||''} · {row.location||row.preferred_location||''}</small><small>{row.candidate_id}</small></span>
  </button>
  <div className="cc837-search-actions">
   <button type="button" className="call" title="Call candidate" aria-label={'Call '+(row.full_name||'candidate')} disabled={busy} onClick={call}><svg viewBox="0 0 24 24"><path d="m7 3 3 5-2 2c1 3 3 5 6 6l2-2 5 3c0 3-2 5-5 4C9 19 5 15 3 8 2 5 4 3 7 3Z"/></svg></button>
   <button type="button" className="whatsapp" title="WhatsApp candidate" aria-label={'WhatsApp '+(row.full_name||'candidate')} onClick={()=>{const preparedWindow=window.open('about:blank','career_crox_whatsapp');openWhatsAppWithLog(row.candidate_id,row.phone,'',{preparedWindow});}}><svg viewBox="0 0 24 24"><path d="M21 11a9 9 0 0 1-13 8l-5 2 1-5A9 9 0 1 1 21 11Z"/><path d="m8 7 2 3-1 1 3 3 1-1 3 2"/></svg></button>
   <button type="button" className="notes" title="Open candidate notes" aria-label={'Notes for '+(row.full_name||'candidate')} onClick={()=>onChoose(()=>openCandidateProfileInPopupTab(row,rows,{sourceKind:'search',jump:'notes'}))}><svg viewBox="0 0 24 24"><path d="M5 3h14v18H5Z M8 8h8 M8 12h8 M8 16h5"/></svg></button>
  </div>{message&&<small className="cc837-search-message" role="status">{message}</small>}
 </div>;
}

export default function HeaderSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState({ candidates: [], tasks: [], jds: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(0);
  const host = useRef(null);
  const input = useRef(null);
  const sequence = useRef(0);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setOpen(false); sequence.current++; }, [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus({ preventScroll: true });
    const position = () => { const rect = host.current?.getBoundingClientRect(); if (rect) setLeft(Math.min(0, window.innerWidth - rect.left - Math.min(520, window.innerWidth - 24) - 12)); };
    const close = event => { if (!host.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); host.current?.querySelector('button')?.focus(); } };
    position(); document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', escape); window.addEventListener('resize', position);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape); window.removeEventListener('resize', position); };
  }, [open]);
  useEffect(() => {
    const current = ++sequence.current;
    if (!open || !query.trim()) { setLoading(false); setResult({ candidates: [], tasks: [], jds: [] }); setError(''); return; }
    setLoading(true); setResult({candidates:[],tasks:[],jds:[]}); setError('');
    const timer = setTimeout(async () => {
      try { const data = await api.get(`/api/search?q=${encodeURIComponent(query.trim())}`, { cacheTtlMs: 20000, background: false }); if (sequence.current === current) { setResult(Object.fromEntries(['candidates', 'tasks', 'jds'].map(key => [key, Array.isArray(data?.[key]) ? data[key] : []]))); setLoading(false); } }
      catch (err) { if (sequence.current === current) { setError(err.message || 'Search could not load. Try again.'); setLoading(false); } }
    }, 180);
    return () => { clearTimeout(timer); sequence.current++; };
  }, [query, open]);
  const total = result.candidates.length + result.tasks.length + result.jds.length;
  function choose(callback) { setOpen(false); sequence.current++; callback(); }
  return <div className="cc785-header-search" ref={host}>
    <button type="button" aria-label="Open CRM search" aria-expanded={open} className="cc785-search-trigger" onClick={() => setOpen(value => !value)}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>
    {open && <section className="cc785-search-panel" aria-label="CRM search panel" style={{ left }}>
      <form onSubmit={event => { event.preventDefault(); if (query.trim()) choose(() => navigate(`/search?q=${encodeURIComponent(query.trim())}`)); }}><input ref={input} aria-label="Search CRM" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name, phone, candidate ID, task…"/><button type="button" aria-label="Close search" onClick={() => setOpen(false)}>×</button></form>
      <div className="cc785-search-results" aria-live="polite">
        {!query.trim() ? <p>Start typing to search your CRM.</p> : loading ? <p>Searching…</p> : error ? <p role="alert">{error}</p> : !total ? <p>No matches found.</p> : <>
          {result.candidates.slice(0,8).map(row=><SearchCandidateRow key={row.candidate_id} row={row} rows={result.candidates} onChoose={choose}/>)}
          {result.tasks.slice(0, 4).map(row => <button type="button" key={row.task_id} onClick={() => choose(() => navigate(`/tasks?task_id=${encodeURIComponent(row.task_id)}`))}><span className="cc785-search-avatar">✓</span><span><strong>{row.title}</strong><small>Task / {row.status}</small></span><span>→</span></button>)}
          {result.jds.slice(0, 4).map(row => <button type="button" key={row.jd_id} onClick={() => choose(() => navigate('/jds'))}><span className="cc785-search-avatar">JD</span><span><strong>{row.job_title}</strong><small>{row.company} / {row.location}</small></span><span>→</span></button>)}
          <button type="button" className="cc785-search-all" onClick={() => choose(() => navigate(`/search?q=${encodeURIComponent(query.trim())}`))}>View all results →</button>
        </>}
      </div>
    </section>}
  </div>;
}
