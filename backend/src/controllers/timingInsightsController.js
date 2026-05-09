const { store, table, mode } = require('../lib/store');

const CACHE = new Map();
const CACHE_TTL_MS = 2 * 60 * 1000;
const IST_OFFSET_MINUTES = 330;

function lower(value) { return String(value || '').trim().toLowerCase(); }
function pad2(value) { return String(value).padStart(2, '0'); }
function isLeadership(user) { return ['admin', 'manager', 'tl'].includes(lower(user?.role)); }

function startOfIstDay(dateValue) {
  const value = String(dateValue || '').slice(0, 10);
  const base = value ? new Date(`${value}T00:00:00+05:30`) : new Date();
  if (Number.isNaN(base.getTime())) return startOfIstDay('');
  return new Date(base.getTime());
}

function periodBounds(period, anchorDate) {
  const anchor = startOfIstDay(anchorDate);
  const key = lower(period) || 'daily';
  if (key === 'monthly') {
    const start = new Date(anchor.getTime());
    start.setDate(1);
    const end = new Date(start.getTime());
    end.setMonth(end.getMonth() + 1);
    return { period: 'monthly', start, end };
  }
  if (key === 'weekly') {
    const start = new Date(anchor.getTime());
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    const end = new Date(start.getTime());
    end.setDate(end.getDate() + 7);
    return { period: 'weekly', start, end };
  }
  const start = anchor;
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  return { period: 'daily', start, end };
}

function hourLabel(hour) {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const base = hour % 12 || 12;
  return `${base} ${suffix}`;
}

function hourRangeLabel(hour) { return `${hourLabel(hour)} - ${hourLabel((hour + 1) % 24)}`; }
function formatPercent(value) { const safe = Number(value || 0); return `${safe.toFixed(safe >= 10 ? 0 : 1)}%`; }
function cacheKey(req, period, anchor, recruiterCode) { return `${lower(req.user?.role)}|${req.user?.user_id || ''}|${period}|${anchor}|${recruiterCode}`; }
function parseJsonSafe(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }

function istHour(dateValue) {
  const date = new Date(dateValue || 0);
  if (Number.isNaN(date.getTime())) return null;
  const adjusted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return adjusted.getUTCHours();
}

function recruiterFilterForUser(req) {
  if (lower(req.user?.role) === 'recruiter') return String(req.user?.recruiter_code || '').trim();
  const selected = String(req.query.recruiter_code || '').trim();
  return selected && lower(selected) !== 'all' ? selected : '';
}

function fillHourRows(rowsByHour) {
  const result = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const row = rowsByHour.get(hour) || { hour, calls: 0, connected: 0, details: 0, submissions: 0 };
    const calls = Number(row.calls || 0);
    const connected = Number(row.connected || 0);
    const details = Number(row.details || 0);
    const submissions = Number(row.submissions || 0);
    const pickupRatio = calls ? (connected / calls) * 100 : 0;
    const detailPerCall = calls ? (details / calls) * 100 : 0;
    const strength = (connected * 2.2) + (details * 1.5) + (submissions * 1.2) + (calls * 0.4);
    result.push({
      hour,
      label: hourRangeLabel(hour),
      calls,
      connected,
      details,
      submissions,
      pickup_ratio: Number(pickupRatio.toFixed(1)),
      detail_per_call: Number(detailPerCall.toFixed(1)),
      strength: Number(strength.toFixed(1)),
    });
  }
  return result;
}

function summarize(hours) {
  const totals = hours.reduce((acc, row) => {
    acc.calls += row.calls;
    acc.connected += row.connected;
    acc.details += row.details;
    acc.submissions += row.submissions;
    return acc;
  }, { calls: 0, connected: 0, details: 0, submissions: 0 });
  const pickupRatio = totals.calls ? (totals.connected / totals.calls) * 100 : 0;
  const detailRatio = totals.calls ? (totals.details / totals.calls) * 100 : 0;
  const sortBy = (key, tieKey) => [...hours].sort((a, b) => (b[key] - a[key]) || (b[tieKey] - a[tieKey]) || (a.hour - b.hour))[0] || hours[0] || null;
  return {
    totals: { ...totals, pickup_ratio: Number(pickupRatio.toFixed(1)), detail_ratio: Number(detailRatio.toFixed(1)) },
    best: {
      calls: sortBy('calls', 'connected'),
      connected: [...hours].sort((a, b) => (b.pickup_ratio - a.pickup_ratio) || (b.connected - a.connected) || (a.hour - b.hour))[0] || hours[0] || null,
      details: sortBy('details', 'detail_per_call'),
      submissions: sortBy('submissions', 'strength'),
    },
    top_windows: [...hours].sort((a, b) => (b.strength - a.strength) || (b.connected - a.connected) || (a.hour - b.hour)).slice(0, 6),
  };
}

async function loadRecruiters() {
  const users = await table('users');
  return users
    .filter((row) => ['recruiter', 'tl', 'manager', 'admin'].includes(lower(row.role)))
    .map((row) => ({
      user_id: row.user_id,
      recruiter_code: String(row.recruiter_code || '').trim(),
      full_name: row.full_name || row.username || 'Unknown',
      role: lower(row.role),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

function withinRange(value, start, end) {
  const time = new Date(value || 0).getTime();
  return Boolean(time) && time >= start.getTime() && time < end.getTime();
}

async function buildFromJson(start, end, recruiterCode) {
  const users = await loadRecruiters();
  const usersById = new Map(users.map((row) => [String(row.user_id), row]));
  const activity = await table('activity_log');
  const rowsByHour = new Map();
  const recruiterStats = new Map();
  let explicitConnected = 0;
  let explicitDetails = 0;
  let fallbackConnected = 0;
  let fallbackDetails = 0;

  for (const row of activity) {
    if (!withinRange(row.created_at, start, end)) continue;
    const userMeta = usersById.get(String(row.user_id || '')) || {};
    const code = String(userMeta.recruiter_code || '').trim();
    if (recruiterCode && code !== recruiterCode) continue;
    const hour = istHour(row.created_at);
    if (hour === null) continue;
    const action = lower(row.action_type);
    const meta = parseJsonSafe(row.metadata) || {};
    const changedFields = Array.isArray(meta.changed_fields) ? meta.changed_fields.map((item) => String(item || '')) : [];
    const bucket = rowsByHour.get(hour) || { hour, calls: 0, connected: 0, details: 0, submissions: 0 };
    const key = `${code}|${row.user_id || ''}`;
    const recruiterBucket = recruiterStats.get(key) || {
      user_id: row.user_id || '', recruiter_code: code, full_name: userMeta.full_name || row.username || 'Unknown', calls: 0, connected: 0, details: 0, submissions: 0,
    };
    if (action === 'call_logged') { bucket.calls += 1; recruiterBucket.calls += 1; }
    if (action === 'call_connected_marked') { bucket.connected += 1; recruiterBucket.connected += 1; explicitConnected += 1; }
    if (action === 'details_saved') { bucket.details += 1; recruiterBucket.details += 1; explicitDetails += 1; }
    if (action === 'submitted_for_approval') { bucket.submissions += 1; recruiterBucket.submissions += 1; }
    if (action === 'profile_updated') {
      fallbackDetails += 1;
      if (changedFields.includes('Call Connected')) fallbackConnected += 1;
    }
    rowsByHour.set(hour, bucket);
    recruiterStats.set(key, recruiterBucket);
  }

  if (!explicitDetails || !explicitConnected) {
    for (const row of activity) {
      if (!withinRange(row.created_at, start, end)) continue;
      const userMeta = usersById.get(String(row.user_id || '')) || {};
      const code = String(userMeta.recruiter_code || '').trim();
      if (recruiterCode && code !== recruiterCode) continue;
      const hour = istHour(row.created_at);
      if (hour === null) continue;
      const action = lower(row.action_type);
      if (action !== 'profile_updated') continue;
      const meta = parseJsonSafe(row.metadata) || {};
      const changedFields = Array.isArray(meta.changed_fields) ? meta.changed_fields.map((item) => String(item || '')) : [];
      const bucket = rowsByHour.get(hour) || { hour, calls: 0, connected: 0, details: 0, submissions: 0 };
      const key = `${code}|${row.user_id || ''}`;
      const recruiterBucket = recruiterStats.get(key) || { user_id: row.user_id || '', recruiter_code: code, full_name: userMeta.full_name || row.username || 'Unknown', calls: 0, connected: 0, details: 0, submissions: 0 };
      if (!explicitDetails) { bucket.details += 1; recruiterBucket.details += 1; }
      if (!explicitConnected && changedFields.includes('Call Connected')) { bucket.connected += 1; recruiterBucket.connected += 1; }
      rowsByHour.set(hour, bucket);
      recruiterStats.set(key, recruiterBucket);
    }
  }

  return { recruiters: users, hours: fillHourRows(rowsByHour), recruiter_breakdown: [...recruiterStats.values()], using_fallback: { connected: !explicitConnected && fallbackConnected > 0, details: !explicitDetails && fallbackDetails > 0 } };
}

async function buildFromPostgres(start, end, recruiterCode) {
  const users = await loadRecruiters();
  const params = [start.toISOString(), end.toISOString()];
  let recruiterSql = '';
  if (recruiterCode) { params.push(recruiterCode); recruiterSql = "and coalesce(u.recruiter_code,'') = $3"; }
  const rows = await store.query(`
    select
      coalesce(u.user_id, a.user_id, '') as user_id,
      coalesce(nullif(u.recruiter_code,''), '') as recruiter_code,
      coalesce(nullif(u.full_name,''), nullif(a.username,''), 'Unknown') as full_name,
      extract(hour from timezone('Asia/Kolkata', (a.created_at)::timestamptz))::int as hour_bucket,
      sum(case when lower(a.action_type) = 'call_logged' then 1 else 0 end)::int as calls,
      sum(case when lower(a.action_type) = 'call_connected_marked' then 1 else 0 end)::int as connected_explicit,
      sum(case when lower(a.action_type) = 'details_saved' then 1 else 0 end)::int as details_explicit,
      sum(case when lower(a.action_type) = 'submitted_for_approval' then 1 else 0 end)::int as submissions,
      sum(case when lower(a.action_type) = 'profile_updated' then 1 else 0 end)::int as details_fallback,
      sum(case when lower(a.action_type) = 'profile_updated'
        and coalesce((coalesce(nullif(a.metadata,''),'{}'))::jsonb -> 'changed_fields', '[]'::jsonb) ? 'Call Connected' then 1 else 0 end)::int as connected_fallback
    from public.activity_log a
    left join public.users u on u.user_id = a.user_id
    where (a.created_at)::timestamptz >= $1::timestamptz
      and (a.created_at)::timestamptz < $2::timestamptz
      and lower(a.action_type) in ('call_logged','call_connected_marked','details_saved','profile_updated','submitted_for_approval')
      ${recruiterSql}
    group by 1,2,3,4
    order by 4 asc, 3 asc
  `, params);

  const rowsByHour = new Map();
  const recruiterStats = new Map();
  let explicitConnected = 0;
  let explicitDetails = 0;
  let fallbackConnected = 0;
  let fallbackDetails = 0;
  for (const row of rows) {
    const hour = Number(row.hour_bucket || 0);
    const bucket = rowsByHour.get(hour) || { hour, calls: 0, connected: 0, details: 0, submissions: 0 };
    bucket.calls += Number(row.calls || 0);
    bucket.connected += Number(row.connected_explicit || 0);
    bucket.details += Number(row.details_explicit || 0);
    bucket.submissions += Number(row.submissions || 0);
    explicitConnected += Number(row.connected_explicit || 0);
    explicitDetails += Number(row.details_explicit || 0);
    fallbackConnected += Number(row.connected_fallback || 0);
    fallbackDetails += Number(row.details_fallback || 0);
    rowsByHour.set(hour, bucket);
    const key = `${row.recruiter_code || ''}|${row.user_id || ''}`;
    const recruiterRow = recruiterStats.get(key) || { user_id: row.user_id || '', recruiter_code: row.recruiter_code || '', full_name: row.full_name || 'Unknown', calls: 0, connected: 0, details: 0, submissions: 0, connected_fallback: 0, details_fallback: 0 };
    recruiterRow.calls += Number(row.calls || 0);
    recruiterRow.connected += Number(row.connected_explicit || 0);
    recruiterRow.details += Number(row.details_explicit || 0);
    recruiterRow.submissions += Number(row.submissions || 0);
    recruiterRow.connected_fallback += Number(row.connected_fallback || 0);
    recruiterRow.details_fallback += Number(row.details_fallback || 0);
    recruiterStats.set(key, recruiterRow);
  }
  if (!explicitConnected || !explicitDetails) {
    for (const row of rows) {
      const hour = Number(row.hour_bucket || 0);
      const bucket = rowsByHour.get(hour) || { hour, calls: 0, connected: 0, details: 0, submissions: 0 };
      if (!explicitConnected) bucket.connected += Number(row.connected_fallback || 0);
      if (!explicitDetails) bucket.details += Number(row.details_fallback || 0);
      rowsByHour.set(hour, bucket);
      const key = `${row.recruiter_code || ''}|${row.user_id || ''}`;
      const recruiterRow = recruiterStats.get(key);
      if (recruiterRow) {
        if (!explicitConnected) recruiterRow.connected += Number(row.connected_fallback || 0);
        if (!explicitDetails) recruiterRow.details += Number(row.details_fallback || 0);
      }
    }
  }
  return { recruiters: users, hours: fillHourRows(rowsByHour), recruiter_breakdown: [...recruiterStats.values()], using_fallback: { connected: !explicitConnected && fallbackConnected > 0, details: !explicitDetails && fallbackDetails > 0 } };
}

function periodLabel(period, start, end) {
  if (period === 'monthly') return start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (period === 'weekly') {
    const endDay = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    return `${start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${endDay.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

exports.overview = async function overview(req, res) {
  const period = lower(req.query.period) || 'daily';
  const anchor = String(req.query.anchor || '').slice(0, 10) || `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}-${pad2(new Date().getDate())}`;
  const recruiterCode = recruiterFilterForUser(req);
  const bounds = periodBounds(period, anchor);
  const key = cacheKey(req, bounds.period, anchor, recruiterCode);
  const cached = CACHE.get(key);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) return res.json(cached.payload);
  const source = mode === 'postgres' ? await buildFromPostgres(bounds.start, bounds.end, recruiterCode) : await buildFromJson(bounds.start, bounds.end, recruiterCode);
  const summary = summarize(source.hours);
  const recruiterRows = source.recruiter_breakdown.map((row) => {
    const calls = Number(row.calls || 0);
    const connected = Number(row.connected || 0);
    const details = Number(row.details || 0);
    const submissions = Number(row.submissions || 0);
    return {
      user_id: row.user_id,
      recruiter_code: row.recruiter_code,
      full_name: row.full_name,
      calls,
      connected,
      details,
      submissions,
      pickup_ratio: Number((calls ? (connected / calls) * 100 : 0).toFixed(1)),
      detail_ratio: Number((calls ? (details / calls) * 100 : 0).toFixed(1)),
    };
  }).sort((a, b) => (b.details - a.details) || (b.connected - a.connected) || (b.calls - a.calls) || a.full_name.localeCompare(b.full_name));
  const payload = {
    meta: {
      page_name: 'Prime Time Insights',
      period: bounds.period,
      period_label: periodLabel(bounds.period, bounds.start, bounds.end),
      anchor,
      recruiter_code: recruiterCode || 'all',
      recruiter_options: source.recruiters,
      using_fallback: source.using_fallback,
      scope: isLeadership(req.user) ? 'leadership' : 'self',
    },
    cards: {
      calls_logged: summary.totals.calls,
      connected_calls: summary.totals.connected,
      details_saved: summary.totals.details,
      pickup_ratio: formatPercent(summary.totals.pickup_ratio),
      best_call_hour: summary.best.calls?.label || 'No data yet',
      best_pickup_hour: summary.best.connected?.label || 'No data yet',
      best_detail_hour: summary.best.details?.label || 'No data yet',
      best_submit_hour: summary.best.submissions?.label || 'No data yet',
    },
    summary: summary.totals,
    hourly: source.hours,
    top_windows: summary.top_windows,
    recruiter_breakdown: recruiterRows,
  };
  CACHE.set(key, { at: Date.now(), payload });
  return res.json(payload);
};
