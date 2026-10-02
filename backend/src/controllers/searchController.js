const { store, table } = require('../lib/store');
const { containsText, normalizeIndianPhone, recruiterCodeMatches } = require('../lib/helpers');
const { userRole, candidateBelongsToUser, candidateBelongsToTeam, candidateScopeSql, simpleOwnerSql } = require('../lib/accessRules');
const { sanitizeCandidateListForUser } = require('../lib/dataLeakGuard');

const SEARCH_CANDIDATE_FIELDS = 'candidate_id, full_name, phone, process, location, recruiter_code, recruiter_name, submitted_by, employee_name, status, bucket_assigned_at, preferred_location, qualification, qualification_level, communication_skill, updated_at, created_at';
const SEARCH_CANDIDATE_LIMIT = Math.max(20, Math.min(100, Number(process.env.CRM_SEARCH_CANDIDATE_LIMIT || 50))); 
const SEARCH_TASK_FIELDS = 'task_id, title, description, assigned_to_name, status, updated_at, created_at';
const SEARCH_JD_FIELDS = 'jd_id, job_title, company, location, updated_at, created_at';


function inferOwnerRole(row) {
  const designation = String(row?.recruiter_designation || row?.role || '').trim().toLowerCase();
  if (designation.includes('admin')) return 'admin';
  if (designation === 'tl' || designation.includes('team lead') || designation.includes('teamlead')) return 'tl';
  if (designation.includes('manager')) return 'manager';
  if (designation.includes('recruit')) return 'recruiter';
  const code = String(row?.recruiter_code || '').trim().toUpperCase();
  if (code.startsWith('ADM')) return 'admin';
  if (code.startsWith('MGR')) return 'manager';
  if (code.startsWith('TL')) return 'tl';
  if (code.startsWith('CC') || code.startsWith('REC')) return 'recruiter';
  return '';
}
function isUnallocated(row) {
  return !String(row?.recruiter_code || '').trim() && !String(row?.recruiter_name || '').trim();
}
function visibleCandidate(row, user) {
  const status = String(row?.status || '').trim().toLowerCase();
  const approval = String(row?.approval_status || '').trim().toLowerCase();
  const details = String(row?.all_details_sent || '').trim().toLowerCase();
  const notes = String(row?.data_notes || '').trim().toLowerCase();
  if (String(row?.deleted_at || '').trim() || status === 'deleted' || status === '__deleted__' || status === 'archived' || approval === 'deleted' || approval === '__deleted__' || approval === 'archived' || details === 'deleted' || details === 'archived' || notes.includes('[crm-deleted]')) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager') return true;
  if (role === 'tl') return candidateBelongsToTeam(row, user);
  return candidateBelongsToUser(row, user);
}

function orderByRecentDesc(items = [], idKey) {
  return [...items].sort((a, b) => String(b?.updated_at || b?.created_at || '').localeCompare(String(a?.updated_at || a?.created_at || '')) || String(b?.[idKey] || '').localeCompare(String(a?.[idKey] || '')));
}

async function search(req, res) {
  const rawQ = String(req.query.q || '').trim();
  const q = rawQ.toLowerCase();
  const compactQ = rawQ.replace(/\s+/g, '').toLowerCase();
  const phoneQ = normalizeIndianPhone(rawQ);
  const looksLikeCandidateId = /^[a-z]{0,4}\d+$/i.test(compactQ);
  const looksLikeStrictPhone = phoneQ.length >= 7;
  const strictCandidateLookup = looksLikeCandidateId || looksLikeStrictPhone;
  if (!q) return res.json({ candidates: [], tasks: [], jds: [], search_mode: 'general' });

  if (store.pool) {
    const like = `%${rawQ}%`;
    const exactCandidates = strictCandidateLookup
      ? await store.query(
        `select ${SEARCH_CANDIDATE_FIELDS} from public.candidates
         where ($1 <> '' and lower(regexp_replace(coalesce(candidate_id, ''), '\\s+', '', 'g')) = $1)
            or ($2 <> '' and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $2)
         order by coalesce(updated_at, created_at, '') desc, candidate_id desc
         limit 100`,
        [looksLikeCandidateId ? compactQ : '', looksLikeStrictPhone ? phoneQ : ''],
      )
      : [];

    if (strictCandidateLookup) {
      const visibleExact = sanitizeCandidateListForUser(exactCandidates.filter((row) => visibleCandidate(row, req.user)), req.user);
      return res.json({ candidates: visibleExact, tasks: [], jds: [], search_mode: 'candidate_exact' });
    }

    const candidateParams = [like];
    const candidateScope = candidateScopeSql('c', req.user, candidateParams);
    const taskParams = [like];
    const taskScope = simpleOwnerSql('t', ['assigned_to_user_id','assigned_to_code','assigned_to_name'], req.user, taskParams);
    const [candidates, tasks, jds] = await Promise.all([
      store.query(
        `select ${SEARCH_CANDIDATE_FIELDS.split(', ').map((f) => `c.${f}`).join(', ')} from public.candidates c
         where (${candidateScope.sql}) and (coalesce(c.candidate_id, '') ilike $1
            or coalesce(c.full_name, '') ilike $1
            or coalesce(c.phone, '') ilike $1
            or coalesce(c.process, '') ilike $1
            or coalesce(c.recruiter_code, '') ilike $1
            or coalesce(c.recruiter_name, '') ilike $1
            or coalesce(c.location, '') ilike $1
            or coalesce(c.preferred_location, '') ilike $1
            or coalesce(c.qualification, '') ilike $1
            or coalesce(c.qualification_level, '') ilike $1
            or coalesce(c.communication_skill, '') ilike $1)
         order by coalesce(c.updated_at, c.created_at, '') desc, c.candidate_id desc
         limit ${SEARCH_CANDIDATE_LIMIT}`,
        candidateScope.params,
      ),
      store.query(
        `select ${SEARCH_TASK_FIELDS.split(', ').map((f) => `t.${f}`).join(', ')} from public.tasks t
         where (${taskScope.sql}) and (coalesce(t.task_id, '') ilike $1
            or coalesce(t.title, '') ilike $1
            or coalesce(t.description, '') ilike $1
            or coalesce(t.assigned_to_name, '') ilike $1)
         order by coalesce(t.updated_at, t.created_at, '') desc, t.task_id desc
         limit 20`,
        taskScope.params,
      ),
      store.query(
        `select ${SEARCH_JD_FIELDS} from public.jd_master
         where coalesce(jd_id, '') ilike $1
            or coalesce(job_title, '') ilike $1
            or coalesce(company, '') ilike $1
            or coalesce(location, '') ilike $1
         order by coalesce(updated_at, created_at, '') desc, jd_id desc
         limit 20`,
        [like],
      ),
    ]);
    return res.json({ candidates: sanitizeCandidateListForUser(candidates.filter((row) => visibleCandidate(row, req.user)), req.user), tasks, jds, search_mode: 'general' });
  }

  const allCandidates = await table('candidates');
  const exactCandidates = strictCandidateLookup
    ? orderByRecentDesc(
      allCandidates.filter((row) => {
        const candidateId = String(row.candidate_id || '').replace(/\s+/g, '').toLowerCase();
        const rowPhone = normalizeIndianPhone(row.phone || '');
        return (looksLikeCandidateId && candidateId === compactQ) || (looksLikeStrictPhone && rowPhone === phoneQ);
      }),
      'candidate_id',
    )
    : [];
  if (strictCandidateLookup) {
    return res.json({ candidates: sanitizeCandidateListForUser(exactCandidates.filter((row) => visibleCandidate(row, req.user)), req.user), tasks: [], jds: [], search_mode: 'candidate_exact' });
  }

  const candidates = orderByRecentDesc(
    allCandidates.filter((row) => ['candidate_id', 'full_name', 'phone', 'process', 'recruiter_code', 'recruiter_name', 'location', 'preferred_location', 'qualification', 'qualification_level', 'communication_skill'].some((key) => containsText(row[key], rawQ))),
    'candidate_id',
  ).slice(0, SEARCH_CANDIDATE_LIMIT);
  const tasks = orderByRecentDesc((await table('tasks'))
    .filter((row) => ['task_id', 'title', 'description', 'assigned_to_name'].some((key) => containsText(row[key], rawQ))), 'task_id')
    .slice(0, 20);
  const jds = orderByRecentDesc((await table('jd_master'))
    .filter((row) => ['jd_id', 'job_title', 'company', 'location'].some((key) => containsText(row[key], rawQ))), 'jd_id')
    .slice(0, 20);
  return res.json({ candidates: sanitizeCandidateListForUser(candidates.filter((row) => visibleCandidate(row, req.user)), req.user), tasks, jds, search_mode: 'general' });
}

module.exports = {
  search,
};
