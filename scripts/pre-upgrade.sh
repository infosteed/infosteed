#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
printf 'scripts/pre-upgrade.sh is deprecated; using upgrade-production.sh.\n' >&2
exec "$script_dir/upgrade-production.sh" "$@"
