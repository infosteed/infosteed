#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-compose.sh"
production_load_compose
if [[ -n ${BACKUP_COMPOSE_FILE:-} ]]; then
  test -f "$BACKUP_COMPOSE_FILE"
  production_check_env_permissions "$BACKUP_COMPOSE_FILE"
  production_compose=(docker compose --env-file "$production_env_file" -f "$BACKUP_COMPOSE_FILE")
fi
leave_stopped=false
if [[ ${1:-} == --leave-stopped ]]; then leave_stopped=true; shift; fi
backup_root=${1:-backups}
[[ $backup_root == /* ]] || backup_root="$production_root/$backup_root"
umask 077
mkdir -p "$backup_root"
backup_dir=$(mktemp -d "$backup_root/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
restart_writers() {
  if [[ $leave_stopped == false ]]; then
    "${production_compose[@]}" up -d --pull never api web caddy video-render-worker >/dev/null
  fi
}
trap restart_writers EXIT
"${production_compose[@]}" stop caddy web api video-render-worker
"${production_compose[@]}" exec -T postgres pg_dump -Fc -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" > "$backup_dir/postgres.dump"
"${production_compose[@]}" exec -T postgres psql -At -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" \
  -c 'select version from schema_migrations order by version' > "$backup_dir/migrations.txt"
"${production_compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$backup_dir:/backup" storage-tools backup /backup
"${production_compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$backup_dir:/backup:ro" storage-tools validate /backup
cat > "$backup_dir/manifest.txt" <<MANIFEST
format_version=2
application_version=${RELEASE_VERSION:-unknown}
release_commit=${RELEASE_COMMIT:-unknown}
created_at=$(date -u +%Y%m%dT%H%M%SZ)
migrations_file=migrations.txt
checksums_file=checksums.sha256
MANIFEST
(cd "$backup_dir" && find . -type f ! -name checksums.sha256 ! -name complete -print0 | sort -z | xargs -0 sha256sum > checksums.sha256)
touch "$backup_dir/complete"
trap - EXIT
restart_writers
if [[ -n ${BACKUP_RESULT_FILE:-} ]]; then printf '%s\n' "$backup_dir" > "$BACKUP_RESULT_FILE"; fi
printf 'Backup completed: %s\n' "$backup_dir"
