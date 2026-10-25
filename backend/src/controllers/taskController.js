const { store, table, withTransaction, afterCommit, transactionalHandler } = require('../lib/store');
const { nextId, nowIso, ymd } = require('../lib/helpers');
const { reminderTriggerNowMs, dueInMinutes } = require('../lib/reminderWindow');
const { userRole, isLeadership, isAdminOrManager, candidateBelongsToTeam, candidateBelongsToUser, candidateScopeSql, simpleOwnerSql, employeeVisibleForUser } = require('../lib/accessRules');

const taskCreateDedupCache = new Map();
const assigneeCache=require('../lib/cache').createTimedCache(300000,{maxEntries:1,tags:['staff','access','reset']});
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
    candidate_id: String(task.candidate_id || ''),task_id: String(task.task_id || ''), title: String(task.title || '').slice(0,160),
    description: String(task.description || '').slice(0,5000),
    assigned_to_user_id: String(task.assigned_to_user_id || ''),
    assigned_to_name: String(task.assigned_to_name || '').slice(0,110),
    assigned_by_user_id: String(task.assigned_by_user_id || ''),
    priority: String(task.priority || 'Normal').slice(0,24),
    due_date: String(task.due_date || ''),
    due_at: String(task.due_at || ''),
    reminder_at: String(task.reminder_at || ''),
    status: String(task.status || 'Open'),
    recurring_parent_task_id: String(task.recurring_parent_task_id || ''),
    recurring_type: String(task.recurring_type || ''),
    recurring_interval_minutes: String(task.recurring_interval_minutes || ''),
    recurring_source_task_id: String(task.recurring_source_task_id || ''),
    assigned_by_name: String(task.assigned_by_name || ''),
    permanent_start_date: String(task.permanent_start_date || ''),
    permanent_end_date: String(task.permanent_end_date || ''),
    permanent_today: task.permanent_today,
    recurring_enabled: String(task.recurring_enabled ?? ''),
    closed_at: String(task.closed_at || ''),
    updated_at: String(task.updated_at || ''),
  };
}
function publishDesktopTask(userId, kind, task) {
  const key = String(userId || '').trim();
  if (!key) return;
  const confirmedPatch = desktopTaskPayload(task);
  // A compact push must never replace a longer stored description with a clipped one.

  require('../lib/approvalLive').publishToUsers([key], 'task-changed', {kind,task:confirmedPatch,recipient_user_id:key,at:Date.now()});
  if (!desktopTaskClients.has(key)) return;
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
  await startTaskDeliveryScheduler();
  let rows;
  if (store.pool) {
    rows = await store.query(`select to_jsonb(tasks)->>'candidate_id' as candidate_id,task_id,title,description,assigned_to_user_id,assigned_to_name,assigned_to_code,
      assigned_by_user_id,assigned_by_name,status,priority,due_date,due_at,reminder_at,recurring_enabled,
      recurring_parent_task_id,recurring_source_task_id,recurring_type,recurring_interval_minutes,closed_at,updated_at
      from public.tasks where (assigned_to_user_id=$1 or (coalesce(assigned_to_user_id,'')='' and
        (($2<>'' and lower(assigned_to_name)=lower($2)) or ($3<>'' and lower(assigned_to_code)=lower($3)))))
      and lower(coalesce(status,'')) not in ('deleted','archived','stopped','cancelled','canceled','scheduled')
      and (recurring_parent_task_id=$4 or (lower(status) in ('open','in progress') and coalesce(nullif(due_at,''),due_date,'')<>''))
      order by task_id`,[id,String(self.full_name||''),String(self.recruiter_code||''),PERMANENT_MARKER]);
  } else {
    rows = (await table('tasks')).filter(row => taskPersonallyOwned(row,self));
  }
  // Return permanent templates as well as today's rows. The recipient's local
  // clock derives tomorrow's alerts without a midnight table download.
  const items = rows.filter(row=>!['deleted','archived','stopped','cancelled','canceled','scheduled'].includes(String(row.status||'').toLowerCase()))
    .map(row=>({...desktopTaskPayload(row),permanent_start_date:isPermanent(row)?String(row.due_date||'').slice(0,10):''}));
  const paused=await require('../lib/reminderPause').decorate(items,self);
  res.set('Cache-Control','private, no-store');
  return res.json({items:paused.items,reminder_pauses:paused.pauses});
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
  const start=String(row.permanent_start_date||row.due_date||'').slice(0,10);
  const endMatch=/^UNTIL:(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(String(row.recurring_interval_minutes||''));
  const end=endMatch?.[1]||'',endTime=endMatch?.[2]||'23:59';
  const inactive=['stopped','cancelled','canceled','deleted','archived'].includes(String(row.status||'').toLowerCase());
  if(inactive || String(row.status||'').toLowerCase()==='scheduled'&&deliveryMs(row)>Date.now())return {...row,permanent_today:false,permanent_start_date:start,permanent_end_date:end?end+'T'+endTime:''};
  const dayDiff=Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000);
  const endPassed=Boolean(end&&(today>end||(today===end&&endMatch?.[2]&&Date.now()>taskDueMs(end+'T'+endTime))));
  const eligible=Number.isFinite(dayDiff)&&dayDiff>=0&&!endPassed&&(String(row.recurring_type||'').toLowerCase()!=='weekly'||dayDiff%7===0);
  if(!eligible)return {...row,status:endPassed?'Expired':'Scheduled',permanent_today:false,permanent_start_date:start,permanent_end_date:end?end+'T'+endTime:''};
  const done=['done','closed','completed'].includes(String(row.status||'').toLowerCase())&&istYmd(Date.parse(row.closed_at||'')||0)===today;
  const shift=value=>value?today+String(value).slice(10):'';
  return {...row,status:done?'Completed':'Open',due_date:shift(row.due_date),due_at:shift(row.due_at||row.due_date),
    reminder_at:shift(row.reminder_at||row.due_at||row.due_date),permanent_today:true,permanent_start_date:start,permanent_end_date:end?end+'T'+endTime:'',permanent_repeat:row.recurring_type||''};
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
    task_id: 'T'+crypto.randomUUID().replaceAll('-','').toUpperCase(),
    title: baseItem.title || '',
    description: baseItem.description || '',
    assigned_to_user_id: target?.user_id || baseItem.assigned_to_user_id || '',
    assigned_to_name: target?.full_name || baseItem.assigned_to_name || '',
    assigned_to_code: target?.recruiter_code || baseItem.assigned_to_code || '',
    assigned_by_user_id: req.user.user_id,
    assigned_by_name: req.user.full_name,
    status: baseItem.status || 'Open',
    priority: baseItem.priority || 'Normal',
    due_date: baseItem.due_date,
    due_at: baseItem.due_at || baseItem.due_date,
    reminder_at: baseItem.reminder_at || baseItem.due_date,
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
  if(String(item.status).toLowerCase()==='scheduled') {
    await afterCommit(()=>armDelivery(item));
  } else {
    const recipientId=String(item.assigned_to_user_id||'');
    if(recipientId&&recipientId!==String(req.user.user_id))await makeNotification(recipientId,'Task assigned',`${req.user.full_name} assigned task: ${item.title}`,JSON.stringify({task_id:item.task_id,open_path:'/tasks?task_id='+encodeURIComponent(item.task_id)}));
    await afterCommit(()=>{if(recipientId){queueMobileTaskSignal(recipientId,item);publishDesktopTask(recipientId,'assigned',item);}});
  }
  return item;
}

function taskPersonallyOwned(task,user,candidate=null){return candidateBelongsToUser({recruiter_user_id:task.assigned_to_user_id,recruiter_code:task.assigned_to_code,recruiter_name:task.assigned_to_name},user)||Boolean(candidate&&candidateBelongsToUser(candidate,user));}

function taskVisibleToUser(task, user, candidate = null) {
  if (isAdminOrManager(user)) return true;
  if(candidate)return require('../lib/accessRules').visibleCandidateForUser(candidate,user);
  if (taskPersonallyOwned(task, user, candidate)) return true;
  if (userRole(user) === 'tl') {
    return candidateBelongsToTeam({recruiter_user_id:task.assigned_to_user_id,recruiter_code:task.assigned_to_code,recruiter_name:task.assigned_to_name},user)
      || Boolean(candidate && candidateBelongsToTeam(candidate,user));
  }
  return false;
}

async function scopedTaskRows(user) {
  if (!store.pool) {
    const items=await table('tasks');
    const candidates=items.some(row=>row.candidate_id)?await table('candidates'):[];
    const byId=new Map(candidates.map(row=>[String(row.candidate_id),row]));
    return items.filter(row=>(taskVisibleToUser(row,user,byId.get(String(row.candidate_id)))||String(row.assigned_by_user_id)===String(user.user_id))&&(String(row.status||'').toLowerCase()!=='scheduled'||String(row.assigned_by_user_id)===String(user.user_id)||isAdminOrManager(user)));
  }
  const direct=simpleOwnerSql('t',['assigned_to_user_id','assigned_to_code','assigned_to_name'],user,[]);
  const candidate=candidateScopeSql('c',user,direct.params);
  return store.query(`select t.* from public.tasks t left join public.candidates c on c.candidate_id=t.candidate_id
    where lower(coalesce(t.status,'')) not in ('archived','deleted','__deleted__')
    and (${direct.sql} or t.assigned_by_user_id=$${candidate.params.length+1} or (c.candidate_id is not null and ${candidate.sql}))
    and (lower(coalesce(t.status,''))<>'scheduled' or t.assigned_by_user_id=$${candidate.params.length+1} or ${isAdminOrManager(user)?'true':'false'})
    order by coalesce(nullif(t.updated_at,''),t.created_at,'') desc`,[...candidate.params,String(user.user_id||'')]);
}


// CC26_630: Task selector reads ONLY employee directory columns. No candidate,
// resume, JD or task scan; no secrets or password fields are returned.
async function assignees(req, res) {
  let rows;
  if (store.pool) {
    rows = await assigneeCache.load('active',()=>store.query(`select user_id, username, full_name, designation, role,
      recruiter_code, is_active from public.users
      where lower(coalesce(is_active::text,'1')) not in ('0','false','inactive','disabled','deleted')
      order by lower(coalesce(full_name, username, user_id)) asc limit 500`));
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
  await startTaskDeliveryScheduler();
  const items = await scopedTaskRows(req.user);
  const candidates = [];
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id || '').trim(), row]));
  const visibleItems = items.filter((row) => !['archived', 'deleted', '__deleted__'].includes(String(row.status || '').toLowerCase()));
  const scoped = visibleItems;
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
  const items = await scopedTaskRows(req.user);
  const candidates = [];
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id || '').trim(), row]));
  const next = items.map(row => permanentToday(row))

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
  if (permanent && (!['daily','weekly'].includes(recurring) || (endDate && (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(endDate))))) {
    return res.status(400).json({message:'Permanent task needs Daily or Weekly recurrence and a valid end date after the start date.'});
  }
  const dueRaw=String(req.body.due_date||req.body.due_at||'').trim();
  const due=dueRaw||new Date(Date.now()+330*60000).toISOString().slice(0,16);
  if(!taskDueMs(due))return res.status(400).json({message:'Choose a valid task date and time (IST).'});
  if(permanent&&endDate&&(endDate.length===10?taskDueMs(endDate+'T23:59:59.999'):taskDueMs(endDate))<taskDueMs(due))return res.status(400).json({message:'Repeat stop date and time must be after the task start.'});
  const schedule=String(req.body.auto_schedule||'')==='1';
  const release=String(req.body.deliver_at||due).trim();
  if(schedule&&(!taskDueMs(release)||taskDueMs(release)<=Date.now()))return res.status(400).json({message:'Auto schedule needs a future delivery date and time (IST).'});
  const users=store.pool?await store.query("select user_id,username,full_name,recruiter_code,role,is_active from public.users where lower(coalesce(is_active::text,'1')) not in ('0','false','inactive','disabled','deleted') limit 1000"):(await table('users')).filter(u=>!['0','false','inactive','disabled','deleted'].includes(String(u.is_active??'1').toLowerCase()));
  const ids=[req.body.assigned_to_user_id,req.body.assigned_to_user_id_2,...(Array.isArray(req.body.assigned_to_user_ids)?req.body.assigned_to_user_ids:String(req.body.assigned_to_user_ids||'').split(','))].map(v=>String(v||'').trim()).filter(Boolean);
  const lookup=String(req.body.assignee_lookup||req.body.assigned_to_name||'').trim().toLowerCase();
  if(!ids.length&&lookup){const target=users.find(u=>[u.full_name,u.username,u.recruiter_code].some(v=>String(v||'').trim().toLowerCase()===lookup));if(target)ids.push(String(target.user_id));}
  if(!ids.length)ids.push(String(req.user.user_id));
  const unique=[...new Set(ids)],targets=unique.map(id=>users.find(u=>String(u.user_id)===id));
  if(targets.some(t=>!t))return res.status(400).json({message:'One selected employee is no longer active. Refresh the employee list.'});
  const rows=[];
  const baseItem={title:String(req.body.title||'').trim(),description:req.body.description||'',status:schedule?'Scheduled':req.body.status||'Open',priority:req.body.priority||'Normal',
    due_date:due,due_at:due,reminder_at:due,recurring_type:String(req.body.recurring_type||'').trim(),
    recurring_interval_minutes:permanent?(endDate?'UNTIL:'+endDate:'UNTIL:FOREVER'):String(req.body.recurring_interval_minutes||'').trim(),
    recurring_parent_task_id:permanent?PERMANENT_MARKER:'',recurring_source_task_id:schedule?'CC917_DELIVER:'+new Date(taskDueMs(release)).toISOString():''};
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
  if (!String(req.body?.title || '').trim()) {
    return res.status(400).json({ message: 'Task title required' });
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
    await withTransaction(()=>createTaskInternal(req, captured));
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
  if (!taskVisibleToUser(existing, req.user) && !['manager','admin'].includes(String(req.user.role||'').toLowerCase()) && String(existing.assigned_by_user_id || '') !== String(req.user.user_id || ''))
    return res.status(403).json({message:'You cannot change another employee’s task.'});
  if(req.body.action==='stop_repeating'){
    if(!isPermanent(existing))return res.status(400).json({message:'This is not a permanent task.'});
    if(!isAdminOrManager(req.user)&&String(existing.assigned_by_user_id)!==String(req.user.user_id))return res.status(403).json({message:'Only the task giver or manager can stop this recurring assignment.'});
    const item=await store.update('tasks','task_id',taskId,{status:'Stopped',recurring_enabled:'0',updated_at:nowIso()});
    cancelDelivery(taskId);await afterCommit(()=>publishDesktopTask(existing.assigned_to_user_id,'updated',item));return res.json({item});
  }
  const recurrencePatch={};
  if(Object.prototype.hasOwnProperty.call(req.body,'permanent_task')){
    const permanent=String(req.body.permanent_task)==='1';
    if(permanent&&!isLeadership(req.user))return res.status(403).json({message:'Only Manager / TL can assign permanent tasks.'});
    const repeat=String(req.body.recurring_type||'').toLowerCase(),end=String(req.body.permanent_end_date||'').trim(),due=String(req.body.due_date||existing.due_date||'');
    if(permanent&&(!['daily','weekly'].includes(repeat)||(end&&(!/^\d{4}-\d\d-\d\d(?:T\d\d:\d\d)?$/.test(end)||(end.length===10?taskDueMs(end+'T23:59:59.999'):taskDueMs(end))<taskDueMs(due)))))return res.status(400).json({message:'Choose a valid repeat stop date and time after the start.'});
    Object.assign(recurrencePatch,{recurring_parent_task_id:permanent?PERMANENT_MARKER:'',recurring_type:repeat,recurring_interval_minutes:permanent?(end?'UNTIL:'+end:'UNTIL:FOREVER'):String(req.body.recurring_interval_minutes||''),recurring_enabled:repeat?'1':'0'});
  }
  if(Object.prototype.hasOwnProperty.call(req.body,'auto_schedule')){
    const scheduled=String(req.body.auto_schedule)==='1';
    const at=String(req.body.deliver_at||req.body.due_date||'');
    if(scheduled&&(!taskDueMs(at)||taskDueMs(at)<=Date.now()))return res.status(400).json({message:'Auto schedule needs a future delivery time (IST).'});
    recurrencePatch.recurring_source_task_id=scheduled?'CC917_DELIVER:'+new Date(taskDueMs(at)).toISOString():'';
    if(scheduled)req.body.status='Scheduled';
  }
  const nextStatus = String(req.body.status || existing.status || 'Open').trim() || 'Open';
  const nextPriority = String(req.body.priority || existing.priority || 'Normal').trim() || 'Normal';
  const nextDueDate = String(req.body.due_at || req.body.due_date || existing.due_date || '').trim();
  if(nextDueDate&&!taskDueMs(nextDueDate))return res.status(400).json({message:'Choose a valid task date and time (IST).'});
  const nextDescription = typeof req.body.description === 'string' ? req.body.description : existing.description;
  const isDone = ['done', 'closed', 'completed'].includes(nextStatus.toLowerCase());
  if (isPermanent(existing)) {
    if (!taskVisibleToUser(existing, req.user) && String(existing.assigned_by_user_id || '') !== String(req.user.user_id || ''))
      return res.status(403).json({message:'This permanent task is not assigned to your account.'});
    if (!permanentToday(existing).permanent_today && isDone) return res.status(409).json({message:'This permanent task is not scheduled for today.'});
  }

  const updated = await store.update('tasks', 'task_id', taskId, {
    ...recurrencePatch,
    title: typeof req.body.title==='string'&&req.body.title.trim()?req.body.title.trim():existing.title,
    status: nextStatus,
    priority: nextPriority,
    due_date: nextDueDate || existing.due_date || '',
    ...(nextDueDate && (req.body.due_date || req.body.due_at) ? {
      due_at: nextDueDate,
      reminder_at: String(req.body.reminder_at || nextDueDate),
    } : {}),
    description: nextDescription,
    updated_at: nowIso(),
    closed_at: isDone ? nowIso() : '',
    closed_by_user_id: isDone ? req.user.user_id : '',
    closed_by_name: isDone ? req.user.full_name : '',
  });

  if(updated&&String(updated.status||'').toLowerCase()==='scheduled')await afterCommit(()=>armDelivery(updated));
  if (updated && String(updated.status||'').toLowerCase()!=='scheduled') {
    const recipients = new Set([existing.assigned_to_user_id,existing.assigned_by_user_id].map(value=>String(value||'').trim()).filter(Boolean));
    for (const recipient of recipients) await afterCommit(()=>publishDesktopTask(recipient, 'updated', updated));
  }
  if (updated && String(updated.status||'').toLowerCase()!=='scheduled' && existing.assigned_to_user_id && String(existing.assigned_to_user_id) !== String(req.user.user_id)) {
    const statusLabel = isDone ? 'closed' : (nextStatus.toLowerCase() === 'open' ? 'reopened' : 'updated');
    await makeNotification(existing.assigned_to_user_id, 'Task updated', `${req.user.full_name} ${statusLabel} task: ${updated.title}`, JSON.stringify({ task_id: updated.task_id, open_path: '/tasks?task_id='+encodeURIComponent(updated.task_id) }));
  }

  if (isDone && !isPermanent(existing) && String(existing.recurring_enabled || '0') === '1') {
    const rows = [];
    const alreadyCreated = store.pool?await store.one('select task_id from public.tasks where recurring_source_task_id=$1 limit 1',[existing.task_id]):(await table('tasks')).find(row=>String(row.recurring_source_task_id||'')===String(existing.task_id));
    if (!alreadyCreated) {
      const target = await store.findById('users','user_id',existing.assigned_to_user_id);
      const nextDue=nextRecurringDue(existing)||existing.due_date;
      const clone = await createSingleTask({
        ...existing,
        status: 'Open',
        due_date: nextDue,
        due_at: nextDue,
        reminder_at: nextDue,
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

const deliveryTimers=new Map();let deliveryHydration=null,deliveryHydrated=false;
function deliveryMs(row){const marker=String(row.recurring_source_task_id||'');return marker.startsWith('CC917_DELIVER:')?Date.parse(marker.slice(14))||0:0;}
function cancelDelivery(id){const timer=deliveryTimers.get(String(id));if(timer)clearTimeout(timer);deliveryTimers.delete(String(id));}
function armDelivery(row){
 cancelDelivery(row.task_id);if(String(row.status||'').toLowerCase()!=='scheduled')return;
 const at=deliveryMs(row);if(!at)return;
 const timer=setTimeout(()=>{deliveryTimers.delete(String(row.task_id));if(at>Date.now()+1000){armDelivery(row);return;}deliverScheduled(row.task_id).catch(error=>{console.error('Scheduled task delivery pending:',error.code||error.message);const retry=setTimeout(()=>armDelivery(row),60000);retry.unref?.();});},Math.max(5,Math.min(at-Date.now(),2147480000)));
 timer.unref?.();deliveryTimers.set(String(row.task_id),timer);
}
async function deliverScheduled(id){
 const quiet=require('../lib/recentHumanActivity');if(quiet.nightDormant())return quiet.deferUntilUse('task:'+id,()=>deliverScheduled(id));
 if(!await require('../lib/multipleCrm').writeAllowed())return;
 return withTransaction(async()=>{
  let item;
  if(store.pool){const row=await store.one('select task_id,status,recurring_source_task_id from public.tasks where task_id=$1 for update',[String(id)]);if(!row||String(row.status).toLowerCase()!=='scheduled'||deliveryMs(row)>Date.now())return;item=(await store.query("update public.tasks set status='Open',updated_at=$2 where task_id=$1 and lower(status)='scheduled' returning *",[String(id),nowIso()]))[0];}
  else{const row=await store.findById('tasks','task_id',id);if(!row||String(row.status).toLowerCase()!=='scheduled'||deliveryMs(row)>Date.now())return;item=await store.update('tasks','task_id',id,{status:'Open',updated_at:nowIso()});}
  if(!item)return;
  await makeNotification(item.assigned_to_user_id,'Scheduled task delivered',`${item.assigned_by_name||'Your manager'} assigned task: ${item.title}`,JSON.stringify({task_id:item.task_id,open_path:'/tasks?task_id='+encodeURIComponent(item.task_id)}));
  await afterCommit(()=>{queueMobileTaskSignal(item.assigned_to_user_id,item);publishDesktopTask(item.assigned_to_user_id,'assigned',item);publishDesktopTask(item.assigned_by_user_id,'updated',item);});return item;
 });
}
async function startTaskDeliveryScheduler(){
 const quiet=require('../lib/recentHumanActivity');if(quiet.nightDormant())return quiet.deferUntilUse('task-hydration',startTaskDeliveryScheduler);
 if(deliveryHydrated)return;if(deliveryHydration)return deliveryHydration;
 deliveryHydration=(async()=>{
  if(!await require('../lib/multipleCrm').writeAllowed()){deliveryHydrated=true;return;}
  const rows=store.pool?await store.query("select task_id,status,recurring_source_task_id from public.tasks where lower(status)='scheduled' and recurring_source_task_id like 'CC917_DELIVER:%'"):(await table('tasks')).filter(r=>String(r.status).toLowerCase()==='scheduled');
  rows.forEach(armDelivery);deliveryHydrated=true;
 })().finally(()=>{deliveryHydration=null;});return deliveryHydration;
}

module.exports = {
  startTaskDeliveryScheduler,
  _test:{permanentToday,taskDueMs,deliveryMs,deliverScheduled,cancelDelivery},
  assignees,
  list,
  nextReminder,
  create,
  update:transactionalHandler(async(req,res)=>{if(store.pool)await store.query('select task_id from public.tasks where task_id=$1 for update',[String(req.params.taskId||'')]);return update(req,res);}),
  mobileTaskSignalsForUser,
  desktopEvents,
  upcomingDesktopReminders,
};
