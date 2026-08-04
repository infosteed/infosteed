-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists users (
  id uuid primary key,
  username text not null,
  display_name text not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'user')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_username_lower_unique on users (lower(username));

create table if not exists sessions (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on sessions(user_id);
create index if not exists sessions_expires_at_idx on sessions(expires_at);

create table if not exists projects (
  id uuid primary key,
  owner_user_id uuid not null references users(id) on delete cascade,
  name text not null,
  description text,
  private boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_user_id_idx on projects(owner_user_id);

create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_id_idx on project_members(user_id);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table recordings add column if not exists owner_user_id uuid references users(id) on delete set null;
alter table recordings add column if not exists project_id uuid references projects(id) on delete set null;

create index if not exists recordings_owner_user_id_idx on recordings(owner_user_id);
create index if not exists recordings_project_id_idx on recordings(project_id);
