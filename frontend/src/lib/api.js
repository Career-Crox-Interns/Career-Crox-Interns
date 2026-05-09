const jsonHeaders = { 'Content-Type': 'application/json' };

const inflightGetRequests = new Map();
const recentGetCache = new Map();
const GET_CACHE_TTL_MS = 15000;
const MAX_STALE_INFLIGHT_MS = 45000;
const activeBackgroundControllers = new Set();
let writeBusyCounter = 0;

const USER_CACHE_KEY = 'careerCroxCachedUser';
const SESSION_LOGIN_AT_KEY = 'careerCroxSessionLoginAt';
const SESSION_LAST_ACTIVITY_KEY = 'careerCroxLastActivityAt';
const SESSION_EXPIRED_MESSAGE_KEY = 'careerCroxSessionExpiredMessage';
const INACTIVITY_LOGOUT_MS = 40 * 60 * 1000;
const DAILY_LOGOUT_HOUR = 21;

const PERSISTENT_GET_CACHE_PREFIX = 'careerCroxFastCache:v31:';
const PERSISTENT_GET_CACHE_MAX_AGE_MS = Number(import.meta?.env?.VITE_STALE_CACHE_MAX_AGE_MS || (12 * 60 * 60 * 1000));
const PERSISTENT_GET_CACHE_MAX_BYTES = Number(import.meta?.env?.VITE_STALE_CACHE_MAX_BYTES || 1400000);

function stableCacheKey(path = '') {
  return `${PERSISTENT_GET_CACHE_PREFIX}${String(path || '').slice(0, 700)}`;
}

function isPersistentGetCacheAllowed(path = '') {
  const clean = String(path || '');
  if (!clean.startsWith('/api/')) return false;
  if (clean.includes('/download') || clean.includes('/export')) return false;
  if (clean.startsWith('/api/auth/')) return false;
  if (clean.includes('/files/')) return false;
  return true;
}

function readPersistentGetCache(path = '') {
  if (typeof window === 'undefined' || !isPersistentGetCacheAllowed(path)) return null;
  try {
    const raw = window.localStorage.getItem(stableCacheKey(path));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if ((Date.now() - Number(parsed.at || 0)) > PERSISTENT_GET_CACHE_MAX_AGE_MS) return null;
    return parsed.payload ?? null;
  } catch {
    return null;
  }
}

function writePersistentGetCache(path = '', payload) {
  if (typeof window === 'undefined' || !isPersistentGetCacheAllowed(path) || payload === undefined) return;
  try {
    const raw = JSON.stringify({ at: Date.now(), payload });
    if (raw.length > PERSISTENT_GET_CACHE_MAX_BYTES) return;
    window.localStorage.setItem(stableCacheKey(path), raw);
  } catch {}
}

function stalePayloadForFailure(path = '', error = null, isBackground = false) {
  if (error?.status === 401 || error?.code === 'LOCAL_SESSION_EXPIRED') return null;
  const payload = readPersistentGetCache(path);
  if (!payload || typeof payload !== 'object') return payload;
  return {
    ...payload,
    __stale: true,
    __stale_message: isBackground ? '' : 'Showing saved CRM data while the server catches up.',
  };
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
  if (typeof window === 'undefined') return '';
  if (!hasCachedUser()) return '';
  if (path === '/api/auth/login' || path === '/api/auth/logout') return '';

  const loginAt = safeNumberFromStorage(SESSION_LOGIN_AT_KEY);
  const lastActivityAt = safeNumberFromStorage(SESSION_LAST_ACTIVITY_KEY);
  if (!loginAt || !lastActivityAt) return '';
  if (nowMs - lastActivityAt >= INACTIVITY_LOGOUT_MS) return 'Logged out after 40 minutes of inactivity. Login again to continue.';
  if (loginAt < latestDailyCutoffMs(nowMs)) return 'Daily 9 PM logout completed. Login again to continue.';
  return '';
}

function stopRequestIfLocalSessionExpired(path) {
  const message = localSessionExpiryReason(path);
  if (!message) return;
  try {
    window.sessionStorage.setItem(SESSION_EXPIRED_MESSAGE_KEY, message);
    window.localStorage.removeItem(USER_CACHE_KEY);
    window.localStorage.removeItem(SESSION_LOGIN_AT_KEY);
    window.localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
    window.dispatchEvent(new CustomEvent('career-crox-auth-expired', { detail: { message, localOnly: true } }));
  } catch {}
  const error = new Error(message);
  error.status = 401;
  error.code = 'LOCAL_SESSION_EXPIRED';
  throw error;
}

function shouldEmitAuthExpired(path, status, message, isBackground = false) {
  if (Number(status || 0) !== 401) return false;
  if (isBackground) return false;
  if (['/api/auth/login', '/api/auth/me'].includes(path)) return false;
  const text = String(message || '').toLowerCase();
  return text.includes('not authenticated') || text.includes('invalid session') || text.includes('session expired') || text.includes('active on another device') || text.includes('inactivity') || text.includes('9 pm');
}

function abortBackgroundRequests() {
  for (const controller of [...activeBackgroundControllers]) {
    try { controller.abort('background-preempted'); } catch {}
  }
  activeBackgroundControllers.clear();
}

async function parseResponsePayload(res) {
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return payload;
}

async function request(path, options = {}) {
  stopRequestIfLocalSessionExpired(path);

  const method = String(options.method || 'GET').toUpperCase();
  const useDedupe = method === 'GET' && !options.body;
  const dedupeKey = useDedupe ? path : '';
  const cacheTtlMs = Number(options.cacheTtlMs ?? (options.background ? Math.max(GET_CACHE_TTL_MS, 30000) : GET_CACHE_TTL_MS));
  const now = Date.now();
  const cached = useDedupe ? recentGetCache.get(dedupeKey) : null;
  if (cached && (now - cached.at) < cacheTtlMs) {
    return Promise.resolve(cached.payload);
  }
  const savedPayload = useDedupe ? readPersistentGetCache(dedupeKey) : null;
  if (savedPayload && options.preferStale === true) {
    return Promise.resolve(savedPayload);
  }
  if (useDedupe && inflightGetRequests.has(dedupeKey)) {
    const current = inflightGetRequests.get(dedupeKey);
    if (current?.promise && (now - Number(current.at || 0)) < MAX_STALE_INFLIGHT_MS) return current.promise;
    inflightGetRequests.delete(dedupeKey);
  }

  const controller = new AbortController();
  const isBackground = Boolean(options.background);
  const timeoutMs = Number(options.timeoutMs || (useDedupe ? 30000 : 90000));
  const timeout = window.setTimeout(() => controller.abort('request-timeout'), timeoutMs);
  const retries = Number(options.retries ?? (useDedupe ? 1 : 0));

  const promise = (async () => {
    const trackWriteBusy = method !== 'GET' && !isBackground;
    if (isBackground) activeBackgroundControllers.add(controller);
    if (trackWriteBusy) {
      abortBackgroundRequests();
      beginWriteBusy();
    }
    try {
      let attempt = 0;
      while (true) {
        try {
          const res = await fetch(path, {
            credentials: 'include',
            headers: options.body ? jsonHeaders : undefined,
            ...options,
            signal: options.signal || controller.signal,
          });
          const payload = await parseResponsePayload(res);
          if (!res.ok) {
            const error = new Error(buildMessage(payload, 'Request failed'));
            error.status = res.status;
            if (typeof window !== 'undefined' && shouldEmitAuthExpired(path, res.status, error.message || 'Session expired', isBackground)) {
              try { window.dispatchEvent(new CustomEvent('career-crox-auth-expired', { detail: { message: error.message || 'Session expired' } })); } catch {}
            }
            throw error;
          }
          markApiSessionActivity(false);
          if (useDedupe) {
            recentGetCache.set(dedupeKey, { at: Date.now(), payload });
            writePersistentGetCache(dedupeKey, payload);
          } else clearGetRequestCache();
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
      if (useDedupe) inflightGetRequests.delete(dedupeKey);
      if (trackWriteBusy) endWriteBusy();
    }
  })();

  if (useDedupe) inflightGetRequests.set(dedupeKey, { at: Date.now(), promise });
  return promise;
}

export const api = {
  get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
  post: (path, data, options = {}) => request(path, { ...options, method: 'POST', body: JSON.stringify(data ?? {}) }),
  put: (path, data, options = {}) => request(path, { ...options, method: 'PUT', body: JSON.stringify(data ?? {}) }),
  del: (path, options = {}) => request(path, { ...options, method: 'DELETE' })
};
