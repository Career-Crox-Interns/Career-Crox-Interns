import { cachePrincipal } from './api';
const NAV_STORAGE_PREFIX = 'careerCroxCandidateNav:';
const INSTANT_PROFILE_PREFIX = 'careerCroxInstantCandidateProfile:';
const NAV_TTL_MS = 12 * 60 * 60 * 1000;
const INSTANT_PROFILE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_NAV_ITEMS = 500;
const navigationMemory = new Map();
let lastStorageCleanupAt = 0;
function scopedNavigationKey(key = '') {
  const principal = cachePrincipal();
  const raw = String(key || '');
  // Accept this user's old CC840 URL without adding their identity twice.
  return NAV_STORAGE_PREFIX + (raw.startsWith(principal + ':') ? raw : principal + ':' + raw);
}
function storedNavigation(key) {
  const fullKey = scopedNavigationKey(key);
  if(navigationMemory.has(fullKey))return navigationMemory.get(fullKey);
  for (const storage of getStorages()) { try { const raw=storage.getItem(fullKey);if(raw){const value=JSON.parse(raw);navigationMemory.set(fullKey,value);return value;} } catch {} }
  return navigationMemory.get(fullKey) || null;
}
function storeNavigation(key, value) {
  const fullKey = scopedNavigationKey(key);
  navigationMemory.set(fullKey,value);
  for(const [old,payload] of navigationMemory) if(Date.now()-Number(payload.created_at||0)>NAV_TTL_MS)navigationMemory.delete(old);
  while(navigationMemory.size>32)navigationMemory.delete(navigationMemory.keys().next().value);
  for(const storage of getStorages()){try{storage.setItem(fullKey,JSON.stringify(value));}catch{}}
}
const MAX_INSTANT_PROFILE_FIELDS = 120;

function getStorage() {
  if (typeof window === 'undefined') return null;
  try {
    if (typeof window.localStorage !== 'undefined') return window.localStorage;
  } catch {}
  try {
    if (typeof window.sessionStorage !== 'undefined') return window.sessionStorage;
  } catch {}
  return null;
}

function getStorages() {
  if (typeof window === 'undefined') return [];
  const out = [];
  try { if (window.sessionStorage) out.push(window.sessionStorage); } catch {}
  try { if (window.localStorage) out.push(window.localStorage); } catch {}
  return out;
}

function canUseStorage() {
  return !!getStorage();
}

function cleanupStorage() {
  if(Date.now()-lastStorageCleanupAt<60000)return;
  lastStorageCleanupAt=Date.now();
  const storages = getStorages();
  for (const storage of storages) {
    try {
      Object.keys(storage || {}).forEach((key) => {
        const keyText = String(key || '');
        if (!keyText.startsWith(NAV_STORAGE_PREFIX) && !keyText.startsWith(INSTANT_PROFILE_PREFIX)) return;
        const raw = storage.getItem(keyText);
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          const maxAge = keyText.startsWith(INSTANT_PROFILE_PREFIX) ? INSTANT_PROFILE_TTL_MS : NAV_TTL_MS;
          const createdAt = Number(parsed?.created_at || parsed?.cached_at || parsed?.at || 0);
          if (!createdAt || (Date.now() - createdAt) > maxAge) storage.removeItem(keyText);
        } catch {
          storage.removeItem(keyText);
        }
      });
    } catch {}
  }
}

function scalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeCandidateId(row) {
  return String(row?.candidate_id || row?.id || row || '').trim();
}

function navRowIdentity(raw = {}, candidateId = '', index = 0) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const id = String(candidateId || normalizeCandidateId(row) || '').trim();
  const rowSpecific = String(
    row._nav_row_key
      || row.nav_row_key
      || row.submission_id
      || row.interview_id
      || row.follow_up_id
      || row.followup_id
      || row.task_id
      || row.activity_id
      || row.call_log_id
      || ''
  ).trim();
  if (rowSpecific) return `${id || 'row'}::${rowSpecific}`;
  return id ? id : `row::${index}`;
}

function compactInstantProfile(row = {}, index = 0) {
  const raw = row && typeof row === 'object' ? row : {};
  const candidateId = normalizeCandidateId(raw);
  if (!candidateId) return null;
  const out = { candidate_id: candidateId, full_name: String(raw.full_name || raw.name || raw.candidate_name || candidateId).trim(), _nav_row_key: navRowIdentity(raw, candidateId, index) };
  let copied = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (copied >= MAX_INSTANT_PROFILE_FIELDS) break;
    const cleanKey = String(key || '').trim();
    if (!cleanKey || cleanKey.startsWith('__')) continue;
    const cleanValue = scalar(value);
    if (cleanValue === '') continue;
    out[cleanKey] = cleanValue;
    copied += 1;
  }
  out.candidate_id = candidateId;
  out.full_name = String(out.full_name || out.name || out.candidate_name || candidateId).trim();
  return out;
}

function normalizeNavItems(rows = []) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const candidateId = normalizeCandidateId(row);
      if (!candidateId) return null;
      const compact = compactInstantProfile(typeof row === 'object' ? row : { candidate_id: candidateId }, index);
      const key = String(compact?._nav_row_key || candidateId).toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return compact || { candidate_id: candidateId, full_name: candidateId, _nav_row_key: navRowIdentity({ candidate_id: candidateId }, candidateId, index) };
    })
    .filter(Boolean)
    .slice(0, MAX_NAV_ITEMS);
}

function instantProfileStorageKey(candidateId = '') {
  const id = String(candidateId || '').trim();
  return id ? `${INSTANT_PROFILE_PREFIX}${cachePrincipal()}:${id}` : '';
}

export function writeCandidateInstantProfile(candidateOrRow, rows = []) {
  if (!canUseStorage()) return null;
  cleanupStorage();
  const candidateId = normalizeCandidateId(candidateOrRow);
  if (!candidateId) return null;
  const sourceRow = (candidateOrRow && typeof candidateOrRow === 'object')
    ? candidateOrRow
    : (Array.isArray(rows) ? rows.find((row) => normalizeCandidateId(row) === candidateId) : null);
  const compact = compactInstantProfile(sourceRow || { candidate_id: candidateId }, 0);
  if (!compact) return null;
  const payload = { created_at: Date.now(), item: compact };
  const key = instantProfileStorageKey(candidateId);
  for (const storage of getStorages()) {
    try { storage.setItem(key, JSON.stringify(payload)); } catch {}
  }
  return compact;
}

export function readCandidateInstantProfile(candidateId = '') {
  const key = instantProfileStorageKey(candidateId);
  if (!key) return null;
  cleanupStorage();
  for (const storage of getStorages()) {
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed?.created_at || (Date.now() - Number(parsed.created_at || 0)) > INSTANT_PROFILE_TTL_MS) {
        storage.removeItem(key);
        continue;
      }
      const item = compactInstantProfile(parsed.item || {});
      if (item) return item;
    } catch {}
  }
  return null;
}

function normalizeNavMeta(options = {}) {
  const raw = options && typeof options === 'object' ? options : {};
  const page = Math.max(1, Number(raw.page || raw.currentPage || 1) || 1);
  const pageSize = Math.max(1, Number(raw.page_size || raw.pageSize || 10) || 10);
  const total = Math.max(0, Number(raw.total || raw.totalRows || 0) || 0);
  const hasMore = raw.has_more !== undefined
    ? Boolean(raw.has_more)
    : (raw.hasMore !== undefined ? Boolean(raw.hasMore) : (total ? page * pageSize < total : false));
  return {
    source_api: String(raw.source_api || raw.sourceApi || '').trim(),
    source_kind: String(raw.source_kind || raw.sourceKind || '').trim(),
    page,
    page_size: pageSize,
    total,
    has_more: hasMore,
    updated_at: Date.now(),
  };
}

export function createCandidateNavContext(rows = [], sourcePath = '', options = {}) {
  const navItems = normalizeNavItems(rows);
  if (!navItems.length) return '';
  cleanupStorage();
  const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const meta = normalizeNavMeta(options);
  try {
    storeNavigation(key, {
      created_at: Date.now(),
      source_path: String(sourcePath || '').trim(),
      source_api: meta.source_api,
      source_kind: meta.source_kind,
      page: meta.page,
      page_size: meta.page_size,
      total: meta.total,
      has_more: meta.has_more,
      nav_items: navItems,
    });
    // One compact context already contains every adjacent snapshot. Do not write
    // hundreds of individual profile caches on each list click.
    return key;
  } catch {
    return '';
  }
}

export function readCandidateNavContext(key = '') {
  if (!key) return null;
  cleanupStorage();
  try {
      const parsed = storedNavigation(key);
      if (!parsed || Date.now()-Number(parsed.created_at||0)>NAV_TTL_MS) return null;
      const navItems = normalizeNavItems(parsed?.nav_items || []);
      if (!navItems.length) return null;
      return {
        nav_key: key,
        source_path: String(parsed?.source_path || '').trim(),
        source_api: String(parsed?.source_api || '').trim(),
        source_kind: String(parsed?.source_kind || '').trim(),
        page: Math.max(1, Number(parsed?.page || 1) || 1),
        page_size: Math.max(1, Number(parsed?.page_size || 10) || 10),
        total: Math.max(0, Number(parsed?.total || 0) || 0),
        has_more: Boolean(parsed?.has_more),
        nav_items: navItems,
      };
    } catch {}
  return null;
}

export function appendCandidateNavContext(key = '', rows = [], patch = {}) {
  if (!key) return null;
  const fullKey = scopedNavigationKey(key);
  const newItems = normalizeNavItems(rows);
  try {
      const parsed = storedNavigation(key);
      if (!parsed) return null;
      const current = normalizeNavItems(parsed?.nav_items || []);
      const seen = new Set(current.map((row) => String(row._nav_row_key || row.candidate_id || '').toLowerCase()).filter(Boolean));
      const merged = [...current];
      for (const row of newItems) {
        const id = String(row._nav_row_key || row.candidate_id || '').toLowerCase();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(row);
      }
      const meta = normalizeNavMeta({
        source_api: patch.source_api || parsed?.source_api || '',
        source_kind: patch.source_kind || parsed?.source_kind || '',
        page: patch.page || parsed?.page || 1,
        page_size: patch.page_size || parsed?.page_size || 10,
        total: patch.total ?? parsed?.total ?? 0,
        has_more: patch.has_more ?? parsed?.has_more ?? false,
      });
      const payload = {
        ...parsed,
        source_api: meta.source_api,
        source_kind: meta.source_kind,
        page: meta.page,
        page_size: meta.page_size,
        total: meta.total,
        has_more: meta.has_more,
        nav_items: merged.slice(0, MAX_NAV_ITEMS),
        updated_at: Date.now(),
      };
      storeNavigation(key, payload);
      // Adjacent snapshots remain in this one context; writes stay constant per page.
      return {
        nav_key: key,
        source_path: String(payload.source_path || '').trim(),
        source_api: payload.source_api,
        source_kind: payload.source_kind,
        page: payload.page,
        page_size: payload.page_size,
        total: payload.total,
        has_more: payload.has_more,
        nav_items: payload.nav_items,
      };
    } catch {}
  return readCandidateNavContext(key);
}

export function buildCandidateUrl(candidateId, navKey = '', navRowKey = '') {
  const id = String(candidateId || '').trim();
  if (!id) return '/candidates';
  const params = new URLSearchParams();
  if (navKey) params.set('nav', navKey);
  if (navRowKey) params.set('nav_row', String(navRowKey || ''));
  const query = params.toString();
  return `/candidate/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

export function navigateSameTab(url = '') {
  const target = String(url || '').trim();
  if (!target || typeof window === 'undefined') return '';
  try {
    // CC26_389: SPA same-tab navigation keeps the current CRM shell alive, avoids tab spam,
    // and lets the instant candidate snapshot render while backend refresh continues.
    window.history.pushState({ careerCroxSameTab: true, at: Date.now() }, '', target);
    try { window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state })); }
    catch { window.dispatchEvent(new Event('popstate')); }
    try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch {}
  } catch {
    window.location.assign(target);
  }
  return target;
}

// Kept under the old export name so every existing page keeps working without feature removal.
// CC26_389 changes the behavior from new-tab to fast same-tab SPA navigation.
export function openCandidateProfileInNewTab(candidateOrId, rows = [], options = {}) {
  const candidateId = normalizeCandidateId(candidateOrId);
  if (!candidateId || typeof window === 'undefined') return '';
  const instant = writeCandidateInstantProfile(candidateOrId, rows);
  const navKey = createCandidateNavContext(rows.length ? rows : [candidateOrId], options?.sourcePath || `${window.location.pathname}${window.location.search || ''}`, options);
  const baseUrl = buildCandidateUrl(candidateId, navKey, instant?._nav_row_key || '');
  const url=options.jump?baseUrl+(baseUrl.includes('?')?'&':'?')+'jump='+encodeURIComponent(options.jump):baseUrl;
  navigateSameTab(url);
  return url;
}


// Popup-only navigation: opening a reminder never replaces the user's current CRM page.
export function openCandidateProfileInPopupTab(candidateOrId, rows = [], options = {}) {
  const candidateId = normalizeCandidateId(candidateOrId);
  if (!candidateId || typeof window === 'undefined') return '';
  const instant = writeCandidateInstantProfile(candidateOrId, rows);
  const navKey = createCandidateNavContext(rows.length ? rows : [candidateOrId], options.sourcePath || `${window.location.pathname}${window.location.search || ''}`, options);
  const baseUrl = buildCandidateUrl(candidateId, navKey, instant?._nav_row_key || '');
  const url=options.jump?baseUrl+(baseUrl.includes('?')?'&':'?')+'jump='+encodeURIComponent(options.jump):baseUrl;
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}

// CC26_557 explicit normal-navigation alias; popup helper above continues opening a new tab.
export const openCandidateProfileInSameTab = openCandidateProfileInNewTab;

// CC813: browser-local instant profile snapshots; no per-tick backend requests.
export const DIALER_LIVE_EVENT='career-crox-dialer-live';
let readyCallTab=null;
export function armDialerProfileTab(){
  if(readyCallTab&&!readyCallTab.closed)return;
  readyCallTab=window.open('about:blank','cc_ready_'+Date.now());
  if(readyCallTab){readyCallTab.document.title='Career Crox · Ready';readyCallTab.document.body.textContent='Ready for your next connected call. Keep this tab open.';}
}
export function openDialerProfile(row,requestId='',manual=false){
  const cid=String(row?.candidate_id||'');if(!cid)return false;
  const dedupe=cachePrincipal()+':dialer-open:'+requestId;
  if(!manual&&requestId&&localStorage.getItem(dedupe))return true;
  writeCandidateInstantProfile(row,[row]);
  let win=readyCallTab&&!readyCallTab.closed?readyCallTab:window.open('about:blank','cc_call_'+(requestId||Date.now()).replace(/[^a-z0-9]/gi,'_'));
  if(!win){window.dispatchEvent(new CustomEvent('career-crox-profile-popup-blocked',{detail:{row,requestId}}));return false;}
  readyCallTab=null;win.opener=null;const navKey=createCandidateNavContext([row],'/live-dialing',{sourceKind:'call',totalRows:1,hasMore:false});const target=buildCandidateUrl(cid,navKey,row._nav_row_key||cid);win.location.href=target+(target.includes('?')?'&':'?')+'dialer_live=1';
  if(requestId)localStorage.setItem(dedupe,String(Date.now()));return true;
}
export function installDialerProfileBridge(user){
  function receive(e){const p=e.detail||{};if(p.profile?.candidate_id)writeCandidateInstantProfile(p.profile,[p.profile]);
    const uid=String(p.call?.employee_user_id||p.session?.assigned_user_id||'');
    if(!p.open_profile||uid!==String(user?.user_id||''))return;
    const row=p.profile||{candidate_id:p.call?.candidate_id,full_name:p.call?.candidate_name,phone:p.call?.phone};
    openDialerProfile(row,p.request_id||'',false);
  }
  window.addEventListener(DIALER_LIVE_EVENT,receive);return()=>window.removeEventListener(DIALER_LIVE_EVENT,receive);
}

if(typeof window!=='undefined')window.addEventListener('storage',event=>{if(String(event.key||'').startsWith(NAV_STORAGE_PREFIX))navigationMemory.delete(event.key);});

if(typeof window!=='undefined'){const purge=()=>{navigationMemory.clear();for(const storage of getStorages()){try{for(const key of Object.keys(storage))if(key.startsWith(NAV_STORAGE_PREFIX)||key.startsWith(INSTANT_PROFILE_PREFIX))storage.removeItem(key)}catch{}}};window.addEventListener('career-crox-access-changed',purge);window.addEventListener('career-crox-team-changed',purge);window.addEventListener('career-crox-auth-changed',purge);}
