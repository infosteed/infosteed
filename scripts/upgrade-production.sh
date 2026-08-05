#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=production-compose.sh
source "$script_dir/production-compose.sh"

allow_dirty=false
allow_without_backup=false
while (($#)); do
  case $1 in
    --allow-dirty) allow_dirty=true ;;
    --allow-without-backup) allow_without_backup=true ;;
    *)
      echo "Usage: scripts/upgrade-production.sh [--allow-dirty] [--allow-without-backup]" >&2
      exit 2
      ;;
  esac
  shift
done

production_check_platform
legacy_internal_tls=false
if [[ -z ${TLS_MODE:-} && -f $production_root/deploy/Caddyfile ]] && grep -Eq '^[[:space:]]*tls internal[[:space:]]*$' "$production_root/deploy/Caddyfile"; then
  legacy_internal_tls=true
fi
production_load_compose
current_env=$production_env_file
current_version=$RELEASE_VERSION
legacy_hotfix=""
if grep -qx 'COMPOSE_FILE=deploy/compose.production.yml:deploy/compose.hotfix.yml' "$current_env"; then
  legacy_hotfix=$production_root/deploy/compose.hotfix.yml
fi

if grep -Eq '^(WEB_IMAGE|API_IMAGE|RENDER_IMAGE|TRANSCRIPTION_IMAGE)=' "$current_env"; then
  production_die "explicit first-party image overrides must be updated or removed before an automated upgrade"
fi

production_checkout_metadata
new_version=$production_version
new_commit=$production_commit
new_short_commit=$production_short_commit
production_assert_checkout "$IMAGE_SOURCE" "$new_version" "$new_commit" "$allow_dirty"

[[ $new_version != "$current_version" || $new_commit != "${RELEASE_COMMIT:-}" ]] ||
  production_die "the configured deployment already matches this checkout"

candidate_env=$(mktemp "$production_root/deploy/.production.env.candidate.XXXXXX")
old_env=$(mktemp "$production_root/deploy/.production.env.previous.XXXXXX")
backup_result=$(mktemp)
cleanup() {
  rm -f "$candidate_env" "$old_env" "$backup_result"
}
trap cleanup EXIT

candidate_tls=$TLS_MODE
[[ $legacy_internal_tls == false ]] || candidate_tls=internal
awk -v version="$new_version" -v commit="$new_commit" -v image_tag="sha-$new_short_commit" \
  -v tls_mode="$candidate_tls" -v llm_mode="$LLM_MODE" -v transcription_mode="$TRANSCRIPTION_MODE" \
  -v voiceover_mode="$VOICEOVER_MODE" '
  /^RELEASE_VERSION=/ { print "RELEASE_VERSION=" version; found_version=1; next }
  /^RELEASE_COMMIT=/ { print "RELEASE_COMMIT=" commit; found_commit=1; next }
  /^LOCAL_IMAGE_TAG=/ { print "LOCAL_IMAGE_TAG=" image_tag; found_image_tag=1; next }
  /^TLS_MODE=/ { print "TLS_MODE=" tls_mode; found_tls=1; next }
  /^LLM_MODE=/ { print "LLM_MODE=" llm_mode; found_llm=1; next }
  /^TRANSCRIPTION_MODE=/ { print "TRANSCRIPTION_MODE=" transcription_mode; found_transcription=1; next }
  /^VOICEOVER_MODE=/ { print "VOICEOVER_MODE=" voiceover_mode; found_voiceover=1; next }
  /^AI_MODEL=qwen3-vl:8b$/ && llm_mode == "managed" { print "AI_MODEL=qwen3-vl:8b-instruct"; next }
  /^COMPOSE_FILE=deploy\/compose.production.yml:deploy\/compose.hotfix.yml$/ { next }
  { print }
  END {
    if (!found_version) print "RELEASE_VERSION=" version
    if (!found_commit) print "RELEASE_COMMIT=" commit
    if (!found_image_tag) print "LOCAL_IMAGE_TAG=" image_tag
    if (!found_tls) print "TLS_MODE=" tls_mode
    if (!found_llm) print "LLM_MODE=" llm_mode
    if (!found_transcription) print "TRANSCRIPTION_MODE=" transcription_mode
    if (!found_voiceover) print "VOICEOVER_MODE=" voiceover_mode
  }
' "$current_env" >"$candidate_env"
chmod 600 "$candidate_env"

prepare_args=(--prepare-only)
[[ $allow_dirty == true ]] && prepare_args+=(--allow-dirty)
ENV_FILE="$candidate_env" "$script_dir/deploy-production.sh" "${prepare_args[@]}"

backup_dir=""
if [[ $allow_without_backup == false ]]; then
  BACKUP_RESULT_FILE="$backup_result" "$script_dir/backup.sh" "${BACKUP_ROOT:-backups}"
  backup_dir=$(<"$backup_result")
fi

cp --preserve=mode "$current_env" "$old_env"
mv "$candidate_env" "$current_env"

deploy_args=()
[[ $allow_dirty == true ]] && deploy_args+=(--allow-dirty)
if ! ENV_FILE="$current_env" "$script_dir/deploy-production.sh" "${deploy_args[@]}"; then
  mv "$old_env" "$current_env"
  printf 'Upgrade to %s failed; the previous configuration has been restored.\n' "$new_version" >&2
  if [[ -n $backup_dir ]]; then
    printf 'Restore the pre-upgrade data and previous images with:\n  scripts/restore.sh --confirm-replace-target %q\n' "$backup_dir" >&2
  else
    printf 'No backup was requested, so an automatic safe rollback is unavailable.\n' >&2
  fi
  exit 1
fi

rm -f "$old_env"
if [[ -n $legacy_hotfix && -f $legacy_hotfix ]]; then
  retired_hotfix="$legacy_hotfix.retired.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$legacy_hotfix" "$retired_hotfix"
  printf 'Retired the beta.1 Compose hotfix to: %s\n' "$retired_hotfix"
fi
printf 'Upgrade complete: %s -> %s\n' "$current_version" "$new_version"
if [[ -n $backup_dir ]]; then
  printf 'Pre-upgrade backup: %s\n' "$backup_dir"
fi
