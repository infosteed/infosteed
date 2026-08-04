-- SPDX-License-Identifier: AGPL-3.0-only
alter table sessions add column if not exists csrf_token_hash text;
alter table sessions add column if not exists csrf_token_created_at timestamptz;

create table if not exists auth_login_attempts (
  id uuid primary key,
  username text not null,
  ip_address text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_login_attempts_lookup_idx
  on auth_login_attempts (lower(username), ip_address, created_at desc);

create table if not exists audit_events (
  id uuid primary key,
  actor_user_id uuid references users(id) on delete set null,
  event_type text not null,
  entity_type text,
  entity_id text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_at_idx on audit_events(created_at desc);
create index if not exists audit_events_actor_user_id_idx on audit_events(actor_user_id);
create index if not exists audit_events_entity_idx on audit_events(entity_type, entity_id);
create index if not exists audit_events_event_type_idx on audit_events(event_type);

create table if not exists guide_versions (
  id uuid primary key,
  recording_id uuid not null references recordings(id) on delete cascade,
  created_by_user_id uuid references users(id) on delete set null,
  version_type text not null check (version_type in ('auto', 'named', 'restore')),
  message text,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists guide_versions_recording_created_idx
  on guide_versions(recording_id, created_at desc);
create index if not exists guide_versions_created_by_idx
  on guide_versions(created_by_user_id);
