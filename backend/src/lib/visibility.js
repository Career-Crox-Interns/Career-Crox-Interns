const { recruiterCodeMatches } = require('./helpers');
const { table } = require('./store');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isManager(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
}

function isTl(user) {
  return ['tl', 'team lead'].includes(lower(user?.role));
}

function isLeadership(user) {
  return isManager(user) || isTl(user);
}

async function getTeamMemberIds(user) {
  const users = await table('users');
  const me = String(user?.user_id || '');
  if (!me) return [];
  if (isManager(user)) return users.map((row) => String(row.user_id || '')).filter(Boolean);
  if (isTl(user)) {
    return users.filter((row) => String(row.assigned_tl_user_id || '') === me || String(row.user_id || '') === me).map((row) => String(row.user_id || '')).filter(Boolean);
  }
  return [me];
}

function rowBelongsToUser(row, user) {
  const sameName = String(row?.recruiter_name || '').trim().toLowerCase() === String(user?.full_name || '').trim().toLowerCase();
  const sameCode = recruiterCodeMatches(row?.recruiter_code, user?.recruiter_code);
  return sameName || sameCode;
}

async function canViewCandidate(row, user) {
  if (isManager(user)) return true;
  if (isTl(user)) {
    const users = await table('users');
    const teamCodes = new Set(users.filter((u) => String(u.assigned_tl_user_id || '') === String(user?.user_id || '')).map((u) => String(u.recruiter_code || '').trim().toLowerCase()).filter(Boolean));
    const teamNames = new Set(users.filter((u) => String(u.assigned_tl_user_id || '') === String(user?.user_id || '')).map((u) => String(u.full_name || '').trim().toLowerCase()).filter(Boolean));
    const sameTl = String(row?.recruiter_name || '').trim().toLowerCase() === String(user?.full_name || '').trim().toLowerCase() || recruiterCodeMatches(row?.recruiter_code, user?.recruiter_code);
    const teamMatch = teamCodes.has(String(row?.recruiter_code || '').trim().toLowerCase()) || teamNames.has(String(row?.recruiter_name || '').trim().toLowerCase());
    return sameTl || teamMatch;
  }
  return rowBelongsToUser(row, user);
}

async function canViewTask(row, user) {
  if (isManager(user)) return true;
  const myId = String(user?.user_id || '');
  if (isTl(user)) {
    const visibleIds = new Set(await getTeamMemberIds(user));
    return visibleIds.has(String(row?.assigned_to_user_id || '')) || visibleIds.has(String(row?.assigned_by_user_id || ''));
  }
  return String(row?.assigned_to_user_id || '') === myId || String(row?.assigned_by_user_id || '') === myId;
}

async function canViewNotification(row, user) {
  if (isManager(user)) return true;
  const myId = String(user?.user_id || '');
  if (String(row?.user_id || '') === myId) return true;
  if (!isTl(user)) return false;
  const visibleIds = new Set(await getTeamMemberIds(user));
  return visibleIds.has(String(row?.user_id || ''));
}

async function visibleUsersForAssignments(user) {
  const users = await table('users');
  if (isManager(user)) return users;
  if (isTl(user)) {
    const visibleIds = new Set(await getTeamMemberIds(user));
    return users.filter((row) => visibleIds.has(String(row.user_id || '')));
  }
  return users.filter((row) => String(row.user_id || '') === String(user?.user_id || ''));
}

module.exports = {
  lower,
  isManager,
  isTl,
  isLeadership,
  getTeamMemberIds,
  rowBelongsToUser,
  canViewCandidate,
  canViewTask,
  canViewNotification,
  visibleUsersForAssignments,
};
