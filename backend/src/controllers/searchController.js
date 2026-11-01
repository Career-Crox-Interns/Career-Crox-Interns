const { store, table } = require('../lib/store');
const { containsText, normalizeIndianPhone, recruiterCodeMatches } = require('../lib/helpers');
const { userRole, candidateBelongsToUser, candidateBelongsToTeam, candidateScopeSql, simpleOwnerSql, visibleCandidateForUser } = require('../lib/accessRules');
const { sanitizeCandidateListForUser } = require('../lib/dataLeakGuard');

const SEARCH_CANDIDATE_FIELDS = 'candidate_id, full_name, phone, email, process, location, recruiter_code, recruiter_name, submitted_by, employee_name, status, bucket_assigned_at, preferred_location, qualification, qualification_level, communication_skill, recruiter_user_id, recruiter_designation, project_id, deleted_at, approval_status, all_details_sent, data_notes, updated_at, created_at';
const SEARCH_CANDIDATE_LIMIT = Math.max(20, Math.min(100, Number(process.env.CRM_SEARCH_CANDIDATE_LIMIT || 50))); 
const SEARCH_TASK_FIELDS = 'task_id, title, description, assigned_to_name, status, updated_at, created_at';
const SEARCH_JD_FIELDS = 'jd_id, job_title, company, location, updated_at, created_at';


function searchProjection(alias=''){const prefix=alias?alias+'.':'';return SEARCH_CANDIDATE_FIELDS.split(', ').map(field=>field==='data_notes'?`case when lower(coalesce(${prefix}data_notes,'')) like '%[crm-deleted]%' then '[crm-deleted]' else '' end as data_notes`:prefix+field).join(', ');}

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
  return visibleCandidateForUser(row,user);
}

function orderByRecentDesc(items = [], idKey) {
  return [...items].sort((a, b) => String(b?.updated_at || b?.created_at || '').localeCompare(String(a?.updated_at || a?.created_at || '')) || String(b?.[idKey] || '').localeCompare(String(a?.[idKey] || '')));
}

// CC931: all CRM header/full-page searches return authorized candidates only.
// Matching owner names, task assignees and job titles is never a candidate match.
function searchKind(raw) {
 if(raw.includes('@'))return 'email';
 if(/^[+\d\s().-]+$/.test(raw)&&raw.replace(/\D/g,'').length>=2)return 'phone';
 if(/^[a-z]{1,4}[\s-]*\d+$/i.test(raw))return 'id';
 return 'name';
}
function matchesCandidate(row,raw,kind) {
 const q=raw.normalize('NFKC').toLocaleLowerCase();
 if(kind==='email')return String(row.email||'').normalize('NFKC').toLocaleLowerCase().includes(q);
 if(kind==='phone'){let digits=q.replace(/\D/g,'');if(digits.length===12&&digits.startsWith('91'))digits=digits.slice(2);return String(row.phone||'').replace(/\D/g,'').includes(digits);}
 if(kind==='id')return String(row.candidate_id||'').replace(/\s/g,'').toLocaleLowerCase()===q.replace(/\s/g,'');
 return String(row.full_name||'').normalize('NFKC').toLocaleLowerCase().includes(q);
}
async function search(req, res) {
 const raw=String(req.query.q||'').normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,120),kind=searchKind(raw);
 const empty={candidates:[],tasks:[],jds:[],search_mode:'candidate_'+kind,query:raw};
 if(!raw)return res.json(empty);
 const limit=raw.length===1?30:SEARCH_CANDIDATE_LIMIT,offset=Math.min(100000,Math.max(0,Math.floor(Number(req.query.offset)||0)));
 let rows;
 if(store.pool){
  const escaped=raw.replace(/[\\%_]/g,v=>'\\'+v),params=['%'+escaped+'%'];
  const scope=candidateScopeSql('c',req.user,params);
  let match;
  if(kind==='email')match="coalesce(c.email,'') ilike $1";
  else if(kind==='phone'){let digits=raw.replace(/\D/g,'');if(digits.length===12&&digits.startsWith('91'))digits=digits.slice(2);params[0]='%'+digits+'%';match="regexp_replace(coalesce(c.phone,''),'\\D','','g') like $1";}
  else if(kind==='id'){params[0]=raw.replace(/\s/g,'').toLowerCase();match="lower(regexp_replace(coalesce(c.candidate_id,''),'\\s','','g'))=$1";}
  else match="coalesce(c.full_name,'') ilike $1";
  params.push(raw);const rank='$'+params.length;
  rows=await store.query(`select ${searchProjection('c')} from public.candidates c where (${scope.sql}) and (${match})
    and coalesce(c.deleted_at,'')='' and lower(coalesce(c.status,'')) not in ('deleted','__deleted__','archived')
    and lower(coalesce(c.approval_status,'')) not in ('deleted','__deleted__','archived')
    and lower(coalesce(c.all_details_sent,'')) not in ('deleted','archived') and lower(coalesce(c.data_notes,'')) not like '%[crm-deleted]%'
    order by case when lower(c.full_name)=lower(${rank}::text) then 0 when lower(c.full_name) like lower(${rank}::text)||'%' then 1 else 2 end,
      coalesce(c.updated_at,c.created_at,'') desc,c.candidate_id desc limit ${limit+1} offset ${offset}`,params);
 }else rows=orderByRecentDesc((await table('candidates')).filter(row=>visibleCandidate(row,req.user)&&matchesCandidate(row,raw,kind)),'candidate_id').slice(offset,offset+limit+1);
 const items=rows.filter(row=>visibleCandidate(row,req.user));
 return res.json({...empty,candidates:sanitizeCandidateListForUser(items.slice(0,limit),req.user),has_more:items.length>limit,next_offset:offset+Math.min(items.length,limit)});
}

module.exports = {
  search,
};
