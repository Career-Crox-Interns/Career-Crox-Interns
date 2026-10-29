import {dashboardScopeKey} from './dashboardScope';
const staffNames=new Map();let staffPrincipal='';
export function rememberStaffNames(users=[]){const principal=cachePrincipal();if(principal!==staffPrincipal){staffPrincipal=principal;staffNames.clear();}for(const person of users){const name=String(person.full_name||person.display_name||person.name||'').trim();if(!name)continue;for(const key of [person.user_id,person.recruiter_code,person.username])if(key)staffNames.set(String(key).toLowerCase(),name);}if(typeof window!=='undefined')window.dispatchEvent(new Event('cc814-staff-names'));}
export function displayStaffName(value,fallback='Team member'){if(staffPrincipal!==cachePrincipal())staffNames.clear();const name=staffNames.get(String(value||'').toLowerCase());if(name)return name;try{const own=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}');if([own.user_id,own.recruiter_code,own.username].includes(value)&&own.full_name)return own.full_name;}catch{}return fallback;}
export function accountPrincipal() { try { const u = JSON.parse(localStorage.getItem('careerCroxCachedUser') || '{}'); return [u.user_id || u.username || 'signed-out',u.role,u.team_id,u.recruiter_code].join('|'); } catch { return 'signed-out'; } }
export function cachePrincipal(){return accountPrincipal()+'|dashboard:'+dashboardScopeKey();}
// CC918: bounded memory suggestions from already authorized reads only.
const candidateSuggestions=new Map();let candidatePrincipal='';
function candidateScope(){const principal=cachePrincipal();if(candidatePrincipal!==principal){candidatePrincipal=principal;candidateSuggestions.clear();}}
export function readCandidateSuggestions(query=''){
 candidateScope();const q=String(query).normalize('NFKC').trim().toLocaleLowerCase(),digits=q.replace(/\D/g,'');if(!q)return [];
 const kind=q.includes('@')?'email':/^[+\d\s().-]+$/.test(q)&&digits.length>=2?'phone':/^[a-z]{1,4}[\s-]*\d+$/i.test(q)?'id':'name';
 const phoneDigits=digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;
 return [...candidateSuggestions.values()].filter(row=>!['deleted','__deleted__','archived'].includes(String(row.status||'').toLowerCase())&&(kind==='email'?String(row.email||'').normalize('NFKC').toLocaleLowerCase().includes(q):kind==='phone'?String(row.phone||'').replace(/\D/g,'').includes(phoneDigits):kind==='id'?String(row.candidate_id||'').toLowerCase()===q.replace(/\s/g,''):String(row.full_name||'').normalize('NFKC').toLocaleLowerCase().includes(q))).slice(0,30);
}
function rememberCandidateSuggestions(payload){
 candidateScope();let rows=Array.isArray(payload?.candidates)?payload.candidates:Array.isArray(payload?.items)?payload.items:payload?.item?.candidate_id?[payload.item]:[];
 for(const row of rows){if(!row?.candidate_id||!row.full_name)continue;candidateSuggestions.set(String(row.candidate_id),Object.fromEntries(['candidate_id','full_name','phone','phone_masked','email','location','preferred_location','recruiter_name','status','client','process'].map(k=>[k,String(row[k]??'')])));}
 while(candidateSuggestions.size>500)candidateSuggestions.delete(candidateSuggestions.keys().next().value);
}
if(typeof window!=='undefined')for(const event of ['career-crox-access-changed','career-crox-team-changed','cc875-dashboard-changed'])window.addEventListener(event,()=>{candidateSuggestions.clear();candidatePrincipal='';});
const jsonHeaders = { 'Content-Type': 'application/json' };

const inflightGetRequests = new Map();
const recentGetCache = new Map();
const resourceVersion=path=>typeof window!=='undefined'?(window.__CC837_RESOURCE_VERSION__?.(path)||'0'):'0';
function discardInvalidatedReads() {
  if (typeof window.__CC837_RESOURCE_VERSION__ !== 'function') { recentGetCache.clear(); return; }
  for (const [key, hit] of recentGetCache) {
    if (!hit.path || hit.revision !== resourceVersion(hit.path)) recentGetCache.delete(key);
  }
}
if(typeof window!=='undefined')window.addEventListener('cc837-read-invalidated',discardInvalidatedReads);
if(typeof window!=='undefined')window.addEventListener('cc875-dashboard-changed',()=>{accessEpoch++;for(const p of inflightGetRequests.values())p.controller?.abort('dashboard-changed');clearGetRequestCache();});
const GET_CACHE_TTL_MS = 60000;
const MAX_STALE_INFLIGHT_MS = 18000;
const activeBackgroundControllers = new Set();
let writeBusyCounter = 0;

// Recover a suspended tab once; do not turn focus events into a polling loop.
if(typeof window!=='undefined'){
  let hiddenAt=document.hidden?Date.now():0,lastResume=0;
  const wake=()=>{
    if(document.hidden){hiddenAt=Date.now();return;}
    if(!hiddenAt||Date.now()-lastResume<2000)return;
    const slept=Date.now()-hiddenAt;hiddenAt=0;lastResume=Date.now();
    if(slept<1500)return;
    for(const [key,pending]of inflightGetRequests){
      if(Date.now()-pending.at>5000){pending.controller?.abort('tab-resumed');inflightGetRequests.delete(key);}
    }
    window.dispatchEvent(new CustomEvent('career-crox-tab-resumed'));
  };
  document.addEventListener('visibilitychange',wake);
  window.addEventListener('pageshow',event=>{if(event.persisted){hiddenAt=Date.now()-2000;wake();}});
}

const USER_CACHE_KEY = 'careerCroxCachedUser';
const SESSION_LOGIN_AT_KEY = 'careerCroxSessionLoginAt';
const SESSION_LAST_ACTIVITY_KEY = 'careerCroxLastActivityAt';
const SESSION_EXPIRED_MESSAGE_KEY = 'careerCroxSessionExpiredMessage';
export function crmInactivityMs(user){if(typeof window!=='undefined'&&window.__CC835_IDLE_TIMEOUT_MS__)return window.__CC835_IDLE_TIMEOUT_MS__(user);const h=new Date(Date.now()+19800000).getUTCHours();if(h>=21||h<9)return 600000;return crmDayMinutes(user)*60000;}
function crmDayMinutes(user){if(!user)try{user=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')}catch{}const role=String(user?.role||user?.designation||'').toLowerCase();return /manager|admin/.test(role)?60:/^(tl|teamlead)$|team lead/.test(role)?30:10;}
export function crmSessionDeadline(user,last){if(typeof window!=='undefined'&&window.__CC919_SESSION_DEADLINE__)return window.__CC919_SESSION_DEADLINE__(user,last);const at=Number(last)||0;if(!at)return 0;const d=new Date(at+19800000),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-19800000,start=d.getUTCHours()<9?day-10800000:day+75600000,end=start+43200000,normal=at+crmDayMinutes(user)*60000,limit=Math.max(start,at+600000);return limit<=end?Math.min(normal,limit):normal;}

export function crmExpiryMinutes(user,last){return crmSessionDeadline(user,last)<Number(last)+crmDayMinutes(user)*60000?10:crmDayMinutes(user);}
export function crmLastActivityAt(){if(typeof window!=='undefined'&&window.__CC835_LAST_ACTIVITY__)return window.__CC835_LAST_ACTIVITY__();return Math.min(Date.now(),Math.max(...['careerCroxLastActivityAt','careerCroxHumanActivityAt','careerCroxSessionLoginAt'].map(safeNumberFromStorage)));}
const DAILY_LOGOUT_HOUR = 21;

const PERSISTENT_GET_CACHE_PREFIX = 'careerCroxFastCache:cc820:';
const PERSISTENT_GET_CACHE_MAX_AGE_MS = Number(import.meta?.env?.VITE_STALE_CACHE_MAX_AGE_MS || (4 * 60 * 60 * 1000));
const PERSISTENT_GET_CACHE_MAX_BYTES = Number(import.meta?.env?.VITE_STALE_CACHE_MAX_BYTES || 180000);
// One-time privacy cleanup for CC851 legacy attachment payload caches; keep all
// unrelated candidate, settings and UI caches intact.
if(typeof window!=='undefined'){
 try{for(const storage of [window.sessionStorage,window.localStorage])for(const key of Object.keys(storage))if(key.startsWith(PERSISTENT_GET_CACHE_PREFIX)&&(key.includes('/candidate-assets/')||key.includes('resume-autofill')))storage.removeItem(key);}catch{}
}


function stableCacheKey(path = '') {
  return `${PERSISTENT_GET_CACHE_PREFIX}${cachePrincipal()}:${String(path || '').slice(0, 700)}`;
}

function isPersistentGetCacheAllowed(path = '') {
  const clean = String(path || '');
  if (!clean.startsWith('/api/')) return false;
  if (clean.includes('/download') || clean.includes('/export')) return false;
  if (clean.startsWith('/api/auth/')||clean.startsWith('/api/multiple-crm/')) return false;
  if (clean.includes('/files/') || clean.includes('/candidate-assets/') || clean.includes('resume') || clean.includes('/assets/')) return false;
  return true;
}

function readPersistentGetCache(path = '') {
  if (typeof window === 'undefined' || !isPersistentGetCacheAllowed(path)) return null;
  try {
    const key = stableCacheKey(path);
    const raw = window.sessionStorage?.getItem(key) || window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if(parsed.revision!==resourceVersion(path))return null;
    if ((Date.now() - Number(parsed.at || 0)) > PERSISTENT_GET_CACHE_MAX_AGE_MS) return null;
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function writePersistentGetCache(path = '', payload) {
  if (typeof window === 'undefined' || !isPersistentGetCacheAllowed(path) || payload === undefined) return;
  try {
    const raw = JSON.stringify({ at: Date.now(), revision:resourceVersion(path), payload });
    if (raw.length > PERSISTENT_GET_CACHE_MAX_BYTES) return;
    window.sessionStorage?.setItem(stableCacheKey(path), raw);
  } catch {}
}

function stalePayloadForFailure(path = '', error = null, isBackground = false) {
  if ([401,403,404].includes(Number(error?.status)) || ['LOCAL_SESSION_EXPIRED','ACCOUNT_CHANGED'].includes(error?.code)) return null;
  const payload = readPersistentGetCache(path);
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    __stale: true,
    __stale_message: isBackground ? '' : 'Showing saved CRM data while the server catches up.',
  };
}


export function invalidateGetResource(prefix){
  for(const key of recentGetCache.keys())if(key.includes(prefix))recentGetCache.delete(key);
  for(const key of inflightGetRequests.keys())if(key.includes(prefix))inflightGetRequests.delete(key);
  try{const current=PERSISTENT_GET_CACHE_PREFIX+cachePrincipal()+':';for(const storage of [window.sessionStorage,window.localStorage])for(const key of Object.keys(storage))if(key.startsWith(current)&&key.includes(prefix))storage.removeItem(key);}catch{}
}
function clearGetRequestCache() {
  inflightGetRequests.clear();
  recentGetCache.clear();
}

function emitWriteBusyChange() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('career-crox-write-busy', { detail: { busy: writeBusyCounter > 0, count: writeBusyCounter } }));
  } catch {}
}

function beginWriteBusy() {
  writeBusyCounter += 1;
  emitWriteBusyChange();
}

function endWriteBusy() {
  writeBusyCounter = Math.max(0, writeBusyCounter - 1);
  emitWriteBusyChange();
}

function buildMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  return payload.message || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safeNumberFromStorage(key) {
  if (typeof window === 'undefined') return 0;
  try {
    const value = Number(window.localStorage.getItem(key) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function markApiSessionActivity(force = false) {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const previous = safeNumberFromStorage(SESSION_LAST_ACTIVITY_KEY);
    if (!force && previous && now - previous < 15000) return;
    window.localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(now));
  } catch {}
}

function hasCachedUser() {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage.getItem(USER_CACHE_KEY));
  } catch {
    return false;
  }
}

function latestDailyCutoffMs(nowMs = Date.now()) {
  const cutoff = new Date(nowMs);
  cutoff.setHours(DAILY_LOGOUT_HOUR, 0, 0, 0);
  if (nowMs < cutoff.getTime()) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff.getTime();
}

function localSessionExpiryReason(path = '', nowMs = Date.now()) {
  const cleanPath = String(path || '');
  if (cleanPath === '/api/auth/login' || cleanPath === '/api/auth/logout') return '';
  if (!hasCachedUser()) return '';
  const lastActivityAt = crmLastActivityAt();
  if (lastActivityAt && nowMs >= crmSessionDeadline(null,lastActivityAt)) {
    return `CRM locked and logged out after ${crmExpiryMinutes(null,lastActivityAt)} minutes of inactivity.`;
  }
  return '';
}

function stopRequestIfLocalSessionExpired(path) {
  const clean = String(path || '');
  if (window.__CC602_NETWORK_PAUSED__ && !['/api/auth/login', '/api/auth/logout'].includes(clean)) {
    const e = new Error('CRM is logged out; sign in to reconnect.'); e.status = 401; e.code = 'LOCAL_SESSION_EXPIRED'; throw e;
  }
  const message = localSessionExpiryReason(path);
  if (!message) return;
  try {
    window.sessionStorage.setItem(SESSION_EXPIRED_MESSAGE_KEY, message);
    window.localStorage.removeItem(USER_CACHE_KEY);
    window.localStorage.removeItem(SESSION_LOGIN_AT_KEY);
    window.localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
    window.__CC602_NETWORK_PAUSED__ = true;
    window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'));
    window.dispatchEvent(new CustomEvent('career-crox-auth-expired', { detail: { message, localOnly: true } }));
  } catch {}
  const error = new Error(message);
  error.status = 401;
  error.code = 'LOCAL_SESSION_EXPIRED';
  throw error;
}

function shouldEmitAuthExpired(path, status, message, isBackground = false) {
  if (Number(status || 0) !== 401) return false;
  if (['/api/auth/login', '/api/auth/logout', '/api/auth/me'].includes(path)) return false;
  const text = String(message || '').toLowerCase();
  return text.includes('crm session ended') || text.includes('account is inactive') || text.includes('not authenticated') || text.includes('invalid session') || text.includes('session expired') || text.includes('active on another device') || text.includes('inactivity') || text.includes('9 pm');
}

function abortBackgroundRequests() {
  for (const controller of [...activeBackgroundControllers]) {
    try { controller.abort('background-preempted'); } catch {}
  }
  activeBackgroundControllers.clear();
}
if (typeof window !== 'undefined') window.addEventListener('career-crox-idle-lock-begin', () => { abortBackgroundRequests(); clearGetRequestCache(); });


function normalizeApiPayloadShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const next = { ...payload };
  for (const key of ['items', 'rows', 'users', 'notifications', 'tasks', 'candidates', 'submissions', 'interviews', 'followups']) {
    if (Object.prototype.hasOwnProperty.call(next, key) && next[key] !== undefined && next[key] !== null && !Array.isArray(next[key])) {
      if (typeof next[key] === 'object') {
        try { next[key] = Object.values(next[key]).filter((item) => item !== null && item !== undefined); }
        catch { next[key] = []; }
      } else {
        next[key] = [];
      }
    }
  }
  return next;
}

async function parseResponsePayload(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return normalizeApiPayloadShape(payload);
}

let accessEpoch=0;
async function requestInternal(path, options = {}) {
  const instanceMode=window.__CC874_INSTANCE_MODE__;
  if(instanceMode&&!['ACTIVE','LOCAL','UNCONFIGURED'].includes(instanceMode)&&!/^\/api\/(auth\/|multiple-crm(?:\/|$)|health)/.test(path)){const e=new Error('This CRM is read-only. Use the active instance or check manager recovery status.');e.code='CRM_STANDBY';e.status=423;throw e;}
  const epochAtStart=accessEpoch;
  const principalAtStart = cachePrincipal();
  stopRequestIfLocalSessionExpired(path);
  // CC26_621: night-time nonessential automatic reads return cached data or stop locally.
  // Explicit manual navigation and Refresh do not set the background flag.
  const manualPage = String(window.location?.pathname || '').split('/')[1].toLowerCase();
  const matchingManualPage = ['candidates','chat','reports','approvals','tasks','submissions','interviews','clients'].includes(manualPage)
    && String(path).startsWith(`/api/${manualPage}`);
  if (document.hidden && options.background && String(options.method || 'GET').toUpperCase() === 'GET' && window.__CC621_NIGHT_QUIET__?.()
      && !String(path).startsWith('/api/auth/') && !String(path).startsWith('/api/attendance?compact=1')
      && !matchingManualPage) {
    const saved = readPersistentGetCache(path);
    if (saved != null) return saved;
    const err = new Error('Night quiet mode — select Manual Refresh for current data.');
    err.code = 'NIGHT_QUIET';
    throw err;
  }

  const method = String(options.method || 'GET').toUpperCase();
  const attendanceContext=String(path).startsWith('/api/attendance')?{path:String(path).split('?')[0],at:Date.now(),method}:null;
  const useDedupe = !path.startsWith('/api/multiple-crm/') && method === 'GET' && !options.body;
  const dedupeKey = useDedupe ? path : '';
  const scopedKey = stableCacheKey(dedupeKey);
  const cacheTtlMs = Number(options.cacheTtlMs ?? (options.background ? Math.max(GET_CACHE_TTL_MS, 30000) : GET_CACHE_TTL_MS));
  const now = Date.now();
  const cached = useDedupe ? recentGetCache.get(scopedKey) : null;
  if (cached && cached.revision===resourceVersion(path) && (now - cached.at) < cacheTtlMs) {
    return Promise.resolve(cached.payload);
  }
  const savedPayload = useDedupe && options.preferStale === true ? readPersistentGetCache(dedupeKey) : null;
  if (savedPayload && options.preferStale === true) {
    return Promise.resolve(savedPayload);
  }
  if (useDedupe && inflightGetRequests.has(scopedKey)) {
    const current = inflightGetRequests.get(scopedKey);
    if (current?.promise && (now - Number(current.at || 0)) < MAX_STALE_INFLIGHT_MS) return current.promise;
    current?.controller?.abort('obsolete-request');
    inflightGetRequests.delete(scopedKey);
  }

  const controller = new AbortController();
  const isBackground = Boolean(options.background);
  const timeoutMs = Number(options.timeoutMs || (useDedupe ? 15000 : 45000));
  const timeout = window.setTimeout(() => controller.abort('request-timeout'), timeoutMs);
  const retries = Number(options.retries ?? (useDedupe ? 1 : 0));

  const detachedWrite = Boolean(options.detachedWrite);
  const promise = (async () => {
    // CC26_522: detached writes persist safely without showing a global
    // processing/loading state. They are not treated as abortable polling.
    const trackWriteBusy = method !== 'GET' && !isBackground && !detachedWrite;
    if (isBackground) activeBackgroundControllers.add(controller);
    if (trackWriteBusy) {
      abortBackgroundRequests();
      beginWriteBusy();
    }
    try {
      let attempt = 0;
      while (true) {
        try {
          const requestHeaders = {
            ...(options.body ? jsonHeaders : {}),
            ...(options.headers || {}),
            ...(isBackground ? { 'X-Career-Crox-Background': '1' } : {}),
            'X-Career-Crox-Last-Activity-At': String(crmLastActivityAt() || ''),
            'X-Career-Crox-Activity-Age-Ms': String(crmLastActivityAt()?Math.max(0,Date.now()-crmLastActivityAt()):90001),
          };
          const fetchOptions = { ...options, ...(path.startsWith('/api/multiple-crm/')?{cache:'no-store'}:{}) };
          if (method === 'GET' && cacheTtlMs <= 0 && fetchOptions.cache !== 'no-store') fetchOptions.cache = 'reload';
          delete fetchOptions.headers;
          delete fetchOptions.detachedWrite;
          const res = await fetch(path, {
            credentials: 'include',
            ...fetchOptions,
            // Local wrapper marker only; never adds a network/CORS header.
            __cc927ManagedWrite: true,
            headers: requestHeaders,
            signal: options.signal ? AbortSignal.any([options.signal,controller.signal]) : controller.signal,
          });
          let payload = await parseResponsePayload(res);
          if(payload?.code==='CRM_STANDBY'){window.__CC874_INSTANCE_MODE__=payload.mode||'FROZEN';window.dispatchEvent(new CustomEvent('cc874-instance-status',{detail:{mode:window.__CC874_INSTANCE_MODE__,available:true}}));}
          if(String(options.method||'GET').toUpperCase()==='GET'&&epochAtStart!==accessEpoch){const e=new Error('Project access changed. Refresh this view.');e.code='ACCESS_CHANGED';e.status=409;throw e;}
          if (cachePrincipal() !== principalAtStart) { const error=new Error('Account changed while the request was running. Refresh this page.');error.code='ACCOUNT_CHANGED';error.status=401;throw error; }
          if (!res.ok) {
            const error = new Error(buildMessage(payload, 'Request failed'));
            error.status = res.status;
            error.code = payload?.code;
            error.payload = payload;
            error.conflict_fields = payload?.conflict_fields || [];
            if (typeof window !== 'undefined' && shouldEmitAuthExpired(path, res.status, error.message || 'Session expired', isBackground)) {
              try { window.dispatchEvent(new CustomEvent('career-crox-auth-expired', { detail: { message: error.message || 'Session expired' } })); } catch {}
            }
            throw error;
          }
          if(method!=='GET'&&method!=='HEAD'&&res.status!==204&&(!payload||typeof payload!=='object')){
            throw Object.assign(new Error('Server acknowledgement was missing or invalid. Check the saved record before retrying.'),{status:res.status,code:'WRITE_ACK_INVALID'});
          }
          if(method!=='GET'&&method!=='HEAD'&&(payload?.ok===false||payload?.success===false)){
            const error=Object.assign(new Error(buildMessage(payload,'Save was not accepted.')),{status:409,code:payload.code||'MUTATION_REJECTED',payload});
            throw error;
          }
          if(method==='POST'&&/^\/api\/attendance\/(start|end)-break$/.test(String(path).split('?')[0])){
            const action=String(path).includes('/start-break')?'start':'end',expected=action==='start'?'1':'0';
            if(payload?.break_action?.committed!==true||payload.break_action.action!==action||String(payload.presence?.user_id)!==String(accountPrincipal().split('|')[0])||String(payload.presence?.is_on_break)!==expected)
              throw Object.assign(new Error('Break confirmation was incomplete. Refresh attendance before retrying.'),{status:res.status,code:'WRITE_ACK_INVALID'});
          }
          if(method!=='GET'&&payload?.soft_hidden_ids?.length){for(const candidate_id of payload.soft_hidden_ids){const patch={item:{candidate_id,status:'__deleted__',deleted_at:new Date().toISOString()},principal:cachePrincipal(),actor_user_id:cachePrincipal().split('|')[0],at:Date.now()};try{window.dispatchEvent(new CustomEvent('career-crox-candidate-upserted',{detail:patch}));localStorage.setItem('careerCroxRealtimeCandidatePatch:v2',JSON.stringify(patch));}catch{}}}
          if(method!=='GET'&&payload?.candidate_item?.candidate_id){
            const patch={item:payload.candidate_item,meta:{source:'pipeline-commit',committed:true,note:payload.note||null},principal:cachePrincipal(),actor_user_id:cachePrincipal().split('|')[0],at:Date.now()};
            try{window.dispatchEvent(new CustomEvent('career-crox-candidate-upserted',{detail:patch}));localStorage.setItem('careerCroxRealtimeCandidatePatch:v2',JSON.stringify(patch));}catch{}
          }
          if(attendanceContext&&payload?.presence)payload=window.__CC836_ACCEPT_ATTENDANCE__?.(payload,attendanceContext)||payload;
          if(Array.isArray(payload?.users))rememberStaffNames(payload.users);
          rememberCandidateSuggestions(payload);
          if(String(path).startsWith('/api/attendance') && payload?.presence && !window.__CC602_NETWORK_PAUSED__)window.dispatchEvent(new CustomEvent('career-crox-attendance-live',{detail:payload}));
          // Human inactivity must not be extended by background GET/polling responses.
          // API responses are not employee activity; only trusted UI events reset the 10-minute clock.
          if (method !== 'GET' && typeof window !== 'undefined') {
            try { window.dispatchEvent(new CustomEvent('career-crox-data-written', { detail: { path, method, reminder_relevant:isReminderWriteRelevant(path,options.body) } })); } catch {}
          }
          if (useDedupe && inflightGetRequests.get(scopedKey)?.promise === promise) {
            recentGetCache.delete(scopedKey);
            recentGetCache.set(scopedKey, { at: Date.now(), path, revision:resourceVersion(path), payload });
            while(recentGetCache.size>120)recentGetCache.delete(recentGetCache.keys().next().value);
            writePersistentGetCache(dedupeKey, payload);
          } else if(!useDedupe) {
            if (typeof window.__CC837_RESOURCE_VERSION__ === 'function') discardInvalidatedReads();
            else clearGetRequestCache();
          }
          return payload;
        } catch (error) {
          const retryable = [502, 503, 504].includes(Number(error?.status || 0));
          if (attempt < retries && retryable) {
            attempt += 1;
            await sleep(450 * attempt);
            continue;
          }
          if (error?.name === 'AbortError') {
            if (controller.signal?.reason === 'background-preempted') {
              const aborted = new Error('Background refresh paused.');
              aborted.code = 'BACKGROUND_ABORT';
              const stale = useDedupe ? stalePayloadForFailure(dedupeKey, aborted, isBackground) : null;
              if (stale && options.allowStale !== false) return stale;
              throw aborted;
            }
            const timeoutError = new Error('Request timed out. Please retry.');
            const stale = useDedupe ? stalePayloadForFailure(dedupeKey, timeoutError, isBackground) : null;
            if (stale && options.allowStale !== false) return stale;
            throw timeoutError;
          }
          const stale = useDedupe ? stalePayloadForFailure(dedupeKey, error, isBackground) : null;
          if (stale && options.allowStale !== false) return stale;
          throw error;
        }
      }
    } finally {
      window.clearTimeout(timeout);
      activeBackgroundControllers.delete(controller);
      if (useDedupe && inflightGetRequests.get(scopedKey)?.promise === promise) inflightGetRequests.delete(scopedKey);
      if (trackWriteBusy) endWriteBusy();
    }
  })();

  if (useDedupe) inflightGetRequests.set(scopedKey, { at: Date.now(), promise, controller });
  return promise;
}

// CC927: one persistent, plain-language notice for a failed foreground write.
// Store no request body, candidate data, credentials or file contents here.
const writeFailureHistory=new Map();
const pendingUserWrites=new Map();
export function shouldReportWriteFailure(path,method,background=false){return !background&&!['GET','HEAD'].includes(String(method||'GET').toUpperCase())&&!/^\/api\/(?:auth|presence|activity|ui\/heartbeat)(?:\/|$)/.test(path)&&!(/\/notifications\/[^/]+\/read$/.test(path));}
export function trackUserWrite(principal=accountPrincipal()){pendingUserWrites.set(principal,(pendingUserWrites.get(principal)||0)+1);let ended=false;return()=>{if(ended)return;ended=true;const count=(pendingUserWrites.get(principal)||1)-1;if(count>0)pendingUserWrites.set(principal,count);else pendingUserWrites.delete(principal);};}
export const hasPendingUserWrite=()=>Number(pendingUserWrites.get(accountPrincipal())||0)>0;
export function resolveWriteFailure(path,principal=accountPrincipal()){
  if(typeof window==='undefined'||principal!==accountPrincipal())return;
  const matches=record=>record.principal===principal&&(record.path===path||(String(path).includes('/candidates/')&&/\/local\/(?:candidate-validation|form-validation)/.test(record.path)));
  window.__CC927_WRITE_FAILURES__=(window.__CC927_WRITE_FAILURES__||[]).filter(record=>!matches(record));
  window.dispatchEvent(new CustomEvent('cc936-write-resolved',{detail:{principal,path}}));
}
export function reportWriteFailure(error,context={}){
  if(typeof window==='undefined'||error?.__cc927Reported&&!context.force)return;
  const method=String(context.method||'POST').toUpperCase(),path=String(context.path||'/local/form').split('?')[0];
  if(!context.force&&!shouldReportWriteFailure(path,method,context.background))return;
  const principal=context.principal||accountPrincipal();if(principal!==accountPrincipal())return;
  try{error.__cc927Reported=true;}catch{}
  const action=context.action||'save',now=Date.now();
  const previous=(window.__CC927_WRITE_FAILURES__||[]).find(r=>r.principal===principal&&r.path===path&&r.action===action);
  const detail={id:previous?.id||'WF'+now+'-'+Math.random().toString(36).slice(2),principal,path,method,status:Number(error?.status||0),code:String(error?.code||''),
    message:String(error?.message||'Save could not be confirmed.').slice(0,2200),committed:error?.payload?.committed,localRejected:context.localRejected===true,
    fields:[context.fields||error?.conflict_fields||error?.payload?.conflict_fields||[]].flat().filter(x=>typeof x==='string').slice(0,30),
    issues:[context.issues||error?.issues||error?.payload?.issues||[]].flat().filter(x=>typeof x==='string').slice(0,30),
    existingProfile:/^\/candidate\/[a-zA-Z0-9_-]+$/.test(error?.payload?.existing_profile||'')?error.payload.existing_profile:'',
    action,route:context.route||location.pathname+location.search,at:now};
  window.__CC927_WRITE_FAILURES__=(window.__CC927_WRITE_FAILURES__||[]).filter(r=>r.principal===principal&&r.id!==detail.id).slice(-4).concat(detail);
  window.dispatchEvent(new CustomEvent('cc927-write-failed',{detail}));
}

async function request(path,options={}){
  const principal=accountPrincipal(),route=location.pathname+location.search;
  const finish=shouldReportWriteFailure(path,options.method,options.background)?trackUserWrite(principal):()=>{};
  try{const result=await requestInternal(path,options);if(!options.background&&!['GET','HEAD'].includes(String(options.method||'GET').toUpperCase()))resolveWriteFailure(String(path).split('?')[0],principal);return result;}catch(error){
    let action='save';try{const body=typeof options.body==='string'?JSON.parse(options.body):{};if(body.action==='submit'||/\/(?:submit|save-and-submit)(?:\/|$)/.test(path))action='submit';}catch{}
    reportWriteFailure(error,{path,method:options.method,background:options.background,principal,action,route});
    throw error;
  }finally{finish();}
}

// CC917: salary/qualification-only saves do not invalidate every reminder source.
export function isReminderWriteRelevant(path,raw){
 const p=String(path||'');if(/^\/api\/tasks(?:[/?]|$)/.test(p))return false;
 if(/\/api\/(submissions|interviews|followups|approvals|revenue-hub)(?:[/?]|$)/.test(p))return true;
 if(!/\/api\/candidates(?:[/?]|$)/.test(p))return false;
 if(/\/(submit|delete|restore|revive|remove-interview-date|notes)(?:[/?]|$)/.test(p))return true;
 let body;try{body=typeof raw==='string'?JSON.parse(raw):raw||{}}catch{return true}
 if(body.action==='submit'||body.note&&String(body.note.body||'').trim())return true;
 const fields=body.fields&&typeof body.fields==='object'?body.fields:body;
 const keys=Array.isArray(fields._changed_fields)?fields._changed_fields:Object.keys(fields);
 return keys.some(key=>/^(full_name|process|recruiter_user_id|recruiter_code|follow_up_at|next_follow_up_at|followup_date|follow_up_date|callback_at|interview_date|interview_reschedule_date|scheduled_at|approval_status|all_details_sent|submission_date|submitted_at|status|due_date|due_at|reminder_at|notes|data_notes)$/.test(key));
}

export const api = {
  get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
  post: (path, data, options = {}) => request(path, { ...options, method: 'POST', body: JSON.stringify(data ?? {}) }),
  put: (path, data, options = {}) => request(path, { ...options, method: 'PUT', body: JSON.stringify(data ?? {}) }),
  del: (path, options = {}) => request(path, { ...options, method: 'DELETE' })
};

// Access edits invalidate every saved list/profile preview. Server ACL remains authoritative.
window.addEventListener('career-crox-access-changed',()=>{accessEpoch++;invalidateGetResource('/api/');window.dispatchEvent(new CustomEvent('career-crox-workspace-change',{detail:{source:'/flowchart/team',meta:{access_changed:true}}}));window.dispatchEvent(new CustomEvent('career-crox-manager-reminder-dirty',{detail:{source:'/flowchart/team'}}));window.dispatchEvent(new Event('career-crox-team-changed'));});

window.addEventListener('career-crox-form-layout',()=>invalidateGetResource('/api/ui/lookups'));
