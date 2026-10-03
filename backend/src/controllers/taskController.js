const { store, table } = require('../lib/store');
const { nextId, nowIso, ymd } = require('../lib/helpers');
const { reminderTriggerNowMs, dueInMinutes } = require('../lib/reminderWindow');
const { userRole, isLeadership, candidateBelongsToUser } = require('../lib/accessRules');

const taskCreateDedupCache = new Map();
// CC26_623: Mobile task alerts piggyback the phone's existing command response.
// This short-lived, per-recipient queue lives in Render memory: no timer, new DB read,
// push provider, Supabase Realtime subscription, or background task polling.
const crypto = require('crypto');
const mobileTaskSignals = new Map();
const MOBILE_TASK_SIGNAL_TTL_MS = 30 * 60 * 1000;

// CC26_625: one authenticated Render-only stream per active desktop tab. No DB
// subscription, task-table polling, background job, or persistent message queue.
const desktopTaskClients = new Map();
function desktopTaskPayload(task) {
  return {
    task_id: String(task.task_id || ''), title: String(task.title || '').slice(0,160),
    description: String(task.description || '').slice(0,400),
    assigned_to_user_id: String(task.assigned_to_user_id || ''),
    assigned_to_name: String(task.assigned_to_name || '').slice(0,110),
    priority: String(task.priority || 'Normal').slice(0,24),
    due_date: String(task.due_date || ''),
    due_at: String(task.due_at || ''),
    reminder_at: String(task.reminder_at || ''),
    status: String(task.status || 'Open'),
    recurring_parent_task_id: String(task.recurring_parent_task_id || ''),
    recurring_type: String(task.recurring_type || ''),
    recurring_interval_minutes: String(task.recurring_interval_minutes || ''),
    closed_at: String(task.closed_at || ''),
  };
}
function publishDesktopTask(userId, kind, task) {
  const key = String(userId || '').trim();
  if (!key || !desktopTaskClients.has(key)) return;
  const message = `data: ${JSON.stringify({kind, task:desktopTaskPayload(task)})}\n\n`;
  for (const client of desktopTaskClients.get(key) || []) {
    try { client.write(message); } catch { try { client.end(); } catch {} }
  }
}
function desktopEvents(req, res) {
  const key = String(req.user?.user_id || '').trim();
  if (!key) return res.status(401).json({message:'Sign in to receive tasks.'});
  res.status(200).set({
    'Content-Type':'text/event-stream; charset=utf-8',
    'Cache-Control':'no-store, no-cache, no-transform',
    'X-Accel-Buffering':'no', 'Connection':'keep-alive',
  });
  res.flushHeaders?.();
  res.write(': task-alert-ready\n\n');
  let clients = desktopTaskClients.get(key);
  if (!clients) { clients = new Set(); desktopTaskClients.set(key, clients); }
  // Keep only three concurrent tabs for one staff member.
  if (clients.size >= 3) { const first = clients.values().next().value; try { first?.end(); } catch {} clients.delete(first); }
  clients.add(res);
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { cleanup(); }
  }, 45000); // 11 bytes / 45s via Render; ZERO periodic Supabase reads.
  // Re-authorize at least every 9 minutes. The browser closes immediately on logout.
  const expiry = setTimeout(() => { try { res.end(); } catch {} cleanup(); }, 9*60000);
  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat); clearTimeout(expiry);
    clients.delete(res);
    if (!clients.size) desktopTaskClients.delete(key);
  }
  req.once('aborted', cleanup);
  res.once('close', cleanup);
}

function taskDueMs(value) {
  let text = String(value || '').trim();
  if (/^\d{4}-\d\d-\d\d$/.test(text)) text += 'T00:00:00+05:30';
  else if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(text)) text = text.replace(' ','T') + '+05:30';
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : 0;
}
// One narrow employee-only upcoming read on login/reconnect/manual refresh.
async function upcomingDesktopReminders(req, res) {
  const self = req.user || {};
  const id = String(self.user_id || '').trim();
  if (!id) return res.status(401).json({message:'Sign in first.'});
  const today = istYmd(Date.now()-86400000);
  let rows;
  if (store.pool) {
    // No select *, no global scan, no name wildcard, no unrelated employees.
    rows = await store.query(`select task_id,title,description,assigned_to_user_id,assigned_to_name,assigned_to_code,
      status,priority,due_date,due_at,reminder_at,recurring_parent_task_id,recurring_type,recurring_interval_minutes,closed_at
      from public.tasks where lower(status) in ('open','in progress','completed','done','closed')
      and (assigned_to_user_id = $1 or ($2 <> '' and lower(assigned_to_name) = lower($2)) or ($3 <> '' and lower(assigned_to_code) = lower($3)))
      and (left(coalesce(nullif(reminder_at,''),nullif(due_at,''),nullif(due_date,''),''),10) >= $4 or recurring_parent_task_id = $5)
      order by coalesce(nullif(reminder_at,''),nullif(due_at,''),nullif(due_date,''),updated_at,created_at,'') asc limit 180`,
      [id, String(self.full_name || ''), String(self.recruiter_code || ''), today, PERMANENT_MARKER]);
  } else {
    rows = (await table('tasks')).filter(row =>
      String(row.assigned_to_user_id || '') === id
      || (self.full_name && String(row.assigned_to_name || '').trim().toLowerCase() === String(self.full_name).trim().toLowerCase())
      || (self.recruiter_code && String(row.assigned_to_code || '').trim().toLowerCase() === String(self.recruiter_code).trim().toLowerCase()));
  }
  const now = Date.now();
  const items = rows.map(row => permanentToday(row))
    .filter(row => ['open','in progress'].includes(String(row.status || '').trim().toLowerCase()))
    .filter(row => taskDueMs(row.reminder_at || row.due_at || row.due_date) >= now - 60*60000)
    .slice(0, 120).map(desktopTaskPayload);
  res.set('Cache-Control','private, no-store');
  return res.json({items});
}

function queueMobileTaskSignal(userId, task) {
  const key = String(userId || '').trim();
  if (!key || !task?.task_id) return;
  const now = Date.now();
  const history = (mobileTaskSignals.get(key) || []).filter(x => now - x.at < MOBILE_TASK_SIGNAL_TTL_MS);
  if (history.some(x => x.task_id === String(task.task_id))) return;
  history.push({ id: crypto.randomBytes(10).toString('hex'), at: now,
    task_id: String(task.task_id), title: String(task.title || 'New task').slice(0,110),
    priority: String(task.priority || 'Normal').slice(0,24) });
  mobileTaskSignals.set(key, history.slice(-12));
  // Lazy cleanup only: no interval/background process after everyone logs out.
  if (mobileTaskSignals.size > 300) for (const [id, entries] of mobileTaskSignals) {
    if (!entries.some(x => now - x.at < MOBILE_TASK_SIGNAL_TTL_MS)) mobileTaskSignals.delete(id);
  }
}
function mobileTaskSignalsForUser(userId, acknowledgedId='') {
  const key = String(userId || '').trim();
  if (!key) return [];
  const now = Date.now();
  const events = (mobileTaskSignals.get(key) || []).filter(x => now - x.at < MOBILE_TASK_SIGNAL_TTL_MS);
  if (!events.length) {mobileTaskSignals.delete(key);return [];}
  if (events.length !== (mobileTaskSignals.get(key) || []).length) mobileTaskSignals.set(key, events);
  const index = events.findIndex(x => x.id === String(acknowledgedId || ''));
  // Unknown cursor (new pairing/server restart) => only latest four events, never table scan.
  const unseen = index >= 0 ? events.slice(index+1) : events.slice(-4);
  return unseen.slice(0,4).map(({at,...event}) => event);
}
const TASK_CREATE_DEDUP_TTL_MS = 2 * 60 * 1000;

function taskCreateDedupeKey(req) {
  const body = req.body || {};
  const explicitKey = String(body.client_request_id || body.idempotency_key || body.request_id || '').trim();
  if (explicitKey) return `${req.user?.user_id || req.user?.username || 'user'}|${explicitKey}`;
  const stablePayload = {
    title: String(body.title || '').trim(),
    description: String(body.description || '').trim(),
    assigned_to_user_id: String(body.assigned_to_user_id || '').trim(),
    assigned_to_user_id_2: String(body.assigned_to_user_id_2 || '').trim(),
    assigned_to_user_ids: Array.isArray(body.assigned_to_user_ids) ? body.assigned_to_user_ids.map((v) => String(v || '').trim()).filter(Boolean).sort() : String(body.assigned_to_user_ids || '').split(',').map((v) => String(v || '').trim()).filter(Boolean).sort(),
    assigned_to_name: String(body.assigned_to_name || '').trim().toLowerCase(),
    priority: String(body.priority || 'Normal').trim().toLowerCase(),
    status: String(body.status || 'Open').trim().toLowerCase(),
    due_date: String(body.due_date || '').trim(),
    recurring_type: String(body.recurring_type || '').trim().toLowerCase(),
    recurring_interval_minutes: String(body.recurring_interval_minutes || '').trim(),
    permanent_task: String(body.permanent_task || '').trim(),
    permanent_end_date: String(body.permanent_end_date || '').trim(),
  };
  return `${req.user?.user_id || req.user?.username || 'user'}|fallback|${JSON.stringify(stablePayload)}`;
}

function getTaskCreateCache(key) {
  const entry = taskCreateDedupCache.get(key);
  if (!entry) return null;
  if ((Date.now() - Number(entry.at || 0)) > TASK_CREATE_DEDUP_TTL_MS) {
    taskCreateDedupCache.delete(key);
    return null;
  }
  return entry;
}

function pruneTaskCreateCache() {
  const now = Date.now();
  for (const [key, entry] of taskCreateDedupCache.entries()) {
    if ((now - Number(entry.at || 0)) > TASK_CREATE_DEDUP_TTL_MS) taskCreateDedupCache.delete(key);
  }
}

async function makeNotification(userId, title, message, metadata = '') {
  await store.insert('notifications', {
    notification_id: 'N' + crypto.randomBytes(12).toString('hex').toUpperCase(),
    user_id: userId,
    title,
    message,
    category: 'task',
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  });
}

// CC26_622: A permanent assignment uses ONE existing tasks row as a template.
// No nightly inserts, timer or Supabase read is required to make it appear each day.
// We reuse existing TEXT columns; no schema migration or old-data mutation.
const PERMANENT_MARKER = 'CC_PERMANENT_V1';
const isPermanent = row => String(row?.recurring_parent_task_id || '') === PERMANENT_MARKER;
const istYmd = (at = Date.now()) => new Date(at + 330 * 60000).toISOString().slice(0,10);
function permanentToday(row, today = istYmd()) {
  if (!isPermanent(row)) return row;
  const start = String(row.due_date || '').slice(0,10);
  const rawEnd = /^UNTIL:(\d{4}-\d{2}-\d{2})$/.exec(String(row.recurring_interval_minutes || ''));
  const end = rawEnd?.[1] || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return {...row, status:'Scheduled'};
  const dayDiff = Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000);
  const eligible = dayDiff >= 0 && (!end || today <= end) && (String(row.recurring_type || '').toLowerCase()!=='weekly' || dayDiff % 7 === 0);
  if (!eligible) return {...row, status: end && today > end ? 'Expired' : 'Scheduled', permanent_today:false, permanent_start_date:start, permanent_end_date:end};
  const doneToday = ['done','closed','completed'].includes(String(row.status || '').toLowerCase()) && istYmd(new Date(row.closed_at || 0).getTime() || 0) === today;
  return {...row, status:doneToday ? 'Completed':'Open', due_date:today+String(row.due_date || '').slice(10), permanent_today:true,
    permanent_start_date:start, permanent_end_date:end, permanent_repeat:String(row.recurring_type || '')};
}

function nextRecurringDue(task) {
  const sourceMs = taskDueMs(task?.reminder_at || task?.due_at || task?.due_date || Date.now());
  if (!sourceMs) return '';
  const type = String(task?.recurring_type || '').trim().toLowerCase();
  let addMs = 0;
  if (type === 'daily') addMs = 24 * 60 * 60 * 1000;
  else if (type === 'weekly') addMs = 7 * 24 * 60 * 60 * 1000;
  else if (type === 'custom') {
    const minutes = Number.parseInt(task?.recurring_interval_minutes || '0', 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    addMs = minutes * 60 * 1000;
  } else return '';
  // India has no DST; shift to IST before formatting back to datetime-local.
  return new Date(sourceMs + addMs + 330 * 60000).toISOString().slice(0, 16);
}

async function createSingleTask(baseItem, target, req, rows, extra = {}) {
  const recurringType = String(extra.recurring_type ?? baseItem.recurring_type ?? '').trim().toLowerCase();
  const recurringIntervalMinutes = String(extra.recurring_interval_minutes ?? baseItem.recurring_interval_minutes ?? '').trim();
  const item = {
    task_id: nextId('T', rows, 'task_id'),
    title: baseItem.title || '',
    description: baseItem.description || '',
    assigned_to_user_id: target?.user_id || baseItem.assigned_to_user_id || '',
    assigned_to_name: target?.full_name || baseItem.assigned_to_name || '',
    assigned_to_code: target?.recruiter_code || baseItem.assigned_to_code || '',
    assigned_by_user_id: req.user.user_id,
    assigned_by_name: req.user.full_name,
    status: baseItem.status || 'Open',
    priority: baseItem.priority || 'Normal',
    due_date: baseItem.due_date || ymd(),
    recurring_enabled: String(extra.recurring_enabled ?? (recurringType ? '1' : '0')),
    recurring_type: recurringType,
    recurring_interval_minutes: recurringIntervalMinutes,
    recurring_parent_task_id: extra.recurring_parent_task_id || baseItem.recurring_parent_task_id || '',
    recurring_source_task_id: extra.recurring_source_task_id || baseItem.recurring_source_task_id || '',
    closed_at: '',
    closed_by_user_id: '',
    closed_by_name: '',
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await store.insert('tasks', item);
  rows.push(item);
  const recipientId = String(target?.user_id || item.assigned_to_user_id || '').trim();
  if (recipientId && recipientId !== String(req.user.user_id)) {
    await makeNotification(recipientId, 'Task assigned', `${req.user.full_name} assigned task: ${item.title}`, JSON.stringify({ task_id: item.task_id, open_path: '/tasks' }));
  }
  // An event is only published after the task has been persisted.
  // Paired active phones see it in their EXISTING command response, not in a new poll.
  if (recipientId) { queueMobileTaskSignal(recipientId, item); publishDesktopTask(recipientId, 'assigned', item); }
  return item;
}

function taskPersonallyOwned(task, user, candidate = null) {
  const fullName = String(user?.full_name || '').trim().toLowerCase();
  const username = String(user?.username || '').trim().toLowerCase();
  const recruiterCode = String(user?.recruiter_code || '').trim().toLowerCase();
  const directAssigned = String(task?.assigned_to_user_id || '') === String(user?.user_id || '')
    || [fullName, username, recruiterCode].filter(Boolean).includes(String(task?.assigned_to_name || '').trim().toLowerCase())
    || (Boolean(recruiterCode) && String(task?.assigned_to_code || '').trim().toLowerCase() === recruiterCode);
  return directAssigned || Boolean(candidate && candidateBelongsToUser(candidate, user));
}

function taskVisibleToUser(task, user, candidate = null) {
  if (taskPersonallyOwned(task, user, candidate)) return true;
  if (isLeadership(user)) return true;
  return false;
}


// CC26_630: Task selector reads ONLY employee directory columns. No candidate,
// resume, JD or task scan; no secrets or password fields are returned.
async function assignees(req, res) {
  let rows;
  if (store.pool) {
    rows = await store.query(`select user_id, username, full_name, designation, role,
      recruiter_code, is_active from public.users
      where lower(coalesce(is_active::text,'1')) not in ('0','false','inactive','disabled','deleted')
      order by lower(coalesce(full_name, username, user_id)) asc limit 500`);
  } else {
    rows = (await table('users')).filter((u) =>
      !['0','false','inactive','disabled','deleted'].includes(String(u.is_active ?? '1').toLowerCase())).slice(0,500);
  }
  const items = rows.filter(u => String(u.user_id || '').trim())
    .map(u => ({user_id:String(u.user_id),username:String(u.username||''),
      full_name:String(u.full_name||u.username||u.user_id),designation:String(u.designation||''),
      role:String(u.role||''),recruiter_code:String(u.recruiter_code||'')}));
  res.set('Cache-Control','private, no-store');
  return res.json({users:items, count:items.length, scope:'task_assignees'});
}

async function list(req, res) {
  const items = await table('tasks');
  const candidates = items.some(row => row.candidate_id) ? await table('candidates').catch(() => []) : [];
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id || '').trim(), row]));
  const visibleItems = items.filter((row) => !['archived', 'deleted', '__deleted__'].includes(String(row.status || '').toLowerCase()));
  const scoped = isLeadership(req.user)
    ? visibleItems
    : visibleItems.filter((row) => {
      const candidate = candidatesById.get(String(row.candidate_id || '').trim()) || null;
      return taskVisibleToUser(row, req.user, candidate);
    });
  const sorted = scoped.map(row => permanentToday(row)).sort((a, b) => {
    const aDone = ['done', 'closed', 'completed'].includes(String(a.status || '').toLowerCase());
    const bDone = ['done', 'closed', 'completed'].includes(String(b.status || '').toLowerCase());
    if (aDone !== bDone) return aDone ? 1 : -1;
    const aDue = taskDueMs(a.reminder_at || a.due_at || a.due_date) || Number.MAX_SAFE_INTEGER;
    const bDue = taskDueMs(b.reminder_at || b.due_at || b.due_date) || Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
  return res.json({ items: sorted });
}

async function nextReminder(req, res) {
  const now = Date.now();
  const triggerUntil = reminderTriggerNowMs(now);
  const exclude = new Set(String(req.query.exclude || '').split(',').map((value) => String(value || '').trim()).filter(Boolean));
  const items = await table('tasks');
  const candidates = items.some(row => row.candidate_id) ? await table('candidates').catch(() => []) : [];
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id || '').trim(), row]));
  const next = items.map(row => permanentToday(row))
    .filter((row) => taskVisibleToUser(row, req.user, candidatesById.get(String(row.candidate_id || '').trim()) || null))
    .filter((row) => !exclude.has(String(row.task_id || '').trim()))
    .filter((row) => ['open', 'in progress'].includes(String(row.status || '').toLowerCase()))
    .map((row) => { const stamp = row.reminder_at || row.due_at || row.due_date; return ({ ...row, dueAt: taskDueMs(stamp), due_in_minutes: dueInMinutes(stamp, now), reminder_buffer_minutes: 10 }); })
    .filter((row) => Number.isFinite(row.dueAt) && row.dueAt > 0 && row.dueAt <= triggerUntil)
    .sort((a, b) => {
      const role = userRole(req.user);
      if (role === 'manager' || role === 'tl') {
        const aCandidate = candidatesById.get(String(a.candidate_id || '').trim()) || null;
        const bCandidate = candidatesById.get(String(b.candidate_id || '').trim()) || null;
        const personal = Number(taskPersonallyOwned(b, req.user, bCandidate)) - Number(taskPersonallyOwned(a, req.user, aCandidate));
        if (personal) return personal;
      }
      return a.dueAt - b.dueAt;
    })[0] || null;
  return res.json({ item: next });
}

async function createTaskInternal(req, res) {
  const permanent = String(req.body?.permanent_task || '') === '1';
  if (permanent && !isLeadership(req.user)) return res.status(403).json({message:'Only Manager / TL can assign permanent tasks.'});
  const recurring = String(req.body?.recurring_type || '').toLowerCase();
  const endDate = String(req.body?.permanent_end_date || '').trim();
  if (permanent && (!['daily','weekly'].includes(recurring) || (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < String(req.body?.due_date || '').slice(0,10))))) {
    return res.status(400).json({message:'Permanent task needs Daily or Weekly recurrence and a valid end date after the start date.'});
  }
  const rows = await table('tasks');
  const users = await table('users');
  const lookup = String(req.body.assignee_lookup || req.body.assigned_to_name || '').toLowerCase();
  const firstTarget = users.find((u) => String(u.user_id) === String(req.body.assigned_to_user_id || ''))
    || users.find((u) => String(u.full_name || '').toLowerCase() === String(req.body.assigned_to_name || '').toLowerCase())
    || users.find((u) => String(u.username || '').toLowerCase() === String(req.body.assigned_to_name || '').toLowerCase())
    || users.find((u) => String(u.recruiter_code || '').toLowerCase() === String(req.body.assigned_to_name || '').toLowerCase())
    || users.find((u) => [u.full_name, u.username, u.recruiter_code].filter(Boolean).some((v) => String(v).toLowerCase().includes(lookup)));
  const secondTarget = users.find((u) => String(u.user_id) === String(req.body.assigned_to_user_id_2 || ''));
  const multiIdsRaw = Array.isArray(req.body.assigned_to_user_ids)
    ? req.body.assigned_to_user_ids
    : String(req.body.assigned_to_user_ids || '').split(',');
  const multiTargets = multiIdsRaw
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((userId) => users.find((u) => String(u.user_id) === userId))
    .filter(Boolean);
  const targets = [firstTarget, secondTarget, ...multiTargets]
    .filter(Boolean)
    .filter((target, idx, arr) => arr.findIndex((item) => String(item.user_id) === String(target.user_id)) === idx);
  const baseItem = {
    title: req.body.title || '',
    description: req.body.description || '',
    assigned_to_user_id: req.body.assigned_to_user_id || '',
    assigned_to_name: req.body.assigned_to_name || '',
    status: req.body.status || 'Open',
    priority: req.body.priority || 'Normal',
    due_date: req.body.due_date || ymd(),
    recurring_type: String(req.body.recurring_type || '').trim(),
    recurring_interval_minutes: permanent ? (endDate ? 'UNTIL:'+endDate : 'UNTIL:FOREVER') : String(req.body.recurring_interval_minutes || '').trim(),
    recurring_parent_task_id: permanent ? PERMANENT_MARKER : '',
  };
  const created = [];
  if (!targets.length) {
    created.push(await createSingleTask(baseItem, null, req, rows));
  } else {
    for (const target of targets) {
      created.push(await createSingleTask(baseItem, target, req, rows));
    }
  }
  return res.json({ item: created[0], items: created });
}

async function create(req, res) {
  if (!String(req.body?.title || '').trim() || !String(req.body?.description || '').trim()) {
    return res.status(400).json({ message: 'Task title and description required' });
  }
  pruneTaskCreateCache();
  const key = taskCreateDedupeKey(req);
  const cached = getTaskCreateCache(key);
  if (cached?.result) return res.json({ ...cached.result, duplicate_blocked: true });
  if (cached?.promise) {
    const result = await cached.promise;
    return res.json({ ...result, duplicate_blocked: true });
  }
  const promise = (async () => {
    const captured = {
      statusCode: 200,
      payload: null,
      json(value) { this.payload = value; return value; },
      status(code) { this.statusCode = code; return this; },
    };
    await createTaskInternal(req, captured);
    if (captured.statusCode >= 400) {
      const err = new Error(captured.payload?.message || 'Task create failed');
      err.statusCode = captured.statusCode;
      err.payload = captured.payload;
      throw err;
    }
    return captured.payload || {};
  })();
  taskCreateDedupCache.set(key, { at: Date.now(), promise });
  try {
    const result = await promise;
    taskCreateDedupCache.set(key, { at: Date.now(), result });
    return res.json(result);
  } catch (error) {
    taskCreateDedupCache.delete(key);
    return res.status(error.statusCode || 500).json(error.payload || { message: error.message || 'Task create failed' });
  }
}

async function update(req, res) {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ message: 'task_id required' });
  const existing = await store.findById('tasks', 'task_id', taskId);
  if (!existing) return res.status(404).json({ message: 'Task not found' });

  // Task alerts must never let one recruiter close another employee's task.
  if (!taskVisibleToUser(existing, req.user) && !isLeadership(req.user) && String(existing.assigned_by_user_id || '') !== String(req.user.user_id || ''))
    return res.status(403).json({message:'You cannot change another employee’s task.'});
  const nextStatus = String(req.body.status || existing.status || 'Open').trim() || 'Open';
  const nextPriority = String(req.body.priority || existing.priority || 'Normal').trim() || 'Normal';
  const nextDueDate = String(req.body.due_date || existing.due_date || '').trim();
  const nextDescription = typeof req.body.description === 'string' ? req.body.description : existing.description;
  const isDone = ['done', 'closed', 'completed'].includes(nextStatus.toLowerCase());
  if (isPermanent(existing)) {
    if (!taskVisibleToUser(existing, req.user) && String(existing.assigned_by_user_id || '') !== String(req.user.user_id || ''))
      return res.status(403).json({message:'This permanent task is not assigned to your account.'});
    if (!permanentToday(existing).permanent_today && isDone) return res.status(409).json({message:'This permanent task is not scheduled for today.'});
  }

  const updated = await store.update('tasks', 'task_id', taskId, {
    status: nextStatus,
    priority: nextPriority,
    due_date: nextDueDate || existing.due_date || '',
    description: nextDescription,
    updated_at: nowIso(),
    closed_at: isDone ? nowIso() : '',
    closed_by_user_id: isDone ? req.user.user_id : '',
    closed_by_name: isDone ? req.user.full_name : '',
  });

  if (updated && existing.assigned_to_user_id) publishDesktopTask(existing.assigned_to_user_id, 'updated', permanentToday(updated));
  if (updated && existing.assigned_to_user_id && String(existing.assigned_to_user_id) !== String(req.user.user_id)) {
    const statusLabel = isDone ? 'closed' : (nextStatus.toLowerCase() === 'open' ? 'reopened' : 'updated');
    await makeNotification(existing.assigned_to_user_id, 'Task updated', `${req.user.full_name} ${statusLabel} task: ${updated.title}`, JSON.stringify({ task_id: updated.task_id, open_path: '/tasks' }));
  }

  if (isDone && !isPermanent(existing) && String(existing.recurring_enabled || '0') === '1') {
    const rows = await table('tasks');
    const alreadyCreated = rows.find((row) => String(row.recurring_source_task_id || '') === String(existing.task_id));
    if (!alreadyCreated) {
      const targetUsers = await table('users');
      const target = targetUsers.find((u) => String(u.user_id) === String(existing.assigned_to_user_id || '')) || null;
      const clone = await createSingleTask({
        ...existing,
        status: 'Open',
        due_date: nextRecurringDue(existing) || existing.due_date,
        recurring_type: existing.recurring_type || '',
        recurring_interval_minutes: existing.recurring_interval_minutes || '',
        recurring_parent_task_id: existing.recurring_parent_task_id || existing.task_id,
        recurring_source_task_id: existing.task_id,
      }, target, req, rows, { recurring_enabled: '1' });
      return res.json({ item: updated, next_item: clone });
    }
  }

  return res.json({ item: permanentToday(updated) });
}

module.exports = {
  assignees,
  list,
  nextReminder,
  create,
  update,
  mobileTaskSignalsForUser,
  desktopEvents,
  upcomingDesktopReminders,
};
