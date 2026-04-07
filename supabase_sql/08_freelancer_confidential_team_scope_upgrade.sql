-- Freelancer confidential CRM team scope upgrade
alter table if exists public.users add column if not exists assigned_tl_user_id text;
alter table if exists public.users add column if not exists assigned_tl_name text;

update public.users set assigned_tl_user_id = nullif(assigned_tl_user_id, ''), assigned_tl_name = nullif(assigned_tl_name, '');

create index if not exists idx_users_assigned_tl_user_id on public.users(assigned_tl_user_id);
