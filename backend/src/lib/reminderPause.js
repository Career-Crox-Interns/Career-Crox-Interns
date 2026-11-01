'use strict';
const crypto=require('crypto');
const {store,table,withTransaction,afterCommit}=require('./store');
const access=require('./accessRules');
const PREFIX='cc922.reminder-pause:';
const text=v=>String(v??'').trim();
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const key=(type,id)=>PREFIX+type+':'+id;
function parse(row){try{const p=JSON.parse(row?.setting_value||'null');return p&&p.target_key&&Number.isFinite(Date.parse(p.until))?p:null;}catch{return null;}}
function targetKeys(row,user){const ids=[];if(row.candidate_id)ids.push(key('candidate',row.candidate_id));if(row.task_id)ids.push(key('task',row.task_id));if(row.notification_id)ids.push(key('notification',row.notification_id));if(row.key)ids.push(key('reminder',text(user?.user_id)+':'+row.key));return ids;}
async function decorate(rows,user){
 const keys=[...new Set(rows.flatMap(r=>targetKeys(r,user)))];if(!keys.length)return{items:rows,pauses:[]};
 const stored=store.pool?await store.query('select setting_key,setting_value from public.settings where setting_key=any($1::text[])',[keys]):(await table('settings')).filter(r=>keys.includes(r.setting_key));
 const map=new Map(stored.map(r=>[r.setting_key,parse(r)]));
 return{items:rows.map(row=>{const matches=targetKeys(row,user).map(k=>map.get(k)).filter(Boolean).sort((a,b)=>Date.parse(b.until)-Date.parse(a.until));return matches.length?{...row,reminder_pause:matches[0]}:row;}),pauses:stored.map(parse).filter(Boolean)};
}
async function resolveTarget(body,user){
 const type=text(body.target_type||(body.candidate_id?'candidate':'')),id=text(body.target_id||body.candidate_id);
 if(!id||id.length>160)fail(400,'A valid reminder/profile is required.');
 if(type==='candidate'){
  const row=await store.findById('candidates','candidate_id',id);
  if(!row||!access.visibleCandidateForUser(row,user))fail(404,'Profile not found.');
  return{type,id,candidate:row,target_key:key(type,id),title:row.full_name||id};
 }
 if(type==='task'){
  let row;
  if(store.pool){const scope=access.simpleOwnerSql('t',['assigned_to_user_id','assigned_to_code','assigned_to_name'],user,[id]);row=await store.one('select t.* from public.tasks t where t.task_id=$1 and ('+scope.sql+')',scope.params);}
  else{row=await store.findById('tasks','task_id',id);const ids=new Set([user.user_id,...(user.__ccTeamUserIds||[])]),codes=new Set([user.recruiter_code,...(user.__ccTeamCodes||[])].filter(Boolean).map(x=>text(x).toLowerCase()));if(row&&!access.isAdminOrManager(user)&&!ids.has(row.assigned_to_user_id)&&!codes.has(text(row.assigned_to_code).toLowerCase()))row=null;}
  if(!row)fail(404,'Task not found.');return{type,id,target_key:key(type,id),title:row.title||id,task:row};
 }
 if(type==='notification'){
  const row=await store.findById('notifications','notification_id',id);if(!row||String(row.user_id)!==String(user.user_id))fail(404,'Notification not found.');
  return{type,id,target_key:key(type,id),title:row.title||'Notification'};
 }
 if(type==='reminder'&&/^(semi_hourly|break|monthly_revenue:\d{4}-\d\d)$/.test(id))return{type,id,target_key:key(type,text(user.user_id)+':'+id),title:text(body.title).slice(0,160)||'Reminder'};
 fail(400,'This reminder does not support a custom pause.');
}
async function save(req,res){
 const user=req.user||{},body=req.body||{},note=text(body.note),command=text(body.request_id);
 if(!note||note.length>2000)fail(400,'Add a reason (up to 2000 characters) before pausing.');
 if(!/^[a-zA-Z0-9-]{16,80}$/.test(command))fail(400,'A valid request identity is required.');
 if(!/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(text(body.until)))fail(400,'Choose a future date and time with timezone.');
 const until=Date.parse(body.until),now=Date.now();
 if(!Number.isFinite(until)||until<=now||until>now+3650*86400000)fail(400,'Choose a future reminder time within ten years.');
 const result=await withTransaction(async()=>{
  const target=await resolveTarget(body,user);
  const receiptKey='cc922.pause-command:'+user.user_id+':'+command;
  if(store.pool){await store.query("insert into public.settings(setting_key,setting_value) values($1,'{}') on conflict(setting_key) do nothing",[receiptKey]);await store.query('select setting_key from public.settings where setting_key=$1 for update',[receiptKey]);}
  let receipt;try{receipt=JSON.parse((await store.findById('settings','setting_key',receiptKey))?.setting_value||'null');}catch{}
  if(receipt?.target_key){if(receipt.target_key!==target.target_key||receipt.until!==new Date(until).toISOString()||receipt.note!==note)fail(409,'This request was used for different reminder details.');return{ok:true,pause:receipt,replayed:true};}
  if(store.pool){await store.query("insert into public.settings(setting_key,setting_value) values($1,'{}') on conflict(setting_key) do nothing",[target.target_key]);await store.query('select setting_key from public.settings where setting_key=$1 for update',[target.target_key]);}
  const previous=parse(await store.findById('settings','setting_key',target.target_key));
  const canonicalUntil=new Date(until).toISOString();
  if(previous?.request_id===command){if(previous.until!==canonicalUntil||previous.note!==note)fail(409,'This request was used for different reminder details.');return{ok:true,pause:previous,replayed:true};}
  const at=new Date().toISOString(),pause={revision:Number(previous?.revision||0)+1,target_key:target.target_key,target_type:target.type,target_id:target.id,candidate_id:target.candidate?.candidate_id||'',task_id:target.task?.task_id||'',title:target.title,until:canonicalUntil,note,request_id:command,actor_id:user.user_id,actor_name:user.full_name||user.username,created_at:at};
  await store.upsert('settings','setting_key',{setting_key:target.target_key,setting_value:JSON.stringify(pause)});
  await store.upsert('settings','setting_key',{setting_key:receiptKey,setting_value:JSON.stringify(pause)});
  const when=new Date(until).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'});
  const message=`${pause.actor_name} paused reminders until ${when} IST.\nReason: ${note}`;
  if(target.candidate){
   const noteId=parseInt(crypto.createHash('sha256').update(target.target_key+':'+command).digest('hex').slice(0,13),16);
   await store.insert('notes',{id:noteId,candidate_id:target.id,username:user.username||pause.actor_name,note_type:'reminder_pause',body:message,created_at:at});
   await require('./workflowNotifications').notify(target.candidate,user,'Reminders paused · '+target.title,message,{note_body:message,reminder_pause:pause});
  }
  await store.insert('activity_log',{activity_id:'PAUSE-'+crypto.randomUUID(),candidate_id:target.candidate?.candidate_id||'',user_id:user.user_id,username:user.username,action_type:'reminder_paused',metadata:JSON.stringify(pause),created_at:at});
  await afterCommit(async()=>{
   require('./cache').clearAllCaches(target.candidate?['reminders','candidates','approvals']:['reminders']);
   const bus=require('./approvalLive'),payload={source:'/reminders/pauses',candidate_id:pause.candidate_id,pause,at:Date.now()};
   if(target.candidate)bus.publishReminderDirty(target.candidate,payload);
   else{const ids=[user.user_id,target.task?.assigned_to_user_id].filter(Boolean);bus.publishToUsers(ids,'reminder-dirty',payload);}
  });
  return{ok:true,pause};
 });
 res.set('Cache-Control','private, no-store');return res.json(result);
}
module.exports={save,decorate,targetKeys,PREFIX};
