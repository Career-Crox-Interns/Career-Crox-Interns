const { store, table } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { ensureDefaultSettings } = require('../lib/settings');
const { authCookie, signUser, registerActiveSession, clearActiveSession, ensureDeviceId } = require('../middleware/auth');
const { verifyPassword, hashPassword, passwordNeedsUpgrade, consumeRateLimit, clearRateLimit, issueActionToken } = require('../lib/security');
const { ensureReloginInactivityLock, lockPresenceForInactivity } = require('../lib/unlockService');

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
  // The exclusive Burgundy display preference must not be returned to other roles.
  if (['burgundy', 'crimson-noir'].includes(safe.theme_name) && safe.role !== 'manager') safe.theme_name = 'orange';
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
  const loginKey = normalizeEmail(username);
  // One username only. Do not download all accounts and password hashes for each login.
  const user = store.pool && typeof store.one === 'function'
    ? await store.one('select * from public.users where lower(username)=lower($1) limit 1', [loginKey])
    : (await table('users')).find((u) => normalizeEmail(u.username) === loginKey);
  if (!user || !looksTruthyActive(user.is_active)) return null;
  return verifyPassword(user.password || user.password_hash || '', password) ? user : null;
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

function autoLogoutKind(req) {
  const reason = String(req.body?.reason || req.body?.message || '').trim();
  const code = lower(req.body?.logout_reason || req.body?.reason_code || '');
  const notify = String(req.body?.notify_leadership || '').trim() === '1' || req.body?.notify_leadership === true;
  const combined = `${code} ${reason}`.toLowerCase();
  if (!notify && !code.startsWith('auto') && !combined.includes('inactivity') && !combined.includes('9 pm')) return null;
  if (combined.includes('9 pm') || combined.includes('daily')) return { code: 'manual_logout', title: 'Session Closed', reason: reason || 'Session closed manually.' };
  if (combined.includes('inactivity') || combined.includes('30')) return { code: 'crm_lock', title: 'CRM Locked', reason: reason || 'Logged out after 10 minutes of inactivity.' };
  return { code: code || 'session_closed', title: 'Session Closed', reason: reason || 'Session closed.' };
}


function localReportDateKeys(now = new Date()) {
  const ist = istDateKey(now) || new Date().toISOString().slice(0, 10);
  return new Set([ist]);
}

function shouldRequireDailyAttendanceReport(user = {}, req = {}) {
  const role = lower(user.role || user.designation || '');
  if (!['recruiter', 'tl', 'team lead', 'teamlead'].includes(role)) return false;
  const code = lower(req.body?.logout_reason || req.body?.reason_code || '');
  const combined = `${code} ${String(req.body?.reason || req.body?.message || '')}`.toLowerCase();
  if (code.startsWith('auto') || combined.includes('inactivity') || combined.includes('session expired') || combined.includes('crm_lock')) return false;
  return true;
}

async function logoutPairedMobileForUser(user = {}, reason = 'crm_logout') {
  const userId = String(user?.user_id || '').trim();
  const username = String(user?.username || '').trim();
  if (!userId && !username) return { devices: 0, sessions: 0 };
  const stamp = nowIso();
  let devices = 0;
  let sessions = 0;
  try {
    if (store.pool && typeof store.query === 'function') {
      const deviceRows = await store.query(`update public.mobile_devices
        set status='Logged Out', device_token='', pairing_code='', logout_reason=$3, revoked_at=$4, last_seen_at=$4, updated_at=$4
        where (($1 <> '' and user_id=$1) or ($2 <> '' and lower(coalesce(username,''))=lower($2)))
          and (coalesce(device_token,'') <> '' or lower(coalesce(status,'')) in ('active','paired','pending'))
        returning device_id`, [userId, username, reason, stamp]);
      devices = Array.isArray(deviceRows) ? deviceRows.length : 0;
      const sessionRows = await store.query(`update public.dialer_sessions
        set status='Stopped', mobile_command='stop', command_type='stop', live_status=$3, stopped_at=$4, updated_at=$4
        where (($1 <> '' and (assigned_user_id=$1 or owner_user_id=$1)) or ($2 <> '' and (lower(coalesce(assigned_username,''))=lower($2) or lower(coalesce(owner_username,''))=lower($2))))
          and lower(coalesce(status,'')) not in ('stopped','cancelled','completed','deleted')
        returning session_id`, [userId, username, `Stopped because CRM logged out: ${reason}`, stamp]);
      sessions = Array.isArray(sessionRows) ? sessionRows.length : 0;
    } else {
      for (const row of await table('mobile_devices')) {
        const same = (userId && String(row.user_id || '') === userId) || (username && lower(row.username) === lower(username));
        if (!same) continue;
        if (String(row.device_token || '').trim() || ['active','paired','pending'].includes(lower(row.status))) {
          await store.update('mobile_devices', 'device_id', row.device_id, { status:'Logged Out', device_token:'', pairing_code:'', logout_reason:reason, revoked_at:stamp, last_seen_at:stamp, updated_at:stamp });
          devices += 1;
        }
      }
      for (const row of await table('dialer_sessions')) {
        const same = [row.assigned_user_id,row.owner_user_id].map(String).includes(userId) || [row.assigned_username,row.owner_username].some((v)=>username && lower(v)===lower(username));
        if (!same || ['stopped','cancelled','completed','deleted'].includes(lower(row.status))) continue;
        await store.update('dialer_sessions','session_id',row.session_id,{ status:'Stopped', mobile_command:'stop', command_type:'stop', live_status:`Stopped because CRM logged out: ${reason}`, stopped_at:stamp, updated_at:stamp });
        sessions += 1;
      }
    }
  } catch {}
  return { devices, sessions };
}

async function hasDailyAttendanceReportForToday(user = {}) {
  const userId = String(user.user_id || '').trim();
  if (!userId) return false;
  const keys = localReportDateKeys(new Date());
  const reports = await table('scheduled_reports');
  return reports.some((row) => {
    if (String(row.user_id || '') !== userId) return false;
    if (lower(row.report_type) !== 'attendance-daily') return false;
    const periodKey = String(row.period_key || '');
    if ([...keys].some((key) => periodKey.includes(`attendance:${key}:${userId}`))) return true;
    try {
      const snap = JSON.parse(row.snapshot_json || '{}');
      if (keys.has(String(snap.work_date || '').slice(0, 10))) return true;
    } catch {}
    const created = String(row.last_run_at || row.created_at || '').slice(0, 10);
    return keys.has(created);
  });
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

  let reloginLock = null;
  try {
    const inactivityMs = Number(process.env.CRM_INACTIVITY_LOGOUT_MS || (10 * 60 * 1000));
    reloginLock = await ensureReloginInactivityLock(user, inactivityMs);
  } catch (error) {
    try { console.warn('Relogin inactivity lock check skipped:', error?.message || error); } catch {}
  }

  // Upgrade legacy plaintext credentials only after a successful login. This preserves
  // the same password for the employee while removing plaintext-at-rest over time.
  try {
    const storedPassword = user.password || user.password_hash || '';
    if (passwordNeedsUpgrade(storedPassword) && user.user_id) {
      const upgraded = hashPassword(password);
      const patch = user.password ? { password: upgraded } : { password_hash: upgraded };
      await store.update('users', 'user_id', user.user_id, patch);
      Object.assign(user, patch);
    }
  } catch (error) {
    try { console.warn('Legacy password upgrade skipped:', error?.message || error); } catch {}
  }

  ensureDeviceId(req, res);
  const sessionToken = await registerActiveSession(user, req, '', { res });
  require('../lib/recentHumanActivity').markRecentHumanActivity({ ...user, session_token: sessionToken });
  res.cookie('career_crox_token', signUser(user, null, sessionToken), authCookie());
  try {
    await store.insert('activity_log', {
      activity_id: makeFastId('A'), user_id: user.user_id || '', username: user.username || '',
      action_type: 'user_login', candidate_id: '', metadata: JSON.stringify({ source: 'crm_login', timezone: 'Asia/Kolkata' }), created_at: nowIso(),
    });
  } catch {}
  return res.json({ user: sanitizeUser(user), attendance_locked: Boolean(reloginLock?.locked), unlock_request_id: reloginLock?.item?.request_id || '' });
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

function invalidatePairedDeviceCache() {
  try { require('./mobileDialerController').invalidateMobileSessionForLogout(); } catch {}
}

async function logout(req, res) {
  const autoKind = autoLogoutKind(req);
  if (autoKind?.code === 'crm_lock' && req.user?.user_id && !['manager','admin'].includes(lower(req.user.role))) {
    try {
      await lockPresenceForInactivity(req.user, autoKind.reason || '10-minute inactivity session ended.', { lockReason: 'session_inactivity', source: 'auto_inactivity_logout', notifyExisting: false });
    } catch {}
  }
  if (autoKind?.code !== 'crm_lock' && shouldRequireDailyAttendanceReport(req.user, req)) {
    const reportSent = await hasDailyAttendanceReportForToday(req.user);
    if (!reportSent) {
      return res.status(409).json({
        code: 'DAILY_ATTENDANCE_REPORT_REQUIRED',
        message: 'Send Daily Attendance Report before logout.',
        open_path: '/attendance',
      });
    }
  }
  if (autoKind && req.user?.user_id) {
    try {
      await notifyLeadership(
        autoKind.title,
        `${req.user.full_name || req.user.username || req.user.user_id} auto logged out. Reason: ${autoKind.reason}`,
        JSON.stringify({ user_id: req.user.user_id, username: req.user.username || '', reason_code: autoKind.code, reason: autoKind.reason, open_path: '/attendance' }),
      );
    } catch {}
  }
  try {
    if (req.user?.user_id) await store.insert('activity_log', {
      activity_id: makeFastId('A'), user_id: req.user.user_id || '', username: req.user.username || '',
      action_type: 'user_logout', candidate_id: '', metadata: JSON.stringify({ source: 'crm_logout', reason: String(req.body?.reason || req.body?.logout_reason || '') }), created_at: nowIso(),
    });
  } catch {}
  const mobileLogout = await logoutPairedMobileForUser(req.user || {}, String(req.body?.logout_reason || req.body?.reason || autoKind?.code || 'crm_manual_logout'));
  invalidatePairedDeviceCache();
  if (req.user?.username) await clearActiveSession(req.user.username, req.user.session_token || '');
  require('../lib/recentHumanActivity').markInactive(req.user, req.user?.session_token);
  res.clearCookie('career_crox_token', { path: '/' });
  return res.json({ ok: true, mobile_logged_out: true, mobile_devices_logged_out: mobileLogout.devices, dialer_sessions_stopped: mobileLogout.sessions });
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
  // Validate against the persisted user role. No data is changed for a denied request.
  const requestedTheme = String(req.body?.theme_name || 'peach-sky').trim().toLowerCase();
  if (['burgundy', 'crimson-noir'].includes(requestedTheme)) {
    const account = await store.findById('users', 'user_id', req.user.user_id);
    if (!account || canonicalRole(account.role, account.designation) !== 'manager') {
      return res.status(403).json({ message: 'This theme is available to Manager accounts only.' });
    }
  }
  const item = await store.update('users', 'user_id', req.user.user_id, {
    theme_name: requestedTheme,
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
    // CC26.237: keep Supabase rows safe. Clearing a custom theme must soft-hide the setting instead of physically deleting it.
    try {
      const existingSetting = await store.findById('settings', 'setting_key', settingKey);
      if (existingSetting) {
        await store.update('settings', 'setting_key', settingKey, {
          setting_value: '',
          status: 'Inactive',
          deleted_at: nowIso(),
          updated_at: nowIso(),
          notes: existingSetting.notes || 'User theme settings cleared safely',
        });
      }
    } catch {}
  }
  return res.json({ item });
}

module.exports = { login, selfRegister, requestPasswordReset, exportAccess, logout, me, theme };
