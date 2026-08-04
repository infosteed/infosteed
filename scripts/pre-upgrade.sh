#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

allow_without_backup=false
if [[ ${1:-} == "--allow-without-backup" ]]; then
  allow_without_backup=true
  shift
fi

if [[ $allow_without_backup == false ]]; then
  scripts/backup.sh "${BACKUP_ROOT:-backups}"
fi

compose_file=${COMPOSE_FILE:-deploy/compose.production.yml}
env_file=${ENV_FILE:-deploy/production.env}
docker compose --env-file "$env_file" -f "$compose_file" pull
docker compose --env-file "$env_file" -f "$compose_file" up -d
