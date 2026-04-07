const { store, table, mode } = require('../lib/store');
const { canViewNotification, isManager, isTl } = require('../lib/visibility');

function isLeadership(user) {
  return isManager(user) || isTl(user);
}

function withUserFields(item, user) {
  return {
    ...item,
    owner_name: user?.full_name || '',
    recruiter_code: user?.recruiter_code || '',
    owner_role: user?.role || '',
    owner_designation: user?.designation || '',
  };
}

async function list(req, res) {
  const limit = Number(req.query.limit || 0);
  const users = await table('users');
  const userMap = new Map(users.map((user) => [String(user.user_id), user]));
  let items = (await table('notifications'))
    .map((item) => withUserFields(item, userMap.get(String(item.user_id))))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const scoped = [];
  for (const item of items) {
    if (await canViewNotification(item, req.user)) scoped.push(item);
  }
  items = scoped;
  if (limit > 0) items = items.slice(0, Math.max(1, Math.min(200, limit)));
  return res.json({ items, scope: isManager(req.user) ? 'all' : isTl(req.user) ? 'team' : 'self' });
}


async function markAllRead(req, res) {
  for (const item of (await table('notifications')).filter((n) => String(n.user_id) === String(req.user.user_id))) {
    await store.update('notifications', 'notification_id', item.notification_id, { status: 'Read' });
  }
  return res.json({ ok: true });
}

async function markRead(req, res) {
  const existing = await store.findById('notifications', 'notification_id', req.params.notificationId);
  if (!existing) return res.status(404).json({ message: 'Notification not found' });
  if (!(await canViewNotification(existing, req.user))) {
    return res.status(404).json({ message: 'Notification not found' });
  }
  await store.update('notifications', 'notification_id', req.params.notificationId, { status: 'Read' });
  return res.json({ ok: true });
}

module.exports = { list, markAllRead, markRead };
