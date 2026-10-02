function lower(value) { return String(value || '').trim().toLowerCase(); }
function canonicalRole(value) {
  const raw = lower(value);
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter') || raw.includes('intern')) return 'recruiter';
  return raw;
}

const BASIC = ['candidates', 'submissions', 'interviews', 'followups', 'tasks', 'live-dialing', 'goal-post'];
const roleFeatureMap = {
  admin: new Set([...BASIC, 'approvals', 'recent-activity', 'admin-control']),
  manager: new Set([...BASIC, 'approvals', 'recent-activity', 'admin-control']),
  tl: new Set([...BASIC, 'approvals']),
  recruiter: new Set(BASIC),
};

const pathFeatureMap = {
  '/candidates': 'candidates', '/candidate': 'candidates', '/submissions': 'submissions',
  '/interviews': 'interviews', '/followups': 'followups', '/tasks': 'tasks',
  '/live-dialing': 'live-dialing', '/auto-dialer': 'live-dialing', '/goal-post': 'goal-post',
  '/approvals': 'approvals', '/recent-activity': 'recent-activity', '/admin': 'admin-control',
};

export function normalizeRole(value) { return canonicalRole(value); }
export function resolveUserRole(user) {
  if (!user || typeof user !== 'object') return normalizeRole(user);
  return normalizeRole(user.role || user.designation || user.user_role || user.access_role || user.type || '');
}
export function canAccessFeature(role, featureKey) {
  const allowed = roleFeatureMap[normalizeRole(role)];
  return Boolean(allowed && allowed.has(String(featureKey || '').trim()));
}
export function featureForPath(pathname) {
  const path = String(pathname || '').trim();
  if (!path) return '';
  const exact = pathFeatureMap[path];
  if (exact) return exact;
  const matched = Object.keys(pathFeatureMap).filter((key) => path.startsWith(key + '/')).sort((a, b) => b.length - a.length)[0];
  return matched ? pathFeatureMap[matched] : '';
}
export function canAccessPath(role, pathname) {
  const feature = featureForPath(pathname);
  return !feature || canAccessFeature(role, feature);
}
