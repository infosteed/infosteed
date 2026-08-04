-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists recordings (
  id uuid primary key,
  title text not null,
  purpose text,
  audience text,
  state text not null check (state in ('recording', 'paused', 'finalized')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz
);

create table if not exists recording_events (
  id uuid primary key,
  recording_id uuid not null references recordings(id) on delete cascade,
  ordinal integer not null,
  action_type text not null,
  page_title text not null,
  sanitized_url text not null,
  element_name text,
  element_role text,
  label_text text,
  nearby_heading text,
  input_category text,
  bounding_box jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (recording_id, ordinal)
);

create index if not exists idx_recording_events_recording_id
  on recording_events(recording_id, ordinal);

create table if not exists screenshots (
  id uuid primary key,
  recording_id uuid not null references recordings(id) on delete cascade,
  event_id uuid not null references recording_events(id) on delete cascade,
  filename text not null,
  content_type text not null,
  byte_size integer not null,
  original_image bytea not null,
  annotated_image bytea not null,
  target_box jsonb,
  created_at timestamptz not null default now(),
  unique (recording_id, filename)
);

create index if not exists idx_screenshots_event_id
  on screenshots(event_id);

create table if not exists guide_steps (
  id uuid primary key,
  recording_id uuid not null references recordings(id) on delete cascade,
  event_id uuid references recording_events(id) on delete set null,
  ordinal integer not null,
  title text not null,
  instruction text not null,
  image_filename text,
  alt_text text,
  source text not null check (source in ('deterministic', 'ai', 'manual')),
  user_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recording_id, ordinal)
);

create index if not exists idx_guide_steps_recording_id
  on guide_steps(recording_id, ordinal);
