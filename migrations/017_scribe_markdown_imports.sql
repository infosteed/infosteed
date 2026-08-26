-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists scribe_markdown_import_jobs (
  id uuid primary key,
  created_by_user_id uuid not null references users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  status text not null check (status in (
    'queued', 'processing', 'completed', 'completed_with_warnings', 'failed'
  )),
  original_filename text not null,
  source_markdown text not null,
  source_url text,
  recording_id uuid references recordings(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists scribe_markdown_import_jobs_user_created_idx
  on scribe_markdown_import_jobs(created_by_user_id, created_at desc);
create index if not exists scribe_markdown_import_jobs_status_idx
  on scribe_markdown_import_jobs(status, updated_at);

create table if not exists scribe_markdown_import_assets (
  id uuid primary key,
  job_id uuid not null references scribe_markdown_import_jobs(id) on delete cascade,
  step_ordinal integer not null,
  source_url text not null,
  filename text not null,
  status text not null check (status in ('pending', 'retry', 'downloaded', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  source_byte_size integer,
  image_data bytea,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, step_ordinal)
);

create index if not exists scribe_markdown_import_assets_ready_idx
  on scribe_markdown_import_assets(status, next_attempt_at, created_at);
