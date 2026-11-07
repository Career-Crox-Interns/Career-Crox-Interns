'use strict';
// CC932: stable, snapshot-consistent transfer preview; keep real edit protection.
const crypto=require('crypto');
const {store,TABLES,withTransaction}=require('../lib/store');
const book=require('../lib/crmExcelWorkbook');
const {reconcileBackup}=require('../lib/backupRestoreCompat');
const {adaptTransferSchema,preflightTypes,columnSql,integerId,sameKey}=require('../lib/fullExcelSchemaCompat');
const {clearAllCaches}=require('../lib/cache');
const {JWT_SECRET}=require('../config/env');
const {canonicalRole}=require('../lib/accessRules');
const mediaTables=new Set(['candidate_files','candidate_file_contents','recording_files','jd_documents','user_onboarding_documents','hr_document_templates','hr_document_runs','mobile_app_releases','important_resources']);
const runtimeTables=new Set(['crm_usage_samples','crm_usage_alerts','active_sessions','mobile_devices','live_call_state','generated_downloads','chat_notification_jobs','crm_command_receipts','password_reset_requests','egress_budget_daily','dialer_sessions','dialer_queue_items','user_onboarding_requests']);
const omitted=new Set([...mediaTables,...runtimeTables]);
const userColumns=new Set(['password','password_hash','email','employee_id','created_at','updated_at','theme_name','theme_config','user_id','username','full_name','role','designation','recruiter_code','tl_user_id','tl_code','tl_name','manager_user_id','manager_code','manager_name','team_id','reporting_to','is_active']);
const teamColumns=['tl_user_id','tl_code','tl_name','manager_user_id','manager_code','manager_name','team_id','reporting_to'];
const mediaKey=/^(?:(?:file|files|resume|resumes|recording|recordings|audio|attachment|attachments|blob|binary|photo|image)(?:$|_)|video_(?:data|base64|bytes|content|blob|binary)$|document_binary|document_data|signature_)/i;
const secretKey=/(password|secret|token|credential|private[_-]?key|api[_-]?key|otp[_-]?secret|session[_-]?key)/i;
const settingsSecret=/(cc180|password|secret|token|session|credential|private|api[_-]?key|smtp|supabase|cc874|backup|passcode|auth|oauth|recording|resume|storage|instance|provider)/i;
const importRecordKey='cc188_backup_last_import_record';
const stateKey='cc876_full_excel_backup_reminder',core=['users','candidates','tasks','notes','submissions','interviews','notifications'];
const quote=x=>'"'+String(x).replace(/"/g,'""')+'"',norm=x=>String(x==null?'':x).trim().toLowerCase();
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const sha=x=>book.sha(Buffer.isBuffer(x)?x:Buffer.from(String(x)));
let restoring=false,heavyOperation=null;
const stageNames=['file','source','schema','staff','mapping','database','destination'];
function reportFor(req){return req.cc188Report||(req.cc188Report={version:'CC188',stages:stageNames.map(name=>({name,status:'not_checked'})),issues:[],warnings:[]});}
async function stage(req,name,work){const report=reportFor(req),item=report.stages.find(s=>s.name===name);if(item)item.status='checking';try{const value=await work();if(item)item.status='passed';return value;}catch(error){if(item)item.status='failed';const issues=Array.isArray(error.issues)?error.issues:[{code:'VERIFY_STOPPED',message:error.message}];report.issues.push(...issues.slice(0,100-report.issues.length));throw error;}}
function sourceIssues(payload){
 const issues=[],groups=new Map(),schema=payload?.schema,tables=payload?.tables;
 const add=(code,table,column,row,message)=>{const key=[code,table,column].join('|');let group=groups.get(key);if(!group&&issues.length<100){group={code,table,column,message,count:0,rows:[]};groups.set(key,group);issues.push(group);}if(group){group.count++;if(row&&group.rows.length<5)group.rows.push(row);}};
 if(!schema||typeof schema!=='object'||Array.isArray(schema)||!tables||typeof tables!=='object'||Array.isArray(tables))return[{code:'FILE_SCHEMA',message:'The backup schema or table list is invalid.'}];
 for(const table of core)if(!schema[table]||!Array.isArray(tables[table]))add('MISSING_TABLE',table,'',0,'A complete Full CRM Excel must include '+table+'.');
 for(const [table,rows]of Object.entries(tables)){
  if(!TABLES.has(table)||omitted.has(table)){add('UNSUPPORTED_TABLE',table,'',0,'This table is not part of the safe structured transfer.');continue;}
  const spec=schema[table];
  if(!Array.isArray(rows)||!spec||!Array.isArray(spec.columns)||!Array.isArray(spec.primary_key)||!spec.primary_key.length){add('TABLE_SCHEMA',table,'',0,'The table has no valid columns and primary key.');continue;}
  const names=spec.columns.map(c=>c?.name),fields=new Set(names),seen=new Set();
  if(fields.size!==names.length||spec.primary_key.some(k=>!fields.has(k))||new Set(spec.primary_key).size!==spec.primary_key.length)add('IDENTITY_SCHEMA',table,'',0,'The declared column/primary-key list contains missing or repeated identities.');
  for(const c of spec.columns)if(!c||typeof c.name!=='string'||!allowedField(table,c))add('PROHIBITED_FIELD',table,String(c?.name||''),0,'A prohibited or invalid field cannot be transferred.');
  rows.forEach((row,index)=>{
   if(!row||typeof row!=='object'||Array.isArray(row)){add('INVALID_ROW',table,'',index+1,'A record is not an object.');return;}
   const pk=spec.primary_key.map(k=>row[k]);
   if(pk.some(v=>v==null||typeof v==='object'||String(v).trim()===''))add('MISSING_ID',table,spec.primary_key.join(','),index+1,'A record has an empty or invalid primary key.');
   else{const key=JSON.stringify(pk.map(String));if(seen.has(key))add('DUPLICATE_ID',table,spec.primary_key.join(','),index+1,'More than one record has the same primary key.');seen.add(key);}
   for(const key of Object.keys(row))if(!fields.has(key))add('UNDECLARED_FIELD',table,key,index+1,'A record contains a field not declared by its backup schema.');
   for(const col of spec.columns){if(!col)continue;const value=row[col.name];if(/^(timestamp|timestamptz|date)$/.test(col.type)&&value!=null&&!Number.isFinite(Date.parse(value)))add('INVALID_DATE',table,col.name,index+1,'A stored date cannot be read safely.');}
  });
 }
 const users=Array.isArray(tables.users)?tables.users:[],logins=new Set(),ids=new Set();
 for(const [index,user]of users.entries()){
  if(!user||typeof user!=='object')continue;
  const login=norm(user.username),id=String(user.user_id||'').trim(),role=canonicalRole(user.role,user.designation);
  if(!login||!id)add('STAFF_ID','users','username/user_id',index+1,'An employee needs both a username and a user ID.');
  if(logins.has(login)||ids.has(id))add('STAFF_DUPLICATE','users','username/user_id',index+1,'Employee usernames and IDs must identify one employee each.');logins.add(login);ids.add(id);
  if(!role)add('STAFF_ROLE','users','role',index+1,'An employee has neither a role nor a designation.');
  const hash=user.password||user.password_hash;
  if(typeof hash!=='string'||!hash||hash.length>1000||require('../lib/security').passwordNeedsUpgrade(hash))add('STAFF_LOGIN','users','password',index+1,'The backup does not include supported staff login hashes. Export an original Full CRM Excel with staff logins.');
 }
 if(!users.some(u=>u&&['manager','admin'].includes(canonicalRole(u.role,u.designation))&&!['0','false','inactive','no'].includes(norm(u.is_active))))add('NO_ACTIVE_MANAGER','users','role',0,'An active Manager account is required so the receiving CRM remains accessible.');
 const candidates=new Set((Array.isArray(tables.candidates)?tables.candidates:[]).filter(Boolean).map(c=>String(c.candidate_id||'').trim()));
 for(const [table,rows]of Object.entries(tables))if(Array.isArray(rows))rows.forEach((row,index)=>{if(!row||table==='candidates'||!row.candidate_id||candidates.has(String(row.candidate_id).trim())||table==='candidate_reset_archive'||table==='crm_candidate_id_registry'||/audit|log|history/.test(table)||isStandaloneManualCallRecord(table,row))return;add('CANDIDATE_REFERENCE',table,'candidate_id',index+1,'A record refers to a candidate absent from the backup. Historical/manual-call exceptions remain supported.');});
 if(payload.highwater!=null&&String(payload.highwater).trim()!==''&&(String(payload.highwater).length>19||!/^\d+$/.test(String(payload.highwater))||typeof payload.highwater==='number'&&!Number.isSafeInteger(payload.highwater)||BigInt(payload.highwater)>9223372036854775807n))add('ID_COUNTER','','highwater',0,'The candidate counter is outside the supported nonnegative 64-bit range.');
 return issues;
}
async function backupWork(kind,work){if(heavyOperation)throw fail('A CRM '+heavyOperation+' is already running. Wait for that action to finish; no second backup/import was started.');heavyOperation=kind;try{return await work();}finally{heavyOperation=null;}}
function notMedia(value,depth=0){
 if(depth>64)throw fail('A CRM record is nested too deeply.',400);
 if(value==null)return value;
 if(value instanceof Date){if(!Number.isFinite(value.getTime()))throw fail('Invalid CRM date.',400);return value.toISOString();}
 if(typeof value==='bigint')return String(value);
 if(Buffer.isBuffer(value)||ArrayBuffer.isView(value))return null;
 if(Array.isArray(value))return value.map(v=>notMedia(v,depth+1));
 if(typeof value==='object'){const out=Object.create(null);for(const [k,v]of Object.entries(value))if(!mediaKey.test(k)&&!secretKey.test(k)&&!['__proto__','constructor','prototype'].includes(k))out[k]=notMedia(v,depth+1);return out;}
 if(typeof value==='string'){
  if(/^data:[^,]*;base64,/i.test(value)||/\/storage\/v1\/object\/(?:public\/|sign\/)?(?:candidate-resumes|resumes|call-recordings|recordings)\//i.test(value))return null;
  if(/^\s*[\[{]/.test(value))try{return JSON.stringify(notMedia(JSON.parse(value),depth+1));}catch(e){if(e.status)throw e;}
 }
 return value;
}
function transferableRow(table,record){
 const clean=notMedia(record);
 if(table==='users')for(const field of ['password','password_hash'])if(Object.hasOwn(record,field)){
  const raw=String(record[field]||'');
  clean[field]=raw ? (require('../lib/security').passwordNeedsUpgrade(raw)?require('../lib/security').hashPassword(raw):raw) : record[field];
 }
 return clean;
}
const person=req=>req.actorUser||req.user||{};
function guard(req){const u=person(req);if(!['manager','admin'].includes(norm(u.role))||u.impersonator||req.authDegraded||!store.pool)throw fail('A verified Manager and a connected CRM database are required.',403);}
function allowedField(table,col){return table==='users'?userColumns.has(col.name):col.type!=='bytea'&&!mediaKey.test(col.name)&&!secretKey.test(col.name);}
function safeSetting(table,row){return !['settings','app_settings'].includes(table)||!settingsSecret.test(String(table==='settings'?row.setting_key:row.key))&&row.key!==stateKey&&row.key!=='cc206_daily_close';}
async function metadata(q){
 const names=[...TABLES].filter(t=>!omitted.has(t)).sort(),schema=Object.create(null);
 const cols=await q('select table_name,column_name,udt_name,is_nullable,column_default is not null or is_identity=\'YES\' as has_default,is_generated<>\'NEVER\' as generated,is_identity=\'YES\' as identity from information_schema.columns where table_schema=$1 and table_name=any($2::text[]) order by table_name,ordinal_position',['public',names]);
 const keys=await q("select k.table_name,k.column_name from information_schema.key_column_usage k join information_schema.table_constraints c on c.constraint_name=k.constraint_name and c.table_schema=k.table_schema and c.table_name=k.table_name where k.table_schema='public' and c.constraint_type='PRIMARY KEY' and k.table_name=any($1::text[]) order by k.table_name,k.ordinal_position",[names]);
 for(const c of cols){if(!schema[c.table_name])schema[c.table_name]={columns:[],primary_key:[]};if(allowedField(c.table_name,{name:c.column_name,type:c.udt_name,nullable:c.is_nullable==='YES',has_default:!!c.has_default,generated:!!c.generated,identity:!!c.identity}))schema[c.table_name].columns.push({name:c.column_name,type:c.udt_name,nullable:c.is_nullable==='YES',has_default:!!c.has_default,generated:!!c.generated,identity:!!c.identity});}
 for(const k of keys)if(schema[k.table_name])schema[k.table_name].primary_key.push(k.column_name);
 for(const t of core)if(!schema[t])throw fail('Required CRM table missing: '+t+'. Apply the included safe schema.');
 for(const [t,s]of Object.entries(schema))if(!s.primary_key.length||s.primary_key.some(k=>!s.columns.some(c=>c.name===k)))throw fail('A stable primary key is missing for '+t+'. No partial transfer file was made.');
 return schema;
}
async function candidateHighwater(q){const exists=await q("select to_regclass('public.crm_candidate_id_seq')::text name");return exists[0]?.name?String((await q('select case when is_called then last_value else 0 end::text n from public.crm_candidate_id_seq'))[0].n):'0';}
async function exportData(){
 const client=await store.pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const q=async(s,p=[])=>{const at=Date.now(),rows=(await client.query(s,p)).rows;return require('../lib/store').measureDatabaseRows(rows,s,Date.now()-at);},schema=await metadata(q),tables=Object.create(null);let count=0,size=0;
  for(const [name,spec]of Object.entries(schema)){
   const columns=spec.columns.map(c=>c.name),order=spec.primary_key.map(quote).join(','),rows=[];let cursor=null;
   const selected=spec.columns.map(c=>{const k=quote(c.name);if(c.type==='date')return k+'::text as '+k;
    if(c.type==='timestamptz')return `to_char(${k} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ${k}`;
    if(c.type==='timestamp')return `to_char((${k} at time zone 'Asia/Kolkata') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ${k}`;
    return k;}).join(',');
   for(;;){
    const where=cursor?'where ('+order+') > ('+spec.primary_key.map((_,i)=>'$'+(i+1)).join(',')+')':'';
    const page=await q('select '+selected+' from public.'+quote(name)+' '+where+' order by '+order+' limit 500',cursor||[]);
    for(const record of page){if(!safeSetting(name,record))continue;const clean=transferableRow(name,record);rows.push(clean);count++;size+=Buffer.byteLength(JSON.stringify(clean));if(count>250000||size>55*1024*1024)throw fail('CRM exceeds the supported Excel snapshot size. No partial file was made.',413);}
    if(page.length<500)break;cursor=spec.primary_key.map(k=>page[page.length-1][k]);
   }tables[name]=rows;
  }
  const highwater=await candidateHighwater(q);await client.query('COMMIT');return {created_at:new Date().toISOString(),schema,tables,highwater};
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}
function ticket(req,type,value,lifetime=15*60000){
 const u=person(req),body=Buffer.from(JSON.stringify({type,user:String(u.user_id),session:sha(u.session_token||u.username||''),value,expires:Date.now()+lifetime})).toString('base64url');
 return body+'.'+crypto.createHmac('sha256',JWT_SECRET).update(body).digest('base64url');
}
function verifyTicket(req,type,input){
 try{
  const [body,signature,extra]=String(input||'').split('.');if(!body||!signature||extra)throw Error();
  const want=crypto.createHmac('sha256',JWT_SECRET).update(body).digest(),got=Buffer.from(signature,'base64url');if(want.length!==got.length||!crypto.timingSafeEqual(want,got))throw Error();
  const d=JSON.parse(Buffer.from(body,'base64url').toString()),u=person(req);
  if(d.type!==type||d.user!==String(u.user_id)||d.session!==sha(u.session_token||u.username||'')||d.expires<=Date.now())throw Error();return d.value;
 }catch{throw fail('Authorization expired or belongs to another file/session. Repeat preview or download.');}
}
async function state(){
 let row=await store.findById('app_settings','key',stateKey);if(row)try{return JSON.parse(row.value);}catch{}
 const initial={first_seen_at:new Date().toISOString(),last_saved_at:null,snooze_until:null};
 await store.query('insert into public.app_settings(key,value,updated_at) values($1,$2,$3) on conflict(key) do nothing',[stateKey,JSON.stringify(initial),initial.first_seen_at]);
 row=await store.findById('app_settings','key',stateKey);try{return JSON.parse(row.value);}catch{return initial;}
}
async function setState(update){return withTransaction(async()=>{const next={...await state(),...update};await store.upsert('app_settings','key',{key:stateKey,value:JSON.stringify(next),updated_at:new Date().toISOString()});return next;});}
function reminderPayload(data,now=Date.now()){
 const parsed=Date.parse(data.last_saved_at||data.first_seen_at),last=Number.isFinite(parsed)?parsed:now,next=last+72*3600000,snooze=Date.parse(data.snooze_until||'');
 return {last_saved_at:data.last_saved_at||null,next_due_at:new Date(next).toISOString(),snooze_until:data.snooze_until||null,due:now>=next&&!(Number.isFinite(snooze)&&now<snooze),overdue:now>=next,days_without_backup:Math.floor(Math.max(0,now-last)/86400000),server_now:new Date(now).toISOString(),last_restore:data.last_restore||null};
}
async function reminder(req,res){guard(req);res.setHeader('Cache-Control','private, no-store');return res.json({ok:true,deployment:{instance:String(process.env.CRM_INSTANCE_LABEL||'Career Crox').slice(0,32),release:'CC148'},reminder:reminderPayload(await state())});}
async function snooze(req,res){guard(req);if(Number(req.body?.hours)!==6)throw fail('Choose Remind after 6 hours.',400);return res.json({ok:true,reminder:reminderPayload(await setState({snooze_until:new Date(Date.now()+6*3600000).toISOString()}))});}
async function saved(req,res){guard(req);const digest=verifyTicket(req,'saved',req.body?.receipt);if(digest!==String(req.body?.sha256||''))throw fail('Saved-file checksum differs from the issued download.',400);return res.json({ok:true,reminder:reminderPayload(await setState({last_saved_at:new Date().toISOString(),snooze_until:null,last_sha256:digest}))});}
async function download(req,res){
 guard(req);if(restoring)throw fail('Restore is in progress. Download after it finishes.');
 const snapshot=await exportData(),data=book.makeWorkbook(snapshot),digest=book.sha(data);
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="Career_Crox_FULL_CRM_'+snapshot.created_at.slice(0,10)+'.xlsx"');
 res.setHeader('X-CRM-Backup-SHA256',digest);res.setHeader('X-CRM-Backup-Receipt',ticket(req,'saved',digest,2*3600000));res.setHeader('Access-Control-Expose-Headers','X-CRM-Backup-SHA256, X-CRM-Backup-Receipt');return res.end(data);
}
function parse(req){guard(req);if(!Buffer.isBuffer(req.body))throw fail('Choose the original Full CRM .xlsx backup.',400);try{return book.readWorkbook(req.body);}catch(e){throw fail(e.message||'Invalid workbook.',400);}}
function validateShape(payload,target){
 if(!payload.schema||typeof payload.schema!=='object'||!payload.tables||typeof payload.tables!=='object')throw fail('Invalid CRM snapshot schema.',400);
 for(const t of Object.keys(target))if(!payload.schema?.[t]||!Array.isArray(payload.tables?.[t]))throw fail('Snapshot is missing '+t+'. Export a fresh complete backup.');
 for(const [t,rows]of Object.entries(payload.tables)){
  if(!TABLES.has(t)||omitted.has(t)||!target[t])throw fail('Unsupported snapshot table: '+t);
  const s=payload.schema[t],d=target[t],fields=new Map(d.columns.map(c=>[c.name,c]));
  if(!s||!Array.isArray(s.columns)||!Array.isArray(s.primary_key)||!s.primary_key.length||new Set(s.primary_key).size!==s.primary_key.length||!sameKey(s.primary_key,d.primary_key))throw fail('Primary key/schema differs for '+t);
  if(new Set(s.columns.map(c=>c.name)).size!==s.columns.length||s.primary_key.some(k=>!s.columns.some(c=>c.name===k)))throw fail('Invalid identity columns in '+t,400);
  const defaults=new Set(payload.defaulted_columns?.[t]||[]);
  if([...defaults].some(k=>!fields.get(k)?.has_default||d.primary_key.includes(k)||s.columns.some(c=>c.name===k)||rows.some(r=>Object.hasOwn(r,k))))throw fail('Invalid defaulted field in '+t,400);
  if(s.columns.length!==d.columns.length-defaults.size||s.columns.some(c=>{
   if(!fields.has(c.name))return true;const type=fields.get(c.name).type;if(type===c.type)return false;
   // Older CRMs used bigint for notes/audit IDs; a fresh schema uses text.
   // Bridge only canonical integer IDs, preserving all 64 bits and references.
   if(['notes','activity_log'].includes(t)&&c.name==='id'&&['text','int8'].includes(c.type)&&['text','int8'].includes(type)){
    if(type==='text')return false;
    return rows.some(r=>r[c.name]!=null&&!integerId(r[c.name]));
   }return true;
  }))throw fail('Column types differ for '+t+'. Apply the same safe schema.');
  const ids=new Set();
  for(const row of rows){
   if(Object.keys(row).some(k=>!fields.has(k)))throw fail('Unexpected or prohibited field in '+t,400);
   const pk=s.primary_key.map(k=>row[k]),key=JSON.stringify(pk.map(String));
   if(pk.some(v=>v==null||typeof v==='object'||String(v).trim()==='')||ids.has(key))throw fail('Missing or repeated record ID in '+t+' ('+s.primary_key.join(',')+'). No records were changed.',400);ids.add(key);
   for(const c of s.columns)if(/^(timestamp|timestamptz|date)$/.test(c.type)&&row[c.name]!=null&&!Number.isFinite(Date.parse(row[c.name])))throw fail('Invalid date in '+t+'.'+c.name+'. Export a fresh backup.',400);
  }
 }
}
const fingerprintVersion='CC188-v1';
const presenceHeartbeatFields=['last_seen_at','last_page','last_activity_at','activity_credit_at','last_activity_source','screen_frame_url','last_screen_frame_at','updated_at'];
async function fingerprint(q,schema,tables){
 const parts=[];
 for(const [t,s]of Object.entries(schema).sort(([a],[b])=>a.localeCompare(b))){
  const params=[];let where='',record='to_jsonb(r)';
  // These settings are only replaced for the incoming, transferable keys.
  // Passcodes, provider credentials, backup reminders and target-only keys stay local.
  if(t==='settings'||t==='app_settings'){
   const key=t==='settings'?'setting_key':'key';
   params.push((tables[t]||[]).filter(r=>safeSetting(t,r)).map(r=>r[key]));
   where=' where r.'+quote(key)+'=any($1::text[])';
  }
  // Keep work/break totals, locks, ownership and every other stored field protected.
  // A page/heartbeat/screen-frame timestamp alone is not a business edit.
  if(t==='presence'){params.push(presenceHeartbeatFields);record='(to_jsonb(r)-$'+params.length+'::text[])';}
  const rows=await q('select count(*)::int n,md5(coalesce(string_agg(md5(('+record+')::text),\'\' order by '+s.primary_key.map(k=>'r.'+quote(k)).join(',')+'),\'\')) digest from public.'+quote(t)+' r'+where,params);
  parts.push([t,Number(rows[0].n),rows[0].digest]);
 }
 return {digest:sha(JSON.stringify(parts)),counts:Object.fromEntries(parts.map(([t,n])=>[t,n])),tables:Object.fromEntries(parts.map(([t,n,d])=>[t,n+':'+d]))};
}
// CC917: Historical manual calls are not saved CRM candidate profiles.
// The actual manual dialer emits MANUAL-<phone> / MOB-MAN-<phone> in BOTH
// manual_dialer_calls and call_quality_events when no profile was chosen.
// Keep these calls unchanged; do not fabricate candidates or weaken ordinary
// candidate-reference checks. Require a real phone to match when provided.
const standaloneManualCallTables=new Set(['manual_dialer_calls','call_quality_events']);
function isStandaloneManualCallRecord(table,row){
 if(!standaloneManualCallTables.has(table))return false;
 const candidateId=String(row?.candidate_id||'').trim();
 const match=/^(?:MANUAL|MOB-MAN)-([0-9]{10,15})$/i.exec(candidateId);
 if(!match)return false;
 const rawPhone=String(row?.phone||'').trim();
 const phone=rawPhone.replace(/\D/g,'');
 return !rawPhone||(phone.length>=10&&phone.slice(-10)===match[1].slice(-10));
}
// Preserve the CC912 helper for existing tests/consumers.
function isStandaloneManualCallQualityEvent(table,row){
 return table==='call_quality_events'&&isStandaloneManualCallRecord(table,row);
}
function validateRelatedCandidateRecords(tables){
 const ids=new Set((tables.candidates||[]).map(r=>String(r.candidate_id).trim()));
 const unresolved=[];
 let standaloneManualQualityEvents=0,standaloneManualDialerCalls=0;
 for(const [table,rows]of Object.entries(tables)){
  for(const row of rows){
   if(table==='candidates'||!row.candidate_id||ids.has(String(row.candidate_id).trim())||table==='candidate_reset_archive'||table==='crm_candidate_id_registry'||/audit|log|history/.test(table))continue;
   if(isStandaloneManualCallRecord(table,row)){
    if(table==='call_quality_events')standaloneManualQualityEvents++;
    else standaloneManualDialerCalls++;
    continue;
   }
   unresolved.push({table,candidate_id:String(row.candidate_id)});
  }
 }
 if(unresolved.length){const error=fail('Backup has '+unresolved.length+' unresolved candidate reference(s): '+unresolved.slice(0,12).map(r=>r.table+': '+r.candidate_id).join('; ')+'. No changes were made.');error.code='BACKUP_CANDIDATE_REFERENCES';error.unresolved_references=unresolved.slice(0,100);throw error;}
 return {candidateCount:ids.size,standaloneManualQualityEvents,standaloneManualDialerCalls};
}
async function checkSource(req,payload){if(req.cc188SourcePayload===payload)return; await stage(req,'source',()=>{const issues=sourceIssues(payload);if(issues.length)throw Object.assign(fail('The backup has '+issues.length+' groups of issues: '+issues.slice(0,3).map(x=>(x.table?x.table+': ':'')+x.message).join(' ')+' No records were changed.'),{issues});validateShape(payload,payload.schema);});req.cc188SourcePayload=payload;}
async function prepare(req,payload,q=(s,p=[])=>store.query(s,p)){
 await checkSource(req,payload);
 const schemaBefore=await stage(req,'schema',()=>metadata(q));
 const compatible=await stage(req,'schema',()=>{const result=adaptTransferSchema(payload,schemaBefore);validateShape(result.payload,result.target);return result;}),target=compatible.target;
 payload=compatible.payload;
 const roster=await stage(req,'staff',async()=>{const rows=await q('select * from public.users'),logins=new Set();for(const u of rows){const login=norm(u.username);if(logins.has(login))throw fail('Duplicate destination employee username. Resolve the receiving staff roster first.');logins.add(login);}return rows;});
 const byLogin=new Map(roster.map(u=>[norm(u.username),u])),sourceUsers=payload.tables.users;
 for(const u of sourceUsers)if(!['admin','manager','tl','recruiter'].includes(canonicalRole(u.role,u.designation)))reportFor(req).warnings.push({code:'CUSTOM_ROLE_PRESERVED',message:'A custom employee role is preserved as recorded. Review its access after import.',employee_id:String(u.user_id)});
 const clean={...payload,tables:Object.fromEntries(Object.entries(payload.tables).map(([t,rows])=>[t,rows.filter(r=>safeSetting(t,r)).map(r=>transferableRow(t,r))]))};
 const mapped=await stage(req,'mapping',()=>{const result=reconcileBackup(clean,roster,target,{transfer:true,collectIssues:true,appearancePolicy:'source-user-id'});if(result.report.issue_count)throw Object.assign(fail('Employee/draft/settings identity checks: '+result.report.issues.slice(0,3).map(x=>x.message).join(' ')+' No records were changed.'),{issues:result.report.issues});validateShape(result.payload,target);return result;});
 reportFor(req).warnings.push(...mapped.report.warnings);
 if(mapped.report.repaired_draft_keys)reportFor(req).warnings.push({code:'LEGACY_DRAFT_KEYS_REPAIRED',message:mapped.report.repaired_draft_keys+' legacy draft/deletion keys will keep their original row owner and UUID/edit reference.'});
 await stage(req,'database',()=>preflightTypes(mapped.payload,target,schemaBefore,q));
 // Team links are already rewritten by the same identity map as profiles/tasks.
 const teamRows=[];
 const related=validateRelatedCandidateRecords(mapped.payload.tables);
 const destination=await stage(req,'destination',()=>fingerprint(q,schemaBefore,mapped.payload.tables));
 return {mapped,target,schemaBefore,additions:compatible.additions,teamRows,destination,summary:{import_policy:'CC188',compatibility_warnings:reportFor(req).warnings,appearance_conflicts:mapped.report.appearance_conflicts.length,repaired_draft_keys:mapped.report.repaired_draft_keys,schema_compatibility:'CC148 matched schema',standalone_manual_call_quality_events:related.standaloneManualQualityEvents,standalone_manual_dialer_calls:related.standaloneManualDialerCalls,defaulted_columns:compatible.defaultedColumns,column_type_bridges:compatible.bridges,empty_legacy_tables:compatible.emptyTables,columns_added_on_restore:compatible.additions.map(c=>c.table+'.'+c.name),tables:Object.keys(clean.tables).length,candidates:related.candidateCount,tasks:clean.tables.tasks.length,followups:clean.tables.candidates.filter(r=>r.follow_up_at&&!/done|complete|cancel/i.test(r.follow_up_status||'')).length,reminders:clean.tables.notifications.length,interviews:clean.tables.interviews.length,submissions:clean.tables.submissions.length,notes:clean.tables.notes.length,staff_mapped:clean.tables.users.length,staff_created:sourceUsers.filter(u=>!byLogin.has(norm(u.username))).length,staff_replaced:roster.filter(u=>!sourceUsers.some(s=>norm(s.username)===norm(u.username))).length,credentials_included:true,existing_candidates:destination.counts.candidates||0,records:Object.entries(clean.tables).filter(([t])=>t!=='users').reduce((n,[,rows])=>n+rows.length,0),source_date:payload.created_at,files:0,employee_mapping:payload.tables.users.map(u=>({username:u.username,from_id:u.user_id,to_id:mapped.identities.get(String(u.user_id)),action:byLogin.has(norm(u.username))?'Update account & login':'Create account & login',profiles:clean.tables.candidates.filter(r=>String(r.recruiter_user_id)===String(u.user_id)||!r.recruiter_user_id&&norm(r.recruiter_code)===norm(u.recruiter_code)).length}))}};
}
async function preview(req,res){
 const payload=await stage(req,'file',()=>parse(req)),digest=book.sha(req.body);await checkSource(req,payload);const client=await store.pool.connect();let p;
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("set local time zone 'UTC'");
  p=await prepare(req,payload,async(s,args=[])=>(await client.query(s,args)).rows);
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
 res.setHeader('Cache-Control','private, no-store');
 return res.json({ok:true,sha256:digest,preview_token:ticket(req,'restore',{fingerprint_version:fingerprintVersion,sha256:digest,destination:p.destination.digest,tables:p.destination.tables,schema:sha(JSON.stringify(p.schemaBefore))}),report:reportFor(req),summary:p.summary,warning:'Transfer replaces CRM records and staff accounts, including login passwords. Provider settings and this CRM transfer passcode stay local. Compatible legacy activity IDs are preserved; a missing activity_log.id column is added only during confirmed restore. All destination sessions are signed out; log in with a transferred account. No media is copied.'});
}
async function dependencyOrder(names){
 const edges=await store.query("select a.relname child,b.relname parent from pg_constraint c join pg_class a on a.oid=c.conrelid join pg_class b on b.oid=c.confrelid join pg_namespace n on n.oid=a.relnamespace where c.contype='f' and n.nspname='public'"),order=[],done=new Set(),visiting=new Set();
 function visit(t){if(done.has(t))return;if(visiting.has(t))throw fail('Circular foreign keys need a compatible restore migration.');visiting.add(t);for(const e of edges)if(e.child===t&&e.parent!==t&&names.includes(e.parent))visit(e.parent);visiting.delete(t);done.add(t);order.push(t);}
 names.forEach(visit);return order;
}
function portable(t,row){return t==='presence'?require('../lib/multipleCrm').portableRow(t,row,{settings:{}}):row;}
async function restore(req,res){
 const payload=parse(req),digest=book.sha(req.body),auth=verifyTicket(req,'restore',req.get('x-crm-preview-token'));
 if(req.get('x-crm-confirm-restore')!=='RESTORE'||auth.sha256!==digest||req.get('x-crm-workbook-hash')!==digest)throw fail('Preview this exact workbook and confirm Restore first.',400);
 if(auth.fingerprint_version!==fingerprintVersion)throw fail('The backup code was updated. Run Preview & Verify again, then confirm Import.');
 if(restoring)throw fail('Another restore is already running.');restoring=true;
 try{
  const result=await withTransaction(async()=>{
   await store.query("set local lock_timeout='5s'");
   await store.query("set local time zone 'UTC'");
   const schema=await metadata((s,p=[])=>store.query(s,p)),names=Object.keys(schema);
   await store.query('lock table '+names.map(t=>'public.'+quote(t)).join(',')+' in share row exclusive mode');
   const beforeState=await state(),previewId=sha(String(req.get('x-crm-preview-token')));
   if(beforeState.last_restore?.preview_id===previewId&&beforeState.last_restore.sha256===digest){const saved=await store.findById('app_settings','key',importRecordKey);let record;try{record=JSON.parse(saved?.value||'null');}catch{}if(record?.preview_id===previewId&&record?.sha256===digest&&record?.result)return {...record.result,replayed:true};throw fail('The earlier import record needs review. Check Last import before starting a new transfer.');}
   const p=await prepare(req,payload);
   if(auth.schema!==sha(JSON.stringify(p.schemaBefore)))throw fail('CRM database structure changed after preview. Run Preview & Verify again.');
   if(auth.destination!==p.destination.digest){
    const changed=Object.keys(p.destination.tables).filter(t=>auth.tables?.[t]!==p.destination.tables[t]);
    throw fail('CRM data changed after preview'+(changed.length?' in: '+changed.join(', '):'')+'. Pause work in this CRM, run Preview & Verify again, then Import. No records were replaced.');
   }
   for(const c of p.additions)await store.query('alter table public.'+quote(c.table)+' add column '+quote(c.name)+' '+columnSql(c.type));
   const tables=p.mapped.payload.tables,sourceSchema=p.mapped.payload.schema,order=await dependencyOrder(names),counts={};
   await store.query("select set_config('career_crox.multiple_restore','on',true)");
   // This Manager-confirmed snapshot must not run live edit/identity/audit side effects.
   // DDL is transactional; a failed import restores trigger states with the data.
   const triggers=await store.query("select t.tgname,c.relname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public' and c.relname=any($1::text[])",[names]);
   for(const t of names)await store.query('alter table public.'+quote(t)+' disable trigger user');
   for(const t of [...order].reverse()){
    if(t==='crm_candidate_id_registry')continue; // Never reuse an ID previously issued by either CRM.
    if(t==='settings'||t==='app_settings'){const k=t==='settings'?'setting_key':'key',keys=tables[t].map(r=>r[k]);if(keys.length)await store.query('delete from public.'+quote(t)+' where '+quote(k)+'=any($1::text[])',[keys]);}
    else await store.query('delete from public.'+quote(t));
   }
   // Sessions and pairing belong to the destination, never the transfer file.
   for(const t of ['active_sessions','mobile_devices','password_reset_requests'])await store.query('delete from public.'+quote(t));
   for(const t of order){
    const s=sourceSchema[t],cols=s.columns.map(c=>c.name),insertCols=cols.filter(k=>!p.target[t].columns.find(c=>c.name===k)?.generated),pk=p.target[t].primary_key,rows=tables[t].map(r=>portable(t,r)),updates=insertCols.filter(k=>!pk.includes(k));
    for(let i=0;i<rows.length;i+=100){
     const batch=rows.slice(i,i+100);
     await store.query('insert into public.'+quote(t)+' ('+insertCols.map(quote).join(',')+') overriding system value select '+insertCols.map(quote).join(',')+' from jsonb_populate_recordset(null::public.'+quote(t)+',$1::jsonb) on conflict ('+pk.map(quote).join(',')+') '+(updates.length?'do update set '+updates.map(k=>quote(k)+'=excluded.'+quote(k)).join(','):'do nothing'),[JSON.stringify(batch)]);
     const equals=cols.map(k=>'to_jsonb(d.'+quote(k)+') is not distinct from to_jsonb(s.'+quote(k)+')').join(' and '),checked=await store.query('select count(*)::int n from jsonb_populate_recordset(null::public.'+quote(t)+',$1::jsonb) s join public.'+quote(t)+' d on '+equals,[JSON.stringify(batch)]);
     if(Number(checked[0].n)!==batch.length)throw fail('Restored values differ for '+t+'. All changes were rolled back.');
    }
    counts[t]=rows.length;
    if(!['settings','app_settings','crm_candidate_id_registry'].includes(t)&&Number((await store.query('select count(*)::int n from public.'+quote(t)))[0].n)!==rows.length)throw fail('Record counts differ for '+t+'. Restore rolled back.');
   }
   const sequences=await store.query("select table_name,column_name from information_schema.columns where table_schema='public' and (column_default like 'nextval(%' or is_identity='YES')");
   for(const c of sequences)if(names.includes(c.table_name)){
    const info=await store.query('select pg_get_serial_sequence($1,$2) seq',['public.'+quote(c.table_name),c.column_name]);
    if(info[0]?.seq)await store.query('select setval($1::regclass,greatest(1,(select last_value from '+info[0].seq.split('.').map(quote).join('.')+'),coalesce((select max('+quote(c.column_name)+') from public.'+quote(c.table_name)+'),1)),true)',[info[0].seq]);
   }
   const reconcile=await store.query("select to_regprocedure('public.crm_reconcile_candidate_sequence(bigint)')::text name");
   if(reconcile[0]?.name&&/^\d+$/.test(String(payload.highwater||'')))await store.query('select public.crm_reconcile_candidate_sequence($1)',[String(payload.highwater)]);
   for(const tr of triggers)await store.query('alter table public.'+quote(tr.relname)+' '+({D:'disable',R:'enable replica',A:'enable always'}[tr.tgenabled]||'enable')+' trigger '+quote(tr.tgname));
   const control=await store.query("select to_regclass('crm_control.instance')::text name");
   if(control[0]?.name)await store.query("update crm_control.instance set mode='ACTIVE',updated_at=now() where id");
   const result={ok:true,counts,total:Object.values(counts).reduce((n,v)=>n+v,0),verified_candidates:counts.candidates||0,files:0,requires_login:true,restored_at:new Date().toISOString()};
   const journal={...beforeState,last_restore:{release:'CC188',preview_id:previewId,sha256:digest,restored_at:result.restored_at,profiles:result.verified_candidates,settings_conflicts:p.mapped.report.appearance_conflicts.length}};
   // Keep the larger preservation record out of routine reminder/status reads.
   await store.upsert('app_settings','key',{key:importRecordKey,value:JSON.stringify({preview_id:previewId,sha256:digest,result,appearance_conflicts:p.mapped.report.appearance_conflicts}),updated_at:result.restored_at});
   await store.upsert('app_settings','key',{key:stateKey,value:JSON.stringify(journal),updated_at:result.restored_at});
   return result;
  },{trackingExclusive:true});
  clearAllCaches();
  try{const live=require('../lib/approvalLive'),users=await store.all('users');live.refreshStaffScopes(users);live.publishToUsers(users.map(u=>u.user_id),'access-changed',{source:'/data-backup/full-excel/restore',at:Date.now(),reload:true});live.publishReminderDirty({},{source:'/data-backup/full-excel/restore',at:Date.now()});require('../lib/multipleCrm').invalidateMode();}catch(e){console.warn('Restore committed; reconnect staff to refresh live views:',e.message);}
  try{require('../lib/approvalLive').disconnectAll?.();res.clearCookie?.('career_crox_token',require('../middleware/auth').authCookie());}catch{}
  return res.json(result);
 }catch(error){if(error.code==='CRM_COMMIT_UNCONFIRMED'||error.committed===null||error.payload?.committed===null){clearAllCaches();try{require('../lib/multipleCrm').invalidateMode();require('../lib/approvalLive').disconnectAll?.();}catch{}}throw error;}finally{restoring=false;}
}
async function checkedPreview(req,res){try{return await backupWork('verification',()=>preview(req,res));}catch(error){if(req.query?.diagnostics!=='1')throw error;const report=reportFor(req);if(!report.issues.length)report.issues.push({code:error.code||'VERIFY_UNAVAILABLE',message:error.message});res.setHeader('Cache-Control','private, no-store');return res.status(error.status||503).json({ok:false,error:error.message,report});}}
module.exports={download:(...args)=>backupWork('download',()=>download(...args)),preview:checkedPreview,restore:(...args)=>backupWork('import',()=>restore(...args)),reminder,snooze,saved,_test:{sourceIssues,backupWork,reminderPayload,allowedField,notMedia,transferableRow,exportData,prepare,metadata,validateShape,validateRelatedCandidateRecords,isStandaloneManualCallQualityEvent,isStandaloneManualCallRecord,mediaTables,runtimeTables,fingerprint,presenceHeartbeatFields}};

// An editable snapshot has a smaller data boundary and merge rules distinct from
// the archival backup above. All dynamic SQL identifiers come from these definitions.
function workColumns(list,editable='',links=''){
 const writable=new Set(editable.split(' ')),linked=new Set(links.split(' '));
 return list.split('|').map(item=>{
  const [name,label]=item.split('='),[key,type='text']=name.split(':');
  return {key,label:label||key.split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join(' '),type,editable:writable.has(key),link:linked.has(key)};
 });
}
const workingSheets=[
 {key:'profiles',title:'All Profiles',table:'candidates',pk:'candidate_id',idLabel:'Candidate ID',date:"coalesce(nullif(x.data_uploading_date,''),nullif(x.created_at,''),nullif(x.updated_at,''))",
  columns:workColumns('full_name=Candidate Name|phone=Phone Number|email|recruiter_name=Recruiter|recruiter_code|location|preferred_location|qualification|qualification_level|course_name|experience|total_experience|relevant_experience|relevant_experience_range|communication_skill|in_hand_salary|ctc_monthly|relevant_in_hand_range|career_gap|documents_availability|reference_details|client=Company|process|jd_name=Job Title|lead_source|profile_priority|looking_for_job|call_connected|status|profile_status|hot_lead_status|approval_status|approved_by_name=Approved By|approved_at:datetime|all_details_sent|interview_availability|interview_date:date|interview_time|virtual_onsite=Interview Mode|interview_reschedule_date:datetime|submission_date:date|last_working_date:date|follow_up_at:datetime|follow_up_status|follow_up_note:note|follow_up_completed_at:datetime|notes:note=Latest Note|data_notes:note=Data Notes|data_uploading_date:date|created_at:datetime|updated_at:datetime',
   'full_name phone email location preferred_location qualification qualification_level course_name experience total_experience relevant_experience relevant_experience_range communication_skill in_hand_salary ctc_monthly relevant_in_hand_range career_gap documents_availability reference_details process lead_source profile_priority looking_for_job call_connected interview_availability interview_date interview_time virtual_onsite interview_reschedule_date last_working_date follow_up_at follow_up_status follow_up_note data_notes',
   'full_name phone recruiter_code')},
 {key:'submissions',title:'Submissions',table:'submissions',pk:'submission_id',date:"coalesce(nullif(x.effective_submission_at,''),nullif(x.submitted_at,''),nullif(x.created_at,''))",
  columns:workColumns('candidate_id=Candidate ID|candidate_name|candidate_phone=Phone Number|recruiter_name=Recruiter|recruiter_code|company|process|jd_id=Job ID|candidate_status|status=Submission Status|approval_status|submitted_at:datetime=Submission Date|effective_submission_at:datetime|interview_date:date|interview_time|submission_comms=Communication Skill|decision_note:note|reminder_note:note|next_follow_up_at:datetime|approval_requested_at:datetime|approved_at:datetime|approved_by_name=Approved By|rejected_at:datetime|created_at:datetime|updated_at:datetime',
   'status interview_date interview_time submission_comms reminder_note next_follow_up_at','candidate_id recruiter_code jd_id')},
 {key:'interviews',title:'Interviews',table:'interviews',pk:'interview_id',date:"coalesce(nullif(x.interview_reschedule_date,''),nullif(x.interview_date,''),nullif(x.scheduled_at,''))",
  columns:workColumns('candidate_id=Candidate ID|candidate_name|candidate_phone=Phone Number|recruiter_name=Recruiter|recruiter_code|company|process|jd_id=Job ID|stage|status|interview_date:date|interview_reschedule_date:datetime|scheduled_at:datetime|interview_mode|created_at:datetime|updated_at:datetime',
   'stage status interview_date interview_reschedule_date scheduled_at','candidate_id jd_id')},
 {key:'breaks',title:'Breaks',table:'break_sessions',pk:'break_id',date:'x.started_at',
  columns:workColumns('full_name=Employee|username|recruiter_code|reason:note|status|started_at:datetime=Break Start|expected_end_at:datetime|ended_at:datetime=Break End|planned_minutes:number|actual_minutes:number|lock_triggered')},
 {key:'attendance',title:'Attendance',table:'scheduled_reports',pk:'report_id',date:'x.last_run_at',filter:"x.report_type='attendance-daily'",
  columns:workColumns('work_date:date|employee_name=Employee|recruiter_code|status=Manager Status|day_status|joined_at:datetime=Joined Office|closed_at:datetime=Closed At|work_minutes:number|break_minutes:number|idle_minutes:number|dialed_calls:number|connected_calls:number|talktime_minutes:number|submissions:number|missed_interviews:number|manager_note:note|employee_note:note|last_run_at:datetime=Generated At')},
 {key:'pipeline',title:'Pipeline',table:'revenue_hub_entries',pk:'revenue_id',date:"coalesce(nullif(x.interview_datetime,''),nullif(x.interview_date,''),nullif(x.updated_at,''))",
  columns:workColumns('candidate_id=Candidate ID|full_name=Candidate Name|phone=Phone Number|email|recruiter_name=Recruiter|recruiter_code|client_name=Company|process|location|qualification|communication_skill|experience_range|salary_range|interview_mode|submission_date:date|interview_date:date|interview_datetime:datetime|arrived_at:datetime|selection_date:date|joining_date:date|joined_date:date|status|payout_status|payout_amount:number|payout_received_at:datetime|payout_days:number|invoice_status|notes:note|feedback_status|feedback_note:note|feedback_updated_at:datetime|created_at:datetime|updated_at:datetime',
   'client_name process location qualification communication_skill experience_range salary_range interview_mode submission_date interview_datetime selection_date joining_date joined_date status payout_status payout_amount payout_days invoice_status notes feedback_status feedback_note','candidate_id recruiter_code')},
 {key:'updates',title:'Pipeline Updates',table:'revenue_hub_entries',pk:'revenue_id',date:'x.updated_at',filter:"coalesce(x.notes,'')<>'' or coalesce(x.feedback_status,'')<>'' or coalesce(x.feedback_note,'')<>'' or coalesce(x.arrived_at,'')<>''",
  columns:workColumns('candidate_id=Candidate ID|full_name=Candidate Name|recruiter_name=Recruiter|status|arrived_at:datetime|notes:note|feedback_status|feedback_note:note|feedback_updated_at:datetime|updated_at:datetime')},
 {key:'followups',title:'Follow-ups',table:'candidates',pk:'candidate_id',idLabel:'Candidate ID',date:'x.follow_up_at',filter:"coalesce(x.follow_up_at,'')<>'' or coalesce(x.follow_up_note,'')<>''",
  columns:workColumns('full_name=Candidate Name|phone=Phone Number|recruiter_name=Recruiter|recruiter_code|process|follow_up_at:datetime|follow_up_status|follow_up_note:note|follow_up_completed_at:datetime')},
 {key:'notes',title:'Notes',table:'notes',pk:'id',date:'x.created_at',
  columns:workColumns('candidate_id=Candidate ID|candidate_name|username=Author|note_type|body:note=Note|parent_note_id|reply_to_note_id|reply_to_username|created_at:datetime|updated_at:datetime','body','candidate_id username parent_note_id reply_to_note_id')},
 {key:'calls',title:'Calls',table:'call_logs',pk:'call_log_id',date:"coalesce(nullif(x.call_started_at,''),nullif(x.created_at,''))",
  columns:workColumns('candidate_id=Candidate ID|candidate_name|phone=Phone Number|employee_name=Employee|recruiter_code|direction|status|call_started_at:datetime|call_ended_at:datetime|duration_seconds:number|talktime_seconds:number|call_source|call_quality|callback_status|report_note:note')},
 {key:'tasks',title:'Tasks',table:'tasks',pk:'task_id',date:"coalesce(nullif(x.due_at,''),nullif(x.due_date,''),nullif(x.created_at,''))",
  columns:workColumns('candidate_id=Candidate ID|title|description:note|assigned_to_name=Assigned To|assigned_to_code=Employee Code|assigned_by_name=Assigned By|status|priority|due_date:date|due_at:datetime|reminder_at:datetime|closed_at:datetime|closed_by_name=Closed By|created_at:datetime|updated_at:datetime',
   'title description status priority due_date due_at reminder_at','candidate_id assigned_to_code')},
];
const workingByKey=new Map(workingSheets.map(d=>[d.key,d]));
const workingEditRows=5000;
const isoDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))&&book.workValue(value,'date')===value&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const workIso=(value)=>value instanceof Date?value.toISOString():value;
function workPassword(value){
 if(typeof value!=='string'||value.length<8||value.length>96||!value.trim())throw fail('Choose a file password of 8 to 96 characters.',400);
 return value;
}
function workRange(body){
 const from=String(body?.from||''),to=String(body?.to||'');
 if(!from&&!to)return null;
 if(!isoDay(from)||!isoDay(to)||from>to)throw fail('Choose a valid start and end date.',400);
 return {from,to};
}
const childContext={
 candidate_name:'c.full_name',candidate_phone:'c.phone',company:'coalesce(nullif(j.company,\'\'),c.client)',
 process:"coalesce(nullif(j.process_name,''),c.process)",interview_mode:'c.virtual_onsite',
};
function workProjection(d){
 if(d.key==='submissions')return {...childContext,recruiter_name:"coalesce(nullif(x.submitted_by_name,''),c.recruiter_name)",recruiter_code:"coalesce(nullif(x.recruiter_code,''),c.recruiter_code)",candidate_status:'c.status',submitted_at:"coalesce(nullif(x.submitted_at,''),nullif(x.effective_submission_at,''),x.created_at)",interview_date:"coalesce(nullif(x.interview_date,''),c.interview_date)",interview_time:"coalesce(nullif(x.interview_time,''),c.interview_time)"};
 if(d.key==='interviews')return {...childContext,recruiter_name:'c.recruiter_name',recruiter_code:'c.recruiter_code',
  interview_date:"coalesce(nullif(x.interview_date,''),to_char(public.crm_due_instant(coalesce(nullif(x.interview_reschedule_date,''),nullif(x.scheduled_at,''))) at time zone 'Asia/Kolkata','YYYY-MM-DD'),c.interview_date)"};
 if(d.key==='notes')return {candidate_name:'c.full_name'};
 if(d.key==='breaks')return {recruiter_code:'u.recruiter_code'};
 if(d.key==='attendance'){
  // Older reports may have a blank snapshot. Read their date and employee from
  // their persisted period and roster while preserving the stored totals.
  const p=k=>"(public.crm_working_json(x.snapshot_json::text) #>> '{"+k+"}'::text[])";
  return {work_date:"split_part(x.period_key,':',2)",employee_name:'u.full_name',recruiter_code:'u.recruiter_code',
   day_status:p('recommended_day_status'),joined_at:p('summary,joined_at'),closed_at:p('summary,closed_at'),work_minutes:p('summary,productive_work_minutes'),break_minutes:p('summary,total_break_minutes'),idle_minutes:p('summary,idle_minutes'),dialed_calls:p('summary,outgoing_calls_count'),connected_calls:p('summary,connected_calls_count'),talktime_minutes:p('summary,talktime_minutes'),submissions:p('summary,submissions_count'),missed_interviews:p('summary,missed_interviews_today'),manager_note:p('manager_note'),employee_note:p('notes')};
 }
 return {};
}
const workJoins=d=>['interviews','submissions'].includes(d.key)?" left join public.candidates c on c.candidate_id=x.candidate_id left join public.jd_master j on j.jd_id=x.jd_id"
 :d.key==='notes'?" left join public.candidates c on c.candidate_id=x.candidate_id"
 :['breaks','attendance'].includes(d.key)?" left join public.users u on u.user_id=x.user_id":"";
function workFilter(d){
 const filters=d.filter?['('+d.filter+')']:[];
 if(d.table==='candidates')filters.push("coalesce(x.deleted_at,'')=''","lower(coalesce(x.status,'')) not in ('deleted','__deleted__','archived')","lower(coalesce(x.approval_status,'')) not in ('deleted','__deleted__','archived')");
 if(d.table==='revenue_hub_entries')filters.push("coalesce(x.deleted_at,'')=''");
 return filters;
}
async function workInstance(){
 const row=await store.one('select instance_uuid::text as id, mode from crm_control.instance where id=true');
 if(!row?.id||row.mode!=='ACTIVE')throw fail('The CRM database must be active. Apply the included non-reset schema if it has never been set up.');
 return row.id;
}
async function workSnapshot(range){
 return withTransaction(async()=>{
  const snapshot={created:new Date().toISOString(),origin:await workInstance(),range,sheets:[]};
  let count=0,size=0;
  for(const definition of workingSheets){
   const d=definition,projection=workProjection(d);
   const selected=d.columns.map(c=>(projection[c.key]||'x.'+quote(c.key))+'::text as '+quote(c.key));
   const referenceOf=!range&&({updates:'pipeline',followups:'profiles'})[d.key];
   const parent=referenceOf&&snapshot.sheets.find(sheet=>sheet.definition.key===referenceOf);
   if(parent){
    const filtered=parent.rows.filter(row=>d.key==='updates'
      ?['notes','feedback_status','feedback_note','arrived_at'].some(key=>row[key])
      :['follow_up_at','follow_up_note'].some(key=>row[key]));
    const rows=filtered.map(row=>Object.fromEntries([d.pk,...d.columns.map(c=>c.key)].map(key=>[key,row[key]])));
    count+=rows.length;
    for(const row of rows)size+=Buffer.byteLength(JSON.stringify(row));
    if(count>200000||size>45*1024*1024)throw fail('Choose a smaller date range. The full Working Copy is too large.',413);
    snapshot.sheets.push({definition,rows});
    continue;
   }
   const rows=[];
   let cursor=null;
   for(;;){
    const params=[],where=workFilter(d);
    if(cursor!==null){params.push(cursor);where.push('x.'+quote(d.pk)+'> $'+params.length);}
    if(range){
     params.push(range.from,range.to);
     where.push("public.crm_due_instant(("+d.date+")::text) >= ($"+(params.length-1)+"::date::timestamp at time zone 'Asia/Kolkata')");
     where.push("public.crm_due_instant(("+d.date+")::text) < (($"+params.length+"::date+1)::timestamp at time zone 'Asia/Kolkata')");
    }
    const page=await store.query('select x.'+quote(d.pk)+', '+selected.join(',')+' from public.'+quote(d.table)+' x'+workJoins(d)+(where.length?' where '+where.join(' and '):'')+' order by x.'+quote(d.pk)+' limit 500',params);
    for(const row of page){
     const value=Object.fromEntries(Object.entries(row).map(([key,cell])=>[key,workIso(cell)]));
     rows.push(value);
     if(++count>200000||(size+=Buffer.byteLength(JSON.stringify(value)))>45*1024*1024)throw fail('Choose a smaller date range. The full Working Copy is too large.',413);
    }
    if(page.length<500)break;
    cursor=page.at(-1)[d.pk];
   }
   snapshot.sheets.push({definition,rows});
  }
  return snapshot;
 },{readOnly:true,deadlineMs:65000});
}
const workHash=(v,c)=>book.workFingerprint(workIso(v),c.type);
const workPhone=require('../lib/candidateIdentityGuard').normalizedPhone;
const workName=require('../lib/candidateIdentityGuard').normalizedName;
const workId='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const wordStatus=/^[\p{L}\d][\p{L}\d _()&./'-]{0,78}$/u;
function workCellError(key,value){
 if(value.length>32767||value.includes('\0')||/^data:[^,]+;base64,/i.test(value))return 'Value is too long or is a file attachment.';
 if(key==='email'&&value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return 'Enter a valid email.';
 if((key==='status'||key.endsWith('_status')||key==='stage')&&value&&(!wordStatus.test(value)||['deleted','__deleted__','archived','removed'].includes(norm(value))))return 'Enter a valid CRM status.';
 if(key==='interview_time'&&value&&!/^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?: [AP]M)?$/i.test(value))return 'Use a time such as 14:30.';
 return '';
}
function validateWorkPatch(d,patch){
 for(const c of d.columns){
  if(!Object.hasOwn(patch,c.key))continue;
  const v=patch[c.key],problem=workCellError(c.key,v);
  if(problem)return c.label+' — '+problem;
  if(v&&(c.type==='date'&&!isoDay(v)||c.type==='datetime'&&(!Number.isFinite(Date.parse(v))||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v))))return c.label+' — enter a valid date.';
  if(v&&c.type==='number'&&(!/^\d+(?:\.\d{1,2})?$/.test(v)||Number(v)>1e9))return c.label+' — enter a valid number.';
 }
 return '';
}
const workLink=(d,row,key)=>row.base?.links[d.columns.filter(c=>c.link).findIndex(c=>c.key===key)]||'';
function workChanged(d,row){
 return row.changedKeys.length?d.columns.filter(c=>row.changedKeys.includes(c.key)):[];
}
function workMatchKey(origin,d,id){
 const hash=sha(origin+'|'+d.key+'|'+id);
 return d.key==='notes'?String(parseInt(hash.slice(0,13),16)):'W206-'+hash.slice(0,28);
}
function workStale(row){
 return !!row&&(Boolean(row.deleted_at)||['deleted','__deleted__','archived'].includes(norm(row.status))||['deleted','__deleted__','archived'].includes(norm(row.approval_status)));
}
async function workRead(d,ids,phones=[]){
 if(!ids.size&&!phones.length)return [];
 const extra={profiles:['deleted_at','recruiter_user_id','user_id'],pipeline:['deleted_at','recruiter_user_id','created_at'],submissions:['submitted_by_user_id','created_at'],notes:['created_at'],interviews:['created_at'],tasks:['assigned_to_user_id','created_at']}[d.key]||[];
 const fields=[...new Set([d.pk,...d.columns.filter(c=>c.editable||c.link||['status','approval_status','note_type'].includes(c.key)).map(c=>c.key),...extra])];
 const records=[];
 const keys=[...ids];
 for(let i=0;i<Math.max(keys.length,phones.length);i+=500){
  const params=[keys.slice(i,i+500)],conditions=['x.'+quote(d.pk)+'::text=any($1::text[])'];
  if(phones.length){params.push(phones.slice(i,i+500));conditions.push('public.crm_normalized_phone(x.phone)=any($2::text[])');}
  const projection=workProjection(d);
  records.push(...await store.query('select '+fields.map(key=>(projection[key]||'x.'+quote(key))+' as '+quote(key)).join(',')+' from public.'+quote(d.table)+' x'+workJoins(d)+' where '+conditions.join(' or '),params));
 }
 return [...new Map(records.map(r=>[String(r[d.pk]),r])).values()];
}
function workStaffFor(roster,code){
 if(!code)return null;
 const same=roster.filter(r=>norm(r.recruiter_code)===norm(code));
 return same.length===1?same[0]:null;
}
function newWorkKey(row){return row.id||'ROW-'+row.row;}
function workOpDigest(ops){return sha(JSON.stringify(ops));}
async function workPlan(file){
 const origin=await workInstance(),same=origin===file.origin;
 const conflicts=[],counts={},ops=[],mapping=new Map(),claimed=new Set();
 let problems=0,examined=0;
 function issue(d,row,reason){problems++;if(conflicts.length<80)conflicts.push({sheet:d.title,row:row.row,record:row.id,message:reason});}
 const candidates=workingByKey.get('profiles'),profileRows=file.sheets.find(s=>s.key==='profiles').rows;
 const childIds=new Set();
 for(const sheet of file.sheets){
  const d=workingByKey.get(sheet.key);
  if(d.key==='profiles'||!d.columns.some(c=>c.editable))continue;
  for(const row of sheet.rows)if(!same||!row.base||workChanged(d,row).some(c=>c.editable)){
   if(row.values.candidate_id)childIds.add(row.values.candidate_id);
  }
 }
 const candidateRows=new Set(profileRows.filter(row=>!same||!row.base||childIds.has(row.id)||workChanged(candidates,row).length));
 // A ranged copy can contain a child of a profile outside the profile date range.
 // Same-CRM imports can look up that ID. Between CRMs the profile must be in the copy.
 const profileIds=new Set([...candidateRows].map(r=>r.id).filter(Boolean));
 if(same)for(const id of childIds)if(!id.startsWith('NEW-'))profileIds.add(id);
 const phones=[...new Set([...candidateRows].map(r=>workPhone(workLink(candidates,r,'phone')||r.values.phone)).filter(Boolean))];
 const profileDb=await workRead(candidates,profileIds,phones),byId=new Map(profileDb.map(r=>[String(r.candidate_id),r])),byPhone=new Map();
 for(const r of profileDb){const phone=workPhone(r.phone);if(!phone)continue;const list=byPhone.get(phone)||[];list.push(r);byPhone.set(phone,list);}
 if(same)for(const r of profileDb)if(!workStale(r))mapping.set(r.candidate_id,r.candidate_id);
 const mayAdd=!same||file.sheets.some(s=>workingByKey.get(s.key).columns.some(c=>c.editable)&&s.rows.some(r=>!r.base));
 const roster=mayAdd?await store.query("select user_id,username,full_name,recruiter_code from public.users where lower(coalesce(is_active::text,'')) not in ('0','false','inactive')"):[];
 const jobs=mayAdd?await store.query('select jd_id from public.jd_master'):[];
 const jobIds=new Set(jobs.map(r=>r.jd_id));
 for(const sheet of file.sheets){
  const d=workingByKey.get(sheet.key),editable=d.columns.some(c=>c.editable);
  const tally=counts[d.title]={new:0,updated:0,unchanged:0,reference:0};
  if(!editable){tally.reference=sheet.rows.length;for(const row of sheet.rows)if(!row.base||workChanged(d,row).length)issue(d,row,'This is a reference sheet. Enter changes on the original working sheet.');continue;}
  const rows=sheet.rows.filter(row=>d.key==='profiles'?candidateRows.has(row):!same||!row.base||workChanged(d,row).length);
  const ids=new Set();
  for(const r of rows)if(d.key!=='profiles'){if(r.base)ids.add(r.id);if(!same||!r.base)ids.add(workMatchKey(file.origin,d,r.base?r.id:file.created+':'+newWorkKey(r)));}
  const db=d.key==='profiles'?byId:new Map((await workRead(d,ids)).map(r=>[String(r[d.pk]),r]));
  tally.unchanged=sheet.rows.length-rows.length;
  for(const row of rows){
   const changed=workChanged(d,row),key=newWorkKey(row);
   if(++examined>200000)throw fail('Choose a smaller date range for this import.',413);
   if(row.base&&changed.some(c=>c.link&&!c.editable)){
    issue(d,row,'Linked IDs or ownership were changed. Use the CRM to change record links and ownership.');continue;
   }
   const immutableEdit=row.base&&changed.find(c=>!c.editable&&!c.link);
   if(immutableEdit){issue(d,row,immutableEdit.label+' is a reference field. Update it through its CRM workflow.');continue;}
   let target,recordId,owner,parent='';
   if(d.key==='profiles'){
    const phone=workPhone(workLink(d,row,'phone')||row.values.phone),name=workName(workLink(d,row,'full_name')||row.values.full_name),matches=byPhone.get(phone)||[];
    if(same&&row.base)target=db.get(row.id);
    else if(matches.length===1&&workName(matches[0].full_name)===name)target=matches[0];
    else if(!same&&row.base&&db.has(row.id)&&!phone&&name&&workName(db.get(row.id).full_name)===name&&!db.get(row.id).phone)target=db.get(row.id);
    if(!target&&matches.length){issue(d,row,'This phone matches a different or multiple destination profiles. Review it in CRM.');continue;}
    if(same&&row.base&&!target){if(changed.some(c=>c.editable)||childIds.has(row.id))issue(d,row,'This profile has been removed from the destination.');else tally.unchanged++;continue;}
    if(target&&workStale(target)){issue(d,row,'This destination profile is deleted or archived.');continue;}
    recordId=target?String(target[d.pk]):'@'+key;
    if(claimed.has(recordId)){issue(d,row,'More than one workbook row points to the same profile.');continue;}
    claimed.add(recordId);
    mapping.set(key,recordId);
    if(!target){
     const code=row.values.recruiter_code;owner=workStaffFor(roster,code);
     if(code&&!owner){issue(d,row,'This recruiter code has no unique active employee in the destination CRM.');continue;}
    }
   }else{
    const candidate=row.values.candidate_id;
    parent=candidate?mapping.get(candidate):'';
    if(candidate&&!parent){issue(d,row,'The linked profile could not be matched. Include the profile in the Working Copy.');continue;}
    if(candidate&&parent&&!parent.startsWith('@')&&workStale(byId.get(parent))){issue(d,row,'The linked profile is archived.');continue;}
    const candidateRequired=d.key!=='tasks';
    if(candidateRequired&&!parent){issue(d,row,'Candidate ID is required.');continue;}
    const portable=workMatchKey(file.origin,d,row.base?row.id:file.created+':'+key);
    const direct=row.base?db.get(row.id):null;
    if(same&&row.base){
     target=direct;
     if(!target){if(changed.some(c=>c.editable))issue(d,row,'This record has been removed from the destination.');else tally.unchanged++;continue;}
    }else{
     const copy=db.get(portable);
     const anchor=d.columns.find(c=>c.key==='created_at');
    const sameAnchor=anchor&&direct&&row.base&&workHash(direct.created_at,anchor)===row.base.hashes[d.columns.indexOf(anchor)]&&Boolean(direct.created_at);
    target=copy||(sameAnchor&&String(direct.candidate_id||'')===parent?direct:null);
    }
    if(target&&(workStale(target)||String(target.candidate_id||'')!==parent)){issue(d,row,'Destination record has a different profile link or is archived.');continue;}
    recordId=target?String(target[d.pk]):portable;
    if(!target&&row.values.jd_id&&!jobIds.has(row.values.jd_id)){issue(d,row,'The linked Job ID is missing in the destination CRM.');continue;}
    if(!target&&['submissions','tasks','pipeline'].includes(d.key)){
     const code=row.values[d.key==='tasks'?'assigned_to_code':'recruiter_code'];owner=workStaffFor(roster,code);
     if(code&&!owner){issue(d,row,'This employee code has no unique active destination account.');continue;}
    }
   }
   let patch={},expected={};
   for(const c of d.columns){
    if(!c.editable)continue;
    const v=row.values[c.key],current=target?.[c.key];
    if(!target){if(v)patch[c.key]=v;continue;}
    if(!changed.includes(c)||workHash(v,c)===workHash(current,c))continue;
    if(!row.base||workHash(current,c)!==row.base.hashes[d.columns.indexOf(c)]){
     issue(d,row,c.label+' was changed in CRM after this copy or differs at the destination.');patch=null;break;
    }
    patch[c.key]=v;expected[c.key]=workHash(current,c);
   }
   if(!patch)continue;
   if(target&&!Object.keys(patch).length){tally.unchanged++;continue;}
   let problem=validateWorkPatch(d,patch);
   if(!problem&&d.key==='profiles'&&(!target||'full_name'in patch||'phone'in patch)){
    try{
     if(!workName(patch.full_name??target?.full_name))throw Error('Candidate name is required.');
     require('../lib/candidatePhoneGuard').validateInput(patch.phone??target?.phone,{required:true});
    }catch(e){problem=e.message;}
   }
   if(!problem&&d.key==='profiles'&&!target){
    const phone=workPhone(patch.phone);
    if(claimed.has('phone:'+phone))problem='More than one new profile has this phone number.';
    claimed.add('phone:'+phone);
   }
   if(!problem&&d.key==='notes'){
    if(!String(patch.body??target?.body??'').trim())problem='A note cannot be empty.';
    if(!target&&(row.values.parent_note_id||row.values.reply_to_note_id))problem='Thread replies must be moved with the Full CRM backup.';
   }
   if(!problem&&d.key==='tasks'&&!String(patch.title??target?.title??'').trim())problem='A task needs a title.';
   if(!problem&&d.key==='pipeline'){
    if(target&&['interview_datetime','joining_date','selection_date','joined_date','submission_date','status','payout_status'].some(k=>k in patch&&!patch[k]))problem='Keep existing stage and date history. Set the revised value or leave it unchanged.';
    if(!problem&&'payout_days'in patch&&(!/^\d+$/.test(patch.payout_days)||Number(patch.payout_days)<1||Number(patch.payout_days)>365))problem='Payment after joining must be 1 to 365 days.';
    if(!problem&&target&&['client_name','process','location'].some(k=>k in patch))problem='Add another interview to change client, process or location.';
    if(!problem)problem=require('./revenueHubController').workingCopyStageError(patch,target||{});
    if(!problem&&!target&&['client_name','process','location','interview_mode','interview_datetime'].some(k=>!String(patch[k]||'').trim()))problem='Enter the client, process, location, interview mode and interview date/time.';
   }
   if(problem){issue(d,row,problem);continue;}
   const seed=target?null:Object.fromEntries(d.columns.filter(c=>c.key==='jd_id'||c.key==='created_at'||c.key==='submitted_at'||c.key==='note_type'||c.key==='username'||c.key==='interview_date'||c.key==='effective_submission_at'||row.base&&['approval_status','approved_at','approved_by_name','approval_requested_at','rejected_at'].includes(c.key)).map(c=>[c.key,row.values[c.key]]).filter(([,v])=>v));
   ops.push({sheet:d.key,id:recordId,parent,expected,patch,seed,owner:owner||null,add:!target});
   tally[target?'updated':'new']++;
   if(ops.length>workingEditRows)throw fail('This upload changes more than 5,000 rows. Use smaller date ranges.',413);
  }
 }
 return {counts,conflicts,problems,ops};
}

async function lockWorkingRows(ops){
 const groups=new Map();
 const add=(d,id)=>{
  if(!id||id.startsWith('@'))return;
  if(!groups.has(d.key))groups.set(d.key,new Set());
  groups.get(d.key).add(id);
 };
 const profile=workingByKey.get('profiles');
 for(const op of ops){
  add(profile,op.parent);
  if(!op.add)add(workingByKey.get(op.sheet),op.id);
 }
 // Candidate locks must precede child locks, the same order as a CRM save.
 for(const d of workingSheets){
  const ids=[...(groups.get(d.key)||[])].sort();
  for(let i=0;i<ids.length;i+=500)await store.query('select '+quote(d.pk)+' from public.'+quote(d.table)+' where '+quote(d.pk)+'::text=any($1::text[]) order by '+quote(d.pk)+' for update',[ids.slice(i,i+500)]);
 }
}
const actorId=user=>String(user.user_id||user.username||'');
const staffName=owner=>String(owner.full_name||owner.username||'');
function workDay(value){
 return new Date(Date.parse(value)+19800000).toISOString().slice(0,10);
}
async function applyWorkingOp(req,op,newProfiles,stamp,notesToCheck){
 const d=workingByKey.get(op.sheet),user=person(req),parent=newProfiles.get(op.parent)||op.parent;
 const owner=op.owner||user,patch={...op.patch};
 if(d.key==='profiles'){
  if('phone'in patch)patch.phone=require('../lib/candidatePhoneGuard').validateInput(patch.phone,{required:true});
  if(op.add){
   const client=require('../lib/store').activeTransactionClient();
   await require('../lib/candidatePhoneGuard').assertUnique(patch.phone,'',client);
   const id=await require('./candidateController').allocateCandidateId(client);
   await store.insert(d.table,{...patch,candidate_id:id,recruiter_user_id:actorId(owner),recruiter_code:owner.recruiter_code||'',recruiter_name:staffName(owner),user_id:actorId(owner),created_by_user_id:actorId(user),created_by_name:staffName(user),created_at:op.seed.created_at||stamp,updated_at:stamp,bucket_state:'working'});
   newProfiles.set(op.id,id);
   return;
  }
  if('full_name'in patch||'phone'in patch){
   const row=await store.findById(d.table,d.pk,op.id);
   return require('../lib/candidateIdentityGuard').withManagerCorrection({...req,user,body:{_client_base_values:{full_name:row.full_name,phone:row.phone},identity_correction_reason:'Confirmed Working Copy import'}},row,patch,()=>store.update(d.table,d.pk,op.id,{...patch,updated_at:stamp}));
  }
 }
 if(d.key==='pipeline'){
  if(!op.add){
   // Use the ordinary pipeline state transition for date/status/payout changes
   // so the current candidate and the Pipeline Hub continue to agree.
   const controller=require('./revenueHubController'),workflow={...patch};
   delete workflow.feedback_note;delete workflow.feedback_status;
   if(Object.keys(workflow).length)await require('../lib/store').callController(controller.updateStatus,{...req,user,params:{revenueId:op.id},body:workflow});
   const feedback=Object.fromEntries(['feedback_status','feedback_note'].filter(k=>k in patch).map(k=>[k,patch[k]]));
   if(Object.keys(feedback).length)await store.update(d.table,d.pk,op.id,{...feedback,feedback_updated_at:stamp,updated_at:stamp});
   return;
  }
  const candidate=await store.findById('candidates','candidate_id',parent);
  const defaultTerms=require('../lib/pipelineCatalog').terms(patch.client_name,patch.location,patch.process);
  const status=patch.status||'will_come_for_interview',today=workDay(stamp);
  const row={...patch,revenue_id:op.id,candidate_id:parent,full_name:candidate.full_name,phone:candidate.phone,email:candidate.email||'',
   recruiter_user_id:op.owner?actorId(owner):candidate.recruiter_user_id||candidate.user_id||actorId(user),
   recruiter_name:op.owner?staffName(owner):candidate.recruiter_name||staffName(user),
   recruiter_code:op.owner?owner.recruiter_code:candidate.recruiter_code||'',
   status,payout_status:patch.payout_status||'payout_pending',payout_amount:patch.payout_amount??String(defaultTerms.payout_amount),
   payout_days:patch.payout_days??String(defaultTerms.payout_days),payout_duration_days:String(defaultTerms.payout_duration_days),
   invoice_lead_days:String(defaultTerms.invoice_lead_days),interview_date:patch.interview_datetime?workDay(patch.interview_datetime):op.seed.interview_date||'',
   joined_date:patch.joined_date||(['joined','completed_60_days'].includes(status)?today:''),selection_date:patch.selection_date||(['selected','pending_joining'].includes(status)?today:''),
   arrived_at:status==='appeared_for_interview'?stamp:'',payout_received_at:patch.payout_status==='payout_received'?stamp:'',
   created_at:op.seed.created_at||stamp,created_by_user_id:actorId(user),updated_at:stamp};
  const saved=await store.insert(d.table,row);
  await require('./revenueHubController').workingCopySyncPipeline(parent,req,saved);
  return;
 }
 if(!op.add){
  if(d.key==='notes'){
   const old=await store.findById(d.table,d.pk,op.id);
   notesToCheck.push({parent,before:old.body,after:patch.body,type:old.note_type});
  }
  await store.update(d.table,d.pk,op.id,{...patch,updated_at:stamp});
  return;
 }
 const row={...op.seed,...patch,[d.pk]:op.id,candidate_id:parent||'',created_at:op.seed.created_at||stamp,updated_at:stamp};
 if(d.key==='submissions'){
  const candidate=await store.findById('candidates','candidate_id',parent);
  Object.assign(row,{submitted_by_user_id:op.owner?actorId(owner):candidate.recruiter_user_id||candidate.user_id||actorId(user),
   submitted_by_name:op.owner?staffName(owner):candidate.recruiter_name||staffName(user),
   recruiter_code:op.owner?owner.recruiter_code||'':candidate.recruiter_code||'',
   submitted_by_recruiter_code:op.owner?owner.recruiter_code||'':candidate.recruiter_code||'',
   approval_status:op.seed.approval_status||'Pending',submitted_at:row.submitted_at||stamp,effective_submission_at:row.effective_submission_at||row.submitted_at||stamp});
 }
 if(d.key==='notes'){
  row.username=user.username;
  row.note_type=norm(row.note_type)==='private'?'private':'public';
  notesToCheck.push({parent,after:row.body,type:row.note_type,added:true});
 }
 if(d.key==='tasks')Object.assign(row,{assigned_to_user_id:actorId(owner),assigned_to_code:owner.recruiter_code||'',assigned_to_name:staffName(owner),assigned_by_user_id:actorId(user),assigned_by_name:staffName(user),status:patch.status||'Open'});
 await store.insert(d.table,row);
}
let pendingWork=null;
const workHashProof=(ops,instances)=>workOpDigest([instances,ops]);
async function downloadWorking(req,res){
 guard(req);
 const format=String(req.body?.format||'xlsx');
 if(!['xlsx','csv'].includes(format))throw fail('Choose Excel or CSV.',400);
 const password=workPassword(req.body?.file_password),snapshot=await workSnapshot(workRange(req.body));
 const file=Buffer.from(await book.runWorkingFileJob('export',{snapshot,format,password}));
 const name='Career_Crox_Working_Copy_'+new Date().toISOString().slice(0,10)+(format==='xlsx'?'.xlsx':'_CSV.zip');
 res.set({'Content-Type':format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/zip','Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'private, no-store'});
 return res.send(file);
}
async function previewWorking(req,res){
 guard(req);
 const raw=String(req.get('X-CRM-File-Password')||'');
 if(!/^[A-Za-z0-9_-]{1,512}$/.test(raw)||!Buffer.isBuffer(req.body))throw fail('Choose the password-protected Working Copy file.',400);
 const password=workPassword(Buffer.from(raw,'base64url').toString('utf8'));
 let file;
 try{file=await book.runWorkingFileJob('import',{file:req.body,password,definitions:workingSheets});}
 catch(error){throw fail(error.message,400);}
 if(!new RegExp(workId,'i').test(String(file.origin))||!Number.isFinite(Date.parse(file.created)))throw fail('The workbook has an invalid source CRM or snapshot date.',400);
 const plan=await withTransaction(()=>workPlan(file),{readOnly:true,deadlineMs:65000});
 const summary={counts:plan.counts,conflicts:plan.conflicts,conflict_count:plan.problems,changes:plan.ops.length};
 if(!plan.problems&&plan.ops.length){
  const key=crypto.randomUUID(),digest=workHashProof(plan.ops,file.origin);
  const timer=setTimeout(()=>{if(pendingWork?.key===key)pendingWork=null;},600000);
  timer.unref?.();
  pendingWork={key,file,ops:plan.ops,digest,expires:Date.now()+600000};
  summary.review=ticket(req,'working-copy',key,600000);
 }
 res.setHeader('Cache-Control','private, no-store');
 return res.json(summary);
}
async function applyWorking(req,res){
 guard(req);
 const key=verifyTicket(req,'working-copy',req.body?.review),pending=pendingWork;
 if(!pending||key!==pending.key||pending.expires<Date.now())throw fail('The preview expired. Preview the file again.');
 const saved=await withTransaction(async()=>{
  await store.query('select pg_advisory_xact_lock(hashtext($1))',['cc206-working-copy-apply']);
  await lockWorkingRows(pending.ops);
  const plan=await workPlan(pending.file);
  if(plan.problems||workHashProof(plan.ops,pending.file.origin)!==pending.digest)throw fail('The destination changed after preview. Preview this file again.');
  const newProfiles=new Map(),stamp=new Date().toISOString(),notesToCheck=[];
  for(const op of plan.ops)await applyWorkingOp(req,op,newProfiles,stamp,notesToCheck);
  for(const {parent,before,after,type,added} of notesToCheck){
   if(norm(type)==='private'||!after)continue;
   await store.query("update public.candidates set notes=$2,updated_at=$3 where candidate_id=$1 and (coalesce(notes,'')=$4 or ($5::boolean and coalesce(notes,'')=''))",[parent,after,stamp,before||'',!!added]);
  }
  return plan.ops.length;
 },{deadlineMs:75000});
 if(pendingWork?.key===key)pendingWork=null;
 clearAllCaches(['candidates','candidate-detail','reminders','revenue','reports','approvals','mobile-work-items']);
 res.setHeader('Cache-Control','private, no-store');
 return res.json({ok:true,applied:saved});
}
Object.assign(module.exports,{
 downloadWorking:(req,res)=>backupWork('Working Copy download',()=>downloadWorking(req,res)),
 previewWorking:(req,res)=>backupWork('Working Copy verification',()=>previewWorking(req,res)),
 applyWorking:(req,res)=>backupWork('Working Copy import',()=>applyWorking(req,res)),
});
Object.assign(module.exports._test,{workingSheets,workSnapshot,workPlan,downloadWorking,previewWorking,applyWorking});
