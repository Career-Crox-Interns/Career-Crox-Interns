const { store, table } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { ensureDefaultSettings } = require('../lib/settings');
const { authCookie, signUser, registerActiveSession, clearActiveSession } = require('../middleware/auth');

function lower(value) {
  return String(value || '').trim().toLowerCase();
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
  delete safe.password;
  return safe;
}

async function authenticateUser(username, password) {
  const users = await table('users');
  const loginKey = normalizeEmail(username);
  return users.find((u) => normalizeEmail(u.username) === loginKey && String(u.password || '') === String(password || '') && String(u.is_active || '1') === '1') || null;
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
  const user = await authenticateUser(username, password);
  if (!user) return res.status(401).json({ message: 'Invalid username or password' });
  const sessionToken = await registerActiveSession(user, req);
  res.cookie('career_crox_token', signUser(user, null, sessionToken), authCookie());
  return res.json({ user: sanitizeUser(user) });
}

async function selfRegister(req, res) {
  const fullName = cleanName(req.body?.full_name);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '').trim();
  const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
  if (!fullName) return res.status(400).json({ message: 'Full name is required.' });
  if (!email || !email.includes('@')) return res.status(400).json({ message: 'Valid email is required.' });
  if (password.length < 4) return res.status(400).json({ message: 'Password must be at least 4 characters.' });

  const users = await table('users');
  if (users.some((row) => normalizeEmail(row.username) === email)) {
    return res.status(400).json({ message: 'This email already has an ID.' });
  }

  const userId = nextId('U', users, 'user_id');
  const recruiterCode = nextRecruiterCode(users);
  const now = nowIso();
  const user = {
    user_id: userId,
    username: email,
    password,
    full_name: fullName,
    designation: String(req.body?.designation || 'Freelancer').trim() || 'Freelancer',
    role: String(req.body?.role || 'recruiter').trim() || 'recruiter',
    recruiter_code: recruiterCode,
    is_active: '1',
    theme_name: 'peach-sky',
    updated_at: now,
  };
  await store.insert('users', user);

  const requestRows = await table('user_onboarding_requests');
  const requestId = nextId('REG', requestRows, 'request_id');
  await store.insert('user_onboarding_requests', {
    request_id: requestId,
    user_id: userId,
    username: email,
    full_name: fullName,
    email,
    recruiter_code: recruiterCode,
    designation: user.designation,
    role: user.role,
    status: 'Account Created',
    requested_at: now,
    approved_at: now,
    approved_by_name: 'Self Signup',
    notes: String(req.body?.notes || '').trim(),
  });

  let uploadedDocs = 0;
  for (const doc of documents) {
    const base64 = String(doc?.content_base64 || '').trim();
    if (!base64) continue;
    uploadedDocs += 1;
    await store.insert('user_onboarding_documents', {
      document_id: makeFastId('UD'),
      request_id: requestId,
      user_id: userId,
      username: email,
      document_type: String(doc?.document_type || 'document').trim() || 'document',
      original_name: String(doc?.original_name || '').trim(),
      mime_type: String(doc?.mime_type || 'application/octet-stream').trim() || 'application/octet-stream',
      size_bytes: String(doc?.size_bytes || '0').trim() || '0',
      content_base64: base64,
      status: 'Submitted',
      created_at: now,
    });
  }

  await notifyLeadership(
    'New self-created login ID',
    `${fullName} created a new CRM ID (${email}). Documents submitted: ${uploadedDocs}.`,
    JSON.stringify({ user_id: userId, open_path: '/admin', request_id: requestId }),
  );

  return res.json({
    ok: true,
    message: uploadedDocs
      ? 'ID created. Documents were also submitted for leadership review.'
      : 'ID created successfully. You can log in now.',
    user: sanitizeUser(user),
    request_id: requestId,
  });
}

async function requestPasswordReset(req, res) {
  const email = normalizeEmail(req.body?.email || req.body?.username);
  const reason = String(req.body?.reason || 'Forgot password request').trim() || 'Forgot password request';
  if (!email) return res.status(400).json({ message: 'Email or username is required.' });
  const users = await table('users');
  const user = users.find((row) => normalizeEmail(row.username) === email);
  if (!user) return res.status(404).json({ message: 'No CRM ID found with this email.' });

  const requests = await table('password_reset_requests');
  const item = {
    request_id: nextId('PR', requests, 'request_id'),
    user_id: user.user_id,
    username: user.username,
    full_name: user.full_name || user.username,
    email: user.username,
    recruiter_code: user.recruiter_code || '',
    status: 'Pending',
    reason,
    requested_at: nowIso(),
    resolved_by_name: '',
    resolved_at: '',
  };
  await store.insert('password_reset_requests', item);
  await notifyLeadership(
    'Password reset request',
    `${user.full_name || user.username} requested password reset access help.`,
    JSON.stringify({ user_id: user.user_id, open_path: '/admin', request_id: item.request_id }),
  );
  return res.json({ ok: true, message: 'Password reset request submitted to leadership.' });
}

async function logout(req, res) {
  if (req.user?.username) await clearActiveSession(req.user.username, req.user.session_token || '');
  res.clearCookie('career_crox_token', { path: '/' });
  return res.json({ ok: true });
}

async function me(req, res) {
  const user = await store.findById('users', 'user_id', req.user.user_id);
  if (!user) return res.status(401).json({ message: 'User not found' });
  await ensureDefaultSettings();
  const settings = await table('settings');
  const themeSetting = settings.find((s) => s.setting_key === `custom_theme_${req.user.user_id}`);
  return res.json({ user: { ...sanitizeUser(user), custom_theme_json: themeSetting?.setting_value || '' } });
}

async function theme(req, res) {
  const item = await store.update('users', 'user_id', req.user.user_id, {
    theme_name: req.body?.theme_name || 'peach-sky',
    updated_at: nowIso(),
  });
  if (req.body?.custom_theme_json) {
    await ensureDefaultSettings();
    await store.upsert('settings', 'setting_key', {
      setting_key: `custom_theme_${req.user.user_id}`,
      setting_value: req.body.custom_theme_json,
      notes: 'User theme settings',
      Instructions: '',
    });
  }
  return res.json({ item });
}

module.exports = { login, selfRegister, requestPasswordReset, logout, me, theme };
