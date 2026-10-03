import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { applyCustomTheme, clearCustomTheme, defaultCustomTheme } from './theme';

const AuthContext = createContext(null);
const USER_CACHE_KEY = 'careerCroxCachedUser';
const SESSION_LOGIN_AT_KEY = 'careerCroxSessionLoginAt';
const SESSION_LAST_ACTIVITY_KEY = 'careerCroxLastActivityAt';
const SESSION_LOGOUT_EVENT_KEY = 'careerCroxLogoutEventAt';
const SESSION_EXPIRED_MESSAGE_KEY = 'careerCroxSessionExpiredMessage';
const OFFICE_JOIN_SESSION_KEY = 'careerCroxOfficeJoinedSession';
const INACTIVITY_LOGOUT_MS = Number(import.meta?.env?.VITE_CRM_INACTIVITY_LOGOUT_MS || (10 * 60 * 1000));
const SESSION_KEEPALIVE_MS = Number(import.meta?.env?.VITE_SESSION_KEEPALIVE_MS || (60 * 60 * 1000));
const AUTO_AUTH_KEEPALIVE_ENABLED = String(import.meta?.env?.VITE_AUTO_AUTH_KEEPALIVE_ENABLED || 'false').toLowerCase() === 'true';
const DAILY_LOGOUT_HOUR = 21;

function readThemePreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function parseTheme(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...defaultCustomTheme, ...parsed };
  } catch {
    return null;
  }
}

function loadCachedUser() {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // CC20 cached user shape guard: corrupted localStorage should never block login page.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      localStorage.removeItem(USER_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    try { localStorage.removeItem(USER_CACHE_KEY); } catch {}
    return null;
  }
}

function persistCachedUser(user) {
  try {
    if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_CACHE_KEY);
  } catch {}
}

function safeNumberFromStorage(key) {
  try {
    const value = Number(localStorage.getItem(key) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function setSessionMessage(message) {
  try {
    sessionStorage.setItem(SESSION_EXPIRED_MESSAGE_KEY, message);
  } catch {}
}

function istDayKey(value = Date.now()) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms + 19800000).toISOString().slice(0, 10) : '';
}

function validDailyOfficeState(user = null) {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFICE_JOIN_SESSION_KEY) || 'null');
    if (!saved?.joined_at || !saved?.manual_confirmed_at || !saved?.identity) return null;
    if (istDayKey(saved.joined_at) !== istDayKey() || istDayKey(saved.manual_confirmed_at) !== istDayKey()) return null;
    const identity = String(user?.user_id || user?.recruiter_code || user?.username || '').trim();
    if (identity && String(saved.identity || '') !== identity) return null;
    return saved;
  } catch { return null; }
}

function clearWorkTimerState(preserveDailyOffice = false) {
  try {
    localStorage.removeItem('cc408_shared_login_work_timer');
    localStorage.removeItem('cc434_work_activity_at');
    if (!preserveDailyOffice) {
      localStorage.removeItem('cc456_session_activity_state');
      localStorage.removeItem(OFFICE_JOIN_SESSION_KEY);
    }
  } catch {}
  try {
    sessionStorage.removeItem('cc399_session_work_timer');
    sessionStorage.removeItem('cc406_work_timer_state');
  } catch {}
  if (!preserveDailyOffice) {
    try { window.dispatchEvent(new CustomEvent('career-crox-work-timer-reset')); } catch {}
  }
}

function clearLocalSession(message = '') {
  if (message) setSessionMessage(message);
  const preserveDailyOffice = String(message || '').toLowerCase().includes('inactivity');
  persistCachedUser(null);
  clearWorkTimerState(preserveDailyOffice);
  try {
    localStorage.removeItem(SESSION_LOGIN_AT_KEY);
    localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
  } catch {}
}

function latestDailyCutoffMs(nowMs = Date.now()) {
  const cutoff = new Date(nowMs);
  cutoff.setHours(DAILY_LOGOUT_HOUR, 0, 0, 0);
  if (nowMs < cutoff.getTime()) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff.getTime();
}

function nextDailyCutoffMs(nowMs = Date.now()) {
  const cutoff = new Date(nowMs);
  cutoff.setHours(DAILY_LOGOUT_HOUR, 0, 0, 0);
  if (nowMs >= cutoff.getTime()) cutoff.setDate(cutoff.getDate() + 1);
  return cutoff.getTime();
}

function getLocalSessionExpiryReason(nowMs = Date.now()) {
  const cachedUser = loadCachedUser();
  if (!cachedUser) return '';
  const lastActivityAt = safeNumberFromStorage(SESSION_LAST_ACTIVITY_KEY);
  if (lastActivityAt && nowMs - lastActivityAt >= INACTIVITY_LOGOUT_MS) {
    return 'CRM locked and logged out after 10 minutes of inactivity.';
  }
  return '';
}


function startLocalSession(forceNewLogin = false, user = null) {
  const now = Date.now();
  const dailyOffice = forceNewLogin ? validDailyOfficeState(user) : null;
  if (forceNewLogin) clearWorkTimerState(Boolean(dailyOffice));
  try {
    const existingLoginAt = Number(localStorage.getItem(SESSION_LOGIN_AT_KEY) || 0);
    const nextLoginAt = (forceNewLogin || !Number.isFinite(existingLoginAt) || existingLoginAt <= 0) ? now : existingLoginAt;
    localStorage.setItem(SESSION_LOGIN_AT_KEY, String(nextLoginAt));
    if (forceNewLogin || !safeNumberFromStorage(SESSION_LAST_ACTIVITY_KEY)) localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(now));
    if (dailyOffice) {
      localStorage.setItem(OFFICE_JOIN_SESSION_KEY, JSON.stringify({ ...dailyOffice, login_marker: String(nextLoginAt) }));
      const tracker = JSON.parse(localStorage.getItem('cc456_session_activity_state') || 'null');
      if (tracker && typeof tracker === 'object') localStorage.setItem('cc456_session_activity_state', JSON.stringify({ ...tracker, login_marker: String(nextLoginAt), _last_write_at: 0 }));
    }
  } catch {}
}

function markSessionActivity(force = false) {
  const now = Date.now();
  const previous = safeNumberFromStorage(SESSION_LAST_ACTIVITY_KEY);
  if (!force && previous && now - previous < 15000) return previous;
  try {
    localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(now));
  } catch {}
  return now;
}

function broadcastLocalLogout(reason = '') {
  try {
    localStorage.setItem(SESSION_LOGOUT_EVENT_KEY, JSON.stringify({ at: Date.now(), reason }));
  } catch {}
}

function autoLogoutReasonCode(message = '') {
  const text = String(message || '').toLowerCase();
  if (text.includes('9 pm') || text.includes('daily')) return 'auto_daily_9pm';
  if (text.includes('inactivity') || text.includes('10 minutes')) return 'auto_inactivity_10m';
  return 'auto_session_expired';
}

async function notifyAutoLogoutToBackend(message = '') {
  const reason = String(message || 'CRM session auto logout completed.').trim();
  const code = autoLogoutReasonCode(reason);
  try {
    const dedupeKey = `careerCroxAutoLogoutNotify:${code}:${safeNumberFromStorage(SESSION_LOGIN_AT_KEY) || ''}`;
    const previous = Number(localStorage.getItem(dedupeKey) || 0);
    if (previous && Date.now() - previous < 120000) return;
    localStorage.setItem(dedupeKey, String(Date.now()));
  } catch {}
  try {
    await api.post('/api/auth/logout', { logout_reason: code, reason, notify_leadership: '1' }, { cacheTtlMs: 0, retries: 0, timeoutMs: 8000, keepalive: true });
  } catch {}
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const reason = getLocalSessionExpiryReason();
    if (reason) {
      clearLocalSession(reason);
      return null;
    }
    return loadCachedUser();
  });
  const [booted, setBooted] = useState(false);
  const [theme, setTheme] = useState(() => {
    const saved = readThemePreference('careerCroxTheme') || 'orange';
    const cached = loadCachedUser();
    return ['burgundy', 'crimson-noir'].includes(saved) && String(cached?.role || cached?.designation || '').toLowerCase() !== 'manager' ? 'orange' : saved;
  });
  const [customTheme, setCustomTheme] = useState(() => parseTheme(readThemePreference('careerCroxCustomTheme')));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('careerCroxTheme', theme); } catch {}
  }, [theme]);

  useEffect(() => {
    if (customTheme) {
      try { localStorage.setItem('careerCroxCustomTheme', JSON.stringify(customTheme)); } catch {}
      applyCustomTheme(customTheme);
      return;
    }
    try { localStorage.removeItem('careerCroxCustomTheme'); } catch {}
    clearCustomTheme();
  }, [customTheme]);

  useEffect(() => {
    let active = true;
    const localExpiry = getLocalSessionExpiryReason();
    if (localExpiry) {
      clearLocalSession(localExpiry);
      setUser(null);
      setBooted(true);
      return () => { active = false; };
    }
    const cachedAtBoot = loadCachedUser();
    if (!cachedAtBoot) {
      persistCachedUser(null);
      setUser(null);
      setBooted(true);
      return () => { active = false; };
    }
    api.get('/api/auth/me', { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 })
      .then((data) => {
        if (!active) return;
        const nextUser = data.user || null;
        setUser(nextUser);
        persistCachedUser(nextUser);
        if (nextUser) {
          startLocalSession(false);
          // Credential verification is not human activity; do not reset the idle clock.
        }
        if (data.user?.theme_name) setTheme(['burgundy', 'crimson-noir'].includes(data.user.theme_name) && String(data.user.role || '').toLowerCase() !== 'manager' ? 'orange' : data.user.theme_name);
        setCustomTheme(parseTheme(data.user?.custom_theme_json || ''));
      })
      .catch((error) => {
        if (!active) return;
        const cachedUser = loadCachedUser();
        const status = Number(error?.status || 0);
        if (cachedUser && status !== 401) {
          setUser(cachedUser);
          return;
        }
        persistCachedUser(null);
        setUser(null);
      })
      .finally(() => {
        if (active) setBooted(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function handleAuthExpired(event) {
      const message = event?.detail?.message || 'Session expired. Login again to continue.';
      const localOnly = Boolean(event?.detail?.localOnly);
      if (localOnly) {
        await notifyAutoLogoutToBackend(message);
        clearLocalSession(message);
        broadcastLocalLogout(message);
        if (active) setUser(null);
        return;
      }
      const retryPlanMs = [0, 700, 1600];
      for (const delayMs of retryPlanMs) {
        if (!active) return;
        if (delayMs > 0) await wait(delayMs);
        try {
          const data = await api.get('/api/auth/me', { cacheTtlMs: 0, retries: 0, timeoutMs: 10000 });
          if (!active) return;
          if (data?.user) {
            setUser(data.user || null);
            persistCachedUser(data.user || null);
            startLocalSession(false);
            // Auth retry is not human activity.
            if (data.user?.theme_name) setTheme(['burgundy', 'crimson-noir'].includes(data.user.theme_name) && String(data.user.role || '').toLowerCase() !== 'manager' ? 'orange' : data.user.theme_name);
            setCustomTheme(parseTheme(data.user?.custom_theme_json || ''));
            return;
          }
        } catch (error) {
          const cachedUser = loadCachedUser();
          const status = Number(error?.status || 0);
          if (active && cachedUser && status !== 401) {
            setUser(cachedUser);
            return;
          }
        }
      }
      clearLocalSession(message);
      if (active) setUser(null);
    }
    window.addEventListener('career-crox-auth-expired', handleAuthExpired);
    return () => {
      active = false;
      window.removeEventListener('career-crox-auth-expired', handleAuthExpired);
    };
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    let disposed = false;
    let activityTimer = null;
    let keepAliveTimer = null;
    let lastActivityWriteAt = 0;

    async function expireAndLogout(message) {
      if (disposed || window.__CC602_IDLE_LOGOUT_RUNNING__) return;
      window.__CC602_IDLE_LOGOUT_RUNNING__ = true;
      window.__CC602_NETWORK_PAUSED__ = true;
      window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'));
      // Unmount every CRM page immediately (closing chat SSE, timers and listeners).
      clearLocalSession(message);
      broadcastLocalLogout(message);
      setUser(null);
      // The logout request is a single bounded keepalive request, not a polling loop.
      void notifyAutoLogoutToBackend(message).finally(() => { window.__CC602_IDLE_LOGOUT_RUNNING__ = false; });
    }

    function scheduleExpiryCheck() {
      if (activityTimer) window.clearTimeout(activityTimer);
      const now = Date.now();
      const lastActivityAt = safeNumberFromStorage(SESSION_LAST_ACTIVITY_KEY) || now;
      const inactivityDueAt = lastActivityAt + INACTIVITY_LOGOUT_MS;
      const dailyDueAt = nextDailyCutoffMs(now);
      const nextDueAt = Math.min(inactivityDueAt, dailyDueAt);
      activityTimer = window.setTimeout(() => {
        if (disposed) return;
        const reason = getLocalSessionExpiryReason();
        if (reason) {
          expireAndLogout(reason);
          return;
        }
        scheduleExpiryCheck();
      }, Math.max(1000, nextDueAt - now + 250));
    }

    function noteActivity(event) {
      if (disposed) return;
      if (event?.type === 'visibilitychange') { scheduleExpiryCheck(); return; }
      if (event?.isTrusted === false) return;
      const reason = getLocalSessionExpiryReason();
      if (reason) { void expireAndLogout(reason); return; }
      const now = Date.now();
      if (now - lastActivityWriteAt < 15000) return;
      lastActivityWriteAt = now;
      markSessionActivity(true);
      scheduleExpiryCheck();
    }

    const startupExpiry = getLocalSessionExpiryReason();
    if (startupExpiry) {
      expireAndLogout(startupExpiry);
      return () => { disposed = true; };
    }

    // Remounts and tab wake-ups must not extend an expired session.
    scheduleExpiryCheck();

    const events = ['click', 'keydown', 'wheel', 'touchstart', 'pointerdown'];
    events.forEach((eventName) => window.addEventListener(eventName, noteActivity, { passive: true }));
    window.addEventListener('pageshow', scheduleExpiryCheck);
    document.addEventListener('visibilitychange', scheduleExpiryCheck);

    // CC26_81: controlled usage mode. Auth keepalive is OFF by default; local timer handles expiry.
    // Enable only with VITE_AUTO_AUTH_KEEPALIVE_ENABLED=true when absolutely needed.
    if (AUTO_AUTH_KEEPALIVE_ENABLED) {
      keepAliveTimer = window.setInterval(() => {
        if (disposed || document.visibilityState === 'hidden') return;
        api.get('/api/auth/me', { cacheTtlMs: 0, retries: 0, timeoutMs: 8000, background: true })
          .then(() => {
            // Keepalive must not impersonate a real employee interaction.
            scheduleExpiryCheck();
          })
          .catch(() => {});
      }, SESSION_KEEPALIVE_MS);
    }

    // CC26_692: no periodic auth/activity network timer. The loaded idle-egress guard
    // sends one throttled pulse only after a trusted human interaction, so active sessions
    // remain valid without duplicate background writes.
    const activityPulse = null;

    function handleStorage(event) {
      if (event.key !== SESSION_LOGOUT_EVENT_KEY || !event.newValue) return;
      let reason = 'Session ended. Login again to continue.';
      try {
        const payload = JSON.parse(event.newValue);
        reason = payload?.reason || reason;
      } catch {}
      clearLocalSession(reason);
      if (!disposed) setUser(null);
    }
    window.addEventListener('storage', handleStorage);

    return () => {
      disposed = true;
      if (activityTimer) window.clearTimeout(activityTimer);
      if (activityPulse) window.clearInterval(activityPulse);
      if (keepAliveTimer) window.clearInterval(keepAliveTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, noteActivity));
      window.removeEventListener('pageshow', scheduleExpiryCheck);
      document.removeEventListener('visibilitychange', scheduleExpiryCheck);
      window.removeEventListener('storage', handleStorage);
    };
  }, [user?.username]);

  const value = useMemo(() => ({
    user,
    booted,
    theme,
    setTheme,
    customTheme,
    setCustomTheme,
    resetCustomTheme() {
      setCustomTheme(null);
      clearCustomTheme();
      try { localStorage.removeItem('careerCroxCustomTheme'); } catch {}
    },
    async persistTheme(nextTheme = theme, nextCustomTheme = customTheme) {
      await api.post('/api/theme', { theme_name: nextTheme, custom_theme_json: nextCustomTheme ? JSON.stringify(nextCustomTheme) : '' });
    },
    async login(username, password) {
      const data = await api.post('/api/auth/login', { username, password });
      if (data.user) { window.__CC602_NETWORK_PAUSED__ = false; window.__CC602_IDLE_LOGOUT_RUNNING__ = false; startLocalSession(true, data.user || {}); }
      persistCachedUser(data.user || null);
      setUser(data.user);
      if (data.user?.theme_name) setTheme(['burgundy', 'crimson-noir'].includes(data.user.theme_name) && String(data.user.role || '').toLowerCase() !== 'manager' ? 'orange' : data.user.theme_name);
      setCustomTheme(parseTheme(data.user?.custom_theme_json || ''));
      return data;
    },
    async logout() {
      try {
        await api.post('/api/auth/logout', {}, { cacheTtlMs: 0, retries: 0, timeoutMs: 8000 });
      } catch (error) {
        if (Number(error?.status || 0) === 409 || String(error?.message || '').toLowerCase().includes('daily attendance report')) {
          try {
            window.dispatchEvent(new CustomEvent('career-crox-report-required-before-logout', { detail: { message: error.message || 'Send Daily Attendance Report before logout.' } }));
          } catch {}
          throw error;
        }
        return;
      }
      window.__CC602_NETWORK_PAUSED__ = true;
      window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'));
      clearLocalSession('Logged out successfully.');
      broadcastLocalLogout('Logged out successfully.');
      setUser(null);
    }
  }), [user, booted, theme, customTheme]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
