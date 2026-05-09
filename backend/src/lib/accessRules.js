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
    || approval === 'deleted'
    || approval === '__deleted__'
    || details === 'deleted'
    || notes.includes('[crm-deleted]');
}

function visibleCandidateForUser(row = {}, user = {}) {
  if (isDeletedCandidate(row)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager' || role === 'tl') return true;
  return candidateBelongsToUser(row, user);
}

function candidateNotDeletedSql(alias = 'c') {
  const p = alias ? `${alias}.` : '';
  return `lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__')
    and lower(coalesce(${p}all_details_sent, '')) <> 'deleted'
    and lower(coalesce(${p}data_notes, '')) not like '%[crm-deleted]%'`;
}

function candidateOwnerSql(alias = 'c', user = {}, params = [], extraAliases = []) {
  if (isLeadership(user)) return { sql: 'true', params };
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
  if (!isLeadership(user)) {
    const owner = candidateOwnerSql(alias, user, params, extraAliases);
    clauses.push(owner.sql);
    params = owner.params;
  }
  return { sql: clauses.join(' and '), params };
}

function simpleOwnerSql(alias, ownerFields = [], user = {}, params = []) {
  if (isLeadership(user) || !ownerFields.length) return { sql: 'true', params };

  params.push(String(user.user_id || '').trim());
  const userIdRef = `$${params.length}`;
  params.push(String(user.recruiter_code || '').trim().toLowerCase());
  const codeRef = `$${params.length}`;
  params.push(String(user.full_name || '').trim().toLowerCase());
  const nameRef = `$${params.length}`;
  params.push(String(user.username || '').trim().toLowerCase());
  const usernameRef = `$${params.length}`;

  const p = alias ? `${alias}.` : '';
  const pieces = [];
  for (const field of ownerFields) {
    const ref = `${p}${field}`;
    const lowerName = String(field || '').toLowerCase();
    if (lowerName.includes('user_id')) pieces.push(`coalesce(${ref}, '') = ${userIdRef}`);
    else if (lowerName.includes('code')) pieces.push(`lower(coalesce(${ref}, '')) = ${codeRef}`);
    else pieces.push(`lower(coalesce(${ref}, '')) in (${nameRef}, ${usernameRef}, ${codeRef})`);
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
  visibleCandidateForUser,
  candidateNotDeletedSql,
  candidateOwnerSql,
  candidateScopeSql,
  simpleOwnerSql,
};
