const { table, store } = require('../lib/store');
const { recruiterCodeMatches, nowIso } = require('../lib/helpers');
const { createTimedCache, registerCache } = require('../lib/cache');
const { callMetricForRow, presenceMinutes, dedupeCallRows } = require('../lib/crmMetrics');

const PERFORMANCE_CACHE_TTL_MS = 300000;
// CC15: Postgres date/text coalesce fixed for performance/recent activity.
const performanceCache = registerCache(new Map());
const recentActivityCache = createTimedCache(300000);

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
  return `${req.user?.user_id || 'anon'}:${req.user?.role || 'none'}`;
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
  const ensure = (key) => { if (!byUserId.has(String(key))) byUserId.set(String(key), { ...emptyCallMetrics(), _phones: new Map(), _profiles: new Set() }); return byUserId.get(String(key)); };
  for (const row of dedupeCallRows(callLogs || [])) {
    if (!isTodayIst(row.call_started_at || row.created_at || row.updated_at)) continue;
    const candidateId = String(row.candidate_id || row.current_candidate_id || '').trim();
    const candidatePhone = normalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '').slice(-10);
    const matchedCandidate = (candidateId && candidateById.get(candidateId)) || (candidatePhone && candidateByPhone.get(candidatePhone)) || null;
    if (!matchedCandidate) continue;
    let user = users.find((u) => String(u.user_id || '') === String(row.employee_user_id || '')) || userByUsername.get(lower(row.employee_username || '')) || userByName.get(lower(row.employee_name || '')) || userByCode.get(lower(row.recruiter_code || '')) || null;
    const key = user?.user_id || row.employee_user_id || row.employee_username || row.employee_name || '';
    if (!key) continue;
    const m = ensure(key);
    const cm = callMetricForRow(row);
    const dir = callDirection(row);
    m.calls_count += cm.calls_count;
    m.incoming_calls_count += cm.incoming_calls_count;
    m.missed_calls_count += cm.missed_calls_count;
    m.outgoing_calls_count += cm.outgoing_calls_count;
    m.dialed_calls_count += cm.outgoing_calls_count;
    m.connected_calls_count += cm.connected_calls_count;
    m.not_connected_calls_count += cm.not_connected_calls_count;
    m.talktime_seconds += cm.talktime_seconds;
    if (String(row.call_log_available || '1') === '0') m.missing_call_log_count += 1;
    if (!String(row.recording_url || row.recording_file_id || '').trim() && lower(row.recording_status || 'missing').includes('missing')) m.recording_missing_count += 1;
    if ((dir === 'missed' || lower(row.status).includes('miss')) && lower(row.callback_status || '') !== 'done') m.callback_pending_count += 1;
    if (String(row.employee_cut_suspect || row.employee_early_cut_suspect || '') === '1') m.employee_cut_suspect_count += 1;
    if (String(row.early_cut_flag || '') === '1') m.short_ring_count += 1;
    if (String(row.candidate_no_answer_likely || '') === '1' || lower(row.disconnect_by || row.disconnect_actor_guess).includes('candidate_no_answer')) m.candidate_no_answer_likely_count += 1;
    m.suspicious_call_score += Math.max(0, Number(row.suspicious_score || 0) || 0);
    const p = normalizePhone(row.phone || '');
    if (p) m._phones.set(p, (m._phones.get(p) || 0) + 1);
    const matchedCandidateId = String(row.candidate_id || matchedCandidate?.candidate_id || '').trim();
    if (matchedCandidateId) m._profiles.add(matchedCandidateId);
  }
  for (const m of byUserId.values()) {
    m.repeated_calls_count = [...m._phones.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    m.unique_called_profiles_count = m._profiles.size;
    m.avg_talktime_seconds = m.connected_calls_count ? Math.round(m.talktime_seconds / m.connected_calls_count) : 0;
    delete m._phones; delete m._profiles;
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

async function recentActivity(req, res) {
  const liveMode = String(req.query?.live || '') === '1';
  const cacheKey = `${req.user?.user_id || 'anon'}:${JSON.stringify(req.query || {})}`;
  const cached = recentActivityCache.get(cacheKey, liveMode ? 180000 : 300000);
  if (cached) return res.json(cached);

  const [users, presenceRows, submissions, candidates] = await (store.pool ? Promise.all([
    safeOpsQuery(`select * from public.users`),
    safeOpsQuery(`select * from public.presence`),
    safeOpsQuery(`select * from public.submissions limit 2200`),
    safeOpsQuery(`select * from public.candidates limit 2200`),
  ]) : Promise.all([
    table('users'),
    table('presence'),
    table('submissions'),
    table('candidates'),
  ]));
  const activeCandidates = activeOpsCandidates(candidates);
  const activeCandidateIds = new Set(activeCandidates.map((row) => String(row.candidate_id || '').trim()).filter(Boolean));
  const activeSubmissions = submissions.filter((row) => rowLinkedToActiveOpsCandidate(row, activeCandidateIds));
  const userMap = new Map(users.map((user) => [lower(user.username), user]));
  const usersById = new Map(users.map((user) => [String(user.user_id), user]));
  const usersByName = new Map(users.map((user) => [lower(user.full_name), user]));
  const candidatesById = new Map(activeCandidates.map((row) => [String(row.candidate_id), row]));

  let activityRows = [];
  if (store.pool) {
    const requestedLimit = Math.min(Math.max(Number(req.query.limit || 900) || 900, 200), 1500);
    const sqlLimit = Math.min(Math.max(requestedLimit * 2, 1000), 2200);
    activityRows = await safeOpsQuery(`select * from public.activity_log limit $1`, [sqlLimit]);
  } else {
    activityRows = await table('activity_log');
  }

  const derivedSubmissionActivities = buildDerivedSubmissionActivities(activeSubmissions, candidatesById, usersById, usersByName, activityRows);
  const decorated = mergeActivitySources(activityRows, derivedSubmissionActivities)
    .map(decorateActivity)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const filtered = applyActivityFilters(decorated, req.query);
  const limit = Math.min(Math.max(Number(req.query.limit || 900), 50), 2000);
  const items = filtered.slice(0, limit);
  const recruiters = Array.from(new Set(decorated.map((item) => lower(item.username)).filter(Boolean)))
    .map((username) => {
      const user = userMap.get(username) || usersByName.get(username) || {};
      return {
        username: user.username || username,
        full_name: user.full_name || user.username || username,
        recruiter_code: user.recruiter_code || '',
        role: user.role || '',
        label: user.recruiter_code ? `${user.full_name || user.username} • ${user.recruiter_code}` : (user.full_name || user.username || username),
      };
    })
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')));

  const payload = {
    items,
    summary: {
      ...buildSummary(filtered),
      ...buildLiveOpsSummary(users, presenceRows, decorated),
    },
    recruiters,
    truncated: filtered.length > items.length,
    total_matched: filtered.length,
  };
  recentActivityCache.set(cacheKey, payload);
  return res.json(payload);
}

async function exportRecentActivity(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can export recent activity report.' });
  const [users, candidates, submissions, activityRows] = await Promise.all([
    table('users'),
    table('candidates'),
    table('submissions'),
    table('activity_log'),
  ]);
  const activeCandidates = activeOpsCandidates(candidates);
  const activeCandidateIds = new Set(activeCandidates.map((row) => String(row.candidate_id || '').trim()).filter(Boolean));
  const activeSubmissions = submissions.filter((row) => rowLinkedToActiveOpsCandidate(row, activeCandidateIds));
  const usersById = new Map(users.map((user) => [String(user.user_id), user]));
  const usersByName = new Map(users.map((user) => [lower(user.full_name), user]));
  const candidatesById = new Map(activeCandidates.map((row) => [String(row.candidate_id), row]));
  const decorated = mergeActivitySources(activityRows, buildDerivedSubmissionActivities(activeSubmissions, candidatesById, usersById, usersByName, activityRows))
    .map(decorateActivity)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const filtered = applyActivityFilters(decorated, req.query).slice(0, 10000);
  const workbook = buildActivityWorkbook(filtered);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="recent-activity-${stamp}.xls"`);
  return res.send(workbook);
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

  const [users, candidates, tasks, notifications, activityLog, submissions, interviews, presence, callLogs] = await (store.pool ? Promise.all([
    safeOpsQuery(`select * from public.users`),
    safeOpsQuery(`select * from public.candidates`),
    safeOpsQuery(`select * from public.tasks`),
    safeOpsQuery(`select * from public.notifications`),
    safeOpsQuery(`select * from public.activity_log`),
    safeOpsQuery(`select * from public.submissions`),
    safeOpsQuery(`select * from public.interviews`),
    safeOpsQuery(`select * from public.presence`),
    safeOpsQuery(`select * from public.call_logs where coalesce(call_started_at, created_at, updated_at, '') >= $1`, [new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()]),
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
    for (const code of csvList(candidate.recruiter_code)) {
      for (const userId of (userIdsByRecruiterCode.get(lower(code)) || [])) matched.add(String(userId));
    }
    for (const userId of (userIdsByFullName.get(lower(candidate.recruiter_name || '')) || [])) matched.add(String(userId));
    matched.forEach((userId) => addCount(candidateCountByUserId, userId));
  }

  for (const interview of activeInterviews) {
    const candidate = candidatesById.get(String(interview.candidate_id)) || {};
    const matched = new Set();
    for (const code of csvList(candidate.recruiter_code)) {
      for (const userId of (userIdsByRecruiterCode.get(lower(code)) || [])) matched.add(String(userId));
    }
    for (const userId of (userIdsByFullName.get(lower(candidate.recruiter_name || '')) || [])) matched.add(String(userId));
    matched.forEach((userId) => addCount(interviewCountByUserId, userId));
  }

  const openTasksByUserId = new Map();
  for (const task of tasks) {
    if (['done', 'closed', 'completed'].includes(lower(task.status))) continue;
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
    return candidateMatch && toMs(row.call_started_at || row.created_at || row.updated_at) >= (Date.now() - 30 * 60 * 1000);
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
      active_break: Boolean(livePresence.is_on_break),
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
