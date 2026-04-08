-- Additive self-signup and password reset upgrade for Career Crox
-- Safe to run on an existing database. No old table is dropped.

create table if not exists public.user_onboarding_requests (
  request_id text primary key,
  user_id text,
  username text,
  full_name text,
  email text,
  recruiter_code text,
  designation text,
  role text,
  status text,
  requested_at text,
  approved_at text,
  approved_by_name text,
  notes text
);

create table if not exists public.user_onboarding_documents (
  document_id text primary key,
  request_id text,
  user_id text,
  username text,
  document_type text,
  original_name text,
  mime_type text,
  size_bytes text,
  content_base64 text,
  status text,
  created_at text
);

create table if not exists public.password_reset_requests (
  request_id text primary key,
  user_id text,
  username text,
  full_name text,
  email text,
  recruiter_code text,
  status text,
  reason text,
  requested_at text,
  resolved_by_name text,
  resolved_at text
);

alter table public.scheduled_reports add column if not exists snapshot_json text;
alter table public.scheduled_reports add column if not exists period_key text;
alter table public.submissions add column if not exists submitted_by_user_id text;
alter table public.submissions add column if not exists submitted_by_name text;
alter table public.submissions add column if not exists submitted_by_recruiter_code text;
