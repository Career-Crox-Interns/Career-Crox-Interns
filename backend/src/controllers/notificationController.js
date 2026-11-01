const { store, table, mode } = require('../lib/store');
const { isLeadership: isAccessLeadership, isAdminOrManager, userRole } = require('../lib/accessRules');
function visibleNotification(user,row){return isAdminOrManager(user)||notificationIds(user).includes(String(row.user_id));}
function notificationIds(user){return [...new Set([user.user_id,...(userRole(user)==='tl'?user.__ccTeamUserIds||[]:[])].map(String))];}

function isLeadership(user) {
  return isAccessLeadership(user);
}

function withUserFields(item, user) {
  return {
    ...item,
    owner_name: user?.full_name || '',
    recruiter_code: user?.recruiter_code || '',
    owner_role: user?.role || '',
    owner_designation: user?.designation || '',
  };
}

async function list(req, res) {
  if(req.query.inbox==='1')return ownInbox(req,res);
  const requested=Number(req.query.limit||200),limit=Number.isFinite(requested)&&requested>0?Math.min(200,Math.floor(requested)):200;
  const leadership = isAdminOrManager(req.user);

  if (mode === 'postgres' && store.pool) {
    const safeLimit = limit > 0 ? `limit ${Math.max(1, Math.min(200, limit))}` : '';
    const params = leadership ? [] : [notificationIds(req.user)];
    const whereClause = leadership
      ? `where lower(coalesce(n.status, '')) <> 'archived' and lower(coalesce(n.category, '')) <> 'archived'`
      : `where n.user_id = any($1::text[]) and lower(coalesce(n.status, '')) <> 'archived' and lower(coalesce(n.category, '')) <> 'archived'`;
    const items = await store.query(
      `select
        n.notification_id,n.user_id,n.title,n.message,n.category,n.status,n.metadata,n.created_at,
        coalesce(u.full_name, '') as owner_name,
        coalesce(u.recruiter_code, '') as recruiter_code,
        coalesce(u.role, '') as owner_role,
        coalesce(u.designation, '') as owner_designation
      from public.notifications n
      left join public.users u on u.user_id = n.user_id
      ${whereClause}
      order by n.created_at desc
      ${safeLimit}`,
      params,
    );
    return res.json({ items, scope: leadership ? 'team' : 'self' });
  }

  const users = await table('users');
  const userMap = new Map(users.map((user) => [String(user.user_id), user]));
  let items = (await table('notifications'))
    .filter((item) => String(item.status || '').toLowerCase() !== 'archived' && String(item.category || '').toLowerCase() !== 'archived')
    .filter((item) => visibleNotification(req.user,item))
    .map((item) => withUserFields(item, userMap.get(String(item.user_id))))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  if (limit > 0) items = items.slice(0, Math.max(1, Math.min(200, limit)));
  return res.json({ items, scope: leadership ? 'team' : 'self' });
}

async function markAllRead(req, res) {
  if (mode === 'postgres' && store.pool) {
    await store.query("update public.notifications set status = 'Read' where user_id = $1 and lower(coalesce(status, '')) not in ('read', 'archived')", [String(req.user.user_id)]);
    await require('../lib/store').afterCommit(()=>require('../lib/approvalLive').publishToUsers([req.user.user_id],'notification-read',{all:true,user_id:req.user.user_id}));
    return res.json({ ok: true });
  }
  for (const item of (await table('notifications')).filter((n) => String(n.user_id) === String(req.user.user_id))) {
    await store.update('notifications', 'notification_id', item.notification_id, { status: 'Read' });
  }
  return res.json({ ok: true });
}

async function markRead(req, res) {
  const existing = await store.findById('notifications', 'notification_id', req.params.notificationId);
  if (!existing) return res.status(404).json({ message: 'Notification not found' });
  if (!visibleNotification(req.user,existing)) {
    return res.status(404).json({ message: 'Notification not found' });
  }
  await store.update('notifications', 'notification_id', req.params.notificationId, { status: 'Read' });
  return res.json({ ok: true });
}

module.exports = { list, markAllRead, markRead };

// One bounded own-recipient snapshot is shared by CRM and mobile alert reads.
const inboxCache=require('../lib/cache').createTimedCache(300000,{maxEntries:128,tags:['notice-inbox']});
const crypto=require('node:crypto');
function compactInboxNotice(row){
 let raw=row.metadata||{};if(typeof raw==='string')try{raw=JSON.parse(raw);}catch{raw={};}
 const metadata=Object.fromEntries(['open_path','candidate_id','task_id','interview_date','count','report_id','employee_user_id','employee_name','approval_type','thread_key','review_id'].filter(k=>raw[k]!==undefined).map(k=>[k,String(raw[k]).slice(0,250)]));
 return {notification_id:String(row.notification_id||''),user_id:String(row.user_id||''),title:String(row.title||'Notification').slice(0,180),message:String(row.message||'').slice(0,1000),category:String(row.category||'general'),status:String(row.status||'Unread'),metadata:JSON.stringify(metadata),created_at:row.created_at||''};
}
async function notificationInboxForUser(user,force=false){
 const id=String(user?.user_id||'');if(!id)throw Object.assign(Error('Not authenticated'),{status:401});
 if(force)inboxCache.delete(id);
 return inboxCache.load(id,async()=>{
  let rows,count;
  if(store.pool){
   rows=await store.query("select notification_id,user_id,left(title,180) as title,left(message,1000) as message,category,status,case when length(coalesce(metadata::text,''))<=6000 then metadata::text else '{}' end as metadata,created_at,count(*) over()::int as unread_total from public.notifications where user_id=$1 and lower(coalesce(status,'unread')) not in ('read','archived','deleted') and lower(coalesce(category,'')) not in ('archived','dialer') order by created_at desc,notification_id desc limit 50",[id]);
   count=Number(rows[0]?.unread_total)||0;
  }else{rows=(await table('notifications')).filter(n=>String(n.user_id)===id&&!['read','archived','deleted'].includes(String(n.status||'unread').toLowerCase())&&!['archived','dialer'].includes(String(n.category||'').toLowerCase())).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||String(b.notification_id).localeCompare(String(a.notification_id)));count=rows.length;rows=rows.slice(0,50);}
  const items=rows.map(compactInboxNotice),signature=crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0,24);
  return {ok:true,items,unread_count:count,signature,poll_after_seconds:300,notice_push_supported:true};
 });
}
async function ownInbox(req,res){
 const payload=await notificationInboxForUser(req.actorUser||req.user);
 res.setHeader('Cache-Control','private, no-store');
 if(String(req.query.signature||'')===payload.signature)return res.json({ok:true,unchanged:true,signature:payload.signature,unread_count:payload.unread_count,poll_after_seconds:300});
 return res.json(payload);
}
module.exports.notificationInboxForUser=notificationInboxForUser;
module.exports.compactInboxNotice=compactInboxNotice;
module.exports.ownInbox=ownInbox;

