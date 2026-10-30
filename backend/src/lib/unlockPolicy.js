function canonicalRole(user = {}) {
  const raw = String(user?.role || user?.designation || user?.user_role || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw === 'team lead' || raw === 'teamlead' || raw === 'team leader' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function isLockExempt(user = {}) {
  return ['admin', 'manager'].includes(canonicalRole(user));
}

function requiresApprovalLock(user = {}) {
  return !isLockExempt(user);
}

function sameUser(a = {}, b = {}) {
  const aid = String(a?.user_id || a?.id || '').trim();
  const bid = String(b?.user_id || b?.id || '').trim();
  if (aid && bid && aid === bid) return true;
  const au = String(a?.username || '').trim().toLowerCase();
  const bu = String(b?.username || '').trim().toLowerCase();
  return Boolean(au && bu && au === bu);
}

function canApproveUnlock(approver = {}, target = {}) {
  if (sameUser(approver,target))return canonicalRole(approver)==='tl'&&canonicalRole(target)==='tl';
  const approverRole = canonicalRole(approver);
  const targetRole = canonicalRole(target);
  if (['admin', 'manager'].includes(targetRole)) return false;
  if (approverRole === 'admin' || approverRole === 'manager') return true;
  if(approverRole==='tl')return targetRole==='recruiter'&&(String(target.tl_user_id||'')===String(approver.user_id||'')||String(target.tl_code||'')&&String(target.tl_code).toLowerCase()===String(approver.recruiter_code||'').toLowerCase()||(approver.__ccTeamUserIds||[]).map(String).includes(String(target.user_id||'')));
  return false;
}

function eligibleApprovers(users = [], target = {}) {
  return (users||[]).filter(user=>!sameUser(user,target)&&canApproveUnlock(user,target));
}

module.exports = { canonicalRole, isLockExempt, requiresApprovalLock, canApproveUnlock, eligibleApprovers, sameUser };
