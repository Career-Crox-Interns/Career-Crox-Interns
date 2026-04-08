-- Additive upgrade for bulk resume import + manager data extractor.
-- Safe to run on an existing Career Crox database.

create table if not exists public.bulk_candidate_import_batches (
  batch_id text primary key,
  created_by_user_id text,
  created_by_name text,
  source_label text,
  total_items integer default 0,
  imported_items integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.bulk_candidate_import_items (
  item_id text primary key,
  batch_id text references public.bulk_candidate_import_batches(batch_id) on delete cascade,
  source_filename text,
  extracted_name text,
  extracted_phone text,
  extracted_email text,
  extracted_location text,
  extracted_qualification text,
  extracted_total_experience text,
  extracted_relevant_experience text,
  extracted_companies text,
  extracted_linkedin_url text,
  extracted_notes text,
  final_candidate_id text,
  final_status text default 'reviewed',
  created_at timestamptz default now()
);

create table if not exists public.client_extractor_runs (
  run_id text primary key,
  created_by_user_id text,
  created_by_name text,
  source_type text,
  source_label text,
  extracted_count integer default 0,
  exported_count integer default 0,
  added_to_database_count integer default 0,
  created_at timestamptz default now()
);

create index if not exists idx_bulk_candidate_import_items_batch_id on public.bulk_candidate_import_items(batch_id);
create index if not exists idx_client_extractor_runs_created_at on public.client_extractor_runs(created_at desc);
