import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router-dom';
import {useAuth} from '../lib/auth';
import {api} from '../lib/api';
import {useDashboardScope} from '../lib/dashboardScope';
import {emitCandidateUpsert,onCandidateRealtime} from '../lib/realtimeProfileBridge';
import {openWhatsAppWithLog,dialCandidateWithLog} from '../lib/candidateAccess';
import {getWhatsAppTemplates,loadSharedWhatsAppTemplates,getNoteTemplates} from '../lib/templateStore';


const STATUS=['Draft','In - Progress','Not Interested','All set for Interview','Appeared in Interview','Selected','Joining Due','Joined','Backout','Completed 60 Days','Rejected once, needs new Interview','Rejected'];
const NOTES=['Interview rescheduled by candidate','Interview details shared on WhatsApp','Candidate confirmed attendance','Candidate asked for a callback','Candidate not responding','Candidate not interested'];
const EMPTY={status:'',interview:'',followup:'',note:'',details:'',followupSet:false};
const sections=[['status','Status','status'],['interview','Interview','calendar'],['note','Notes','note'],['followup','Follow-up','clock'],['details','Details sent','save']];
const two=n=>String(n).padStart(2,'0');
function wall(value) {
  if(!value)return '';
  const text=String(value);
  if(/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d)?$/.test(text))return text.length===10?text+'T10:00':text;
  const ms=Date.parse(text);if(!Number.isFinite(ms))return '';
  return new Date(ms+19800000).toISOString().slice(0,16);
}
const toIso=value=>value?value+':00+05:30':'';
const initial=item=>({status:item.status||'Draft',interview:wall(item.interview_reschedule_date||item.interview_date),followup:wall(item.follow_up_at),note:''});
function displayDate(value){const v=wall(value);if(!v)return 'Not scheduled';const [d,t]=v.split('T'),[y,m,day]=d.split('-');let [h,min]=t.split(':');return `${day}/${m} · ${Number(h)%12||12}:${min} ${+h>=12?'PM':'AM'}`;}
function preset(minutes,tomorrow=false){let d=new Date(Date.now()+19800000+minutes*60000);if(tomorrow){d.setUTCDate(d.getUTCDate()+1);d.setUTCHours(10,0,0,0);}return d.toISOString().slice(0,16);}
function Icon({name,...props}) {
 const paths={plus:<path d="M12 5v14M5 12h14"/>,phone:<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 3a14 14 0 0 1-8-8l3-2-2-5Z"/>,whatsapp:<><path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.1A8 8 0 1 1 20 11.5Z"/><path d="m9 7-1 2c1 3 2 4 5 5l2-1-2-2-1 1-2-2 1-1-2-2Z"/></>,bolt:<path d="m13 2-8 11h6l-1 9 9-12h-6l1-8Z"/>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,status:<><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2"/></>,note:<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8m-8 4h5"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,close:<path d="m6 6 12 12M6 18 18 6"/>,min:<path d="M5 12h14"/>,back:<path d="m14 6-6 6 6 6"/>,refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17"/></>,save:<path d="m5 12 4 4L19 6"/>,arrow:<path d="m9 5 7 7-7 7"/>,pip:<><rect x="2" y="4" width="20" height="16" rx="3"/><rect x="11" y="11" width="8" height="6" rx="1"/></>};
 return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]||paths.bolt}</svg>;
}
function Calendar({value,onChange,label}) {
 const today=wall(new Date().toISOString()).slice(0,10),chosen=value?.slice(0,10)||today;
 const [month,setMonth]=useState(()=>chosen.slice(0,7));
 useEffect(()=>{if(value)setMonth(value.slice(0,7));},[value?.slice(0,7)]);
 const [year,mon]=month.split('-').map(Number),first=new Date(Date.UTC(year,mon-1,1)),offset=(first.getUTCDay()+6)%7,days=new Date(Date.UTC(year,mon,0)).getUTCDate();
 function move(delta){const d=new Date(Date.UTC(year,mon-1+delta,1));setMonth(d.toISOString().slice(0,7));}
 function choose(day){onChange(`${month}-${two(day)}T${value?.slice(11,16)||'10:00'}`);}
 return <div className="ccqu-calendar" data-cc839-time="quick-managed">
  <div className="ccqu-month"><button type="button" aria-label={`Previous ${label} month`} onClick={()=>move(-1)}><Icon name="back"/></button><strong>{first.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</strong><button type="button" aria-label={`Next ${label} month`} onClick={()=>move(1)}><Icon name="arrow"/></button></div>
  <div className="ccqu-days" role="group" aria-label={`${label} calendar`}>
   {['M','T','W','T','F','S','S'].map((d,i)=><small key={'h'+i}>{d}</small>)}
   {Array.from({length:offset},(_,i)=><span key={'e'+i}/>)}
   {Array.from({length:days},(_,i)=>{const key=`${month}-${two(i+1)}`;return <button type="button" key={key} aria-label={`${label} ${key}`} aria-pressed={value?.slice(0,10)===key} className={(value?.slice(0,10)===key?'is-selected ':'')+(key===today?'is-today':'')} onClick={()=>choose(i+1)}>{i+1}</button>;})}
  </div>
  <div className="ccqu-time"><label>Date<input aria-label={`${label} date`} type="date" value={value?.slice(0,10)||''} onChange={e=>{if(e.target.value){setMonth(e.target.value.slice(0,7));onChange(e.target.value+'T'+(value?.slice(11,16)||'10:00'));}}}/></label><label>Time · IST<input aria-label={`${label} time`} type="time" value={value?.slice(11,16)||''} onChange={e=>{if(e.target.value)onChange((value?.slice(0,10)||today)+'T'+e.target.value);}}/></label></div>
 </div>;
}
export default function QuickUpdate(){
 const {user,booted}=useAuth(),scope=useDashboardScope(),location=useLocation();
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[results,setResults]=useState([]);
 const [selected,setSelected]=useState([]),[interviews,setInterviews]=useState({}),[interviewPick,setInterviewPick]=useState({});
 const [draft,setDraft]=useState(EMPTY),[active,setActive]=useState('status'),[busy,setBusy]=useState(false);
 const [searching,setSearching]=useState(false),[loading,setLoading]=useState(''),[error,setError]=useState(''),[toast,setToast]=useState('');
 const [outcomes,setOutcomes]=useState({}),[waMenu,setWaMenu]=useState(false),[templates,setTemplates]=useState(getWhatsAppTemplates);
 const [contactBusy,setContactBusy]=useState(false);
 const searchSeq=useRef(0),epoch=useRef(0),openTimer=useRef(),closeTimer=useRef(),toastTimer=useRef(),hoverTimer=useRef(),panelRef=useRef(),inputRef=useRef();
 const receiptRef=useRef(new Map()),confirmedRef=useRef(new Set()),unknownRef=useRef(new Set()),savingRef=useRef(false),hoverSuppressedUntil=useRef(0),currentRef=useRef({}),lastScope=useRef('');
 const identity=String(user?.user_id||'')+'|'+scope,visible=!!user&&booted&&!['/login','/data-backup'].includes(location.pathname);
 const readOnly=!['overview','self','team',String(user?.user_id||'')].includes(scope);
 const dirty=!!(draft.status||draft.interview||draft.note.trim()||draft.followupSet||draft.details);
 const single=selected.length===1?selected[0]:null;
 currentRef.current={singleId:String(single?.candidate_id||''),identity};
 function say(message){setToast(message);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),4000);}
 function reset(){searchSeq.current++;savingRef.current=false;unknownRef.current.clear();setLoading('');setSearching(false);setQuery('');setResults([]);setSelected([]);setInterviews({});setInterviewPick({});setDraft(EMPTY);setError('');setOutcomes({});setBusy(false);setWaMenu(false);receiptRef.current.clear();confirmedRef.current.clear();}
 useEffect(()=>{if(lastScope.current===identity)return;lastScope.current=identity;epoch.current++;reset();setOpen(false);},[identity]);
 useEffect(()=>{if(!visible){epoch.current++;setOpen(false);}},[visible]);
 useEffect(()=>()=>{[openTimer,closeTimer,toastTimer,hoverTimer].forEach(r=>clearTimeout(r.current));},[]);
 function openPanel(){clearTimeout(closeTimer.current);clearTimeout(openTimer.current);openTimer.current=setTimeout(()=>setOpen(true),120);}
 function keepOpen(){clearTimeout(closeTimer.current);clearTimeout(openTimer.current);}
 function hide(){if(savingRef.current)return;clearTimeout(closeTimer.current);clearTimeout(openTimer.current);setOpen(false);setWaMenu(false);if(panelRef.current?.contains(document.activeElement))document.activeElement.blur();}
 function leave(){clearTimeout(openTimer.current);closeTimer.current=setTimeout(()=>{const focused=panelRef.current?.contains(document.activeElement)&&/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'');if(!busy&&!dirty&&!focused)hide();},470);}
 useEffect(()=>{const fn=e=>{if(e.key==='Escape'&&e.target?.closest?.('.ccqu'))hide();};document.addEventListener('keydown',fn);return()=>document.removeEventListener('keydown',fn);},[busy]);
 useEffect(()=>{if(!visible||!open||!query.trim())return;const q=query.trim(),token=epoch.current,seq=++searchSeq.current;
  const timer=setTimeout(async()=>{setSearching(true);try{const data=await api.get('/api/aria/search?q='+encodeURIComponent(q),{cacheTtlMs:0,allowStale:false,retries:0});if(token===epoch.current&&seq===searchSeq.current)setResults((data.items||[]).filter(x=>!selected.some(s=>s.candidate_id===x.candidate_id)));}
  catch(e){if(token===epoch.current&&seq===searchSeq.current)setError(e.message||'Search unavailable');}
  finally{if(token===epoch.current&&seq===searchSeq.current)setSearching(false);}},240);
  return()=>clearTimeout(timer);
 },[query,selected.map(x=>x.candidate_id).join('|'),identity,visible,open]);
 async function addCandidate(row){if(savingRef.current||selected.some(x=>x.candidate_id===row.candidate_id))return;const token=epoch.current;searchSeq.current++;setSearching(false);setLoading(String(row.candidate_id));setError('');
  try{const data=await api.get('/api/candidates/'+encodeURIComponent(row.candidate_id)+'?edit_only=1',{cacheTtlMs:0,allowStale:false,retries:0});if(token!==epoch.current)return;
   if(!data.item?.candidate_id)throw Error('Candidate not found');setSelected(old=>old.some(x=>x.candidate_id===data.item.candidate_id)?old:[...old,data.item]);setQuery('');setResults([]);setOutcomes(old=>({...old,[data.item.candidate_id]:null}));setTimeout(()=>inputRef.current?.focus({preventScroll:true}),30);}
  catch(e){if(token===epoch.current)setError(e.message||'Candidate could not be loaded');}finally{if(token===epoch.current)setLoading('');}
 }
 function removeCandidate(id){if(busy)return;setSelected(old=>old.filter(x=>x.candidate_id!==id));setOutcomes(old=>{const n={...old};delete n[id];return n;});setInterviews(old=>{const n={...old};delete n[id];return n;});}
 function change(key,value){if(savingRef.current||readOnly)return;if(unknownRef.current.size){setError('Retry Save to verify the previous request before changing it.');return;}setDraft(d=>({...d,[key]:value,...(key==='followup'?{followupSet:true}:{})}));setError('');setOutcomes({});}
 function changeTab(key){clearTimeout(hoverTimer.current);setActive(key);setWaMenu(false);}
 function hoverTab(key){clearTimeout(hoverTimer.current);if(Date.now()<hoverSuppressedUntil.current)return;hoverTimer.current=setTimeout(()=>changeTab(key),110);}
 async function loadInterviews(){const token=epoch.current;const fresh=selected.filter(x=>!Object.prototype.hasOwnProperty.call(interviews,x.candidate_id));
  for(const row of fresh){try{const data=await api.get('/api/aria/interviews/'+encodeURIComponent(row.candidate_id),{cacheTtlMs:0,retries:0});if(token===epoch.current)setInterviews(old=>({...old,[row.candidate_id]:data.items||[]}));}
   catch(e){if(token===epoch.current)setInterviews(old=>({...old,[row.candidate_id]:{error:e.message||'Cannot load interviews'}}));}}
 }
 useEffect(()=>{if(open&&active==='interview'&&selected.length)loadInterviews();},[active,open,selected.map(x=>x.candidate_id).join('|')]);
 useEffect(()=>onCandidateRealtime(payload=>{if(!payload.meta?.committed||payload.meta?.source==='aria-bulk'||busy)return;setSelected(old=>old.map(row=>String(row.candidate_id)===String(payload.item?.candidate_id)?payload.item:row));}),[identity,busy]);
 async function copy(text){const value=String(text??'');if(!value.trim())return say('Nothing to copy');try{await navigator.clipboard.writeText(value);say('Copied');}catch{say('Clipboard permission denied');}}
 function makeEntry(row){const fields={},base_values={};const put=(key,val)=>{fields[key]=val;base_values[key]=String(row[key]??'');};
  if(draft.status&&draft.status!==row.status)put('status',draft.status);
  if(draft.interview){const iso=toIso(draft.interview);if(Date.parse(iso)!==Date.parse(row.interview_reschedule_date||row.interview_date||'')){put('interview_reschedule_date',iso);put('interview_date',iso);}}
  if(draft.followupSet){const val=toIso(draft.followup);if((val||row.follow_up_at)&&Date.parse(val)!==Date.parse(row.follow_up_at||'')){put('follow_up_at',val);put('follow_up_status',val?'Open':'');}}
  if(draft.details&&draft.details!==row.all_details_sent)put('all_details_sent',draft.details);
  const note=draft.note.trim(),interview_id=interviewPick[row.candidate_id]||'';
  const list=interviews[row.candidate_id];const ix=Array.isArray(list)?list.find(i=>i.interview_id===interview_id)||(list.length===1?list[0]:null):null;
  const payload={candidate_id:row.candidate_id,fields,base_values,note,...(draft.interview?{interview_id:ix?.interview_id||'',interview_base:ix?.scheduled_at||''}:{})};
  const signature=JSON.stringify(payload);let key=receiptRef.current.get(signature);
  if(!key){key=crypto.randomUUID().replaceAll('-','');receiptRef.current.set(signature,key);}
  return {...payload,command_id:key,__signature:signature};
 }
 async function save(){if(savingRef.current||readOnly||!selected.length||!dirty)return;const token=epoch.current;
  const entries=selected.map(makeEntry).filter(x=>(Object.keys(x.fields).length||x.note)&&!confirmedRef.current.has(x.candidate_id+'|'+JSON.stringify(draft)));
  if(!entries.length){say('No new changes to save');return;}
  if(draft.interview){const blocked=selected.filter(x=>interviews[x.candidate_id]?.error||!Array.isArray(interviews[x.candidate_id]));if(blocked.length){setError('Interview list unavailable. Retry opening Interview before saving.');return;}
   const ambiguous=selected.filter(x=>(interviews[x.candidate_id]||[]).length>1&&!interviewPick[x.candidate_id]);if(ambiguous.length){setError('Choose a specific interview for: '+ambiguous.map(x=>x.full_name).join(', '));changeTab('interview');return;}}
  savingRef.current=true;setBusy(true);setError('');let good=0,bad=0;const nextOut={},confirmedLabels=new Set();
  // Batch in bounded requests, without limiting how many + chips may be selected.
  for(let start=0;start<entries.length;start+=20){
   const batch=entries.slice(start,start+20);try{
    const data=await api.post('/api/aria/bulk-update',{updates:batch.map(({__signature,...x})=>x)},{timeoutMs:90000,retries:0});
    if(token!==epoch.current)return;
    for(const row of data.results||[]){const sent=batch.find(x=>x.candidate_id===row.candidate_id);if(!sent||nextOut[row.candidate_id])continue;
     if(row.committed&&String(row.item?.candidate_id)===String(sent.candidate_id)){good++;unknownRef.current.delete(sent.candidate_id);for(const label of row.confirmed_changes||[])confirmedLabels.add(label);confirmedRef.current.add(sent.candidate_id+'|'+JSON.stringify(draft));nextOut[row.candidate_id]={ok:true,message:row.replayed?'Already saved':'Saved to database'};
      setSelected(old=>old.map(x=>x.candidate_id===row.candidate_id?row.item:x));emitCandidateUpsert(row.item,{source:'aria-bulk',committed:true,changed_fields:Object.keys(sent.fields),note:row.note||null});
      if(draft.interview&&row.interview_id)setInterviews(old=>({...old,[row.candidate_id]:(old[row.candidate_id]||[]).map(i=>i.interview_id===row.interview_id?{...i,scheduled_at:sent.fields.interview_date}:i)}));
     }else{bad++;unknownRef.current.delete(sent.candidate_id);nextOut[row.candidate_id]={ok:false,code:row.code,message:row.message||'Not saved'};}
    }
    if((data.results||[]).length!==batch.length){for(const row of batch.filter(x=>!nextOut[x.candidate_id])){bad++;unknownRef.current.add(row.candidate_id);nextOut[row.candidate_id]={ok:false,code:'UNCONFIRMED',message:'No server confirmation · retry Save'};}}
   }catch(e){if(token!==epoch.current)return;for(const row of batch){bad++;unknownRef.current.add(row.candidate_id);nextOut[row.candidate_id]={ok:false,code:'UNCONFIRMED',message:e.message||'Network error · retry safely'};}}
  }
  if(token===epoch.current){setOutcomes(old=>({...old,...nextOut}));savingRef.current=false;setBusy(false);if(good)say(`${good} saved${confirmedLabels.size?' · '+[...confirmedLabels].join(', '):' · verified'}${bad?` · ${bad} need review`:''}`);if(bad)setError(`${bad} candidate(s) not saved · review results and retry`);else{setDraft(EMPTY);receiptRef.current.clear();confirmedRef.current.clear();unknownRef.current.clear();setActive('status');hide();}}
 }
 async function refreshSelected(){
  if(savingRef.current||!selected.length)return;if(unknownRef.current.size){setError('Retry Save first to confirm the previous request.');return;}
  const token=epoch.current;setLoading('refresh');setError('');
  try{for(const row of selected){const data=await api.get('/api/candidates/'+encodeURIComponent(row.candidate_id)+'?edit_only=1',{cacheTtlMs:0,allowStale:false,retries:0});if(token!==epoch.current)return;if(data.item?.candidate_id===row.candidate_id)setSelected(old=>old.map(x=>x.candidate_id===row.candidate_id?data.item:x));}
   if(token===epoch.current){setInterviews({});say('Latest values loaded · review your changes');}
  }catch(error){if(token===epoch.current)setError(error.message);}finally{if(token===epoch.current)setLoading('');}
 }
 function contactGuard(id,token){return token===epoch.current&&currentRef.current.identity===identity&&currentRef.current.singleId===String(id)&&!window.__CC602_NETWORK_PAUSED__;}
 async function whatsapp(text=''){if(!single||contactBusy||readOnly)return;const id=single.candidate_id,token=epoch.current;setContactBusy(true);setError('');setWaMenu(false);try{const r=await openWhatsAppWithLog(single.candidate_id,single.phone,text,{source:'aria-quick',guard:()=>contactGuard(id,token)});if(!contactGuard(id,token))return;if(!r||r.error)throw Error(r?.error||'WhatsApp Desktop unavailable');say(r.needsClick?'Open WhatsApp Desktop to continue':'WhatsApp Desktop requested');}catch(e){setError(e.message);}finally{setContactBusy(false);}}
 async function dial(){if(!single||contactBusy||readOnly)return;const id=single.candidate_id,token=epoch.current;setContactBusy(true);setError('');try{await dialCandidateWithLog(single.candidate_id,single.phone,{candidate_name:single.full_name,process:single.process,client:single.client,location:single.location,source:'aria-quick',guard:()=>contactGuard(id,token)});if(contactGuard(id,token))say('Call sent to paired phone');}catch(e){setError(e.message||'Pair phone first');}finally{setContactBusy(false);}}
 const content=<section className="ccqu ccqu-panel ccqu-docked" role="dialog" aria-label="ARIA candidate quick update" ref={panelRef} onPointerEnter={keepOpen} onPointerLeave={leave} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();save();}}}>
  <header className="ccqu-header"><span className="ccqu-brand"><Icon name="bolt"/><strong>ARIA</strong><small>Quick Update</small></span><div className="ccqu-header-actions">{selected.length?<button type="button" aria-label="Refresh selected candidates" title="Refresh latest candidate values" disabled={busy||!!loading} onClick={refreshSelected}><Icon name="refresh"/></button>:null}<button type="button" title="Minimise" aria-label="Minimise ARIA" onClick={hide}><Icon name="min"/></button></div></header>
  <div className="ccqu-content">
   <form className="ccqu-search" onSubmit={e=>e.preventDefault()}><Icon name="search"/><input ref={inputRef} aria-label="Find candidate by name number or ID" placeholder="Name · Number · Candidate ID" value={query} maxLength={80} autoComplete="off" disabled={busy} onChange={e=>{searchSeq.current++;setSearching(false);setQuery(e.target.value);setResults([]);setError('');}}/><button type="button" aria-label="Add candidate from search" title="Add candidate" disabled={busy} onClick={()=>{if(results.length===1)addCandidate(results[0]);else inputRef.current?.focus({preventScroll:true});}}><Icon name="plus"/></button></form>
   {searching||loading?<div className="ccqu-search-state" role="status">{loading?'Adding candidate…':'Searching…'}</div>:null}
   {query&&results.length?<div className="ccqu-results ccqu-aria-results" role="listbox" aria-label="Candidate suggestions">{results.map(r=><button type="button" role="option" aria-selected="false" key={r.candidate_id} disabled={busy||!!loading} onClick={()=>addCandidate(r)}><span><strong>{r.full_name||r.candidate_id}</strong><small>{r.candidate_id} · {r.phone||'Phone hidden'}</small></span><b>＋</b></button>)}</div>:null}
   {selected.length?<div className="ccqu-aria-selected"><div className="ccqu-aria-count"><strong>{selected.length} selected</strong><small>One action → all selected</small></div><div className="ccqu-aria-chips">{selected.map(row=><div key={row.candidate_id} className={'ccqu-aria-chip '+(outcomes[row.candidate_id]?.ok?'is-saved':outcomes[row.candidate_id]?'is-failed':'')}><span data-copy-value={row.full_name||row.candidate_id} data-copy-label="candidate name" title={row.full_name+' · '+row.candidate_id+' · '+(row.recruiter_name||'')}>{row.full_name||row.candidate_id}</span><button type="button" title={'Remove '+row.full_name} aria-label={'Remove '+row.full_name} onClick={()=>removeCandidate(row.candidate_id)}>×</button></div>)}</div></div>:<div className="ccqu-aria-hint">Type even 1 letter, pick a person, then ＋ add more</div>}
   {readOnly?<div className="ccqu-message">Read-only dashboard · switch to your editable dashboard</div>:null}
   {selected.length?<><div className="ccqu-option-grid ccqu-aria-actions" role="tablist" aria-label="ARIA quick actions">{sections.map(([key,label,icon])=><button type="button" key={key} role="tab" aria-selected={active===key} className={'ccqu-option ccqu-'+key+(active===key?' is-active':'')} onPointerEnter={()=>hoverTab(key)} onPointerLeave={()=>clearTimeout(hoverTimer.current)} onFocus={()=>changeTab(key)} onClick={()=>changeTab(key)}><span className="ccqu-option-head"><Icon name={icon}/><strong>{label}</strong></span></button>)}</div>
   <div className={'ccqu-editor ccqu-aria-editor ccqu-editor-'+active} role="tabpanel"><div className="ccqu-editor-title"><span>{sections.find(x=>x[0]===active)?.[1]}</span><small>Hover or click an action</small></div>
    {active==='status'?<div className="ccqu-statuses">{STATUS.map(s=><button type="button" key={s} disabled={busy||readOnly} aria-pressed={draft.status===s} className={(draft.status===s?'is-chosen ':'')+(/Rejected|Backout|Not Interested/.test(s)?'tone-red':/Joined|Completed/.test(s)?'tone-green':/Selected|Joining/.test(s)?'tone-amber':'tone-blue')} onClick={()=>change('status',s)}>{s}</button>)}</div>:null}
    {active==='interview'?<><div className="ccqu-aria-interview-list">{selected.map(row=>{const list=interviews[row.candidate_id];return <label key={row.candidate_id}>{row.full_name}<select aria-label={'Interview for '+row.full_name} disabled={busy||readOnly||!Array.isArray(list)} value={interviewPick[row.candidate_id]||((Array.isArray(list)&&list.length===1)?list[0].interview_id:'')} onChange={e=>setInterviewPick(old=>({...old,[row.candidate_id]:e.target.value}))}><option value="">{!Array.isArray(list)?'Loading interviews…':list.length>1?'Choose exact interview':list.length===0?'Profile interview date only':'Select interview'}</option>{Array.isArray(list)&&list.map(i=><option key={i.interview_id} value={i.interview_id}>{i.interview_id} · {i.stage||'Interview'} · {displayDate(i.scheduled_at)}</option>)}</select></label>;})}</div><div className="ccqu-presets">{[['Today',preset(0)],['Tomorrow',preset(0,true)]].map(([name,val])=><button type="button" key={name} onClick={()=>change('interview',val)}>{name}</button>)}</div><fieldset disabled={busy||readOnly}><Calendar value={draft.interview} label="Interview" onChange={v=>change('interview',v)}/></fieldset></>:null}
    {active==='note'?<><div className="ccqu-aria-note-preview">{single?.notes?<CopyInline value={single.notes} onCopy={copy} label="Latest note"/>:<small>{selected.length>1?'Same new note will be added separately to every selected candidate':'Add a new note without removing old notes'}</small>}</div><textarea className="ccqu-aria-textarea" aria-label="ARIA new note" placeholder="Type or paste a note…" value={draft.note} maxLength={4000} disabled={busy||readOnly} onChange={e=>change('note',e.target.value)}/><div className="ccqu-note-presets">{[...new Set([...NOTES,...getNoteTemplates()])].slice(0,12).map(n=><button type="button" key={n} disabled={busy||readOnly} onClick={()=>change('note',n)}>{n}</button>)}</div></>:null}
    {active==='followup'?<><div className="ccqu-presets">{[[15,'15m'],[30,'30m'],[60,'1h'],[120,'2h']].map(([m,t])=><button type="button" key={m} onClick={()=>change('followup',preset(m))}>{t}</button>)}<button type="button" onClick={()=>change('followup',preset(0,true))}>Tomorrow 10am</button><button type="button" onClick={()=>change('followup','')}>Clear</button></div><fieldset disabled={busy||readOnly}><Calendar value={draft.followup} label="Follow-up" onChange={v=>change('followup',v)}/></fieldset></>:null}
    {active==='details'?<div className="ccqu-aria-details"><p>All Details Sent</p><small>Uses the same completion rules as the full profile.</small>{['Pending','Completed','Only Resume Pending'].map(s=><button type="button" key={s} className={draft.details===s?'is-chosen':''} disabled={busy||readOnly} onClick={()=>change('details',s)}>{s}</button>)}</div>:null}
    {active==='whatsapp'&&single?<div className="ccqu-aria-wa-list">{templates.map((t,i)=><button type="button" key={t.id||i} disabled={contactBusy||readOnly} onClick={()=>whatsapp(String(t.body||'').replace(/\{\{candidate_name\}\}/g,single.full_name||'Candidate').replace(/\{\{first_name\}\}/g,String(single.full_name||'Candidate').split(' ')[0]).replace(/\{\{recruiter_name\}\}/g,single.recruiter_name||user?.full_name||'Career Crox'))}>{t.title}</button>)}</div>:null}
   </div>
   {single?<div className="ccqu-aria-person"><CopyInline value={single.full_name} onCopy={copy} label="Name"/><CopyInline value={single.phone} onCopy={copy} label="Phone"/><CopyInline value={single.email} onCopy={copy} label="Email"/><div className="ccqu-contact-actions"><button className="ccqu-call" title="Dial" disabled={contactBusy||readOnly} onClick={dial}><Icon name="phone"/></button><button className="ccqu-whatsapp" title="WhatsApp Desktop" disabled={contactBusy||readOnly} onClick={()=>{clearTimeout(hoverTimer.current);setWaMenu(x=>!x);}}><Icon name="whatsapp"/></button></div>{waMenu?<div className="ccqu-wa-menu"><button type="button" onClick={()=>whatsapp('')}>WhatsApp only</button><button type="button" onClick={async()=>{const token=epoch.current;clearTimeout(hoverTimer.current);hoverSuppressedUntil.current=Date.now()+450;setTemplates(getWhatsAppTemplates());setActive('whatsapp');setWaMenu(false);const ts=await loadSharedWhatsAppTemplates().catch(()=>getWhatsAppTemplates());if(token===epoch.current)setTemplates(ts);}}>Preset messages</button></div>:null}</div>:null}
   {Object.entries(outcomes).length?<div className="ccqu-aria-outcomes" role="status">{selected.filter(row=>outcomes[row.candidate_id]).map(row=><div key={row.candidate_id} className={outcomes[row.candidate_id].ok?'ok':'fail'}>{outcomes[row.candidate_id].ok?'✓':'!'} {row.full_name} · {outcomes[row.candidate_id].message}</div>)}</div>:null}
   {error?<div className="ccqu-message is-error" role="alert">{error}</div>:null}
   </>:null}
  </div>
  <footer className="ccqu-footer"><span>{busy?'Saving to database…':selected.length?`${selected.length} candidates · ${dirty?'changes ready':'select an action'}`:'Add candidates with ＋'}</span><button className="ccqu-save" type="button" disabled={!selected.length||!dirty||busy||readOnly} onClick={save}><Icon name="save"/>{busy?'Saving…':`Save ${selected.length||''}`}</button></footer>
 </section>;
 if(!visible)return null;
 return createPortal(<><style>{styles}</style><div className="ccqu ccqu-launcher" onPointerEnter={openPanel} onPointerLeave={leave}><button type="button" title="ARIA Quick Update" aria-label="Open ARIA" aria-expanded={open} onClick={()=>{setOpen(true);setTimeout(()=>inputRef.current?.focus({preventScroll:true}),50);}}><span className="ccqu-aria-mark">ARIA</span>{dirty?<b/>:null}</button></div>{toast?<div className="ccqu ccqu-toast ccqu-aria-top-toast" role="status"><Icon name="save"/>{toast}</div>:null}{open?content:null}</>,document.body);
}
function CopyInline({value,label}){if(value==null||String(value)==='')return null;return <span className="ccqu-aria-copy" tabIndex={0} data-copy-value={String(value)} data-copy-label={label} title={String(value)}><span>{value}</span></span>;}

const styles=String.raw`.ccqu{font-family:Inter,"Segoe UI",system-ui,sans-serif!important;font-size:12px!important;line-height:1.4!important;color:#19263e!important;text-align:left!important;letter-spacing:0!important;box-sizing:border-box!important;color-scheme:light!important}
.ccqu *{box-sizing:border-box!important;letter-spacing:normal!important}
.ccqu button,.ccqu input,.ccqu textarea{font:inherit!important;line-height:1.4!important;text-transform:none!important;letter-spacing:normal!important}
.ccqu button{cursor:pointer!important;transition:transform .15s ease,background .15s ease,box-shadow .15s ease!important;box-shadow:none!important;margin:0!important;min-height:0!important;white-space:normal!important;outline-offset:2px!important}
.ccqu button:hover:not(:disabled){transform:translateY(-1px)!important}
.ccqu button:focus-visible,.ccqu input:focus-visible,.ccqu textarea:focus-visible{outline:2px solid #3862e6!important;outline-offset:2px!important}
.ccqu button:disabled{cursor:default!important;opacity:.5!important;transform:none!important}
.ccqu svg{flex:none!important;display:block!important;pointer-events:none!important;fill:none!important;stroke:currentColor!important}
.ccqu-launcher{position:fixed!important;right:11px!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;width:40px!important;height:40px!important;z-index:11002!important;pointer-events:none!important}
.ccqu-launcher>button{pointer-events:auto!important;display:grid!important;place-items:center!important;position:relative!important;width:40px!important;height:40px!important;padding:9px!important;border:1px solid #6c9cff70!important;border-radius:15px!important;background:linear-gradient(135deg,#d3e4ff70,#b7d3ff3b)!important;color:#2457bdc9!important;backdrop-filter:blur(12px)!important;-webkit-backdrop-filter:blur(12px)!important;box-shadow:0 3px 15px #2b518918,inset 0 1px 0 #ffffffa0!important}
.ccqu-launcher>button:hover,.ccqu-launcher>button:focus-visible,.ccqu-launcher>button[aria-expanded=true]{transform:scale(1.1)!important;background:linear-gradient(140deg,#377aff,#6658e6)!important;color:#fff!important;border-color:#ffffffa1!important;box-shadow:0 6px 21px #315ec244!important}
.ccqu-launcher b{position:absolute!important;top:3px!important;right:3px!important;width:6px!important;height:6px!important;border-radius:50%!important;background:#ef9f19!important;box-shadow:0 0 0 2px #fff!important}
.ccqu-panel{display:flex!important;flex-direction:column!important;background:linear-gradient(145deg,#fffffffa,#f7f9ffff)!important;border:1px solid #cdd9ed!important;border-radius:17px!important;box-shadow:0 12px 42px #2137642b,0 2px 8px #24438012!important;overflow:visible!important;isolation:isolate;z-index:11001!important}
.ccqu-docked{position:fixed!important;right:62px!important;top:50%!important;bottom:auto!important;transform:translateY(-50%)!important;width:336px!important;max-width:calc(100vw - 74px)!important;height:488px!important;max-height:calc(100dvh - 24px)!important;animation:qu-open .17s ease-out}
.ccqu-docked.ccqu-small{height:auto!important;min-height:142px!important}
.ccqu-header{display:flex!important;align-items:center!important;justify-content:space-between!important;padding:9px 11px!important;gap:7px!important;background:linear-gradient(110deg,#eaf1ff,#f5ecff)!important;border-bottom:1px solid #dce4f4!important;border-radius:16px 16px 0 0!important;flex:none!important;min-height:44px!important}
.ccqu-brand{display:flex!important;align-items:center!important;gap:7px!important;color:#4563d2!important}
.ccqu-brand>svg{width:24px!important;height:24px!important;padding:4px!important;background:#fff9!important;border:1px solid #d6e1fe!important;border-radius:8px!important}
.ccqu-brand strong{font-size:12px!important;font-weight:750!important;color:#283857!important}
.ccqu-header-actions{display:flex!important;gap:4px!important}
.ccqu-header-actions button{width:25px!important;height:25px!important;display:grid!important;place-items:center!important;border:1px solid #d6dff0!important;background:#ffffffc9!important;color:#466082!important;border-radius:8px!important;padding:4px!important}
.ccqu-header-actions svg{width:15px!important;height:15px!important}
.ccqu-content{display:flex!important;flex-direction:column!important;overflow:hidden!important;overscroll-behavior:contain!important;min-height:0!important;flex:1 1 auto!important;padding:9px!important;border-radius:0 0 16px 16px!important}
.ccqu-search{flex:none!important;display:flex!important;align-items:center!important;gap:6px!important;border:1px solid #d2ddef!important;border-radius:10px!important;background:#f4f7ff!important;color:#516da3!important;padding:0 8px!important;margin:0 0 8px!important;height:34px!important}
.ccqu-search:focus-within{border-color:#6988e4!important;box-shadow:0 0 0 2px #355de611!important;background:#fff!important}
.ccqu-search>svg{width:15px!important;height:15px!important}
.ccqu-search input{border:0!important;outline:0!important;box-shadow:none!important;background:transparent!important;color:#18253e!important;padding:6px 0!important;border-radius:0!important;min-width:0!important;width:100%!important;height:31px!important;font-size:11px!important}
.ccqu-search input::placeholder{color:#6a7d9d!important}
.ccqu-search button{display:grid!important;place-items:center!important;border:0!important;padding:3px!important;background:transparent!important;color:#627b9e!important}
.ccqu-search-state{display:flex!important;align-items:center!important;gap:6px!important;color:#4562a2!important;font-size:10px!important;padding:5px 2px!important;flex:none!important}
.ccqu-search-state i{width:10px;height:10px;border:2px solid #d7e1fa;border-top-color:#526bd6;border-radius:50%;animation:qu-spin .6s linear infinite}
.ccqu-results{max-height:310px!important;overflow:auto!important;scrollbar-width:thin!important}
.ccqu-results>small{display:block!important;padding:4px 2px!important;color:#647591!important;font-size:10px!important}
.ccqu-results button{display:flex!important;align-items:center!important;gap:6px!important;width:100%!important;text-align:left!important;border:1px solid #dde5f3!important;border-radius:9px!important;background:#fff!important;padding:8px!important;color:#243455!important;margin-bottom:5px!important}
.ccqu-results button>span{flex:1!important;min-width:0!important;display:flex!important;flex-direction:column!important}
.ccqu-results strong{font-size:11px!important;font-weight:700!important;overflow-wrap:anywhere!important}
.ccqu-results small{font-size:9px!important;color:#67809c!important}
.ccqu-results em{font-size:9px!important;font-style:normal!important;color:#6946b1!important;background:#efe8fb!important;border-radius:5px!important;padding:3px 5px!important;max-width:90px!important}
.ccqu-person{position:relative!important;display:flex!important;align-items:center!important;gap:6px!important;padding:7px 8px!important;background:linear-gradient(100deg,#f0f5ff,#f3efff)!important;border:1px solid #dce4f8!important;border-radius:10px!important;flex:none!important;margin:0 0 8px!important;min-height:48px!important}
.ccqu-person-copy{min-width:0!important;flex:1!important}
.ccqu-person-copy>strong{display:flex!important;flex-wrap:wrap!important;align-items:center!important;gap:3px 5px!important;font-size:11px!important;font-weight:750!important;color:#263d64!important;overflow-wrap:anywhere!important}
.ccqu-person-copy em{font-style:normal!important;font-weight:650!important;font-size:9px!important;line-height:1.35!important;background:#ebe4fb!important;color:#7444a9!important;padding:1px 4px!important;border-radius:4px!important}
.ccqu-person-copy>small{display:block!important;font-size:9px!important;color:#506887!important;margin-top:2px!important;overflow-wrap:anywhere!important}
.ccqu-contact-actions{display:flex!important;gap:5px!important;flex:none!important}
.ccqu-contact-actions button{width:29px!important;height:29px!important;display:grid!important;place-items:center!important;padding:5px!important;border-radius:9px!important;border:1px solid #ffffffb0!important;box-shadow:0 2px 5px #25477c1c!important}
.ccqu-contact-actions button:hover:not(:disabled){transform:scale(1.1)!important}
.ccqu-contact-actions .ccqu-call{background:linear-gradient(145deg,#367ce9,#4056c9)!important;color:#fff!important}
.ccqu-contact-actions .ccqu-whatsapp{background:linear-gradient(145deg,#0ab978,#00835d)!important;color:#fff!important}
.ccqu-contact-actions svg{width:17px!important;height:17px!important}
.ccqu-wa-menu{position:absolute!important;right:5px!important;top:calc(100% - 3px)!important;z-index:4!important;width:170px!important;padding:5px!important;border:1px solid #cee4dc!important;border-radius:11px!important;background:#fff!important;box-shadow:0 8px 24px #204c4526!important;animation:qu-editor .12s ease-out}
.ccqu-wa-menu button{display:flex!important;align-items:center!important;gap:7px!important;width:100%!important;text-align:left!important;font-size:11px!important;font-weight:650!important;color:#16614f!important;background:#eaf8f1!important;border:0!important;border-radius:7px!important;padding:9px 8px!important}
.ccqu-wa-menu button+button{margin-top:4px!important;color:#6750a7!important;background:#f1edfc!important}
.ccqu-option-grid{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:5px!important;flex:none!important;margin:0 0 8px!important}
.ccqu-option{display:flex!important;flex-direction:column!important;justify-content:center!important;align-items:flex-start!important;border:1px solid transparent!important;border-radius:10px!important;padding:6px 5px!important;height:55px!important;min-width:0!important;text-align:left!important}
.ccqu-option-head{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:2px!important;width:100%!important;min-width:0!important}
.ccqu-option-head>svg{width:12px!important;height:12px!important}
.ccqu-option strong{display:flex!important;align-items:center!important;gap:3px!important;font-size:10px!important;font-weight:750!important;white-space:nowrap!important;line-height:1.2!important}
.ccqu-option>small{display:block!important;max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;font-size:8px!important;margin-top:3px!important;opacity:.85!important;line-height:1.3!important}
.ccqu-status{color:#23469d!important;background:linear-gradient(140deg,#e2edff,#d6e3ff)!important;border-color:#c8d9fa!important}
.ccqu-interview{color:#964405!important;background:linear-gradient(140deg,#fff1d5,#ffe3c0)!important;border-color:#f9d3a9!important}
.ccqu-note{color:#7040a4!important;background:linear-gradient(140deg,#f2e6ff,#e8d7ff)!important;border-color:#ddc9f4!important}
.ccqu-followup{color:#116b5a!important;background:linear-gradient(140deg,#dff8ed,#c7efdf)!important;border-color:#bae1d4!important}
.ccqu-option.is-active{outline:2px solid currentColor!important;outline-offset:-2px!important;box-shadow:0 3px 8px #263c6c15!important}
.ccqu-dirty-dot{width:4px!important;height:4px!important;border-radius:50%!important;background:currentColor!important}
.ccqu-editor{overflow:auto!important;overscroll-behavior:contain!important;scrollbar-width:thin!important;scrollbar-color:#bac9e1 transparent!important;flex:1 1 auto!important;min-height:0!important;padding:8px!important;border:1px solid #dde5f2!important;border-radius:11px!important;background:#fff!important;animation:qu-editor .14s ease-out}
.ccqu-editor-title{display:flex!important;align-items:center!important;justify-content:space-between!important;margin-bottom:7px!important;gap:4px!important}
.ccqu-editor-title>span{font-size:10px!important;font-weight:750!important;color:#3b5278!important}
.ccqu-editor-title small{font-size:8px!important;color:#72849f!important}
.ccqu-statuses{display:grid!important;grid-template-columns:1fr 1fr!important;gap:5px!important}
.ccqu-statuses button{display:flex!important;align-items:center!important;justify-content:flex-start!important;min-height:29px!important;padding:6px 7px!important;border-radius:7px!important;border:1px solid #dce6f5!important;font-size:10px!important;text-align:left!important;font-weight:650!important;line-height:1.3!important}
.ccqu-statuses .tone-blue{background:#edf3ff!important;color:#315382!important}
.ccqu-statuses .tone-red{background:#fff0f1!important;color:#a12e42!important;border-color:#f4d6df!important}
.ccqu-statuses .tone-amber{background:#fff5dd!important;color:#8d5c0b!important;border-color:#efdfb9!important}
.ccqu-statuses .tone-green{background:#e4f7ec!important;color:#1d704e!important;border-color:#cde9da!important}
.ccqu-statuses button.is-chosen{outline:2px solid #4b6add!important;outline-offset:-2px!important;font-weight:750!important}
.ccqu-presets{display:flex!important;flex-wrap:wrap!important;gap:4px!important;margin-bottom:6px!important}
.ccqu-presets button{background:#edf2ff!important;color:#3959a4!important;border:1px solid #d7e2fc!important;border-radius:6px!important;padding:4px 6px!important;font-size:9px!important;font-weight:650!important}
.ccqu fieldset{margin:0!important;padding:0!important;border:0!important;min-width:0!important}
.ccqu-calendar{display:flex!important;flex-direction:column!important}
.ccqu-month{display:flex!important;justify-content:space-between!important;align-items:center!important;margin-bottom:3px!important}
.ccqu-month strong{font-size:10px!important;color:#3d5275!important;font-weight:700!important}
.ccqu-month button{width:23px!important;height:23px!important;display:grid!important;place-items:center!important;border:0!important;border-radius:6px!important;padding:3px!important;background:#f0f4fc!important;color:#516fa2!important}
.ccqu-month svg{width:13px!important;height:13px!important}
.ccqu-days{display:grid!important;grid-template-columns:repeat(7,minmax(0,1fr))!important;gap:2px!important;text-align:center!important}
.ccqu-days>small{font-size:8px!important;color:#7d8da8!important;padding:2px!important}
.ccqu-days button{height:23px!important;padding:2px!important;border:0!important;border-radius:6px!important;background:#f4f6fc!important;color:#39527a!important;font-size:10px!important;font-weight:600!important}
.ccqu-days .is-today{box-shadow:inset 0 0 0 1px #9db1e8!important}
.ccqu-days button.is-selected{background:#4668df!important;color:#fff!important;font-weight:750!important}
.ccqu-time{display:grid!important;grid-template-columns:1.2fr 1fr!important;gap:6px!important;order:-1!important;margin:0 0 7px!important}
.ccqu-time label{display:flex!important;flex-direction:column!important;gap:2px!important;color:#617897!important;font-size:9px!important}
.ccqu-time input{width:100%!important;min-width:0!important;font-size:10px!important;height:29px!important;padding:4px 5px!important;border-radius:7px!important;border:1px solid #d1ddef!important;background:#fff!important;color:#263b59!important;box-shadow:none!important}
.ccqu-latest{background:#f4f1fc!important;border-radius:7px!important;padding:6px 7px!important;margin-bottom:7px!important;border-left:2px solid #b8a1df!important}
.ccqu-latest small{color:#745b9d!important;font-size:8px!important}
.ccqu-latest p{margin:2px 0 0!important;color:#554276!important;font-size:10px!important;line-height:1.4!important;max-height:38px!important;overflow:auto!important;overflow-wrap:anywhere!important}
.ccqu-note-label{display:block!important;font-size:10px!important;font-weight:650!important;color:#665083!important}
.ccqu-note-label textarea{display:block!important;resize:vertical!important;min-height:62px!important;max-height:120px!important;width:100%!important;background:#fff!important;color:#263956!important;border:1px solid #d5c9ec!important;border-radius:8px!important;padding:7px!important;font-size:11px!important;line-height:1.45!important;margin:4px 0 7px!important;box-shadow:none!important}
.ccqu-note-presets{display:flex!important;flex-wrap:wrap!important;gap:4px!important}
.ccqu-note-presets button{padding:4px 6px!important;border:1px solid #e1d6f1!important;background:#f4eefc!important;color:#6d478f!important;border-radius:6px!important;font-size:9px!important;text-align:left!important}
.ccqu-wa-presets{display:flex!important;flex-direction:column!important;gap:5px!important}
.ccqu-wa-presets button{display:flex!important;align-items:center!important;gap:7px!important;border:1px solid #ccebdc!important;border-radius:8px!important;background:#effaf4!important;color:#1c7c58!important;padding:7px!important;width:100%!important;text-align:left!important}
.ccqu-wa-presets span{display:flex!important;flex-direction:column!important;gap:2px!important;flex:1!important;min-width:0!important}
.ccqu-wa-presets strong{font-size:10px!important;font-weight:700!important}
.ccqu-wa-presets small{display:block!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;color:#5c7c6e!important;font-size:9px!important}
.ccqu-footer{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:7px!important;flex:none!important;padding:8px 10px!important;background:#fff!important;border-top:1px solid #e1e8f4!important;border-radius:0 0 16px 16px!important;min-height:47px!important}
.ccqu-footer>span{font-size:10px!important;font-weight:650!important;color:#647796!important}
.ccqu .ccqu-save{display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;background:linear-gradient(120deg,#3667eb,#7454db)!important;color:#fff!important;border:0!important;border-radius:9px!important;padding:8px 14px!important;font-size:11px!important;font-weight:750!important;white-space:nowrap!important}
.ccqu .ccqu-save:disabled{background:#e8edf7!important;color:#8c9bb4!important;opacity:1!important}
.ccqu-message{flex:none!important;padding:6px 7px!important;border-radius:7px!important;margin-top:6px!important;font-size:10px!important;line-height:1.4!important;overflow-wrap:anywhere!important;max-height:74px!important;overflow:auto!important;background:#f0f4ff!important;color:#45618b!important}
.ccqu-message.is-error{background:#fff1f2!important;color:#a52d44!important;border:1px solid #f2d3dc!important}
.ccqu-message.is-success{background:#eaf8f1!important;color:#227552!important;border:1px solid #cee7db!important}
.ccqu-empty{padding:12px 7px!important;text-align:center!important;color:#536b8e!important;font-size:11px!important}
.ccqu-welcome{padding:12px 3px 5px!important;color:#7d89a2!important;font-size:10px!important;text-align:center!important}
.ccqu-toast{position:absolute!important;right:50px!important;top:0!important;display:flex!important;align-items:center!important;gap:5px!important;width:max-content!important;max-width:260px!important;padding:8px 10px!important;background:#edfff5!important;border:1px solid #bcebd3!important;border-radius:10px!important;box-shadow:0 4px 17px #2351391a!important;color:#237448!important;font-size:10px!important;pointer-events:none!important;animation:qu-editor .16s ease-out}
@keyframes qu-open{from{opacity:0;transform:translateY(-50%) scale(.97)}to{opacity:1;transform:translateY(-50%) scale(1)}}
@keyframes qu-editor{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@keyframes qu-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.ccqu,.ccqu *{animation:none!important;transition:none!important}}
@media(max-width:420px){.ccqu-docked{right:57px!important;max-width:calc(100vw - 66px)!important}.ccqu-launcher{right:9px!important;width:36px!important;height:36px!important}.ccqu-launcher>button{width:36px!important;height:36px!important}.ccqu-option{padding:6px 4px!important}.ccqu-option strong{font-size:9px!important}.ccqu-option-head>svg{width:11px!important;height:11px!important}}
/* CC910 ARIA — readability and compact high-contrast overlays, same 336×488 popup. */
.ccqu{font-size:13px!important;color:#17243c!important}
.ccqu-docked{width:336px!important;height:488px!important;box-shadow:0 24px 62px #172d6490,0 0 0 1px #95b2f4!important;animation:aria-rise .24s cubic-bezier(.18,.9,.28,1.2)!important}
.ccqu-launcher>button{background:linear-gradient(140deg,#273dcb,#8e2de2)!important;color:#fff!important;border:1px solid #f8d8ff!important;box-shadow:0 8px 22px #4a34d477,inset 0 1px 0 #ffffff80!important}
.ccqu-aria-mark{font-size:11px!important;font-weight:950!important;letter-spacing:.4px!important;text-shadow:0 1px 3px #12226280!important}
.ccqu-header{background:linear-gradient(115deg,#c8e6ff,#ebd8ff 62%,#fff0cb)!important;min-height:44px!important}
.ccqu-brand strong{font-size:17px!important;font-weight:950!important;color:#222a82!important;letter-spacing:.6px!important}
.ccqu-brand small{font-size:11px!important;font-weight:800!important;color:#6736b5!important}
.ccqu-content{padding:7px!important;gap:5px!important}
.ccqu-search{height:39px!important;min-height:39px!important;border:2px solid #6f8df1!important;margin-bottom:0!important;background:#fff!important}
.ccqu-search input{font-size:13px!important;font-weight:750!important;height:35px!important}
.ccqu-search>button{font-size:22px!important;font-weight:950!important;background:linear-gradient(145deg,#386bfc,#8640e5)!important;color:#fff!important;width:31px!important;height:30px!important;border-radius:8px!important}
.ccqu-aria-results{position:absolute!important;z-index:12!important;top:90px!important;left:8px!important;right:8px!important;max-height:220px!important;border:2px solid #9aa8ff!important;background:#fff!important;border-radius:12px!important;padding:5px!important;box-shadow:0 12px 32px #24376966!important}
.ccqu-aria-results strong{font-size:13px!important;color:#1c315d!important}.ccqu-aria-results small{font-size:11px!important;color:#445c87!important}.ccqu-aria-results b{font-size:20px!important;color:#315ef0!important}
.ccqu-aria-hint{font-size:12px!important;font-weight:700!important;color:#4555a1!important;padding:7px 5px!important;background:#eaf0ff!important;border-radius:9px!important}
.ccqu-aria-selected{flex:none!important;background:linear-gradient(115deg,#f3efff,#e9f3ff)!important;border:1px solid #c5d0fb!important;border-radius:10px!important;padding:5px 7px!important;max-height:86px!important;overflow:auto!important}
.ccqu-aria-count{display:flex!important;justify-content:space-between!important;align-items:center!important;gap:4px!important;margin-bottom:4px!important}.ccqu-aria-count strong{font-size:12px!important;color:#30248c!important}.ccqu-aria-count small{font-size:10px!important;font-weight:700!important;color:#5a4d95!important}
.ccqu-aria-chips{display:flex!important;flex-wrap:wrap!important;gap:4px!important}.ccqu-aria-chip{display:flex!important;align-items:center!important;gap:4px!important;max-width:150px!important;padding:3px 4px 3px 7px!important;border-radius:9px!important;background:linear-gradient(125deg,#d8e6ff,#e3d5ff)!important;border:1px solid #adbeee!important;color:#243d83!important;font-size:11px!important;font-weight:800!important;animation:aria-chip .23s ease-out!important}
.ccqu-aria-chip>span{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.ccqu-aria-chip button{border:0!important;border-radius:5px!important;background:#fff9!important;color:#813bc2!important;font-size:16px!important;font-weight:900!important;padding:0 4px!important}.ccqu-aria-chip.is-saved{background:#c7f4df!important;border-color:#2baf78!important}.ccqu-aria-chip.is-failed{background:#ffe0e5!important;border-color:#e14e66!important}
.ccqu-aria-actions{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:4px!important;margin:0!important}.ccqu-aria-actions .ccqu-option{height:41px!important;padding:5px!important;border-radius:9px!important;box-shadow:inset 0 1px 0 #fff8,0 2px 5px #263d7a24!important}.ccqu-aria-actions .ccqu-option-head{flex-direction:row!important;gap:4px!important;align-items:center!important}.ccqu-aria-actions .ccqu-option-head svg{width:14px!important;height:14px!important}.ccqu-aria-actions .ccqu-option strong{font-size:11.3px!important;font-weight:900!important;white-space:normal!important;line-height:1.12!important}.ccqu-details{background:linear-gradient(140deg,#ffdbef,#f5c3df)!important;color:#9a165e!important;border-color:#ed93c0!important}.ccqu-aria-actions .is-active{outline:2px solid currentColor!important;box-shadow:0 3px 12px #405ad050!important}
.ccqu-aria-editor{padding:8px!important;border:1.5px solid #b7c9f5!important;border-radius:10px!important;min-height:95px!important;animation:aria-editor .2s ease-out!important}.ccqu-editor-title>span{font-size:13px!important;font-weight:900!important;color:#273c78!important}.ccqu-editor-title small{font-size:10px!important;font-weight:750!important;color:#4b6191!important}
.ccqu-statuses{gap:5px!important}.ccqu-statuses button{font-size:12px!important;font-weight:800!important;min-height:33px!important;padding:6px 8px!important}.ccqu-presets button,.ccqu-note-presets button{font-size:11.5px!important;font-weight:800!important;padding:6px 8px!important}.ccqu-note-presets{gap:5px!important}
.ccqu-aria-textarea{width:100%!important;min-height:70px!important;max-height:100px!important;resize:vertical!important;padding:9px!important;font-size:13px!important;font-weight:650!important;color:#263050!important;border:2px solid #b69bea!important;border-radius:9px!important;background:#fff!important}
.ccqu-aria-note-preview{padding:4px!important;font-size:11px!important;color:#4e357c!important}.ccqu-aria-note-preview small{font-size:11px!important;font-weight:750!important;color:#4c387c!important}
.ccqu-aria-interview-list{display:flex!important;flex-direction:column!important;gap:5px!important;margin-bottom:6px!important}.ccqu-aria-interview-list label{font-size:11px!important;font-weight:800!important;color:#7c3f00!important}.ccqu-aria-interview-list select{display:block!important;width:100%!important;height:32px!important;border:1px solid #e4b567!important;border-radius:7px!important;color:#663b08!important;background:#fff9e9!important;font-size:11px!important;font-weight:750!important}
.ccqu-calendar .ccqu-month strong{font-size:12px!important;color:#1f3c79!important}.ccqu-calendar .ccqu-days button{font-size:11px!important;height:25px!important}.ccqu-calendar .ccqu-days>small{font-size:10px!important;color:#40577e!important}.ccqu-calendar .ccqu-time input{font-size:12px!important;height:33px!important}.ccqu-calendar .ccqu-time label{font-size:11px!important;font-weight:750!important}
.ccqu-aria-details{display:flex!important;flex-direction:column!important;gap:6px!important}.ccqu-aria-details p{font-size:11px!important;font-weight:750!important;color:#80345c!important;margin:0 0 3px!important}.ccqu-aria-details button{border:1px solid #eaa7c9!important;border-radius:9px!important;padding:9px!important;background:#fff0f7!important;color:#8d205e!important;font-size:12px!important;font-weight:850!important}.ccqu-aria-details button.is-chosen{background:#b52880!important;color:#fff!important}
.ccqu-aria-person{display:flex!important;align-items:center!important;gap:5px!important;flex-wrap:wrap!important;background:#eaf2ff!important;border:1px solid #bcd1ff!important;border-radius:8px!important;padding:4px!important;position:relative!important;flex:none!important}.ccqu-aria-copy{display:inline-flex!important;align-items:center!important;position:relative!important;max-width:125px!important;padding:3px 4px!important;border-radius:5px!important;font-size:11px!important;font-weight:750!important;color:#253d72!important}.ccqu-aria-copy>span{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.ccqu-aria-copy>button{display:none!important;position:absolute!important;z-index:4!important;right:0!important;top:0!important;height:100%!important;padding:2px 5px!important;border:1px solid #5c68cc!important;border-radius:5px!important;background:#273fc2!important;color:#fff!important;font-size:10px!important;font-weight:900!important}.ccqu-aria-copy:hover>button,.ccqu-aria-copy:focus-within>button,.ccqu-aria-copy:focus>button{display:block!important}.ccqu-aria-person .ccqu-contact-actions button{width:25px!important;height:25px!important}
.ccqu-aria-outcomes{max-height:78px!important;overflow:auto!important;border:1px solid #d2dcf4!important;border-radius:8px!important;flex:none!important}.ccqu-aria-outcomes div{font-size:11px!important;font-weight:750!important;padding:4px 7px!important}.ccqu-aria-outcomes .ok{color:#0c744e!important;background:#dcfbed!important}.ccqu-aria-outcomes .fail{color:#a11f42!important;background:#ffe6ea!important}
.ccqu-footer{min-height:45px!important}.ccqu-footer>span{font-size:11px!important;font-weight:800!important;color:#40588a!important}.ccqu .ccqu-save{font-size:13px!important;font-weight:950!important;padding:9px 14px!important;background:linear-gradient(115deg,#235af2,#8a32dd)!important;box-shadow:0 4px 12px #384dc055!important}
.ccqu-toast{font-size:12px!important;font-weight:900!important;color:#065f46!important;background:#c6f8e3!important;border:2px solid #34bd85!important;box-shadow:0 9px 25px #1d714e44!important;animation:aria-chip .3s ease-out!important}
.ccqu-message{font-size:12px!important;font-weight:750!important;max-height:66px!important}.ccqu .ccqu-option:hover:not(:disabled){transform:translateY(-2px) scale(1.015)!important;filter:saturate(1.2)!important}
@keyframes aria-rise{from{opacity:0;transform:translateY(-47%) scale(.91)}to{opacity:1;transform:translateY(-50%) scale(1)}}@keyframes aria-chip{from{opacity:0;transform:translateY(6px) scale(.93)}to{opacity:1;transform:translateY(0) scale(1)}}@keyframes aria-editor{from{opacity:.4;transform:translateX(5px)}to{opacity:1;transform:none}}
@media(max-width:420px){.ccqu-aria-actions .ccqu-option strong{font-size:10.5px!important}.ccqu-aria-results{top:88px!important}}
@media(prefers-reduced-motion:reduce){.ccqu,.ccqu *{animation:none!important;transition:none!important}}

.ccqu-aria-top-toast{position:fixed!important;top:16px!important;left:50%!important;right:auto!important;transform:translateX(-50%)!important;z-index:12055!important;min-height:40px!important;max-width:min(460px,90vw)!important;justify-content:center!important;box-shadow:0 9px 28px #1a6a5080!important}

.ccqu-aria-wa-list{display:flex!important;flex-direction:column!important;gap:5px!important}.ccqu-aria-wa-list button{padding:8px!important;border:1px solid #9bdfc4!important;border-radius:8px!important;background:#e5fff3!important;color:#116c4b!important;font-size:12px!important;font-weight:850!important;text-align:left!important}
/* CC911: readable text in the same popup dimensions. */
.ccqu{font-size:14px!important;color:#102a53!important}.ccqu-brand strong{font-size:18px!important;color:#202986!important}.ccqu-brand small{font-size:12px!important;color:#6934b2!important}.ccqu-search input{font-size:14px!important;color:#14346b!important}.ccqu-aria-hint{font-size:13px!important;color:#344e77!important}.ccqu-aria-count strong{font-size:13px!important;color:#164aa8!important}.ccqu-aria-count small{font-size:11px!important;color:#56708b!important}.ccqu-aria-chips{max-height:60px!important}.ccqu-aria-chip{font-size:13px!important;font-weight:750!important;background:#e0eaff!important;color:#1c3984!important}.ccqu-aria-chip button{font-size:16px!important}.ccqu-aria-results strong{font-size:14px!important}.ccqu-aria-results small{font-size:12px!important;color:#4c648b!important}
.ccqu-aria-actions{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:4px!important;margin:1px 0!important;flex:none!important}.ccqu-aria-actions .ccqu-option{grid-column:span 2!important;height:33px!important;padding:6px 7px!important;border-radius:8px!important}.ccqu-aria-actions .ccqu-option:nth-child(n+4){grid-column:span 3!important}.ccqu-aria-actions .ccqu-option-head{flex-direction:row!important;align-items:center!important;gap:5px!important;flex-wrap:nowrap!important}.ccqu-aria-actions .ccqu-option strong{font-size:13px!important;font-weight:800!important;white-space:nowrap!important}.ccqu-aria-actions svg{width:14px!important;height:14px!important}.ccqu-aria-actions .ccqu-status{background:linear-gradient(115deg,#d7e9ff,#b6cfff)!important;color:#153f9a!important;border-color:#75a7f4!important}.ccqu-aria-actions .ccqu-interview{background:linear-gradient(115deg,#fff0bd,#ffcd89)!important;color:#893c05!important;border-color:#ecaa47!important}.ccqu-aria-actions .ccqu-note{background:linear-gradient(115deg,#eedcff,#d1b5ff)!important;color:#65259c!important;border-color:#ad7ae9!important}.ccqu-aria-actions .ccqu-followup{background:linear-gradient(115deg,#d2fbe8,#9ee2cb)!important;color:#075b49!important;border-color:#55bc9b!important}.ccqu-aria-actions .ccqu-details{background:linear-gradient(115deg,#ffe1ef,#ffb6db)!important;color:#98255d!important;border-color:#e77fae!important}.ccqu-option.is-active{outline-width:2px!important;box-shadow:0 3px 9px #26386a27!important}
.ccqu-aria-editor .ccqu-editor-title>span{font-size:13px!important;color:#284a82!important;font-weight:800!important}.ccqu-editor-title small{font-size:10px!important;color:#6680a2!important}.ccqu-statuses button{font-size:12px!important;min-height:35px!important;line-height:1.28!important;font-weight:750!important}.ccqu-statuses .tone-red{background:#ffe3e9!important;color:#9d183a!important;border-color:#ed9cb1!important}.ccqu-statuses .tone-green{background:#d4f5e3!important;color:#15623d!important;border-color:#93d6b2!important}.ccqu-statuses .tone-amber{background:#fff0c0!important;color:#80510c!important;border-color:#e5c272!important}.ccqu-statuses .tone-blue{background:#e5eeff!important;color:#204789!important;border-color:#b7cafa!important}.ccqu-statuses .is-chosen{background:#3457c5!important;color:#fff!important;outline-color:#163181!important;animation:aria-chip .15s ease-out!important}
.ccqu-aria-textarea{font-size:14px!important;line-height:1.45!important;color:#192c53!important;min-height:70px!important}.ccqu-note-presets button{font-size:12px!important;line-height:1.35!important;padding:6px 7px!important;background:#eee0ff!important;color:#622d98!important;border-color:#c39ce9!important}.ccqu-aria-note-preview small{font-size:12px!important;color:#576a86!important}.ccqu-aria-copy{font-size:12px!important;max-width:145px!important;color:#203c79!important}.ccqu-aria-note-preview .ccqu-aria-copy{max-width:100%!important;display:block!important;white-space:normal!important;font-size:12px!important}.ccqu-aria-note-preview .ccqu-aria-copy>span{white-space:normal!important;display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ccqu-aria-details button{font-size:14px!important;color:#8d215c!important;background:#ffe3ef!important}.ccqu-aria-details small{font-size:12px!important;line-height:1.4!important;color:#7d536b!important}.ccqu-aria-interview-list label{font-size:12px!important;color:#6c420d!important}.ccqu-aria-interview-list select{font-size:12px!important;min-height:31px!important}.ccqu-presets button{font-size:11px!important;font-weight:750!important}.ccqu .ccqu-time input{font-size:13px!important}.ccqu-aria-top-toast{font-size:13px!important;white-space:normal!important}.ccqu-aria-outcomes{max-height:66px!important}.ccqu-aria-outcomes div{font-size:12px!important}.ccqu-footer>span{font-size:12px!important;color:#3d557f!important}.ccqu .ccqu-save{font-size:14px!important;min-height:34px!important}.ccqu-aria-wa-list button{font-size:13px!important}.ccqu-launcher>button{animation:aria-halo 4s ease-in-out infinite!important}.ccqu-aria-mark{font-size:11px!important}.ccqu-wa-menu button{font-size:13px!important}
@keyframes aria-halo{0%,100%{box-shadow:0 3px 13px #5d51c950!important}50%{box-shadow:0 3px 17px #6951da77!important}}@media(prefers-reduced-motion:reduce){.ccqu,.ccqu *{animation:none!important;transition:none!important}}
`;
