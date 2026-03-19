-- Career Crox speed + session safety patch
-- Run in Supabase SQL Editor after deploying the updated zip.

create table if not exists public.active_sessions (
    username text primary key,
    session_token text,
    ip_address text,
    user_agent text,
    updated_at timestamptz default now()
);

alter table public.active_sessions add column if not exists session_token text;
alter table public.active_sessions add column if not exists ip_address text;
alter table public.active_sessions add column if not exists user_agent text;
alter table public.active_sessions add column if not exists updated_at timestamptz default now();
alter table public.active_sessions disable row level security;

create index if not exists idx_candidates_recruiter_code on public.candidates(recruiter_code);
create index if not exists idx_candidates_updated_at on public.candidates(updated_at);
create index if not exists idx_candidates_created_at on public.candidates(created_at);
create index if not exists idx_candidates_status on public.candidates(status);

create index if not exists idx_interviews_candidate_id on public.interviews(candidate_id);
create index if not exists idx_interviews_scheduled_at on public.interviews(scheduled_at);
create index if not exists idx_submissions_candidate_id on public.submissions(candidate_id);
create index if not exists idx_submissions_recruiter_code on public.submissions(recruiter_code);
create index if not exists idx_submissions_submitted_at on public.submissions(submitted_at);
