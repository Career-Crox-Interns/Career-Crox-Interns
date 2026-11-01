const {store,afterCommit,transactionalHandler}=require('./store');
const {nowIso}=require('./helpers');
const makeFastId=prefix=>prefix+'_'+require('crypto').randomUUID();
const access=require('./accessRules');
const collab=require('./collaborationAccess');
const bus=require('./approvalLive');
const labels={notes:'Notes',data_notes:'Profile notes',submission_date:'Submission date',recruiter_user_id:'Owner',recruiter_code:'Owner code',follow_up_at:'Follow-up date',follow_up_status:'Follow-up status',follow_up_note:'Follow-up note',interview_date:'Interview date',interview_reschedule_date:'Interview date',virtual_onsite:'Interview mode',status:'Status',approval_status:'Approval',all_details_sent:'Details sent',process:'Process',project_id:'Project',joining_date:'Planned joining',joined_date:'Actual joining',selection_date:'Selection date'};
function changes(before={},after={}){return Object.keys(labels).filter(key=>!(key==='interview_reschedule_date'&&String(before.interview_date||'')!==String(after.interview_date||''))).filter(key=>String(before[key]||'')!==String(after[key]||'')).map(key=>({field:key,label:labels[key],from:String(before[key]||'').slice(0,250)||'Not set',to:String(after[key]||'').slice(0,250)||'Not set'}));}
async function create(userId,title,message,metadata={},category='candidate_update'){
 const item={notification_id:makeFastId('N'),user_id:userId,title,message,category,status:'Unread',metadata:JSON.stringify(metadata),created_at:nowIso()};
 await store.insert('notifications',item);
 await afterCommit(()=>{require('./cache').clearAllCaches(['approvals','notice-inbox','mobile-work-items']);bus.publishToUsers([userId],'notification',{item});});
 return item;
}
async function notify(row,actor,title,message,metadata={},extraIds=[]){
 const [users,state]=await Promise.all([collab.roster(),collab.state()]);
 const recipients=new Set(extraIds),viewers=new Map();
 for(const user of users){
  const viewer=collab.hydrateFrom(user,state,users);
  if(access.userRole(user)==='tl'){
   const team=users.filter(u=>access.userRole(u)==='recruiter'&&collab.primaryTl(u,users)===String(user.user_id));
   viewer.__ccTeamUserIds=[user.user_id,...team.map(u=>u.user_id)];viewer.__ccTeamCodes=[user.recruiter_code,...team.map(u=>u.recruiter_code)];viewer.__ccTeamNames=[user.full_name,...team.flatMap(u=>[u.full_name,u.username])];
  }
  viewers.set(String(user.user_id),viewer);
  if(access.visibleCandidateForUser(row,viewer))recipients.add(String(user.user_id));
 }
 if(actor?.user_id)recipients.add(actor.user_id);
 const pending=[];
 for(const recipient of recipients){
  
  // A removed collaborator must not receive a new note after losing record access.
  const person=users.find(u=>String(u.user_id)===String(recipient));if(!person)continue;
  if(!access.visibleCandidateForUser(row,viewers.get(String(recipient))||person))continue;
  pending.push({notification_id:makeFastId('N'),user_id:recipient,title,message,category:'candidate_update',status:'Unread',metadata:JSON.stringify({structured_notice:true,note_body:metadata.note_id?String(message||'').slice(0,4000):metadata.note_body||'',candidate_id:row.candidate_id,candidate_name:row.full_name||row.candidate_name||'',open_path:'/candidate/'+encodeURIComponent(row.candidate_id),actor_id:actor?.user_id||'',actor_name:actor?.full_name||actor?.username||'Team member',...metadata,notice_scope:'profile',owner_user_id:String(row.recruiter_user_id||row.assigned_to_user_id||row.owner_user_id||''),project_id:String(row.project_id||'')}),created_at:nowIso()});
 }
 if(!pending.length)return;
 if(store.pool){
  const columns=Object.keys(pending[0]),values=[];
  const groups=pending.map(item=>'('+columns.map(column=>{values.push(item[column]);return '$'+values.length;}).join(',')+')');
  await store.query('insert into public.notifications ('+columns.map(c=>'"'+c+'"').join(',')+') values '+groups.join(','),values);
 }else for(const item of pending)await store.insert('notifications',item);
 // Notifications remain durable in the same commit. Only delivery is deferred.
 await afterCommit(()=>{require('./cache').clearAllCaches(['approvals','notice-inbox','mobile-work-items']);for(const item of pending)bus.publishToUsers([item.user_id],'notification',{item},{viewer:viewers.get(String(item.user_id)),profile:row});});
}
async function updated(before,row,actor){const moved=['project_id','recruiter_user_id','recruiter_code'].some(k=>String(before[k]||'')!==String(row[k]||''));if(moved)await afterCommit(async()=>bus.publishToUsers((await collab.roster()).map(u=>u.user_id),'access-changed',{source:'/candidates/ownership',at:Date.now()}));const delta=changes(before,row);if(!delta.length)return;const name=actor.full_name||actor.username||'Team member';await notify(row,actor,name+' updated '+(row.full_name||row.candidate_id),delta.map(c=>c.label+': '+c.from+' → '+c.to).join('\n'),{changes:delta});}
function istDate(ms=Date.now()){return new Date(ms+330*60000).toISOString().slice(0,10);}
function nextDigestDelay(ms=Date.now()){const today=istDate(ms),due=Date.parse(today+'T17:30:00+05:30');return (ms<due?due:due+86400000)-ms;}
let running=null,lastDigestDay='';
async function digest(now=Date.now()){
 const quiet=require('./recentHumanActivity');if(quiet.nightDormant())return quiet.deferUntilUse('interview-digest',()=>require('./store').withTransaction(()=>digest()));
 if(!await require('./multipleCrm').writeAllowed())return {skipped:true,reason:'Standby instance'};
 if(running)return running;
 running=(async()=>{
  const day=istDate(now),due=Date.parse(day+'T17:30:00+05:30');if(now<due)return {skipped:true};
  const tomorrow=istDate(now+86400000),marker='cc831_interview_digest';
  if(store.pool){await store.query(`insert into app_settings(key,value,updated_at) values($1,'{}',$2) on conflict(key) do nothing`,[marker,nowIso()]);await store.query('select key from app_settings where key=$1 for update',[marker]);}
  const previous=await collab.setting(marker);if(previous.day===day){lastDigestDay=day;return {skipped:true,day};}
  const [users,state]=await Promise.all([collab.roster(),collab.state()]);
  const rows=store.pool?await store.query(`select candidate_id,full_name,phone,recruiter_user_id,recruiter_code,recruiter_name,project_id,status,approval_status,all_details_sent,data_notes,deleted_at,coalesce(nullif(interview_reschedule_date,''),interview_date,'') as interview_at from candidates c where to_char(crm_due_instant(coalesce(nullif(interview_reschedule_date,''),interview_date,'')) at time zone 'Asia/Kolkata','YYYY-MM-DD')=$1`,[tomorrow]):(await require('./store').table('candidates')).map(c=>({...c,interview_at:c.interview_reschedule_date||c.interview_date||''})).filter(c=>(/(?:Z|[+-]\d{2}:\d{2})$/.test(String(c.interview_at))?Number.isFinite(Date.parse(c.interview_at))?istDate(Date.parse(c.interview_at)):'':String(c.interview_at).slice(0,10))===tomorrow);
  let sent=0;
  for(const user of users){if(!['recruiter','tl','manager','admin'].includes(access.userRole(user)))continue;
   const viewer=collab.hydrateFrom(user,state,users),team=users.filter(u=>collab.primaryTl(u,users)===String(user.user_id));viewer.__ccTeamUserIds=[user.user_id,...team.map(u=>u.user_id)];viewer.__ccTeamCodes=[user.recruiter_code,...team.map(u=>u.recruiter_code)];viewer.__ccTeamNames=[user.full_name,...team.flatMap(u=>[u.full_name,u.username])];
   const visible=rows.filter(c=>access.visibleCandidateForUser(c,viewer)&&!['joined','backout','not joined','not interested','not intrested','rejected'].includes(String(c.status).toLowerCase()));if(!visible.length)continue;
   await create(user.user_id,"Tomorrow's interviews · "+visible.length,visible.slice(0,8).map(c=>c.full_name+' · '+c.interview_at).join('\n')+(visible.length>8?'\nOpen the complete list.':''),{open_path:'/interviews?date='+tomorrow,interview_date:tomorrow,count:visible.length},'interview_digest');sent++;
  }
  // One daily bounded cleanup for this feature's notices, no per-message retention scan.
  // Seven-day retention handles expired notifications without a count-based deletion.
  await store.upsert('app_settings','key',{key:marker,value:JSON.stringify({day}),updated_at:nowIso()});lastDigestDay=day;return {day,sent};
 })().finally(()=>{running=null;});return running;
}
function startDigest(){const tick=()=>{const timer=setTimeout(async()=>{tick();try{const quiet=require('./recentHumanActivity');if(quiet.nightDormant())quiet.deferUntilUse('interview-digest',()=>require('./store').withTransaction(()=>digest()));else await require('./store').withTransaction(()=>digest());}catch(error){console.error('Interview digest pending:',error.code||error.message);}},nextDigestDelay());timer.unref?.();};tick();}
async function catchUpDigest(){const quiet=require('./recentHumanActivity');if(quiet.nightDormant())return quiet.deferUntilUse('interview-digest',catchUpDigest);const now=Date.now(),day=istDate(now);if(day===lastDigestDay||now<Date.parse(day+'T17:30:00+05:30'))return;return require('./store').withTransaction(()=>digest(now));}
module.exports={changes,create,notify,updated,digest,catchUpDigest,nextDigestDelay,startDigest};

// CC153: personal staff activity never inherits project/combined-team access.
const noticeText=value=>String(value??'').trim();
function noticeMeta(item={}){try{const m=typeof item.metadata==='string'?JSON.parse(item.metadata||'{}'):item.metadata;return m&&typeof m==='object'&&!Array.isArray(m)?m:{};}catch{return {};}}
function staffNoticeVisible(viewer,subject,users=[]){
 if(!viewer?.user_id||!subject?.user_id)return false;
 if(access.isAdminOrManager(viewer)||String(viewer.user_id)===String(subject.user_id))return true;
 return access.userRole(viewer)==='tl'&&access.userRole(subject)==='recruiter'
  &&collab.primaryTl(subject,users)===String(viewer.user_id);
}
function staffNoticeRecipients(subject,users=[],{includeSelf=false,managerOnly=false}={}){
 return users.filter(u=>access.isAdminOrManager(u)||(!managerOnly&&access.userRole(u)==='tl'
  &&access.userRole(subject)==='recruiter'&&collab.primaryTl(subject,users)===String(u.user_id))
  ||includeSelf&&String(u.user_id)===String(subject.user_id)).map(u=>String(u.user_id));
}
function staffSubject(item,context={}){
 const m=noticeMeta(item),users=context.users||[];
 let key=noticeText(m.subject_user_id||m.employee_user_id||m.requester_user_id||m.user_id);
 if(!key&&m.report_id)key=noticeText(context.reports?.get(String(m.report_id))?.user_id);
 if(!key&&m.request_id)key=noticeText(context.unlocks?.get(String(m.request_id))?.user_id);
 return key?users.find(u=>String(u.user_id)===key)||{user_id:key,role:''}:null;
}
function notificationAllowed(viewer,item,context={},ownOnly=false){
 if(!viewer?.user_id||!item?.user_id)return false;
 const own=String(viewer.user_id)===String(item.user_id);
 if(ownOnly&&!own)return false;
 const m=noticeMeta(item),category=noticeText(item.category).toLowerCase(),title=noticeText(item.title);
 if(category==='chat')return own;
 if(access.isAdminOrManager(viewer))return true;
 if(m.manager_review||/attendance report approval pending|TL self.unlocked.*review pending/i.test(title))return false;
 const subject=staffSubject(item,context);
 if(subject&&!staffNoticeVisible(viewer,subject,context.users||[]))return false;
 const staff=/^(?:attendance|performance)$/.test(category)||/no[- ]?call|low.call|low activity|idle.*warning|attendance report|auto logged out|self.unlocked/i.test(title);
 if(staff&&!subject){
  const receipt=/^(?:CRM unlocked|Unlock request rejected|Self-unlock reviewed|Attendance report (?:approved|reviewed)|Report sent|Office (?:joined|left|exited)|Break (?:started|ended))\b/i.test(title);
  return own&&receipt;
 }
 const cid=noticeText(m.candidate_id);
 if(cid){
  if(category==='profile_access'&&own&&/^Profile access (?:approved|rejected)/i.test(title))return true;
  const row=context.candidates?.get(cid)||context.profile;
  if(!row){
   // Live delivery can use the owner snapshot carried by new profile notices.
   if(context.live&&m.notice_scope==='profile'&&m.owner_user_id){
    return access.visibleCandidateForUser({candidate_id:cid,project_id:m.project_id||'',recruiter_user_id:m.owner_user_id},context.viewer||viewer);
   }
   return context.live?own:false;
  }
  return access.visibleCandidateForUser(row,context.viewer||viewer);
 }
 if(subject)return true;
 if(own)return true;
 return staffNoticeVisible(viewer,(context.users||[]).find(u=>String(u.user_id)===String(item.user_id)),context.users||[]);
}
async function noticeAccessContext(viewer,items=[]){
 const [users,config]=await Promise.all([collab.roster(),collab.state()]);
 const current=users.find(u=>String(u.user_id)===String(viewer?.user_id))||viewer;
 const scoped=collab.hydrateFrom({...viewer,...current},config,users);
 const team=users.filter(u=>access.userRole(u)==='recruiter'&&collab.primaryTl(u,users)===String(current.user_id));
 scoped.__ccTeamUserIds=[current.user_id,...team.map(u=>u.user_id)];
 scoped.__ccTeamCodes=[current.recruiter_code,...team.map(u=>u.recruiter_code)].filter(Boolean);
 scoped.__ccTeamNames=[current.full_name,current.username,...team.flatMap(u=>[u.full_name,u.username])].filter(Boolean);
 if(access.isAdminOrManager(scoped))return {users,viewer:scoped,candidates:new Map(),reports:new Map(),unlocks:new Map()};
 const metadata=items.map(noticeMeta),ids=key=>[...new Set(metadata.map(m=>noticeText(m[key])).filter(Boolean))];
 async function rows(table,key,keys,fields){
  if(!keys.length)return new Map();
  const list=store.pool?await store.query('select '+fields+' from public.'+table+' where '+key+'=any($1::text[])',[keys]):(await require('./store').table(table)).filter(r=>keys.includes(String(r[key])));
  return new Map(list.map(r=>[String(r[key]),r]));
 }
 const [candidates,reports,unlocks]=await Promise.all([
  rows('candidates','candidate_id',ids('candidate_id'),'candidate_id,project_id,recruiter_user_id,recruiter_code,recruiter_name,status,approval_status,all_details_sent,data_notes,deleted_at,bucket_assigned_at,bucket_expires_at,bucket_is_bucket_out,allocation_lock_until,allocation_lock_owner_id'),
  rows('scheduled_reports','report_id',ids('report_id'),'report_id,user_id'),
  rows('unlock_requests','request_id',ids('request_id'),'request_id,user_id')
 ]);
 return {users,viewer:scoped,candidates,reports,unlocks};
}
Object.assign(module.exports,{noticeMeta,staffNoticeVisible,staffNoticeRecipients,notificationAllowed,noticeAccessContext});
