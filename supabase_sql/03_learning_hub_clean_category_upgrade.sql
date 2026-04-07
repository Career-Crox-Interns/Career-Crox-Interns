-- Additive upgrade: learning hub cleanup categories and better defaults
-- Safe to run on existing data. No old data is deleted.

alter table if exists public.yt_hub_playlists
  add column if not exists category text default 'interview-prep';

update public.yt_hub_playlists
set category = case
  when lower(coalesce(title,'' ) || ' ' || coalesce(description,'')) like '%gen z%' then 'genz-english'
  when lower(coalesce(title,'' ) || ' ' || coalesce(description,'')) like '%gen-z%' then 'genz-english'
  when lower(coalesce(title,'' ) || ' ' || coalesce(description,'')) like '%funky%' then 'genz-english'
  when lower(coalesce(title,'' ) || ' ' || coalesce(description,'')) like '%english%' then 'advanced-english'
  when lower(coalesce(title,'' ) || ' ' || coalesce(description,'')) like '%jargon%' then 'advanced-english'
  else coalesce(nullif(category,''), 'interview-prep')
end
where coalesce(category,'') = '';

create index if not exists idx_yt_hub_playlists_category
  on public.yt_hub_playlists(category);

comment on column public.yt_hub_playlists.category is 'UI row category for YT Hub: interview-prep, advanced-english, genz-english';
