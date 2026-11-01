const { store, mode } = require('./store');
const { ensureDefaultSettings } = require('./settings');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function ensureCriticalProfileSchema() {
  if (mode !== 'postgres' || !store.pool) return;
  // CC26_779: tiny additive-only startup repair for the profile features that must never
  // disappear because an older Supabase project is missing a table/column. No user data
  // is updated or deleted here; DDL only creates missing structures.
  const statements = [
    `alter table if exists public.candidates add column if not exists project_id text default ''`,
    `alter table if exists public.revenue_hub_entries add column if not exists project_id text default ''`,
    `create table if not exists public.notes (id text primary key)`,
    `alter table if exists public.notes add column if not exists candidate_id text`,
    `alter table if exists public.notes add column if not exists username text`,
    `alter table if exists public.notes add column if not exists note_type text`,
    `alter table if exists public.notes add column if not exists body text`,
    `alter table if exists public.notes add column if not exists parent_note_id text`,
    `alter table if exists public.notes add column if not exists reply_to_note_id text`,
    `alter table if exists public.notes add column if not exists reply_to_username text`,
    `alter table if exists public.notes add column if not exists created_at text`,
    `alter table if exists public.notes add column if not exists updated_at text`,
    `create index if not exists idx_cc779_notes_candidate_created on public.notes(candidate_id, created_at desc)`,

    `create table if not exists public.activity_log (id text primary key)`,
    `alter table if exists public.activity_log add column if not exists activity_id text`,
    `alter table if exists public.activity_log add column if not exists user_id text`,
    `alter table if exists public.activity_log add column if not exists username text`,
    `alter table if exists public.activity_log add column if not exists action_type text`,
    `alter table if exists public.activity_log add column if not exists candidate_id text`,
    `alter table if exists public.activity_log add column if not exists metadata text`,
    `alter table if exists public.activity_log add column if not exists created_at text`,
    `create index if not exists idx_cc779_activity_candidate_created on public.activity_log(candidate_id, created_at desc)`,

    `alter table if exists public.candidates add column if not exists last_viewed_at text`,
    `alter table if exists public.candidates add column if not exists last_viewed_by_name text`,
    `alter table if exists public.candidates add column if not exists previous_last_viewed_at text`,
    `alter table if exists public.candidates add column if not exists previous_last_viewed_by_name text`,
    `alter table if exists public.candidates add column if not exists follow_up_at text`,
    `alter table if exists public.candidates add column if not exists follow_up_note text`,
    `alter table if exists public.candidates add column if not exists follow_up_status text`,
    `alter table if exists public.candidates add column if not exists approval_requested_at text`,
    `alter table if exists public.candidates add column if not exists submitted_at text`,

    `alter table if exists public.submissions add column if not exists submitted_at text`,
    `alter table if exists public.submissions add column if not exists approval_requested_at text`,
    `alter table if exists public.submissions add column if not exists effective_submission_at text`,
    `alter table if exists public.submissions add column if not exists submission_origin_at text`,
    `alter table if exists public.submissions add column if not exists reminder_due_at text`,
    `alter table if exists public.submissions add column if not exists approval_reminder_at text`,
    `alter table if exists public.submissions add column if not exists reminder_snoozed_until text`,
    `alter table if exists public.submissions add column if not exists reminder_note text`,
    `alter table if exists public.submissions add column if not exists next_follow_up_at text`,

    `alter table if exists public.tasks add column if not exists due_at text`,
    `alter table if exists public.tasks add column if not exists reminder_at text`,
    `alter table if exists public.interviews add column if not exists scheduled_at text`,
    `alter table if exists public.notifications add column if not exists updated_at text`,
    `alter table if exists public.presence add column if not exists locked_at text`,
    `alter table if exists public.unlock_requests add column if not exists late_minutes text`,
    `alter table if exists public.unlock_requests add column if not exists lock_started_at text`,
    `alter table if exists public.unlock_requests add column if not exists returned_at text`,
    `alter table if exists public.unlock_requests add column if not exists access_kind text`,
    `alter table if exists public.unlock_requests add column if not exists break_session_key text`,
    `alter table if exists public.unlock_requests add column if not exists permission_until text`,
  ];
  for (const sql of statements) {
    try { await store.pool.query(sql); }
    catch (error) { console.warn('Critical schema repair skipped:', error?.message || error); }
  }
}

async function bootstrapIfNeeded() {
  if (mode !== 'postgres' || !store.pool) return;

  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await store.pool.query('select 1 as ok');
      await ensureCriticalProfileSchema();
      await ensureDefaultSettings();
      return;
    } catch (error) {
      lastError = error;
      console.error(`Bootstrap attempt ${attempt} failed:`, error?.message || error);
      if (attempt < 4) await wait(1200 * attempt);
    }
  }

  throw lastError;
}

module.exports = { bootstrapIfNeeded, ensureCriticalProfileSchema };
