const NAV_STORAGE_PREFIX = 'careerCroxCandidateNav:';
const INSTANT_PROFILE_PREFIX = 'careerCroxInstantCandidateProfile:';
const NAV_TTL_MS = 12 * 60 * 60 * 1000;
const INSTANT_PROFILE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_NAV_ITEMS = 500;
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
  return id ? `${INSTANT_PROFILE_PREFIX}${id}` : '';
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
  if (!navItems.length || !canUseStorage()) return '';
  cleanupStorage();
  const key = `${NAV_STORAGE_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storage = getStorage();
  if (!storage) return '';
  const meta = normalizeNavMeta(options);
  try {
    storage.setItem(key, JSON.stringify({
      created_at: Date.now(),
      source_path: String(sourcePath || '').trim(),
      source_api: meta.source_api,
      source_kind: meta.source_kind,
      page: meta.page,
      page_size: meta.page_size,
      total: meta.total,
      has_more: meta.has_more,
      nav_items: navItems,
    }));
    for (const row of navItems) writeCandidateInstantProfile(row, navItems);
    return key.slice(NAV_STORAGE_PREFIX.length);
  } catch {
    return '';
  }
}

export function readCandidateNavContext(key = '') {
  if (!key || !canUseStorage()) return null;
  cleanupStorage();
  for (const storage of getStorages()) {
    try {
      const raw = storage.getItem(`${NAV_STORAGE_PREFIX}${key}`);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
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
  }
  return null;
}

export function appendCandidateNavContext(key = '', rows = [], patch = {}) {
  if (!key || !canUseStorage()) return null;
  const fullKey = `${NAV_STORAGE_PREFIX}${key}`;
  const newItems = normalizeNavItems(rows);
  if (!newItems.length) return readCandidateNavContext(key);
  for (const storage of getStorages()) {
    try {
      const raw = storage.getItem(fullKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
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
      storage.setItem(fullKey, JSON.stringify(payload));
      for (const row of newItems) writeCandidateInstantProfile(row, payload.nav_items);
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
  }
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
  const navKey = createCandidateNavContext(rows, options?.sourcePath || `${window.location.pathname}${window.location.search || ''}`, options);
  const url = buildCandidateUrl(candidateId, navKey, instant?._nav_row_key || '');
  navigateSameTab(url);
  return url;
}


// Popup-only navigation: opening a reminder never replaces the user's current CRM page.
export function openCandidateProfileInPopupTab(candidateOrId, rows = [], options = {}) {
  const candidateId = normalizeCandidateId(candidateOrId);
  if (!candidateId || typeof window === 'undefined') return '';
  const instant = writeCandidateInstantProfile(candidateOrId, rows);
  const navKey = createCandidateNavContext(rows, options.sourcePath || `${window.location.pathname}${window.location.search || ''}`, options);
  const url = buildCandidateUrl(candidateId, navKey, instant?._nav_row_key || '');
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}

// CC26_557 explicit normal-navigation alias; popup helper above continues opening a new tab.
export const openCandidateProfileInSameTab = openCandidateProfileInNewTab;
