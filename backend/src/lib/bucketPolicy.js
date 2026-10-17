const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE = 70;
const TOTAL_DAYS = 7;
const WARNING_DAYS = 5;
const TERMINAL = new Set(['closed','joined','hired','rejected','not interested','not intrested','not_interested','completed','done']);
const lower = value => String(value || '').trim().toLowerCase();
function ownerRole(row = {}) {
  const role = lower(row.recruiter_designation || row.role);
  if (role.includes('admin')) return 'admin';
  if (role === 'tl' || role.includes('team lead') || role.includes('teamlead')) return 'tl';
  if (role.includes('manager')) return 'manager';
  if (role.includes('recruit')) return 'recruiter';
  const code = lower(row.recruiter_code);
  if (code.startsWith('adm')) return 'admin';
  if (code.startsWith('mgr')) return 'manager';
  if (code.startsWith('tl')) return 'tl';
  return '';
}
function ownerKey(row = {}) {
  if (lower(row.recruiter_user_id)) return `id:${lower(row.recruiter_user_id)}`;
  if (lower(row.recruiter_code)) return `code:${lower(row.recruiter_code)}`;
  if (lower(row.recruiter_name)) return `name:${lower(row.recruiter_name)}`;
  return '';
}
function ownerKeys(row={}){const codes=lower(row.recruiter_code).split(',').map(x=>x.trim()).filter(Boolean);return codes.length?codes.map(code=>'code:'+code):[ownerKey(row)].filter(Boolean)}
function hasAllocatedOwner(row = {}) { return Boolean(ownerKey(row)) && !['admin','manager'].includes(ownerRole(row)); }
function isAssigned(row = {}) { return lower(row.bucket_state) !== 'fresh' && hasAllocatedOwner(row); }
function isUnworked(row={}) { return !isAssigned(row) && !String(row.last_dialed_at||'').trim() && !String(row.follow_up_at||'').trim() && !String(row.approval_requested_at||row.submission_id||'').trim() && !['pending','approved','rejected'].includes(lower(row.approval_status)) && !['completed','complete','yes','done'].includes(lower(row.all_details_sent)); }
function isTerminal(row = {}) { return TERMINAL.has(lower(row.status)); }
function isDeleted(row = {}) {
  const removed = new Set(['deleted','__deleted__','archived']);
  return Boolean(String(row.deleted_at || '').trim()) || removed.has(lower(row.status)) || removed.has(lower(row.approval_status)) || removed.has(lower(row.all_details_sent)) || lower(row.data_notes).includes('[crm-deleted]');
}
function assignedRaw(row = {}) {
  return [row.bucket_assigned_at,row.allocated_at,row.assigned_on,row.created_at,row.submission_date,row.updated_at].find(value => String(value || '').trim()) || '';
}
function instantMs(value) {
  let raw = String(value || '').trim();
  if (!raw) return NaN;
  // Legacy wall-clock timestamps are India time; explicit offsets are preserved.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += 'T00:00:00+05:30';
  else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw) && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) raw = raw.replace(' ','T') + '+05:30';
  return Date.parse(raw);
}
function meta(row = {}, now = Date.now()) {
  const assigned = isAssigned(row), terminal = isTerminal(row), raw = assigned ? assignedRaw(row) : '';
  const start = instantMs(raw), valid = Number.isFinite(start), expires = valid ? start + TOTAL_DAYS * DAY_MS : NaN;
  const expired = assigned && !terminal && valid && now >= expires;
  const active = assigned && !terminal && !isDeleted(row) && !expired;
  const left = assigned && valid ? Math.max(0,Math.ceil((expires-now)/DAY_MS)) : '';
  const followup = !terminal && Boolean(String(row.follow_up_at || '').trim());
  const due = followup && lower(row.follow_up_status) !== 'done' && instantMs(row.follow_up_at) <= now;
  let stage = terminal ? 'closed' : expired ? 'bucket_out' : !assigned ? 'fresh' : !valid ? 'date_unknown' : left <= 1 ? 'last_day' : left <= WARNING_DAYS ? 'warning' : 'safe';
  const labels = {closed:'Closed',bucket_out:'Bucket Out',fresh:'Fresh Profile',date_unknown:'Assignment date needed',last_day:'Last Day',warning:'Warning',safe:'Allocated'};
  const priorities = {closed:'Done',bucket_out:'Expired',fresh:'Unallocated',date_unknown:'Review',last_day:'Urgent',warning:'High',safe:'Normal'};
  return {assignedRaw:raw,assigned,terminal,fresh:isUnworked(row)&&!terminal&&!expired,followup,pendingFollowup:due,bucketOut:expired,active,
    dateInvalid:assigned&&!valid,daysPassed:assigned&&valid?Math.max(0,Math.floor((now-start)/DAY_MS)):0,daysLeft:left,
    expiresAt:assigned&&valid?new Date(expires).toISOString():'',stage,statusLabel:labels[stage],priority:stage==='fresh'&&hasAllocatedOwner(row)?'Not worked':priorities[stage]};
}
function nextRefresh(rows = [], now = Date.now()) {
  const times = rows.map(row => meta(row,now)).filter(m=>m.active&&!m.dateInvalid).map(m=>Date.parse(m.expiresAt)).filter(ms=>ms>now);
  return times.length ? new Date(Math.min(...times)).toISOString() : '';
}
function readCache(cache,key) {
  const value=cache.get(key);
  if(value?.bucket_refresh_at && instantMs(value.bucket_refresh_at)<=Date.now())return null;
  if(Array.isArray(value) && value.some(row=>!row.bucket_is_bucket_out && meta(row).bucketOut))return null;
  return value;
}
function expiredSql(alias='c') {
  if(alias&&!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))throw new Error('Invalid bucket scope alias');
  return `public.crm_bucket_expired(to_jsonb(${alias || 'candidates'}), statement_timestamp())`;
}
module.exports={DAY_MS,MAX_ACTIVE,TOTAL_DAYS,WARNING_DAYS,ownerRole,ownerKey,ownerKeys,hasAllocatedOwner,isUnworked,isAssigned,isTerminal,isDeleted,assignedRaw,instantMs,meta,nextRefresh,readCache,expiredSql};

function factsSql(whereSql='',ownSql='false') {
  return `with bucket_source as (
    select candidates.*,to_jsonb(candidates) as j, (${ownSql}) as cc_own
    from public.candidates ${whereSql}
  ), bucket_values as (
    select *, lower(coalesce(j->>'status',''))=any(array['closed','joined','hired','rejected','not interested','not intrested','not_interested','completed','done']) as cc_terminal,
      coalesce(nullif(trim(j->>'recruiter_user_id'),''),nullif(trim(j->>'recruiter_code'),''),nullif(trim(j->>'recruiter_name'),'')) is not null and public.crm_bucket_owner_role(j) not in ('admin','manager') as cc_owned,
      coalesce(trim(j->>'last_dialed_at'),'')='' and coalesce(trim(j->>'follow_up_at'),'')='' and coalesce(nullif(trim(j->>'approval_requested_at'),''),nullif(trim(j->>'submission_id'),''),'')='' and lower(coalesce(j->>'approval_status','')) not in ('pending','approved','rejected') and lower(coalesce(j->>'all_details_sent','')) not in ('completed','complete','yes','done') as cc_unworked,
      lower(coalesce(j->>'bucket_state',''))<>'fresh'
      and coalesce(nullif(trim(j->>'recruiter_user_id'),''),nullif(trim(j->>'recruiter_code'),''),nullif(trim(j->>'recruiter_name'),'')) is not null
      and public.crm_bucket_owner_role(j) not in ('admin','manager') as cc_assigned,
      public.crm_safe_instant(coalesce(nullif(trim(j->>'bucket_assigned_at'),''),nullif(trim(j->>'allocated_at'),''),nullif(trim(j->>'assigned_on'),''),nullif(trim(j->>'created_at'),''),nullif(trim(j->>'submission_date'),''),nullif(trim(j->>'updated_at'),''))) as cc_start,
      coalesce(trim(j->>'follow_up_at'),'')<>'' as cc_has_followup,
      public.crm_safe_instant(j->>'follow_up_at') as cc_due_at
    from bucket_source
  ), bucket_states as (
    select *, cc_assigned and not cc_terminal and cc_start is not null and statement_timestamp()>=cc_start+interval '7 days' as cc_expired,
      not cc_assigned and cc_unworked and not cc_terminal and not (cc_assigned and cc_start is not null and statement_timestamp()>=cc_start+interval '7 days') as cc_fresh,
      not cc_terminal and cc_has_followup as cc_followup,
      not cc_terminal and cc_has_followup and lower(coalesce(j->>'follow_up_status',''))<>'done' and cc_due_at<=statement_timestamp() as cc_due,
      case when cc_assigned and cc_start is not null then greatest(0,ceil(extract(epoch from (cc_start+interval '7 days'-statement_timestamp()))/86400)) else null end as cc_left
    from bucket_values
  ), bucket_facts as (
    select *,cc_assigned and not cc_terminal and not cc_expired as cc_active,
      case when cc_terminal then 'closed' when cc_expired then 'bucket_out' when not cc_assigned then 'fresh' when cc_start is null then 'date_unknown' when cc_left<=1 then 'last_day' when cc_left<=5 then 'warning' else 'safe' end as cc_stage
    from bucket_states
  ) `;
}
function viewSql(view='all') {
  return ({my_fresh:'cc_own and cc_fresh and not cc_expired',my_working:'cc_own and cc_active and not cc_fresh and not coalesce(cc_due,false) and not cc_expired and not cc_terminal',fresh:'cc_fresh and not cc_expired',followup:'cc_active and cc_followup and not cc_expired',followup_due:'cc_active and coalesce(cc_due,false) and not cc_expired',allocated:'cc_owned and not cc_terminal and not cc_expired',warning:"cc_stage='warning'",last_day:"cc_stage='last_day'",safe:"cc_stage='safe'",days_4_plus:'cc_active and cc_left>=4 and not cc_expired and not cc_terminal and not cc_fresh',days_3:'cc_active and cc_left=3 and not cc_expired',days_2:'cc_active and cc_left=2 and not cc_expired',days_1:'cc_active and cc_left=1 and not cc_expired',unallocated:'not cc_owned',bucket_out:'cc_expired',all_bucket_out_profiles:'cc_expired'})[lower(view)]||'true';
}
function summarySql(){
  const predicates={total_visible:'true',active_bucket:'cc_active',fresh_profiles:'cc_fresh and not cc_expired',followup_profiles:'cc_active and cc_followup',pending_followups:'cc_active and coalesce(cc_due,false) and not cc_expired',allocated_profiles:'cc_owned and not cc_terminal and not cc_expired',unallocated_profiles:'not cc_owned',warning_profiles:"cc_active and cc_assigned and cc_stage='warning'",last_day_profiles:"cc_active and cc_assigned and cc_stage='last_day'",safe_profiles:"cc_active and cc_assigned and cc_stage='safe'",bucket_out_profiles:'cc_expired',all_bucket_out_profiles:'cc_expired',days_1:'cc_active and cc_assigned and cc_left=1',days_2:'cc_active and cc_assigned and cc_left=2',days_3:'cc_active and cc_assigned and cc_left=3',days_4_plus:'cc_active and cc_assigned and cc_left>=4',my_fresh_profiles:viewSql('my_fresh'),my_working_profiles:viewSql('my_working')};
  return 'select '+Object.entries(predicates).map(([key,predicate])=>`count(*) filter(where ${predicate})::int as ${key}`).join(', ')+", min(cc_start+interval '7 days') filter(where cc_active and cc_start is not null and cc_start+interval '7 days'>statement_timestamp()) as bucket_refresh_at from bucket_facts";
}
module.exports.factsSql=factsSql;module.exports.viewSql=viewSql;module.exports.summarySql=summarySql;
