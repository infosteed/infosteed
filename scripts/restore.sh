#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

if [[ ${1:-} != "--confirm-empty-target" || -z ${2:-} ]]; then
  echo "Usage: scripts/restore.sh --confirm-empty-target BACKUP_DIRECTORY" >&2
  exit 2
fi

backup_dir=$2
compose_file=${COMPOSE_FILE:-deploy/compose.production.yml}
env_file=${ENV_FILE:-deploy/production.env}
set -a
source "$env_file"
set +a
compose=(docker compose --env-file "$env_file" -f "$compose_file")

test -f "$backup_dir/manifest.txt"
test -f "$backup_dir/postgres.dump"
test -f "$backup_dir/checksums.sha256"
(cd "$backup_dir" && sha256sum --check checksums.sha256)

table_count=$("${compose[@]}" exec -T postgres psql -At -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" \
  -c "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'")
if [[ $table_count != "0" ]]; then
  echo "Refusing restore: the target database is not empty." >&2
  exit 1
fi

object_count=$("${compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c \
  'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc find "target/$S3_BUCKET" --type f | wc -l')
if [[ $object_count != "0" ]]; then
  echo "Refusing restore: the target object bucket is not empty." >&2
  exit 1
fi

"${compose[@]}" stop caddy web api video-render-worker
"${compose[@]}" exec -T postgres psql -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" -c "drop table if exists schema_migrations"
"${compose[@]}" exec -T postgres pg_restore --exit-on-error --no-owner -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-app}" < "$backup_dir/postgres.dump"
"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh \
  -v "$PWD/$backup_dir/objects:/restore:ro" minio-init -c \
  'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite /restore "target/$S3_BUCKET"'

expected_objects=$(find "$backup_dir/objects" -type f | wc -l)
actual_objects=$("${compose[@]}" run --rm --no-deps --entrypoint /bin/sh minio-init -c \
  'mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc find "target/$S3_BUCKET" --type f | wc -l')
if [[ $expected_objects != "$actual_objects" ]]; then
  echo "Restore verification failed: object count differs." >&2
  exit 1
fi

"${compose[@]}" up -d api web caddy video-render-worker
printf 'Restore completed from: %s\n' "$backup_dir"
