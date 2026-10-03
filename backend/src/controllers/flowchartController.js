const { store, table } = require('../lib/store');

const FLOWCHART_MAP_KEY = 'flowchart_team_map_json';

const DEFAULT_FLOWCHART_USERS = [
  { user_id: 'MGR.ARYANS', username: 'MGR.ARYANS', full_name: 'Aryans Manager', designation: 'Manager', role: 'manager', recruiter_code: 'MGR-001', is_active: '1', email: 'MGR.ARYANS' },
  { user_id: 'TL.SAKSHI', username: 'TL.SAKSHI', full_name: 'Sakshi Soni', designation: 'Team Lead', role: 'tl', recruiter_code: 'TL-001', is_active: '1', email: 'TL.SAKSHI' },
  { user_id: 'TL.KHUSHI', username: 'TL.KHUSHI', full_name: 'Khushi Singh', designation: 'Team Lead', role: 'tl', recruiter_code: 'TL-002', is_active: '1', email: 'TL.KHUSHI' },
  { user_id: 'TL.SRISHTI', username: 'TL.SRISHTI', full_name: 'Srishti Seth', designation: 'Team Lead', role: 'tl', recruiter_code: 'TL-003', is_active: '1', email: 'TL.SRISHTI' },
  { user_id: 'REC.SAKSHI1', username: 'REC.SAKSHI1', full_name: 'Sakshi Recruiter 1', designation: 'Recruiter', role: 'recruiter', recruiter_code: 'REC-001', is_active: '1', email: 'REC.SAKSHI1' },
  { user_id: 'REC.SAKSHI2', username: 'REC.SAKSHI2', full_name: 'Sakshi Recruiter 2', designation: 'Recruiter', role: 'recruiter', recruiter_code: 'REC-002', is_active: '1', email: 'REC.SAKSHI2' },
  { user_id: 'REC.KHUSHI1', username: 'REC.KHUSHI1', full_name: 'Khushi Recruiter 1', designation: 'Recruiter', role: 'recruiter', recruiter_code: 'REC-003', is_active: '1', email: 'REC.KHUSHI1' },
  { user_id: 'REC.KHUSHI2', username: 'REC.KHUSHI2', full_name: 'Khushi Recruiter 2', designation: 'Recruiter', role: 'recruiter', recruiter_code: 'REC-004', is_active: '1', email: 'REC.KHUSHI2' },
  { user_id: 'REC.SRISHTI1', username: 'REC.SRISHTI1', full_name: 'Srishti Recruiter 1', designation: 'Recruiter', role: 'recruiter', recruiter_code: 'REC-005', is_active: '1', email: 'REC.SRISHTI1' },
  { user_id: 'REC.SRISHTI2', username: 'REC.SRISHTI2', full_name: 'Srishti Recruiter 2', designation: 'Recruiter', role: 'recruiter', recruiter_code: 'REC-006', is_active: '1', email: 'REC.SRISHTI2' },
];

const DEFAULT_ROLE_OVERRIDES = Object.fromEntries(DEFAULT_FLOWCHART_USERS.map((row) => [row.user_id, row.role]));

const DEFAULT_TEAM_MAP = {
  'REC.SAKSHI1': { recruiter_user_id: 'REC.SAKSHI1', recruiter_code: 'REC-001', recruiter_name: 'Sakshi Recruiter 1', tl_user_id: 'TL.SAKSHI', tl_code: 'TL-001', tl_name: 'Sakshi Soni' },
  'REC.SAKSHI2': { recruiter_user_id: 'REC.SAKSHI2', recruiter_code: 'REC-002', recruiter_name: 'Sakshi Recruiter 2', tl_user_id: 'TL.SAKSHI', tl_code: 'TL-001', tl_name: 'Sakshi Soni' },
  'REC.KHUSHI1': { recruiter_user_id: 'REC.KHUSHI1', recruiter_code: 'REC-003', recruiter_name: 'Khushi Recruiter 1', tl_user_id: 'TL.KHUSHI', tl_code: 'TL-002', tl_name: 'Khushi Singh' },
  'REC.KHUSHI2': { recruiter_user_id: 'REC.KHUSHI2', recruiter_code: 'REC-004', recruiter_name: 'Khushi Recruiter 2', tl_user_id: 'TL.KHUSHI', tl_code: 'TL-002', tl_name: 'Khushi Singh' },
  'REC.SRISHTI1': { recruiter_user_id: 'REC.SRISHTI1', recruiter_code: 'REC-005', recruiter_name: 'Srishti Recruiter 1', tl_user_id: 'TL.SRISHTI', tl_code: 'TL-003', tl_name: 'Srishti Seth' },
  'REC.SRISHTI2': { recruiter_user_id: 'REC.SRISHTI2', recruiter_code: 'REC-006', recruiter_name: 'Srishti Recruiter 2', tl_user_id: 'TL.SRISHTI', tl_code: 'TL-003', tl_name: 'Srishti Seth' },
};

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(value, fallback = '') {
  const raw = lower(value || fallback);
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function isActiveUser(row = {}) {
  const value = lower(row.is_active ?? row.active ?? '1');
  return !['0', 'false', 'no', 'inactive', 'disabled', 'deleted'].includes(value);
}

function userKey(row = {}) {
  return String(row.user_key || row.user_id || row.id || row.username || row.recruiter_code || row.email || '').trim();
}

function userCode(row = {}) {
  return String(row.display_code || row.recruiter_code || row.employee_code || row.user_id || row.username || '').trim();
}

function userName(row = {}) {
  return String(row.display_name || row.full_name || row.name || row.username || row.user_id || userCode(row) || 'Team Member').trim();
}

function safeFlowchartUser(row = {}) {
  const next = { ...(row || {}) };
  delete next.password;
  delete next.password_hash;
  delete next.passwordHash;
  delete next.reset_token;
  return next;
}

function safeParseJson(value, fallback) {
  try {
    if (!value) return fallback;
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function cloneDefaultMap() {
  const stamp = nowIso();
  const next = {};
  Object.entries(DEFAULT_TEAM_MAP).forEach(([key, value]) => {
    next[key] = { ...value, updated_at: stamp, default_seed: '1' };
  });
  return next;
}

function normalizeState(parsed = {}) {
  const map = parsed?.map && typeof parsed.map === 'object' ? parsed.map : (parsed && !parsed.version ? parsed : {});
  const roles = parsed?.roles && typeof parsed.roles === 'object' ? parsed.roles : {};
  return {
    map: Object.keys(map || {}).length ? map : cloneDefaultMap(),
    roles: Object.keys(roles || {}).length ? roles : { ...DEFAULT_ROLE_OVERRIDES },
  };
}

async function readMapRecord() {
  try {
    const rows = await table('app_settings');
    return (rows || []).find((row) => String(row.key || '') === FLOWCHART_MAP_KEY) || null;
  } catch {
    return null;
  }
}

async function readTeamState() {
  const record = await readMapRecord();
  return normalizeState(safeParseJson(record?.value, {}));
}

async function writeTeamState(state = {}, actor = {}) {
  const stamp = nowIso();
  const payload = {
    version: 'CC26_FLOWCHART_MAP_V2_ROLE_TEAM',
    updated_at: stamp,
    updated_by_user_id: String(actor.user_id || actor.username || ''),
    updated_by_name: userName(actor),
    map: state.map || {},
    roles: state.roles || {},
  };
  const row = { key: FLOWCHART_MAP_KEY, value: JSON.stringify(payload), updated_at: stamp };
  return store.upsert('app_settings', 'key', row);
}

function canEditFlowchart(user = {}) {
  const role = normalizeRole(user.role, user.designation);
  return role === 'admin' || role === 'manager';
}

function shouldUseDefaultFlowchartUsers(users = []) {
  const active = (users || []).filter(isActiveUser);
  const keys = new Set(active.map((row) => userKey(row).toUpperCase()));
  const hasRequestedTlSet = ['TL.SAKSHI', 'TL.KHUSHI', 'TL.SRISHTI'].every((id) => keys.has(id));
  if (hasRequestedTlSet) return false;
  if (active.length <= 3) return true;
  return false;
}

function sourceUsersForFlowchart(users = []) {
  if (shouldUseDefaultFlowchartUsers(users)) return DEFAULT_FLOWCHART_USERS.map((row) => safeFlowchartUser(row));
  return (users || []).filter(isActiveUser).map((row) => safeFlowchartUser(row));
}

function roleForUser(row = {}, state = {}) {
  const key = userKey(row);
  const code = userCode(row);
  const override = state.roles?.[key] || state.roles?.[code] || row.flowchart_role || row.effective_role;
  return normalizeRole(override, row.role || row.designation || row.user_role || row.access_role);
}

function pickTlFromUserFields(recruiter = {}, tls = []) {
  const possibleId = String(recruiter.tl_user_id || recruiter.team_lead_user_id || recruiter.reporting_tl_user_id || recruiter.reports_to_user_id || recruiter.reporting_manager_user_id || '').trim();
  const possibleCode = String(recruiter.tl_code || recruiter.team_lead_code || recruiter.reporting_tl_code || recruiter.reports_to_code || recruiter.reporting_manager_code || '').trim();
  const possibleName = String(recruiter.tl_name || recruiter.team_lead_name || recruiter.reporting_tl_name || recruiter.reports_to_name || recruiter.reporting_manager_name || '').trim();
  return tls.find((tl) => {
    const id = userKey(tl);
    const code = userCode(tl);
    const name = userName(tl);
    return (possibleId && id && possibleId === id)
      || (possibleCode && code && possibleCode.toLowerCase() === code.toLowerCase())
      || (possibleName && name && possibleName.toLowerCase() === name.toLowerCase());
  }) || null;
}

function resolveAssignedTl(recruiter = {}, teamMap = {}, tls = []) {
  const id = userKey(recruiter);
  const code = userCode(recruiter);
  const mapRow = teamMap[id] || teamMap[code] || null;
  if (mapRow) {
    const mappedId = String(mapRow.tl_user_id || '').trim();
    const mappedCode = String(mapRow.tl_code || '').trim();
    const mappedName = String(mapRow.tl_name || '').trim();
    const match = tls.find((tl) => {
      const tlId = userKey(tl);
      const tlCode = userCode(tl);
      const tlName = userName(tl);
      return (mappedId && tlId && mappedId === tlId)
        || (mappedCode && tlCode && mappedCode.toLowerCase() === tlCode.toLowerCase())
        || (mappedName && tlName && mappedName.toLowerCase() === tlName.toLowerCase());
    });
    if (match) return match;
  }
  return pickTlFromUserFields(recruiter, tls);
}

function decorateUsers(users = [], state = {}) {
  const active = sourceUsersForFlowchart(users);
  const withRoles = active.map((row) => {
    const effectiveRole = roleForUser(row, state);
    return {
      ...row,
      user_key: userKey(row),
      display_name: userName(row),
      display_code: userCode(row),
      effective_role: effectiveRole,
      flowchart_role: effectiveRole,
      role_group: effectiveRole,
    };
  });
  const managers = withRoles.filter((row) => ['admin', 'manager'].includes(row.effective_role));
  const tls = withRoles.filter((row) => row.effective_role === 'tl');
  const recruiters = withRoles.filter((row) => row.effective_role === 'recruiter');
  const tlCards = tls.map((tl) => ({ ...tl, role_group: 'tl' }));
  const recruiterRows = recruiters.map((recruiter) => {
    const assignedTl = resolveAssignedTl(recruiter, state.map || {}, tlCards);
    return {
      ...recruiter,
      role_group: 'recruiter',
      assigned_tl_user_id: assignedTl ? userKey(assignedTl) : '',
      assigned_tl_code: assignedTl ? userCode(assignedTl) : '',
      assigned_tl_name: assignedTl ? userName(assignedTl) : '',
    };
  });
  const managerCards = managers.map((manager) => ({ ...manager, role_group: normalizeRole(manager.effective_role) || 'manager' }));
  return {
    managers: managerCards,
    tls: tlCards,
    recruiters: recruiterRows,
    members: withRoles,
    unassigned_recruiters: recruiterRows.filter((row) => !row.assigned_tl_user_id),
    updated_at: nowIso(),
  };
}

async function team(req, res) {
  const users = await table('users');
  const state = await readTeamState();
  const sourceUsers = sourceUsersForFlowchart(users);
  const hierarchy = decorateUsers(sourceUsers, state);
  return res.json({
    ok: true,
    users: sourceUsers,
    team_map: state.map,
    role_map: state.roles,
    hierarchy,
    can_edit: canEditFlowchart(req.user),
  });
}

function findActiveUserByKey(users = [], target = '') {
  const key = String(target || '').trim().toLowerCase();
  if (!key) return null;
  return (users || []).filter(isActiveUser).find((row) => [userKey(row), userCode(row), row.username, row.email].some((value) => String(value || '').trim().toLowerCase() === key)) || null;
}

async function moveRecruiter(req, res) {
  if (!canEditFlowchart(req.user)) return res.status(403).json({ message: 'Only Manager/Admin can change Flowchart team mapping.' });
  const recruiterKey = String(req.body?.recruiter_user_id || req.body?.recruiter_key || req.body?.recruiter_code || '').trim();
  const tlKey = String(req.body?.tl_user_id || req.body?.tl_key || req.body?.tl_code || '').trim();
  const rawUsers = await table('users');
  const users = sourceUsersForFlowchart(rawUsers);
  const state = await readTeamState();
  const recruiter = findActiveUserByKey(users, recruiterKey);
  const targetTl = findActiveUserByKey(users, tlKey);
  if (!recruiter || roleForUser(recruiter, state) !== 'recruiter') return res.status(400).json({ message: 'Valid recruiter is required.' });
  if (!targetTl || roleForUser(targetTl, state) !== 'tl') return res.status(400).json({ message: 'Valid TL is required.' });
  const key = userKey(recruiter) || userCode(recruiter);
  state.roles[key] = 'recruiter';
  state.roles[userKey(targetTl)] = 'tl';
  state.map[key] = {
    recruiter_user_id: userKey(recruiter),
    recruiter_code: userCode(recruiter),
    recruiter_name: userName(recruiter),
    tl_user_id: userKey(targetTl),
    tl_code: userCode(targetTl),
    tl_name: userName(targetTl),
    updated_at: nowIso(),
    updated_by_user_id: String(req.user?.user_id || req.user?.username || ''),
    updated_by_name: userName(req.user),
  };
  await writeTeamState(state, req.user);
  const hierarchy = decorateUsers(users, state);
  return res.json({ ok: true, team_map: state.map, role_map: state.roles, hierarchy, moved: state.map[key] });
}

async function saveTeamMap(req, res) {
  if (!canEditFlowchart(req.user)) return res.status(403).json({ message: 'Only Manager/Admin can change Flowchart team mapping.' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const rawUsers = await table('users');
  const users = sourceUsersForFlowchart(rawUsers);
  const state = await readTeamState();
  for (const row of rows) {
    const member = findActiveUserByKey(users, row?.user_id || row?.user_key || row?.recruiter_user_id || row?.recruiter_key || row?.recruiter_code);
    if (!member) continue;
    const key = userKey(member) || userCode(member);
    const requestedRole = normalizeRole(row?.role || row?.flowchart_role || row?.effective_role, roleForUser(member, state));
    if (requestedRole === 'manager' || requestedRole === 'admin') {
      state.roles[key] = requestedRole;
      delete state.map[key];
      continue;
    }
    if (requestedRole === 'tl') {
      state.roles[key] = 'tl';
      delete state.map[key];
      continue;
    }
    if (requestedRole === 'recruiter') {
      state.roles[key] = 'recruiter';
      const targetTl = findActiveUserByKey(users, row?.tl_user_id || row?.tl_key || row?.tl_code || row?.assigned_tl_user_id || '');
      if (!targetTl || normalizeRole(row?.tl_user_id || '') === 'recruiter') {
        delete state.map[key];
        continue;
      }
      const targetRole = roleForUser(targetTl, { ...state, roles: { ...state.roles, [key]: 'recruiter' } });
      if (targetRole !== 'tl') {
        delete state.map[key];
        continue;
      }
      state.map[key] = {
        recruiter_user_id: userKey(member),
        recruiter_code: userCode(member),
        recruiter_name: userName(member),
        tl_user_id: userKey(targetTl),
        tl_code: userCode(targetTl),
        tl_name: userName(targetTl),
        updated_at: nowIso(),
        updated_by_user_id: String(req.user?.user_id || req.user?.username || ''),
        updated_by_name: userName(req.user),
      };
    }
  }
  await writeTeamState(state, req.user);
  const hierarchy = decorateUsers(users, state);
  return res.json({ ok: true, team_map: state.map, role_map: state.roles, hierarchy, saved_count: rows.length });
}

module.exports = {
  team,
  moveRecruiter,
  saveTeamMap,
  DEFAULT_FLOWCHART_USERS,
  DEFAULT_TEAM_MAP,
};
