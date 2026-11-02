#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail
if [[ (${1:-} != --confirm-empty-target && ${1:-} != --confirm-replace-target) || -z ${2:-} ]]; then
  echo 'Usage: scripts/restore.sh (--confirm-empty-target|--confirm-replace-target) BACKUP_DIRECTORY' >&2
  exit 2
fi
restore_mode=$1
backup_dir=$2
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/production-compose.sh"
production_load_compose
[[ $backup_dir == /* ]] || backup_dir="$production_root/$backup_dir"
test -f "$backup_dir/manifest.txt"
test -s "$backup_dir/postgres.dump"
(cd "$backup_dir" && sha256sum --strict --check checksums.sha256)
format=$(sed -n 's/^format_version=//p' "$backup_dir/manifest.txt")
[[ $format == 1 || $format == 2 ]] || production_die 'Unsupported backup format'
object_dir=$backup_dir
staging=""
cleanup() { [[ -z $staging ]] || rm -rf "$staging"; }
trap cleanup EXIT
if [[ $format == 2 ]]; then
  test -f "$backup_dir/complete"
else
  staging=$(mktemp -d)
  object_dir=$staging
  "${production_compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
    -v "$backup_dir:/legacy:ro" -v "$staging:/backup" storage-tools import-v1 /legacy /backup
fi
"${production_compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$object_dir:/backup:ro" storage-tools validate /backup
# From this point any failure leaves writers stopped, including failures in emptiness checks.
"${production_compose[@]}" stop caddy web api video-render-worker
restore_failure() {
  local status=$?
  trap - ERR
  "${production_compose[@]}" stop caddy web api video-render-worker >/dev/null 2>&1 || true
  printf 'Restore did not finish. Writers remain stopped; correct the failure before restarting.\n' >&2
  exit "$status"
}
trap restore_failure ERR
table_count=$("${production_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -At -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" \
  -c "select count(*) from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'")
if [[ $restore_mode == --confirm-empty-target ]]; then
  [[ $table_count == 0 ]] || production_die 'Refusing restore: target database is not empty'
  production_storage check --empty
else
  production_storage clear --confirm-replace-target
fi
"${production_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" \
  -c 'drop schema public cascade; create schema public'
"${production_compose[@]}" exec -T postgres pg_restore --exit-on-error --no-owner -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-app}" < "$backup_dir/postgres.dump"
if [[ $format == 1 ]]; then
  "${production_compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -qAt -U "${POSTGRES_USER:-app}" "${POSTGRES_DB:-app}" > "$staging/mime.json" <<'SQL'
create temporary table restored_media_mime (storage_key text, mime_type text);
do $legacy$
declare relation text;
begin
  foreach relation in array array['recording_video_assets', 'recording_video_renders', 'recording_video_exports', 'recording_voiceover_clips'] loop
    if to_regclass(relation) is not null then
      execute format('insert into restored_media_mime select storage_key, mime_type from %I where storage_key is not null and mime_type is not null', relation);
    end if;
  end loop;
end
$legacy$;
select coalesce(json_object_agg(storage_key, mime_type), '{}'::json) from restored_media_mime;
SQL
  "${production_compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
    -v "$staging:/backup" storage-tools mime-v1 /backup /backup/mime.json
fi
"${production_compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$object_dir:/backup:ro" storage-tools restore /backup
"${production_compose[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$object_dir:/backup:ro" storage-tools verify /backup
"${production_compose[@]}" up -d --pull never api web caddy video-render-worker
printf 'Restore completed from: %s\n' "$backup_dir"
