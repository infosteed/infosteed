-- SPDX-License-Identifier: AGPL-3.0-only
alter table recordings
  add column if not exists capture_mode text not null default 'guide'
  check (capture_mode in ('guide', 'video', 'both'));

alter table recording_events
  add column if not exists video_offset_ms integer
  check (video_offset_ms is null or video_offset_ms >= 0);

create table if not exists recording_videos (
  id uuid primary key,
  recording_id uuid not null unique references recordings(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  status text not null check (status in ('initializing', 'recording', 'finalizing', 'ready', 'published', 'failed')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  capture_settings jsonb not null default '{}'::jsonb,
  raw_assets_complete boolean not null default true,
  recovered boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  published_at timestamptz
);

create table if not exists recording_video_assets (
  id uuid primary key,
  video_id uuid not null references recording_videos(id) on delete cascade,
  kind text not null check (kind in ('composite', 'screen', 'camera', 'microphone')),
  mime_type text not null,
  codec text,
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  storage_key text not null unique,
  multipart_upload_id text,
  byte_size bigint not null default 0,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  status text not null check (status in ('uploading', 'complete', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (video_id, kind)
);

create table if not exists recording_video_parts (
  asset_id uuid not null references recording_video_assets(id) on delete cascade,
  part_number integer not null check (part_number between 1 and 10000),
  etag text not null,
  byte_size integer not null check (byte_size > 0),
  started_at_ms integer,
  ended_at_ms integer,
  uploaded_at timestamptz not null default now(),
  primary key (asset_id, part_number)
);

create index if not exists idx_recording_videos_status on recording_videos(status, updated_at);
create index if not exists idx_recording_video_assets_video on recording_video_assets(video_id, kind);
