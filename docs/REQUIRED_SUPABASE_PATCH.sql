-- Career Crox required patch for smoother Render + Supabase runtime

create table if not exists public.active_sessions (
    username text primary key,
    session_token text,
    ip_address text,
    user_agent text,
    updated_at timestamptz default now()
);

alter table public.active_sessions disable row level security;

alter table public.users add column if not exists username text;
alter table public.users add column if not exists role text;
alter table public.users add column if not exists recruiter_code text;
alter table public.users add column if not exists is_active text;
alter table public.users add column if not exists theme_name text;

alter table public.candidates add column if not exists preferred_location text;
alter table public.candidates add column if not exists follow_up_at text;
alter table public.candidates add column if not exists follow_up_note text;
alter table public.candidates add column if not exists follow_up_status text;
alter table public.candidates add column if not exists approval_status text;
alter table public.candidates add column if not exists approval_requested_at text;
alter table public.candidates add column if not exists approved_at text;
alter table public.candidates add column if not exists approved_by_name text;

alter table public.submissions add column if not exists approval_status text;
alter table public.submissions add column if not exists approval_requested_at text;
alter table public.submissions add column if not exists approved_by_name text;
alter table public.submissions add column if not exists approved_at text;
alter table public.submissions add column if not exists approval_rescheduled_at text;

alter table public.unlock_requests add column if not exists approved_by_user_id text;
alter table public.unlock_requests add column if not exists approved_by_name text;
alter table public.unlock_requests add column if not exists approved_at text;

create index if not exists idx_candidates_recruiter_code on public.candidates(recruiter_code);
create index if not exists idx_candidates_updated_at on public.candidates(updated_at);
create index if not exists idx_candidates_follow_up_at on public.candidates(follow_up_at);
create index if not exists idx_candidates_approval_status on public.candidates(approval_status);

create index if not exists idx_submissions_candidate_id on public.submissions(candidate_id);
create index if not exists idx_submissions_recruiter_code on public.submissions(recruiter_code);
create index if not exists idx_submissions_approval_status on public.submissions(approval_status);
create index if not exists idx_submissions_submitted_at on public.submissions(submitted_at);

create index if not exists idx_interviews_candidate_id on public.interviews(candidate_id);
create index if not exists idx_interviews_scheduled_at on public.interviews(scheduled_at);

create index if not exists idx_tasks_assigned_to_user_id on public.tasks(assigned_to_user_id);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_tasks_due_date on public.tasks(due_date);

create index if not exists idx_notifications_user_id_status on public.notifications(user_id, status);
create index if not exists idx_unlock_requests_user_id_status on public.unlock_requests(user_id, status);
create index if not exists idx_presence_user_id on public.presence(user_id);
