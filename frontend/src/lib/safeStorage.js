const IMPORTANT_LOCAL_KEYS = new Set([
  'careerCroxCachedUser',
  'careerCroxSessionLoginAt',
  'careerCroxLastActivityAt',
  'careerCroxTheme',
  'careerCroxCustomTheme',
  'careerCroxLogoutEventAt',
  'careerCroxNotificationTune',
]);

const BLOAT_PREFIXES = [
  'careerCroxFastCache:',
  'careerCroxFastCache',
  'careerCroxPageCache:',
  'careerCroxAutoDialerQueue:v1',
  'cc_page_cache:',
  'candidate_cache:',
  'candidateDetailCache:',
  'report_cache:',
  'submissions_cache:',
  'interviews_cache:',
];

const BLOAT_CONTAINS = [
  'FastCache',
  'PageCache',
  'AutoDialerQueue',
  '_summary',
];

function isQuotaError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('quota') || name.includes('storage') || message.includes('quota') || message.includes('exceeded the quota');
}

function shouldRemoveKey(key, value = '', aggressive = false) {
  if (!key) return false;
  // Never clear unsaved work, even if its JSON is large. Only known disposable caches
  // and optional snooze markers can be removed by the recovery/quota cleaner.
  if (IMPORTANT_LOCAL_KEYS.has(key) || key.startsWith('careerCroxCandidateDurableDraft_v6_finaldraft:')) return false;
  if (BLOAT_PREFIXES.some((prefix) => key.startsWith(prefix))) return true;
  if (BLOAT_CONTAINS.some((token) => key.includes(token))) return true;
  if (aggressive && /^task_snooze_|^followup_snooze_|^approval_snooze_|^revenue_snooze_|^semi_hourly_opened_/.test(key)) return true;
  // Unknown large keys may be real unsaved CRM work. Never infer that size means cache.
  return false;
}

export function clearCareerCroxBrowserBloat(options = {}) {
  if (typeof window === 'undefined') return 0;
  try { if (!window.localStorage) return 0; } catch { return 0; }
  const aggressive = !!options.aggressive;
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key) keys.push(key);
    }
    for (const key of keys) {
      let value = '';
      try { value = window.localStorage.getItem(key) || ''; } catch { value = ''; }
      if (shouldRemoveKey(key, value, aggressive)) {
        try { window.localStorage.removeItem(key); removed += 1; } catch {}
      }
    }
  } catch {}
  try {
    if (window.sessionStorage) {
      const sessionKeys = [];
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        if (key) sessionKeys.push(key);
      }
      for (const key of sessionKeys) {
        let value = '';
        try { value = window.sessionStorage.getItem(key) || ''; } catch { value = ''; }
        if (shouldRemoveKey(key, value, aggressive) && String(value || '').length > 180000) {
          try { window.sessionStorage.removeItem(key); removed += 1; } catch {}
        }
      }
    }
  } catch {}
  return removed;
}

export function safeLocalSetItem(key, value, options = {}) {
  if (typeof window === 'undefined' || !key) return false;
  try { if (!window.localStorage) return false; } catch { return false; }
  const text = String(value ?? '');
  const maxBytes = Number(options.maxBytes || 180000);
  const fallbackToSession = options.fallbackToSession !== false;
  if (!IMPORTANT_LOCAL_KEYS.has(String(key)) && text.length > maxBytes) {
    if (fallbackToSession) {
      try { window.sessionStorage?.setItem(key, text); return true; } catch {}
    }
    return false;
  }
  try {
    window.localStorage.setItem(key, text);
    return true;
  } catch (error) {
    clearCareerCroxBrowserBloat({ aggressive: isQuotaError(error) });
    try {
      window.localStorage.setItem(key, text);
      return true;
    } catch {
      if (fallbackToSession) {
        try { window.sessionStorage?.setItem(key, text); return true; } catch {}
      }
      return false;
    }
  }
}

export function safeSessionSetItem(key, value) {
  if (typeof window === 'undefined' || !key) return false;
  try { if (!window.sessionStorage) return false; } catch { return false; }
  try { window.sessionStorage.setItem(key, String(value ?? '')); return true; } catch { return false; }
}

export function installCareerCroxStorageGuard() {
  if (typeof window === 'undefined') return;
  if (window.__CAREER_CROX_STORAGE_GUARD_V90__) return;
  window.__CAREER_CROX_STORAGE_GUARD_V90__ = true;
  clearCareerCroxBrowserBloat({ aggressive: false });
  try {
    const proto = window.Storage && window.Storage.prototype;
    if (!proto || proto.__careerCroxSafeSetItemV90) return;
    const originalSetItem = proto.setItem;
    Object.defineProperty(proto, '__careerCroxSafeSetItemV90', { value: true, configurable: false });
    proto.setItem = function patchedCareerCroxSetItem(key, value) {
      try {
        return originalSetItem.call(this, key, value);
      } catch (error) {
        if (this === window.localStorage || isQuotaError(error)) {
          clearCareerCroxBrowserBloat({ aggressive: isQuotaError(error) });
          try { return originalSetItem.call(this, key, value); } catch {}
          if (this === window.localStorage) {
            try { return window.sessionStorage?.setItem(key, value); } catch {}
          }
          return undefined;
        }
        return undefined;
      }
    };
  } catch {}
}
