const { store, table, mode } = require('../lib/store');
const { isLeadership: isAccessLeadership } = require('../lib/accessRules');

function isLeadership(user) {
  return isAccessLeadership(user);
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
  const limit = Number(req.query.limit || (isLeadership(req.user) ? 200 : 120));
  const leadership = isLeadership(req.user);

  if (mode === 'postgres' && store.pool) {
    const safeLimit = limit > 0 ? `limit ${Math.max(1, Math.min(200, limit))}` : '';
    const params = leadership ? [] : [req.user.user_id];
    const whereClause = leadership ? '' : 'where n.user_id = $1';
    const items = await store.query(
      `select
        n.*,
        coalesce(u.full_name, '') as owner_name,
        coalesce(u.recruiter_code, '') as recruiter_code,
        coalesce(u.role, '') as owner_role,
        coalesce(u.designation, '') as owner_designation
      from public.notifications n
      left join public.users u on u.user_id = n.user_id
      ${whereClause}
      order by n.created_at desc
      ${safeLimit}`,
      params,
    );
    return res.json({ items, scope: leadership ? 'team' : 'self' });
  }

  const users = await table('users');
  const userMap = new Map(users.map((user) => [String(user.user_id), user]));
  let items = (await table('notifications'))
    .filter((item) => leadership || String(item.user_id) === String(req.user.user_id))
    .map((item) => withUserFields(item, userMap.get(String(item.user_id))))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  if (limit > 0) items = items.slice(0, Math.max(1, Math.min(200, limit)));
  return res.json({ items, scope: leadership ? 'team' : 'self' });
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
  if (!isLeadership(req.user) && String(existing.user_id) !== String(req.user.user_id)) {
    return res.status(404).json({ message: 'Notification not found' });
  }
  await store.update('notifications', 'notification_id', req.params.notificationId, { status: 'Read' });
  return res.json({ ok: true });
}

module.exports = { list, markAllRead, markRead };
