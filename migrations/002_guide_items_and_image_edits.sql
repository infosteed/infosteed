-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists guide_items (
  id uuid primary key,
  recording_id uuid not null references recordings(id) on delete cascade,
  event_id uuid references recording_events(id) on delete set null,
  ordinal integer not null,
  kind text not null check (kind in ('step', 'tip', 'alert', 'header')),
  title text not null,
  body text not null,
  image_filename text,
  alt_text text,
  source text not null check (source in ('deterministic', 'ai', 'manual')),
  user_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recording_id, ordinal)
);

create index if not exists idx_guide_items_recording_id
  on guide_items(recording_id, ordinal);

insert into guide_items (
  id, recording_id, event_id, ordinal, kind, title, body,
  image_filename, alt_text, source, user_edited, created_at, updated_at
)
select
  id, recording_id, event_id, ordinal, 'step', title, instruction,
  image_filename, alt_text, source, user_edited, created_at, updated_at
from guide_steps
on conflict (id) do nothing;

alter table screenshots
  add column if not exists edit_operations jsonb not null default '{"redactions":[]}'::jsonb,
  add column if not exists edited_image bytea;
