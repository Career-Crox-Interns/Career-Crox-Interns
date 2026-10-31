const {store,table,mode}=require('../lib/store');
const {isAdminOrManager,userRole}=require('../lib/accessRules');
const crypto=require('node:crypto');
const inboxCache=require('../lib/cache').createTimedCache(300000,{maxEntries:128,tags:['notice-inbox']});
function notificationIds(user){return [...new Set([user.user_id,...(userRole(user)==='tl'?user.__ccTeamUserIds||[]:[])].map(String))];}
function visibleNotification(user,row){return isAdminOrManager(user)||notificationIds(user).includes(String(row.user_id));}
function withUserFields(item,user){return {...item,owner_name:user?.full_name||'',recruiter_code:user?.recruiter_code||'',owner_role:user?.role||'',owner_designation:user?.designation||''};}
function noticeInstantSql(column){
 // The existing schema uses text on some instances and timestamps on others.
 // Validate legacy text before casting; malformed values never crash the feed.
 return "case when "+column+"::text ~ '"+RETENTION_DATE_PATTERN+"' then case when substring("+column+"::text,9,2)::int <= extract(day from (make_date(substring("+column+"::text,1,4)::int,substring("+column+"::text,6,2)::int,1)+interval '1 month - 1 day')) then case when "+column+"::text ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' then "+column+"::text::timestamptz else "+column+"::text::timestamp at time zone 'UTC' end else null end else null end";
}
function parseCursor(value){
 if(!value)return null;
 try{if(String(value).length>1200)throw Error();const pair=JSON.parse(Buffer.from(String(value),'base64url').toString());if(!Array.isArray(pair)||pair.length!==2||!Number.isFinite(Date.parse(pair[0]))||typeof pair[1]!=='string'||!pair[1]||pair[1].length>300)throw Error();return [new Date(pair[0]).toISOString(),pair[1]];}catch{throw Object.assign(Error('Invalid notification page. Refresh the list.'),{status:400});}
}
function pageOf(rows,limit){
 const more=rows.length>limit,items=rows.slice(0,limit).map(row=>{const {_notice_instant,_notice_iso,...item}=row;return {...item,created_at:_notice_iso||item.created_at};});
 const last=items.at(-1),cursor=more&&last?Buffer.from(JSON.stringify([last.created_at,last.notification_id])).toString('base64url'):'';
 return {items,next_cursor:cursor,retention_days:7};
}
async function list(req,res){
 if(req.query.inbox==='1')return ownInbox(req,res);
 const requested=Number(req.query.limit||200),limit=Number.isFinite(requested)&&requested>0?Math.min(200,Math.floor(requested)):200;
 let cursor;try{cursor=parseCursor(req.query.cursor);}catch(error){return res.status(400).json({message:error.message});}
 const leadership=isAdminOrManager(req.user),cutoff=new Date(Date.now()-7*86400000).toISOString();
 if(mode==='postgres'&&store.pool){
  const params=[cutoff];let scope='';
  if(!leadership){params.push(notificationIds(req.user));scope='and n.user_id=any($'+params.length+'::text[])';}
  let before='';if(cursor){params.push(cursor[0],cursor[1]);before='and (_notice_instant,notification_id::text)<($'+(params.length-1)+'::timestamptz,$'+params.length+'::text)';}
  const rows=await store.query(`with visible as (
   select n.notification_id,n.user_id,n.title,n.message,n.category,n.status,n.metadata,n.created_at,
    coalesce(u.full_name,'') as owner_name,coalesce(u.recruiter_code,'') as recruiter_code,
    coalesce(u.role,'') as owner_role,coalesce(u.designation,'') as owner_designation,
    ${noticeInstantSql('n.created_at')} as _notice_instant
   from public.notifications n left join public.users u on u.user_id=n.user_id
   where lower(coalesce(n.status,'')) not in ('archived','deleted') and lower(coalesce(n.category,''))<>'archived' ${scope}
  ) select *,to_char(_notice_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as _notice_iso from visible where _notice_instant >= $1::timestamptz ${before}
  order by _notice_instant desc,notification_id::text desc limit ${limit+1}`,params);
  return res.json({...pageOf(rows,limit),scope:leadership?'team':'self'});
 }
 const users=new Map((await table('users')).map(user=>[String(user.user_id),user]));
 let rows=latestNoticeRows((await table('notifications')).filter(item=>!['archived','deleted'].includes(String(item.status||'').toLowerCase())&&String(item.category||'').toLowerCase()!=='archived'&&visibleNotification(req.user,item)));
 if(cursor)rows=rows.filter(row=>Date.parse(row.created_at)<Date.parse(cursor[0])||(Date.parse(row.created_at)===Date.parse(cursor[0])&&String(row.notification_id)<cursor[1]));
 return res.json({...pageOf(rows.slice(0,limit+1).map(item=>withUserFields(item,users.get(String(item.user_id)))),limit),scope:leadership?'team':'self'});
}
async function markAllRead(req,res){
 if(mode==='postgres'&&store.pool)await store.query("update public.notifications set status='Read' where user_id=$1 and lower(coalesce(status,'')) not in ('read','archived','deleted')",[String(req.user.user_id)]);
 else for(const item of (await table('notifications')).filter(n=>String(n.user_id)===String(req.user.user_id)&&!['read','archived','deleted'].includes(String(n.status||'').toLowerCase())))await store.update('notifications','notification_id',item.notification_id,{status:'Read'});
 require('../lib/cache').clearAllCaches(['notice-inbox','mobile-work-items','approvals']);
 await require('../lib/store').afterCommit(()=>require('../lib/approvalLive').publishToUsers([req.user.user_id],'notification-read',{all:true,user_id:req.user.user_id}));
 return res.json({ok:true});
}
async function markRead(req,res){
 const existing=await store.findById('notifications','notification_id',req.params.notificationId);
 if(!existing||!visibleNotification(req.user,existing))return res.status(404).json({message:'Notification not found'});
 await store.update('notifications','notification_id',req.params.notificationId,{status:'Read'});
 require('../lib/cache').clearAllCaches(['notice-inbox','mobile-work-items','approvals']);return res.json({ok:true});
}
function compactInboxNotice(row){
 const raw=noticeMetadata(row),metadata=Object.fromEntries(['open_path','candidate_id','task_id','interview_date','count','report_id','employee_user_id','employee_name','approval_type','thread_key','review_id','note_id'].filter(key=>raw[key]!==undefined).map(key=>[key,String(raw[key]).slice(0,250)]));
 return {notification_id:String(row.notification_id||''),user_id:String(row.user_id||''),title:String(row.title||'Notification').slice(0,180),message:String(row.message||'').slice(0,1000),category:String(row.category||'general'),status:String(row.status||'Unread'),metadata:JSON.stringify(metadata),created_at:row._notice_iso||row.created_at||''};
}
async function notificationInboxForUser(user,force=false){
 const id=String(user?.user_id||'');if(!id)throw Object.assign(Error('Not authenticated'),{status:401});
 if(force)inboxCache.delete(id);
 return inboxCache.load(id,async()=>{
  let rows,count;
  if(store.pool){
   rows=await store.query(`with own_notices as (
    select notification_id,user_id,left(title,180) as title,left(message,1000) as message,category,status,
     case when length(coalesce(metadata::text,''))<=6000 then metadata::text else '{}' end as metadata,created_at,
     ${noticeInstantSql('created_at')} as _notice_instant
    from public.notifications where user_id=$1 and lower(coalesce(status,'unread')) not in ('read','archived','deleted') and lower(coalesce(category,'')) not in ('archived','dialer')
   ) select *,to_char(_notice_instant at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as _notice_iso,count(*) over()::int as unread_total from own_notices where _notice_instant >= $2::timestamptz order by _notice_instant desc,notification_id::text desc limit 50`,[id,new Date(Date.now()-7*86400000).toISOString()]);
   count=Number(rows[0]?.unread_total)||0;
  }else{rows=latestNoticeRows((await table('notifications')).filter(n=>String(n.user_id)===id&&!['read','archived','deleted'].includes(String(n.status||'unread').toLowerCase())&&!['archived','dialer'].includes(String(n.category||'').toLowerCase())));count=rows.length;rows=rows.slice(0,50);}
  const items=rows.map(compactInboxNotice),policy=await workNoticePolicyForUser(user),signature=crypto.createHash('sha256').update(JSON.stringify([policy,items,count])).digest('hex').slice(0,24);
  return {ok:true,items,unread_count:count,signature,poll_after_seconds:300,notice_push_supported:true,notice_policy:policy};
 });
}
async function ownInbox(req,res){
 const payload=await notificationInboxForUser(req.actorUser||req.user);res.setHeader('Cache-Control','private, no-store');
 if(String(req.query.signature||'')===payload.signature)return res.json({ok:true,unchanged:true,signature:payload.signature,unread_count:payload.unread_count,poll_after_seconds:300,notice_policy:payload.notice_policy});
 return res.json(payload);
}
module.exports={list,markAllRead,markRead,notificationInboxForUser,compactInboxNotice,ownInbox};

// CC120: original recipient rules; display duration and age cleanup only.
const NOTICE_DAYS=7,ACTIVITY_DAYS=5;
let noticePolicySnapshot={tl_enabled:true,manager_seconds:1,tl_seconds:1};
function normalizeNoticePolicy(settings={}){
 const seconds=(value)=>Math.max(.5,Math.min(30,Number(value)||1));
 return {tl_enabled:true,manager_seconds:seconds(settings.work_notice_manager_seconds),tl_seconds:seconds(settings.work_notice_tl_seconds)};
}
async function getNoticePolicy(){noticePolicySnapshot=normalizeNoticePolicy(await require('../lib/settings').getSettingsMap());return {...noticePolicySnapshot};}
function noticeRoleAllowed(user,policy=noticePolicySnapshot){const role=userRole(user||{});return Boolean(user?.user_id);}
async function noticeUser(user){if(user&&typeof user==='object'&&user.role)return user;const id=String(typeof user==='object'?user?.user_id||'':user||'');return (await require('../lib/collaborationAccess').roster()).find(row=>String(row.user_id)===id)||{};}
async function shouldReceiveWorkNotice(user){return noticeRoleAllowed(await noticeUser(user),await getNoticePolicy());}
async function workNoticePolicyForUser(user){const [person,policy]=await Promise.all([noticeUser(user),getNoticePolicy()]);return {...policy,enabled:noticeRoleAllowed(person,policy),role:userRole(person),seconds:userRole(person)==='tl'?policy.tl_seconds:policy.manager_seconds};}
async function getPolicy(req,res){res.setHeader('Cache-Control','private, no-store');return res.json({ok:true,notice_policy:await workNoticePolicyForUser(req.actorUser||req.user)});}
async function savePolicy(req,res){
 if(!isAdminOrManager(req.actorUser||req.user))return res.status(403).json({message:'Only a manager can change work notification settings.'});
 const body=req.body||{},patch={};
 if(Object.hasOwn(body,'tl_enabled')){if(typeof body.tl_enabled!=='boolean')return res.status(400).json({message:'Choose whether TL work notifications are enabled.'});patch.work_notice_tl_enabled=String(body.tl_enabled);}
 for(const key of ['manager_seconds','tl_seconds'])if(Object.hasOwn(body,key)){const value=Number(body[key]);if(!Number.isFinite(value)||value<.5||value>30)return res.status(400).json({message:'Choose a display time between 0.5 and 30 seconds.'});patch['work_notice_'+key]=String(value);}
 await require('../lib/settings').setSettingsMap(patch);const policy=await getNoticePolicy();
 require('../lib/cache').clearAllCaches(['notice-inbox','mobile-work-items']);
 await require('../lib/store').afterCommit(async()=>{const users=await require('../lib/collaborationAccess').roster();require('../lib/approvalLive').publishToUsers(users.map(u=>u.user_id),'notice-policy',{policy});require('./mobileDialerController').publishMobileNoticePolicy?.(users.map(u=>u.user_id),policy);});
 return res.json({ok:true,notice_policy:await workNoticePolicyForUser(req.actorUser||req.user)});
}
function noticeMetadata(row){try{return typeof row?.metadata==='string'?JSON.parse(row.metadata||'{}'):row?.metadata||{};}catch{return {};}}
function noticeSeriesKey(row){return String(row.user_id||'')+'|id|'+String(row.notification_id||'');}
function latestNoticeRows(rows,now=Date.now()){
 const seen=new Set();return [...(rows||[])].filter(row=>row?.notification_id&&Number.isFinite(Date.parse(row.created_at))&&Date.parse(row.created_at)>=now-NOTICE_DAYS*86400000).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||String(b.notification_id).localeCompare(String(a.notification_id))).filter(row=>{const id=String(row.notification_id);if(seen.has(id))return false;seen.add(id);return true;});
}
let retentionFlight=null,retentionStarted=false,lastRetentionAt=0;
const RETENTION_DATE_PATTERN='^(19|20|21)[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])[T ]([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,9})?(Z|[+-](0[0-9]|1[0-4])(:[0-5][0-9])?)?$';
function olderThan(value,cutoff){
 const text=String(value||'');if(!new RegExp(RETENTION_DATE_PATTERN).test(text))return false;
 const year=Number(text.slice(0,4)),month=Number(text.slice(5,7)),day=Number(text.slice(8,10)),calendar=new Date(Date.UTC(year,month-1,day));
 if(calendar.getUTCFullYear()!==year||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day)return false;
 let instant=text.replace(' ','T');if(!/(?:Z|[+-][0-9]{2}(?::[0-9]{2})?)$/.test(instant))instant+='Z';else if(/[+-][0-9]{2}$/.test(instant))instant+=':00';
 const stamp=Date.parse(instant);return Number.isFinite(stamp)&&stamp<cutoff;
}
function retentionDatePredicate(dataType){
 if(dataType==='timestamp with time zone')return 'created_at < $1::timestamptz';
 if(dataType==='timestamp without time zone')return "created_at < ($1::timestamptz at time zone 'UTC')";
 // Validate shape and calendar before any cast. Legacy UTC text (space/+00)
 // and offset-bearing ISO text are supported without deleting invalid dates.
 return "case when created_at::text ~ '"+RETENTION_DATE_PATTERN+"' then case when substring(created_at::text,9,2)::int <= extract(day from (make_date(substring(created_at::text,1,4)::int,substring(created_at::text,6,2)::int,1)+interval '1 month - 1 day')) then (case when created_at::text ~ '(Z|[+-][0-9]{2}(:[0-9]{2})?)$' then created_at::text::timestamptz else created_at::text::timestamp at time zone 'UTC' end) < $1::timestamptz else false end else false end";
}
async function runNoticeRetention(now=Date.now()){
 if(retentionFlight)return retentionFlight;
 if(lastRetentionAt&&now-lastRetentionAt<6*3600000)return {skipped:true};
 retentionFlight=(async()=>{
  if(!await require('../lib/multipleCrm').writeAllowed())return {skipped:true,reason:'Standby instance'};
  const result={notifications:0,activity_log:0},cutoffs={notifications:now-NOTICE_DAYS*86400000,activity_log:now-ACTIVITY_DAYS*86400000};
  if(!store.pool){for(const name of Object.keys(cutoffs)){if(!Array.isArray(store.state?.[name]))continue;const before=store.state[name];store.state[name]=before.filter(row=>name==='activity_log'&&String(row.action_type||'').toLowerCase()==='unmatched_call_fingerprint'||!olderThan(row.created_at,cutoffs[name]));result[name]=before.length-store.state[name].length;}if(result.notifications||result.activity_log)store.save();}
  else{
   const columns=await store.query("select table_name,data_type from information_schema.columns where table_schema='public' and table_name in ('notifications','activity_log') and column_name='created_at'");
   for(const name of Object.keys(cutoffs)){
    const column=columns.find(c=>c.table_name===name);if(!column)continue;
    const cutoff=new Date(cutoffs[name]).toISOString();
    // Text dates produced by this CRM are UTC ISO strings. Ambiguous/invalid
    // text is left alone; native timestamp columns use their native comparison.
    const datePredicate=retentionDatePredicate(column.data_type);
    const predicate='('+datePredicate+')'+(name==='activity_log'?" and lower(coalesce(action_type,'')) <> 'unmatched_call_fingerprint'":'');
    for(let batch=0;batch<8;batch++){
     const rows=await store.query('with expired as (select ctid from public.'+name+' where '+predicate+' limit 2000 for update skip locked), removed as (delete from public.'+name+' target using expired where target.ctid=expired.ctid returning 1) select count(*)::int as deleted from removed',[cutoff]);
     const count=Number(rows[0]?.deleted)||0;result[name]+=count;if(count<2000)break;
    }
   }
  }
  lastRetentionAt=now;if(result.notifications||result.activity_log)require('../lib/cache').clearAllCaches(['notice-inbox','mobile-work-items','approvals']);return result;
 })().finally(()=>{retentionFlight=null;});return retentionFlight;
}
function startNoticeRetention(){if(retentionStarted)return;retentionStarted=true;const schedule=delay=>{const timer=setTimeout(async()=>{try{await runNoticeRetention();}catch(error){console.error('Log cleanup will retry:',error.code||error.message);}schedule(6*3600000);},delay);timer.unref?.();};schedule(30000);}
Object.assign(module.exports,{getPolicy,savePolicy,getNoticePolicy,workNoticePolicyForUser,noticeRoleAllowed,shouldReceiveWorkNotice,noticeSeriesKey,latestNoticeRows,runNoticeRetention,startNoticeRetention,olderThan,retentionDatePredicate});
