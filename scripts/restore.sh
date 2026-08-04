#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

if [[ (${1:-} != "--confirm-empty-target" && ${1:-} != "--confirm-replace-target") || -z ${2:-} ]]; then
  echo "Usage: scripts/restore.sh (--confirm-empty-target|--confirm-replace-target) BACKUP_DIRECTORY" >&2
  exit 2
fi

restore_mode=$1
backup_dir=$2
# shellcheck source=production-compose.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-compose.sh"
production_load_compose

if [[ $backup_dir != /* ]]; then
  backup_dir="$production_root/$backup_dir"
fi

test -f "$backup_dir/manifest.txt"
test -f "$backup_dir/postgres.dump"
test -f "$backup_dir/checksums.sha256"
(cd "$backup_dir" && sha256sum --check checksums.sha256)

table_count=$("${production_compose[@]}" exec -T postgres psql -At -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" \
  -c "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'")
if [[ $restore_mode == --confirm-empty-target && $table_count != "0" ]]; then
  echo "Refusing restore: the target database is not empty." >&2
  exit 1
fi

object_count=$("${production_compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c \
  'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc find "target/$S3_BUCKET" --type f | wc -l')
if [[ $restore_mode == --confirm-empty-target && $object_count != "0" ]]; then
  echo "Refusing restore: the target object bucket is not empty." >&2
  exit 1
fi

"${production_compose[@]}" stop caddy web api video-render-worker
if [[ $restore_mode == --confirm-replace-target ]]; then
  "${production_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" \
    -c "drop schema public cascade; create schema public"
  if [[ $object_count != "0" ]]; then
    "${production_compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c \
      'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc rm --recursive --force "target/$S3_BUCKET"'
  fi
else
  "${production_compose[@]}" exec -T postgres psql -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" -c "drop table if exists schema_migrations"
fi
"${production_compose[@]}" exec -T postgres pg_restore --exit-on-error --no-owner -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-app}" < "$backup_dir/postgres.dump"
"${production_compose[@]}" run --rm --no-deps --entrypoint /bin/sh \
  -v "$backup_dir/objects:/restore:ro" minio-init -c \
  'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite /restore "target/$S3_BUCKET"'

expected_objects=$(find "$backup_dir/objects" -type f | wc -l)
actual_objects=$("${production_compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c \
  'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc find "target/$S3_BUCKET" --type f | wc -l')
if [[ $expected_objects != "$actual_objects" ]]; then
  echo "Restore verification failed: object count differs." >&2
  exit 1
fi

"${production_compose[@]}" up -d --pull never api web caddy video-render-worker
printf 'Restore completed from: %s\n' "$backup_dir"
