const { store, table } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { createTimedCache, clearAllCaches } = require('../lib/cache');

const chatListCache = createTimedCache(500);
const CHAT_MESSAGE_LIMIT = Number(process.env.CHAT_MESSAGE_LIMIT || 1600);

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function isManagerLike(user) {
  return ['admin', 'manager'].includes(normalizeRole(user?.role));
}

function isTeamLead(user) {
  return ['tl', 'team lead'].includes(normalizeRole(user?.role));
}

function canManageGroups(user) {
  return isManagerLike(user);
}

function canDeleteHard(user) {
  return isManagerLike(user);
}

function canDeleteOwnForEveryone(user) {
  return ['recruiter', 'tl', 'team lead', 'manager', 'admin'].includes(normalizeRole(user?.role));
}

function decodeMessageFlags(value) {
  return String(value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function encodeMessageFlags(flags) {
  return [...new Set(flags.filter(Boolean))].join('|');
}

function getMessageDeleteMode(message) {
  return String(message?.delete_mode || '').trim().toLowerCase();
}

function isHardDeleted(message) {
  return getMessageDeleteMode(message) === 'hard';
}

function isManagerAuditDeleted(message) {
  return getMessageDeleteMode(message) === 'soft_manager_audit';
}

function visibleToUser(message, user) {
  if (isHardDeleted(message)) return false;
  if (isManagerAuditDeleted(message)) return isManagerLike(user);
  return true;
}

function serializeForUser(message, user) {
  const flags = decodeMessageFlags(message.mention_usernames);
  if (isManagerAuditDeleted(message) && isManagerLike(user)) {
    return {
      ...message,
      body: message.original_body || message.body || 'Deleted message',
      audit_deleted: '1',
      deleted_badge: 'Deleted for everyone',
      deleted_hint: `${message.deleted_by_username || message.sender_username || 'A user'} removed this message for everyone. Manager-only audit view is still available.`,
      mention_usernames: encodeMessageFlags([...flags.filter((flag) => flag !== '__deleted__'), '__audit_deleted__']),
    };
  }
  return message;
}

async function makeNotification(userId, title, message, metadata = '') {
  const rows = await table('notifications');
  const item = {
    notification_id: nextId('N', rows, 'notification_id'),
    user_id: userId,
    title,
    message,
    category: 'chat',
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  };
  await store.insert('notifications', item);
  return item;
}

async function ensureGeneralGroup() {
  const groups = await table('chat_groups');
  const existing = groups.find((item) => String(item.group_id) === 'team');
  if (existing) return existing;
  const item = {
    group_id: 'team',
    title: 'General Team',
    created_by: 'system',
    created_at: nowIso(),
  };
  await store.insert('chat_groups', item);
  return item;
}


function mergeMessages(primaryRows, extraRows) {
  const seen = new Set();
  const merged = [];
  for (const row of [...(primaryRows || []), ...(extraRows || [])]) {
    const key = String(row?.id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged.sort((a, b) => {
    const timeDiff = String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
    if (timeDiff !== 0) return timeDiff;
    return Number(a?.id || 0) - Number(b?.id || 0);
  });
}

async function list(req, res) {
  const requestedThread = String(req.query?.thread_key || req.query?.thread || '').trim() || 'team';
  const cacheKey = `all:${req.user?.user_id || 'anon'}:${normalizeRole(req.user?.role || '')}:${requestedThread}`;
  const cached = chatListCache.get(cacheKey);
  if (cached) return res.json(cached);
  await ensureGeneralGroup();
  let groups = [];
  let messages = [];
  if (store.pool) {
    const [groupRows, recentRows, selectedRows] = await Promise.all([
      store.query(`select *, coalesce(created_by_username, created_by, 'system') as created_by_username from public.chat_groups order by case when group_id = 'team' then 0 else 1 end, coalesce(title, '') asc`),
      store.query(`select * from (select * from public.messages order by created_at desc, id desc limit $1) items order by created_at asc, id asc`, [Math.max(CHAT_MESSAGE_LIMIT, 600)]),
      requestedThread
        ? store.query(`select * from (select * from public.messages where thread_key = $1 order by created_at desc, id desc limit $2) items order by created_at asc, id asc`, [requestedThread, Math.max(CHAT_MESSAGE_LIMIT * 8, 12000)])
        : Promise.resolve([]),
    ]);
    groups = groupRows;
    messages = mergeMessages(recentRows, selectedRows);
  } else {
    const allGroups = (await table('chat_groups')).map((item) => ({
      ...item,
      created_by_username: item.created_by_username || item.created_by || 'system',
    }));
    const allMessages = (await table('messages')).sort((a, b) => {
      const timeDiff = String(a.created_at || '').localeCompare(String(b.created_at || ''));
      if (timeDiff !== 0) return timeDiff;
      return Number(a.id || 0) - Number(b.id || 0);
    });
    const recentRows = allMessages.slice(-Math.max(CHAT_MESSAGE_LIMIT, 600));
    const selectedRows = requestedThread
      ? allMessages.filter((item) => String(item.thread_key || 'team') === String(requestedThread)).slice(-Math.max(CHAT_MESSAGE_LIMIT * 8, 12000))
      : [];
    groups = allGroups;
    messages = mergeMessages(recentRows, selectedRows);
  }
  const orderedGroups = [...groups].sort((a, b) => {
    if (String(a.group_id) === 'team') return -1;
    if (String(b.group_id) === 'team') return 1;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
  const visibleMessages = messages.filter((item) => visibleToUser(item, req.user)).map((item) => serializeForUser(item, req.user));
  const payload = { groups: orderedGroups, messages: visibleMessages };
  chatListCache.set(cacheKey, payload);
  return res.json(payload);
}

async function createGroup(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groups = await table('chat_groups');
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Group title required' });
  const item = {
    group_id: nextId('G', groups.filter((group) => String(group.group_id) !== 'team'), 'group_id'),
    title,
    created_by: req.user.username,
    created_at: nowIso(),
  };
  await store.insert('chat_groups', item);
  clearAllCaches();
  return res.json({ item });
}

async function renameGroup(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  await ensureGeneralGroup();
  const groupId = String(req.params.groupId || '').trim();
  const title = String(req.body.title || '').trim();
  if (!groupId) return res.status(400).json({ message: 'Group id required' });
  if (!title) return res.status(400).json({ message: 'Group title required' });
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Group not found' });
  const item = await store.update('chat_groups', 'group_id', groupId, { title });
  clearAllCaches();
  return res.json({ item });
}

async function deleteGroup(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groupId = String(req.params.groupId || '').trim();
  if (!groupId) return res.status(400).json({ message: 'Group id required' });
  if (groupId === 'team') return res.status(400).json({ message: 'Default General Team group cannot be deleted' });
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Group not found' });
  await store.deleteWhere('messages', 'thread_key', groupId);
  await store.delete('chat_groups', 'group_id', groupId);
  clearAllCaches();
  return res.json({ ok: true });
}

async function sendMessage(req, res) {
  await ensureGeneralGroup();
  const messages = await table('messages');
  const groups = (await table('chat_groups')).map((item) => ({
    ...item,
    created_by_username: item.created_by_username || item.created_by || 'system',
  }));
  const body = String(req.body.body || '').trim();
  const requestedThreadKey = String(req.body.thread_key || 'team').trim() || 'team';
  const thread = groups.find((group) => String(group.group_id) === requestedThreadKey) || groups.find((group) => String(group.group_id) === 'team');
  const threadKey = String(thread?.group_id || 'team');
  const replyToId = req.body.reply_to_id ? Number(req.body.reply_to_id) : '';
  if (!body) return res.status(400).json({ message: 'Message body required' });
  const item = {
    id: messages.length ? Math.max(...messages.map((m) => Number(m.id || 0))) + 1 : 1,
    sender_username: req.user.username,
    sender_role: normalizeRole(req.user.role || ''),
    recipient_username: '',
    body,
    original_body: body,
    created_at: nowIso(),
    thread_key: threadKey,
    thread_type: 'group',
    reference_type: replyToId ? 'message' : '',
    reference_id: replyToId || '',
    mention_usernames: '',
    delete_mode: '',
    deleted_by_username: '',
    deleted_at: '',
  };
  const insertRow = store.pool
    ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id'))
    : item;
  const savedItem = await store.insert('messages', insertRow);
  clearAllCaches();
  const users = await table('users');
  const openPath = `/chat?thread=${encodeURIComponent(threadKey)}`;
  for (const user of users.filter((u) => String(u.user_id) !== String(req.user.user_id))) {
    try {
      await makeNotification(
        user.user_id,
        'New team message',
        `${req.user.full_name} sent a new message in ${thread?.title || threadKey}.`,
        JSON.stringify({ thread_key: threadKey, open_path: openPath, message_id: savedItem.id }),
      );
    } catch {
      // chat send should not fail just because one notification insert failed
    }
  }
  return res.json({ item: serializeForUser(savedItem, req.user) });
}

async function editMessage(req, res) {
  await ensureGeneralGroup();
  const messageId = Number(req.params.messageId || 0);
  const body = String(req.body.body || '').trim();
  if (!messageId) return res.status(400).json({ message: 'Message id required' });
  if (!body) return res.status(400).json({ message: 'Message body required' });
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  if (existing.sender_username !== req.user.username && !isManagerLike(req.user)) {
    return res.status(403).json({ message: 'You can edit only your own messages' });
  }
  const flags = decodeMessageFlags(existing.mention_usernames);
  if (flags.includes('__deleted__') || isHardDeleted(existing) || isManagerAuditDeleted(existing)) {
    return res.status(400).json({ message: 'Deleted message cannot be edited' });
  }
  const item = await store.update('messages', 'id', messageId, {
    body,
    original_body: body,
    mention_usernames: encodeMessageFlags([...flags, '__edited__']),
  });
  clearAllCaches();
  return res.json({ item: serializeForUser(item, req.user) });
}

async function deleteMessage(req, res) {
  await ensureGeneralGroup();
  const messageId = Number(req.params.messageId || 0);
  if (!messageId) return res.status(400).json({ message: 'Message id required' });
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  const mine = existing.sender_username === req.user.username;
  const role = normalizeRole(req.user.role || '');
  if (canDeleteHard(req.user)) {
    const item = await store.update('messages', 'id', messageId, {
      delete_mode: 'hard',
      deleted_by_username: req.user.username,
      deleted_at: nowIso(),
      original_body: existing.original_body || existing.body || '',
      body: '',
      reference_type: '',
      reference_id: '',
      mention_usernames: encodeMessageFlags([...decodeMessageFlags(existing.mention_usernames), '__deleted__']),
    });
    clearAllCaches();
    return res.json({ ok: true, item: serializeForUser(item, req.user), visibility: 'hard' });
  }
  if (!mine || !canDeleteOwnForEveryone(req.user)) {
    return res.status(403).json({ message: 'You can delete only your own messages' });
  }
  if (!['recruiter', 'tl', 'team lead'].includes(role)) {
    return res.status(403).json({ message: 'Delete for everyone is not allowed for this role' });
  }
  const flags = decodeMessageFlags(existing.mention_usernames);
  const item = await store.update('messages', 'id', messageId, {
    delete_mode: 'soft_manager_audit',
    deleted_by_username: req.user.username,
    deleted_at: nowIso(),
    original_body: existing.original_body || existing.body || '',
    body: 'This message was deleted for everyone',
    reference_type: '',
    reference_id: '',
    mention_usernames: encodeMessageFlags([...flags.filter((flag) => flag !== '__edited__'), '__deleted__']),
  });
  clearAllCaches();
  return res.json({ ok: true, item: serializeForUser(item, req.user), visibility: 'manager_audit' });
}

module.exports = {
  list,
  createGroup,
  renameGroup,
  deleteGroup,
  sendMessage,
  editMessage,
  deleteMessage,
};
