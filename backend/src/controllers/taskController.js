const { store, table } = require('../lib/store');
const { nextId, nowIso, ymd } = require('../lib/helpers');
const { canViewTask, visibleUsersForAssignments } = require('../lib/visibility');

async function makeNotification(userId, title, message, metadata = '') {
  const rows = await table('notifications');
  await store.insert('notifications', {
    notification_id: nextId('N', rows, 'notification_id'),
    user_id: userId,
    title,
    message,
    category: 'task',
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  });
}

function nextRecurringDue(task) {
  const source = new Date(task?.due_date || Date.now());
  if (Number.isNaN(source.getTime())) return '';
  const type = String(task?.recurring_type || '').trim().toLowerCase();
  if (type === 'daily') source.setDate(source.getDate() + 1);
  else if (type === 'weekly') source.setDate(source.getDate() + 7);
  else if (type === 'custom') {
    const minutes = Number.parseInt(task?.recurring_interval_minutes || '0', 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return '';
    source.setMinutes(source.getMinutes() + minutes);
  } else return '';
  return source.toISOString().slice(0, 16);
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
  if (target && String(target.user_id) !== String(req.user.user_id)) {
    await makeNotification(target.user_id, 'Task assigned', `${req.user.full_name} assigned task: ${item.title}`, JSON.stringify({ task_id: item.task_id, open_path: '/tasks' }));
  }
  return item;
}

async function list(req, res) {
  const items = await table('tasks');
  const scoped = [];
  for (const row of items) {
    if (await canViewTask(row, req.user)) scoped.push(row);
  }
  const sorted = scoped.slice().sort((a, b) => {
    const aDone = ['done', 'closed', 'completed'].includes(String(a.status || '').toLowerCase());
    const bDone = ['done', 'closed', 'completed'].includes(String(b.status || '').toLowerCase());
    if (aDone !== bDone) return aDone ? 1 : -1;
    const aDue = new Date(a.due_date || 0).getTime() || Number.MAX_SAFE_INTEGER;
    const bDue = new Date(b.due_date || 0).getTime() || Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
  return res.json({ items: sorted });
}


async function create(req, res) {
  const rows = await table('tasks');
  const users = await visibleUsersForAssignments(req.user);
  const lookup = String(req.body.assignee_lookup || req.body.assigned_to_name || '').toLowerCase();
  const firstTarget = users.find((u) => String(u.user_id) === String(req.body.assigned_to_user_id || ''))
    || users.find((u) => String(u.full_name || '').toLowerCase() === String(req.body.assigned_to_name || '').toLowerCase())
    || users.find((u) => String(u.username || '').toLowerCase() === String(req.body.assigned_to_name || '').toLowerCase())
    || users.find((u) => String(u.recruiter_code || '').toLowerCase() === String(req.body.assigned_to_name || '').toLowerCase())
    || users.find((u) => [u.full_name, u.username, u.recruiter_code].filter(Boolean).some((v) => String(v).toLowerCase().includes(lookup)));
  const secondTarget = users.find((u) => String(u.user_id) === String(req.body.assigned_to_user_id_2 || ''));
  const targets = [firstTarget, secondTarget].filter(Boolean).filter((target, idx, arr) => arr.findIndex((item) => String(item.user_id) === String(target.user_id)) === idx);
  const baseItem = {
    title: req.body.title || '',
    description: req.body.description || '',
    assigned_to_user_id: req.body.assigned_to_user_id || '',
    assigned_to_name: req.body.assigned_to_name || '',
    status: req.body.status || 'Open',
    priority: req.body.priority || 'Normal',
    due_date: req.body.due_date || ymd(),
    recurring_type: String(req.body.recurring_type || '').trim(),
    recurring_interval_minutes: String(req.body.recurring_interval_minutes || '').trim(),
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


async function update(req, res) {
  const taskId = String(req.params.taskId || '').trim();
  if (!taskId) return res.status(400).json({ message: 'task_id required' });
  const existing = await store.findById('tasks', 'task_id', taskId);
  if (!existing) return res.status(404).json({ message: 'Task not found' });
  if (!(await canViewTask(existing, req.user))) return res.status(403).json({ message: 'Not allowed' });

  const nextStatus = String(req.body.status || existing.status || 'Open').trim() || 'Open';
  const nextPriority = String(req.body.priority || existing.priority || 'Normal').trim() || 'Normal';
  const nextDueDate = String(req.body.due_date || existing.due_date || '').trim();
  const nextDescription = typeof req.body.description === 'string' ? req.body.description : existing.description;
  const isDone = ['done', 'closed', 'completed'].includes(nextStatus.toLowerCase());

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

  if (updated && existing.assigned_to_user_id && String(existing.assigned_to_user_id) !== String(req.user.user_id)) {
    const statusLabel = isDone ? 'closed' : (nextStatus.toLowerCase() === 'open' ? 'reopened' : 'updated');
    await makeNotification(existing.assigned_to_user_id, 'Task updated', `${req.user.full_name} ${statusLabel} task: ${updated.title}`, JSON.stringify({ task_id: updated.task_id, open_path: '/tasks' }));
  }

  if (isDone && String(existing.recurring_enabled || '0') === '1') {
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

  return res.json({ item: updated });
}

module.exports = {
  list,
  create,
  update,
};
