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
tls_mode=""
allow_dirty=false

usage() {
  cat >&2 <<'EOF'
Usage: scripts/install-production.sh [options]
  --source ghcr|build
  --domain HOSTNAME
  --email ACME_EMAIL
  --extension-origin chrome-extension://ID
  --tls public|internal
  --allow-dirty
EOF
}

while (($#)); do
  case $1 in
    --source | --domain | --email | --extension-origin | --tls)
      (($# >= 2)) || { usage; exit 2; }
      case $1 in
        --source) requested_source=$2 ;;
        --domain) domain=$2 ;;
        --email) email=$2 ;;
        --extension-origin) extension_origin=$2 ;;
        --tls) tls_mode=$2 ;;
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
  if [[ -n $tls_mode && $tls_mode != "${TLS_MODE:-public}" ]]; then
    production_die "existing $env_file uses TLS_MODE=${TLS_MODE:-public}; change it with the documented migration or edit it explicitly"
  fi
  printf 'Using existing production configuration: %s\n' "$env_file"
  args=()
  [[ $allow_dirty == true ]] && args+=(--allow-dirty)
  ENV_FILE="$env_file" exec "$script_dir/deploy-production.sh" "${args[@]}"
fi

image_source=${requested_source:-ghcr}
tls_mode=${tls_mode:-public}
[[ $image_source == ghcr || $image_source == build ]] || production_die "--source must be ghcr or build"
[[ $tls_mode == public || $tls_mode == internal ]] || production_die "--tls must be public or internal"
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

prompt_required domain "Application hostname"
if [[ $tls_mode == public ]]; then
  prompt_required email "Email for HTTPS certificate notices"
fi
prompt_required extension_origin "Official Chrome extension origin"

[[ $domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || production_die "invalid hostname: $domain"
if [[ $tls_mode == public ]]; then
  [[ $email =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || production_die "invalid email address: $email"
fi
[[ $extension_origin =~ ^chrome-extension://[a-p]{32}$ ]] ||
  production_die "extension origin must be chrome-extension:// followed by the 32-character Chrome extension ID"

setup_token=$(openssl rand -hex 32)
two_factor_encryption_key=$(openssl rand -hex 32)
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
DEPLOY_WAIT_TIMEOUT=300

APP_DOMAIN=$domain
TLS_MODE=$tls_mode
ACME_EMAIL=$email
APP_SOURCE_URL=https://github.com/infosteed/infosteed
EXTENSION_ORIGINS=$extension_origin
SETUP_TOKEN=$setup_token
TWO_FACTOR_ENABLED=false
TWO_FACTOR_ENCRYPTION_KEY=$two_factor_encryption_key

LLM_MODE=off
TRANSCRIPTION_MODE=off
VOICEOVER_MODE=off

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
printf '\nConfigure optional AI services when ready:\n  scripts/configure-ai-services.sh\n'
