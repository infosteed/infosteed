-- SPDX-License-Identifier: AGPL-3.0-only
alter table recordings add column if not exists deleted_at timestamptz;
alter table recordings add column if not exists deleted_by_user_id uuid references users(id) on delete set null;

create index if not exists recordings_deleted_at_idx on recordings(deleted_at);
