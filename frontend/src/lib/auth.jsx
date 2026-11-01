import {dashboardEffectiveUser,useDashboardScope} from './dashboardScope';
import { readMobileAppearance } from './theme';
import { applyPersonalSettings, readPersonalSettings, THEMES } from './personalSettings';
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api,crmInactivityMs,crmLastActivityAt,crmSessionDeadline,crmExpiryMinutes } from './api';
import { applyCustomTheme, clearCustomTheme, defaultCustomTheme } from './theme';

const AuthContext = createContext(null);
const USER_CACHE_KEY = 'careerCroxCachedUser';
const SESSION_LOGIN_AT_KEY = 'careerCroxSessionLoginAt';
const SESSION_LAST_ACTIVITY_KEY = 'careerCroxLastActivityAt';
const SESSION_LOGOUT_EVENT_KEY = 'careerCroxLogoutEventAt';
const SESSION_EXPIRED_MESSAGE_KEY = 'careerCroxSessionExpiredMessage';
const OFFICE_JOIN_SESSION_KEY = 'careerCroxOfficeJoinedSession';
const SESSION_KEEPALIVE_MS = Number(import.meta?.env?.VITE_SESSION_KEEPALIVE_MS || (60 * 60 * 1000));
const AUTO_AUTH_KEEPALIVE_ENABLED = String(import.meta?.env?.VITE_AUTO_AUTH_KEEPALIVE_ENABLED || 'false').toLowerCase() === 'true';
const DAILY_LOGOUT_HOUR = 21;

function readThemePreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}


// CC921: one complete palette commit; the auth response cannot erase a newer choice.
function appearanceOwner(user) {
  return [user?.user_id || user?.username || 'signed-out', user?.role, user?.team_id, user?.recruiter_code].join('|');
}
function allowedTheme(name, user) {
  const item = THEMES.find(t => t[0] === name);
  return item && (item[7] !== 'manager' || String(user?.role || user?.designation || '').toLowerCase() === 'manager') ? name : 'orange';
}
function savedThemeChoice(user) {
  try {
    const p = JSON.parse(localStorage.getItem('cc787:preferences:' + appearanceOwner(user)) || '{}');
    return p.theme && THEMES.some(t => t[0] === p.theme) ? allowedTheme(p.theme, user) : '';
  } catch { return ''; }
}
function preferredTheme(user, fallback) {
  return savedThemeChoice(user) || allowedTheme(fallback || user?.theme_name || 'orange', user);
}
function saveThemePaint(user, custom) {
  try {
    const root = document.documentElement, vars = {}, attrs = {};
    for (let i = 0; i < root.style.length; i++) {
      const key = root.style[i];
      if (key.startsWith('--')) vars[key] = root.style.getPropertyValue(key);
    }
    for (const name of ['data-theme','data-cc791','data-cc819-theme-name','data-cc823-theme-family','data-cc824-premium','data-cc824-layout','data-cc829','data-cc829-finish','data-cc825-orange','data-cc787-mode','data-cc787-cursor','data-cc787-accent','data-cc787-motion','data-cc787-chat']) {
      if (root.hasAttribute(name)) attrs[name] = root.getAttribute(name);
    }
    const data = { owner: appearanceOwner(user), theme: root.dataset.theme, vars, attrs, custom: custom || null };
    localStorage.setItem('cc921-theme-paint:' + data.owner, JSON.stringify(data));
    localStorage.setItem('cc918-theme-paint', JSON.stringify(data));
  } catch {}
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
  const previous = loadCachedUser();
  if (String(previous?.user_id || previous?.username || '') !== String(user?.user_id || user?.username || '')) {
    for (const storage of [sessionStorage,localStorage]) for (const key of Object.keys(storage)) {
      if (/^(?:careerCrox(?:FastCache|CandidateNav|InstantCandidateProfile|PageCache|Candidates|Interviews|Submissions|FollowUps|Tasks|AutoDialer|RealtimeCandidatePatch)|cc_chat_cache|cc489_chat_shell|cc500Chat|cc498Chat|cc391|cc_page_cache)/.test(key)) storage.removeItem(key);
    }
    window.dispatchEvent(new Event('career-crox-account-changed'));
  }
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
  window.__CC919_SESSION_GENERATION__=(window.__CC919_SESSION_GENERATION__||0)+1;
  window.__CC787_STOP_CONNECTIONS__?.();
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
  const lastActivityAt = crmLastActivityAt();
  if (lastActivityAt && nowMs >= crmSessionDeadline(cachedUser,lastActivityAt)) {
    return `CRM locked and logged out after ${crmExpiryMinutes(cachedUser,lastActivityAt)} minutes of inactivity.`;
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
    if(forceNewLogin){localStorage.setItem('careerCroxHumanActivityAt',String(now));localStorage.removeItem('cc602_last_human_activity_pulse');localStorage.removeItem('cc835_last_sent_activity_at');}
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
    localStorage.setItem('careerCroxHumanActivityAt',String(now));
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
  if (text.includes('inactivity') || text.includes('10 minutes')) return 'auto_inactivity';
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

// CC889: quiet, local-only expiry warning. No background keepalive or fake activity.
function SessionExpiryNotice({ user }) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!user) { setRemaining(null); return undefined; }
    const update = () => {
      if (document.visibilityState === 'hidden') { setRemaining(null); return; }
      const last = crmLastActivityAt() || Date.now();
      const seconds = Math.ceil((crmSessionDeadline(user,last) - Date.now()) / 1000);
      setRemaining(seconds > 0 && seconds <= 120 ? seconds : null);
    };
    update();
    const timer = window.setInterval(update, 15000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [user?.username, user?.role]);
  if (!user || remaining === null) return null;
  return <div role="status" aria-live="polite" style={{position:'fixed',right:14,bottom:18,zIndex:2100,maxWidth:320,padding:'12px 14px',border:'1px solid #d7c8f7',borderRadius:16,background:'linear-gradient(120deg,#fff9ef,#f1ebff)',color:'#25304b',boxShadow:'0 12px 28px rgba(33,25,84,.17)',fontSize:13}}>
    <div style={{fontWeight:800,marginBottom:5}}>◷ Session lock in about {Math.ceil(remaining / 60)} min</div>
    <div style={{fontSize:12,lineHeight:1.4}}>For account safety, inactive sessions lock automatically. Save unfinished changes.</div>
    <button type="button" onClick={()=>{markSessionActivity(true);setRemaining(null);window.dispatchEvent(new Event('career-crox-session-active'));void api.get('/api/auth/me',{cacheTtlMs:0,retries:0,timeoutMs:7000}).catch(()=>{});}} style={{marginTop:9,border:0,borderRadius:10,padding:'8px 12px',cursor:'pointer',fontWeight:800,color:'#fff',background:'linear-gradient(100deg,#675bea,#ca518d)'}}>Continue working</button>
  </div>;
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
  const appearanceChanged = useRef(0);
  const [appearanceVersion, setAppearanceVersion] = useState(0);
  const [theme, setThemeState] = useState(() => {
    const cached = loadCachedUser();
    return preferredTheme(cached, cached?.theme_name || readThemePreference('careerCroxTheme'));
  });
  const [customTheme, setCustomThemeState] = useState(() => parseTheme(readThemePreference('careerCroxCustomTheme')));
  function setTheme(next) {
    const name = allowedTheme(typeof next === 'function' ? next(theme) : next, user);
    appearanceChanged.current++;
    try {
      const key = 'cc787:preferences:' + appearanceOwner(user);
      const p = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...p, theme: name }));
    } catch {}
    setThemeState(name);
    setAppearanceVersion(v => v + 1);
  }
  function setCustomTheme(next) {
    appearanceChanged.current++;
    setCustomThemeState(next);
    setAppearanceVersion(v => v + 1);
  }
  useEffect(()=>{
    let refreshing=false;
    const changed=event=>{if(!/flowchart/.test(String(event.detail?.source||''))||refreshing)return;refreshing=true;api.get('/api/auth/me',{cacheTtlMs:0,retries:0,timeoutMs:12000}).then(data=>{if(data.user){persistCachedUser(data.user);setUser(data.user);window.dispatchEvent(new Event('career-crox-tab-resumed'));}}).catch(()=>{}).finally(()=>{refreshing=false;});};
    window.addEventListener('career-crox-workspace-change',changed);return()=>window.removeEventListener('career-crox-workspace-change',changed);
  },[]);


  useLayoutEffect(() => {
    if (!user) { document.documentElement.dataset.cc921ThemeBoot = 'ready'; return; }
    const root = document.documentElement;
    // Clear only before rebuilding the complete selected palette, never afterwards.
    clearCustomTheme();
    delete root.__cc829AppearanceKey;
    const prefs = readPersonalSettings();
    const selected = allowedTheme(prefs.theme || theme, user);
    applyPersonalSettings({ ...prefs, theme: selected }, selected, user.role);
    if (customTheme) {
      applyCustomTheme(customTheme);
      try { localStorage.setItem('careerCroxCustomTheme', JSON.stringify(customTheme)); } catch {}
    } else {
      try { localStorage.removeItem('careerCroxCustomTheme'); } catch {}
    }
    try { localStorage.setItem('careerCroxTheme', root.dataset.theme); } catch {}
    saveThemePaint(user, customTheme);
    root.dataset.cc921ThemeBoot = 'ready';
  }, [theme, customTheme, user, appearanceVersion]);

  useEffect(() => {
    if (!user) return;
    const apply = () => {
      appearanceChanged.current++;
      const next = savedThemeChoice(user);
      if (next) setThemeState(next);
      setAppearanceVersion(v => v + 1);
    };
    const storage = event => {
      if (!event.key || event.key === 'cc787:preferences:' + appearanceOwner(user)) apply();
    };
    window.addEventListener('cc787-settings-changed', apply);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('cc787-settings-changed', apply);
      window.removeEventListener('storage', storage);
    };
  }, [user]);

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
    const bootGeneration=window.__CC919_SESSION_GENERATION__||0;
    const appearanceAtBoot = appearanceChanged.current;
    api.get('/api/auth/me', { cacheTtlMs: 0, retries: 0, timeoutMs: 12000 })
      .then((data) => {
        if (!active||bootGeneration!==(window.__CC919_SESSION_GENERATION__||0)||window.__CC602_NETWORK_PAUSED__||!loadCachedUser()) return;
        const nextUser = data.user || null;
        setUser(nextUser);
        persistCachedUser(nextUser);
        if (nextUser) {
          startLocalSession(false);
          // Credential verification is not human activity; do not reset the idle clock.
        }
        if (data.user && appearanceChanged.current === appearanceAtBoot) {
          setThemeState(preferredTheme(data.user, data.user.theme_name));
          if (!savedThemeChoice(data.user)) setCustomThemeState(parseTheme(data.user.custom_theme_json || ''));
        }
      })
      .catch((error) => {
        if (!active) return;
        const cachedUser = loadCachedUser();
        const status = Number(error?.status || 0);
        if (cachedUser && status !== 401) {
          setUser(cachedUser);
          return;
        }
        clearLocalSession();
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
      const message=event?.detail?.message||'Session ended. Sign in again.';
      const closing=window.__CC602_IDLE_LOGOUT_RUNNING__;
      clearLocalSession(message);broadcastLocalLogout(message);if(active)setUser(null);
      if(event?.detail?.localOnly&&!closing)void notifyAutoLogoutToBackend(message);
    }
    window.addEventListener('career-crox-auth-expired', handleAuthExpired);
    return () => {
      active = false;
      window.removeEventListener('career-crox-auth-expired', handleAuthExpired);
    };
  }, []);

  useEffect(()=>{const stop=event=>{clearLocalSession(event.detail?.message||'Session ended. Sign in again.');setUser(null);setBooted(true);};window.addEventListener('career-crox-local-logout',stop);return()=>window.removeEventListener('career-crox-local-logout',stop);},[]);

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
      const lastActivityAt = crmLastActivityAt() || now;
      const inactivityDueAt = crmSessionDeadline(user,lastActivityAt);
      const dailyDueAt = nextDailyCutoffMs(now);
      const nextDueAt = inactivityDueAt;
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

    const events = ['click','keydown','keyup','beforeinput','input','change','paste','compositionend','wheel','touchstart','pointerdown','pointermove'];
    events.forEach((eventName) => window.addEventListener(eventName, noteActivity, { passive: true,capture:true }));
    window.addEventListener('pageshow', scheduleExpiryCheck);
    window.addEventListener('career-crox-approved-work-resumed',scheduleExpiryCheck);
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
      if([SESSION_LAST_ACTIVITY_KEY,'careerCroxHumanActivityAt',SESSION_LOGIN_AT_KEY].includes(event.key)){scheduleExpiryCheck();return;}
      if (event.key !== SESSION_LOGOUT_EVENT_KEY || !event.newValue) return;
      let reason = 'Session ended. Login again to continue.';
      try {
        const payload = JSON.parse(event.newValue);
        if(Number(payload.at)<safeNumberFromStorage(SESSION_LOGIN_AT_KEY))return;
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
      events.forEach((eventName) => window.removeEventListener(eventName, noteActivity,true));
      window.removeEventListener('pageshow', scheduleExpiryCheck);
      window.removeEventListener('career-crox-approved-work-resumed',scheduleExpiryCheck);
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
      try { localStorage.removeItem('careerCroxCustomTheme'); } catch {}
    },
    async persistTheme(nextTheme = theme, nextCustomTheme = customTheme) {
      await new Promise(resolve=>requestAnimationFrame(resolve));
      await api.post('/api/theme', { appearance:readMobileAppearance(), theme_name: nextTheme, custom_theme_json: nextCustomTheme ? JSON.stringify(nextCustomTheme) : '' });
    },
    async login(username, password) {
      const data = await api.post('/api/auth/login', { username, password });
      if (data.user) { window.__CC602_NETWORK_PAUSED__ = false; window.__CC602_IDLE_LOGOUT_RUNNING__ = false; startLocalSession(true, data.user || {}); }
      persistCachedUser(data.user || null);
      setUser(data.user);
      if(data.user)window.dispatchEvent(new Event('career-crox-session-active'));
      if (data.user) setThemeState(preferredTheme(data.user, data.user.theme_name));
      setCustomThemeState(savedThemeChoice(data.user) ? null : parseTheme(data.user?.custom_theme_json || ''));
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
      }
      window.__CC602_NETWORK_PAUSED__ = true;
      window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'));
      clearLocalSession('Logged out successfully.');
      broadcastLocalLogout('Logged out successfully.');
      setUser(null);
    }
  }), [user, booted, theme, customTheme]);

  return <AuthContext.Provider value={value}>{children}<SessionExpiryNotice user={user} /></AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }

export function useDashboardAuth(){const auth=useAuth();useDashboardScope();return {...auth,actor:auth?.user,user:dashboardEffectiveUser(auth?.user)};}
