function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalRole(value) {
  const raw = lower(value);
  if (!raw) return '';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'manager' || raw.includes('manager')) return 'manager';
  if (raw === 'recruiter' || raw === 'rec' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

const roleFeatureMap = {
  admin: new Set(['candidates','hot-leads','submissions','interviews','followups','tasks','bucket','client-pipeline','data-extractor','quality-analyst','hr-head','revenue-hub','performance-centre','recent-activity','bda','duplicate-profiles','attendance','reports','mail-centre','jd-centre','learning-hub','admin-control','approvals','notifications','chat','search','quick-add','aaria','daily-interview-workflow','goal-post','timing-insights','disabled-slices','live-dialing']),
  manager: new Set(['candidates','hot-leads','submissions','interviews','followups','tasks','bucket','client-pipeline','data-extractor','quality-analyst','hr-head','revenue-hub','performance-centre','recent-activity','bda','duplicate-profiles','attendance','reports','mail-centre','jd-centre','learning-hub','admin-control','approvals','notifications','chat','search','quick-add','aaria','daily-interview-workflow','goal-post','timing-insights','disabled-slices','live-dialing']),
  tl: new Set(['candidates','hot-leads','submissions','interviews','followups','tasks','attendance','reports','jd-centre','learning-hub','performance-centre','recent-activity','revenue-hub','approvals','notifications','chat','search','quick-add','aaria','daily-interview-workflow','goal-post','timing-insights','live-dialing']),
  recruiter: new Set(['candidates','hot-leads','submissions','interviews','followups','tasks','jd-centre','approvals','notifications','chat','search','quick-add','aaria','daily-interview-workflow','goal-post','live-dialing']),
};

const pathFeatureMap = {
  '/candidates': 'candidates',
  '/hot-leads': 'hot-leads',
  '/candidate': 'candidates',
  '/submissions': 'submissions',
  '/interviews': 'interviews',
  '/followups': 'followups',
  '/tasks': 'tasks',
  '/live-dialing': 'live-dialing',
  '/bucket-out': 'bucket',
  '/client-pipeline': 'client-pipeline',
  '/data-extractor': 'data-extractor',
  '/quality-analyst': 'quality-analyst',
  '/hr-head': 'hr-head',
  '/revenue-hub': 'revenue-hub',
  '/performance-centre': 'performance-centre',
  '/recent-activity': 'recent-activity',
  '/bda': 'bda',
  '/bda-head': 'bda',
  '/duplicate-profiles': 'duplicate-profiles',
  '/attendance': 'attendance',
  '/reports': 'reports',
  '/mail-centre': 'mail-centre',
  '/jds': 'jd-centre',
  '/learning-hub': 'learning-hub',
  '/admin': 'admin-control',
  '/approvals': 'approvals',
  '/notifications': 'notifications',
  '/chat': 'chat',
  '/search': 'search',
  '/quick-add': 'quick-add',
  '/aaria': 'aaria',
  '/daily-interview-workflow': 'daily-interview-workflow',
  '/goal-post': 'goal-post',
  '/prime-time-insights': 'timing-insights',
  '/disabled-slices': 'disabled-slices',
};

export function normalizeRole(value) {
  return canonicalRole(value);
}

export function resolveUserRole(user) {
  if (!user || typeof user !== 'object') return normalizeRole(user);
  return normalizeRole(user.role || user.designation || user.user_role || user.access_role || user.type || '');
}

export function canAccessFeature(role, featureKey) {
  const normalizedRole = normalizeRole(role);
  const feature = String(featureKey || '').trim();
  if (!feature) return true;
  if (normalizedRole === 'admin' || normalizedRole === 'manager') return true;
  const allowed = roleFeatureMap[normalizedRole];
  if (!allowed) return false;
  return allowed.has(feature);
}

export function featureForPath(pathname) {
  const path = String(pathname || '').trim();
  if (!path) return '';
  const exact = pathFeatureMap[path];
  if (exact) return exact;
  const matched = Object.keys(pathFeatureMap)
    .filter((key) => key !== '/' && path.startsWith(key + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return matched ? pathFeatureMap[matched] : '';
}

export function canAccessPath(role, pathname) {
  const feature = featureForPath(pathname);
  if (!feature) return true;
  return canAccessFeature(role, feature);
}
