const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { store, TABLES, withTransaction } = require('../lib/store');
const { GENERATED_DIR } = require('../config/env');
const codec = require('../lib/backupCodec');
const { clearAllCaches } = require('../lib/cache');
const { reconcileBackup } = require('../lib/backupRestoreCompat');
const RUNTIME = new Set(['active_sessions', 'mobile_devices', 'live_call_state', 'generated_downloads', 'chat_notification_jobs']);
const quote = s => '"' + String(s).replace(/"/g, '""') + '"';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function manager(req) {
  if (!['manager','admin'].includes(String(req.user?.role || '').toLowerCase()) || req.user?.impersonator) throw fail('Manager backup access only.', 403);
  if (req.authDegraded || !store.pool) throw fail('A verified PostgreSQL session is required.', 503);
}
async function metadata(query) {
  const names = [...TABLES];
  const columns = await query('select table_name,column_name,udt_name,is_nullable,column_default from information_schema.columns where table_schema=\'public\' and table_name=any($1::text[]) order by table_name,ordinal_position', [names]);
  const keys = await query(`select k.table_name,k.column_name from information_schema.key_column_usage k join information_schema.table_constraints c on c.constraint_name=k.constraint_name and c.table_schema=k.table_schema and c.table_name=k.table_name where k.table_schema='public' and c.constraint_type='PRIMARY KEY' and k.table_name=any($1::text[]) order by k.table_name,k.ordinal_position`, [names]);
  const schema = Object.create(null);
  for (const c of columns) { schema[c.table_name] ||= { columns: [], primary_key: [] }; schema[c.table_name].columns.push({ name:c.column_name, type:c.udt_name }); }
  for (const k of keys) schema[k.table_name]?.primary_key.push(k.column_name);
  if (names.some(t => !schema[t])) throw fail('CRM schema is incomplete. Run the matching complete setup before backup or restore.', 409);
  return schema;
}
function relativeFile(value) {
  let pathname; try { pathname = new URL(String(value || ''), 'http://backup.local').pathname; } catch { return ''; }
  if (!pathname.startsWith('/generated/')) return '';
  const rel = decodeURIComponent(pathname.slice(11));
  if (!rel || rel.includes('..') || !/^[a-zA-Z0-9._/-]+$/.test(rel) || path.isAbsolute(rel)) throw fail('Unsafe attachment path in backup.');
  return rel;
}
function fileTarget(relative) {
  const rel = relativeFile('/generated/' + relative), target = path.resolve(GENERATED_DIR, rel);
  if (!target.startsWith(path.resolve(GENERATED_DIR) + path.sep)) throw fail('Invalid attachment path.');
  // No symlink directory may route a restore outside the generated-files area.
  let cursor = target;
  while (cursor.startsWith(path.resolve(GENERATED_DIR))) { if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw fail('Attachment path is a symbolic link.'); if (cursor === path.resolve(GENERATED_DIR)) break; cursor = path.dirname(cursor); }
  return target;
}
function attachments(tables) {
  const refs = new Set(), files = [], missing = []; let bytes = 0;
  for (const rows of Object.values(tables)) for (const row of rows) for (const field of ['file_url','preview_url','file_path']) { const rel = relativeFile(row[field]); if (rel) refs.add(rel); }
  for (const rel of refs) {
    const target = fileTarget(rel);
    if (!fs.existsSync(target)) { missing.push(rel); continue; }
    const info = fs.statSync(target);
    if (!info.isFile() || info.size > 16 * 1024 * 1024 || bytes + info.size > 32 * 1024 * 1024 || files.length >= 1024) throw fail('Generated attachments exceed this backup limit (32 MB total / 16 MB each).', 413);
    const data = fs.readFileSync(target); bytes += data.length;
    files.push({ path:rel, base64:data.toString('base64'), sha256:codec.sha(data) });
  }
  return { files, missing_attachments:missing };
}
async function snapshot() {
  const client = await store.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const query = async (sql,p=[]) => (await client.query(sql,p)).rows;
    const schema = await metadata(query), tables = Object.create(null); let total = 0, byteBudget=0;
    for (const [t, spec] of Object.entries(schema)) {
      tables[t]=[];if(!RUNTIME.has(t)){if(!spec.primary_key.length)throw fail('Backup table has no stable key: '+t,409);let last=null;const order=spec.primary_key.map(quote).join(',');for(;;){const page=await query(`select * from public.${quote(t)} ${last?'where ('+order+') > ('+spec.primary_key.map((_,i)=>'$'+(i+1)).join(',')+')':''} order by ${order} limit 250`,last||[]);byteBudget+=Buffer.byteLength(JSON.stringify(page));if(byteBudget>256*1024*1024)throw fail('Backup exceeds the 256 MB in-memory safety limit. Use a database-level export for this dataset.',413);tables[t].push(...page);if(tables[t].length>100000)throw fail('Backup row limit exceeded',413);if(page.length<250)break;last=spec.primary_key.map(k=>page.at(-1)[k]);}}
      if (tables[t].length > 100000 || (total += tables[t].length) > 1000000) throw fail('Backup row limit exceeded.', 413);
      for (const row of tables[t]) for (const c of spec.columns) if (Buffer.isBuffer(row[c.name])) row[c.name] = '\\x' + row[c.name].toString('hex');
    }
    const fileData = attachments(tables);
    await client.query('COMMIT');
    return { candidate_id_highwater:Number((await query("select case when is_called then last_value else 0 end as n from public.crm_candidate_id_seq"))[0]?.n)||0,format:'career-crox-data', version:1, build:'CC861', created_at:new Date().toISOString(), schema, tables, runtime_excluded:[...RUNTIME], ...fileData };
  } catch (e) { await client.query('ROLLBACK').catch(()=>{}); throw e; }
  finally { client.release(); }
}
async function download(req,res) {
  manager(req);
  let secret=String(req.body?.passphrase||'');const managerMode=typeof req.body?.manager_password==='string';if(managerMode){const account=await store.findById('users','user_id',req.user.user_id);if(!require('../lib/security').verifyPassword(account?.password||account?.password_hash||'',req.body.manager_password))throw fail('Manager password is incorrect.',401);secret='CC828_MANAGER_BACKUP:'+req.body.manager_password;}
  const payload=await snapshot(),envelope=await codec.seal(payload,secret);if(managerMode)envelope.password_mode='manager_login_v1';
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Disposition',`attachment; filename="Career_Crox_${payload.created_at.slice(0,10)}_CC861.ccbackup"`);
  res.setHeader('Content-Type','application/octet-stream');
  return res.send(Buffer.from(JSON.stringify(envelope)));
}
function validate(payload, target) {
  if (payload?.format !== 'career-crox-data' || payload.version !== 1 || !payload.schema || !payload.tables) throw fail('Unsupported backup data.');
  let total = 0;
  for (const [t, rows] of Object.entries(payload.tables)) {
    if (!Array.isArray(rows) || !payload.schema[t]) throw fail(`Unsupported table: ${t}`);
    if (!TABLES.has(t) || !target[t]) { if (!rows.length) continue; throw fail(`Backup contains records for unsupported table ${t}. Install a compatible CRM schema before restoring.`,409); }
    if (RUNTIME.has(t) && rows.length) throw fail('Active sessions and device pairing cannot be restored.');
    const spec = payload.schema[t], key = target[t].primary_key;
    if (!key.length || JSON.stringify(key) !== JSON.stringify(spec.primary_key)) throw fail(`Primary key differs for ${t}. Use the matching CRM schema.`,409);
    const allowed = new Set(target[t].columns.map(c=>c.name));
    if (!Array.isArray(spec.columns) || spec.columns.some(c=>!allowed.has(c.name))) throw fail(`Missing destination columns in ${t}. Use the matching complete setup.`,409);
    if (rows.length > 100000 || (total += rows.length) > 1000000) throw fail('Backup row limit exceeded.',413);
    const ids = new Set(), declared = new Set(spec.columns.map(c=>c.name));
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(k=>!declared.has(k))) throw fail(`Invalid row or unrecognised columns in ${t}.`);
      const identity = key.map(k=>row[k]);
      if (identity.some(v=>v==null || String(v)==='')) throw fail(`Missing identity in ${t}.`);
      const id = JSON.stringify(identity); if (ids.has(id)) throw fail(`Duplicate identity in backup table ${t}.`); ids.add(id);
    }
  }
  if (!Array.isArray(payload.tables.users) || !Array.isArray(payload.tables.candidates)) throw fail('This backup is missing its users or candidates table.');
  if (!Array.isArray(payload.files) || payload.files.length > 1024) throw fail('Invalid attachment list.');
  let bytes = 0; const seen = new Set();
  for (const file of payload.files) {
    fileTarget(file.path); const data = Buffer.from(String(file.base64 || ''),'base64');
    if (seen.has(file.path) || data.length > 16*1024*1024 || (bytes += data.length) > 32*1024*1024 || codec.sha(data)!==file.sha256) throw fail('Invalid or damaged attachment.');
    seen.add(file.path);
  }
  return total;
}
async function verifyBusinessData() {
  if ((await store.query(`select upper(trim(candidate_id)) from candidates group by upper(trim(candidate_id)) having count(*)>1 limit 1`)).length) throw fail('Candidate IDs would conflict.',409);
  const active = "lower(trim(coalesce(status,'')))<>'deleted' and coalesce(trim(deleted_at),'')=''";
  // CC874: each revenue_id is a separate legitimate interview attempt.
  if ((await store.query(`select r.revenue_id from revenue_hub_entries r where ${active} and not exists(select 1 from candidates c where upper(trim(c.candidate_id))=upper(trim(r.candidate_id))) limit 1`)).length) throw fail('Revenue references a missing candidate.',409);
  for (const t of ['notes','submissions','interviews','candidate_jd_feedback']) if ((await store.query(`select candidate_id from ${quote(t)} r where coalesce(trim(candidate_id),'')<>'' and not exists(select 1 from candidates c where c.candidate_id=r.candidate_id) limit 1`)).length) throw fail(`${t} references a missing candidate.`,409);
}
async function restore(req,res) {
  manager(req);
  const envelope = req.body?.backup, command = String(req.body?.command_id || '');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(command)) throw fail('Restore command identity is required.');
  const sourcePayload = await codec.open(envelope,String(req.body?.passphrase || '')), hash = envelope.sha256;
  let restoredPayload = sourcePayload;
  const created = [];
  const result = await withTransaction(async () => {
    await store.query("SET LOCAL lock_timeout='15s'");
    await store.query("SET LOCAL statement_timeout='5min'");
    await store.query("select pg_advisory_xact_lock(hashtext('CC787-backup-restore'))");
    const receiptKey = 'restore:' + command;
    const old = await store.findById('crm_command_receipts','command_id',receiptKey);
    if (old) { if (old.user_id!==req.user.user_id || old.payload_hash!==hash) throw fail('Restore identity was already used for another backup.',409); return {...JSON.parse(old.receipt_json),replayed:true}; }
    const target = await metadata((q,p=[])=>store.query(q,p));
    validate(sourcePayload,target);
    await store.query('lock table public.users in share row exclusive mode');
    const roster = await store.query('select * from public.users');
    const reconciled = reconcileBackup(sourcePayload,roster,target);
    const payload = reconciled.payload; restoredPayload = payload;
    const total = validate(payload,target);
    await store.query('select pg_advisory_xact_lock($1)',[2644001]);
    await store.query("select set_config('career_crox.restore_mode','on',true)");
    const tables = Object.keys(target).filter(t=>Array.isArray(payload.tables[t])).sort();
    await store.query(`lock table ${tables.map(t=>'public.'+quote(t)).join(',')} in share row exclusive mode`);
    const triggers = await store.query("select tgname,c.relname,tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and tgname=any($1::text[])",[['cc782_bucket_capacity','cc782_revenue_identity']]);
    for (const tr of triggers) await store.query(`alter table public.${quote(tr.relname)} disable trigger ${quote(tr.tgname)}`);
    let complete=false;
    try {
      const ordered = ['users','settings','candidates'].filter(t=>tables.includes(t)).concat(tables.filter(t=>!['users','settings','candidates'].includes(t)));
      const counts = {};
      for (const t of ordered) {
        if (RUNTIME.has(t)) continue;
        let rows = payload.tables[t].map(row=>({...row}));
        // Keep the currently authenticated manager's credentials and identity intact.
        if (t==='users') rows=rows.filter(row=>row.user_id!==req.user.user_id && row.username!==req.user.username);
        if (t==='presence') rows=rows.map(row=>({...row,is_on_break:'0',locked:'0',lock_reason:'',break_started_at:'',break_expected_end_at:'',activity_credit_at:new Date().toISOString()}));
        if (t==='dialer_sessions') rows=rows.map(row=>({...row,status:'Stopped',mobile_command:'stop',command_type:'stop'}));
        if (t==='crm_command_receipts') rows=rows.filter(row=>row.command_id!==receiptKey);
        const spec = payload.schema[t], cols = spec.columns.map(c=>c.name), pk = target[t].primary_key;
        const changes = ['crm_candidate_id_registry','crm_candidate_phone_claims','crm_candidate_audit'].includes(t)?[]:cols.filter(c=>!pk.includes(c));
        for (let i=0;i<rows.length;i+=250) await store.query(`insert into public.${quote(t)} (${cols.map(quote).join(',')}) select ${cols.map(quote).join(',')} from jsonb_populate_recordset(null::public.${quote(t)},$1::jsonb) on conflict (${pk.map(quote).join(',')}) ${changes.length?'do update set '+changes.map(c=>`${quote(c)}=excluded.${quote(c)}`).join(','):'do nothing'}`,[JSON.stringify(rows.slice(i,i+250))]);
        counts[t]=rows.length;
      }
      await store.query('select public.crm_reconcile_candidate_sequence($1)',[Number(sourcePayload.candidate_id_highwater)||0]);
      await verifyBusinessData();
      for (const [t,spec] of Object.entries(target)) for (const c of spec.columns) if (['int8','int4','int2'].includes(c.type)) {
        const seq=await store.scalar('select pg_get_serial_sequence($1,$2) value',['public.'+t,c.name]);
        if (seq) await store.query(`select setval($1::regclass,greatest(coalesce((select max(${quote(c.name)}) from public.${quote(t)}),1),1),true)`,[seq]);
      }
      for (const file of payload.files) {
        const dest = fileTarget(file.path), data = Buffer.from(file.base64,'base64');
        if (fs.existsSync(dest)) { if (codec.sha(fs.readFileSync(dest))!==file.sha256) throw fail('An attachment filename already exists with different contents.',409); continue; }
        fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,data,{flag:'wx'}); created.push(dest);
      }
      await store.query('delete from active_sessions where username<>$1',[req.user.username]);
      await store.query('delete from mobile_devices');
      await store.query('delete from live_call_state');
      await store.query('delete from chat_notification_jobs');
      const value={ok:true,counts,total_rows:total,files:payload.files.length,missing_attachments:payload.missing_attachments||[],mode:'merge',identity:reconciled.identity,restored_at:new Date().toISOString()};
      await store.insert('crm_command_receipts',{command_id:receiptKey,user_id:req.user.user_id,candidate_id:'',payload_hash:hash,receipt_json:JSON.stringify(value),created_at:value.restored_at});
      complete=true;
      return value;
    } finally { if(complete)for (const tr of triggers) await store.query(`alter table public.${quote(tr.relname)} ${{D:'disable',R:'enable replica',A:'enable always'}[tr.tgenabled]||'enable'} trigger ${quote(tr.tgname)}`); }
  }).catch(error=>{for (const p of created)try{fs.unlinkSync(p);}catch{} throw error;});
  clearAllCaches();
  // Other restored accounts must verify their credentials again; do not keep old streams alive.
  const recent = require('../lib/recentHumanActivity');
  for (const u of restoredPayload.tables.users) if(u.user_id!==req.user.user_id) recent.markInactive(u);
  require('../lib/approvalLive').publishReminderDirty({}, {source:'/data-backup/restore',at:Date.now()});
  return res.json(result);
}
const CANDIDATE_TABLES=['crm_candidate_id_registry','candidates','notes','submissions','interviews','candidate_jd_feedback','revenue_hub_entries'];
const CANDIDATE_KEYS={crm_candidate_id_registry:'candidate_id',candidates:'candidate_id',notes:'id',submissions:'submission_id',interviews:'interview_id',candidate_jd_feedback:'feedback_id',revenue_hub_entries:'revenue_id'};
function candidateManager(req){if(!['manager','admin'].includes(String(req.user?.role||'').toLowerCase())||req.user?.impersonator||req.authDegraded)throw fail('Verified manager access required.',403);}
async function candidateExcel(req,res){
  candidateManager(req);return withTransaction(async()=>{
  if(store.pool)await store.query('set transaction isolation level repeatable read');
  const tables={};
  for(const name of CANDIDATE_TABLES){tables[name]=store.pool?await store.query(`select * from public.${quote(name)} limit 100001`):await store.all(name);if(tables[name].length>100000)throw fail('Export more than 100,000 records in smaller batches.',413);}
  const users=(store.pool?await store.query('select user_id,username,full_name,recruiter_code,role,tl_user_id from users'):await store.all('users')).map(({user_id,username,full_name,recruiter_code,role,tl_user_id})=>({user_id,username,full_name,recruiter_code,role,tl_user_id}));
  const scopeKeys=['cc831_collaboration_projects','cc831_shared_form_layout'];const scope_settings=[];for(const key of scopeKeys){const row=await store.findById('app_settings','key',key);if(row)scope_settings.push({key,value:row.value});}
  res.setHeader('Cache-Control','no-store');return res.json({candidate_id_highwater:store.pool?Number((await store.query("select case when is_called then last_value else 0 end n from public.crm_candidate_id_seq"))[0]?.n)||0:0,format:'cc-candidate-workbook',version:1,created_at:new Date().toISOString(),tables,users,scope_settings});
  });
}
async function restoreCandidates(req,res){
  candidateManager(req);const payload=req.body?.workbook;if(payload?.format!=='cc-candidate-workbook'||payload.version!==1||!payload.tables||!Array.isArray(payload.tables.candidates))throw fail('Choose an original Career Crox candidate Excel backup.');
  let total=0;for(const [name,rows] of Object.entries(payload.tables)){if(!CANDIDATE_TABLES.includes(name)||!Array.isArray(rows)||(total+=rows.length)>500000)throw fail('Unsupported workbook table.');const ids=new Set();for(const row of rows){const key=row[CANDIDATE_KEYS[name]];if(!key||ids.has(String(key))||Object.keys(row).some(k=>!/^\w+$/.test(k)))throw fail('Missing or duplicate workbook identity in '+name);ids.add(String(key));}}
  const known=new Set(payload.tables.candidates.map(c=>c.candidate_id));for(const [name,rows] of Object.entries(payload.tables))if(!['candidates','crm_candidate_id_registry'].includes(name))for(const row of rows)if(row.candidate_id&&!known.has(row.candidate_id))throw fail('A related record has no candidate in this backup.');
  const result=await withTransaction(async()=>{
    const counts={},schema=store.pool?await metadata((q,p=[])=>store.query(q,p)):null;
    const roster=await store.all('users');const identityMap=new Map();for(const old of payload.users||[]){let matches=roster.filter(u=>String(u.user_id)===String(old.user_id)||u.recruiter_code&&String(u.recruiter_code).toLowerCase()===String(old.recruiter_code).toLowerCase());if(!matches.length&&old.username)matches=roster.filter(u=>String(u.username).toLowerCase()===String(old.username).toLowerCase());if(matches.length===1)identityMap.set(String(old.user_id),matches[0]);}for(const c of payload.tables.candidates){if(!c.recruiter_code&&!c.recruiter_user_id)continue;const member=identityMap.get(String(c.recruiter_user_id))||roster.find(u=>String(u.user_id)===String(c.recruiter_user_id)||u.recruiter_code&&String(u.recruiter_code).toLowerCase()===String(c.recruiter_code).toLowerCase());if(!member)throw fail('Restore the employee roster first; owner missing for '+c.full_name,409);c.recruiter_user_id=member.user_id;c.recruiter_code=member.recruiter_code;c.recruiter_name=member.full_name||member.username;}
    const ownerByCandidate=new Map(payload.tables.candidates.map(c=>[c.candidate_id,c]));for(const [name,rows] of Object.entries(payload.tables)){for(const row of rows){for(const key of Object.keys(row))if((key==='user_id'||key.endsWith('_user_id'))&&identityMap.has(String(row[key])))row[key]=identityMap.get(String(row[key])).user_id;const candidate=ownerByCandidate.get(row.candidate_id);if(name!=='candidates'&&candidate){for(const key of ['recruiter_user_id','recruiter_code','recruiter_name'])if(Object.hasOwn(row,key))row[key]=candidate[key]||'';}}}
    const scopeRows=payload.scope_settings||[];if(!Array.isArray(scopeRows)||scopeRows.length>2)throw fail('Invalid project settings in backup.');
    for(const setting of scopeRows){if(!['cc831_collaboration_projects','cc831_shared_form_layout'].includes(setting.key)||typeof setting.value!=='string'||setting.value.length>100000)throw fail('Invalid project settings in backup.');let value;try{value=JSON.parse(setting.value);}catch{throw fail('Invalid project settings JSON.');}
      if(setting.key==='cc831_collaboration_projects'){const mapId=id=>identityMap.get(String(id))?.user_id||String(id);value.projects=(value.projects||[]).map(p=>({...p,tl_ids:p.tl_ids.map(mapId),recruiter_ids:p.recruiter_ids.map(mapId),pairs:(p.pairs||[]).map(group=>group.map(mapId))}));value.solo_pairs=(value.solo_pairs||[]).map(p=>({...p,tl_id:mapId(p.tl_id),members:p.members.map(mapId)}));const valid=require('../lib/collaborationAccess').validateConfig(value,roster);const prior=await require('../lib/collaborationAccess').setting(setting.key);value={...valid,revision:(Number(prior.revision)||0)+1};}
      else{if(!Array.isArray(value.order)||value.order.length>80||value.order.some(k=>!/^[a-z_]{1,60}$/.test(k)))throw fail('Invalid shared layout in backup.');const prior=await require('../lib/collaborationAccess').setting(setting.key);value={order:value.order,revision:(Number(prior.revision)||0)+1};}
      await store.upsert('app_settings','key',{key:setting.key,value:JSON.stringify(value),updated_at:new Date().toISOString()});
    }
    let triggers=[];if(store.pool){await store.query("select pg_advisory_xact_lock(hashtext('cc814-candidate-restore'))");triggers=await store.query("select tgname,c.relname,tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and tgname=any($1::text[])",[['cc782_bucket_capacity','cc782_revenue_identity']]);for(const tr of triggers)await store.query(`alter table public.${quote(tr.relname)} disable trigger ${quote(tr.tgname)}`);}
    if(store.pool){await store.query('select pg_advisory_xact_lock($1)',[2644001]);await store.query("select set_config('career_crox.restore_mode','on',true)");}
    for(const name of [...CANDIDATE_TABLES].sort((a,b)=>Number(a==='crm_candidate_id_registry')-Number(b==='crm_candidate_id_registry'))){const rows=payload.tables[name]||[];counts[name]=rows.length;const key=CANDIDATE_KEYS[name];if(store.pool){const spec=schema[name],allowed=new Set(spec.columns.map(c=>c.name));for(const row of rows)if(Object.keys(row).some(k=>!allowed.has(k)))throw fail('Run 01_SAFE_STRUCTURE.sql first; destination columns differ in '+name,409);const cols=[...new Set(rows.flatMap(Object.keys))],changes=cols.filter(c=>c!==key);for(let i=0;i<rows.length;i+=200)await store.query(`insert into public.${quote(name)} (${cols.map(quote).join(',')}) select ${cols.map(quote).join(',')} from jsonb_populate_recordset(null::public.${quote(name)},$1::jsonb) on conflict (${quote(key)}) ${name==='crm_candidate_id_registry'?'do nothing':'do update set '+changes.map(c=>`${quote(c)}=excluded.${quote(c)}`).join(',')}`,[JSON.stringify(rows.slice(i,i+200))]);}else for(const row of rows)await store.upsert(name,key,row);}
    if(store.pool)for(const name of CANDIDATE_TABLES){for(const column of schema[name]?.columns||[]){const seq=(await store.query('select pg_get_serial_sequence($1,$2) as seq',['public.'+name,column.name]))[0]?.seq;if(seq)await store.query(`select setval($1::regclass,greatest(coalesce((select max(${quote(column.name)}) from public.${quote(name)}),1),1),true)`,[seq]);}}
    if(store.pool)await store.query('select public.crm_reconcile_candidate_sequence($1)',[Number(payload.candidate_id_highwater)||0]);
    for(const tr of triggers)await store.query(`alter table public.${quote(tr.relname)} ${{D:'disable',R:'enable replica',A:'enable always'}[tr.tgenabled]||'enable'} trigger ${quote(tr.tgname)}`);return counts;
  });clearAllCaches();const bus=require('../lib/approvalLive'),collab=require('../lib/collaborationAccess');const staff=await collab.roster();bus.refreshCollaborationScopes(await collab.state(),staff);bus.publishToUsers(staff.map(u=>u.user_id),'access-changed',{source:'/candidates/restore',at:Date.now()});bus.publishToUsers(staff.map(u=>u.user_id),'form-layout',await collab.setting(collab.UI_KEY));bus.publishReminderDirty({}, {source:'/candidates/restore',at:Date.now()});return res.json({ok:true,counts:result});
}
async function preflight(req,res){
 manager(req);const schema=await metadata((q,p)=>store.query(q,p));
 const estimates=await store.query("select c.relname as table_name,greatest(c.reltuples,0)::bigint as estimated_rows from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])",[[...TABLES]]);
 return res.json({ok:true,tables:Object.keys(schema).length,estimated_rows:estimates.reduce((n,r)=>n+Number(r.estimated_rows||0),0),message:'Schema is ready. Row estimates are approximate; backup download reads the actual records.'});
}
module.exports = { preflight, download, restore, snapshot, validate, RUNTIME, candidateExcel, restoreCandidates };
