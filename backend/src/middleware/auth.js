const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { store } = require('../lib/store');
const { nowIso } = require('../lib/helpers');
const { COOKIE_SECURE, JWT_SECRET } = require('../config/env');
const { verifyActionToken } = require('../lib/security');

const DEVICE_COOKIE_NAME = 'career_crox_device_id';
const INACTIVITY_LOGOUT_MS = Number(process.env.CRM_INACTIVITY_LOGOUT_MS || (4 * 60 * 60 * 1000));
const KOLKATA_OFFSET_MS = 330 * 60 * 1000;
const DAILY_LOGOUT_HOUR = 21;

function authCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  };
}

function deviceCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 365,
  };
}

function lowerText(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalRole(value, fallback = '') {
  const raw = lowerText(value || fallback);
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function makeSessionToken() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(24).toString('hex');
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((item) => item.trim()).filter(Boolean)[0];
  return forwarded || req.ip || req.socket?.remoteAddress || '';
}

function readDeviceId(req) {
  return String(req?.cookies?.[DEVICE_COOKIE_NAME] || '').trim();
}

function ensureDeviceId(req, res, preferred = '') {
  const current = readDeviceId(req);
  if (current) return current;
  const nextValue = String(preferred || makeSessionToken()).trim();
  if (res?.cookie && nextValue) {
    try { res.cookie(DEVICE_COOKIE_NAME, nextValue, deviceCookie()); } catch {}
  }
  if (!req.cookies) req.cookies = {};
  if (nextValue) req.cookies[DEVICE_COOKIE_NAME] = nextValue;
  return nextValue;
}

function requestUserAgent(req) {
  return String(req.get?.('user-agent') || req.headers['user-agent'] || '').trim();
}

function withLegacySessionShape(row = {}) {
  const copy = { ...row };
  delete copy.device_id;
  delete copy.last_seen_at;
  delete copy.login_at;
  return copy;
}

async function upsertActiveSessionCompat(username, row) {
  const existing = await store.findById('active_sessions', 'username', username);
  try {
    if (existing) await store.update('active_sessions', 'username', username, row);
    else await store.insert('active_sessions', row);
    return true;
  } catch (error) {
    const legacyRow = withLegacySessionShape(row);
    if (existing) await store.update('active_sessions', 'username', username, legacyRow);
    else await store.insert('active_sessions', legacyRow);
    return false;
  }
}

async function updateActiveSessionCompat(username, updates) {
  try {
    await store.update('active_sessions', 'username', username, updates);
    return true;
  } catch (error) {
    await store.update('active_sessions', 'username', username, withLegacySessionShape(updates));
    return false;
  }
}

function shouldTouchSession(active) {
  const stamp = Date.parse(String(active?.last_seen_at || active?.updated_at || ''));
  if (!stamp) return true;
  return (Date.now() - stamp) > (1000 * 60 * 3);
}

function latestKolkataDailyCutoffMs(nowMs = Date.now()) {
  const shifted = new Date(nowMs + KOLKATA_OFFSET_MS);
  const cutoffTodayUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    DAILY_LOGOUT_HOUR,
    0,
    0,
    0,
  ) - KOLKATA_OFFSET_MS;
  if (nowMs < cutoffTodayUtc) return cutoffTodayUtc - (24 * 60 * 60 * 1000);
  return cutoffTodayUtc;
}

function getActiveSessionExpiry(active) {
  if (!active) return null;
  const now = Date.now();
  const lastSeenAt = Date.parse(String(active.last_seen_at || active.updated_at || ''));
  if (lastSeenAt && now - lastSeenAt >= INACTIVITY_LOGOUT_MS) {
    return { message: 'Session expired after 40 minutes of inactivity.' };
  }
  const loginAt = Date.parse(String(active.login_at || ''));
  if (loginAt && loginAt < latestKolkataDailyCutoffMs(now)) {
    return { message: 'Daily 9 PM logout completed. Login again.' };
  }
  return null;
}


function sameBrowserSession(active, req) {
  if (!active) return false;
  const activeDeviceId = String(active.device_id || '').trim();
  const requestDeviceId = readDeviceId(req);
  if (activeDeviceId && requestDeviceId && activeDeviceId === requestDeviceId) return true;
  const activeIp = String(active.ip_address || '').trim();
  const requestIp = String(clientIp(req) || '').trim();
  const activeUa = String(active.user_agent || '').trim();
  const requestUa = requestUserAgent(req);
  const ipMatches = activeIp && requestIp && activeIp === requestIp;
  const uaMatches = activeUa && requestUa && activeUa === requestUa;
  return uaMatches || (ipMatches && uaMatches);
}

async function registerActiveSession(user, req, explicitSessionToken = '', options = {}) {
  const sessionToken = explicitSessionToken || makeSessionToken();
  const deviceId = ensureDeviceId(req, options.res || null, options.preferredDeviceId || '');
  const row = {
    username: user.username,
    session_token: sessionToken,
    ip_address: clientIp(req),
    user_agent: requestUserAgent(req),
    device_id: deviceId,
    updated_at: nowIso(),
    last_seen_at: nowIso(),
    login_at: nowIso(),
  };
  await upsertActiveSessionCompat(user.username, row);
  return sessionToken;
}

async function clearActiveSession(username, sessionToken = '') {
  const existing = await store.findById('active_sessions', 'username', username);
  if (!existing) return false;
  if (sessionToken && String(existing.session_token || '') !== String(sessionToken || '')) return false;
  await store.delete('active_sessions', 'username', username);
  return true;
}

async function recoverFromSignedSessionCookie(token, req, res) {
  const decoded = jwt.decode(token);
  if (!decoded?.username || !decoded?.session_token) return null;
  try {
    const active = await store.findById('active_sessions', 'username', decoded.username);
    if (!active) return null;
    if (String(active.session_token || '') !== String(decoded.session_token || '')) return null;
    if (!sameBrowserSession(active, req)) return null;
    const user = await store.findById('users', 'username', decoded.username);
    if (!user) return null;
    const deviceId = ensureDeviceId(req, res, String(active.device_id || ''));
    await updateActiveSessionCompat(decoded.username, {
      ip_address: clientIp(req),
      user_agent: requestUserAgent(req),
      device_id: deviceId,
      updated_at: nowIso(),
      last_seen_at: nowIso(),
    });
    res.cookie('career_crox_token', signUser(user, null, String(active.session_token || decoded.session_token || '')), authCookie());
    return {
      user_id: user.user_id,
      username: user.username,
      role: canonicalRole(user.role, user.designation),
      full_name: user.full_name,
      designation: user.designation,
      recruiter_code: user.recruiter_code,
      session_token: String(active.session_token || decoded.session_token || ''),
    };
  } catch {
    return null;
  }
}

function signUser(user, impersonator, sessionToken) {
  return jwt.sign(
    {
      user_id: user.user_id,
      username: user.username,
      role: canonicalRole(user.role, user.designation),
      full_name: user.full_name,
      designation: user.designation,
      recruiter_code: user.recruiter_code,
      impersonator: impersonator || null,
      session_token: sessionToken || user.session_token || '',
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
}

async function requireAuth(req, res, next) {
  const token = req.cookies.career_crox_token;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });

  let decoded = null;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    const recovered = await recoverFromSignedSessionCookie(token, req, res);
    if (recovered) {
      req.user = recovered;
      return next();
    }
    return res.status(401).json({ message: 'Invalid session' });
  }

  decoded.role = canonicalRole(decoded.role, decoded.designation);

  if (decoded.impersonator) {
    req.user = decoded;
    return next();
  }

  try {
    const active = await store.findById('active_sessions', 'username', decoded.username);
    const deviceId = ensureDeviceId(req, res, String(active?.device_id || ''));
    const sessionExpiry = getActiveSessionExpiry(active);
    if (sessionExpiry) {
      try { await clearActiveSession(decoded.username, String(active?.session_token || '')); } catch {}
      try { res.clearCookie('career_crox_token', { path: '/' }); } catch {}
      return res.status(401).json({ message: sessionExpiry.message });
    }
    const hasMatchingToken = Boolean(active && decoded.session_token && String(active.session_token || '') === String(decoded.session_token || ''));
    if (!hasMatchingToken) {
      const user = await store.findById('users', 'username', decoded.username);
      if (!user) return res.status(401).json({ message: 'Invalid session' });
      if (!active || sameBrowserSession(active, req)) {
        const restoredToken = String(active?.session_token || decoded.session_token || makeSessionToken());
        await registerActiveSession(user, req, restoredToken, { res, preferredDeviceId: deviceId });
        if (String(restoredToken || '') !== String(decoded.session_token || '')) {
          res.cookie('career_crox_token', signUser(user, null, restoredToken), authCookie());
        }
        req.user = { ...decoded, session_token: restoredToken };
        return next();
      }
      // CC16 stability: allow multiple active browsers/devices with the same valid user token.
      // The old single-row active_sessions check caused recruiters to get 401 while another tab/device was working.
      try {
        await updateActiveSessionCompat(decoded.username, {
          ip_address: clientIp(req),
          user_agent: requestUserAgent(req),
          device_id: deviceId,
          updated_at: nowIso(),
          last_seen_at: nowIso(),
        });
      } catch {}
      req.user = decoded;
      return next();
    }

    if (shouldTouchSession(active)) {
      try {
        await updateActiveSessionCompat(decoded.username, {
          ip_address: clientIp(req),
          user_agent: requestUserAgent(req),
          device_id: deviceId,
          updated_at: nowIso(),
          last_seen_at: nowIso(),
        });
      } catch {}
    }

    req.user = decoded;
    return next();
  } catch (error) {
    console.error('Auth session lookup failed. Allowing degraded session without forced logout:', error?.message || error);
    req.user = decoded;
    req.authDegraded = true;
    return next();
  }
}


function requireStrongAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
  if (req.authDegraded) return res.status(401).json({ message: 'Refresh CRM and sign in again.' });
  return next();
}

function requireExportAccess(routeKey) {
  return function exportAccessGuard(req, res, next) {
    if (!['manager', 'admin'].includes(String(req.user?.role || '').trim().toLowerCase())) {
      return res.status(403).json({ message: 'Manager export access only' });
    }
    if (req.authDegraded) return res.status(401).json({ message: 'Refresh CRM and sign in again.' });
    const token = String(req.query?.export_token || req.headers['x-export-token'] || '').trim();
    if (!token) return res.status(401).json({ message: 'Manager export password required.' });
    const decoded = verifyActionToken(token, { purpose: 'export', username: req.user?.username, routeKey });
    if (!decoded) return res.status(401).json({ message: 'Export unlock expired. Enter manager password again.' });
    req.exportAccess = decoded;
    return next();
  };
}

function requireLeadership(req, res, next) {
  const role = canonicalRole(req.user?.role, req.user?.designation);
  if (!['admin', 'manager', 'tl'].includes(role)) {
    return res.status(403).json({ message: 'Leadership access only' });
  }
  return next();
}

module.exports = {
  authCookie,
  signUser,
  registerActiveSession,
  clearActiveSession,
  ensureDeviceId,
  requireAuth,
  requireLeadership,
  requireStrongAuth,
  requireExportAccess,
};
