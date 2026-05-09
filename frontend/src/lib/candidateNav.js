const NAV_STORAGE_PREFIX = 'careerCroxCandidateNav:';
const NAV_TTL_MS = 12 * 60 * 60 * 1000;

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

function canUseStorage() {
  return !!getStorage();
}

function cleanupStorage() {
  const storage = getStorage();
  if (!storage) return;
  try {
    Object.keys(storage || {}).forEach((key) => {
      if (!String(key).startsWith(NAV_STORAGE_PREFIX)) return;
      const raw = storage.getItem(key);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed?.created_at || (Date.now() - Number(parsed.created_at || 0)) > NAV_TTL_MS) {
          storage.removeItem(key);
        }
      } catch {
        storage.removeItem(key);
      }
    });
  } catch {}
}

function normalizeNavItems(rows = []) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const candidateId = String(row?.candidate_id || row?.id || row || '').trim();
      if (!candidateId) return null;
      const key = candidateId.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        candidate_id: candidateId,
        full_name: String(row?.full_name || row?.name || '').trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 500);
}

export function createCandidateNavContext(rows = [], sourcePath = '') {
  const navItems = normalizeNavItems(rows);
  if (!navItems.length || !canUseStorage()) return '';
  cleanupStorage();
  const key = `${NAV_STORAGE_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storage = getStorage();
  if (!storage) return '';
  try {
    storage.setItem(key, JSON.stringify({
      created_at: Date.now(),
      source_path: String(sourcePath || '').trim(),
      nav_items: navItems,
    }));
    return key.slice(NAV_STORAGE_PREFIX.length);
  } catch {
    return '';
  }
}

export function readCandidateNavContext(key = '') {
  if (!key || !canUseStorage()) return null;
  cleanupStorage();
  try {
    const storage = getStorage();
    if (!storage) return null;
    const raw = storage.getItem(`${NAV_STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const navItems = normalizeNavItems(parsed?.nav_items || []);
    if (!navItems.length) return null;
    return {
      nav_key: key,
      source_path: String(parsed?.source_path || '').trim(),
      nav_items: navItems,
    };
  } catch {
    return null;
  }
}

export function buildCandidateUrl(candidateId, navKey = '') {
  const id = String(candidateId || '').trim();
  if (!id) return '/candidates';
  const params = new URLSearchParams();
  if (navKey) params.set('nav', navKey);
  const query = params.toString();
  return `/candidate/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

export function openCandidateProfileInNewTab(candidateOrId, rows = [], options = {}) {
  const candidateId = String(candidateOrId?.candidate_id || candidateOrId || '').trim();
  if (!candidateId || typeof window === 'undefined') return '';
  const navKey = createCandidateNavContext(rows, options?.sourcePath || `${window.location.pathname}${window.location.search || ''}`);
  const url = buildCandidateUrl(candidateId, navKey);
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}
