-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists capture_sessions (
  id uuid primary key,
  recording_id uuid not null references recordings(id) on delete cascade,
  started_by_user_id uuid references users(id) on delete set null,
  status text not null check (status in ('recording', 'finalized')),
  insert_after_item_id uuid references guide_items(id) on delete set null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);

create index if not exists idx_capture_sessions_recording_id
  on capture_sessions(recording_id, status, created_at);

alter table recording_events
  add column if not exists capture_session_id uuid references capture_sessions(id) on delete set null;

create index if not exists idx_recording_events_capture_session_id
  on recording_events(capture_session_id, ordinal);
