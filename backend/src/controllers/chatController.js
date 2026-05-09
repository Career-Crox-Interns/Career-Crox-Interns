const { store, table } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');

const CHAT_RECENT_FETCH_LIMIT = Number(process.env.CHAT_RECENT_FETCH_LIMIT || 90);
const CHAT_SELECTED_FETCH_LIMIT = Number(process.env.CHAT_SELECTED_FETCH_LIMIT || 260);

const REVIEW_WORDS = [
  'fraud','cheat','scam','fake','spam','abuse','abusing','harass','harassment','bribe','threat','blackmail','bloody',
  'madarchod','bhosdi','bhosdike','bhenchod','behenchod','chutiya','gandu','randi','mc','bc','fuck','shit','asshole',
  'fraudulent','cheater','chor','ghotala','loot','scammer'
];

function normalizeRole(value) { return String(value || '').trim().toLowerCase(); }
function username(user) { return String(user?.username || user?.employee_code || user?.user_id || '').trim(); }
function userId(user) { return String(user?.user_id || user?.id || '').trim(); }
function isManagerLike(user) { return ['admin', 'manager'].includes(normalizeRole(user?.role)); }
function isTl(user) { return ['tl', 'team lead'].includes(normalizeRole(user?.role)); }
function canReview(user) { return isManagerLike(user) || isTl(user); }
function canManageGroups(user) { return isManagerLike(user); }
function canRenameGroups(user) { return isManagerLike(user) || isTl(user); }
function low(value) { return String(value || '').toLowerCase(); }
function splitList(value) { return String(value || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean); }
function flags(value) { return String(value || '').split('|').map((x) => x.trim()).filter(Boolean); }
function joinFlags(list) { return [...new Set((list || []).filter(Boolean))].join('|'); }
function groupKey(value) { return String(value || '').trim() || 'team'; }
function memberKey(row) { return `${row.group_id || ''}|${row.user_id || ''}|${row.username || ''}`; }

function detectReview(body) {
  const text = low(body).replace(/[^a-z0-9\u0900-\u097f]+/g, ' ');
  const hit = REVIEW_WORDS.find((word) => text.includes(word));
  if (!hit) return null;
  return { word: hit, reason: `Risk word detected: ${hit}` };
}

function visibleToUser(message, user) {
  const mode = low(message.delete_mode);
  if (mode === 'hard') return false;
  const moderation = low(message.moderation_status || 'approved');
  if (moderation === 'review_pending' || moderation === 'rejected') {
    return canReview(user) || String(message.sender_username || '') === username(user);
  }
  if (mode === 'soft_manager_audit') return isManagerLike(user);
  return true;
}

function serializeForUser(message, user) {
  const moderation = low(message.moderation_status || 'approved');
  if ((moderation === 'review_pending' || moderation === 'rejected') && !canReview(user) && String(message.sender_username || '') !== username(user)) {
    return null;
  }
  if (moderation === 'rejected' && !canReview(user)) {
    return { ...message, body: 'Message rejected after review', moderation_badge: 'Rejected' };
  }
  if (low(message.delete_mode) === 'soft_manager_audit' && isManagerLike(user)) {
    return { ...message, body: message.original_body || message.body || 'Deleted message', audit_deleted: '1', deleted_badge: 'Deleted for everyone' };
  }
  return message;
}

async function notify(user_id, title, message, metadata = '') {
  if (!user_id) return null;
  const rows = await table('notifications');
  return store.insert('notifications', {
    notification_id: nextId('N', rows, 'notification_id'), user_id, title, message, category: 'chat', status: 'Unread', metadata, created_at: nowIso(),
  });
}

async function ensureGeneralGroup() {
  const groups = await table('chat_groups');
  const existing = groups.find((item) => String(item.group_id) === 'team');
  if (existing) return existing;
  const item = { group_id: 'team', title: 'General Team', created_by: 'system', created_by_username: 'system', status: 'Active', visibility: 'all', created_at: nowIso(), updated_at: nowIso() };
  await store.insert('chat_groups', item);
  return item;
}

async function getVisibleGroups(user) {
  await ensureGeneralGroup();
  const groups = (await table('chat_groups')).filter((g) => low(g.status || 'active') !== 'deleted');
  if (isManagerLike(user)) return groups;
  const members = await table('chat_group_members');
  const uid = userId(user);
  const un = username(user);
  const allowed = new Set(['team']);
  for (const m of members) {
    if (String(m.user_id || '') === uid || String(m.username || '') === un) allowed.add(String(m.group_id || ''));
  }
  return groups.filter((g) => allowed.has(String(g.group_id || '')) || low(g.visibility) === 'all');
}

async function assertCanUseGroup(user, groupId) {
  const groups = await getVisibleGroups(user);
  const group = groups.find((g) => String(g.group_id) === String(groupId));
  return group || null;
}

async function groupMembers(groupId) {
  return (await table('chat_group_members')).filter((m) => String(m.group_id) === String(groupId));
}

async function list(req, res) {
  res.set('Cache-Control', 'private, max-age=8');
  const requestedThread = groupKey(req.query?.thread_key || req.query?.thread || 'team');
  const sinceId = Math.max(0, Number(req.query?.since_id || 0) || 0);
  const fullMode = String(req.query?.full || '').trim() === '1';
  const visibleGroups = await getVisibleGroups(req.user);
  const selectedGroup = visibleGroups.find((g) => String(g.group_id) === requestedThread) || visibleGroups.find((g) => String(g.group_id) === 'team');
  const threadKey = String(selectedGroup?.group_id || 'team');
  const limit = fullMode || sinceId === 0 ? Math.min(Math.max(CHAT_SELECTED_FETCH_LIMIT, 180), 600) : Math.max(Math.min(CHAT_RECENT_FETCH_LIMIT, 180), 60);
  let rawRows = [];
  let reviewItems = [];
  try {
    if (store.pool) {
      rawRows = await store.query(`select * from (select * from public.messages where coalesce(nullif(thread_key, ''), 'team') = $1 order by created_at desc, id desc limit $2) x order by created_at asc, id asc`, [threadKey, limit]);
      if (canReview(req.user)) reviewItems = await store.query(`select * from public.messages where coalesce(moderation_status, '') = 'review_pending' order by created_at desc limit 80`, []);
    } else {
      const allMessages = (await table('messages')).sort((a, b) => (Number(a.id || 0) - Number(b.id || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
      rawRows = allMessages.filter((m) => groupKey(m.thread_key) === threadKey).filter((m) => !sinceId || Number(m.id || 0) > sinceId).slice(-limit);
      reviewItems = canReview(req.user) ? allMessages.filter((m) => low(m.moderation_status) === 'review_pending').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 80) : [];
    }
  } catch {
    const allMessages = (await table('messages')).sort((a, b) => (Number(a.id || 0) - Number(b.id || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    rawRows = allMessages.filter((m) => groupKey(m.thread_key) === threadKey).slice(-limit);
    reviewItems = canReview(req.user) ? allMessages.filter((m) => low(m.moderation_status) === 'review_pending').slice(0, 80) : [];
  }
  const rows = rawRows.filter((m) => visibleToUser(m, req.user)).map((m) => serializeForUser(m, req.user)).filter(Boolean);
  const members = await table('chat_group_members');
  const payload = {
    groups: visibleGroups.sort((a, b) => (String(a.group_id) === 'team' ? -1 : String(b.group_id) === 'team' ? 1 : String(a.title || '').localeCompare(String(b.title || '')))),
    members,
    messages: rows,
    review_items: reviewItems,
    latest_message_id: rows.length ? Math.max(...rows.map((item) => Number(item?.id || 0))) : sinceId,
    permissions: { can_manage_groups: canManageGroups(req.user), can_rename_groups: canRenameGroups(req.user), can_review: canReview(req.user) },
  };
  return res.json(payload);
}

async function createGroup(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groups = await table('chat_groups');
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Group title required' });
  const item = { group_id: nextId('G', groups.filter((g) => String(g.group_id) !== 'team'), 'group_id'), title, created_by: username(req.user), created_by_username: username(req.user), status: 'Active', visibility: 'members', created_at: nowIso(), updated_at: nowIso() };
  await store.insert('chat_groups', item);
  clearAllCaches();
  return res.json({ item });
}

async function renameGroup(req, res) {
  if (!canRenameGroups(req.user)) return res.status(403).json({ message: 'TL can rename only. Manager can fully manage.' });
  const groupId = groupKey(req.params.groupId);
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Group title required' });
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Group not found' });
  const item = await store.update('chat_groups', 'group_id', groupId, { title, updated_at: nowIso() });
  clearAllCaches();
  return res.json({ item });
}

async function deleteGroup(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groupId = groupKey(req.params.groupId);
  if (groupId === 'team') return res.status(400).json({ message: 'Default group cannot be deleted' });
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Group not found' });
  await store.update('chat_groups', 'group_id', groupId, { status: 'Deleted', deleted_by_username: username(req.user), deleted_at: nowIso(), updated_at: nowIso() });
  clearAllCaches();
  return res.json({ ok: true });
}

async function addMembers(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groupId = groupKey(req.params.groupId);
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Group not found' });
  const input = splitList(req.body.members || req.body.usernames || req.body.username || req.body.user_id || '');
  if (!input.length) return res.status(400).json({ message: 'Member username/user id required' });
  const users = await table('users');
  const oldMembers = await table('chat_group_members');
  const existingKeys = new Set(oldMembers.map(memberKey));
  const added = [];
  for (const raw of input) {
    const u = users.find((x) => String(x.username || '').toLowerCase() === raw.toLowerCase() || String(x.user_id || '') === raw || String(x.recruiter_code || '') === raw) || { username: raw, user_id: raw, full_name: raw, role: '' };
    const row = { id: nextId('CGM', [...oldMembers, ...added], 'id'), group_id: groupId, user_id: String(u.user_id || raw), username: String(u.username || raw), full_name: String(u.full_name || u.name || raw), role: String(u.role || ''), added_by_username: username(req.user), created_at: nowIso(), status: 'Active' };
    if (existingKeys.has(memberKey(row))) continue;
    await store.insert('chat_group_members', row);
    existingKeys.add(memberKey(row));
    added.push(row);
  }
  clearAllCaches();
  return res.json({ ok: true, added });
}

async function removeMember(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groupId = groupKey(req.params.groupId);
  const target = String(req.body.username || req.body.user_id || req.params.memberKey || '').trim();
  if (!target) return res.status(400).json({ message: 'Member required' });
  const members = await groupMembers(groupId);
  const hit = members.find((m) => String(m.username || '') === target || String(m.user_id || '') === target || String(m.id || '') === target);
  if (!hit) return res.status(404).json({ message: 'Member not found' });
  if (hit.id) await store.delete('chat_group_members', 'id', hit.id);
  else await store.deleteWhere('chat_group_members', 'username', hit.username || target);
  clearAllCaches();
  return res.json({ ok: true });
}

async function sendMessage(req, res) {
  await ensureGeneralGroup();
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ message: 'Message body required' });
  const threadKey = groupKey(req.body.thread_key || 'team');
  const thread = await assertCanUseGroup(req.user, threadKey);
  if (!thread) return res.status(403).json({ message: 'You are not in this group' });
  const messages = await table('messages');
  const review = detectReview(body);
  const id = messages.length ? Math.max(...messages.map((m) => Number(m.id || 0)).filter(Number.isFinite)) + 1 : 1;
  const item = {
    id, sender_username: username(req.user), sender_name: req.user.full_name || username(req.user), sender_role: normalizeRole(req.user.role || ''), recipient_username: '',
    body, original_body: body, message: body, message_text: body, content: body, created_at: nowIso(), updated_at: nowIso(), thread_key: threadKey, thread_type: 'group', chat_type: 'team_group',
    reference_type: req.body.reply_to_id ? 'message' : '', reference_id: req.body.reply_to_id ? String(req.body.reply_to_id) : '', mention_usernames: review ? '__review_pending__' : '', delete_mode: '', deleted_by_username: '', deleted_at: '', status: review ? 'Review Pending' : 'sent', moderation_status: review ? 'review_pending' : 'approved', moderation_reason: review ? review.reason : '', moderation_word: review ? review.word : '', reviewed_by_username: '', reviewed_at: '', review_decision_note: '',
  };
  const saved = await store.insert('messages', item);
  const finalItem = { ...item, ...(saved || {}) };
  const users = await table('users');
  const openPath = `/chat?thread=${encodeURIComponent(threadKey)}`;
  const recipients = review ? users.filter((u) => ['manager','admin','tl','team lead'].includes(normalizeRole(u.role))) : users.slice(0, 80);
  for (const u of recipients) {
    if (String(u.user_id) === String(req.user.user_id)) continue;
    try { await notify(u.user_id, review ? 'Chat message needs review' : 'New team message', review ? `${req.user.full_name || username(req.user)} message went to review.` : `${req.user.full_name || username(req.user)} sent a message in ${thread.title || threadKey}.`, JSON.stringify({ thread_key: threadKey, open_path: openPath, message_id: finalItem.id || '' })); } catch {}
  }
  clearAllCaches();
  return res.json({ item: serializeForUser(finalItem, req.user), review_pending: !!review });
}

async function editMessage(req, res) {
  const messageId = String(req.params.messageId || '').trim();
  const body = String(req.body.body || '').trim();
  if (!messageId || !body) return res.status(400).json({ message: 'Message id and body required' });
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  if (String(existing.sender_username) !== username(req.user) && !isManagerLike(req.user)) return res.status(403).json({ message: 'You can edit only your own messages' });
  const review = detectReview(body);
  const item = await store.update('messages', 'id', messageId, { body, original_body: body, message: body, message_text: body, content: body, updated_at: nowIso(), mention_usernames: joinFlags([...flags(existing.mention_usernames), '__edited__', review ? '__review_pending__' : '']), moderation_status: review ? 'review_pending' : 'approved', moderation_reason: review ? review.reason : '', moderation_word: review ? review.word : '', status: review ? 'Review Pending' : 'sent' });
  clearAllCaches();
  return res.json({ item: serializeForUser(item, req.user) });
}

async function deleteMessage(req, res) {
  const messageId = String(req.params.messageId || '').trim();
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  const mine = String(existing.sender_username) === username(req.user);
  if (!mine && !isManagerLike(req.user)) return res.status(403).json({ message: 'You can delete only your own messages' });
  const item = await store.update('messages', 'id', messageId, { delete_mode: isManagerLike(req.user) ? 'hard' : 'soft_manager_audit', deleted_by_username: username(req.user), deleted_at: nowIso(), original_body: existing.original_body || existing.body || '', body: isManagerLike(req.user) ? '' : 'This message was deleted for everyone', updated_at: nowIso() });
  clearAllCaches();
  return res.json({ ok: true, item: serializeForUser(item, req.user) });
}

async function reviewMessage(req, res) {
  if (!canReview(req.user)) return res.status(403).json({ message: 'TL/Manager review access only' });
  const messageId = String(req.params.messageId || '').trim();
  const decision = low(req.body.decision || req.body.status || 'approve');
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  const approved = decision.startsWith('approve');
  const item = await store.update('messages', 'id', messageId, { moderation_status: approved ? 'approved' : 'rejected', status: approved ? 'sent' : 'Rejected', reviewed_by_username: username(req.user), reviewed_at: nowIso(), review_decision_note: String(req.body.note || '').slice(0, 250), body: approved ? (existing.original_body || existing.body || '') : 'Message rejected after review', updated_at: nowIso() });
  clearAllCaches();
  return res.json({ ok: true, item: serializeForUser(item, req.user) });
}

module.exports = { list, createGroup, renameGroup, deleteGroup, addMembers, removeMember, sendMessage, editMessage, deleteMessage, reviewMessage };
