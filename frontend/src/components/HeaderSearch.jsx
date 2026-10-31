import {RestrictedSearchCard} from './WorkspaceUtilities';
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api,readCandidateSuggestions } from '../lib/api';
import { dialCandidateWithLog, openWhatsAppWithLog } from '../lib/candidateAccess';
import { openCandidateProfileInPopupTab } from '../lib/candidateNav';
import { openCandidateProfileInSameTab } from '../lib/candidateNav';

export function SearchCandidateRow({row,rows=[],onChoose=fn=>fn(),searchPhone=''}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const call=async()=>{setBusy(true);setMessage('');try{await dialCandidateWithLog(row.candidate_id,row.phone,row);setMessage('Call sent to your phone');}catch(e){setMessage(e.message||'Call could not start');}finally{setBusy(false)}};
 if(row.restricted)return <RestrictedSearchCard row={row} phone={searchPhone}/>;
 return <div className="cc837-search-row">
  <button type="button" className="cc837-search-profile" onClick={()=>onChoose(()=>openCandidateProfileInSameTab(row,rows,{sourceKind:'search'}))}>
   <span className="cc785-search-avatar">{String(row.full_name||'C').slice(0,1)}</span><span><strong>{row.full_name||row.candidate_id}</strong><small>{row.phone_masked||row.phone||''} · {row.location||row.preferred_location||''}</small><small>{row.candidate_id}{row.email?' · '+row.email:''}</small></span>
  </button>
  <div className="cc837-search-actions">
   <button type="button" className="call" title="Call candidate" aria-label={'Call '+(row.full_name||'candidate')} disabled={busy} onClick={call}><svg viewBox="0 0 24 24"><path d="m7 3 3 5-2 2c1 3 3 5 6 6l2-2 5 3c0 3-2 5-5 4C9 19 5 15 3 8 2 5 4 3 7 3Z"/></svg></button>
   <button type="button" className="whatsapp" title="WhatsApp candidate" aria-label={'WhatsApp '+(row.full_name||'candidate')} onClick={()=>{openWhatsAppWithLog(row.candidate_id,row.phone,'');}}><svg viewBox="0 0 24 24"><path d="M21 11a9 9 0 0 1-13 8l-5 2 1-5A9 9 0 1 1 21 11Z"/><path d="m8 7 2 3-1 1 3 3 1-1 3 2"/></svg></button>
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
  const currentQuery=useRef(query);currentQuery.current=query;
  const closeTimer=useRef(null);
  useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { setOpen(false); sequence.current++; }, [location.pathname, location.search]);
  useEffect(()=>{const clear=()=>{sequence.current++;setOpen(false);setQuery('');setResult({candidates:[],tasks:[],jds:[]});};window.addEventListener('career-crox-access-changed',clear);window.addEventListener('career-crox-team-changed',clear);return()=>{window.removeEventListener('career-crox-access-changed',clear);window.removeEventListener('career-crox-team-changed',clear);};},[]);
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
    const controller=new AbortController();const suggestions=readCandidateSuggestions(query);setLoading(true); setResult({candidates:suggestions,tasks:[],jds:[]}); setError('');
    const timer = setTimeout(async () => {
      try { const data = await api.get(`/api/search?q=${encodeURIComponent(query.trim())}&candidates_only=1`, { cacheTtlMs: 20000, background: false, retries:0,signal:controller.signal, headers:{'X-CC-Dashboard-User':'global'} }); if (sequence.current === current) { setResult({candidates:Array.isArray(data?.candidates)?data.candidates:[],tasks:[],jds:[]}); setLoading(false); } }
      catch (err) { if (sequence.current === current) { setError(err.message || 'Search could not load. Try again.'); setLoading(false); } }
    }, suggestions.length?180:120);
    return () => { clearTimeout(timer); if(currentQuery.current!==query)controller.abort();sequence.current++; };
  }, [query, open]);
  const total = result.candidates.length;
  function choose(callback) { setOpen(false); sequence.current++; callback(); }
  return <div className="cc785-header-search" ref={host}>
    <button type="button" aria-label="Open CRM search" aria-expanded={open} className="cc785-search-trigger" onClick={() => { clearTimeout(closeTimer.current); setOpen(true); input.current?.focus({preventScroll:true}); }}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>
    {open && <section className="cc785-search-panel" aria-label="CRM search panel" style={{ left }}>
      <form onSubmit={event => { event.preventDefault(); if (query.trim()) choose(() => navigate(`/search?q=${encodeURIComponent(query.trim())}`)); }}><input ref={input} aria-label="Search CRM" value={query} onChange={event => {sequence.current++;setQuery(event.target.value);setResult({candidates:readCandidateSuggestions(event.target.value),tasks:[],jds:[]});}} placeholder="Candidate name, phone, email or ID…"/><button type="button" aria-label="Close search" onClick={() => setOpen(false)}>×</button></form>
      <div className="cc785-search-results" aria-live="polite">
        {!query.trim() ? <p>Search candidates by name, phone, email or ID.</p> : loading&&!total ? <p>Searching…</p> : error ? <p role="alert">{error}</p> : !total ? <p>No matching candidates.</p> : <>
          {result.candidates.slice(0,8).map(row=><SearchCandidateRow key={row.candidate_id} row={row} rows={result.candidates} searchPhone={query} onChoose={choose}/>)}
          <button type="button" className="cc785-search-all" onClick={() => choose(() => navigate(`/search?q=${encodeURIComponent(query.trim())}`))}>View all results →</button>
        </>}
      </div>
    </section>}
  </div>;
}
