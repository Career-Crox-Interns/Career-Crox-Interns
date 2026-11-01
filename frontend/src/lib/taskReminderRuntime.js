import {acceptReminderPauses,reminderPauseUntil,openReminderPause} from './reminderPause';
import {api,reportWriteFailure} from './api';
import {getPollingLeaderSnapshot} from './tabLeader';

const DAY=86400000,IST=19800000,PERMANENT='CC_PERMANENT_V1';
const ymd=now=>new Date(now+IST).toISOString().slice(0,10);
const stamp=value=>{let s=String(value||'').trim();if(/^\d{4}-\d\d-\d\d$/.test(s))s+='T00:00';if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(s))s=s.replace(' ','T')+'+05:30';return Date.parse(s)||0;};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function taskOccurrence(row,now=Date.now()){
 if(!row||['deleted','archived','stopped','cancelled','canceled'].includes(String(row.status||'').toLowerCase()))return null;
 const permanent=row.recurring_parent_task_id===PERMANENT;
 const done=['completed','done','closed'].includes(String(row.status||'').toLowerCase());
 const day=ymd(now);let raw=row.due_at||row.due_date;
 if(permanent){
  const start=String(row.permanent_start_date||row.due_date||'').slice(0,10),endMatch=/^UNTIL:(\d{4}-\d\d-\d\d)(?:T(\d\d:\d\d))?$/.exec(String(row.recurring_interval_minutes||'')),end=endMatch?.[1]||'',endTime=endMatch?.[2]||'';
  const diff=Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/DAY);
  if(!Number.isFinite(diff)||diff<0||end&&(day>end||(day===end&&endTime&&now>stamp(end+'T'+endTime)))||String(row.recurring_type).toLowerCase()==='weekly'&&diff%7||done&&ymd(stamp(row.closed_at))===day)return null;
  const wall=stamp(raw);if(!wall)return null;
  raw=day+'T'+new Date(wall+IST).toISOString().slice(11,19)+'+05:30';
 }else if(done)return null;
 const due=stamp(raw);if(!due)return null;
 return {row,due,permanent,day:permanent?day:String(raw).slice(0,10)};
}
export function taskReminderStages(row,now=Date.now()){
 const o=taskOccurrence(row,now);if(!o)return [];
 const stages=[{stage:'before',at:o.due-600000},{stage:'due',at:o.due},{stage:'after',at:o.due+600000}];
 return stages.map(s=>({...o,...s,key:[row.task_id,o.day,s.stage].join('|')}));
}
let active=null;
export function installTaskReminderRuntime(user){
 if(!user?.user_id)return ()=>{};
 const principal=String(user.user_id);
 if(active&&active.principal!==principal){active.dispose();active=null;}
 if(!active)active=createRuntime(user);
 const runtime=active;runtime.refs++;clearTimeout(runtime.disposeTimer);
 return ()=>{runtime.refs--;runtime.disposeTimer=setTimeout(()=>{if(runtime.refs<=0){runtime.dispose();if(active===runtime)active=null;}},1200);};
}
function createRuntime(user){
 const principal=String(user.user_id),key='cc917-task-alerts:'+principal;
 const rt={principal,refs:0},rows=new Map(),pendingTasks=new Set();let pendingSnooze=null;let state={},disposed=false,inflight=null,lastSync=0,current=null,signature='',busy=false,error='';
 try{const saved=JSON.parse(localStorage.getItem(key)||'{}');state=saved.state||{};(saved.rows||[]).forEach(r=>rows.set(String(r.task_id),r));}catch{}
 const host=document.createElement('div');host.id='cc917-task-reminder';host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:100910;width:min(410px,calc(100vw - 24px));max-height:calc(100dvh - 24px);';
 const shadow=host.attachShadow({mode:'open'});document.body.append(host);
 shadow.innerHTML=`<style>:host{font:400 14px/1.45 "Plus Jakarta Sans","Segoe UI",Arial,sans-serif;color:#193250;color-scheme:light}*{box-sizing:border-box}section{max-height:calc(100dvh - 30px);overflow:auto;border-radius:22px;border:1px solid #a4e4ce;padding:23px;background:linear-gradient(145deg,#ffffff,#effff8 65%,#e9f4ff);box-shadow:0 20px 60px #18486633}header{display:flex;justify-content:space-between;gap:10px;align-items:center;color:#087450;font-size:12px;font-weight:600;letter-spacing:.06em}h2{font-weight:600;font-size:23px;line-height:1.25;margin:12px 0;color:#12334d;overflow-wrap:anywhere}.meta{display:flex;gap:10px;flex-wrap:wrap;color:#395e74;font-size:13px;margin:10px 0}.note{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;border:1px solid #cce5dd;border-radius:13px;padding:13px;font-size:16px;background:#fff;color:#23405c}.time{font-size:19px;font-weight:600;color:#075b43;padding:13px 0}.actions,.presets{display:flex;gap:8px;flex-wrap:wrap}button{font:500 14px/1.3 "Segoe UI",Arial,sans-serif;border-radius:11px;border:1px solid #abcdbf;color:#244d4c;padding:11px 13px;background:#fff;cursor:var(--cc922-pointer,var(--cc922-cursor,pointer))}button.primary{color:white;border-color:#079364;background:linear-gradient(120deg,#047c57,#12b982);flex:1}button:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible{outline:3px solid #71a1ff;outline-offset:2px}.presets button{padding:7px 10px;font-size:12px}.presets{margin-top:11px}small{font-size:12px}select{padding:9px;border:1px solid #abcdbf;border-radius:10px;background:white;color:#244d4c}.error{color:#a62836;margin-top:8px}.open{width:100%;margin-top:12px;background:#ecf4ff;border-color:#c7dbef;color:#285689}.count{letter-spacing:0;color:#526f83} section{animation:cc937-task-pop var(--cc937-popup-duration,.38s) cubic-bezier(.2,.85,.25,1.12) backwards}button{transition:scale .13s ease}button:active:not(:disabled){scale:.965}@keyframes cc937-task-pop{from{opacity:0;translate:0 10px;scale:.975}65%{opacity:1;translate:0 -2px;scale:1.006}to{opacity:1;translate:0 0;scale:1}}@media(prefers-reduced-motion:reduce){section{animation:none}button{transition:none;scale:1}} @media(max-width:430px){section{padding:16px}h2{font-size:21px}}</style><div id="card"></div>`;
 const card=shadow.querySelector('#card');
 function persist(){try{const cutoff=ymd(Date.now()-7*DAY);for(const k of Object.keys(state))if((k.split('|')[1]||'')<cutoff)delete state[k];localStorage.setItem(key,JSON.stringify({rows:[...rows.values()].slice(-2000),state}));}catch{}}
 function hide(){card.innerHTML='';host.style.display='none';signature='';current=null;}
 function candidates(){
  const now=Date.now(),list=[];
  for(const row of rows.values()){
   if(pendingTasks.has(String(row.task_id)))continue;
   const o=taskOccurrence(row,now);if(!o)continue;
   const until=reminderPauseUntil(row);if(until>now)continue;
   if(until&&(!o.permanent||ymd(until)===o.day)){const key=[row.task_id,o.day,'pause:'+until].join('|');if(!state[key]?.ack){list.push({...o,key,stage:'rescheduled',at:until});continue;}}
   for(const stage of taskReminderStages(row,now)){
    if(stage.at>now||stage.at<=until||state[stage.key]?.ack||Number(state[stage.key]?.until||0)>now)continue;
    if(stage.stage==='before'&&now>=stage.due||stage.stage==='due'&&now>=stage.due+600000)continue;
    list.push(stage);
   }
  }
  return list.sort((a,b)=>a.at-b.at);
 }
 function render(){
  if(disposed||!getPollingLeaderSnapshot().isLeader||document.hidden||/\/(login|data-backup)(?:[/?#]|$)/.test(location.pathname)){hide();return;}
  const due=candidates(),o=due[0];window.__CC917_TASK_DUE_COUNT__=new Set(due.map(x=>x.row.task_id)).size;
  if(!o){hide();return;}if(busy)return;
  const sig=JSON.stringify([o.key,o.row.updated_at,o.row.title,o.row.description,error,due.length]);if(sig===signature)return;signature=sig;current=o;
  host.style.display='block';host.dataset.cc927Occurrence=o.key;const r=o.row,when=new Date(o.due).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true});
  card.innerHTML=`<section role="alertdialog" aria-label="Task reminder"><header><span>${o.permanent?'DAILY / RECURRING TASK':'TASK REMINDER'}</span><span class="count">${due.length} due</span></header><h2>${esc(r.title||'Your task')}</h2><div class="meta"><span>For: ${esc(r.assigned_to_name||user.full_name||'You')}</span><span>From: ${esc(r.assigned_by_name||'Task giver')}</span></div><div class="note">${esc(r.description||'No additional instructions.')}</div><div class="time">${o.stage==='before'?'Starts in 10 minutes':o.stage==='after'?'10 minutes passed · Is the work complete?':o.stage==='rescheduled'?'Rescheduled reminder':'Due now'} · ${esc(when)} IST</div><div class="actions"><button class="primary" data-action="${o.permanent&&!['after','rescheduled'].includes(o.stage)?'ack':'complete'}">${o.permanent&&!['after','rescheduled'].includes(o.stage)?'OK, I will':'Mark completed'}</button><button data-action="later">Later · 30m</button></div><div class="presets">${[5,10,30,60,360].map(n=>`<button data-minutes="${n}">${n<60?n+'m':n/60+'h'}</button>`).join('')}<button data-action="custom" aria-label="Custom reminder pause" title="Pause until a date, with a note">+</button></div><button class="open" data-action="open">Open task ↗</button>${error?`<div class="error" role="status">${esc(error)}</div>`:''}</section>`;
 }
 async function action(event){
  const button=event.target.closest('button');if(!button||!current)return;const o=current,id=String(o.row.task_id);if(pendingTasks.has(id))return;
  if(button.dataset.action==='custom'){openReminderPause({target_type:'task',target_id:o.row.task_id,title:o.row.title},()=>{hide();render();});return;}
  if(button.dataset.action==='ack'){state[o.key]={ack:true};persist();hide();render();return;}
  if(button.dataset.action==='open'){window.open('/tasks?task_id='+encodeURIComponent(o.row.task_id),'_blank','noopener,noreferrer');return;}
  const later=button.dataset.minutes||button.dataset.action==='later',complete=button.dataset.action==='complete';if(!later&&!complete)return;
  let intent;
  if(later){const minutes=Number(button.dataset.minutes||30);if(!pendingSnooze||pendingSnooze.key!==o.key||pendingSnooze.minutes!==minutes)pendingSnooze={key:o.key,minutes,until:new Date(Date.now()+minutes*60000).toISOString(),request_id:crypto.randomUUID()};intent={...pendingSnooze};}
  // Hide this occurrence immediately; other reminders and the workspace stay usable.
  // No acknowledgement is persisted until the server confirms the actual write.
  pendingTasks.add(id);error='';hide();render();
  try{
   if(later){const reply=await api.post('/api/reminders/pauses',{target_type:'task',target_id:o.row.task_id,until:intent.until,note:'Task reminder rescheduled by '+(user.full_name||'recipient')+' for '+intent.minutes+' minutes.',request_id:intent.request_id},{retries:0,timeoutMs:20000,detachedWrite:true});if(!reply.ok||!reply.pause)throw Error('Reschedule was not confirmed.');if(disposed)return;acceptReminderPauses([reply.pause]);state[o.key]={ack:true};if(pendingSnooze?.request_id===intent.request_id)pendingSnooze=null;}
   else{const reply=await api.put('/api/tasks/'+encodeURIComponent(id),{status:'Completed'},{retries:0,timeoutMs:20000,detachedWrite:true,headers:{'x-cc-dashboard-user':'self'}});if(!reply?.item||String(reply.item.task_id)!==id||!['completed','done','closed'].includes(String(reply.item.status).toLowerCase()))throw Object.assign(new Error('Completion was not confirmed. Check this task before retrying.'),{code:'WRITE_ACK_INVALID'});if(disposed)return;rows.set(id,{...rows.get(id),...reply.item});state[o.key]={ack:true};}
   persist();
  }catch(e){if(!disposed){error=(o.row.title||'Task')+': '+e.message;reportWriteFailure(e,{force:true,path:later?'/api/reminders/pauses':'/api/tasks/'+encodeURIComponent(id),method:later?'POST':'PUT'});}}
  finally{pendingTasks.delete(id);signature='';if(!disposed)render();}
 }
 shadow.addEventListener('click',action);
 async function sync(force=false){if(disposed||inflight||!force&&Date.now()-lastSync<300000)return inflight;inflight=api.get('/api/tasks/alerts/upcoming',{cacheTtlMs:0,retries:0,background:true,headers:{'x-cc-dashboard-user':'self'}}).then(data=>{if(disposed)return;if(!Array.isArray(data.items))throw Error('Invalid task snapshot');acceptReminderPauses(data.reminder_pauses||[]);const loaded=new Map(data.items.map(r=>[String(r.task_id),r]));for(const [id,r]of rows)if((Date.parse(r.updated_at)||0)>started)loaded.set(id,r);rows.clear();loaded.forEach((r,id)=>rows.set(id,r));lastSync=Date.now();persist();render();}).catch(()=>{}).finally(()=>{inflight=null;});const started=Date.now();return inflight;}
 function receive(event){const r=event.detail?.task||event.detail?.item;if(!r?.task_id)return;if(String(r.assigned_to_user_id||'')!==principal){rows.delete(String(r.task_id));persist();render();return;}rows.set(String(r.task_id),{...rows.get(String(r.task_id)),...r});persist();signature='';render();}
 function written(event){for(const row of event.detail?.items||[])receive({detail:{item:row}});}
 function ready(){if(Date.now()-lastSync>10000)sync(true);render();}
 function manual(event){if(event.target.closest('button')?.textContent?.trim().match(/^Reminders\b/i))sync(true);}
 function storage(event){if(event.key!==key)return;try{state=JSON.parse(event.newValue||'{}').state||{};signature='';render();}catch{}}
 window.addEventListener('cc922-reminder-pauses-changed',render);window.addEventListener('career-crox-task-changed',receive);window.addEventListener('career-crox-workspace-change',receive);window.addEventListener('career-crox-reminder-ready',ready);window.addEventListener('online',ready);window.addEventListener('career-crox-task-created',written);window.addEventListener('storage',storage);document.addEventListener('click',manual,true);
 const timer=setInterval(render,1000);sync(true);render();
 rt.dispose=()=>{disposed=true;clearInterval(timer);clearTimeout(rt.disposeTimer);host.remove();window.removeEventListener('cc922-reminder-pauses-changed',render);window.removeEventListener('career-crox-task-changed',receive);window.removeEventListener('career-crox-workspace-change',receive);window.removeEventListener('career-crox-reminder-ready',ready);window.removeEventListener('online',ready);window.removeEventListener('career-crox-task-created',written);window.removeEventListener('storage',storage);document.removeEventListener('click',manual,true);};return rt;
}
