import React,{useEffect,useMemo,useRef,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import Layout from '../components/Layout';
import {api,cachePrincipal} from '../lib/api';
import {useAuth} from '../lib/auth';
import {notificationTarget} from '../lib/workspaceHelpers';
import {readPageCache,writePageCache} from '../lib/persistentPageCache';
import {NOTICE_CATEGORIES,noticeCategory,noticeMetadata,recentWorkNotices} from '../lib/notificationInboxRuntime';

const CACHE='cc120-notification-history';
const pending=row=>String(row.status||'unread').toLowerCase()==='unread';
const labelFor=category=>NOTICE_CATEGORIES.find(([key])=>key===category)?.[1]||'Other';
const stamp=value=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});

export default function NotificationsPage(){
 const {user}=useAuth(),navigate=useNavigate(),principal=cachePrincipal(),scopeRef=useRef(principal);
 const initial=useMemo(()=>readPageCache(CACHE,{items:[],next_cursor:'',scope:'self'}),[principal]);
 const [rows,setRows]=useState(()=>recentWorkNotices(initial.items)),[cursor,setCursor]=useState(initial.next_cursor||''),[scope,setScope]=useState(initial.scope||'self');
 const [category,setCategory]=useState('all'),[status,setStatus]=useState('all'),[owner,setOwner]=useState('all'),[hours,setHours]=useState('168'),[query,setQuery]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(Boolean(initial.items?.length)),[expanded,setExpanded]=useState(new Set());
 const request=useRef(0),eventVersion=useRef(0),inflight=useRef(false),mounted=useRef(false);
 const leadership=['admin','manager','tl'].includes(String(user?.role||'').toLowerCase());
 const persist=(items,next=cursor,currentScope=scope)=>writePageCache(CACHE,{items:recentWorkNotices(items).slice(0,1200),next_cursor:next,scope:currentScope});
 async function load(more=false,force=false){
  if(inflight.current)return;inflight.current=true;setBusy(true);setError('');
  const serial=++request.current,version=eventVersion.current,requestedPrincipal=principal;
  try{
   const data=await api.get('/api/notifications?limit=200'+(more&&cursor?'&cursor='+encodeURIComponent(cursor):''),{cacheTtlMs:force?0:15000,timeoutMs:12000,retries:0,background:true});
   if(!mounted.current||serial!==request.current||scopeRef.current!==requestedPrincipal)return;
   setRows(current=>{const items=recentWorkNotices(more||eventVersion.current!==version?[...current,...(data.items||[])]:data.items||[]);persist(items,data.next_cursor||'',data.scope||'self');return items;});
   setCursor(data.next_cursor||'');setScope(data.scope||'self');setLoaded(true);
  }catch(err){if(mounted.current&&scopeRef.current===requestedPrincipal)setError(err.message||'Could not refresh. Your current list is still available.');}
  finally{if(serial===request.current){inflight.current=false;if(mounted.current)setBusy(false);}}
 }
 useEffect(()=>{
  mounted.current=true;scopeRef.current=principal;request.current++;inflight.current=false;
  const cached=readPageCache(CACHE,{items:[],next_cursor:'',scope:'self'});setRows(recentWorkNotices(cached.items));setCursor(cached.next_cursor||'');setScope(cached.scope||'self');
  const incoming=event=>{
   const item=event.detail;if(!item?.notification_id)return;eventVersion.current++;
   setRows(current=>recentWorkNotices([item,...current]));
  };
  const read=event=>{const data=event.detail||{};eventVersion.current++;setRows(current=>current.map(row=>(data.all&&String(row.user_id)===String(data.user_id)||String(row.notification_id)===String(data.notification_id))?{...row,status:'Read'}:row));};
  const chatRead=event=>{const data=event.detail||{};setRows(current=>current.map(row=>{const meta=noticeMetadata(row);return row.category==='chat'&&String(row.user_id)===String(user.user_id)&&meta.thread_key===data.thread_key&&Number(meta.message_id)<=Number(data.last_read_id)?{...row,status:'Read'}:row;}));};
  window.addEventListener('career-crox-notification',incoming);window.addEventListener('career-crox-notification-read',read);window.addEventListener('career-crox-chat-read',chatRead);
  void load();
  return()=>{mounted.current=false;request.current++;window.removeEventListener('career-crox-notification',incoming);window.removeEventListener('career-crox-notification-read',read);window.removeEventListener('career-crox-chat-read',chatRead);};
 },[principal]);
 useEffect(()=>{persist(rows);},[rows,cursor,scope,principal]);
 useEffect(()=>{const expires=rows.map(row=>Date.parse(row.created_at)+7*86400000).filter(at=>Number.isFinite(at)&&at>Date.now());if(!expires.length)return;const timer=setTimeout(()=>setRows(current=>recentWorkNotices(current)),Math.max(1,Math.min(...expires)-Date.now()+20));return()=>clearTimeout(timer);},[rows]);
 // No history polling: manual refresh and the existing shared event stream only.
 const activeRows=useMemo(()=>recentWorkNotices(rows).filter(row=>{
  if(owner!=='all'&&String(row.recruiter_code||row.user_id)!==owner)return false;
  if(Date.parse(row.created_at)<Date.now()-Number(hours)*3600000)return false;
  if(query){const meta=noticeMetadata(row),text=[row.title,row.message,row.owner_name,row.recruiter_code,meta.actor_name,meta.candidate_name,meta.candidate_id].join(' ').normalize('NFKC').toLowerCase();if(!text.includes(query.normalize('NFKC').trim().toLowerCase()))return false;}
  return true;
 }),[rows,owner,hours,query]);
 const categories=useMemo(()=>{const counts={all:activeRows.length};for(const row of activeRows){const key=noticeCategory(row);counts[key]=(counts[key]||0)+1;}return counts;},[activeRows]);
 const categorized=useMemo(()=>activeRows.filter(row=>category==='all'||noticeCategory(row)===category),[activeRows,category]);
 const unread=categorized.filter(pending).length;
 const visible=categorized.filter(row=>status==='all'||(status==='unread'?pending(row):!pending(row)));
 const owners=useMemo(()=>[...new Map(rows.map(row=>[String(row.recruiter_code||row.user_id),row.owner_name?row.owner_name+' · '+(row.recruiter_code||row.user_id):row.recruiter_code||row.user_id])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[rows]);
 function open(row){
  navigate(notificationTarget(row));
  void api.post('/api/notifications/'+encodeURIComponent(row.notification_id)+'/read',{}, {retries:0,background:true,detachedWrite:true}).catch(()=>{});
 }
 async function readAll(){
  setBusy(true);setError('');
  try{await api.post('/api/notifications/mark-all-read',{}, {retries:0});setRows(current=>current.map(row=>String(row.user_id)===String(user.user_id)?{...row,status:'Read'}:row));}
  catch(err){setError(err.message||'Could not mark read. Please retry.');}finally{if(mounted.current)setBusy(false);}
 }
 return <Layout title="Notifications"><section className="cc120-nc" aria-label="Notification centre"><style>{styles+readableStyles}</style>
  <header className="cc120-nc-head"><div><strong>Notification centre</strong><small>Last 7 days · {scope==='team'?'Team activity':'Your activity'} · {rows.length} loaded</small></div><div className="cc120-nc-actions"><button type="button" disabled={busy} onClick={()=>load(false,true)}>{busy?'Updating…':'↻ Refresh'}</button><button type="button" disabled={busy} onClick={readAll}>Mark mine read</button></div></header>
  <div className="cc120-nc-tools"><label className="cc120-search"><span>Search</span><input type="search" aria-label="Search notifications" placeholder="Name, note, candidate or update…" value={query} onChange={event=>setQuery(event.target.value)}/></label>{leadership?<label><span>Person</span><select aria-label="Filter notifications by person" value={owner} onChange={event=>setOwner(event.target.value)}><option value="all">Everyone in this view</option>{owners.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>:null}<label><span>Time</span><select aria-label="Notification time window" value={hours} onChange={event=>setHours(event.target.value)}><option value="168">7 days</option><option value="24">24 hours</option><option value="6">6 hours</option></select></label></div>
  <nav className="cc120-nc-categories" aria-label="Notification categories">{NOTICE_CATEGORIES.filter(([key])=>['all','notes','profile','transfer','status','submission'].includes(key)||categories[key]).map(([key,label])=><button type="button" key={key} aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}<b>{categories[key]||0}</b></button>)}</nav>
  <div className="cc120-nc-status" role="group" aria-label="Notification status">{[['all','All',categorized.length],['unread','Unread',unread],['read','Read',categorized.length-unread]].map(([key,label,count])=><button type="button" key={key} aria-pressed={status===key} onClick={()=>setStatus(key)}>{label} <b>{count}</b></button>)}<span>{visible.length} visible · newest first</span></div>
  {error?<div className="cc120-nc-error" role="alert">{error} <button type="button" disabled={busy} onClick={()=>load(false,true)}>Retry</button></div>:null}
  <div className="cc120-nc-list" role="list">{visible.map((row,index)=>{
   const meta=noticeMetadata(row),kind=noticeCategory(row),isExpanded=expanded.has(row.notification_id);
   return <div role="listitem" className={'cc120-notice-row '+(pending(row)?'is-unread':'is-read')} key={row.notification_id}>
    <button type="button" className="cc120-notice-main" onClick={()=>open(row)} title="Open this update"><span className="cc123-notice-serial" aria-label={'Serial '+(index+1)}>{index+1}</span><span className="cc120-notice-copy"><strong>{row.title||'Work update'}</strong><span>{row.message}</span></span><span className={'cc120-notice-category kind-'+kind}>{labelFor(kind)}</span><span className="cc120-notice-person" title={row.owner_name||''}>{row.owner_name||row.recruiter_code||row.user_id}</span><time dateTime={row.created_at}>{stamp(row.created_at)}</time><span className="cc120-read-label">{pending(row)?'Unread':'Read'}</span></button>
    <button type="button" className="cc120-notice-expand" aria-label={(isExpanded?'Hide':'Show')+' notification details'} aria-expanded={isExpanded} onClick={()=>setExpanded(current=>{const next=new Set(current);if(next.has(row.notification_id))next.delete(row.notification_id);else next.add(row.notification_id);return next;})}>{isExpanded?'⌃':'⌄'}</button>
    {isExpanded?<div className="cc120-notice-details"><p>{row.message||'Open this update to see more.'}</p><small>{meta.candidate_name||meta.candidate_id||''}{row.owner_name?' · For '+row.owner_name:''}</small><button type="button" onClick={()=>open(row)}>Open update ↗</button></div>:null}
   </div>;
  })}{!visible.length?<div className="cc120-nc-empty">{!loaded&&busy?'Loading your notifications…':rows.length?'No updates match these filters.':'No notifications in the last 7 days.'}</div>:null}</div>
  <footer className="cc120-nc-footer"><span>Notifications older than 7 days are removed automatically.</span>{cursor?<button type="button" disabled={busy} onClick={()=>load(true,true)}>{busy?'Loading…':'Load more from this week'}</button>:null}</footer>
 </section></Layout>;
}
const readableStyles='.cc120-nc{font-size:14px}.cc120-nc-head strong{font-size:17px}.cc120-nc-head small,.cc120-nc-tools label{font-size:12px;color:#526981}.cc120-notice-row{min-height:64px}.cc120-notice-main{grid-template-columns:30px minmax(160px,1fr) 100px 130px 125px 44px;gap:9px}.cc123-notice-serial{font:650 13px/1.4 "Segoe UI",sans-serif;text-align:center;color:#4e6890}.cc120-notice-copy strong{font-size:14px;line-height:1.4;white-space:normal;color:#243b58}.cc120-notice-copy>span{font-size:13px;line-height:1.45;color:#526781;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.cc120-notice-category,.cc120-notice-person,.cc120-notice-main time,.cc120-nc-categories button,.cc120-nc-actions button,.cc120-nc-status button{font-size:12px}.cc120-notice-main time{color:#526781}.cc120-notice-details p{font-size:14px}.cc120-nc-footer{font-size:12px}@media(max-width:1150px){.cc120-notice-main{grid-template-columns:28px minmax(130px,1fr) 92px 100px 120px;gap:6px}}@media(max-width:800px){.cc120-notice-main{grid-template-columns:25px minmax(100px,1fr) 88px}}';
const styles=`
.cc120-nc{margin:8px 0 16px;border:1px solid #dce3ee;border-radius:13px;background:#fff;overflow:hidden;color:#243953;font:12px/1.4 "Segoe UI",Arial,sans-serif}.cc120-nc *{box-sizing:border-box}.cc120-nc button,.cc120-nc input,.cc120-nc select{font:inherit}.cc120-nc button{cursor:pointer}.cc120-nc button:disabled{opacity:.55;cursor:wait}.cc120-nc button:focus-visible,.cc120-nc input:focus-visible,.cc120-nc select:focus-visible{outline:2px solid #5b83d2;outline-offset:-2px}.cc120-nc-head{display:flex;align-items:center;gap:10px;justify-content:space-between;background:linear-gradient(105deg,#f4f8ff,#faf7ff);padding:10px 12px;border-bottom:1px solid #e3e9f2}.cc120-nc-head strong{font-size:14px;font-weight:750}.cc120-nc-head small{display:block;font-size:10px;color:#687d96;margin-top:2px}.cc120-nc-actions{display:flex;gap:5px}.cc120-nc-actions button,.cc120-nc-footer button,.cc120-nc-error button,.cc120-notice-details button{border:1px solid #d3dfee;border-radius:7px;background:#f5f8fe;color:#35568e;padding:5px 9px;font-size:11px;min-height:27px}.cc120-nc-tools{display:flex;align-items:end;gap:8px;padding:8px 12px}.cc120-nc-tools label{display:flex;flex-direction:column;gap:3px;color:#5c718c;font-size:10px}.cc120-nc-tools input,.cc120-nc-tools select{border:1px solid #d5dfec;border-radius:7px;min-height:30px;height:30px;padding:4px 8px;background:white;color:#2a405d;width:100%}.cc120-nc-tools .cc120-search{flex:1;max-width:480px}.cc120-nc-tools label:not(.cc120-search){max-width:230px;min-width:100px}.cc120-nc-categories{display:flex;flex-wrap:wrap;gap:5px;padding:2px 12px 8px}.cc120-nc-categories button{display:flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid #dce5f1;border-radius:8px;color:#526b8b;background:#f8faff;white-space:nowrap;min-height:27px;font-size:11px}.cc120-nc-categories b{font-size:10px;padding:0 4px;border-radius:4px;background:#eaf0f9;font-weight:700}.cc120-nc-categories button[aria-pressed=true]{background:#e8efff;border-color:#9db5e7;color:#284c94}.cc120-nc-status{display:flex;align-items:center;gap:4px;padding:6px 12px;background:#fafbfd;border-top:1px solid #e8edf5;border-bottom:1px solid #dce4ef}.cc120-nc-status button{border:0;border-radius:6px;background:transparent;color:#718198;font-size:11px;padding:4px 8px}.cc120-nc-status button[aria-pressed=true]{background:#e8eef9;color:#344f7c}.cc120-nc-status b{font-size:10px;margin-left:3px}.cc120-nc-status>span{margin-left:auto;color:#7c8ca0;font-size:10px}.cc120-nc-list{display:block}.cc120-notice-row{display:grid;grid-template-columns:minmax(0,1fr) 28px;border-bottom:1px solid #edf0f6;min-height:47px;background:#fff}.cc120-notice-row.is-unread{background:#f7faff}.cc120-notice-main{display:grid;grid-template-columns:7px minmax(150px,1fr) 95px 135px 118px 39px;align-items:center;gap:10px;padding:7px 10px 7px 13px;border:0;border-radius:0;color:#2b405e;background:transparent;text-align:left;min-width:0}.cc120-notice-main:hover{background:#edf4ff}.cc120-notice-dot{width:6px;height:6px;border-radius:50%;background:#5c86d3}.is-read .cc120-notice-dot{background:#d4dce7}.cc120-notice-copy{min-width:0;display:flex;flex-direction:column;gap:2px}.cc120-notice-copy strong{font-size:12px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#2c405f}.cc120-notice-copy>span{font-size:10.5px;color:#73839a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cc120-notice-category{justify-self:start;max-width:100%;overflow:hidden;text-overflow:ellipsis;border-radius:5px;padding:2px 6px;font-size:10px;background:#edf1f7;color:#58708b;white-space:nowrap}.cc120-notice-category.kind-notes{background:#e4f5ed;color:#2f7153}.cc120-notice-category.kind-transfer{background:#fff0db;color:#92641f}.cc120-notice-category.kind-status{background:#efe6fd;color:#754e9f}.cc120-notice-category.kind-submission{background:#dfedff;color:#3e6b9e}.cc120-notice-person{color:#596f8c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px}.cc120-notice-main time{font-size:10px;color:#7c8c9f;white-space:nowrap}.cc120-read-label{font-size:9px;color:#9ca8b8}.is-unread .cc120-read-label{color:#527db7}.cc120-notice-expand{color:#7b8da6;border:0;border-radius:0;background:transparent;font-size:16px;padding:0}.cc120-notice-expand:hover{background:#edf3fb}.cc120-notice-details{grid-column:1/-1;padding:8px 16px 11px 30px;border-top:1px dashed #e1e8f2;background:#fbfcff}.cc120-notice-details p{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;margin:0 0 6px;color:#39516e}.cc120-notice-details small{font-size:10px;color:#7c8b9f}.cc120-notice-details button{margin-left:10px}.cc120-nc-empty{padding:28px 12px;text-align:center;color:#7e8da1;font-size:12px}.cc120-nc-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;color:#8b99ac;font-size:10px}.cc120-nc-error{padding:7px 12px;background:#fff2ed;color:#a34d37;font-size:11px}@media(max-width:1150px){.cc120-notice-main{grid-template-columns:6px minmax(120px,1fr) 88px 95px 105px;gap:7px}.cc120-read-label{display:none}.cc120-notice-person{font-size:10px}}@media(max-width:800px){.cc120-notice-main{grid-template-columns:6px minmax(100px,1fr) 85px}.cc120-notice-person,.cc120-notice-main time{display:none}.cc120-nc-head{align-items:start;gap:7px}.cc120-nc-actions{flex-wrap:wrap;justify-content:end}.cc120-nc-tools{flex-wrap:wrap}.cc120-nc-tools .cc120-search{flex-basis:100%;max-width:none}.cc120-nc-status>span{font-size:9px}.cc120-nc-footer{align-items:start}.cc120-nc-categories{gap:4px}}
`;
