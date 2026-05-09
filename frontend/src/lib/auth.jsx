import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { applyCustomTheme, clearCustomTheme, defaultCustomTheme } from './theme';

const AuthContext = createContext(null);
const USER_CACHE_KEY = 'careerCroxCachedUser';
const SESSION_LOGIN_AT_KEY = 'careerCroxSessionLoginAt';
const SESSION_LAST_ACTIVITY_KEY = 'careerCroxLastActivityAt';
const SESSION_LOGOUT_EVENT_KEY = 'careerCroxLogoutEventAt';
const SESSION_EXPIRED_MESSAGE_KEY = 'careerCroxSessionExpiredMessage';
const INACTIVITY_LOGOUT_MS = Number(import.meta?.env?.VITE_CRM_INACTIVITY_LOGOUT_MS || (4 * 60 * 60 * 1000));
const SESSION_KEEPALIVE_MS = 8 * 60 * 1000;
const DAILY_LOGOUT_HOUR = 21;

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

function clearLocalSession(message = '') {
  if (message) setSessionMessage(message);
  persistCachedUser(null);
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

  const loginAt = safeNumberFromStorage(SESSION_LOGIN_AT_KEY);
  const lastActivityAt = safeNumberFromStorage(SESSION_LAST_ACTIVITY_KEY);

  if (!loginAt || !lastActivityAt) {
    return '';
  }
  if (nowMs - lastActivityAt >= INACTIVITY_LOGOUT_MS) {
    return 'Logged out after 40 minutes of inactivity. Login again to continue.';
  }
  if (loginAt < latestDailyCutoffMs(nowMs)) {
    return 'Daily 9 PM logout completed. Login again to continue.';
  }
  return '';
}

function startLocalSession() {
  const now = Date.now();
  try {
    localStorage.setItem(SESSION_LOGIN_AT_KEY, String(now));
    localStorage.setItem(SESSION_LAST_ACTIVITY_KEY, String(now));
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
  const [theme, setTheme] = useState(localStorage.getItem('careerCroxTheme') || 'peach-sky');
  const [customTheme, setCustomTheme] = useState(() => parseTheme(localStorage.getItem('careerCroxCustomTheme')));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('careerCroxTheme', theme);
  }, [theme]);

  useEffect(() => {
    if (customTheme) {
      localStorage.setItem('careerCroxCustomTheme', JSON.stringify(customTheme));
      applyCustomTheme(customTheme);
      return;
    }
    localStorage.removeItem('careerCroxCustomTheme');
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
          startLocalSession();
          markSessionActivity(true);
        }
        if (data.user?.theme_name) setTheme(data.user.theme_name);
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
            startLocalSession();
            markSessionActivity(true);
            if (data.user?.theme_name) setTheme(data.user.theme_name);
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
      if (disposed) return;
      clearLocalSession(message);
      broadcastLocalLogout(message);
      setUser(null);
      try {
        await api.post('/api/auth/logout', {}, { cacheTtlMs: 0, retries: 0, timeoutMs: 8000 });
      } catch {}
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
      if (event?.type === 'visibilitychange' && document.visibilityState === 'hidden') return;
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

    markSessionActivity(true);
    scheduleExpiryCheck();

    const events = ['click', 'keydown', 'scroll', 'touchstart', 'pointerdown', 'visibilitychange'];
    events.forEach((eventName) => window.addEventListener(eventName, noteActivity, { passive: true }));

    // CC20 login-safe keepalive: one tiny auth ping every 8 minutes while visible.
    // Declared earlier as let, so login/app never crashes from timer TDZ.
    keepAliveTimer = window.setInterval(() => {
      if (disposed || document.visibilityState === 'hidden') return;
      api.get('/api/auth/me', { cacheTtlMs: 0, retries: 0, timeoutMs: 8000, background: true })
        .then(() => {
          markSessionActivity(true);
          scheduleExpiryCheck();
        })
        .catch(() => {});
    }, SESSION_KEEPALIVE_MS);

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
      if (keepAliveTimer) window.clearInterval(keepAliveTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, noteActivity));
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
      localStorage.removeItem('careerCroxCustomTheme');
    },
    async persistTheme(nextTheme = theme, nextCustomTheme = customTheme) {
      await api.post('/api/theme', { theme_name: nextTheme, custom_theme_json: nextCustomTheme ? JSON.stringify(nextCustomTheme) : '' });
    },
    async login(username, password) {
      const data = await api.post('/api/auth/login', { username, password });
      if (data.user) startLocalSession();
      persistCachedUser(data.user || null);
      setUser(data.user);
      if (data.user?.theme_name) setTheme(data.user.theme_name);
      setCustomTheme(parseTheme(data.user?.custom_theme_json || ''));
      return data;
    },
    async logout() {
      try {
        await api.post('/api/auth/logout', {}, { cacheTtlMs: 0, retries: 0, timeoutMs: 8000 });
      } catch {}
      clearLocalSession('Logged out successfully.');
      broadcastLocalLogout('Logged out successfully.');
      setUser(null);
    }
  }), [user, booted, theme, customTheme]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
