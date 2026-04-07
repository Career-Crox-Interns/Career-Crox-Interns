const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { store } = require('../lib/store');
const { nowIso } = require('../lib/helpers');
const { COOKIE_SECURE, JWT_SECRET } = require('../config/env');

function authCookie() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  };
}

function makeSessionToken() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(24).toString('hex');
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((item) => item.trim()).filter(Boolean)[0];
  return forwarded || req.ip || req.socket?.remoteAddress || '';
}

async function registerActiveSession(user, req, explicitSessionToken = '') {
  const sessionToken = explicitSessionToken || makeSessionToken();
  const row = {
    username: user.username,
    session_token: sessionToken,
    ip_address: clientIp(req),
    user_agent: req.get?.('user-agent') || req.headers['user-agent'] || '',
    updated_at: nowIso(),
  };
  const existing = await store.findById('active_sessions', 'username', user.username);
  if (existing) await store.update('active_sessions', 'username', user.username, row);
  else await store.insert('active_sessions', row);
  return sessionToken;
}

async function clearActiveSession(username, sessionToken = '') {
  const existing = await store.findById('active_sessions', 'username', username);
  if (!existing) return false;
  if (sessionToken && String(existing.session_token || '') !== String(sessionToken || '')) return false;
  await store.delete('active_sessions', 'username', username);
  return true;
}

function signUser(user, impersonator, sessionToken) {
  return jwt.sign(
    {
      user_id: user.user_id,
      username: user.username,
      role: user.role,
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
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.impersonator) {
      const active = await store.findById('active_sessions', 'username', decoded.username);
      if (!active || !decoded.session_token || String(active.session_token || '') !== String(decoded.session_token || '')) {
        return res.status(401).json({ message: 'Session expired. This account is active on another device.' });
      }
    }
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid session' });
  }
}

function requireLeadership(req, res, next) {
  if (!['admin', 'manager', 'tl'].includes(req.user?.role)) {
    return res.status(403).json({ message: 'Leadership access only' });
  }
  return next();
}

module.exports = {
  authCookie,
  signUser,
  registerActiveSession,
  clearActiveSession,
  requireAuth,
  requireLeadership,
};
