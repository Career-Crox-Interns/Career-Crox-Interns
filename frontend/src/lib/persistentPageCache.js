const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function parseStored(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data')) {
      const age = now() - Number(parsed.cachedAt || 0);
      if (Number.isFinite(age) && age >= 0 && age <= MAX_CACHE_AGE_MS) return parsed.data;
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function readPageCache(key, fallback = null) {
  if (!key || typeof window === 'undefined') return fallback;
  const storages = [window.sessionStorage, window.localStorage].filter(Boolean);
  for (const storage of storages) {
    try {
      const value = parseStored(storage.getItem(key));
      if (value !== null && value !== undefined) return value;
    } catch {}
  }
  return fallback;
}

export function writePageCache(key, data) {
  if (!key || typeof window === 'undefined') return;
  const payload = JSON.stringify({ cachedAt: now(), data });
  try { window.sessionStorage.setItem(key, payload); } catch {}
  try { window.localStorage.setItem(key, payload); } catch {}
}
