-- SPDX-License-Identifier: AGPL-3.0-only
create table if not exists word_export_templates (
  id uuid primary key,
  name text not null,
  original_filename text not null,
  content bytea not null,
  sha256 text not null,
  validation_report jsonb not null,
  is_default boolean not null default false,
  uploaded_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists word_export_templates_name_lower_unique
  on word_export_templates (lower(name));

create unique index if not exists word_export_templates_single_default
  on word_export_templates (is_default)
  where is_default;
