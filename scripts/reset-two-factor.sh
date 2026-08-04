#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=production-compose.sh
source "$script_dir/production-compose.sh"

production_check_platform
production_load_compose

read -r -p "Exact username to reset 2FA for: " reset_2fa_username
[[ -n $reset_2fa_username ]] || production_die "username is required"
read -r -p "Type the exact username again to confirm: " reset_2fa_confirm
[[ $reset_2fa_username == "$reset_2fa_confirm" ]] ||
  production_die "confirmation did not match"

"${production_compose[@]}" exec -T api \
  node dist/twoFactorResetCli.js --username "$reset_2fa_username"
