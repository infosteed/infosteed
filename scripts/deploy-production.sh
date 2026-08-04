#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=production-compose.sh
source "$script_dir/production-compose.sh"

allow_dirty=false
prepare_only=false
while (($#)); do
  case $1 in
    --allow-dirty) allow_dirty=true ;;
    --prepare-only) prepare_only=true ;;
    *)
      echo "Usage: scripts/deploy-production.sh [--allow-dirty] [--prepare-only]" >&2
      exit 2
      ;;
  esac
  shift
done

production_check_platform
production_load_compose

required=(RELEASE_VERSION RELEASE_COMMIT APP_DOMAIN ACME_EMAIL EXTENSION_ORIGINS SETUP_TOKEN POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY)
[[ $IMAGE_SOURCE == build ]] && required+=(LOCAL_IMAGE_TAG)
for name in "${required[@]}"; do
  [[ -n ${!name:-} ]] || production_die "$name is required in $production_env_file"
  [[ ${!name} != *REPLACE* ]] || production_die "$name still contains a placeholder"
done

production_assert_checkout "$IMAGE_SOURCE" "$RELEASE_VERSION" "$RELEASE_COMMIT" "$allow_dirty"
production_prepare_images

if [[ $prepare_only == true ]]; then
  printf 'Images prepared for InfoSteed %s.\n' "$RELEASE_VERSION"
  exit 0
fi

production_start
printf 'InfoSteed %s is healthy at https://%s\n' "$RELEASE_VERSION" "$APP_DOMAIN"
