const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { store, table } = require('../lib/store');
const { nowIso, isActiveAccount } = require('../lib/helpers');
const { COOKIE_SECURE, JWT_SECRET } = require('../config/env');
const { verifyActionToken } = require('../lib/security');
const { lockPresenceForInactivity } = require('../lib/unlockService');

const activeSessionCache=require('../lib/cache').createTimedCache(1500,{tags:['auth','access']});
const DEVICE_COOKIE_NAME = 'career_crox_device_id';
const policy=require('../lib/sessionPolicy');
const {inactivityMs,inactivityMinutes,activityAt}=policy;
const KOLKATA_OFFSET_MS = 330 * 60 * 1000;
const DAILY_LOGOUT_HOUR = 21;

function authCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  };
}

function deviceCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 365,
  };
}

function lowerText(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalRole(value, fallback = '') {
  const raw = lowerText(value || fallback);
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function makeSessionToken() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(24).toString('hex');
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((item) => item.trim()).filter(Boolean)[0];
  return forwarded || req.ip || req.socket?.remoteAddress || '';
}

function readDeviceId(req) {
  return String(req?.cookies?.[DEVICE_COOKIE_NAME] || '').trim();
}

function ensureDeviceId(req, res, preferred = '') {
  const current = readDeviceId(req);
  if (current) return current;
  const nextValue = String(preferred || makeSessionToken()).trim();
  if (res?.cookie && nextValue) {
    try { res.cookie(DEVICE_COOKIE_NAME, nextValue, deviceCookie()); } catch {}
  }
  if (!req.cookies) req.cookies = {};
  if (nextValue) req.cookies[DEVICE_COOKIE_NAME] = nextValue;
  return nextValue;
}

function requestUserAgent(req) {
  return String(req.get?.('user-agent') || req.headers['user-agent'] || '').trim();
}

function withLegacySessionShape(row = {}) {
  const copy = { ...row };
  delete copy.device_id;
  delete copy.last_seen_at;
  delete copy.login_at;
  return copy;
}

async function upsertActiveSessionCompat(username, row) {
  const existing = await store.findById('active_sessions', 'username', username);
  try {
    if (existing) await store.update('active_sessions', 'username', username, row);
    else await store.insert('active_sessions', row);
    return true;
  } catch (error) {
    const legacyRow = withLegacySessionShape(row);
    if (existing) await store.update('active_sessions', 'username', username, legacyRow);
    else await store.insert('active_sessions', legacyRow);
    return false;
  }
}

async function updateActiveSessionCompat(username, updates, sessionToken='') {
  activeSessionCache.delete(username);require('../lib/mobileCrmLease').invalidate(username);
  if(store.pool&&sessionToken){const fields=Object.keys(updates),values=fields.map(k=>updates[k]);values.push(username,sessionToken);const rows=await store.query(`update public.active_sessions set ${fields.map((k,i)=>'"'+k+'"=$'+(i+1)).join(',')} where username=$${values.length-1} and session_token=$${values.length} returning username`,values);return Boolean(rows.length);}
  const row=await store.findById('active_sessions','username',username);if(!row||(sessionToken&&row.session_token!==sessionToken))return false;
  try{await store.update('active_sessions','username',username,updates);}catch(error){await store.update('active_sessions','username',username,withLegacySessionShape(updates));}return true;
}

function isBackgroundRequest(req) {
  const headerValue = String(req.get?.('x-career-crox-background') || req.headers?.['x-career-crox-background'] || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'background'].includes(headerValue);
}

function shouldTouchSession(active, req) {
  if (isBackgroundRequest(req)) return false;
  if (!activityAt(req)) return false;
  const stamp = Date.parse(String(active?.last_seen_at || active?.updated_at || ''));
  if (!stamp) return true;
  return (Date.now() - stamp) > (1000 * 60 * 3);
}

function latestKolkataDailyCutoffMs(nowMs = Date.now()) {
  const shifted = new Date(nowMs + KOLKATA_OFFSET_MS);
  const cutoffTodayUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    DAILY_LOGOUT_HOUR,
    0,
    0,
    0,
  ) - KOLKATA_OFFSET_MS;
  if (nowMs < cutoffTodayUtc) return cutoffTodayUtc - (24 * 60 * 60 * 1000);
  return cutoffTodayUtc;
}

async function revokeMobilePairingForExpiredCrmSession(user = {}, reason = 'crm_inactivity_session_expired') {
  const userId = String(user?.user_id || '').trim();
  const username = String(user?.username || '').trim();
  if (!userId && !username) return;
  const stamp = nowIso();
  try {
    if (store.pool && typeof store.query === 'function') {
      await store.query(`update public.mobile_devices
        set status='Logged Out', device_token='', pairing_code='', logout_reason=$3, revoked_at=$4, last_seen_at=$4, updated_at=$4
        where (($1 <> '' and user_id=$1) or ($2 <> '' and lower(coalesce(username,''))=lower($2)))
          and (coalesce(device_token,'') <> '' or lower(coalesce(status,'')) in ('active','paired','pending'))`, [userId, username, reason, stamp]);
      await store.query(`update public.dialer_sessions
        set status='Stopped', mobile_command='stop', command_type='stop', live_status=$3, stopped_at=$4, updated_at=$4
        where (($1 <> '' and (assigned_user_id=$1 or owner_user_id=$1)) or ($2 <> '' and (lower(coalesce(assigned_username,''))=lower($2) or lower(coalesce(owner_username,''))=lower($2))))
          and lower(coalesce(status,'')) not in ('stopped','cancelled','completed','deleted')`, [userId, username, 'Stopped because CRM inactivity session expired', stamp]);
    } else {
      const devices = await table('mobile_devices');
      for (const row of devices) {
        const same = (userId && String(row.user_id || '') === userId) || (username && lowerText(row.username) === lowerText(username));
        if (same && (String(row.device_token || '').trim() || ['active','paired','pending'].includes(lowerText(row.status)))) {
          await store.update('mobile_devices','device_id',row.device_id,{status:'Logged Out',device_token:'',pairing_code:'',logout_reason:reason,revoked_at:stamp,last_seen_at:stamp,updated_at:stamp});
        }
      }
      const sessions = await table('dialer_sessions');
      for (const row of sessions) {
        const same = [row.assigned_user_id,row.owner_user_id].map(String).includes(userId) || [row.assigned_username,row.owner_username].some((v)=>username && lowerText(v)===lowerText(username));
        if (!same || ['stopped','cancelled','completed','deleted'].includes(lowerText(row.status))) continue;
        await store.update('dialer_sessions','session_id',row.session_id,{status:'Stopped',mobile_command:'stop',command_type:'stop',live_status:'Stopped because CRM inactivity session expired',stopped_at:stamp,updated_at:stamp});
      }
    }
  } catch(error) { throw error; }
}

function getActiveSessionExpiry(active,user={}) {
  if (!active) return null;
  const lastSeenAt = Date.parse(String(active.last_seen_at || active.updated_at || active.login_at || ''));
  if (policy.expired(lastSeenAt,user)) {
    return { message: `Logged out after ${policy.expiryInfo(lastSeenAt,user).night?10:inactivityMinutes(user)} minutes of inactivity.`,lastActivityAt:lastSeenAt,night:policy.expiryInfo(lastSeenAt,user).night };
  }
  return null;
}


function sameBrowserSession(active, req) {
  if (!active) return false;
  const activeDeviceId = String(active.device_id || '').trim();
  const requestDeviceId = readDeviceId(req);
  if (activeDeviceId && requestDeviceId && activeDeviceId === requestDeviceId) return true;
  const activeIp = String(active.ip_address || '').trim();
  const requestIp = String(clientIp(req) || '').trim();
  const activeUa = String(active.user_agent || '').trim();
  const requestUa = requestUserAgent(req);
  const ipMatches = activeIp && requestIp && activeIp === requestIp;
  const uaMatches = activeUa && requestUa && activeUa === requestUa;
  return uaMatches || (ipMatches && uaMatches);
}

async function registerActiveSession(user, req, explicitSessionToken = '', options = {}) {
  const sessionToken = explicitSessionToken || makeSessionToken();
  const deviceId = ensureDeviceId(req, options.res || null, options.preferredDeviceId || '');
  const row = {
    username: user.username,
    session_token: sessionToken,
    ip_address: clientIp(req),
    user_agent: requestUserAgent(req),
    device_id: deviceId,
    updated_at: nowIso(),
    last_seen_at: nowIso(),
    login_at: nowIso(),
  };
  activeSessionCache.delete(user.username);require('../lib/mobileCrmLease').invalidate(user.username);
  await upsertActiveSessionCompat(user.username, row);
  activeSessionCache.delete(user.username);require('../lib/mobileCrmLease').invalidate(user.username);
  return sessionToken;
}

async function clearActiveSession(username, sessionToken = '', cutoffMs = 0) {
  activeSessionCache.delete(username);require('../lib/mobileCrmLease').invalidate(username);
  const stamp=nowIso();
  if(store.pool){const result=await store.query(`update public.active_sessions set session_token='',status='Logged Out',revoked_at=$3,logout_at=$3,updated_at=$3,last_seen_at=$3 where username=$1 and ($2='' or session_token=$2) and ($4='' or coalesce(nullif(last_seen_at::text,''),nullif(updated_at::text,''),login_at::text,'') <= $4) returning username`,[username,sessionToken,stamp,cutoffMs?new Date(cutoffMs).toISOString():'']);return Boolean(result.length);}
  const existing=await store.findById('active_sessions','username',username);
  if(!existing||(sessionToken&&existing.session_token!==sessionToken))return false;
  if(cutoffMs&&(Date.parse(existing.last_seen_at||existing.updated_at||existing.login_at||'')||0)>cutoffMs)return false;
  await store.update('active_sessions','username',username,{session_token:'',status:'Logged Out',revoked_at:stamp,logout_at:stamp,updated_at:stamp,last_seen_at:stamp});return true;
}

async function recoverFromSignedSessionCookie(token, req, res) {
  const decoded = jwt.decode(token);
  if (!decoded?.username || !decoded?.session_token) return null;
  try {
    const active = await store.findById('active_sessions', 'username', decoded.username);
    if (!active) return null;
    if (String(active.session_token || '') !== String(decoded.session_token || '')) return null;
    if (!sameBrowserSession(active, req)) return null;
    const user = await store.findById('users', 'username', decoded.username);
    if (!user || getActiveSessionExpiry(active,user)) return null;
    const deviceId = ensureDeviceId(req, res, String(active.device_id || ''));
    res.cookie('career_crox_token', signUser(user, null, String(active.session_token || decoded.session_token || '')), authCookie());
    return {
      user_id: user.user_id,
      username: user.username,
      role: canonicalRole(user.role, user.designation),
      full_name: user.full_name,
      designation: user.designation,
      recruiter_code: user.recruiter_code,
      session_token: String(active.session_token || decoded.session_token || ''),
    };
  } catch {
    return null;
  }
}

function signUser(user, impersonator, sessionToken) {
  return jwt.sign(
    {
      user_id: user.user_id,
      username: user.username,
      role: canonicalRole(user.role, user.designation),
      full_name: user.full_name,
      designation: user.designation,
      recruiter_code: user.recruiter_code,
      impersonator: impersonator || null,
      session_token: sessionToken || user.session_token || '',
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

// CC26_644: bounded roster cache. No scheduler or background refresh; query only an ACTIVE TL request.
const ccTlRosterCache = new Map();
const authIdentityCache = require('../lib/cache').createTimedCache(30000, {tags:["access", "staff"]});
require('../lib/cache').registerCache(Object.assign(ccTlRosterCache,{tags:new Set(['staff','access'])}));
async function hydrateTlCandidateScope(user = {}, { fresh = false } = {}) {
  if (canonicalRole(user.role, user.designation) !== 'tl') return user;
  const key = String(user.user_id || user.username || '').trim();
  if (!key) return user;
  let entry = ccTlRosterCache.get(key);
  if (fresh || !entry || Date.now() - entry.at > 30 * 1000) {
    // Read only the roster identities needed by an active TL; writes refresh it.
    const rosterFields=['tl_user_id','team_lead_user_id','reporting_tl_user_id','reports_to_user_id','reporting_manager_user_id','tl_code','team_lead_code','reporting_tl_code','reports_to_code','reporting_manager_code','tl_name','team_lead_name','reports_to_name','reporting_manager_name'];
    const users = store.pool ? await store.query(`select user_id,username,full_name,recruiter_code,role,designation,${rosterFields.map(field=>`to_jsonb(u)->>'${field}' as ${field}`).join(',')} from users u where lower(coalesce(is_active,'1')) not in ('0','false','no','inactive','deleted')`) : (await table('users')).filter(u=>!['0','false','no','inactive','deleted'].includes(lowerText(u.is_active??'1')));
    const tlId = String(user.user_id || '').trim(), tlCode = lowerText(user.recruiter_code || ''), tlName = lowerText(user.full_name || user.username || '');
    const matching = (users || []).filter((row) => {
      if (canonicalRole(row.role,row.designation) !== 'recruiter') return false;
      const ownerId = String(row.tl_user_id || row.team_lead_user_id || row.reporting_tl_user_id || row.reports_to_user_id || row.reporting_manager_user_id || '').trim();
      const ownerCode = lowerText(row.tl_code || row.team_lead_code || row.reporting_tl_code || row.reports_to_code || row.reporting_manager_code || '');
      const ownerName = lowerText(row.tl_name || row.team_lead_name || row.reporting_tl_name || row.reports_to_name || row.reporting_manager_name || '');
      return Boolean((tlId && ownerId === tlId) || (tlCode && ownerCode === tlCode) || (tlName && ownerName === tlName));
    });
    const roster = [user,...matching];
    entry = { at: Date.now(), ids: roster.map((r) => String(r.user_id||'').trim()).filter(Boolean), codes: roster.map((r) => lowerText(r.recruiter_code||'')).filter(Boolean), names: roster.flatMap((r) => [lowerText(r.full_name||''),lowerText(r.username||'')]).filter(Boolean) };
    ccTlRosterCache.set(key, entry);
    if (ccTlRosterCache.size > 100) for (const [id, cached] of ccTlRosterCache) if (Date.now() - cached.at > 5*60*1000) ccTlRosterCache.delete(id);
  }
  return { ...user, __ccTeamUserIds: entry.ids, __ccTeamCodes: entry.codes, __ccTeamNames: entry.names };
}
// Reject known ended sessions before the instance-mode middleware can read DB.
function quietSessionGate(req,res,next){
 const phone=req.get?.('x-device-token')||req.query?.device_token||req.body?.device_token;if(phone&&require('../controllers/mobileDialerController').isRevokedMobileToken(phone)){const old=req.method==='GET'&&/(?:^|\/)active-session$/.test(req.path||'');return res.status(old?200:410).json({ok:false,code:'DEVICE_LOGGED_OUT',message:'CRM session ended. Sign in and pair again.'});}
 const token=req.cookies?.career_crox_token;
 if(!token&&!phone&&require('../lib/recentHumanActivity').nightDormant()&&!/^\/(?:auth\/(?:login|self-register|password-reset-request)|health(?:\/|$)|jds\/shared\/)/.test(req.path||''))return res.status(401).json({code:'NOT_AUTHENTICATED',message:'Not authenticated. Sign in to use the CRM.'});
 if(!token||/^\/auth\/login(?:\/|$)/.test(req.path||''))return next();
 let user;try{user=jwt.verify(token,JWT_SECRET);}catch{return next();}
 const recent=require('../lib/recentHumanActivity'),state=recent.localState(user);
 if(recent.isKnownRevoked(user)&&req.path==='/auth/logout')return res.status(200).json({ok:true,already_logged_out:true});
 if(recent.isKnownRevoked(user))return res.status(401).json({code:'SESSION_ENDED',message:'CRM session ended. Sign in again.'});
 if(state?.expired){void recent.expireKnownSession(user);return res.status(401).json({code:'SESSION_ENDED',message:'CRM session ended after inactivity. Sign in again.'});}
 return next();
}
async function requireAuth(req, res, next) {
  const token = req.cookies.career_crox_token;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  let decoded = null;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    const recovered = await recoverFromSignedSessionCookie(token, req, res);
    if (recovered) {
      req.user = recovered.__cc874RecoveryOwner?recovered:await require('../lib/collaborationAccess').hydrate(await hydrateTlCandidateScope(recovered));
      return require('../lib/accessRules').applyDashboardScope(req,res,next);
    }
    return res.status(401).json({ message: 'Invalid session' });
  }

  decoded.role = canonicalRole(decoded.role, decoded.designation);
  // Old tabs may continue polling after the user signs out; do not ask Supabase
  // to validate a session that was already revoked in this Render process.
  if (require('../lib/recentHumanActivity').isKnownRevoked(decoded)) {
    return res.status(401).json({ message: 'CRM session ended after inactivity. Sign in again.',code:'SESSION_ENDED' });
  }

  if (decoded.impersonator) {
    return res.status(401).json({code:'STALE_SESSION',message:'Legacy impersonation has ended. Please sign in again.'});
  }

  try {
    // CC26_603: every authenticated API request checks only the minimal session fields.
    // Legacy installations without optional timestamp columns fall back to the existing row.
    let active;
    if (store.pool && typeof store.one === 'function') {
      try { const read=()=>store.one('select session_token, last_seen_at, login_at, updated_at, device_id from public.active_sessions where username=$1 limit 1',[decoded.username]);active=['GET','HEAD'].includes(req.method)?await activeSessionCache.load(decoded.username,read):await read(); }
      catch { active = await store.findById('active_sessions', 'username', decoded.username); }
    } else active = await store.findById('active_sessions', 'username', decoded.username);
    const deviceId = ensureDeviceId(req, res, String(active?.device_id || ''));
    const identityKey=String(decoded.user_id||decoded.username);
    let identity=['GET','HEAD'].includes(req.method) ? authIdentityCache.get(identityKey) : null;
    if (!identity) {
      const localRecoveryIdentity=await require('../lib/multipleCrm').recoveryOwner(decoded.username);
      identity=localRecoveryIdentity || (store.pool ? await store.one('select user_id,username,full_name,recruiter_code,role,designation,is_active from users where user_id=$1 and lower(username)=lower($2) limit 1',[decoded.user_id||'',decoded.username||'']) : await store.findById('users','user_id',decoded.user_id));
      if (!identity || !isActiveAccount(identity.is_active) || String(identity.user_id)!==String(decoded.user_id) || lowerText(identity.username)!==lowerText(decoded.username)) {authIdentityCache.delete(identityKey);return res.status(401).json({message:'This account is inactive or its login has changed. Please contact your manager.'});}
      authIdentityCache.set(identityKey,identity);
    }
    // JSON/local stores return the whole account; its legacy session_token must
    // never overwrite the token that was verified from the signed session cookie.
    const identityFields=['user_id','username','full_name','recruiter_code','role','designation','is_active','__cc874RecoveryOwner'];
    const safeIdentity=Object.fromEntries(identityFields.filter(field=>identity[field]!==undefined).map(field=>[field,identity[field]]));
    decoded={...decoded,...safeIdentity,role:canonicalRole(identity.role,identity.designation)};
    const hasMatchingToken = Boolean(active && decoded.session_token && String(active.session_token || '') === String(decoded.session_token || ''));
    if(!hasMatchingToken){require('../lib/recentHumanActivity').markRevoked(decoded);return res.status(401).json({message:'CRM session ended. Please sign in again.',code:'STALE_SESSION'});}
    const sessionExpiry = getActiveSessionExpiry(active,decoded);
    if (sessionExpiry) {
      const revoked=await clearActiveSession(decoded.username,decoded.session_token,sessionExpiry.lastActivityAt);
      if(!revoked)return res.status(503).json({message:'Session activity changed. Please retry.'});
      if (!sessionExpiry.night&&!['manager','admin'].includes(decoded.role)) { try { await lockPresenceForInactivity(decoded, `${inactivityMinutes(decoded)}-minute inactivity session expired. Unlock approval is required before login can resume work.`, { lockReason: 'session_inactivity', source: 'auth_session_expired', notifyExisting: false }); } catch {} }
      if(sessionExpiry.night)await store.insert('activity_log',{activity_id:'NIGHT-'+require('crypto').randomUUID(),user_id:decoded.user_id,username:decoded.username,action_type:'user_logout',metadata:JSON.stringify({reason:'night_idle_logout'}),created_at:nowIso()});
      try { await revokeMobilePairingForExpiredCrmSession(decoded, 'crm_inactivity_session_expired');
        require('../controllers/mobileDialerController').invalidateMobileSessionForLogout(decoded.user_id); } catch {}
      try { require('../lib/recentHumanActivity').markInactive(decoded, decoded.session_token); } catch {}
      return res.status(401).json({ message: sessionExpiry.message, mobile_logged_out: true });
    }
    const recentActivity=!isBackgroundRequest(req)&&sameBrowserSession(active,req)?activityAt(req):0;
    if(recentActivity)require('../lib/recentHumanActivity').markRecentHumanActivity(decoded,recentActivity);
    // Recent typing/clicking can reach any API route, not only the pulse route.
    // Validate the current session before allowing real UI activity to extend it.
    const trustedActivityPulse=req.path==='/auth/activity'&&req.method==='POST';
    const priorAt=Date.parse(active.last_seen_at||active.updated_at||'')||0;
    const matchingActivity=recentActivity>priorAt&&(trustedActivityPulse||shouldTouchSession(active,req));
    if(matchingActivity){const stamp=new Date(recentActivity).toISOString();const updated=await updateActiveSessionCompat(decoded.username,{last_seen_at:stamp,updated_at:stamp,device_id:deviceId},decoded.session_token);if(!updated)return res.status(503).json({message:'Session activity changed. Please retry.'});active={...active,last_seen_at:stamp,updated_at:stamp};}
    req.user = decoded.__cc874RecoveryOwner?decoded:await require('../lib/collaborationAccess').hydrate(await hydrateTlCandidateScope(decoded, { fresh: /\/(?:flowchart|users)(?:\/|$)/.test(req.originalUrl||req.url||'') && !['GET','HEAD'].includes(req.method) }));
    return require('../lib/accessRules').applyDashboardScope(req,res,next);
  } catch (error) {
    console.error('Auth session lookup unavailable; protected routes paused:', error?.message || error);
    return res.status(503).json({ message: 'CRM session verification unavailable. Retry after connection recovers; no background data access permitted.' });
  }
}


function requireStrongAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  if (req.authDegraded) return res.status(401).json({ message: 'Refresh CRM and sign in again.' });
  return next();
}

function requireExportAccess(routeKey) {
  return async function exportAccessGuard(req, res, next) {
    if (!['manager', 'admin'].includes(String(req.user?.role || '').trim().toLowerCase())) {
      return res.status(403).json({ message: 'Manager export access only' });
    }
    if (req.authDegraded) return res.status(401).json({ message: 'Refresh CRM and sign in again.' });
    const token = String(req.query?.export_token || req.headers['x-export-token'] || '').trim();
    if (!token) return res.status(401).json({ message: 'Manager export password required.' });
    const decoded = verifyActionToken(token, { purpose: 'export', username: req.user?.username, routeKey });
    if (!decoded) return res.status(401).json({ message: 'Export unlock expired. Enter manager password again.' });
    if(/^data-backup\/(download|restore)$/.test(routeKey)){
      try{
        const state=await require('../controllers/authController').transferPasscodeState();
        const session=require('crypto').createHash('sha256').update(String(req.user.session_token||'')).digest('hex');
        if(!state?.hash||decoded.transfer_revision!==state.revision||decoded.user_id!==req.user.user_id||decoded.session!==session)return res.status(401).json({message:'Manager password and current transfer passcode required.'});
      }catch(error){return next(error);}
    }
    req.exportAccess = decoded;
    return next();
  };
}

function requireLeadership(req, res, next) {
  const role = canonicalRole(req.user?.role, req.user?.designation);
  if (!['admin', 'manager', 'tl'].includes(role)) {
    return res.status(403).json({ message: 'Leadership access only' });
  }
  return next();
}

module.exports = {
  authCookie,
  signUser,
  registerActiveSession,
  clearActiveSession,
  touchActiveSession: updateActiveSessionCompat,
  revokeMobilePairingForExpiredCrmSession,
  ensureDeviceId,
  requireAuth,
  quietSessionGate,
  requireLeadership,
  requireStrongAuth,
  requireExportAccess,
};

module.exports.hydrateTlCandidateScope=hydrateTlCandidateScope;
