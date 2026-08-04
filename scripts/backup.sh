#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

compose_file=${COMPOSE_FILE:-deploy/compose.production.yml}
env_file=${ENV_FILE:-deploy/production.env}
set -a
source "$env_file"
set +a
backup_root=${1:-backups}
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="$backup_root/$timestamp"

mkdir -p "$backup_dir/objects"
compose=(docker compose --env-file "$env_file" -f "$compose_file")

restart_writers() {
  "${compose[@]}" up -d api web caddy video-render-worker >/dev/null
}
trap restart_writers EXIT

"${compose[@]}" stop caddy web api video-render-worker
"${compose[@]}" exec -T postgres pg_dump -Fc -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" > "$backup_dir/postgres.dump"
"${compose[@]}" exec -T postgres psql -At -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" \
  -c "select version from schema_migrations order by version" > "$backup_dir/migrations.txt"

"${compose[@]}" run --rm --no-deps --entrypoint /bin/sh \
  -v "$PWD/$backup_dir/objects:/backup" minio-init -c \
  'mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null && mc mirror --overwrite "source/$S3_BUCKET" /backup'

(cd "$backup_dir" && find . -type f ! -name checksums.sha256 ! -name manifest.txt -print0 \
  | sort -z | xargs -0 sha256sum > checksums.sha256)

database_bytes=$(stat -c %s "$backup_dir/postgres.dump")
object_bytes=$(du -sb "$backup_dir/objects" | cut -f1)
cat > "$backup_dir/manifest.txt" <<EOF
format_version=1
application_version=${RELEASE_VERSION:-unknown}
release_commit=${RELEASE_COMMIT:-unknown}
created_at=$timestamp
database_bytes=$database_bytes
object_bytes=$object_bytes
migrations_file=migrations.txt
checksums_file=checksums.sha256
EOF

trap - EXIT
restart_writers
printf 'Backup completed: %s\n' "$backup_dir"
