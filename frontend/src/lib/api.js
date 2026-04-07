const jsonHeaders = { 'Content-Type': 'application/json' };

const inflightGetRequests = new Map();
const recentGetCache = new Map();
const GET_CACHE_TTL_MS = 2600;
const activeBackgroundControllers = new Set();
let writeBusyCounter = 0;

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
  const method = String(options.method || 'GET').toUpperCase();
  const useDedupe = method === 'GET' && !options.body;
  const dedupeKey = useDedupe ? path : '';
  const cacheTtlMs = Number(options.cacheTtlMs ?? GET_CACHE_TTL_MS);
  const now = Date.now();
  const cached = useDedupe ? recentGetCache.get(dedupeKey) : null;
  if (cached && (now - cached.at) < cacheTtlMs) {
    return Promise.resolve(cached.payload);
  }
  if (useDedupe && inflightGetRequests.has(dedupeKey)) {
    return inflightGetRequests.get(dedupeKey);
  }

  const controller = new AbortController();
  const isBackground = Boolean(options.background);
  const timeoutMs = Number(options.timeoutMs || (useDedupe ? 18000 : 90000));
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
            if (res.status === 401 && typeof window !== 'undefined' && !['/api/auth/login', '/api/auth/me'].includes(path)) {
              try { window.dispatchEvent(new CustomEvent('career-crox-auth-expired', { detail: { message: error.message || 'Session expired' } })); } catch {}
            }
            throw error;
          }
          if (useDedupe) recentGetCache.set(dedupeKey, { at: Date.now(), payload });
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
              throw aborted;
            }
            throw new Error('Request timed out. Please retry.');
          }
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

  if (useDedupe) inflightGetRequests.set(dedupeKey, promise);
  return promise;
}

export const api = {
  get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
  post: (path, data, options = {}) => request(path, { ...options, method: 'POST', body: JSON.stringify(data ?? {}) }),
  put: (path, data, options = {}) => request(path, { ...options, method: 'PUT', body: JSON.stringify(data ?? {}) })
};
