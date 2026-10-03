const store = require('../lib/store');
const { callMetricForRow, negativeStatus, connectedStatus, istDateKey } = require('../lib/crmMetrics');
const { bumpCallChange } = require('../lib/callChange');

function nowIso() { return new Date().toISOString(); }
function rid(prefix = 'MCRM') { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function str(v = '') { return String(v || '').trim(); }
function digits(v = '') { return String(v || '').replace(/\D+/g, '').slice(-10); }
function uname(u = {}) { return str(u.username || u.email || u.name || ''); }
function fname(u = {}) { return str(u.full_name || u.name || u.employee_name || u.username || ''); }
function int(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round(n)) : d; }

async function findCall(callLogId = '') {
  if (!callLogId) return null;
  return store.store.findById('call_logs', 'call_log_id', callLogId).catch(() => null);
}

async function saveCall(row) {
  const existing = await findCall(row.call_log_id);
  const merged = existing ? { ...existing, ...row, created_at: existing.created_at || row.created_at, updated_at: nowIso() } : row;
  let saved;
  if (existing) saved = await store.store.update('call_logs', 'call_log_id', row.call_log_id, merged);
  else saved = await store.store.insert('call_logs', merged);
  if (saved) bumpCallChange(existing ? 'mobile_crm_call_update' : 'mobile_crm_call_insert');
  return saved;
}

async function logCallActivity(req, row = {}) {
  try {
    await store.store.insert('activity_log', {
      activity_id: rid('A'),
      user_id: str(req.user?.user_id),
      username: uname(req.user),
      action_type: 'mobile_crm_call_logged',
      candidate_id: str(row.candidate_id),
      metadata: JSON.stringify({
        call_log_id: row.call_log_id,
        candidate_name: row.candidate_name,
        phone: row.phone,
        status: row.status,
        duration_seconds: row.duration_seconds || 0,
        talktime_seconds: row.talktime_seconds || 0,
        source: 'mobile_crm_app'
      }),
      created_at: row.call_ended_at || row.updated_at || nowIso(),
    });
  } catch {}
}

async function updateEmployeeDailyStats(req, row = {}) {
  try {
    if (String(row.stats_counted || '') === '1') return false;
    const user = req.user || {};
    const statDate = istDateKey(row.call_started_at || row.created_at || nowIso()) || nowIso().slice(0, 10);
    const recruiterCode = str(user.recruiter_code || user.user_id || user.username || 'UNKNOWN') || 'UNKNOWN';
    const statId = `${statDate}|${recruiterCode}`;
    const existing = await store.store.findById('employee_daily_stats', 'stat_id', statId).catch(() => null);
    const metrics = callMetricForRow(row);
    const base = existing || {
      stat_id: statId,
      stat_date: statDate,
      recruiter_code: recruiterCode,
      recruiter_name: fname(user) || recruiterCode,
      username: uname(user),
      calls_count: '0', connected_calls_count: '0', not_connected_calls_count: '0', outgoing_calls_count: '0', incoming_calls_count: '0', missed_calls_count: '0', talktime_seconds: '0', outgoing_talktime_seconds: '0', incoming_talktime_seconds: '0', updated_at: nowIso()
    };
    const next = { ...base, updated_at: nowIso() };
    for (const [key, amount] of Object.entries(metrics)) {
      next[key] = String((Number(next[key] || 0) || 0) + (Number(amount || 0) || 0));
    }
    if (existing) await store.store.update('employee_daily_stats', 'stat_id', statId, next);
    else await store.store.insert('employee_daily_stats', next);
    await store.store.update('call_logs', 'call_log_id', row.call_log_id, { stats_counted: '1', updated_at: nowIso() }).catch(() => null);
    return true;
  } catch { return false; }
}

function baseCallRow(req, body = {}, status = 'Dialed', duration = 0) {
  const phone = digits(body.phone || body.number || '');
  const callId = str(body.call_log_id) || rid('MCL');
  const started = str(body.call_started_at) || nowIso();
  const ended = str(body.call_ended_at) || (status === 'Dialed' ? '' : nowIso());
  return {
    call_log_id: callId,
    session_id: str(body.session_id),
    queue_item_id: str(body.queue_item_id),
    candidate_id: str(body.candidate_id),
    candidate_name: str(body.candidate_name || body.name || 'Mobile CRM Profile'),
    phone,
    employee_user_id: str(req.user?.user_id),
    employee_username: uname(req.user),
    employee_name: fname(req.user),
    direction: 'Outgoing',
    status,
    call_started_at: started,
    call_ended_at: ended,
    answered_at: duration > 0 ? (str(body.answered_at) || started) : '',
    duration_seconds: duration,
    talktime_seconds: duration,
    ring_seconds: int(body.ring_seconds, 0),
    idle_seconds: 0,
    notes: str(body.notes || (status === 'Dialed' ? 'Mobile CRM native dial started' : 'Mobile CRM native call synced')).slice(0, 500),
    call_source: 'mobile_crm_app',
    source_mode: 'mobile_crm_app',
    recording_status: str(body.recording_status || 'device_call_recording_if_available'),
    recording_url: str(body.recording_url),
    recording_file_id: str(body.recording_file_id),
    synced_from: 'mobile_crm_native_bridge',
    stats_counted: status === 'Dialed' ? '0' : str(body.stats_counted || '0'),
    created_at: str(body.created_at) || nowIso(),
    updated_at: nowIso()
  };
}

async function nativeCallStart(req, res) {
  const body = req.body || {};
  const phone = digits(body.phone || body.number || '');
  if (phone.length < 10) return res.status(400).json({ ok: false, message: 'Valid phone required' });
  const row = baseCallRow(req, body, 'Dialed', 0);
  const saved = await saveCall(row);
  try {
    await store.store.update('presence', 'user_id', str(req.user?.user_id), {
      last_call_dial_at: row.call_started_at || nowIso(),
      last_call_candidate_id: row.candidate_id || '',
      last_seen_at: nowIso(),
      last_activity_at: nowIso(),
      last_activity_source: 'mobile_crm_native_call',
      updated_at: nowIso(),
    });
  } catch {}
  res.json({ ok: true, call_log_id: row.call_log_id, item: saved, mobile_crm: true });
}

async function nativeCallEnd(req, res) {
  const body = req.body || {};
  const phone = digits(body.phone || body.number || '');
  if (phone.length < 10) return res.status(400).json({ ok: false, message: 'Valid phone required' });
  const duration = int(body.duration_seconds || body.talktime_seconds, 0);
  const rawStatus = str(body.status || body.call_status || '');
  const status = negativeStatus(rawStatus) ? 'Not Connected' : (connectedStatus(rawStatus) || duration > 0 ? 'Connected' : 'Not Connected');
  const row = baseCallRow(req, body, status, duration);
  const saved = await saveCall(row);
  await logCallActivity(req, saved || row);
  await updateEmployeeDailyStats(req, saved || row);
  res.json({ ok: true, call_log_id: row.call_log_id, item: saved, mobile_crm: true, reports_synced: true, attendance_synced: true });
}

async function mobileCrmConfig(req, res) {
  res.json({
    ok: true,
    app: 'Career Crox TRIAL Mobile CRM',
    version: 'CC26.217-MOBILE-CRM-LAST-FULL-AUDIT-PATCH',
    backend_url: process.env.PUBLIC_BACKEND_URL || 'https://career-crox.onrender.com',
    call_tracking: true,
    pair_code_required: false,
    play_store_mode: true,
    note: 'Mobile CRM uses normal CRM login. Native call bridge tracks calls, Call Review, attendance, and reports when Android permissions are granted.'
  });
}

module.exports = { nativeCallStart, nativeCallEnd, mobileCrmConfig };
