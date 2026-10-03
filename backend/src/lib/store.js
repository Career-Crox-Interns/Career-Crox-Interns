const fs = require('fs');
const { Pool } = require('pg');
const { DATABASE_URL, SEED_FILE, REQUIRE_POSTGRES } = require('../config/env');
const { clone } = require('./helpers');

const TABLES = new Set([
  'users','candidates','tasks','notifications','jd_master','notes','messages','interviews','submissions',
  'active_sessions','presence','unlock_requests','activity_log','scheduled_reports','break_sessions','report_summaries','aaria_queue',
  'client_pipeline','client_requirements','revenue_entries','chat_groups','chat_group_members',
  'chat_user_state','settings','learning_progress','suggested_videos','interview_remove_requests','candidate_jd_feedback','revenue_hub_entries',
  'mail_templates','mail_drafts','mail_logs','candidate_files','yt_hub_playlists','yt_hub_videos','important_resources',
  'user_onboarding_requests','user_onboarding_documents','password_reset_requests',
  'hot_leads','bda_leads','bda_activities','hr_employees','hr_attendance_logs','hr_worklogs','hr_leave_logs','hr_stage_events','hr_document_templates','hr_document_runs','goal_post_targets','employee_daily_stats',
  'bulk_upload_history','mobile_devices','dialer_sessions','dialer_queue_items','manual_dialer_calls','call_logs','call_quality_events','recording_files','live_call_state','team_chat_messages','team_chat_threads','egress_budget_daily','employee_locations','candidate_file_contents','mobile_app_releases','crm_feature_flags','app_feature_flags','app_settings','candidate_reset_archive'
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
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  async insert(table, row) {
    this.state[table] ||= [];
    this.state[table].push(clone(row));
    this.save();
    return clone(row);
  }

  async update(table, idField, id, updates) {
    this.state[table] ||= [];
    const idx = this.state[table].findIndex((row) => String(row[idField]) === String(id));
    if (idx === -1) return null;
    this.state[table][idx] = { ...this.state[table][idx], ...clone(updates) };
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

class PgStore {
  constructor(url) {
    this.pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: Math.max(4, Math.min(12, Number(process.env.PG_POOL_MAX || 10) || 10)),
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 8000,
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 22000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 22000),
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      maxUses: 7500,
    });
  }

  async query(sql, params = []) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const { rows } = await this.pool.query(sql, params);
        return clone(rows);
      } catch (error) {
        lastError = error;
        if (attempt >= 1 || !isRetryablePgError(error)) throw error;
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

module.exports = {
  TABLES,
  safeTable,
  store,
  table,
  mode: DATABASE_URL ? 'postgres' : (REQUIRE_POSTGRES ? 'postgres-unavailable' : 'json-sample'),
};
