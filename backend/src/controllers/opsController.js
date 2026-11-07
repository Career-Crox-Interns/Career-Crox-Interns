const { table, store } = require('../lib/store');
const { candidateScopeSql,isAdminOrManager }=require('../lib/accessRules');
const { recruiterCodeMatches, nowIso } = require('../lib/helpers');
const { createTimedCache, registerCache } = require('../lib/cache');
const { callMetricForRow, presenceMinutes, dedupeCallRows } = require('../lib/crmMetrics');

const PERFORMANCE_CACHE_TTL_MS = 300000;
// CC15: Postgres date/text coalesce fixed for performance/recent activity.
const performanceCache = registerCache(new Map());
performanceCache.tags=new Set(['reports','attendance','access','candidates']);
const recentActivityCache = createTimedCache(30000, {maxEntries:80,tags:["activity", "access", "staff", "reset"]});
const activityRosterCache=createTimedCache(300000,{maxEntries:1,tags:["staff","access","reset"]});

async function safeOpsQuery(sql, params = []) {
  try {
    return await store.query(sql, params);
  } catch (error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('does not exist') || message.includes('column') || message.includes('relation')) return [];
    throw error;
  }
}

function cacheKeyForPerformance(req) {
  return `${req.user?.user_id || 'anon'}:${req.user?.role || 'none'}:${req.user?.__ccAccessRevision||0}:${(req.user?.__ccTeamUserIds || []).join(',')}`;
}

function getCachedPerformance(req) {
  const hit = performanceCache.get(cacheKeyForPerformance(req));
  if (!hit) return null;
  if ((Date.now() - hit.at) > PERFORMANCE_CACHE_TTL_MS) {
    performanceCache.delete(cacheKeyForPerformance(req));
    return null;
  }
  return hit.payload;
}

function setCachedPerformance(req, payload) {
  performanceCache.set(cacheKeyForPerformance(req), { at: Date.now(), payload });
}


function isManager(user) {
  return lower(user?.role) === 'manager';
}

function safeJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function pickActionCategory(actionType) {
  const value = lower(actionType);
  if (!value) return 'other';
  if (value.includes('submission')) return 'submission';
  if (value.includes('interview')) return 'interview';
  if (value.includes('call')) return 'calls';
  if (value.includes('whatsapp')) return 'whatsapp';
  if (value.includes('profile_open')) return 'profiles_open';
  if (value.includes('break')) return 'break';
  if (value.includes('crm_locked') || value.includes('unlock') || value.includes('no_call_lock')) return 'crm_lock';
  return 'other';
}

function titleCaseAction(actionType) {
  return String(actionType || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function opsCandidateIsDeleted(row = {}) {
  const status = lower(row.status || row.candidate_status || '');
  const approval = lower(row.approval_status || '');
  const details = lower(row.all_details_sent || '');
  const notes = lower(row.data_notes || '');
  return Boolean(String(row.deleted_at || '').trim())
    || status === 'deleted'
    || status === '__deleted__'
    || status === 'archived'
    || approval === 'deleted'
    || approval === '__deleted__'
    || approval === 'archived'
    || details === 'deleted'
    || details === 'archived'
    || notes.includes('[crm-deleted]');
}

function activeOpsCandidates(rows = []) {
  return (rows || []).filter((row) => !opsCandidateIsDeleted(row));
}

function rowLinkedToActiveOpsCandidate(row = {}, activeCandidateIds = new Set()) {
  const candidateId = String(row.candidate_id || '').trim();
  return !candidateId || activeCandidateIds.has(candidateId);
}

function toMs(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) && t > 0 ? t : 0;
}

const IST_OFFSET_MS = 330 * 60 * 1000;
function istDateKey(value = Date.now()) {
  const t = typeof value === 'number' ? value : toMs(value);
  if (!t) return '';
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function isTodayIst(value) {
  const t = toMs(value);
  return !!t && istDateKey(t) === istDateKey(Date.now());
}
function isConnectedCall(row = {}) { return callMetricForRow(row).connected_calls_count > 0; }
function callDirection(row = {}) {
  const s = lower(`${row.direction || ''} ${row.call_type || ''} ${row.status || ''}`);
  if (s.includes('miss')) return 'missed';
  if (s.includes('incoming') || s.includes('inbound')) return 'incoming';
  return 'outgoing';
}
function emptyCallMetrics() {
  return {
    calls_count: 0, dialed_calls_count: 0, connected_calls_count: 0, not_connected_calls_count: 0,
    incoming_calls_count: 0, outgoing_calls_count: 0, missed_calls_count: 0,
    talktime_seconds: 0, avg_talktime_seconds: 0, missing_call_log_count: 0, recording_missing_count: 0,
    callback_pending_count: 0, unique_called_profiles_count: 0, repeated_calls_count: 0, employee_cut_suspect_count: 0,
    short_ring_count: 0, candidate_no_answer_likely_count: 0, suspicious_call_score: 0
  };
}
function buildCallMetricsForUsers(callLogs = [], users = [], candidates = []) {
  const byUserId = new Map();
  const activeCandidates = activeOpsCandidates(candidates || []);
  const candidateById = new Map(activeCandidates.map((c) => [String(c.candidate_id || '').trim(), c]).filter(([id]) => id));
  const candidateByPhone = new Map();
  for (const candidate of activeCandidates) {
    const p = normalizePhone(candidate.phone || candidate.number || candidate.mobile || candidate.candidate_phone || '').slice(-10);
    if (p) candidateByPhone.set(p, candidate);
  }
  const userByUsername = new Map(users.map((u) => [lower(u.username), u]));
  const userByName = new Map(users.map((u) => [lower(u.full_name || u.name), u]));
  const userByCode = new Map(users.map((u) => [lower(u.recruiter_code || u.employee_code), u]));
  const ensure = (key) => { if (!byUserId.has(String(key))) byUserId.set(String(key), { ...emptyCallMetrics(), _phones: new Map(), _profiles: new Set(),_validTalk:0 }); return byUserId.get(String(key)); };
  for (const row of dedupeCallRows(callLogs || [])) {
    if (!isTodayIst(row.call_started_at || row.created_at || row.updated_at)) continue;
    const candidateId = String(row.candidate_id || row.current_candidate_id || '').trim();
    const candidatePhone = normalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '').slice(-10);
    const matchedCandidate = (candidateId && candidateById.get(candidateId)) || (candidatePhone && candidateByPhone.get(candidatePhone)) || null;
    let user = users.find((u) => String(u.user_id || '') === String(row.employee_user_id || '')) || userByUsername.get(lower(row.employee_username || '')) || userByName.get(lower(row.employee_name || '')) || userByCode.get(lower(row.recruiter_code || '')) || null;
    const key = user?.user_id || row.employee_user_id || row.employee_username || row.employee_name || '';
    if (!key) continue;
    const m = ensure(key);
    const cm = callMetricForRow(row);
    if (!cm.calls_count) continue;
    const dir = callDirection(row);
    m.calls_count += cm.calls_count;
    m.incoming_calls_count += cm.incoming_calls_count;
    m.missed_calls_count += cm.missed_calls_count;
    m.outgoing_calls_count += cm.outgoing_calls_count;
    m.dialed_calls_count += cm.outgoing_calls_count;
    m.connected_calls_count += cm.connected_calls_count;
    m.not_connected_calls_count += cm.not_connected_calls_count;
    m.talktime_seconds += cm.talktime_seconds;
    if(cm.connected_calls_count)m._validTalk+=cm.talktime_seconds;
    if (String(row.call_log_available || '1') === '0') m.missing_call_log_count += 1;
    if (!String(row.recording_url || row.recording_file_id || '').trim() && lower(row.recording_status || 'missing').includes('missing')) m.recording_missing_count += 1;
    if ((dir === 'missed' || lower(row.status).includes('miss')) && lower(row.callback_status || '') !== 'done') m.callback_pending_count += 1;
    if (String(row.employee_cut_suspect || row.employee_early_cut_suspect || '') === '1') m.employee_cut_suspect_count += 1;
    if (String(row.early_cut_flag || '') === '1') m.short_ring_count += 1;
    if (String(row.candidate_no_answer_likely || '') === '1' || lower(row.disconnect_by || row.disconnect_actor_guess).includes('candidate_no_answer')) m.candidate_no_answer_likely_count += 1;
    m.suspicious_call_score += Math.max(0, Number(row.suspicious_score || 0) || 0);
    const p = normalizePhone(row.phone || '');
    if (p) m._phones.set(p, (m._phones.get(p) || 0) + 1);
    const matchedCandidateId = String(matchedCandidate?.candidate_id || '').trim();
    if (matchedCandidateId) m._profiles.add(matchedCandidateId);
  }
  for (const m of byUserId.values()) {
    m.repeated_calls_count = [...m._phones.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    m.unique_called_profiles_count = m._profiles.size;
    m.avg_talktime_seconds = m.connected_calls_count ? Math.round(m._validTalk / m.connected_calls_count) : 0;
    delete m._phones; delete m._profiles;delete m._validTalk;
  }
  return byUserId;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function submissionStamp(row, candidate = null) {
  return String(
    row?.submission_origin_at
    || row?.submitted_at
    || row?.approval_requested_at
    || candidate?.submission_date
    || row?.created_at
    || ''
  );
}

function buildSubmissionIdentity(row, candidate = null) {
  const phone = normalizePhone(candidate?.phone || row?.phone || '');
  if (phone.length >= 10) return `phone:${phone.slice(-10)}`;
  const candidateId = String(row?.candidate_id || candidate?.candidate_id || '').trim().toLowerCase();
  if (candidateId) return `candidate:${candidateId}`;
  const fullName = lower(candidate?.full_name || row?.candidate_name || '');
  if (fullName) return `name:${fullName}`;
  return String(row?.submission_id || '').trim().toLowerCase();
}

function livePresenceMetrics(row) {
  const live = presenceMinutes(row);
  return { session_minutes: live.session_minutes, productive_minutes: live.productive_work_minutes, total_break_minutes: live.total_break_minutes };
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function csvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function prettyAction(actionType) {
  const raw = String(actionType || '').trim();
  if (!raw) return 'Unknown action';
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function classifyActivity(actionType) {
  const action = lower(actionType);
  if (['crm_locked', 'no_call_lock', 'break_exceeded', 'over_break_alert'].includes(action)) return 'idle';
  if (action === 'submitted_for_approval' || action.startsWith('submission_') || action.includes('approval')) return 'submission';
  if (action.includes('whatsapp')) return 'whatsapp';
  if (action.includes('call')) return 'call';
  if (action === 'profile_opened') return 'profile_open';
  if (['profile_updated', 'candidate_updated'].includes(action)) return 'profile_edit';
  if (action.includes('task')) return 'task';
  if (action.includes('note')) return 'note';
  if (action.includes('interview')) return 'interview';
  if (['join_work', 'break_started', 'break_ended', 'unlock_requested', 'crm_unlocked', 'attendance_report_sent'].includes(action)) return 'attendance';
  return 'other';
}

function buildDetailsText(row, metadata, category) {
  const action = lower(row.action_type);
  if (category === 'idle') {
    const idleMinutes = Number(metadata.idle_minutes || metadata.no_call_minutes || metadata.break_minutes || 0);
    const page = metadata.page ? ` on ${metadata.page}` : '';
    if (action === 'no_call_lock') return `No call activity for ${idleMinutes || 0} minutes${page}`;
    if (action === 'crm_locked') return `System idle lock after ${idleMinutes || 0} minutes${page}`;
    if (action === 'break_exceeded') return `Break exceeded by ${idleMinutes || 0} minutes`;
    if (action === 'over_break_alert') return `Break alert${metadata.reason ? `: ${metadata.reason}` : ''}`;
  }

  if (category === 'submission') {
    if (action === 'submitted_for_approval') return `Submitted for approval${metadata.process ? ` • ${metadata.process}` : ''}`;
    if (action === 'submission_approved') return `Approved${metadata.approved_by ? ` by ${metadata.approved_by}` : ''}`;
    if (action === 'submission_rejected') return `Rejected${metadata.reason ? ` • ${metadata.reason}` : ''}`;
  }

  if (category === 'call') {
    return metadata.phone ? `Call logged • ${metadata.phone}` : 'Call logged';
  }

  if (category === 'whatsapp') {
    return metadata.phone ? `WhatsApp opened • ${metadata.phone}` : 'WhatsApp activity';
  }

  if (category === 'profile_open') {
    return metadata.full_name ? `Opened ${metadata.full_name}` : 'Profile opened';
  }

  if (category === 'profile_edit') {
    const bits = [metadata.full_name, metadata.status, metadata.approval_status].filter(Boolean);
    return bits.length ? `Updated • ${bits.join(' • ')}` : 'Profile details updated';
  }

  if (category === 'task') {
    return metadata.task_id ? `Task ${metadata.task_id}` : 'Task activity';
  }

  if (category === 'note') {
    return metadata.note_type ? `Note added • ${metadata.note_type}` : 'Note added';
  }

  if (category === 'attendance') {
    if (action === 'join_work') return 'Joined office';
    if (action === 'break_started') return `Break started${metadata.reason ? ` • ${metadata.reason}` : ''}`;
    if (action === 'break_ended') return 'Break ended';
    if (action === 'unlock_requested') return `Unlock requested${metadata.reason ? ` • ${metadata.reason}` : ''}`;
    if (action === 'crm_unlocked') return 'CRM unlocked';
    if (action === 'attendance_report_sent') return 'Attendance report sent';
  }

  if (metadata.reason) return metadata.reason;
  if (metadata.section) return `Section • ${metadata.section}`;
  if (metadata.open_path) return `Open • ${metadata.open_path}`;
  return prettyAction(row.action_type);
}

function decorateActivity(row) {
  const metadata = parseMetadata(row.metadata);
  const activityCategory = classifyActivity(row.action_type);
  const createdAtMs = toMs(row.created_at);
  const idleMinutes = Number(metadata.idle_minutes || metadata.no_call_minutes || metadata.break_minutes || 0);
  const idleEndedAt = createdAtMs ? new Date(createdAtMs).toISOString() : '';
  const idleStartedAt = createdAtMs && idleMinutes > 0 ? new Date(createdAtMs - (idleMinutes * 60000)).toISOString() : '';
  return {
    ...row,
    activity_category: activityCategory,
    action_label: prettyAction(row.action_type),
    metadata_object: metadata,
    details_text: buildDetailsText(row, metadata, activityCategory),
    candidate_label: row.candidate_id || '-',
    idle_minutes: idleMinutes > 0 ? idleMinutes : '',
    idle_started_at: idleStartedAt,
    idle_ended_at: idleEndedAt,
  };
}

function applyActivityFilters(items, query = {}) {
  const recruiters = new Set(csvList(query.recruiters).map((item) => item.toLowerCase()));
  const fromMs = toMs(query.from);
  const toMsValue = toMs(query.to);
  const idleThreshold = Number(query.idle_threshold || 0);
  const search = lower(query.search);
  const category = lower(query.category);

  return items.filter((item) => {
    const createdAtMs = toMs(item.created_at);
    if (recruiters.size && !recruiters.has(lower(item.username))) return false;
    if (fromMs && createdAtMs && createdAtMs < fromMs) return false;
    if (toMsValue && createdAtMs && createdAtMs > toMsValue) return false;
    if (idleThreshold && item.activity_category === 'idle' && Number(item.idle_minutes || 0) < idleThreshold) return false;
    if (category && item.activity_category !== category) return false;
    if (search) {
      const hay = [
        item.username,
        item.action_type,
        item.action_label,
        item.candidate_id,
        item.details_text,
        JSON.stringify(item.metadata_object || {}),
      ].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function buildLiveOpsSummary(users, presenceRows, activityItems) {
  const trackedUsers = (users || []).filter((row) => ['recruiter', 'tl', 'team lead', 'manager', 'admin'].includes(lower(row.role)));
  const presenceByUserId = new Map((presenceRows || []).map((row) => [String(row.user_id), row]));
  const latestActivityByUser = new Map();
  for (const row of (activityItems || [])) {
    const key = String(row.user_id || '');
    const stamp = toMs(row.created_at);
    if (!key || !stamp) continue;
    if (!latestActivityByUser.has(key) || stamp > latestActivityByUser.get(key)) latestActivityByUser.set(key, stamp);
  }
  const windowStart = Date.now() - (30 * 60 * 1000);
  let liveBreaks = 0;
  let breakMinutesToday = 0;
  let loginMinutesToday = 0;
  let workMinutesToday = 0;
  let liveIdle15 = 0;
  let liveIdle30 = 0;
  let noProfileOpen30 = 0;
  let noCall30 = 0;
  trackedUsers.forEach((user) => {
    const presenceRow = presenceByUserId.get(String(user.user_id)) || {};
    const live = livePresenceMetrics(presenceRow);
    loginMinutesToday += Number(live.session_minutes || 0);
    workMinutesToday += Number(live.productive_minutes || 0);
    breakMinutesToday += Number(live.total_break_minutes || 0);
    if (presenceRow.is_on_break) liveBreaks += 1;
    const latest = Math.max(latestActivityByUser.get(String(user.user_id)) || 0, toMs(presenceRow.last_seen_at), toMs(presenceRow.last_call_dial_at), toMs(presenceRow.work_started_at));
    const idle = latest ? Math.max(0, Math.round((Date.now() - latest) / 60000)) : 0;
    if (idle >= 15) liveIdle15 += 1;
    if (idle >= 30) liveIdle30 += 1;
    const recent = (activityItems || []).filter((row) => String(row.user_id || '') === String(user.user_id) && toMs(row.created_at) >= windowStart);
    if (!recent.some((row) => lower(row.action_type) === 'profile_opened')) noProfileOpen30 += 1;
    if (!recent.some((row) => lower(row.action_type) === 'call_logged')) noCall30 += 1;
  });
  return {
    live_breaks: liveBreaks,
    break_minutes_today: breakMinutesToday,
    login_minutes_today: loginMinutesToday,
    work_minutes_today: workMinutesToday,
    live_idle_15: liveIdle15,
    live_idle_30: liveIdle30,
    no_profile_open_30: noProfileOpen30,
    no_call_30: noCall30,
  };
}


function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function buildSubmitterContext(row, candidate, usersById, usersByName) {
  const explicitName = row?.submitted_by_name || '';
  const directUser = usersById.get(String(row?.submitted_by_user_id || '')) || {};
  const namedUser = usersByName.get(lower(explicitName || candidate?.submitted_by || candidate?.recruiter_name || '')) || {};
  return {
    user_id: row?.submitted_by_user_id || directUser.user_id || namedUser.user_id || '',
    username: directUser.username || namedUser.username || '',
    full_name: explicitName || directUser.full_name || (explicitName ? namedUser.full_name : '') || candidate?.submitted_by || candidate?.recruiter_name || '',
    recruiter_code: row?.submitted_by_recruiter_code || directUser.recruiter_code || (explicitName ? namedUser.recruiter_code : '') || row?.recruiter_code || candidate?.recruiter_code || '',
  };
}

function buildActivityIdentity(row) {
  return [
    lower(row?.action_type),
    String(row?.candidate_id || ''),
    String(row?.user_id || ''),
    lower(row?.username || row?.full_name || ''),
    String(row?.created_at || '').slice(0, 16),
  ].join('|');
}

function mergeActivitySources(primaryRows, extraRows) {
  const seen = new Set();
  const merged = [];
  for (const row of [...(primaryRows || []), ...(extraRows || [])]) {
    const key = buildActivityIdentity(row);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}

function buildDerivedSubmissionActivities(submissions, candidatesById, usersById, usersByName, activityRows = []) {
  const existing = new Set((activityRows || []).map((row) => buildActivityIdentity(row)));
  const derived = [];
  const latestByIdentity = new Map();
  for (const row of submissions || []) {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    const submitter = buildSubmitterContext(row, candidate, usersById, usersByName);
    const submittedAt = submissionStamp(row, candidate);
    const dedupeKey = `${submitter.user_id || submitter.recruiter_code || submitter.full_name || 'unknown'}|${buildSubmissionIdentity(row, candidate)}`;
    if (submittedAt && (submitter.user_id || submitter.full_name || submitter.recruiter_code)) {
      const current = latestByIdentity.get(dedupeKey);
      if (!current || toMs(submittedAt) >= toMs(current.created_at)) {
        latestByIdentity.set(dedupeKey, {
          activity_id: `DER-SUB-${row.submission_id}`,
          user_id: submitter.user_id || '',
          username: submitter.username || submitter.full_name || submitter.recruiter_code || 'system',
          action_type: 'submitted_for_approval',
          candidate_id: row.candidate_id || '',
          metadata: JSON.stringify({
            process: candidate.process || '',
            recruiter_code: submitter.recruiter_code || '',
            approval_status: row.approval_status || '',
            source: 'derived_submission',
          }),
          created_at: submittedAt,
        });
      }
    }

    const approver = usersByName.get(lower(row.approved_by_name || '')) || {};
    const approvalStamp = row.approved_at || row.updated_at || '';
    const approvalStatus = lower(row.approval_status || row.status);
    if (approvalStamp && approver.user_id && ['approved', 'rejected'].includes(approvalStatus)) {
      const approvalRow = {
        activity_id: `DER-APR-${row.submission_id}-${approvalStatus}`,
        user_id: approver.user_id,
        username: approver.username || approver.full_name || approver.recruiter_code || 'system',
        action_type: approvalStatus === 'approved' ? 'submission_approved' : 'submission_rejected',
        candidate_id: row.candidate_id || '',
        metadata: JSON.stringify({
          approved_by: row.approved_by_name || approver.full_name || '',
          recruiter_code: approver.recruiter_code || '',
          decision_note: row.decision_note || '',
          source: 'derived_submission',
        }),
        created_at: approvalStamp,
      };
      const approvalKey = buildActivityIdentity(approvalRow);
      if (!existing.has(approvalKey)) {
        existing.add(approvalKey);
        derived.push(approvalRow);
      }
    }
  }
  for (const submitRow of latestByIdentity.values()) {
    const submitKey = buildActivityIdentity(submitRow);
    if (!existing.has(submitKey)) {
      existing.add(submitKey);
      derived.push(submitRow);
    }
  }
  return derived;
}

function buildSummary(items) {
  const byCategory = (target) => items.filter((item) => item.activity_category === target).length;
  const idleItems = items.filter((item) => item.activity_category === 'idle');
  return {
    total: items.length,
    idle: idleItems.length,
    submission: byCategory('submission'),
    call: byCategory('call'),
    whatsapp: byCategory('whatsapp'),
    profile_open: byCategory('profile_open'),
    profile_edit: byCategory('profile_edit'),
    task: byCategory('task'),
    recruiters_active: new Set(items.map((item) => lower(item.username)).filter(Boolean)).size,
    idle_minutes_total: idleItems.reduce((sum, item) => sum + Number(item.idle_minutes || 0), 0),
  };
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function spreadsheetCell(value, type = 'String') {
  return `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}

function buildActivityWorkbook(items) {
  const header = ['Recruiter', 'Category', 'Activity', 'Candidate', 'Idle Minutes', 'Idle Start', 'Idle End', 'Created At', 'Details'];
  const rows = items.map((item) => [
    item.username || '',
    item.activity_category || '',
    item.action_label || '',
    item.candidate_id || '',
    item.idle_minutes ? String(item.idle_minutes) : '',
    item.idle_started_at || '',
    item.idle_ended_at || '',
    item.created_at || '',
    item.details_text || '',
  ]);

  const tableRows = [header, ...rows]
    .map((row, rowIndex) => `<Row>${row.map((cell, index) => spreadsheetCell(cell, rowIndex > 0 && index === 4 && cell !== '' ? 'Number' : 'String')).join('')}</Row>`)
    .join('');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
  <Worksheet ss:Name="Activity Report">
    <Table>${tableRows}</Table>
  </Worksheet>
</Workbook>`;
}

function activityRole(user) {
  const role=String(user?.role || user?.designation || '').trim().toLowerCase();
  return ['team lead','team leader'].includes(role) ? 'tl' : role;
}
function scopedActivityUsers(users, actor) {
  if(['manager','admin'].includes(activityRole(actor)))return users;
  const id=String(actor.user_id||''),code=lower(actor.recruiter_code),names=[lower(actor.full_name),lower(actor.username)].filter(Boolean);
  return users.filter(u=>{
    if(String(u.user_id)===id)return true;
    if(activityRole(u)!=='recruiter')return false;
    const parent=String(u.tl_user_id||u.team_lead_user_id||u.reporting_tl_user_id||u.reports_to_user_id||u.reporting_manager_user_id||'').trim();
    if(parent)return parent===id;
    const parentCode=lower(u.tl_code||u.team_lead_code||u.reporting_tl_code||u.reports_to_code||u.reporting_manager_code);
    if(parentCode)return Boolean(code&&parentCode===code);
    return names.includes(lower(u.tl_name||u.team_lead_name||u.reports_to_name||u.reporting_manager_name));
  });
}
async function readScopedActivity(req) {
  const role=activityRole(req.user);
  if(!['manager','admin','tl'].includes(role))throw Object.assign(new Error('Recent Activity is available to managers and team leads only.'),{status:403});
  const now=Date.now(),cutoff=now-30*86400000;
  const start=Date.parse(req.query.from || '') || now-86400000,end=Date.parse(req.query.to || '') || now;
  if(start>end)throw Object.assign(new Error('Choose an end time after the start time.'),{status:400});
  const from=new Date(Math.max(cutoff,start)).toISOString(),to=new Date(Math.min(now,end)).toISOString();
  const fields=['user_id','username','full_name','role','designation','recruiter_code','tl_user_id','team_lead_user_id','reporting_tl_user_id','reports_to_user_id','reporting_manager_user_id','tl_code','team_lead_code','reporting_tl_code','reports_to_code','reporting_manager_code','tl_name','team_lead_name','reports_to_name','reporting_manager_name'];
  const roster=await activityRosterCache.load('roster',()=>store.pool?store.query(`select ${fields.map(f=>`to_jsonb(u)->>'${f}' as ${f}`).join(',')} from public.users u`):table('users'));
  const sharedIds=new Set((req.user.__ccSharedScopes||[]).flatMap(scope=>scope.ids));
  const soloUsers=scopedActivityUsers(roster,req.user),soloIds=new Set(soloUsers.map(u=>String(u.user_id)));
  const users=roster.filter(u=>soloIds.has(String(u.user_id))||sharedIds.has(String(u.user_id))),ids=users.map(u=>String(u.user_id));
  const selected=String(req.query.employee_id||'');
  if(selected&&!ids.includes(selected))throw Object.assign(new Error('This employee is outside your team.'),{status:403});
  const scopeIds=selected?[selected]:ids,limit=Math.min(50,Math.max(1,Number(req.query.limit)||50));
  const category=String(req.query.category||''),search=lower(req.query.search).slice(0,120);
  let cursor=null;
  if(req.query.cursor){try{cursor=JSON.parse(Buffer.from(String(req.query.cursor),'base64url').toString());if(!cursor.at||!cursor.id||!Number.isFinite(Date.parse(cursor.at)))throw Error();}catch{throw Object.assign(new Error('Invalid activity page. Refresh again.'),{status:400});}}
  let rows=[];
  if(store.pool){
    // CC863: reading Recent Activity never deletes history.
    // Identity/date predicates run inside PostgreSQL. No candidate, submission or presence scan.
    const params=[from,to,scopeIds],where=['created_at >= $1','created_at <= $2','user_id=any($3::text[])'];
    const sqlCategory=`case when lower(action_type) in ('crm_locked','no_call_lock','break_exceeded','over_break_alert') then 'idle' when lower(action_type)='submitted_for_approval' or lower(action_type) like 'submission_%' or lower(action_type) like '%approval%' then 'submission' when lower(action_type) like '%whatsapp%' then 'whatsapp' when lower(action_type) like '%call%' then 'call' when lower(action_type)='profile_opened' then 'profile_open' when lower(action_type) in ('profile_updated','candidate_updated') then 'profile_edit' when lower(action_type) like '%task%' then 'task' when lower(action_type) like '%note%' then 'note' when lower(action_type) like '%interview%' then 'interview' when lower(action_type) in ('join_work','break_started','break_ended','unlock_requested','crm_unlocked','attendance_report_sent') then 'attendance' else 'other' end`;
    if(category){params.push(category);where.push(`(${sqlCategory})=$${params.length}`);}
    if(search){params.push(search);const searchParam=params.length;params.push(users.filter(u=>lower(u.full_name).includes(search)).map(u=>String(u.user_id)));where.push(`(position(lower($${searchParam}) in lower(coalesce(username,'')||' '||coalesce(action_type,'')||' '||coalesce(candidate_id,'')||' '||coalesce(metadata,'')))>0 or user_id=any($${params.length}::text[]))`);}
    if(cursor){params.push(cursor.at,cursor.id);where.push(`(created_at,coalesce(nullif(activity_id,''),id::text)) < ($${params.length-1},$${params.length})`);}
    if(!['manager','admin'].includes(role)){const scope=candidateScopeSql('cc_activity',req.user,params);params.push([...soloIds]);const ref=`$${params.length}`;where.push(`(case when coalesce(candidate_id,'')<>'' then exists(select 1 from public.candidates cc_activity where cc_activity.candidate_id=activity_log.candidate_id and ${scope.sql}) else user_id=any(${ref}::text[]) end)`);}
    params.push(limit+1);
    const sql=`select coalesce(nullif(activity_id,''),id::text) as id,user_id,username,action_type,candidate_id,left(coalesce(metadata,''),4096) as metadata,created_at from public.activity_log where ${where.join(' and ')} order by created_at desc,coalesce(nullif(activity_id,''),id::text) desc limit $${params.length}`;
    rows=await recentActivityCache.load(JSON.stringify([require('../lib/accessRules').dashboardCacheKey(req.user),sql,params]),()=>store.query(sql,params));
  }else{
    const profiles=new Map((await table('candidates')).map(c=>[String(c.candidate_id),c]));
    rows=(await table('activity_log')).filter(row=>role==='manager'||row.candidate_id?role==='manager'||require('../lib/accessRules').visibleCandidateForUser(profiles.get(String(row.candidate_id))||{},req.user):soloIds.has(String(row.user_id))).map(row=>({...row,id:String(row.activity_id||row.id||'')})).filter(row=>scopeIds.includes(String(row.user_id))&&String(row.created_at)>=from&&String(row.created_at)<=to&&(!category||classifyActivity(row.action_type)===category)&&(!search||[row.username,row.action_type,row.candidate_id,row.metadata,users.find(u=>String(u.user_id)===String(row.user_id))?.full_name].some(v=>lower(v).includes(search)))&&(!cursor||String(row.created_at)<cursor.at||(String(row.created_at)===cursor.at&&row.id<cursor.id))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))||String(b.id).localeCompare(String(a.id))).slice(0,limit+1);
  }
  const more=rows.length>limit,picked=rows.slice(0,limit),userMap=new Map(users.map(u=>[String(u.user_id),u]));
  const items=picked.map(row=>{const decorated=decorateActivity(row),u=userMap.get(String(row.user_id))||{};return {id:String(row.id),user_id:row.user_id,employee_name:u.full_name||u.username||row.username,employee_role:activityRole(u),candidate_id:row.candidate_id||'',created_at:row.created_at,activity_category:decorated.activity_category,action_label:row.action_type==='whatsapp_opened'?'WhatsApp opened':decorated.action_label,details_text:decorated.details_text.slice(0,320)};});
  const last=picked[picked.length-1];
  return {items,employees:users.map(u=>({user_id:u.user_id,full_name:u.full_name||u.username,role:activityRole(u)})).sort((a,b)=>a.full_name.localeCompare(b.full_name)),next_cursor:more&&last?Buffer.from(JSON.stringify({at:last.created_at,id:String(last.id)})).toString('base64url'):'',updated_at:new Date(now).toISOString(),retention_days:30,limit};
}
async function recentActivity(req,res){try{return res.json(await readScopedActivity(req));}catch(e){if(e.status)return res.status(e.status).json({message:e.message});throw e;}}
async function exportRecentActivity(req,res){
  if(activityRole(req.user)!=='manager')return res.status(403).json({message:'Manager export only.'});
  // Exports use exactly the same scoped, bounded page as the screen.
  const data=await readScopedActivity({...req,query:{...req.query,limit:100}});
  res.setHeader('Content-Type','application/vnd.ms-excel');res.setHeader('Content-Disposition','attachment; filename="recent-activity.xls"');
  return res.send(buildActivityWorkbook(data.items.map(row=>({...row,username:row.employee_name}))));
}

async function clientPipeline(req, res) {
  return res.json({ items: await table('client_pipeline') });
}

async function revenueHub(req, res) {
  return res.json({ items: await table('revenue_entries') });
}

async function performanceCentre(req, res) {
  const liveMode = String(req.query?.live || '') === '1';
  const cached = getCachedPerformance(req);
  if (cached) return res.json(cached);

  const scope=candidateScopeSql('c',req.user,[]),teamIds=[req.user.user_id,...(req.user.__ccTeamUserIds || [])];
  const teamWhere=isAdminOrManager(req.user)?'true':'user_id=any($1::text[])';
  const teamArgs=isAdminOrManager(req.user)?[]:[teamIds];
  const cutoff=new Date(Date.now()-30*86400000).toISOString();
  const callScope=require('../lib/accessRules').simpleOwnerSql('l',['employee_user_id','employee_name','employee_username','recruiter_code'],req.user,[]);
  const candidateFields=['candidate_id','full_name','phone','recruiter_user_id','recruiter_code','recruiter_name','status','approval_status','deleted_at','deleted_by','all_details_sent','submission_date','approval_requested_at','submitted_by','interview_date','interview_reschedule_date','created_at','updated_at'];
  const [users, candidates, tasks, notifications, activityLog, submissions, interviews, presence, callLogs] = await (store.pool ? Promise.all([
    safeOpsQuery(`select user_id,username,full_name,role,designation,recruiter_code from public.users where ${teamWhere}`,teamArgs),
    safeOpsQuery(`select ${candidateFields.map(f=>`c.${f}`).join(',')} from public.candidates c where ${scope.sql}`,scope.params),
    safeOpsQuery(`select task_id,title,status,assigned_to_user_id,assigned_to_name,due_date,priority from public.tasks where ${isAdminOrManager(req.user)?'true':'assigned_to_user_id=any($1::text[]) or lower(assigned_to_name)=any($2::text[])'}`,isAdminOrManager(req.user)?[]:[teamIds,[req.user.full_name,...(req.user.__ccTeamNames || [])].map(lower)]),
    safeOpsQuery(`select notification_id,user_id,status from public.notifications where lower(status)='unread' and ${teamWhere}`,teamArgs),
    safeOpsQuery(`select activity_id,user_id,username,action_type,candidate_id,metadata,created_at from public.activity_log where created_at>=$${teamArgs.length+1} and ${teamWhere}`,[...teamArgs,cutoff]),
    safeOpsQuery(`select s.* from public.submissions s where exists(select 1 from public.candidates c where c.candidate_id=s.candidate_id and ${scope.sql})`,scope.params),
    safeOpsQuery(`select i.* from public.interviews i where exists(select 1 from public.candidates c where c.candidate_id=i.candidate_id and ${scope.sql})`,scope.params),
    safeOpsQuery(`select p.* from public.presence p where ${teamWhere}`,teamArgs),
    safeOpsQuery(`select l.* from public.call_logs l where ${callScope.sql} and coalesce(l.call_started_at,l.created_at,l.updated_at,'') >= $${callScope.params.length+1}`,[...callScope.params,new Date(Date.now()-36*60*60*1000).toISOString()]),
  ]) : Promise.all([
    table('users'),
    table('candidates'),
    table('tasks'),
    table('notifications'),
    table('activity_log'),
    table('submissions'),
    table('interviews'),
    table('presence'),
    table('call_logs').catch(() => []),
  ]));

  const activeCandidates = activeOpsCandidates(candidates);
  const activeCandidateIds = new Set(activeCandidates.map((row) => String(row.candidate_id || '').trim()).filter(Boolean));
  const activeSubmissions = submissions.filter((row) => rowLinkedToActiveOpsCandidate(row, activeCandidateIds));
  const activeInterviews = interviews.filter((row) => rowLinkedToActiveOpsCandidate(row, activeCandidateIds));
  const candidatesById = new Map(activeCandidates.map((row) => [String(row.candidate_id), row]));
  const usersById = new Map(users.map((row) => [String(row.user_id), row]));
  const usersByName = new Map(users.map((row) => [lower(row.full_name), row]));
  const presenceByUserId = new Map(presence.map((row) => [String(row.user_id), row]));
  const userIdsByRecruiterCode = new Map();
  const userIdsByFullName = new Map();
  for (const user of users) {
    const codeKey = lower(user.recruiter_code || user.user_id || '');
    const nameKey = lower(user.full_name || '');
    if (codeKey) userIdsByRecruiterCode.set(codeKey, [...(userIdsByRecruiterCode.get(codeKey) || []), String(user.user_id)]);
    if (nameKey) userIdsByFullName.set(nameKey, [...(userIdsByFullName.get(nameKey) || []), String(user.user_id)]);
  }

  const activityWithDerived = mergeActivitySources(
    activityLog,
    buildDerivedSubmissionActivities(activeSubmissions, candidatesById, usersById, usersByName, activityLog),
  );
  const activityByUserId = new Map();
  const lastActivityByUserId = new Map();
  for (const row of activityWithDerived) {
    const userId = String(row.user_id || '');
    if (!activityByUserId.has(userId)) activityByUserId.set(userId, []);
    activityByUserId.get(userId).push(row);
    const stamp = toMs(row.created_at);
    if (userId && stamp && stamp > (lastActivityByUserId.get(userId) || 0)) lastActivityByUserId.set(userId, stamp);
  }

  const candidateCountByUserId = new Map();
  const interviewCountByUserId = new Map();
  const addCount = (map, userId, delta = 1) => {
    if (!userId) return;
    map.set(String(userId), Number(map.get(String(userId)) || 0) + Number(delta || 0));
  };

  for (const candidate of activeCandidates) {
    const matched = new Set();
    if(candidate.recruiter_user_id) matched.add(String(candidate.recruiter_user_id));
    else if(candidate.recruiter_code){for (const code of csvList(candidate.recruiter_code)) for (const userId of (userIdsByRecruiterCode.get(lower(code)) || [])) matched.add(String(userId));}
    else for (const userId of (userIdsByFullName.get(lower(candidate.recruiter_name || '')) || [])) matched.add(String(userId));
    matched.forEach((userId) => addCount(candidateCountByUserId, userId));
  }

  for (const interview of activeInterviews) {
    const candidate = candidatesById.get(String(interview.candidate_id)) || {};
    const matched = new Set();
    if(candidate.recruiter_user_id) matched.add(String(candidate.recruiter_user_id));
    else if(candidate.recruiter_code){for (const code of csvList(candidate.recruiter_code)) for (const userId of (userIdsByRecruiterCode.get(lower(code)) || [])) matched.add(String(userId));}
    else for (const userId of (userIdsByFullName.get(lower(candidate.recruiter_name || '')) || [])) matched.add(String(userId));
    matched.forEach((userId) => addCount(interviewCountByUserId, userId));
  }

  const openTasksByUserId = new Map();
  for (const task of tasks) {
    if (['done','closed','completed','cancelled','deleted','archived'].includes(lower(task.status))) continue;
    const matched = new Set();
    if (task.assigned_to_user_id) matched.add(String(task.assigned_to_user_id));
    for (const userId of (userIdsByFullName.get(lower(task.assigned_to_name || '')) || [])) matched.add(String(userId));
    matched.forEach((userId) => addCount(openTasksByUserId, userId));
  }

  const unreadNotificationsByUserId = new Map();
  for (const item of notifications) {
    if (lower(item.status) !== 'unread') continue;
    addCount(unreadNotificationsByUserId, item.user_id);
  }

  const submissionCountByUserId = new Map();
  const seenSubmissionKeys = new Set();
  for (const row of activeSubmissions) {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    const submitter = buildSubmitterContext(row, candidate, usersById, usersByName);
    const stamp = submissionStamp(row, candidate);
    if (!stamp) continue;
    const dedupeKey = `${submitter.user_id || submitter.recruiter_code || submitter.full_name || 'unknown'}|${buildSubmissionIdentity(row, candidate)}`;
    if (seenSubmissionKeys.has(dedupeKey)) continue;
    seenSubmissionKeys.add(dedupeKey);
    const matched = new Set();
    if (submitter.user_id) matched.add(String(submitter.user_id));
    for (const userId of (userIdsByRecruiterCode.get(lower(submitter.recruiter_code || '')) || [])) matched.add(String(userId));
    for (const userId of (userIdsByFullName.get(lower(submitter.full_name || '')) || [])) matched.add(String(userId));
    matched.forEach((userId) => addCount(submissionCountByUserId, userId));
  }

  const callMetricsByUserId = buildCallMetricsForUsers(callLogs || [], users || [], activeCandidates || []);
  const activeCandidateIdsForCalls = new Set((activeCandidates || []).map((c) => String(c.candidate_id || '').trim()).filter(Boolean));
  const activeCandidatePhonesForCalls = new Set((activeCandidates || []).map((c) => normalizePhone(c.phone || c.number || c.mobile || c.candidate_phone || '').slice(-10)).filter(Boolean));
  const recentTrackedCalls = dedupeCallRows(callLogs || []).filter((row) => {
    const candidateId = String(row.candidate_id || row.current_candidate_id || '').trim();
    const candidatePhone = normalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '').slice(-10);
    const candidateMatch = (candidateId && activeCandidateIdsForCalls.has(candidateId)) || (candidatePhone && activeCandidatePhonesForCalls.has(candidatePhone));
    return toMs(row.call_started_at || row.created_at || row.updated_at) >= (Date.now() - 30 * 60 * 1000);
  });

  const items = users.map((u) => {
    const mine = activityByUserId.get(String(u.user_id)) || [];
    const crmLocked = mine.filter((row) => ['crm_locked', 'no_call_lock'].includes(lower(row.action_type))).length;
    const breakEvents = mine.filter((row) => lower(row.action_type) === 'break_started').length;
    const lastActivityStamp = lastActivityByUserId.get(String(u.user_id)) || toMs(presenceByUserId.get(String(u.user_id))?.last_seen_at) || toMs(presenceByUserId.get(String(u.user_id))?.work_started_at);
    const livePresence = presenceByUserId.get(String(u.user_id)) || {};
    const live = livePresenceMetrics(livePresence);
    const cm = callMetricsByUserId.get(String(u.user_id)) || callMetricsByUserId.get(String(u.username || '')) || emptyCallMetrics();
    const profileOpens = mine.filter((row) => lower(row.action_type) === 'profile_opened');
    const uniqueProfileOpen = new Set(profileOpens.map((row) => String(row.candidate_id || safeJson(row.metadata).candidate_id || '')).filter(Boolean)).size;
    const todayRecentCalls = recentTrackedCalls.filter((row) => {
      return String(row.employee_user_id || row.user_id || '') === String(u.user_id || '')
        || lower(row.employee_username || row.username || '') === lower(u.username || '')
        || lower(row.employee_name || row.recruiter_name || '') === lower(u.full_name || u.name || '')
        || lower(row.recruiter_code || row.employee_code || '') === lower(u.recruiter_code || u.employee_code || '');
    });
    const activeBreakMinutes = String(livePresence.is_on_break || '0') === '1' ? Math.max(0, Math.round((Date.now() - toMs(livePresence.break_started_at)) / 60000)) : 0;
    const totalBreakMinutes = Number(livePresence.total_break_minutes || 0) + activeBreakMinutes;
    const calculatedIdle = Math.max(0, Number(live.idle_minutes || 0) || 0);
    return {
      user_id: u.user_id,
      full_name: u.full_name,
      role: u.role,
      recruiter_code: u.recruiter_code,
      designation: u.designation,
      candidate_count: Number(candidateCountByUserId.get(String(u.user_id)) || 0),
      open_tasks: Number(openTasksByUserId.get(String(u.user_id)) || 0),
      unread_notifications: Number(unreadNotificationsByUserId.get(String(u.user_id)) || 0),
      ...cm,
      whatsapp_count: mine.filter((row) => lower(row.action_type) === 'whatsapp_opened').length,
      profiles_opened_count: profileOpens.length,
      unique_profiles_opened_count: uniqueProfileOpen,
      submissions_count: Number(submissionCountByUserId.get(String(u.user_id)) || 0),
      interviews_count: Number(interviewCountByUserId.get(String(u.user_id)) || 0),
      crm_locked_count: crmLocked,
      break_events: breakEvents,
      break_count: breakEvents,
      break_minutes: totalBreakMinutes,
      break_hours: Math.round((totalBreakMinutes / 60) * 100) / 100,
      session_minutes: live.session_minutes,
      productive_minutes: live.productive_work_minutes,
      login_minutes: live.session_minutes,
      work_minutes: live.productive_work_minutes,
      active_break: ['1','true','yes'].includes(lower(livePresence.is_on_break)),
      no_call_30: todayRecentCalls.length ? 0 : 1,
      no_profile_open_30: profileOpens.filter((row) => toMs(row.created_at) >= (Date.now() - 30 * 60 * 1000)).length ? 0 : 1,
      last_activity_at: lastActivityStamp ? new Date(lastActivityStamp).toISOString() : '',
      idle_minutes: calculatedIdle,
    };
  });

  const normalizedActivity = activityWithDerived.map((row) => {
    const user = usersById.get(String(row.user_id)) || {};
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    const metadata = safeJson(row.metadata);
    return {
      activity_id: row.activity_id,
      user_id: row.user_id,
      full_name: user.full_name || row.username || '',
      recruiter_code: user.recruiter_code || candidate.recruiter_code || metadata.recruiter_code || '',
      role: user.role || '',
      candidate_id: row.candidate_id || '',
      candidate_name: candidate.full_name || metadata.full_name || '',
      action_type: row.action_type || '',
      action_label: titleCaseAction(row.action_type || ''),
      category: pickActionCategory(row.action_type || ''),
      created_at: row.created_at || '',
      metadata,
    };
  }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const normalizedSubmissions = activeSubmissions.map((row) => {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    const derivedSubmitter = buildSubmitterContext(row, candidate, usersById, usersByName);
    return {
      submission_id: row.submission_id,
      candidate_id: row.candidate_id,
      candidate_name: candidate.full_name || '',
      submitted_by_user_id: derivedSubmitter.user_id || '',
      recruiter_code: derivedSubmitter.recruiter_code || '',
      recruiter_name: derivedSubmitter.recruiter_name || '',
      approval_status: row.approval_status || '',
      status: row.status || '',
      submitted_at: submissionStamp(row, candidate),
    };
  });

  const normalizedInterviews = activeInterviews.map((row) => {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    return {
      interview_id: row.interview_id,
      candidate_id: row.candidate_id,
      candidate_name: candidate.full_name || '',
      recruiter_code: candidate.recruiter_code || '',
      recruiter_name: candidate.recruiter_name || '',
      stage: row.stage || '',
      status: row.status || '',
      created_at: row.created_at || row.scheduled_at || '',
      scheduled_at: row.scheduled_at || '',
    };
  });

  const payload = {
    generated_at: nowIso(),
    items,
    users,
    presence,
    tasks,
    notifications,
    candidates: activeCandidates,
    activity_items: normalizedActivity,
    submissions: normalizedSubmissions,
    interviews: normalizedInterviews,
    recruiter_options: users
      .filter((row) => ['recruiter', 'tl', 'manager', 'admin', 'team lead'].includes(lower(row.role)))
      .map((row) => ({
        user_id: row.user_id,
        full_name: row.full_name,
        recruiter_code: row.recruiter_code || row.user_id,
        role: row.role,
      })),
  };
  setCachedPerformance(req, payload);
  return res.json(payload);
}

module.exports = {
  recentActivity,
  exportRecentActivity,
  clientPipeline,
  revenueHub,
  performanceCentre,
};

module.exports.buildCallMetricsForUsers = buildCallMetricsForUsers;

const USAGE_CHECKLIST_180=[{"id": "S001", "platform": "Supabase", "label": "Uncached egress: total", "kind": "Monthly quota", "limit_note": "5 GB / billing cycle; organization ke sab projects ka total", "where": "Organization > Usage > Egress", "frequency": "Daily", "action": "Aaj ka increase aur cycle-end pace dekhein; repeat downloads kam karein", "reference": "S1 S3 S11"}, {"id": "S002", "platform": "Supabase", "label": "Cached egress: total", "kind": "Monthly quota", "limit_note": "Alag 5 GB; Storage CDN cache hits; browser cache nahi", "where": "Organization > Usage > Cached egress", "frequency": "Daily if Storage", "action": "Uncached 5 GB ke saath interchange na karein", "reference": "S1 S3"}, {"id": "S003", "platform": "Supabase", "label": "Database egress breakdown", "kind": "Usage component", "limit_note": "Total egress ka hissa; alag extra allowance nahi", "where": "Usage > Egress breakdown", "frequency": "Daily", "action": "Sabse bade result aur repeat list requests trace karein", "reference": "S3"}, {"id": "S004", "platform": "Supabase", "label": "Shared Pooler egress", "kind": "Usage component", "limit_note": "Supavisor se backend tak aane wale results", "where": "Usage > Shared Pooler egress", "frequency": "Daily", "action": "Browser response chhota hone par bhi DB-to-backend bytes dekhein", "reference": "S3"}, {"id": "S005", "platform": "Supabase", "label": "Storage egress / downloads", "kind": "Usage component", "limit_note": "Resume / image / audio / PDF download bytes", "where": "Usage > Storage egress", "frequency": "Daily if Storage", "action": "Repeat previews aur full file downloads count karein", "reference": "S3"}, {"id": "S006", "platform": "Supabase", "label": "Auth / Functions / Realtime egress", "kind": "Usage components", "limit_note": "Enabled services ke bytes bhi total egress me judte hain", "where": "Usage > Egress breakdown", "frequency": "Conditional", "action": "Sirf used services check karein; total aur parts ko dobara add na karein", "reference": "S3"}, {"id": "S007", "platform": "Supabase", "label": "Database size", "kind": "Capacity quota", "limit_note": "500 MB per project; data + indexes + materialized views", "where": "Database reports / Usage", "frequency": "Daily", "action": "Growth note karein; bina review purana data delete na karein", "reference": "S1 S4"}, {"id": "S008", "platform": "Supabase", "label": "Physical disk free space", "kind": "Capacity health", "limit_note": "Free fixed physical disk 2 GB; 95% used par read-only safeguard; DB quota alag", "where": "Infrastructure / Database settings", "frequency": "Daily", "action": "WAL/temp/system included; 95% se kaafi pehle action; safeguard guarantee nahi", "reference": "S4"}, {"id": "S009", "platform": "Supabase", "label": "Largest tables / daily growth", "kind": "Storage health", "limit_note": "Universal row-count quota nahi; bytes aur growth matter karte hain", "where": "Database reports; read-only table-sizes", "frequency": "Weekly; daily if growing", "action": "Top growing tables aur unke write sources identify karein", "reference": "S5"}, {"id": "S010", "platform": "Supabase", "label": "Index sizes / unused indexes", "kind": "Storage / write health", "limit_note": "Har index disk aur write work badha sakta hai", "where": "Read-only index-sizes / index-usage", "frequency": "Weekly / after schema change", "action": "Query evidence ke bina indexes add ya drop na karein", "reference": "S5"}, {"id": "S011", "platform": "Supabase", "label": "Audit / history / notification growth", "kind": "Application health", "limit_note": "Activity rows tezi se size badha sakti hain", "where": "Largest-table reports / app metrics", "frequency": "Daily trend", "action": "Noisy duplicate events kam karein; audit data blindly delete nahi", "reference": "C1 S5"}, {"id": "S012", "platform": "Supabase", "label": "Base64 / large JSON inside rows", "kind": "Application health", "limit_note": "Bade row payload DB size aur result bytes badhate hain", "where": "Schema / sampled response sizes", "frequency": "Weekly / change", "action": "Files ko har list me na bhejein; safe migration review karein", "reference": "C1"}, {"id": "S013", "platform": "Supabase", "label": "File Storage used", "kind": "Capacity quota", "limit_note": "1 GB included; database 500 MB se alag", "where": "Storage / Organization Usage", "frequency": "Daily if Storage", "action": "File growth aur actual app reference reconcile karein", "reference": "S1 S11"}, {"id": "S014", "platform": "Supabase", "label": "Per-file upload size", "kind": "Request cap", "limit_note": "Free par configured cap 50 MB se zyada nahi", "where": "Storage settings + bucket settings", "frequency": "Change / upload failure", "action": "App aur bucket caps match karein; failed upload blindly repeat nahi", "reference": "S9"}, {"id": "S015", "platform": "Supabase", "label": "Duplicate / orphan files", "kind": "Storage health", "limit_note": "Same file ki multiple copies; bina profile reference wale uploads", "where": "Storage inventory + app references", "frequency": "Weekly", "action": "Reference verify karke review list banayein; automatic delete nahi", "reference": "C1"}, {"id": "S016", "platform": "Supabase", "label": "Upload failures / repeated transfers", "kind": "Traffic health", "limit_note": "Har re-upload duplicate work / files bana sakta hai", "where": "Storage logs + browser Network", "frequency": "Daily if uploads", "action": "Failed response aur saved object verify karke hi retry karein", "reference": "C1"}, {"id": "S017", "platform": "Supabase", "label": "Database CPU: average and peak", "kind": "Compute health", "limit_note": "Shared Nano CPU; monthly CPU-minutes bucket nahi", "where": "Observability / Infrastructure", "frequency": "Daily; peak work time", "action": "Sustained load ko top query calls/time se match karein", "reference": "S1 S2 S5"}, {"id": "S018", "platform": "Supabase", "label": "Database RAM pressure", "kind": "Compute health", "limit_note": "Free roughly 0.5 GB shared memory; cache usage akeli failure nahi", "where": "Infrastructure / database health", "frequency": "Daily", "action": "Low available memory, swap aur failures saath dekhein", "reference": "S1 S2"}, {"id": "S019", "platform": "Supabase", "label": "Swap / OOM / DB restarts", "kind": "Failure signal", "limit_note": "Memory pressure / restart events; koi monthly quota nahi", "where": "Infrastructure + Postgres logs", "frequency": "Daily", "action": "Badi sorts, concurrent queries aur large results inspect karein", "reference": "C1 S14"}, {"id": "S020", "platform": "Supabase", "label": "Disk I/O burst balance", "kind": "Compute health", "limit_note": "Kam balance kharab; 0% par burst exhausted, baseline par wapas", "where": "Observability + Infrastructure minimum balance", "frequency": "Daily; busy periods", "action": "Average ke saath minimum / dips bhi dekhein", "reference": "S2"}, {"id": "S021", "platform": "Supabase", "label": "Read IOPS", "kind": "Compute rate", "limit_note": "Nano baseline combined IOPS 250; read/write alag allowance nahi", "where": "Disk I/O graphs", "frequency": "Daily trend", "action": "Repeated scans aur cache misses identify karein", "reference": "S2 S5"}, {"id": "S022", "platform": "Supabase", "label": "Write IOPS", "kind": "Compute rate", "limit_note": "Same disk capacity; writes + indexes + WAL ka work", "where": "Disk I/O graphs", "frequency": "Daily trend", "action": "Repeated heartbeats / logs / per-action write fan-out dekhein", "reference": "S2 C1"}, {"id": "S023", "platform": "Supabase", "label": "Disk throughput MB/s", "kind": "Compute rate", "limit_note": "Nano baseline 5 MB/s; burst sustainable allowance nahi", "where": "Disk I/O graphs", "frequency": "Daily trend", "action": "Bade reads, imports, exports aur maintenance se correlate karein", "reference": "S2"}, {"id": "S024", "platform": "Supabase", "label": "Disk I/O latency / waits", "kind": "Performance health", "limit_note": "Slow disk waits timeout ka reason ho sakte hain", "where": "Observability / query outliers", "frequency": "Daily if slow", "action": "I/O dip ko query time aur CPU ke saath compare karein", "reference": "S2 S5"}, {"id": "S025", "platform": "Supabase", "label": "Temporary files / temp bytes", "kind": "Disk / RAM health", "limit_note": "Sort / hash memory se bahar nikle to disk temp files", "where": "Query stats / permitted read-only diagnostics", "frequency": "Weekly; on spikes", "action": "Large sort/hash queries ko pehle optimize karein", "reference": "S14"}, {"id": "S026", "platform": "Supabase", "label": "Database buffer cache hit ratio", "kind": "Performance health", "limit_note": "Sudden drop investigate; fixed universal pass mark nahi", "where": "Read-only cache-hit / query stats", "frequency": "Weekly; on spikes", "action": "Same counter-reset window me compare karein", "reference": "S5"}, {"id": "S027", "platform": "Supabase", "label": "Full scans / rows examined", "kind": "Query work", "limit_note": "Kam output rows ka matlab kam DB work zaroori nahi", "where": "Query Performance / reviewed query plans", "frequency": "Weekly; on spikes", "action": "Filters, scope, indexes aur whole-list hashing inspect karein", "reference": "S5 C1"}, {"id": "S028", "platform": "Supabase", "label": "Top queries: calls and total time", "kind": "Query work", "limit_note": "Cumulative totals; reset time ke bina daily compare galat ho sakta hai", "where": "Query Performance / pg_stat_statements report", "frequency": "Daily", "action": "Sirf slowest query nahi; bahut baar chalne wali query bhi dekhein", "reference": "S5"}, {"id": "S029", "platform": "Supabase", "label": "Long-running queries / latency", "kind": "Performance health", "limit_note": "App timeout budget ke andar query finish honi chahiye", "where": "Query Performance / active queries", "frequency": "Daily", "action": "Read-only inspection; heavy EXPLAIN ANALYZE live rush me na chalayein", "reference": "S5 C1"}, {"id": "S030", "platform": "Supabase", "label": "Returned rows / selected columns", "kind": "Egress / memory work", "limit_note": "Zarurat se badi result lists, SELECT * aur notes payload", "where": "Backend sampled query/route metrics", "frequency": "Daily trend", "action": "DB se hi pagination / required columns; client-side hiding enough nahi", "reference": "S3 C1"}, {"id": "S031", "platform": "Supabase", "label": "Direct DB connections", "kind": "Connection cap", "limit_note": "Nano default max 60; platform connections bhi use karti hai", "where": "Infrastructure / Database connections", "frequency": "Daily", "action": "Backend pools ka total dekhein; 60 ko app target na banayein", "reference": "S2"}, {"id": "S032", "platform": "Supabase", "label": "Pooler client connections", "kind": "Connection cap", "limit_note": "Nano max 200 pooler clients; 200 users ki guarantee nahi", "where": "Pooler / connection metrics", "frequency": "Daily", "action": "Idle clients aur reconnect loops track karein", "reference": "S2"}, {"id": "S033", "platform": "Supabase", "label": "Pooler backend pool size", "kind": "Configured cap", "limit_note": "Nano default pool size 15; actual setting verify", "where": "Database / connection pool settings", "frequency": "Daily if busy; change", "action": "Client limit, backend pool aur app pool ko alag samjhein", "reference": "S2"}, {"id": "S034", "platform": "Supabase", "label": "Pool acquire wait / waiting requests", "kind": "App connection health", "limit_note": "Busy pool me queue aur wait badhta hai", "where": "Backend pool counters / queue logs", "frequency": "Daily", "action": "Background work bound karein; connections blindly na badhayein", "reference": "C1"}, {"id": "S035", "platform": "Supabase", "label": "Idle-in-transaction / long transactions", "kind": "DB health", "limit_note": "Khuli transaction lock / connection rok sakti hai", "where": "Read-only active sessions", "frequency": "Daily if busy", "action": "Owning code aur transaction boundary review karein", "reference": "S5"}, {"id": "S036", "platform": "Supabase", "label": "Blocked queries / lock waits", "kind": "DB health", "limit_note": "Dusri transaction ka lock wait; egress quota nahi", "where": "Read-only locks / blocking report", "frequency": "Daily if errors", "action": "Blocker ka reason identify; random kill nahi", "reference": "S5"}, {"id": "S037", "platform": "Supabase", "label": "Deadlocks / lock retry count", "kind": "Failure signal", "limit_note": "Failed transactions; bounded safe retries only", "where": "Postgres + backend logs", "frequency": "Daily", "action": "Write order / transaction scope / confirmed rollback verify karein", "reference": "C1 S5"}, {"id": "S038", "platform": "Supabase", "label": "Statement / request timeouts", "kind": "Configured limits", "limit_note": "Role, DB, pool, driver, HTTP deadlines alag ho sakte hain", "where": "DB settings + backend config + error logs", "frequency": "Daily failures; after change", "action": "Timeout badhane se pehle slow work aur deadline mismatch dekhein", "reference": "S12 C1"}, {"id": "S039", "platform": "Supabase", "label": "Failed / uncertain write outcomes", "kind": "Data correctness", "limit_note": "Timeout ke baad commit hua ya nahi, unknown ho sakta hai", "where": "Backend transaction result / draft verification", "frequency": "Daily", "action": "Unknown save ko success na dikhayein; verify before replay", "reference": "C1"}, {"id": "S040", "platform": "Supabase", "label": "Autovacuum / dead tuples", "kind": "DB maintenance health", "limit_note": "Updates ke purane row versions; automatic cleanup ko time chahiye", "where": "Read-only vacuum-stats", "frequency": "Weekly; after write spikes", "action": "Maintenance health investigate; business data delete mat karein", "reference": "S5 S14"}, {"id": "S041", "platform": "Supabase", "label": "Table / index bloat", "kind": "Storage health", "limit_note": "Reused/free space aur physical size alag ho sakte hain", "where": "Read-only bloat / table stats", "frequency": "Weekly", "action": "VACUUM FULL ya rebuild daily routine na banayein", "reference": "S4 S5"}, {"id": "S042", "platform": "Supabase", "label": "WAL retained / replication slots / lag", "kind": "Disk / replication health", "limit_note": "Nano max 5 slots / 5 WAL senders; unused slots WAL rok sakte hain", "where": "Replication / Infrastructure / read-only stats", "frequency": "Weekly; daily if replication", "action": "Slot owner / consumer verify karein; blind slot deletion nahi", "reference": "S2 S4 S5"}, {"id": "S043", "platform": "Supabase", "label": "Cron / triggers / DB webhook loops", "kind": "Background work", "limit_note": "Job overlap aur cascading writes I/O badha sakte hain", "where": "Scheduled jobs / function logs / app metrics", "frequency": "Daily if enabled", "action": "Run count, failures aur duplicate execution inspect karein", "reference": "C1"}, {"id": "S044", "platform": "Supabase", "label": "RLS / authorization query cost", "kind": "Query / access health", "limit_note": "Policies aur scope joins bhi query work karte hain", "where": "Performance advisor / reviewed query plans", "frequency": "Weekly / permission change", "action": "Speed ke liye RLS / permission checks disable nahi", "reference": "C1 S5"}, {"id": "S045", "platform": "Supabase", "label": "Backup age / restore verification", "kind": "Recovery limitation", "limit_note": "Free automatic DB backups / PITR included nahi; files alag backup chahiye", "where": "Backup records / controlled restore test", "frequency": "Daily age; periodic restore", "action": "Backup schedule bounded rakhein; full export har check par nahi", "reference": "S1 C1"}, {"id": "S046", "platform": "Supabase", "label": "Project status / read-only / pause", "kind": "Availability state", "limit_note": "Free inactivity pause roughly 1 week; quota/read-only warning bhi dekhein", "where": "Project status / billing alerts", "frequency": "Daily", "action": "Actual restriction identify karein; empty screen ko zero data na samjhein", "reference": "S1 S4"}, {"id": "S047", "platform": "Supabase", "label": "Free projects / shared org quotas", "kind": "Plan scope", "limit_note": "2 active Free projects ownership/admin scope; most usage org-level", "where": "Organization > Projects + Usage", "frequency": "Change / daily totals", "action": "CRM1 + CRM2 + test projects count; per-project free quota assume nahi", "reference": "S1 S11 S15"}, {"id": "S048", "platform": "Supabase", "label": "Auth monthly active users", "kind": "Conditional monthly quota", "limit_note": "50,000 MAU if Supabase Auth is used", "where": "Usage > Auth", "frequency": "Conditional daily", "action": "CRM ke custom login users ko automatically Supabase MAU na samjhein", "reference": "S1"}, {"id": "S049", "platform": "Supabase", "label": "Third-party auth MAU", "kind": "Conditional monthly quota", "limit_note": "50,000 third-party MAU included; only if integrated", "where": "Usage > Third-party MAU", "frequency": "Conditional", "action": "Normal MAU aur third-party MAU ko duplicate na count karein", "reference": "S1 S11"}, {"id": "S050", "platform": "Supabase", "label": "Auth signup / sign-in / verify rate", "kind": "Conditional rate cap", "limit_note": "Defaults 30 / 5 min / IP; token bucket allows bursts", "where": "Authentication > Rate Limits + logs", "frequency": "Conditional daily", "action": "Actual endpoint config dekhein; repeated login loops stop karein", "reference": "S6"}, {"id": "S051", "platform": "Supabase", "label": "Built-in auth email sending", "kind": "Conditional rate cap", "limit_note": "2 emails/hour/project; built-in test sender restrictions apply", "where": "Authentication > Rate Limits / SMTP", "frequency": "Conditional", "action": "OTP/reset delivery issue ko DB speed issue na samjhein", "reference": "S6"}, {"id": "S052", "platform": "Supabase", "label": "OTP / confirmation / reset cooldown", "kind": "Conditional rate cap", "limit_note": "Default same-user resend wait 60 seconds", "where": "Authentication logs / Rate Limits", "frequency": "Conditional", "action": "Countdown dikhayein; repeated resend requests nahi", "reference": "S6"}, {"id": "S053", "platform": "Supabase", "label": "Auth token endpoint requests", "kind": "Conditional rate cap", "limit_note": "Default 150 / 5 min / IP; burst bucket applies", "where": "Authentication logs / Rate Limits", "frequency": "Conditional", "action": "Refresh loops, multiple tabs aur invalid tokens investigate", "reference": "S6"}, {"id": "S054", "platform": "Supabase", "label": "Auth SMS / MFA rate and provider credits", "kind": "Conditional rate / external quota", "limit_note": "SMS default 30/hour; MFA challenge 15/min/IP; provider bill alag", "where": "Auth Rate Limits + SMS provider", "frequency": "Conditional", "action": "Configured limits aur SMS balance dono dekhein", "reference": "S6"}, {"id": "S055", "platform": "Supabase", "label": "Realtime messages per month", "kind": "Conditional monthly quota", "limit_note": "2 million / org; enabled subscriptions only", "where": "Usage > Realtime", "frequency": "Conditional daily", "action": "Render SSE ko Supabase Realtime quota na samjhein", "reference": "S1 S11 C1"}, {"id": "S056", "platform": "Supabase", "label": "Realtime concurrent connections", "kind": "Conditional concurrency cap", "limit_note": "Free 200 per project", "where": "Realtime reports / settings", "frequency": "Conditional daily", "action": "Tabs/devices aur duplicate subscriptions dekhein", "reference": "S7"}, {"id": "S057", "platform": "Supabase", "label": "Realtime messages per second", "kind": "Conditional rate cap", "limit_note": "Free 100 messages/sec", "where": "Realtime reports / error logs", "frequency": "Conditional daily", "action": "Burst fan-out aur reconnect cascades ko control karein", "reference": "S7"}, {"id": "S058", "platform": "Supabase", "label": "Realtime channel joins / second", "kind": "Conditional rate cap", "limit_note": "Free 100 joins/sec", "where": "Realtime logs", "frequency": "Conditional", "action": "Join loop aur repeated component subscriptions inspect karein", "reference": "S7"}, {"id": "S059", "platform": "Supabase", "label": "Realtime channels per connection", "kind": "Conditional cap", "limit_note": "Free 100 channels per connection", "where": "Client subscription inventory", "frequency": "Conditional", "action": "Unused channel subscriptions cleanup karein", "reference": "S7"}, {"id": "S060", "platform": "Supabase", "label": "Realtime Presence limits", "kind": "Conditional rate / payload", "limit_note": "20 messages/sec; 5 calls/client/30 sec; 10 keys/object", "where": "Realtime settings / client logs", "frequency": "Conditional", "action": "Presence heartbeat throttle karein; live board feature preserve karein", "reference": "S7"}, {"id": "S061", "platform": "Supabase", "label": "Realtime message payload", "kind": "Conditional payload cap", "limit_note": "Broadcast 256 KB; Postgres changes 1,024 KB", "where": "Realtime errors / payload inspection", "frequency": "Conditional", "action": "Full candidate/notes/file data broadcast nahi; small change signal", "reference": "S7"}, {"id": "S062", "platform": "Supabase", "label": "Edge Function invocation count", "kind": "Conditional monthly quota", "limit_note": "500,000 invocations / org", "where": "Usage > Edge Functions", "frequency": "Conditional daily", "action": "Recursive / duplicate / cron-triggered runs count karein", "reference": "S1 S11"}, {"id": "S063", "platform": "Supabase", "label": "Edge Function memory", "kind": "Conditional runtime cap", "limit_note": "256 MB maximum", "where": "Function logs / resource errors", "frequency": "Conditional", "action": "Bade imports / binary buffers bound karein", "reference": "S8"}, {"id": "S064", "platform": "Supabase", "label": "Edge Function wall / idle duration", "kind": "Conditional runtime cap", "limit_note": "Free worker wall 150 sec; idle request timeout 150 sec", "where": "Function logs", "frequency": "Conditional", "action": "Job duration aur pending requests bound karein", "reference": "S8"}, {"id": "S065", "platform": "Supabase", "label": "Edge Function CPU time", "kind": "Conditional runtime cap", "limit_note": "2 sec CPU/request; network wait CPU time nahi", "where": "Function logs / CPU limit errors", "frequency": "Conditional", "action": "CPU-heavy processing ko request se alag design karein", "reference": "S8"}, {"id": "S066", "platform": "Supabase", "label": "Edge deployment bundle / count", "kind": "Conditional deployment cap", "limit_note": "100 functions/project; bundle 20 MB CLI or 5 MB server-side", "where": "Functions deployment / CLI logs", "frequency": "Change if used", "action": "Unused dependencies exclude karein; export artifacts repo me nahi", "reference": "S8"}, {"id": "S067", "platform": "Supabase", "label": "Edge logs / recursion / secrets count", "kind": "Conditional platform caps", "limit_note": "Logs 100 events/10sec; message 10k chars; recursion 30/trace/60sec; 100 secrets", "where": "Function logs / settings", "frequency": "Conditional / change", "action": "Noisy logs aur recursive invocation investigate; secret values record nahi", "reference": "S8"}, {"id": "S068", "platform": "Supabase", "label": "Management API request rate", "kind": "Conditional platform rate", "limit_note": "Standard 120 requests/min; some endpoints lower", "where": "Management API response headers / 429s", "frequency": "Conditional", "action": "Monitoring ke liye fast repeated polling nahi", "reference": "S10"}, {"id": "S069", "platform": "Supabase", "label": "Data API maximum result rows", "kind": "Conditional configured cap", "limit_note": "Default 1,000 rows/response; not total DB row limit; direct SQL alag", "where": "Project API settings", "frequency": "Change if Data API", "action": "Pagination ke bina truncated data se counts na banayein", "reference": "S13"}, {"id": "S070", "platform": "Supabase", "label": "Platform log retention / ingestion / queries", "kind": "Plan / observability quota", "limit_note": "Free API/DB logs retention 1 day; ingestion/query meters plan se verify", "where": "Logs + Organization Usage", "frequency": "Daily errors; weekly usage", "action": "Old logs expire; lightweight error summary save karein", "reference": "S1"}, {"id": "S071", "platform": "Supabase", "label": "Database size fair-use / period average", "kind": "Billing restriction signal", "limit_note": "Organization aggregate average aur 402 restriction bhi check; live size alone enough nahi", "where": "Organization Usage + restriction notice", "frequency": "Daily", "action": "Pricing per-project allowance aur Fair Use meter alag dekhein; shrink se immediate reset nahi", "reference": "S4 S11"}, {"id": "S072", "platform": "Supabase", "label": "Logs Ingest volume", "kind": "Logs quota", "limit_note": "Free includes 1 GB ingest; actual meter/account rollout verify", "where": "Organization Usage > Logs Ingest", "frequency": "Daily", "action": "Noisy app/DB logs aur debug dumps kam karein", "reference": "S16 S1"}, {"id": "S073", "platform": "Supabase", "label": "Logs Query scanned volume", "kind": "Logs query allowance", "limit_note": "Free base 100 GB scanned; allowance scales 100x ingest; not billed; enforcement rollout verify", "where": "Organization Usage > Logs Query", "frequency": "Daily if querying logs", "action": "Har check par poore mahine ke raw logs scan nahi", "reference": "S17 S16"}, {"id": "R001", "platform": "Render", "label": "Free instance hours", "kind": "Monthly quota", "limit_note": "750 hours / workspace / calendar month; all Free web services share", "where": "Billing > Monthly Included Usage", "frequency": "Daily", "action": "2 always-on services roughly double hours; static sites yeh hours consume nahi karti", "reference": "R1"}, {"id": "R002", "platform": "Render", "label": "Outbound bandwidth: total", "kind": "Monthly quota", "limit_note": "Hobby current included 5 GB / workspace; legacy account screen verify", "where": "Workspace Billing > Bandwidth", "frequency": "Daily", "action": "Frontend + backend + service-initiated outbound add hota hai", "reference": "R2"}, {"id": "R003", "platform": "Render", "label": "Bandwidth by service / traffic type", "kind": "Usage component", "limit_note": "One service kis direction me bytes bhej rahi hai", "where": "Service > Metrics > Outbound bandwidth", "frequency": "Daily", "action": "Top service aur request type isolate karein", "reference": "R2 R5"}, {"id": "R004", "platform": "Render", "label": "Pipeline minutes used", "kind": "Monthly quota", "limit_note": "Hobby Starter tier 500 minutes / workspace", "where": "Billing > Pipeline minutes", "frequency": "Daily / deploy day", "action": "Repeated push / failed rebuild / duplicate deploy kam karein", "reference": "R3"}, {"id": "R005", "platform": "Render", "label": "Pipeline spend limit / payment state", "kind": "Billing control", "limit_note": "Limit/card par build stop ho sakti hai; current app chal sakti hai", "where": "Workspace settings > Build Pipeline / Billing", "frequency": "Daily alerts; change", "action": "Budget aur existing deployed version note karein", "reference": "R1 R3"}, {"id": "R006", "platform": "Render", "label": "Running service CPU", "kind": "Compute capacity", "limit_note": "Free 0.1 CPU; runtime resource, monthly minutes bucket nahi", "where": "Service > Metrics", "frequency": "Daily; busy periods", "action": "Sustained pressure, large JSON aur CPU work identify karein", "reference": "R4 R5"}, {"id": "R007", "platform": "Render", "label": "Running service RAM", "kind": "Compute capacity", "limit_note": "Free 512 MB; build RAM se alag", "where": "Service > Metrics", "frequency": "Daily; busy periods", "action": "RSS, buffers, cache size aur memory leaks check karein", "reference": "R4 R5"}, {"id": "R008", "platform": "Render", "label": "OOM kills / crash count", "kind": "Failure signal", "limit_note": "Out-of-memory / abnormal process exit", "where": "Service > Events / Logs", "frequency": "Daily", "action": "Last error + memory peak ko correlate karein", "reference": "C1 R5"}, {"id": "R009", "platform": "Render", "label": "Restart / deploy frequency", "kind": "Availability / cache health", "limit_note": "Free service restart ho sakti hai; cache phir warm hota hai", "where": "Events / deploy history", "frequency": "Daily", "action": "Unexpected restarts aur repeated DB cache refill identify karein", "reference": "R1 C1"}, {"id": "R010", "platform": "Render", "label": "Idle sleep / cold start", "kind": "Free runtime restriction", "limit_note": "15 min without inbound traffic par sleep; next spin-up about 1 min", "where": "Events / first-request timing", "frequency": "Daily availability", "action": "Cache se screen dikhayein; keep-awake polling se waste mat badhayein", "reference": "R1"}, {"id": "R011", "platform": "Render", "label": "Health checks / service uptime", "kind": "Availability signal", "limit_note": "App health route aur deploy health status", "where": "Service > Events / Health Check / app logs", "frequency": "Daily", "action": "Health endpoint se heavy DB scan na karwayein", "reference": "C1"}, {"id": "R012", "platform": "Render", "label": "HTTP volume / 4xx / 5xx / 429", "kind": "Traffic / error signal", "limit_note": "Free inbound rate limiting possible; fixed public universal cap nahi", "where": "Metrics; app-generated bounded request logs", "frequency": "Daily", "action": "Sudden request spikes, errors, bots aur duplicate requests inspect", "reference": "R5 C1"}, {"id": "R013", "platform": "Render", "label": "Response latency / p95 / p99", "kind": "Performance signal", "limit_note": "Native latency graphs Pro+; Free par app instrumentation may be needed", "where": "Metrics where available; sampled app timings", "frequency": "Daily", "action": "Same endpoint / workload compare; unavailable ko zero nahi", "reference": "R5"}, {"id": "R014", "platform": "Render", "label": "Request / upstream timeout count", "kind": "Failure signal", "limit_note": "App, proxy, DB aur network deadlines alag ho sakti hain", "where": "App logs + browser Network", "frequency": "Daily", "action": "Failed route aur request ID se bottleneck trace karein", "reference": "C1"}, {"id": "R015", "platform": "Render", "label": "SSE / WebSocket reconnects", "kind": "Traffic / availability signal", "limit_note": "Connection churn extra checks aur bytes badha sakta hai", "where": "App connection counters / sampled logs", "frequency": "Daily", "action": "One connection per intended tab/device; bounded recovery", "reference": "R2 C1"}, {"id": "R016", "platform": "Render", "label": "Service-initiated public traffic restriction", "kind": "Free usage restriction", "limit_note": "Unusually high external DB/API/storage traffic par suspension possible; exact threshold not published", "where": "Billing bandwidth + provider alerts", "frequency": "Daily", "action": "External calls bound/cache karein; hidden safety quota invent nahi", "reference": "R1"}, {"id": "R017", "platform": "Render", "label": "External DB latency / failures", "kind": "Network / performance signal", "limit_note": "Supabase round-trip aur region distance; monthly quota nahi", "where": "Sampled backend DB timings", "frequency": "Daily", "action": "Render CPU wait aur actual DB query duration alag measure karein", "reference": "C1"}, {"id": "R018", "platform": "Render", "label": "App DB pool / queue depth", "kind": "Configured runtime capacity", "limit_note": "All processes/CRM instances ke pools ka combined total", "where": "Backend pool / queue metrics", "frequency": "Daily", "action": "Writes ke liye capacity reserve; blind pool increase nahi", "reference": "C1"}, {"id": "R019", "platform": "Render", "label": "Node event-loop lag / in-flight requests", "kind": "Runtime pressure", "limit_note": "Blocked event loop frontend requests delay kar sakta hai", "where": "Bounded app instrumentation", "frequency": "Daily if slow", "action": "Sync parsing, exports aur huge JSON processing inspect karein", "reference": "C1"}, {"id": "R020", "platform": "Render", "label": "Cache hit rate / invalidation / refill", "kind": "Application efficiency", "limit_note": "Restart ya broad invalidation DB reads badha sakti hai", "where": "In-memory app counters", "frequency": "Daily trend", "action": "Targeted invalidate; shared cache; user access boundaries preserve", "reference": "C1"}, {"id": "R021", "platform": "Render", "label": "Temporary disk / buffers / file descriptors", "kind": "Runtime health", "limit_note": "Temp files / open resources can exhaust instance limits; config-specific", "where": "App diagnostics / errors", "frequency": "Weekly; on failure", "action": "Uploads stream karein; temp resources bounded cleanup; actual files preserve", "reference": "C1"}, {"id": "R022", "platform": "Render", "label": "Filesystem durability", "kind": "Free storage restriction", "limit_note": "Restart/redeploy/sleep par local changes lost; persistent disk unavailable", "where": "Service storage/config + data path review", "frequency": "Change / daily backup state", "action": "User files / only backup ko local ephemeral disk par depend na karein", "reference": "R1"}, {"id": "R023", "platform": "Render", "label": "HTTP body / upload size settings", "kind": "Configured request cap", "limit_note": "App parser / proxy / upstream caps verify; no guessed universal value", "where": "Backend config + upload errors", "frequency": "Change / daily failures", "action": "Frontend limit, backend parser aur Storage cap match karein", "reference": "C1"}, {"id": "R024", "platform": "Render", "label": "Single build duration", "kind": "Build cap", "limit_note": "Build command timeout 120 minutes", "where": "Deploy build logs", "frequency": "Each deploy", "action": "Hanging installs aur accidental large build context inspect", "reference": "R3"}, {"id": "R025", "platform": "Render", "label": "Build CPU / RAM", "kind": "Build capacity", "limit_note": "Starter pipeline 2 CPU / 8 GB RAM; runtime 512 MB se alag", "where": "Workspace pipeline tier / build logs", "frequency": "Each deploy", "action": "Build memory error ko runtime OOM se alag track karein", "reference": "R3"}, {"id": "R026", "platform": "Render", "label": "Build disk space", "kind": "Build cap", "limit_note": "16 GB build disk limit", "where": "Build logs", "frequency": "Each deploy", "action": "node_modules caches / generated artifacts build context control karein", "reference": "R3"}, {"id": "R027", "platform": "Render", "label": "Pre-deploy duration", "kind": "Build cap", "limit_note": "Pre-deploy command timeout 30 minutes", "where": "Deploy logs", "frequency": "Each deploy if configured", "action": "Long migrations daily startup se mat chalayein", "reference": "R3"}, {"id": "R028", "platform": "Render", "label": "Concurrent builds / canceled builds", "kind": "Build concurrency cap", "limit_note": "One active build per service; new build cancels current build", "where": "Deploy history", "frequency": "Each deploy day", "action": "Multiple small pushes ko planned deploy me combine karein", "reference": "R3"}, {"id": "R029", "platform": "Render", "label": "Auto-deploy / scheduled build loops", "kind": "Usage / configuration", "limit_note": "Git push, hooks, watchers ke duplicate triggers", "where": "Settings + Deploy history", "frequency": "Daily if changing code", "action": "Only intended branch/path par build trigger karein", "reference": "C1 R3"}, {"id": "R030", "platform": "Render", "label": "Static asset size / browser cache misses", "kind": "Bandwidth work", "limit_note": "JS bundles / images / repeated asset responses consume outbound", "where": "Frontend build report + browser Network", "frequency": "Weekly / deploy", "action": "Compressed assets, versioned cache, on-demand media; features preserve", "reference": "R2 C1"}, {"id": "R031", "platform": "Render", "label": "Log retention", "kind": "Observability restriction", "limit_note": "Hobby logs 7 days", "where": "Service > Logs", "frequency": "Daily errors", "action": "Issue ke time concise non-sensitive evidence save karein", "reference": "R6"}, {"id": "R032", "platform": "Render", "label": "Log lines per minute / dropped logs", "kind": "Logging rate cap", "limit_note": "6,000 app-generated lines/minute/instance; excess dropped", "where": "Logs / instrumentation", "frequency": "Daily if noisy", "action": "Per-request huge dumps band; useful sampled errors rakhein", "reference": "R6"}, {"id": "R033", "platform": "Render", "label": "Metrics retention / missing graphs", "kind": "Observability restriction", "limit_note": "Hobby metrics 7 days; some HTTP features Pro+ only", "where": "Service > Metrics", "frequency": "Daily", "action": "Daily snapshot notes rakhein; unavailable graphs ko healthy zero nahi", "reference": "R5"}, {"id": "R034", "platform": "Render", "label": "Outbound SMTP ports", "kind": "Networking restriction", "limit_note": "Free web service ports 25, 465, 587 blocked", "where": "Email errors / service config", "frequency": "Conditional", "action": "Approved HTTPS mail API/provider route verify karein", "reference": "R1"}, {"id": "R035", "platform": "Render", "label": "Single instance / no autoscaling", "kind": "Free runtime restriction", "limit_note": "Free compute single instance; no scaling beyond it", "where": "Service settings", "frequency": "Change / load growth", "action": "Optimization ke baad sustained demand fit na ho to capacity review", "reference": "R1"}, {"id": "R036", "platform": "Render", "label": "Workspace services / team members / environments", "kind": "Workspace caps", "limit_note": "Hobby: 25 services, 1 dashboard member, 2 environments/project", "where": "Workspace settings / service inventory", "frequency": "Weekly / change", "action": "Dashboard member CRM employee count se alag hai", "reference": "R8"}, {"id": "R037", "platform": "Render", "label": "Optional paid workers / cron / disks / previews", "kind": "Conditional billing", "limit_note": "Free workspace ka matlab har service compute free nahi", "where": "Billing + all service compute plans", "frequency": "Weekly / change", "action": "Unintended paid resource / preview instance review karein", "reference": "R1 R8"}, {"id": "R038", "platform": "Render", "label": "Free Render Postgres size / expiry", "kind": "Conditional data-store restriction", "limit_note": "Only if used: 1 DB/workspace, 1 GB; expires day 30; 14-day upgrade grace", "where": "Render Postgres > Info / Billing", "frequency": "Conditional daily", "action": "Supabase DB se alag; expiry mail aur backup plan check karein", "reference": "R1"}, {"id": "R039", "platform": "Render", "label": "Free Render Postgres recovery / pooling", "kind": "Conditional feature restriction", "limit_note": "Free DB has no backups or managed pooling; restart/maintenance possible", "where": "Postgres settings / recovery records", "frequency": "Conditional", "action": "Database ko only-copy safe storage assume na karein", "reference": "R1"}, {"id": "R040", "platform": "Render", "label": "Free Key Value RAM / connections / durability", "kind": "Conditional data-store cap", "limit_note": "If used: 25 MB RAM, 50 connections; only one Free instance; restart loses data", "where": "Key Value Metrics / Events", "frequency": "Conditional daily", "action": "Durable saves ka source of truth is cache ko na banayein", "reference": "R1 R9"}, {"id": "R041", "platform": "Render", "label": "Render Management API rate limits", "kind": "Conditional API cap", "limit_note": "Generic GET 400/min, writes 30/min; endpoint exceptions apply", "where": "API headers / 429 errors", "frequency": "Conditional", "action": "Dashboard automation slow/bounded; Retry-After respect karein", "reference": "R7"}, {"id": "R042", "platform": "Render", "label": "Deploy / service creation API rates", "kind": "Conditional API cap", "limit_note": "Deploy/hooks 10/min/service; create service 20/hour", "where": "Deploy automation / rate headers", "frequency": "Conditional", "action": "Retry loop se repeated deploy mat trigger karein", "reference": "R7"}, {"id": "R043", "platform": "Render", "label": "TLS / DNS / domain health", "kind": "Availability/config", "limit_note": "Certificate / DNS / domain cap settings if custom domain used", "where": "Custom Domains / DNS provider / Events", "frequency": "Weekly; on outage", "action": "Domain expiry aur certificate error ko quota se alag identify karein", "reference": "C1"}, {"id": "R044", "platform": "Render", "label": "Included custom domains", "kind": "Conditional billing allowance", "limit_note": "Hobby includes 2; additional domains billable", "where": "Workspace Billing / Custom Domains", "frequency": "Change / weekly", "action": "onrender.com service URL aur custom domains alag count", "reference": "R10"}, {"id": "R045", "platform": "Render", "label": "Cron job runtime / billing / overlap", "kind": "Conditional paid service", "limit_note": "Minimum $1/month/cron service; active run stops at 12 hours; one run at a time", "where": "Cron Runs / Billing", "frequency": "Conditional daily", "action": "Free workspace ka matlab free cron nahi; never-ending command inspect", "reference": "R11"}, {"id": "R046", "platform": "Render", "label": "Workflows compute / state / trigger rates", "kind": "Conditional paid service", "limit_note": "Hobby root runs 50/min, chained runs 1,000/min; compute + retained state billable", "where": "Workflows usage / Billing / API errors", "frequency": "Conditional daily", "action": "New Hobby compute/min 16 CPU + 64 GB RAM; queue aur recursion monitor", "reference": "R12"}, {"id": "R047", "platform": "Render", "label": "Workflows run / argument / step limits", "kind": "Conditional workflow caps", "limit_note": "Default run 2h, max 24h; args/output 4 MB; 500 definitions; 10k steps/run", "where": "Workflow definitions / run errors", "frequency": "Conditional / change", "action": "Large payload aur runaway steps bound karein; retention 30 days", "reference": "R12"}, {"id": "G001", "platform": "GitHub", "label": "Included compute allowance", "kind": "Conditional monthly quota", "limit_note": "Current Free docs: $12/month included eligible compute; actual Billing verify", "where": "Account/Org Settings > Billing & licensing > Usage", "frequency": "Daily if Actions", "action": "Private Actions/cloud compute ka same eligible pool; raw minutes alone enough nahi", "reference": "G1 G2"}, {"id": "G002", "platform": "GitHub", "label": "Actions artifact + Packages storage", "kind": "Conditional shared allowance", "limit_note": "Free 500 MB pooled allowance; artifact aur Packages ko 500+500 extra na samjhein", "where": "Billing usage > Actions / Packages", "frequency": "Daily if used", "action": "Retention aur large artifacts inspect; source repo storage se alag", "reference": "G1 G2"}, {"id": "G003", "platform": "GitHub", "label": "Actions cache storage", "kind": "Conditional per-repo allowance", "limit_note": "10 GB included per repository; artifact pool se alag", "where": "Repository Actions > Caches + Billing", "frequency": "Daily if Actions", "action": "Changing cache keys / eviction / configured overage limit dekhein", "reference": "G2 G3"}, {"id": "G004", "platform": "GitHub", "label": "Accrued storage vs currently stored", "kind": "Conditional billing measure", "limit_note": "GB-hours accrued usage; month change par files khud delete nahi hote", "where": "Billing + artifact inventory", "frequency": "Daily if storage grows", "action": "Current size aur cycle accrued storage ko alag record karein", "reference": "G2"}, {"id": "G005", "platform": "GitHub", "label": "Workflow count / duration / failed reruns", "kind": "Conditional compute usage", "limit_note": "Failed jobs aur reruns bhi compute consume karte hain", "where": "Repository > Actions", "frequency": "Daily on build days", "action": "Duplicate schedules, push+PR runs aur accidental loops identify", "reference": "G2 C1"}, {"id": "G006", "platform": "GitHub", "label": "Runner OS / size / compute cost", "kind": "Conditional compute usage", "limit_note": "Windows/macOS/larger runners rates alag; public standard-runner rules alag", "where": "Workflow YAML + Billing breakdown", "frequency": "Change / daily spend", "action": "Har runner ko same minutes cost na samjhein", "reference": "G2"}, {"id": "G007", "platform": "GitHub", "label": "Concurrent hosted jobs", "kind": "Conditional concurrency cap", "limit_note": "Free 20 total standard jobs; max 5 macOS", "where": "Actions job queues", "frequency": "Daily if queued", "action": "Unnecessary matrix / duplicate queued runs control", "reference": "G3"}, {"id": "G008", "platform": "GitHub", "label": "Hosted job duration", "kind": "Conditional execution cap", "limit_note": "Maximum 6 hours/job", "where": "Actions job logs / timeout config", "frequency": "Each failed workflow", "action": "App-level job timeout shorter set/review karein", "reference": "G3"}, {"id": "G009", "platform": "GitHub", "label": "Workflow total / approval wait", "kind": "Conditional execution caps", "limit_note": "35 days/workflow incl wait; gate approval up to 30 days", "where": "Actions runs / environment approvals", "frequency": "Conditional", "action": "Stale wait / deployment approvals resolve karein", "reference": "G3"}, {"id": "G010", "platform": "GitHub", "label": "Matrix / workflow file size", "kind": "Conditional configuration caps", "limit_note": "256 jobs/matrix; workflow YAML <=500 KB", "where": "Workflow YAML / run errors", "frequency": "Change", "action": "Matrix fan-out aur generated YAML bound karein", "reference": "G3"}, {"id": "G011", "platform": "GitHub", "label": "Workflow event / queue rate", "kind": "Conditional rate caps", "limit_note": "1,500 events/10sec/repo; 500 runs queued/10sec", "where": "Actions/API errors", "frequency": "Conditional", "action": "Webhook-trigger loop aur repo automation inspect", "reference": "G3"}, {"id": "G012", "platform": "GitHub", "label": "Actions cache operation rates", "kind": "Conditional rate caps", "limit_note": "Per repo/min: uploads 200, downloads 1,500, deletes 400", "where": "Cache/action logs / 429s", "frequency": "Conditional", "action": "Parallel cache storms kam karein; rates per minute hain", "reference": "G3"}, {"id": "G013", "platform": "GitHub", "label": "Workflow / artifact retention", "kind": "Conditional storage setting", "limit_note": "Configured retention check; current usage accrual remains", "where": "Actions settings / artifacts", "frequency": "Weekly", "action": "Useful release evidence preserve; temporary artifacts retention bound", "reference": "G2 C1"}, {"id": "G014", "platform": "GitHub", "label": "Git LFS storage", "kind": "Conditional capacity/billing", "limit_note": "Free 10 GiB; versions ka full file size count hota hai", "where": "Billing > Git LFS", "frequency": "Daily if LFS", "action": "Bade binary versions ke churn ko monitor karein", "reference": "G10"}, {"id": "G015", "platform": "GitHub", "label": "Git LFS download bandwidth", "kind": "Conditional monthly quota", "limit_note": "Free 10 GiB / billing cycle; downloads owner ke usage me", "where": "Billing > Git LFS", "frequency": "Daily if LFS", "action": "CI clones/archives me LFS repeat downloads inspect", "reference": "G10"}, {"id": "G016", "platform": "GitHub", "label": "Git LFS single file maximum", "kind": "Conditional file cap", "limit_note": "Free/Pro 2 GB per LFS file", "where": "LFS push errors / docs", "frequency": "Each large upload", "action": "Regular Git 100 MiB limit se confuse na karein", "reference": "G11"}, {"id": "G017", "platform": "GitHub", "label": "GitHub Packages data transfer", "kind": "Conditional monthly quota", "limit_note": "Free 1 GB included; eligible public/package exceptions verify", "where": "Billing > Packages usage", "frequency": "Daily if Packages", "action": "Registry pulls aur repeat build downloads inspect", "reference": "G1"}, {"id": "G018", "platform": "GitHub", "label": "GitHub Codespaces compute", "kind": "Conditional personal allowance", "limit_note": "Personal GitHub Free 120 core-hours/month; org Free has no included amount", "where": "Billing > Codespaces", "frequency": "Daily if Codespaces", "action": "Running machine size x hours dekhein; unused session stop karein", "reference": "G1"}, {"id": "G019", "platform": "GitHub", "label": "GitHub Codespaces storage", "kind": "Conditional personal allowance", "limit_note": "Personal Free 15 GB-month included; org Free none", "where": "Billing > Codespaces / Codespaces inventory", "frequency": "Daily if Codespaces", "action": "Stopped codespace ki retained storage alag check karein", "reference": "G1 C1"}, {"id": "G020", "platform": "GitHub", "label": "REST API: user / unauthenticated", "kind": "Conditional API caps", "limit_note": "Typical user 5,000/hour; unauthenticated 60/hour/IP", "where": "Response x-ratelimit headers / API logs", "frequency": "Conditional", "action": "Authentication type aur shared actor usage identify", "reference": "G7"}, {"id": "G021", "platform": "GitHub", "label": "Actions GITHUB_TOKEN API usage", "kind": "Conditional API cap", "limit_note": "Usually 1,000 REST requests/hour/repository", "where": "Actions logs / rate headers", "frequency": "Conditional", "action": "User PAT ke 5,000/hour budget se alag token scope samjhein", "reference": "G3"}, {"id": "G022", "platform": "GitHub", "label": "GraphQL points / query complexity", "kind": "Conditional API cap", "limit_note": "Typical user 5,000 points/hour; cost query par depend", "where": "GraphQL rateLimit / errors", "frequency": "Conditional", "action": "Points aur requests count ko same metric na samjhein", "reference": "G8"}, {"id": "G023", "platform": "GitHub", "label": "Secondary API / search rate limits", "kind": "Conditional rate cap", "limit_note": "Endpoint/burst/concurrency specific; primary quota bachi ho tab bhi 403/429", "where": "API error + Retry-After / headers", "frequency": "Conditional", "action": "Parallel aggressive calls stop; current endpoint limits verify", "reference": "G7"}, {"id": "G024", "platform": "GitHub", "label": "Browser upload size", "kind": "Upload cap", "limit_note": "25 MiB per file through web browser", "where": "Repository upload screen", "frequency": "Each upload", "action": "Large binary source repo me upload na karein", "reference": "G4"}, {"id": "G025", "platform": "GitHub", "label": "Browser files per upload batch", "kind": "Upload cap", "limit_note": "Up to 100 files at one time; total repo file cap nahi", "where": "Repository upload screen", "frequency": "Each upload", "action": "Project delivery cap frontend <100 and others <100 preserve", "reference": "G4 C1"}, {"id": "G026", "platform": "GitHub", "label": "Regular Git file size", "kind": "Git file cap", "limit_note": "50 MiB warning; >100 MiB blocked", "where": "Git push / repo largest files", "frequency": "Each upload", "action": "ZIPs, DB dumps, recordings aur dependencies source repo se alag", "reference": "G5"}, {"id": "G027", "platform": "GitHub", "label": "Single Git push size", "kind": "Git transport cap", "limit_note": "2 GiB enforced per push (repository guide rounds as 2 GB)", "where": "Git push output", "frequency": "Each large push", "action": "Smaller planned source changes; giant generated files exclude", "reference": "G13 G6"}, {"id": "G028", "platform": "GitHub", "label": "Repository history size / clone time", "kind": "Repository health recommendation", "limit_note": "Current repo-limit guide: .git 10 GB recommendation, hard account quota nahi", "where": "Repository size / clone timings", "frequency": "Weekly", "action": "Code repo chhota rakhein; old binary commits history me reh sakte hain", "reference": "G6 C1"}, {"id": "G029", "platform": "GitHub", "label": "Directory width / depth / branches", "kind": "Repository health recommendations", "limit_note": "3,000 entries/dir; depth 50; branches 5,000 recommended maxima", "where": "Repository structure", "frequency": "Change / weekly", "action": "Isse GitHub 100-file browser-batch rule alag hai", "reference": "G6"}, {"id": "G030", "platform": "GitHub", "label": "Git fetch / clone / push rate", "kind": "Repository health recommendations", "limit_note": "Reads 15/sec/repo; pushes 6/min/repo recommended maxima", "where": "CI / integration logs", "frequency": "Conditional", "action": "Repeated full clones aur push loops reduce karein", "reference": "G6"}, {"id": "G031", "platform": "GitHub", "label": "Diff / PR display limits", "kind": "Review visibility cap", "limit_note": "Total diff 20k lines/1 MB; max 300 files; single diff file 500 KB/20k lines", "where": "Pull request Files changed", "frequency": "Each big change", "action": "Review hidden/truncated ho sakta hai; source content lost nahi", "reference": "G6"}, {"id": "G032", "platform": "GitHub", "label": "Commit display / rebase limits", "kind": "Review/merge caps", "limit_note": "Compare shows 250 commits; Rebase and merge max 100 commits", "where": "Pull request / compare", "frequency": "Conditional", "action": "Large change ko reviewable batches me plan karein", "reference": "G6"}, {"id": "G033", "platform": "GitHub", "label": "PR volume / merge churn", "kind": "Repository health recommendation", "limit_note": "Same target branch 1,000 open PRs; merge 1 PR/min recommended", "where": "Pull requests / automation", "frequency": "Conditional", "action": "Dependency bots aur auto-merge loops inspect", "reference": "G6"}, {"id": "G034", "platform": "GitHub", "label": "Generated / backup files in source repo", "kind": "Project requirement", "limit_note": "Frontend <100 files; backend + others <100 per CRM GitHub folder", "where": "Delivery manifest / repo tracked files", "frequency": "Every delivery", "action": "node_modules, backup ZIP, logs, private data source repo me na jodein", "reference": "C1"}, {"id": "G035", "platform": "GitHub", "label": "Pages published size", "kind": "Conditional hosting cap", "limit_note": "Only if GitHub Pages used: published site <=1 GB", "where": "Repository Settings > Pages / build output", "frequency": "Deploy / weekly", "action": "Render-hosted site par Pages limits automatically apply nahi", "reference": "G9"}, {"id": "G036", "platform": "GitHub", "label": "Pages bandwidth", "kind": "Conditional soft quota", "limit_note": "100 GB/month soft bandwidth limit", "where": "Pages traffic / provider notices", "frequency": "Conditional", "action": "Pages ko unlimited file-download server na samjhein", "reference": "G9"}, {"id": "G037", "platform": "GitHub", "label": "Pages builds / deployment timeout", "kind": "Conditional limits", "limit_note": "10 builds/hour soft limit (custom Actions exception); deploy timeout 10 min", "where": "Pages / Actions logs", "frequency": "Conditional", "action": "Failed build storms aur repeated deploy inspect", "reference": "G9"}, {"id": "G038", "platform": "GitHub", "label": "Budget alerts / stop-usage setting", "kind": "Billing control", "limit_note": "Product budgets aur Stop usage when budget limit reached verify", "where": "Billing & licensing > Budgets and alerts", "frequency": "Daily alerts; change", "action": "Alert-only budget hard stop nahi; stop hone se deploy block ho sakta hai", "reference": "G1"}, {"id": "G039", "platform": "GitHub", "label": "Copilot / AI / cloud sandbox usage", "kind": "Conditional product quota", "limit_note": "Plan/account-specific credits and eligible compute; only if enabled", "where": "Billing product breakdown", "frequency": "Conditional", "action": "CRM users ko automatically AI billed users na samjhein", "reference": "G1 G2"}, {"id": "G040", "platform": "GitHub", "label": "Webhook / deploy integration failures", "kind": "Integration health", "limit_note": "429/403, invalid token ya duplicate delivery se builds ruk sakti hain", "where": "Repository Webhooks / Render integration events", "frequency": "Daily on change days", "action": "Delivery reason verify; retry loop se deploy storm nahi", "reference": "C1"}, {"id": "G041", "platform": "GitHub", "label": "Token expiry / scopes / repo access", "kind": "Integration health", "limit_note": "Expired/revoked app token quota hit jaisa deploy error de sakta hai", "where": "Integration settings / deploy logs", "frequency": "Weekly / failure", "action": "Secret values tracker me kabhi paste na karein", "reference": "C1"}, {"id": "G042", "platform": "GitHub", "label": "Release asset count / file size", "kind": "Conditional release caps", "limit_note": "Up to 1,000 assets/release; each asset under 2 GiB", "where": "Releases > Assets", "frequency": "Each release", "action": "Release assets source repo file limit aur LFS billing se alag hain", "reference": "G12"}, {"id": "C001", "platform": "CRM / Other", "label": "Billing cycle / reset / meter delay", "kind": "Tracking prerequisite", "limit_note": "Each meter ka cycle, scope, unit aur delayed update alag ho sakta hai", "where": "Provider Billing / Usage", "frequency": "Daily", "action": "Same cycle readings compare; monthly reset ko negative usage na samjhein", "reference": "C1 S11 R2 G2"}, {"id": "C002", "platform": "CRM / Other", "label": "Daily increase / quota exhaustion pace", "kind": "Suggested tracking", "limit_note": "Used-now minus prior same-cycle reading; same unit only", "where": "Daily Record + provider readings", "frequency": "Daily", "action": "Cycle-end projection budget cross kare to 70% ka wait na karein", "reference": "C1"}, {"id": "C003", "platform": "CRM / Other", "label": "Internal warning thresholds", "kind": "Suggested precaution", "limit_note": "Consumed quota: 70% Watch, 85% Action; provider rule nahi", "where": "Daily Record status; provider emails", "frequency": "Daily", "action": "CPU bursts aur I/O balance par yeh same rule mat lagayein", "reference": "C1"}, {"id": "C004", "platform": "CRM / Other", "label": "UI consistency / last confirmed update", "kind": "Application health", "limit_note": "Rows/counts same confirmed snapshot; failed refresh par false zero nahi", "where": "Candidates cards / list / error state", "frequency": "Daily sample", "action": "Last-update time dikhayein; stale data ko fresh confirmed na batayein", "reference": "C1"}, {"id": "C005", "platform": "CRM / Other", "label": "Save / Submit / date-change verification", "kind": "Application correctness", "limit_note": "Confirmed save, pending/unknown outcome aur duplicate records", "where": "CRM drafts / save result / controlled sample", "frequency": "Daily sample", "action": "Read-only verification pehle; automatic duplicate save nahi", "reference": "C1"}, {"id": "C006", "platform": "CRM / Other", "label": "Pending offline outbox / oldest item", "kind": "Application health", "limit_note": "Unsynced drafts count + sabse purani pending age", "where": "My Drafts / outbox status", "frequency": "Daily", "action": "Local draft retained; pending ko server-saved success na samjhein", "reference": "C1"}, {"id": "C007", "platform": "CRM / Other", "label": "Requests / bytes per action per user", "kind": "Application efficiency", "limit_note": "Same click se kitne requests / bytes / DB queries", "where": "Browser Network + bounded backend counters", "frequency": "Daily sample", "action": "One action multiple full refreshes trigger to fix ownership", "reference": "C1"}, {"id": "C008", "platform": "CRM / Other", "label": "Visible/hidden tabs / phone fallback", "kind": "Application efficiency", "limit_note": "Background tab, duplicate login, reconnect and polling frequency", "where": "Browser / mobile logs / app settings", "frequency": "Daily if high usage", "action": "Leader-tab / visibility guards; useful event push preserve", "reference": "C1"}, {"id": "C009", "platform": "CRM / Other", "label": "CRM1 / CRM2 / staging / old app clients", "kind": "Usage inventory", "limit_note": "Sab deployments aur mobile versions same project ko hit kar sakte hain", "where": "Deployment inventory + usage breakdown", "frequency": "Weekly / rollout", "action": "Unused auto clients identify; authorized users ka access preserve", "reference": "C1"}, {"id": "C010", "platform": "CRM / Other", "label": "Monitoring requests themselves", "kind": "Monitoring cost", "limit_note": "Check karne ke liye full DB export / per-second poll waste badha sakta hai", "where": "Monitoring config / provider logs", "frequency": "Weekly / setup", "action": "Existing dashboard + sampled app counters; lightweight manual snapshots", "reference": "C1"}, {"id": "C011", "platform": "CRM / Other", "label": "Browser storage / eviction / cached files", "kind": "Client capacity", "limit_note": "IndexedDB/localStorage quota browser/device-dependent; stale cache possible", "where": "Browser storage / draft status", "frequency": "Weekly / cache failure", "action": "Unsynced draft backup ke bina Clear site data mat karein", "reference": "C1"}, {"id": "C012", "platform": "CRM / Other", "label": "Email / SMS / WhatsApp / calling credits", "kind": "Conditional external quota", "limit_note": "Provider daily sends, API rate, credits, attachment size, webhook rate", "where": "Relevant provider usage screen", "frequency": "Conditional daily", "action": "Used integration ka actual free limit note karein; universal number nahi", "reference": "C1"}, {"id": "C013", "platform": "CRM / Other", "label": "Google Sheets / Drive / Calendar APIs", "kind": "Conditional external quota", "limit_note": "Requests/minute, daily quotas, storage and auth limits vary", "where": "Google Cloud/API usage + account storage", "frequency": "Conditional", "action": "Only configured integrations; quota screen se number copy karein", "reference": "C1"}, {"id": "C014", "platform": "CRM / Other", "label": "AI / OCR / transcription APIs", "kind": "Conditional external quota", "limit_note": "Tokens, requests, audio minutes, image jobs, file sizes, credits", "where": "Provider usage / billing", "frequency": "Conditional daily", "action": "Unintended repeated analysis / upload count karein", "reference": "C1"}, {"id": "C015", "platform": "CRM / Other", "label": "Other CDN / hosting / DNS / monitoring", "kind": "Conditional external limits", "limit_note": "Bandwidth, requests, function calls, logs, certificate/domain renewal", "where": "Provider dashboard", "frequency": "Conditional / weekly", "action": "Supabase aur Render quota se separate record rakhein", "reference": "C1"}, {"id": "C016", "platform": "CRM / Other", "label": "Unexpected bots / leaked access / traffic", "kind": "Traffic health", "limit_note": "Zero staff activity me bhi unusual requests / exports", "where": "Existing request logs / provider alerts", "frequency": "Daily if spike", "action": "Access source investigate; required authorization checks preserve", "reference": "C1"}, {"id": "C017", "platform": "CRM / Other", "label": "Provider incidents / restriction emails", "kind": "Availability / policy signal", "limit_note": "Outage, billing hold, suspension, policy notice usage se alag bhi ho sakta hai", "where": "Supabase / Render / GitHub status and account email", "frequency": "Daily / incident", "action": "Exact message record; quota assume karke wrong fix nahi", "reference": "C1"}, {"id": "C018", "platform": "CRM / Other", "label": "Quota action and change record", "kind": "Operational follow-up", "limit_note": "Kya badla, kab, kis metric ka pehle/baad result", "where": "Daily Record > Note / action", "frequency": "Every change", "action": "Same workload window compare; no blind data deletion or load storm", "reference": "C1"}];
// CC180: one small sample per awake backend per hour. Provider failures never
// retry, and a missing reading is not a zero. No browser polling is installed.
const usage180=(()=>{
 const {withTransaction,queueBackgroundWork,databaseResponseEstimate}=require('../lib/store');
 const cfgKey='cc180_instance_usage_config',boot=require('crypto').randomUUID();
 let config=null,history=null,flight=null,lastCheck=0,timer=null,configTail=Promise.resolve();
 const metrics=[
  ['supabase_egress','Supabase uncached egress','GB',5,'cycle'],['supabase_cached','Supabase cached egress','GB',5,'cycle'],
  ['database_size','Database size','MB',500,'capacity'],['storage_size','Supabase file storage','GB',1,'capacity'],
  ['db_connections','Database connections','connections',0,'capacity'],['db_blocks_read','Database blocks read','blocks',0,'counter'],
  ['db_cache_hits','Database buffer hits','blocks',0,'counter'],['db_temp_bytes','Database temporary writes','bytes',0,'counter'],
  ['db_commits','Database commits','transactions',0,'counter'],['db_deadlocks','Database deadlocks','events',0,'counter'],
  ['app_read_bytes','App database response estimate','MB',0,'daily'],['app_queries','App database queries','queries',0,'daily'],
  ['render_cpu','Render CPU','%',100,'capacity'],['render_memory','Render memory','MB',512,'capacity'],
  ['render_bandwidth_hour','Render sampled hour outbound','MB',0,'window'],['render_bandwidth','Render billed outbound bandwidth','GB',0,'cycle'],['render_hours','Render free instance hours','hours',750,'cycle'],
  ['render_build','Render build minutes','minutes',0,'cycle'],['github_actions','GitHub Actions minutes','minutes',0,'cycle'],
  ['github_storage','GitHub billed storage','GB',0,'capacity'],['io_balance','Database IO budget used','%',100,'capacity']
 ].map(([key,label,unit,limit,kind])=>({key,label,unit,limit,kind}));
 const defs=()=>[...metrics,...USAGE_CHECKLIST_180.map(r=>({key:r.id,label:r.platform+' · '+r.label,unit:'%',limit:100,kind:'capacity'}))];
 const admin=req=>{const u=req.actorUser||req.user;if(!u||!['manager','admin'].includes(String(u.role).toLowerCase())||u.impersonator||req.authDegraded)throw Object.assign(Error('Verified Manager/Admin access only.'),{status:403});return u;};
 async function load(){
  if(!config){const row=await store.findById('app_settings','key',cfgKey);try{config=JSON.parse(row?.value||'null');}catch{}config=config||{enabled:true,metrics:{},manual:{},revision:0};}
  if(!history){const rows=store.pool?await store.query('select sample_id,created_at,metrics_json from public.crm_usage_samples order by created_at desc limit 96'):(await table('crm_usage_samples')).slice(-768).reverse();history=rows.map(r=>{try{return{id:r.sample_id,at:r.created_at,...JSON.parse(r.metrics_json)}}catch{return null;}}).filter(Boolean).reverse();}
 }
 const number=v=>Number.isFinite(Number(v))&&v!==''&&v!=null?Number(v):null;
 function summarize(sample,prior){
  return defs().map(d=>{
   const setting=config.metrics[d.key]||{},manual=config.manual[d.key],auto=sample.values?.[d.key];
   const value=auto||manual&&{value:manual.value,source:'manual',at:manual.at,cycle_start:manual.cycle_start};
   const used=number(value?.value),limit=number(setting.limit??d.limit),pct=used!=null&&limit>0?used/limit*100:null;
   const baseline=history.find(s=>s.at.slice(0,10)===sample.at.slice(0,10));
   const old=prior?.values?.[d.key],hour=auto&&old&&sample.boot===prior.boot&&auto.reset===old.reset&&number(auto.value)>=number(old.value)&&Date.parse(sample.at)-Date.parse(prior.at)<=90*60000?number(auto.value)-number(old.value):null;
   const istDay=x=>new Date(Date.parse(x)+19800000).toISOString().slice(0,10);
   const start=history.find(s=>istDay(s.at)===istDay(sample.at)&&((Date.parse(s.at)+19800000)%86400000)<90*60000);
   const startValue=start?.values?.[d.key],today=auto&&startValue&&sample.boot===start.boot&&auto.reset===startValue.reset&&number(auto.value)>=number(startValue.value)?number(auto.value)-number(startValue.value):null;
   return{...d,limit,used,remaining:used!=null&&limit>0?Math.max(0,limit-used):null,percent:pct,source:value?.source||'unavailable',reading_at:value?.at||sample.at,daily_percent:setting.daily_percent??10,total_percent:setting.total_percent??10,hour:!['counter','daily','cycle'].includes(d.kind)?null:hour,today:!['counter','daily','cycle'].includes(d.kind)?null:today,cycle_start:value?.cycle_start||null,stale:value?.source==='manual'&&Date.now()-Date.parse(value.at)>24*3600000};
  });
 }

 async function boundedProviderJson(url,token,transport=fetch){
  const response=await transport(url,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(5000),redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw Error('Provider HTTP '+response.status);}
  if(Number(response.headers.get('content-length')||0)>524288){await response.body?.cancel();throw Error('Provider response too large');}
  let length=0,chunks=[];try{for await(const chunk of response.body){length+=chunk.length;if(length>524288)throw Error('Provider response too large');chunks.push(Buffer.from(chunk));}}catch(e){await response.body?.cancel().catch(()=>{});throw e;}
  return JSON.parse(Buffer.concat(chunks).toString());
 }
 function renderReading(payload,kind,service,now=Date.now()){
  if(!Array.isArray(payload))throw Error('Provider response shape changed');
  const series=payload.filter(s=>Array.isArray(s.labels)&&s.labels.some(l=>['service','resource'].includes(l.field)&&l.value===service));
  const rows=[];
  for(const item of series){
   const unit=String(item.unit||'').toLowerCase();
   for(const point of item.values||[]){const value=number(point.value),at=Date.parse(point.timestamp);if(value==null||value<0||!Number.isFinite(at)||at>now||now-at>80*60000)continue;
    let used=null;
    if(kind==='cpu'){
     if(['%','percent','percentage'].includes(unit))used=value;
     else if(['cpu','core','cores'].includes(unit)&&Number(process.env.CC180_RENDER_CPU_CORES)>0)used=value/Number(process.env.CC180_RENDER_CPU_CORES)*100;
    }else{const scale={b:1,bytes:1,kb:1000,kib:1024,mb:1000000,mib:1048576,gb:1000000000,gib:1073741824}[unit];if(scale)used=value*scale/1048576;}
    if(used!=null)rows.push({value:used,at:new Date(at).toISOString(),source:'render'});
   }
  }
  if(!rows.length)throw Error('Provider metric unavailable or unit not recognized');
  if(kind==='bandwidth'){if(rows.length!==1)throw Error('Bandwidth returned multiple points; interval aggregation needs review');return rows[0];}
  rows.sort((a,b)=>b.at.localeCompare(a.at)||b.value-a.value);return rows[0];
 }
 async function renderMetrics(values,errors,transport=fetch){
  const token=process.env.CC180_RENDER_API_KEY,service=process.env.CC180_RENDER_SERVICE_ID||process.env.RENDER_SERVICE_ID;
  if(!token||!/^srv-[a-z0-9-]+$/i.test(service||'')||process.env.CC_LOCAL_TEST==='1')return;
  const end=new Date(Date.now()-5*60000),start=new Date(end.getTime()-3600000);
  await Promise.all(['cpu','memory','bandwidth'].map(async kind=>{try{
   const url=new URL('https://api.render.com/v1/metrics/'+kind);url.searchParams.set('resource',service);url.searchParams.set('startTime',start.toISOString());url.searchParams.set('endTime',end.toISOString());if(kind!=='bandwidth')url.searchParams.set('resolutionSeconds','600');
   const reading=renderReading(await boundedProviderJson(url,token,transport),kind,service);values[kind==='cpu'?'render_cpu':kind==='memory'?'render_memory':'render_bandwidth_hour']={...reading,window_start:start.toISOString(),window_end:end.toISOString()};
  }catch(e){errors.push('Render '+kind+': '+String(e.message).replaceAll(token,'[redacted]').slice(0,140));}}));
 }
 async function collect(){
  const values={},errors=[],stamp=new Date().toISOString(),estimate=databaseResponseEstimate();
  values.app_read_bytes={value:Number(estimate.estimated_response_bytes||0)/1048576,source:'app-estimate',at:stamp};values.app_queries={value:Number(estimate.queries||0),source:'app-estimate',at:stamp};
  if(store.pool)try{
   const row=(await store.query('select pg_database_size(current_database())::text as size,numbackends,blks_read::text,blks_hit::text,temp_bytes::text,xact_commit::text,deadlocks::text,stats_reset::text from pg_stat_database where datname=current_database()'))[0];
   for(const [key,column,div]of [['database_size','size',1048576],['db_connections','numbackends',1],['db_blocks_read','blks_read',1],['db_cache_hits','blks_hit',1],['db_temp_bytes','temp_bytes',1],['db_commits','xact_commit',1],['db_deadlocks','deadlocks',1]])if(row&&number(row[column])!=null)values[key]={value:Number(row[column])/div,source:'database',at:stamp,reset:row.stats_reset};
  }catch(e){errors.push('Database metrics unavailable: '+String(e.code||'read failed'));}
  // RSS is app process memory, not the provider's billed/container metric.
  values.app_memory={value:process.memoryUsage().rss/1048576,source:'app-estimate',at:stamp};
  await renderMetrics(values,errors);
  return{boot,at:stamp,values,errors,estimate:{date:estimate.date,queries:estimate.queries,bytes:estimate.estimated_response_bytes,routes:estimate.routes?.slice(0,10),tables:estimate.tables?.slice(0,10)}};
 }
 async function sample(force=false){
  await load();if(flight)return flight;
  if(Date.now()-lastCheck<(force?60000:3600000))return history.at(-1)||{at:new Date().toISOString(),values:{},boot};
  lastCheck=Date.now();
  flight=(async()=>{
   const current=await collect(),id=current.at.slice(0,13),row={sample_id:id,created_at:current.at,metrics_json:JSON.stringify(current)};
   await store.upsert('crm_usage_samples','sample_id',row);history=history.filter(s=>s.id!==id&&Date.now()-Date.parse(s.at)<32*86400000);history.push({id,...current});history.sort((a,b)=>a.at.localeCompare(b.at));history=history.slice(-768);
   const out=summarize(current,history.at(-2)),day=new Date(Date.now()+19800000).toISOString().slice(0,10);
   for(const metric of out.filter(m=>m.percent!=null&&!m.stale)){
    for(const [scope,used,threshold]of [['total',metric.percent,metric.total_percent],['daily',metric.today!=null&&metric.limit>0?metric.today/metric.limit*100:null,metric.daily_percent]]){
     if(used==null||threshold<=0||used<threshold)continue;
     const alertId=[day,metric.key,scope,threshold].join(':');
     if(await store.findById('crm_usage_alerts','alert_id',alertId))continue;
     const message=metric.label+' '+scope+' usage '+used.toFixed(1)+'% crossed '+threshold+'% ('+metric.source+').';
     await store.insert('crm_usage_alerts',{alert_id:alertId,created_at:current.at,metric_key:metric.key,message});
     queueBackgroundWork(async()=>{const users=store.pool?await store.query("select user_id from public.users where lower(role) in ('manager','admin')"):await table('users');for(const user of users.filter(u=>['manager','admin'].includes(String(u.role||'manager').toLowerCase())))await store.insert('notifications',{notification_id:'usage:'+alertId+':'+user.user_id,user_id:user.user_id,title:'Usage limit warning',message,status:'Unread',type:'system',metadata:JSON.stringify({open_path:'/admin?tab=usage',source:metric.source}),created_at:current.at});});
    }
   }
   // Only this release's telemetry expires. Never candidate/business data.
   if(store.pool){await store.query('delete from public.crm_usage_samples where created_at<$1',[new Date(Date.now()-32*86400000).toISOString()]);await store.query('delete from public.crm_usage_alerts where created_at<$1',[new Date(Date.now()-35*86400000).toISOString()]);}
   else{store.state.crm_usage_samples=(store.state.crm_usage_samples||[]).filter(r=>Date.now()-Date.parse(r.created_at)<32*86400000);store.state.crm_usage_alerts=(store.state.crm_usage_alerts||[]).filter(r=>Date.now()-Date.parse(r.created_at)<35*86400000);store.save();}
   return current;
  })().finally(()=>{flight=null;});return flight;
 }
 async function response(){await load();const current=history.at(-1)||{at:new Date().toISOString(),values:{},boot};const alerts=store.pool?await store.query('select alert_id,created_at,metric_key,message from public.crm_usage_alerts order by created_at desc limit 30'):(await table('crm_usage_alerts')).slice(-30).reverse();return{ok:true,instance_label:process.env.CRM_INSTANCE_LABEL||'Career Crox',auto_sampling:samplingMode(),config,metrics:summarize(current,history.at(-2)),history:history.slice(-72).map(s=>({at:s.at,boot:s.boot,values:s.values,errors:s.errors})),alerts,checklist:USAGE_CHECKLIST_180,estimate:current.estimate||null,errors:current.errors||[],last_check:history.at(-1)?.at||null,limitations:['The default mode takes readings on request. When enabled, hourly checks depend on server availability and the sampling mode.','Database counters and app estimates are not Supabase billed egress. Provider billing readings are manual.','Daily changes require a near-midnight IST baseline. Manual entries do not invent hourly history.','Alerts are observations, not a hard quota cap; spikes may occur between checks.']};}
 async function exportHistory(req,res){admin(req);const hours=Math.max(1,Math.min(768,Number(req.query.hours)||768)),cutoff=new Date(Date.now()-hours*3600000).toISOString();const rows=store.pool?await store.query('select sample_id,created_at,metrics_json from public.crm_usage_samples where created_at>=$1 order by created_at limit 8192',[cutoff]):(await table('crm_usage_samples')).filter(r=>r.created_at>=cutoff).slice(-8192);return res.json({ok:true,items:rows.map(r=>{try{return{at:r.created_at,...JSON.parse(r.metrics_json)}}catch{return null;}}).filter(Boolean),retention_days:32});}
 async function read(req,res){admin(req);res.setHeader('Cache-Control','private,no-store');return res.json(await response());}
 async function check(req,res){admin(req);await load();if(flight){await flight;return res.json(await response());}if(Date.now()-lastCheck<60000)return res.status(429).json({message:'A shared check just ran. Wait one minute; existing readings are kept.'});await sample(true);return res.json(await response());}
 async function save(req,res){admin(req);const work=configTail.then(async()=>{await load();const next=structuredClone(config),key=String(req.body.metric_key||''),def=defs().find(d=>d.key===key);if(!def)throw Object.assign(Error('Choose a known metric.'),{status:400});
   const setting={...(next.metrics[key]||{})};for(const field of ['daily_percent','total_percent','limit'])if(req.body[field]!==undefined){const v=number(req.body[field]);if(v==null||v<0||field!=='limit'&&v>100)throw Object.assign(Error('Enter a valid nonnegative limit and a percentage from 0 to 100.'),{status:400});setting[field]=v;}
   next.metrics[key]=setting;if(req.body.manual_value!==undefined){const v=number(req.body.manual_value);if(v==null||v<0)throw Object.assign(Error('Enter the actual provider reading.'),{status:400});next.manual[key]={value:v,at:new Date().toISOString(),cycle_start:String(req.body.cycle_start||'').slice(0,10)};}
   next.revision=(next.revision||0)+1;await store.upsert('app_settings','key',{key:cfgKey,value:JSON.stringify(next),updated_at:new Date().toISOString()});config=next;return response();});configTail=work.catch(()=>{});return res.json(await work);}
 function samplingMode(){
  if(process.env.CC180_DISABLE_MONITOR==='1'||process.env.CC_LOCAL_TEST==='1')return 'manual';
  if(process.env.CC207_ENABLE_IDLE_USAGE_SAMPLING==='1')return 'hourly_always';
  return process.env.CC208_ENABLE_AUTOMATIC_USAGE_SAMPLING==='1'?'hourly_active':'manual';
 }
 function start(){
  const mode=samplingMode();
  if(timer||mode==='manual')return;
  const run=()=>{
   if(mode==='hourly_active'&&!require('../lib/recentHumanActivity').hasRecentHumanActivity())return;
   queueBackgroundWork(()=>require('../lib/store').runDatabaseJob('optional-usage-sample',()=>sample(false)));
  };
  timer=setTimeout(()=>{run();timer=setInterval(run,3600000);timer.unref?.();},60000);
  timer.unref?.();
 }
 return{read,check,save,exportHistory,start,_test:{metrics,defs,summarize,sample,collect,boundedProviderJson,renderReading,renderMetrics,reset(){config=null;history=null;lastCheck=0;}}};
})();
module.exports.usageTracker=usage180;
