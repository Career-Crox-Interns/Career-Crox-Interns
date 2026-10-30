import {api,accountPrincipal} from './api';
import {getPollingLeaderSnapshot,subscribePollingLeader} from './tabLeader';
import {notificationTarget} from './workspaceHelpers';

const DEFAULT_POLICY={tl_enabled:false,manager_seconds:1,tl_seconds:1};
let policyScope='',policyState={...DEFAULT_POLICY},policyAt=0,policyFlight=null;
export function readWorkNoticePolicy(){const scope=accountPrincipal();if(scope!==policyScope){policyScope=scope;policyState={...DEFAULT_POLICY};policyAt=0;policyFlight=null;}return {...policyState};}
function applyPolicy(raw={}){readWorkNoticePolicy();const seconds=value=>Math.max(.5,Math.min(30,Number(value)||1));policyState={tl_enabled:raw.tl_enabled===true,manager_seconds:seconds(raw.manager_seconds),tl_seconds:seconds(raw.tl_seconds)};policyAt=Date.now();window.dispatchEvent(new Event('cc119-work-notice-settings'));return readWorkNoticePolicy();}
export function subscribeWorkNoticePolicy(listener){const receive=()=>listener(readWorkNoticePolicy());window.addEventListener('cc119-work-notice-settings',receive);return()=>window.removeEventListener('cc119-work-notice-settings',receive);}
export function canReceiveWorkNotices(user,policy=readWorkNoticePolicy()){const role=String(user?.role||'').toLowerCase();return ['manager','admin'].includes(role)||(role==='tl'&&policy.tl_enabled===true);}
export async function loadWorkNoticePolicy(force=false){
 readWorkNoticePolicy();if(!force&&policyAt&&Date.now()-policyAt<300000)return readWorkNoticePolicy();if(policyFlight)return policyFlight;
 const scope=policyScope;const flight=api.get('/api/notifications/policy',{cacheTtlMs:force?0:300000,background:true,retries:0,timeoutMs:12000,headers:{'X-CC-Dashboard-User':'global'}}).then(data=>scope===accountPrincipal()?applyPolicy(data.notice_policy):readWorkNoticePolicy()).finally(()=>{if(policyFlight===flight)policyFlight=null;});policyFlight=flight;return flight;
}
export async function saveWorkNoticePolicy(patch){const scope=accountPrincipal();const data=await api.post('/api/notifications/policy',patch,{retries:0,headers:{'X-CC-Dashboard-User':'global'}});return scope===accountPrincipal()?applyPolicy(data.notice_policy):readWorkNoticePolicy();}
if(typeof window!=='undefined')window.addEventListener('career-crox-notice-policy',event=>applyPolicy(event.detail||{}));

export function isManagedWorkNotice(item){const category=String(item?.category||'').toLowerCase();return Boolean(item?.notification_id)&&!['chat','unlock','dialer','archived'].includes(category)&&!/^unlock\b/i.test(item.title||'');}
function metadata(row){try{return typeof row.metadata==='string'?JSON.parse(row.metadata||'{}'):row.metadata||{};}catch{return {};}}
export function workNoticeSeries(row){
 if(row.series_key)return String(row.series_key);
 const m=metadata(row),category=String(row.category||'general').toLowerCase(),owner=String(row.user_id||'');
 if(m.kind==='semi_hourly_report'||m.type==='semi_hourly_report'||/30.minute|half.hour|half hourly/i.test(row.title||''))return owner+'|report|half-hourly';
 if(m.report_id)return owner+'|report|'+(m.kind||m.type||category+'|'+String(row.title||'').toLowerCase());
 if(category==='interview_digest')return owner+'|interview-digest';
 if(m.reason)return owner+'|'+category+'|'+m.reason+'|'+(m.employee_user_id||m.user_id||'team');
 if(category==='candidate_update'&&m.candidate_id)return owner+'|candidate|'+m.candidate_id;
 return owner+'|id|'+row.notification_id;
}
export function latestWorkNotices(rows,now=Date.now(),history=false){
 const seen=new Set();return (rows||[]).filter(row=>Number.isFinite(Date.parse(row.created_at))&&Date.parse(row.created_at)>=now-7*86400000).sort((a,b)=>(Date.parse(b.created_at)-Date.parse(a.created_at))||String(b.notification_id).localeCompare(String(a.notification_id))).filter(row=>{const series=workNoticeSeries(row),key=history&&!series.includes('|report|')&&!series.endsWith('|interview-digest')?'id|'+row.notification_id:series;if(seen.has(key))return false;seen.add(key);return true;});
}
export function mergeInboxRows(current,incoming,userId){
 const map=new Map((current||[]).map(row=>[String(row.notification_id),row]));
 for(const row of incoming||[]){if(!row?.notification_id||String(row.user_id)!==String(userId))continue;map.set(String(row.notification_id),row);}
 // Retain read versions while coalescing, then drop read rows. This prevents
 // older unread reports from returning after the latest report is opened.
 return latestWorkNotices([...map.values()].filter(row=>String(row.user_id)===String(userId))).filter(row=>!['read','archived','deleted'].includes(String(row.status||'unread').toLowerCase())).slice(0,60);
}

export function installNotificationInboxRuntime(user,{navigate=path=>window.location.assign(path)}={}){
 if(!user?.user_id||typeof document==='undefined'||!canReceiveWorkNotices(user))return()=>{};
 const principal=accountPrincipal(),uid=String(user.user_id),key='cc119-notice-seen:'+principal,positionKey='cc119-notice-position:'+principal;
 const parse=(name,fallback)=>{try{return JSON.parse(localStorage.getItem(name)||'null')||fallback;}catch{return fallback;}};
 const initial=parse(key,{});let shown=initial.shown||{},series=initial.series||{},rows=[],disposed=false,inflight=null,lastSync=0,signature='',current=null,pending=null,hideTimer=null,removeTimer=null,flushTimer=null,recoveryTimer=null,lastShownAt=0,hover=false,drag=null,dragged=false;
 let position=parse(positionKey,null);if(!Number.isFinite(position?.x)||!Number.isFinite(position?.y))position=null;
 const host=document.createElement('div');host.className='cc119-work-notice-host';host.hidden=true;host.style.cssText='position:fixed;z-index:100960;width:min(300px,calc(100vw - 24px));pointer-events:auto;';
 const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
 style.textContent=`*{box-sizing:border-box}article{font:12px/1.4 Inter,Segoe UI,Arial,sans-serif;color:#334155;background:rgba(248,251,255,.72);border:1px solid rgba(134,157,190,.32);border-radius:10px;box-shadow:0 2px 10px #3341550c;opacity:.84;animation:enter .12s ease-out;transition:opacity .12s,background .12s}article:hover,article:focus-within{opacity:1;background:rgba(250,252,255,.97)}header{display:flex;align-items:center;gap:5px;min-height:33px;padding:3px 5px}button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}.grip{width:15px;color:#94a3b8;cursor:grab;touch-action:none;user-select:none}.heading{flex:1;min-width:0;padding:4px 0;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;touch-action:none}.close{font-size:17px;line-height:1;width:23px;height:23px;color:#64748b}.body{display:none;max-height:min(180px,35vh);overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:0 12px 10px;color:#475569;cursor:pointer}article:hover .body,article:focus-within .body{display:block}.leaving{opacity:0;transform:translateY(3px);transition:opacity .12s,transform .12s}@keyframes enter{from{opacity:0;transform:translateY(4px)}to{opacity:.84;transform:none}}@media(prefers-reduced-motion:reduce){article{animation:none;transition:none}.leaving{transition:none}}`;
 shadow.append(style);(document.body||document.documentElement).append(host);
 const live=()=>!disposed&&accountPrincipal()===principal;
 function persist(){const cutoff=Date.now()-7*86400000;shown=Object.fromEntries(Object.entries(shown).filter(([,at])=>Number(at)>=cutoff).slice(-400));series=Object.fromEntries(Object.entries(series).filter(([,at])=>Number(at)>=cutoff).slice(-100));try{localStorage.setItem(key,JSON.stringify({shown,series}));}catch{}}
 function place(){const rect=host.getBoundingClientRect(),w=rect.width||300,h=rect.height||34;const x=position?Number(position.x)*window.innerWidth:window.innerWidth-w-16,y=position?Number(position.y)*window.innerHeight:window.innerHeight*.72;host.style.left=Math.round(Math.max(8,Math.min(window.innerWidth-w-8,x)))+'px';host.style.top=Math.round(Math.max(8,Math.min(window.innerHeight-h-8,y)))+'px';}
 function record(item){const stamp=Date.parse(item.created_at)||Date.now();shown[String(item.notification_id)]=Date.now();series[workNoticeSeries(item)]=Math.max(Number(series[workNoticeSeries(item)])||0,stamp);}
 function eligible(item){return isManagedWorkNotice(item)&&String(item.user_id)===uid&&!shown[item.notification_id]&&(Date.parse(item.created_at)||0)>Number(series[workNoticeSeries(item)]||0);}
 function finish(){clearTimeout(hideTimer);clearTimeout(removeTimer);if(!current)return;shadow.querySelector('article')?.classList.add('leaving');removeTimer=setTimeout(()=>{host.hidden=true;current=null;},120);}
 function scheduleHide(delay){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!hover&&!drag)finish();},Math.max(100,delay));}
 function openCurrent(item){if(dragged){dragged=false;return;}finish();navigate(notificationTarget(item));void api.post('/api/notifications/'+encodeURIComponent(item.notification_id)+'/read',{}, {retries:0,detachedWrite:true,background:true,headers:{'X-CC-Dashboard-User':'global'}}).catch(()=>{});}
 function show(item){
  if(!live()||!canReceiveWorkNotices(user)||document.hidden||!getPollingLeaderSnapshot()?.isLeader)return;
  clearTimeout(hideTimer);clearTimeout(removeTimer);current=item;record(item);persist();lastShownAt=Date.now();hover=false;
  const article=document.createElement('article');article.setAttribute('role','status');article.setAttribute('aria-label','Work notification');
  const header=document.createElement('header'),grip=document.createElement('button'),heading=document.createElement('button'),close=document.createElement('button'),body=document.createElement('div');
  grip.className='grip';grip.textContent='⠿';grip.setAttribute('aria-label','Drag notification');heading.className='heading';heading.textContent=item.title||'Work update';heading.title='Click to open · hover for details';close.className='close';close.textContent='×';close.setAttribute('aria-label','Dismiss notification');body.className='body';body.textContent=item.message||'';
  heading.onclick=()=>openCurrent(item);body.onclick=()=>openCurrent(item);close.onclick=event=>{event.stopPropagation();finish();};
  const down=event=>{if(event.button!==0)return;dragged=false;const rect=host.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,target:event.currentTarget};clearTimeout(hideTimer);event.currentTarget.setPointerCapture?.(event.pointerId);};
  for(const target of [grip,heading]){target.onpointerdown=down;target.onpointermove=event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4)dragged=true;if(!dragged)return;position={x:(drag.left+dx)/window.innerWidth,y:(drag.top+dy)/window.innerHeight};place();};target.onpointerup=()=>{if(!drag)return;drag=null;if(dragged){const rect=host.getBoundingClientRect();position={x:rect.left/window.innerWidth,y:rect.top/window.innerHeight};try{localStorage.setItem(positionKey,JSON.stringify(position));}catch{}}if(!hover)scheduleHide(250);};target.onpointercancel=()=>{drag=null;if(!hover)scheduleHide(250);};}
  article.onpointerenter=()=>{hover=true;clearTimeout(hideTimer);place();};article.onpointerleave=()=>{hover=false;if(!drag)scheduleHide(250);flushLatest();};article.onfocusin=()=>{hover=true;clearTimeout(hideTimer);};article.onfocusout=()=>{hover=false;scheduleHide(250);};
  header.append(grip,heading,close);article.append(header,body);const old=shadow.querySelector('article');if(old)old.replaceWith(article);else shadow.append(article);host.hidden=false;place();const p=readWorkNoticePolicy(),seconds=String(user.role).toLowerCase()==='tl'?p.tl_seconds:p.manager_seconds;scheduleHide(seconds*1000-120);
 }
 function flushLatest(){
  clearTimeout(flushTimer);if(!pending||!live())return;
  if(hover||drag){flushTimer=setTimeout(flushLatest,1000);return;}
  const wait=Math.max(0,lastShownAt+4000-Date.now());if(wait){flushTimer=setTimeout(flushLatest,wait);return;}
  const item=pending;pending=null;if(eligible(item))show(item);
 }
 function offer(incoming){
  const list=latestWorkNotices(incoming||[]).filter(eligible),item=list[0];
  // Drop the catch-up queue locally. History remains available on the server.
  for(const old of list.slice(1))record(old);if(list.length>1)persist();
  if(!item)return;if(!pending||(Date.parse(item.created_at)||0)>=(Date.parse(pending.created_at)||0)){if(pending)record(pending);pending=item;}
  clearTimeout(flushTimer);flushTimer=setTimeout(flushLatest,140);
 }
 function planRecovery(){clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>{if(live()&&!document.hidden)void sync();else planRecovery();},window.__CC940_NOTICE_STREAM_READY__?1800000:300000);}
 async function sync(){
  if(!live()||!canReceiveWorkNotices(user)||inflight||document.hidden||!getPollingLeaderSnapshot()?.isLeader||window.__CC602_NETWORK_PAUSED__)return inflight;
  if(lastSync&&Date.now()-lastSync<300000){planRecovery();return;}
  lastSync=Date.now();const scope=principal;
  inflight=api.get('/api/notifications?inbox=1'+(signature?'&signature='+encodeURIComponent(signature):''),{cacheTtlMs:0,retries:0,background:true,timeoutMs:12000,headers:{'X-CC-Dashboard-User':'global'}}).then(feed=>{
   if(!live()||scope!==accountPrincipal())return;if(feed.notice_policy)applyPolicy(feed.notice_policy);if(!canReceiveWorkNotices(user)){host.hidden=true;return;}
   if(!feed.unchanged){rows=mergeInboxRows([],feed.items||[],uid);offer(rows);}signature=feed.signature||signature;
  }).catch(()=>{}).finally(()=>{inflight=null;if(live())planRecovery();});return inflight;
 }
 function incoming(event){const item=event.detail;if(!live()||String(item?.user_id)!==uid||!canReceiveWorkNotices(user))return;rows=mergeInboxRows(rows,[item],uid);offer([item]);}
 function read(event){const data=event.detail||{};if(String(data.user_id)!==uid)return;if(current&&(data.all||String(data.notification_id)===String(current.notification_id)))finish();rows=rows.filter(row=>!data.all&&String(row.notification_id)!==String(data.notification_id));}
 function recover(){if(!live())return;if(document.hidden){host.hidden=true;return;}if(current)finish();if(Date.now()-lastSync>=300000)void sync();}
 function changed(){if(!canReceiveWorkNotices(user)){pending=null;finish();}else if(!lastSync)void sync();}
 const unsubscribe=subscribePollingLeader(snapshot=>{if(snapshot.isLeader){if(!lastSync)void sync();}else{pending=null;finish();}}),unpolicy=subscribeWorkNoticePolicy(changed);
 const reset=()=>{position=null;try{localStorage.removeItem(positionKey);}catch{}place();};
 window.addEventListener('career-crox-notification',incoming);window.addEventListener('career-crox-notification-read',read);window.addEventListener('focus',recover);window.addEventListener('resize',place);window.addEventListener('cc119-reset-notice-position',reset);document.addEventListener('visibilitychange',recover);
 void loadWorkNoticePolicy().catch(()=>{});void sync();
 return()=>{disposed=true;for(const timer of [hideTimer,removeTimer,flushTimer,recoveryTimer])clearTimeout(timer);unsubscribe();unpolicy();window.removeEventListener('career-crox-notification',incoming);window.removeEventListener('career-crox-notification-read',read);window.removeEventListener('focus',recover);window.removeEventListener('resize',place);window.removeEventListener('cc119-reset-notice-position',reset);document.removeEventListener('visibilitychange',recover);host.remove();};
}
