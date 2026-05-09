const { store, table } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { ensureDefaultSettings } = require('../lib/settings');
const { authCookie, signUser, registerActiveSession, clearActiveSession, ensureDeviceId } = require('../middleware/auth');
const { verifyPassword, consumeRateLimit, clearRateLimit, issueActionToken } = require('../lib/security');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalRole(value, fallback = '') {
  const raw = lower(value || fallback);
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeUser(user) {
  if (!user) return null;
  const safe = { ...user };
  safe.role = canonicalRole(safe.role, safe.designation);
  delete safe.password;
  delete safe.password_hash;
  return safe;
}

function looksTruthyActive(value) {
  const current = String(value ?? '1').trim().toLowerCase();
  return !['0', 'false', 'no', 'inactive'].includes(current);
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((item) => item.trim()).filter(Boolean)[0];
  return forwarded || req.ip || req.socket?.remoteAddress || '';
}

function loginLimitKey(req, username = '') {
  return `${clientIp(req)}::${normalizeEmail(username)}`;
}

async function authenticateUser(username, password) {
  const users = await table('users');
  const loginKey = normalizeEmail(username);
  return users.find((u) => {
    const storedPassword = u.password || u.password_hash || '';
    return normalizeEmail(u.username) === loginKey && verifyPassword(storedPassword, password) && looksTruthyActive(u.is_active);
  }) || null;
}

async function notifyLeadership(title, message, metadata = '') {
  const users = await table('users');
  const leaders = users.filter((u) => ['admin', 'manager', 'tl', 'team lead'].includes(lower(u.role)));
  for (const leader of leaders) {
    await store.insert('notifications', {
      notification_id: makeFastId('N'),
      user_id: leader.user_id,
      title,
      message,
      category: 'system',
      status: 'Unread',
      metadata,
      created_at: nowIso(),
    });
  }
}

function makeFastId(prefix = 'X') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function nextRecruiterCode(users = []) {
  const taken = new Set(
    users
      .map((row) => String(row.recruiter_code || '').trim().toUpperCase())
      .filter(Boolean),
  );
  let counter = 1;
  while (taken.has(`FR-${String(counter).padStart(3, '0')}`)) counter += 1;
  return `FR-${String(counter).padStart(3, '0')}`;
}

async function login(req, res) {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '').trim();
  if (!username || !password) return res.status(400).json({ message: 'Username and password required' });

  const limiterKey = loginLimitKey(req, username);
  const allowed = consumeRateLimit('login', limiterKey, { limit: 8, windowMs: 10 * 60 * 1000, blockMs: 20 * 60 * 1000 });
  if (!allowed.allowed) {
    return res.status(429).json({ message: 'Too many login attempts. Try again later.' });
  }

  const user = await authenticateUser(username, password);
  if (!user) return res.status(401).json({ message: 'Invalid username or password' });
  clearRateLimit('login', limiterKey);

  // Keep the password exactly as stored in Supabase. Existing hashed passwords still verify, but login will not auto-convert plain passwords.

  ensureDeviceId(req, res);
  const sessionToken = await registerActiveSession(user, req, '', { res });
  res.cookie('career_crox_token', signUser(user, null, sessionToken), authCookie());
  return res.json({ user: sanitizeUser(user) });
}

async function selfRegister(req, res) {
  return res.status(403).json({ message: 'Self signup is disabled. CRM IDs are created only by manager.' });
}

async function requestPasswordReset(req, res) {
  return res.status(403).json({ message: 'Self password reset is disabled. Contact manager.' });
}

async function exportAccess(req, res) {
  if (req.user?.impersonator) return res.status(403).json({ message: 'Stop impersonation before export access.' });
  if (!['manager', 'admin'].includes(lower(req.user?.role))) return res.status(403).json({ message: 'Only manager can unlock exports.' });
  if (req.authDegraded) return res.status(401).json({ message: 'Refresh CRM and sign in again before export.' });

  const password = String(req.body?.password || '').trim();
  const routeKey = String(req.body?.route_key || '').trim();
  if (!password) return res.status(400).json({ message: 'Manager password required.' });
  if (!routeKey) return res.status(400).json({ message: 'Export route missing.' });

  const limiterKey = loginLimitKey(req, req.user?.username || 'export');
  const allowed = consumeRateLimit('export-access', limiterKey, { limit: 5, windowMs: 10 * 60 * 1000, blockMs: 20 * 60 * 1000 });
  if (!allowed.allowed) return res.status(429).json({ message: 'Too many wrong export password attempts. Try later.' });

  const user = await store.findById('users', 'user_id', req.user.user_id) || await store.findById('users', 'username', req.user.username);
  if (!user || !verifyPassword(user.password || user.password_hash || '', password)) return res.status(401).json({ message: 'Manager password is incorrect.' });
  clearRateLimit('export-access', limiterKey);

  // Keep the manager export password exactly as stored in Supabase.

  const exportToken = issueActionToken({ username: user.username, purpose: 'export', routeKey }, 150);
  return res.json({ ok: true, export_token: exportToken, expires_in_seconds: 150 });
}

async function logout(req, res) {
  if (req.user?.username) await clearActiveSession(req.user.username, req.user.session_token || '');
  res.clearCookie('career_crox_token', { path: '/' });
  return res.json({ ok: true });
}

async function me(req, res) {
  try {
    const user = await store.findById('users', 'user_id', req.user.user_id);
    if (!user) return res.status(401).json({ message: 'User not found' });
    await ensureDefaultSettings();
    const settings = await table('settings');
    const themeSetting = settings.find((s) => s.setting_key === `custom_theme_${req.user.user_id}`);
    return res.json({ user: { ...sanitizeUser(user), custom_theme_json: themeSetting?.setting_value || '' }, degraded: Boolean(req.authDegraded) });
  } catch (error) {
    console.error('auth/me lookup failed. Returning token-backed user to avoid forced logout:', error?.message || error);
    return res.json({
      user: sanitizeUser({
        user_id: req.user?.user_id,
        username: req.user?.username,
        role: req.user?.role,
        full_name: req.user?.full_name,
        designation: req.user?.designation,
        recruiter_code: req.user?.recruiter_code,
        theme_name: 'peach-sky',
        custom_theme_json: '',
      }),
      degraded: true,
    });
  }
}

async function theme(req, res) {
  const item = await store.update('users', 'user_id', req.user.user_id, {
    theme_name: req.body?.theme_name || 'peach-sky',
    updated_at: nowIso(),
  });
  await ensureDefaultSettings();
  const settingKey = `custom_theme_${req.user.user_id}`;
  const nextCustomThemeJson = String(req.body?.custom_theme_json || '').trim();
  if (nextCustomThemeJson) {
    await store.upsert('settings', 'setting_key', {
      setting_key: settingKey,
      setting_value: nextCustomThemeJson,
      notes: 'User theme settings',
      Instructions: '',
    });
  } else {
    try {
      await store.delete('settings', 'setting_key', settingKey);
    } catch {}
  }
  return res.json({ item });
}

module.exports = { login, selfRegister, requestPasswordReset, exportAccess, logout, me, theme };
