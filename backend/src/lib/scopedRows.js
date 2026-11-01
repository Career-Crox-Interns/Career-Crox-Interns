'use strict';
const {store,table,SNAPSHOT_IDS,activeTransactionClient}=require('./store');
const {candidateScopeSql,simpleOwnerSql,employeeVisibleForUser,visibleCandidateForUser,isAdminOrManager}=require('./accessRules');
const {createTimedCache}=require('./cache');
const rosterCache=createTimedCache(60000,{tags:['staff','access']});
const valid=s=>{if(!/^[a-z_]+$/.test(s))throw Error('Invalid table');return s};
async function scopedRows(name,user,fields=null,window=null){
 valid(name);
 const read=async(from,where='true',params=[])=>{
  params=[...params];if(window&&['call_logs','activity_log'].includes(name)){
   const value=name==='call_logs'?"coalesce(nullif(r.call_started_at,''),nullif(r.created_at,''),r.updated_at,'')":"r.created_at";
   params.push(new Date(window.from).toISOString(),new Date(window.to).toISOString());
   where+=` and public.crm_safe_instant(${value}) >= $${params.length-1}::timestamptz and public.crm_safe_instant(${value}) <= $${params.length}::timestamptz`;
  }
  const select=fields?await require('./sqlProjection').projection(name,'r',fields):'r.*';
  const id=SNAPSHOT_IDS[name];
  if(id&&!activeTransactionClient()&&(!fields||fields.includes(id)))return require('./versionedList').versionedList({key:'scoped:'+name,select,from,where,params,id,idExpr:`r."${id}"::text`});
  return store.query(`select ${select} from ${from} where ${where}`,params);
 };
 if(name==='users'){
  const users=store.pool?await rosterCache.load('thin',()=>store.query('select user_id,username,full_name,recruiter_code,role,designation,is_active,tl_user_id,tl_code,team_id from public.users')):await table(name);
  return users.filter(r=>!user||employeeVisibleForUser(r,user));
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
