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

function userIdentity(user = {}) {
  return {
    userId: String(user.user_id || '').trim(),
    recruiterCode: lower(user.recruiter_code),
    names: new Set([user.full_name, user.username, user.name].map(lower).filter(Boolean)),
  };
}

// Candidate ownership has ONE authoritative chain. Audit/submission/last-editor fields
// never grant profile ownership. This prevents an intern from seeing a Manager/TL
// profile merely because the intern submitted or edited it earlier.
function candidateBelongsToUser(row = {}, user = {}) {
  if (!row || !user) return false;
  const who = userIdentity(user);

  const primaryCode = lower(row.recruiter_code);
  const primaryName = lower(row.recruiter_name);
  if (primaryCode) {
    const codeMatches = Boolean(who.recruiterCode && recruiterCodeMatches(primaryCode, who.recruiterCode));
    const nameConsistent = !primaryName || who.names.has(primaryName);
    return codeMatches && nameConsistent;
  }

  if (primaryName) return who.names.has(primaryName);

  const primaryUserId = String(row.recruiter_user_id || row.user_id || '').trim();
  if (primaryUserId) return Boolean(who.userId && primaryUserId === who.userId);

  // Legacy fallback is used only when modern recruiter ownership is completely absent.
  const legacyCode = lower(row.owner_code || row.assigned_to_code || row.employee_code || row.employee_no);
  if (legacyCode) return Boolean(who.recruiterCode && recruiterCodeMatches(legacyCode, who.recruiterCode));

  const legacyName = lower(row.owner_name || row.assigned_to_name || row.employee_name);
  if (legacyName) return who.names.has(legacyName);

  const createdBy = String(row.created_by_user_id || row.owner_user_id || row.assigned_to_user_id || '').trim();
  if (createdBy) return Boolean(who.userId && createdBy === who.userId);

  const createdName = lower(row.created_by_name);
  return Boolean(createdName && who.names.has(createdName));
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
  const codes = new Set((user.__ccTeamCodes || []).map(lower).filter(Boolean));
  const names = new Set((user.__ccTeamNames || []).map(lower).filter(Boolean));

  const primaryCode = lower(row.recruiter_code);
  const primaryName = lower(row.recruiter_name);
  if (primaryCode) return codes.has(primaryCode) && (!primaryName || names.has(primaryName));
  if (primaryName) return names.has(primaryName);
  const primaryUserId = String(row.recruiter_user_id || row.user_id || '').trim();
  if (primaryUserId) return ids.has(primaryUserId);

  const legacyCode = lower(row.owner_code || row.assigned_to_code || row.employee_code || row.employee_no);
  if (legacyCode) return codes.has(legacyCode);
  const legacyName = lower(row.owner_name || row.assigned_to_name || row.employee_name);
  if (legacyName) return names.has(legacyName);
  const legacyId = String(row.created_by_user_id || row.owner_user_id || row.assigned_to_user_id || '').trim();
  if (legacyId) return ids.has(legacyId);
  const createdName = lower(row.created_by_name);
  return Boolean(createdName && names.has(createdName));
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
  const p = alias ? `${alias}.` : '';
  const tl = userRole(user) === 'tl';
  const ids = [...new Set([user.user_id, ...(tl ? (user.__ccTeamUserIds || []) : [])].map((v) => String(v || '').trim()).filter(Boolean))];
  const codes = [...new Set([user.recruiter_code, ...(tl ? (user.__ccTeamCodes || []) : [])].map(lower).filter(Boolean))];
  const names = [...new Set([user.full_name, user.username, ...(tl ? (user.__ccTeamNames || []) : [])].map(lower).filter(Boolean))];

  params.push(ids); const idsRef = `$${params.length}`;
  params.push(codes); const codesRef = `$${params.length}`;
  params.push(names); const namesRef = `$${params.length}`;

  // recruiter_code -> recruiter_name -> recruiter/user id -> legacy fallback.
  // Later audit fields never widen the scope.
  const primaryCodePresent = `coalesce(${p}recruiter_code, '') <> ''`;
  const primaryNamePresent = `coalesce(${p}recruiter_name, '') <> ''`;
  const primaryIdExpr = `coalesce(nullif(${p}recruiter_user_id, ''), nullif(${p}user_id, ''), '')`;
  const primaryIdPresent = `${primaryIdExpr} <> ''`;
  const modernEmpty = `not (${primaryCodePresent}) and not (${primaryNamePresent}) and not (${primaryIdPresent})`;
  const legacyCodeExpr = `coalesce(nullif(${p}employee_code, ''), nullif(${p}employee_no, ''), '')`;
  const legacyNameExpr = `coalesce(${p}employee_name, '')`;
  const legacyIdExpr = `coalesce(${p}created_by_user_id, '')`;

  const checks = [
    `(${primaryCodePresent} and lower(${p}recruiter_code) = any(${codesRef}::text[]) and (not (${primaryNamePresent}) or lower(${p}recruiter_name) = any(${namesRef}::text[])))`,
    `(not (${primaryCodePresent}) and ${primaryNamePresent} and lower(${p}recruiter_name) = any(${namesRef}::text[]))`,
    `(not (${primaryCodePresent}) and not (${primaryNamePresent}) and ${primaryIdPresent} and ${primaryIdExpr} = any(${idsRef}::text[]))`,
    `(${modernEmpty} and ${legacyCodeExpr} <> '' and lower(${legacyCodeExpr}) = any(${codesRef}::text[]))`,
    `(${modernEmpty} and ${legacyCodeExpr} = '' and ${legacyNameExpr} <> '' and lower(${legacyNameExpr}) = any(${namesRef}::text[]))`,
    `(${modernEmpty} and ${legacyCodeExpr} = '' and ${legacyNameExpr} = '' and ${legacyIdExpr} <> '' and ${legacyIdExpr} = any(${idsRef}::text[]))`,
  ];
  return { sql: `(${checks.join(' or ')})`, params };
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
