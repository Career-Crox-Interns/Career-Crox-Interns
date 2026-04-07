const fs = require('fs');
const { Pool } = require('pg');
const { DATABASE_URL, SEED_FILE, REQUIRE_POSTGRES } = require('../config/env');
const { clone } = require('./helpers');

const TABLES = new Set([
  'users','candidates','tasks','notifications','jd_master','notes','messages','interviews','submissions',
  'active_sessions','presence','unlock_requests','activity_log','scheduled_reports','aaria_queue',
  'client_pipeline','client_requirements','revenue_entries','chat_groups','chat_group_members',
  'chat_user_state','settings','learning_progress','suggested_videos','interview_remove_requests','candidate_jd_feedback','revenue_hub_entries',
  'mail_templates','mail_drafts','mail_logs','candidate_files','yt_hub_playlists','yt_hub_videos','important_resources',
  'user_onboarding_requests','user_onboarding_documents','password_reset_requests'
]);

function safeTable(table) {
  if (!TABLES.has(table)) throw new Error(`Unsupported table ${table}`);
  return table;
}

function qident(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
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
    const before = this.state[table].length;
    this.state[table] = this.state[table].filter((row) => String(row[idField]) !== String(id));
    const changed = before !== this.state[table].length;
    if (changed) this.save();
    return changed;
  }

  async deleteWhere(table, field, value) {
    this.state[table] ||= [];
    const before = this.state[table].length;
    this.state[table] = this.state[table].filter((row) => String(row[field]) !== String(value));
    const changed = before !== this.state[table].length;
    if (changed) this.save();
    return changed;
  }

  async query() {
    throw new Error('Direct SQL query is not available in json-demo mode');
  }

  async one() {
    return null;
  }

  async scalar() {
    return null;
  }
}

class PgStore {
  constructor(url) {
    this.pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX || 6),
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 10000,
      query_timeout: 25000,
      statement_timeout: 25000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      maxUses: 7500,
    });
  }

  async query(sql, params = []) {
    const { rows } = await this.pool.query(sql, params);
    return clone(rows);
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

  async delete(table, idField, id) {
    await this.query(`delete from ${qident(safeTable(table))} where ${qident(idField)} = $1`, [id]);
    return true;
  }

  async deleteWhere(table, field, value) {
    await this.query(`delete from ${qident(safeTable(table))} where ${qident(field)} = $1`, [value]);
    return true;
  }
}

if (REQUIRE_POSTGRES && !DATABASE_URL) {
  throw new Error('DATABASE_URL missing');
}

const store = DATABASE_URL ? new PgStore(DATABASE_URL) : new JsonStore(SEED_FILE);

async function table(name) {
  return store.all(name);
}

module.exports = {
  TABLES,
  safeTable,
  store,
  table,
  mode: DATABASE_URL ? 'postgres' : 'json-demo',
};
