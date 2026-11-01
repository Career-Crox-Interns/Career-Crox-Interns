const {store}=require('./store');
const policy=require('./sessionPolicy');
const {inactivityMs}=policy;
const leases=require('./cache').createTimedCache(1500,{tags:['auth','access']});
async function validCrmLease(actor){
 const auth=require('../middleware/auth');
 let active=await leases.load(actor.username,()=>store.pool?store.one('select session_token,last_seen_at,updated_at,login_at from public.active_sessions where username=$1',[actor.username]):store.findById('active_sessions','username',actor.username));
 const now=Date.now(),stamp=Date.parse(active?.last_seen_at||active?.updated_at||active?.login_at||'')||0;
 if(active?.session_token&&stamp&&!policy.expired(stamp,actor,now))return true;
 if(active?.session_token){const changed=await auth.clearActiveSession(actor.username,active.session_token,stamp);if(!changed){active=await store.findById('active_sessions','username',actor.username);if(active?.session_token&&!policy.expired(Date.parse(active.last_seen_at||active.updated_at)||0,actor,now))return true;}}
 if(stamp&&policy.expiryInfo(stamp,actor).night)await store.insert('activity_log',{activity_id:'NIGHT-'+require('crypto').randomUUID(),user_id:actor.user_id,username:actor.username,action_type:'user_logout',metadata:JSON.stringify({reason:'night_idle_logout'}),created_at:new Date().toISOString()});
 require('./recentHumanActivity').markInactive({...actor,session_token:active?.session_token||''},active?.session_token||'');
 await auth.revokeMobilePairingForExpiredCrmSession(actor,'crm_inactivity_session_expired');
 require('../controllers/mobileDialerController').invalidateMobileSessionForLogout(actor.user_id);
 return false;
}
module.exports={validCrmLease,invalidate:username=>leases.delete(username)};
