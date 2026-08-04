-- SPDX-License-Identifier: AGPL-3.0-only
alter table users add column if not exists two_factor_required boolean not null default false;

create table if not exists user_totp_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  secret_ciphertext text not null,
  last_accepted_counter bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_recovery_codes (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null unique,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_recovery_codes_user_id_idx
  on user_recovery_codes(user_id);
create index if not exists user_recovery_codes_available_idx
  on user_recovery_codes(user_id, consumed_at)
  where consumed_at is null;

create table if not exists two_factor_continuations (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null check (purpose in ('login', 'enrollment_login', 'account_enrollment')),
  totp_secret_ciphertext text,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists two_factor_continuations_user_id_idx
  on two_factor_continuations(user_id);
create index if not exists two_factor_continuations_expires_at_idx
  on two_factor_continuations(expires_at);
