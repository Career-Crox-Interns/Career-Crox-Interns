import {api} from './api';
const PREFIX='cc922.reminder-pause:', maps=new Map();let dialog=null;
const principal=()=>{try{return String(JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}').user_id||'');}catch{return'';}};
function current(){const id=principal();if(!maps.has(id)){try{maps.set(id,JSON.parse(localStorage.getItem('cc922:pauses:'+id)||'{}'));}catch{maps.set(id,{});}}return maps.get(id);}
export function acceptReminderPauses(rows=[]){
 const map=current();for(const row of rows){if(!row?.target_key||!Number.isFinite(Date.parse(row.until)))continue;const previous=map[row.target_key];if(previous&&Number(previous.revision)>Number(row.revision))continue;map[row.target_key]=row;}
 try{const keys=Object.keys(map);if(keys.length>1500)for(const key of keys.sort((a,b)=>Date.parse(map[a].until)-Date.parse(map[b].until)).slice(0,keys.length-1500))delete map[key];localStorage.setItem('cc922:pauses:'+principal(),JSON.stringify(map));}catch{}
 window.dispatchEvent(new Event('cc922-reminder-pauses-changed'));
}
function keys(row={}){const list=[];if(row.candidate_id||row.candidateId)list.push(PREFIX+'candidate:'+(row.candidate_id||row.candidateId));if(row.task_id)list.push(PREFIX+'task:'+row.task_id);if(row.notification_id)list.push(PREFIX+'notification:'+row.notification_id);if(row.key)list.push(PREFIX+'reminder:'+principal()+':'+row.key);return list;}
export function reminderPauseUntil(row={}){
 const map=current(),all=[row.reminder_pause,...keys(row).map(k=>map[k])].filter(Boolean),byKey=new Map();
 for(const p of all){const old=byKey.get(p.target_key);if(!old||Number(p.revision)>=Number(old.revision))byKey.set(p.target_key,p);}
 return Math.max(0,...[...byKey.values()].map(p=>Date.parse(p.until)||0));
}
function target(row){if(row.target_type)return row;if(row.candidate_id||row.candidateId)return{target_type:'candidate',target_id:row.candidate_id||row.candidateId,title:row.name||row.title};if(row.task_id)return{target_type:'task',target_id:row.task_id,title:row.title};if(row.notification_id)return{target_type:'notification',target_id:row.notification_id,title:row.title};return{target_type:'reminder',target_id:row.key,title:row.title};}
const localValue=ms=>new Date(ms+19800000).toISOString().slice(0,16);
export function openReminderPause(row,onSaved){
 if(window.__CC920_OFFICE_GATE__?.()===false||!principal())return;
 dialog?.close();const owner=principal(),item=target(row),el=document.createElement('dialog');dialog=el;window.__CC922_PAUSE_DIALOG_OPEN__=true;
 el.className='cc922-pause-dialog';el.dataset.cc839Time='native';el.dataset.cc730Skip='1';el.setAttribute('aria-labelledby','cc922-pause-title');
 el.innerHTML=`<style>.cc922-pause-dialog{position:fixed!important;inset:0!important;margin:auto!important;height:fit-content;box-sizing:border-box;width:min(470px,calc(100vw - 28px));max-height:calc(100dvh - 30px);overflow:auto;border:1px solid #c5d2e6;border-radius:22px;padding:24px;background:linear-gradient(140deg,#fff,#f4f6ff 65%,#f2fff8);color:#20324b;font:400 14px/1.5 Inter,"Segoe UI",sans-serif;box-shadow:0 24px 90px #17294840}.cc922-pause-dialog::backdrop{background:#15203866;backdrop-filter:blur(4px)}.cc922-pause-dialog h2{font-size:22px;font-weight:600;margin:0 0 5px}.cc922-pause-dialog p{margin:5px 0 15px;color:#56677e}.cc922-pause-dialog label{display:block;font-size:13px;margin:12px 0 5px;font-weight:500}.cc922-pause-dialog input,.cc922-pause-dialog textarea{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid #bfccdf;border-radius:11px;background:white;color:#223854;font:inherit}.cc922-pause-dialog textarea{min-height:95px;resize:vertical}.cc922-pause-dialog .cc922-mode,.cc922-pause-dialog .cc922-buttons{display:flex;gap:8px;margin:14px 0}.cc922-pause-dialog button{font:500 14px Inter,"Segoe UI",sans-serif;padding:10px 14px;border:1px solid #c3cfe1;border-radius:11px;background:white;color:#30476a;cursor:var(--cc922-pointer,var(--cc922-cursor,pointer))}.cc922-pause-dialog button[aria-pressed=true]{background:#e8e9ff;border-color:#7c7add}.cc922-pause-dialog button[type=submit]{flex:1;background:linear-gradient(115deg,#5064ca,#7956c2);color:white!important;border:0}.cc922-pause-dialog button:disabled{opacity:.55;cursor:wait}.cc922-pause-dialog [role=alert]{color:#a1263c;font-size:13px}.cc922-pause-dialog input:focus,.cc922-pause-dialog textarea:focus{outline:3px solid #a7b8f6;outline-offset:1px}</style><form><h2 id="cc922-pause-title">Pause reminders</h2><p data-title></p><div class="cc922-mode" role="group" aria-label="Choose reminder schedule"><button type="button" data-mode="days" aria-pressed="true">After days</button><button type="button" data-mode="date" aria-pressed="false">Choose date & time</button></div><div data-days><label for="cc922-days">Remind after how many days?</label><input id="cc922-days" type="number" min="1" max="3650" step="1" value="3" required></div><div data-date hidden><label for="cc922-until">Resume date and time · IST</label><input id="cc922-until" type="datetime-local"></div><label for="cc922-note">Reason / note · required</label><textarea id="cc922-note" maxlength="2000" required placeholder="Candidate returns on the 10th; documents can be collected after arrival."></textarea><p data-preview></p><div role="alert" aria-live="polite"></div><div class="cc922-buttons"><button type="button" data-cancel>Cancel</button><button type="submit">Save pause</button></div><small>The profile stays Pending. These reminders resume at the selected time.</small></form>`;
 el.querySelector('[data-title]').textContent=item.title||'Selected reminder';
 const days=el.querySelector('#cc922-days'),until=el.querySelector('#cc922-until'),note=el.querySelector('#cc922-note'),preview=el.querySelector('[data-preview]'),error=el.querySelector('[role=alert]');let mode='days',busy=false,request='',payloadKey='';
 until.value=localValue(Date.now()+3*86400000);until.min=localValue(Date.now());
 const chosen=()=>mode==='days'?Date.now()+Number(days.value)*86400000:Date.parse(until.value+':00+05:30');
 const showPreview=()=>{const at=chosen();preview.textContent=Number.isFinite(at)?'Resume: '+new Date(at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST':'';};
 el.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;el.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));el.querySelector('[data-days]').hidden=mode!=='days';el.querySelector('[data-date]').hidden=mode!=='date';days.required=mode==='days';until.required=mode==='date';showPreview();});
 days.oninput=showPreview;until.oninput=showPreview;showPreview();
 el.querySelector('[data-cancel]').onclick=()=>{if(!busy)el.close();};
 el.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 el.addEventListener('close',()=>{el.remove();if(dialog===el){dialog=null;window.__CC922_PAUSE_DIALOG_OPEN__=false;}});
 el.querySelector('form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;error.textContent='';const reason=note.value.trim(),at=chosen();
  if(!reason){error.textContent='Add a reason before saving.';note.focus();return;}
  if(mode==='days'&&(!Number.isInteger(Number(days.value))||Number(days.value)<1||Number(days.value)>3650)||!Number.isFinite(at)||at<=Date.now()){error.textContent='Choose a valid future date/time.';return;}
  if(owner!==principal()){error.textContent='Account changed. Reopen the reminder.';return;}
  // Freeze the resolved timestamp for a retry of exactly the same input.
  const signature=JSON.stringify([item,mode,days.value,until.value,reason]);if(signature!==payloadKey){payloadKey=signature;request=crypto.randomUUID();el.__pauseAt=new Date(at).toISOString();}
  busy=true;el.querySelectorAll('button').forEach(b=>b.disabled=true);const button=el.querySelector('button[type=submit]');button.textContent='Saving…';
  try{const reply=await api.post('/api/reminders/pauses',{...item,until:el.__pauseAt,note:reason,request_id:request},{retries:0,timeoutMs:20000});if(!reply?.ok||!reply.pause)throw Error('Pause was not confirmed. Retry.');if(owner!==principal())return;acceptReminderPauses([reply.pause]);onSaved?.(reply.pause);window.dispatchEvent(new CustomEvent('career-crox-workspace-change',{detail:{source:'/reminders/pauses',pause:reply.pause,candidate_id:reply.pause.candidate_id}}));el.close();}
  catch(e){error.textContent=e.message||'Could not save. Your entries are kept.';}
  finally{busy=false;el.querySelectorAll('button').forEach(b=>b.disabled=false);button.textContent='Save pause';}
 };
 document.body.appendChild(el);el.showModal();note.focus();
}
export function installReminderPauseRuntime(){
 if(window.__CC922_PAUSE_INSTALLED__)return;window.__CC922_PAUSE_INSTALLED__=true;
 window.__CC922_OPEN_REMINDER_PAUSE__=openReminderPause;window.__CC922_REMINDER_PAUSE_UNTIL__=reminderPauseUntil;window.__CC922_ACCEPT_REMINDER_PAUSES__=acceptReminderPauses;
 window.addEventListener('career-crox-workspace-change',event=>{if(event.detail?.pause)acceptReminderPauses([event.detail.pause]);});
 window.addEventListener('storage',event=>{if(event.key==='cc922:pauses:'+principal()){maps.delete(principal());window.dispatchEvent(new Event('cc922-reminder-pauses-changed'));}});
 window.addEventListener('career-crox-idle-lock-begin',()=>dialog?.close());
}
