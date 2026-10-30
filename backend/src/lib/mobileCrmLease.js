const {store}=require('./store');
const policy=require('./sessionPolicy');
const leases=require('./cache').createTimedCache(1500,{tags:['auth','access']});
const rechecks=new Map(),renewals=new Map(),expiries=new Map();
const stampOf=row=>Date.parse(row?.last_seen_at||row?.updated_at||row?.login_at||'')||0;
const usable=(row,actor)=>Boolean(row?.session_token&&stampOf(row)&&!policy.expired(stampOf(row),actor,Date.now()));
const read=username=>store.pool?store.one('select session_token,last_seen_at,updated_at,login_at from public.active_sessions where username=$1',[username]):store.findById('active_sessions','username',username);
function once(map,key,work){if(map.has(key))return map.get(key);const pending=Promise.resolve().then(work).finally(()=>{if(map.get(key)===pending)map.delete(key);});map.set(key,pending);return pending;}
async function fresh(username){leases.delete(username);return once(rechecks,username,()=>read(username));}
async function acceptActive(actor,active,req){
 const at=req?policy.activityAt(req,Date.now()):0;
 // Only a recent native foreground touch renews an already-valid session.
 if(!at||at<=stampOf(active)||Date.now()-stampOf(active)<180000)return true;
 return once(renewals,actor.username,async()=>{
  const current=await fresh(actor.username);if(!usable(current,actor))return false;
  if(at<=stampOf(current)||Date.now()-stampOf(current)<180000)return true;
  const stamp=new Date(at).toISOString();
  const updated=await require('../middleware/auth').touchActiveSession(actor.username,{last_seen_at:stamp,updated_at:stamp},current.session_token);
  leases.delete(actor.username);
  return updated||usable(await read(actor.username),actor);
 });
}
async function expire(actor){
 const auth=require('../middleware/auth');let active=await fresh(actor.username);
 if(usable(active,actor))return true;
 const stamp=stampOf(active);let cleared=false;
 if(active?.session_token){
  cleared=await auth.clearActiveSession(actor.username,active.session_token,stamp);
  if(!cleared){
   active=await fresh(actor.username);if(usable(active,actor))return true;
   // Never revoke a newer session using an obsolete cached snapshot.
   if(active?.session_token)return false;
  }
 }
 if(cleared&&stamp&&policy.expiryInfo(stamp,actor).night)await store.insert('activity_log',{activity_id:'NIGHT-'+require('crypto').randomUUID(),user_id:actor.user_id,username:actor.username,action_type:'user_logout',metadata:JSON.stringify({reason:'night_idle_logout'}),created_at:new Date().toISOString()});
 require('./recentHumanActivity').markInactive({...actor,session_token:active?.session_token||''},active?.session_token||'');
 await auth.revokeMobilePairingForExpiredCrmSession(actor,'crm_inactivity_session_expired');
 require('../controllers/mobileDialerController').invalidateMobileSessionForLogout(actor.user_id);
 return false;
}
async function validCrmLease(actor,req=null){
 if(!actor?.username)return false;
 let active=await leases.load(actor.username,()=>read(actor.username));
 if(!usable(active,actor))active=await fresh(actor.username);
 if(usable(active,actor))return acceptActive(actor,active,req);
 return once(expiries,actor.username,()=>expire(actor));
}
module.exports={validCrmLease,invalidate:username=>leases.delete(username)};
