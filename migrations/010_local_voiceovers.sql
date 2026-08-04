-- SPDX-License-Identifier: AGPL-3.0-only
alter table recording_video_assets drop constraint if exists recording_video_assets_kind_check;
alter table recording_video_assets add constraint recording_video_assets_kind_check
  check (kind in ('composite', 'screen', 'camera', 'microphone', 'transcription', 'voiceover'));
alter table recording_video_assets drop constraint if exists recording_video_assets_video_id_kind_key;
create unique index if not exists idx_recording_video_assets_unique_source_kind
  on recording_video_assets(video_id, kind) where kind <> 'voiceover';

create table if not exists recording_voiceover_clips (
  id uuid primary key,
  content_hash text not null unique,
  provider text not null,
  model text not null,
  voice text not null,
  speed double precision not null check (speed between 0.5 and 2),
  text text not null,
  storage_key text not null unique,
  mime_type text not null default 'audio/wav',
  byte_size bigint not null check (byte_size > 0),
  duration_ms integer not null check (duration_ms > 0),
  created_at timestamptz not null default now()
);

create table if not exists recording_voiceover_generations (
  id uuid primary key,
  video_id uuid not null references recording_videos(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  status text not null check (status in ('queued', 'processing', 'ready', 'failed')),
  progress double precision not null default 0 check (progress between 0 and 1),
  attempts integer not null default 0 check (attempts >= 0),
  provider text not null,
  model text not null,
  voice text not null,
  speed double precision not null check (speed between 0.5 and 2),
  script_hash text not null,
  request_hash text not null,
  asset_id uuid references recording_video_assets(id) on delete set null,
  error_message text,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, request_hash)
);

create table if not exists recording_voiceover_generation_cues (
  generation_id uuid not null references recording_voiceover_generations(id) on delete cascade,
  cue_id text not null,
  ordinal integer not null check (ordinal >= 0),
  source_start_ms integer not null check (source_start_ms >= 0),
  source_end_ms integer not null check (source_end_ms > source_start_ms),
  text text not null,
  content_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'failed')),
  clip_id uuid references recording_voiceover_clips(id) on delete set null,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  overlong_by_ms integer not null default 0 check (overlong_by_ms >= 0),
  error_message text,
  primary key (generation_id, cue_id),
  unique (generation_id, ordinal)
);

create index if not exists idx_voiceover_generations_claim
  on recording_voiceover_generations(status, created_at);
create index if not exists idx_voiceover_generations_video
  on recording_voiceover_generations(video_id, created_at desc);
create index if not exists idx_voiceover_cues_content_hash
  on recording_voiceover_generation_cues(content_hash);
