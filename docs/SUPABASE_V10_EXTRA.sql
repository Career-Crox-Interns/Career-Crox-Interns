-- Extra table for single-session login support
create table if not exists active_sessions (
  username text primary key,
  session_token text,
  ip_address text,
  user_agent text,
  updated_at text
);
