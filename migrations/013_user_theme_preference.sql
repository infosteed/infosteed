-- SPDX-License-Identifier: AGPL-3.0-only
alter table users
  add column if not exists theme_preference text not null default 'system'
  check (theme_preference in ('light', 'dark', 'system'));
