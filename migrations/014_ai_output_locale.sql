-- SPDX-License-Identifier: AGPL-3.0-only
alter table recording_videos
  add column if not exists ai_output_locale text not null default 'en'
  check (ai_output_locale in ('en', 'ga', 'fr', 'de'));
