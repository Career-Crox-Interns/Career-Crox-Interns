const streams = new Map();
const streamUsers = new Map();

function userKey(user = {}) {
  return String(user?.user_id || user?.id || user?.username || '').trim();
}

function attach(req, res) {
  const key = userKey(req.user);
  if (!key) return res.status(401).json({ message: 'Not authenticated' });
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const set = streams.get(key) || new Set();
  set.add(res);
  streams.set(key, set);
  streamUsers.set(key, { ...(req.user || {}) });
  const untrackIdle = require('./recentHumanActivity').registerStream(req.user, res);
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, transport: 'sse' })}\n\n`);
  const heartbeat = setInterval(() => {
    // CC26_760: session inactivity owns stream shutdown. Do not force periodic reconnects.
    try { res.write(': keepalive\n\n'); }
    catch { cleanup(); }
  }, 45000);
  heartbeat.unref?.();
  function cleanup() {
    clearInterval(heartbeat);
    untrackIdle();
    const current = streams.get(key);
    if (!current) return;
    current.delete(res);
    if (!current.size) { streams.delete(key); streamUsers.delete(key); }
  }
  res.on('close', cleanup);
  req.on('aborted', cleanup);
}

function publishToUsers(userIds = [], event = 'approval', payload = {}) {
  const ids = new Set((userIds || []).map((value) => String(value || '').trim()).filter(Boolean));
  if (!ids.size) return 0;
  let delivered = 0;
  for (const id of ids) {
    const set = streams.get(id);
    if (!set) continue;
    for (const res of [...set]) {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`);
        delivered += 1;
      } catch {
        try { res.end(); } catch {}
        set.delete(res);
      }
    }
    if (!set.size) streams.delete(id);
  }
  return delivered;
}

function roleOf(user = {}) {
  const raw = String(user.role || user.designation || '').trim().toLowerCase();
  if (raw.includes('admin')) return 'admin';
  if (raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw.includes('recruiter')) return 'recruiter';
  return raw;
}
function lower(value) { return String(value || '').trim().toLowerCase(); }
function viewerOwnsActor(viewer = {}, actor = {}) {
  const viewerRole = roleOf(viewer);
  if (viewerRole === 'admin' || viewerRole === 'manager') return true;
  const actorId = String(actor.user_id || actor.id || '').trim();
  const actorCode = lower(actor.recruiter_code || actor.employee_code || '');
  const actorNames = [actor.full_name, actor.username, actor.name].map(lower).filter(Boolean);
  if (viewerRole === 'tl') {
    const ids = new Set([viewer.user_id, ...(viewer.__ccTeamUserIds || [])].map((v) => String(v || '').trim()).filter(Boolean));
    const codes = new Set([viewer.recruiter_code, ...(viewer.__ccTeamCodes || [])].map(lower).filter(Boolean));
    const names = new Set([viewer.full_name, viewer.username, ...(viewer.__ccTeamNames || [])].map(lower).filter(Boolean));
    return Boolean((actorId && ids.has(actorId)) || (actorCode && codes.has(actorCode)) || actorNames.some((name) => names.has(name)));
  }
  const viewerId = String(viewer.user_id || viewer.id || '').trim();
  const viewerCode = lower(viewer.recruiter_code || viewer.employee_code || '');
  const viewerNames = new Set([viewer.full_name, viewer.username, viewer.name].map(lower).filter(Boolean));
  return Boolean((actorId && viewerId && actorId === viewerId) || (actorCode && viewerCode && actorCode === viewerCode) || actorNames.some((name) => viewerNames.has(name)));
}
function publishReminderDirty(actor = {}, payload = {}) {
  let delivered = 0;
  const actorKey = userKey(actor);
  for (const [key, set] of streams) {
    const viewer = streamUsers.get(key) || {};
    // CC26_765: include the actor too. The production bundle does not emit a reliable
    // local career-crox-data-written event for every write, so excluding the actor could
    // leave their reminder snapshot stale forever. This is one tiny SSE invalidation only.
    if (!viewerOwnsActor(viewer, actor)) continue;
    for (const res of [...set]) {
      try {
        res.write(`event: reminder-dirty\ndata: ${JSON.stringify({ source: String(payload.source || ''), at: Number(payload.at || Date.now()) })}\n\n`);
        delivered += 1;
      } catch {
        try { res.end(); } catch {}
        set.delete(res);
      }
    }
    if (!set.size) { streams.delete(key); streamUsers.delete(key); }
  }
  return delivered;
}

module.exports = { attach, publishToUsers, publishReminderDirty };
