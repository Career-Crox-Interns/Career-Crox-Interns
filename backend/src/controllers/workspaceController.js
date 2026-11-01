'use strict';
const crypto=require('crypto');
const {store,table,withTransaction,afterCommit}=require('../lib/store');
const access=require('../lib/accessRules'),bucket=require('../lib/bucketPolicy');
const {createTimedCache,clearAllCaches}=require('../lib/cache');
const cache=createTimedCache(30000,{maxEntries:200,tags:['access','candidates','staff']});
const layoutsCache=createTimedCache(300000,{maxEntries:1,tags:['settings']});
const text=v=>String(v??'').trim(),parse=(v,fallback={})=>{try{return typeof v==='string'?JSON.parse(v):v??fallback;}catch{return fallback;}};
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const actor=req=>req.actorUser||req.user;
const manager=req=>{if(!access.isAdminOrManager(actor(req)))fail(403,'Only a manager can approve access or arrange shared columns.');};
const matches=(loss,user)=>String(loss.previous_user_id)===String(user.user_id)||parse(loss.previous_tl_ids,[]).map(String).includes(String(user.user_id));
const grantNewer=(request,loss)=>request.status==='Approved'&&String(request.candidate_id)===String(loss.candidate_id)&&Date.parse(request.decided_at||'')>=Date.parse(loss.lost_at||'');
function safeSnapshot(row){return {full_name:require('../lib/helpers').normalizeCandidateName(row.full_name),phone_masked:text(row.phone).replace(/\d(?=\d{4})/g,'•'),location:text(row.location),process:text(row.process),status:text(row.status)};}

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
 const user=actor(req);await captureExpired(user);const q=text(req.query.q).toLowerCase(),page=Math.max(1,Number(req.query.page)||1),size=50;
 let losses,requests,total;
 if(store.pool){
  const where=access.isAdminOrManager(user)?'true':'(l.previous_user_id=$1 or l.previous_tl_ids ? $1)',params=access.isAdminOrManager(user)?[]:[String(user.user_id)];
  params.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');const clause=where+` and (l.candidate_id ilike $${params.length} or l.snapshot->>'full_name' ilike $${params.length})`;
  total=Number((await store.one('select count(distinct l.candidate_id)::int as n from public.crm_lost_profiles l where '+clause,params))?.n||0);
  if(req.query.count_only==='1')return res.json({items:[],total,page,has_more:false});
  losses=await store.query(`select * from (select distinct on(l.candidate_id) l.* from public.crm_lost_profiles l where ${clause} order by l.candidate_id,l.lost_at desc,l.loss_id) latest order by lost_at desc limit ${size} offset $${params.length+1}`,[...params,(page-1)*size]);
  requests=losses.length?await store.query('select request_id,candidate_id,user_id,status,decided_at,created_at from public.crm_profile_access_requests where user_id=$1 and candidate_id=any($2::text[])',[String(user.user_id),losses.map(l=>l.candidate_id)]):[];
 }else{
  losses=(await table('crm_lost_profiles')).filter(l=>access.isAdminOrManager(user)||matches(l,user)).filter(l=>!q||(text(l.candidate_id)+' '+text(parse(l.snapshot).full_name)).toLowerCase().includes(q)).sort((a,b)=>String(b.lost_at).localeCompare(String(a.lost_at)));losses=[...new Map(losses.map(l=>[l.candidate_id,l]).reverse()).values()].sort((a,b)=>String(b.lost_at).localeCompare(String(a.lost_at)));total=losses.length;if(req.query.count_only==='1')return res.json({items:[],total,page,has_more:false});losses=losses.slice((page-1)*size,page*size);requests=(await table('crm_profile_access_requests')).filter(r=>String(r.user_id)===String(user.user_id));
 }
 const items=losses.map(l=>{const own=requests.filter(r=>String(r.candidate_id)===String(l.candidate_id)).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))),approved=own.some(r=>grantNewer(r,l));return {loss_id:l.loss_id,candidate_id:l.candidate_id,...safeSnapshot(parse(l.snapshot)),phone_masked:text(parse(l.snapshot).phone_masked)||safeSnapshot(parse(l.snapshot)).phone_masked,lost_at:l.lost_at,locked:!approved&&!access.isAdminOrManager(user),request_status:approved?'Approved':own[0]?.status||'',request_id:own[0]?.request_id||''};});
 return res.json({items,total,page,has_more:page*size<total});
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
  for(const manager of (await require('../lib/collaborationAccess').roster()).filter(access.isAdminOrManager)){const notice={notification_id:crypto.randomUUID(),user_id:manager.user_id,title:'Lost profile access requested',message:row.requester_name+' requested access to '+id+'. Reason: '+note,category:'profile_access',status:'Unread',created_at:row.created_at,metadata:JSON.stringify({open_path:'/candidates?lost=1',candidate_id:id})};await store.insert('notifications',notice);await afterCommit(()=>require('../lib/approvalLive').publishToUsers([manager.user_id],'notification',{item:notice}));}
  await afterCommit(()=>broadcast('lost-profile-access-requested',{candidate_id:id}));return {ok:true,item:row};
 }));
}
async function accessRequests(req,res){manager(req);const rows=store.pool?await store.query("select request_id,candidate_id,user_id,requester_name,note,status,created_at,decided_at from public.crm_profile_access_requests where status='Pending' order by created_at limit 200"):(await table('crm_profile_access_requests')).filter(r=>r.status==='Pending');return res.json({items:rows});}
async function decideAccess(req,res){
 manager(req);const status=req.body.approve===true?'Approved':req.body.approve===false?'Rejected':'';if(!status)fail(400,'Choose Approve or Reject.');
 const result=await withTransaction(async()=>{const id=text(req.params.requestId);if(store.pool)await store.query('select request_id from public.crm_profile_access_requests where request_id=$1 for update',[id]);const old=await store.findById('crm_profile_access_requests','request_id',id);if(!old)fail(404,'Request not found.');if(old.status!=='Pending'){if(old.status===status)return old;fail(409,'This request was already decided.');}
  const row=await store.findById('candidates','candidate_id',old.candidate_id);if(!row||access.isDeletedCandidate(row))fail(404,'This profile is no longer available.');
  const item=await store.update('crm_profile_access_requests','request_id',id,{status,decided_at:new Date().toISOString(),decided_by:String(actor(req).user_id)});
  const notice={notification_id:crypto.randomUUID(),user_id:old.user_id,title:'Profile access '+status.toLowerCase(),message:actor(req).full_name+' '+status.toLowerCase()+' your request for '+old.candidate_id+'.',category:'profile_access',status:'Unread',created_at:new Date().toISOString(),metadata:JSON.stringify({open_path:'/candidates?lost=1',candidate_id:old.candidate_id})};await store.insert('notifications',notice);await afterCommit(()=>require('../lib/approvalLive').publishToUsers([old.user_id],'notification',{item:notice}));
  await afterCommit(async()=>{clearAllCaches();await broadcast('access-changed',{candidate_id:old.candidate_id});});return item;
 });return res.json({ok:true,item:result});
}
async function broadcast(type,payload){const users=await require('../lib/collaborationAccess').roster();require('../lib/approvalLive').publishToUsers(users.map(u=>u.user_id),type,{source:'/workspace/access',...payload});}
async function tableLayouts(req,res){const layouts=await layoutsCache.load('all',async()=>{const rows=store.pool?await store.query("select setting_key,setting_value from public.settings where setting_key like 'cc929.table:%' limit 200"):(await table('settings')).filter(r=>r.setting_key?.startsWith('cc929.table:'));return Object.fromEntries(rows.map(r=>[r.setting_key.slice(12),parse(r.setting_value)]));});return res.json({layouts});}
async function saveTableLayout(req,res){
 manager(req);const key=text(req.body.key),columns=req.body.columns;
 if(!/^[a-zA-Z0-9._:-]{1,100}$/.test(key)||!Array.isArray(columns)||columns.length<2||columns.length>60||new Set(columns).size!==columns.length||columns.some(c=>typeof c!=='string'||c.length>180))fail(400,'Invalid table column order.');
 const item=await withTransaction(async()=>{if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['cc929.table:'+key]);const previous=parse((await store.findById('settings','setting_key','cc929.table:'+key))?.setting_value);if(Number(req.body.expected_revision||0)!==Number(previous.revision||0))fail(409,'Another manager changed this table. Refresh and arrange again.');const value={columns,revision:Number(previous.revision||0)+1,updated_by:actor(req).user_id,updated_at:new Date().toISOString()};await store.upsert('settings','setting_key',{setting_key:'cc929.table:'+key,setting_value:JSON.stringify(value)});await afterCommit(()=>{layoutsCache.clear();return broadcast('workspace-change',{source:'/ui/table-layouts',key});});return value;});return res.json({ok:true,key,item});
}
module.exports={hydrateAccess,recordLoss,listLost,requestAccess,accessRequests,decideAccess,tableLayouts,saveTableLayout};
