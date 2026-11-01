const { store, table, withTransaction } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');

const CHAT_RECENT_FETCH_LIMIT = Number(process.env.CHAT_RECENT_FETCH_LIMIT || 90);
const CHAT_SELECTED_FETCH_LIMIT = Number(process.env.CHAT_SELECTED_FETCH_LIMIT || 260);
const DEFAULT_GENERAL_GROUP_TITLE = 'Team Aaryansh';
const ARIA_REPORT_GROUP_ID = 'aria-reports';
const ARIA_REPORT_GROUP_TITLE = 'ARIA Reports';
const ARIA_CONTACT = { user_id: 'ARIA', username: 'aria', full_name: 'ARIA', role: 'assistant', designation: '30-Minute Report Assistant', recruiter_code: 'ARIA', can_chat: true, is_self: false, is_bot: true, system_thread: ARIA_REPORT_GROUP_ID };
const chatStreams = new Map();
const staffRosterCache=require('../lib/cache').createTimedCache(30000,{tags:['staff']});

function streamKey(user, threadKey) { return `${userId(user) || username(user)}|${groupKey(threadKey)}`; }
function streamUserOnline(target, threadKey) {
  const key = groupKey(threadKey);
  for (const entry of chatStreams.values()) {
    if (!sameUser(entry.user, target)) continue;
    if (entry.threadKey === key) return true;
    if (entry.threadKey === '*' && (key === 'team' || key.startsWith('dm:') || entry.allowedGroups?.has(key))) return true;
  }
  return false;
}
function wildcardStreamCanReceive(message, user, allowedGroups = new Set()) {
  const key = groupKey(message?.thread_key || 'team');
  if (key === 'team') return true;
  if (key.startsWith('dm:')) {
    const viewer = username(user);
    return Boolean(viewer && (String(message.sender_username || '') === viewer || String(message.recipient_username || '') === viewer || (low(message.moderation_status).includes('review') && canReview(user))));
  }
  // Restricted/custom groups keep using their exact-thread SSE. Do not leak them into the global preview stream.
  return allowedGroups.has(key);
}
function publishToStreams(message) {
  const key = groupKey(message?.thread_key || 'team');
  for (const [id, entry] of [...chatStreams.entries()]) {
    if (entry.threadKey !== '*' && entry.threadKey !== key && !(entry.threadKey === ARIA_REPORT_GROUP_ID && low(message?.sender_username) === 'aria' && message?.reference_type === 'semi_hourly_report')) continue;
    try {
      if (entry.threadKey === '*' && !wildcardStreamCanReceive(message, entry.user, entry.allowedGroups)) continue;
      const removed = low(message.delete_mode) === 'hard' || (low(message.delete_mode) === 'soft_manager_audit' && !isManagerLike(entry.user));
      if (!removed && !visibleToUser(message, entry.user)) continue;
      const item = removed ? { id:message.id,thread_key:key,deleted:true,deleted_at:message.deleted_at,updated_at:message.updated_at } : serializeForUser(message, entry.user);
      if (!item) continue;
      entry.res.write(`event: message\ndata: ${JSON.stringify({ item })}\n\n`);
    } catch {
      try { entry.res.end(); } catch {}
      chatStreams.delete(id);
    }
  }
}

const REVIEW_WORDS = [
  'fraud', 'cheat', 'scam', 'fake', 'spam', 'abuse', 'abusing', 'harass', 'harassment', 'bribe', 'threat', 'blackmail', 'bloody',
  Buffer.from('bWFkYXJjaG9k', 'base64').toString('utf8'), Buffer.from('Ymhvc2Rp', 'base64').toString('utf8'), Buffer.from('Ymhvc2Rpa2U=', 'base64').toString('utf8'), Buffer.from('YmhlbmNob2Q=', 'base64').toString('utf8'), Buffer.from('YmVoZW5jaG9k', 'base64').toString('utf8'), Buffer.from('Y2h1dGl5YQ==', 'base64').toString('utf8'), Buffer.from('Z2FuZHU=', 'base64').toString('utf8'), Buffer.from('cmFuZGk=', 'base64').toString('utf8'), Buffer.from('bWM=', 'base64').toString('utf8'), Buffer.from('YmM=', 'base64').toString('utf8'), Buffer.from('ZnVjaw==', 'base64').toString('utf8'), Buffer.from('c2hpdA==', 'base64').toString('utf8'), Buffer.from('YXNzaG9sZQ==', 'base64').toString('utf8'),
  'fraudulent', 'cheater', 'chor', 'ghotala', 'loot', 'scammer', 'whatsapp', 'mobile number', 'phone number', 'personal number', 'contact number',
];

function normalizeRole(value) { return String(value || '').trim().toLowerCase(); }
function username(user) { return String(user?.username || user?.employee_code || user?.user_id || '').trim(); }
function userId(user) { return String(user?.user_id || user?.id || '').trim(); }
function isManagerLike(user) { return ['admin', 'manager'].includes(normalizeRole(user?.role)); }
function isTl(user) { return ['tl', 'team lead', 'teamlead', 'team leader'].includes(normalizeRole(user?.role)); }
function isRecruiter(user) { return normalizeRole(user?.role) === 'recruiter' || normalizeRole(user?.designation).includes('recruiter'); }
function canReview(user) { return isManagerLike(user) || isTl(user); }
function canManageGroups(user) { return isManagerLike(user); }
function canRenameGroups(user) { return isManagerLike(user) || isTl(user); }
function low(value) { return String(value || '').toLowerCase(); }
function splitList(value) { return String(value || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean); }
function flags(value) { return String(value || '').split('|').map((x) => x.trim()).filter(Boolean); }
function joinFlags(list) { return [...new Set((list || []).filter(Boolean))].join('|'); }
function groupKey(value) { return String(value || '').trim() || 'team'; }
function memberKey(row) { return `${row.group_id || ''}|${row.user_id || ''}|${row.username || ''}`; }
function isActiveMemberRow(row = {}) {
  const status = String(row.status || 'Active').trim().toLowerCase();
  return !['removed', 'deleted', 'inactive', 'archived'].includes(status) && !String(row.deleted_at || row.removed_at || '').trim();
}
function nextNumericId(rows = [], field = 'id') {
  const nums = rows.map((row) => Number(row?.[field] || 0)).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) + 1 : 1;
}
function looksActive(user) { return !['0', 'false', 'no', 'inactive', 'deleted'].includes(low(user?.is_active ?? '1')); }
function displayName(user) { return String(user?.full_name || user?.name || user?.username || user?.user_id || 'User').trim(); }
function cleanId(value) { return String(value || '').trim(); }
function sameUser(a, b) {
  const au = username(a).toLowerCase();
  const bu = username(b).toLowerCase();
  const ai = userId(a);
  const bi = userId(b);
  return (!!au && au === bu) || (!!ai && ai === bi);
}

function detectReview(body) {
  const raw = String(body || '');
  const text = low(raw).replace(/[^a-z0-9\u0900-\u097f]+/g, ' ');
  const wordHit = REVIEW_WORDS.find((word) => text.includes(word));
  if (wordHit) return { word: wordHit, reason: `Risk word detected: ${wordHit}` };
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10 && /(?:\+?91[\s-]?)?[6-9]\d[\d\s-]{8,}/.test(raw)) {
    return { word: 'phone', reason: 'Phone/contact number detected. Sent to TL/Manager review.' };
  }
  return null;
}

function visibleToUser(message, user) {
  const mode = low(message.delete_mode);
  if (mode === 'hard') return false;
  const moderation = low(message.moderation_status || 'approved');
  if (moderation === 'review_pending' || moderation === 'rejected') {
    return canReview(user) || String(message.sender_username || '') === username(user) || String(message.recipient_username || '') === username(user);
  }
  if (mode === 'soft_manager_audit') return isManagerLike(user);
  return true;
}

function serializeForUser(message, user) {
  const moderation = low(message.moderation_status || 'approved');
  if ((moderation === 'review_pending' || moderation === 'rejected') && !canReview(user) && String(message.sender_username || '') !== username(user) && String(message.recipient_username || '') !== username(user)) {
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

function serializeContact(user, viewer) {
  const role = normalizeRole(user?.role || user?.designation || '');
  return {
    user_id: cleanId(user?.user_id || user?.id),
    username: username(user),
    full_name: displayName(user),
    role,
    designation: String(user?.designation || role || '').trim(),
    recruiter_code: String(user?.recruiter_code || '').trim(),
    can_chat: canDirectMessage(viewer, user),
    is_self: sameUser(user, viewer),
  };
}

async function activeUsers() {
  // Only the fields used by Team Chat; never download the full users table or passwords on every message.
  if (store.pool) {
    try {
      const cached = staffRosterCache.get('active');
      if (cached) return cached;
      const users = await store.query('select user_id, username, full_name, role, designation, recruiter_code, is_active from public.users limit 500', []);
      return staffRosterCache.set('active', users.filter(looksActive));
    } catch { /* Legacy schemas can continue to use the previous path. */ }
  }
  return (await table('users')).filter(looksActive);
}

function canViewContact(viewer, target) {
  if (!target || !viewer) return false;
  if (sameUser(viewer, target)) return true;
  if (isManagerLike(viewer) || isTl(viewer)) return true;
  if (isRecruiter(viewer)) return true; // CC26_579: active coworkers appear in Team Chat, including other recruiters
  return isManagerLike(target) || isTl(target) || sameUser(viewer, target);
}

function canDirectMessage(viewer, target) {
  if (!target || !viewer) return false;
  if (sameUser(viewer, target)) return true;
  if (isManagerLike(viewer) || isTl(viewer)) return true;
  if (isRecruiter(viewer)) return true; // CC26_579: active coworkers appear in Team Chat, including other recruiters
  return false;
}

function directThreadKeyFor(a, b) {
  const ids = [cleanId(userId(a) || username(a)), cleanId(userId(b) || username(b))].filter(Boolean).sort((x, y) => x.localeCompare(y));
  return ids.length === 2 ? `dm:${ids.join('__')}` : '';
}

function parseDirectThreadKey(threadKey) {
  const raw = String(threadKey || '').trim();
  if (!raw.startsWith('dm:')) return [];
  return raw.slice(3).split('__').map((x) => x.trim()).filter(Boolean);
}

function matchesUserToken(user, token) {
  const t = cleanId(token).toLowerCase();
  return cleanId(user?.user_id).toLowerCase() === t || username(user).toLowerCase() === t || cleanId(user?.recruiter_code).toLowerCase() === t;
}

async function visibleContacts(viewer) {
  const users = await activeUsers();
  const contacts = users
    .filter((u) => canViewContact(viewer, u))
    .map((u) => serializeContact(u, viewer))
    .sort((a, b) => {
      const rank = (r) => (r === 'manager' || r === 'admin' ? 0 : r === 'tl' || r === 'team lead' ? 1 : r === 'recruiter' ? 2 : 3);
      return rank(a.role) - rank(b.role) || a.full_name.localeCompare(b.full_name);
    });
  return [ARIA_CONTACT, ...contacts];
}

async function resolveDirectThread(viewer, threadKey) {
  const tokens = parseDirectThreadKey(threadKey);
  if (tokens.length !== 2) return null;
  const users = await activeUsers();
  const first = users.find((u) => matchesUserToken(u, tokens[0]));
  const second = users.find((u) => matchesUserToken(u, tokens[1]));
  if (!first || !second) return null;
  const viewerIsParticipant = sameUser(viewer, first) || sameUser(viewer, second);
  if (!viewerIsParticipant) return null;
  const other = sameUser(viewer, first) ? second : first;
  if (!canDirectMessage(viewer, other)) return null;
  const canonical = directThreadKeyFor(first, second);
  if (canonical && canonical !== threadKey) return null;
  return {
    group_id: canonical,
    title: sameUser(viewer, other) ? `${displayName(viewer)} (You)` : displayName(other),
    thread_type: 'direct',
    visibility: 'direct',
    other: serializeContact(other, viewer),
    participants: [serializeContact(first, viewer), serializeContact(second, viewer)],
  };
}

async function notify(user_id, title, message, metadata = '') {
  if (!user_id) return null;
  const notification_id = `N${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return store.insert('notifications', {
    notification_id, user_id, title, message, category: 'chat', status: 'Unread', metadata, created_at: nowIso(),
  });
}

async function stream(req, res) {
  const requestedThread = groupKey(req.query?.thread_key || req.query?.thread || 'team');
  const globalStream = requestedThread === 'all' || requestedThread === '*';
  const thread = globalStream ? { group_id: '*' } : await assertCanUseThread(req.user, requestedThread);
  if (!thread) return res.status(403).json({ message: 'This chat is not allowed for your role' });
  setImmediate(() => { drainChatNotifications().catch(error=>console.error('Chat queue recovery pending:',error.code||error.message)); });
  const threadKey = globalStream ? '*' : String(thread.group_id || requestedThread);
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const key = `${streamKey(req.user, threadKey)}|${require('crypto').randomUUID()}`;
  const entry = { res, user: { ...req.user }, threadKey, allowedGroups:new Set((await getVisibleGroups(req.user)).map(g => String(g.group_id))) };
  chatStreams.set(key, entry);
  const untrackIdle = require('../lib/recentHumanActivity').registerStream(req.user, res);
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, thread_key: threadKey, transport: 'sse' })}\n\n`);
  const heartbeat = setInterval(() => {
    try {
      // CC26_760: recentHumanActivity closes streams at the real 10-minute session idle boundary.
      // Keeping this connection avoids reconnect gaps and extra HTTP handshakes.
      res.write(': keepalive\n\n');
    }
    catch { clearInterval(heartbeat); chatStreams.delete(key); }
  }, 45000);
  heartbeat.unref?.();
  req.on('close', () => {
    clearInterval(heartbeat);
    untrackIdle();
    if (chatStreams.get(key)?.res === res) chatStreams.delete(key);
  });
}

async function publishAriaReportMessage(payload = {}) {
  await ensureGeneralGroup();
  await ensureAriaReportGroup();
  const reportId = String(payload.report_id || payload.saved_report_id || '').trim();
  if (!reportId) return null;
  let existing = null;
  if (store.pool) {
    existing = await store.one(`select * from public.messages where sender_username = 'aria' and reference_type = 'semi_hourly_report' and reference_id = $1 limit 1`, [reportId]);
  } else {
    existing = (await table('messages')).find((row) => String(row.sender_username || '').toLowerCase() === 'aria' && String(row.reference_type || '') === 'semi_hourly_report' && String(row.reference_id || '') === reportId) || null;
  }
  if (existing) return existing;
  const summary = payload.summary || {};
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  // CC26_491: ARIA chat report must show the full visible team, not only the top 3.
  // Keep the compact text payload as the source for the inline Excel-style table so no
  // extra report API request is required when Team Chat opens (lower egress + instant UI).
  const ranked = rows.slice();
  const teamText = ranked.length ? ranked.map((r, i) => `${i + 1}. ${r.full_name || r.username || 'Team'} — D ${Number(r.metrics?.dialed_calls || 0)} • C ${Number(r.metrics?.connected_calls || 0)} • I ${Number(r.metrics?.incoming_calls || 0)} • T ${Number(r.metrics?.talk_time_minutes || 0)}m • S ${Number(r.metrics?.submissions || 0)} • B ${Number(r.metrics?.break_minutes || 0)}m • Idle ${Number(r.metrics?.idle_minutes || 0)}m`).join('\n') : 'No activity recorded in this window.';
  const openPath = `/semi-hourly-report?reportId=${encodeURIComponent(reportId)}`;
  const body = `30-Minute Team Performance • ${payload.window_label || 'Previous 30 Minutes'}\nDialed ${Number(summary.dialed_calls || 0)} • Connected ${Number(summary.connected_calls || 0)} • Incoming ${Number(summary.incoming_calls || 0)} • Talk ${Number(summary.talk_time_minutes || 0)}m • Submissions ${Number(summary.submissions || 0)} • Break ${Number(summary.break_minutes || 0)}m • Idle ${Number(summary.idle_minutes || 0)}m\n${teamText}\nChart: ${openPath}`;
  let base = {
    sender_username: 'aria', sender_name: 'ARIA', sender_role: 'assistant', recipient_username: '',
    body, original_body: body, message: body, message_text: body, content: body,
    created_at: nowIso(), updated_at: nowIso(), thread_key: 'team', thread_type: 'group', chat_type: 'aria_report_group',
    reference_type: 'semi_hourly_report', reference_id: reportId, mention_usernames: '', delete_mode: '', deleted_by_username: '', deleted_at: '',
    status: 'sent', moderation_status: 'approved', moderation_reason: '', moderation_word: '', reviewed_by_username: '', reviewed_at: '', review_decision_note: '',
  };
  if (!store.pool) {
    const messages = await table('messages');
    base.id = nextNumericId(messages, 'id');
  }
  const saved = await store.insert('messages', base);
  const item = { ...base, ...(saved || {}) };
  publishToStreams(item);
  clearAllCaches();
  return item;
}

function virtualAriaReportGroup() {
  return { group_id: ARIA_REPORT_GROUP_ID, title: ARIA_REPORT_GROUP_TITLE, created_by: 'system', created_by_username: 'system', status: 'Active', visibility: 'all', created_at: nowIso(), updated_at: nowIso() };
}

async function ensureAriaReportGroup() {
  // CC26_503: keep ARIA Reports schema-safe. Older live Supabase chat_groups tables
  // do not have a system_group column; inserting that extra field made the whole
  // /api/chat bootstrap fail. The channel can safely exist as a virtual system
  // group if the insert is unavailable, so normal Team Chat must never go down.
  const fallback = virtualAriaReportGroup();
  let groups = [];
  try { groups = await table('chat_groups'); } catch { return fallback; }
  const existing = groups.find((item) => String(item.group_id) === ARIA_REPORT_GROUP_ID);
  if (existing) return { ...fallback, ...existing, title: ARIA_REPORT_GROUP_TITLE, visibility: 'all', status: 'Active' };
  try {
    const saved = await store.insert('chat_groups', fallback);
    return { ...fallback, ...(saved || {}) };
  } catch {
    return fallback;
  }
}

async function ensureGeneralGroup() {
  const existing = await store.findById('chat_groups','group_id','team');
  if (existing) {
    // CC26_487: migrate only the old system label once. After that, preserve any
    // manager/TL rename instead of forcing the group name back on every refresh.
    const currentTitle = String(existing.title || '').trim();
    if (!currentTitle || currentTitle === 'CRM Team Chat') {
      const patch = { title: DEFAULT_GENERAL_GROUP_TITLE, visibility: 'all', status: 'Active', updated_at: nowIso() };
      try {
        const updated = await store.update('chat_groups', 'group_id', 'team', patch);
        return updated || { ...existing, ...patch };
      } catch {
        return { ...existing, ...patch };
      }
    }
    return { ...existing, visibility: 'all', status: 'Active' };
  }
  const item = { group_id: 'team', title: DEFAULT_GENERAL_GROUP_TITLE, created_by: 'system', created_by_username: 'system', status: 'Active', visibility: 'all', created_at: nowIso(), updated_at: nowIso() };
  await store.insert('chat_groups', item);
  return item;
}

async function getVisibleGroups(user) {
  let teamGroup = null;
  let ariaGroup = virtualAriaReportGroup();
  try { teamGroup = await ensureGeneralGroup(); } catch {}
  try { ariaGroup = await ensureAriaReportGroup(); } catch {}
  let groups = [];
  try { groups = (store.pool ? await store.query("select * from chat_groups where lower(coalesce(status,'active')) <> 'deleted'") : (await table('chat_groups')).filter((g) => low(g.status || 'active') !== 'deleted')); } catch {}
  if (!groups.some((g) => String(g.group_id) === 'team')) {
    groups.unshift(teamGroup || { group_id: 'team', title: DEFAULT_GENERAL_GROUP_TITLE, status: 'Active', visibility: 'all' });
  }
  if (!groups.some((g) => String(g.group_id) === ARIA_REPORT_GROUP_ID)) groups.push(ariaGroup);
  else groups = groups.map((g) => String(g.group_id) === ARIA_REPORT_GROUP_ID ? { ...ariaGroup, ...g, title: ARIA_REPORT_GROUP_TITLE, status: 'Active', visibility: 'all' } : g);
  if (isManagerLike(user) || isTl(user)) return groups;
  let members = [];
  try { members = store.pool ? await store.query('select * from chat_group_members where user_id=$1 or username=$2',[userId(user),username(user)]) : await table('chat_group_members'); } catch {}
  const uid = userId(user);
  const un = username(user);
  const allowed = new Set(['team', ARIA_REPORT_GROUP_ID]);
  for (const m of members) {
    if (!isActiveMemberRow(m)) continue;
    if (String(m.user_id || '') === uid || String(m.username || '') === un) allowed.add(String(m.group_id || ''));
  }
  return groups
    .filter((g) => allowed.has(String(g.group_id || '')) || low(g.visibility) === 'all')
    .map((g) => g);
}

async function assertCanUseThread(user, threadId) {
  const key = groupKey(threadId);
  if (key.startsWith('dm:')) return resolveDirectThread(user, key);
  const groups = await getVisibleGroups(user);
  const group = groups.find((g) => String(g.group_id) === String(key));
  return group || null;
}

async function groupMembers(groupId) {
  const rows = store.pool ? await store.query('select * from chat_group_members where group_id=$1',[String(groupId)]) : (await table('chat_group_members')).filter(m=>String(m.group_id)===String(groupId));
  return rows.filter(isActiveMemberRow);
}

async function membersPayload(viewer) {
  const users = await activeUsers();
  const allowed = new Set((await getVisibleGroups(viewer)).map(g=>String(g.group_id)));
  const groupRows = (store.pool ? await store.query('select * from chat_group_members where group_id=any($1::text[])',[[...allowed]]) : (await table('chat_group_members')).filter(m=>allowed.has(String(m.group_id)))).filter(isActiveMemberRow);
  const userById = new Map(users.map((u) => [String(u.user_id || ''), u]));
  const userByUsername = new Map(users.map((u) => [username(u), u]));
  const hydrated = [];
  const existingKeys = new Set();
  for (const m of groupRows) {
    const linked = userById.get(String(m.user_id || '')) || userByUsername.get(String(m.username || '')) || m;
    if (!canViewContact(viewer, linked)) continue;
    const row = {
      ...m,
      user_id: String(linked.user_id || m.user_id || ''),
      username: username(linked) || String(m.username || ''),
      full_name: displayName(linked),
      role: normalizeRole(linked.role || m.role || ''),
    };
    hydrated.push(row);
    existingKeys.add(`${row.group_id}|${row.user_id || row.username}`);
  }
  for (const u of users) {
    if (!canViewContact(viewer, u)) continue;
    const key = `team|${u.user_id || username(u)}`;
    if (existingKeys.has(key)) continue;
    hydrated.push({ group_id: 'team', user_id: String(u.user_id || ''), username: username(u), full_name: displayName(u), role: normalizeRole(u.role || ''), status: 'Active' });
  }
  return hydrated;
}

async function list(req, res) {
  res.set('Cache-Control', 'private, max-age=8');
  const requestedThread = groupKey(req.query?.thread_key || req.query?.thread || 'team');
  const sinceId = Math.max(0, Number(req.query?.since_id || 0) || 0);
  const fullMode = String(req.query?.full || '').trim() === '1';
  // CC26_603 tiny manual chat check. Never read groups/users/members or entire message table.
  // Only system-wide threads have implicit access; private/direct threads use the fully authorized path.
  if (store.pool && sinceId > 0 && !fullMode && ['team', ARIA_REPORT_GROUP_ID].includes(requestedThread) && String(req.query?.tiny || '') === '1') {
    const cap = 60;
    const results = requestedThread === 'team'
      ? await store.query(`select * from public.messages where coalesce(nullif(thread_key, ''), 'team') = 'team' and id > $1 order by id asc limit $2`, [sinceId, cap])
      : await store.query(`select * from public.messages where (coalesce(nullif(thread_key, ''), 'team') = $1 or (lower(coalesce(sender_username,'')) = 'aria' and coalesce(reference_type,'') = 'semi_hourly_report')) and id > $2 order by id asc limit $3`, [ARIA_REPORT_GROUP_ID, sinceId, cap]);
    const messages = results.filter((m) => visibleToUser(m, req.user)).map((m) => serializeForUser(m, req.user)).filter(Boolean);
    return res.json({ messages, latest_message_id: results.length ? Math.max(sinceId, ...results.map((m) => Number(m.id || 0))) : sinceId, compact: true, tiny: true });
  }
  const visibleGroups = await getVisibleGroups(req.user);
  const directThread = requestedThread.startsWith('dm:') ? await resolveDirectThread(req.user, requestedThread) : null;
  const selectedGroup = directThread || visibleGroups.find((g) => String(g.group_id) === requestedThread);
  if(!selectedGroup)return res.status(403).json({message:'Not allowed for this thread'});
  const threadKey = String(selectedGroup?.group_id || 'team');
  const limit = fullMode || sinceId === 0 ? Math.min(Math.max(CHAT_SELECTED_FETCH_LIMIT, 180), 600) : Math.max(Math.min(CHAT_RECENT_FETCH_LIMIT, 180), 60);
  let rawRows = [];
  let reviewItems = [];
  try {
    if (store.pool) {
      const ariaThread = threadKey === ARIA_REPORT_GROUP_ID;
      const teamThread = threadKey === 'team';
      if (sinceId > 0 && !fullMode) {
        if (ariaThread) rawRows = await store.query(
          `select * from public.messages where ((coalesce(nullif(thread_key, ''), 'team') = $1) or (lower(coalesce(sender_username,'')) = 'aria' and coalesce(reference_type,'') = 'semi_hourly_report')) and id > $2 order by id asc limit $3`,
          [ARIA_REPORT_GROUP_ID, sinceId, limit],
        );
        else if (teamThread) rawRows = await store.query(
          `select * from public.messages where coalesce(nullif(thread_key, ''), 'team') = 'team'  and id > $1 order by id asc limit $2`,
          [sinceId, limit],
        );
        else rawRows = await store.query(
          `select * from public.messages where coalesce(nullif(thread_key, ''), 'team') = $1 and id > $2 order by id asc limit $3`,
          [threadKey, sinceId, limit],
        );
      } else {
        if (ariaThread) rawRows = await store.query(
          `select * from (select * from public.messages where (coalesce(nullif(thread_key, ''), 'team') = $1) or (lower(coalesce(sender_username,'')) = 'aria' and coalesce(reference_type,'') = 'semi_hourly_report') order by created_at desc, id desc limit $2) x order by created_at asc, id asc`,
          [ARIA_REPORT_GROUP_ID, limit],
        );
        else if (teamThread) rawRows = await store.query(
          `select * from (select * from public.messages where coalesce(nullif(thread_key, ''), 'team') = 'team'  order by created_at desc, id desc limit $1) x order by created_at asc, id asc`,
          [limit],
        );
        else rawRows = await store.query(
          `select * from (select * from public.messages where coalesce(nullif(thread_key, ''), 'team') = $1 order by created_at desc, id desc limit $2) x order by created_at asc, id asc`,
          [threadKey, limit],
        );
      }
      if (canReview(req.user) && (fullMode || sinceId === 0)) reviewItems = await store.query(`select * from public.messages where coalesce(moderation_status, '') = 'review_pending' order by created_at desc limit 80`, []);
    } else {
      const allMessages = (await table('messages')).sort((a, b) => (Number(a.id || 0) - Number(b.id || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
      rawRows = allMessages.filter((m) => threadKey === ARIA_REPORT_GROUP_ID ? (groupKey(m.thread_key) === ARIA_REPORT_GROUP_ID || (low(m.sender_username) === 'aria' && String(m.reference_type || '') === 'semi_hourly_report')) : (threadKey === 'team' ? (groupKey(m.thread_key) === 'team' ) : groupKey(m.thread_key) === threadKey)).filter((m) => !sinceId || Number(m.id || 0) > sinceId).slice(-limit);
      reviewItems = canReview(req.user) && (fullMode || sinceId === 0) ? allMessages.filter((m) => low(m.moderation_status) === 'review_pending').sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 80) : [];
    }
  } catch {
    const allMessages = (await table('messages')).sort((a, b) => (Number(a.id || 0) - Number(b.id || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    rawRows = allMessages.filter((m) => threadKey === ARIA_REPORT_GROUP_ID ? (groupKey(m.thread_key) === ARIA_REPORT_GROUP_ID || (low(m.sender_username) === 'aria' && String(m.reference_type || '') === 'semi_hourly_report')) : (threadKey === 'team' ? (groupKey(m.thread_key) === 'team' ) : groupKey(m.thread_key) === threadKey)).filter((m) => !sinceId || Number(m.id || 0) > sinceId).slice(-limit);
    reviewItems = canReview(req.user) && (fullMode || sinceId === 0) ? allMessages.filter((m) => low(m.moderation_status) === 'review_pending').slice(0, 80) : [];
  }
  const rows = rawRows.filter((m) => visibleToUser(m, req.user)).map((m) => serializeForUser(m, req.user)).filter(Boolean);
  const latestMessageId = rows.length ? Math.max(...rows.map((item) => Number(item?.id || 0))) : sinceId;
  // CC26_483: incremental chat checks return only message deltas. This avoids repeatedly
  // sending groups, members, contacts and permissions on every background refresh.
  if (sinceId > 0 && !fullMode) {
    return res.json({ messages: rows, latest_message_id: latestMessageId, compact: true });
  }
  // Optional sidebar lookups must not prevent authorized chat messages from loading.
  // Run them concurrently to reduce cold-start latency; fail closed for optional contact lists.
  const [safeMembers, safeContacts] = await Promise.all([
    membersPayload(req.user).catch(() => []),
    visibleContacts(req.user).catch(() => []),
  ]);
  const payload = {
    groups: visibleGroups.sort((a, b) => (String(a.group_id) === 'team' ? -1 : String(b.group_id) === 'team' ? 1 : String(a.title || '').localeCompare(String(b.title || '')))),
    members: safeMembers,
    contacts: safeContacts,
    selected_context: selectedGroup,
    messages: rows,
    review_items: reviewItems.map((m) => serializeForUser(m, req.user)).filter(Boolean),
    latest_message_id: latestMessageId,
    permissions: {
      can_manage_groups: canManageGroups(req.user),
      can_rename_groups: canRenameGroups(req.user),
      can_review: canReview(req.user),
      can_direct_all: isManagerLike(req.user) || isTl(req.user),
      recruiter_mode: isRecruiter(req.user),
      restriction_note: 'All active coworkers can chat. Candidate and CRM data visibility is unchanged.',
    },
  };
  return res.json(payload);
}

async function createGroup(req,res){
 if(!canManageGroups(req.user))return res.status(403).json({message:'Manager access only'});
 const title=String(req.body.title||'').trim();if(!title||title.length>100)return res.status(400).json({message:'Group name must contain 1–100 characters.'});
 const selected=[...new Set([username(req.user),...splitList(req.body.members||[])])];
 const users=await activeUsers(),targets=selected.map(name=>users.find(u=>username(u).toLowerCase()===name.toLowerCase()||String(u.user_id)===name));
 if(targets.some(u=>!u))return res.status(400).json({message:'Choose active coworkers from the list.'});
 const item={group_id:'G'+require('node:crypto').randomUUID().replaceAll('-',''),title,created_by:username(req.user),created_by_username:username(req.user),status:'Active',visibility:'members',created_at:nowIso(),updated_at:nowIso()};
 await withTransaction(async()=>{
  await store.insert('chat_groups',item);
  const rows=await table('chat_group_members');let id=nextNumericId(rows,'id');
  for(const u of targets)await store.insert('chat_group_members',{id:id++,group_id:item.group_id,user_id:u.user_id,username:username(u),full_name:displayName(u),role:u.role,added_by_username:username(req.user),created_at:nowIso(),status:'Active'});
 });await refreshStreamPermissions();clearAllCaches();return res.json({item});
}

async function renameGroup(req, res) {
  if (!canRenameGroups(req.user)) return res.status(403).json({ message: 'TL can rename only. Manager can fully manage.' });
  const groupId = groupKey(req.params.groupId);
  if (groupId === ARIA_REPORT_GROUP_ID) return res.status(400).json({ message: 'ARIA Reports is a system channel and cannot be renamed.' });
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Channel title required' });
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Channel not found' });
  const item = await store.update('chat_groups', 'group_id', groupId, { title, updated_at: nowIso() });
  clearAllCaches();
  return res.json({ item });
}

async function deleteGroup(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groupId = groupKey(req.params.groupId);
  if (groupId === 'team' || groupId === ARIA_REPORT_GROUP_ID) return res.status(400).json({ message: 'System chat channels cannot be deleted' });
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Channel not found' });
  await store.update('chat_groups', 'group_id', groupId, { status: 'Deleted', deleted_by_username: username(req.user), deleted_at: nowIso(), updated_at: nowIso() });
  await refreshStreamPermissions();
  clearAllCaches();
  return res.json({ ok: true });
}

async function addMembers(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groupId = groupKey(req.params.groupId);
  if (groupId === ARIA_REPORT_GROUP_ID) return res.status(400).json({ message: 'ARIA Reports automatically includes all users.' });
  const existing = await store.findById('chat_groups', 'group_id', groupId);
  if (!existing) return res.status(404).json({ message: 'Channel not found' });
  const input = splitList(req.body.members || req.body.usernames || req.body.username || req.body.user_id || '');
  if (!input.length) return res.status(400).json({ message: 'Member username/user id required' });
  const users = await activeUsers();
  const oldMembers = await table('chat_group_members');
  const activeOldMembers = oldMembers.filter(isActiveMemberRow);
  const existingKeys = new Set(activeOldMembers.map(memberKey));
  if(input.some(raw=>!users.some(x=>username(x).toLowerCase()===raw.toLowerCase()||String(x.user_id||'')===raw||String(x.recruiter_code||'')===raw)))return res.status(400).json({message:'Select an active coworker.'});
  const added = [];
  for (const raw of input) {
    const u = users.find((x) => username(x).toLowerCase() === raw.toLowerCase() || String(x.user_id || '') === raw || String(x.recruiter_code || '') === raw) || { username: raw, user_id: raw, full_name: raw, role: '' };
    const row = { id: nextNumericId([...oldMembers, ...added], 'id'), group_id: groupId, user_id: String(u.user_id || raw), username: String(u.username || raw), full_name: displayName(u), role: String(u.role || ''), added_by_username: username(req.user), created_at: nowIso(), status: 'Active' };
    if (existingKeys.has(memberKey(row))) continue;
    await store.insert('chat_group_members', row);
    existingKeys.add(memberKey(row));
    added.push(row);
  }
  await refreshStreamPermissions();
  clearAllCaches();
  return res.json({ ok: true, added });
}

async function removeMember(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groupId = groupKey(req.params.groupId);
  if (groupId === ARIA_REPORT_GROUP_ID) return res.status(400).json({ message: 'ARIA Reports automatically includes all users.' });
  const target = String(req.body.username || req.body.user_id || req.params.memberKey || '').trim();
  if (!target) return res.status(400).json({ message: 'Member required' });
  const members = await groupMembers(groupId);
  const hit = members.find((m) => String(m.username || '') === target || String(m.user_id || '') === target || String(m.id || '') === target);
  if (!hit) return res.status(404).json({ message: 'Member not found' });
  const softRemove = { status: 'Removed', removed_at: nowIso(), deleted_at: nowIso(), removed_by_username: username(req.user), updated_at: nowIso() };
  if (hit.id) await store.update('chat_group_members', 'id', hit.id, softRemove);
  else {
    const allMembers = await table('chat_group_members');
    const candidates = allMembers.filter((m) => String(m.group_id || '') === groupId && isActiveMemberRow(m) && String(m.username || '') === String(hit.username || target));
    for (const row of candidates) await store.update('chat_group_members', 'id', row.id, softRemove);
  }
  await refreshStreamPermissions();
  clearAllCaches();
  return res.json({ ok: true });
}

async function sendMessage(req, res) {
  await ensureGeneralGroup();
  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ message: 'Message body required' });
  const threadKey = groupKey(req.body.thread_key || 'team');
  if (threadKey === ARIA_REPORT_GROUP_ID && low(req.user?.username) !== 'aria') return res.status(403).json({ message: 'ARIA Reports is an automatic report feed.' });
  const thread = await assertCanUseThread(req.user, threadKey);
  if (!thread) return res.status(403).json({ message: 'This chat is not allowed for your role' });
  const clientKey = String(req.body.client_message_key || '').slice(0,128);
  const review = detectReview(body);
  const isDirect = String(thread.group_id || threadKey).startsWith('dm:');
  const recipient = isDirect ? thread.other : null;
  const item = {
    client_message_key:clientKey,
    sender_username: username(req.user),
    sender_name: req.user.full_name || username(req.user),
    sender_role: normalizeRole(req.user.role || ''),
    recipient_username: recipient?.username || '',
    body,
    original_body: body,
    message: body,
    message_text: body,
    content: body,
    created_at: nowIso(),
    updated_at: nowIso(),
    thread_key: String(thread.group_id || threadKey),
    thread_type: isDirect ? 'direct' : 'group',
    chat_type: isDirect ? 'direct_chat' : 'team_group',
    reference_type: req.body.reply_to_id ? 'message' : '',
    reference_id: req.body.reply_to_id ? String(req.body.reply_to_id) : '',
    mention_usernames: review ? '__review_pending__' : '',
    delete_mode: '',
    deleted_by_username: '',
    deleted_at: '',
    status: review ? 'Review Pending' : 'sent',
    moderation_status: review ? 'review_pending' : 'approved',
    moderation_reason: review ? review.reason : '',
    moderation_word: review ? review.word : '',
    reviewed_by_username: '',
    reviewed_at: '',
    review_decision_note: '',
  };
  if (!store.pool) {
    const messages = await table('messages');
    item.id = nextNumericId(messages, 'id');
  }
  let finalItem;
  try {
    finalItem = await withTransaction(async () => {
      if (clientKey && store.pool) {
        await store.query('select pg_advisory_xact_lock(hashtext($1))',[username(req.user)+':chat:'+clientKey]);
        const prior=await store.one('select * from messages where sender_username=$1 and client_message_key=$2',[username(req.user),clientKey]);
        if (prior) {
          if (prior.body!==body || prior.thread_key!==threadKey) { const error=new Error('Message key already used');error.status=409;throw error; }
          return prior;
        }
      }
      if(clientKey&&!store.pool){const prior=(await table('messages')).find(m=>m.sender_username===username(req.user)&&m.client_message_key===clientKey);if(prior){if(prior.body!==body||prior.thread_key!==threadKey)throw Object.assign(new Error('Message key already used'),{status:409});return prior;}item.id=nextNumericId(await table('messages'),'id');}
      const saved=await store.insert('messages',item);
      const result={...item,...saved};
      await store.insert('chat_notification_jobs',{ job_id:'CHAT:'+result.id,message_id:result.id,
        payload_json:JSON.stringify({ actor:{user_id:userId(req.user),username:username(req.user),full_name:req.user.full_name,role:req.user.role},thread,threadKey,recipient,isDirect,review,finalItem:{id:result.id} }),
        status:'Pending',attempts:0,created_at:nowIso(),updated_at:nowIso(),last_error:'' });
      return result;
    });
  } catch (error) { if(error.status===409)return res.status(409).json({message:error.message});throw error; }
  if(!req.cc790DeferDelivery)publishToStreams(finalItem);
  clearAllCaches();
  const receipt=res.json({ item:serializeForUser(finalItem,req.user),review_pending:!!review });
  if(!req.cc790DeferDelivery)setImmediate(() => { drainChatNotifications().catch(error=>console.error('Chat notification queue retained:',error.code||error.message)); });
  return receipt;
}

async function deliverNotificationJob(job) { return withTransaction(()=>deliverNotificationInTransaction(job)); }
async function deliverNotificationInTransaction(job) {
  const {actor,thread,threadKey,recipient,isDirect,review,finalItem}=JSON.parse(job.payload_json);
  const users = await activeUsers();
  const openPath = `/chat?thread=${encodeURIComponent(String(thread.group_id || threadKey))}`;
  let recipients = [];
  if (review) {
    recipients = users.filter((u) => canReview(u));
  } else if (isDirect && recipient) {
    recipients = users.filter((u) => String(u.user_id || '') === String(recipient.user_id || '') || username(u) === recipient.username);
  } else {
    const groupRows = await groupMembers(String(thread.group_id || threadKey));
    if (groupRows.length) {
      const ids = new Set(groupRows.map((m) => String(m.user_id || '')).filter(Boolean));
      const usernames = new Set(groupRows.map((m) => String(m.username || '')).filter(Boolean));
      recipients = users.filter((u) => ids.has(String(u.user_id || '')) || usernames.has(username(u)));
    } else {
      recipients = low(thread.visibility)==='all' || threadKey==='team' ? users : [];
    }
  }
  const targets = recipients.filter(u=>!sameUser(u,actor)&&u.user_id);
  if(store.pool&&targets.length)await store.query("select pg_advisory_xact_lock(hashtext('chat-read:'||u||':'||$2)) from unnest($1::text[]) u order by u",[targets.map(userId).sort(),String(thread.group_id||threadKey)]);
  const reads=store.pool?await store.query('select user_id,last_read_id from public.chat_thread_read_state where thread_key=$1 and user_id=any($2::text[])',[String(thread.group_id||threadKey),targets.map(userId)]):(await table('chat_thread_read_state')).filter(r=>String(r.thread_key)===String(thread.group_id||threadKey));
  const readByUser=new Map(reads.map(r=>[String(r.user_id),Number(r.last_read_id)||0]));
  const offline=targets.filter(u=>(readByUser.get(userId(u))||0)<Number(finalItem.id));
  const noticeTitle = review ? 'Chat message needs review' : (isDirect ? 'New direct message' : 'New CRM Team Chat message');
  const noticeText = review ? `${actor.full_name || username(actor)} message went to review.` : `${actor.full_name || username(actor)} sent a message in ${thread.title || 'CRM Team Chat'}.`;
  const noticeMeta = JSON.stringify({ thread_key: String(thread.group_id || threadKey), open_path: openPath, message_id: finalItem.id || '' });
  let batchSaved = false,noticeRows=[];
  if (store.pool && offline.length > 0) {
      noticeRows=await store.query(`insert into public.notifications (notification_id, user_id, title, message, category, status, metadata, created_at)
        select 'CHAT:' || $6 || ':' || target.user_id, target.user_id, $2, $3, 'chat', 'Unread', $4, $5
        from (select distinct unnest($1::text[]) as user_id) target
        where exists (select 1 from public.messages where id=$6::bigint)
        and not exists(select 1 from public.chat_thread_read_state r where r.user_id=target.user_id and r.thread_key=$7 and r.last_read_id >= $6::bigint)
        on conflict (notification_id) do nothing returning *`,
        [offline.map((u) => String(u.user_id)), noticeTitle, noticeText, noticeMeta, nowIso(), String(finalItem.id),String(thread.group_id||threadKey)]);
      batchSaved = true;
  }
  if (!batchSaved) for (const u of offline) {
    if (!await store.findById('messages','id',finalItem.id)) break;
    const notificationId=`CHAT:${finalItem.id}:${u.user_id}`;
    if (!await store.findById('notifications','notification_id',notificationId)) noticeRows.push(await store.insert('notifications', { notification_id:notificationId,user_id:u.user_id,title:noticeTitle,message:noticeText,category:'chat',status:'Unread',metadata:noticeMeta,created_at:nowIso() }));
  }
  await require('../lib/store').afterCommit(()=>{clearAllCaches(['approvals']);for(const item of noticeRows)require('../lib/approvalLive').publishToUsers([item.user_id],'notification',{item});});
}
let notificationDrain=null;
function drainChatNotifications() {
  const quiet=require('../lib/recentHumanActivity');if(quiet.nightDormant())return Promise.resolve(quiet.deferUntilUse('chat-notifications',drainChatNotifications));
  if (notificationDrain) return notificationDrain;
  notificationDrain=(async()=>{
    const abandonedAt=new Date(Date.now()-5*60*1000).toISOString();
    const jobs=await withTransaction(async()=>{
      const rows=store.pool ? await store.query("select * from chat_notification_jobs where status='Pending' or (status='Processing' and updated_at<$1) order by created_at asc limit 100 for update skip locked",[abandonedAt]) : (await table('chat_notification_jobs')).filter(j=>j.status==='Pending'||(j.status==='Processing'&&j.updated_at<abandonedAt)).slice(0,100);
      for (const job of rows) await store.update('chat_notification_jobs','job_id',job.job_id,{status:'Processing',attempts:Number(job.attempts||0)+1,updated_at:nowIso()});
      return rows;
    });
    let failed=false;
    for (const job of jobs) {
      try { await deliverNotificationJob(job);await store.update('chat_notification_jobs','job_id',job.job_id,{status:'Done',payload_json:'{}',updated_at:nowIso(),last_error:''}); }
      catch(error){failed=true;await store.update('chat_notification_jobs','job_id',job.job_id,{status:'Pending',updated_at:nowIso(),last_error:String(error.code||'NOTIFICATION_UNAVAILABLE')});}
    }
    if (jobs.length===100&&!failed) setImmediate(()=>{drainChatNotifications().catch(()=>{});});
    return jobs.length;
  })().finally(()=>{notificationDrain=null});
  return notificationDrain;
}
module.exports.drainChatNotifications=drainChatNotifications;

async function editMessage(req, res) {
  const messageId = String(req.params.messageId || '').trim();
  const body = String(req.body.body || '').trim();
  if (!messageId || !body) return res.status(400).json({ message: 'Message id and body required' });
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  if (String(existing.sender_username) !== username(req.user) && !isManagerLike(req.user)) return res.status(403).json({ message: 'You can edit only your own messages' });
  const thread = await assertCanUseThread(req.user, existing.thread_key || 'team');
  if (!thread) return res.status(403).json({ message: 'This chat is not allowed for your role' });
  const review = detectReview(body);
  const item = await store.update('messages', 'id', messageId, { body, original_body: body, message: body, message_text: body, content: body, updated_at: nowIso(), mention_usernames: joinFlags([...flags(existing.mention_usernames), '__edited__', review ? '__review_pending__' : '']), moderation_status: review ? 'review_pending' : 'approved', moderation_reason: review ? review.reason : '', moderation_word: review ? review.word : '', status: review ? 'Review Pending' : 'sent' });
  publishToStreams(item);
  clearAllCaches();
  return res.json({ item: serializeForUser(item, req.user) });
}

async function deleteMessage(req, res) {
  const messageId = String(req.params.messageId || '').trim();
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  const mine = String(existing.sender_username) === username(req.user);
  if (!mine && !isManagerLike(req.user)) return res.status(403).json({ message: 'You can delete only your own messages' });
  const thread = await assertCanUseThread(req.user, existing.thread_key || 'team');
  if (!thread) return res.status(403).json({ message: 'This chat is not allowed for your role' });
  const item = await store.update('messages', 'id', messageId, { delete_mode: isManagerLike(req.user) ? 'hard' : 'soft_manager_audit', deleted_by_username: username(req.user), deleted_at: nowIso(), original_body: existing.original_body || existing.body || '', body: isManagerLike(req.user) ? '' : 'This message was deleted for everyone', updated_at: nowIso() });
  publishToStreams(item);
  clearAllCaches();
  return res.json({ ok: true, item: serializeForUser(item, req.user) });
}

async function reviewMessage(req, res) {
  if (!canReview(req.user)) return res.status(403).json({ message: 'TL/Manager review access only' });
  const messageId = String(req.params.messageId || '').trim();
  const decision = low(req.body.decision || req.body.status || 'approve');
  const existing = await store.findById('messages', 'id', messageId);
  if (!existing) return res.status(404).json({ message: 'Message not found' });
  if (!await assertCanUseThread(req.user, existing.thread_key || 'team')) return res.status(403).json({ message:'Not allowed for this thread' });
  const approved = decision.startsWith('approve');
  const item = await store.update('messages', 'id', messageId, { moderation_status: approved ? 'approved' : 'rejected', status: approved ? 'sent' : 'Rejected', reviewed_by_username: username(req.user), reviewed_at: nowIso(), review_decision_note: String(req.body.note || '').slice(0, 250), body: approved ? (existing.original_body || existing.body || '') : 'Message rejected after review', updated_at: nowIso() });
  publishToStreams(item);
  clearAllCaches();
  return res.json({ ok: true, item: serializeForUser(item, req.user) });
}

module.exports = { drainChatNotifications, list, stream, createGroup, renameGroup, deleteGroup, addMembers, removeMember, sendMessage, editMessage, deleteMessage, reviewMessage, publishAriaReportMessage };

async function delta(req,res) {
 const key=groupKey(req.query.thread_key);
 if (!await assertCanUseThread(req.user,key)) return res.status(403).json({message:'Not allowed for this thread'});
 let rows;
 // Reconnect must include edits and deletion tombstones for existing IDs.
 // The bounded snapshot is requested on reconnect/focus, never on a new timer.
 if (store.pool) rows=await store.query('select * from (select * from messages where thread_key=$1 order by id desc limit 100) recent order by id asc',[key]);
 else rows=(await table('messages')).filter(m=>groupKey(m.thread_key)===key).slice(-100);
 return res.json({messages:rows.map(m=> {
   if (low(m.delete_mode)==='hard' || (low(m.delete_mode)==='soft_manager_audit' && !isManagerLike(req.user))) return {id:m.id,thread_key:key,deleted:true,deleted_at:m.deleted_at,updated_at:m.updated_at};
   return visibleToUser(m,req.user) ? serializeForUser(m,req.user) : null;
 }).filter(Boolean)});
}
async function readThread(req,res) {
 const key=groupKey(req.body.thread_key); if (!await assertCanUseThread(req.user,key)) return res.status(403).json({message:'Not allowed for this thread'});
 if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['chat-read:'+userId(req.user)+':'+key]);
 const max=store.pool ? Number(await store.scalar('select coalesce(max(id),0) as value from messages where thread_key=$1',[key])) : Math.max(0,...(await table('messages')).filter(m=>groupKey(m.thread_key)===key).map(m=>Number(m.id)||0));
 const id=Math.max(0,Math.min(max,Number(req.body.last_read_id)||0)); const stateId=`${userId(req.user)}:${key}`;
 if (store.pool) await store.query(`insert into chat_thread_read_state(state_id,user_id,thread_key,last_read_id,updated_at) values($1,$2,$3,$4,$5) on conflict(state_id) do update set last_read_id=greatest(chat_thread_read_state.last_read_id,excluded.last_read_id),updated_at=excluded.updated_at`,[stateId,userId(req.user),key,id,nowIso()]);
 else { const old=await store.findById('chat_thread_read_state','state_id',stateId); await store.upsert('chat_thread_read_state','state_id',{state_id:stateId,user_id:userId(req.user),thread_key:key,last_read_id:Math.max(Number(old?.last_read_id)||0,id),updated_at:nowIso()}); }
 let changed=[];
 if(store.pool)changed=await store.query(`update public.notifications set status='Read' where user_id=$1 and category='chat' and lower(coalesce(status,''))='unread' and notification_id in (select 'CHAT:'||m.id||':'||$1 from public.messages m where m.thread_key=$2 and m.id <= $3) returning notification_id`,[userId(req.user),key,id]);
 else for(const n of await table('notifications')){let meta={};try{meta=JSON.parse(n.metadata||'{}')}catch{}if(String(n.user_id)===userId(req.user)&&n.category==='chat'&&low(n.status)==='unread'&&meta.thread_key===key&&Number(meta.message_id)<=id){await store.update('notifications','notification_id',n.notification_id,{status:'Read'});changed.push(n);}}
 await require('../lib/store').afterCommit(()=>{clearAllCaches(['approvals']);require('../lib/approvalLive').publishToUsers([userId(req.user)],'chat-read',{thread_key:key,last_read_id:id,read_count:changed.length});});
 return res.json({ok:true,last_read_id:id,read_count:changed.length});
}
async function inbox(req,res) {
 const groups=await getVisibleGroups(req.user); let keys=groups.map(g=>String(g.group_id));
 if(!store.pool){
  const states=(await table('chat_thread_read_state')).filter(r=>String(r.user_id)===String(userId(req.user))),byKey=new Map(states.map(r=>[String(r.thread_key),Number(r.last_read_id)||0]));
  const messages=(await table('messages')).filter(m=>visibleToUser(m,req.user)&&(!String(m.thread_key||'').startsWith('dm:')||m.sender_username===username(req.user)||m.recipient_username===username(req.user)));
  const dmKeys=messages.filter(m=>String(m.thread_key||'').startsWith('dm:')).map(m=>String(m.thread_key));keys=[...new Set([...keys,...dmKeys])].slice(0,100);
  const rows=keys.map(thread_key=>{const ms=messages.filter(m=>groupKey(m.thread_key)===thread_key&&low(m.delete_mode)!=='hard');if(!ms.length)return null;return{thread_key,last_read_id:Number(byKey.get(thread_key)||0),latest_message_id:Math.max(0,...ms.map(m=>Number(m.id)||0)),last_message_at:ms.map(m=>String(m.created_at||'')).sort().at(-1),unread_count:ms.filter(m=>Number(m.id)>Number(byKey.get(thread_key)||0)&&m.sender_username!==username(req.user)&&!m.deleted_at).length};}).filter(Boolean).sort((a,b)=>String(b.last_message_at).localeCompare(String(a.last_message_at)));
  return res.json({items:rows,latest_unread:req.query?.preview==='1'?messages.filter(m=>keys.includes(groupKey(m.thread_key))&&Number(m.id)>(byKey.get(groupKey(m.thread_key))||0)&&m.sender_username!==username(req.user)&&!m.deleted_at).sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,1).map(m=>serializeForUser(m,req.user)):[]});
 }
 const dm=await store.query(`select distinct thread_key from messages where thread_key like 'dm:%' and (sender_username=$1 or recipient_username=$1) limit 60`,[username(req.user)]);
 keys=[...new Set([...keys,...dm.map(d=>d.thread_key)])].slice(0,100);
 const rows=await store.query(`select m.thread_key,max(m.id) as latest_message_id,coalesce(max(r.last_read_id),0) as last_read_id,max(m.created_at) as last_message_at,count(*) filter(where m.id>coalesce(r.last_read_id,0) and m.sender_username<>$2 and coalesce(m.deleted_at,'')='')::int as unread_count from messages m left join chat_thread_read_state r on r.thread_key=m.thread_key and r.user_id=$1 where m.thread_key=any($3::text[]) and coalesce(m.delete_mode,'')<>'hard' and (coalesce(m.delete_mode,'')<>'soft_manager_audit' or $4::boolean) and (coalesce(m.moderation_status,'approved') not in ('review_pending','rejected') or m.sender_username=$2 or m.recipient_username=$2 or $5::boolean) group by m.thread_key order by max(m.created_at) desc limit 100`,[userId(req.user),username(req.user),keys,isManagerLike(req.user),canReview(req.user)]);
 let latest=[];
 if(req.query?.preview==='1')latest=await store.query(`select m.id,m.sender_username,m.sender_name,m.body,m.thread_key,m.created_at,m.reference_type,m.reference_id from public.messages m left join public.chat_thread_read_state r on r.thread_key=m.thread_key and r.user_id=$1 where m.thread_key=any($3::text[]) and m.id>coalesce(r.last_read_id,0) and m.sender_username<>$2 and coalesce(m.deleted_at,'')='' and coalesce(m.delete_mode,'') not in ('hard','soft_manager_audit') and coalesce(m.moderation_status,'approved')='approved' order by m.id desc limit 1`,[userId(req.user),username(req.user),keys]);
 return res.json({items:rows,latest_unread:latest});
}
async function refreshStreamPermissions() {
 const byUser=new Map();
 for (const entry of chatStreams.values()) { const key=userId(entry.user);if(!byUser.has(key)) byUser.set(key,getVisibleGroups(entry.user)); }
 for (const entry of chatStreams.values()) entry.allowedGroups=new Set((await byUser.get(userId(entry.user))).map(g=>String(g.group_id)));
}
module.exports.delta=delta;module.exports.readThread=readThread;module.exports.inbox=inbox;

// One manual broadcast command; direct-message permissions and durable receipt apply.
async function broadcast(req,res){
 const recipients=[...new Set((Array.isArray(req.body.recipients)?req.body.recipients:[]).map(x=>String(x).trim()).filter(Boolean))].sort();
 const body=String(req.body.body||'').trim(),key=String(req.body.command_id||'');
 if(!body||body.length>4000||!recipients.length||recipients.length>50||!/^[a-zA-Z0-9_-]{16,128}$/.test(key))return res.status(400).json({message:'Choose 1–50 coworkers, enter a message and retry.'});
 const users=await activeUsers(),targets=recipients.map(name=>users.find(u=>username(u)===name));
 if(targets.some(u=>!u||sameUser(u,req.user)||!canDirectMessage(req.user,u)))return res.status(403).json({message:'A selected recipient is not available for your account.'});
 const {callController}=require('../lib/store'),crypto=require('node:crypto');
 const receiptId='broadcast:'+userId(req.user)+':'+key,signature=crypto.createHash('sha256').update(JSON.stringify({recipients,body})).digest('hex');
 const result=await withTransaction(async()=>{
  if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',[receiptId]);
  const old=await store.findById('crm_command_receipts','command_id',receiptId);
  if(old){if(old.payload_hash!==signature){const e=new Error('Broadcast command already used.');e.status=409;throw e;}return {...JSON.parse(old.receipt_json),replayed:true};}
  const messages=[];for(const target of targets){const receipt=await callController(sendMessage,{...req,cc790DeferDelivery:true,body:{thread_key:directThreadKeyFor(req.user,target),body,client_message_key:key+'_'+userId(target)}});messages.push(receipt.item);}
  const out={ok:true,sent_count:targets.length,message_ids:messages.map(m=>m.id)};
  await store.insert('crm_command_receipts',{command_id:receiptId,user_id:userId(req.user),candidate_id:'',payload_hash:signature,receipt_json:JSON.stringify(out),created_at:nowIso()});return out;
 });if(!result.replayed){for(const id of result.message_ids){const m=await store.findById('messages','id',id);if(m)publishToStreams(m);}setImmediate(()=>drainChatNotifications().catch(e=>console.error('Chat queue retained:',e.code||e.message)));}return res.json({ok:true,sent_count:result.sent_count,replayed:!!result.replayed});
}
module.exports.broadcast=broadcast;

async function resetHistory(req,res){
 if(String(req.user?.role||'').toLowerCase()!=='manager')return res.status(403).json({message:'Only a manager can reset chat history.'});
 if(req.body?.confirm!=='RESET')return res.status(400).json({message:'Confirm the reset before continuing.'});
 const employeeId=String(req.body?.user_id||'').trim(),thread=String(req.body?.thread_key||'').trim();
 if(!employeeId&&!thread)return res.status(400).json({message:'Choose a conversation or employee.'});
 const target=employeeId?await store.findById('users','user_id',employeeId):null;
 if(employeeId&&!target)return res.status(404).json({message:'Employee not found.'});
 if(!employeeId){
   if(thread.startsWith('dm:')){
     const tokens=parseDirectThreadKey(thread),users=await activeUsers();
     if(tokens.length!==2||tokens.some(token=>!users.some(u=>matchesUserToken(u,token))))return res.status(404).json({message:'Conversation not found.'});
   }else if(!await assertCanUseThread(req.user,thread))return res.status(404).json({message:'Conversation not found.'});
 }
 const stamp=nowIso();
 const result=await withTransaction(async()=>{
   const matches=m=>employeeId?(String(m.sender_username)===username(target)||String(m.recipient_username)===username(target)||[m.sender_user_id,m.recipient_user_id,m.user_id].some(id=>id&&String(id)===employeeId)||parseDirectThreadKey(m.thread_key||m.thread_id).some(t=>matchesUserToken(target,t))):groupKey(m.thread_key||m.thread_id||'team')===thread;
   let changed=[];
   let legacy=[];
   if(store.pool){
     const deleteParams=employeeId?[username(target),cleanId(userId(target))]:[thread];
     const deleteWhere=employeeId?"(sender_username=$1 or recipient_username=$1 or (thread_key like 'dm:%' and $2=any(string_to_array(substring(thread_key from 4),'__'))))":"coalesce(nullif(thread_key,''),'team')=$1";
     changed=await store.query(`delete from messages where ${deleteWhere} returning id,thread_key`,deleteParams);
     // Legacy chat records can survive a migration; clear the same employee scope there too.
     const oldExists=await store.one("select to_regclass('public.team_chat_messages') as name");
     if(oldExists?.name){
       const legacyWhere=employeeId?"(sender_username=$1 or to_jsonb(m)->>'recipient_username'=$1 or to_jsonb(m)->>'sender_user_id'=$2 or to_jsonb(m)->>'recipient_user_id'=$2 or (thread_id like 'dm:%' and $2=any(string_to_array(substring(thread_id from 4),'__'))))":"coalesce(nullif(thread_id,''),'team')=$1";
       legacy=await store.query(`delete from public.team_chat_messages m where ${legacyWhere} returning message_id as id,thread_id as thread_key`,deleteParams);
     }
   }else{
     changed=(await table('messages')).filter(matches);
     legacy=(await table('team_chat_messages')).filter(matches).map(m=>({...m,id:m.message_id,thread_key:m.thread_id}));
     store.state.messages=store.state.messages.filter(m=>!matches(m));store.save();
     store.state.team_chat_messages=(store.state.team_chat_messages||[]).filter(m=>!matches(m));store.save();
   }
   const threads=[...new Set([...changed,...legacy].map(m=>groupKey(m.thread_key||'team')))];
   if(store.pool&&threads.length){
     await store.query("delete from chat_notification_jobs where message_id=any($1::bigint[])",[changed.map(m=>String(m.id))]);
     const ids=changed.map(m=>String(m.id)).filter(id=>/^\d+$/.test(id));
     const noticePattern=ids.length?'"message_id"[[:space:]]*:[[:space:]]*"?('+ids.join('|')+')("|[},[:space:]]|$)':'^$';
     await store.query("delete from notifications where category='chat' and (metadata ~ $1 or ($2<>'' and user_id=$2))",[noticePattern,employeeId]);
   }
   if(!store.pool&&changed.length){
     const ids=new Set(changed.map(m=>String(m.id)));
     store.state.chat_notification_jobs=(store.state.chat_notification_jobs||[]).filter(job=>!ids.has(String(job.message_id)));
     store.state.notifications=(store.state.notifications||[]).filter(notice=>{if(notice.category!=='chat')return true;try{return !ids.has(String(JSON.parse(notice.metadata||'{}').message_id));}catch{return true;}});
     store.save();
   }
   return {ok:true,reset_count:changed.length+legacy.length,thread_keys:threads,user_id:employeeId};
 });
 clearAllCaches(['chat']);
 const users=await activeUsers();
 require('../lib/approvalLive').publishToUsers(users.map(userId),'workspace-change',{source:'/chat',reset:true,thread_keys:result.thread_keys,user_id:employeeId,at:stamp});
 return res.json(result);
}
module.exports.resetHistory=resetHistory;

async function resetEmployees(req,res){
 if(String(req.user?.role||'').toLowerCase()!=='manager')return res.status(403).json({message:'Manager access only.'});
 const rows=store.pool?await store.query('select user_id,username,full_name,role,is_active from public.users order by full_name'):await table('users');
 return res.json({items:rows.map(u=>({user_id:u.user_id,full_name:u.full_name||u.username,role:u.role,is_active:u.is_active}))});
}
module.exports.resetEmployees=resetEmployees;

module.exports.directory=async function(req,res){
 if(req.query.fresh==='1')staffRosterCache.clear();
 const [contacts,groups]=await Promise.all([visibleContacts(req.user),getVisibleGroups(req.user)]);
 res.set('Cache-Control','no-store');return res.json({contacts,groups});
};
