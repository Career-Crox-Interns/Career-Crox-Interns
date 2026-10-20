const store = require('../lib/store');
const { callMetricForRow, negativeStatus, connectedStatus, istDateKey, applyDailyStatsDelta, parseTs } = require('../lib/crmMetrics');
const { visibleCandidateForUser } = require('../lib/accessRules');
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
  return store.store.findById('call_logs','call_log_id',callLogId);
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
  } catch(error) { if(store.activeTransactionClient())throw error; }
}

async function updateEmployeeDailyStats(req,row={},previous=null) {
  const before=previous && String(previous.stats_counted)==='1' ? callMetricForRow(previous) : {};
  const after=callMetricForRow(row),delta={};
  for(const [key,value] of Object.entries(after))delta[key]=value-(Number(before[key])||0);
  await applyDailyStatsDelta(req.user,delta,row.call_started_at||row.created_at);
  await store.store.update('call_logs','call_log_id',row.call_log_id,{stats_counted:'1',crm_tracked_number:'1',updated_at:nowIso()});
  return true;
}
async function validateNativeIdentity(req,res) {
  const b=req.body||{},existing=await findCall(str(b.call_log_id));
  if(existing) {
    if(str(existing.employee_user_id)!==str(req.user?.user_id)) { res.status(403).json({ok:false,message:'Call belongs to another employee.'});return null; }
    if(digits(existing.phone)!==digits(b.phone||b.number) || (b.candidate_id && str(existing.candidate_id)!==str(b.candidate_id))) {
      res.status(409).json({ok:false,message:'Phone or candidate does not match the call ID.'});return null;
    }
    return {existing,candidate:null};
  }
  const candidate=await store.store.findById('candidates','candidate_id',str(b.candidate_id));
  if(!candidate || !visibleCandidateForUser(candidate,req.user) || digits(candidate.phone||candidate.number)!==digits(b.phone||b.number)) {
    res.status(403).json({ok:false,message:'A visible CRM candidate and matching phone are required.'});return null;
  }
  return {existing:null,candidate};
}

function baseCallRow(req, body = {}, status = 'Dialed', duration = 0) {
  const phone = digits(body.phone || body.number || '');
  const callId = str(body.call_log_id) || rid('MCL');
  const startMs=parseTs(body.call_started_at||nowIso());
  const started=startMs?new Date(startMs).toISOString():'';
  const endMs=parseTs(body.call_ended_at || nowIso());
  const ended=status==='Dialed'?'':(endMs?new Date(endMs).toISOString():'');
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
    stats_counted:'0',crm_tracked_number:'1',call_log_available:status==='Dialed'?'0':(String(body.call_log_available)==='1'?'1':'0'),
    created_at: str(body.created_at) || nowIso(),
    updated_at: nowIso()
  };
}

async function nativeCallStart(req, res) {
  const body = req.body || {};
  const phone = digits(body.phone || body.number || '');
  if (phone.length < 10) return res.status(400).json({ ok: false, message: 'Valid phone required' });
  const valid=await validateNativeIdentity(req,res);if(!valid)return;
  if(valid.existing)return res.json({ok:true,call_log_id:valid.existing.call_log_id,item:valid.existing,replayed:true});
  const row = baseCallRow(req,body,'Dialed',0);
  row.candidate_name=valid.candidate?.full_name||row.candidate_name;
  if(!row.call_started_at || (row.call_ended_at && parseTs(row.call_ended_at)<parseTs(row.call_started_at)))return res.status(400).json({ok:false,message:'Invalid call time.'});
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
  if(!str(body.call_log_id))return res.status(400).json({ok:false,message:'Use the call_log_id returned by call start.'});
  const valid=await validateNativeIdentity(req,res);if(!valid)return;
  const previous=valid.existing;
  const duration = int(body.duration_seconds || body.talktime_seconds, 0);
  const rawStatus = str(body.status || body.call_status || '');
  const status = negativeStatus(rawStatus) ? 'Not Connected' : (connectedStatus(rawStatus) || duration > 0 ? 'Connected' : 'Not Connected');
  const row=baseCallRow(req,body,status,status==='Connected'?duration:0);
  row.call_started_at=previous?.call_started_at||row.call_started_at;
  row.stats_counted=previous?.stats_counted||'0';
  row.candidate_id=previous?.candidate_id||valid.candidate?.candidate_id||row.candidate_id;
  row.candidate_name=previous?.candidate_name||valid.candidate?.full_name||row.candidate_name;
  if(previous?.call_ended_at && previous.status===row.status && Number(previous.talktime_seconds||0)===Number(row.talktime_seconds||0))return res.json({ok:true,call_log_id:row.call_log_id,item:previous,replayed:true,reports_synced:true,attendance_synced:true});
  if(!row.call_started_at || (row.call_ended_at && parseTs(row.call_ended_at)<parseTs(row.call_started_at)))return res.status(400).json({ok:false,message:'Invalid call time.'});
  const saved = await saveCall(row);
  await logCallActivity(req, saved || row);
  await updateEmployeeDailyStats(req,saved||row,previous);
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

function nativeWrite(handler){return store.transactionalHandler(async(req,res)=>{
  if(store.store.pool)await store.store.query('select pg_advisory_xact_lock(hashtext($1))',['CC782-call-writes:'+str(req.user?.user_id)]);
  return handler(req,res);
})}
module.exports={nativeCallStart:nativeWrite(nativeCallStart),nativeCallEnd:nativeWrite(nativeCallEnd),mobileCrmConfig};
