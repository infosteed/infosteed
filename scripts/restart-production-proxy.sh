#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=production-compose.sh
source "$script_dir/production-compose.sh"

case ${1:-} in
  "") ;;
  -h | --help)
    echo "Usage: scripts/restart-production-proxy.sh"
    exit 0
    ;;
  *)
    echo "Usage: scripts/restart-production-proxy.sh" >&2
    exit 2
    ;;
esac

production_check_platform
production_load_compose
production_validate_external_tls_container
"${production_compose[@]}" restart caddy
production_verify_host_https "${PRODUCTION_HOST_VERIFY_TIMEOUT:-60}"
printf 'InfoSteed proxy restarted and HTTPS verified at https://%s\n' "$APP_DOMAIN"
