// One role-aware, one-shot inactivity lifecycle. Background reads/streams never renew it.
const {inactivityMs,inactivityMinutes}=require('./sessionPolicy');
const active=new Map(),streams=new Map(),revokedTokens=new Map();
const keyOf=user=>String(user?.username||'').trim().toLowerCase();
const revokedKey=user=>`${keyOf(user)}:${String(user?.session_token||'').trim()}`;
function markRevoked(user){const key=revokedKey(user);if(key.endsWith(':')||key===':')return;revokedTokens.set(key,Date.now());if(revokedTokens.size>1500){for(const [k,at]of revokedTokens)if(Date.now()-at>86400000)revokedTokens.delete(k);while(revokedTokens.size>1500)revokedTokens.delete(revokedTokens.keys().next().value);}}
function isKnownRevoked(user){const at=revokedTokens.get(revokedKey(user));return Boolean(at&&Date.now()-at<86400000);}
function closeStreams(user){const key=keyOf(user),set=streams.get(key),token=String(user?.session_token||'');if(!set)return;for(const res of [...set]){if(token&&res.__cc835SessionToken&&token!==res.__cc835SessionToken)continue;set.delete(res);try{res.end();}catch{}}if(!set.size)streams.delete(key);}
function registerStream(user,res){const key=keyOf(user);if(!key||!res)return()=>{};let set=streams.get(key);if(!set){set=new Set();streams.set(key,set);}res.__cc835SessionToken=String(user.session_token||'');set.add(res);const remove=()=>{set.delete(res);if(!set.size)streams.delete(key);};res.on?.('close',remove);return remove;}
function markInactive(user,token=''){const key=keyOf(user),old=active.get(key);if(!key||(old&&token&&old.token&&old.token!==token))return;if(old?.timer)clearTimeout(old.timer);active.delete(key);if(token||old?.token)markRevoked({username:key,session_token:token||old?.token});closeStreams({...user,session_token:token||old?.token||user.session_token});}
function arm(key,entry){if(entry.timer)clearTimeout(entry.timer);entry.timer=setTimeout(()=>{void expireOneSession(key,entry);},Math.max(600,inactivityMs(entry.user)-(Date.now()-entry.at)+600));entry.timer.unref?.();}
function markRecentHumanActivity(user={},activityAt=Date.now()){
 const key=keyOf(user),token=String(user.session_token||'').trim(),at=Math.min(Date.now(),Number(activityAt)||Date.now());if(!key||!token||isKnownRevoked(user))return;
 const old=active.get(key);if(old?.token===token&&old.at>=at&&inactivityMs(old.user)===inactivityMs(user))return;
 if(old?.timer)clearTimeout(old.timer);
 const entry={at,token,timer:null,user:{user_id:String(user.user_id||''),username:String(user.username||''),full_name:String(user.full_name||user.username||''),role:String(user.role||user.designation||''),designation:String(user.designation||user.role||''),session_token:token}};
 active.set(key,entry);arm(key,entry);
}
function hasRecentHumanActivity(windowMs=600000){for(const row of active.values())if(Date.now()-row.at<Math.min(windowMs,inactivityMs(row.user)))return true;return false;}
function isRecentlyActive(user,windowMs=inactivityMs(user)){const row=active.get(keyOf(user));return Boolean(row&&(!user?.session_token||row.token===String(user.session_token))&&Date.now()-row.at<Math.min(windowMs,inactivityMs(user)));}
async function expireOneSession(key,entry){
 if(active.get(key)!==entry)return;if(Date.now()-entry.at<inactivityMs(entry.user)){arm(key,entry);return;}
 try{
  const {store}=require('./store'),cutoff=Date.now()-inactivityMs(entry.user),stamp=new Date().toISOString();let changed;
  if(store.pool){changed=await store.query(`update public.active_sessions set session_token='',status='Logged Out',revoked_at=$3,logout_at=$5,updated_at=$6 where username=$1 and session_token=$2 and coalesce(nullif(to_jsonb(active_sessions)->>'last_seen_at',''),nullif(to_jsonb(active_sessions)->>'updated_at',''),to_jsonb(active_sessions)->>'login_at','') <= $4 returning username`,[entry.user.username,entry.token,stamp,new Date(cutoff).toISOString(),stamp,stamp]);}
  else{const row=await store.findById('active_sessions','username',entry.user.username);changed=[];if(row?.session_token===entry.token&&(Date.parse(row.last_seen_at||row.updated_at||row.login_at||'')||0)<=cutoff){await store.update('active_sessions','username',entry.user.username,{session_token:'',status:'Logged Out',revoked_at:stamp,logout_at:stamp,updated_at:stamp});changed=[{username:row.username}];}}
  if(!changed?.length){
   // Another tab/process may have saved activity while this old timer was waiting.
   const row=await store.findById('active_sessions','username',entry.user.username),at=Date.parse(row?.last_seen_at||row?.updated_at||row?.login_at||'')||0;
   if(active.get(key)!==entry)return;
   if(row?.session_token===entry.token&&at>cutoff){entry.at=at;arm(key,entry);return;}
   active.delete(key);markRevoked(entry.user);closeStreams(entry.user);return;
  }
  if(active.get(key)!==entry)return;active.delete(key);markRevoked(entry.user);closeStreams(entry.user);
  if(!['manager','admin'].includes(entry.user.role.toLowerCase()))await require('./unlockService').lockPresenceForInactivity(entry.user,`${inactivityMinutes(entry.user)} minutes without CRM use. Sign in and request unlock approval.`,{lockReason:'session_inactivity',source:'server_idle',notifyExisting:false}).catch(()=>{});
  await require('../middleware/auth').revokeMobilePairingForExpiredCrmSession(entry.user,'crm_inactivity_session_expired');
  try{require('../controllers/mobileDialerController').invalidateMobileSessionForLogout();}catch{}
 }catch(error){if(active.get(key)===entry){active.delete(key);closeStreams(entry.user);}console.warn('Idle cleanup deferred to the next authenticated request:',error?.message||String(error));}
}
module.exports={markRecentHumanActivity,hasRecentHumanActivity,isRecentlyActive,markInactive,registerStream,closeStreams,isKnownRevoked,markRevoked};
