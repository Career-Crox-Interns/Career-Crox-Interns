const IST_OFFSET_MS = 330 * 60 * 1000;

function low(value) {
  return String(value || '').trim().toLowerCase();
}

function int(value, fallback = 0) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

function parseTs(value) {
  let raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00+05:30';
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) raw = raw.replace(' ', 'T') + '+05:30';
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function istDateKey(value = Date.now()) {
  const t = typeof value === 'number' ? value : parseTs(value);
  if (!t) return '';
  const d = new Date(t + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isTodayIst(value) {
  return Boolean(value && istDateKey(value) === istDateKey(Date.now()));
}

function istDayBounds(value = Date.now()) {
  const key = istDateKey(value);
  if (!key) return { key: '', startMs: 0, endMs: 0, startIso: '', endIso: '' };
  const startMs = Date.parse(`${key}T00:00:00.000+05:30`);
  const endMs = Number.isFinite(startMs) ? startMs + 24 * 60 * 60 * 1000 : 0;
  return {
    key,
    startMs,
    endMs,
    startIso: Number.isFinite(startMs) ? new Date(startMs).toISOString() : '',
    endIso: endMs ? new Date(endMs).toISOString() : '',
  };
}

function minutesBetween(from, to = Date.now()) {
  const start = parseTs(from);
  const end = typeof to === 'number' ? to : parseTs(to);
  if (!start || !end || end < start) return 0;
  return Math.round((end - start) / 60000);
}

function settingsNumber(settings = {}, key, fallback) {
  const n = Number(settings?.[key]);
  return Number.isFinite(n) ? n : fallback;
}

function attendanceThresholds(settings = {}) {
  return {
    fullDayMinutes: settingsNumber(settings, 'attendance_full_day_work_minutes', 540),
    zeroDayMinutes: settingsNumber(settings, 'attendance_zero_day_work_minutes', 300),
    // Business rule: 9h full day; below 5h zero; every worked time from 5h to below 9h is half day.
    halfDayMinutes: settingsNumber(settings, 'attendance_min_half_day_work_minutes', settingsNumber(settings, 'attendance_half_day_work_minutes', settingsNumber(settings, 'attendance_zero_day_work_minutes', 300))),
  };
}

function normalizedStatusText(value = '') {
  return low(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function missedStatus(value = '') {
  const s = normalizedStatusText(value);
  if (!s) return false;
  return s === 'miss' || s === 'missed' || s.includes('missed call') || s.includes('call missed') || s.includes('missed');
}

function negativeStatus(value = '') {
  const s = normalizedStatusText(value);
  if (!s) return false;
  return (
    s.includes('not connected') || s.includes('not connect') || s.includes('disconnect') ||
    s.includes('employee cut') || s.includes('cut suspect') || s.includes('cut suspected') ||
    s.includes('early cut') || s.includes('short ring') || s.includes('ring window') ||
    missedStatus(s) || s.includes('fail') || s.includes('busy') || s.includes('reject') ||
    s.includes('cancel') || s.includes('decline') || s.includes('no answer') || s.includes('unanswered') ||
    s.includes('switched off') || s.includes('invalid') || s.includes('wrong number')
  );
}

function connectedStatus(value) {
  const s = normalizedStatusText(value);
  if (!s || negativeStatus(s)) return false;
  return s === 'connected' || s === 'answered' || s === 'completed' || s === 'success' || s.includes('answered') || s.includes('completed') || s.includes('success') || s.includes('connected');
}

function callDirection(row = {}) {
  const explicit = normalizedStatusText(row.direction || row.call_type || '');
  if (explicit.includes('outgoing') || explicit.includes('outbound') || explicit === '2') return 'outgoing';
  if (explicit.includes('incoming') || explicit.includes('inbound') || explicit === '1' || explicit === '3') return 'incoming';
  const s = normalizedStatusText(`${row.direction || ''} ${row.call_type || ''} ${row.status || ''} ${row.call_status || ''}`);
  // A missed/rejected phone call is still an incoming call. Keep missed as a
  // separate status metric, but count it inside Incoming so Total = Incoming + Outgoing.
  if (missedStatus(s) || s.includes('incoming') || s.includes('inbound')) return 'incoming';
  return 'outgoing';
}

function talkDurationSeconds(row = {}, status = '') {
  if (['missed','calling','not_connected','incoming_unanswered'].includes(status)) return 0;
  const explicitTalk = int(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0);
  if (explicitTalk > 0) return explicitTalk;
  if (!['connected','short_call'].includes(status)) return 0;
  return int(row.duration_seconds || row.call_duration_seconds || row.duration || 0);
}

function callStatus(row = {}) {
  const raw = `${row.status || ''} ${row.call_status || ''} ${row.outcome || ''}`;
  if(missedStatus(raw)) return 'missed';
  if(/calling|dialing|ringing/i.test(raw) && !row.call_ended_at) return 'calling';
  const explicit = int(row.talktime_seconds || row.talk_time_seconds || row.connected_seconds || 0);
  const proven=Boolean(row.answered_at)||String(row.call_log_available)==='1';
  const actual = (proven||!negativeStatus(raw)) ? (explicit || ((connectedStatus(raw)||/short call/i.test(raw)||proven) ? int(row.duration_seconds) : 0)) : 0;
  if(actual >= 15 && !negativeStatus(raw)) return 'connected';
  if(actual > 0) return 'short_call';
  return callDirection(row)==='incoming' ? 'incoming_unanswered' : 'not_connected';
}

function callMetricForRow(row = {}) {
  // CC844: every recorded employee call counts, including unmatched/personal calls.
  const dir = callDirection(row);
  const status = callStatus(row);
  const talktime = talkDurationSeconds(row, status);
  const sourceText = low(`${row.call_source || ''} ${row.source_mode || ''} ${row.synced_from || ''}`);
  return {
    calls_count: 1,
    connected_calls_count: status === 'connected' ? 1 : 0,
    not_connected_calls_count: (dir === 'outgoing' && status !== 'connected' && status !== 'missed' && status !== 'calling') ? 1 : 0,
    incoming_calls_count: dir === 'incoming' ? 1 : 0,
    outgoing_calls_count: dir === 'outgoing' ? 1 : 0,
    missed_calls_count: status === 'missed' ? 1 : 0,
    talktime_seconds: talktime,
    outgoing_talktime_seconds: dir === 'outgoing' ? talktime : 0,
    incoming_talktime_seconds: dir === 'incoming' ? talktime : 0,
    manual_calls_count: sourceText.includes('manual') ? 1 : 0,
    auto_dialer_calls_count: sourceText.includes('auto') ? 1 : 0,
  };
}

function callNeedsReview(row = {}) { return callMetricForRow(row).talktime_seconds > 600; }

function emptyCallMetrics() {
  return {
    calls_count: 0,
    connected_calls_count: 0,
    not_connected_calls_count: 0,
    incoming_calls_count: 0,
    outgoing_calls_count: 0,
    missed_calls_count: 0,
    talktime_seconds: 0,
    outgoing_talktime_seconds: 0,
    incoming_talktime_seconds: 0,
    manual_calls_count: 0,
    auto_dialer_calls_count: 0,
  };
}

function addCallMetrics(target = emptyCallMetrics(), patch = {}) {
  const out = target;
  for (const key of Object.keys(emptyCallMetrics())) out[key] = int(out[key]) + int(patch[key]);
  return out;
}

function stableCallKey(row = {}) {
  const id = String(row.call_log_id || row.id || '').trim();
  if (id) return `id:${id}`;
  const phone = String(row.phone || row.mobile || row.number || row.candidate_phone || '').replace(/\D+/g, '').slice(-10);
  const stamp = String(row.call_started_at || row.started_at || row.created_at || row.date || '').trim();
  const user = String(row.employee_user_id || row.employee_username || row.employee_name || row.user_id || row.username || '').trim().toLowerCase();
  return phone && stamp ? `fallback:${user}:${phone}:${stamp}` : '';
}

function normalizePhone10(value = '') {
  return String(value || '').replace(/\D+/g, '').slice(-10);
}

function callEmployeeKey(row = {}) {
  return low(row.employee_user_id || row.employee_username || row.employee_name || row.user_id || row.username || row.recruiter_code || '');
}

function callTimestampMs(row = {}) {
  return parseTs(row.call_started_at || row.started_at || row.created_at || row.updated_at || row.call_ended_at || '');
}

function isAndroidPhoneLog(row = {}) {
  return String(row.call_log_id || '').startsWith('PHONELOG-') || low(`${row.synced_from || ''} ${row.call_source || ''} ${row.source_mode || ''}`).includes('android_phone_call_log');
}

function isLiveCallPlaceholder(row = {}) {
  const status = normalizedStatusText(`${row.status || ''} ${row.call_status || ''}`);
  return status.includes('calling') && !String(row.call_ended_at || '').trim() && !isAndroidPhoneLog(row);
}

function callRowScore(row = {}) {
  let score = 0;
  if (isAndroidPhoneLog(row)) score += 100;
  if (String(row.call_log_available || '') === '1') score += 35;
  if (String(row.call_ended_at || '').trim()) score += 20;
  if (!normalizedStatusText(row.status || '').includes('calling')) score += 16;
  if (int(row.duration_seconds || row.talktime_seconds || 0) > 0) score += 12;
  if (String(row.candidate_id || '').trim()) score += 5;
  return score;
}

function samePhysicalCall(a = {}, b = {}) {
  const ap = normalizePhone10(a.phone || a.mobile || a.number || a.candidate_phone || '');
  const bp = normalizePhone10(b.phone || b.mobile || b.number || b.candidate_phone || '');
  if (!ap || ap !== bp) return false;
  const ae = callEmployeeKey(a);
  const be = callEmployeeKey(b);
  if (ae && be && ae !== be) return false;
  const at = callTimestampMs(a);
  const bt = callTimestampMs(b);
  if (!at || !bt) return false;
  const diff = Math.abs(at - bt);
  const aid = String(a.call_log_id || a.id || '').trim();
  const bid = String(b.call_log_id || b.id || '').trim();
  if (aid && bid && aid === bid) return true;
  // Two Android phone-log rows are separate physical calls even if very close together.
  if (isAndroidPhoneLog(a) && isAndroidPhoneLog(b)) return false;
  // Merge app-side placeholder/finish rows with the later authoritative Android CallLog proof.
  const aq = String(a.queue_item_id || '').trim(), bq = String(b.queue_item_id || '').trim();
  if(aq && bq && aq!==bq)return false;
  if (aq && bq && aq === bq && String(a.session_id || '') === String(b.session_id || '')) return true;
  // Phone/time proximity alone must not erase a quick retry. Correlate proof
  // only at the same start instant; distinct Android IDs always remain distinct.
  if (callDirection(a) !== callDirection(b)) return false;
  if ((isLiveCallPlaceholder(a) || isLiveCallPlaceholder(b) || isAndroidPhoneLog(a) || isAndroidPhoneLog(b)) && diff <= 1500) return true;
  return false;
}

function dedupeCallRows(inputRows = []) {
  const byId = new Map(), loose = [];
  for (const row of inputRows || []) {
    const id = String(row.call_log_id || row.id || '').trim();
    if (!id) { loose.push(row); continue; }
    const old = byId.get(id);
    if (!old || callRowScore(row) >= callRowScore(old)) byId.set(id, row);
  }
  const sorted = [...byId.values(), ...loose].sort((a,b)=>callTimestampMs(a)-callTimestampMs(b));
  const out=[], groups=new Map(), queueIndexes=new Map();
  for (const row of sorted) {
    const phone=normalizePhone10(row.phone||row.mobile||row.number||row.candidate_phone);
    const group=callEmployeeKey(row)+':'+phone;
    const q=String(row.queue_item_id||'');
    const queueKey=q ? group+':'+String(row.session_id||'')+':'+q : '';
    const candidates=groups.get(group)||[];
    let idx=-1;
    if(queueKey && queueIndexes.has(queueKey)) {
      const possible=queueIndexes.get(queueKey);
      if(samePhysicalCall(out[possible],row))idx=possible;
    }
    if(idx<0 && phone) for(let n=candidates.length-1;n>=0;n--) {
      const possible=candidates[n];
      if(callTimestampMs(row)-callTimestampMs(out[possible])>1500)break;
      if(samePhysicalCall(out[possible],row)){idx=possible;break;}
    }
    if(idx>=0) {
      if(callRowScore(row)>=callRowScore(out[idx]))out[idx]={...out[idx],...row};
    } else {
      idx=out.length;out.push(row);candidates.push(idx);groups.set(group,candidates);
    }
    if(queueKey)queueIndexes.set(queueKey,idx);
  }
  return out.sort((a,b)=>callTimestampMs(b)-callTimestampMs(a));
}

function aggregateCallRows(rows = []) {
  const out = emptyCallMetrics();
  for (const row of dedupeCallRows(rows)) addCallMetrics(out, callMetricForRow(row));
  return out;
}

function presenceMinutes(row = {}, nowMs = Date.now()) {
  // CC26_725: login/heartbeat must NEVER masquerade as a human-confirmed
  // office join. The attendance controller masks work_started_at until the
  // durable explicit-join audit exists; respect that mask in every report.
  // `total_work_minutes` is meaningful work, not the office/session duration.
  const start = parseTs(row.work_started_at || '');
  if (!start) return {
    session_minutes: 0, office_duration_minutes: 0, total_work_minutes: 0,
    active_work_minutes: 0, productive_work_minutes: 0, productive_minutes: 0,
    total_break_minutes: 0, active_break_minutes: 0, grace_minutes: 0,
    idle_minutes: 0,
  };
  const safeEnd = Math.max(start || 0, Number(nowMs || Date.now()));
  const hasSavedActive = Object.prototype.hasOwnProperty.call(row || {}, 'total_work_minutes')
    && String(row.total_work_minutes ?? '').trim() !== '';
  const savedActive = Math.max(0, int(row.total_work_minutes || 0));
  const session = Math.max(0, Math.round((safeEnd - start) / 60000));

  const savedBreak = Math.max(0, int(row.total_break_minutes || 0));
  const activeBreak = String(row.is_on_break || '0') === '1'
    ? Math.max(0, minutesBetween(row.break_started_at, safeEnd))
    : 0;
  const totalBreak = Math.min(session, Math.max(0, savedBreak + activeBreak));
  const available = Math.max(0, session - totalBreak);
  const productive = Math.max(0, Math.min(available, hasSavedActive ? savedActive : available));
  const unaccounted = Math.max(0, available - productive);
  const graceMinutes = Math.min(Math.max(0, int(row.activity_grace_minutes || 2)), unaccounted);
  const idle = Math.max(0, unaccounted - graceMinutes);

  return {
    session_minutes: session,
    office_duration_minutes: session,
    total_work_minutes: productive,
    active_work_minutes: productive,
    productive_work_minutes: productive,
    productive_minutes: productive, // compatibility alias used by Performance/OPS.
    total_break_minutes: totalBreak,
    active_break_minutes: Math.min(totalBreak, activeBreak),
    grace_minutes: graceMinutes,
    idle_minutes: idle,
  };
}

function aggregateBreakRows(rows = [], rangeFrom = 0, rangeTo = 0, nowMs = Date.now()) {
  const from = typeof rangeFrom === 'number' ? rangeFrom : parseTs(rangeFrom);
  const toParsed = typeof rangeTo === 'number' ? rangeTo : parseTs(rangeTo);
  const to = toParsed || nowMs;
  const byId = new Map();
  const loose = [];
  for (const row of rows || []) {
    const id = String(row.break_id || row.id || '').trim();
    if (id) byId.set(id, row); else loose.push(row);
  }
  const unique = [...byId.values(), ...loose];
  let totalMs = 0;
  let count = 0;
  const windows = [];
  const employeeIntervals = new Map();
  for (const row of unique) {
    const start = parseTs(row.started_at || row.break_started_at || row.created_at || '');
    if (!start) continue;
    let end = parseTs(row.ended_at || row.break_ended_at || '');
    if (!end) end = Math.min(nowMs, to);
    const overlapStart = Math.max(start, from || start);
    const overlapEnd = Math.min(end, to || end);
    if (!overlapEnd || overlapEnd <= overlapStart) continue;
    const mins = Math.max(0, Math.round((overlapEnd - overlapStart) / 60000));
    count += 1;
    const employee = String(row.user_id || row.username || row.employee_user_id || 'unknown');
    if (!employeeIntervals.has(employee)) employeeIntervals.set(employee, []);
    employeeIntervals.get(employee).push([overlapStart, overlapEnd]);
    windows.push({
      break_id: String(row.break_id || row.id || ''),
      started_at: new Date(overlapStart).toISOString(),
      ended_at: new Date(overlapEnd).toISOString(),
      actual_minutes: mins,
      reason: String(row.reason || row.break_reason || ''),
      status: String(row.status || ''),
    });
  }
  for (const intervals of employeeIntervals.values()) {
    intervals.sort((a,b) => a[0]-b[0]);
    let start = 0, end = 0;
    for (const [a,b] of intervals) {
      if (a <= end) end = Math.max(end,b);
      else { totalMs += Math.max(0,end-start); start = a; end = b; }
    }
    totalMs += Math.max(0,end-start);
  }
  return { total_break_minutes: Math.round(totalMs / 60000), total_break_seconds: totalMs / 1000, break_count: count, windows };
}

const statsIdentityCache=require('./cache').createTimedCache(60000,{tags:['staff','access']});
async function applyDailyStatsDelta(user = {}, patch = {}, stamp = Date.now()) {
  const {store,withTransaction}=require('./store');
  const resolved=user.__cc837CurrentActor?null:user.user_id ? await statsIdentityCache.load(String(user.user_id),()=>store.pool?store.one('select user_id,username,full_name,recruiter_code,role from public.users where user_id=$1',[user.user_id]):store.findById('users','user_id',user.user_id)) : null;
  user={...user,...(resolved||{})};
  const date=istDateKey(stamp), code=String(user.recruiter_code || user.user_id || user.username || '').trim();
  if(!date || !code) throw new Error('Daily call statistics identity/date is missing.');
  const id=`${date}|${code}`;
  const allowed=new Set([...Object.keys(emptyCallMetrics()),'employee_cut_suspect_count','short_ring_count','candidate_no_answer_likely_count','suspicious_call_score','whatsapp_count','jd_sent_count','submissions_count','interviews_count','selections_count','joinings_count']);
  return withTransaction(async()=>{
    if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['crm-daily-stats:'+id]);
    const prior=await store.findById('employee_daily_stats','stat_id',id);
    const next={stat_id:id,stat_date:date,recruiter_code:code,recruiter_name:String(user.full_name||user.employee_name||user.username||code),username:String(user.username||''),updated_at:new Date().toISOString()};
    for(const [key,value] of Object.entries(patch||{})) {
      if(!allowed.has(key))continue;
      const amount=Number(value);if(!Number.isFinite(amount))throw new Error('Invalid daily statistic delta.');
      next[key]=String(Math.max(0,(Number(prior?.[key])||0)+amount));
    }
    return prior ? store.update('employee_daily_stats','stat_id',id,next) : store.insert('employee_daily_stats',next);
  });
}

function dayStatusFromMinutes(productiveMinutes, joined, settings = {}, failedRules = []) {
  if (!joined) return 'No Work Day';
  const { fullDayMinutes, halfDayMinutes, zeroDayMinutes } = attendanceThresholds(settings);
  const mins = int(productiveMinutes);
  if (mins < zeroDayMinutes) return 'Zero Day';
  if (mins >= fullDayMinutes && !(failedRules || []).length) return 'Full Day';
  if (mins >= halfDayMinutes) return 'Half Day';
  return 'Zero Day';
}

// Performance belongs to the recorded submitter, not a later profile owner.
function historicalSubmitter(row={},candidate={},users=[]){
 const norm=value=>String(value||'').trim().toLowerCase();
 const by=value=>users.find(user=>[user.user_id,user.username,user.full_name,user.recruiter_code].some(v=>norm(v)&&norm(v)===norm(value)));
 const explicitId=row.submitted_by_user_id||row.submitted_by_username||'';
 const explicitName=row.submitted_by_name||row.submitted_by||'';
 const actor=by(explicitId)||by(explicitName)||by(row.submitted_by_recruiter_code)||by(row.recruiter_code)||by(row.user_id)||by(candidate.created_by_user_id)||{};
 return {user_id:String(explicitId&&by(explicitId)?.user_id||row.submitted_by_user_id||actor.user_id||''),
  recruiter_code:String(row.submitted_by_recruiter_code||actor.recruiter_code||row.recruiter_code||''),
  recruiter_name:String(explicitName||actor.full_name||actor.username||row.recruiter_name||candidate.created_by_name||'Unknown submitter')};
}

module.exports = {
  historicalSubmitter,
  low,
  int,
  parseTs,
  istDateKey,
  isTodayIst,
  istDayBounds,
  minutesBetween,
  settingsNumber,
  attendanceThresholds,
  missedStatus,
  negativeStatus,
  connectedStatus,
  callDirection,
  callStatus,
  callMetricForRow,
  emptyCallMetrics,
  addCallMetrics,
  dedupeCallRows,
  samePhysicalCall,
  applyDailyStatsDelta,
  aggregateCallRows,
  aggregateBreakRows,
  presenceMinutes,
  dayStatusFromMinutes,
};

module.exports.callNeedsReview = callNeedsReview;
