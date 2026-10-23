import React,{useEffect,useState,useSyncExternalStore,useRef} from 'react';
import {api} from './api';
import {createPortal} from 'react-dom';
const EVENT='cc875-dashboard-changed';let scopeEpoch=0;
if(typeof window!=='undefined'){window.__CC875_SCOPE_EPOCH__=()=>scopeEpoch;const changed=()=>{scopeEpoch++;for(const storage of [localStorage,sessionStorage])try{for(const k of Object.keys(storage))if(k.startsWith('careerCroxInstantCandidateProfile:'))storage.removeItem(k);}catch{}};window.addEventListener(EVENT,changed);window.addEventListener('storage',e=>{if(e.key?.startsWith('cc875:dashboard:')){changed();window.dispatchEvent(new Event(EVENT));}});}
const role=u=>String(u?.role||'').toLowerCase();
export function dashboardActor(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}');}catch{return {};}}
const key=()=>`cc875:dashboard:${dashboardActor().user_id||'signed-out'}`;
export function dashboardSelection(){
 const actor=dashboardActor(),r=role(actor);
 if(!['manager','admin','tl'].includes(r))return null;
 try{const s=JSON.parse(localStorage.getItem(key())||'null');if(s&&typeof s.user_id==='string')return s;}catch{}
 return r==='tl'?{...actor,user_id:'self'}:null;
}
export function dashboardScopeKey(){const s=dashboardSelection();return s?.user_id||'overview';}
export function dashboardEffectiveUser(actor){const s=dashboardSelection();if(!s||s.user_id==='team'||s.user_id==='overview')return actor;const selected=s.user_id==='self'||s.user_id===String(actor?.user_id)?actor:s;return {...selected,role:'recruiter',dashboard_role:selected.role,__ccDashboardOwn:true,__ccTeamUserIds:[],__ccTeamCodes:[],__ccTeamNames:[],__ccSharedScopes:[],__ccSoloPeers:{},__ccAccessRevision:actor?.__ccAccessRevision||0};}
export function selectDashboard(user){if(user)localStorage.setItem(key(),JSON.stringify(Object.fromEntries(['user_id','username','full_name','recruiter_code','role','designation'].map(k=>[k,user[k]||'']))));else localStorage.removeItem(key());window.dispatchEvent(new Event(EVENT));}
const subscribe=fn=>{window.addEventListener(EVENT,fn);window.addEventListener('storage',fn);return()=>{window.removeEventListener(EVENT,fn);window.removeEventListener('storage',fn);};};
export function useDashboardScope(){return useSyncExternalStore(subscribe,dashboardScopeKey,()=> 'overview');}
const business=path=>/^\/api\/(?:candidates|followups|submissions|interviews|tasks|revenue-hub|client-pipeline|profile-safety|search|hot-leads|bucket|performance-centre)(?:\/|$)/.test(path)||path==='/api/reports/reminder-summary'||path==='/api/reports/semi-hourly';
if(typeof window!=='undefined'&&!window.__CC875_SCOPE_INSTALLED__){
 window.__CC875_SCOPE_INSTALLED__=true;window.__CC875_DASHBOARD_KEY__=dashboardScopeKey;window.__CC875_EFFECTIVE_USER__=()=>dashboardEffectiveUser(dashboardActor());
 const native=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{let url;try{url=new URL(typeof input==='string'?input:input.url,location.href);}catch{return native(input,options);}if(location.pathname==='/data-backup'&&url.origin===location.origin&&url.pathname.startsWith('/api/')&&!/^\/api\/(?:auth|multiple-crm|data-backup|health)(?:\/|$)/.test(url.pathname))throw Object.assign(Error('Open the workspace to access business data.'),{code:'RECOVERY_VIEW_ONLY'});let selection=dashboardSelection();if(!selection&&url.pathname==='/api/reports/reminder-summary'&&['manager','admin'].includes(role(dashboardActor()))&&window.__CC875_POPUP_SETTINGS__?.().managerTeamPopups===false)selection={user_id:'self'};const scoped=url.origin===location.origin&&business(url.pathname)&&!!selection;
  if(!scoped)return native(input,options);const epochAtStart=scopeEpoch,atStart=dashboardScopeKey(),headers=new Headers(input instanceof Request?input.headers:undefined);new Headers(options.headers||{}).forEach((v,k)=>headers.set(k,v));headers.set('X-CC-Dashboard-User',selection.user_id);const response=await native(input,{...options,headers});
  if(epochAtStart!==scopeEpoch||atStart!==dashboardScopeKey())throw Object.assign(Error('Dashboard changed. Reload this view.'),{code:'DASHBOARD_CHANGED'});
  if(response.status===403){const data=await response.clone().json().catch(()=>({}));if(data.code==='DASHBOARD_SCOPE_DENIED')window.dispatchEvent(new CustomEvent('cc875-dashboard-denied',{detail:data.message}));}return response;
 };
}
const rosterByActor=new Map();
export async function warmDashboardChoices(force=false){
 const actor=dashboardActor();if(!['manager','admin','tl'].includes(role(actor)))return [];
 const key=String(actor.user_id),cached=rosterByActor.get(key);
 if(cached?.promise)return cached.promise;if(!force&&cached&&Date.now()-cached.at<300000)return cached.users;
 const promise=api.get('/api/dashboard/choices',{cacheTtlMs:force?0:300000,allowStale:false,retries:0}).then(data=>{rosterByActor.set(key,{users:data.users||[],at:Date.now()});return data.users||[];}).catch(e=>{rosterByActor.delete(key);throw e;});
 rosterByActor.set(key,{...cached,promise});return promise;
}
if(typeof window!=='undefined')for(const event of ['career-crox-team-changed','cc875-dashboard-denied','career-crox-access-changed'])window.addEventListener(event,()=>rosterByActor.clear());
export function DashboardSwitcher(){
 const actor=dashboardActor(),scope=useDashboardScope(),anchor=useRef(null),menu=useRef(null);
 const [people,setPeople]=useState(()=>rosterByActor.get(String(actor.user_id))?.users||[]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[position,setPosition]=useState({});
 const s=dashboardSelection(),label=s?(s.user_id==='self'?'My dashboard':s.full_name||s.username):'All dashboards';
 const reposition=()=>{const r=anchor.current?.getBoundingClientRect();if(r)setPosition({position:'fixed',left:Math.max(8,Math.min(r.left,innerWidth-308)),top:r.bottom+7,width:Math.min(300,innerWidth-16),maxHeight:Math.max(160,innerHeight-r.bottom-20)});};
 useEffect(()=>{let live=true;warmDashboardChoices().then(users=>{if(live)setPeople(users);}).catch(()=>{});const denied=e=>setError(e.detail||'Dashboard unavailable');window.addEventListener('cc875-dashboard-denied',denied);return()=>{live=false;window.removeEventListener('cc875-dashboard-denied',denied);};},[actor.user_id]);
 useEffect(()=>{if(!open)return;const outside=e=>{if(!anchor.current?.contains(e.target)&&!menu.current?.contains(e.target))setOpen(false);};const keys=e=>{if(e.key==='Escape'){setOpen(false);anchor.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',keys);window.addEventListener('resize',reposition);window.addEventListener('scroll',reposition,true);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',keys);window.removeEventListener('resize',reposition);window.removeEventListener('scroll',reposition,true);};},[open]);
 if(!['manager','admin','tl'].includes(role(actor)))return null;
 async function load(force=false){setBusy(true);setError('');try{setPeople(await warmDashboardChoices(force));}catch(e){setError(e.message);}finally{setBusy(false);}}
 function choose(u){selectDashboard(u);setOpen(false);setError('');}
 const h=React.createElement;
 return h('div',{className:'cc875-switcher cc878-dashboard-switch'},h('button',{ref:anchor,type:'button',className:'cc875-switch-trigger',onClick:()=>{reposition();setOpen(!open);if(!open)load();},'aria-expanded':open,'aria-haspopup':'dialog','aria-label':'Switch dashboard · '+label,title:'Switch dashboard · '+label},h('span',{'aria-hidden':true},'⇄'),h('span',{className:'cc878-scope-label'},label==='All dashboards'?'All':label==='My dashboard'?'My':label.split(' ')[0])),
 open?createPortal(h('div',{ref:menu,style:position,className:'cc875-switch-menu cc878-scope-menu',role:'dialog','aria-label':'Switch dashboard'},h('header',null,h('strong',null,'Switch dashboard'),h('button',{type:'button',onClick:()=>setOpen(false),'aria-label':'Close dashboard switcher'},'×')),h('input',{'aria-label':'Find dashboard',placeholder:'Find a TL or recruiter…',value:search,onChange:e=>setSearch(e.target.value)}),h('button',{type:'button',onClick:()=>choose({...actor,user_id:'self'})},'My dashboard'),h('button',{type:'button',onClick:()=>choose(role(actor)==='tl'?{...actor,user_id:'team',full_name:'My team'}:null)},['manager','admin'].includes(role(actor))?'All dashboards · overview':'My team · overview'),busy&&!people.length?h('p',{role:'status'},'Loading employees…'):null,
 h('div',{className:'cc875-switch-people'},people.filter(u=>String(u.user_id)!==String(actor.user_id)&&[u.full_name,u.username,u.role].join(' ').toLowerCase().includes(search.toLowerCase())).map(u=>h('button',{type:'button',key:u.user_id,onClick:()=>choose(u)},h('span',null,u.full_name||u.username),h('small',null,String(u.role||'').toUpperCase())))),error?h('p',{role:'alert'},error):null,h('button',{type:'button',className:'cc875-switch-close',disabled:busy,onClick:()=>load(true)},busy?'Refreshing…':'Refresh employees')),document.body):null);
}
// Scope stays visible in the small top-bar switch. No full-width banner.
export function DashboardViewBanner(){return null;}
