'use strict';
const crypto=require('crypto');
const {store,table,withTransaction,afterCommit}=require('../lib/store');
const access=require('../lib/accessRules'),bucket=require('../lib/bucketPolicy');
const {createTimedCache,clearAllCaches}=require('../lib/cache');
const cache=createTimedCache(30000,{maxEntries:200,tags:['access','candidates','staff']});
const layoutsCache=createTimedCache(300000,{maxEntries:1,tags:['settings']});
const text=v=>String(v??'').trim(),parse=(v,fallback={})=>{try{return typeof v==='string'?JSON.parse(v):v??fallback;}catch{return fallback;}};
const fail=(status,message,code)=>{throw Object.assign(new Error(message),{status,...(code?{code}:{})});};
const actor=req=>req.actorUser||req.user;
const manager=req=>{if(!access.isAdminOrManager(actor(req)))fail(403,'Only a manager can approve access or arrange shared columns.');};
const matches=(loss,user)=>String(loss.previous_user_id)===String(user.user_id)||parse(loss.previous_tl_ids,[]).map(String).includes(String(user.user_id));
const grantNewer=(request,loss)=>request.status==='Approved'&&String(request.candidate_id)===String(loss.candidate_id)&&Date.parse(request.decided_at||'')>=Date.parse(loss.lost_at||'');
function safeSnapshot(row){return {full_name:require('../lib/helpers').normalizeCandidateName(row.full_name),phone_masked:'Hidden',location:text(row.location),process:text(row.process),status:text(row.status),interview_date:text(row.interview_reschedule_date||row.interview_date),submission_date:text(row.submission_date||row.submitted_at),last_note:text(row.notes||row.data_notes)};}
function safeLostText(value,user){const body=text(value).slice(0,10000);return access.isAdminOrManager(user)?body:body.replace(/(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}\b/g,'[phone hidden]').replace(/\b\d{10,15}\b/g,'[phone hidden]');}
function lostDate(value){const at=bucket.instantMs(value);return Number.isFinite(at)?at:0;}
function lostGroup(row,now=Date.now()){const at=lostDate(row.interview_date);if(!at)return 'no_date';if(/joined|selected|appeared|arrived|complete|rejected|cancel|not.interested|backout/i.test(row.status||''))return 'completed';return at<now?'missed':'upcoming';}
async function lossFor(user,id){if(store.pool)return store.one('select * from public.crm_lost_profiles where candidate_id=$1'+(access.isAdminOrManager(user)?'':' and (previous_user_id=$2 or previous_tl_ids ? $2)')+' order by lost_at desc limit 1',access.isAdminOrManager(user)?[id]:[id,String(user.user_id)]);return (await table('crm_lost_profiles')).filter(row=>String(row.candidate_id)===String(id)&&(access.isAdminOrManager(user)||matches(row,user))).sort((a,b)=>Date.parse(b.lost_at)-Date.parse(a.lost_at))[0];}

async function recordLoss(row,roster){
 if(!bucket.meta(row).bucketOut)return;
 roster=roster||await require('../lib/collaborationAccess').roster();
 const owner=roster.find(u=>String(u.user_id)===String(row.recruiter_user_id))||roster.find(u=>text(u.recruiter_code).toLowerCase()===text(row.recruiter_code).toLowerCase());
 if(!owner)return;
 const ids=roster.filter(u=>access.userRole(u)==='tl'&&(String(owner.tl_user_id||owner.team_lead_user_id||owner.reporting_tl_user_id||'')===String(u.user_id)||text(owner.tl_code||owner.team_lead_code).toLowerCase()===text(u.recruiter_code).toLowerCase()||text(owner.tl_name).toLowerCase()===text(u.full_name).toLowerCase())).map(u=>String(u.user_id));
 if(access.userRole(owner)==='tl')ids.push(String(owner.user_id));
 const assigned=bucket.assignedRaw(row),key=crypto.createHash('md5').update([row.candidate_id,owner.user_id,assigned].join('|')).digest('hex');
 if(await store.findById('crm_lost_profiles','loss_id',key))return;
 const when=bucket.meta(row).expiresAt||new Date().toISOString();
 await store.insert('crm_lost_profiles',{loss_id:key,candidate_id:row.candidate_id,previous_user_id:owner.user_id,previous_tl_ids:JSON.stringify([...new Set(ids)]),assigned_at:text(assigned),lost_at:when,snapshot:JSON.stringify(safeSnapshot(row))});
 cache.clear();
}
async function hydrateAccess(user){
 if(!user?.user_id||access.isAdminOrManager(user))return user;
 const id=String(user.user_id),data=await cache.load(id,async()=>{
  if(store.pool){
   const [lost,grants]=await Promise.all([
    store.query("select l.candidate_id from public.crm_lost_profiles l where (l.previous_user_id=$1 or l.previous_tl_ids ? $1) and not exists(select 1 from public.crm_profile_access_requests r where r.user_id=$1 and r.candidate_id=l.candidate_id and r.status='Approved' and r.decided_at>=l.lost_at)",[id]),
    store.query("select distinct r.candidate_id from public.crm_profile_access_requests r where r.user_id=$1 and r.status='Approved' and not exists(select 1 from public.crm_lost_profiles l where l.candidate_id=r.candidate_id and (l.previous_user_id=$1 or l.previous_tl_ids ? $1) and l.lost_at>r.decided_at)",[id])
   ]);return {lost:lost.map(r=>r.candidate_id),grants:grants.map(r=>r.candidate_id)};
  }
  const losses=(await table('crm_lost_profiles')).filter(l=>matches(l,user)),requests=(await table('crm_profile_access_requests')).filter(r=>String(r.user_id)===id);
  return {lost:losses.filter(l=>!requests.some(r=>grantNewer(r,l))).map(l=>l.candidate_id),grants:requests.filter(r=>r.status==='Approved'&&!losses.some(l=>l.candidate_id===r.candidate_id&&Date.parse(l.lost_at)>Date.parse(r.decided_at))).map(r=>r.candidate_id)};
 });return {...user,__ccLostCandidateIds:data.lost,__ccGrantedCandidateIds:data.grants};
}
async function captureExpired(user){
 if(store.pool){await store.query('select public.cc929_capture_expired($1,$2::boolean)',[String(user.user_id),access.isAdminOrManager(user)]);cache.clear();return;}
 const roster=await require('../lib/collaborationAccess').roster();
 for(const row of await table('candidates')){
  const own=String(row.recruiter_user_id)===String(user.user_id),team=(user.__ccTeamUserIds||[]).map(String).includes(String(row.recruiter_user_id));
  if((access.isAdminOrManager(user)||own||team)&&bucket.meta(row).bucketOut)await recordLoss(row,roster);
 }
}
async function listLost(req,res){
 const user=req.user;res.set('Cache-Control','private, no-store');await captureExpired(user);
 const q=text(req.query.q).toLowerCase().slice(0,180),page=Math.max(1,Math.min(100000,Number(req.query.page)||1)),size=30,group=['upcoming','missed','no_date','completed'].includes(req.query.group)?req.query.group:'all';
 let losses,requests,profiles,notes,total,counts,nextExpiry='';
 if(store.pool){
  const params=[String(user.user_id),'%'+q.replace(/[\\%_]/g,'\\$&')+'%'],where=user.__ccDashboardOwn?'l.previous_user_id=$1':access.isAdminOrManager(user)?'($1::text is not null)':'(l.previous_user_id=$1 or l.previous_tl_ids ? $1)';
  const base="with latest as (select distinct on(l.candidate_id) l.* from public.crm_lost_profiles l where "+where+" order by l.candidate_id,l.lost_at desc,l.loss_id), live as (select l.*,coalesce(nullif(c.interview_reschedule_date,''),nullif(c.interview_date,''),l.snapshot->>'interview_date','') as interview_date,coalesce(nullif(c.submission_date,''),l.snapshot->>'submission_date','') as submission_date,coalesce(nullif(c.status,''),l.snapshot->>'status','') as live_status,coalesce(nullif(c.full_name,''),l.snapshot->>'full_name','') as live_name,coalesce(c.phone,'') as live_phone,coalesce(c.location,l.snapshot->>'location','') as live_location,coalesce(c.process,l.snapshot->>'process','') as live_process,coalesce(nullif(c.notes,''),l.snapshot->>'last_note','') as live_note from latest l left join public.candidates c on c.candidate_id=l.candidate_id), facts as (select *,public.crm_due_instant(interview_date) as interview_at,case when public.crm_due_instant(interview_date) is null then 'no_date' when live_status ~* 'joined|selected|appeared|arrived|complete|rejected|cancel|not.interested|backout' then 'completed' when public.crm_due_instant(interview_date)<statement_timestamp() then 'missed' else 'upcoming' end as interview_group from live where (candidate_id ilike $2 or live_name ilike $2)) ";
  const summary=await store.one(base+"select count(*)::int as total,count(*) filter(where interview_group='upcoming')::int as upcoming,count(*) filter(where interview_group='missed')::int as missed,count(*) filter(where interview_group='no_date')::int as no_date,count(*) filter(where interview_group='completed')::int as completed from facts",params);
  counts={all:Number(summary.total),upcoming:Number(summary.upcoming),missed:Number(summary.missed),no_date:Number(summary.no_date),completed:Number(summary.completed)};total=group==='all'?counts.all:counts[group];
  const expiry=await store.one("select min(public.crm_bucket_deadline(to_jsonb(c))) as at from public.candidates c where "+(access.isAdminOrManager(user)?'true':'(c.recruiter_user_id=$1 or c.recruiter_user_id=any($2::text[]))')+" and public.crm_bucket_deadline(to_jsonb(c))>statement_timestamp()",access.isAdminOrManager(user)?[]:[String(user.user_id),(user.__ccTeamUserIds||[]).map(String)]);
  nextExpiry=expiry?.at||'';if(req.query.count_only==='1')return res.json({items:[],total,counts,page,has_more:false,next_expiry_at:nextExpiry});
  losses=await store.query(base+"select * from facts where ($3='all' or interview_group=$3) order by interview_at desc nulls last,lost_at desc,candidate_id limit 30 offset $4",[...params,group,(page-1)*size]);
  const ids=losses.map(row=>row.candidate_id);
  requests=ids.length?await store.query('select request_id,candidate_id,user_id,status,decided_at,created_at from public.crm_profile_access_requests where user_id=$1 and candidate_id=any($2::text[])',[String(user.user_id),ids]):[];
  notes=ids.length?await store.query("select n.* from unnest($1::text[]) as target(cid) cross join lateral(select id,candidate_id,username,note_type,left(body,2000) as body,created_at from public.notes where candidate_id=target.cid and (lower(coalesce(note_type,''))<>'private' or username=$2) order by created_at desc,id desc limit 6) n",[ids,user.username||'']):[];
  profiles=new Map(losses.map(l=>[String(l.candidate_id),{full_name:l.live_name,phone:l.live_phone,location:l.live_location,process:l.live_process,status:l.live_status,interview_date:l.interview_date,submission_date:l.submission_date,notes:l.live_note}]));
 }else{
  const all=await table('candidates');profiles=new Map(all.map(c=>[String(c.candidate_id),c]));
  losses=(await table('crm_lost_profiles')).filter(l=>user.__ccDashboardOwn?String(l.previous_user_id)===String(user.user_id):access.isAdminOrManager(user)||matches(l,user)).sort((a,b)=>Date.parse(b.lost_at)-Date.parse(a.lost_at));
  losses=[...new Map(losses.map(l=>[String(l.candidate_id),l]).reverse()).values()].filter(l=>!q||(l.candidate_id+' '+(profiles.get(String(l.candidate_id))?.full_name||parse(l.snapshot).full_name)).toLowerCase().includes(q));
  const view=l=>safeSnapshot(profiles.get(String(l.candidate_id))||parse(l.snapshot));
  counts={all:losses.length,upcoming:0,missed:0,no_date:0,completed:0};for(const l of losses)counts[lostGroup(view(l))]++;
  losses=losses.filter(l=>group==='all'||lostGroup(view(l))===group).sort((a,b)=>lostDate(view(b).interview_date)-lostDate(view(a).interview_date)||Date.parse(b.lost_at)-Date.parse(a.lost_at));total=losses.length;
  const times=all.filter(c=>access.isAdminOrManager(user)||String(c.recruiter_user_id)===String(user.user_id)||(user.__ccTeamUserIds||[]).map(String).includes(String(c.recruiter_user_id))).map(c=>Date.parse(bucket.meta(c).expiresAt)).filter(at=>at>Date.now());nextExpiry=times.length?new Date(Math.min(...times)).toISOString():'';
  if(req.query.count_only==='1')return res.json({items:[],total,counts,page,has_more:false,next_expiry_at:nextExpiry});
  losses=losses.slice((page-1)*size,page*size);requests=(await table('crm_profile_access_requests')).filter(r=>String(r.user_id)===String(user.user_id));notes=await table('notes');
 }
 const items=losses.map(l=>{
  const profile=profiles.get(String(l.candidate_id))||parse(l.snapshot),own=requests.filter(r=>String(r.candidate_id)===String(l.candidate_id)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)),approved=own.some(r=>grantNewer(r,l));
  const history=notes.filter(n=>String(n.candidate_id)===String(l.candidate_id)&&(text(n.note_type).toLowerCase()!=='private'||n.username===user.username)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,6),snapshot=safeSnapshot(profile);
  return {loss_id:l.loss_id,candidate_id:l.candidate_id,...snapshot,...(access.isAdminOrManager(user)?{phone:text(profile.phone)}:{}),phone_masked:'Hidden',last_note:safeLostText(history[0]?.body||snapshot.last_note,user).slice(0,2000),loss_note:safeLostText(parse(l.snapshot).last_note||parse(l.snapshot).notes,user).slice(0,2000),notes:history.slice(0,5).map(n=>({id:n.id,body:safeLostText(n.body,user).slice(0,2000),username:n.username,created_at:n.created_at})),notes_has_more:history.length>5,interview_group:lostGroup(snapshot),lost_at:l.lost_at,locked:!approved&&!access.isAdminOrManager(user),request_status:approved?'Approved':own[0]?.status||'',request_id:own[0]?.request_id||''};
 });return res.json({items,total,counts,page,has_more:page*size<total,next_expiry_at:nextExpiry});
}
async function lostNotes(req,res){
 const user=actor(req),id=text(req.params.candidateId);if(!await lossFor(user,id))fail(404,'This lost profile is not in your history.');
 const before=text(req.query.before),limit=30;if(before&&!/^\d{1,20}$/.test(before))fail(400,'Invalid note page.');
 let rows;if(store.pool)rows=await store.query("select id,body,username,created_at from public.notes where candidate_id=$1 and (lower(coalesce(note_type,''))<>'private' or username=$2)"+(before?' and id<$3::bigint':'')+" order by id desc limit 31",before?[id,user.username||'',before]:[id,user.username||'']);
 else rows=(await table('notes')).filter(n=>String(n.candidate_id)===id&&(text(n.note_type).toLowerCase()!=='private'||n.username===user.username)&&(!before||BigInt(n.id)<BigInt(before))).sort((a,b)=>BigInt(a.id)>BigInt(b.id)?-1:1).slice(0,31);
 const items=rows.slice(0,limit).map(n=>({...n,body:safeLostText(n.body,user)}));res.set('Cache-Control','private, no-store');return res.json({items,next_before:rows.length>limit?String(items.at(-1).id):''});
}
async function requestAccess(req,res){
 const user=actor(req),id=text(req.params.candidateId),note=text(req.body.note);if(!note||note.length>1000)fail(400,'Add a short reason for requesting access.');
 await captureExpired(user);
 return res.json(await withTransaction(async()=>{
  if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['cc929-access:'+user.user_id+':'+id]);
  const losses=store.pool?await store.query('select * from public.crm_lost_profiles where candidate_id=$1 and (previous_user_id=$2 or previous_tl_ids ? $2)',[id,String(user.user_id)]):(await table('crm_lost_profiles')).filter(l=>String(l.candidate_id)===id&&matches(l,user));
  if(!losses.length)fail(404,'This lost profile is not in your history.');
  const existing=store.pool?await store.one("select * from public.crm_profile_access_requests where candidate_id=$1 and user_id=$2 and status='Pending'",[id,String(user.user_id)]):(await table('crm_profile_access_requests')).find(r=>r.candidate_id===id&&r.user_id===user.user_id&&r.status==='Pending');
  if(existing)return {ok:true,item:existing,replayed:true};
  const row={request_id:crypto.randomUUID(),candidate_id:id,user_id:user.user_id,requester_name:user.full_name||user.username,note,status:'Pending',created_at:new Date().toISOString(),decided_at:null,decided_by:''};
  await store.insert('crm_profile_access_requests',row);
  for(const manager of (await require('../lib/collaborationAccess').roster()).filter(access.isAdminOrManager)){const notice={notification_id:crypto.randomUUID(),user_id:manager.user_id,title:'Lost profile access requested',message:row.requester_name+' requested access to '+id+'. Reason: '+note,category:'profile_access',status:'Unread',created_at:row.created_at,metadata:JSON.stringify({open_path:'/approvals',approval_kind:'profile_access',request_id:row.request_id,candidate_id:id})};await store.insert('notifications',notice);await afterCommit(()=>require('../lib/approvalLive').publishToUsers([manager.user_id],'notification',{item:notice}));}
  await afterCommit(()=>{clearAllCaches(['approvals','access']);return broadcast('approval-changed',{candidate_id:id,type:'profile_access'});});return {ok:true,item:row};
 }));
}
async function accessRequests(req,res){manager(req);const rows=store.pool?await store.query("select request_id,candidate_id,user_id,requester_name,note,status,created_at,decided_at from public.crm_profile_access_requests where status='Pending' order by created_at limit 200"):(await table('crm_profile_access_requests')).filter(r=>r.status==='Pending');return res.json({items:rows});}
async function decideAccess(req,res){
 manager(req);const status=req.body.approve===true?'Approved':req.body.approve===false?'Rejected':'';if(!status)fail(400,'Choose Approve or Reject.');
 const result=await withTransaction(async()=>{const id=text(req.params.requestId);if(store.pool)await store.query('select request_id from public.crm_profile_access_requests where request_id=$1 for update',[id]);const old=await store.findById('crm_profile_access_requests','request_id',id);if(!old)fail(404,'Request not found.');if(old.status!=='Pending'){if(old.status===status)return old;fail(409,'This request was already decided.');}
  const row=await store.findById('candidates','candidate_id',old.candidate_id);if(!row||access.isDeletedCandidate(row))fail(404,'This profile is no longer available.');
  const item=await store.update('crm_profile_access_requests','request_id',id,{status,decided_at:new Date().toISOString(),decided_by:String(actor(req).user_id)});
  const notice={notification_id:crypto.randomUUID(),user_id:old.user_id,title:'Profile access '+status.toLowerCase(),message:actor(req).full_name+' '+status.toLowerCase()+' your request for '+old.candidate_id+'.',category:'profile_access',status:'Unread',created_at:new Date().toISOString(),metadata:JSON.stringify({open_path:'/approvals',approval_kind:'profile_access',request_id:old.request_id,candidate_id:old.candidate_id})};await store.insert('notifications',notice);await afterCommit(()=>require('../lib/approvalLive').publishToUsers([old.user_id],'notification',{item:notice}));
  await afterCommit(async()=>{clearAllCaches();await broadcast('access-changed',{candidate_id:old.candidate_id});await broadcast('approval-changed',{candidate_id:old.candidate_id,type:'profile_access'});});return item;
 });return res.json({ok:true,item:result});
}
async function broadcast(type,payload){const users=await require('../lib/collaborationAccess').roster();require('../lib/approvalLive').publishToUsers(users.map(u=>u.user_id),type,{source:'/workspace/access',...payload});}
async function tableLayouts(req,res){const layouts=await layoutsCache.load('all',async()=>{const rows=store.pool?await store.query("select setting_key,setting_value from public.settings where setting_key like 'cc929.table:%' limit 200"):(await table('settings')).filter(r=>r.setting_key?.startsWith('cc929.table:'));return Object.fromEntries(rows.map(r=>[r.setting_key.slice(12),parse(r.setting_value)]));});return res.json({layouts});}
async function saveTableLayout(req,res){
 manager(req);const key=text(req.body.key),columns=req.body.columns;
 if(!/^[a-zA-Z0-9._:-]{1,100}$/.test(key)||!Array.isArray(columns)||columns.length<2||columns.length>60||new Set(columns).size!==columns.length||columns.some(c=>typeof c!=='string'||c.length>180))fail(400,'Invalid table column order.');
 const item=await withTransaction(async()=>{if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['cc929.table:'+key]);const previous=parse((await store.findById('settings','setting_key','cc929.table:'+key))?.setting_value);if(Number(req.body.expected_revision||0)!==Number(previous.revision||0))fail(409,'Another manager changed this table. Refresh and arrange again.');const value={columns,revision:Number(previous.revision||0)+1,updated_by:actor(req).user_id,updated_at:new Date().toISOString()};await store.upsert('settings','setting_key',{setting_key:'cc929.table:'+key,setting_value:JSON.stringify(value)});await afterCommit(()=>{layoutsCache.clear();return broadcast('workspace-change',{source:'/ui/table-layouts',key});});return value;});return res.json({ok:true,key,item});
}
module.exports={hydrateAccess,recordLoss,listLost,lostNotes,requestAccess,accessRequests,decideAccess,tableLayouts,saveTableLayout,safeLostText,lostGroup,captureExpired};

// CC124 allocation approvals share this workspace module; every source line stays visible.
module.exports.allocation=(()=>{
'use strict';
// CC124: approval records use the existing durable, indexed settings store.
const crypto=require('crypto');
const {store,table,withTransaction,afterCommit}=require('../lib/store');
const access=require('../lib/accessRules'),bucket=require('../lib/bucketPolicy');
const PREFIX='cc124.allocation-request:';
const text=v=>String(v??'').trim(),actor=req=>req.actorUser||req.user;
const fail=(status,message,code)=>{throw Object.assign(Error(message),{status,...(code?{code}:{})});};
function decode(row){try{return JSON.parse(row.setting_value);}catch{return null;}}
async function requests({user,all=false,pending=false}={}){
 let rows;
 if(store.pool){const args=[PREFIX],clauses=['left(setting_key,length($1))=$1'];if(pending)clauses.push("setting_value::jsonb->>'status'='Pending'");if(user&&!all){args.push(String(user.user_id));clauses.push("setting_value::jsonb->>'user_id'=$2");}rows=await store.query('select setting_value from public.settings where '+clauses.join(' and ')+" order by setting_value::jsonb->>'created_at' desc limit 500",args);}
 else rows=(await table('settings')).filter(r=>text(r.setting_key).startsWith(PREFIX));
 return rows.map(decode).filter(Boolean).filter(r=>(!pending||r.status==='Pending')&&(!user||all||String(r.user_id)===String(user.user_id))).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,500);
}
async function changed(row,decision=false){
 await afterCommit(async()=>{
  require('../lib/cache').clearAllCaches();
  const users=await require('../lib/collaborationAccess').roster(),managers=users.filter(access.isAdminOrManager);
  const recipients=decision?[row.user_id,row.owner_id]:managers.map(u=>u.user_id);
  for(const userId of new Set(recipients.filter(Boolean))){const item={notification_id:crypto.randomUUID(),user_id:userId,title:decision?'Allocation '+row.status.toLowerCase():row.kind==='lock'?'Allocation lock approval requested':'Profile allocation requested',message:row.candidate_id+' · '+row.requester_name+' · '+row.reason,category:'approval',status:'Unread',created_at:new Date().toISOString(),metadata:JSON.stringify({open_path:'/approvals',approval_kind:'allocation',request_id:row.id,candidate_id:row.candidate_id})};await store.insert('notifications',item);}
  require('../lib/approvalLive').publishToUsers(users.map(u=>u.user_id),'approval-changed',{source:'/workspace/allocation-locks',candidate_id:row.candidate_id});
  if(decision)require('../lib/approvalLive').publishToUsers(users.map(u=>u.user_id),'access-changed',{source:'/workspace/allocation-locks',candidate_id:row.candidate_id});
 });
}
async function request(req,res){
 const user=actor(req),id=text(req.params.candidateId),kind=req.body.kind==='allocation'?'allocation':'lock',reason=text(req.body.reason);
 if(!reason||reason.length>1000)fail(400,'Add a reason (up to 1,000 characters).');
 const result=await withTransaction(async()=>{
  if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['cc124-allocation:'+id]);
  const row=await store.findById('candidates','candidate_id',id);if(!row||access.isDeletedCandidate(row))fail(404,'Profile not found.');
  if(kind==='lock'){
   if(!access.visibleCandidateForUser(row,user))fail(403,'This profile is outside your current allocation access. Reopen it from your dashboard or request allocation.','ALLOCATION_ACCESS_DENIED');
   const meta=bucket.meta(row);
   if(meta.terminal)fail(409,'This profile is closed or marked not interested. Review its status before requesting an allocation extension.','ALLOCATION_CLOSED');
   if(!meta.assigned)fail(409,'Allocate this profile to an active TL or recruiter first. Fresh, unallocated and manager-owned profiles do not have a recruiter allocation to extend.','ALLOCATION_NOT_ASSIGNED');
   if(meta.bucketOut)fail(409,'This allocation has expired. Request a fresh allocation before asking for an extension.','ALLOCATION_EXPIRED');
   if(meta.dateInvalid)fail(409,'The saved allocation date is missing or invalid. Ask a manager to check the allocation.','ALLOCATION_DATE_INVALID');
  }
  const owner=text(row.recruiter_user_id),assigned=text(bucket.assignedRaw(row));
  if(kind==='lock'&&!owner)fail(400,'Allocate this profile before requesting a lock.');
  // A restricted search result can request allocation only with the complete
  // matching number, never by enumerating candidate IDs.
  if(kind==='allocation'&&!access.visibleCandidateForUser(row,user)){
   const phone=text(req.body.phone).replace(/\D/g,'').replace(/^91(?=\d{10}$)/,'');
   if(phone.length!==10||phone!==text(row.phone).replace(/\D/g,'').slice(-10))fail(404,'Search the complete matching phone number first.');
  }
  const until=kind==='lock'?bucket.instantMs(req.body.until):0;
  if(kind==='lock'&&(!Number.isFinite(until)||until<=Date.now()||until>Date.now()+730*bucket.DAY_MS||until<=Date.parse(bucket.meta(row).expiresAt)))fail(400,'Choose a lock end after the current expiry, within two years.');
  const pending=(await requests({user,pending:true})).find(r=>r.candidate_id===id&&r.kind===kind);
  if(pending)return {ok:true,item:pending,replayed:true};
  const entry={id:crypto.randomUUID(),kind,candidate_id:id,candidate_name:row.full_name||id,user_id:String(user.user_id),requester_name:user.full_name||user.username,owner_id:owner,assigned_at:assigned,reason,until:kind==='lock'?new Date(until).toISOString():'',status:'Pending',created_at:new Date().toISOString()};
  await store.upsert('settings','setting_key',{setting_key:PREFIX+entry.id,setting_value:JSON.stringify(entry)});await changed(entry);return {ok:true,item:entry};
 });res.json(result);
}
async function decide(req,res){
 const user=actor(req);if(!access.isAdminOrManager(user))fail(403,'Only a manager can decide allocation requests.');
 const status=req.body.approve===true?'Approved':req.body.approve===false?'Rejected':'';if(!status)fail(400,'Choose Approve or Reject.');
 const item=await withTransaction(async()=>{
  const key=PREFIX+text(req.params.requestId);if(store.pool)await store.query('select setting_key from public.settings where setting_key=$1 for update',[key]);
  const entry=decode(await store.findById('settings','setting_key',key)||{});if(!entry)fail(404,'Allocation request not found.');
  if(store.pool)await store.query('select candidate_id from public.candidates where candidate_id=$1 for update',[entry.candidate_id]);
  if(entry.status!=='Pending'){if(entry.status===status)return entry;fail(409,'This request was already decided.');}
  const profile=await store.findById('candidates','candidate_id',entry.candidate_id);if(!profile||access.isDeletedCandidate(profile))fail(404,'Profile no longer exists.');
  if(status==='Approved'){
   if(text(profile.recruiter_user_id)!==entry.owner_id||text(bucket.assignedRaw(profile))!==entry.assigned_at)fail(409,'This allocation changed after the request. Ask for a fresh request.');
   if(store.pool)await store.query("select set_config('career_crox.allocation_decision','1',true)");
   if(entry.kind==='lock'){
    if(Date.parse(entry.until)<=Date.now()||bucket.isTerminal(profile))fail(409,'The requested date has passed or this profile is closed.');
    const until=new Date(Math.max(Date.parse(entry.until),Number.isFinite(bucket.validLockUntil(profile))?bucket.validLockUntil(profile):0)).toISOString();
    await store.update('candidates','candidate_id',entry.candidate_id,{allocation_lock_until:until,allocation_lock_owner_id:entry.owner_id,allocation_lock_assigned_at:entry.assigned_at,allocation_lock_request_id:entry.id,updated_at:new Date().toISOString()},{allocationDecision:true});
   }else{
    const target=await store.findById('users','user_id',entry.user_id);if(!target||!['tl','recruiter'].includes(access.userRole(target)))fail(409,'Choose an active TL or recruiter for allocation.');
    if(!store.pool&&(await table('candidates')).filter(c=>String(c.recruiter_user_id)===entry.user_id&&c.candidate_id!==entry.candidate_id&&bucket.meta(c).active).length>=bucket.MAX_ACTIVE)fail(409,'This employee already has 70 active profiles.');
    const stamp=new Date().toISOString();await store.update('candidates','candidate_id',entry.candidate_id,{recruiter_user_id:entry.user_id,recruiter_code:target.recruiter_code||'',recruiter_name:target.full_name||target.username,recruiter_designation:target.role||target.designation,bucket_assigned_at:stamp,bucket_state:'working',allocation_lock_until:'',allocation_lock_owner_id:'',allocation_lock_assigned_at:'',allocation_lock_request_id:'',updated_at:stamp},{allocationDecision:true});
    // Preserve loss history, but restore this requester's access to the newly
    // approved allocation using the existing grant mechanism.
    await store.insert('crm_profile_access_requests',{request_id:crypto.randomUUID(),candidate_id:entry.candidate_id,user_id:entry.user_id,requester_name:entry.requester_name,note:entry.reason,status:'Approved',created_at:stamp,decided_at:stamp,decided_by:user.user_id});
   }
  }
  const next={...entry,status,decision_note:text(req.body.note).slice(0,1000),decided_at:new Date().toISOString(),decided_by:String(user.user_id)};
  await store.upsert('settings','setting_key',{setting_key:key,setting_value:JSON.stringify(next)});await changed(next,true);return next;
 });return res.json({ok:true,item});
}
async function list(req,res){
 const user=req.user,page=Math.max(1,Math.min(100000,Number(req.query?.page)||1)),size=50;let rows,total;
 if(store.pool){const scope=access.candidateScopeSql('c',user,[]),where=scope.sql+" and coalesce(c.allocation_lock_until,'')<>'' and public.crm_bucket_active(to_jsonb(c),statement_timestamp()) and public.crm_allocation_lock_until(to_jsonb(c))>statement_timestamp()";total=Number((await store.one('select count(*)::int as total from public.candidates c where '+where,scope.params))?.total||0);rows=await store.query('select c.candidate_id,c.full_name,c.recruiter_name,c.allocation_lock_until from public.candidates c where '+where+" order by c.allocation_lock_until,c.candidate_id limit 50 offset "+((page-1)*size),scope.params);}
 else{const all=(await table('candidates')).filter(c=>access.visibleCandidateForUser(c,user)&&bucket.meta(c).active&&bucket.validLockUntil(c)>Date.now()).sort((a,b)=>String(a.allocation_lock_until).localeCompare(String(b.allocation_lock_until)));total=all.length;rows=all.slice((page-1)*size,page*size);}
 const items=rows.map(c=>({candidate_id:c.candidate_id,full_name:c.full_name,recruiter_name:c.recruiter_name,until:c.allocation_lock_until}));res.set('Cache-Control','private, no-store');return res.json({items,total,page,has_more:page*size<total});
}
return {requests,request,decide,list};

})();
