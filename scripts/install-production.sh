#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=production-compose.sh
source "$script_dir/production-compose.sh"

requested_source=""
domain=""
email=""
extension_origin=""
allow_dirty=false

usage() {
  cat >&2 <<'EOF'
Usage: scripts/install-production.sh [options]
  --source ghcr|build
  --domain HOSTNAME
  --email ACME_EMAIL
  --extension-origin chrome-extension://ID
  --allow-dirty
EOF
}

while (($#)); do
  case $1 in
    --source | --domain | --email | --extension-origin)
      (($# >= 2)) || { usage; exit 2; }
      case $1 in
        --source) requested_source=$2 ;;
        --domain) domain=$2 ;;
        --email) email=$2 ;;
        --extension-origin) extension_origin=$2 ;;
      esac
      shift 2
      ;;
    --allow-dirty) allow_dirty=true; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

env_file=${ENV_FILE:-$production_root/deploy/production.env}
if [[ $env_file != /* ]]; then
  env_file="$production_root/$env_file"
fi

if [[ -f $env_file ]]; then
  production_check_env_permissions "$env_file"
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  if [[ -n $requested_source && $requested_source != "${IMAGE_SOURCE:-ghcr}" ]]; then
    production_die "existing $env_file uses IMAGE_SOURCE=${IMAGE_SOURCE:-ghcr}; edit it explicitly to change deployment source"
  fi
  printf 'Using existing production configuration: %s\n' "$env_file"
  args=()
  [[ $allow_dirty == true ]] && args+=(--allow-dirty)
  ENV_FILE="$env_file" exec "$script_dir/deploy-production.sh" "${args[@]}"
fi

image_source=${requested_source:-ghcr}
[[ $image_source == ghcr || $image_source == build ]] || production_die "--source must be ghcr or build"
production_check_platform
production_checkout_metadata
production_assert_checkout "$image_source" "$production_version" "$production_commit" "$allow_dirty"
command -v openssl >/dev/null 2>&1 || production_die "openssl is required to generate deployment secrets"

prompt_required() {
  local variable_name=$1
  local prompt=$2
  local current=${!variable_name}
  if [[ -z $current ]]; then
    [[ -t 0 ]] || production_die "$variable_name is required in non-interactive mode"
    read -r -p "$prompt: " current
    printf -v "$variable_name" '%s' "$current"
  fi
  [[ -n $current ]] || production_die "$variable_name cannot be empty"
}

prompt_required domain "Public hostname"
prompt_required email "Email for HTTPS certificate notices"
prompt_required extension_origin "Official Chrome extension origin"

[[ $domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || production_die "invalid hostname: $domain"
[[ $email =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || production_die "invalid email address: $email"
[[ $extension_origin =~ ^chrome-extension://[a-p]{32}$ ]] ||
  production_die "extension origin must be chrome-extension:// followed by the 32-character Chrome extension ID"

setup_token=$(openssl rand -hex 32)
postgres_password=$(openssl rand -hex 32)
minio_root_password=$(openssl rand -hex 32)
s3_secret=$(openssl rand -hex 32)
temporary_env=$(mktemp "$production_root/deploy/.production.env.XXXXXX")
trap 'rm -f "$temporary_env"' EXIT
umask 077

cat >"$temporary_env" <<EOF
IMAGE_SOURCE=$image_source
RELEASE_VERSION=$production_version
RELEASE_COMMIT=$production_commit
LOCAL_IMAGE_TAG=sha-$production_short_commit

APP_DOMAIN=$domain
ACME_EMAIL=$email
APP_SOURCE_URL=https://github.com/infosteed/infosteed
EXTENSION_ORIGINS=$extension_origin
SETUP_TOKEN=$setup_token

POSTGRES_USER=app
POSTGRES_PASSWORD=$postgres_password
POSTGRES_DB=app
MINIO_ROOT_USER=minio-root
MINIO_ROOT_PASSWORD=$minio_root_password
S3_BUCKET=app-media
S3_ACCESS_KEY_ID=app-media-user
S3_SECRET_ACCESS_KEY=$s3_secret
EOF

chmod 600 "$temporary_env"
mv "$temporary_env" "$env_file"
trap - EXIT

args=()
[[ $allow_dirty == true ]] && args+=(--allow-dirty)
ENV_FILE="$env_file" "$script_dir/deploy-production.sh" "${args[@]}"

printf '\nFirst-admin setup token (also stored in %s):\n%s\n' "$env_file" "$setup_token"
