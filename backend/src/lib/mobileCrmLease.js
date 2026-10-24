const {store}=require('./store');
const {inactivityMs}=require('./sessionPolicy');
const leases=require('./cache').createTimedCache(1500,{tags:['auth','access']});
async function validCrmLease(actor){
 const auth=require('../middleware/auth');
 let active=await leases.load(actor.username,()=>store.pool?store.one('select session_token,last_seen_at,updated_at,login_at from public.active_sessions where username=$1',[actor.username]):store.findById('active_sessions','username',actor.username));
 const now=Date.now(),stamp=Date.parse(active?.last_seen_at||active?.updated_at||active?.login_at||'')||0;
 if(active?.session_token&&stamp&&now-stamp<inactivityMs(actor))return true;
 if(active?.session_token){const changed=await auth.clearActiveSession(actor.username,active.session_token,now-inactivityMs(actor));if(!changed){active=await store.findById('active_sessions','username',actor.username);if(active?.session_token&&now-(Date.parse(active.last_seen_at||active.updated_at)||0)<inactivityMs(actor))return true;}}
 await auth.revokeMobilePairingForExpiredCrmSession(actor,'crm_inactivity_session_expired');
 require('../controllers/mobileDialerController').invalidateMobileSessionForLogout(actor.user_id);
 return false;
}
module.exports={validCrmLease,invalidate:username=>leases.delete(username)};
