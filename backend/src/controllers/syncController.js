const { store, table, mode } = require('../lib/store');
const { sanitizeCandidateListForUser } = require('../lib/dataLeakGuard');
const { isLeadership, candidateScopeSql: centralCandidateScopeSql, simpleOwnerSql } = require('../lib/accessRules');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}


function isoNow() {
  return new Date().toISOString();
}

function safeLimit(value, fallback = 50) {
  const n = Number(value || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(Math.floor(n), 50));
}

function candidateVisibleSql(alias = 'c') {
  return `lower(coalesce(${alias}.status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${alias}.approval_status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${alias}.all_details_sent, '')) <> 'deleted'
    and lower(coalesce(${alias}.data_notes, ${alias}.notes, '')) not like '%[crm-deleted]%'`;
}

function candidateScopeSql(user, alias = 'c', params = []) {
  return centralCandidateScopeSql(alias, user, params);
}

function simpleScopeSql(user, alias, ownerFields = [], params = []) {
  return simpleOwnerSql(alias, ownerFields, user, params);
}

function versionExpr(alias = '') {
  const p = alias ? `${alias}.` : '';
  return `coalesce(nullif(${p}updated_at, ''), nullif(${p}created_at, ''), nullif(${p}submitted_at, ''), nullif(${p}approval_requested_at, ''), nullif(${p}scheduled_at, ''), '')`;
}

function normalizeAfter(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : raw;
}

async function tableExists(tableName) {
  if (!(mode === 'postgres' && store.pool)) return true;
  const row = await store.one(`select to_regclass($1) as exists`, [`public.${tableName}`]);
  return Boolean(row?.exists);
}

async function safeStatePayload(scope, error = null) {
  return {
    ok: true,
    scope,
    changed: false,
    change_count: 0,
    count: 0,
    version: '',
    server_time: isoNow(),
    snapshot: {},
    degraded: Boolean(error),
    message: error ? 'Sync skipped safely. Page remains usable.' : '',
  };
}

async function countCandidateSnapshot(user) {
  if (!(mode === 'postgres' && store.pool)) return {};
  const { sql, params } = candidateScopeSql(user, 'c', []);
  const rows = await store.query(`
    select
      count(*)::int as total_visible,
      count(*) filter (where lower(coalesce(c.all_details_sent, '')) = 'pending')::int as pending_details,
      count(*) filter (where coalesce(c.follow_up_at, '') <> '')::int as followup_profiles,
      count(*) filter (where coalesce(c.follow_up_at, '') <> '' and coalesce(c.follow_up_at, '') <= now()::text)::int as pending_followups,
      count(*) filter (where lower(coalesce(c.approval_status, '')) = 'pending')::int as pending_approvals
    from public.candidates c
    where ${sql}
  `, params);
  const r = rows[0] || {};
  return { summary: {
    total_visible: Number(r.total_visible || 0),
    active_bucket: Number(r.total_visible || 0),
    pending_details: Number(r.pending_details || 0),
    followup_profiles: Number(r.followup_profiles || 0),
    pending_followups: Number(r.pending_followups || 0),
    pending_approvals: Number(r.pending_approvals || 0),
  }, total: Number(r.total_visible || 0) };
}

async function countSubmissionSnapshot(user) {
  if (!(mode === 'postgres' && store.pool)) return {};
  const params = [];
  const { sql: cScope, params: scopedParams } = candidateScopeSql(user, 'c', params);
  const rows = await store.query(`
    select
      count(*)::int as total,
      count(*) filter (where lower(coalesce(s.approval_status, '')) = 'pending')::int as pending_approval,
      count(*) filter (where lower(coalesce(c.all_details_sent, '')) = 'pending')::int as pending_details,
      count(*) filter (where coalesce(s.next_follow_up_at, '') <> '')::int as reminders,
      count(*) filter (where coalesce(s.submitted_at, s.approval_requested_at, '') >= current_date::text)::int as today
    from public.submissions s
    left join public.candidates c on c.candidate_id = s.candidate_id
    where ${cScope}
  `, scopedParams);
  return { cards: rows[0] || {} };
}

async function countInterviewSnapshot(user) {
  if (!(mode === 'postgres' && store.pool)) return {};
  const params = [];
  const { sql, params: scopedParams } = candidateScopeSql(user, 'c', params);
  const rows = await store.query(`
    select
      count(*)::int as total,
      count(*) filter (where coalesce(c.interview_reschedule_date, c.interview_date, i.scheduled_at, '')::text like current_date::text || '%')::int as today,
      count(*) filter (where coalesce(c.interview_reschedule_date, c.interview_date, i.scheduled_at, '')::text like (current_date + interval '1 day')::date::text || '%')::int as tomorrow,
      count(*) filter (where lower(coalesce(c.status, i.status, '')) in ('completed','selected','rejected','joined'))::int as completed
    from public.candidates c
    left join public.interviews i on i.candidate_id = c.candidate_id
    where ${sql} and coalesce(c.interview_reschedule_date, c.interview_date, i.scheduled_at, '') <> ''
  `, scopedParams);
  return { cards: rows[0] || {} };
}

async function countSimpleSnapshot(scope, user) {
  if (!(mode === 'postgres' && store.pool)) return {};
  const configs = {
    tasks: { table: 'tasks', alias: 't', owners: ['assigned_to_user_id', 'assigned_to_code', 'assigned_to_name'] },
    followups: { table: 'candidates', alias: 'c', candidate: true },
    'client-pipeline': { table: 'client_pipeline', alias: 'p', owners: [] },
    'revenue-hub': { table: 'revenue_hub_entries', alias: 'r', owners: ['recruiter_code', 'recruiter_name'] },
    approvals: { table: 'submissions', alias: 's', owners: [], leadershipOnly: true },
    notifications: { table: 'notifications', alias: 'n', owners: ['user_id'] },
  };
  const cfg = configs[scope];
  if (!cfg) return {};
  if (cfg.leadershipOnly && !isLeadership(user)) return { total: 0 };
  let where = 'true';
  let params = [];
  if (cfg.candidate) {
    const scoped = candidateScopeSql(user, cfg.alias, []);
    where = `${scoped.sql} and coalesce(${cfg.alias}.follow_up_at, '') <> ''`;
    params = scoped.params;
  } else {
    const scoped = simpleScopeSql(user, cfg.alias, cfg.owners, []);
    where = scoped.sql;
    params = scoped.params;
  }
  const rows = await store.query(`select count(*)::int as total from public.${cfg.table} ${cfg.alias} where ${where}`, params);
  return { total: Number(rows[0]?.total || 0) };
}

async function buildSnapshot(scope, user) {
  try {
    if (scope === 'candidates') return await countCandidateSnapshot(user);
    if (scope === 'submissions') return await countSubmissionSnapshot(user);
    if (scope === 'interviews') return await countInterviewSnapshot(user);
    return await countSimpleSnapshot(scope, user);
  } catch {
    return {};
  }
}

function getScopeConfig(scope) {
  const map = {
    candidates: { table: 'candidates', alias: 'c', id: 'candidate_id', kind: 'candidate' },
    submissions: { table: 'submissions', alias: 's', id: 'submission_id', kind: 'submissions' },
    interviews: { table: 'interviews', alias: 'i', id: 'interview_id', kind: 'interviews' },
    tasks: { table: 'tasks', alias: 't', id: 'task_id', owners: ['assigned_to_user_id', 'assigned_to_code', 'assigned_to_name'] },
    followups: { table: 'candidates', alias: 'c', id: 'candidate_id', kind: 'followups' },
    'client-pipeline': { table: 'client_pipeline', alias: 'p', id: 'lead_id', owners: [] },
    'revenue-hub': { table: 'revenue_hub_entries', alias: 'r', id: 'revenue_id', owners: ['recruiter_code', 'recruiter_name'] },
    approvals: { table: 'submissions', alias: 's', id: 'submission_id', owners: [] },
    notifications: { table: 'notifications', alias: 'n', id: 'notification_id', owners: ['user_id'] },
  };
  return map[scope] || null;
}

async function scopeWhere(cfg, user, params = []) {
  if (cfg.kind === 'candidate') return candidateScopeSql(user, cfg.alias, params);
  if (cfg.kind === 'followups') {
    const scoped = candidateScopeSql(user, cfg.alias, params);
    return { sql: `${scoped.sql} and coalesce(${cfg.alias}.follow_up_at, '') <> ''`, params: scoped.params };
  }
  if (cfg.kind === 'submissions') {
    const scoped = candidateScopeSql(user, 'c', params);
    return { sql: scoped.sql, params: scoped.params };
  }
  if (cfg.kind === 'interviews') {
    const scoped = candidateScopeSql(user, 'c', params);
    return { sql: `${scoped.sql} and coalesce(c.interview_reschedule_date, c.interview_date, i.scheduled_at, '') <> ''`, params: scoped.params };
  }
  return simpleScopeSql(user, cfg.alias, cfg.owners || [], params);
}

async function state(req, res) {
  const scope = lower(req.query.scope || '');
  const cfg = getScopeConfig(scope);
  if (!cfg) return res.json(await safeStatePayload(scope));
  if (cfg.leadershipOnly && !isLeadership(req.user)) return res.json(await safeStatePayload(scope));
  if (!(mode === 'postgres' && store.pool)) return res.json(await safeStatePayload(scope));
  if (!(await tableExists(cfg.table))) return res.json(await safeStatePayload(scope));

  try {
    const after = normalizeAfter(req.query.after || '');
    const params = [];
    const scoped = await scopeWhere(cfg, req.user, params);
    const tableSql = cfg.kind === 'submissions'
      ? `public.submissions s left join public.candidates c on c.candidate_id = s.candidate_id`
      : cfg.kind === 'interviews'
        ? `public.interviews i left join public.candidates c on c.candidate_id = i.candidate_id`
        : `public.${cfg.table} ${cfg.alias}`;
    const vexpr = cfg.kind === 'interviews'
      ? `greatest(coalesce(nullif(i.updated_at,''), nullif(i.created_at,''), ''), coalesce(nullif(c.updated_at,''), nullif(c.created_at,''), ''))`
      : versionExpr(cfg.alias);
    let changeSql = '';
    if (after) {
      scoped.params.push(after);
      changeSql = `, count(*) filter (where ${vexpr} > $${scoped.params.length})::int as change_count`;
    }
    const rows = await store.query(`
      select count(*)::int as total, max(${vexpr}) as version ${changeSql}
      from ${tableSql}
      where ${scoped.sql}
    `, scoped.params);
    const row = rows[0] || {};
    const version = row.version || '';
    const changeCount = after ? Number(row.change_count || 0) : 0;
    return res.json({
      ok: true,
      scope,
      changed: Boolean(after && changeCount > 0),
      change_count: changeCount,
      count: Number(row.total || 0),
      version,
      server_time: isoNow(),
      snapshot: await buildSnapshot(scope, req.user),
    });
  } catch (error) {
    return res.json(await safeStatePayload(scope, error));
  }
}

async function changes(req, res) {
  const scope = lower(req.query.scope || '');
  const cfg = getScopeConfig(scope);
  if (!cfg) return res.json({ ok: true, scope, items: [], version: '', snapshot: {} });
  if (cfg.leadershipOnly && !isLeadership(req.user)) return res.json({ ok: true, scope, items: [], version: '', snapshot: { total: 0 } });
  if (!(mode === 'postgres' && store.pool)) return res.json({ ok: true, scope, items: [], version: '', snapshot: {} });

  try {
    const after = normalizeAfter(req.query.after || '');
    const limit = safeLimit(req.query.limit || 50);
    const params = [];
    const scoped = await scopeWhere(cfg, req.user, params);
    let rows = [];
    let vexpr = versionExpr(cfg.alias);
    let sql = '';
    if (cfg.kind === 'submissions') {
      vexpr = `greatest(coalesce(nullif(s.updated_at,''), nullif(s.submitted_at,''), nullif(s.approval_requested_at,''), nullif(s.created_at,''), ''), coalesce(nullif(c.updated_at,''), nullif(c.created_at,''), ''))`;
      sql = `
        select s.*, c.full_name, c.phone, c.location, c.preferred_location, c.process, c.status as candidate_status,
          coalesce(c.recruiter_name, s.recruiter_code, '') as recruiter_name,
          coalesce(c.recruiter_code, s.recruiter_code, '') as recruiter_code,
          coalesce(c.all_details_sent, 'Pending') as all_details_sent,
          coalesce(c.communication_skill, s.submission_comms, '') as submission_comms,
          coalesce(s.submitted_at, s.approval_requested_at, '') as submission_origin_at,
          ${vexpr} as __sync_version
        from public.submissions s
        left join public.candidates c on c.candidate_id = s.candidate_id
        where ${scoped.sql} ${after ? `and ${vexpr} > $${scoped.params.length + 1}` : ''}
        order by ${vexpr} desc
        limit $${scoped.params.length + (after ? 2 : 1)}
      `;
    } else if (cfg.kind === 'interviews') {
      vexpr = `greatest(coalesce(nullif(i.updated_at,''), nullif(i.created_at,''), ''), coalesce(nullif(c.updated_at,''), nullif(c.created_at,''), ''))`;
      sql = `
        select c.*, i.interview_id, coalesce(i.jd_id, c.jd_id) as jd_id,
          coalesce(i.scheduled_at, c.interview_reschedule_date, c.interview_date, '') as scheduled_at,
          coalesce(i.stage, '') as stage,
          ${vexpr} as __sync_version
        from public.interviews i
        left join public.candidates c on c.candidate_id = i.candidate_id
        where ${scoped.sql} ${after ? `and ${vexpr} > $${scoped.params.length + 1}` : ''}
        order by ${vexpr} desc
        limit $${scoped.params.length + (after ? 2 : 1)}
      `;
    } else {
      sql = `
        select ${cfg.alias}.*, ${vexpr} as __sync_version
        from public.${cfg.table} ${cfg.alias}
        where ${scoped.sql} ${after ? `and ${vexpr} > $${scoped.params.length + 1}` : ''}
        order by ${vexpr} desc
        limit $${scoped.params.length + (after ? 2 : 1)}
      `;
    }
    const queryParams = after ? [...scoped.params, after, limit] : [...scoped.params, limit];
    rows = await store.query(sql, queryParams);
    if (scope === 'candidates' || scope === 'followups' || scope === 'interviews') {
      rows = sanitizeCandidateListForUser(rows, req.user);
    }
    const version = rows.reduce((best, row) => String(row.__sync_version || row.updated_at || row.created_at || '').localeCompare(String(best || '')) > 0 ? (row.__sync_version || row.updated_at || row.created_at || '') : best, after || '');
    return res.json({
      ok: true,
      scope,
      items: rows,
      version,
      server_time: isoNow(),
      snapshot: await buildSnapshot(scope, req.user),
    });
  } catch (error) {
    return res.json({ ok: true, scope, items: [], version: normalizeAfter(req.query.after || ''), snapshot: {}, degraded: true, message: 'Delta sync skipped safely.' });
  }
}

module.exports = { state, changes };
