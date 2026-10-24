import {api} from './api';
import {getPollingLeaderSnapshot} from './tabLeader';

const DAY=86400000,IST=19800000,PERMANENT='CC_PERMANENT_V1';
const ymd=now=>new Date(now+IST).toISOString().slice(0,10);
const stamp=value=>{let s=String(value||'').trim();if(/^\d{4}-\d\d-\d\d$/.test(s))s+='T00:00';if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(s))s=s.replace(' ','T')+'+05:30';return Date.parse(s)||0;};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function taskOccurrence(row,now=Date.now()){
 if(!row||['deleted','archived','stopped','cancelled','canceled','scheduled'].includes(String(row.status||'').toLowerCase()))return null;
 const permanent=row.recurring_parent_task_id===PERMANENT;
 const done=['completed','done','closed'].includes(String(row.status||'').toLowerCase());
 const day=ymd(now);let raw=row.due_at||row.due_date;
 if(permanent){
  const start=String(row.permanent_start_date||row.due_date||'').slice(0,10),end=(/^UNTIL:(\d{4}-\d\d-\d\d)$/.exec(String(row.recurring_interval_minutes||''))||[])[1]||'';
  const diff=Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/DAY);
  if(!Number.isFinite(diff)||diff<0||end&&day>end||String(row.recurring_type).toLowerCase()==='weekly'&&diff%7||done&&ymd(stamp(row.closed_at))===day)return null;
  raw=day+String(raw||'').slice(10);
 }else if(done)return null;
 const due=stamp(raw);if(!due)return null;
 return {row,due,permanent,day:permanent?day:String(raw).slice(0,10)};
}
export function taskReminderStages(row,now=Date.now()){
 const o=taskOccurrence(row,now);if(!o)return [];
 const stages=o.permanent?[{stage:'before',at:o.due-600000},{stage:'due',at:o.due}]:[{stage:'due',at:stamp(row.reminder_at)||o.due}];
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
 const rt={principal,refs:0},rows=new Map();let state={},disposed=false,inflight=null,lastSync=0,current=null,signature='',busy=false,error='';
 try{const saved=JSON.parse(localStorage.getItem(key)||'{}');state=saved.state||{};(saved.rows||[]).forEach(r=>rows.set(String(r.task_id),r));}catch{}
 const host=document.createElement('div');host.id='cc917-task-reminder';host.style.cssText='position:fixed;right:18px;bottom:18px;z-index:100910;width:min(390px,calc(100vw - 24px));max-height:calc(100dvh - 24px);';
 const shadow=host.attachShadow({mode:'open'});document.body.append(host);
 shadow.innerHTML=`<style>:host{font:14px/1.45 "Segoe UI",Arial,sans-serif;color:#193250;color-scheme:light}*{box-sizing:border-box}section{max-height:calc(100dvh - 30px);overflow:auto;border-radius:22px;border:1px solid #a4e4ce;padding:20px;background:linear-gradient(145deg,#ffffff,#effff8 65%,#e9f4ff);box-shadow:0 20px 60px #18486633}header{display:flex;justify-content:space-between;gap:10px;align-items:center;color:#087450;font-size:12px;font-weight:800;letter-spacing:.06em}h2{font-size:23px;line-height:1.25;margin:12px 0;color:#12334d;overflow-wrap:anywhere}.meta{display:flex;gap:10px;flex-wrap:wrap;color:#395e74;font-size:13px;margin:10px 0}.note{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;border:1px solid #cce5dd;border-radius:13px;padding:13px;font-size:16px;background:#fff;color:#23405c}.time{font-size:19px;font-weight:800;color:#075b43;padding:13px 0}.actions,.presets{display:flex;gap:8px;flex-wrap:wrap}button{font:750 14px/1.3 "Segoe UI",Arial,sans-serif;border-radius:11px;border:1px solid #abcdbf;color:#244d4c;padding:11px 13px;background:#fff;cursor:pointer}button.primary{color:white;border-color:#079364;background:linear-gradient(120deg,#047c57,#12b982);flex:1}button:disabled{opacity:.55;cursor:wait}button:focus-visible,input:focus-visible{outline:3px solid #71a1ff;outline-offset:2px}.presets button{padding:7px 10px;font-size:12px}.presets{margin-top:11px}small{font-size:12px}select{padding:9px;border:1px solid #abcdbf;border-radius:10px;background:white;color:#244d4c}.error{color:#a62836;margin-top:8px}.open{width:100%;margin-top:12px;background:#ecf4ff;border-color:#c7dbef;color:#285689}.count{letter-spacing:0;color:#526f83} @media(max-width:430px){section{padding:16px}h2{font-size:21px}}</style><div id="card"></div>`;
 const card=shadow.querySelector('#card');
 function persist(){try{const cutoff=ymd(Date.now()-7*DAY);for(const k of Object.keys(state))if((k.split('|')[1]||'')<cutoff)delete state[k];localStorage.setItem(key,JSON.stringify({rows:[...rows.values()].slice(-2000),state}));}catch{}}
 function hide(){card.innerHTML='';host.style.display='none';signature='';current=null;}
 function candidates(){const now=Date.now();return [...rows.values()].flatMap(r=>taskReminderStages(r,now)).filter(o=>o.at<=now&&!(state[o.key]?.ack)&&Number(state[o.key]?.until||0)<=now&&!(o.stage==='before'&&o.due<=now)).sort((a,b)=>a.at-b.at);}
 function render(){
  if(disposed||!getPollingLeaderSnapshot().isLeader||document.hidden||/\/(login|data-backup)(?:[/?#]|$)/.test(location.pathname)){hide();return;}
  const due=candidates(),o=due[0];window.__CC917_TASK_DUE_COUNT__=new Set(due.map(x=>x.row.task_id)).size;
  if(!o){hide();return;}if(busy)return;
  const sig=JSON.stringify([o.key,o.row.updated_at,o.row.title,o.row.description,error,due.length]);if(sig===signature)return;signature=sig;current=o;
  host.style.display='block';const r=o.row,when=new Date(o.due).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true});
  card.innerHTML=`<section role="alertdialog" aria-label="Task reminder"><header><span>${o.permanent?'DAILY / RECURRING TASK':'TASK REMINDER'}</span><span class="count">${due.length} due</span></header><h2>${esc(r.title||'Your task')}</h2><div class="meta"><span>For: ${esc(r.assigned_to_name||user.full_name||'You')}</span><span>From: ${esc(r.assigned_by_name||'Task giver')}</span></div><div class="note">${esc(r.description||'No additional instructions.')}</div><div class="time">${o.stage==='before'?'Starts in 10 minutes':'Due now'} · ${esc(when)} IST</div><div class="actions"><button class="primary" data-action="${o.permanent?'ack':'complete'}">${o.permanent?'OK, I will':'Mark completed'}</button><button data-action="later">Later · 30m</button></div><div class="presets">${[5,10,30,60,360].map(n=>`<button data-minutes="${n}">${n<60?n+'m':n/60+'h'}</button>`).join('')}</div><button class="open" data-action="open">Open task ↗</button>${error?`<div class="error" role="status">${esc(error)}</div>`:''}</section>`;
 }
 async function action(event){const button=event.target.closest('button');if(!button||!current||busy)return;const o=current;
  if(button.dataset.minutes||button.dataset.action==='later'){state[o.key]={until:Date.now()+Number(button.dataset.minutes||30)*60000};persist();hide();render();return;}
  if(button.dataset.action==='ack'){state[o.key]={ack:true};persist();hide();render();return;}
  if(button.dataset.action==='open'){window.open('/tasks?task_id='+encodeURIComponent(o.row.task_id),'_blank','noopener,noreferrer');return;}
  if(button.dataset.action==='complete'){busy=true;button.disabled=true;button.textContent='Saving…';try{const result=await api.put('/api/tasks/'+encodeURIComponent(o.row.task_id),{status:'Completed'},{retries:0,headers:{'x-cc-dashboard-user':'self'}});if(!result?.item||!['completed','done','closed'].includes(String(result.item.status).toLowerCase()))throw Error('Completion was not confirmed. Retry.');rows.set(String(o.row.task_id),{...o.row,...result.item});state[o.key]={ack:true};error='';persist();hide();}catch(e){error=e.message;signature='';}finally{busy=false;render();}}
 }
 shadow.addEventListener('click',action);
 async function sync(force=false){if(disposed||inflight||!force&&Date.now()-lastSync<300000)return inflight;inflight=api.get('/api/tasks/alerts/upcoming',{cacheTtlMs:0,retries:0,background:true,headers:{'x-cc-dashboard-user':'self'}}).then(data=>{if(disposed)return;if(!Array.isArray(data.items))throw Error('Invalid task snapshot');const loaded=new Map(data.items.map(r=>[String(r.task_id),r]));for(const [id,r]of rows)if((Date.parse(r.updated_at)||0)>started)loaded.set(id,r);rows.clear();loaded.forEach((r,id)=>rows.set(id,r));lastSync=Date.now();persist();render();}).catch(()=>{}).finally(()=>{inflight=null;});const started=Date.now();return inflight;}
 function receive(event){const r=event.detail?.task||event.detail?.item;if(!r?.task_id)return;if(String(r.assigned_to_user_id||'')!==principal){rows.delete(String(r.task_id));persist();render();return;}rows.set(String(r.task_id),{...rows.get(String(r.task_id)),...r});persist();signature='';render();}
 function written(event){for(const row of event.detail?.items||[])receive({detail:{item:row}});}
 function ready(){if(Date.now()-lastSync>10000)sync(true);render();}
 function manual(event){if(event.target.closest('button')?.textContent?.trim().match(/^Reminders\b/i))sync(true);}
 function storage(event){if(event.key!==key)return;try{state=JSON.parse(event.newValue||'{}').state||{};signature='';render();}catch{}}
 window.addEventListener('career-crox-task-changed',receive);window.addEventListener('career-crox-workspace-change',receive);window.addEventListener('career-crox-reminder-ready',ready);window.addEventListener('online',ready);window.addEventListener('career-crox-task-created',written);window.addEventListener('storage',storage);document.addEventListener('click',manual,true);
 const timer=setInterval(render,1000);sync(true);render();
 rt.dispose=()=>{disposed=true;clearInterval(timer);clearTimeout(rt.disposeTimer);host.remove();window.removeEventListener('career-crox-task-changed',receive);window.removeEventListener('career-crox-workspace-change',receive);window.removeEventListener('career-crox-reminder-ready',ready);window.removeEventListener('online',ready);window.removeEventListener('career-crox-task-created',written);window.removeEventListener('storage',storage);document.removeEventListener('click',manual,true);};return rt;
}
