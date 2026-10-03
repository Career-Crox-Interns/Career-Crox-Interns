const { store, table } = require('../lib/store');
const { callMetricForRow, presenceMinutes, istDateKey, dayStatusFromMinutes, dedupeCallRows, aggregateBreakRows } = require('../lib/crmMetrics');

function low(value) { return String(value || '').trim().toLowerCase(); }
function int(value) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
function arr(value) { return Array.isArray(value) ? value : []; }
function csv(value) { return String(value || '').split(',').map((x) => x.trim()).filter(Boolean); }
function phone(value) { return String(value || '').replace(/\D+/g, '').slice(-10); }
function parseTs(value) { const t = Date.parse(String(value || '')); return Number.isFinite(t) ? t : 0; }
function pad2(value) { return String(value).padStart(2, '0'); }
function istToday() { const d = new Date(Date.now() + (330 * 60 * 1000)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function minutesLabel(total) { const mins = Math.max(0, Math.round(Number(total || 0))); const h = Math.floor(mins / 60); const m = mins % 60; return `${h}h ${m}m`; }
function secondsLabel(total) { const sec = Math.max(0, Math.round(Number(total || 0))); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`; }
function timeLabel(value) { const t = parseTs(value); if (!t) return '-'; return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t)); }
function dateTimeLabel(value) { const t = parseTs(value); if (!t) return '-'; return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t)); }
function rangeStart(date, time) { return Date.parse(`${date}T${time || '00:00'}:00+05:30`); }
function rangeEnd(date, time) { return Date.parse(`${date}T${time || '23:59'}:59+05:30`); }
function inRange(value, startMs, endMs) { const t = parseTs(value); return t && t >= startMs && t <= endMs; }
function roleOf(user) { const r = low(user?.role || user?.designation || user?.user_role || ''); if (r.includes('admin')) return 'admin'; if (r.includes('manager')) return 'manager'; if (r === 'tl' || r.includes('team lead') || r.includes('teamlead')) return 'tl'; if (r.includes('recruiter')) return 'recruiter'; return r || 'employee'; }
function nameOf(user) { return user?.full_name || user?.name || user?.employee_name || user?.username || user?.user_id || '-'; }
function isConnected(row) { return callMetricForRow(row).connected_calls_count > 0; }
function isIncoming(row) { const text = low(`${row?.direction || ''} ${row?.call_type || ''} ${row?.status || ''}`); return text.includes('incoming') || text.includes('inbound'); }
function isMissed(row) { const text = low(`${row?.direction || ''} ${row?.call_type || ''} ${row?.status || ''}`); return text.includes('missed'); }
function callTime(row) { return row?.call_started_at || row?.started_at || row?.created_at || row?.updated_at || ''; }
function subTime(row) { return row?.submitted_at || row?.submission_origin_at || row?.approval_requested_at || row?.created_at || row?.updated_at || ''; }
function candidateTime(row) { return row?.data_uploading_date || row?.created_at || row?.updated_at || row?.approval_requested_at || ''; }
function safeStatus(row) { return String(row?.status || row?.submission_status || row?.approval_status || '').trim(); }
function isCompleteSubmission(row) { const s = low(safeStatus(row)); return ['complete','completed','approved','submitted','done','accepted'].some((x) => s.includes(x)); }
function isPendingSubmission(row) { const s = low(safeStatus(row)); return !s || ['pending','hold','review','waiting'].some((x) => s.includes(x)); }
function reportCandidateIsDeleted(row = {}) {
  const status = low(row.status || row.candidate_status || '');
  const approval = low(row.approval_status || '');
  const details = low(row.all_details_sent || '');
  const notes = low(row.data_notes || '');
  return Boolean(String(row.deleted_at || '').trim())
    || ['deleted','__deleted__','archived'].includes(status)
    || ['deleted','__deleted__','archived'].includes(approval)
    || ['deleted','archived'].includes(details)
    || notes.includes('[crm-deleted]');
}
function identityValues(row = {}) {
  return [
    row.user_id, row.employee_user_id, row.owner_user_id, row.assigned_user_id, row.submitted_by_user_id,
    row.username, row.employee_username, row.owner_username, row.assigned_username, row.submitted_by_username,
    row.recruiter_code, row.submitted_by_recruiter_code, row.submitted_by, row.submitted_by_name,
    row.employee_name, row.recruiter_name, row.full_name, row.name,
  ].map((x) => low(x)).filter(Boolean);
}
function matchesUser(row, selectedUsers, selectedRoles, usersByAny) {
  const vals = identityValues(row);
  const userHit = !selectedUsers.length || selectedUsers.some((x) => vals.includes(low(x)));
  if (!userHit) return false;
  if (!selectedRoles.length) return true;
  const rowUsers = vals.map((v) => usersByAny.get(v)).filter(Boolean);
  if (!rowUsers.length) return selectedRoles.some((r) => vals.includes(low(r)));
  return rowUsers.some((u) => selectedRoles.includes(roleOf(u)));
}
function userKeyFromRow(row, usersByAny) {
  for (const v of identityValues(row)) {
    const u = usersByAny.get(v);
    if (u) return String(u.user_id || u.username || v);
  }
  return String(row.employee_username || row.username || row.submitted_by_username || row.submitted_by_name || row.recruiter_code || row.user_id || 'unknown');
}
function makeUserMaps(users) {
  const byKey = new Map();
  const byAny = new Map();
  for (const u of users) {
    const key = String(u.user_id || u.username || '').trim() || nameOf(u);
    byKey.set(key, u);
    [u.user_id, u.username, u.full_name, u.name, u.recruiter_code, u.employee_code].map((x) => low(x)).filter(Boolean).forEach((v) => byAny.set(v, u));
  }
  return { byKey, byAny };
}
async function safeTable(name) { try { return await table(name); } catch { return []; } }
function emptyUserMetric(key, user = {}) {
  return {
    key,
    user_id: user.user_id || '',
    username: user.username || '',
    employee: nameOf(user),
    role: roleOf(user),
    first_login_at: '',
    first_login_time: '-',
    work_minutes: 0,
    remaining_minutes: 540,
    idle_minutes: 0,
    break_count: 0,
    break_minutes: 0,
    break_windows: [],
    total_calls: 0,
    dialed_calls: 0,
    connected_calls: 0,
    not_connected_calls: 0,
    incoming_calls: 0,
    outgoing_calls: 0,
    missed_calls: 0,
    unique_calls: 0,
    repeated_calls: 0,
    talktime_seconds: 0,
    aht_seconds: 0,
    submissions_total: 0,
    submissions_pending: 0,
    submissions_complete: 0,
    profiles_created: 0,
    profiles_opened: 0,
    unique_profiles_opened: 0,
    _phones: new Map(),
    _openedProfiles: new Set(),
    _session_minutes: 0,
  };
}
function bucketKey(ms) { const d = new Date(ms + (330 * 60 * 1000)); return `${pad2(d.getUTCHours())}:00`; }
function ensureBucket(map, label) {
  if (!map.has(label)) map.set(label, { hour: label, calls: 0, dialed: 0, connected: 0, not_connected: 0, incoming: 0, outgoing: 0, missed: 0, unique_calls: 0, repeated_calls: 0, talktime_seconds: 0, submissions: 0, pending_submissions: 0, complete_submissions: 0, profiles_created: 0, profiles_opened: 0, _phones: new Map() });
  return map.get(label);
}
function publicMetric(row) {
  const copy = { ...row };
  delete copy._phones;
  delete copy._openedProfiles;
  delete copy._session_minutes;
  copy.talktime = secondsLabel(copy.talktime_seconds);
  copy.aht = secondsLabel(copy.aht_seconds);
  copy.worked = minutesLabel(copy.work_minutes);
  copy.remaining_work = minutesLabel(copy.remaining_minutes);
  copy.idle_time = minutesLabel(copy.idle_minutes);
  copy.break_time = minutesLabel(copy.break_minutes);
  copy.breaks = (copy.break_windows || []).join(' | ');
  return copy;
}

function performanceScore(m = {}) {
  const talkMinutes = Number(m.talktime_seconds || 0) / 60;
  const workHours = Number(m.work_minutes || 0) / 60;
  const connected = int(m.connected_calls);
  const completeSubmissions = int(m.submissions_complete);
  const pendingSubmissions = int(m.submissions_pending);
  const totalSubmissions = int(m.submissions_total);
  const uniqueCalls = int(m.unique_calls);
  const notConnected = int(m.not_connected_calls);
  const repeated = int(m.repeated_calls);
  const idleMinutes = int(m.idle_minutes);
  const breakMinutes = int(m.break_minutes);
  const score = (connected * 6) + (completeSubmissions * 12) + (pendingSubmissions * 3) + (totalSubmissions * 2) + (uniqueCalls * 1.5) + (talkMinutes * 0.35) + (workHours * 2) - (notConnected * 0.6) - (repeated * 0.4) - (idleMinutes * 0.04) - (breakMinutes * 0.03);
  return Math.max(0, Math.round(score * 10) / 10);
}

function activityWorkBreakByUser(activityRows = [], usersByAny = new Map()) {
  const groups = new Map();
  for (const row of arr(activityRows)) {
    const stamp = row.created_at || row.updated_at || '';
    const ts = parseTs(stamp);
    if (!ts) continue;
    const key = userKeyFromRow(row, usersByAny);
    if (!key) continue;
    const day = istDateKey(ts) || String(stamp).slice(0, 10);
    const groupKey = `${key}|${day}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { key, day, firstJoin: 0, firstAny: ts, lastAny: ts, breakMinutes: 0, breakCount: 0 });
    const g = groups.get(groupKey);
    g.firstAny = Math.min(g.firstAny || ts, ts);
    g.lastAny = Math.max(g.lastAny || ts, ts);
    const action = low(row.action_type || row.type || row.action || '');
    if (action === 'join_work' || action === 'join_office') g.firstJoin = g.firstJoin ? Math.min(g.firstJoin, ts) : ts;
    if (action === 'break_started') g.breakCount += 1;
    if (action === 'break_ended' || action === 'break_exceeded' || action === 'break_exceeded_lock') {
      let meta = {};
      try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
      const mins = int(meta.break_minutes || meta.minutes || meta.duration_minutes || 0);
      if (mins > 0) g.breakMinutes += mins;
    }
  }
  const byUser = new Map();
  for (const g of groups.values()) {
    if (!byUser.has(g.key)) byUser.set(g.key, { sessionMinutes: 0, breakMinutes: 0, breakCount: 0, days: 0, firstLoginAt: '' });
    const out = byUser.get(g.key);
    const start = g.firstJoin || g.firstAny;
    const end = g.lastAny || start;
    out.sessionMinutes += Math.max(0, Math.round((end - start) / 60000));
    out.breakMinutes += Math.max(0, Math.round(g.breakMinutes || 0));
    out.breakCount += Math.max(0, Math.round(g.breakCount || 0));
    out.days += 1;
    if (start && (!out.firstLoginAt || start < parseTs(out.firstLoginAt))) out.firstLoginAt = new Date(start).toISOString();
  }
  return byUser;
}

async function masterReport(req, res) {
  const today = istToday();
  const fromDate = String(req.query.date_from || today).slice(0, 10);
  const toDate = String(req.query.date_to || fromDate).slice(0, 10);
  const timeFrom = String(req.query.time_from || '00:00').slice(0, 5);
  const timeTo = String(req.query.time_to || '23:59').slice(0, 5);
  const startMs = rangeStart(fromDate, timeFrom);
  const endMs = rangeEnd(toDate, timeTo);
  const selectedUsers = csv(req.query.users || req.query.user || req.query.username || '').filter((x) => low(x) !== 'all');
  const selectedRoles = csv(req.query.roles || req.query.role || '').map(low).filter((x) => x && x !== 'all');
  const sections = csv(req.query.sections || 'master,calls,submissions,attendance,breaks,hourly');

  const [users, callRowsRaw, subRowsRaw, presenceRows, activeRows, activityRows, candidateRows, breakRowsRaw] = await Promise.all([
    safeTable('users'), safeTable('call_logs'), safeTable('submissions'), safeTable('presence'), safeTable('active_sessions'), safeTable('activity_log'), safeTable('candidates'), safeTable('break_sessions'),
  ]);
  const { byKey, byAny } = makeUserMaps(users);
  const activeCandidates = arr(candidateRows).filter((row) => !reportCandidateIsDeleted(row));
  const candidatesById = new Map(activeCandidates.map((row) => [String(row.candidate_id || ''), row]));
  const candidatesByPhone = new Map();
  for (const candidate of activeCandidates) {
    const p = phone(candidate.phone || candidate.number || candidate.mobile || candidate.candidate_phone || '');
    if (p) candidatesByPhone.set(p, candidate);
  }
  const metricByUser = new Map();
  function metricForRow(row) {
    const key = userKeyFromRow(row, byAny);
    const user = byKey.get(key) || byAny.get(low(key)) || {};
    if (!metricByUser.has(key)) metricByUser.set(key, emptyUserMetric(key, user));
    return metricByUser.get(key);
  }
  function include(row) { return matchesUser(row, selectedUsers, selectedRoles, byAny); }

  const hourMap = new Map();
  const calls = dedupeCallRows(arr(callRowsRaw)).filter((r) => {
    if (!inRange(callTime(r), startMs, endMs) || !include(r)) return false;
    const candidateId = String(r.candidate_id || r.current_candidate_id || '').trim();
    const p = phone(r.phone || r.mobile || r.number || r.candidate_phone || '');
    return Boolean((candidateId && candidatesById.has(candidateId)) || (p && candidatesByPhone.has(p)));
  });
  for (const row of calls) {
    const m = metricForRow(row);
    const t = parseTs(callTime(row));
    const bucket = ensureBucket(hourMap, bucketKey(t));
    const p = phone(row.phone || row.mobile || row.number || row.candidate_phone);
    const cm = callMetricForRow(row);
    m.total_calls += cm.calls_count; bucket.calls += cm.calls_count;
    m.incoming_calls += cm.incoming_calls_count; bucket.incoming += cm.incoming_calls_count;
    m.missed_calls += cm.missed_calls_count; bucket.missed += cm.missed_calls_count;
    m.outgoing_calls += cm.outgoing_calls_count; bucket.outgoing += cm.outgoing_calls_count;
    m.dialed_calls += cm.outgoing_calls_count; bucket.dialed += cm.outgoing_calls_count;
    m.connected_calls += cm.connected_calls_count; bucket.connected += cm.connected_calls_count;
    m.not_connected_calls += cm.not_connected_calls_count; bucket.not_connected += cm.not_connected_calls_count;
    m.talktime_seconds += cm.talktime_seconds; bucket.talktime_seconds += cm.talktime_seconds;
    if (p) { m._phones.set(p, (m._phones.get(p) || 0) + 1); bucket._phones.set(p, (bucket._phones.get(p) || 0) + 1); }
  }

  const submissionRows = arr(subRowsRaw).map((row) => {
    const candidate = candidatesById.get(String(row.candidate_id || '')) || {};
    return {
      ...row,
      recruiter_code: row.recruiter_code || candidate.recruiter_code || '',
      recruiter_name: row.recruiter_name || row.submitted_by_name || candidate.recruiter_name || '',
      submitted_by_user_id: row.submitted_by_user_id || candidate.created_by_user_id || '',
      submitted_by_name: row.submitted_by_name || candidate.recruiter_name || '',
      candidate_name: row.candidate_name || candidate.full_name || '',
    };
  });
  const submissions = submissionRows.filter((r) => inRange(subTime(r), startMs, endMs) && include(r));
  for (const row of submissions) {
    const m = metricForRow(row);
    const t = parseTs(subTime(row));
    const bucket = ensureBucket(hourMap, bucketKey(t || startMs));
    m.submissions_total += 1; bucket.submissions += 1;
    if (isCompleteSubmission(row)) { m.submissions_complete += 1; bucket.complete_submissions += 1; }
    else if (isPendingSubmission(row)) { m.submissions_pending += 1; bucket.pending_submissions += 1; }
  }

  const candidateProfiles = arr(candidateRows).filter((r) => inRange(candidateTime(r), startMs, endMs) && include(r));
  for (const row of candidateProfiles) {
    const m = metricForRow(row);
    const t = parseTs(candidateTime(row));
    const bucket = ensureBucket(hourMap, bucketKey(t || startMs));
    m.profiles_created += 1;
    bucket.profiles_created += 1;
  }
  const profileOpenActivities = arr(activityRows).filter((r) => low(r.action_type || r.type || r.action || '') === 'profile_opened' && inRange(r.created_at || r.updated_at, startMs, endMs) && include(r));
  for (const row of profileOpenActivities) {
    const m = metricForRow(row);
    const t = parseTs(row.created_at || row.updated_at);
    const bucket = ensureBucket(hourMap, bucketKey(t || startMs));
    const candidateId = String(row.candidate_id || '').trim();
    m.profiles_opened += 1;
    if (candidateId) m._openedProfiles.add(candidateId);
    m.unique_profiles_opened = m._openedProfiles.size;
    bucket.profiles_opened += 1;
  }

  const presence = arr(presenceRows).filter(include);
  const active = arr(activeRows).filter(include);
  const activities = arr(activityRows).filter((r) => inRange(r.created_at || r.updated_at, startMs, endMs) && include(r));
  const exactBreakByUser = new Map();
  for (const row of arr(breakRowsRaw)) {
    if (!include(row)) continue;
    const start = parseTs(row.started_at || row.created_at || '');
    const end = parseTs(row.ended_at || '') || Math.min(Date.now(), endMs);
    if (!start || start > endMs || end < startMs) continue;
    const key = userKeyFromRow(row, byAny);
    if (!exactBreakByUser.has(key)) exactBreakByUser.set(key, []);
    exactBreakByUser.get(key).push(row);
  }
  const rangeWorkBreak = activityWorkBreakByUser(activities, byAny);
  for (const [key, wb] of rangeWorkBreak.entries()) {
    const user = byKey.get(key) || byAny.get(low(key)) || {};
    if (!metricByUser.has(key)) metricByUser.set(key, emptyUserMetric(key, user));
    const m = metricByUser.get(key);
    if (wb.firstLoginAt && (!m.first_login_at || parseTs(wb.firstLoginAt) < parseTs(m.first_login_at))) m.first_login_at = wb.firstLoginAt;
    m.break_minutes = Math.max(m.break_minutes, wb.breakMinutes);
    m.break_count = Math.max(m.break_count, wb.breakCount);
    m._session_minutes = Math.max(m._session_minutes, Math.max(0, wb.sessionMinutes));
    m.work_minutes = Math.max(m.work_minutes, Math.max(0, wb.sessionMinutes - wb.breakMinutes));
  }
  for (const [key, rows] of exactBreakByUser.entries()) {
    const m = metricByUser.get(key) || metricForRow(rows[0] || { user_id: key });
    const exact = aggregateBreakRows(rows, startMs, endMs);
    if (exact.break_count > 0) {
      m.break_minutes = exact.total_break_minutes;
      m.break_count = exact.break_count;
      m.break_windows = exact.windows.map((w) => `${dateTimeLabel(w.started_at)} → ${dateTimeLabel(w.ended_at)}${w.reason ? ` • ${w.reason}` : ''}`);
      if (m._session_minutes > 0) m.work_minutes = Math.max(0, m._session_minutes - exact.total_break_minutes);
    }
  }
  for (const row of presence) {
    const m = metricForRow(row);
    const start = row.work_started_at || row.login_at || row.created_at || row.last_seen_at;
    const seen = row.last_seen_at || row.updated_at || '';
    const startT = parseTs(start);
    const endT = parseTs(seen) || Math.min(Date.now(), endMs);
    if (startT && (!m.first_login_at || startT < parseTs(m.first_login_at))) m.first_login_at = start;
    const live = presenceMinutes(row, Math.min(Date.now(), endMs));
    if (!exactBreakByUser.has(m.key)) m.break_minutes = Math.max(m.break_minutes, live.total_break_minutes);
    const worked = startT ? Math.max(0, Math.round((Math.min(endT || endMs, endMs) - Math.max(startT, startMs)) / 60000)) : int(row.total_work_minutes);
    m._session_minutes = Math.max(m._session_minutes, worked);
    const breakForRange = exactBreakByUser.has(m.key) ? Math.min(worked, m.break_minutes) : Math.min(worked, live.total_break_minutes);
    const productiveCap = Math.max(0, worked - breakForRange);
    const hasSavedActive = Object.prototype.hasOwnProperty.call(row || {}, 'total_work_minutes') && String(row.total_work_minutes ?? '').trim() !== '';
    const savedActive = Math.max(0, Number(row.total_work_minutes || 0) || 0);
    const productive = Math.max(0, Math.min(productiveCap, hasSavedActive ? savedActive : productiveCap));
    // Presence is authoritative for a live/current session, including a legitimate zero.
    m.work_minutes = productive;
  }
  for (const row of active) {
    const m = metricForRow(row);
    const login = row.login_at || row.created_at || row.updated_at || row.last_seen_at;
    const t = parseTs(login);
    if (t && (!m.first_login_at || t < parseTs(m.first_login_at))) m.first_login_at = login;
  }
  for (const row of activities) {
    const action = low(row.action_type || row.type || row.action || '');
    if (!action.includes('break')) continue;
    const m = metricForRow(row);
    if (exactBreakByUser.has(m.key)) continue;
    const meta = (() => { try { return JSON.parse(row.metadata || '{}'); } catch { return {}; } })();
    m.break_count += action.includes('started') || action.includes('break_started') || action === 'break' ? 1 : 0;
    // Break duration is already stored in presence.total_break_minutes and calculated through presenceMinutes().
    // Do not add activity_log break_minutes again, otherwise Master Report doubles break time.
    m.break_windows.push(`${dateTimeLabel(row.created_at)} ${action.replaceAll('_',' ')}`);
  }

  // Include selected users even if they have zero activity, so filters show empty rows instead of pretending people vanished.
  if (selectedUsers.length) {
    for (const key of selectedUsers) {
      const u = byAny.get(low(key)) || byKey.get(key) || {};
      const id = String(u.user_id || u.username || key);
      if (!metricByUser.has(id)) metricByUser.set(id, emptyUserMetric(id, u));
    }
  }

  const userRowsRaw = [...metricByUser.values()].map((m) => {
    m.unique_profiles_opened = m._openedProfiles ? m._openedProfiles.size : Number(m.unique_profiles_opened || 0);
    const unique = [...m._phones.keys()].length;
    const repeated = [...m._phones.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    m.unique_calls = unique;
    m.repeated_calls = repeated;
    m.aht_seconds = m.connected_calls ? Math.round(m.talktime_seconds / m.connected_calls) : 0;
    m.remaining_minutes = Math.max(0, 540 - m.work_minutes);
    m.idle_minutes = Math.max(0, Number(m._session_minutes || 0) - Number(m.break_minutes || 0) - Number(m.work_minutes || 0));
    m.first_login_time = timeLabel(m.first_login_at);
    m.performance_score = performanceScore(m);
    return publicMetric(m);
  }).sort((a, b) => Number(b.performance_score || 0) - Number(a.performance_score || 0) || String(a.employee).localeCompare(String(b.employee)));

  const activePerformanceRows = userRowsRaw.filter((r) => int(r.total_calls) || int(r.submissions_total) || int(r.work_minutes));
  const bestKey = activePerformanceRows[0]?.key || '';
  const lowKey = activePerformanceRows.length > 1 ? activePerformanceRows[activePerformanceRows.length - 1]?.key || '' : '';
  const userRows = userRowsRaw.map((row) => {
    const rankType = row.key && row.key === bestKey ? 'best' : row.key && row.key === lowKey ? 'lowest' : 'normal';
    return {
      ...row,
      rank_type: rankType,
      rank_badge: rankType === 'best' ? 'Best Performer' : rankType === 'lowest' ? 'Lowest Performer' : 'Normal'
    };
  });
  const bestPerformer = userRows.find((r) => r.rank_type === 'best') || null;
  const lowestPerformer = userRows.find((r) => r.rank_type === 'lowest') || null;

  const summary = userRows.reduce((out, row) => {
    for (const k of ['total_calls','dialed_calls','connected_calls','not_connected_calls','incoming_calls','outgoing_calls','missed_calls','talktime_seconds','unique_calls','repeated_calls','submissions_total','submissions_pending','submissions_complete','profiles_created','profiles_opened','unique_profiles_opened','work_minutes','remaining_minutes','idle_minutes','break_count','break_minutes','performance_score']) out[k] += int(row[k]);
    return out;
  }, { total_calls:0, dialed_calls:0, connected_calls:0, not_connected_calls:0, incoming_calls:0, outgoing_calls:0, missed_calls:0, talktime_seconds:0, unique_calls:0, repeated_calls:0, submissions_total:0, submissions_pending:0, submissions_complete:0, profiles_created:0, profiles_opened:0, unique_profiles_opened:0, work_minutes:0, remaining_minutes:0, idle_minutes:0, break_count:0, break_minutes:0, performance_score:0 });
  summary.aht_seconds = summary.connected_calls ? Math.round(summary.talktime_seconds / summary.connected_calls) : 0;
  summary.performance_score = userRows.length ? Math.round((userRows.reduce((sum, row) => sum + Number(row.performance_score || 0), 0) / userRows.length) * 10) / 10 : 0;
  summary.talktime = secondsLabel(summary.talktime_seconds);
  summary.aht = secondsLabel(summary.aht_seconds);
  summary.worked = minutesLabel(summary.work_minutes);
  summary.remaining_work = minutesLabel(summary.remaining_minutes);
  summary.idle_time = minutesLabel(summary.idle_minutes);
  summary.break_time = minutesLabel(summary.break_minutes);

  const hourly = [...hourMap.values()].sort((a,b) => a.hour.localeCompare(b.hour)).map((b) => {
    b.unique_calls = [...b._phones.keys()].length;
    b.repeated_calls = [...b._phones.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    delete b._phones;
    b.talktime = secondsLabel(b.talktime_seconds);
    return b;
  });

  const callSamples = calls.slice(0, 300).map((r) => { const cm = callMetricForRow(r); return { time: dateTimeLabel(callTime(r)), employee: metricForRow(r).employee, candidate: r.candidate_name || r.full_name || r.candidate_id || '-', phone: r.phone || '-', status: cm.connected_calls_count ? 'Connected' : (cm.missed_calls_count ? 'Missed' : (cm.incoming_calls_count ? 'Incoming' : 'Not Connected')), direction: cm.missed_calls_count ? 'Missed' : (cm.incoming_calls_count ? 'Incoming' : 'Outgoing'), talktime: secondsLabel(cm.talktime_seconds) }; });
  const submissionSamples = submissions.slice(0, 300).map((r) => ({ time: dateTimeLabel(subTime(r)), employee: metricForRow(r).employee, candidate: r.candidate_name || r.full_name || r.candidate_id || '-', status: safeStatus(r) || '-', client: r.client_name || r.company || '-' }));
  const breakSamples = userRows.flatMap((u) => (u.break_windows || []).map((b) => ({ employee: u.employee, break: b }))).slice(0, 200);

  const userOptions = users.map((u) => ({ value: String(u.user_id || u.username || nameOf(u)), label: `${nameOf(u)}${u.role ? ` • ${u.role}` : ''}${u.recruiter_code ? ` • ${u.recruiter_code}` : ''}`, role: roleOf(u), username: u.username || '', recruiter_code: u.recruiter_code || '' }));

  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, manual_refresh_only: true, generated_at: new Date().toISOString(), filters: { date_from: fromDate, date_to: toDate, time_from: timeFrom, time_to: timeTo, sections, users: selectedUsers, roles: selectedRoles }, user_options: userOptions, summary, best_performer: bestPerformer, lowest_performer: lowestPerformer, hourly, users: userRows, calls: callSamples, submissions: submissionSamples, breaks: breakSamples, source_counts: { call_logs: calls.length, submissions: submissions.length, presence: presence.length, active_sessions: active.length, activity_log: activities.length, break_sessions: arr(breakRowsRaw).length } });
}

module.exports = { masterReport };
