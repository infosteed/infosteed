#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only

production_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

production_die() {
  printf 'Error: %s\n' "$*" >&2
  return 1
}

production_checkout_metadata() {
  command -v git >/dev/null 2>&1 || production_die "git is required"
  production_version=$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$production_root/package.json")
  [[ -n $production_version ]] || production_die "could not read the package version"
  production_commit=$(git -C "$production_root" rev-parse HEAD)
  production_short_commit=${production_commit:0:12}
}

production_assert_checkout() {
  local source=$1
  local expected_version=$2
  local expected_commit=$3
  local allow_dirty=${4:-false}

  production_checkout_metadata
  [[ $production_version == "$expected_version" ]] ||
    production_die "checkout version $production_version does not match RELEASE_VERSION $expected_version"
  [[ $production_commit == "$expected_commit" ]] ||
    production_die "checkout commit $production_commit does not match RELEASE_COMMIT $expected_commit"

  if [[ $source == ghcr ]]; then
    local exact_tag
    exact_tag=$(git -C "$production_root" describe --tags --exact-match 2>/dev/null || true)
    [[ $exact_tag == "v$expected_version" ]] ||
      production_die "GHCR deployment requires checkout tag v$expected_version"
  elif [[ $allow_dirty != true ]] && [[ -n $(git -C "$production_root" status --porcelain --untracked-files=normal) ]]; then
    production_die "source-build checkout is dirty; commit the changes or pass --allow-dirty"
  fi
}

production_check_platform() {
  local architecture
  architecture=$(uname -m)
  [[ $architecture == x86_64 || $architecture == amd64 ]] ||
    production_die "production images currently support Linux amd64 only (found $architecture)"
  command -v docker >/dev/null 2>&1 || production_die "docker is required"
  docker compose version >/dev/null 2>&1 || production_die "Docker Compose v2 is required"
}

production_check_env_permissions() {
  local env_file=$1
  local env_mode
  env_mode=$(stat -c '%a' "$env_file")
  (( (8#$env_mode & 077) == 0 )) ||
    production_die "$env_file must not be accessible by group or other users (run chmod 600)"
}

production_load_compose() {
  cd "$production_root"
  production_env_file=${ENV_FILE:-deploy/production.env}
  if [[ $production_env_file != /* ]]; then
    production_env_file="$production_root/$production_env_file"
  fi
  [[ -f $production_env_file ]] || production_die "missing environment file: $production_env_file"
  production_check_env_permissions "$production_env_file"

  set -a
  # shellcheck disable=SC1090
  source "$production_env_file"
  set +a

  IMAGE_SOURCE=${IMAGE_SOURCE:-ghcr}
  [[ $IMAGE_SOURCE == ghcr || $IMAGE_SOURCE == build ]] ||
    production_die "IMAGE_SOURCE must be ghcr or build"

  local compose_paths=()
  if [[ -n ${COMPOSE_FILE:-} ]]; then
    IFS=: read -r -a compose_paths <<<"$COMPOSE_FILE"
  else
    compose_paths=(deploy/compose.production.yml)
    if [[ $IMAGE_SOURCE == build ]]; then
      compose_paths+=(deploy/compose.build.yml)
    fi
  fi

  production_compose=(docker compose --env-file "$production_env_file")
  local compose_path
  for compose_path in "${compose_paths[@]}"; do
    production_compose+=(-f "$compose_path")
  done
}

production_prepare_images() {
  "${production_compose[@]}" config --quiet
  if [[ $IMAGE_SOURCE == build ]]; then
    "${production_compose[@]}" pull --ignore-buildable
    "${production_compose[@]}" build --pull
  else
    "${production_compose[@]}" pull
  fi
}

production_start() {
  "${production_compose[@]}" up -d --remove-orphans --pull never --wait \
    --wait-timeout "${DEPLOY_WAIT_TIMEOUT:-300}"
}
