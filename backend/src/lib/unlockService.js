const { store, table, withTransaction, afterCommit } = require('./store');
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
  let context={};try{context=typeof item.context_json==='object'?item.context_json:JSON.parse(item.context_json||'{}');}catch{}
  const review=String(item.manager_review_status||'').toLowerCase()==='pending';
  return {type:item.access_kind==='youtube'?'youtube':'unlock',id:item.request_id,
    title:review?`${user.full_name||user.username} self-unlocked · Manager review`:`${user.full_name||user.username||'Employee'} ${item.access_kind==='youtube'?'YouTube access':'unlock'} request`,
    status:review?'Pending':item.status||'Pending',manager_review:review,requested_at:item.requested_at||item.created_at||nowIso(),
    recruiter_name:user.full_name||user.username||'',process:item.reason||user.recruiter_code||'',
    employee_note:context.employee_note||String(item.reason||'').split(/(?:Employee note:|Reason:)\s*/).at(-1),
    requester_role:canonicalRole(user),requester_user_id:user.user_id||item.user_id||'',
    late_minutes:context.late_minutes??item.late_minutes??'0',returned_at:item.returned_at||item.requested_at||'',
    break_started_at:context.break_started_at||'',break_ended_at:context.break_ended_at||'',
    break_expected_end_at:context.break_expected_end_at||'',break_active:Boolean(context.break_active),
    lock_reason:context.lock_reason||'',lock_started_at:context.lock_started_at||item.lock_started_at||'',
    unlock_number_today:context.unlock_number_today||'',unlock_date:context.unlock_date||'',self_approved_at:item.self_approved_at||''};
}
async function captureUnlockContext(user, employeeNote='') {
  const p=await store.findById('presence','user_id',user.user_id)||{},today=istDateKey(),from=new Date(Date.parse(today+'T00:00:00+05:30')).toISOString();
  const rows=store.pool?await store.query('select started_at,expected_end_at,ended_at from public.break_sessions where user_id=$1 and started_at >= $2 order by started_at desc limit 1',[user.user_id,from]):(await table('break_sessions')).filter(b=>String(b.user_id)===String(user.user_id)&&String(b.started_at||'')>=from).sort((a,b)=>String(b.started_at).localeCompare(String(a.started_at))).slice(0,1);
  const active=String(p.is_on_break)==='1',b=rows[0]||{},deadline=(p.lock_reason==='break_exceeded'?p.break_expected_end_at:'')||p.locked_at||'';
  const lockAt=Date.parse(deadline)||(Date.parse(p.last_activity_at||p.last_seen_at||'')+require('./sessionPolicy').inactivityMs(user))||Date.now();
  const total=store.pool?Number(await store.scalar("select count(*)::int as value from public.unlock_requests where user_id=$1 and lower(coalesce(status,''))='approved' and coalesce(nullif(self_approved_at,''),approved_at,'') >= $2 and coalesce(access_kind,'')<>'youtube'",[user.user_id,from])):(await table('unlock_requests')).filter(r=>String(r.user_id)===String(user.user_id)&&String(r.status).toLowerCase()==='approved'&&String(r.self_approved_at||r.approved_at||'')>=from&&r.access_kind!=='youtube').length;
  return {employee_note:String(employeeNote||'').trim(),break_started_at:active?p.break_started_at||b.started_at||'':b.started_at||'',
    break_expected_end_at:active?p.break_expected_end_at||b.expected_end_at||'':b.expected_end_at||'',
    break_ended_at:active?'':b.ended_at||'',break_active:active,lock_reason:p.lock_reason||'',lock_started_at:new Date(lockAt).toISOString(),
    late_minutes:String(Math.max(0,Math.floor((((p.lock_reason==='break_exceeded'&&!active&&Date.parse(b.ended_at||''))||Date.now())-lockAt)/60000))),unlock_number_today:total+1,unlock_date:today};
}

async function ensureUnlockRequestForUser(user = {}, reason = 'CRM unlock approval required.', options = {}) {
  if (!requiresApprovalLock(user) || !String(user?.user_id || '').trim() || options.autoCreated !== false) return { item: null, created: false, approvers: [] };
  return withTransaction(async () => {
    // One request per employee, even across tabs/server processes. Decisions use
    // this same lock; no schema changes or removal of old request history.
    if (store.pool) await store.query('select pg_advisory_xact_lock(hashtext($1))', ['career-crox-unlock:' + String(user.user_id)]);
    return ensureUnlockRequestInTransaction(user, reason, options);
  });
}

async function ensureUnlockRequestInTransaction(user = {}, reason = 'CRM unlock approval required.', options = {}) {
  if (!requiresApprovalLock(user) || !String(user?.user_id || '').trim()) return { item: null, created: false, approvers: [] };
  // Locking alone never creates a manager request. The employee must click Request for Access.
  if (options.autoCreated !== false) return { item:null,created:false,approvers:[] };
  const requests = store.pool && typeof store.query === 'function'
    ? await store.query(`select * from public.unlock_requests where user_id = $1 and coalesce(access_kind,'') <> 'youtube' and lower(coalesce(status,'')) = 'pending' order by requested_at desc, request_id desc for update`, [user.user_id])
    : await table('unlock_requests');
  const pendingRows = requests.filter((row) => row.access_kind!=='youtube' && String(row.user_id || '') === String(user.user_id || '') && String(row.status || '').trim().toLowerCase() === 'pending')
    .sort((a,b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')) || String(b.request_id || '').localeCompare(String(a.request_id || '')));
  const pending = pendingRows[0];
  const superseded = pendingRows.slice(1);
  for (const duplicate of superseded) await store.update('unlock_requests','request_id',duplicate.request_id,{status:'Superseded',updated_at:nowIso()});
  const context = await captureUnlockContext(user, options.employeeNote || reason);
  let item = pending;
  let created = false;
  if (pending) {
    // Automatic/relogin checks cannot overwrite the employee's manually saved note.
    const nextReason = options.notifyExisting === true
      ? (String(reason || pending.reason || '').trim() || pending.reason || '')
      : String(pending.reason || reason || 'CRM unlock approval required.');
    try {
      // A background lock-status check must never rewrite the same row repeatedly.
      item = nextReason !== String(pending.reason || '') || pending.auto_created === '1' || !pending.context_json
        ? await store.update('unlock_requests', 'request_id', pending.request_id, { reason: nextReason,context_json:JSON.stringify(context), updated_at: nowIso(),auto_created:'0',requested_at:pending.auto_created==='1'?nowIso():pending.requested_at,late_minutes:context.late_minutes,lock_started_at:options.lockStartedAt || pending.lock_started_at || '',returned_at:pending.returned_at || nowIso() })
        : pending;
      if (!item) throw new Error('Unlock request was not saved. Please retry.');
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
      auto_created:'0',context_json:JSON.stringify(context), late_minutes:context.late_minutes, lock_started_at:options.lockStartedAt || context.lock_started_at, returned_at:nowIso(),
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
  if (created || options.notifyExisting === true || superseded.length) await afterCommit(() => clearAllCaches(['approvals','access']));
  // Push as soon as the request is persisted; do NOT wait for notification rows.
  // One event/one request; no per-second full-table lookups.
  if (superseded.length) await afterCommit(() => {
    for (const duplicate of superseded) approvalLive.publishToUsers([...ids,user.user_id], 'unlock-resolved', {id:duplicate.request_id,status:'Superseded',requester_user_id:user.user_id});
  });
  if (!options.selfApprove && (created || (options.notifyExisting === true && (pending?.auto_created === '1' || pending?.reason !== item.reason)))) {
    await afterCommit(async () => {
    approvalLive.publishToUsers(ids, 'unlock', payload);
    approvalLive.publishToUsers([user.user_id], 'self-locked', payload);
    const metadata = JSON.stringify({ request_id: item.request_id, approval_kind:'unlock', user_id: user.user_id || '', requester_role: canonicalRole(user), open_path: '/approvals' });
    await Promise.allSettled(approvers.map((approver) => makeNotification(
      approver.user_id,
      'Employee unlock approval required',
      `${user.full_name || user.username || 'Employee'} requests CRM access. ${String(item.reason || '').slice(0, 180)}`,
      metadata,
    )));
    });
  }
  // Manual reason updates must invalidate approval caches too, otherwise the manager can
  // keep seeing a stale pending list even though the request was updated successfully.
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
      locked_at:options.lockedAt||nowIso(),
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

async function ensureReloginInactivityLock(user = {}, inactivityMs = require('./sessionPolicy').inactivityMs(user)) {
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
        if (exitReason.includes('night_idle_logout'))return {locked:false,signedOut:true};
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
  return lockPresenceForInactivity(user, `Inactivity session ended after ${mins} minutes. ${approverLabel} is required before work resumes.`, { lockReason: 'inactivity_relogin', source:'relogin_after_inactivity',notifyExisting:false,lockedAt:new Date(last+Math.max(1,Number(inactivityMs||0))).toISOString() });
}

module.exports = { lockMessage, ensureUnlockRequestForUser, lockPresenceForInactivity, ensureReloginInactivityLock, approvalPayload };
