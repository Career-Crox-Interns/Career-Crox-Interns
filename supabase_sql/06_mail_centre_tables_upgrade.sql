-- Patch 15: Mail Centre tables for Supabase / Postgres deploy
create table if not exists public.mail_templates (
  template_id text primary key,
  title text,
  category text,
  subject text,
  body text,
  visibility_role text,
  sort_order text,
  updated_at text,
  created_at text,
  created_by_user_id text,
  created_by_name text
);

create table if not exists public.mail_drafts (
  draft_id text primary key,
  title text,
  template_id text,
  to_emails text,
  cc_emails text,
  bcc_emails text,
  subject text,
  body text,
  target_kind text,
  placeholder_name text,
  created_by_user_id text,
  created_by_name text,
  created_at text,
  updated_at text,
  is_auto_generated text default '0'
);

create table if not exists public.mail_logs (
  log_id text primary key,
  draft_id text,
  template_id text,
  title text,
  to_emails text,
  cc_emails text,
  bcc_emails text,
  subject text,
  body text,
  sent_to_count text,
  recipient_labels text,
  created_by_user_id text,
  created_by_name text,
  created_at text
);

create index if not exists idx_mail_templates_created_by on public.mail_templates (created_by_user_id);
create index if not exists idx_mail_drafts_created_by on public.mail_drafts (created_by_user_id);
create index if not exists idx_mail_logs_created_by on public.mail_logs (created_by_user_id);
