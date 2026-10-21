'use strict';
// CC879 - receiver compatibility for legacy activity identities; CC878 transfer safeguards retained.
const crypto=require('crypto');
const {store,TABLES,withTransaction}=require('../lib/store');
const book=require('../lib/crmExcelWorkbook');
const {reconcileBackup}=require('../lib/backupRestoreCompat');
const {adaptActivitySchema,integerId,sameKey}=require('../lib/fullExcelSchemaCompat');
const {clearAllCaches}=require('../lib/cache');
const {JWT_SECRET}=require('../config/env');
const {canonicalRole}=require('../lib/accessRules');
const mediaTables=new Set(['candidate_files','candidate_file_contents','recording_files','jd_documents','user_onboarding_documents','hr_document_templates','hr_document_runs','mobile_app_releases','important_resources']);
const runtimeTables=new Set(['active_sessions','mobile_devices','live_call_state','generated_downloads','chat_notification_jobs','crm_command_receipts','password_reset_requests','egress_budget_daily','dialer_sessions','dialer_queue_items','user_onboarding_requests']);
const omitted=new Set([...mediaTables,...runtimeTables]);
const userColumns=new Set(['password','password_hash','email','employee_id','created_at','updated_at','theme_name','theme_config','user_id','username','full_name','role','designation','recruiter_code','tl_user_id','tl_code','tl_name','manager_user_id','manager_code','manager_name','team_id','reporting_to','is_active']);
const teamColumns=['tl_user_id','tl_code','tl_name','manager_user_id','manager_code','manager_name','team_id','reporting_to'];
const mediaKey=/^(?:(?:file|files|resume|resumes|recording|recordings|audio|attachment|attachments|blob|binary|photo|image)(?:$|_)|video_(?:data|base64|bytes|content|blob|binary)$|document_binary|document_data|signature_)/i;
const secretKey=/(password|secret|token|credential|private[_-]?key|api[_-]?key|otp[_-]?secret|session[_-]?key)/i;
const settingsSecret=/(password|secret|token|session|credential|private|api[_-]?key|smtp|supabase|cc874|backup|passcode|auth|oauth|recording|resume|storage|instance|provider)/i;
const stateKey='cc876_full_excel_backup_reminder',core=['users','candidates','tasks','notes','submissions','interviews','notifications'];
const quote=x=>'"'+String(x).replace(/"/g,'""')+'"',norm=x=>String(x==null?'':x).trim().toLowerCase();
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const sha=x=>book.sha(Buffer.isBuffer(x)?x:Buffer.from(String(x)));
let restoring=false;
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
function safeSetting(table,row){return !['settings','app_settings'].includes(table)||!settingsSecret.test(String(table==='settings'?row.setting_key:row.key))&&row.key!==stateKey;}
async function metadata(q){
 const names=[...TABLES].filter(t=>!omitted.has(t)).sort(),schema=Object.create(null);
 const cols=await q('select table_name,column_name,udt_name from information_schema.columns where table_schema=$1 and table_name=any($2::text[]) order by table_name,ordinal_position',['public',names]);
 const keys=await q("select k.table_name,k.column_name from information_schema.key_column_usage k join information_schema.table_constraints c on c.constraint_name=k.constraint_name and c.table_schema=k.table_schema and c.table_name=k.table_name where k.table_schema='public' and c.constraint_type='PRIMARY KEY' and k.table_name=any($1::text[]) order by k.table_name,k.ordinal_position",[names]);
 for(const c of cols){if(!schema[c.table_name])schema[c.table_name]={columns:[],primary_key:[]};if(allowedField(c.table_name,{name:c.column_name,type:c.udt_name}))schema[c.table_name].columns.push({name:c.column_name,type:c.udt_name});}
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
  const q=async(s,p=[])=>(await client.query(s,p)).rows,schema=await metadata(q),tables=Object.create(null);let count=0,size=0;
  for(const [name,spec]of Object.entries(schema)){
   const columns=spec.columns.map(c=>c.name),order=spec.primary_key.map(quote).join(','),rows=[];let cursor=null;
   for(;;){
    const where=cursor?'where ('+order+') > ('+spec.primary_key.map((_,i)=>'$'+(i+1)).join(',')+')':'';
    const page=await q('select '+columns.map(quote).join(',')+' from public.'+quote(name)+' '+where+' order by '+order+' limit 500',cursor||[]);
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
 return {last_saved_at:data.last_saved_at||null,next_due_at:new Date(next).toISOString(),snooze_until:data.snooze_until||null,due:now>=next&&!(Number.isFinite(snooze)&&now<snooze),overdue:now>=next,days_without_backup:Math.floor(Math.max(0,now-last)/86400000),server_now:new Date(now).toISOString()};
}
async function reminder(req,res){guard(req);res.setHeader('Cache-Control','private, no-store');return res.json({ok:true,reminder:reminderPayload(await state())});}
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
  if(s.columns.length!==d.columns.length||s.columns.some(c=>{
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
async function fingerprint(q,schema){
 const parts=[];
 for(const [t,s]of Object.entries(schema)){
  const rows=await q('select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(r)::text),\'\' order by '+s.primary_key.map(k=>'r.'+quote(k)).join(',')+'),\'\')) digest from public.'+quote(t)+' r');
  parts.push([t,Number(rows[0].n),rows[0].digest]);
 }
 return {digest:sha(JSON.stringify(parts)),counts:Object.fromEntries(parts.map(([t,n])=>[t,n]))};
}
async function prepare(req,payload){
 const q=(s,p=[])=>store.query(s,p),schemaBefore=await metadata(q);
 if(!payload.schema?.users?.columns?.some(c=>['password','password_hash'].includes(c.name)))throw fail('This older Excel does not include staff login hashes. Update the source to CC878 and download a new Full CRM Excel.');
 // Validate the original identities before adapting anything. Validate the
 // destination identities again after mapping, before any destructive write.
 validateShape(payload,payload.schema);
 const compatible=adaptActivitySchema(payload,schemaBefore),target=compatible.target;
 payload=compatible.payload;
 validateShape(payload,target);
 const roster=await store.all('users'),byLogin=new Map();
 for(const u of roster){const k=norm(u.username);if(byLogin.has(k))throw fail('Duplicate destination employee username: '+k);byLogin.set(k,u);}
 const sourceUsers=payload.tables.users;
 if(!sourceUsers.some(u=>['manager','admin'].includes(canonicalRole(u.role,u.designation))&&!['0','false','inactive','no'].includes(norm(u.is_active))))throw fail('Transfer must contain an active Manager account.');
 for(const u of sourceUsers){
  const hash=u.password||u.password_hash;
  if(!hash||typeof hash!=='string'||hash.length>1000||require('../lib/security').passwordNeedsUpgrade(hash))throw fail('Employee login hashes are missing or invalid. Download a fresh Full CRM Excel from CC878.');
 }
 const clean={...payload,tables:Object.fromEntries(Object.entries(payload.tables).map(([t,rows])=>[t,rows.filter(r=>safeSetting(t,r)).map(r=>transferableRow(t,r))]))};
 const mapped=reconcileBackup(clean,roster,target,{transfer:true});
 validateShape(mapped.payload,target);
 // Team links are already rewritten by the same identity map as profiles/tasks.
 const teamRows=[];
 const ids=new Set(mapped.payload.tables.candidates.map(r=>String(r.candidate_id)));
 for(const [t,rows]of Object.entries(mapped.payload.tables))for(const row of rows)if(t!=='candidates'&&row.candidate_id&&!ids.has(String(row.candidate_id))&&t!=='candidate_reset_archive'&&t!=='crm_candidate_id_registry'&&!/audit|log|history/.test(t))throw fail('Related '+t+' record has no candidate: '+row.candidate_id);
 const destination=await fingerprint(q,schemaBefore);
 return {mapped,target,schemaBefore,additions:compatible.additions,teamRows,destination,summary:{schema_compatibility:'CC879 activity-log ID compatibility',columns_added_on_restore:compatible.additions.map(c=>c.table+'.'+c.name),tables:Object.keys(clean.tables).length,candidates:ids.size,tasks:clean.tables.tasks.length,followups:clean.tables.candidates.filter(r=>r.follow_up_at&&!/done|complete|cancel/i.test(r.follow_up_status||'')).length,reminders:clean.tables.notifications.length,interviews:clean.tables.interviews.length,submissions:clean.tables.submissions.length,notes:clean.tables.notes.length,staff_mapped:clean.tables.users.length,staff_created:sourceUsers.filter(u=>!byLogin.has(norm(u.username))).length,staff_replaced:roster.filter(u=>!sourceUsers.some(s=>norm(s.username)===norm(u.username))).length,credentials_included:true,existing_candidates:destination.counts.candidates||0,records:Object.entries(clean.tables).filter(([t])=>t!=='users').reduce((n,[,rows])=>n+rows.length,0),source_date:payload.created_at,files:0,employee_mapping:payload.tables.users.map(u=>({username:u.username,from_id:u.user_id,to_id:mapped.identities.get(String(u.user_id)),action:byLogin.has(norm(u.username))?'Update account & login':'Create account & login',profiles:clean.tables.candidates.filter(r=>String(r.recruiter_user_id)===String(u.user_id)||!r.recruiter_user_id&&norm(r.recruiter_code)===norm(u.recruiter_code)).length}))}};
}
async function preview(req,res){
 const payload=parse(req),p=await prepare(req,payload),digest=book.sha(req.body);res.setHeader('Cache-Control','private, no-store');
 return res.json({ok:true,sha256:digest,preview_token:ticket(req,'restore',{sha256:digest,destination:p.destination.digest,schema:sha(JSON.stringify(p.schemaBefore))}),summary:p.summary,warning:'Transfer replaces CRM records and staff accounts, including login passwords. Provider settings and this CRM transfer passcode stay local. Compatible legacy activity IDs are preserved; a missing activity_log.id column is added only during confirmed restore. All destination sessions are signed out; log in with a transferred account. No media is copied.'});
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
 if(restoring)throw fail('Another restore is already running.');restoring=true;
 try{
  const result=await withTransaction(async()=>{
   await store.query("set local lock_timeout='5s'");
   const schema=await metadata((s,p=[])=>store.query(s,p)),names=Object.keys(schema);
   await store.query('lock table '+names.map(t=>'public.'+quote(t)).join(',')+' in share row exclusive mode');
   const p=await prepare(req,payload);
   if(auth.destination!==p.destination.digest||auth.schema!==sha(JSON.stringify(p.schemaBefore)))throw fail('Destination records or employee accounts changed after preview. Preview again.');
   for(const c of p.additions)await store.query('alter table public.'+quote(c.table)+' add column '+quote(c.name)+' '+({text:'text',int8:'bigint'}[c.type]));
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
    const s=sourceSchema[t],cols=s.columns.map(c=>c.name),pk=p.target[t].primary_key,rows=tables[t].map(r=>portable(t,r)),updates=cols.filter(k=>!pk.includes(k));
    for(let i=0;i<rows.length;i+=100){
     const batch=rows.slice(i,i+100);
     await store.query('insert into public.'+quote(t)+' ('+cols.map(quote).join(',')+') select '+cols.map(quote).join(',')+' from jsonb_populate_recordset(null::public.'+quote(t)+',$1::jsonb) on conflict ('+pk.map(quote).join(',')+') '+(updates.length?'do update set '+updates.map(k=>quote(k)+'=excluded.'+quote(k)).join(','):'do nothing'),[JSON.stringify(batch)]);
     const equals=cols.map(k=>'d.'+quote(k)+' is not distinct from s.'+quote(k)).join(' and '),checked=await store.query('select count(*)::int n from jsonb_populate_recordset(null::public.'+quote(t)+',$1::jsonb) s join public.'+quote(t)+' d on '+equals,[JSON.stringify(batch)]);
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
   return {ok:true,counts,total:Object.values(counts).reduce((n,v)=>n+v,0),verified_candidates:counts.candidates||0,files:0,requires_login:true,restored_at:new Date().toISOString()};
  });
  clearAllCaches();
  try{const live=require('../lib/approvalLive'),users=await store.all('users');live.refreshStaffScopes(users);live.publishToUsers(users.map(u=>u.user_id),'access-changed',{source:'/data-backup/full-excel/restore',at:Date.now(),reload:true});live.publishReminderDirty({},{source:'/data-backup/full-excel/restore',at:Date.now()});require('../lib/multipleCrm').invalidateMode();}catch(e){console.warn('Restore committed; reconnect staff to refresh live views:',e.message);}
  try{require('../lib/approvalLive').disconnectAll?.();res.clearCookie?.('career_crox_token',require('../middleware/auth').authCookie());}catch{}
  return res.json(result);
 }finally{restoring=false;}
}
module.exports={download,preview,restore,reminder,snooze,saved,_test:{reminderPayload,allowedField,notMedia,transferableRow,exportData,prepare,metadata,validateShape,mediaTables,runtimeTables}};
