const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const transactionContext = new AsyncLocalStorage();
const databaseRequestContext = new AsyncLocalStorage();
const { Pool } = require('pg');
const { DATABASE_URL, SEED_FILE, REQUIRE_POSTGRES } = require('../config/env');
const { clone } = require('./helpers');

const TABLES = new Set([
  'crm_draft_deletions','crm_usage_samples','crm_usage_alerts','crm_lost_profiles','crm_profile_access_requests',
  'crm_candidate_audit','crm_candidate_phone_claims','crm_candidate_id_registry','crm_candidate_drafts','crm_command_receipts','crm_candidate_submit_failures','chat_thread_read_state','chat_notification_jobs','generated_downloads','candidate_reset_archive',
  'users','candidates','tasks','notifications','jd_master','jd_documents','notes','messages','interviews','submissions',
  'active_sessions','presence','unlock_requests','activity_log','scheduled_reports','break_sessions','report_summaries','aaria_queue',
  'client_pipeline','client_requirements','revenue_entries','chat_groups','chat_group_members',
  'chat_user_state','settings','learning_progress','suggested_videos','interview_remove_requests','candidate_jd_feedback','revenue_hub_entries',
  'mail_templates','mail_drafts','mail_logs','candidate_files','yt_hub_playlists','yt_hub_videos','important_resources',
  'user_onboarding_requests','user_onboarding_documents','password_reset_requests',
  'hot_leads','bda_leads','bda_activities','hr_employees','hr_attendance_logs','hr_worklogs','hr_leave_logs','hr_stage_events','hr_document_templates','hr_document_runs','goal_post_targets','employee_daily_stats',
  'bulk_upload_history','mobile_devices','dialer_sessions','dialer_queue_items','manual_dialer_calls','call_logs','call_quality_events','recording_files','live_call_state','team_chat_messages','team_chat_threads','egress_budget_daily','employee_locations','candidate_file_contents','mobile_app_releases','crm_feature_flags','app_feature_flags','app_settings'
]);

const ALLOCATION_LOCK_FIELDS=['allocation_lock_until','allocation_lock_owner_id','allocation_lock_assigned_at','allocation_lock_request_id'];
function safeCandidateLockPatch(table,patch,options={}){if(table!=='candidates'||options.allocationDecision)return patch;const copy={...patch};for(const key of ALLOCATION_LOCK_FIELDS)delete copy[key];return copy;}
function safeTable(table) {
  if (!TABLES.has(table)) throw new Error(`Unsupported table ${table}`);
  return table;
}

function qident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function softDeletePatch(table, row = {}) {
  const stamp = new Date().toISOString();
  const patch = { updated_at: stamp };
  if (table === 'active_sessions') {
    patch.session_token = '';
    patch.status = 'Logged Out';
    patch.revoked_at = stamp;
    patch.logout_at = stamp;
    patch.last_seen_at = stamp;
    return patch;
  }
  if (table === 'settings') {
    patch.setting_value = '';
    patch.status = 'Inactive';
    patch.deleted_at = stamp;
    return patch;
  }
  if (table === 'chat_group_members') {
    patch.status = 'Removed';
    patch.removed_at = stamp;
    patch.deleted_at = stamp;
    return patch;
  }
  patch.status = row.status && String(row.status).toLowerCase() === 'inactive' ? row.status : 'Deleted';
  patch.deleted_at = stamp;
  return patch;
}


function noticeMutation(table,row){
 if(!['notifications','tasks','candidates'].includes(table))return;
 afterCommit(()=>{
  require('./cache').clearAllCaches(table==='notifications'?['notice-inbox','mobile-work-items','approvals','reminders']:['mobile-work-items','reminders']);
  if(table!=='notifications'||!row?.user_id||!row.notification_id)return;
  const unread=!['read','archived','deleted'].includes(String(row.status||'unread').toLowerCase());
  require('./approvalLive').publishToUsers([row.user_id],unread?'notification':'notification-read',unread?{item:row}:{notification_id:row.notification_id,user_id:row.user_id});
 }).catch(error=>console.error('Work notice delivery pending:',error.code||error.message));
}

class JsonStore {
  constructor(file) {
    this.file = file;
    this.state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }

  async all(table) {
    return clone(this.state[table] || []);
  }

  async findById(table, idField, id) {
    return clone((this.state[table] || []).find((row) => String(row[idField]) === String(id)) || null);
  }

  save() {
    const tx = transactionContext.getStore();
    if (tx?.active && !tx.client) { tx.dirty = true; return; }
    // Local tests persist one complete transaction, using an atomic rename.
    // A process restart never loads a half-written profile/notes/submission file.
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, 'w');
      fs.writeFileSync(descriptor, JSON.stringify(this.state, null, 2));
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor); descriptor = undefined;
      fs.renameSync(temporary, this.file);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  prepareRow(table,row,existing=null) {
    if(table==='candidates') {
      const normalize=require('./candidateIdentityGuard').normalizedPhone,key=normalize(row.phone);
      if(key&&(!existing||normalize(existing.phone)!==key)&&(this.state.candidates||[]).some(c=>c.candidate_id!==row.candidate_id&&normalize(c.phone)===key))throw Object.assign(new Error(require('./candidatePhoneGuard').message),{status:409,code:'DUPLICATE_PHONE'});
      if(String(row.approval_status || '').toLowerCase()==='pending' && String(existing?.approval_status || '').toLowerCase()!=='pending'
         && !String(row.notes || '').trim() && !(this.state.notes || []).some(note=>String(note.candidate_id)===String(row.candidate_id) && String(note.body || '').trim()))
        throw Object.assign(new Error('Add a profile note before Save & Submit. Save can keep a draft without notes.'),{code:'CC081'});
      const policy=require('./bucketPolicy');
      if(existing && String(row.bucket_state || '').toLowerCase()==='fresh' && String(existing.bucket_state || '').toLowerCase()!=='fresh')
        row={...row,bucket_state:existing.bucket_state || ''};
      if(existing && String(row.bucket_state || '').toLowerCase()==='fresh'
        && ((String(row.call_connected || '').trim() && String(row.call_connected || '')!==String(existing.call_connected || ''))
        || (String(row.last_dialed_at || '').trim() && String(row.last_dialed_at || '')!==String(existing.last_dialed_at || ''))))
        row={...row,bucket_state:'working'};
      if(existing && row.candidate_id!==existing.candidate_id)throw Object.assign(new Error('Candidate ID cannot change.'),{code:'CC074'});
      if (existing) require('./candidateIdentityGuard').assertCandidateIdentityStable(existing, row);
      if(!existing && (this.state.candidates||[]).some(c=>String(c.candidate_id).trim().toUpperCase()===String(row.candidate_id).trim().toUpperCase()))throw Object.assign(new Error('Candidate ID already exists.'),{code:'CC074'});
      const same=policy.ownerKey(row)===policy.ownerKey(existing||{});
      if(!existing||!same){
        const target=(this.state.users||[]).find(u=>String(u.recruiter_code||'').trim().toLowerCase()===String(row.recruiter_code||'').trim().toLowerCase()&&String(row.recruiter_code||'').trim());
        if(target)row={...row,recruiter_user_id:target.user_id,recruiter_name:target.full_name||target.username,recruiter_designation:target.role||target.designation};
      }
      if(policy.isAssigned(row)) {
        if(!existing||!same||!policy.isAssigned(existing)||String(row.bucket_assigned_at||'')!==String(existing.bucket_assigned_at||''))row={...row,bucket_assigned_at:new Date().toISOString()};
        else if(!row.bucket_assigned_at)row={...row,bucket_assigned_at:policy.assignedRaw(existing)};
      }
      if(!existing||String(row.recruiter_user_id)!==String(existing.recruiter_user_id)||String(row.bucket_assigned_at)!==String(existing.bucket_assigned_at)){for(const key of ALLOCATION_LOCK_FIELDS)row[key]='';}
      if(policy.meta(row).active && !(same&&policy.meta(existing||{}).active)) {
        const used=Math.max(0,...policy.ownerKeys(row).map(key=>(this.state.candidates||[]).filter(c=>c.candidate_id!==row.candidate_id&&policy.ownerKeys(c).includes(key)&&policy.meta(c).active).length));
        if(used>=70)throw Object.assign(new Error('Bucket capacity reached: 70 active profiles.'),{code:'CC070'});
      }
    }
    if(table==='revenue_hub_entries' && !row.deleted_at && String(row.status||'').toLowerCase()!=='deleted') {
      const key=String(row.candidate_id||'').trim().toUpperCase();
      const entrant=!existing||String(existing.candidate_id||'').trim().toUpperCase()!==key||existing.deleted_at||String(existing.status||'').toLowerCase()==='deleted';
      if(entrant && !(this.state.candidates||[]).some(c=>String(c.candidate_id||'').trim().toUpperCase()===key))throw Object.assign(new Error('Revenue must reference an existing candidate.'),{code:'CC072'});
      // CC871: repeated interviews are separate revenue_id records.
    }
    return row;
  }

  async insert(table, row) {
    row=safeCandidateLockPatch(table,row);
    if(table==='candidates'&&row.full_name!==undefined)row={...row,full_name:require('./helpers').normalizeCandidateName(row.full_name)};
    if (table === 'activity_log' && !row.id) row = { ...row, id: crypto.randomUUID() };
    if (table === 'activity_log') {
      // CC863: keep historical activity. Daily duplicate-open limits remain.
      this.state.activity_log ||= [];
      if (['profile_opened', 'whatsapp_opened'].includes(row.action_type)) {
        const dayKey = stamp => new Date((Date.parse(stamp) || Date.now()) + 19800000).toISOString().slice(0,10);
        const day = dayKey(row.created_at);
        const used = this.state.activity_log.filter(item => String(item.user_id) === String(row.user_id) && dayKey(item.created_at) === day && ['profile_opened','whatsapp_opened'].includes(item.action_type)).length;
        if (used >= 1000) { this.save(); return null; }
        let metadata = {}; try { metadata = JSON.parse(row.metadata || '{}'); } catch {}
        const compact = Object.fromEntries(['phone','section','full_name','process','source','open_path'].filter(key => metadata[key] !== undefined).map(key => [key,String(metadata[key]).slice(0,160)]));
        row = { ...row, metadata:JSON.stringify(compact) };
      }
    }
    row=this.prepareRow(table,clone(row));
    this.state[table] ||= [];
    this.state[table].push(clone(row));
    this.save();noticeMutation(table,row);
    return clone(row);
  }

  async update(table, idField, id, updates, options={}) {
    updates=safeCandidateLockPatch(table,updates,options);
    if(table==='candidates'&&updates.full_name!==undefined)updates={...updates,full_name:require('./helpers').normalizeCandidateName(updates.full_name)};
    this.state[table] ||= [];
    const idx = this.state[table].findIndex((row) => String(row[idField]) === String(id));
    if (idx === -1) return null;
    if(table==='candidates'&&updates.recruiter_user_id!==undefined&&String(updates.recruiter_user_id)!==String(this.state[table][idx].recruiter_user_id))await require('../controllers/workspaceController').recordLoss(this.state[table][idx]);
    this.state[table][idx]=this.prepareRow(table,{...this.state[table][idx],...clone(updates)},this.state[table][idx]);
    this.save();noticeMutation(table,this.state[table][idx]);
    return clone(this.state[table][idx]);
  }

  async upsert(table, idField, row) {
    const existing = await this.findById(table, idField, row[idField]);
    return existing ? this.update(table, idField, row[idField], row) : this.insert(table, row);
  }

  async delete(table, idField, id) {
    this.state[table] ||= [];
    const idx = this.state[table].findIndex((row) => String(row[idField]) === String(id));
    if (idx === -1) return false;
    this.state[table][idx] = { ...this.state[table][idx], ...softDeletePatch(table, this.state[table][idx]) };
    this.save();
    return true;
  }

  async deleteWhere(table, field, value) {
    this.state[table] ||= [];
    let changed = false;
    this.state[table] = this.state[table].map((row) => {
      if (String(row[field]) !== String(value)) return row;
      changed = true;
      return { ...row, ...softDeletePatch(table, row) };
    });
    if (changed) this.save();
    return changed;
  }

  async query() {
    throw new Error('Direct SQL query is not available in local JSON mode');
  }

  async one() {
    return null;
  }

  async scalar() {
    return null;
  }
}

function waitForPgRetry(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function brokenPgConnection(error) {
  return /^(?:08|57P0[123]$)/.test(String(error?.code||''))
    || ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE'].includes(error?.code)
    || /query read timeout|connection.*(?:terminated|closed)|not queryable/i.test(String(error?.message||''));
}

const meterStart = new Date().toISOString();
const traffic = () => ({queries:0, returned_rows:0, estimated_input_bytes:0, estimated_response_bytes:0, slow_queries:0});
const estimate = {date:'',...traffic(),tables:new Map(),routes:new Map(),hours:new Map()};
const apiTraffic = () => ({api_requests:0, declared_request_bytes:0, declared_response_bytes:0});
const istShiftMs = 19800000;

function tally(map, key, identity, limit) {
  const existing = map.get(key);
  if (existing) return existing;
  const bucket = map.size < limit ? key : 'Other';
  if (!map.has(bucket)) map.set(bucket,{[identity]:bucket,...traffic(),...apiTraffic()});
  return map.get(bucket);
}
function hourRecord() {
  const stamp = new Date(Date.now()+istShiftMs).toISOString();
  const date = stamp.slice(0,10), hour = stamp.slice(0,13)+':00 IST';
  if (estimate.date!==date) {
    Object.assign(estimate,{date,...traffic()});
    estimate.tables.clear();
    estimate.routes.clear();
  }
  if (!estimate.hours.has(hour)) {
    estimate.hours.set(hour,{hour,...traffic(),...apiTraffic()});
    if (estimate.hours.size>48) estimate.hours.delete(estimate.hours.keys().next().value);
  }
  return estimate.hours.get(hour);
}

// Sample a few rows and nested values without copying large file blobs to JSON.
// This estimates payload data only. SQL text, framing, and compressed wire bytes differ.
function sampleBytes(value, depth=0) {
  if (value==null) return 0;
  if (typeof value==='string') return Buffer.byteLength(value);
  if (typeof value==='number'||typeof value==='bigint'||typeof value==='boolean') return Buffer.byteLength(String(value));
  if (Buffer.isBuffer(value)) return value.length;
  if (value instanceof Date) return 24;
  if (depth>=3 || typeof value!=='object') return 0;
  if (Array.isArray(value)) {
    const count = Math.min(value.length,8);
    return count ? Math.round(value.slice(0,count).reduce((n,v)=>n+sampleBytes(v,depth+1),0)*value.length/count) : 0;
  }
  return Object.values(value).reduce((n,v)=>n+sampleBytes(v,depth+1),0);
}
function recordQuery(args, result, elapsed) {
  try {
    const command = args[0], sql = typeof command==='string' ? command : command?.text;
    const params = typeof command==='string' ? args[1] : command?.values;
    const sets = Array.isArray(result) ? result : [result];
    let rows = 0, output = 0;
    for (const {rows:items=[]} of sets.filter(Boolean)) {
      rows+=items.length;
      output+=sampleBytes(items);
    }
    const input = Array.isArray(params) ? params.reduce((n,v)=>n+sampleBytes(v),0) : 0;
    const context = databaseRequestContext.getStore();
    const table = /\b(?:from|into|update)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)/i.exec(sql||'')?.[1] || 'metadata';
    const hour = hourRecord();
    const buckets = [estimate,hour,tally(estimate.tables,table,'table',60),tally(estimate.routes,context?.route||'BACKGROUND / startup','route',70)];
    if (context?.jobStats) buckets.push(context.jobStats);
    for (const bucket of buckets) {
      bucket.queries++;
      bucket.returned_rows+=rows;
      bucket.estimated_input_bytes+=input;
      bucket.estimated_response_bytes+=output;
      if(elapsed>2000)bucket.slow_queries++;
    }
  } catch {
    // Metering is best-effort. Never let it change a successful database result.
  }
}
function recordApiTransfer(route, input, output) {
  const hour=hourRecord();
  for(const bucket of [hour,tally(estimate.routes,route,'route',70)]) {
    bucket.api_requests++;
    bucket.declared_request_bytes+=input;
    bucket.declared_response_bytes+=output;
  }
}
async function runDatabaseJob(label, work) {
  const jobStats=traffic();
  const started=Date.now();
  const context={...databaseRequestContext.getStore(),route:'JOB '+label,background:true,jobStats};
  return databaseRequestContext.run(context,async()=>{
    try { return await work(); }
    finally {
      if(jobStats.queries)console.info('CC208_DB_JOB',JSON.stringify({job:label,at:new Date().toISOString(),elapsed_ms:Date.now()-started,...jobStats}));
    }
  });
}
function measuredRows(rows) {
  return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])));
}
function databaseResponseEstimate() {
  hourRecord();
  const rank = (map, limit) => [...map.values()].sort((a,b)=>b.estimated_response_bytes-a.estimated_response_bytes).slice(0,limit)
    .map(value=>({...value,rows:value.returned_rows,bytes:value.estimated_response_bytes}));
  return {...estimate,tables:rank(estimate.tables,60),routes:rank(estimate.routes,60),hours:[...estimate.hours.values()],
    started_at:meterStart,meter_source:'cc208_crm_pool_estimate',is_billing_meter:false,
    coverage:'Successful CRM PostgreSQL pool queries, sampled logical input and output. API sizes are declared lengths. Excludes PostgreSQL protocol overhead, Storage and other clients.'};
}

// CC166: reserve pool capacity for sign-in and writes instead of letting idle
// refreshes occupy every slot. Transactions own one slot until release.
function createDatabasePool(raw) {
  const max=Math.max(1,Number(raw.options?.max)||10),reserve=Math.min(2,Math.max(0,max-1));
  const queue=[];let running=0,lowRunning=0,backgroundRunning=0;
  // CC174: these are admission limits inside the SAME pool, never extra connections.
  const readLimit=Math.max(1,max-reserve),backgroundLimit=Math.min(2,readLimit);
  let unavailableUntil=0,connectionFailures=0;
  const busy=()=>Object.assign(new Error('CRM database is busy. Retry the same action; an unconfirmed save is not reported as saved.'),{status:503,code:'DB_QUEUE_BUSY'});
  const aborted=()=>Object.assign(new Error('This request was cancelled before a database connection was used.'),{status:499,code:'REQUEST_CANCELLED'});
  function failure(error){if(brokenPgConnection(error)||error?.code==='53300'){connectionFailures=Math.min(4,connectionFailures+1);unavailableUntil=Date.now()+Math.min(15000,1000*2**connectionFailures);}}
  function recovered(){connectionFailures=0;unavailableUntil=0;}
  function drain(){
    if(Date.now()<unavailableUntil){for(const job of queue.splice(0)){job.cleanup();job.reject(Object.assign(new Error('Database connection is recovering. Your saved view and drafts are kept.'),{status:503,code:'DB_RECOVERING'}));}return;}
    queue.sort((a,b)=>a.rank-b.rank||a.at-b.at);
    while(running<max){
      const n=queue.findIndex(job=>job.rank===0||(lowRunning<readLimit&&(job.rank!==2||backgroundRunning<backgroundLimit)));
      if(n<0)return;const job=queue.splice(n,1)[0];job.cleanup();running++;if(job.rank>0)lowRunning++;if(job.rank===2)backgroundRunning++;
      let released=false;job.resolve(()=>{if(released)return;released=true;running--;if(job.rank>0)lowRunning--;if(job.rank===2)backgroundRunning--;drain();});
    }
  }
  function acquire(){
    const context=databaseRequestContext.getStore()||{},route=String(context.route||'');
    const background=context.background===true||!route;
    const rank=background?2:/^(POST|PUT|PATCH|DELETE)\b/.test(route)||/commit-status|edit_only/.test(route)?0:1;
    const signal=context.signal;
    if(signal?.aborted)return Promise.reject(aborted());
    if(Date.now()<unavailableUntil)return Promise.reject(Object.assign(new Error('Database connection is recovering. Your draft is kept. Use the same action after a short pause.'),{status:503,code:'DB_RECOVERING',retry_after_ms:unavailableUntil-Date.now()}));
    return new Promise((resolve,reject)=>{
      if(queue.length>=256){reject(busy());return;}
      let timer;const job={rank,at:Date.now(),resolve,reject,cleanup(){clearTimeout(timer);signal?.removeEventListener('abort',cancel);}};
      const cancel=()=>{const n=queue.indexOf(job);if(n>=0){queue.splice(n,1);job.cleanup();reject(signal?.aborted?aborted():busy());drain();}};
      signal?.addEventListener('abort',cancel,{once:true});timer=setTimeout(cancel,background?5000:10000);timer.unref?.();queue.push(job);drain();
    });
  }
  function measuredQuery(target,args) {
    const started=Date.now();
    return target.query(...args).then(result=>{recordQuery(args,result,Date.now()-started);return result;});
  }
  const connect=async()=>{const done=await acquire();try{const client=await raw.connect(),release=client.release.bind(client);let released=false;
    if(databaseRequestContext.getStore()?.signal?.aborted){release();throw aborted();}
    return new Proxy(client,{get(target,key){
      if(key==='release')return error=>{if(released)return;released=true;if(error)failure(error);else recovered();try{return release(error);}finally{done();}};
      if(key==='query')return (...args)=>{
        const callback=typeof args.at(-1)==='function'?args.pop():null,result=measuredQuery(target,args);
        if(callback){result.then(value=>callback(null,value),error=>callback(error));return;}
        return result;
      };
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  }catch(error){failure(error);done();throw error;}};
  const query=async(...args)=>{const done=await acquire();try{
    if(databaseRequestContext.getStore()?.signal?.aborted)throw aborted();
    const result=await measuredQuery(raw,args);recovered();return result;
  }catch(error){failure(error);throw error;}finally{done();}};
  return new Proxy(raw,{get(target,key){
    if(key==='connect')return callback=>{const result=connect();if(typeof callback==='function'){result.then(c=>callback(null,c,e=>c.release(e)),e=>callback(e));return;}return result;};
    if(key==='query')return (...args)=>{const callback=typeof args.at(-1)==='function'?args.pop():null,result=query(...args);if(callback){result.then(x=>callback(null,x),e=>callback(e));return;}return result;};
    if(key==='crmQueueState')return {running,lowRunning,backgroundRunning,waiting:queue.length,reserved:reserve,max,backgroundLimit,unavailableUntil};
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
}

class PgStore {
  constructor(url) {
    this.pool = createDatabasePool(new Pool({
      connectionString: url,
      application_name: 'CC208-'+String(process.env.CRM_INSTANCE_LABEL||'CareerCrox').replace(/[^a-z0-9_-]/gi,'_').slice(0,44),
      ssl: { rejectUnauthorized: false },
      // CC139: 20 CRM users are NOT 20 dedicated DB connections. Keep the
      // bounded pool and let requests queue rather than exhausting Supabase.
      max: Math.max(1, Math.min(10, Number(process.env.PG_POOL_MAX || 10) || 10)),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: Math.max(1000, Math.min(10000, Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000) || 10000)),
      // Server cancellation must arrive BEFORE the driver's wire timeout.
      // Existing Render values of 10000/10000 otherwise race each other.
      query_timeout: Math.max(10000, Math.min(30000, Number(process.env.PG_QUERY_TIMEOUT_MS || 10000) || 10000)),
      statement_timeout: Math.max(1000, Math.min(8000, Number(process.env.PG_STATEMENT_TIMEOUT_MS || 8000) || 8000,
        Math.max(10000, Math.min(30000, Number(process.env.PG_QUERY_TIMEOUT_MS || 10000) || 10000))-2000)),
      lock_timeout: Math.max(1000,Math.min(15000,Number(process.env.PG_LOCK_TIMEOUT_MS||4000)||4000)),
      idle_in_transaction_session_timeout: 30000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      maxUses: 7500,
    }));
  }

  async query(sql, params = []) {
    const tx = transactionContext.getStore();
    const noticeTable=/\b(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?"?(notifications|tasks|candidates)"?\b/i.exec(sql)?.[1];
    const invalidate=()=>{if(noticeTable)afterCommit(()=>require('./cache').clearAllCaches(noticeTable==='notifications'?['notice-inbox','mobile-work-items','approvals','reminders']:['mobile-work-items','reminders']));if(/\b(?:insert\s+into|update\s+(?:public\.)?[a-z_"]|delete\s+from|truncate\s+)/i.test(sql))afterCommit(()=>{require('./versionedList').invalidateRecent?.();});};
    if (tx?.active){
      assertTransactionBudget(tx);
      try { const result=await tx.client.query(sql,params);invalidate();return measuredRows(result.rows); }
      catch(error){ rememberTransactionConflict(tx,error);throw error; }
    }
    // One SQL read per requested action. A timeout/overload must not multiply
    // into a database retry underneath another browser retry.
    const { rows } = await this.pool.query(sql, params);
    invalidate();return measuredRows(rows);
  }

  async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  async scalar(sql, params = [], field = 'value') {
    const row = await this.one(sql, params);
    return row ? row[field] : null;
  }

  async all(table) {
    safeTable(table);
    const id=SNAPSHOT_IDS[table];
    // A transaction reads its own writes and never publishes uncommitted rows.
    if(id&&!activeTransactionClient())return require('./versionedList').versionedList({key:'table:'+table,select:'r.*',from:`public.${qident(table)} r`,where:'true',id,idExpr:`r.${qident(id)}::text`});
    return this.query(`select * from ${qident(table)}`);
  }

  async findById(table, idField, id) {
    return this.one(`select * from ${qident(safeTable(table))} where ${qident(idField)} = $1 limit 1`, [id]);
  }

  async compatibleTemporalRow(table,row){
    if(!Object.values(row).some(value=>typeof value==='string'&&!value.trim()))return row;
    if(!this.temporalSchemas)this.temporalSchemas=require('./cache').createTimedCache(3600000,{maxEntries:80,tags:['schema','reset']});
    const columns=await this.temporalSchemas.load(safeTable(table),()=>this.query("select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name=$1 and data_type in ('date','timestamp without time zone','timestamp with time zone','time without time zone','time with time zone')",[table]));
    let next=row;
    for(const column of columns){const key=column.column_name;if(typeof row[key]!=='string'||row[key].trim())continue;
      if(column.is_nullable==='NO')throw Object.assign(new Error(key.replaceAll('_',' ')+' is required.'),{status:400,code:'DATE_REQUIRED',conflict_fields:[key]});
      if(next===row)next={...row};next[key]=null;
    }return next;
  }

  async insert(table, row) {
    row=safeCandidateLockPatch(table,row);
    if(table==='candidates'&&row.full_name!==undefined)row={...row,full_name:require('./helpers').normalizeCandidateName(row.full_name)};
    if (table === 'activity_log') return insertActivityRecord(row);
    row=await this.compatibleTemporalRow(table,row);
    const cols = Object.keys(row);
    const vals = Object.values(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const quotedCols = cols.map(qident).join(', ');
    const rows = await this.query(
      `insert into ${qident(safeTable(table))} (${quotedCols}) values (${placeholders}) returning *`,
      vals,
    );
    noticeMutation(table,rows[0]);
    return rows[0] || null;
  }

  async update(table, idField, id, updates, options={}) {
    updates=safeCandidateLockPatch(table,updates,options);
    if(table==='candidates'&&updates.full_name!==undefined)updates={...updates,full_name:require('./helpers').normalizeCandidateName(updates.full_name)};
    if (table === 'candidates' && ('full_name' in updates || 'phone' in updates)) {
      const existing = await this.findById('candidates', idField, id);
      if (existing) require('./candidateIdentityGuard').assertCandidateIdentityStable(existing, { ...existing, ...updates });
    }
    updates=await this.compatibleTemporalRow(table,updates);
    const cols = Object.keys(updates);
    if (!cols.length) return this.findById(table, idField, id);
    const vals = Object.values(updates);
    const setSql = cols.map((col, i) => `${qident(col)} = $${i + 1}`).join(', ');
    const rows = await this.query(
      `update ${qident(safeTable(table))} set ${setSql} where ${qident(idField)} = $${cols.length + 1} returning *`,
      [...vals, id],
    );
    noticeMutation(table,rows[0]);
    return rows[0] || null;
  }

  async upsert(table, idField, row) {
    const existing = await this.findById(table, idField, row[idField]);
    return existing ? this.update(table, idField, row[idField], row) : this.insert(table, row);
  }

  async filterSoftDeletePatch(table, patch) {
    const rows = await this.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [safeTable(table)],
    );
    const allowed = new Set(rows.map((row) => String(row.column_name || '')));
    return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
  }

  async delete(table, idField, id) {
    const existing = await this.findById(table, idField, id);
    if (!existing) return false;
    const patch = await this.filterSoftDeletePatch(table, softDeletePatch(table, existing));
    if (!Object.keys(patch).length) throw new Error(`Physical row removal disabled and no soft-archive columns exist for ${safeTable(table)}`);
    await this.update(table, idField, id, patch);
    return true;
  }

  async deleteWhere(table, field, value) {
    const rows = await this.query(`select * from ${qident(safeTable(table))} where ${qident(field)} = $1`, [value]);
    for (const row of rows) {
      const idField = Object.prototype.hasOwnProperty.call(row, 'id') ? 'id' : Object.keys(row)[0];
      if (!idField || row[idField] === undefined) continue;
      const patch = await this.filterSoftDeletePatch(table, softDeletePatch(table, row));
      if (!Object.keys(patch).length) throw new Error(`Physical row removal disabled and no soft-archive columns exist for ${safeTable(table)}`);
      await this.update(table, idField, row[idField], patch);
    }
    return Boolean(rows.length);
  }
}

class UnavailableStore {
  constructor(reason = 'Production database is not configured.') { this.reason = reason; this.pool = null; }
  error() { const err = new Error(this.reason); err.status = 503; err.code = 'DATABASE_UNAVAILABLE'; return err; }
  async all() { throw this.error(); }
  async findById() { throw this.error(); }
  async insert() { throw this.error(); }
  async update() { throw this.error(); }
  async upsert() { throw this.error(); }
  async delete() { throw this.error(); }
  async deleteWhere() { throw this.error(); }
  async query() { throw this.error(); }
  async one() { throw this.error(); }
  async scalar() { throw this.error(); }
}

// CC26_685: never write production data into demo JSON. Static SPA/login can still
// boot when DATABASE_URL is temporarily missing; authenticated data APIs fail closed.
const store = DATABASE_URL
  ? new PgStore(DATABASE_URL)
  : (REQUIRE_POSTGRES ? new UnavailableStore('Career Crox database is temporarily unavailable. Check DATABASE_URL on Render.') : new JsonStore(SEED_FILE));

const SNAPSHOT_IDS={crm_lost_profiles:'loss_id',crm_profile_access_requests:'request_id',users:'user_id',candidates:'candidate_id',submissions:'submission_id',interviews:'interview_id',notes:'id',tasks:'task_id',activity_log:'id',call_logs:'call_log_id',revenue_hub_entries:'revenue_id',scheduled_reports:'report_id',notifications:'notification_id'};

async function table(name) {
  return store.all(name);
}

let jsonTransactionTail = Promise.resolve();
let savepointSequence = 0;
function activeTransactionClient() {
  const tx = transactionContext.getStore();
  return tx?.active ? tx.client : null;
}
// Logging, counters and notification delivery must never borrow a profile's
// transaction. A failed optional INSERT would otherwise abort every core write.
function afterCommit(work) {
  const tx = transactionContext.getStore();
  if (tx?.active) {
    tx.afterCommit.push(work);
    return Promise.resolve(null);
  }
  return Promise.resolve().then(work);
}
// CC141: limit optional after-commit DB fan-out to two worker chains. The
// request has ALREADY committed; never hold its transaction/connection while
// notifications or audit jobs wait. Preserve FIFO within each command and do
// not silently drop work just because workers are busy.
const postCommitJobs=[];
let postCommitRunning=0;
const MAX_POST_COMMIT_RUNNING=2;
function drainPostCommitJobs(){
  while(postCommitRunning<MAX_POST_COMMIT_RUNNING&&postCommitJobs.length){
    const works=postCommitJobs.shift();postCommitRunning++;
    setImmediate(()=>databaseRequestContext.run({route:'BACKGROUND post-commit',background:true},()=>transactionContext.run(null,async()=>{
      try {
        for(const work of works){
          try{
            if(!store.pool)await withTransaction(work);
            else await work();
          }catch(error){console.error('Post-commit CRM activity failed:',error.code||'ACTIVITY_FAILED');}
        }
      }finally{postCommitRunning--;drainPostCommitJobs();}
    })));
  }
}
function queueBackgroundWork(work){postCommitJobs.push([work]);drainPostCommitJobs();}
function dispatchAfterCommit(tx) {
  if (!tx.afterCommit.length) return;
  postCommitJobs.push(tx.afterCommit.splice(0));
  drainPostCommitJobs();
}
// A compatibility fallback is useful only if its first failed SQL statement
// has been rolled back to a savepoint. PostgreSQL otherwise stays in 25P02.
async function withSavepoint(work) {
  const client = activeTransactionClient();
  if (!client) return work();
  const name = `crm_compat_${++savepointSequence}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const value = await work();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    rememberTransactionConflict(transactionContext.getStore(),error);
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
// CC137: the tracking statement trigger locks this row for every business write.
// Acquire it BEFORE candidate/receipt/phone/ID locks, avoiding the reverse order
// that can deadlock two different new profiles. Do not update tracking revisions.
async function lockTrackingWrites(client,exclusive=false) {
  try {
    // Backwards-compatible deployment: before CC140 SQL use CC137 serial gate.
    // Once migration exists, SHARE permits concurrent writers but still blocks
    // freeze/promote until all active transactions complete.
    await client.query('SAVEPOINT cc140_tracking_gate');
    try {
      // CC148: permission/schema capability failures must be recoverable too.
      const ready=(await client.query("SELECT to_regclass('crm_control.write_revision_seq') IS NOT NULL AS cc140_ready")).rows[0]?.cc140_ready;
      await client.query(ready && !exclusive
        ? 'SELECT 1 FROM crm_control.instance WHERE id FOR SHARE'
        : 'SELECT 1 FROM crm_control.instance WHERE id FOR UPDATE');
      await client.query('RELEASE SAVEPOINT cc140_tracking_gate');
      return true;
    } catch(error) {
      await client.query('ROLLBACK TO SAVEPOINT cc140_tracking_gate');
      await client.query('RELEASE SAVEPOINT cc140_tracking_gate');
      if (['42P01','3F000','42501'].includes(error.code)) return false;
      throw error;
    }
  } catch(error) { throw error; }
}
function assertTransactionBudget(tx){
  if(tx?.active&&tx.readOnly&&databaseRequestContext.getStore()?.signal?.aborted)throw Object.assign(new Error('This read was cancelled. The saved view is kept.'),{code:'REQUEST_CANCELLED',status:499});
  if(tx?.active&&tx.deadlineAt&&Date.now()>=tx.deadlineAt)throw Object.assign(new Error('The database could not finish this save in time. Your entered details are kept; retry the same action.'),{code:'CRM_TRANSACTION_DEADLINE',status:503});
}
function isTransactionConflict(error) { return ['40P01','40001','55P03'].includes(error?.code); }
function rememberTransactionConflict(tx,error) {
  if(tx?.active && isTransactionConflict(error) && !tx.pgConflict) tx.pgConflict=error;
}
async function withTransaction(work,options={}) {
  // A nested caller cannot restart part of an outer transaction.
  if (transactionContext.getStore()?.active) return work();
  if (!store.pool) {
    const run = jsonTransactionTail.then(async () => {
      const snapshot = clone(store.state || {});
      const tx = { active: true, afterCommit: [] };
      try {
        const value = await transactionContext.run(tx, work);
        tx.active = false;
        if (tx.dirty && store.state) store.save();
        dispatchAfterCommit(tx);
        return value;
      }
      catch (error) { if (store.state) { store.state = snapshot; store.save(); } throw error; }
      finally { tx.active = false; }
    });
    jsonTransactionTail = run.catch(() => {});
    return run;
  }
  // Retry only explicitly replay-safe commands, only confirmed rollback errors.
  // Never replay an ambiguous COMMIT/connection timeout, validation or duplicate.
  const attempts=options.retryConflicts===true?2:1;
  const overallStarted=Date.now();
  // Retry attempts share one request budget; no unsafe replay after COMMIT.
  // This is a retry cutoff, NOT a false guarantee that a currently running
  // SQL query/COMMIT can be cancelled within the budget.
  const interactiveCommand=/^POST \/(?:auth\/login|candidates\/[^/]+\/commit)$/.test(String(databaseRequestContext.getStore()?.route||''));
  const overallBudget=Math.max(15000,Math.min(85000,Number(options.deadlineMs||(interactiveCommand?25000:process.env.PG_WRITE_DEADLINE_MS||75000))||75000));
  for(let attempt=0;attempt<attempts;attempt++) {
    if(attempt>0&&Date.now()-overallStarted>overallBudget-10000){
      const error=Object.assign(new Error('CRM is busy. Your previous attempt was rolled back; your saved draft is safe. Retry the same action.'),{code:'CRM_RETRY_DEADLINE',status:503,committed:false,retryable:true});
      error.payload={ok:false,committed:false,retryable:true,code:error.code,message:error.message};
      throw error;
    }
    const poolWaitStarted=Date.now();
    const client=await store.pool.connect();
    const poolWaitMs=Date.now()-poolWaitStarted;
    const transactionStarted=Date.now();
    const tx={client,active:true,readOnly:options.readOnly===true,afterCommit:[],pgConflict:null,deadlineAt:(interactiveCommand||options.deadlineMs)?overallStarted+overallBudget:0};
    let retry=false,committed=false,commitStarted=false,releaseError=null;
    try {
      // CC139: read-only Candidate List snapshots MUST NOT take the global
      // write-tracking row lock. Postgres enforces READ ONLY itself.
      await client.query(options.readOnly===true
        ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
        : 'BEGIN');
      // SET LOCAL also works through a transaction-mode pooler. No role/global
      // setting or migration changes. Reads use one stable snapshot for counts.
      await client.query("SET LOCAL statement_timeout='8s'");
      if(options.trackingExclusive===true)await client.query("SET LOCAL lock_timeout='15s'");
      const value=await transactionContext.run(tx,async()=>{
        if(options.readOnly!==true)await lockTrackingWrites(client,options.trackingExclusive===true);
        return work();
      });
      // Also detect a transient SQL error swallowed by a compatibility catch.
      if(tx.pgConflict)throw tx.pgConflict;
      assertTransactionBudget(tx);
      await client.query('SELECT 1 AS crm_transaction_ok');
      // Once COMMIT is issued, a connection failure makes the outcome
      // uncertain; never replay that write even if a later ROLLBACK replies.
      assertTransactionBudget(tx);
      commitStarted=true;
      const result=await client.query('COMMIT');
      if(result.command==='ROLLBACK')throw Object.assign(new Error('Database did not commit the profile. Your draft is safe; retry.'),{code:'TRANSACTION_NOT_COMMITTED'});
      committed=true;tx.active=false;
      dispatchAfterCommit(tx);
      return value;
    } catch(caught) {
      let error=tx.pgConflict||caught;
      let rolledBack=false;
      if(!committed)try{const result=await client.query('ROLLBACK');rolledBack=result.command==='ROLLBACK';}catch(rollbackError){releaseError=rollbackError;}
      if(brokenPgConnection(error))releaseError=error;
      tx.afterCommit.length=0;
      if(!committed&&!tx.readOnly&&(commitStarted||!rolledBack)){
        error=Object.assign(new Error('Save confirmation was interrupted. Your draft and save reference are kept. Check this same save before retrying.'),{code:'CRM_COMMIT_UNCONFIRMED',status:503,committed:null,retryable:false});
        error.payload={ok:false,committed:null,retryable:false,verification_required:true,code:error.code,message:error.message};
      }else if(!committed&&rolledBack){error.committed=false;}
      if(!committed&&!commitStarted&&rolledBack&&isTransactionConflict(error)){
        retry=attempt+1<attempts;
        console.warn('[CC137_TRANSACTION_CONFLICT]',{sqlstate:error.code,attempt:attempt+1,retry});
        if(!retry){
          error.status=503;error.committed=false;error.retryable=true;
          error.message='The CRM database was busy with another write. This request was rolled back; your draft is kept. Retry the same Save or Submit button.';
          error.payload={ok:false,committed:false,retryable:true,code:error.code,message:error.message};
        }
      }
      if(!retry)throw error;
    } finally {
      tx.active=false;client.release(releaseError||undefined);
      const durationMs=Date.now()-transactionStarted;
      if(poolWaitMs>2000||durationMs>5000){
        // No candidate details, phone, notes, tokens or SQL literals in logs.
        console.warn('[CC141_DB_WAIT]',{pool_wait_ms:poolWaitMs,transaction_ms:durationMs,
          attempt:attempt+1,read_only:options.readOnly===true,committed,
          pool_active:store.pool.totalCount-store.pool.idleCount,
          pool_waiting:store.pool.waitingCount});
      }
    }
    // Release all locks/connection before a short bounded exponential jitter.
    await waitForPgRetry(100*2**attempt+crypto.randomInt(25,100));
  }
}

function captureResponse() {
  return { statusCode: 200, body: null, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; }, set() { return this; }, setHeader() { return this; } };
}
async function callController(handler, req) {
  const response = captureResponse();
  await handler(req, response);
  if (response.statusCode >= 400) {
    const error = new Error(response.body?.message || 'Action failed');
    error.status = response.statusCode; error.code = response.body?.code;
    error.payload = response.body; throw error;
  }
  return response.body;
}
function transactionalHandler(handler, options={}) {
  return async (req, res) => {
    try {
      const originalBody=options.retryConflicts===true?clone(req.body||{}):null;
      const body = await withTransaction(async () => {
        if(originalBody)req.body=clone(originalBody);
        if (store.pool) {
          if (Array.isArray(req.body?.candidate_ids) && req.body.candidate_ids.length) await store.query('select candidate_id from candidates where candidate_id=any($1::text[]) order by candidate_id for update',[req.body.candidate_ids.map(String)]);
          let id = req.params?.candidateId || (req.path==='/notes'?req.body?.candidate_id:'');
          if (req.body?.type === 'candidate') {
            const sub = await store.findById('submissions', 'submission_id', req.body.id);
            id = sub?.candidate_id || req.body.id;
          }
          if (id) await store.query('select candidate_id from candidates where candidate_id = $1 for update', [id]);
          if (req.body?.type === 'attendance_report') await store.query('select report_id from scheduled_reports where report_id = $1 for update', [req.body.id]);
        }
        return callController(handler, req);
      }, options);
      return res.json(body);
    } catch (error) {
      if (error.code === 'CC074') return res.status(409).json({message:error.message,code:'CANDIDATE_ID_CONFLICT'});
      if (error.code === 'CC071') return res.status(409).json({message:error.message,code:'REVENUE_DUPLICATE'});
      if (error.code === 'CC072') return res.status(400).json({message:error.message,code:'REVENUE_INVALID'});
      if (error.code === 'CC081') return res.status(400).json({message:error.message,code:'NOTE_REQUIRED'});
      if (error.code === 'CC070') return res.status(409).json({message:error.message,code:'BUCKET_CAPACITY_REACHED'});
      if (error.status) return res.status(error.status).json(error.payload || { message: error.message, code: error.code });
      throw error;
    }
  };
}

// One allocator for attendance, break, task and profile activity. Legacy databases
// may use text, UUID, numeric, serial or identity IDs. Never infer an ID by
// stripping digits from mixed historical activity keys.
let activityShapeCache=null;
async function insertActivityRecord(input, suppliedClient=null) {
  if(!store.pool)return store.insert('activity_log',{...input,id:input.id||crypto.randomUUID(),activity_id:input.activity_id||'ACT-'+crypto.randomUUID()});
  const client=suppliedClient||activeTransactionClient()||await store.pool.connect();
  const own=!suppliedClient&&!activeTransactionClient();
  try{
    if(own){await client.query('BEGIN');await lockTrackingWrites(client);}
    if(!activityShapeCache||activityShapeCache.pool!==store.pool||Date.now()-activityShapeCache.at>60000){
      const result=await client.query("select column_name,data_type,column_default,is_identity,is_nullable from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name in ('id','activity_id')");
      activityShapeCache={pool:store.pool,at:Date.now(),columns:result.rows};
    }
    const columns=activityShapeCache.columns,id=columns.find(c=>c.column_name==='id'),activity=columns.find(c=>c.column_name==='activity_id');
    let manualNumber=null;
    const integer=c=>c&&/^(smallint|integer|bigint|numeric|decimal)$/.test(c.data_type);
    if(integer(id)&&!id.column_default&&id.is_identity!=='YES'){
      await client.query('select pg_advisory_xact_lock(hashtext($1))',['cc936:activity-id']);
      manualNumber=BigInt((await client.query('select coalesce(max(id),0)::text as value from public.activity_log')).rows[0].value)+1n;
    }
    let saved;
    for(let attempt=0;attempt<4;attempt++){
      const row={...input};
      if(activity)row.activity_id=integer(activity)?String(BigInt(Date.now())*1000000n+BigInt(crypto.randomInt(1000000))):'ACT-'+crypto.randomUUID();
      else delete row.activity_id;
      if(!id)delete row.id;
      else if(id.column_default||id.is_identity==='YES')delete row.id;
      else if(integer(id))row.id=String(manualNumber++);
      else if(id.data_type==='uuid')row.id=crypto.randomUUID();
      // Decimal text stays portable to the legacy bigint activity-log schema.
      else row.id=String((BigInt('0x'+crypto.randomBytes(8).toString('hex'))&0x7fffffffffffffffn)||1n);
      const keys=Object.keys(row);
      await client.query('SAVEPOINT cc936_activity_insert');
      try{
        saved=(await client.query('insert into public.activity_log ('+keys.map(qident).join(',')+') values ('+keys.map((_,i)=>'$'+(i+1)).join(',')+') returning *',Object.values(row))).rows[0];
        await client.query('RELEASE SAVEPOINT cc936_activity_insert');break;
      }catch(error){
        await client.query('ROLLBACK TO SAVEPOINT cc936_activity_insert');
        await client.query('RELEASE SAVEPOINT cc936_activity_insert');
        if(error.code!=='23505'||!(/activity_log.*(?:pkey|id_key)/.test(error.constraint||'')||/Key \((?:id|activity_id)\)/.test(error.detail||''))||attempt===3)throw error;
        if(id&&(id.column_default||id.is_identity==='YES')){
          const sequence=(await client.query("select pg_get_serial_sequence('public.activity_log','id') as seq")).rows[0]?.seq;
          if(sequence){
            await client.query('select pg_advisory_xact_lock(hashtext($1))',['cc936:activity-sequence']);
            const last=(await client.query('select last_value::text as value from '+sequence.split('.').map(x=>qident(x.replace(/^"|"$/g,''))).join('.'))).rows[0].value;
            const maximum=(await client.query('select coalesce(max(id),0)::text as value from public.activity_log')).rows[0].value;
            const high=BigInt(last)>BigInt(maximum)?BigInt(last):BigInt(maximum);
            await client.query('select setval($1::regclass,$2::bigint,true)',[sequence,String(high>0n?high:1n)]);
          }
        }
      }
    }
    if(own)await client.query('COMMIT');
    if(own||activeTransactionClient())afterCommit(()=>require('./versionedList').invalidateRecent?.());
    return saved;
  }catch(error){if(own)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally{if(own)client.release();}
}

module.exports = {
  databaseRequestContext, databaseResponseEstimate, recordApiTransfer, runDatabaseJob, measureDatabaseRows:measuredRows, createDatabasePool, queueBackgroundWork, TABLES, SNAPSHOT_IDS,
  safeTable,
  store,
  table,
  withTransaction,
  lockTrackingWrites,
  activeTransactionClient,
  afterCommit,
  withSavepoint,
  callController,
  transactionalHandler,
  insertActivityRecord,
  mode: DATABASE_URL ? 'postgres' : (REQUIRE_POSTGRES ? 'postgres-unavailable' : 'json-sample'),
};
