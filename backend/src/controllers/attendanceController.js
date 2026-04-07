const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');
const { getSettingsMap } = require('../lib/settings');

function basePresence(userId, page = '/attendance') {
  return {
    user_id: userId,
    last_seen_at: nowIso(),
    last_page: page,
    is_on_break: '0',
    break_reason: '',
    break_started_at: '',
    break_expected_end_at: '',
    total_break_minutes: '0',
    locked: '0',
    lock_reason: '',
    lock_message: '',
    unlock_grace_until: '',
    last_call_dial_at: '',
    last_call_candidate_id: '',
    last_call_alert_sent_at: '',
    meeting_joined: '1',
    meeting_joined_at: nowIso(),
    screen_sharing: '0',
    screen_frame_url: '',
    last_screen_frame_at: '',
    work_started_at: nowIso(),
    total_work_minutes: '0',
  };
}

function minutesBetween(a, b = new Date()) {
  if (!a) return 0;
  const ms = b.getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.round(ms / 60000);
}

function addMinutes(dateIso, minutes) {
  const d = new Date(dateIso || Date.now());
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  return d.toISOString();
}

function isToday(dateIso) {
  if (!dateIso) return false;
  return String(dateIso).slice(0, 10) === new Date().toISOString().slice(0, 10);
}

async function makeNotification(userId, title, message, category = 'attendance', metadata = '') {
  const rows = await table('notifications');
  const item = {
    notification_id: nextId('N', rows, 'notification_id'),
    user_id: userId,
    title,
    message,
    category,
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  };
  await store.insert('notifications', item);
  return item;
}

async function notifyLeadership(title, message, metadata = '') {
  const users = await table('users');
  const leaders = users.filter((u) => ['admin', 'manager', 'tl'].includes(String(u.role || '').toLowerCase()));
  for (const leader of leaders) {
    await makeNotification(leader.user_id, title, message, 'attendance', metadata);
  }
}

async function logActivity(req, actionType, metadata = {}, candidateId = '') {
  const rows = await table('activity_log');
  const item = {
    activity_id: nextId('A', rows, 'activity_id'),
    user_id: req.user.user_id,
    username: req.user.username,
    action_type: actionType,
    candidate_id: candidateId,
    metadata: JSON.stringify(metadata),
    created_at: nowIso(),
  };
  await store.insert('activity_log', item);
  return item;
}

async function userMap() {
  const users = await table('users');
  const map = new Map();
  for (const user of users) map.set(String(user.user_id), user);
  return map;
}

function buildSummary(presence, settings = {}) {
  const sessionMinutes = isToday(presence?.work_started_at) ? minutesBetween(presence?.work_started_at) : 0;
  const breakMinutes = Number(presence?.total_break_minutes || '0');
  const productiveMinutes = Math.max(sessionMinutes - breakMinutes, 0);
  const remainingWorkMinutes = Math.max(480 - productiveMinutes, 0);
  const breakAllowanceMinutes = Number(settings.break_limit_minutes || 120);
  const remainingBreakMinutes = Math.max(breakAllowanceMinutes - breakMinutes, 0);
  let dayStatus = 'No Work Day';
  if (productiveMinutes >= 480) dayStatus = 'Full Day';
  else if (productiveMinutes >= 300) dayStatus = 'Half Day';
  return {
    joined_today: isToday(presence?.work_started_at),
    joined_at: presence?.work_started_at || '',
    session_minutes: String(sessionMinutes),
    total_break_minutes: String(breakMinutes),
    productive_work_minutes: String(productiveMinutes),
    remaining_work_minutes: String(remainingWorkMinutes),
    remaining_break_minutes: String(remainingBreakMinutes),
    locked: presence?.locked || '0',
    day_status: dayStatus,
  };
}


function isLeadershipRole(user) {
  return ['admin', 'manager', 'tl'].includes(String(user?.role || '').toLowerCase());
}

function wantsCompactResponse(req) {
  return String(req.query?.compact || req.body?.compact || '').trim() === '1' || req.body?.compact === true;
}

async function attendanceGateSnapshot(req, explicitPresence = null, explicitSettings = null) {
  const settings = explicitSettings || await getSettingsMap();
  const presence = explicitPresence || await store.findById('presence', 'user_id', req.user.user_id);
  return {
    presence,
    today_stats: buildSummary(presence, settings),
    settings: {
      break_limit_minutes: Number(settings.break_limit_minutes || 120),
      crm_lock_idle_minutes: Number(settings.crm_lock_idle_minutes || 10),
      crm_lock_no_call_minutes: Number(settings.crm_lock_no_call_minutes || 15),
    },
  };
}

async function ensurePendingUnlockRequest(req, reason) {
  const requests = await table('unlock_requests');
  const pending = requests.find((r) => String(r.user_id) === String(req.user.user_id) && String(r.status || '').toLowerCase() === 'pending');
  if (pending) return pending;
  const item = {
    request_id: nextId('UR', requests, 'request_id'),
    user_id: req.user.user_id,
    status: 'Pending',
    reason,
    requested_at: nowIso(),
    approved_by_user_id: '',
    approved_by_name: '',
    approved_at: '',
  };
  await store.insert('unlock_requests', item);
  await logActivity(req, 'unlock_requested', { reason: item.reason, auto_created: true });
  await notifyLeadership(
    'CRM unlock requested',
    `${req.user.full_name || req.user.username} requested unlock.`,
    JSON.stringify({ user_id: req.user.user_id, open_path: '/attendance' }),
  );
  return item;
}

async function attendanceSnapshot(req) {
  const settings = await getSettingsMap();
  const presence = await store.findById('presence', 'user_id', req.user.user_id);
  const allRequests = await table('unlock_requests');
  const requests = isLeadershipRole(req.user)
    ? allRequests.slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')))
    : allRequests.filter((r) => String(r.user_id) === String(req.user.user_id)).sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const usersById = await userMap();
  const allPresence = await table('presence');
  const scopedPresence = isLeadershipRole(req.user)
    ? allPresence
    : allPresence.filter((p) => String(p.user_id) === String(req.user.user_id));
  const teamWorking = scopedPresence
    .map((p) => {
      const user = usersById.get(String(p.user_id)) || {};
      return {
        user_id: p.user_id,
        full_name: user.full_name || user.username || p.user_id,
        designation: user.designation || '',
        recruiter_code: user.recruiter_code || '',
        role: user.role || '',
        locked: p.locked || '0',
        is_on_break: p.is_on_break || '0',
        break_reason: p.break_reason || '',
        lock_reason: p.lock_reason || '',
        lock_message: p.lock_message || '',
        last_seen_at: p.last_seen_at || '',
        work_started_at: p.work_started_at || '',
        total_break_minutes: p.total_break_minutes || '0',
      };
    })
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const activity = (await table('activity_log'))
    .filter((row) => ['join_work', 'break_started', 'break_ended', 'break_exceeded', 'crm_locked', 'crm_unlocked', 'unlock_requested', 'over_break_alert', 'no_call_lock', 'attendance_report_sent'].includes(String(row.action_type || '').toLowerCase()))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const mine = activity.filter((row) => String(row.user_id) === String(req.user.user_id));
  const todayStats = buildSummary(presence, settings);
  return {
    presence,
    requests,
    settings,
    today_stats: {
      break_count: String(mine.filter((row) => String(row.action_type || '').toLowerCase() === 'break_started' && isToday(row.created_at)).length),
      ...todayStats,
    },
    team_working: teamWorking,
    logs: isLeadershipRole(req.user) ? activity.slice(0, 150) : mine.slice(0, 60),
    all_logs: activity.slice(0, 150),
  };
}

async function getOne(req, res) {
  if (wantsCompactResponse(req)) return res.json(await attendanceGateSnapshot(req));
  return res.json(await attendanceSnapshot(req));
}

async function join(req, res) {
  const compact = wantsCompactResponse(req);
  const existing = await store.findById('presence', 'user_id', req.user.user_id);
  if (existing && isToday(existing.work_started_at)) {
    return res.json(compact ? await attendanceGateSnapshot(req, existing) : await attendanceSnapshot(req));
  }
  const item = await store.upsert('presence', 'user_id', {
    ...basePresence(req.user.user_id, req.body.last_page || '/attendance'),
    locked: '0',
    lock_reason: '',
    lock_message: '',
    unlock_grace_until: '',
    total_break_minutes: '0',
  });
  await logActivity(req, 'join_work', { page: req.body.last_page || '/attendance', joined_at: item.work_started_at });
  await notifyLeadership(
    'Office joined',
    `${req.user.full_name || req.user.username} joined office at ${new Date().toLocaleTimeString()}.`,
    JSON.stringify({ user_id: req.user.user_id, open_path: '/attendance' }),
  );
  return res.json(compact ? await attendanceGateSnapshot(req, item) : await attendanceSnapshot(req));
}

async function startBreak(req, res) {
  const compact = wantsCompactResponse(req);
  const presence = (await store.findById('presence', 'user_id', req.user.user_id)) || null;
  if (!presence || !isToday(presence.work_started_at)) return res.status(400).json({ message: 'Join office first' });
  if (String(presence.is_on_break || '0') === '1') return res.json(compact ? await attendanceGateSnapshot(req, presence) : await attendanceSnapshot(req));
  const reason = req.body.reason || 'Break';
  const plannedMinutes = String(req.body.planned_minutes || '10');
  const leadership = isLeadershipRole(req.user);
  await store.upsert('presence', 'user_id', {
    ...presence,
    is_on_break: '1',
    break_reason: reason,
    break_started_at: nowIso(),
    break_expected_end_at: addMinutes(nowIso(), plannedMinutes),
    locked: leadership ? '0' : '1',
    lock_reason: leadership ? '' : 'break',
    lock_message: leadership ? '' : 'Break started. End the break to resume CRM access.',
    last_seen_at: nowIso(),
  });
  await logActivity(req, 'break_started', { reason, planned_minutes: plannedMinutes });
  const nextPresence = await store.findById('presence', 'user_id', req.user.user_id);
  return res.json(compact ? await attendanceGateSnapshot(req, nextPresence) : await attendanceSnapshot(req));
}

async function endBreak(req, res) {
  const compact = wantsCompactResponse(req);
  const existing = await store.findById('presence', 'user_id', req.user.user_id);
  if (!existing) return res.status(400).json({ message: 'Join office first' });
  if (String(existing.is_on_break || '0') !== '1') return res.json(compact ? await attendanceGateSnapshot(req, existing) : await attendanceSnapshot(req));
  const usedMinutes = minutesBetween(existing.break_started_at);
  const priorBreak = Number(existing?.total_break_minutes || '0');
  const exceeded = existing?.break_expected_end_at ? Date.now() > new Date(existing.break_expected_end_at).getTime() : false;
  const updates = {
    is_on_break: '0',
    break_reason: '',
    break_started_at: '',
    break_expected_end_at: '',
    last_seen_at: nowIso(),
    total_break_minutes: String(priorBreak + usedMinutes),
    last_call_alert_sent_at: '',
    lock_reason: '',
    lock_message: '',
    unlock_grace_until: '',
  };
  const leadership = isLeadershipRole(req.user);
  if (exceeded && !leadership) {
    updates.locked = '1';
    updates.break_reason = existing.break_reason || 'Break limit exceeded';
    updates.break_expected_end_at = existing.break_expected_end_at || '';
    updates.lock_reason = 'break_exceeded';
    updates.lock_message = 'Break limit exceeded. Please contact your reporting lead and request CRM unlock approval.';
    updates.unlock_grace_until = '';
    await logActivity(req, 'break_exceeded', { break_minutes: usedMinutes });
    await ensurePendingUnlockRequest(req, 'Break limit exceeded. Please approve CRM unlock.');
  } else {
    updates.locked = '0';
    updates.lock_reason = '';
    updates.lock_message = '';
    updates.unlock_grace_until = addMinutes(nowIso(), 15);
    updates.last_call_dial_at = nowIso();
    await logActivity(req, exceeded ? 'break_exceeded' : 'break_ended', { break_minutes: usedMinutes, leadership_bypass: leadership && exceeded });
  }
  await store.update('presence', 'user_id', req.user.user_id, updates);
  const nextPresence = await store.findById('presence', 'user_id', req.user.user_id);
  return res.json(compact ? await attendanceGateSnapshot(req, nextPresence) : await attendanceSnapshot(req));
}

async function requestUnlock(req, res) {
  const compact = wantsCompactResponse(req);
  await ensurePendingUnlockRequest(req, req.body.reason || 'Unlock requested');
  return res.json(compact ? await attendanceGateSnapshot(req) : await attendanceSnapshot(req));
}

async function ping(req, res) {
  const compact = wantsCompactResponse(req);
  const settings = await getSettingsMap();
  const existing = await store.findById('presence', 'user_id', req.user.user_id);
  const leadership = isLeadershipRole(req.user);
  const idleMinutes = Number(settings.crm_lock_idle_minutes || 10);
  const noCallMinutes = Number(settings.crm_lock_no_call_minutes || 15);
  const breakWarnMinutes = Number(settings.crm_lock_break_warning_minutes || 3);
  const nextPage = req.body.last_page || '/dashboard';
  const now = Date.now();
  if (!existing) {
    return res.json(compact ? await attendanceGateSnapshot(req, null, settings) : await attendanceSnapshot(req));
  }

  const lastSeen = new Date(existing.last_seen_at || 0).getTime();
  const lastCall = new Date(existing.last_call_dial_at || existing.work_started_at || 0).getTime();
  const unlockGraceUntil = new Date(existing.unlock_grace_until || 0).getTime();
  const onBreak = String(existing.is_on_break || '0') === '1';
  const updates = {
    last_page: nextPage,
    total_work_minutes: String(minutesBetween(existing.work_started_at)),
  };
  if (!onBreak) updates.last_seen_at = nowIso();

  const withinUnlockGrace = unlockGraceUntil && now < unlockGraceUntil;
  const callSensitivePages = ['/candidates', '/candidate/', '/followups', '/interviews', '/submissions'];
  const noCallTrackingEnabled = callSensitivePages.some((page) => String(nextPage || '').startsWith(page));
  const shouldLockIdle = !leadership && !onBreak && existing.locked !== '1' && !withinUnlockGrace && lastSeen && idleMinutes > 0 && (now - lastSeen) > idleMinutes * 60 * 1000;
  const shouldLockNoCall = !leadership && !onBreak && existing.locked !== '1' && !withinUnlockGrace && noCallTrackingEnabled && lastCall && noCallMinutes > 0 && (now - lastCall) > noCallMinutes * 60 * 1000;

  if (shouldLockIdle) {
    updates.locked = '1';
    updates.lock_reason = 'idle';
    updates.lock_message = 'No activity was detected for the configured idle limit. Please contact your reporting lead and request CRM unlock approval.';
    updates.unlock_grace_until = '';
    await logActivity(req, 'crm_locked', { idle_minutes: idleMinutes, page: nextPage });
    await notifyLeadership(
      'CRM locked for inactivity',
      `${req.user.full_name || req.user.username} was locked after ${idleMinutes} minutes idle.`,
      JSON.stringify({ user_id: req.user.user_id, open_path: '/attendance' }),
    );
  }
  if (shouldLockNoCall) {
    updates.locked = '1';
    updates.lock_reason = 'no_call';
    updates.lock_message = 'No call activity was detected for the configured limit. Please contact your reporting lead and request CRM unlock approval.';
    updates.unlock_grace_until = '';
    await logActivity(req, 'no_call_lock', { no_call_minutes: noCallMinutes, page: nextPage });
    await notifyLeadership(
      'CRM locked for no call activity',
      `${req.user.full_name || req.user.username} was locked due to no call activity.`,
      JSON.stringify({ user_id: req.user.user_id, open_path: '/attendance' }),
    );
  }
  if (!leadership && onBreak && existing.break_expected_end_at && now > new Date(existing.break_expected_end_at).getTime()) {
    updates.locked = '1';
    updates.lock_reason = 'break_exceeded';
    updates.lock_message = 'Break limit exceeded. Please contact your reporting lead and request CRM unlock approval.';
    updates.unlock_grace_until = '';
    const lastAlert = new Date(existing.last_call_alert_sent_at || 0).getTime();
    if (!lastAlert || (now - lastAlert) > breakWarnMinutes * 60 * 1000) {
      updates.last_call_alert_sent_at = nowIso();
      await logActivity(req, 'over_break_alert', { reason: existing.break_reason || 'Break' });
      await notifyLeadership(
        'Employee over break',
        `${req.user.full_name || req.user.username} is over break for ${existing.break_reason || 'Break'}.`,
        JSON.stringify({ user_id: req.user.user_id, open_path: '/attendance' }),
      );
    }
  }
  await store.update('presence', 'user_id', req.user.user_id, updates);
  if (compact) {
    const nextPresence = await store.findById('presence', 'user_id', req.user.user_id);
    return res.json(await attendanceGateSnapshot(req, nextPresence, settings));
  }
  return res.json(await attendanceSnapshot(req));
}

async function logoutSummary(req, res) {
  const settings = await getSettingsMap();
  const presence = await store.findById('presence', 'user_id', req.user.user_id);
  return res.json({ summary: buildSummary(presence, settings), presence });
}

async function sendReport(req, res) {
  const settings = await getSettingsMap();
  const presence = await store.findById('presence', 'user_id', req.user.user_id);
  const summary = buildSummary(presence, settings);
  const message = `${req.user.full_name || req.user.username} sent report. Worked ${summary.productive_work_minutes} min, breaks ${summary.total_break_minutes} min, status ${summary.day_status}.`;
  await notifyLeadership('Daily attendance report', message, JSON.stringify({ user_id: req.user.user_id, open_path: '/attendance' }));
  await makeNotification(req.user.user_id, 'Report sent', 'Your daily report was sent to leadership.', 'attendance', JSON.stringify({ open_path: '/attendance' }));
  await logActivity(req, 'attendance_report_sent', summary);
  return res.json({ ok: true, summary });
}

module.exports = {
  getOne,
  join,
  startBreak,
  endBreak,
  requestUnlock,
  ping,
  logoutSummary,
  sendReport,
};
