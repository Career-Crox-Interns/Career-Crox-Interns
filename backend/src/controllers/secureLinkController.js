// Career Crox SecureLink: authenticated, consent-first, in-memory WebRTC signaling.
// No candidate data, Supabase changes or screen bytes pass through this service.
const crypto = require('crypto');
const { table, store } = require('../lib/store');
const sessions = new Map();
const attempts = new Map();
const invitations = new Map();
// CC26_605: one authenticated, in-memory push per active browser; zero Supabase reads.
// No polling, no timer or database query is needed to deliver an invitation.
const listeners = new Map();
function pushTo(userId, kind, detail={}) {
  const targets=listeners.get(String(userId)); if(!targets)return 0;
  let delivered=0;
  const data=JSON.stringify({kind,...detail});
  for(const response of [...targets]) {
    if(response.destroyed || response.writableEnded){targets.delete(response);continue;}
    try{response.write('data: '+data+'\n\n');delivered++;}catch(_){targets.delete(response);}
  }
  if(!targets.size)listeners.delete(String(userId));
  return delivered;
}
function events(req,res){
  const me=idOf(req);if(!me)return res.status(401).end();
  res.set({'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.flushHeaders?.();res.write(': connected\n\n');
  let set=listeners.get(me);if(!set){set=new Set();listeners.set(me,set);}
  // One EventSource per tab; bound active connections per user to avoid abandoned listeners.
  if(set.size>=5){const oldest=set.values().next().value;set.delete(oldest);oldest.end();}
  set.add(res);
  const cleanup=()=>{set.delete(res);if(!set.size)listeners.delete(me);};
  res.on('close',cleanup);req.on('aborted',cleanup);
  // Client closes on inactivity/logout. This is only a transport keepalive, not a DB poll.
  const keepalive=setInterval(()=>{if(res.destroyed||res.writableEnded){clearInterval(keepalive);cleanup();return;}try{res.write(': ping\n\n');}catch(_){clearInterval(keepalive);cleanup();}},45000);
  res.on('close',()=>clearInterval(keepalive));
}

const notify = (s) => {s.revision=(s.revision||0)+1;for(const wake of s.waiters||[])wake();s.waiters?.clear();};
// The browser checks less frequently after a direct peer connection is live.
// This is a presence grace period, NOT a permission bypass or session extension.
const WAIT_MS = 180_000, CODE_MS = 5 * 60_000, MAX_MS = 90 * 60_000;
const idOf = (req) => String(req.user?.user_id || req.user?.username || '');
const randomCode = () => String(crypto.randomInt(1000, 10000)); // Short reference only; never grants access without employee consent.
const manager = req => ['manager','admin'].includes(String(req.user?.role||'').toLowerCase());
const clean = () => {
  const now = Date.now();
  for (const [code, session] of sessions) if (now > session.expires || (now - session.ownerAt > CODE_MS && !session.helper)) {sessions.delete(code);notify(session);}
  for (const [ref, invite] of invitations) if (now > invite.expires || (invite.state === 'declined' && now - invite.updatedAt > 30000)) invitations.delete(ref);
  for (const [id, row] of attempts) if (now - row.time > 60_000) attempts.delete(id);
};
const csrf = (req,res,next) => {
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}` && origin !== `https://${req.get('host')}`) return res.status(403).json({message:'Invalid request origin'});
  return next();
};
const guard = (req,res,next) => {
  res.set('Cache-Control','no-store');
  if (req.authDegraded) return res.status(401).json({message:'Sign in again to start a secure support session.'});
  return next();
};
function open(req,res){
  clean();
  const owner=idOf(req);
  for(const [code,s] of sessions) if(s.owner===owner){sessions.delete(code);notify(s);}
  if (sessions.size >= 300) return res.status(503).json({message:'Support capacity reached. Try later.'});
  let code=randomCode(); while(sessions.has(code)) code=randomCode();
  sessions.set(code,{code,owner,ownerName:String(req.user?.username||'Team member').slice(0,70),ownerAt:Date.now(),helperAt:0,helper:null,helperName:'',approved:false,requestMode:'view',expires:Date.now()+CODE_MS,messages:[],serial:0,revision:1,waiters:new Set()});
  return res.json({ok:true,code,validForSeconds:300});
}
function join(req,res){
  clean(); const me=idOf(req);
  const row=attempts.get(me)||{time:Date.now(),count:0}; if(Date.now()-row.time>60_000){row.time=Date.now();row.count=0;} row.count++; attempts.set(me,row);
  if(row.count>3) return res.status(429).json({message:'Too many attempts. Wait one minute.'});
  const code=String(req.body?.code||''); if(!/^(?:\d{4}|[a-f0-9]{32})$/i.test(code)) return res.status(400).json({message:'Enter the four-digit code shown by your colleague.'});
  const s=sessions.get(code); if(!s || s.expires<Date.now()) return res.status(404).json({message:'Code expired or incorrect. Generate a fresh code.'});
  const accessMode=String(req.body?.access_mode||'').toLowerCase()==='assist'?'assist':'view';
  if(s.owner===me) return res.status(400).json({message:'Use another team member’s code, not your own.'});
  if(s.helper && s.helper!==me) return res.status(409).json({message:'Someone else is already connected.'});
  s.helper=me; s.helperName=String(req.user?.username||'Team member').slice(0,70); s.helperAt=Date.now(); s.requestMode=accessMode; s.expires=Math.min(Date.now()+MAX_MS,Date.now()+MAX_MS);
  notify(s);pushTo(s.owner,'code-request',{requester:s.helperName,access_mode:s.requestMode});return res.json({ok:true,code,role:'helper',approved:false,request_mode:s.requestMode});
}
async function current(req,res){
  clean(); const me=idOf(req),code=String(req.query.code||''); const s=sessions.get(code);
  if(!s || (s.owner!==me && s.helper!==me)) return res.status(404).json({message:'Support session ended.'});
  if(s.owner===me) s.ownerAt=Date.now(); else s.helperAt=Date.now();
  if(s.helper && Date.now()-s.helperAt>WAIT_MS) {s.helper=null;s.helperName='';s.approved=false;s.messages=[];s.serial=0;notify(s);}
  const since=Math.max(0,Number(req.query.since)||0);
  // Setup: long-poll for consent/ICE; live media: browser checks ~once per 82s.
  // Only small in-memory signaling metadata leaves this endpoint, never screen pixels.
  const fromRevision=Number(req.query.revision)||0;
  const unread=()=>s.approved && s.messages.some(m=>m.id>since&&m.to===me);
  if(fromRevision>=s.revision && !unread()){
    await new Promise(resolve=>{
      let done=false, timer;
      const finish=()=>{if(done)return;done=true;clearTimeout(timer);s.waiters.delete(finish);resolve();};
      s.waiters.add(finish);timer=setTimeout(finish,17000);
      if (typeof res.on === 'function') res.on('close',finish); else req.on('aborted',finish);
    });
  }
  if(!sessions.has(code))return res.status(404).json({message:'Support session ended.'});
  const messages=s.approved ? s.messages.filter(m=>m.id>since && m.to===me) : [];
  return res.json({ok:true,code,role:s.owner===me?'owner':'helper',revision:s.revision,approved:s.approved,partner:s.owner===me?s.helperName:s.ownerName,hasPartner:Boolean(s.helper),request_mode:s.requestMode||'view',expires:s.expires,messages});
}
function approve(req,res){const s=sessions.get(String(req.body?.code||''));if(!s||s.owner!==idOf(req))return res.status(404).json({message:'No session'});if(!s.helper)return res.status(409).json({message:'Nobody has requested help yet.'});s.approved=true;s.expires=Date.now()+MAX_MS;notify(s);return res.json({ok:true});}
function signal(req,res){
 const s=sessions.get(String(req.body?.code||'')); const me=idOf(req);
 if(!s||!s.approved || (me!==s.owner&&me!==s.helper))return res.status(403).json({message:'Approval needed'});
 const kind=String(req.body?.type||''), payload=req.body?.payload;
 if(!['offer','answer','ice','stop'].includes(kind)|| typeof payload!=='object'||!payload||JSON.stringify(payload).length>15000) return res.status(400).json({message:'Invalid signaling message'});
 const to=me===s.owner?s.helper:s.owner;if(!to)return res.status(409).json({message:'Partner disconnected'});
 s.serial++;s.messages.push({id:s.serial,to,type:kind,payload});if(s.messages.length>120)s.messages.splice(0,s.messages.length-120);
 if(kind==='stop'){s.approved=false;s.messages=[];s.serial=0;}notify(s);
 return res.json({ok:true});
}
function close(req,res){const code=String(req.body?.code||'');const s=sessions.get(code);if(s&&(s.owner===idOf(req)||s.helper===idOf(req))){sessions.delete(code);notify(s);}return res.json({ok:true});}

// Authenticated internal directory: manager can select a colleague by name without entering a code.
// Selection is an invitation, NOT permission to see or control their computer.
// Fetch only the directory columns, never resumes, passwords, candidate data, or call logs.
// Reuse the result for 90 seconds across manager requests (in-memory; no extra storage).
let directoryCache = { rows: null, until: 0, loading: null };
async function readDirectoryRows() {
  if (directoryCache.rows && directoryCache.until > Date.now()) return directoryCache.rows;
  if (directoryCache.loading) return directoryCache.loading;
  directoryCache.loading = (async () => {
    let rows;
    if (store?.pool && typeof store?.query === 'function') {
      // Small, password-free projection. Some older users schemas have no is_active column.
      // Retry only on PostgreSQL undefined_column (42703), never download a whole table as fallback.
      try {
        rows = await store.query('select user_id, username, full_name, role, is_active from public.users order by full_name asc limit 250', []);
      } catch (error) {
        if (String(error?.code||'') !== '42703') throw error;
        rows = await store.query('select user_id, username, full_name, role from public.users order by full_name asc limit 250', []);
      }
    } else {
      // Local JSON demo store only; production PostgreSQL never takes this path.
      rows = (await table('users')).slice(0,250);
    }
    if (!Array.isArray(rows)) throw new Error('Employee directory is temporarily unavailable.');
    directoryCache.rows = rows;
    directoryCache.until = Date.now() + 10 * 60_000; // low-egress shared employee directory cache
    return rows;
  })();
  try { return await directoryCache.loading; }
  finally { directoryCache.loading = null; }
}
const publicId = user => String(user?.user_id || user?.id || user?.username || '').trim();
const enabled = user => !['0','false','no','inactive','deleted','disabled'].includes(String(user?.is_active ?? '1').trim().toLowerCase());
async function directory(req,res){
  if(!manager(req))return res.status(403).json({message:'Manager access required. You may connect with a four-digit support code instead.'});
  // Never put the private staff list in the browser cache. The server-side 90s cache is shared.
  res.set('Cache-Control','no-store');
  try {
    const me=idOf(req), currentUsername=String(req.user?.username||'').trim().toLowerCase();
    const users=await readDirectoryRows();
    const unique=new Map();
    for (const u of users) {
      const id=publicId(u), username=String(u.username||'').trim();
      if (!id || !enabled(u) || (me && id===me) || (username && username.toLowerCase()===currentUsername)) continue;
      const role=String(u.role||'').trim().toLowerCase();
      if (['bot','system','assistant'].includes(role) || username.toLowerCase()==='aria') continue;
      const name=String(u.full_name||u.name||username||id).trim().slice(0,90);
      if (!name) continue;
      unique.set(id,{user_id:id,name,username:username.slice(0,80),role:role.slice(0,35)});
    }
    const people=[...unique.values()].sort((a,b)=>a.name.localeCompare(b.name)).slice(0,250);
    return res.json({ok:true,people,empty_reason:people.length?'':'No active employees are available in the CRM user directory. You can still connect using a four-digit support reference.'});
  } catch (error) {
    return res.status(503).json({message:'Employee directory is temporarily unavailable. Use the four-digit support code instead.'});
  }
}
async function invite(req,res){
  if(!manager(req))return res.status(403).json({message:'Manager access required.'});
  clean(); const me=idOf(req),targetId=String(req.body?.employee_id||'').trim();
  const accessMode=String(req.body?.access_mode||'').toLowerCase()==='assist'?'assist':'view';
  if(!targetId || targetId===me)return res.status(400).json({message:'Choose another team member.'});
  // Reuse the same tiny, server-cached directory projection; do not re-download all user columns (including password hashes).
  const users=await readDirectoryRows();
  const target=users.find(u=>publicId(u)===targetId && enabled(u) && !['bot','system','assistant'].includes(String(u.role||'').trim().toLowerCase()) && String(u.username||'').trim().toLowerCase()!=='aria');
  if(!target)return res.status(404).json({message:'Employee not available.'});
  // Only pending invitations are reusable. An accepted invitation has already
  // become a consent-scoped session and must never silently change access mode.
  const existing=[...invitations.values()].find(x=>x.manager===me && x.employee===targetId && x.expires>Date.now() && x.state==='pending');
  if(existing){
    // Manager may switch view/full assist before the employee accepts. Update
    // the pending invitation AND push again; never report a fresh full-access
    // request while silently reusing an old view-only invitation.
    existing.accessMode=accessMode;
    existing.updatedAt=Date.now();
    existing.expires=Date.now()+5*60_000;
    const deliveryLive=pushTo(targetId,'invite',{request_id:existing.id,requester:existing.managerName,access_mode:accessMode});
    return res.json({ok:true,request_id:existing.id,employee:existing.employeeName,state:'pending',access_mode:accessMode,delivery_live:deliveryLive>0});
  }
  if(invitations.size>=150)return res.status(429).json({message:'Too many active requests. Please try later.'});
  const now=Date.now(),id=crypto.randomBytes(12).toString('hex');
  invitations.set(id,{id,manager:me,managerName:String(req.user?.full_name||req.user?.username||'Manager').slice(0,90),employee:targetId,employeeName:String(target.full_name||target.username||'Employee').slice(0,90),accessMode,state:'pending',createdAt:now,updatedAt:now,expires:now+5*60_000,code:''});
  const deliveryLive=pushTo(targetId,'invite',{request_id:id,requester:String(req.user?.full_name||req.user?.username||'Manager').slice(0,90),access_mode:accessMode});
  return res.json({ok:true,request_id:id,employee:String(target.full_name||target.username||'Employee'),state:'pending',access_mode:accessMode,delivery_live:deliveryLive>0});
}
function inbox(req,res){
  clean();const me=idOf(req);
  const invites=[...invitations.values()].filter(x=>x.employee===me && x.state==='pending' && x.expires>Date.now())
    .map(x=>({request_id:x.id,requester:x.managerName,expires:x.expires,access_mode:x.accessMode||'view'}));
  return res.json({ok:true,requests:invites});
}
function acceptInvite(req,res){
  clean(); const ref=String(req.body?.request_id||''),v=invitations.get(ref),me=idOf(req);
  if(!v || v.employee!==me || v.state!=='pending' || v.expires<Date.now())return res.status(404).json({message:'Request no longer available.'});
  const expectedMode=String(req.body?.request_mode||'view').toLowerCase()==='assist'?'assist':'view';
  if(expectedMode!==(v.accessMode||'view'))return res.status(409).json({message:'Access type changed. Review the updated request before sharing your screen.'});
  if(sessions.size>=300)return res.status(503).json({message:'Support capacity reached.'});
  // Internal secret is never typed or displayed and is only returned to the two named CRM accounts.
  const code=crypto.randomBytes(16).toString('hex');const now=Date.now();
  sessions.set(code,{code,owner:me,ownerName:String(req.user?.full_name||req.user?.username||'Employee').slice(0,90),ownerAt:now,helper:v.manager,helperName:v.managerName,helperAt:now,approved:false,requestMode:v.accessMode||'view',expires:now+CODE_MS,messages:[],serial:0,revision:1,waiters:new Set()});
  v.code=code;v.state='accepted';v.updatedAt=now;pushTo(v.manager,'invite-accepted',{request_id:ref});
  return res.json({ok:true,session:code,requester:v.managerName,access_mode:v.accessMode||'view'});
}
function declineInvite(req,res){
  const v=invitations.get(String(req.body?.request_id||''));if(!v || v.employee!==idOf(req))return res.status(404).json({message:'Request not found.'});
  v.state='declined';v.updatedAt=Date.now();pushTo(v.manager,'invite-declined',{request_id:v.id});return res.json({ok:true});
}
function inviteStatus(req,res){
  clean();const v=invitations.get(String(req.query?.request_id||''));
  if(!v || v.manager!==idOf(req))return res.status(404).json({message:'Support invitation ended.'});
  return res.json({ok:true,state:v.state,session:v.state==='accepted'?v.code:undefined,employee:v.employeeName});
}

module.exports={open,join,current,approve,signal,close,csrf,guard,directory,invite,inbox,acceptInvite,declineInvite,inviteStatus,events};
