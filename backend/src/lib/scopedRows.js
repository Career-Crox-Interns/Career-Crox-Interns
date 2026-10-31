'use strict';
const {store,table,SNAPSHOT_IDS,activeTransactionClient}=require('./store');
const {candidateScopeSql,simpleOwnerSql,employeeVisibleForUser,visibleCandidateForUser,isAdminOrManager,candidateNotDeletedSql}=require('./accessRules');
const {createTimedCache}=require('./cache');
const rosterCache=createTimedCache(60000,{tags:['staff','access']});
const valid=s=>{if(!/^[a-z_]+$/.test(s))throw Error('Invalid table');return s};
async function scopedRows(name,user,fields=null,window=null){
 valid(name);
 const read=async(from,where='true',params=[])=>{
  params=[...params];
  if(window&&Number.isFinite(window.from)&&Number.isFinite(window.to)){
   const json=field=>"nullif(to_jsonb(r)->>'"+field+"','')",coalesce=fields=>'coalesce('+fields.map(json).join(',')+",'')";
   const fields={call_logs:['call_started_at','started_at','created_at','updated_at'],activity_log:['created_at','updated_at'],submissions:['submission_origin_at','submitted_at','approval_requested_at','created_at','updated_at'],candidates:['data_uploading_date','created_at','updated_at','approval_requested_at'],presence:['work_started_at'],active_sessions:['login_at','created_at','updated_at','last_seen_at'],break_sessions:['started_at','created_at']}[name];
   if(fields){
    params.push(new Date(window.from).toISOString(),new Date(window.to).toISOString());const start='$'+(params.length-1)+'::timestamptz',end='$'+params.length+'::timestamptz',instant='public.crm_safe_instant('+coalesce(fields)+')';
    let within=instant+'>='+start+' and '+instant+'<='+end;
    if(name==='break_sessions')within=instant+'<='+end+" and coalesce(public.crm_safe_instant("+json('ended_at')+"),now())>="+start;
    if(name==='candidates'){
      const ids=[...new Set(window.reference_ids||[])],phones=[...new Set(window.reference_phones||[])];
      if(ids.length){params.push(ids);within='('+within+' or r.candidate_id=any($'+params.length+'::text[]))';}
      if(phones.length){params.push(phones);within='('+within+' or public.crm_normalized_phone(r.phone)=any($'+params.length+'::text[]))';}
    }
    where+=' and ('+within+')';
   }
  }
  let select=fields?await require('./sqlProjection').projection(name,'r',fields):'r.*';
  if(name==='submissions'&&window?.historical)select+=",c.full_name as __report_candidate_name,c.process as __report_process,true as __report_candidate_active";
  const id=SNAPSHOT_IDS[name];
  if(id&&!activeTransactionClient()&&(!fields||fields.includes(id)))return require('./versionedList').versionedList({key:'scoped:'+name,select,from,where,params,id,idExpr:`r."${id}"::text`});
  return store.query(`select ${select} from ${from} where ${where}`,params);
 };
 if(name==='users'){
  const users=store.pool?await rosterCache.load('thin',()=>store.query('select user_id,username,full_name,recruiter_code,role,designation,is_active,tl_user_id,tl_code,team_id from public.users')):await table(name);
  return users.filter(r=>!user||employeeVisibleForUser(r,user));
 }
 if(name==='submissions'&&window?.historical){
  if(!store.pool){const candidates=new Map((await table('candidates')).map(r=>[String(r.candidate_id),r]));return (await table(name)).filter(r=>{const c=candidates.get(String(r.candidate_id));if(!c||require('./accessRules').isDeletedCandidate(c))return false;const actor=require('./crmMetrics').historicalSubmitter(r,c,[]);return !user||isAdminOrManager(user)||employeeVisibleForUser({...r,user_id:actor.user_id,recruiter_code:actor.recruiter_code,full_name:actor.recruiter_name},user);}).map(r=>({...r,__report_candidate_name:candidates.get(String(r.candidate_id)).full_name,__report_process:candidates.get(String(r.candidate_id)).process,__report_candidate_active:true}));}
  let scope={sql:'true',params:[]};if(user&&!isAdminOrManager(user)){
   const columns=await rosterCache.load('columns:submissions',async()=>new Set((await store.query("select column_name from information_schema.columns where table_schema='public' and table_name='submissions'")).map(r=>r.column_name)));
   scope=simpleOwnerSql('r',['submitted_by_user_id','submitted_by_username','submitted_by_name','submitted_by','submitted_by_recruiter_code','recruiter_code','user_id'].filter(f=>columns.has(f)),user,[],{historical:true});
  }
  return read('public.submissions r join public.candidates c on c.candidate_id=r.candidate_id','('+scope.sql+') and '+candidateNotDeletedSql('c'),scope.params);
 }
 if(!user||isAdminOrManager(user))return store.pool&&(fields||window)?read('public.'+name+' r'):table(name);
 if(!store.pool){const rows=await table(name);if(name==='candidates')return rows.filter(r=>visibleCandidateForUser(r,user));
  if(['submissions','interviews','revenue_hub_entries'].includes(name)){const ids=new Set((await scopedRows('candidates',user)).map(r=>r.candidate_id));return rows.filter(r=>ids.has(r.candidate_id))}
  return rows.filter(r=>employeeVisibleForUser(r,user));
 }
 let from='public.'+name+' r',scope;
 if(name==='candidates')scope=candidateScopeSql('r',user,[]);
 else if(['submissions','interviews','revenue_hub_entries'].includes(name)){from+=' join public.candidates c on c.candidate_id=r.candidate_id';scope=candidateScopeSql('c',user,[])}
 else if(name==='call_logs')scope=simpleOwnerSql('r',['employee_user_id','employee_username','employee_name','recruiter_code'],user,[]);
 else if(['presence','activity_log','active_sessions','break_sessions','notifications'].includes(name)){
  const fields=await rosterCache.load('columns:'+name,async()=>new Set((await store.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[name])).map(r=>r.column_name)));
  scope=simpleOwnerSql('r',['user_id','employee_user_id','username','employee_username','employee_name'].filter(f=>fields.has(f)),user,[]);
 }
 else return [];
 return read(from,scope.sql,scope.params);
}
function clientScopeSql(alias,user,params=[]){
 if(isAdminOrManager(user))return{sql:'true',params};
 if(String(user?.role).toLowerCase()!=='tl')return{sql:'false',params};
 const clauses=[];for(const[field,value]of [['visible_to_tl_user_ids',user.user_id],['visible_to_tl_codes',user.recruiter_code],['visible_to_tl_names',user.full_name]]){
  params.push(String(value||'').trim().toLowerCase());clauses.push(`($${params.length}<>'' and $${params.length}=any(regexp_split_to_array(lower(coalesce(${alias}.${field},'')),'\\s*,\\s*')))`);
 }return{sql:'('+clauses.join(' or ')+')',params};
}
module.exports={scopedRows,clientScopeSql};
