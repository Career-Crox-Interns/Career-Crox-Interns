const { recruiterCodeMatches } = require('./helpers');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalRole(value, fallback = '') {
  const raw = lower(value || fallback);
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function userRole(user = {}) {
  return canonicalRole(user.role, user.designation);
}

function isLeadership(user = {}) {
  return ['admin', 'manager', 'tl'].includes(userRole(user));
}

function isAdminOrManager(user = {}) {
  return ['admin', 'manager'].includes(userRole(user));
}

function splitLoose(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function sameText(a, b) {
  const aa = lower(a);
  const bb = lower(b);
  return Boolean(aa && bb && aa === bb);
}

function valueMatchesAnyName(value, user = {}) {
  const userNames = [user.full_name, user.username, user.name].map(lower).filter(Boolean);
  const raw = lower(value);
  return Boolean(raw && userNames.includes(raw));
}

function candidateBelongsToUser(row = {}, user = {}) {
  if (!row || !user) return false;

  const recruiterCode = String(user.recruiter_code || '').trim();
  const userId = String(user.user_id || '').trim();

  const codeFields = [
    row.recruiter_code,
    row.submitted_by_recruiter_code,
    row.assigned_to_code,
    row.employee_no,
    row.employee_code,
    row.owner_code,
  ];

  if (recruiterCode && codeFields.some((value) => recruiterCodeMatches(value, recruiterCode))) return true;

  const nameFields = [
    row.recruiter_name,
    row.submitted_by,
    row.submitted_by_name,
    row.employee_name,
    row.assigned_to_name,
    row.owner_name,
    row.created_by_name,
    row.last_updated_by_name,
  ];

  if (nameFields.some((value) => valueMatchesAnyName(value, user))) return true;

  const idFields = [
    row.user_id,
    row.recruiter_user_id,
    row.submitted_by_user_id,
    row.assigned_to_user_id,
    row.created_by_user_id,
    row.owner_user_id,
  ];

  return Boolean(userId && idFields.some((value) => String(value || '').trim() === userId));
}

function isDeletedCandidate(row = {}) {
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

// Manager: all; TL: only records belonging to own team; recruiter: own only.
// A missing/stale team roster fails CLOSED (own only), never grants all-candidate access.
function candidateBelongsToTeam(row = {}, user = {}) {
  if (candidateBelongsToUser(row, user)) return true;
  if (userRole(user) !== 'tl') return false;
  const ids = new Set((user.__ccTeamUserIds || []).map((v) => String(v || '').trim()).filter(Boolean));
  const codes = new Set((user.__ccTeamCodes || []).map((v) => lower(v)).filter(Boolean));
  const names = new Set((user.__ccTeamNames || []).map((v) => lower(v)).filter(Boolean));
  return [row.recruiter_user_id, row.user_id, row.created_by_user_id].some((v) => ids.has(String(v || '').trim()) && String(v || '').trim())
    || [row.recruiter_code,row.employee_code,row.employee_no].some((v) => codes.has(lower(v)) && lower(v))
    || [row.recruiter_name,row.employee_name,row.submitted_by].some((v) => names.has(lower(v)) && lower(v));
}
function visibleCandidateForUser(row = {}, user = {}) {
  if (isDeletedCandidate(row)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager') return true;
  return role === 'tl' ? Boolean(candidateBelongsToTeam(row, user)) : candidateBelongsToUser(row, user);
}

function candidateNotDeletedSql(alias = 'c') {
  const p = alias ? `${alias}.` : '';
  return `coalesce(${p}deleted_at, '') = ''
    and lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}all_details_sent, '')) not in ('deleted', 'archived')
    and lower(coalesce(${p}data_notes, '')) not like '%[crm-deleted]%'`;
}

function candidateOwnerSql(alias = 'c', user = {}, params = [], extraAliases = []) {
  if (isAdminOrManager(user)) return { sql: 'true', params };
  if (userRole(user) === 'tl') {
    const p = alias ? `${alias}.` : '';
    const codes = [...new Set([user.recruiter_code, ...(user.__ccTeamCodes || [])].map(lower).filter(Boolean))];
    const names = [...new Set([user.full_name,user.username, ...(user.__ccTeamNames || [])].map(lower).filter(Boolean))];
    params.push(codes); const codeRef = `$${params.length}`;
    params.push(names); const nameRef = `$${params.length}`;
    const checks = [`lower(coalesce(${p}recruiter_code, '')) = any(${codeRef}::text[])`,
      `lower(coalesce(${p}employee_code, '')) = any(${codeRef}::text[])`,
      `lower(coalesce(${p}employee_no, '')) = any(${codeRef}::text[])`,
      `lower(coalesce(${p}recruiter_name, '')) = any(${nameRef}::text[])`,
      `lower(coalesce(${p}employee_name, '')) = any(${nameRef}::text[])`,
      `lower(coalesce(${p}submitted_by, '')) = any(${nameRef}::text[])`];
    return { sql: `(${checks.join(' or ')})`, params };
  }
  const p = alias ? `${alias}.` : '';

  params.push(String(user.recruiter_code || '').trim().toLowerCase());
  const codeRef = `$${params.length}`;
  params.push(String(user.full_name || '').trim().toLowerCase());
  const nameRef = `$${params.length}`;
  params.push(String(user.username || '').trim().toLowerCase());
  const usernameRef = `$${params.length}`;
  params.push(String(user.user_id || '').trim());
  const userIdRef = `$${params.length}`;

  const pieces = [
    `lower(coalesce(${p}recruiter_code, '')) = ${codeRef}`,
    `lower(coalesce(${p}employee_code, '')) = ${codeRef}`,
    `lower(coalesce(${p}employee_no, '')) = ${codeRef}`,
    `lower(coalesce(${p}recruiter_name, '')) in (${nameRef}, ${usernameRef})`,
    `lower(coalesce(${p}submitted_by, '')) in (${nameRef}, ${usernameRef}, ${codeRef})`,
    `lower(coalesce(${p}employee_name, '')) in (${nameRef}, ${usernameRef})`,
  ];

  for (const extra of extraAliases || []) {
    const ep = extra ? `${extra}.` : '';
    // Keep SQL scope compatible with old submissions table:
    // recruiter_code exists in all known CRM builds; extended submitted_by_* columns may not.
    pieces.push(`lower(coalesce(${ep}recruiter_code, '')) = ${codeRef}`);
    pieces.push(`lower(coalesce(${ep}employee_code, '')) = ${codeRef}`);
    pieces.push(`lower(coalesce(${ep}employee_no, '')) = ${codeRef}`);
  }

  return { sql: `(${pieces.join(' or ')})`, params };
}

function candidateScopeSql(alias = 'c', user = {}, params = [], extraAliases = []) {
  const clauses = [candidateNotDeletedSql(alias)];
  if (!isAdminOrManager(user)) {
    const owner = candidateOwnerSql(alias, user, params, extraAliases);
    clauses.push(owner.sql);
    params = owner.params;
  }
  return { sql: clauses.join(' and '), params };
}

function simpleOwnerSql(alias, ownerFields = [], user = {}, params = []) {
  if (isAdminOrManager(user) || !ownerFields.length) return { sql: 'true', params };

  const tl = userRole(user) === 'tl';
  const ids = [...new Set([user.user_id, ...(tl ? (user.__ccTeamUserIds || []) : [])].map((v) => String(v || '').trim()).filter(Boolean))];
  const codes = [...new Set([user.recruiter_code, ...(tl ? (user.__ccTeamCodes || []) : [])].map(lower).filter(Boolean))];
  const names = [...new Set([user.full_name, user.username, ...(tl ? (user.__ccTeamNames || []) : [])].map(lower).filter(Boolean))];

  params.push(ids); const idsRef = `$${params.length}`;
  params.push(codes); const codesRef = `$${params.length}`;
  params.push(names); const namesRef = `$${params.length}`;

  const p = alias ? `${alias}.` : '';
  const pieces = [];
  for (const field of ownerFields) {
    const ref = `${p}${field}`;
    const lowerName = String(field || '').toLowerCase();
    if (lowerName.includes('user_id')) pieces.push(`coalesce(${ref}, '') = any(${idsRef}::text[])`);
    else if (lowerName.includes('code')) pieces.push(`lower(coalesce(${ref}, '')) = any(${codesRef}::text[])`);
    else pieces.push(`lower(coalesce(${ref}, '')) = any(${namesRef}::text[]) or lower(coalesce(${ref}, '')) = any(${codesRef}::text[])`);
  }
  return { sql: pieces.length ? `(${pieces.join(' or ')})` : 'false', params };
}

module.exports = {
  lower,
  canonicalRole,
  userRole,
  isLeadership,
  isAdminOrManager,
  candidateBelongsToUser,
  candidateBelongsToTeam,
  visibleCandidateForUser,
  candidateNotDeletedSql,
  candidateOwnerSql,
  candidateScopeSql,
  simpleOwnerSql,
};
