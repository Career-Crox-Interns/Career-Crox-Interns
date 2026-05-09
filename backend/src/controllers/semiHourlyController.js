const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');
const { createTimedCache } = require('../lib/cache');

const semiHourlyCache = createTimedCache(300000);
const WINDOW_MINUTES = 30;

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isLeadership(user) {
  return ['admin', 'manager', 'tl', 'team lead'].includes(lower(user?.role));
}

function isManagedRole(user) {
  return ['recruiter', 'tl', 'team lead', 'manager', 'admin'].includes(lower(user?.role));
}

function toMs(value) {
  const stamp = new Date(value || 0).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
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

function currentSessionMinutes(presenceRow, windowStart = 0, windowEnd = Date.now()) {
  const started = toMs(presenceRow?.work_started_at);
  if (!started) return 0;
  const effectiveStart = windowStart ? Math.max(started, windowStart) : started;
  const effectiveEnd = Math.max(windowEnd, effectiveStart);
  return Math.max(0, Math.round((effectiveEnd - effectiveStart) / 60000));
}

function productiveMinutes(presenceRow, breakMinutes = null, windowStart = 0, windowEnd = Date.now()) {
  const session = currentSessionMinutes(presenceRow, windowStart, windowEnd);
  const appliedBreakMinutes = breakMinutes === null ? Number(presenceRow?.total_break_minutes || 0) : Number(breakMinutes || 0);
  return Math.max(session - appliedBreakMinutes, 0);
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

function buildSubmitterContext(row, candidate, usersById, usersByName) {
  const explicitName = row?.submitted_by_name || '';
  const derivedById = usersById.get(String(row?.submitted_by_user_id || '')) || {};
  const derivedByName = usersByName.get(lower(explicitName || candidate?.submitted_by || candidate?.recruiter_name || '')) || {};
  return {
    user_id: row?.submitted_by_user_id || derivedById.user_id || derivedByName.user_id || '',
    recruiter_code: row?.submitted_by_recruiter_code || derivedById.recruiter_code || (explicitName ? derivedByName.recruiter_code : '') || row?.recruiter_code || candidate?.recruiter_code || '',
    recruiter_name: explicitName || derivedById.full_name || (explicitName ? derivedByName.full_name : '') || candidate?.submitted_by || candidate?.recruiter_name || '',
  };
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

function floorToHalfHour(date) {
  const next = new Date(date.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() >= 30 ? 30 : 0);
  return next;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function countByWindow(rows, picker) {
  return rows.reduce((sum, row) => sum + (picker(row) ? 1 : 0), 0);
}

function countFlags(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row.metrics?.[key] || 0), 0);
}

function sumByWindow(rows, picker, valueGetter) {
  return rows.reduce((sum, row) => sum + (picker(row) ? Number(valueGetter(row) || 0) : 0), 0);
}

function avgGapMinutes(rows, picker) {
  const points = rows
    .filter((row) => picker(row))
    .map((row) => toMs(row.created_at))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (points.length < 2) return 0;
  let totalGap = 0;
  for (let i = 1; i < points.length; i += 1) totalGap += Math.max(0, points[i] - points[i - 1]);
  return Math.round((totalGap / (points.length - 1)) / 60000);
}

function parseChangedFields(metadata) {
  const changed = metadata?.changed_fields;
  if (Array.isArray(changed)) return changed.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  return [];
}

function computePerformanceTone(metrics) {
  const score = (
    (metrics.submissions_30 * 7) +
    (metrics.calls_30 * 2) +
    (metrics.whatsapp_30 * 1) +
    (metrics.profile_opens_30 * 0.75) +
    (metrics.details_saved_30 * 1.5) +
    (metrics.looking_for_job_marked_30 * 1.25) +
    (metrics.crm_unlocks_30 * 0.5)
  ) - (
    (metrics.idle_minutes_30 * 0.8) +
    (metrics.avg_call_gap_30 * 0.6) +
    (metrics.break_minutes_30 * 0.15)
  );
  if (score >= 16) return 'green';
  if (score <= 4) return 'red';
  return 'amber';
}

function normalizePeriodKey(value) {
  return String(value || '').trim();
}

function formatWindowLabel(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '30 Minutes Report';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function saveSnapshot(payload, user) {
  const reports = await table('scheduled_reports');
  const periodKey = normalizePeriodKey(payload.period_key);
  const existing = reports.find((row) => lower(row.report_type) === 'semi-hourly' && normalizePeriodKey(row.period_key) === periodKey);
  const now = nowIso();
  const row = {
    user_id: user?.user_id || 'system',
    title: `30 Minutes Report • ${formatWindowLabel(payload.window_end || payload.generated_at)}`,
    report_type: 'semi-hourly',
    filters_json: JSON.stringify({
      period_key: payload.period_key,
      window_start: payload.window_start,
      window_end: payload.window_end,
    }),
    file_format: 'live',
    frequency_minutes: '30',
    status: 'saved',
    next_run_at: '',
    last_run_at: payload.generated_at || now,
    last_file_name: '',
    period_key: payload.period_key,
    snapshot_json: JSON.stringify(payload),
    created_at: existing?.created_at || now,
  };
  if (existing?.report_id) {
    return store.update('scheduled_reports', 'report_id', existing.report_id, row);
  }
  return store.insert('scheduled_reports', {
    report_id: nextId('SHR', reports, 'report_id'),
    ...row,
  });
}

async function overview(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Leadership access only' });

  const requestedId = String(req.query?.report_id || '').trim();
  if (requestedId) {
    const reports = await table('scheduled_reports');
    const match = reports.find((row) => String(row.report_id) === requestedId && lower(row.report_type) === 'semi-hourly');
    if (!match) return res.status(404).json({ message: 'Saved 30 minutes report not found.' });
    const snapshot = safeJson(match.snapshot_json);
    if (!snapshot || typeof snapshot !== 'object' || !Object.keys(snapshot).length) {
      return res.status(404).json({ message: 'Saved 30 minutes report is empty.' });
    }
    return res.json({
      ...snapshot,
      saved_report_id: match.report_id,
      saved_title: match.title || '30 Minutes Report',
      saved_at: match.last_run_at || match.created_at || '',
      is_saved_snapshot: true,
    });
  }

  const generateMode = String(req.query?.generate || '') === '1';
  if (!generateMode) {
    return res.json({
      manual_required: true,
      generated_at: '',
      period_key: '',
      summary: {},
      rows: [],
      message: 'Semi-hourly report is manual now. Use generate=1 to create a snapshot.'
    });
  }

  const cacheKey = `${req.user?.user_id || 'anon'}:${lower(req.user?.role)}:semi-hourly`;
  const cached = semiHourlyCache.get(cacheKey, 300000);
  if (cached) return res.json(cached);

  const now = new Date();
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - (WINDOW_MINUTES * 60 * 1000));
  const dayStart = startOfDay(now);
  const periodKey = floorToHalfHour(now).toISOString().slice(0, 16);

  const [users, activityRows, submissions, candidates, presenceRows] = await (store.pool ? Promise.all([
    store.query(`select user_id, username, full_name, recruiter_code, role, designation from public.users`),
    store.query(`select activity_id, user_id, username, action_type, candidate_id, metadata, created_at from public.activity_log where created_at >= $1 order by created_at desc limit 4000`, [dayStart.toISOString()]),
    store.query(`select submission_id, candidate_id, recruiter_code, approval_status, submitted_at, approval_requested_at, updated_at, submitted_by_user_id, submitted_by_name, submitted_by_recruiter_code from public.submissions where coalesce(submitted_at, approval_requested_at, updated_at, '') >= $1 order by coalesce(submitted_at, approval_requested_at, updated_at, '') desc limit 4000`, [dayStart.toISOString()]),
    store.query(`select candidate_id, full_name, phone, recruiter_code, recruiter_name, submitted_by, process, status, approval_status, updated_at, approved_at, created_at, submission_date from public.candidates order by coalesce(updated_at, created_at, '') desc limit 4000`),
    store.query(`select user_id, last_seen_at, last_page, is_on_break, break_reason, break_started_at, break_expected_end_at, total_break_minutes, locked, lock_reason, lock_message, unlock_grace_until, last_call_dial_at, last_call_candidate_id, last_call_alert_sent_at, meeting_joined, meeting_joined_at, screen_sharing, screen_frame_url, last_screen_frame_at, work_started_at, total_work_minutes from public.presence`),
  ]) : Promise.all([
    table('users'),
    table('activity_log'),
    table('submissions'),
    table('candidates'),
    table('presence'),
  ]));

  const trackedUsers = users.filter((user) => isManagedRole(user));
  const userById = new Map(trackedUsers.map((user) => [String(user.user_id), user]));
  const usersByName = new Map(trackedUsers.map((user) => [lower(user.full_name), user]));
  const candidatesById = new Map(candidates.map((row) => [String(row.candidate_id), row]));
  const presenceByUserId = new Map(presenceRows.map((row) => [String(row.user_id), row]));
  const activityByUserId = new Map();
  for (const row of activityRows) {
    const key = String(row.user_id || '');
    if (!activityByUserId.has(key)) activityByUserId.set(key, []);
    activityByUserId.get(key).push(row);
  }
  const submissionsByUserId = new Map();
  const dedupedSubmissionMap = new Map();
  for (const row of submissions) {
    const candidate = candidatesById.get(String(row.candidate_id)) || {};
    const submitter = buildSubmitterContext(row, candidate, userById, usersByName);
    const key = String(submitter.user_id || '');
    const stamp = submissionStamp(row, candidate);
    const identity = `${key || 'unknown'}|${buildSubmissionIdentity(row, candidate)}`;
    const item = {
      ...row,
      actor_user_id: submitter.user_id,
      actor_recruiter_code: submitter.recruiter_code,
      actor_name: submitter.recruiter_name,
      stamp,
    };
    const current = dedupedSubmissionMap.get(identity);
    if (!current || toMs(item.stamp) >= toMs(current.stamp)) {
      dedupedSubmissionMap.set(identity, item);
    }
  }
  for (const item of dedupedSubmissionMap.values()) {
    const key = String(item.actor_user_id || '');
    if (!key) continue;
    if (!submissionsByUserId.has(key)) submissionsByUserId.set(key, []);
    submissionsByUserId.get(key).push(item);
  }
  const rows = trackedUsers.map((user) => {
    const mine = activityByUserId.get(String(user.user_id)) || [];
    const inWindow = (row) => {
      const stamp = toMs(row.created_at);
      return stamp >= windowStart.getTime() && stamp <= windowEnd.getTime();
    };
    const inDay = (row) => {
      const stamp = toMs(row.created_at);
      return stamp >= dayStart.getTime() && stamp <= windowEnd.getTime();
    };
    const calls = mine.filter((row) => lower(row.action_type) === 'call_logged');
    const profileOpens = mine.filter((row) => lower(row.action_type) === 'profile_opened');
    const profileUpdates = mine.filter((row) => ['profile_updated', 'candidate_updated'].includes(lower(row.action_type)));
    const breakStarts = mine.filter((row) => lower(row.action_type) === 'break_started');
    const mineSubmissions = submissionsByUserId.get(String(user.user_id)) || [];
    const livePresence = presenceByUserId.get(String(user.user_id)) || {};
    const latestActivityStamp = mine
      .map((row) => row.created_at)
      .filter(Boolean)
      .map(toMs)
      .sort((a, b) => b - a)[0] || 0;
    const latestPresenceStamp = Math.max(
      toMs(livePresence.last_seen_at),
      toMs(livePresence.last_call_dial_at),
      toMs(livePresence.work_started_at),
    );
    const lastActivityStamp = Math.max(latestActivityStamp, latestPresenceStamp);
    const lastActivityAt = lastActivityStamp ? new Date(lastActivityStamp).toISOString() : '';
    const liveIdleMinutes = lastActivityStamp ? Math.max(0, Math.round((Date.now() - lastActivityStamp) / 60000)) : 0;
    const calls30 = countByWindow(calls, inWindow);
    const callsDay = countByWindow(calls, inDay);
    const profileOpens30 = countByWindow(profileOpens, inWindow);
    const profileOpensDay = countByWindow(profileOpens, inDay);
    const breakCount30 = countByWindow(breakStarts, inWindow);
    const breakCountDay = countByWindow(breakStarts, inDay);
    const metrics = {
      submissions_30: countByWindow(mineSubmissions, (row) => { const stamp = toMs(row.stamp); return stamp >= windowStart.getTime() && stamp <= windowEnd.getTime(); }),
      submissions_day: countByWindow(mineSubmissions, (row) => { const stamp = toMs(row.stamp); return stamp >= dayStart.getTime() && stamp <= windowEnd.getTime(); }),
      calls_30: calls30,
      calls_day: callsDay,
      whatsapp_30: countByWindow(mine, (row) => inWindow(row) && lower(row.action_type) === 'whatsapp_opened'),
      whatsapp_day: countByWindow(mine, (row) => inDay(row) && lower(row.action_type) === 'whatsapp_opened'),
      profile_opens_30: profileOpens30,
      profile_opens_day: profileOpensDay,
      details_saved_30: countByWindow(profileUpdates, inWindow),
      details_saved_day: countByWindow(profileUpdates, inDay),
      looking_for_job_marked_30: countByWindow(profileUpdates, (row) => {
        const changedFields = parseChangedFields(safeJson(row.metadata));
        return inWindow(row) && changedFields.includes('looking_for_job');
      }),
      looking_for_job_marked_day: countByWindow(profileUpdates, (row) => {
        const changedFields = parseChangedFields(safeJson(row.metadata));
        return inDay(row) && changedFields.includes('looking_for_job');
      }),
      break_count_30: breakCount30,
      break_count_day: breakCountDay,
      break_minutes_30: sumByWindow(mine, (row) => inWindow(row) && ['break_ended', 'break_exceeded'].includes(lower(row.action_type)), (row) => safeJson(row.metadata).break_minutes),
      break_minutes_day: sumByWindow(mine, (row) => inDay(row) && ['break_ended', 'break_exceeded'].includes(lower(row.action_type)), (row) => safeJson(row.metadata).break_minutes),
      crm_unlocks_30: countByWindow(mine, (row) => inWindow(row) && lower(row.action_type) === 'crm_unlocked'),
      crm_unlocks_day: countByWindow(mine, (row) => inDay(row) && lower(row.action_type) === 'crm_unlocked'),
      idle_minutes_30: Math.max(
        sumByWindow(mine, (row) => inWindow(row) && ['crm_locked', 'no_call_lock', 'break_exceeded', 'over_break_alert'].includes(lower(row.action_type)), (row) => {
          const meta = safeJson(row.metadata);
          return meta.idle_minutes || meta.no_call_minutes || meta.break_minutes || 0;
        }),
        Math.min(liveIdleMinutes, WINDOW_MINUTES),
      ),
      idle_minutes_day: Math.max(
        sumByWindow(mine, (row) => inDay(row) && ['crm_locked', 'no_call_lock', 'break_exceeded', 'over_break_alert'].includes(lower(row.action_type)), (row) => {
          const meta = safeJson(row.metadata);
          return meta.idle_minutes || meta.no_call_minutes || meta.break_minutes || 0;
        }),
        liveIdleMinutes,
      ),
      avg_call_gap_30: avgGapMinutes(calls, inWindow),
      avg_call_gap_day: avgGapMinutes(calls, inDay),
      session_minutes_30: currentSessionMinutes(livePresence, windowStart.getTime(), windowEnd.getTime()),
      session_minutes_day: currentSessionMinutes(livePresence, dayStart.getTime(), windowEnd.getTime()),
      productive_minutes_30: productiveMinutes(livePresence, sumByWindow(mine, (row) => inWindow(row) && ['break_ended', 'break_exceeded'].includes(lower(row.action_type)), (row) => safeJson(row.metadata).break_minutes), windowStart.getTime(), windowEnd.getTime()),
      productive_minutes_day: productiveMinutes(livePresence, Number(livePresence?.total_break_minutes || 0), dayStart.getTime(), windowEnd.getTime()),
      idle_15_flag_30: liveIdleMinutes >= 15 ? 1 : 0,
      idle_15_flag_day: liveIdleMinutes >= 15 ? 1 : 0,
      idle_30_flag_30: liveIdleMinutes >= 30 ? 1 : 0,
      idle_30_flag_day: liveIdleMinutes >= 30 ? 1 : 0,
      no_profile_open_30: profileOpens30 === 0 ? 1 : 0,
      no_profile_open_day: profileOpensDay === 0 ? 1 : 0,
      no_call_30: calls30 === 0 ? 1 : 0,
      no_call_day: callsDay === 0 ? 1 : 0,
      on_break_30: Number(livePresence?.is_on_break ? 1 : 0),
      on_break_day: Number(livePresence?.is_on_break ? 1 : 0),
    };
    return {
      user_id: user.user_id,
      username: user.username,
      recruiter_code: user.recruiter_code || '',
      full_name: user.full_name || user.username || user.user_id,
      role: user.role || '',
      last_activity_at: lastActivityAt,
      active_break: Boolean(livePresence?.is_on_break),
      tone: computePerformanceTone(metrics),
      metrics,
    };
  });

  const summary = {
    active_people: rows.length,
    submissions_30: rows.reduce((sum, row) => sum + row.metrics.submissions_30, 0),
    calls_30: rows.reduce((sum, row) => sum + row.metrics.calls_30, 0),
    details_saved_30: rows.reduce((sum, row) => sum + row.metrics.details_saved_30, 0),
    idle_minutes_30: rows.reduce((sum, row) => sum + row.metrics.idle_minutes_30, 0),
    break_count_30: rows.reduce((sum, row) => sum + row.metrics.break_count_30, 0),
    break_minutes_30: rows.reduce((sum, row) => sum + row.metrics.break_minutes_30, 0),
    login_minutes_30: rows.reduce((sum, row) => sum + row.metrics.session_minutes_30, 0),
    work_minutes_30: rows.reduce((sum, row) => sum + row.metrics.productive_minutes_30, 0),
    idle_people_15: countFlags(rows, 'idle_15_flag_30'),
    idle_people_30: countFlags(rows, 'idle_30_flag_30'),
    no_profile_open_30: countFlags(rows, 'no_profile_open_30'),
    no_call_30: countFlags(rows, 'no_call_30'),
    active_breaks: countFlags(rows, 'on_break_30'),
  };

  const payload = {
    generated_at: nowIso(),
    period_key: periodKey,
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    summary,
    rows: rows.sort((a, b) => {
      const toneScore = { green: 2, amber: 1, red: 0 };
      if (toneScore[b.tone] !== toneScore[a.tone]) return toneScore[b.tone] - toneScore[a.tone];
      return String(a.full_name || '').localeCompare(String(b.full_name || ''));
    }),
  };

  const saved = await saveSnapshot(payload, req.user || null);
  const enriched = {
    ...payload,
    saved_report_id: saved?.report_id || '',
    saved_title: saved?.title || `30 Minutes Report • ${formatWindowLabel(payload.window_end || payload.generated_at)}`,
    saved_at: saved?.last_run_at || saved?.created_at || payload.generated_at,
    is_saved_snapshot: false,
  };

  semiHourlyCache.set(cacheKey, enriched);
  return res.json(enriched);
}

module.exports = { overview };
