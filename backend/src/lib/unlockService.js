const { store, table } = require('./store');
const crypto = require('node:crypto');
const { nowIso } = require('./helpers');
const { requiresApprovalLock, eligibleApprovers, canonicalRole } = require('./unlockPolicy');
const approvalLive = require('./approvalLive');
const { clearAllCaches } = require('./cache');

function istDateKey(value = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  } catch {
    return String(value || '').slice(0, 10);
  }
}

function lockMessage() {
  return 'CRM Access Paused. Unlock approval is required before work can continue.';
}

async function makeNotification(userId, title, message, metadata = '') {
  try {
    const item = {
      notification_id: `N${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`.toUpperCase(),
      user_id: userId,
      title,
      message,
      category: 'attendance',
      status: 'Unread',
      metadata,
      created_at: nowIso(),
    };
    await store.insert('notifications', item);
    return item;
  } catch {
    return null;
  }
}

async function approversForUser(user = {}) {
  const users = await table('users').catch(() => []);
  return eligibleApprovers(users, user);
}

function approvalPayload(user = {}, item = {}) {
  return {
    type: 'unlock',
    id: item.request_id,
    title: `${user.full_name || user.username || 'Employee'} unlock request`,
    status: item.status || 'Pending',
    requested_at: item.requested_at || item.created_at || nowIso(),
    recruiter_name: user.full_name || user.username || '',
    process: item.reason || user.recruiter_code || '',
    requester_role: canonicalRole(user),
    requester_user_id: user.user_id || '',
  };
}

async function ensureUnlockRequestForUser(user = {}, reason = 'CRM unlock approval required.', options = {}) {
  if (!requiresApprovalLock(user) || !String(user?.user_id || '').trim()) return { item: null, created: false, approvers: [] };
  const requests = store.pool && typeof store.query === 'function'
    ? await store.query(`select * from public.unlock_requests where user_id = $1 and lower(coalesce(status,'')) = 'pending' order by requested_at desc limit 1`, [user.user_id])
    : await table('unlock_requests');
  const pending = requests.find((row) => String(row.user_id || '') === String(user.user_id || '') && String(row.status || '').trim().toLowerCase() === 'pending');
  let item = pending;
  let created = false;
  if (pending) {
    // Automatic/relogin checks cannot overwrite the employee's manually saved note.
    const nextReason = options.notifyExisting === true
      ? (String(reason || pending.reason || '').trim() || pending.reason || '')
      : String(pending.reason || reason || 'CRM unlock approval required.');
    try {
      // A background lock-status check must never rewrite the same row repeatedly.
      item = nextReason !== String(pending.reason || '')
        ? (await store.update('unlock_requests', 'request_id', pending.request_id, { reason: nextReason, updated_at: nowIso() }) || { ...pending, reason: nextReason })
        : pending;
    } catch (error) {
      // Do not confirm a user-entered late reason unless it was actually persisted.
      if (options.notifyExisting === true && options.autoCreated === false) throw error;
      item = pending;
    }
  } else {
    item = {
      request_id: `UR${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`.toUpperCase(),
      user_id: user.user_id,
      username: user.username || '',
      full_name: user.full_name || user.username || '',
      status: 'Pending',
      reason: String(reason || 'CRM unlock approval required.').trim(),
      auto_created: options.autoCreated === false ? '0' : '1',
      requested_at: nowIso(),
      created_at: nowIso(),
      updated_at: nowIso(),
      approved_by_user_id: '',
      approved_by_name: '',
      approved_at: '',
    };
    await store.insert('unlock_requests', item);
    created = true;
  }
  const approvers = await approversForUser(user);
  const ids = approvers.map((row) => String(row.user_id || '')).filter(Boolean);
  const payload = approvalPayload(user, item);
  // Push as soon as the request is persisted; do NOT wait for notification rows.
  // One event/one request; no per-second full-table lookups.
  if (created || options.notifyExisting === true) {
    approvalLive.publishToUsers(ids, 'unlock', payload);
    approvalLive.publishToUsers([user.user_id], 'self-locked', payload);
    const metadata = JSON.stringify({ request_id: item.request_id, user_id: user.user_id || '', requester_role: canonicalRole(user), open_path: '/approvals' });
    await Promise.allSettled(approvers.map((approver) => makeNotification(
      approver.user_id,
      'Employee unlock approval required',
      `${user.full_name || user.username || 'Employee'} requests CRM access. ${String(item.reason || '').slice(0, 180)}`,
      metadata,
    )));
  }
  // Manual reason updates must invalidate approval caches too, otherwise the manager can
  // keep seeing a stale pending list even though the request was updated successfully.
  if (created || options.notifyExisting === true) clearAllCaches();
  return { item, created, approvers, payload };
}

async function lockPresenceForInactivity(user = {}, reason = 'Inactivity lock.', options = {}) {
  if (!requiresApprovalLock(user) || !String(user?.user_id || '').trim()) return { locked: false, item: null };
  const presence = await store.findById('presence', 'user_id', user.user_id);
  if (!presence || !presence.work_started_at) return { locked: false, item: null };
  if (String(presence.is_on_break || '0') === '1' && String(presence.lock_reason || '') === 'break') return { locked: false, breakActive: true, item: null };
  const alreadyLocked = String(presence.locked || '0') === '1';
  if (!alreadyLocked) {
    await store.update('presence', 'user_id', user.user_id, {
      locked: '1',
      lock_reason: options.lockReason || 'idle',
      lock_message: lockMessage(),
      unlock_grace_until: '',
    });
    try {
      await store.insert('activity_log', {
        activity_id: `A${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase(),
        user_id: user.user_id || '', username: user.username || '', action_type: 'crm_locked', candidate_id: '',
        metadata: JSON.stringify({ source: options.source || 'session_inactivity', reason: String(reason || '') }), created_at: nowIso(),
      });
    } catch {}
  }
  const request = await ensureUnlockRequestForUser(user, reason, { autoCreated: true, notifyExisting: options.notifyExisting === true });
  return { locked: true, alreadyLocked, ...request };
}

async function ensureReloginInactivityLock(user = {}, inactivityMs = 10 * 60 * 1000) {
  if (!requiresApprovalLock(user)) {
    const presence = String(user?.user_id || '').trim() ? await store.findById('presence', 'user_id', user.user_id) : null;
    if (presence && String(presence.locked || '0') === '1') {
      try {
        await store.update('presence', 'user_id', user.user_id, { locked: '0', lock_reason: '', lock_message: '', unlock_grace_until: '' });
        clearAllCaches();
      } catch {}
    }
    return { locked: false, exempt: true };
  }
  const presence = await store.findById('presence', 'user_id', user.user_id);
  if (!presence || !presence.work_started_at) return { locked: false };
  if (String(presence.is_on_break || '0') === '1') {
    if (String(presence.lock_reason || '') === 'break') return { locked: false, breakActive: true };
    if (String(presence.locked || '0') === '1') return lockPresenceForInactivity(user, presence.lock_message || 'Break approval lock is still active.', { lockReason: presence.lock_reason || 'break_exceeded', source: 'relogin_existing_lock' });
    return { locked: false };
  }
  if (String(presence.locked || '0') === '1') {
    return lockPresenceForInactivity(user, presence.lock_message || 'Existing CRM lock requires approval.', { lockReason: presence.lock_reason || 'idle', source: 'relogin_existing_lock', notifyExisting: false });
  }
  // CC26_601: Closing a laptop prevents its local 30-minute timer from firing.
  // On next password login, check the server's last known activity even if the
  // work session started yesterday. Respect a real manual/daily logout so a
  // properly signed-out employee is NOT incorrectly locked next morning.
  const lastServerActivityMs = Date.parse(String(presence.last_activity_at || presence.last_seen_at || presence.work_started_at || '')) || 0;
  if (lastServerActivityMs && Date.now() - lastServerActivityMs >= Math.max(1, Number(inactivityMs || 0))) {
    try {
      const exits = store.pool
        ? await store.query(`select created_at, metadata from public.activity_log where user_id = $1 and lower(action_type) = 'user_logout' and created_at >= $2 order by created_at desc limit 1`,
          [user.user_id, new Date(lastServerActivityMs).toISOString()])
        : (await table('activity_log')).filter(row => String(row.user_id || '') === String(user.user_id || '') && String(row.action_type || '').toLowerCase() === 'user_logout' && (Date.parse(row.created_at || '') || 0) >= lastServerActivityMs).sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || ''))).slice(0, 1);
      const lastExit = exits[0];
      if (lastExit) {
        let metadata = {};
        try { metadata = typeof lastExit.metadata === 'string' ? JSON.parse(lastExit.metadata) : (lastExit.metadata || {}); } catch {}
        const exitReason = String(metadata.reason || metadata.reason_code || '').toLowerCase();
        if (!exitReason.includes('inactivity') && !exitReason.includes('crm_lock')) return { locked: false, signedOut: true };
      }
    } catch (error) {
      // Never silently unlock because a status lookup failed; the existing
      // presence lock and password flow remain the authority.
      throw error;
    }
  }
  const grace = Date.parse(String(presence.unlock_grace_until || '')) || 0;
  if (grace && Date.now() < grace) return { locked: false };
  const last = Date.parse(String(presence.last_activity_at || presence.last_seen_at || presence.work_started_at || '')) || 0;
  if (!last || (Date.now() - last) < Math.max(1, Number(inactivityMs || 0))) return { locked: false };
  const mins = Math.max(1, Math.floor((Date.now() - last) / 60000));
  const approverLabel = canonicalRole(user) === 'tl' ? 'Manager approval' : 'TL/Manager approval';
  return lockPresenceForInactivity(user, `Inactivity session ended after ${mins} minutes. ${approverLabel} is required before work resumes.`, { lockReason: 'inactivity_relogin', source: 'relogin_after_inactivity', notifyExisting: false });
}

module.exports = { lockMessage, ensureUnlockRequestForUser, lockPresenceForInactivity, ensureReloginInactivityLock, approvalPayload };
