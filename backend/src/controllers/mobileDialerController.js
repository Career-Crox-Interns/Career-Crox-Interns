const crypto = require('crypto');
const multer = require('multer');
const { store, table } = require('../lib/store');
const { nowIso, normalizeIndianPhone, nextId } = require('../lib/helpers');
const { callMetricForRow, aggregateCallRows, negativeStatus, connectedStatus } = require('../lib/crmMetrics');
const { bumpCallChange, getCallChangeSnapshot } = require('../lib/callChange');
const { lockPresenceForInactivity } = require('../lib/unlockService');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Number(process.env.CRM_MOBILE_UPLOAD_MAX_BYTES || process.env.CRM_RECORDING_UPLOAD_MAX_BYTES || 18 * 1024 * 1024) } });
let cache = { at: 0, key: '', payload: null };
const mobileTaskCreateDedupCache = new Map();
const manualDialCommandDedupCache = new Map();
const MOBILE_TASK_CREATE_DEDUP_TTL_MS = 2 * 60 * 1000;
const MANUAL_DIAL_COMMAND_DEDUP_TTL_MS = 2500;
// CC26_601: old APK builds can poll every 500ms. Never turn those hits into 500ms Supabase reads.
const mobileDeviceStateCache = new Map();
const mobileSessionStateCache = new Map();
const mobileInactivityGuardCache = new Map();
const revokedMobileTokens = new Map();
function markRevokedMobileToken(token) {
  const t = String(token || "").trim(); if (!t) return;
  if (revokedMobileTokens.size > 2000) { for (const [k, at] of revokedMobileTokens) if (Date.now()-at>24*3600000) revokedMobileTokens.delete(k); if (revokedMobileTokens.size>2000) revokedMobileTokens.clear(); }
  revokedMobileTokens.set(t, Date.now());
}
function isRevokedMobileToken(token) {
  const at = revokedMobileTokens.get(String(token||""));
  return Boolean(at && Date.now()-at<24*3600000);
}
const MOBILE_DEVICE_CACHE_MS = Math.max(5000, Number(process.env.MOBILE_DEVICE_CACHE_MS || 60000));
const MOBILE_SESSION_CACHE_MS = Math.max(1000, Number(process.env.MOBILE_SESSION_CACHE_MS || 60000));
const MOBILE_INACTIVITY_GUARD_MS = Math.max(60000, Number(process.env.MOBILE_INACTIVITY_GUARD_MS || 60000));
const CRM_INACTIVITY_LOGOUT_MS = Math.max(5 * 60 * 1000, Number(process.env.CRM_INACTIVITY_LOGOUT_MS || 10 * 60 * 1000));

function mobileTaskDedupeKey(device, body = {}) {
  const explicitKey = String(body.client_request_id || body.idempotency_key || body.request_id || '').trim();
  if (explicitKey) return `${device?.device_id || device?.user_id || device?.username || 'mobile'}|${explicitKey}`;
  return `${device?.device_id || device?.user_id || device?.username || 'mobile'}|fallback|${JSON.stringify({
    title: String(body.title || body.task || '').trim(),
    description: String(body.description || '').trim(),
    due: String(body.due_date || body.due_at || '').trim(),
    priority: String(body.priority || 'Normal').trim().toLowerCase(),
  })}`;
}

function readMobileTaskCreateCache(key) {
  const entry = mobileTaskCreateDedupCache.get(key);
  if (!entry) return null;
  if ((Date.now() - Number(entry.at || 0)) > MOBILE_TASK_CREATE_DEDUP_TTL_MS) {
    mobileTaskCreateDedupCache.delete(key);
    return null;
  }
  return entry;
}

function pruneMobileTaskCreateCache() {
  const now = Date.now();
  for (const [key, entry] of mobileTaskCreateDedupCache.entries()) {
    if ((now - Number(entry.at || 0)) > MOBILE_TASK_CREATE_DEDUP_TTL_MS) mobileTaskCreateDedupCache.delete(key);
  }
}

function rid(p) { return `${p}${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function low(v) { return String(v || '').trim().toLowerCase(); }
function int(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : d; }
function role(u) { const r = low(u?.role || u?.designation || ''); if (r.includes('admin')) return 'admin'; if (r.includes('manager')) return 'manager'; if (r === 'tl' || r.includes('team')) return 'tl'; return r || 'recruiter'; }
function uname(u) { return String(u?.username || u?.employee_code || u?.user_id || '').trim(); }
function fname(u) { return String(u?.full_name || u?.name || u?.username || u?.user_id || '').trim(); }
async function all(t) { try { return await table(t); } catch { return []; } }
function invalidateMobileSessionState(row = {}) {
  const ids = [row.user_id, row.assigned_user_id, row.owner_user_id, row.username, row.assigned_username, row.owner_username].map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
  if (!ids.length) { mobileSessionStateCache.clear(); return; }
  for (const [key, entry] of mobileSessionStateCache.entries()) {
    const hay = `${key} ${JSON.stringify(entry?.rows || [])}`.toLowerCase();
    if (ids.some((id) => hay.includes(id))) mobileSessionStateCache.delete(key);
  }
}
async function ins(t, r) {
  try {
    const saved = await store.insert(t, r);
    if (saved && t === 'call_logs') bumpCallChange('call_log_insert');
    if (saved && t === 'dialer_sessions') invalidateMobileSessionState(saved || r);
    if (saved && t === 'mobile_devices') mobileDeviceStateCache.clear();
    return saved;
  } catch { return null; }
}
async function upd(t, k, id, r) {
  try {
    const saved = await store.update(t, k, id, r);
    if (saved && t === 'call_logs') bumpCallChange('call_log_update');
    if (saved && t === 'dialer_sessions') invalidateMobileSessionState(saved || r);
    if (saved && t === 'mobile_devices') mobileDeviceStateCache.clear();
    return saved;
  } catch { return null; }
}
async function find(t, k, id) { try { return await store.findById(t, k, id); } catch { return null; } }


async function pgRows(sql, params = []) {
  if (!store.pool || typeof store.query !== 'function') return null;
  try { return await store.query(sql, params); } catch { return null; }
}

async function ensureMobileDevicesTable() {
  if (!store.pool || typeof store.query !== 'function') return;
  if (ensureMobileDevicesTable.done) return;
  const ddl = [
    `create table if not exists "mobile_devices" (
      device_id text primary key,
      pairing_code text,
      device_token text,
      user_id text,
      username text,
      employee_name text,
      role text,
      device_name text,
      status text default 'Pending',
      paired_at timestamptz,
      last_seen_at timestamptz,
      expires_at timestamptz,
      logout_reason text,
      revoked_at timestamptz,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    )`,
    `alter table if exists "mobile_devices" add column if not exists device_id text`,
    `alter table if exists "mobile_devices" add column if not exists pairing_code text`,
    `alter table if exists "mobile_devices" add column if not exists device_token text`,
    `alter table if exists "mobile_devices" add column if not exists user_id text`,
    `alter table if exists "mobile_devices" add column if not exists username text`,
    `alter table if exists "mobile_devices" add column if not exists employee_name text`,
    `alter table if exists "mobile_devices" add column if not exists role text`,
    `alter table if exists "mobile_devices" add column if not exists device_name text`,
    `alter table if exists "mobile_devices" add column if not exists status text default 'Pending'`,
    `alter table if exists "mobile_devices" add column if not exists paired_at timestamptz`,
    `alter table if exists "mobile_devices" add column if not exists last_seen_at timestamptz`,
    `alter table if exists "mobile_devices" add column if not exists expires_at timestamptz`,
    `alter table if exists "mobile_devices" add column if not exists logout_reason text`,
    `alter table if exists "mobile_devices" add column if not exists revoked_at timestamptz`,
    `alter table if exists "mobile_devices" add column if not exists created_at timestamptz default now()`,
    `alter table if exists "mobile_devices" add column if not exists updated_at timestamptz default now()`,
    `alter table if exists "mobile_devices" add column if not exists last_latitude text`,
    `alter table if exists "mobile_devices" add column if not exists last_longitude text`,
    `alter table if exists "mobile_devices" add column if not exists last_location_accuracy_meters text`,
    `alter table if exists "mobile_devices" add column if not exists last_location_at text`,
    `alter table if exists "mobile_devices" add column if not exists last_location_source text`,
    `create table if not exists "employee_locations" (
      location_id text primary key,
      device_id text,
      device_token text,
      employee_user_id text,
      employee_username text,
      employee_name text,
      latitude text,
      longitude text,
      accuracy_meters text,
      provider text,
      captured_at text,
      sync_mode text,
      app_version text,
      created_at text,
      updated_at text
    )`,
    `create index if not exists idx_employee_locations_emp_time_cc26_137 on "employee_locations"(employee_username, captured_at)`,
    `create index if not exists idx_mobile_devices_pairing_code_cc26_116 on "mobile_devices"(pairing_code)`,
    `create index if not exists idx_mobile_devices_token_cc26_116 on "mobile_devices"(device_token)`,
    `create index if not exists idx_mobile_devices_user_status_cc26_116 on "mobile_devices"(user_id, username, status, updated_at desc)`
  ];
  for (const sql of ddl) {
    try { await store.query(sql, []); } catch {}
  }
  ensureMobileDevicesTable.done = true;
}
async function updateMobileDeviceTolerant(deviceId, fullPatch = {}, minimalPatch = {}) {
  const id = String(deviceId || '').trim();
  if (!id) return null;
  const attempts = [];
  attempts.push(fullPatch);
  attempts.push({
    device_token: fullPatch.device_token,
    pairing_code: fullPatch.pairing_code,
    status: fullPatch.status,
    device_name: fullPatch.device_name,
    paired_at: fullPatch.paired_at,
    last_seen_at: fullPatch.last_seen_at,
    expires_at: fullPatch.expires_at,
    updated_at: fullPatch.updated_at,
    ...minimalPatch
  });
  attempts.push({
    device_token: fullPatch.device_token,
    pairing_code: fullPatch.pairing_code,
    status: fullPatch.status,
    last_seen_at: fullPatch.last_seen_at,
    updated_at: fullPatch.updated_at,
    ...minimalPatch
  });
  for (const patch of attempts) {
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([, v]) => v !== undefined));
    if (!Object.keys(clean).length) continue;
    const saved = await upd('mobile_devices', 'device_id', id, clean);
    if (saved) return saved;
  }
  return null;
}

async function getMobileDeviceByTokenOrId(tok = '', did = '') {
  const token = String(tok || '').trim();
  const deviceId = String(did || '').trim();
  if (token && isRevokedMobileToken(token)) return { __revoked: true, status: 'Logged Out', logout_reason: 'crm_lock_inactivity_10m' };
  const cacheKey = `${token}|${deviceId}`;
  const hit = mobileDeviceStateCache.get(cacheKey);
  if (hit && Date.now() - hit.at < MOBILE_DEVICE_CACHE_MS) return hit.row ? { ...hit.row } : null;
  const rows = await pgRows(`select * from "mobile_devices" where (($1 <> '' and device_token = $1) or ($2 <> '' and device_id = $2)) limit 1`, [token, deviceId]);
  let row = rows ? (rows[0] || null) : null;
  if (!rows) {
    const allRows = await all('mobile_devices');
    row = allRows.find((x) => (token && String(x.device_token) === token) || (deviceId && String(x.device_id) === deviceId)) || null;
  }
  if (row && token && String(row.device_token || '').trim() !== token) { markRevokedMobileToken(token); return { __revoked: true, status: 'Logged Out', logout_reason: 'old_pairing_token_revoked' }; }
  if (row && token && ['logged out','expired','revoked'].includes(low(row.status))) markRevokedMobileToken(token);
  mobileDeviceStateCache.set(cacheKey, { at: Date.now(), row: row ? { ...row } : null });
  return row;
}
function sessionFreshnessScore(s = {}) {
  const state = low(`${s.status || ''} ${s.mobile_command || ''} ${s.command_type || ''}`);
  let score = 0;
  if (String(s.client_queue_id || '').trim()) score += 80;
  if (String(s.client_queue_signature || '').trim()) score += 80;
  if (/crm|table|queue/.test(low(s.call_source || s.source_mode || ''))) score += 35;
  if (/running|start|resume|wait|queued|ready/.test(state)) score += 30;
  if (/manual_dialer|manual_call|crm_call_icon|profile_call|single_profile/.test(state + ' ' + low(s.call_source || s.source_mode || ''))) score += 2500;
  if (/stop|stopped|cancel|cancelled|completed|deleted/.test(state)) score -= 1000;
  return score;
}
function sortMobileSessions(rows = []) {
  return [...rows].sort((a, b) => (sessionFreshnessScore(b) - sessionFreshnessScore(a)) || String(b.updated_at || b.started_at || b.created_at).localeCompare(String(a.updated_at || a.started_at || a.created_at)));
}
async function currentSessionsForDevice(d = {}, limit = 8) {
  const tok = String(d.device_token || '');
  const did = String(d.device_id || '');
  const uid = String(d.user_id || '');
  const un = low(d.username || '');
  const lim = Math.max(1, Math.min(20, int(limit, 8)));
  const cacheKey = `${tok}|${did}|${uid}|${un}`;
  const hit = mobileSessionStateCache.get(cacheKey);
  if (hit && Date.now() - hit.at < MOBILE_SESSION_CACHE_MS) return sortMobileSessions(hit.rows || []).slice(0, lim).map((row) => ({ ...row }));
  // CC26_601: read Supabase at most once per cache window while idle. Every dialer_sessions write invalidates this cache, so fresh CRM call commands are still picked up immediately.
  const rows = await pgRows(`select * from "dialer_sessions"
    where (($1 <> '' and device_token = $1)
      or ($2 <> '' and device_id = $2)
      or ($3 <> '' and (assigned_user_id = $3 or owner_user_id = $3))
      or ($4 <> '' and (lower(coalesce(assigned_username,'')) = $4 or lower(coalesce(owner_username,'')) = $4)))
    order by coalesce(updated_at, started_at, created_at, '') desc
    limit 50`, [tok, did, uid, un]);
  const source = rows || (await all('dialer_sessions'));
  const visible = visibleRunningSessions(source).filter((row) => sessionMatchesDevice(row, d));
  const sorted = sortMobileSessions(visible);
  mobileSessionStateCache.set(cacheKey, { at: Date.now(), rows: sorted.map((row) => ({ ...row })) });
  return sorted.slice(0, lim);
}
async function queueForSessionId(sid = '', limit = 250) {
  const sessionId = String(sid || '').trim();
  const rows = await pgRows(`select * from "dialer_queue_items" where session_id = $1
    order by coalesce(nullif(regexp_replace(coalesce(dialer_sequence::text, queue_order::text, ''), '[^0-9]', '', 'g'), '')::int, 0) asc, created_at asc
    limit $2`, [sessionId, Math.max(1, Math.min(500, int(limit, 250)))]);
  if (rows) return rows;
  return (await all('dialer_queue_items')).filter((q) => String(q.session_id) === sessionId).sort((a, b) => int(a.queue_order) - int(b.queue_order)).slice(0, Math.max(1, Math.min(500, int(limit, 250))));
}
async function activeSessionsVisibleToUser(u = {}, limit = 12) {
  const r = role(u), uid = String(u.user_id || ''), un = low(uname(u));
  let rows = null;
  if (['admin','manager','tl'].includes(r)) {
    rows = await pgRows(`select * from "dialer_sessions" order by coalesce(updated_at, created_at, '') desc limit $1`, [Math.max(1, Math.min(50, int(limit, 12)))]);
  } else {
    rows = await pgRows(`select * from "dialer_sessions" where (($1 <> '' and (owner_user_id = $1 or assigned_user_id = $1)) or ($2 <> '' and (lower(coalesce(owner_username,'')) = $2 or lower(coalesce(assigned_username,'')) = $2))) order by coalesce(updated_at, created_at, '') desc limit $3`, [uid, un, Math.max(1, Math.min(50, int(limit, 12))) ]);
  }
  const source = rows || (await all('dialer_sessions')).filter((s) => canSee(u, s)).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0, Math.max(1, Math.min(50, int(limit, 12))));
  return source.filter((s) => canSee(u, s));
}
async function todayCallsForUser(u = {}, limit = 400) {
  const b = todayIstBounds();
  const r = role(u), uid = String(u.user_id || ''), un = low(uname(u));
  const params = [new Date(b.start).toISOString(), new Date(b.end).toISOString()];
  let where = `where coalesce(call_started_at, created_at, '') >= $1 and coalesce(call_started_at, created_at, '') < $2`;
  if (!['admin','manager','tl'].includes(r)) { params.push(uid, un); where += ` and (($3 <> '' and employee_user_id = $3) or ($4 <> '' and lower(coalesce(employee_username,'')) = $4))`; }
  params.push(Math.max(1, Math.min(1000, int(limit, 400))));
  const rows = await pgRows(`select * from "call_logs" ${where} order by coalesce(call_started_at, created_at, '') desc limit $${params.length}`, params);
  if (rows) return rows;
  return (await all('call_logs')).filter((l) => isTodayIst(l.call_started_at || l.created_at)).filter((l) => ['admin','manager','tl'].includes(r) || String(l.employee_user_id || '') === uid || low(l.employee_username || '') === un).sort((a, b) => String(b.call_started_at || b.created_at).localeCompare(String(a.call_started_at || a.created_at))).slice(0, Math.max(1, Math.min(1000, int(limit, 400))));
}
async function mobileTodayCallSummary(d = {}) {
  const date = istDateKey(Date.now());
  const uid = String(d.user_id || '').trim();
  const username = String(d.username || '').trim();
  const keys = [uid, username].filter(Boolean).map((code) => `${date}|${code}`);
  let row = null;
  for (const key of keys) {
    row = await find('employee_daily_stats', 'stat_id', key).catch(() => null);
    if (row) break;
  }
  if (!row && store.pool && typeof store.query === 'function') {
    const rows = await pgRows(`select * from "employee_daily_stats" where stat_date = $1 and (($2 <> '' and recruiter_code = $2) or ($3 <> '' and lower(coalesce(username,'')) = lower($3))) order by coalesce(updated_at, created_at, '') desc limit 1`, [date, uid, username]);
    row = rows?.[0] || null;
  }
  const summary = {
    date,
    date_scope: 'today_ist',
    total_calls: int(row?.calls_count || 0),
    dialed: int(row?.outgoing_calls_count || 0),
    outgoing: int(row?.outgoing_calls_count || 0),
    incoming: int(row?.incoming_calls_count || 0),
    missed: int(row?.missed_calls_count || 0),
    connected: int(row?.connected_calls_count || 0),
    not_connected: int(row?.not_connected_calls_count || 0),
    talktime_seconds: int(row?.talktime_seconds || 0),
  };
  return summary;
}

async function previousCallForUser(userId = '', beforeStamp = '') {
  const before = parseTs(beforeStamp) ? new Date(parseTs(beforeStamp)).toISOString() : nowIso();
  const rows = await pgRows(`select * from "call_logs" where employee_user_id = $1 and coalesce(call_started_at, created_at, '') <= $2 order by coalesce(call_started_at, created_at, '') desc limit 1`, [String(userId || ''), before]);
  if (rows) return rows[0] || null;
  return (await all('call_logs')).filter((l) => String(l.employee_user_id || '') === String(userId || '')).map((l) => ({ ...l, _ts: parseTs(l.call_started_at || l.created_at), _end: parseTs(l.call_ended_at || '') })).filter((l) => l._ts && l._ts <= parseTs(before)).sort((a, b) => b._ts - a._ts)[0] || null;
}

const MOBILE_DEVICE_RECENT_MS = Number(process.env.MOBILE_DEVICE_RECENT_MS || 12 * 60 * 1000);
const MOBILE_HEARTBEAT_WRITE_MS = Number(process.env.MOBILE_HEARTBEAT_WRITE_MS || 5 * 60 * 1000);
const MOBILE_IDLE_POLL_SECONDS = Math.max(15, Number(process.env.MOBILE_IDLE_POLL_SECONDS || 60));
const MOBILE_WAITING_POLL_SECONDS = Math.max(2, Number(process.env.MOBILE_WAITING_POLL_SECONDS || 5));
const MOBILE_ACTIVE_POLL_SECONDS = Math.max(1, Number(process.env.MOBILE_ACTIVE_POLL_SECONDS || 1));
function recentTs(value) { const t = parseTs(value || ''); return t && Date.now() - t <= MOBILE_DEVICE_RECENT_MS; }
function isDeviceCallable(d = {}) { return d && low(d.status) === 'active' && String(d.device_token || '').trim(); }
async function activeDeviceForUser(userId = '', username = '') {
  const uid = String(userId || '');
  const un = low(username || '');
  const rows = await pgRows(`select * from "mobile_devices"
    where lower(coalesce(status,'')) = 'active'
      and coalesce(device_token,'') <> ''
      and (($1 <> '' and user_id = $1) or ($2 <> '' and lower(coalesce(username,'')) = $2))
    order by coalesce(last_seen_at, paired_at, updated_at, created_at, '') desc
    limit 5`, [uid, un]);
  const devices = (rows || (await all('mobile_devices'))).filter(isDeviceCallable);
  return devices.find((d) => (uid && String(d.user_id || '') === uid) || (un && low(d.username || '') === un)) || null;
}
async function touchMobileDevice(d = {}) {
  if (!d?.device_id) return;
  const last = parseTs(d.last_seen_at || d.updated_at || '');
  if (last && Date.now() - last < MOBILE_HEARTBEAT_WRITE_MS) return;
  await upd('mobile_devices', 'device_id', d.device_id, { last_seen_at: nowIso(), status: 'Active', updated_at: nowIso() });
}
function canSee(u, s) { if (['admin', 'manager', 'tl'].includes(role(u))) return true; return [s.owner_user_id, s.assigned_user_id].map(String).includes(String(u.user_id)) || String(s.assigned_username || '') === uname(u); }
function sessionMatchesDevice(s, d) { return String(s.assigned_user_id || '') === String(d.user_id || '') || String(s.owner_user_id || '') === String(d.user_id || '') || String(s.assigned_username || '') === String(d.username || '') || String(s.owner_username || '') === String(d.username || '') || String(s.device_token || '') === String(d.device_token || '') || String(s.device_id || '') === String(d.device_id || ''); }
function parseTs(v) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0; }
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateKey(ms = Date.now()) { return new Date(Number(ms || Date.now()) + IST_OFFSET_MS).toISOString().slice(0, 10); }
function isTodayIst(v) { const t = parseTs(v || nowIso()) || Date.now(); return istDateKey(t) === istDateKey(Date.now()); }
function todayIstBounds() { const key = istDateKey(Date.now()); const start = Date.parse(`${key}T00:00:00.000Z`) - IST_OFFSET_MS; return { start, end: start + 24 * 60 * 60 * 1000, key }; }
const CRM_TIME_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatIstDateTime(value = '') {
  const t = parseTs(value || '');
  if (!t) return '';
  const d = new Date(t + IST_OFFSET_MS);
  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())} ${CRM_TIME_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(h)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${ampm}`;
}
function reportTimeMs(row = {}) {
  return parseTs(row.call_started_at || row.created_at || row.updated_at || row.call_ended_at || '') || 0;
}
function commandVersion() { return String(Date.now()); }
function commandPatch(command, extra = {}) { return { mobile_command: command, command_type: command, command_version: commandVersion(), updated_at: nowIso(), ...extra }; }
function compactSession(s = {}) {
  if (!s) return null;
  return {
    session_id: s.session_id || '',
    owner_user_id: s.owner_user_id || '',
    owner_username: s.owner_username || '',
    assigned_user_id: s.assigned_user_id || '',
    assigned_username: s.assigned_username || '',
    status: s.status || '',
    live_status: s.live_status || '',
    mobile_command: s.mobile_command || s.command_type || '',
    command_type: s.command_type || s.mobile_command || '',
    command_version: s.command_version || '',
    current_queue_item_id: s.current_queue_item_id || '',
    current_candidate_id: s.current_candidate_id || '',
    current_candidate_name: s.current_candidate_name || '',
    current_phone: s.current_phone || '',
    completed_items: int(s.completed_items || 0),
    total_items: int(s.total_items || 0),
    next_call_gap_seconds: 10,
    updated_at: s.updated_at || '',
    call_source: s.call_source || s.source_mode || 'auto_dialer',
    crm_open_profile_candidate_id: s.crm_open_profile_candidate_id || '',
    crm_open_profile_queue_item_id: s.crm_open_profile_queue_item_id || '',
    crm_open_profile_request_version: s.crm_open_profile_request_version || '',
    crm_open_profile_requested_at: s.crm_open_profile_requested_at || '',
    crm_open_profile_source: s.crm_open_profile_source || '',
    next_queue_item_id: s.next_queue_item_id || '',
    next_candidate_id: s.next_candidate_id || '',
    next_candidate_name: s.next_candidate_name || '',
    next_phone: s.next_phone || '',
    warm_profile_candidate_ids: s.warm_profile_candidate_ids || '',
    client_queue_id: s.client_queue_id || '',
    client_queue_signature: s.client_queue_signature || ''
  };
}
function queueOpen(q) {
  // Desktop CRM and Android Calling Assistant must match exactly.
  // If CRM unchecks/skips a row, mobile must not call it or count it as checked.
  if (!q) return false;
  const st = low(q.status || '');
  if (st.includes('completed') || st.includes('cancel') || st.includes('skip')) return false;
  const enabled = low(q.call_enabled ?? q.enabled ?? q.selected ?? q.is_callable ?? '1');
  if (['0','false','no','off','skip','skipped'].includes(enabled)) return false;
  return !!(String(q.queue_item_id || q.candidate_id || q.phone || '').trim());
}
function mobileSafeQueueItem(q = {}) {
  // Preserve exact Desktop CRM queue decision. Do NOT convert unchecked/skipped rows back to callable.
  const enabled = String(q.call_enabled ?? q.enabled ?? q.selected ?? q.is_callable ?? '1');
  const isOpen = queueOpen({ ...q, call_enabled: enabled });
  return {
    ...q,
    status: String(q.status || (isOpen ? 'Queued' : 'Skipped')),
    call_enabled: enabled,
    enabled: String(q.enabled ?? enabled),
    selected: String(q.selected ?? enabled),
    is_callable: String(q.is_callable ?? enabled),
    skip_reason: String(q.skip_reason || (isOpen ? '' : 'Unchecked/Skipped in CRM'))
  };
}
function visibleRunningSessions(rows) { const cutoff = Date.now() - 18 * 60 * 60 * 1000; return rows.filter((s) => { const st = low(s.status); if (['stopped', 'cancelled', 'deleted', 'completed'].includes(st)) return false; const t = parseTs(s.updated_at || s.started_at || s.created_at); return ['running', 'paused', 'active', 'queued', 'waiting', 'waiting_for_mobile_sync'].includes(st) || t >= cutoff; }).sort((a, b) => String(b.updated_at || b.started_at || b.created_at).localeCompare(String(a.updated_at || a.started_at || a.created_at))); }
function attachNextProfiles(sessions = [], queueItems = []) {
  const bySession = new Map();
  for (const q of queueItems || []) {
    const sid = String(q.session_id || '');
    if (!sid) continue;
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(q);
  }
  for (const list of bySession.values()) list.sort((a, b) => int(a.queue_order, 0) - int(b.queue_order, 0));
  return (sessions || []).map((s) => {
    const sid = String(s.session_id || '');
    const items = bySession.get(sid) || [];
    if (!items.length) return s;
    const curQid = String(s.current_queue_item_id || '');
    const curCid = String(s.current_candidate_id || '');
    const current = items.find((q) => curQid && String(q.queue_item_id) === curQid) || items.find((q) => curCid && String(q.candidate_id) === curCid) || items.find(queueOpen) || null;
    const currentOrder = int(current?.queue_order, 0);
    const next = items.find((q) => queueOpen(q) && int(q.queue_order, 0) > currentOrder) || null;
    return { ...s,
      next_queue_item_id: next?.queue_item_id || '',
      next_candidate_id: next?.candidate_id || '',
      next_candidate_name: next?.candidate_name || '',
      next_phone: next?.phone || '',
      warm_profile_candidate_ids: [s.current_candidate_id || current?.candidate_id || '', next?.candidate_id || ''].filter(Boolean).join(',')
    };
  });
}
function qItem(row, i, section, source = 'auto_dialer') { const phone = normalizeIndianPhone(row.phone || row.number || row.mobile || row.candidate_phone || ''); const cid = String(row.candidate_id || row.id || '').trim(); return { queue_item_id: String(row.queue_item_id || '').trim() || rid('DQ'), candidate_id: cid, candidate_name: String(row.full_name || row.candidate_name || row.name || row.candidate || 'Candidate').trim(), phone, client: String(row.client || row.client_name || row.company || row.company_name || '').trim(), role: String(row.role || row.job_role || row.position || row.designation || '').trim(), process: String(row.process || row.process_name || row.jd_name || row.jd || row.client_process || '').trim(), location: String(row.location || row.preferred_location || row.city || row.job_location || row.work_location || '').trim(), qualification: String(row.qualification || row.qualification_level || '').trim(), experience: String(row.experience || row.exp || row.required_experience || row.total_experience || '').trim(), source: String(row.source || row.lead_source || row.data_source || row.list_name || source || '').trim(), recruiter_name: String(row.recruiter_name || row.employee_name || row.created_by_name || row.assigned_to_name || '').trim(), recruiter_code: String(row.recruiter_code || row.employee_no || row.employee_code || row.created_by_username || row.assigned_to || '').trim(), profile_status: String(row.profile_status || row.candidate_status || row.manager_crm || row.status || '').trim(), jd_name: String(row.jd_name || row.jd || row.process_name || row.requirement_name || '').trim(), section, profile_section: section, queue_order: int(row.queue_order || row.dialer_sequence || row.__dialer_order || i, i), status: String(row.queue_status || row.dialer_status || 'Queued'), profile_number: String(row.profile_number || row.profile_no || row.sr_no || row.source_sr_no || '').trim(), imn_candidate_id: String(row.imn_candidate_id || row.imn_id || row.internal_candidate_id || row.external_candidate_id || '').trim(), last_note: String(row.last_note || row.notes || row.data_notes || row.follow_up_note || row.feedback || '').trim().slice(0, 500), interview_date: String(row.interview_date || row.interview_datetime || row.interview_reschedule_date || '').trim(), source_row_index: String(row.source_row_index || row.__crm_sequence || row.__dialer_order || i || '').trim(), source_profile_key: String(row.source_profile_key || `${row.source_row_index || row.__crm_sequence || row.__dialer_order || i}:${cid || '-'}:${phone || '-'}`).trim(), call_enabled: String(row.call_enabled ?? row.enabled ?? '1'), enabled: String(row.call_enabled ?? row.enabled ?? '1'), selected: String(row.selected ?? row.call_enabled ?? row.enabled ?? '1'), is_callable: String(row.is_callable ?? row.call_enabled ?? row.enabled ?? '1'), skip_reason: String(row.skip_reason || ''), client_queue_id: String(row.client_queue_id || '').trim(), call_source: source, source_mode: source } }
function queueSignatureOf(items = []) {
  // CC26_103: stable order identity only. Name text is not used because DB/API can normalize it differently.
  // This prevents false SERVER_QUEUE_SIGNATURE_MISMATCH while still blocking stale/wrong calls by queue_item_id + candidate_id + phone.
  return (Array.isArray(items) ? items : [])
    .map((r, i) => `${i + 1}:${String(r.candidate_id || '').trim()}:${normalizeIndianPhone(r.phone || '')}`)
    .join('|');
}
function assertQueueItemIdentity(req, q) {
  const cid = String(req.body?.candidate_id || req.body?.candidateId || '').trim();
  if (cid && String(q.candidate_id || '').trim() !== cid) return 'Candidate ID mismatch. Fresh CRM sync required before calling.';
  const phone = normalizeIndianPhone(req.body?.phone || '');
  if (phone && normalizeIndianPhone(q.phone) !== phone) return 'Phone mismatch. This call is blocked so wrong profiles are not called.';
  return '';
}
async function notify(user_id, title, message, category = 'dialer', metadata = '') { if (!user_id) return; try { const id = store.pool ? rid('N') : nextId('N', await all('notifications'), 'notification_id'); await ins('notifications', { notification_id: id, user_id, title, message, category, status: 'Unread', metadata, created_at: nowIso() }); } catch {} }


function isConnectedStatus(v) {
  return connectedStatus(v);
}
function isNegativeCallStatus(v) {
  return negativeStatus(v);
}
function isMissedStatus(v) {
  const s = low(v);
  return s.includes('miss');
}
function normalizeDirection(v) {
  const s = low(v).replace(/[_-]+/g, ' ');
  if (s === 'missed' || s.includes('missed')) return 'Missed';
  if (s === 'incoming' || s === 'inbound' || s.includes('incoming') || s.includes('inbound')) return 'Incoming';
  return 'Outgoing';
}
function finalTalktime(status, duration, suppliedTalktime = null) {
  if (!isConnectedStatus(status)) return 0;
  const t = suppliedTalktime === null || suppliedTalktime === undefined || suppliedTalktime === '' ? duration : int(suppliedTalktime, 0);
  return Math.max(0, t);
}

const EARLY_CUT_RING_SECONDS = Math.max(5, int(process.env.CALL_EARLY_CUT_RING_SECONDS || 12, 12));
const GOOD_RING_SECONDS = Math.max(EARLY_CUT_RING_SECONDS + 5, int(process.env.CALL_GOOD_RING_SECONDS || 25, 25));
function flag01(value) { return value ? '1' : '0'; }
function validLocationFromBody(body = {}) {
  const lat = Number(body.employee_latitude ?? body.latitude ?? body.lat);
  const lng = Number(body.employee_longitude ?? body.longitude ?? body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const captured = String(body.employee_location_captured_at || body.captured_at || nowIso());
  const accuracy = String(body.employee_location_accuracy_meters || body.accuracy_meters || body.accuracy || '').trim();
  return {
    latitude: String(lat), longitude: String(lng), accuracy_meters: accuracy,
    provider: String(body.provider || body.employee_location_source || 'apk_egress_safe_last_known').slice(0, 80),
    captured_at: captured, source: String(body.employee_location_source || body.sync_mode || 'apk_egress_safe').slice(0, 100)
  };
}
function distanceMeters(a = {}, b = {}) {
  const lat1 = Number(a.latitude), lon1 = Number(a.longitude), lat2 = Number(b.latitude), lon2 = Number(b.longitude);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 999999;
  const R = 6371000, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function latestLocationForEmployee(userId = '', username = '') {
  const uid = String(userId || '').trim();
  const un = low(username || '');
  const rows = await pgRows(`select * from "employee_locations" where (($1 <> '' and employee_user_id = $1) or ($2 <> '' and lower(coalesce(employee_username,'')) = $2)) order by coalesce(captured_at, created_at, '') desc limit 1`, [uid, un]);
  if (rows) return rows[0] || null;
  return (await all('employee_locations')).filter((x) => (uid && String(x.employee_user_id || '') === uid) || (un && low(x.employee_username || '') === un)).sort((a,b)=>String(b.captured_at || b.created_at || '').localeCompare(String(a.captured_at || a.created_at || '')))[0] || null;
}
async function attachLocationToDeviceAndLog(d = {}, loc = {}) {
  if (!loc) return null;
  const patch = { last_latitude: loc.latitude, last_longitude: loc.longitude, last_location_accuracy_meters: loc.accuracy_meters, last_location_at: loc.captured_at, last_location_source: loc.source, last_seen_at: nowIso(), updated_at: nowIso() };
  await upd('mobile_devices', 'device_id', d.device_id, patch).catch(()=>{});
  return patch;
}

function classifyCallQuality(input = {}) {
  const status = String(input.status || '').trim();
  const direction = low(input.direction || 'Outgoing');
  const connected = isConnectedStatus(status);
  const duration = Math.max(0, int(input.duration_seconds || input.duration || 0));
  const talk = Math.max(0, int(input.talktime_seconds || input.talktime || 0));
  const ring = Math.max(0, int(input.ring_seconds || 0));
  const elapsed = Math.max(0, int(input.client_elapsed_seconds || input.dial_hold_seconds || ring || duration || 0));
  const actorFromClient = low(input.disconnect_actor_guess || input.disconnect_by || '');
  const callLogAvailable = String(input.call_log_available ?? '1') !== '0';
  let actor = 'unknown';
  let label = 'Unknown';
  let reason = '';
  let suspect = false;
  let shortRing = false;
  let score = 0;
  const isIncomingDirection = direction === 'in' || direction.includes('incoming') || direction.includes('inbound');
  const isMissedDirection = direction.includes('miss');
  if (isIncomingDirection || isMissedDirection) {
    actor = isMissedDirection ? 'candidate_missed_incoming' : 'incoming';
    label = isMissedDirection ? 'Incoming missed' : 'Incoming';
  } else if (connected || talk > 0 || duration >= 5) {
    actor = 'connected';
    label = 'Connected';
  } else {
    shortRing = ring > 0 && ring < GOOD_RING_SECONDS;
    if (actorFromClient.includes('employee') || actorFromClient.includes('early')) {
      actor = 'employee_early_cut_suspect';
      label = 'Employee cut suspected';
      reason = 'Mobile returned before normal ring window';
      suspect = true;
      score = 70;
    } else if (ring > 0 && ring < EARLY_CUT_RING_SECONDS) {
      actor = 'employee_early_cut_suspect';
      label = 'Employee cut suspected';
      reason = `Ring window ${ring}s is below ${EARLY_CUT_RING_SECONDS}s`;
      suspect = true;
      score = 65;
    } else if (ring >= GOOD_RING_SECONDS) {
      actor = 'candidate_no_answer_likely';
      label = 'Candidate not picked likely';
      reason = `Rang ${ring}s before ending`;
      score = 0;
    } else if (!callLogAvailable && elapsed > 0 && elapsed < GOOD_RING_SECONDS) {
      actor = 'unverified_short_call';
      label = 'Short unverified call';
      reason = 'Call log permission/result missing, but call window was short';
      suspect = true;
      score = 45;
    } else {
      actor = 'unknown_not_connected';
      label = 'Not connected';
      reason = ring ? `Rang ${ring}s` : 'No ring evidence received';
      score = 15;
    }
  }
  return { label, actor, reason, suspect, shortRing, ring_seconds: ring, dial_hold_seconds: elapsed, suspicious_score: score, threshold_seconds: EARLY_CUT_RING_SECONDS, good_ring_seconds: GOOD_RING_SECONDS, call_log_available: callLogAvailable ? '1' : '0' };
}
async function logCallQualityEvent(call = {}, q = {}, employee = {}, quality = {}) {
  try {
    const eventId = `CQ-${call.call_log_id || rid('CQ')}`;
    const item = {
      event_id: eventId,
      call_log_id: call.call_log_id || '',
      session_id: call.session_id || q.session_id || '',
      queue_item_id: call.queue_item_id || q.queue_item_id || '',
      candidate_id: call.candidate_id || q.candidate_id || '',
      candidate_name: call.candidate_name || q.candidate_name || '',
      phone: normalizeIndianPhone(call.phone || q.phone || ''),
      employee_user_id: call.employee_user_id || employee.user_id || '',
      employee_username: call.employee_username || employee.username || '',
      employee_name: call.employee_name || employee.employee_name || '',
      call_started_at: call.call_started_at || '',
      call_ended_at: call.call_ended_at || '',
      ring_seconds: int(quality.ring_seconds || call.ring_seconds || 0),
      dial_hold_seconds: int(quality.dial_hold_seconds || call.dial_hold_seconds || 0),
      duration_seconds: int(call.duration_seconds || 0),
      talktime_seconds: int(call.talktime_seconds || 0),
      status: call.status || '',
      disconnect_by: quality.actor || call.disconnect_by || '',
      employee_cut_suspect: flag01(quality.suspect),
      early_cut_flag: flag01(quality.shortRing),
      early_cut_reason: quality.reason || '',
      suspicious_score: int(quality.suspicious_score || 0),
      evidence_source: 'mobile_call_log_plus_app_elapsed_time',
      created_at: nowIso(),
      updated_at: nowIso()
    };
    const existing = await find('call_quality_events', 'event_id', eventId).catch(() => null);
    if (existing) await upd('call_quality_events', 'event_id', eventId, item); else await ins('call_quality_events', item);
  } catch {}
}
function syntheticManualCandidateId(value = '') {
  return /^(manual-|mob-man-|manual$|mob-man$)/i.test(String(value || '').trim());
}
function countableCrmCandidateId(value = '') {
  const id = String(value || '').trim();
  return Boolean(id) && !syntheticManualCandidateId(id);
}

async function reconcileTodayCallStatsForDevice(d = {}, candidates = null) {
  try {
    const sourceCandidates = Array.isArray(candidates) ? candidates : await all('candidates');
    const raw = await todayCallsForUser({ user_id: d.user_id || '', username: d.username || '', role: 'recruiter' }, 1000);
    const rows = dedupeReportCallRows(crmCandidateOnlyCallRows(raw, sourceCandidates));
    const metrics = aggregateCallRows(rows);
    const date = istDateKey(Date.now());
    const code = String(d.recruiter_code || d.user_id || d.username || 'UNKNOWN').trim() || 'UNKNOWN';
    const statId = `${date}|${code}`;
    const existing = await find('employee_daily_stats', 'stat_id', statId).catch(() => null);
    if (!existing) return { metrics, rows };
    await upd('employee_daily_stats', 'stat_id', statId, {
      calls_count: String(int(metrics.calls_count || 0)),
      connected_calls_count: String(int(metrics.connected_calls_count || 0)),
      not_connected_calls_count: String(int(metrics.not_connected_calls_count || 0)),
      incoming_calls_count: String(int(metrics.incoming_calls_count || 0)),
      outgoing_calls_count: String(int(metrics.outgoing_calls_count || 0)),
      missed_calls_count: String(int(metrics.missed_calls_count || 0)),
      talktime_seconds: String(int(metrics.talktime_seconds || 0)),
      updated_at: nowIso(),
    }).catch(() => {});
    return { metrics, rows };
  } catch {
    return null;
  }
}

function dailyStatsMetricForCall(row = {}) {
  const out = { ...callMetricForRow(row) };
  if (String(row.employee_cut_suspect || '') === '1' || low(row.disconnect_by || '').includes('employee')) out.employee_cut_suspect_count = 1;
  if (String(row.early_cut_flag || '') === '1') out.short_ring_count = 1;
  if (low(row.disconnect_by || '').includes('candidate_no_answer')) out.candidate_no_answer_likely_count = 1;
  const risk = int(row.suspicious_score || 0, 0);
  if (risk > 0) out.suspicious_call_score = risk;
  return out;
}

function dailyStatsMetricDelta(before = {}, after = {}) {
  const prev = dailyStatsMetricForCall(before);
  const next = dailyStatsMetricForCall(after);
  const out = {};
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const delta = (Number(next[key] || 0) || 0) - (Number(prev[key] || 0) || 0);
    if (delta) out[key] = delta;
  }
  return out;
}

async function updateDailyStatsForUser(userInfo = {}, patch = {}, statDateValue = '') {
  try {
    const uid = String(userInfo.user_id || '').trim();
    const username = String(userInfo.username || '').trim();
    const recruiterCode = String(userInfo.recruiter_code || uid || username || 'UNKNOWN').trim() || 'UNKNOWN';
    const statDate = istDateKey(statDateValue || patch.stat_date || patch.call_started_at || patch.created_at || Date.now()) || nowIso().slice(0, 10);
    const statId = `${statDate}|${recruiterCode}`;
    const existing = await find('employee_daily_stats', 'stat_id', statId).catch(() => null);
    const current = existing || {
      stat_id: statId,
      stat_date: statDate,
      recruiter_code: recruiterCode,
      recruiter_name: String(userInfo.full_name || userInfo.employee_name || username || recruiterCode || '').trim(),
      username,
      calls_count: '0', whatsapp_count: '0', jd_sent_count: '0', submissions_count: '0', interviews_count: '0', selections_count: '0', joinings_count: '0',
      connected_calls_count: '0', not_connected_calls_count: '0', incoming_calls_count: '0', outgoing_calls_count: '0', missed_calls_count: '0', talktime_seconds: '0', employee_cut_suspect_count: '0', short_ring_count: '0', candidate_no_answer_likely_count: '0', suspicious_call_score: '0'
    };
    const next = { ...current, updated_at: nowIso() };
    for (const [key, amountRaw] of Object.entries(patch || {})) {
      const amount = Number(amountRaw || 0);
      next[key] = String(Math.max(0, (Number(next[key] || 0) || 0) + amount));
    }
    if (existing) await upd('employee_daily_stats', 'stat_id', statId, next);
    else await ins('employee_daily_stats', next);
    return true;
  } catch { return false; }
}
async function logAuditActivityFromMobile(d, candidateId, actionType, metadata = {}) {
  try {
    await ins('activity_log', {
      activity_id: rid('A'),
      user_id: d.user_id || '', username: d.username || '', action_type: actionType,
      candidate_id: candidateId || '', metadata: JSON.stringify(metadata || {}), created_at: nowIso()
    });
  } catch {}
}
async function findNearbyCallLogForSync(phone, when, employee = {}) {
  const p = normalizeIndianPhone(phone || '');
  const t = parseTs(when || '');
  if (!p || !t) return null;
  const fromIso = new Date(t - 180000).toISOString();
  const toIso = new Date(t + 180000).toISOString();
  const uid = String(employee.user_id || '').trim();
  const un = low(employee.username || '');
  const rows = await pgRows(`select * from "call_logs"
    where phone = $1
      and coalesce(call_started_at, created_at, '') >= $2
      and coalesce(call_started_at, created_at, '') <= $3
      and (($4 <> '' and employee_user_id = $4) or ($5 <> '' and lower(coalesce(employee_username,'')) = $5))
    order by coalesce(call_started_at, created_at, '') desc
    limit 1`, [p, fromIso, toIso, uid, un]);
  // A valid empty PostgreSQL result is a legitimate "not found". Never
  // download the whole call history after each ordinary cache miss.
  if (rows !== null) return rows[0] || null;
  if (store.pool) return null; // SQL failure: fail closed, not a full-table read.
  const allRows = await all('call_logs');
  return allRows.find((row) => {
    const rt = parseTs(row.call_started_at || row.created_at || '');
    const sameUser = (uid && String(row.employee_user_id || '') === uid) || (un && low(row.employee_username || '') === un);
    return sameUser && normalizeIndianPhone(row.phone || '') === p && rt && Math.abs(rt - t) <= 180000;
  }) || null;
}

async function markMissedCallback(phone, employee, callLogId) {
  const p = normalizeIndianPhone(phone || '');
  if (!p) return;
  try {
    const scoped = await pgRows(`select * from public.call_logs
      where phone=$1 and lower(coalesce(status,'')) like '%miss%'
        and lower(coalesce(callback_status,'')) <> 'done'
      order by coalesce(call_started_at,created_at,'') desc limit 1`,[p]);
    // No successful callback may trigger an unbounded read of call_logs.
    const rows = scoped !== null ? scoped : store.pool ? [] : (await all('call_logs'))
      .filter((l) => normalizeIndianPhone(l.phone || '') === p)
      .filter((l) => low(l.status).includes('miss') && low(l.callback_status || '') !== 'done')
      .sort((a, b) => String(b.call_started_at || b.created_at).localeCompare(String(a.call_started_at || a.created_at))).slice(0,1);
    const latest = rows[0];
    if (latest?.call_log_id) await upd('call_logs', 'call_log_id', latest.call_log_id, {
      callback_status: 'Done', callback_done_at: nowIso(), callback_by_user_id: employee.user_id || '', callback_by_name: employee.employee_name || employee.username || '', callback_call_log_id: callLogId || '', updated_at: nowIso()
    });
  } catch {}
}

async function revokeMobileDevicesForUser(userId = '', username = '', exceptDeviceId = '', reason = 'single_device_policy', exceptDeviceToken = '') {
  const uid = String(userId || '');
  const un = low(username || '');
  const exceptId = String(exceptDeviceId || '');
  const exceptTok = String(exceptDeviceToken || '').trim();
  const stamp = nowIso();
  let changed = 0;
  if (store.pool && typeof store.query === 'function') {
    await ensureMobileDevicesTable();
    let rows = await pgRows(`update "mobile_devices" set status = 'Logged Out', pairing_code = '', logout_reason = $4, revoked_at = $5, last_seen_at = $5, updated_at = $5
      where (($1 <> '' and user_id = $1) or ($2 <> '' and lower(coalesce(username,'')) = $2))
        and ($3 = '' or device_id <> $3)
        and ($6 = '' or coalesce(device_token,'') <> $6)
        and (coalesce(device_token,'') <> '' or lower(coalesce(status,'')) in ('active','paired','pending'))
      returning device_id`, [uid, un, exceptId, reason, stamp, exceptTok]);
    if (!Array.isArray(rows)) {
      rows = await pgRows(`update "mobile_devices" set status = 'Logged Out', pairing_code = '', last_seen_at = $4, updated_at = $4
        where (($1 <> '' and user_id = $1) or ($2 <> '' and lower(coalesce(username,'')) = $2))
          and ($3 = '' or device_id <> $3)
          and ($5 = '' or coalesce(device_token,'') <> $5)
          and (coalesce(device_token,'') <> '' or lower(coalesce(status,'')) in ('active','paired','pending'))
        returning device_id`, [uid, un, exceptId, stamp, exceptTok]);
    }
    changed = Array.isArray(rows) ? rows.length : 0;
  } else {
    const rows = await all('mobile_devices');
    for (const old of rows.filter((x) => (uid && String(x.user_id || '') === uid) || (un && low(x.username || '') === un))) {
      if (exceptId && String(old.device_id || '') === exceptId) continue;
      if (exceptTok && String(old.device_token || '').trim() === exceptTok) continue;
      if (String(old.device_token || '').trim() || ['active','paired','pending'].includes(low(old.status || ''))) {
        await upd('mobile_devices', 'device_id', old.device_id, { status: 'Logged Out', pairing_code: '', logout_reason: reason, revoked_at: stamp, last_seen_at: stamp, updated_at: stamp }).catch(() => {});
        changed += 1;
      }
    }
  }
  return changed;
}

async function stopMobileSessionsForUser(userId = '', username = '', reason = 'mobile_logout_all') {
  const uid = String(userId || '');
  const un = low(username || '');
  const stamp = nowIso();
  const ver = commandVersion();
  let changed = 0;
  if (store.pool && typeof store.query === 'function') {
    const rows = await pgRows(`update "dialer_sessions" set status='Stopped', mobile_command='stop', command_type='stop', command_version=$3, live_status=$4, stopped_at=$5, updated_at=$5
      where (($1 <> '' and (assigned_user_id = $1 or owner_user_id = $1)) or ($2 <> '' and (lower(coalesce(assigned_username,'')) = $2 or lower(coalesce(owner_username,'')) = $2)))
        and lower(coalesce(status,'')) not in ('stopped','cancelled','completed','deleted')
      returning session_id`, [uid, un, ver, reason, stamp]);
    changed = Array.isArray(rows) ? rows.length : 0;
  } else {
    const sessions = await all('dialer_sessions');
    for (const ses of sessions) {
      const sameUser = String(ses.assigned_user_id || ses.owner_user_id || '') === uid || low(ses.assigned_username || ses.owner_username || '') === un;
      if (sameUser && !['stopped','cancelled','completed','deleted'].includes(low(ses.status || ''))) {
        await upd('dialer_sessions', 'session_id', ses.session_id, { status: 'Stopped', mobile_command: 'stop', command_type: 'stop', command_version: ver, live_status: reason, stopped_at: stamp, updated_at: stamp }).catch(() => {});
        changed += 1;
      }
    }
  }
  cache.at = 0;
  return changed;
}
async function device(req) {
  const tok = String(req.get('x-device-token') || req.body?.device_token || req.query?.device_token || '');
  const did = String(req.get('x-device-id') || req.body?.device_id || req.query?.device_id || '');
  const d = await getMobileDeviceByTokenOrId(tok, did);
  if (!d) { if (tok) markRevokedMobileToken(tok); return null; }
  if (low(d.status) === 'logged out' || low(d.status) === 'expired' || low(d.status) === 'revoked') return { __revoked: true, ...d };
  if (!String(d.device_token || '').trim()) return null;
  // CC26_115: token validation only. No CRM-browser-session expiry can kick out the newly paired phone.
  await touchMobileDevice(d);
  return d || null;
}
async function needDevice(req, res) {
  // Old signed Android binary checks isNotPaired only when GET returned HTTP 2xx.
  // A tiny HTTP 200 control message on active-session lets it STOP further polls;
  // all protected content endpoints still reject revoked tokens with 401/410.
  const oldApkCommandCheck = req.method === 'GET' && /(?:^|\/)active-session$/.test(String(req.path || '').split('?')[0]);
  const d = await device(req);
  if (d && d.__revoked) {
    const reason = d.logout_reason || 'mobile_logged_out';
    const r = low(reason);
    const crmLock = r.includes('crm_lock') || r.includes('inactivity') || r.includes('no_call') || r.includes('break_exceeded');
    res.status(oldApkCommandCheck ? 200 : 410).json({
      ok: false,
      code: crmLock ? 'CRM_LOCKED_PAIR_AGAIN' : 'DEVICE_LOGGED_OUT',
      reason,
      message: crmLock
        ? 'CRM is locked by attendance rules. Ask manager/TL to approve unlock, then generate a fresh pair code and pair the mobile app again.'
        : 'Mobile device is logged out. Generate a fresh CRM pair code and pair this phone again.'
    });
    return null;
  }
  if (!d) {
    res.status(oldApkCommandCheck ? 200 : 401).json({ ok: false, code: 'NOT_PAIRED', message: 'Mobile device is not paired. Enter the latest CRM pair code on this phone.' });
    return null;
  }
  return d;
}

async function logoutDevice(req, res) {
  const tok = String(req.get('x-device-token') || req.body?.device_token || req.query?.device_token || '');
  if (!tok) return res.status(400).json({ ok: false, message: 'Device token required' });
  // One-off logout from an old APK must not download an entire mobile_devices table.
  const found = await pgRows('select * from "mobile_devices" where device_token=$1 limit 1', [tok]);
  const d = found ? (found[0] || null) : (await all('mobile_devices')).find((x) => String(x.device_token || '') === tok);
  let stoppedSessions = 0;
  if (d?.device_id) {
    const reason = String(req.body?.reason || 'mobile_reset');
    await upd('mobile_devices', 'device_id', d.device_id, {
      status: 'Logged Out', device_token: '', pairing_code: '', logout_reason: reason, revoked_at: nowIso(), last_seen_at: nowIso(), updated_at: nowIso()
    });
    stoppedSessions = await stopMobileSessionsForUser(d.user_id, d.username, 'Stopped because Calling Assistant logged out').catch(() => 0);
  }
  return res.json({ ok: true, reset: true, stopped_sessions: stoppedSessions });
}

async function logoutAllDevices(req, res) {
  const tok = String(req.get('x-device-token') || req.body?.device_token || req.query?.device_token || '');
  if (!tok) return res.status(400).json({ ok: false, message: 'Device token required' });
  const d = await getMobileDeviceByTokenOrId(tok, '');
  if (!d?.device_id) return res.status(401).json({ ok: false, code: 'NOT_PAIRED', message: 'Mobile device is not paired.' });
  const reason = String(req.body?.reason || 'logout_all_from_mobile');
  const devices = await revokeMobileDevicesForUser(d.user_id, d.username, '', reason);
  const sessions = await stopMobileSessionsForUser(d.user_id, d.username, 'Stopped by mobile Logout All Devices');
  return res.json({ ok: true, logout_all: true, logged_out_devices: devices, stopped_sessions: sessions });
}

async function makeQueue(section, limit) {
  const s=low(section),lim=Math.max(1,Math.min(200,int(limit,80)));
  let rows=null;
  // CC725: auto dial only transfers the visible/scoped queue, never an entire
  // Candidates/Interviews/Hot Leads table to the Render process.
  if (s.includes('interview')) rows=await pgRows(`select i.*,c.full_name as candidate_name,c.phone
    from public.interviews i left join public.candidates c on c.candidate_id=i.candidate_id
    order by coalesce(i.scheduled_at,i.created_at,'') desc limit $1`,[lim]);
  else if (s.includes('hot')) {
    rows=await pgRows(`select * from public.hot_leads limit $1`,[lim]);
    if(rows&&!rows.length) rows=await pgRows(`select * from public.candidates
      where lower(coalesce(nullif(status,''),manager_crm,'')) like '%hot%' limit $1`,[lim]);
  }else rows=await pgRows(`select * from public.candidates order by candidate_id asc limit $1`,[lim]);
  if(!rows){
    if(s.includes('interview'))rows=(await all('interviews')).slice(0,lim).map(x=>({...x,candidate_name:x.candidate_name||x.full_name||x.name,phone:x.phone||x.candidate_phone}));
    else if(s.includes('hot')){const leads=(await all('hot_leads'));rows=(leads.length?leads:(await all('candidates')).filter(x=>low(x.status||x.manager_crm).includes('hot'))).slice(0,lim)}
    else rows=(await all('candidates')).slice(0,lim);
  }
  return rows.map((r,i)=>qItem(r,i+1,s.includes('interview')?'Interviews':s.includes('hot')?'Hot Leads':'Candidates')).filter(x=>x.phone||x.candidate_id);
}
async function writeLiveState(session, item, state, source = '') { await ins('live_call_state', { state_id: rid('LCS'), session_id: session?.session_id || '', queue_item_id: item?.queue_item_id || '', candidate_id: item?.candidate_id || '', candidate_name: item?.candidate_name || '', phone: normalizeIndianPhone(item?.phone || ''), employee_user_id: session?.assigned_user_id || session?.owner_user_id || '', employee_username: session?.assigned_username || session?.owner_username || '', live_status: state, command_version: session?.command_version || commandVersion(), call_source: source || item?.call_source || 'auto_dialer', created_at: nowIso(), updated_at: nowIso() }); }
function qident(name) { return `"${String(name).replace(/"/g, '""')}"`; }
async function insertMany(tableName, rows) {
  if (!rows.length) return [];
  if (!store.pool || typeof store.query !== 'function') {
    const out = [];
    for (const row of rows) out.push(await ins(tableName, row));
    return out;
  }
  const cols = Object.keys(rows[0]);
  const vals = [];
  const groups = rows.map((row) => `(${cols.map((col) => { vals.push(row[col]); return `$${vals.length}`; }).join(', ')})`).join(', ');
  const sql = `insert into ${qident(tableName)} (${cols.map(qident).join(', ')}) values ${groups} returning *`;
  return store.query(sql, vals);
}
async function hardStopExistingDialerSessionsForUser(assignedUserId = '', assignedUsername = '', reason = 'Replaced by fresh CRM queue', exceptSessionId = '') {
  const uid = String(assignedUserId || '');
  const un = low(assignedUsername || '');
  const exceptSid = String(exceptSessionId || '');
  const stamp = nowIso();
  const ver = commandVersion();
  if (store.pool && typeof store.query === 'function') {
    const stopped = await pgRows(`update "dialer_sessions"
      set status = 'Stopped', live_status = $3, mobile_command = 'stop', command_type = 'stop', command_version = $4, stopped_at = $5, updated_at = $5
      where (($1 <> '' and (assigned_user_id = $1 or owner_user_id = $1))
        or ($2 <> '' and (lower(coalesce(assigned_username,'')) = $2 or lower(coalesce(owner_username,'')) = $2)))
        and ($6 = '' or session_id <> $6)
        and lower(coalesce(status,'')) not in ('stopped','completed','cancelled','deleted')
      returning session_id`, [uid, un, reason, ver, stamp, exceptSid]);
    const ids = (stopped || []).map((r) => String(r.session_id || '')).filter(Boolean);
    // CC26_107: Stop old sessions only. Do not mark queue rows Cancelled/Skipped,
    // because Android may still render the last synced queue for a moment and then shows SKIP/0 checked.
    return ids.length;
  }
  let count = 0;
  const existingSessions = await all('dialer_sessions');
  for (const old of existingSessions) {
    const sameUser = String(old.assigned_user_id || old.owner_user_id || '') === uid || low(old.assigned_username || old.owner_username || '') === un;
    const st = low(`${old.status || ''} ${old.mobile_command || ''} ${old.command_type || ''}`);
    if (exceptSid && String(old.session_id || '') === exceptSid) continue;
    if (sameUser && !/(stopped|completed|cancelled|deleted|stop|cancel)/.test(st)) {
      count += 1;
      await upd('dialer_sessions', 'session_id', old.session_id, { status: 'Stopped', live_status: reason, mobile_command: 'stop', command_type: 'stop', command_version: ver, stopped_at: stamp, updated_at: stamp }).catch(() => {});
      try {
        // CC26_107: leave old queue rows as-is; session stop is enough.
      } catch {}
    }
  }
  return count;
}

async function createSession(req, res, { section, queue, source = 'auto_dialer', autoStart = true, manualNumber = '', gapSeconds = 5, forceCommandType = '' }) {
  if (!queue.length) return res.status(400).json({ ok: false, message: 'Queue empty' });
  const forcedCommandType = String(forceCommandType || '').trim();
  const srcLow = low(`${source || ''} ${forcedCommandType || ''} ${req.body?.command_source || ''} ${req.body?.call_source || ''} ${req.body?.source_mode || ''}`);
  const isManualOrProfileCommand = /manual|crm_call_icon|profile_call|single_profile/.test(srcLow);
  const gap = isManualOrProfileCommand ? 0 : 10; // Manual/profile dialer icons must call immediately; bulk/auto queues keep countdown.
  const assignedUserId = String(req.body?.assigned_user_id || req.user.user_id || '');
  const assignedUsername = String(req.body?.assigned_username || uname(req.user) || '');
  const matchedDevice = await activeDeviceForUser(assignedUserId, assignedUsername);
  if (autoStart && !matchedDevice) return res.status(409).json({ ok: false, code: 'MOBILE_APP_NOT_ACTIVE', message: 'Pair/open the Career Crox Android app first. Calls are app-only, browser/normal dialer is disabled so records stay correct.' });
  if (autoStart && isManualOrProfileCommand) {
    const firstIdentity = queue[0] || {};
    const dedupeKey = `${assignedUserId || low(assignedUsername)}|${String(firstIdentity.candidate_id || '').trim()}|${normalizeIndianPhone(firstIdentity.phone || manualNumber || '')}`;
    const previousAt = Number(manualDialCommandDedupCache.get(dedupeKey) || 0);
    const stamp = Date.now();
    for (const [key, at] of manualDialCommandDedupCache.entries()) if (stamp - Number(at || 0) > 15000) manualDialCommandDedupCache.delete(key);
    if (previousAt && stamp - previousAt < MANUAL_DIAL_COMMAND_DEDUP_TTL_MS) {
      return res.json({ ok: true, duplicate_blocked: true, persistent_pairing: true, poll_after_seconds: 1, message: 'Same manual/profile call command was already sent. Duplicate dial blocked.' });
    }
    manualDialCommandDedupCache.set(dedupeKey, stamp);
  }
  // CC26_102: hard stop old queues before inserting fresh visible-table queue; mobile queue order uses numeric queue_order.
  // This prevents the phone from showing stale queue items like CCHOT11 after CRM loaded CCHOT19.
  try { await hardStopExistingDialerSessionsForUser(assignedUserId, assignedUsername, 'Replaced by fresh visible CRM table queue'); } catch {}
  const sid = rid('DS');
  const ver = commandVersion();
  queue = [...queue].sort((a, b) => int(a.queue_order, 0) - int(b.queue_order, 0));
  queue.forEach((q, i) => { q.queue_order = i + 1; q.dialer_sequence = i + 1; if (!q.source_row_index) q.source_row_index = String(i + 1); if (!q.source_profile_key) q.source_profile_key = `${i + 1}:${q.candidate_id || '-'}:${normalizeIndianPhone(q.phone || '') || '-'}`; });
  const callableQueue = queue.filter(queueOpen);
  if (!callableQueue.length) return res.status(409).json({ ok: false, code: 'NO_CHECKED_PROFILES', message: 'No checked profiles selected. Check at least one profile in CRM before syncing/calling.' });
  const clientQueueId = String(req.body?.client_queue_id || queue.find((q) => q.client_queue_id)?.client_queue_id || '').trim();
  const clientQueueSignature = String(req.body?.client_queue_signature || '').trim();
  const serverQueueSignature = queueSignatureOf(queue);
  if (clientQueueSignature && clientQueueSignature !== serverQueueSignature) {
    return res.status(409).json({ ok: false, code: 'QUEUE_SIGNATURE_MISMATCH', message: 'CRM loaded table and mobile queue do not match. Refresh Candidates page, load selected visible rows again, then Sync Table.', client_queue_signature: clientQueueSignature, server_queue_signature: serverQueueSignature, item_count: queue.length });
  }
  const first = callableQueue[0];
  const second = callableQueue.find((q) => int(q.queue_order, 0) > int(first.queue_order, 0)) || null;
  const ts = nowIso();
  // CC26_290: send explicit run command again. Patched APK force-reloads the newest queue on every
  // start/manual_call command, so repeat profile-icon clicks cannot get stuck behind the old local queue.
  const startCommandType = autoStart ? (isManualOrProfileCommand ? 'manual_call' : 'start') : 'sync';
  const ses = {
    session_id: sid, owner_user_id: req.user.user_id, owner_username: uname(req.user), assigned_user_id: assignedUserId, assigned_username: assignedUsername,
    device_id: matchedDevice?.device_id || '', device_token: matchedDevice?.device_token || '', section,
    status: autoStart ? 'Running' : 'Queued', next_call_gap_seconds: gap, total_items: queue.length, completed_items: 0,
    current_queue_item_id: first.queue_item_id, current_candidate_id: first.candidate_id, current_candidate_name: first.candidate_name, current_phone: first.phone,
    live_status: autoStart ? 'App call command sent' : 'CRM queue synced to mobile. Open app or wait a few seconds.', mobile_auto_start: autoStart ? 'Yes' : 'No',
    mobile_command: startCommandType, command_type: startCommandType, command_version: ver,
    start_from_crm: autoStart ? 'Yes' : 'No', call_source: source, manual_number: manualNumber,
    client_queue_id: clientQueueId, client_queue_signature: clientQueueSignature || serverQueueSignature,
    crm_open_profile_candidate_id: first.candidate_id || '', crm_open_profile_queue_item_id: first.queue_item_id || '',
    crm_open_profile_request_version: autoStart ? ver : '', crm_open_profile_requested_at: autoStart ? ts : '', crm_open_profile_source: autoStart ? 'session_start' : 'table_sync',
    next_queue_item_id: second?.queue_item_id || '', next_candidate_id: second?.candidate_id || '', next_candidate_name: second?.candidate_name || '', next_phone: second?.phone || '',
    warm_profile_candidate_ids: [first.candidate_id || '', second?.candidate_id || ''].filter(Boolean).join(','),
    started_at: autoStart ? ts : '', stopped_at: '', updated_at: ts, created_at: ts
  };
  await ins('dialer_sessions', ses);
  const queueRows = queue.map((q) => ({ ...q, client_queue_id: q.client_queue_id || clientQueueId, session_id: sid, created_at: ts, updated_at: ts, started_at: '', ended_at: '', last_call_log_id: '' }));
  await insertMany('dialer_queue_items', queueRows);
  cache.at = 0;
  const responsePayload = { ok: true, session: ses, queue_preview: queue.slice(0, 10), queue_items: queueRows.map((q) => ({ queue_item_id: q.queue_item_id, candidate_id: q.candidate_id, queue_order: q.queue_order, call_enabled: q.call_enabled || '1', status: q.status })), message: 'Instant app call command created for paired Android app', poll_after_seconds: 1, persistent_pairing: true };
  res.json(responsePayload);
  // Non-critical bookkeeping must never delay a manual/profile dial click.
  if (isManualOrProfileCommand) {
    void Promise.allSettled([
      writeLiveState(ses, first, 'App command queued', source),
      hardStopExistingDialerSessionsForUser(assignedUserId, assignedUsername, 'Superseded by instant manual/profile call', sid),
    ]).then(() => { cache.at = 0; });
  } else {
    void writeLiveState(ses, first, autoStart ? 'App command queued' : 'Queued', source).catch(() => {});
  }
  return;
}

async function createPairCode(req, res) {
  await ensureMobileDevicesTable();
  const rawRequestedCode = String(req.body?.client_pairing_code || req.body?.pairing_code || req.body?.code || '').trim();
  if (rawRequestedCode && !/^\d{4}$/.test(rawRequestedCode)) {
    return res.status(400).json({ ok: false, code: 'PAIR_CODE_MUST_BE_4_DIGITS', message: 'Pair code must be exactly 4 numeric digits.' });
  }
  const code = rawRequestedCode || String(Math.floor(1000 + Math.random() * 9000));
  // CC26_371: the frontend can display a requested 4-digit code immediately while the backend saves that same code.
  // The response still confirms whether the code was saved successfully.
  const item = {
    device_id: rid('DEV'), pairing_code: code, device_token: '',
    user_id: req.user.user_id, username: uname(req.user), employee_name: fname(req.user), role: role(req.user),
    device_name: String(req.body?.device_name || 'Android Phone'), status: 'Pending',
    created_at: nowIso(), paired_at: null, last_seen_at: null, expires_at: null, updated_at: nowIso()
  };
  let saved = await ins('mobile_devices', item);
  if (!saved) {
    saved = await ins('mobile_devices', {
      device_id: item.device_id, pairing_code: item.pairing_code, device_token: '', user_id: item.user_id, username: item.username,
      employee_name: item.employee_name, role: item.role, status: 'Pending', created_at: item.created_at, updated_at: item.updated_at
    });
  }
  if (!saved) return res.status(500).json({ ok: false, code: 'PAIR_CODE_SAVE_FAILED', message: 'Pair code was not saved in database. Run the Supabase safe SQL once, then generate a fresh code.' });
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, pairing_code: code, device_id: item.device_id, expires_at: null, security: 'pair code stays valid until used/replaced; paired device stays active until CRM/app logout or CRM inactivity lock', persistent_pairing: true, cc26_444_persistent_pairing: true });
}
async function pairDevice(req, res) {
  await ensureMobileDevicesTable();
  const code = String(req.body?.pairing_code || req.body?.code || '').trim();
  if (!/^\d{4}$/.test(code)) return res.status(400).json({ ok: false, code: 'PAIR_CODE_MUST_BE_4_DIGITS', message: 'Enter valid 4 digit pair code' });
  async function findPairRow() {
    const rows = await pgRows(`select * from "mobile_devices" where pairing_code = $1 and lower(coalesce(status,'pending')) in ('pending','active','paired') order by coalesce(created_at, '') desc limit 1`, [code]);
    const source = rows || (await all('mobile_devices'));
    return source.find((x) => String(x.pairing_code) === code && ['pending','active','paired'].includes(low(x.status || 'pending'))) || null;
  }
  let d = await findPairRow();
  if (!d) {
    // CC26_106: first Android pairing attempt can reach the API before the new code row is visible.
    // Wait briefly and re-check so the first pairing attempt can succeed.
    await new Promise((resolve) => setTimeout(resolve, 900));
    d = await findPairRow();
  }
  if (!d) return res.status(404).json({ ok: false, message: 'Pair code is wrong, used, or expired' });
  if (Date.parse(d.expires_at || '') && Date.parse(d.expires_at) < Date.now()) {
    await upd('mobile_devices', 'device_id', d.device_id, { status: 'Expired', pairing_code: '', device_token: '', logout_reason: 'pair_code_expired', updated_at: nowIso() }).catch(() => {});
    return res.status(410).json({ ok: false, message: 'Pair code expired' });
  }
  const token = rid('MTK');
  revokedMobileTokens.delete(token);
  // CC26_116: Activate with a tolerant minimal update first. Optional columns like revoked_at/logout_reason must never break pairing.
  const stamp = nowIso();
  const activationPatch = { device_token: token, pairing_code: '', status: 'Active', device_name: String(req.body?.device_name || d.device_name || 'Android'), paired_at: stamp, last_seen_at: stamp, expires_at: null, logout_reason: '', revoked_at: null, updated_at: stamp };
  let activeRow = await updateMobileDeviceTolerant(d.device_id, activationPatch, { device_token: token, pairing_code: '', status: 'Active', updated_at: stamp });
  if (!activeRow || String(activeRow.device_token || '') !== token || low(activeRow.status) !== 'active') {
    // One DB read/retry for Supabase timing.
    activeRow = await updateMobileDeviceTolerant(d.device_id, activationPatch, { device_token: token, pairing_code: '', status: 'Active', updated_at: stamp });
  }
  if (!activeRow || String(activeRow.device_token || '') !== token) activeRow = await getMobileDeviceByTokenOrId(token, d.device_id);
  if (!activeRow || String(activeRow.device_token || '') !== token) return res.status(500).json({ ok: false, code: 'PAIR_TOKEN_SAVE_FAILED', message: 'Pairing token was not saved. Run the Supabase safe SQL once, generate a fresh CRM pair code, then try again.' });
  // CC26.260: Single-device pairing lock. If the same user pairs another phone,
  // every previous phone/token is logged out and old mobile sessions are stopped.
  // This prevents two APKs from pulling the same queue/session and breaking sync.
  const revokedDevices = await revokeMobileDevicesForUser(d.user_id, d.username, d.device_id, 'new_pair_code_used_on_another_phone', token).catch(() => 0);
  const sync = await createApplicationSyncSessionForDevice({ user_id: d.user_id, username: d.username, full_name: d.employee_name, employee_name: d.employee_name, role: d.role }, { ...activeRow, device_id: d.device_id, device_token: token, user_id: d.user_id, username: d.username, employee_name: activeRow.employee_name || d.employee_name }, 'Stopped because this user paired a new phone');
  cache.at = 0;
  mobileInactivityGuardCache.delete(String(d.user_id || d.username || d.device_id || '').trim().toLowerCase());
  await notify(d.user_id, 'Mobile synced', 'CAREER CROX mobile app linked and synced successfully. Manual/profile calls are ready on this phone. Old phones were logged out.', 'mobile', JSON.stringify({ open_path: '/live-dialing', synced: true }));
  res.json({ ok: true, synced: true, auto_synced: true, device: { ...activeRow, pairing_code: '', device_token: token, status: 'Active' }, device_token: token, employee_name: activeRow.employee_name || d.employee_name, username: activeRow.username || d.username, role: activeRow.role || d.role, session: sync.session, single_device_login: true, revoked_old_devices: revokedDevices, stopped_old_sessions: sync.stopped_old_sessions, message: 'Application synced successfully. Manual/profile calls will start immediately from CRM.' });
}
async function createApplicationSyncSessionForDevice(userInfo = {}, matchedDevice = {}, reason = 'auto_pair_application_sync') {
  await ensureMobileDevicesTable();
  const assignedUserId = String(userInfo.user_id || matchedDevice.user_id || '');
  const assignedUsername = String(userInfo.username || matchedDevice.username || '');
  const displayName = String(userInfo.full_name || userInfo.employee_name || matchedDevice.employee_name || assignedUsername || '');
  if (!matchedDevice?.device_id || !matchedDevice?.device_token) return { synced: false, session: null, stopped_old_sessions: 0 };
  const stoppedSessions = await hardStopExistingDialerSessionsForUser(assignedUserId, assignedUsername, reason).catch(() => 0);
  const sid = rid('DS');
  const ver = commandVersion();
  const ts = nowIso();
  const ses = {
    session_id: sid, owner_user_id: assignedUserId, owner_username: assignedUsername,
    assigned_user_id: assignedUserId, assigned_username: assignedUsername,
    device_id: matchedDevice.device_id || '', device_token: matchedDevice.device_token || '',
    section: 'Application Sync', status: 'Queued', next_call_gap_seconds: 0, total_items: 0, completed_items: 0,
    current_queue_item_id: '', current_candidate_id: '', current_candidate_name: '', current_phone: '',
    live_status: 'Application synced. Manual/profile calls will start immediately on this paired phone.',
    mobile_auto_start: 'No', mobile_command: 'sync', command_type: 'sync', command_version: ver,
    start_from_crm: 'No', call_source: 'application_sync', source_mode: 'application_sync', manual_number: '',
    client_queue_id: 'application-sync', client_queue_signature: 'application-sync',
    crm_open_profile_candidate_id: '', crm_open_profile_queue_item_id: '', crm_open_profile_request_version: '', crm_open_profile_requested_at: '', crm_open_profile_source: 'application_sync',
    next_queue_item_id: '', next_candidate_id: '', next_candidate_name: '', next_phone: '', warm_profile_candidate_ids: '',
    started_at: '', stopped_at: '', updated_at: ts, created_at: ts
  };
  const saved = await ins('dialer_sessions', ses);
  await upd('mobile_devices', 'device_id', matchedDevice.device_id, { status: 'Active', last_seen_at: ts, updated_at: ts }).catch(() => {});
  await writeLiveState(saved || ses, null, 'Application synced', 'application_sync').catch(() => {});
  cache.at = 0;
  return { synced: true, session: saved || ses, stopped_old_sessions: stoppedSessions, display_name: displayName };
}

async function syncApplication(req, res) {
  await ensureMobileDevicesTable();
  const assignedUserId = String(req.user?.user_id || '');
  const assignedUsername = String(uname(req.user) || '');
  const matchedDevice = await activeDeviceForUser(assignedUserId, assignedUsername);
  if (!matchedDevice) {
    return res.status(409).json({ ok: false, code: 'MOBILE_APP_NOT_ACTIVE', message: 'Generate pair code, open the Android app, and enter the code. Sync is automatic after pairing.' });
  }
  const revokedDevices = await revokeMobileDevicesForUser(assignedUserId, assignedUsername, matchedDevice.device_id, 'sync_application_single_device_lock', matchedDevice.device_token).catch(() => 0);
  const sync = await createApplicationSyncSessionForDevice({ ...req.user, username: assignedUsername }, matchedDevice, 'Replaced by application auto sync');
  return res.json({ ok: true, synced: true, single_device_login: true, session: sync.session, revoked_old_devices: revokedDevices, stopped_old_sessions: sync.stopped_old_sessions, message: 'Application synced. Manual/profile calls will go to this paired phone immediately.' });
}

async function startSession(req, res) { const section = String(req.body?.section || 'Interviews'); const src = String(req.body?.command_source || req.body?.call_source || 'auto_dialer'); const strict = String(req.body?.strict_sequence || '1') !== '0'; const queue = Array.isArray(req.body?.items) && req.body.items.length ? req.body.items.map((r, i) => qItem({ ...r, queue_order: strict ? i + 1 : (r.queue_order || r.dialer_sequence || i + 1), dialer_sequence: strict ? i + 1 : (r.dialer_sequence || r.queue_order || i + 1), __dialer_order: i + 1 }, i + 1, section, src)) : await makeQueue(section, req.body?.limit); queue.forEach((q, idx) => { q.queue_order = strict ? idx + 1 : (int(q.queue_order, 0) || idx + 1); q.dialer_sequence = q.queue_order; }); return createSession(req, res, { section, queue, source: src, autoStart: String(req.body?.mobile_auto_start || req.body?.start_from_crm || '1') === '1', gapSeconds: 10 }); }
async function manualCall(req, res) {
  const phone = normalizeIndianPhone(req.body?.phone || req.body?.number || '');
  if (!phone || phone.length < 10) return res.status(400).json({ ok: false, message: 'Valid phone number required' });
  const candidateId = String(req.body?.candidate_id || req.body?.candidateId || '').trim();
  let match = {};
  if (candidateId) match = await find('candidates', 'candidate_id', candidateId).catch(() => null) || {};
  const item = qItem({
    ...match,
    candidate_id: match.candidate_id || candidateId || `MANUAL-${phone}`,
    full_name: req.body?.candidate_name || match.full_name || match.name || `Manual ${phone}`,
    phone,
    process: req.body?.process || match.process || 'Manual Dialer',
    client: req.body?.client || match.client || match.client_name || '',
    role: req.body?.role || match.role || match.job_role || '',
    location: req.body?.location || match.location || match.preferred_location || '',
    source: req.body?.source || match.source || match.lead_source || 'crm_call_icon',
    profile_number: req.body?.profile_number || match.profile_number || match.profile_no || '',
    imn_candidate_id: req.body?.imn_candidate_id || match.imn_candidate_id || match.imn_id || '',
    jd_name: req.body?.jd_name || match.jd_name || match.jd || '',
    source_profile_key: req.body?.source_profile_key || '',
    last_note: req.body?.note || match.notes || ''
  }, 1, 'Manual Dialer', 'manual_dialer');
  void ins('manual_dialer_calls', { manual_call_id: rid('MDC'), session_id: '', candidate_id: item.candidate_id, candidate_name: item.candidate_name, phone, employee_user_id: req.user.user_id || '', employee_username: uname(req.user), status: 'Queued', note: String(req.body?.note || ''), created_at: nowIso(), updated_at: nowIso() }).catch(() => {});
  return createSession(req, res, { section: 'Manual Dialer', queue: [item], source: String(req.body?.command_source || req.body?.call_source || req.body?.source_mode || 'manual_dialer'), autoStart: true, manualNumber: phone, gapSeconds: 0, forceCommandType: 'manual_call' });
}

async function mobileManualCall(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  let phone = normalizeIndianPhone(req.body?.phone || req.body?.number || req.body?.mobile || '');
  const lookupKey = String(req.body?.lookup_key || req.body?.manual_query || req.body?.profile_number || req.body?.candidate_id || req.body?.candidateId || '').trim();
  const lookupLow = low(lookupKey);
  const candidateIdFromReq = String(req.body?.candidate_id || req.body?.candidateId || '').trim();
  let match = {};
  if (candidateIdFromReq) match = await find('candidates', 'candidate_id', candidateIdFromReq).catch(() => null) || {};
  try {
    // A single manual call must not download the full Candidates table.
    // Keep the old in-memory search ONLY for installations using local JSON.
    if (!match?.candidate_id && store.pool) {
      if (phone) {
        const forms = [phone, `+91${phone}`, `91${phone}`];
        const rows = await pgRows(`select * from public.candidates
          where phone=any($1::text[]) or number=any($1::text[])
          order by candidate_id limit 2`, [forms]);
        if (rows === null) return res.status(503).json({ok:false,message:'Candidate lookup is temporarily unavailable.'});
        match = rows[0] || {};
      }
      if (!match?.candidate_id && lookupKey) {
        const rows = await pgRows(`select * from public.candidates
          where lower(candidate_id)=$1 or lower(coalesce(source_sr_no,''))=$1
            or lower(coalesce(employee_no,''))=$1 or lower(coalesce(employee_row_no,''))=$1
          order by candidate_id limit 2`, [lookupLow]);
        if (rows === null) return res.status(503).json({ok:false,message:'Profile lookup is temporarily unavailable.'});
        match = rows[0] || {};
      }
    } else if (!match?.candidate_id) {
      const candidates = await all('candidates');
      if (phone) match = candidates.find((c) => normalizeIndianPhone(c.phone || c.number || c.mobile || c.candidate_phone || '') === phone) || {};
      if (!match?.candidate_id && lookupKey) {
        match = candidates.find((c) => {
          const keys = [c.candidate_id,c.profile_number,c.profile_no,c.sr_no,c.source_sr_no,c.source_row_index,c.imn_candidate_id,c.imn_id,c.internal_candidate_id,c.external_candidate_id].map((x)=>low(x));
          const numericKeys=keys.map((x)=>String(x||'').replace(/\D/g,'')).filter(Boolean);
          const lookupDigits=lookupKey.replace(/\D/g,'');
          return keys.includes(lookupLow)||(!!lookupDigits&&numericKeys.includes(lookupDigits));
        }) || {};
      }
    }
    if (!phone && match?.candidate_id) phone = normalizeIndianPhone(match.phone || match.number || match.mobile || match.candidate_phone || '');
  } catch (_) { if (store.pool) return res.status(503).json({ok:false,message:'Candidate lookup failed.'}); }
  if (!phone || phone.length < 10) return res.status(400).json({ ok: false, message: lookupKey ? 'Profile found but phone number missing or profile not found' : 'Valid phone number required' });
  const candidateId = String(match.candidate_id || candidateIdFromReq || `MOB-MAN-${phone}`).trim();
  const source = String(req.body?.call_source || req.body?.source_mode || 'mobile_app_manual_dialer').trim() || 'mobile_app_manual_dialer';
  const item = qItem({
    ...match,
    candidate_id: candidateId,
    full_name: req.body?.candidate_name || match.full_name || match.name || `Manual ${phone}`,
    phone,
    process: req.body?.process || match.process || 'Manual Dialer',
    role: req.body?.role || match.role || '',
    client: req.body?.client || match.client || '',
    location: req.body?.location || match.location || '',
    profile_number: req.body?.profile_number || match.profile_number || match.profile_no || '',
    imn_candidate_id: req.body?.imn_candidate_id || match.imn_candidate_id || match.imn_id || '',
    jd_name: req.body?.jd_name || match.jd_name || match.jd || '',
    source_profile_key: req.body?.source_profile_key || '',
    last_note: req.body?.note || match.notes || 'Manual typed number from APK',
    call_enabled: '1', enabled: '1', selected: '1', is_callable: '1'
  }, 1, 'Manual Dialer', source);
  const assignedUserId = String(d.user_id || '').trim();
  const assignedUsername = String(d.username || '').trim();
  try { await hardStopExistingDialerSessionsForUser(assignedUserId, assignedUsername, 'Replaced by mobile APK manual dial'); } catch {}
  const sid = rid('DS');
  const ver = commandVersion();
  const ts = nowIso();
  const ses = {
    session_id: sid, owner_user_id: assignedUserId, owner_username: assignedUsername, assigned_user_id: assignedUserId, assigned_username: assignedUsername,
    device_id: d.device_id || '', device_token: d.device_token || '', section: 'Manual Dialer', status: 'Running', next_call_gap_seconds: '0', total_items: '1', completed_items: '0',
    current_queue_item_id: item.queue_item_id, current_candidate_id: item.candidate_id, current_candidate_name: item.candidate_name, current_phone: item.phone,
    live_status: 'Manual app dial queued from mobile APK', mobile_auto_start: 'Yes', mobile_command: 'manual_call', command_type: 'manual_call', command_version: ver,
    start_from_crm: 'No', call_source: source, source_mode: source, manual_number: phone,
    client_queue_id: `MOBILE-MANUAL-${sid}`, client_queue_signature: queueSignatureOf([item]),
    crm_open_profile_candidate_id: item.candidate_id || '', crm_open_profile_queue_item_id: item.queue_item_id || '', crm_open_profile_request_version: ver, crm_open_profile_requested_at: ts, crm_open_profile_source: 'mobile_app_manual_dialer',
    next_queue_item_id: '', next_candidate_id: '', next_candidate_name: '', next_phone: '', warm_profile_candidate_ids: item.candidate_id || '',
    started_at: ts, stopped_at: '', updated_at: ts, created_at: ts
  };
  const queueRow = { ...item, session_id: sid, client_queue_id: ses.client_queue_id, created_at: ts, updated_at: ts, started_at: '', ended_at: '', last_call_log_id: '', call_source: source, source_mode: source };
  await ins('dialer_sessions', ses);
  await ins('dialer_queue_items', queueRow);
  await ins('manual_dialer_calls', {
    manual_call_id: rid('MDC'), session_id: sid, queue_item_id: queueRow.queue_item_id, candidate_id: queueRow.candidate_id, candidate_name: queueRow.candidate_name, phone,
    employee_user_id: assignedUserId, employee_username: assignedUsername, employee_name: d.employee_name || assignedUsername, device_id: d.device_id || '', device_token: d.device_token || '',
    status: 'Queued', note: String(req.body?.note || 'Manual typed from APK'), call_source: source, source_mode: source, command_source: 'apk_typed_number', created_at: ts, updated_at: ts
  }).catch(() => {});
  await writeLiveState(ses, queueRow, 'Manual app dial queued', source).catch(() => {});
  await logAuditActivityFromMobile(d, queueRow.candidate_id, 'manual_app_dial_queued', { phone, queue_item_id: queueRow.queue_item_id, session_id: sid, source });
  cache.at = 0;
  return res.json({ ok: true, session: ses, queue_item: queueRow, items: [queueRow], message: 'Manual app dial queued. Call will be counted from Android CallLog.' });
}

async function stopSession(req, res) { const sid = String(req.body?.session_id || ''); const ses = await find('dialer_sessions', 'session_id', sid); if (!ses || !canSee(req.user, ses)) return res.status(404).json({ ok: false, message: 'Session not found' }); const stamp = nowIso(); try { const qs = (await queueForSessionId(sid, 250)).filter((q) => !['completed','cancelled'].includes(low(q.status))); for (const q of qs) await upd('dialer_queue_items', 'queue_item_id', q.queue_item_id, { status: 'Cancelled', updated_at: stamp }); } catch {} const up = await upd('dialer_sessions', 'session_id', sid, commandPatch('stop', { status: 'Stopped', live_status: 'Stopped from CRM', mobile_auto_start: 'No', stopped_at: stamp, current_queue_item_id: '', current_candidate_id: '', current_candidate_name: '', current_phone: '', next_queue_item_id: '', next_candidate_id: '', next_candidate_name: '', next_phone: '', warm_profile_candidate_ids: '', crm_open_profile_candidate_id: '', crm_open_profile_queue_item_id: '', crm_open_profile_request_version: '', crm_open_profile_requested_at: '', crm_open_profile_source: 'stop' })); cache.at = 0; res.json({ ok: true, hard_stopped: true, session: up || ses }); }
async function pauseSession(req, res) { const sid = String(req.body?.session_id || ''); const ses = await find('dialer_sessions', 'session_id', sid); if (!ses || !canSee(req.user, ses)) return res.status(404).json({ ok: false, message: 'Session not found' }); const up = await upd('dialer_sessions', 'session_id', sid, commandPatch('pause', { status: 'Paused', live_status: 'Paused from CRM', paused_at: nowIso(), paused_by: uname(req.user), mobile_auto_start: 'No' })); cache.at = 0; res.json({ ok: true, session: up || ses }); }
async function resumeSession(req, res) { const sid = String(req.body?.session_id || ''); const ses = await find('dialer_sessions', 'session_id', sid); if (!ses || !canSee(req.user, ses)) return res.status(404).json({ ok: false, message: 'Session not found' }); const items = await queueForSessionId(sid, 250); const firstOpen = items.find(queueOpen) || null; const secondOpen = firstOpen ? items.find((q) => queueOpen(q) && int(q.queue_order, 0) > int(firstOpen.queue_order, 0)) : null; const extra = firstOpen ? { current_queue_item_id: firstOpen.queue_item_id || '', current_candidate_id: firstOpen.candidate_id || '', current_candidate_name: firstOpen.candidate_name || '', current_phone: firstOpen.phone || '', next_queue_item_id: secondOpen?.queue_item_id || '', next_candidate_id: secondOpen?.candidate_id || '', next_candidate_name: secondOpen?.candidate_name || '', next_phone: secondOpen?.phone || '' } : {}; const up = await upd('dialer_sessions', 'session_id', sid, commandPatch('start', { ...extra, status: 'Running', live_status: 'Start command sent to mobile', resumed_at: nowIso(), resumed_by: uname(req.user), mobile_auto_start: 'Yes', next_call_gap_seconds: 10 })); cache.at = 0; res.json({ ok: true, instant_start: true, poll_after_seconds: 1, session: up || ses }); }
async function mobilePauseSession(req, res) { const d = await needDevice(req, res); if (!d) return; const sid = String(req.body?.session_id || ''); const ses = await find('dialer_sessions', 'session_id', sid); if (!ses || !sessionMatchesDevice(ses, d)) return res.status(404).json({ ok: false, message: 'Session not found' }); const up = await upd('dialer_sessions', 'session_id', sid, commandPatch('pause', { status: 'Paused', live_status: 'Paused from mobile', paused_at: nowIso(), paused_by: d.username || d.user_id || 'mobile', mobile_auto_start: 'No' })); cache.at = 0; res.json({ ok: true, session: up || ses }); }
async function mobileStopSession(req, res) { const d = await needDevice(req, res); if (!d) return; const sid = String(req.body?.session_id || ''); const ses = await find('dialer_sessions', 'session_id', sid); if (!ses || !sessionMatchesDevice(ses, d)) return res.status(404).json({ ok: false, message: 'Session not found' }); const stamp = nowIso(); try { const qs = (await queueForSessionId(sid, 250)).filter((q) => !['completed','cancelled'].includes(low(q.status))); for (const q of qs) await upd('dialer_queue_items', 'queue_item_id', q.queue_item_id, { status: 'Cancelled', updated_at: stamp }); } catch {} const up = await upd('dialer_sessions', 'session_id', sid, commandPatch('stop', { status: 'Stopped', live_status: 'Stopped from mobile', mobile_auto_start: 'No', stopped_at: stamp, current_queue_item_id: '', current_candidate_id: '', current_candidate_name: '', current_phone: '', next_queue_item_id: '', next_candidate_id: '', next_candidate_name: '', next_phone: '', warm_profile_candidate_ids: '', crm_open_profile_candidate_id: '', crm_open_profile_queue_item_id: '', crm_open_profile_request_version: '', crm_open_profile_requested_at: '', crm_open_profile_source: 'mobile_stop' })); cache.at = 0; res.json({ ok: true, hard_stopped: true, session: up || ses }); }

async function recomputeSessionAfterQueueChange(sessionId, reason = 'queue_toggle') {
  const ses = await find('dialer_sessions', 'session_id', sessionId).catch(() => null);
  if (!ses) return null;
  const state = low(`${ses.status || ''} ${ses.mobile_command || ''} ${ses.command_type || ''}`);
  if (state.includes('stop') || state.includes('completed') || state.includes('cancel')) return ses;
  const items = await queueForSessionId(sessionId, 250);
  const currentStillOpen = items.find((item) => String(item.queue_item_id) === String(ses.current_queue_item_id || '') && queueOpen(item));
  if (currentStillOpen) return ses;
  const currentOrder = int((items.find((item) => String(item.queue_item_id) === String(ses.current_queue_item_id || '')) || {}).queue_order, 0);
  const next = items.find((item) => queueOpen(item) && int(item.queue_order, 0) > currentOrder);
  const afterNext = next ? items.find((item) => queueOpen(item) && int(item.queue_order, 0) > int(next.queue_order, 0)) : null;
  const ver = commandVersion();
  const patch = next ? {
    current_queue_item_id: next.queue_item_id || '', current_candidate_id: next.candidate_id || '', current_candidate_name: next.candidate_name || '', current_phone: next.phone || '',
    next_queue_item_id: afterNext?.queue_item_id || '', next_candidate_id: afterNext?.candidate_id || '', next_candidate_name: afterNext?.candidate_name || '', next_phone: afterNext?.phone || '', warm_profile_candidate_ids: [next.candidate_id || '', afterNext?.candidate_id || ''].filter(Boolean).join(','),
    live_status: `Next callable: ${next.candidate_name || next.phone || next.candidate_id}`,
    status: low(ses.status).includes('paused') ? 'Paused' : 'Running',
    mobile_command: low(ses.status).includes('paused') ? 'pause' : 'start', command_type: low(ses.status).includes('paused') ? 'pause' : 'start', command_version: ver,
    crm_open_profile_candidate_id: next.candidate_id || '', crm_open_profile_queue_item_id: next.queue_item_id || '', crm_open_profile_request_version: ver, crm_open_profile_requested_at: nowIso(), crm_open_profile_source: reason,
    updated_at: nowIso()
  } : {
    current_queue_item_id: '', current_candidate_id: '', current_candidate_name: '', current_phone: '', next_queue_item_id: '', next_candidate_id: '', next_candidate_name: '', next_phone: '', warm_profile_candidate_ids: '', live_status: 'Queue completed', status: 'Completed', mobile_command: 'completed', command_type: 'completed', command_version: ver,
    crm_open_profile_candidate_id: '', crm_open_profile_queue_item_id: '', crm_open_profile_request_version: '', crm_open_profile_requested_at: '', crm_open_profile_source: 'queue_completed', stopped_at: nowIso(), updated_at: nowIso()
  };
  return await upd('dialer_sessions', 'session_id', sessionId, patch).catch(() => null) || ses;
}

async function queueItemToggle(req, res) {
  const qid = String(req.body?.queue_item_id || req.body?.queueItemId || '').trim();
  const enabled = !['0','false','no','off','skip','skipped'].includes(low(req.body?.enabled ?? req.body?.call_enabled ?? '1'));
  if (!qid) return res.status(400).json({ ok: false, message: 'queue_item_id required' });
  const q = await find('dialer_queue_items', 'queue_item_id', qid);
  if (!q) return res.status(404).json({ ok: false, message: 'Queue item not found' });
  const ses = await find('dialer_sessions', 'session_id', q.session_id);
  if (!ses || !canSee(req.user, ses)) return res.status(403).json({ ok: false, message: 'Session not allowed' });
  const nextStatus = enabled ? (low(q.status) === 'skipped' ? 'Queued' : (q.status || 'Queued')) : 'Skipped';
  const patch = { call_enabled: enabled ? '1' : '0', status: nextStatus, skip_reason: enabled ? '' : String(req.body?.reason || 'Skipped from CRM').slice(0, 160), skipped_by: enabled ? '' : uname(req.user), skipped_at: enabled ? '' : nowIso(), updated_at: nowIso() };
  const updated = await upd('dialer_queue_items', 'queue_item_id', qid, patch);
  const session = await recomputeSessionAfterQueueChange(q.session_id, 'queue_toggle_crm');
  cache.at = 0;
  res.json({ ok: true, item: updated || { ...q, ...patch }, session: compactSession(session) });
}

async function mobileQueueItemToggle(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  const qid = String(req.body?.queue_item_id || req.body?.queueItemId || '').trim();
  const enabled = !['0','false','no','off','skip','skipped'].includes(low(req.body?.enabled ?? req.body?.call_enabled ?? '1'));
  if (!qid) return res.status(400).json({ ok: false, message: 'queue_item_id required' });
  const q = await find('dialer_queue_items', 'queue_item_id', qid);
  if (!q) return res.status(404).json({ ok: false, message: 'Queue item not found' });
  const ses = await find('dialer_sessions', 'session_id', q.session_id);
  if (!ses || !sessionMatchesDevice(ses, d)) return res.status(403).json({ ok: false, message: 'Session is not assigned to this phone' });
  const nextStatus = enabled ? (low(q.status) === 'skipped' ? 'Queued' : (q.status || 'Queued')) : 'Skipped';
  const patch = { call_enabled: enabled ? '1' : '0', status: nextStatus, skip_reason: enabled ? '' : String(req.body?.reason || 'Skipped from mobile').slice(0, 160), skipped_by: enabled ? '' : (d.username || d.user_id || 'mobile'), skipped_at: enabled ? '' : nowIso(), updated_at: nowIso() };
  const updated = await upd('dialer_queue_items', 'queue_item_id', qid, patch);
  const session = await recomputeSessionAfterQueueChange(q.session_id, 'queue_toggle_mobile');
  cache.at = 0;
  res.json({ ok: true, item: updated || { ...q, ...patch }, session: compactSession(session) });
}

async function liveStatus(req, res) {
  const lite = ['1', 'true', 'yes'].includes(low(req.query?.lite || req.query?.compact || ''));
  const profileWatch = ['1', 'true', 'yes'].includes(low(req.query?.profile_watch || req.query?.watch || ''));
  const key = req.user.user_id + ':' + role(req.user) + ':' + (lite ? 'lite' : 'full') + ':' + (profileWatch ? 'watch' : 'normal');
  const ttl = profileWatch ? 30000 : (lite ? 60000 : 180000);
  if (ttl > 0 && cache.payload && cache.key === key && Date.now() - cache.at < ttl) {
    res.set('Cache-Control', `private, max-age=${lite ? 15 : 60}`);
    return res.json({ ...cache.payload, cached: true, system_guard_mode: true });
  }
  const sessionsRaw = sortMobileSessions(await activeSessionsVisibleToUser(req.user, lite ? 8 : 20)).slice(0, lite ? 8 : 20);
  const sessions = sessionsRaw.map(compactSession);
  const pairedDevice = await activeDeviceForUser(req.user?.user_id || '', uname(req.user));
  const pairState = { mobile_pair_active: !!pairedDevice, persistent_pairing: !!pairedDevice, paired_device_id: pairedDevice?.device_id || '', paired_device_name: pairedDevice?.device_name || '' };
  if (lite) {
    const payload = { ok: true, generated_at: nowIso(), sync_mode: 'compact_command_sync_hard_egress', sessions, active_queue: [], recent_calls: [], summary: { sessions: sessions.length }, manual_refresh_mode: true, crm_sync_fix_cc26_117: true, system_guard_mode: true, ...pairState };
    if (!profileWatch) cache = { at: Date.now(), key, payload };
    res.set('Cache-Control', 'private, max-age=30');
    return res.json(payload);
  }
  const ids = new Set(sessionsRaw.filter((s) => !['stopped','cancelled','deleted'].includes(low(s.status))).slice(0, 2).map((s) => String(s.session_id)));
  let active_queue = [];
  for (const sid of ids) active_queue.push(...(await queueForSessionId(sid, 12)));
  active_queue = active_queue.slice(0, 24);
  const visibleTodayCallsRaw = await todayCallsForUser(req.user, 250);
  const visibleTodayCalls = dedupeReportCallRows(crmCandidateOnlyCallRows(visibleTodayCallsRaw, await all('candidates')));
  const recent = visibleTodayCalls.slice(0, 30);
  const summaryMetrics = aggregateCallRows(visibleTodayCalls);
  const summary = { dialed: summaryMetrics.outgoing_calls_count, connected: summaryMetrics.connected_calls_count, not_connected: summaryMetrics.not_connected_calls_count, incoming: summaryMetrics.incoming_calls_count, missed: summaryMetrics.missed_calls_count, talktime_seconds: summaryMetrics.talktime_seconds, total_calls: summaryMetrics.calls_count, unique_numbers: new Set(visibleTodayCalls.map((x) => normalizeIndianPhone(x.phone || '')).filter(Boolean)).size, date_scope: 'today_ist', date: istDateKey(Date.now()) };
  const payload = { ok: true, generated_at: nowIso(), sync_mode: 'manual_cached_command_sync', sessions, active_queue, recent_calls: recent, summary, manual_refresh_mode: true, system_guard_mode: true, ...pairState };
  if (!profileWatch) cache = { at: Date.now(), key, payload };
  res.set('Cache-Control', 'private, max-age=60');
  res.json(payload);
}
async function enforceMobileInactivityGuard(d = {}) {
  const key = String(d.user_id || d.username || d.device_id || '').trim().toLowerCase();
  if (!key) return { locked: false };
  const prior = mobileInactivityGuardCache.get(key);
  if (prior && Date.now() - prior.at < MOBILE_INACTIVITY_GUARD_MS) return prior.result || { locked: false };
  let result = { locked: false };
  try {
    const liveSession = await find('active_sessions', 'username', d.username);
    const hasSession = Boolean(String(liveSession?.session_token || '').trim());
    const browserLast = hasSession ? parseTs(liveSession?.last_seen_at || liveSession?.login_at || '') : 0;
    // Only credential login and trusted visible human interactions refresh browserLast.
    // Phone polling and background presence updates never renew the CRM session.
    const presence = await find('presence', 'user_id', d.user_id);
    const fallbackLast = parseTs(presence?.work_started_at || d.paired_at || d.created_at || '');
    const last = browserLast || fallbackLast;
    if ((!hasSession || (last && Date.now() - last >= CRM_INACTIVITY_LOGOUT_MS)) &&
        (!last || Date.now() - last >= CRM_INACTIVITY_LOGOUT_MS)) {
      const user = { user_id: d.user_id, username: d.username, full_name: d.employee_name || d.username, role: d.role || 'recruiter', designation: d.role || 'recruiter' };
      if (!['manager','admin'].includes(low(user.role))) {
        await lockPresenceForInactivity(user, '10-minute inactivity logout. Login again and request unlock approval.', { lockReason: 'session_inactivity', source: 'mobile_inactivity_guard', notifyExisting: false }).catch(() => null);
      }
      await revokeMobileDevicesForUser(d.user_id, d.username, '', 'crm_lock_inactivity_10m').catch(() => 0);
      await stopMobileSessionsForUser(d.user_id, d.username, 'Stopped because CRM locked after 10-minute inactivity').catch(() => 0);
      if (hasSession) await upd('active_sessions', 'username', d.username, { session_token:'', status:'Logged Out', revoked_at:nowIso(), logout_at:nowIso(), updated_at:nowIso() }).catch(() => null);
      mobileDeviceStateCache.clear();
      mobileSessionStateCache.clear();
      result = { locked: true, reason: 'crm_lock_inactivity_10m' };
    }
  } catch {}
  mobileInactivityGuardCache.set(key, { at: Date.now(), result });
  return result;
}

async function activeSession(req, res) {
  const d = await needDevice(req, res);
  if (!d) return;
  const guard = await enforceMobileInactivityGuard(d);
  if (guard.locked) return res.status(200).json({ ok:false, code:'CRM_LOCKED_PAIR_AGAIN', reason:guard.reason, message:'CRM logged out after 10 minutes of inactivity. Login again, request approval if required, then pair the phone again.' }); // 200 is a control signal recognized by the installed old APK: it stops subsequent HTTP polls.
  const sessions = await currentSessionsForDevice(d, 8);
  const raw = sessions[0] || null;
  const ses = compactSession(raw);
  const cmd = low(ses?.mobile_command || ses?.command_type || '');
  const state = low(ses?.status || '');
  const sourceMode = low(`${ses?.call_source || ''} ${ses?.source_mode || ''} ${ses?.section || ''}`);
  const applicationSynced = !!(ses && sourceMode.includes('application_sync'));
  const isRunCommand = !!(ses && ['start', 'resume', 'prepare', 'running', 'manual_call'].includes(cmd));
  const isSyncCommand = !!(ses && (applicationSynced || ['sync', 'wait', 'queued', 'ready', 'waiting', 'waiting_for_mobile_sync'].includes(cmd)));
  const recentlyUpdated = !!(raw && parseTs(raw.updated_at || raw.created_at || '') && Date.now() - parseTs(raw.updated_at || raw.created_at || '') < 4 * 60 * 1000);
  // CC26_117: when CRM presses Sync Mobile Queue, the phone must pick it quickly while the app is open.
  // Background/idle remains slow, so egress does not start burning all day like a tiny cloud bonfire.
  const poll = !ses ? MOBILE_IDLE_POLL_SECONDS : isRunCommand ? MOBILE_ACTIVE_POLL_SECONDS : (isSyncCommand && recentlyUpdated ? 1 : MOBILE_WAITING_POLL_SECONDS);
  const includeSummary = ['1', 'true', 'yes'].includes(low(req.query?.include_summary || ''));
  const todaySummary = includeSummary ? await mobileTodayCallSummary(d).catch(() => null) : null;
  res.set('Cache-Control', includeSummary ? 'no-store' : 'private, max-age=10');
  // CC26_623: tiny in-memory task signals; no task/notifications SQL on this endpoint.
  // needDevice() and inactivity guard ran first, so a revoked/logged-out phone never gets events.
  let taskEvents = [];
  if (d.user_id) {
    try { taskEvents = require('./taskController').mobileTaskSignalsForUser(
      d.user_id, String(req.query?.task_event_ack || '').slice(0,64)); } catch (_) {}
  }
  res.json({ ok: true, strict_device_session: true, single_device_login: true, persistent_pairing: true, paired: true, session: ses, has_active_session: !!ses, command_type: cmd, command_version: ses?.command_version || '', auto_start: !!(ses && (['start', 'resume', 'manual_call', 'sync'].includes(cmd) || state === 'running')), paused: cmd === 'pause' || state === 'paused', poll_after_seconds: poll, manual_sync_available: true, application_synced: applicationSynced, crm_sync_waiting: isSyncCommand, system_guard_mode: true, egress_lock_mode: true, ...(taskEvents.length ? { task_events: taskEvents } : {}), ...(todaySummary ? { today_summary: todaySummary } : {}) });
}
async function mobileQueue(req, res) {
  const d = await needDevice(req, res);
  if (!d) return;
  let sid = String(req.query?.session_id || req.body?.session_id || '');
  let ses = sid ? await find('dialer_sessions', 'session_id', sid) : null;
  if (ses && !sessionMatchesDevice(ses, d)) return res.status(403).json({ ok: false, message: 'Queue is not assigned to this paired phone' });
  if (!ses) {
    const sessions = await currentSessionsForDevice(d, 8);
    ses = sessions[0] || null;
    sid = String(ses?.session_id || '');
  }
  if (!ses) return res.status(404).json({ ok: false, message: 'No CRM session assigned to this phone' });
  let items = await queueForSessionId(sid, 150);
  const cmd = low(ses.mobile_command || ses.command_type || '');
  // Exact CRM queue rule: do not auto-change Skipped/unchecked rows in the mobile API.
  // The phone receives the same checked list/status that Desktop CRM saved.
  res.set('Cache-Control', 'no-store');
  const serverQueueSignature = queueSignatureOf(items);
  const storedSignature = String(ses.client_queue_signature || '').trim();
  let repairedSignature = false;
  if (storedSignature && serverQueueSignature && storedSignature !== serverQueueSignature) {
    // CC26_103: do NOT empty the phone queue on a harmless signature-format mismatch.
    // The wrong-profile bug is prevented by freshest-session selection + old-session hard-stop + per-call identity guard.
    // If queue rows are present, mobile must receive them instead of getting stuck on Queue empty.
    repairedSignature = true;
    try {
      const patched = await upd('dialer_sessions', 'session_id', sid, {
        client_queue_signature: serverQueueSignature,
        live_status: 'Queue verified and signature auto-repaired',
        updated_at: nowIso()
      });
      if (patched) ses = patched;
      else ses = { ...ses, client_queue_signature: serverQueueSignature, live_status: 'Queue verified and signature auto-repaired' };
    } catch {
      ses = { ...ses, client_queue_signature: serverQueueSignature };
    }
  }
  const mobileItems = items.map(mobileSafeQueueItem);
  const todaySummary = await mobileTodayCallSummary(d).catch(() => null);
  res.json({ ok: true, strict_device_session: true, session: compactSession(ses), items: mobileItems, ...(todaySummary ? { today_summary: todaySummary } : {}), queue_signature: serverQueueSignature, signature_auto_repaired: repairedSignature, queue_preview: mobileItems.slice(0, 10).map((q) => ({ queue_order: q.queue_order, candidate_id: q.candidate_id, candidate_name: q.candidate_name, phone: q.phone, call_enabled: q.call_enabled })), next_call_gap_seconds: int(ses.next_call_gap_seconds, 10), auto_start: ['start', 'resume', 'manual_call'].includes(cmd) || low(ses.status) === 'running', paused: cmd === 'pause' || low(ses.status) === 'paused', requires_manual_start: false, poll_after_seconds: (['start', 'resume', 'manual_call', 'running', 'prepare'].includes(cmd) || low(ses.status) === 'running') ? MOBILE_ACTIVE_POLL_SECONDS : MOBILE_WAITING_POLL_SECONDS, queue_cached_until_manual_sync: true, fresh_visible_table_lock: true, checked_count: mobileItems.filter(queueOpen).length, system_guard_mode: true });
}
async function prepareCall(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  const q = await find('dialer_queue_items', 'queue_item_id', String(req.body?.queue_item_id || ''));
  if (!q) return res.status(404).json({ ok: false, message: 'Queue item missing' });
  if (normalizeIndianPhone(q.phone) !== normalizeIndianPhone(req.body?.phone || q.phone)) return res.status(400).json({ ok: false, message: 'Only CRM queue numbers counted' });
  const identityError = assertQueueItemIdentity(req, q);
  if (identityError) return res.status(409).json({ ok: false, code: 'QUEUE_ITEM_IDENTITY_MISMATCH', message: identityError });
  if (!queueOpen(q)) return res.status(409).json({ ok: false, message: 'Fresh Sync Queue required before calling this profile' });
  const ses = await find('dialer_sessions', 'session_id', q.session_id);
  const sesState = low(`${ses?.status || ''} ${ses?.mobile_command || ''} ${ses?.command_type || ''}`);
  if (sesState.includes('stop') || sesState.includes('paused') || sesState.includes('pause') || sesState.includes('completed')) return res.status(409).json({ ok: false, message: 'Session is not running' });
  const items = await queueForSessionId(q.session_id, 250);
  const next = items.find((item) => queueOpen(item) && int(item.queue_order, 0) > int(q.queue_order, 0)) || null;
  await upd('dialer_queue_items', 'queue_item_id', q.queue_item_id, { status: 'Preparing', updated_at: nowIso() });
  const ver = commandVersion();
  await upd('dialer_sessions', 'session_id', q.session_id, {
    current_queue_item_id: q.queue_item_id, current_candidate_id: q.candidate_id, current_candidate_name: q.candidate_name, current_phone: q.phone,
    next_queue_item_id: next?.queue_item_id || '', next_candidate_id: next?.candidate_id || '', next_candidate_name: next?.candidate_name || '', next_phone: next?.phone || '', warm_profile_candidate_ids: [q.candidate_id || '', next?.candidate_id || ''].filter(Boolean).join(','),
    live_status: `Preparing ${q.candidate_name || q.phone}`, mobile_command: 'prepare', command_type: 'prepare', command_version: ver,
    crm_open_profile_candidate_id: q.candidate_id, crm_open_profile_queue_item_id: q.queue_item_id, crm_open_profile_request_version: ver, crm_open_profile_requested_at: nowIso(), crm_open_profile_source: 'prepare_call', updated_at: nowIso()
  });
  await writeLiveState({ ...ses, command_version: ver }, q, 'Preparing', q.call_source || 'auto_dialer');
  cache.at = 0;
  res.json({ ok: true, prepared: true, queue_item: q, next_queue_item: next, countdown_seconds: Math.max(0, int(ses?.next_call_gap_seconds, 10)) });
}
async function callStart(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  const qid = String(req.body?.queue_item_id || '');
  const q = await find('dialer_queue_items', 'queue_item_id', qid);
  if (!q) return res.status(404).json({ ok: false, message: 'Queue item missing' });
  if (!queueOpen(q)) return res.status(409).json({ ok: false, message: 'Fresh Sync Queue required before calling this profile' });
  if (!sessionMatchesDevice(await find('dialer_sessions', 'session_id', q.session_id) || {}, d)) return res.status(403).json({ ok: false, message: 'Session is not assigned to this phone' });
  if (normalizeIndianPhone(q.phone) !== normalizeIndianPhone(req.body?.phone || q.phone)) return res.status(400).json({ ok: false, message: 'Only CRM queue numbers counted' });
  const identityError = assertQueueItemIdentity(req, q);
  if (identityError) return res.status(409).json({ ok: false, code: 'QUEUE_ITEM_IDENTITY_MISMATCH', message: identityError });
  const sesForStart = await find('dialer_sessions', 'session_id', q.session_id);
  const sesStartState = low(`${sesForStart?.status || ''} ${sesForStart?.mobile_command || ''} ${sesForStart?.command_type || ''}`);
  if (sesStartState.includes('stop') || sesStartState.includes('paused') || sesStartState.includes('pause') || sesStartState.includes('completed')) return res.status(409).json({ ok: false, message: 'Session is not running' });
  const idd = String(req.body?.call_log_id || rid('CL'));
  const src = String(q.call_source || q.source_mode || (low(q.section).includes('manual') ? 'manual_dialer' : 'auto_dialer'));
  const startedAt = String(req.body?.call_started_at || nowIso());
  const existingById = await find('call_logs', 'call_log_id', idd).catch(() => null);
  const existingByQueueRows = await pgRows(`select * from "call_logs" where queue_item_id = $1 and session_id = $2 and coalesce(call_ended_at,'') = '' order by coalesce(created_at,'') desc limit 1`, [String(q.queue_item_id), String(q.session_id)]);
  const existingByQueue = existingByQueueRows ? (existingByQueueRows[0] || null) : (await all('call_logs')).find((l) => String(l.queue_item_id) === String(q.queue_item_id) && String(l.session_id) === String(q.session_id) && !String(l.call_ended_at || '').trim());
  const locStart = validLocationFromBody(req.body || {});
  if (locStart) await attachLocationToDeviceAndLog(d, locStart).catch(() => {});
  const log = {
    call_log_id: existingById?.call_log_id || existingByQueue?.call_log_id || idd,
    session_id: q.session_id, queue_item_id: q.queue_item_id, candidate_id: q.candidate_id, candidate_name: q.candidate_name,
    phone: normalizeIndianPhone(q.phone), employee_user_id: d.user_id, employee_username: d.username, employee_name: d.employee_name,
    client: q.client || '', process: q.process || '', role: q.role || '', location: q.location || '', source: q.source || '',
    profile_number: q.profile_number || '', imn_candidate_id: q.imn_candidate_id || '', recruiter_name: q.recruiter_name || '', recruiter_code: q.recruiter_code || '', profile_status: q.profile_status || '', jd_name: q.jd_name || '', source_profile_key: q.source_profile_key || '',
    call_started_at: existingById?.call_started_at || existingByQueue?.call_started_at || startedAt, call_ended_at: '', answered_at: '',
    ring_seconds: 0, dial_hold_seconds: 0, duration_seconds: 0, talktime_seconds: 0, idle_seconds: 0, status: 'Calling', direction: 'Outgoing', call_quality: 'Calling', disconnect_by: '', disconnect_actor_guess: '', employee_cut_suspect: '0', early_cut_flag: '0', early_cut_reason: '', suspicious_score: 0, call_log_available: '1',
    employee_latitude: locStart?.latitude || '', employee_longitude: locStart?.longitude || '', employee_location_accuracy_meters: locStart?.accuracy_meters || '', employee_location_captured_at: locStart?.captured_at || '', employee_location_source: locStart?.source || '', call_source: src, source_mode: src, recording_status: 'Missing', recording_url: '', recording_file_id: '', synced_from: 'mobile', stats_counted: '0',
    created_at: existingById?.created_at || existingByQueue?.created_at || nowIso(), updated_at: nowIso()
  };
  if (existingById || existingByQueue) await upd('call_logs', 'call_log_id', log.call_log_id, log);
  else await ins('call_logs', log);
  try {
    await upd('presence', 'user_id', d.user_id, {
      last_call_dial_at: log.call_started_at || nowIso(),
      last_call_candidate_id: q.candidate_id || '',
      last_seen_at: nowIso(),
      last_activity_at: nowIso(),
      last_activity_source: 'mobile_call_assistant',
      updated_at: nowIso(),
    });
  } catch {}
  await upd('dialer_queue_items', 'queue_item_id', q.queue_item_id, { status: 'Calling', started_at: log.call_started_at, last_call_log_id: log.call_log_id, updated_at: nowIso() });
  await upd('dialer_sessions', 'session_id', q.session_id, { current_queue_item_id: q.queue_item_id, current_candidate_id: q.candidate_id, current_candidate_name: q.candidate_name, current_phone: q.phone, live_status: `Calling ${q.candidate_name || q.phone}`, mobile_command: 'running', command_type: 'running', command_version: commandVersion(), updated_at: nowIso() });
  await writeLiveState({ session_id: q.session_id, assigned_user_id: d.user_id, assigned_username: d.username }, q, 'Calling', src);
  await logAuditActivityFromMobile(d, q.candidate_id, 'call_started', { phone: q.phone, queue_item_id: q.queue_item_id, session_id: q.session_id });
  cache.at = 0;
  res.json({ ok: true, call_log: log });
}
async function callEnd(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  const idd = String(req.body?.call_log_id || '');
  const qid = String(req.body?.queue_item_id || '');
  const q = qid ? await find('dialer_queue_items', 'queue_item_id', qid).catch(() => null) : null;
  if (q && !sessionMatchesDevice(await find('dialer_sessions', 'session_id', q.session_id) || {}, d)) return res.status(403).json({ ok: false, message: 'Session is not assigned to this phone' });
  if (q) {
    const identityError = assertQueueItemIdentity(req, q);
    if (identityError) return res.status(409).json({ ok: false, code: 'QUEUE_ITEM_IDENTITY_MISMATCH', message: identityError });
  }
  const existing = idd ? await find('call_logs', 'call_log_id', idd).catch(() => null) : null;
  const rawStatus = String(req.body?.status || req.body?.call_status || existing?.status || 'Not Connected');
  const direction = normalizeDirection(req.body?.direction || existing?.direction || rawStatus || 'Outgoing');
  const dur = Math.max(0, int(req.body?.duration_seconds, 0));
  const callLogAvailable = String(req.body?.call_log_available ?? existing?.call_log_available ?? '0') === '1';
  // An incoming ring with zero talk duration is NOT a connected call. Android
  // CallLog proof + an affirmative answer (or positive duration) is required.
  const connected = callLogAvailable && !isNegativeCallStatus(rawStatus)
    && (isConnectedStatus(rawStatus) || dur > 0 || Math.max(0,int(req.body?.talktime_seconds,0)) > 0);
  // Android CallLog proof is compulsory. Negative statuses such as Not Connected must never become Connected only because ring duration exists.
  const finalStatus = direction === 'Missed' || isMissedStatus(rawStatus) ? 'Missed' : connected ? 'Connected' : (direction === 'Incoming' ? 'Incoming' : 'Not Connected');
  const talktime = finalTalktime(finalStatus, dur, req.body?.talktime_seconds);
  const startedAt = String(existing?.call_started_at || req.body?.call_started_at || nowIso());
  const ended = String(req.body?.call_ended_at || nowIso());
  const clientElapsedSeconds = Math.max(0, int(req.body?.client_elapsed_seconds || req.body?.call_window_seconds || req.body?.dial_hold_seconds || 0));
  const ringSeconds = Math.max(0, int(req.body?.ring_seconds, clientElapsedSeconds > 0 ? (finalStatus === 'Connected' ? Math.max(0, clientElapsedSeconds - talktime) : clientElapsedSeconds) : 0));
  const quality = classifyCallQuality({ status: finalStatus, direction, duration_seconds: dur, talktime_seconds: talktime, ring_seconds: ringSeconds, client_elapsed_seconds: clientElapsedSeconds, disconnect_actor_guess: req.body?.disconnect_actor_guess || req.body?.disconnect_by, call_log_available: req.body?.call_log_available });
  const note = String(req.body?.notes || req.body?.note || req.body?.call_note || '').trim().slice(0, 500);
  let idleSeconds = 0;
  try {
    const started = parseTs(startedAt);
    const prev = await previousCallForUser(d.user_id || '', startedAt);
    if (prev && started) {
      const prevEnd = prev._end || (prev._ts + int(prev.duration_seconds || prev.talktime_seconds) * 1000);
      idleSeconds = Math.max(0, Math.round((started - prevEnd) / 1000));
    }
  } catch {}
  const callLogId = existing?.call_log_id || idd || rid('CL');
  const locEnd = validLocationFromBody(req.body || {});
  if (locEnd) await attachLocationToDeviceAndLog(d, locEnd).catch(() => {});
  const patch = {
    call_log_id: callLogId,
    session_id: existing?.session_id || q?.session_id || String(req.body?.session_id || ''),
    queue_item_id: existing?.queue_item_id || qid,
    candidate_id: existing?.candidate_id || q?.candidate_id || String(req.body?.candidate_id || ''),
    candidate_name: existing?.candidate_name || q?.candidate_name || String(req.body?.candidate_name || ''),
    phone: normalizeIndianPhone(existing?.phone || q?.phone || req.body?.phone || ''),
    client: existing?.client || q?.client || String(req.body?.client || ''),
    process: existing?.process || q?.process || String(req.body?.process || ''),
    role: existing?.role || q?.role || String(req.body?.role || ''),
    location: existing?.location || q?.location || String(req.body?.location || ''),
    source: existing?.source || q?.source || String(req.body?.source || ''),
    profile_number: existing?.profile_number || q?.profile_number || String(req.body?.profile_number || ''),
    imn_candidate_id: existing?.imn_candidate_id || q?.imn_candidate_id || String(req.body?.imn_candidate_id || ''),
    recruiter_name: existing?.recruiter_name || q?.recruiter_name || String(req.body?.recruiter_name || ''),
    recruiter_code: existing?.recruiter_code || q?.recruiter_code || String(req.body?.recruiter_code || ''),
    profile_status: existing?.profile_status || q?.profile_status || String(req.body?.profile_status || ''),
    jd_name: existing?.jd_name || q?.jd_name || String(req.body?.jd_name || ''),
    source_profile_key: existing?.source_profile_key || q?.source_profile_key || String(req.body?.source_profile_key || ''),
    employee_user_id: existing?.employee_user_id || d.user_id,
    employee_username: existing?.employee_username || d.username,
    employee_name: existing?.employee_name || d.employee_name,
    employee_latitude: locEnd?.latitude || existing?.employee_latitude || '',
    employee_longitude: locEnd?.longitude || existing?.employee_longitude || '',
    employee_location_accuracy_meters: locEnd?.accuracy_meters || existing?.employee_location_accuracy_meters || '',
    employee_location_captured_at: locEnd?.captured_at || existing?.employee_location_captured_at || '',
    employee_location_source: locEnd?.source || existing?.employee_location_source || '',
    call_started_at: startedAt,
    call_ended_at: ended,
    answered_at: connected ? String(req.body?.answered_at || existing?.answered_at || startedAt) : '',
    duration_seconds: dur,
    talktime_seconds: talktime,
    ring_seconds: ringSeconds,
    dial_hold_seconds: clientElapsedSeconds,
    status: finalStatus,
    call_quality: quality.label,
    disconnect_by: quality.actor,
    disconnect_actor_guess: String(req.body?.disconnect_actor_guess || req.body?.disconnect_by || quality.actor || ''),
    employee_cut_suspect: flag01(quality.suspect),
    early_cut_flag: flag01(quality.shortRing),
    early_cut_reason: quality.reason,
    suspicious_score: quality.suspicious_score,
    call_log_available: callLogAvailable ? '1' : '0',
    qa_checked_at: nowIso(),
    direction,
    notes: note,
    idle_seconds: idleSeconds,
    call_source: existing?.call_source || q?.call_source || q?.source_mode || String(req.body?.call_source || 'auto_dialer'),
    source_mode: existing?.source_mode || q?.source_mode || q?.call_source || String(req.body?.call_source || 'auto_dialer'),
    recording_status: existing?.recording_status || 'Missing',
    recording_url: existing?.recording_url || '',
    recording_file_id: existing?.recording_file_id || '',
    synced_from: 'mobile',
    crm_tracked_number: countableCrmCandidateId(existing?.candidate_id || q?.candidate_id || req.body?.candidate_id || '') ? '1' : '0',
    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso()
  };
  let up = null;
  if (existing) up = await upd('call_logs', 'call_log_id', existing.call_log_id, patch);
  else { up = await ins('call_logs', { ...patch, stats_counted: '0' }); }
  const alreadyCounted = String(existing?.stats_counted || up?.stats_counted || '') === '1';
  const countableCrmCall = countableCrmCandidateId(patch.candidate_id);
  if (countableCrmCall && alreadyCounted && existing) {
    // A placeholder/not-connected row can later receive authoritative Android CallLog proof.
    // Reconcile the cache by delta so daily stats cannot stay stale or double-count.
    const deltaPatch = dailyStatsMetricDelta(existing, { ...patch, stats_counted: '1' });
    if (Object.keys(deltaPatch).length) await updateDailyStatsForUser(d, deltaPatch, patch.call_started_at || patch.created_at || ended);
  } else if (countableCrmCall) {
    const statsPatch = dailyStatsMetricForCall({ ...patch, status: finalStatus, direction, talktime_seconds: talktime, duration_seconds: dur });
    await updateDailyStatsForUser(d, statsPatch, patch.call_started_at || patch.created_at || ended);
    await upd('call_logs', 'call_log_id', callLogId, { stats_counted: '1', crm_tracked_number: '1', updated_at: nowIso() }).catch(() => {});
    await logAuditActivityFromMobile(d, patch.candidate_id, finalStatus === 'Connected' ? 'call_logged' : (finalStatus === 'Missed' ? 'missed_call_logged' : (quality.suspect ? 'employee_early_cut_suspected' : 'call_not_connected')), { phone: patch.phone, talktime_seconds: talktime, duration_seconds: dur, ring_seconds: ringSeconds, disconnect_by: quality.actor, suspicious_score: quality.suspicious_score, queue_item_id: qid, session_id: patch.session_id });
    await logCallQualityEvent(patch, q || {}, d, quality);
    if (finalStatus === 'Connected') await markMissedCallback(patch.phone, d, callLogId);
  } else {
    await upd('call_logs', 'call_log_id', callLogId, { stats_counted: '0', crm_tracked_number: '0', updated_at: nowIso() }).catch(() => {});
  }
  if (qid) await upd('dialer_queue_items', 'queue_item_id', qid, { status: 'Completed', ended_at: ended, last_call_log_id: callLogId, updated_at: nowIso() });
  const sid = String(req.body?.session_id || patch.session_id || '');
  let responseNext = null;
  if (sid) {
    const ses = await find('dialer_sessions', 'session_id', sid);
    const sesState = low(`${ses?.status || ''} ${ses?.mobile_command || ''} ${ses?.command_type || ''}`);
    const stopped = sesState.includes('stop') || sesState.includes('cancel') || sesState.includes('completed');
    const paused = !stopped && (low(ses?.status) === 'paused' || low(ses?.mobile_command) === 'pause' || sesState.includes('pause'));
    const items = await queueForSessionId(sid, 250);
    const done = items.filter((item) => ['completed'].includes(low(item.status))).length;
    const currentOrder = int(q?.queue_order || (items.find((item) => String(item.queue_item_id) === String(qid || patch.queue_item_id || '')) || {}).queue_order, 0);
    const next = stopped ? null : items.find((item) => queueOpen(item) && int(item.queue_order, 0) > currentOrder);
    responseNext = next || null;
    const afterNext = next ? items.find((item) => queueOpen(item) && int(item.queue_order, 0) > int(next.queue_order, 0)) : null;
    const adaptiveNextGapSeconds = finalStatus === 'Connected' ? 10 : 2;
    const ver = commandVersion();
    await upd('dialer_sessions', 'session_id', sid, {
      completed_items: done,
      current_queue_item_id: next?.queue_item_id || '', current_candidate_id: next?.candidate_id || '', current_candidate_name: next?.candidate_name || '', current_phone: next?.phone || '',
      next_queue_item_id: afterNext?.queue_item_id || '', next_candidate_id: afterNext?.candidate_id || '', next_candidate_name: afterNext?.candidate_name || '', next_phone: afterNext?.phone || '', warm_profile_candidate_ids: [next?.candidate_id || '', afterNext?.candidate_id || ''].filter(Boolean).join(','),
      live_status: stopped ? 'Stopped' : next ? (paused ? `Paused before ${next.candidate_name || next.phone}` : `Next: ${next.candidate_name || next.phone} • ${adaptiveNextGapSeconds}s`) : 'Queue completed',
      next_call_gap_seconds: next ? adaptiveNextGapSeconds : 10,
      status: stopped ? 'Stopped' : next ? (paused ? 'Paused' : 'Running') : 'Completed',
      mobile_command: stopped ? 'stop' : next ? (paused ? 'pause' : 'start') : 'completed',
      command_type: stopped ? 'stop' : next ? (paused ? 'pause' : 'start') : 'completed', command_version: ver,
      crm_open_profile_candidate_id: stopped ? '' : (ses?.crm_open_profile_candidate_id || ''), crm_open_profile_queue_item_id: stopped ? '' : (ses?.crm_open_profile_queue_item_id || ''), crm_open_profile_request_version: stopped ? '' : (ses?.crm_open_profile_request_version || ''), crm_open_profile_requested_at: stopped ? '' : (ses?.crm_open_profile_requested_at || ''), crm_open_profile_source: stopped ? 'stop' : 'already_warm_no_refresh',
      updated_at: nowIso(), stopped_at: (stopped || !next) ? nowIso() : ''
    });
  }
  cache.at = 0;
  const nextCountdownSeconds = finalStatus === 'Connected' ? 10 : 2;
  const todaySummary = await mobileTodayCallSummary(d).catch(() => null);
  res.json({ ok: true, call_log: up || patch, counted_once: countableCrmCall && !alreadyCounted, ...(todaySummary ? { today_summary: todaySummary } : {}), talktime_rule: 'not_connected_is_zero', sequence_rule: 'auto_next_gap_2s_not_connected_10s_connected', next_countdown_seconds: responseNext ? nextCountdownSeconds : 0, next_queue_item_id: responseNext ? responseNext.queue_item_id : '', next_candidate_id: responseNext ? responseNext.candidate_id : '', next_candidate_name: responseNext ? responseNext.candidate_name : '' });
}
async function recordingUploaded(req, res) { const d = await needDevice(req, res); if (!d) return; const call = String(req.body?.call_log_id || ''); if (!call) return res.status(400).json({ ok: false, message: 'call_log_id required' }); const file = { recording_file_id: rid('RF'), call_log_id: call, candidate_id: String(req.body?.candidate_id || ''), phone: normalizeIndianPhone(req.body?.phone || ''), employee_user_id: d.user_id, storage_bucket: 'call-recordings', storage_path: String(req.body?.storage_path || ''), recording_url: String(req.body?.recording_url || ''), original_filename: String(req.body?.original_filename || ''), compressed_size_bytes: int(req.body?.compressed_size_bytes), duration_seconds: int(req.body?.duration_seconds), status: req.body?.recording_url ? 'Uploaded' : 'Linked', uploaded_at: nowIso(), created_at: nowIso() }; await ins('recording_files', file); await upd('call_logs', 'call_log_id', call, { recording_status: file.status, recording_url: file.recording_url, recording_file_id: file.recording_file_id, updated_at: nowIso() }); res.json({ ok: true, recording: file }); }
async function uploadRecordingFile(req, res) { const d = await needDevice(req, res); if (!d) return; if (!req.file?.buffer) return res.status(400).json({ ok: false, message: 'recording file required' }); const call = String(req.body?.call_log_id || ''); const candidateId = String(req.body?.candidate_id || '').trim(); if (!call && !candidateId) return res.status(400).json({ ok: false, message: 'call_log_id or candidate_id required' }); const supa = String(process.env.SUPABASE_URL || '').replace(/\/$/, ''); const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''); const ext = String(req.file.originalname || 'recording.m4a').split('.').pop().replace(/[^a-z0-9]/gi, '') || 'm4a'; const path = `${d.user_id || 'mobile'}/${call || candidateId}-${Date.now()}.${ext}`; let url = '', status = 'Stored Metadata'; if (supa && key && typeof fetch === 'function') { const r = await fetch(`${supa}/storage/v1/object/call-recordings/${encodeURIComponent(path).replace(/%2F/g, '/')}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': req.file.mimetype || 'application/octet-stream', 'x-upsert': 'true' }, body: req.file.buffer }); if (!r.ok) return res.status(502).json({ ok: false, message: 'Supabase upload failed', detail: await r.text().catch(() => '') }); url = `${supa}/storage/v1/object/public/call-recordings/${path}`; status = 'Uploaded'; } const file = { recording_file_id: rid('RF'), call_log_id: call, candidate_id: candidateId, phone: normalizeIndianPhone(req.body?.phone || ''), employee_user_id: d.user_id, storage_bucket: 'call-recordings', storage_path: path, recording_url: url, original_filename: req.file.originalname || '', compressed_size_bytes: req.file.size || req.file.buffer.length, duration_seconds: int(req.body?.duration_seconds), status, uploaded_at: nowIso(), created_at: nowIso() }; await ins('recording_files', file); if (file.candidate_id) { try { const cf = { file_id: rid('F'), candidate_id: file.candidate_id, file_kind: 'call_recording', original_name: file.original_filename || (`recording_${call || file.candidate_id}.bin`), storage_name: (file.candidate_id + '_call_recording_' + file.recording_file_id + '_' + (file.original_filename || 'recording')).slice(0, 180), mime_type: req.file.mimetype || 'application/octet-stream', size_bytes: String(req.file.size || req.file.buffer.length), content_base64: req.file.buffer.toString('base64'), uploaded_by_user_id: d.user_id || '', uploaded_by_name: d.employee_name || d.username || 'Mobile', created_at: nowIso(), updated_at: nowIso(), source: 'mobile_apk_recording' }; await ins('candidate_files', cf); await upd('candidates', 'candidate_id', file.candidate_id, { recording_filename: cf.original_name, updated_at: nowIso() }); } catch {} } if (call) await upd('call_logs', 'call_log_id', call, { recording_status: status, recording_url: url, recording_file_id: file.recording_file_id, updated_at: nowIso() }); cache.at = 0; res.json({ ok: true, recording: file, storage_configured: !!url, message: 'Recording linked to candidate profile' }); }
async function uploadMobileCandidateFile(req, res) { const d = await needDevice(req, res); if (!d) return; if (!req.file?.buffer) return res.status(400).json({ ok: false, message: 'file required' }); const candidateId = String(req.body?.candidate_id || '').trim(); if (!candidateId) return res.status(400).json({ ok: false, message: 'candidate_id required' }); const candidate = await find('candidates', 'candidate_id', candidateId); if (!candidate) return res.status(404).json({ ok: false, message: 'Candidate not found' }); const kind = String(req.body?.file_kind || 'resume').trim() === 'call_recording' ? 'call_recording' : 'resume'; const now = nowIso(); const original = String(req.file.originalname || `${kind}.bin`).replace(/[\\/"<>|?*]+/g, '_').slice(0, 120); const fileId = rid('F'); const item = { file_id: fileId, candidate_id: candidateId, file_kind: kind, original_name: original, storage_name: `${candidateId}_${kind}_${fileId}_${original}`.slice(0, 180), mime_type: req.file.mimetype || 'application/octet-stream', size_bytes: String(req.file.size || req.file.buffer.length), content_base64: req.file.buffer.toString('base64'), uploaded_by_user_id: d.user_id || '', uploaded_by_name: d.employee_name || d.username || 'Mobile', created_at: now, updated_at: now, source: 'mobile_apk', suggested_file_name: String(req.body?.suggested_file_name || '') }; await ins('candidate_files', item); await upd('candidates', 'candidate_id', candidateId, { updated_at: now, resume_filename: kind === 'resume' ? original : (candidate.resume_filename || ''), recording_filename: kind === 'call_recording' ? original : (candidate.recording_filename || '') }); cache.at = 0; res.json({ ok: true, item: { ...item, content_base64: undefined }, message: kind === 'resume' ? 'Resume linked to candidate profile' : 'Recording linked to candidate profile' }); }
async function candidateCallHistory(req, res) { const cid = String(req.params?.candidateId || req.query?.candidate_id || ''); const phone = normalizeIndianPhone(req.query?.phone || ''); const rows = (await all('call_logs')).filter((l) => (cid && String(l.candidate_id) === cid) || (phone && normalizeIndianPhone(l.phone) === phone)).sort((a, b) => String(b.call_started_at || b.created_at).localeCompare(String(a.call_started_at || a.created_at))).slice(0, 80); res.json({ ok: true, items: rows }); }
async function mobileChatList(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  const since = Math.max(0, int(req.query?.since_id));
  // Tiny, indexed, max-80-row read. Never pull all messages just to find the latest few.
  const queried = since
    ? await pgRows(`select * from public.messages where id > $1 and coalesce(nullif(thread_key,''), 'team') = 'team' order by id asc limit 80`, [since])
    : await pgRows(`select * from (select * from public.messages where coalesce(nullif(thread_key,''), 'team') = 'team' order by id desc limit 80) recent order by id asc`, []);
  // Local-file mode / missing optional SQL columns only: preserve the previous functional path.
  const rows = queried !== null ? queried : (await all('messages')).filter((m) => (!since || int(m.id) > since) && (!m.thread_key || String(m.thread_key) === 'team')).sort((a, b) => int(a.id) - int(b.id)).slice(-80);
  res.json({ ok: true, messages: rows, latest_message_id: rows.reduce((m, x) => Math.max(m, int(x.id)), since), poll_after_seconds: 300, tiny: queried !== null });
}
async function mobileChatSend(req, res) { const d = await needDevice(req, res); if (!d) return; const body = String(req.body?.body || req.body?.message || req.body?.message_text || '').trim(); if (!body) return res.status(400).json({ ok: false, message: 'Message required' }); const rows = store.pool ? [] : await all('messages'); const numericIds = rows.map((m) => Number(m.id || 0)).filter(Number.isFinite); const item = { id: numericIds.length ? Math.max(...numericIds) + 1 : 1, created_by_username: d.username || d.user_id || 'mobile', created_by_name: d.employee_name || d.username || 'Mobile User', created_by_role: d.role || 'recruiter', sender_username: d.username || d.user_id || 'mobile', sender_name: d.employee_name || d.username || 'Mobile User', sender_role: d.role || 'recruiter', recipient_username: '', body, original_body: body, message: body, message_text: body, content: body, created_at: nowIso(), updated_at: nowIso(), thread_key: 'team', thread_type: 'mobile_team', chat_type: 'common_team', reference_type: 'mobile', reference_id: d.device_id, mention_usernames: '', delete_mode: '', deleted_by_username: '', deleted_at: '', status: 'sent' }; const insertRow = store.pool ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id')) : item; const saved = await ins('messages', insertRow); const messageTitle = 'Team Chat'; const messagePreview = `${d.employee_name || d.username}: ${body.slice(0, 80)}`; const messageMeta = JSON.stringify({ open_path: '/chat', source: 'mobile' });
  let batchSaved = false;
  if (store.pool) {
    try {
      // One insert-with-select instead of reading users + 80 separate notification queries.
      await store.query(`insert into public.notifications (notification_id, user_id, title, message, category, status, metadata, created_at)
        select 'N' || substr(md5(random()::text || clock_timestamp()::text || u.user_id), 1, 18), u.user_id, $2, $3, 'chat', 'Unread', $4, $5
        from (select user_id from public.users where user_id <> $1 order by user_id limit 80) u`,
        [String(d.user_id || ''), messageTitle, messagePreview, messageMeta, nowIso()]);
      batchSaved = true;
    } catch { /* Preserve old notification flow on schemas without the expected columns. */ }
  }
  if (!batchSaved) {
    const recipients = store.pool ? (await pgRows('select user_id from public.users where user_id <> $1 limit 80', [String(d.user_id || '')]) || []) : (await all('users')).filter((u) => String(u.user_id) !== String(d.user_id)).slice(0, 80);
    for (const u of recipients) await notify(u.user_id, messageTitle, messagePreview, 'chat', messageMeta);
  } res.json({ ok: true, message: saved || item }); }
async function mobileNotifications(req, res) { const d = await needDevice(req, res); if (!d) return; const seen = new Set(); const items = (await all('notifications')).filter((n) => (String(n.user_id) === String(d.user_id) || low(n.username || n.assigned_username || '') === low(d.username || '')) && low(n.status || 'unread') !== 'read' && low(n.category) !== 'dialer').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).filter((n) => { const k = String(n.notification_id || n.id || n.title || '') + '|' + String(n.message || ''); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 20); res.json({ ok: true, items, unread: items.length, poll_after_seconds: 300 }); }
function userLabel(r) { return String(r.employee_username || r.employee_name || r.created_by_username || r.assigned_username || 'Unknown').trim() || 'Unknown'; }
function cleanStatus(v) { const s = low(v); if (s.includes('miss')) return 'Missed'; if (s.includes('incoming')) return 'Incoming'; if (isNegativeCallStatus(v)) return 'Not Connected'; if (isConnectedStatus(v)) return 'Connected'; if (s.includes('call')) return 'Calling'; return String(v || 'Not Connected'); }
async function liveReports(req, res) {
  const q = req.query || {};
  const now = Date.now();
  const todayBounds = todayIstBounds();
  let from = todayBounds.start, to = todayBounds.end;
  const mins = int(q.minutes || q.duration_minutes || 0);
  const hours = int(q.hours || q.duration_hours || 0);
  const explicitRange = q.date_from || q.date_to || mins > 0 || hours > 0;
  if (mins > 0) from = now - mins * 60 * 1000;
  else if (hours > 0) from = now - hours * 60 * 60 * 1000;
  else if (q.date_from) from = Date.parse(String(q.date_from));
  if (q.date_to) to = Date.parse(String(q.date_to)) + 24 * 60 * 60 * 1000;
  else if (q.date_from && !q.date_to) to = Date.parse(String(q.date_from)) + 24 * 60 * 60 * 1000;
  if (!Number.isFinite(from)) from = 0;
  if (!Number.isFinite(to)) to = now + 24 * 60 * 60 * 1000;
  const search = low(q.q || q.search || ''), phoneSearch = normalizeIndianPhone(q.phone || q.number || ''), nameSearch = low(q.name || ''), rec = low(q.recruiter || q.employee || ''), direction = low(q.direction || ''), stat = low(q.status || ''), source = low(q.source || q.call_source || ''), durMin = int(q.duration_min || q.min_duration || 0), durMax = int(q.duration_max || q.max_duration || 0);
  let logs = [];
  if (store.pool && typeof store.query === 'function') {
    const clauses = [`coalesce(call_started_at, created_at, '') >= $1`, `coalesce(call_started_at, created_at, '') <= $2`];
    const params = [new Date(from).toISOString(), new Date(to).toISOString()];
    if (!['admin','manager','tl'].includes(role(req.user))) { params.push(String(req.user.user_id || '')); params.push(low(uname(req.user))); clauses.push(`(employee_user_id = $${params.length-1} or lower(coalesce(employee_username,'')) = $${params.length})`); }
    if (phoneSearch) { params.push(`%${phoneSearch}%`); clauses.push(`regexp_replace(coalesce(phone,''),'\\D','','g') like $${params.length}`); }
    if (nameSearch) { params.push(`%${nameSearch}%`); clauses.push(`lower(coalesce(candidate_name,'')) like $${params.length}`); }
    if (rec) { params.push(`%${rec}%`); clauses.push(`(lower(coalesce(employee_username,'')) like $${params.length} or lower(coalesce(employee_name,'')) like $${params.length})`); }
    if (direction) { params.push(`%${direction}%`); clauses.push(`(lower(coalesce(direction,'')) like $${params.length} or lower(coalesce(status,'')) like $${params.length})`); }
    if (stat) { params.push(`%${stat}%`); clauses.push(`lower(coalesce(status,'')) like $${params.length}`); }
    if (source) { params.push(`%${source}%`); clauses.push(`lower(coalesce(call_source, source_mode, '')) like $${params.length}`); }
    if (search) { params.push(`%${search}%`); clauses.push(`(lower(coalesce(candidate_name,'')) like $${params.length} or lower(coalesce(candidate_id,'')) like $${params.length} or regexp_replace(coalesce(phone,''),'\\D','','g') like $${params.length} or lower(coalesce(notes,'')) like $${params.length})`); }
    if (durMin) { params.push(durMin); clauses.push(`coalesce(nullif(talktime_seconds,''),'0')::numeric >= $${params.length}`); }
    if (durMax) { params.push(durMax); clauses.push(`coalesce(nullif(talktime_seconds,''),'0')::numeric <= $${params.length}`); }
    logs = await store.query(`select * from public.call_logs where ${clauses.join(' and ')} order by coalesce(call_started_at, created_at, '') desc limit 700`, params);
  } else {
    logs = await all('call_logs');
  }
  logs = crmCandidateOnlyCallRows(logs, await all('candidates'));
  const employeeOptions = buildEmployeeOptions(await all('users'));
  const rows = dedupeReportCallRows(logs.map((l) => {
    const status = cleanStatus(l.status || l.call_status);
    const talk = finalTalktime(status, int(l.duration_seconds, 0), l.talktime_seconds);
    return { ...l, status, phone: normalizeIndianPhone(l.phone || ''), _ts: parseTs(l.call_started_at || l.created_at), _employee: userLabel(l), _status: status, duration_seconds: int(l.duration_seconds, 0), talktime_seconds: talk, ring_seconds: int(l.ring_seconds, 0), dial_hold_seconds: int(l.dial_hold_seconds, 0), idle_seconds: int(l.idle_seconds, 0), call_quality: String(l.call_quality || ''), disconnect_by: String(l.disconnect_by || l.disconnect_actor_guess || ''), employee_cut_suspect: String(l.employee_cut_suspect || '0'), early_cut_flag: String(l.early_cut_flag || '0'), early_cut_reason: String(l.early_cut_reason || ''), suspicious_score: int(l.suspicious_score, 0), number_call_count: 0, notes: String(l.notes || l.note || l.call_note || ''), call_source: String(l.call_source || l.source_mode || 'auto_dialer'), callback_status: l.callback_status || '' };
  }).filter((l) => l.phone)
    .filter((l) => !store.pool ? l._ts >= from && l._ts <= to : true)
    .filter((l) => !search || low(l.phone).includes(search) || low(l.candidate_name).includes(search) || low(l.candidate_id).includes(search) || low(l.notes).includes(search) || low(l._employee).includes(search))
    .filter((l) => !phoneSearch || low(l.phone).includes(phoneSearch))
    .filter((l) => !nameSearch || low(l.candidate_name).includes(nameSearch))
    .filter((l) => !rec || low(l._employee).includes(rec) || low(l.employee_user_id).includes(rec) || low(l.employee_username).includes(rec))
    .filter((l) => !direction || low(l.direction || 'outgoing').includes(direction) || low(l._status).includes(direction))
    .filter((l) => !stat || low(l._status).includes(stat))
    .filter((l) => !source || low(l.call_source).includes(source))
    .filter((l) => !durMin || int(l.talktime_seconds) >= durMin)
    .filter((l) => !durMax || int(l.talktime_seconds) <= durMax)
    .filter((l) => ['admin','manager','tl'].includes(role(req.user)) || String(l.employee_user_id || '') === String(req.user.user_id || '') || low(l.employee_username).includes(low(uname(req.user)))));
  const asc = [...rows].sort((a, b) => a._ts - b._ts), byEmp = new Map(), byPhone = new Map(), byCandidateDay = new Map(), lastByEmp = new Map();
  for (const l of asc) {
    const pk = l.phone;
    byPhone.set(pk, (byPhone.get(pk) || 0) + 1);
    l.number_call_count = byPhone.get(pk);
    const day = istDateKey(l._ts || Date.now());
    const cdKey = `${l.candidate_id || pk}|${day}`;
    const cd = byCandidateDay.get(cdKey) || { candidate_id: l.candidate_id || '', candidate_name: l.candidate_name || '', phone: pk, date: day, calls: 0, connected: 0, talktime_seconds: 0, employees: new Set(), last_call_at: '' };
    const cdMetric = callMetricForRow(l);
    cd.calls += int(cdMetric.calls_count || 0);
    cd.connected += int(cdMetric.connected_calls_count || 0);
    cd.talktime_seconds += int(cdMetric.talktime_seconds || 0);
    cd.employees.add(l._employee); cd.last_call_at = l.call_started_at || l.created_at || cd.last_call_at; byCandidateDay.set(cdKey, cd);
    const emp = l._employee || 'Unknown', start = l._ts, dur = int(l.duration_seconds), prev = lastByEmp.get(emp);
    if (!int(l.idle_seconds) && prev && start > prev.end) l.idle_seconds = Math.max(0, Math.round((start - prev.end) / 1000));
    lastByEmp.set(emp, { end: start + dur * 1000 });
    const cur = byEmp.get(emp) || { employee: emp, dialed: 0, connected: 0, not_connected: 0, incoming: 0, outgoing: 0, missed: 0, employee_cut_suspect: 0, short_ring: 0, candidate_no_answer_likely: 0, suspicious_score: 0, talktime_seconds: 0, total_duration_seconds: 0, idle_seconds: 0, unique_numbers: new Set() };
    cur.unique_numbers.add(pk);
    if (String(l.employee_cut_suspect || '') === '1' || low(l.disconnect_by).includes('employee')) cur.employee_cut_suspect++;
    if (String(l.early_cut_flag || '') === '1') cur.short_ring++;
    if (low(l.disconnect_by).includes('candidate_no_answer')) cur.candidate_no_answer_likely++;
    cur.suspicious_score += int(l.suspicious_score || 0);
    const empMetric = callMetricForRow(l);
    cur.incoming += int(empMetric.incoming_calls_count || 0);
    cur.missed += int(empMetric.missed_calls_count || 0);
    cur.outgoing += int(empMetric.outgoing_calls_count || 0);
    cur.dialed += int(empMetric.outgoing_calls_count || 0);
    cur.connected += int(empMetric.connected_calls_count || 0);
    cur.not_connected += int(empMetric.not_connected_calls_count || 0);
    cur.talktime_seconds += int(empMetric.talktime_seconds || 0); cur.total_duration_seconds += dur; cur.idle_seconds += int(l.idle_seconds);
    byEmp.set(emp, cur);
  }
  rows.sort((a, b) => b._ts - a._ts);
  const performers = [...byEmp.values()].map((x) => { const empLoc = rows.find((r) => String(r._employee || '') === String(x.employee || '') && (r.employee_latitude || r.employee_longitude)) || {}; const aht = x.connected ? Math.round(x.talktime_seconds / Math.max(1, x.connected)) : 0, conv = x.dialed ? Math.round((x.connected / x.dialed) * 1000) / 10 : 0; return { ...x, latest_latitude: empLoc.employee_latitude || '', latest_longitude: empLoc.employee_longitude || '', latest_location_at: empLoc.employee_location_captured_at || '', latest_location_source: empLoc.employee_location_source || '', unique_numbers: x.unique_numbers.size, aht_seconds: aht, conversion_percent: conv, early_cut_percent: x.dialed ? Math.round((x.employee_cut_suspect / x.dialed) * 1000) / 10 : 0, score: (x.connected * 5) + Math.round(x.talktime_seconds / 60) + x.dialed - (x.employee_cut_suspect * 3) - Math.round(x.suspicious_score / 20) }; }).sort((a, b) => b.score - a.score);
  const candidate_daily = [...byCandidateDay.values()].map((x) => ({ ...x, employees: [...x.employees].join(', ') })).sort((a, b) => b.calls - a.calls).slice(0, 300);
  const summaryMetrics = aggregateCallRows(rows);
  const baseSummary = reportSummaryFromRows(rows);
  const summary = { ...baseSummary, dialed: baseSummary.dialed_calls, connected: baseSummary.connected_calls, not_connected: baseSummary.not_connected_calls, outgoing: baseSummary.outgoing_calls, incoming: baseSummary.incoming_calls, missed: baseSummary.missed_calls, callbacks_done: rows.filter((x) => low(x.callback_status) === 'done').length, callbacks_pending: rows.filter((x) => (callMetricForRow(x).missed_calls_count > 0) && low(x.callback_status) !== 'done').length, idle_seconds: rows.reduce((s, x) => s + int(x.idle_seconds), 0), employee_cut_suspect: rows.filter((x) => String(x.employee_cut_suspect || '') === '1' || low(x.disconnect_by).includes('employee')).length, short_ring: rows.filter((x) => String(x.early_cut_flag || '') === '1').length, candidate_no_answer_likely: rows.filter((x) => low(x.disconnect_by).includes('candidate_no_answer')).length, suspicious_call_score: rows.reduce((s, x) => s + int(x.suspicious_score, 0), 0), total_employees: performers.length };
  const leaders = { cleanest: [...performers].sort((a, b) => (a.employee_cut_suspect - b.employee_cut_suspect) || (b.connected - a.connected))[0] || null, highest_risk: [...performers].sort((a, b) => b.employee_cut_suspect - a.employee_cut_suspect || b.suspicious_score - a.suspicious_score)[0] || null, overall: performers[0] || null, top_dialed: [...performers].sort((a, b) => b.dialed - a.dialed)[0] || null, top_talktime: [...performers].sort((a, b) => b.talktime_seconds - a.talktime_seconds)[0] || null, top_conversion: [...performers].sort((a, b) => b.conversion_percent - a.conversion_percent)[0] || null, best_aht: [...performers].filter((x) => x.connected > 0).sort((a, b) => b.aht_seconds - a.aht_seconds)[0] || null };
  res.set('Cache-Control', 'private, max-age=10');
  res.json({ ok: true, generated_at: nowIso(), manual_refresh: true, sync_mode: 'manual report mode', summary, leaders, performers, candidate_daily, employee_options: employeeOptions, items: rows.slice(0, 700), filters: { from: from ? new Date(from).toISOString() : '', to: to ? new Date(to).toISOString() : '' } });
}
async function mobileOpenProfileRequest(req, res) {
  const d = await needDevice(req, res);
  if (!d) return;
  const candidateId = String(req.body?.candidate_id || req.body?.candidateId || '').trim();
  const queueItemId = String(req.body?.queue_item_id || req.body?.queueItemId || '').trim();
  const sid = String(req.body?.session_id || '').trim();
  if (!candidateId && !queueItemId) return res.status(400).json({ ok: false, message: 'candidate_id required' });
  const ses = sid ? await find('dialer_sessions', 'session_id', sid) : visibleRunningSessions(await all('dialer_sessions')).filter((s) => sessionMatchesDevice(s, d))[0];
  if (!ses || !sessionMatchesDevice(ses, d)) return res.status(404).json({ ok: false, message: 'Assigned CRM session not found' });
  let q = null;
  const items = (await queueForSessionId(String(ses.session_id), 250));
  if (queueItemId) q = items.find((item) => String(item.queue_item_id) === queueItemId) || null;
  if (!q && candidateId) q = items.find((item) => String(item.candidate_id) === candidateId) || null;
  const cid = q?.candidate_id || candidateId;
  const ver = commandVersion();
  const patch = {
    crm_open_profile_candidate_id: cid,
    crm_open_profile_queue_item_id: q?.queue_item_id || queueItemId,
    crm_open_profile_request_version: ver,
    crm_open_profile_requested_at: nowIso(),
    crm_open_profile_source: 'mobile_button',
    live_status: `CRM profile open requested: ${q?.candidate_name || cid}`,
    updated_at: nowIso()
  };
  const up = await upd('dialer_sessions', 'session_id', ses.session_id, patch);
  await notify(ses.owner_user_id || ses.assigned_user_id || d.user_id, 'Open profile requested', `${d.employee_name || d.username || 'Mobile'} requested CRM profile ${q?.candidate_name || cid}`, 'dialer', JSON.stringify({ open_path: `/candidate/${encodeURIComponent(cid)}`, candidate_id: cid, source: 'mobile_open_profile' }));
  cache.at = 0;
  if (!up) return res.status(409).json({ ok: false, message: 'Run latest Supabase SQL once to enable CRM open-profile requests' });
  res.json({ ok: true, candidate_id: cid, request_version: ver, session: compactSession(up) });
}

async function mobileTaskCreate(req, res) {
  const d = await needDevice(req, res);
  if (!d) return;
  const title = String(req.body?.title || req.body?.task || '').trim();
  if (!title) return res.status(400).json({ ok: false, message: 'Task title required' });
  pruneMobileTaskCreateCache();
  const dedupeKey = mobileTaskDedupeKey(d, req.body || {});
  const cached = readMobileTaskCreateCache(dedupeKey);
  if (cached?.item) return res.json({ ok: true, item: cached.item, duplicate_blocked: true });
  if (cached?.promise) {
    const item = await cached.promise;
    return res.json({ ok: true, item, duplicate_blocked: true });
  }
  const rows = await all('tasks');
  const due = String(req.body?.due_date || req.body?.due_at || '').trim() || new Date().toISOString().slice(0, 10);
  const priorityRaw = String(req.body?.priority || 'Normal').trim();
  const priority = /high|urgent|important/i.test(priorityRaw) ? 'High' : /low/i.test(priorityRaw) ? 'Low' : 'Normal';
  const item = {
    task_id: nextId('T', rows, 'task_id'),
    title,
    description: String(req.body?.description || '').trim(),
    assigned_to_user_id: String(d.user_id || ''),
    assigned_to_name: String(d.employee_name || d.username || ''),
    assigned_to_code: String(d.username || ''),
    assigned_by_user_id: String(d.user_id || ''),
    assigned_by_name: String(d.employee_name || d.username || 'Mobile'),
    status: 'Open',
    priority,
    due_date: due,
    recurring_enabled: '0',
    recurring_type: '',
    recurring_interval_minutes: '',
    created_at: nowIso(),
    updated_at: nowIso()
  };
  const createPromise = (async () => {
    await ins('tasks', item);
    await notify(d.user_id, 'Task added', title, 'task', JSON.stringify({ open_path: '/tasks', task_id: item.task_id, priority }));
    return item;
  })();
  mobileTaskCreateDedupCache.set(dedupeKey, { at: Date.now(), promise: createPromise });
  try {
    const savedItem = await createPromise;
    mobileTaskCreateDedupCache.set(dedupeKey, { at: Date.now(), item: savedItem });
    res.json({ ok: true, item: savedItem });
  } catch (error) {
    mobileTaskCreateDedupCache.delete(dedupeKey);
    res.status(500).json({ ok: false, message: error?.message || 'Task save failed' });
  }
}

async function mobileWorkItems(req, res) { const d = await needDevice(req, res); if (!d) return; const uid = String(d.user_id || ''), un = String(d.username || ''); const unread = (await all('notifications')).filter((n) => (String(n.user_id) === uid || String(n.username || '') === un) && low(n.status || 'unread') !== 'read').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30); const tasks = (await all('tasks')).filter((t) => String(t.assigned_to_user_id || t.assigned_to || t.user_id || t.owner_user_id || '') === uid || String(t.assigned_username || t.assigned_to_code || t.username || '') === un).sort((a, b) => String(b.due_at || b.followup_date || b.created_at).localeCompare(String(a.due_at || a.followup_date || a.created_at))).slice(0, 30); const followups = (await all('candidates')).filter((c) => String(c.recruiter_code || c.assigned_to || c.created_by_username || '') === un || String(c.recruiter_id || c.user_id || '') === uid).filter((c) => String(c.followup_date || c.next_followup_date || c.next_follow_up || '').trim()).sort((a, b) => String(b.followup_date || b.next_followup_date || '').localeCompare(String(a.followup_date || a.next_followup_date || ''))).slice(0, 30); res.json({ ok: true, view_only: true, poll_after_seconds: 300, notifications: unread, tasks, followups, reminders: tasks.filter((t) => low(t.type || t.category || '').includes('remind') || String(t.reminder_at || '').trim()) }); }
async function mobileLocationPing(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  const loc = validLocationFromBody(req.body || {});
  if (!loc) return res.status(400).json({ ok: false, message: 'Valid employee location not received' });
  const last = await latestLocationForEmployee(d.user_id || '', d.username || '').catch(() => null);
  const lastMs = parseTs(last?.captured_at || last?.created_at || '');
  const moved = last ? distanceMeters(last, loc) : 999999;
  const tooSoonSamePlace = lastMs && (Date.now() - lastMs < 15 * 60 * 1000) && moved < 200;
  if (tooSoonSamePlace) {
    await touchMobileDevice(d).catch(() => {});
    return res.json({ ok: true, skipped_write: true, egress_safe: true, reason: 'same_place_under_15_min_200m', poll_after_seconds: 900 });
  }
  const row = {
    location_id: rid('LOC'), device_id: d.device_id || '', device_token: d.device_token || '',
    employee_user_id: d.user_id || '', employee_username: d.username || '', employee_name: d.employee_name || d.username || '',
    latitude: loc.latitude, longitude: loc.longitude, accuracy_meters: loc.accuracy_meters, provider: loc.provider,
    captured_at: loc.captured_at, sync_mode: String(req.body?.sync_mode || 'egress_safe_15m_or_200m'), app_version: String(req.body?.app_version || ''),
    created_at: nowIso(), updated_at: nowIso()
  };
  await ins('employee_locations', row).catch(() => {});
  await attachLocationToDeviceAndLog(d, loc).catch(() => {});
  cache.at = 0;
  res.json({ ok: true, egress_safe: true, saved: true, location: { latitude: loc.latitude, longitude: loc.longitude, accuracy_meters: loc.accuracy_meters, captured_at: loc.captured_at }, poll_after_seconds: 900 });
}


function candidateHiddenForCallSync(row = {}) {
  const status = low(row.status || row.approval_status || row.all_details_sent || row.profile_status || '');
  const notes = low(`${row.notes || ''} ${row.data_notes || ''}`);
  return Boolean(String(row.deleted_at || '').trim())
    || ['deleted','__deleted__','archived','inactive'].includes(status)
    || notes.includes('[crm-deleted]');
}
function crmCandidateOnlyCallRows(rows = [], candidates = []) {
  const visible = (candidates || []).filter((c) => !candidateHiddenForCallSync(c));
  const ids = new Set(visible.map((c) => String(c.candidate_id || '').trim()).filter(Boolean));
  const phones = new Set(visible.map((c) => normalizeIndianPhone(c.phone || c.number || c.mobile || c.candidate_phone || '')).filter(Boolean));
  return (rows || []).filter((row) => {
    const cid = String(row.candidate_id || row.current_candidate_id || '').trim();
    const phone = normalizeIndianPhone(row.phone || row.number || row.mobile || row.candidate_phone || '');
    return Boolean((cid && ids.has(cid)) || (phone && phones.has(phone)));
  });
}
function candidateMatchesDeviceForCallSync(row = {}, d = {}) {
  if (!row || !d) return false;
  const uid = String(d.user_id || '').trim();
  const un = low(d.username || '');
  const emp = low(d.employee_name || '');
  const code = low(d.recruiter_code || d.employee_code || '');
  const rowUser = String(row.user_id || row.assigned_user_id || row.recruiter_user_id || row.owner_user_id || row.created_by_user_id || row.employee_user_id || '').trim();
  const rowUn = low(row.username || row.created_by_username || row.assigned_username || row.employee_username || '');
  const rowName = low(row.recruiter_name || row.employee_name || row.created_by_name || row.assigned_recruiter_name || row.assigned_to_name || '');
  const rowCode = low(row.recruiter_code || row.employee_no || row.employee_code || row.assigned_to || row.created_by_code || '');
  return (uid && rowUser === uid) || (un && rowUn === un) || (emp && rowName === emp) || (code && rowCode === code);
}
function chooseCandidateForPhoneSync(candidatesForPhone = [], raw = {}, d = {}) {
  const explicitCandidateId = String(raw.candidate_id || '').trim();
  const visible = (candidatesForPhone || []).filter((c) => !candidateHiddenForCallSync(c));
  if (explicitCandidateId) return visible.find((c) => String(c.candidate_id || '') === explicitCandidateId) || {};
  const assigned = visible.filter((c) => candidateMatchesDeviceForCallSync(c, d));
  const pool = assigned.length ? assigned : visible;
  if (!pool.length) return {};
  return pool.slice().sort((a, b) => {
    const at = parseTs(a.updated_at || a.created_at || '') || 0;
    const bt = parseTs(b.updated_at || b.created_at || '') || 0;
    return bt - at;
  })[0] || {};
}

function phoneCallFingerprint(phone = '') {
  const p = normalizeIndianPhone(phone || '');
  if (!p) return '';
  const secret = String(process.env.CALL_FINGERPRINT_SECRET || process.env.SESSION_SECRET || process.env.JWT_SECRET || 'career-crox-call-fingerprint-v1');
  return crypto.createHmac('sha256', secret).update(p).digest('hex');
}

function unmatchedFingerprintActivityId(d = {}, phone = '', when = '', direction = '') {
  const key = `${d.user_id || d.username || ''}|${phoneCallFingerprint(phone)}|${Date.parse(when) || when}|${direction}`;
  return `UCF-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 28)}`;
}

async function rememberUnmatchedCallFingerprint(d = {}, raw = {}, normalized = {}) {
  const phone = normalizeIndianPhone(normalized.phone || raw.phone || raw.number || '');
  const phoneHash = phoneCallFingerprint(phone);
  if (!phoneHash) return false;
  const when = String(normalized.when || raw.call_started_at || raw.date || raw.created_at || nowIso());
  const direction = String(normalized.direction || raw.direction || raw.type || 'Incoming');
  const activityId = unmatchedFingerprintActivityId(d, phone, when, direction);
  const existing = await find('activity_log', 'activity_id', activityId).catch(() => null);
  if (existing) return false;
  const status = String(normalized.status || raw.status || raw.call_status || 'Not Connected');
  const duration = int(normalized.duration_seconds ?? raw.duration_seconds ?? raw.talktime_seconds, 0);
  const payload = {
    phone_hash: phoneHash,
    call_started_at: when,
    call_ended_at: String(raw.call_ended_at || ''),
    direction,
    status,
    duration_seconds: duration,
    talktime_seconds: int(raw.talktime_seconds, status === 'Connected' ? duration : 0),
    source: 'android_phone_call_log_privacy_fingerprint',
    version: 'cc26_443',
  };
  await ins('activity_log', {
    activity_id: activityId,
    user_id: d.user_id || '',
    username: d.username || '',
    action_type: 'unmatched_call_fingerprint',
    candidate_id: '',
    metadata: JSON.stringify(payload),
    created_at: when || nowIso(),
  }).catch(() => null);
  return true;
}

async function reconcileUnmatchedCallFingerprints(d = {}, candidates = []) {
  const candidatesByHash = new Map();
  for (const c of candidates || []) {
    if (candidateHiddenForCallSync(c)) continue;
    const phone = normalizeIndianPhone(c.phone || c.number || c.mobile || c.candidate_phone || '');
    const hash = phoneCallFingerprint(phone);
    if (!hash) continue;
    if (!candidatesByHash.has(hash)) candidatesByHash.set(hash, []);
    candidatesByHash.get(hash).push(c);
  }
  if (!candidatesByHash.size) return 0;
  const uid = String(d.user_id || '').trim();
  const un = low(d.username || '');
  let fingerprints = [];
  try {
    if (store.pool && typeof store.query === 'function') {
      fingerprints = await store.query(`select * from public.activity_log
        where lower(coalesce(action_type,'')) = 'unmatched_call_fingerprint'
          and (($1 <> '' and user_id = $1) or ($2 <> '' and lower(coalesce(username,'')) = $2))
        order by created_at asc limit 5000`, [uid, un]);
    } else {
      fingerprints = (await all('activity_log')).filter((row) => low(row.action_type) === 'unmatched_call_fingerprint' && ((uid && String(row.user_id || '') === uid) || (un && low(row.username || '') === un))).sort((a,b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).slice(0, 5000);
    }
  } catch { fingerprints = []; }
  let reconciled = 0;
  for (const fp of fingerprints) {
    let meta = {};
    try { meta = JSON.parse(fp.metadata || '{}') || {}; } catch { meta = {}; }
    const pool = candidatesByHash.get(String(meta.phone_hash || '')) || [];
    if (!pool.length) continue;
    const candidate = chooseCandidateForPhoneSync(pool, {}, d);
    if (!candidate?.candidate_id) continue;
    const phone = normalizeIndianPhone(candidate.phone || candidate.number || candidate.mobile || candidate.candidate_phone || '');
    if (!phone) continue;
    const when = String(meta.call_started_at || fp.created_at || nowIso());
    const dirRaw = String(meta.direction || meta.status || 'Incoming');
    const direction = normalizeDirection(dirRaw);
    const rawStatus = String(meta.status || '');
    const duration = int(meta.duration_seconds || meta.talktime_seconds, 0);
    const status = direction === 'Missed' || isMissedStatus(rawStatus) ? 'Missed' : (!isNegativeCallStatus(rawStatus) && (isConnectedStatus(rawStatus) || duration > 0) ? 'Connected' : (direction === 'Incoming' ? 'Incoming' : 'Not Connected'));
    const talk = finalTalktime(status, duration, meta.talktime_seconds);
    const callId = `FPREC-${crypto.createHash('sha256').update(`${fp.activity_id}|${candidate.candidate_id}`).digest('hex').slice(0, 28)}`;
    const existing = await find('call_logs', 'call_log_id', callId).catch(() => null);
    const row = {
      call_log_id: callId,
      session_id: '', queue_item_id: '',
      candidate_id: String(candidate.candidate_id || ''),
      candidate_name: String(candidate.full_name || candidate.candidate_name || ''),
      phone,
      client: String(candidate.client || candidate.client_name || ''),
      process: String(candidate.process || candidate.jd_name || ''),
      role: String(candidate.role || candidate.job_role || ''),
      location: String(candidate.location || candidate.preferred_location || ''),
      source_profile_key: String(candidate.source_profile_key || ''),
      profile_number: String(candidate.profile_number || candidate.profile_no || ''),
      imn_candidate_id: String(candidate.imn_candidate_id || candidate.imn_id || ''),
      employee_user_id: d.user_id || '', employee_username: d.username || '', employee_name: d.employee_name || '',
      direction, status, call_started_at: when,
      call_ended_at: String(meta.call_ended_at || (duration > 0 ? new Date((Date.parse(when) || Date.now()) + duration * 1000).toISOString() : when)),
      answered_at: status === 'Connected' ? when : '',
      duration_seconds: duration, talktime_seconds: talk, ring_seconds: '0', idle_seconds: '0', notes: '',
      call_source: 'historical_candidate_reconciliation', source_mode: 'historical_candidate_reconciliation',
      recording_status: '', recording_url: '', recording_file_id: '',
      synced_from: 'privacy_fingerprint_candidate_match', crm_tracked_number: '1', stats_counted: existing?.stats_counted || '0',
      created_at: existing?.created_at || nowIso(), updated_at: nowIso(),
    };
    if (existing) await upd('call_logs', 'call_log_id', callId, row); else await ins('call_logs', row);
    if (String(row.stats_counted) !== '1') {
      await updateDailyStatsForUser(d, dailyStatsMetricForCall(row), when);
      await upd('call_logs', 'call_log_id', callId, { stats_counted: '1', updated_at: nowIso() }).catch(() => {});
    }
    const nextMeta = { ...meta, reconciled_at: nowIso(), candidate_id: candidate.candidate_id, call_log_id: callId };
    await upd('activity_log', 'activity_id', fp.activity_id, { action_type: 'reconciled_call_fingerprint', candidate_id: candidate.candidate_id, metadata: JSON.stringify(nextMeta) }).catch(() => {});
    reconciled += 1;
  }
  return reconciled;
}

async function syncPending(req, res) {
  const d = await needDevice(req, res); if (!d) return;
  const calls = Array.isArray(req.body?.calls) ? req.body.calls.slice(0, 250) : [];
  // CC725: old APKs can submit an empty sync repeatedly. Do not download
  // every candidate for each empty batch. Preserve historical fingerprint
  // reconciliation, checking for pending work with one narrow indexed query.
  const forceHistory=String(req.body?.reconcile_historical||'').toLowerCase()==='true';
  const historyKey=String(d.device_id||d.user_id||d.username||'');
  if(!syncPending.lastHistoryCheckByDevice)syncPending.lastHistoryCheckByDevice=new Map();
  const checkedAt=syncPending.lastHistoryCheckByDevice.get(historyKey)||0;
  const historyDue=forceHistory || calls.length>0 || !checkedAt
    || Date.now()-checkedAt>10*60*1000;
  let historyPending=false;
  if(historyDue){
    syncPending.lastHistoryCheckByDevice.set(historyKey,Date.now());
    if(store.pool){
      const existing=await pgRows(`select activity_id from public.activity_log
        where action_type='unmatched_call_fingerprint'
          and (($1 <> '' and user_id=$1) or ($2 <> '' and lower(coalesce(username,''))=$2))
        limit 1`,[String(d.user_id||''),low(d.username||'')]);
      historyPending=Boolean(existing && existing.length);
    }else historyPending=(await all('activity_log')).some(r=>r.action_type==='unmatched_call_fingerprint'
      && (String(r.user_id||'')===String(d.user_id||'')||low(r.username||'')===low(d.username||'')));
  }
  let candidates=[];
  if(historyPending){
    // Only this explicit historical recovery needs the full phone mapping.
    candidates=await all('candidates');
  }else if(calls.length&&store.pool){
    const forms=[...new Set(calls.flatMap(r=>{const p=normalizeIndianPhone(r.phone||r.number||'');return p?[p,`91${p}`,`+91${p}`]:[]}))];
    if(forms.length){
      const rows=await pgRows(`select * from public.candidates
        where phone=any($1::text[]) or number=any($1::text[])
        order by candidate_id limit 500`,[forms]);
      if(rows===null)return res.status(503).json({ok:false,message:'Call sync candidate lookup is temporarily unavailable.'});
      candidates=rows;
    }
  }else if(calls.length)candidates=await all('candidates');
  const byPhone = new Map();
  for (const c of candidates) {
    const p = normalizeIndianPhone(c.phone || c.number || c.mobile || c.candidate_phone || '');
    if (!p) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(c);
  }
  const historicalReconciled = historyPending ? await reconcileUnmatchedCallFingerprints(d, candidates) : 0;
  const out = [];
  let storedCount = 0;
  let skippedCount = 0;
  for (const raw of calls) {
    const phone = normalizeIndianPhone(raw.phone || raw.number || '');
    if (!phone) continue;
    const when = String(raw.call_started_at || raw.date || raw.created_at || nowIso());
    const direction = normalizeDirection(raw.direction || raw.type || raw.status || 'Incoming');
    const rawStatus = String(raw.status || raw.call_status || raw.outcome || '');
    const rawDuration = int(raw.duration_seconds || raw.talktime_seconds, 0);
    const status = direction === 'Missed' || isMissedStatus(rawStatus) ? 'Missed' : (!isNegativeCallStatus(rawStatus) && (isConnectedStatus(rawStatus) || rawDuration > 0) ? 'Connected' : (direction === 'Incoming' ? 'Incoming' : 'Not Connected'));
    const candidatesForPhone = byPhone.get(phone) || [];
    const explicitCandidateId = String(raw.candidate_id || '').trim();
    const candidate = chooseCandidateForPhoneSync(candidatesForPhone, raw, d);
    const requestedCallId = String(raw.call_log_id || `SYNC-${phone}-${Date.parse(when) || Date.now()}-${direction}`);
    const isAndroidPhoneLog = requestedCallId.startsWith('PHONELOG-') || String(raw.synced_from || '').includes('android_phone_call_log');
    const directExisting = await find('call_logs', 'call_log_id', requestedCallId).catch(() => null);
    // CC26_357: Android CallLog rows have a unique PHONELOG timestamp id.
    // Do not merge separate same-number calls within +/-3 minutes, otherwise two quick calls become one old row in Call Review.
    const nearbyExisting = directExisting || (isAndroidPhoneLog ? null : await findNearbyCallLogForSync(phone, when, d));
    const callId = String(nearbyExisting?.call_log_id || requestedCallId);
    const existing = nearbyExisting || directExisting || null;
    const matchedCrmCandidate = !!candidate.candidate_id;
    const rawCandidateId = String(raw.candidate_id || existing?.candidate_id || explicitCandidateId || '').trim();
    const crmTracked = matchedCrmCandidate || countableCrmCandidateId(rawCandidateId) || String(raw.crm_tracked_number || raw.crm_tracked || existing?.crm_tracked_number || '') === '1';
    if (!crmTracked) {
      if (isAndroidPhoneLog) await rememberUnmatchedCallFingerprint(d, raw, { phone, when, direction, status, duration_seconds: rawDuration });
      skippedCount += 1;
      out.push({ status: 'Skipped', phone, reason: 'No CRM candidate/profile match. Personal number is not stored/countable; only a privacy-safe fingerprint is kept for future CRM re-match.' });
      continue;
    }
    const talk = finalTalktime(status, int(raw.duration_seconds || raw.talktime_seconds, 0), raw.talktime_seconds);
    const syncSource = matchedCrmCandidate ? 'mobile_call_log_sync_candidate_match' : 'mobile_call_log_sync_crm_tracked';
    const row = { call_log_id: callId, session_id: String(existing?.session_id || raw.session_id || ''), queue_item_id: String(existing?.queue_item_id || raw.queue_item_id || ''), candidate_id: String((matchedCrmCandidate ? candidate.candidate_id : '') || (countableCrmCandidateId(existing?.candidate_id) ? existing.candidate_id : '') || raw.candidate_id || ''), candidate_name: String((matchedCrmCandidate ? (candidate.full_name || candidate.candidate_name) : '') || existing?.candidate_name || raw.candidate_name || ''), phone, client: String(existing?.client || raw.client || candidate.client || candidate.client_name || ''), process: String(existing?.process || raw.process || candidate.process || candidate.jd_name || ''), role: String(existing?.role || raw.role || candidate.role || candidate.job_role || ''), location: String(existing?.location || raw.location || candidate.location || candidate.preferred_location || ''), source_profile_key: String(existing?.source_profile_key || raw.source_profile_key || ''), profile_number: String(existing?.profile_number || raw.profile_number || candidate.profile_number || candidate.profile_no || ''), imn_candidate_id: String(existing?.imn_candidate_id || raw.imn_candidate_id || candidate.imn_candidate_id || candidate.imn_id || ''), employee_user_id: existing?.employee_user_id || d.user_id || '', employee_username: existing?.employee_username || d.username || '', employee_name: existing?.employee_name || d.employee_name || '', employee_latitude: raw.employee_latitude || existing?.employee_latitude || '', employee_longitude: raw.employee_longitude || existing?.employee_longitude || '', employee_location_accuracy_meters: raw.employee_location_accuracy_meters || existing?.employee_location_accuracy_meters || '', employee_location_captured_at: raw.employee_location_captured_at || existing?.employee_location_captured_at || '', employee_location_source: raw.employee_location_source || existing?.employee_location_source || '', direction, status, call_started_at: existing?.call_started_at || when, call_ended_at: String(raw.call_ended_at || existing?.call_ended_at || when), answered_at: status === 'Connected' ? (existing?.answered_at || when) : '', duration_seconds: int(raw.duration_seconds || raw.talktime_seconds, 0), talktime_seconds: talk, ring_seconds: int(raw.ring_seconds, existing?.ring_seconds || 0), idle_seconds: int(existing?.idle_seconds || 0), notes: String(raw.notes || existing?.notes || '').slice(0, 500), call_source: existing?.call_source || syncSource, source_mode: existing?.source_mode || syncSource, recording_status: existing?.recording_status || '', recording_url: existing?.recording_url || '', recording_file_id: existing?.recording_file_id || '', synced_from: syncSource, crm_tracked_number: '1', stats_counted: existing?.stats_counted || '0', created_at: existing?.created_at || nowIso(), updated_at: nowIso() };
    if (existing) await upd('call_logs', 'call_log_id', callId, row); else await ins('call_logs', row);
    if (crmTracked && String(row.stats_counted) === '1' && existing) {
      const deltaPatch = dailyStatsMetricDelta(existing, row);
      if (Object.keys(deltaPatch).length) await updateDailyStatsForUser(d, deltaPatch, row.call_started_at || row.created_at || when);
    } else if (crmTracked) {
      const statsPatch = dailyStatsMetricForCall(row);
      await updateDailyStatsForUser(d, statsPatch, row.call_started_at || row.created_at || when);
      await upd('call_logs', 'call_log_id', callId, { stats_counted: '1', updated_at: nowIso() }).catch(() => {});
      try { await upd('presence', 'user_id', d.user_id, { last_call_dial_at: row.call_started_at || nowIso(), last_call_candidate_id: row.candidate_id || '', last_seen_at: nowIso(), last_activity_at: nowIso(), last_activity_source: 'mobile_call_log_sync', updated_at: nowIso() }); } catch {}
    }
    storedCount += 1;
    out.push({ call_log_id: callId, status, phone });
  }
  cache.at = 0;
  await reconcileTodayCallStatsForDevice(d, candidates).catch(() => null);
  const todaySummary = await mobileTodayCallSummary(d).catch(() => null);
  res.json({ ok: true, synced: storedCount, skipped: skippedCount, historical_reconciled: historicalReconciled, ...(todaySummary ? { today_summary: todaySummary } : {}), results: out });
}



function egressDefaults() {
  return {
    ok: true,
    budget_date: istDateKey(Date.now()),
    mode: 'manual_safe',
    today_percent: 0,
    target_percent: Number(process.env.EGRESS_TARGET_PERCENT || 2),
    warning_percent: Number(process.env.EGRESS_WARNING_PERCENT || 2),
    hard_safe_percent: Number(process.env.EGRESS_HARD_SAFE_PERCENT || 2.5),
    danger_percent: Number(process.env.EGRESS_DANGER_PERCENT || 3),
    auto_refresh_locked: true,
    full_table_refresh_locked: true,
    realtime_big_tables_locked: true,
    mobile_queue_cache_required: true,
    last_updated_at: nowIso(),
    note: 'Manual CRM traffic guard. Supabase exact dashboard percent is entered manually by manager; CRM will not poll billing APIs automatically.'
  };
}
async function egressGuardStatus(req, res) {
  const date = istDateKey(Date.now());
  const base = egressDefaults();
  const saved = await find('egress_budget_daily', 'budget_date', date).catch(() => null);
  const payload = { ...base, ...(saved || {}) };
  const p = Number(payload.today_percent || 0);
  payload.warning = p >= Number(payload.warning_percent || 2);
  payload.heavy_sections_locked = p >= Number(payload.hard_safe_percent || 2.5) || low(payload.mode).includes('lock');
  payload.danger = p >= Number(payload.danger_percent || 3);
  payload.rules = [
    'No blind full-table polling; call tables refresh only after a tiny in-memory call-change signal',
    'Dashboard/reports/candidates manual refresh only',
    'Android app uses tiny command-version polling',
    'Queue is cached locally on mobile',
    'Realtime disabled for large tables'
  ];
  return res.json(payload);
}
async function updateEgressGuard(req, res) {
  const date = istDateKey(Date.now());
  const defaults = egressDefaults();
  const row = {
    ...defaults,
    budget_date: date,
    today_percent: String(req.body?.today_percent ?? req.body?.percent ?? defaults.today_percent).replace('%','').trim() || '0',
    mode: String(req.body?.mode || defaults.mode),
    updated_by_user_id: req.user?.user_id || '',
    updated_by_username: uname(req.user || {}),
    last_updated_at: nowIso(),
    updated_at: nowIso(),
    created_at: nowIso()
  };
  const existing = await find('egress_budget_daily', 'budget_date', date).catch(() => null);
  if (existing) await upd('egress_budget_daily', 'budget_date', date, { ...existing, ...row, created_at: existing.created_at || row.created_at });
  else await ins('egress_budget_daily', row);
  return egressGuardStatus(req, res);
}

function inRange(row, fromMs, toMs) {
  const t = parseTs(row.call_started_at || row.created_at || row.updated_at || '');
  if (!t) return true;
  if (fromMs && t < fromMs) return false;
  if (toMs && t >= toMs) return false;
  return true;
}

function parseDateOnlyIst(value = '', endOfDay = false) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 0;
  const start = Date.parse(`${raw}T00:00:00.000Z`) - IST_OFFSET_MS;
  return endOfDay ? start + (24 * 60 * 60 * 1000) : start;
}

function resolveFraudWindow(query = {}) {
  const today = todayIstBounds();
  const now = Date.now();
  const fromRaw = String(query.date_from || '').trim();
  const toRaw = String(query.date_to || '').trim();
  const preset = low(query.preset || query.range_preset || (fromRaw || toRaw ? 'custom' : 'today'));
  if (['last_30_min', 'last_30_minutes', '30_min', '30m'].includes(preset)) return { preset: 'last_30_min', label: 'Last 30 min', fromMs: now - (30 * 60 * 1000), toMs: now + 1000, date_from: today.key, date_to: today.key };
  if (['last_1_hour', '1_hour', 'one_hour', '1h'].includes(preset)) return { preset: 'last_1_hour', label: 'Last 1 hour', fromMs: now - (60 * 60 * 1000), toMs: now + 1000, date_from: today.key, date_to: today.key };
  if (['last_2_hour', 'last_2_hours', '2_hour', '2h'].includes(preset)) return { preset: 'last_2_hour', label: 'Last 2 hours', fromMs: now - (2 * 60 * 60 * 1000), toMs: now + 1000, date_from: today.key, date_to: today.key };
  if (['last_5_hour', 'last_5_hours', '5_hour', '5h'].includes(preset)) return { preset: 'last_5_hour', label: 'Last 5 hours', fromMs: now - (5 * 60 * 60 * 1000), toMs: now + 1000, date_from: today.key, date_to: today.key };
  if (preset === 'custom' || fromRaw || toRaw) {
    const fromMs = parseDateOnlyIst(fromRaw, false) || today.start;
    const toMs = parseDateOnlyIst(toRaw || fromRaw, true) || today.end;
    return { preset: 'custom', label: `${fromRaw || today.key} to ${toRaw || fromRaw || today.key}`, fromMs, toMs, date_from: fromRaw || today.key, date_to: toRaw || fromRaw || today.key };
  }
  return { preset: preset === 'whole_day' ? 'whole_day' : 'today', label: preset === 'whole_day' ? 'Whole day' : 'Today', fromMs: today.start, toMs: today.end, date_from: today.key, date_to: today.key };
}

function employeeMatches(row = {}, employeeFilter = '') {
  if (!employeeFilter) return true;
  return low(`${row.employee_name || ''} ${row.employee_username || ''} ${row.employee_user_id || ''} ${row.recruiter_code || ''}`).includes(employeeFilter);
}

function buildEmployeeOptions(users = []) {
  return users
    .filter((u) => !['0','false','no','inactive'].includes(low(u.is_active ?? '1')))
    .map((u) => ({
      user_id: u.user_id || '',
      username: u.username || '',
      full_name: u.full_name || u.name || '',
      role: u.role || u.designation || '',
      recruiter_code: u.recruiter_code || '',
      value: u.username || u.user_id || u.full_name || '',
      label: `${u.full_name || u.name || u.username || u.user_id || 'Employee'}${u.username ? ` (${u.username})` : ''}`,
    }))
    .filter((u) => u.value)
    .sort((a, b) => String(a.full_name || a.username).localeCompare(String(b.full_name || b.username)));
}



function reportEmployeeKey(row = {}) {
  return low(row.employee_user_id || row.employee_username || row.employee_name || row.created_by_username || row.created_by_name || '');
}

function reportPhoneKey(row = {}) {
  return normalizeIndianPhone(row.phone || row.number || row.mobile || '');
}

function reportTimestamp(row = {}) {
  return parseTs(row.call_started_at || row.created_at || row.updated_at || row.call_ended_at || '') || 0;
}

function isAndroidPhoneLogRow(row = {}) {
  return String(row.call_log_id || '').startsWith('PHONELOG-') || lower(row.synced_from || row.call_source || row.source_mode || '').includes('android_phone_call_log');
}

function isLivePlaceholderRow(row = {}) {
  const status = lower(row.status || row.call_status || row.call_quality || '');
  return status.includes('calling') && !String(row.call_ended_at || '').trim() && !isAndroidPhoneLogRow(row);
}

function reportRowScore(row = {}) {
  let score = 0;
  if (isAndroidPhoneLogRow(row)) score += 100;
  if (String(row.call_log_available || '') === '1') score += 35;
  if (String(row.call_ended_at || '').trim()) score += 20;
  if (!lower(row.status || '').includes('calling')) score += 16;
  if (Number(row.duration_seconds || row.talktime_seconds || 0) > 0) score += 12;
  if (String(row.candidate_id || '').trim()) score += 5;
  score += Math.min(9, Math.floor((reportTimestamp({ call_started_at: row.updated_at || row.call_ended_at || row.created_at || '' }) || 0) / 100000000000));
  return score;
}

function sameReportPhysicalCall(a = {}, b = {}) {
  const aPhone = reportPhoneKey(a);
  const bPhone = reportPhoneKey(b);
  if (!aPhone || aPhone !== bPhone) return false;
  const aEmp = reportEmployeeKey(a);
  const bEmp = reportEmployeeKey(b);
  if (aEmp && bEmp && aEmp !== bEmp) return false;
  const at = reportTimestamp(a);
  const bt = reportTimestamp(b);
  if (!at || !bt) return false;
  const diff = Math.abs(at - bt);
  // Do not merge two real Android phone-log rows. Two quick cut calls must remain two calls.
  if (isAndroidPhoneLogRow(a) && isAndroidPhoneLogRow(b)) return false;
  if (String(a.call_log_id || '') && String(a.call_log_id || '') === String(b.call_log_id || '')) return true;
  if ((isLivePlaceholderRow(a) || isLivePlaceholderRow(b)) && diff <= 90000) return true;
  if ((isAndroidPhoneLogRow(a) || isAndroidPhoneLogRow(b)) && diff <= 45000) return true;
  return false;
}

function dedupeReportCallRows(inputRows = []) {
  const byId = new Map();
  for (const row of inputRows || []) {
    const id = String(row.call_log_id || '').trim();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing || reportRowScore(row) >= reportRowScore(existing)) byId.set(id, row);
  }
  const rows = [...(inputRows || [])].filter((row) => {
    const id = String(row.call_log_id || '').trim();
    return !id || byId.get(id) === row;
  });
  rows.sort((a, b) => reportTimestamp(a) - reportTimestamp(b));
  const out = [];
  for (const row of rows) {
    const idx = out.findIndex((old) => sameReportPhysicalCall(old, row));
    if (idx >= 0) {
      if (reportRowScore(row) >= reportRowScore(out[idx])) out[idx] = { ...out[idx], ...row };
    } else {
      out.push(row);
    }
  }
  return out.sort((a, b) => reportTimestamp(b) - reportTimestamp(a));
}

function reportSummaryFromRows(rows = []) {
  const metrics = aggregateCallRows(rows);
  const phones = new Set((rows || []).map((x) => reportPhoneKey(x)).filter(Boolean));
  return {
    total_calls: rows.length,
    dialed_calls: Number(metrics.outgoing_calls_count || 0) || 0,
    connected_calls: Number(metrics.connected_calls_count || 0) || 0,
    talktime_seconds: Number(metrics.talktime_seconds || 0) || 0,
    missed_calls: Number(metrics.missed_calls_count || 0) || 0,
    incoming_calls: Number(metrics.incoming_calls_count || 0) || 0,
    outgoing_calls: Number(metrics.outgoing_calls_count || 0) || 0,
    unique_calls: phones.size,
    unique_numbers: phones.size,
    not_connected_calls: Number(metrics.not_connected_calls_count || 0) || 0,
  };
}

async function requestPhoneLogSyncForCallReview(employeeFilter = '') {
  const filter = low(employeeFilter || '');
  const devices = (await all('mobile_devices')).filter((d) => {
    if (!isDeviceCallable(d)) return false;
    if (!filter) return true;
    return low(`${d.employee_name || ''} ${d.username || ''} ${d.user_id || ''} ${d.recruiter_code || ''}`).includes(filter);
  });
  const stamp = nowIso();
  const command = 'sync_phone_logs';
  let requested = 0;
  for (const d of devices.slice(0, 80)) {
    const ver = commandVersion();
    try {
      const sessions = await currentSessionsForDevice(d, 1);
      const existing = sessions[0] || null;
      if (existing?.session_id) {
        await upd('dialer_sessions', 'session_id', existing.session_id, {
          status: existing.status || 'waiting_for_mobile_sync',
          live_status: 'Call Review requested latest phone log sync',
          mobile_command: command,
          command_type: command,
          command_version: ver,
          updated_at: stamp,
          call_source: existing.call_source || 'call_review_phone_log_sync',
          source_mode: existing.source_mode || 'call_review_phone_log_sync',
        });
      } else {
        await ins('dialer_sessions', {
          session_id: rid('DSYNC'),
          owner_user_id: d.user_id || '',
          owner_username: d.username || '',
          assigned_user_id: d.user_id || '',
          assigned_username: d.username || '',
          device_id: d.device_id || '',
          device_token: d.device_token || '',
          section: 'call_review_phone_log_sync',
          status: 'waiting_for_mobile_sync',
          live_status: 'Call Review requested latest phone log sync',
          mobile_command: command,
          command_type: command,
          command_version: ver,
          total_items: '0',
          completed_items: '0',
          current_queue_item_id: '',
          current_candidate_id: '',
          current_candidate_name: '',
          current_phone: '',
          call_source: 'call_review_phone_log_sync',
          source_mode: 'call_review_phone_log_sync',
          created_at: stamp,
          updated_at: stamp,
        });
      }
      requested += 1;
    } catch {}
  }
  return { requested, devices_considered: devices.length, requested_at: stamp };
}


async function fraudReport(req, res) {
  const r = role(req.user || {});
  if (!['admin','manager','tl'].includes(r)) return res.status(403).json({ ok: false, message: 'Leadership access required.' });
  const window = resolveFraudWindow(req.query || {});
  const fromMs = window.fromMs;
  const toMs = window.toMs;
  const employeeFilter = low(req.query.employee || '');
  const minScore = int(req.query.min_score || 0, 0);
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const empLike = `%${employeeFilter}%`;
  const employeeOptions = buildEmployeeOptions(await all('users'));
  const syncRequested = ['1','true','yes','force'].includes(low(req.query.force_phone_sync || req.query.sync_phone_logs || req.query.mobile_sync || ''));
  const syncRequest = syncRequested ? await requestPhoneLogSyncForCallReview(employeeFilter) : { requested: 0, devices_considered: 0, requested_at: '' };

  let qualityRows = await pgRows(`select * from "call_quality_events"
    where coalesce(call_started_at, created_at, '') >= $1 and coalesce(call_started_at, created_at, '') < $2
      and ($3 = '' or lower(coalesce(employee_name,'') || ' ' || coalesce(employee_username,'') || ' ' || coalesce(employee_user_id,'')) like $4)
    order by coalesce(nullif(call_started_at,''), nullif(created_at,''), nullif(updated_at,''), '') desc limit 700`, [fromIso, toIso, employeeFilter, empLike]);
  if (!qualityRows) qualityRows = (await all('call_quality_events')).filter((x) => inRange(x, fromMs, toMs)).filter((x) => employeeMatches(x, employeeFilter));

  let callRows = await pgRows(`select * from "call_logs"
    where coalesce(call_started_at, created_at, '') >= $1 and coalesce(call_started_at, created_at, '') < $2
      and ($3 = '' or lower(coalesce(employee_name,'') || ' ' || coalesce(employee_username,'') || ' ' || coalesce(employee_user_id,'')) like $4)
    order by coalesce(nullif(call_started_at,''), nullif(created_at,''), nullif(updated_at,''), '') desc limit 700`, [fromIso, toIso, employeeFilter, empLike]);
  if (!callRows) callRows = (await all('call_logs')).filter((x) => inRange(x, fromMs, toMs)).filter((x) => employeeMatches(x, employeeFilter));
  callRows = crmCandidateOnlyCallRows(callRows, await all('candidates'));

  function reviewRow(x = {}, source = 'call_log') {
    const score = int(x.suspicious_score || (String(x.employee_cut_suspect) === '1' ? 70 : String(x.early_cut_flag) === '1' ? 35 : 0), 0);
    const callTime = x.call_started_at || x.created_at || x.updated_at || x.call_ended_at || '';
    const updateTime = x.updated_at || x.call_ended_at || x.created_at || x.call_started_at || '';
    const locationTime = x.employee_location_captured_at || x.latest_location_at || updateTime;
    return {
      ...x,
      event_id: x.event_id || x.call_quality_event_id || x.call_log_id || x.queue_item_id || rid('REV'),
      source,
      sort_ts: reportTimeMs({ call_started_at: callTime }),
      display_time_ist: formatIstDateTime(callTime),
      display_updated_ist: formatIstDateTime(updateTime),
      display_location_time_ist: formatIstDateTime(locationTime),
      call_log_id: x.call_log_id || '',
      candidate_name: x.candidate_name || x.candidate || x.name || x.candidate_id || '-',
      candidate_id: x.candidate_id || '',
      phone: normalizeIndianPhone(x.phone || x.number || ''),
      employee_user_id: x.employee_user_id || '',
      employee_username: x.employee_username || x.created_by_username || '',
      employee_name: x.employee_name || x.created_by_name || '',
      call_started_at: x.call_started_at || x.created_at || '',
      call_ended_at: x.call_ended_at || '',
      status: x.status || x.call_status || x.call_quality || (x.call_ended_at ? 'Completed' : 'Calling'),
      direction: x.direction || 'Outgoing',
      ring_seconds: int(x.ring_seconds || 0, 0),
      dial_hold_seconds: int(x.dial_hold_seconds || 0, 0),
      duration_seconds: int(x.duration_seconds || 0, 0),
      talktime_seconds: int(x.talktime_seconds || 0, 0),
      disconnect_by: x.disconnect_by || x.disconnect_actor_guess || '',
      call_quality: x.call_quality || '',
      early_cut_reason: x.early_cut_reason || '',
      employee_cut_suspect: String(x.employee_cut_suspect || '0'),
      early_cut_flag: String(x.early_cut_flag || '0'),
      suspicious_score: score,
      recording_status: x.recording_status || '',
      notes: x.notes || x.note || '',
      employee_latitude: x.employee_latitude || '',
      employee_longitude: x.employee_longitude || '',
      employee_location_accuracy_meters: x.employee_location_accuracy_meters || '',
      employee_location_captured_at: x.employee_location_captured_at || ''
    };
  }

  const merged = new Map();
  for (const row of callRows || []) {
    const item = reviewRow(row, 'call_log_live');
    const key = item.call_log_id || `${item.queue_item_id || ''}|${item.phone}|${item.call_started_at}`;
    merged.set(key, item);
  }
  for (const row of qualityRows || []) {
    const item = reviewRow(row, 'quality_event');
    const key = item.call_log_id || `${item.queue_item_id || item.event_id || ''}|${item.phone}|${item.call_started_at}`;
    merged.set(key, { ...(merged.get(key) || {}), ...item, source: merged.has(key) ? 'call_log_plus_quality' : item.source });
  }

  let rows = dedupeReportCallRows([...merged.values()])
    .filter((x) => int(x.suspicious_score || 0, 0) >= minScore)
    .sort((a, b) => (Number(b.sort_ts || reportTimeMs(b)) - Number(a.sort_ts || reportTimeMs(a))) || String(b.call_started_at || b.created_at || '').localeCompare(String(a.call_started_at || a.created_at || '')))
    .slice(0, 700);

  const employees = new Map();
  const summary = { ...reportSummaryFromRows(rows), employee_cut_suspect: 0, short_ring: 0, connected: 0, calling_live: 0, not_connected: 0, avg_risk: 0 };
  let riskSum = 0;
  for (const x of rows) {
    const key = String(x.employee_user_id || x.employee_username || x.employee_name || 'unknown');
    const cur = employees.get(key) || { employee_user_id: x.employee_user_id || '', employee_username: x.employee_username || '', employee_name: x.employee_name || '', total_calls: 0, dialed_calls: 0, connected_calls: 0, talktime_seconds: 0, missed_calls: 0, incoming_calls: 0, outgoing_calls: 0, unique_numbers_set: new Set(), unique_calls: 0, employee_cut_suspect: 0, short_ring: 0, connected: 0, calling_live: 0, not_connected: 0, risk_sum: 0, avg_risk: 0 };
    cur.total_calls += 1;
    cur.unique_numbers_set.add(x.phone || '');
    const metric = callMetricForRow(x);
    cur.dialed_calls += int(metric.outgoing_calls_count || 0);
    cur.outgoing_calls += int(metric.outgoing_calls_count || 0);
    cur.incoming_calls += int(metric.incoming_calls_count || 0);
    cur.missed_calls += int(metric.missed_calls_count || 0);
    cur.connected_calls += int(metric.connected_calls_count || 0);
    cur.talktime_seconds += int(metric.talktime_seconds || 0);
    const risk = int(x.suspicious_score || 0, 0); cur.risk_sum += risk; riskSum += risk;
    if (String(x.employee_cut_suspect) === '1' || low(x.disconnect_by).includes('employee')) { cur.employee_cut_suspect += 1; summary.employee_cut_suspect += 1; }
    if (String(x.early_cut_flag) === '1' || (int(x.ring_seconds,0) > 0 && int(x.ring_seconds,0) < GOOD_RING_SECONDS)) { cur.short_ring += 1; summary.short_ring += 1; }
    if (low(x.status).includes('calling')) { cur.calling_live += 1; summary.calling_live += 1; }
    else if (isConnectedStatus(x.status)) { cur.connected += 1; summary.connected += 1; }
    else if (low(x.status).includes('not')) { cur.not_connected += 1; summary.not_connected += 1; }
    employees.set(key, cur);
  }
  const employeeRows = [...employees.values()].map((x)=>{ const loc = rows.find((r) => (String(r.employee_user_id || r.employee_username || r.employee_name || 'unknown') === String(x.employee_user_id || x.employee_username || x.employee_name || 'unknown')) && (r.employee_latitude || r.employee_longitude)) || {}; return { ...x, unique_calls: x.unique_numbers_set ? x.unique_numbers_set.size : Number(x.unique_calls || 0), unique_numbers: x.unique_numbers_set ? x.unique_numbers_set.size : Number(x.unique_numbers || 0), unique_numbers_set: undefined, latest_latitude: loc.employee_latitude || '', latest_longitude: loc.employee_longitude || '', latest_location_at: loc.employee_location_captured_at || '', display_location_time_ist: loc.display_location_time_ist || formatIstDateTime(loc.employee_location_captured_at || loc.updated_at || loc.call_started_at || ''), avg_risk: x.total_calls ? Math.round(x.risk_sum / x.total_calls) : 0 }; }).sort((a,b)=>(b.calling_live-a.calling_live)||(b.employee_cut_suspect-a.employee_cut_suspect)||(b.short_ring-a.short_ring)||(b.avg_risk-a.avg_risk));
  summary.avg_risk = rows.length ? Math.round(riskSum / rows.length) : 0;
  summary.connected = summary.connected_calls;
  summary.not_connected = summary.not_connected_calls;
  summary.missed = summary.missed_calls;
  summary.incoming = summary.incoming_calls;
  summary.outgoing = summary.outgoing_calls;
  summary.dialed = summary.dialed_calls;
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  return res.json({ ok: true, live_call_review: true, auto_refresh_seconds: 0, signal_refresh: true, manual_refresh_only: false, forced_phone_sync: syncRequested, sync_request: syncRequest, last_refreshed_at: nowIso(), last_refreshed_ist: formatIstDateTime(nowIso()), range: { ...window, from_iso: fromIso, to_iso: toIso }, summary, employees: employeeRows, employee_options: employeeOptions, items: rows });
}
function callChangeStatus(req, res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res.json({ ok: true, ...getCallChangeSnapshot(), source: 'server_memory', db_query: false });
}

async function latestMobileApp(req, res) {
  const configuredUrl = String(process.env.MOBILE_APK_URL || process.env.APK_URL || '').trim();
  const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || 'https://career-crox.onrender.com').replace(/\/$/, '');
  const bundledDownloadUrl = `${baseUrl}/download/android-apk`;
  return res.json({
    ok: true,
    app_name: 'Career Crox',
    display_name: 'Career Crox Calling Assistant',
    version_code: 147,
    version_name: 'Career Crox APK',
    file_name: 'Career Crox.apk',
    package_name: 'com.careercrox.dialer',
    download_url: configuredUrl || bundledDownloadUrl,
    backend_url: baseUrl,
    apk_source: configuredUrl ? 'configured_url' : 'bundled_backend_apk',
    mobile_env_required: false,
    strict_pair_required: true,
    required_permissions: ['CALL_PHONE', 'READ_CALL_LOG', 'READ_PHONE_STATE', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS'],
    notes: [
      'Latest uploaded Career Crox APK is bundled with CRM download.',
      'Bundled backend APK path: backend/public/apk/CAREER_CROX.apk.',
      'Download file name is Career Crox.apk.',
      'CRM Sync Mobile Queue, Pair Code, Start/Pause/Resume/Stop and call list flow are linked to this APK.'
    ]
  });
}

module.exports = { invalidateMobileSessionForLogout: () => { mobileDeviceStateCache.clear(); mobileSessionStateCache.clear(); mobileInactivityGuardCache.clear(); }, createPairCode, pairDevice, logoutDevice, logoutAllDevices, syncApplication, startSession, stopSession, pauseSession, resumeSession, manualCall, queueItemToggle, mobileQueueItemToggle, mobileManualCall, liveStatus, callChangeStatus, activeSession, mobileQueue, prepareCall, mobilePauseSession, mobileStopSession, callStart, callEnd, recordingUploaded, uploadRecordingFile, candidateCallHistory, mobileChatList, mobileChatSend, mobileNotifications, mobileWorkItems, mobileTaskCreate, liveReports, mobileOpenProfileRequest, mobileLocationPing, syncPending, egressGuardStatus, updateEgressGuard, fraudReport, latestMobileApp, uploadMobileCandidateFile, recordingUploadMiddleware: upload.single('file') };
