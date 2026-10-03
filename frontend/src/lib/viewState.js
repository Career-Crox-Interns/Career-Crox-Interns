function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readViewState(key, fallback) {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) || {}) };
  } catch {
    return fallback;
  }
}

export function writeViewState(key, value) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value || {}));
  } catch {}
}

export function clearViewState(key) {
  if (!hasStorage()) return;
  try { window.localStorage.removeItem(key); } catch {}
}
