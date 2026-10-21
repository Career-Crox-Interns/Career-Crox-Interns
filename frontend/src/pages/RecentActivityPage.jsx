import { CrmDateTimeInput } from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import PremiumSelect from '../components/PremiumSelect';
import { api } from '../lib/api';
import { toCrmDateTimeLocalInput } from '../lib/workspaceHelpers';
import { openCandidateProfileInPopupTab } from '../lib/candidateNav';
const CATEGORIES=[['','All actions'],['profile_open','Profile opened'],['profile_edit','Profile updated'],['whatsapp','WhatsApp opened'],['call','Calls'],['submission','Submissions'],['interview','Interviews'],['note','Notes'],['task','Tasks'],['attendance','Attendance'],['idle','Locks / breaks'],['other','Other']];
const fmt=v=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date(v));
const range=(days=1)=>({from:toCrmDateTimeLocalInput(new Date(Date.now()-days*86400000)),to:toCrmDateTimeLocalInput(new Date())});
const asIso=(v,end=false)=>new Date(`${v}${end?':59.999':':00'}+05:30`).toISOString();
export default function RecentActivityPage(){
 const [filters,setFilters]=useState(()=>({...range(),employee_id:'',category:'',search:''}));
 const [items,setItems]=useState([]),[employees,setEmployees]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [loadedAt,setLoadedAt]=useState(''),[cursor,setCursor]=useState(''),[applied,setApplied]=useState(null);
 const [preset,setPreset]=useState(1);
 const seq=useRef(0),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;seq.current++;};},[]);
 async function refresh(more=false){
  if(busy)return;const current=++seq.current;
  try{const chosen=more?applied:{...filters,...(preset?range(preset):{})},from=asIso(chosen.from),to=asIso(chosen.to,true);
   if(new Date(from)>new Date(to))throw Error('Choose an end time after the start time.');
   if(new Date(asIso(chosen.to))-new Date(from)>30*86400000)throw Error('Choose up to 30 days.');
   setBusy(true);setError('');const q=new URLSearchParams({...chosen,from,to,limit:'50',...(more?{cursor}:{})});
   const data=await api.get(`/api/recent-activity?${q}`,{cacheTtlMs:0,allowStale:false,retries:0,timeoutMs:15000});
   if(!mounted.current||current!==seq.current)return;
   setItems(old=>more?[...old,...(data.items||[])].filter((row,index,all)=>all.findIndex(x=>x.id===row.id)===index):(data.items||[]));
   setEmployees(data.employees||[]);setCursor(data.next_cursor||'');setLoadedAt(data.updated_at);setApplied({...chosen});if(!more)setFilters({...chosen});
  }catch(e){if(mounted.current&&current===seq.current)setError(e.message||'Activity could not load.');}
  finally{if(mounted.current&&current===seq.current)setBusy(false);}
 }
 const counts=useMemo(()=>({profiles:items.filter(x=>x.activity_category==='profile_open').length,whatsapp:items.filter(x=>x.activity_category==='whatsapp').length,employees:new Set(items.map(x=>x.user_id)).size}),[items]);
 const changed=applied&&JSON.stringify(filters)!==JSON.stringify(applied);
 return <Layout title="Recent Activity"><div id="cc826-activity" className="cc826-studio">
 <header className="cc826-studio-hero"><div><span className="cc826-eyebrow">ACTIVITY STUDIO</span><h2>Recent Activity</h2></div><button className="add-profile-btn" disabled={busy} onClick={()=>refresh()}>{busy?'Loading…':'Refresh activity'}</button></header>
 <section className="panel cc826-activity-filters"><div className="cc826-actions">{[[1,'24 hours'],[7,'7 days'],[30,'30 days']].map(([days,label])=><button key={days} className={`ghost-btn cc826-preset ${preset===days?'active':''}`} aria-pressed={preset===days} onClick={()=>{setPreset(days);setFilters(f=>({...f,...range(days)}));}}>{label}</button>)}<span className="cc826-count">{loadedAt?`Updated ${fmt(loadedAt)} IST`:'Refresh to load activity'}</span></div>
 <div className="cc826-filter-grid"><label>From · IST<CrmDateTimeInput aria-label="Activity from" type="datetime-local" value={filters.from} onChange={e=>{setPreset(0);setFilters(f=>({...f,from:e.target.value}));}}/></label><label>To · IST<CrmDateTimeInput aria-label="Activity to" type="datetime-local" value={filters.to} onChange={e=>{setPreset(0);setFilters(f=>({...f,to:e.target.value}));}}/></label><label>Employee<PremiumSelect value={filters.employee_id} onChange={e=>setFilters(f=>({...f,employee_id:e.target.value}))}><option value="">My visible team</option>{employees.map(u=><option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}</PremiumSelect></label><label>Action<PremiumSelect value={filters.category} onChange={e=>setFilters(f=>({...f,category:e.target.value}))}>{CATEGORIES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</PremiumSelect></label><label className="cc826-search-wide">Search<input type="search" aria-label="Search activity" placeholder="Name, profile, action or detail…" value={filters.search} onChange={e=>setFilters(f=>({...f,search:e.target.value}))}/></label></div>
 {changed?<p role="status">Filters changed. Refresh to apply them.</p>:null}</section>
 {error?<div role="alert" className="panel cc826-error">{error}</div>:null}
 <div className="cc826-mode-grid four">{[['Loaded actions',items.length,'peach'],['Employees',counts.employees,'lavender'],['Profile opens',counts.profiles,'mint'],['WhatsApp opens',counts.whatsapp,'sky']].map(([label,value,tone])=><div className={`stat-card cc828-stat cc826-mode-card ${tone}`} key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
 <section className="panel cc826-activity-table"><div className="cc826-table-heading"><h3>Recorded actions</h3><span>{items.length} loaded{cursor?' · more available':''}</span></div><div className="cc826-table-scroll"><table><thead><tr><th>Time · IST</th><th>Employee</th><th>Action</th><th>Profile</th><th>Details</th></tr></thead><tbody>{items.map(row=><tr key={row.id}><td className="cc826-nowrap">{fmt(row.created_at)}</td><td><strong>{row.employee_name}</strong><span className="cc826-role">{row.employee_role}</span></td><td><span className={`cc826-activity-tag ${row.activity_category}`}>{row.action_label}</span></td><td>{row.candidate_id?<button className="ghost-btn" onClick={()=>openCandidateProfileInPopupTab(row.candidate_id)}>{row.candidate_id} ↗</button>:'—'}</td><td title={row.details_text}><span className="cc826-detail-ellipsis">{row.details_text}</span></td></tr>)}</tbody></table>{!items.length?<div className="cc826-empty">{loadedAt?'No actions match these filters.':'Choose a period and click Refresh activity.'}</div>:null}</div>{cursor?<button className="ghost-btn" disabled={busy||changed} onClick={()=>refresh(true)}>Load next 50</button>:null}</section>
 <p className="cc826-retention">Manual refresh only · 50 actions per page · Last 30 days · Profile / WhatsApp opens are capped at 1,000 per employee per day. “WhatsApp opened” records opening WhatsApp, not message delivery.</p>
 </div></Layout>;
}
