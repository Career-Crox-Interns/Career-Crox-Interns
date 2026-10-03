// CC26_619: per-user, one-shot idle lifecycle; no recurring DB polling.
// The registry is populated only by password login and explicit /auth/activity.
const IDLE_MS = 10 * 60 * 1000;
const active = new Map();
const streams = new Map();
// Known ended browser sessions: reject old-tab loops before any DB lookup.
const revokedTokens = new Map();
function revokedKey(user) { return `${keyOf(user)}:${String(user?.session_token || '').trim()}`; }
function markRevoked(user) {
  const key = revokedKey(user); if (!key.endsWith(':') && key !== ':') {
    revokedTokens.set(key, Date.now());
    if (revokedTokens.size > 1500) {
      const now = Date.now();
      for (const [token, at] of revokedTokens) if (now-at > 24*60*60*1000) revokedTokens.delete(token);
      while (revokedTokens.size > 1500) revokedTokens.delete(revokedTokens.keys().next().value);
    }
  }
}
function isKnownRevoked(user) { const at = revokedTokens.get(revokedKey(user)); return Boolean(at && Date.now()-at < 24*60*60*1000); }
const keyOf = (user) => String(user?.username || '').trim().toLowerCase();

function closeStreams(user) {
  const key = keyOf(user);
  const set = streams.get(key);
  if (!set) return;
  streams.delete(key);
  for (const res of set) { try { res.end(); } catch (_) {} }
}
function registerStream(user, res) {
  const key = keyOf(user);
  if (!key || !res) return () => {};
  let set = streams.get(key);
  if (!set) { set = new Set(); streams.set(key, set); }
  set.add(res);
  const remove = () => { set.delete(res); if (!set.size) streams.delete(key); };
  res.on?.('close', remove);
  return remove;
}
function markInactive(user, token = '') {
  const key = keyOf(user), existing = active.get(key);
  if (!key) return;
  // Old tab/old logout must not revoke a newer login on the same account.
  if (existing && token && existing.token && existing.token !== token) return;
  if (existing?.timer) clearTimeout(existing.timer);
  active.delete(key);
  if (token || existing?.token) markRevoked({ username:key, session_token: token || existing?.token });
  closeStreams(user);
}
function markRecentHumanActivity(user = {}) {
  const key = keyOf(user), token = String(user.session_token || '').trim();
  if (!key || !token) return;
  const old = active.get(key);
  if (old?.timer) clearTimeout(old.timer);
  const snapshot = {
    user_id: String(user.user_id || ''), username: String(user.username || ''),
    full_name: String(user.full_name || user.username || ''),
    role: String(user.role || user.designation || ''),
    designation: String(user.designation || user.role || ''),
    session_token: token,
  };
  const entry = { at: Date.now(), token, timer: null, user: snapshot };
  active.set(key, entry);
  entry.timer = setTimeout(() => { void expireOneSession(key, entry); }, IDLE_MS + 600);
  entry.timer.unref?.();
}
function hasRecentHumanActivity(windowMs = IDLE_MS) {
  const now = Date.now();
  for (const row of active.values()) if (now - row.at < Math.min(windowMs, IDLE_MS)) return true;
  return false;
}
function isRecentlyActive(user, windowMs = IDLE_MS) {
  const row = active.get(keyOf(user));
  return Boolean(row && (!user?.session_token || row.token === String(user.session_token)) && Date.now() - row.at < windowMs);
}
async function expireOneSession(key, entry) {
  if (active.get(key) !== entry) return;
  if (Date.now() - entry.at < IDLE_MS) {
    entry.timer = setTimeout(() => { void expireOneSession(key, entry); }, IDLE_MS - (Date.now() - entry.at) + 600);
    entry.timer.unref?.(); return;
  }
  // Close event-based transports immediately. The employee cannot start another
  // long-running stream until a fresh password login has been verified.
  active.delete(key);
  closeStreams(entry.user);
  try {
    const { store } = require('./store');
    if (!store.pool || typeof store.query !== 'function') return;
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - IDLE_MS).toISOString();
    // Compare the exact token AND the persisted activity timestamp atomically.
    // Never revoke a newer login or a recent activity update. No DELETE/TRUNCATE.
    let changed;
    try {
      changed = await store.query(`update public.active_sessions
        set session_token='', status='Logged Out', revoked_at=$3, logout_at=$3, updated_at=$3
        where username=$1 and session_token=$2
          and nullif(last_seen_at::text, '')::timestamptz <= $4::timestamptz
        returning username`, [entry.user.username, entry.token, now, cutoff]);
    } catch (error) {
      // Legacy schemas may omit last_seen_at; use the existing updated_at column.
      // If the conditional update cannot be made safely, defer to request-time
      // session expiry rather than risking someone's active session/data.
      if (!/last_seen_at.*does not exist|column .*last_seen_at/i.test(String(error.message || ''))) return;
      changed = await store.query(`update public.active_sessions
        set session_token='', status='Logged Out', revoked_at=$3, logout_at=$3, updated_at=$3
        where username=$1 and session_token=$2
          and nullif(updated_at::text, '')::timestamptz <= $4::timestamptz
        returning username`, [entry.user.username, entry.token, now, cutoff]);
    }
    if (!changed?.length) return;
    markRevoked(entry.user);
    if (!['manager', 'admin'].includes(entry.user.role.toLowerCase())) {
      await require('./unlockService').lockPresenceForInactivity(
        entry.user, '10 minutes without CRM use. Sign in and request unlock approval.',
        { lockReason: 'session_inactivity', source: 'server_10m_idle', notifyExisting: false }
      ).catch(() => {});
    }
    const { revokeMobilePairingForExpiredCrmSession } = require('../middleware/auth');
    await revokeMobilePairingForExpiredCrmSession(entry.user, 'crm_inactivity_session_expired');
    try { require('../controllers/mobileDialerController').invalidateMobileSessionForLogout(); } catch (_) {}
  } catch (error) {
    console.warn('One-shot idle cleanup deferred to next authenticated request:', error?.message || String(error));
  }
}
module.exports = { markRecentHumanActivity, hasRecentHumanActivity, isRecentlyActive, markInactive, registerStream, closeStreams, isKnownRevoked, markRevoked };
