import {api,accountPrincipal} from './api';
import {getPollingLeaderSnapshot,subscribePollingLeader} from './tabLeader';
import {notificationTarget} from './workspaceHelpers';
import {playNotificationSound} from './notificationSound';

export function isManagedWorkNotice(item){
 const category=String(item?.category||'').toLowerCase();
 return Boolean(item?.notification_id)&&!['chat','unlock','dialer','archived'].includes(category)&&!/^unlock\b/i.test(item.title||'');
}
export function mergeInboxRows(current,incoming,userId){
 const map=new Map(current.map(row=>[String(row.notification_id),row]));
 for(const row of incoming||[]){
  if(!row?.notification_id||String(row.user_id)!==String(userId))continue;
  const id=String(row.notification_id);
  if(['read','archived','deleted'].includes(String(row.status||'unread').toLowerCase()))map.delete(id);else map.set(id,row);
 }
 return [...map.values()].filter(row=>String(row.user_id)===String(userId)).sort((a,b)=>(Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0)||String(b.notification_id).localeCompare(String(a.notification_id))).slice(0,60);
}

export function installNotificationInboxRuntime(user,{navigate=path=>window.location.assign(path)}={}){
 if(!user?.user_id||typeof document==='undefined')return()=>{};
 const principal=accountPrincipal(),uid=String(user.user_id),key='cc940-notice-state:'+principal;
 const loginAt=(()=>{try{return localStorage.getItem('careerCroxSessionLoginAt')||'';}catch{return '';}})();
 const dataKey='cc940-notice-inbox:'+principal+':'+loginAt;
 const parse=(store,name,fallback)=>{try{return JSON.parse(store.getItem(name)||'null')||fallback;}catch{return fallback;}};
 let state=parse(localStorage,key,{}),rows=mergeInboxRows([],parse(sessionStorage,dataKey,[]),uid);
 const savedMeta=parse(sessionStorage,dataKey+':meta',{});
 let signature=savedMeta.signature||'',disposed=false,inflight=null,lastSync=Number(savedMeta.at)||0,eventSerial=0,currentId='',shownAt=0,renderKey='';
 const patches=new Map(),errors=new Map(),pending=new Set(),host=document.createElement('div');
 host.className='cc940-work-notice-host';host.style.cssText='position:fixed;right:14px;top:112px;z-index:100960;width:min(370px,calc(100vw - 28px));';
 const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
 style.textContent='*{box-sizing:border-box}article{font:13px/1.5 Segoe UI,Arial,sans-serif;color:#23354c;background:linear-gradient(125deg,#fff,#eef5ff 70%,#f5eefd);border:1px solid #bfcee6;border-radius:17px;box-shadow:0 8px 28px #29436029;overflow:hidden;animation:enter .22s ease-out}header{display:flex;align-items:center;gap:9px;padding:11px 13px;background:#e9f1fc;color:#486b93;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}header img{width:26px;height:26px;object-fit:contain}header span{flex:1}button{font:inherit;cursor:pointer;border:1px solid #c4d2e5;border-radius:9px;padding:7px 11px;background:white;color:#36557a}header button{border:0;background:transparent;font-size:18px;padding:0 4px}h3{margin:12px 14px 6px;font-size:16px;line-height:1.35}p{white-space:pre-wrap;overflow-wrap:anywhere;max-height:140px;overflow:auto;margin:6px 14px;color:#485d77}.actions{display:flex;gap:7px;padding:11px 14px}.primary{background:linear-gradient(120deg,#557de0,#7962ca);color:white;border:0}.status{font-size:11px;color:#746154;padding:0 14px 10px}@keyframes enter{from{transform:translateY(-9px);opacity:0}to{transform:none;opacity:1}}@media(prefers-reduced-motion:reduce){article{animation:none}}';
 shadow.append(style);(document.body||document.documentElement).append(host);
 const live=()=>!disposed&&accountPrincipal()===principal;
 function persist(){
  const now=Date.now();state=Object.fromEntries(Object.entries(state).filter(([,v])=>Number(v?.at||0)>now-3*86400000).slice(-150));
  try{localStorage.setItem(key,JSON.stringify(state));sessionStorage.setItem(dataKey,JSON.stringify(rows));}catch{}
 }
 function dismiss(id,minutes=30){state[id]={at:Date.now(),until:Date.now()+minutes*60000};persist();renderKey='';render();}
 function render(){
  if(!live()||document.hidden||!getPollingLeaderSnapshot()?.isLeader){host.hidden=true;return;}
  const now=Date.now(),due=rows.filter(row=>isManagedWorkNotice(row)&&!pending.has(String(row.notification_id))&&!state[row.notification_id]?.read&&Number(state[row.notification_id]?.until||0)<=now&&(!Date.parse(row.created_at)||Date.parse(row.created_at)>now-2*86400000));
  const item=due[0];if(!item){host.hidden=true;currentId='';renderKey='';return;}
  const id=String(item.notification_id),stamp=JSON.stringify([id,item.title,item.message,due.length]);
  if(currentId===id&&shownAt&&now-shownAt>=20000&&!shadow.contains(document.activeElement)){dismiss(id,30);return;}
  host.hidden=false;if(stamp===renderKey)return;
  const article=document.createElement('article');article.setAttribute('role','status');article.setAttribute('aria-label','Career Crox work notification');
  const header=document.createElement('header'),logo=document.createElement('img');logo.src='/assets/img/career-crox-brand-icon.png';logo.alt='Career Crox';
  const brand=document.createElement('span');brand.textContent='Career Crox · '+due.length+' pending';const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Remind me later');close.onclick=()=>dismiss(id,30);header.append(logo,brand,close);
  const title=document.createElement('h3');title.textContent=item.title||'Work notification';const body=document.createElement('p');body.textContent=item.message||'';
  const actions=document.createElement('div');actions.className='actions';
  const open=document.createElement('button');open.className='primary';open.textContent='Open ↗';open.onclick=()=>{dismiss(id,30);navigate(notificationTarget(item));};
  const done=document.createElement('button');done.textContent='Done';done.onclick=()=>complete(item);
  const later=document.createElement('button');later.textContent='Later · 15m';later.onclick=()=>dismiss(id,15);actions.append(open,done,later);article.append(header,title,body,actions);if(errors.has(id)){const note=document.createElement('div');note.className='status';note.textContent=errors.get(id);article.append(note);}
  const previous=shadow.querySelector('article');if(previous)previous.replaceWith(article);else shadow.append(article);
  if(currentId!==id){currentId=id;shownAt=now;playNotificationSound('','','notice:'+id+':'+Math.floor(now/900000)).catch(()=>{});}
  renderKey=stamp;
 }
 async function complete(item){
  const id=String(item.notification_id);if(pending.has(id))return;
  pending.add(id);errors.delete(id);renderKey='';render();
  try{
   await api.post('/api/notifications/'+encodeURIComponent(id)+'/read',{}, {retries:0,timeoutMs:20000,detachedWrite:true,headers:{'X-CC-Dashboard-User':'global'}});
   if(!live())return;rows=rows.filter(row=>String(row.notification_id)!==id);state[id]={read:true,at:Date.now()};persist();
  }catch(error){if(live()){state[id]={at:Date.now(),until:0};errors.set(id,'Completion was not confirmed. Please retry Done.');}}
  finally{pending.delete(id);renderKey='';if(live())render();}
 }
 async function sync(){
  if(!live()||inflight||document.hidden||!getPollingLeaderSnapshot()?.isLeader||window.__CC602_NETWORK_PAUSED__)return inflight;
  if(lastSync&&Date.now()-lastSync<300000)return;
  const started=eventSerial;lastSync=Date.now();
  inflight=api.get('/api/notifications?inbox=1'+(signature?'&signature='+encodeURIComponent(signature):''),{cacheTtlMs:0,retries:0,background:true,timeoutMs:12000,headers:{'X-CC-Dashboard-User':'global'}}).then(feed=>{
   if(!live())return;if(!feed.unchanged)rows=mergeInboxRows([],feed.items||[],uid);signature=feed.signature||signature;
   for(const [id,patch]of patches)if(patch.serial>started)rows=mergeInboxRows(rows,[patch.row],uid);else patches.delete(id);
   try{sessionStorage.setItem(dataKey+':meta',JSON.stringify({signature,at:lastSync}));}catch{}
   persist();renderKey='';render();
  }).catch(()=>{}).finally(()=>{inflight=null;});return inflight;
 }
 function incoming(event){const row=event.detail;if(!live()||String(row?.user_id)!==uid)return;patches.set(String(row.notification_id),{serial:++eventSerial,row});while(patches.size>100)patches.delete(patches.keys().next().value);rows=mergeInboxRows(rows,[row],uid);persist();renderKey='';render();}
 function read(event){const data=event.detail||{};if(!live()||String(data.user_id)!==uid)return;const ids=data.all?rows.map(row=>String(row.notification_id)):[String(data.notification_id||'')];for(const id of ids){state[id]={read:true,at:Date.now()};patches.set(id,{serial:++eventSerial,row:{user_id:uid,notification_id:id,status:'Read'}});}rows=rows.filter(row=>!ids.includes(String(row.notification_id)));persist();renderKey='';render();}
 function recover(){if(Date.now()-lastSync>300000)void sync();render();}
 function storage(event){if(event.key===key){state=parse(localStorage,key,{});renderKey='';render();}}
 const unsubscribe=subscribePollingLeader(snapshot=>{if(snapshot.isLeader){render();if(!lastSync)void sync();}});
 window.addEventListener('career-crox-notification',incoming);window.addEventListener('career-crox-notification-read',read);window.addEventListener('storage',storage);window.addEventListener('focus',recover);document.addEventListener('visibilitychange',recover);
 // Replaying/snoozing/displaying a notice makes no request. A bounded recovery
 // read catches a disconnected event stream; healthy streams recover twice/hour.
 const timer=setInterval(()=>{render();if(Date.now()-lastSync>(window.__CC940_NOTICE_STREAM_READY__?1800000:300000))void sync();},1000);
 render();void sync();
 return()=>{disposed=true;clearInterval(timer);unsubscribe();window.removeEventListener('career-crox-notification',incoming);window.removeEventListener('career-crox-notification-read',read);window.removeEventListener('storage',storage);window.removeEventListener('focus',recover);document.removeEventListener('visibilitychange',recover);host.remove();};
}
