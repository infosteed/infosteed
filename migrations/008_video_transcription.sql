-- SPDX-License-Identifier: AGPL-3.0-only
alter table recording_videos
  add column if not exists transcription_status text not null default 'disabled'
    check (transcription_status in ('disabled', 'pending', 'processing', 'ready', 'failed')),
  add column if not exists transcription_language text,
  add column if not exists transcription_error_message text,
  add column if not exists transcription_started_at timestamptz,
  add column if not exists transcription_completed_at timestamptz;

alter table recording_video_assets
  drop constraint if exists recording_video_assets_kind_check;

alter table recording_video_assets
  add constraint recording_video_assets_kind_check
  check (kind in ('composite', 'screen', 'camera', 'microphone', 'transcription'));

create table if not exists recording_video_transcripts (
  video_id uuid primary key references recording_videos(id) on delete cascade,
  model text not null,
  source_asset_kind text not null
    check (source_asset_kind in ('composite', 'screen', 'camera', 'microphone', 'transcription')),
  language text,
  language_probability double precision
    check (language_probability is null or language_probability between 0 and 1),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  transcript_text text not null,
  segments jsonb not null default '[]'::jsonb,
  words jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists recording_video_chapter_titles (
  video_id uuid not null references recording_videos(id) on delete cascade,
  event_id uuid not null references recording_events(id) on delete cascade,
  title text not null,
  source text not null check (source in ('ai', 'deterministic')),
  updated_at timestamptz not null default now(),
  primary key (video_id, event_id)
);

create index if not exists idx_recording_videos_transcription_status
  on recording_videos(transcription_status, updated_at);
