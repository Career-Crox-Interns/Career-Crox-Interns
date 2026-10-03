const { store, table } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');

const CHAT_RECENT_FETCH_LIMIT = Number(process.env.CHAT_RECENT_FETCH_LIMIT || 90);
const CHAT_SELECTED_FETCH_LIMIT = Number(process.env.CHAT_SELECTED_FETCH_LIMIT || 260);
const DEFAULT_GENERAL_GROUP_TITLE = 'Team Aaryansh';
const ARIA_REPORT_GROUP_ID = 'aria-reports';
const ARIA_REPORT_GROUP_TITLE = 'ARIA Reports';
const ARIA_CONTACT = { user_id: 'ARIA', username: 'aria', full_name: 'ARIA', role: 'assistant', designation: '30-Minute Report Assistant', recruiter_code: 'ARIA', can_chat: true, is_self: false, is_bot: true, system_thread: ARIA_REPORT_GROUP_ID };
const chatStreams = new Map();

function streamKey(user, threadKey) { return `${userId(user) || username(user)}|${groupKey(threadKey)}`; }
function streamUserOnline(target, threadKey) {
  const key = groupKey(threadKey);
  for (const entry of chatStreams.values()) {
    if (!sameUser(entry.user, target)) continue;
    if (entry.threadKey === key) return true;
    if (entry.threadKey === '*' && (key === 'team' || key.startsWith('dm:'))) return true;
  }
  return false;
}
function wildcardStreamCanReceive(message, user) {
  const key = groupKey(message?.thread_key || 'team');
  if (key === 'team') return true;
  if (key.startsWith('dm:')) {
    const viewer = username(user);
    return Boolean(viewer && (String(message.sender_username || '') === viewer || String(message.recipient_username || '') === viewer || (low(message.moderation_status).includes('review') && canReview(user))));
  }
  // Restricted/custom groups keep using their exact-thread SSE. Do not leak them into the global preview stream.
  return false;
}
function publishToStreams(message) {
  const key = groupKey(message?.thread_key || 'team');
  for (const [id, entry] of [...chatStreams.entries()]) {
    if (entry.threadKey !== '*' && entry.threadKey !== key && !(entry.threadKey === ARIA_REPORT_GROUP_ID && low(message?.sender_username) === 'aria' && message?.reference_type === 'semi_hourly_report')) continue;
    try {
      if (entry.threadKey === '*' && !wildcardStreamCanReceive(message, entry.user)) continue;
      if (!visibleToUser(message, entry.user)) continue;
      const item = serializeForUser(message, entry.user);
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
      const users = await store.query('select user_id, username, full_name, role, designation, recruiter_code, is_active from public.users limit 500', []);
      return users.filter(looksActive);
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
  const threadKey = globalStream ? '*' : String(thread.group_id || requestedThread);
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const key = streamKey(req.user, threadKey);
  const previous = chatStreams.get(key);
  if (previous?.res && previous.res !== res) { try { previous.res.end(); } catch {} }
  const entry = { res, user: { ...req.user }, threadKey };
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
  const groups = await table('chat_groups');
  const existing = groups.find((item) => String(item.group_id) === 'team');
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
  try { groups = (await table('chat_groups')).filter((g) => low(g.status || 'active') !== 'deleted'); } catch {}
  if (!groups.some((g) => String(g.group_id) === 'team')) {
    groups.unshift(teamGroup || { group_id: 'team', title: DEFAULT_GENERAL_GROUP_TITLE, status: 'Active', visibility: 'all' });
  }
  if (!groups.some((g) => String(g.group_id) === ARIA_REPORT_GROUP_ID)) groups.push(ariaGroup);
  else groups = groups.map((g) => String(g.group_id) === ARIA_REPORT_GROUP_ID ? { ...ariaGroup, ...g, title: ARIA_REPORT_GROUP_TITLE, status: 'Active', visibility: 'all' } : g);
  if (isManagerLike(user) || isTl(user)) return groups;
  let members = [];
  try { members = await table('chat_group_members'); } catch {}
  const uid = userId(user);
  const un = username(user);
  const allowed = new Set(['team', ARIA_REPORT_GROUP_ID]);
  for (const m of members) {
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
  return (await table('chat_group_members')).filter((m) => String(m.group_id) === String(groupId) && isActiveMemberRow(m));
}

async function membersPayload(viewer) {
  const users = await activeUsers();
  const groupRows = (await table('chat_group_members')).filter(isActiveMemberRow);
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
  const selectedGroup = directThread || visibleGroups.find((g) => String(g.group_id) === requestedThread) || visibleGroups.find((g) => String(g.group_id) === 'team');
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

async function createGroup(req, res) {
  if (!canManageGroups(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const groups = await table('chat_groups');
  const title = String(req.body.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Channel title required' });
  const item = { group_id: nextId('G', groups.filter((g) => String(g.group_id) !== 'team'), 'group_id'), title, created_by: username(req.user), created_by_username: username(req.user), status: 'Active', visibility: 'members', created_at: nowIso(), updated_at: nowIso() };
  await store.insert('chat_groups', item);
  clearAllCaches();
  return res.json({ item });
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
  const added = [];
  for (const raw of input) {
    const u = users.find((x) => username(x).toLowerCase() === raw.toLowerCase() || String(x.user_id || '') === raw || String(x.recruiter_code || '') === raw) || { username: raw, user_id: raw, full_name: raw, role: '' };
    const row = { id: nextNumericId([...oldMembers, ...added], 'id'), group_id: groupId, user_id: String(u.user_id || raw), username: String(u.username || raw), full_name: displayName(u), role: String(u.role || ''), added_by_username: username(req.user), created_at: nowIso(), status: 'Active' };
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
  const review = detectReview(body);
  const isDirect = String(thread.group_id || threadKey).startsWith('dm:');
  const recipient = isDirect ? thread.other : null;
  const item = {
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
  const saved = await store.insert('messages', item);
  const finalItem = { ...item, ...(saved || {}) };
  publishToStreams(finalItem);
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
      recipients = users;
    }
  }
  const offline = recipients.filter((u) => !sameUser(u, req.user) && !streamUserOnline(u, String(thread.group_id || threadKey)) && u.user_id);
  const noticeTitle = review ? 'Chat message needs review' : (isDirect ? 'New direct message' : 'New CRM Team Chat message');
  const noticeText = review ? `${req.user.full_name || username(req.user)} message went to review.` : `${req.user.full_name || username(req.user)} sent a message in ${thread.title || 'CRM Team Chat'}.`;
  const noticeMeta = JSON.stringify({ thread_key: String(thread.group_id || threadKey), open_path: openPath, message_id: finalItem.id || '' });
  let batchSaved = false;
  if (store.pool && offline.length > 1) {
    try {
      await store.query(`insert into public.notifications (notification_id, user_id, title, message, category, status, metadata, created_at)
        select 'N' || substr(md5(random()::text || clock_timestamp()::text || target.user_id), 1, 18), target.user_id, $2, $3, 'chat', 'Unread', $4, $5
        from (select distinct unnest($1::text[]) as user_id) target`,
        [offline.map((u) => String(u.user_id)), noticeTitle, noticeText, noticeMeta, nowIso()]);
      batchSaved = true;
    } catch { /* Fall back without dropping any recipient's notification. */ }
  }
  if (!batchSaved) for (const u of offline) {
    try { await notify(u.user_id, noticeTitle, noticeText, noticeMeta); } catch {}
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
  const thread = await assertCanUseThread(req.user, existing.thread_key || 'team');
  if (!thread) return res.status(403).json({ message: 'This chat is not allowed for your role' });
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
  const thread = await assertCanUseThread(req.user, existing.thread_key || 'team');
  if (!thread) return res.status(403).json({ message: 'This chat is not allowed for your role' });
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

module.exports = { list, stream, createGroup, renameGroup, deleteGroup, addMembers, removeMember, sendMessage, editMessage, deleteMessage, reviewMessage, publishAriaReportMessage };
