-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists recording_video_edit_drafts (
  video_id uuid primary key references recording_videos(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  recipe jsonb not null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recording_video_edit_versions (
  id uuid primary key,
  video_id uuid not null references recording_videos(id) on delete cascade,
  revision integer not null check (revision >= 0),
  version_type text not null check (version_type in ('named', 'render', 'restore')),
  name text,
  recipe jsonb not null,
  media_hash text not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table if not exists recording_video_renders (
  id uuid primary key,
  video_id uuid not null references recording_videos(id) on delete cascade,
  edit_version_id uuid not null unique references recording_video_edit_versions(id) on delete cascade,
  reused_render_id uuid references recording_video_renders(id) on delete set null,
  media_hash text not null,
  status text not null check (status in ('queued', 'processing', 'ready', 'failed', 'canceled', 'expired')),
  progress double precision not null default 0 check (progress between 0 and 1),
  attempts integer not null default 0 check (attempts >= 0),
  storage_key text unique,
  mime_type text,
  codec text,
  byte_size bigint not null default 0,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_message text,
  cancel_requested boolean not null default false,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  cleanup_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recording_video_render_workers (
  id text primary key,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

alter table recording_videos
  add column if not exists published_edit_version_id uuid
    references recording_video_edit_versions(id) on delete set null;

create index if not exists idx_video_edit_versions_video_created
  on recording_video_edit_versions(video_id, created_at desc);
create index if not exists idx_video_renders_claim
  on recording_video_renders(status, created_at);
create index if not exists idx_video_renders_media_hash
  on recording_video_renders(video_id, media_hash, status);
create index if not exists idx_video_renders_cleanup
  on recording_video_renders(cleanup_after) where cleanup_after is not null;
