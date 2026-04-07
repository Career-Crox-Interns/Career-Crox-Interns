alter table public.submissions add column if not exists submitted_by_user_id text;
alter table public.submissions add column if not exists submitted_by_name text;
alter table public.submissions add column if not exists submitted_by_recruiter_code text;
alter table public.submissions add column if not exists updated_at text;

update public.submissions
set updated_at = coalesce(nullif(updated_at, ''), nullif(submitted_at, ''), nullif(approval_requested_at, ''), now()::text)
where coalesce(updated_at, '') = '';

create index if not exists submissions_candidate_pending_idx
  on public.submissions(candidate_id, approval_status, submitted_at);
