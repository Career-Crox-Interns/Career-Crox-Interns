const fs = require('fs');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const transactionContext = new AsyncLocalStorage();
const { Pool } = require('pg');
const { DATABASE_URL, SEED_FILE, REQUIRE_POSTGRES } = require('../config/env');
const { clone } = require('./helpers');

const TABLES = new Set([
  'crm_command_receipts','chat_thread_read_state','chat_notification_jobs','generated_downloads','candidate_reset_archive',
  'users','candidates','tasks','notifications','jd_master','jd_documents','notes','messages','interviews','submissions',
  'active_sessions','presence','unlock_requests','activity_log','scheduled_reports','break_sessions','report_summaries','aaria_queue',
  'client_pipeline','client_requirements','revenue_entries','chat_groups','chat_group_members',
  'chat_user_state','settings','learning_progress','suggested_videos','interview_remove_requests','candidate_jd_feedback','revenue_hub_entries',
  'mail_templates','mail_drafts','mail_logs','candidate_files','yt_hub_playlists','yt_hub_videos','important_resources',
  'user_onboarding_requests','user_onboarding_documents','password_reset_requests',
  'hot_leads','bda_leads','bda_activities','hr_employees','hr_attendance_logs','hr_worklogs','hr_leave_logs','hr_stage_events','hr_document_templates','hr_document_runs','goal_post_targets','employee_daily_stats',
  'bulk_upload_history','mobile_devices','dialer_sessions','dialer_queue_items','manual_dialer_calls','call_logs','call_quality_events','recording_files','live_call_state','team_chat_messages','team_chat_threads','egress_budget_daily','employee_locations','candidate_file_contents','mobile_app_releases','crm_feature_flags','app_feature_flags','app_settings'
]);

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
      if(policy.meta(row).active && !(same&&policy.meta(existing||{}).active)) {
        const used=Math.max(0,...policy.ownerKeys(row).map(key=>(this.state.candidates||[]).filter(c=>c.candidate_id!==row.candidate_id&&policy.ownerKeys(c).includes(key)&&policy.meta(c).active).length));
        if(used>=70)throw Object.assign(new Error('Bucket capacity reached: 70 active profiles.'),{code:'CC070'});
      }
    }
    if(table==='revenue_hub_entries' && !row.deleted_at && String(row.status||'').toLowerCase()!=='deleted') {
      const key=String(row.candidate_id||'').trim().toUpperCase();
      const entrant=!existing||String(existing.candidate_id||'').trim().toUpperCase()!==key||existing.deleted_at||String(existing.status||'').toLowerCase()==='deleted';
      if(entrant && !(this.state.candidates||[]).some(c=>String(c.candidate_id||'').trim().toUpperCase()===key))throw Object.assign(new Error('Revenue must reference an existing candidate.'),{code:'CC072'});
      if(entrant && (this.state.revenue_hub_entries||[]).some(r=>r.revenue_id!==row.revenue_id&&String(r.candidate_id||'').trim().toUpperCase()===key&&!r.deleted_at&&String(r.status||'').toLowerCase()!=='deleted'))throw Object.assign(new Error('Duplicate active revenue entry.'),{code:'CC071'});
    }
    return row;
  }

  async insert(table, row) {
    if (table === 'activity_log' && !row.id) row = { ...row, id: row.activity_id || crypto.randomUUID() };
    if (table === 'activity_log') {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      const auditAction = action => /^(profile_|candidate_|whatsapp_|task_|note_|submission_|interview_)/.test(String(action || '')) || action === 'submitted_for_approval';
      // This shared table also contains call/work accounting; only audit events age out.
      this.state.activity_log = (this.state.activity_log || []).filter(item => !auditAction(item.action_type) || String(item.created_at || '') >= cutoff);
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
    this.save();
    return clone(row);
  }

  async update(table, idField, id, updates) {
    this.state[table] ||= [];
    const idx = this.state[table].findIndex((row) => String(row[idField]) === String(id));
    if (idx === -1) return null;
    this.state[table][idx]=this.prepareRow(table,{...this.state[table][idx],...clone(updates)},this.state[table][idx]);
    this.save();
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

function isRetryablePgError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  const code = String(error?.code || '').trim();
  return ['ECONNRESET', 'ETIMEDOUT', '57P01', '57P02', '57P03', '53300', '08006', '08003'].includes(code)
    || msg.includes('connection terminated')
    || msg.includes('timeout')
    || msg.includes('terminating connection')
    || msg.includes('the database system is starting up')
    || msg.includes('remaining connection slots are reserved');
}

const responseEstimates={date:'',queries:0,returned_rows:0,estimated_response_bytes:0,slow_queries:0,tables:new Map()};
function measuredRows(rows,sql,elapsed){
  const sample=rows.slice(0,8),bytes=sample.length?Math.round(Buffer.byteLength(JSON.stringify(sample))*rows.length/sample.length):0;const day=new Date(Date.now()+19800000).toISOString().slice(0,10);
  if(responseEstimates.date!==day){Object.assign(responseEstimates,{date:day,queries:0,returned_rows:0,estimated_response_bytes:0,slow_queries:0});responseEstimates.tables.clear();}
  responseEstimates.queries++;responseEstimates.returned_rows+=rows.length;responseEstimates.estimated_response_bytes+=bytes;if(elapsed>2000)responseEstimates.slow_queries++;
  const table=(String(sql).match(/\b(?:from|into|update)\s+(?:public\.)?"?([a-z_][a-z0-9_]*)/i)||[])[1]||'metadata';const old=responseEstimates.tables.get(table)||{table,queries:0,rows:0,bytes:0};old.queries++;old.rows+=rows.length;old.bytes+=bytes;responseEstimates.tables.set(table,old);
  return rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])));
}
function databaseResponseEstimate(){return {...responseEstimates,tables:[...responseEstimates.tables.values()].sort((a,b)=>b.bytes-a.bytes),meter_source:'store_query_json_estimate',is_billing_meter:false,coverage:'sampled store.query JSON response estimate; direct pool reads and protocol overhead excluded'};}

class PgStore {
  constructor(url) {
    this.pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: Math.max(4, Math.min(12, Number(process.env.PG_POOL_MAX || 10) || 10)),
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 5000,
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 10000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 10000),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      maxUses: 7500,
    });
  }

  async query(sql, params = []) {
    const tx = transactionContext.getStore();
    if (tx?.active){const started=Date.now();const result=await tx.client.query(sql,params);return measuredRows(result.rows,sql,Date.now()-started);}
    // A disconnect after a write may mean it already committed. Retry only reads.
    const retrySafe = /^\s*select\b/i.test(sql) && !/\b(for\s+update|nextval|setval|pg_advisory)\b/i.test(sql);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const started=Date.now();const { rows } = await this.pool.query(sql, params);
        return measuredRows(rows,sql,Date.now()-started);
      } catch (error) {
        lastError = error;
        if (!retrySafe || attempt >= 1 || !isRetryablePgError(error)) throw error;
        await waitForPgRetry(250 + (attempt * 350));
      }
    }
    throw lastError;
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
    return this.query(`select * from ${qident(safeTable(table))}`);
  }

  async findById(table, idField, id) {
    return this.one(`select * from ${qident(safeTable(table))} where ${qident(idField)} = $1 limit 1`, [id]);
  }

  async insert(table, row) {
    if (table === 'activity_log' && !row.id) row = { ...row, id: row.activity_id || crypto.randomUUID() };
    const cols = Object.keys(row);
    const vals = Object.values(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const quotedCols = cols.map(qident).join(', ');
    const rows = await this.query(
      `insert into ${qident(safeTable(table))} (${quotedCols}) values (${placeholders}) returning *`,
      vals,
    );
    return rows[0] || null;
  }

  async update(table, idField, id, updates) {
    const cols = Object.keys(updates);
    if (!cols.length) return this.findById(table, idField, id);
    const vals = Object.values(updates);
    const setSql = cols.map((col, i) => `${qident(col)} = $${i + 1}`).join(', ');
    const rows = await this.query(
      `update ${qident(safeTable(table))} set ${setSql} where ${qident(idField)} = $${cols.length + 1} returning *`,
      [...vals, id],
    );
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
function dispatchAfterCommit(tx) {
  if (!tx.afterCommit.length) return;
  setImmediate(() => transactionContext.run(null, async () => {
    for (const work of tx.afterCommit) {
      try {
        // An optional local JSON write must not flush another command's
        // uncommitted profile into the persistent database file.
        if (!store.pool) await withTransaction(work);
        else await work();
      }
      catch (error) { console.error('Post-commit CRM activity failed:', error.code || 'ACTIVITY_FAILED'); }
    }
  }));
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
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}
async function withTransaction(work) {
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
  const client = await store.pool.connect();
  const tx = { client, active: true, afterCommit: [] };
  try {
    await client.query('BEGIN');
    const value = await transactionContext.run(tx, work);
    // A swallowed PostgreSQL error leaves the transaction aborted. Probe before
    // COMMIT, which otherwise quietly returns ROLLBACK and a false success.
    await client.query('SELECT 1 AS crm_transaction_ok');
    const committed = await client.query('COMMIT');
    if (committed.command === 'ROLLBACK') throw Object.assign(new Error('Database did not commit the profile. Your draft is safe; retry.'), { code: 'TRANSACTION_NOT_COMMITTED' });
    tx.active = false;
    dispatchAfterCommit(tx);
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { tx.active = false; client.release(); }
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
function transactionalHandler(handler) {
  return async (req, res) => {
    try {
      const body = await withTransaction(async () => {
        if (store.pool) {
          if (Array.isArray(req.body?.candidate_ids) && req.body.candidate_ids.length) await store.query('select candidate_id from candidates where candidate_id=any($1::text[]) order by candidate_id for update',[req.body.candidate_ids.map(String)]);
          let id = req.params?.candidateId;
          if (req.body?.type === 'candidate') {
            const sub = await store.findById('submissions', 'submission_id', req.body.id);
            id = sub?.candidate_id || req.body.id;
          }
          if (id) await store.query('select candidate_id from candidates where candidate_id = $1 for update', [id]);
          if (req.body?.type === 'attendance_report') await store.query('select report_id from scheduled_reports where report_id = $1 for update', [req.body.id]);
        }
        return callController(handler, req);
      });
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

module.exports = {
  databaseResponseEstimate, TABLES,
  safeTable,
  store,
  table,
  withTransaction,
  activeTransactionClient,
  afterCommit,
  withSavepoint,
  callController,
  transactionalHandler,
  mode: DATABASE_URL ? 'postgres' : (REQUIRE_POSTGRES ? 'postgres-unavailable' : 'json-sample'),
};
