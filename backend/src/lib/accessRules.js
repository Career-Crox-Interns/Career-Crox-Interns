const { recruiterCodeMatches } = require('./helpers');
const bucketPolicy = require('./bucketPolicy');

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

// Explicit current ownership wins over historical creator/submission identities.
const OWNER_FIELDS = [
  ['id',['recruiter_user_id','assigned_to_user_id','owner_user_id']],
  ['code',['recruiter_code','assigned_to_code','owner_code']],
  ['name',['recruiter_name','assigned_to_name','owner_name']],
  ['code',['employee_no','employee_code','submitted_by_recruiter_code']],
  ['id',['user_id','submitted_by_user_id','created_by_user_id']],
  ['name',['employee_name','submitted_by','submitted_by_name','created_by_name']],
];
function currentOwner(row={}) {
  for (const [kind,fields] of OWNER_FIELDS) for (const field of fields) {
    const value=String(row[field]||'').trim();if(value)return {kind,value};
  }
  return null;
}
function ownerMatches(owner,user={}) {
  if(!owner)return false;
  if(owner.kind==='code')return recruiterCodeMatches(owner.value,user.recruiter_code);
  if(owner.kind==='id')return Boolean(user.user_id&&owner.value===String(user.user_id).trim());
  return valueMatchesAnyName(owner.value,user);
}
function candidateBelongsToUser(row={},user={}) { return ownerMatches(currentOwner(row),user); }

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
function identityMatches(owner,scope={}) {
  if(!owner)return false;
  if(owner.kind==='id')return (scope.ids||[]).map(String).includes(owner.value);
  if(owner.kind==='code')return (scope.codes||[]).some(code=>recruiterCodeMatches(owner.value,code));
  return (scope.names||[]).map(lower).includes(lower(owner.value));
}
function sharedCandidateVisible(row={},user={}) {
  const project=String(row.project_id||'').trim(),owner=currentOwner(row);
  if(project)return (user.__ccSharedScopes||[]).some(scope=>scope.project_id===project&&identityMatches(owner,scope));
  return identityMatches(owner,user.__ccSoloPeers||{});
}
function candidateBelongsToTeam(row={},user={}) {
  if(candidateBelongsToUser(row,user))return true;
  if(String(row.project_id||'').trim())return sharedCandidateVisible(row,user);
  if(userRole(user)!=='tl')return sharedCandidateVisible(row,user);
  return identityMatches(currentOwner(row),{ids:user.__ccTeamUserIds,codes:user.__ccTeamCodes,names:user.__ccTeamNames});
}

function visibleCandidateForUser(row = {}, user = {}) {
  if (isDeletedCandidate(row)) return false;
  const role = userRole(user);
  if (role === 'admin' || role === 'manager') return true;
  if (role !== 'tl' && bucketPolicy.meta(row).bucketOut) return false;
  return Boolean(candidateBelongsToTeam(row, user));
}

function candidateNotDeletedSql(alias = 'c') {
  const p = alias ? `${alias}.` : '';
  return `coalesce(${p}deleted_at, '') = ''
    and lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}all_details_sent, '')) not in ('deleted', 'archived')
    and lower(coalesce(${p}data_notes, '')) not like '%[crm-deleted]%'`;
}

function candidateOwnerSql(alias='c',user={},params=[],extraAliases=[]) {
 if(isAdminOrManager(user))return {sql:'true',params};
 const aliases=[alias||'candidates',...extraAliases];
 if(aliases.some(a=>!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(a)))throw Error('Invalid scope alias');
 const predicate=scope=>{
  params.push([...new Set((scope.ids||[]).map(String).filter(Boolean))]);const ir=`$${params.length}`;
  params.push([...new Set((scope.codes||[]).map(lower).filter(Boolean))]);const cr=`$${params.length}`;
  params.push([...new Set((scope.names||[]).map(lower).filter(Boolean))]);const nr=`$${params.length}`;
  const checks=aliases.map(a=>{const legacy=`case ${OWNER_FIELDS.map(([kind,fields])=>{
   const value=`coalesce(${fields.map(f=>`nullif(trim(to_jsonb(${a})->>'${f}'), '')`).join(',')})`;
   const condition=kind==='id'?`${value}=any(${ir}::text[])`:kind==='name'?`lower(${value})=any(${nr}::text[])`:`exists(select 1 from regexp_split_to_table(${value},',') code where lower(trim(code))=any(${cr}::text[]))`;
   return `when ${value} is not null then ${condition}`;
  }).join(' ')} else null end`;
   // Indexed canonical owner path. Only legacy blank owners require JSON projection.
   if(['c','candidates','cc_scope','cc_activity'].includes(a)){const current=`coalesce(nullif(btrim(${a}.recruiter_user_id),''),'')`;return `(${current}=any(${ir}::text[]) or (${current}='' and (${legacy})))`;}
   return legacy;
  });
  return `coalesce(${checks.join(',')},false)`;
 };
 const own={ids:[user.user_id],codes:[user.recruiter_code],names:[user.full_name,user.username]};
 const tl=userRole(user)==='tl',peers=user.__ccSoloPeers||{};
 const solo={ids:[...own.ids,...(tl?user.__ccTeamUserIds||[]:peers.ids||[])],codes:[...own.codes,...(tl?user.__ccTeamCodes||[]:peers.codes||[])],names:[...own.names,...(tl?user.__ccTeamNames||[]:peers.names||[])]};
 const project=['c','candidates','cc_scope','cc_activity'].includes(aliases[0])?`coalesce(nullif(btrim(${aliases[0]}.project_id),''),'')`:`coalesce(nullif(trim(to_jsonb(${aliases[0]})->>'project_id'),''),'')`;
 const clauses=[predicate(own),`(${project}='' and ${predicate(solo)})`];
 for(const scope of user.__ccSharedScopes||[]){params.push(scope.project_id);const ref=`$${params.length}`;clauses.push(`(${project}=${ref} and ${predicate(scope)})`);}
 return {sql:`(${clauses.join(' or ')})`,params};
}

function candidateScopeSql(alias = 'c', user = {}, params = [], extraAliases = []) {
  const clauses = [candidateNotDeletedSql(alias)];
  if (!isAdminOrManager(user)) {
    const owner = candidateOwnerSql(alias, user, params, extraAliases);
    clauses.push(owner.sql);
    params = owner.params;
    if (userRole(user) !== 'tl') clauses.push(`not (${bucketPolicy.expiredSql(alias)})`);
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
  const group=kind=>ownerFields.filter(field=>kind==='id'?field.includes('user_id'):kind==='code'?field.includes('code'):!field.includes('user_id')&&!field.includes('code'));
  const tiers=[];
  for(const kind of ['id','code','name']){
    const fields=group(kind);if(!fields.length)continue;
    const value=`coalesce(${fields.map(field=>`nullif(trim(${p}${field}), '')`).join(',')})`;
    const match=kind==='id'?`${value}=any(${idsRef}::text[])`:kind==='code'?`lower(${value})=any(${codesRef}::text[])`:`lower(${value})=any(${namesRef}::text[]) or lower(${value})=any(${codesRef}::text[])`;
    tiers.push(`when ${value} is not null then (${match})`);
  }
  const plain=`case ${tiers.join(' ')} else false end`;
  // Candidate-linked tasks/calls follow project ACL; no grant to a peer's unrelated records.
  if(alias&&/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)){
    const linked=candidateOwnerSql('cc_scope',user,params);
    const cid=`coalesce(nullif(to_jsonb(${alias})->>'candidate_id',''),'')`;
    return {sql:`(case when ${cid}<>'' then exists(select 1 from public.candidates cc_scope where cc_scope.candidate_id=${cid} and ${candidateNotDeletedSql('cc_scope')} and ${linked.sql}) else (${plain}) end)`,params};
  }
  return {sql:plain,params};
}

function employeeVisibleForUser(row={},user={}) {
  if(isAdminOrManager(user))return true;
  const tl=userRole(user)==='tl';
  const ids=[user.user_id,...(tl?user.__ccTeamUserIds||[]:[])].map(String).filter(Boolean);
  const names=[user.full_name,user.username,...(tl?user.__ccTeamNames||[]:[])].map(lower).filter(Boolean);
  const usernames=[user.username,...(tl?user.__ccTeamUsernames||[]:[]),...(tl?user.__ccTeamNames||[]:[])].map(lower).filter(Boolean);
  const id=String(row.employee_user_id||row.user_id||'').trim();if(id)return ids.includes(id);
  const username=lower(row.employee_username||row.username);if(username)return usernames.includes(username);
  return names.includes(lower(row.employee_name||row.full_name||row.recruiter_name));
}

function submissionAuthorId(candidate={},submission={}) {
  return String(submission.submitted_by_user_id||candidate.created_by_user_id||candidate.recruiter_user_id||candidate.user_id||'').trim();
}
function canReviewSubmission(user={},candidate={},submission={},users=[]) {
  if(isAdminOrManager(user))return true;
  if(userRole(user)!=='tl'||!visibleCandidateForUser(candidate,user))return false;
  const id=submissionAuthorId(candidate,submission);
  if(id&&id===String(user.user_id||''))return false;
  const author=users.find(u=>String(u.user_id||'')===id);
  const role=author?userRole(author):canonicalRole(candidate.recruiter_designation);
  return role!=='tl';
}
function submissionReviewScopeSql(candidateAlias='c',submissionAlias='s',user={},params=[]) {
  if(isAdminOrManager(user))return {sql:'true',params};
  if(userRole(user)!=='tl')return {sql:'false',params};
  params.push(String(user.user_id||''));
  const id=`coalesce(nullif(to_jsonb(${submissionAlias})->>'submitted_by_user_id',''),nullif(to_jsonb(${candidateAlias})->>'created_by_user_id',''),nullif(to_jsonb(${candidateAlias})->>'recruiter_user_id',''),nullif(to_jsonb(${candidateAlias})->>'user_id',''),'')`;
  const role=`lower(coalesce(nullif((select coalesce(nullif(u.role,''),u.designation) from public.users u where u.user_id=${id} limit 1),''),to_jsonb(${candidateAlias})->>'recruiter_designation',''))`;
  return {sql:`(${id} <> $${params.length} and ${role} not in ('tl','teamlead','team leader','team lead','team_lead'))`,params};
}

module.exports = {
  canReviewSubmission,
  submissionReviewScopeSql,
  lower,
  canonicalRole,
  userRole,
  isLeadership,
  isAdminOrManager,
  candidateBelongsToUser,
  candidateBelongsToTeam,
  visibleCandidateForUser,
  sharedCandidateVisible,
  isDeletedCandidate,
  candidateNotDeletedSql,
  candidateOwnerSql,
  candidateScopeSql,
  simpleOwnerSql,
  employeeVisibleForUser,
};
