const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');

async function makeNotification(userId, title, message, category = 'aaria', metadata = '') {
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

async function list(req, res) {
  const rows = (await table('aaria_queue')).filter((row) => ['admin', 'manager', 'tl'].includes(String(req.user.role || '').toLowerCase()) || String(row.user_id) === String(req.user.user_id));
  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return res.json({ items: rows.slice(0, 25) });
}

function queueItem(rows, req, command, status, result) {
  return {
    task_id: nextId('AQ', rows, 'task_id'),
    user_id: req.user.user_id,
    serial_hint: req.user.recruiter_code || req.user.username || '',
    command_text: command,
    status,
    result_text: result,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

async function execute(req, res) {
  const command = String(req.body.command || '').trim();
  if (!command) return res.status(400).json({ message: 'Command is empty' });
  const lower = command.toLowerCase();
  const users = await table('users');
  let result = 'Command not supported yet.';
  let status = 'Blocked';

  const assign = lower.match(/^assign\s+task\s+(.+?)\s+to\s+(.+)$/i);
  const msg = command.match(/^message\s+(.+?)\s*:\s*(.+)$/i);
  const markRead = /mark\s+all\s+notifications\s+read/i.test(lower);
  const unlockApprove = lower.match(/^approve\s+unlock\s+(ur\d+)/i);
  const unlockReject = lower.match(/^reject\s+unlock\s+(ur\d+)/i);

  try {
    if (markRead) {
      for (const item of (await table('notifications')).filter((n) => String(n.user_id) === String(req.user.user_id))) {
        await store.update('notifications', 'notification_id', item.notification_id, { status: 'Read' });
      }
      result = 'All your notifications were marked read.';
      status = 'Completed';
    } else if (assign) {
      const title = assign[1].trim();
      const lookup = assign[2].trim().toLowerCase();
      const target = users.find((u) => [u.full_name, u.username, u.recruiter_code].filter(Boolean).some((v) => String(v).toLowerCase() === lookup || String(v).toLowerCase().includes(lookup)));
      if (!target) throw new Error('Assignee not found');
      const tasks = await table('tasks');
      const item = {
        task_id: nextId('T', tasks, 'task_id'),
        title,
        description: `Created by Aaria command: ${command}`,
        assigned_to_user_id: target.user_id,
        assigned_to_name: target.full_name,
        assigned_to_code: target.recruiter_code || '',
        assigned_by_user_id: req.user.user_id,
        assigned_by_name: req.user.full_name,
        status: 'Open',
        priority: 'Normal',
        due_date: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      await store.insert('tasks', item);
      await makeNotification(target.user_id, 'Task assigned by Aaria', `${req.user.full_name} assigned task: ${title}`, 'task', JSON.stringify({ task_id: item.task_id, open_path: '/tasks' }));
      result = `Task created for ${target.full_name}.`;
      status = 'Completed';
    } else if (msg) {
      const targetRaw = msg[1].trim().toLowerCase();
      const messageBody = msg[2].trim();
      const target = users.find((u) => [u.full_name, u.username, u.recruiter_code].filter(Boolean).some((v) => String(v).toLowerCase() === targetRaw || String(v).toLowerCase().includes(targetRaw)));
      const messages = await table('messages');
      await store.insert('messages', {
        id: messages.length ? Math.max(...messages.map((m) => Number(m.id || 0))) + 1 : 1,
        sender_username: req.user.username,
        recipient_username: '',
        body: target ? `@${target.username || target.recruiter_code} ${messageBody}` : messageBody,
        created_at: nowIso(),
        thread_key: 'team',
        thread_type: 'group',
        reference_type: 'aaria',
        reference_id: '',
        mention_usernames: target?.username || '',
      });
      if (target) await makeNotification(target.user_id, 'Aaria message', `${req.user.full_name} sent: ${messageBody}`, 'chat', JSON.stringify({ open_path: '/chat' }));
      result = target ? `Message sent for ${target.full_name} in team chat.` : 'Message posted in team chat.';
      status = 'Completed';
    } else if (unlockApprove || unlockReject) {
      if (!['admin', 'manager', 'tl'].includes(String(req.user.role || '').toLowerCase())) throw new Error('Only leadership can decide unlock requests');
      const requestId = (unlockApprove || unlockReject)[1];
      const row = await store.findById('unlock_requests', 'request_id', requestId);
      if (!row) throw new Error('Unlock request not found');
      const approve = Boolean(unlockApprove);
      await store.update('unlock_requests', 'request_id', requestId, { status: approve ? 'Approved' : 'Rejected', approved_by_user_id: req.user.user_id, approved_by_name: req.user.full_name, approved_at: nowIso() });
      if (approve) {
        const presence = await store.findById('presence', 'user_id', row.user_id);
        if (presence) await store.update('presence', 'user_id', row.user_id, { locked: '0', is_on_break: '0', break_reason: '', break_started_at: '', break_expected_end_at: '' });
        await makeNotification(row.user_id, 'CRM unlocked', `Your CRM was unlocked by ${req.user.full_name}.`, 'attendance', JSON.stringify({ open_path: '/attendance' }));
      } else {
        await makeNotification(row.user_id, 'Unlock request rejected', `Unlock request was rejected by ${req.user.full_name}.`, 'attendance', JSON.stringify({ open_path: '/attendance' }));
      }
      result = `Unlock request ${requestId} ${approve ? 'approved' : 'rejected'}.`;
      status = 'Completed';
    }
  } catch (err) {
    result = err.message || 'Command failed';
    status = 'Blocked';
  }

  const existingQueue = await table('aaria_queue');
  const q = queueItem(existingQueue, req, command, status, result);
  await store.insert('aaria_queue', q);
  return res.json({ item: q, result });
}

module.exports = { list, execute };
