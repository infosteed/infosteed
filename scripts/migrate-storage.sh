#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Explicit, one-deployment migration. Never called by install/upgrade.
set -euo pipefail
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$script_dir/production-compose.sh"
if (($# != 4)); then
  echo 'Usage: scripts/migrate-storage.sh prepare|backup|restore|verify|cutover|rollback SOURCE_ENV DESTINATION_ENV STATE_DIRECTORY' >&2
  echo 'Source: legacy deployment env. Destination: Garage env with identical app image/release/DB settings and STORAGE_TOOLS_IMAGE pointing to the new CLI image.' >&2
  exit 2
fi
stage=$1
case $stage in
  prepare|backup|restore|verify|cutover|rollback) ;;
  *) production_die 'Unknown migration stage'; exit 2 ;;
esac
source_env=$(realpath "$2")
target_env=$(realpath "$3")
state=$(realpath -m "$4")
[[ $source_env != "$target_env" ]] || production_die 'Source and destination configuration must be separate files'
production_check_env_permissions "$source_env"
production_check_env_permissions "$target_env"
umask 077
mkdir -p "$state"
production_check_env_permissions "$state"
# Prevent two invocations from racing stage markers or cutover.
exec 9>"$state/lock"
flock -n 9 || production_die 'Another migration invocation holds the state lock'
if [[ -f $state/cutover.started && $stage != rollback ]]; then
  production_die 'Cutover was already attempted. Use coordinated rollback or normal application operations.'
fi
migration_failure() {
  local status=$?
  trap - ERR
  if [[ $stage != prepare ]]; then
    source_compose stop caddy web api video-render-worker >/dev/null 2>&1 || true
    target_compose stop caddy web api video-render-worker >/dev/null 2>&1 || true
  fi
  printf 'Migration stage failed. Writers remain stopped after maintenance begins. See docs/storage-migration.md; state: %s\n' "$state" >&2
  exit "$status"
}
trap migration_failure ERR

source_compose() {
  docker compose --env-file "$state/source.env" -f "$state/source.compose.yml" "$@"
}
target_compose() (
  if [[ -f $state/frozen.done ]]; then
    docker compose --env-file "$state/target.env" -f "$state/target.compose.yml" "$@"
    exit
  fi
  ENV_FILE="$state/target.env" production_load_compose
  "${production_compose[@]}" "$@"
)
# Run the new tooling on the original network using source S3 settings, without requiring legacy mc.
source_tools() (
  set -a
  source "$state/source.env"
  set +a
  export S3_ENDPOINT=${S3_ENDPOINT:-http://minio:9000} S3_REGION=${S3_REGION:-us-east-1} S3_BUCKET=${S3_BUCKET:-app-media}
  docker compose --env-file "$state/source.env" -f "$state/source.compose.yml" \
    -f "$state/tools.compose.yml" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
    -v "$state/backup:/backup" storage-tools "$@"
)
target_tools() {
  if [[ ${1:-} == check ]]; then
    target_compose run --rm --no-deps -T storage-tools "$@"
    return
  fi
  target_compose run --rm --no-deps -T --user "$(id -u):$(id -g)" \
    -v "$state/backup:/backup:ro" storage-tools "$@"
}
require_stage() { test -f "$state/$1.done" || production_die "Run migration stage '$1' first"; }
assert_stopped() {
  local service
  for service in caddy web api video-render-worker; do
    [[ -z $(source_compose ps --status running -q "$service") ]] || production_die "Source $service is still running"
    [[ -z $(target_compose ps --status running -q "$service") ]] || production_die "Target $service is still running"
  done
}
validate_backup() {
  test -f "$state/backup/complete"
  [[ $(sha256sum "$state/backup/checksums.sha256") == "$(<"$state/backup.identity")" ]] || production_die 'Backup identity differs from the recorded migration'
  (cd "$state/backup" && sha256sum --strict --check checksums.sha256 >/dev/null)
  source_tools validate /backup
}

if [[ $stage != prepare ]]; then
  test -f "$state/source.env" && test -f "$state/target.env"
  cmp -s "$source_env" "$state/source.env" || production_die 'Source environment differs from the prepared migration'
  cmp -s "$target_env" "$state/target.env" || production_die 'Destination environment differs from the prepared migration'
fi
case $stage in
  prepare)
    [[ ! -f $state/prepare.done ]] || production_die 'Migration already prepared; use the recorded state'
    [[ ! -f $state/source.env ]] || production_die 'Incomplete preparation exists; inspect it and choose a fresh state directory'
    cp "$source_env" "$state/source.env"
    cp "$target_env" "$state/target.env"
    # Check target modes and preserve source application/database configuration exactly.
    (
      ENV_FILE="$state/target.env" production_load_compose
      [[ $STORAGE_MODE == garage ]] || production_die 'Destination must use STORAGE_MODE=garage'
      [[ -n ${STORAGE_TOOLS_IMAGE:-} ]] || production_die 'Destination must set STORAGE_TOOLS_IMAGE to the new CLI image'
      printf '%s\n' "$STORAGE_TOOLS_IMAGE" > "$state/tools.image"
    )
    (
      set -a; source "$state/source.env"; set +a
      [[ -n ${RELEASE_COMMIT:-} ]] || production_die 'Source release commit is missing'
      # Optional explicit old files; otherwise recover the old release manifest from git.
      args=(docker compose --project-directory "$production_root/deploy" --env-file "$state/source.env")
      if [[ -n ${COMPOSE_FILE:-} ]]; then
        IFS=: read -r -a old_files <<< "$COMPOSE_FILE"
        for file in "${old_files[@]}"; do
          [[ $file == /* ]] || file="$production_root/$file"
          args+=(-f "$file")
        done
      else
        git -C "$production_root" show "$RELEASE_COMMIT:deploy/compose.production.yml" > "$state/source.original.yml"
        args+=(-f "$state/source.original.yml")
        if [[ ${IMAGE_SOURCE:-ghcr} == build ]]; then
          git -C "$production_root" show "$RELEASE_COMMIT:deploy/compose.build.yml" > "$state/source.build.yml"
          args+=(-f "$state/source.build.yml")
        fi
        case ${TLS_MODE:-public} in
          internal) export CADDY_CONFIG_FILE=./Caddyfile.internal ;;
          external) args+=(-f "$production_root/deploy/compose.external-tls.yml") ;;
        esac
      fi
      "${args[@]}" config > "$state/source.compose.yml"
    )
    target_compose --profile tools config > "$state/target.compose.yml"
    # Only S3 settings and the new tooling are allowed to differ in application containers.
    docker compose -f "$state/source.compose.yml" config --format json > "$state/source.json"
    docker compose -f "$state/target.compose.yml" --profile tools config --format json > "$state/target.json"
    node "$script_dir/storage-migration-config.mjs" "$state/source.json" "$state/target.json" "$state/tools.compose.yml" "$(<"$state/tools.image")"
    # Archive the exact images of running source containers, not mutable registry tags.
    source_compose ps -q > "$state/containers.txt"
    [[ -s $state/containers.txt ]] || production_die 'No source containers found; check Compose project identity'
    mapfile -t containers < "$state/containers.txt"
    docker inspect --format '{{.Image}}' "${containers[@]}" | sort -u > "$state/image-ids.txt"
    mapfile -t image_ids < "$state/image-ids.txt"
    docker image save -o "$state/source-images.tar" "${image_ids[@]}"
    docker inspect "${containers[@]}" > "$state/containers.json"
    node "$script_dir/storage-migration-config.mjs" freeze "$state"
    touch "$state/frozen.done"
    target_compose pull garage
    docker image inspect "$(<"$state/tools.image")" >/dev/null 2>&1 || target_compose pull storage-tools
    target_compose run --rm --no-deps -T storage-tools help >/dev/null
    target_compose up -d --no-deps --pull never --wait --wait-timeout 120 garage
    target_tools check --empty
    touch "$state/prepare.done"
    ;;
  backup)
    require_stage prepare
    [[ ! -d $state/backup ]] || production_die 'Backup already exists; preserve it and use a fresh state for a failed snapshot'
    source_compose stop caddy web api video-render-worker
    assert_stopped
    pending=$(source_compose exec -T postgres psql -v ON_ERROR_STOP=1 -At -U "$(source "$state/source.env"; printf '%s' "${POSTGRES_USER:-app}")" "$(source "$state/source.env"; printf '%s' "${POSTGRES_DB:-app}")" \
      -c "select count(*) from recording_video_assets where status = 'uploading' or multipart_upload_id is not null")
    [[ $pending == 0 ]] || production_die 'Unfinished uploads exist. Complete or explicitly fail them using the documented cleanup command before retrying backup.'
    mkdir "$state/backup"
    source_compose exec -T postgres pg_dump -Fc -U "$(source "$state/source.env"; printf '%s' "${POSTGRES_USER:-app}")" "$(source "$state/source.env"; printf '%s' "${POSTGRES_DB:-app}")" > "$state/backup/postgres.dump"
    source_compose exec -T postgres psql -v ON_ERROR_STOP=1 -At -U "$(source "$state/source.env"; printf '%s' "${POSTGRES_USER:-app}")" "$(source "$state/source.env"; printf '%s' "${POSTGRES_DB:-app}")" -c 'select version from schema_migrations order by version' > "$state/backup/migrations.txt"
    source_tools backup /backup
    source_tools validate /backup
    source_tools verify /backup
    (
      source "$state/source.env"
      printf 'format_version=2\napplication_version=%s\nrelease_commit=%s\n' "$RELEASE_VERSION" "$RELEASE_COMMIT" > "$state/backup/manifest.txt"
    )
    (cd "$state/backup" && find . -type f ! -name checksums.sha256 -print0 | sort -z | xargs -0 sha256sum > checksums.sha256)
    sha256sum "$state/backup/checksums.sha256" > "$state/backup.identity"
    touch "$state/backup/complete" "$state/backup.done"
    ;;
  restore)
    require_stage backup
    assert_stopped
    validate_backup
    if [[ ! -f $state/restore.started ]]; then target_tools check --empty; touch "$state/restore.started"; fi
    target_tools restore /backup --resume
    touch "$state/restore.done"
    ;;
  verify)
    require_stage restore
    assert_stopped
    validate_backup
    target_tools verify /backup
    touch "$state/verify.done"
    ;;
  cutover)
    require_stage verify
    [[ ! -f $state/cutover.started ]] || production_die 'Cutover was already attempted; use coordinated rollback before another attempt'
    assert_stopped
    validate_backup
    target_tools verify /backup
    touch "$state/cutover.started"
    # Start exact preserved app images with changed S3 settings. Do not call deploy/upgrade or remove orphans.
    target_compose up -d --no-build --pull never --wait --wait-timeout 300 api video-render-worker web caddy
    cp "$state/target.compose.yml" "$(dirname "$target_env")/.production.active.yml"
    chmod 600 "$(dirname "$target_env")/.production.active.yml"
    touch "$state/cutover.done"
    printf 'Cutover complete. Use ENV_FILE=%q for subsequent operations. Run acceptance checks before reopening access.\n' "$target_env"
    ;;
  rollback)
    test -f "$state/cutover.started" || production_die 'Cutover has not started'
    target_compose stop caddy web api video-render-worker
    source_compose stop caddy web api video-render-worker
    validate_backup
    source_tools clear --confirm-replace-target
    source_tools restore /backup
    source_tools verify /backup
    source_compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$(source "$state/source.env"; printf '%s' "${POSTGRES_USER:-app}")" "$(source "$state/source.env"; printf '%s' "${POSTGRES_DB:-app}")" -c 'drop schema public cascade; create schema public'
    source_compose exec -T postgres pg_restore --exit-on-error --no-owner -U "$(source "$state/source.env"; printf '%s' "${POSTGRES_USER:-app}")" -d "$(source "$state/source.env"; printf '%s' "${POSTGRES_DB:-app}")" < "$state/backup/postgres.dump"
    source_compose up -d --no-deps --no-build --pull never api video-render-worker web caddy
    touch "$state/rollback.done"
    printf 'Rolled back to the coordinated snapshot. Writes made after cutover have been discarded.\n'
    ;;
  *) production_die 'Unknown migration stage' ;;
esac
printf 'Migration stage complete: %s\n' "$stage"
