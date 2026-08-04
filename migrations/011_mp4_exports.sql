-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists recording_video_exports (
  id uuid primary key,
  video_id uuid not null references recording_videos(id) on delete cascade,
  render_id uuid not null unique references recording_video_renders(id) on delete cascade,
  status text not null check (status in ('queued', 'processing', 'ready', 'failed')),
  progress double precision not null default 0 check (progress between 0 and 1),
  attempts integer not null default 0 check (attempts >= 0),
  storage_key text unique,
  mime_type text,
  codec text,
  byte_size bigint not null default 0,
  error_message text,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_video_exports_claim
  on recording_video_exports(status, created_at);
create index if not exists idx_video_exports_video
  on recording_video_exports(video_id, created_at desc);
