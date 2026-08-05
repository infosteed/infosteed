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
  [[ $architecture == x86_64 || $architecture == amd64 ]] || {
    production_die "production images currently support Linux amd64 only (found $architecture)"
    return 1
  }
  command -v docker >/dev/null 2>&1 || { production_die "docker is required"; return 1; }
  docker compose version >/dev/null 2>&1 || { production_die "Docker Compose v2 is required"; return 1; }
  command -v curl >/dev/null 2>&1 || { production_die "curl is required"; return 1; }
}

production_check_env_permissions() {
  local env_file=$1
  local env_mode
  env_mode=$(stat -c '%a' "$env_file") || return 1
  (( (8#$env_mode & 077) == 0 )) || {
    production_die "$env_file must not be accessible by group or other users (run chmod 600)"
    return 1
  }
}

production_append_profile() {
  local profile=$1
  case ",${COMPOSE_PROFILES:-}," in
    *",$profile,"*) ;;
    *) COMPOSE_PROFILES=${COMPOSE_PROFILES:+$COMPOSE_PROFILES,}$profile ;;
  esac
}

production_configure_modes() {
  local requested_profiles=${COMPOSE_PROFILES:-}
  TLS_MODE=${TLS_MODE:-public}
  [[ $TLS_MODE == public || $TLS_MODE == internal ]] || {
    production_die "TLS_MODE must be public or internal"
    return 1
  }
  if [[ $TLS_MODE == internal ]]; then
    CADDY_CONFIG_FILE=./Caddyfile.internal
  else
    CADDY_CONFIG_FILE=./Caddyfile
  fi

  if [[ -z ${LLM_MODE:-} ]]; then
    if [[ ,$requested_profiles, == *,llm-local,* ]]; then
      LLM_MODE=managed
    elif [[ -n ${AI_ENDPOINT:-} ]]; then
      LLM_MODE=external
    else
      LLM_MODE=off
    fi
  fi
  if [[ -z ${TRANSCRIPTION_MODE:-} ]]; then
    if [[ ,$requested_profiles, == *,transcription-gpu,* || ,$requested_profiles, == *,transcription-local,* ]]; then
      TRANSCRIPTION_MODE=managed
    elif [[ -n ${TRANSCRIPTION_ENDPOINT:-} ]]; then
      TRANSCRIPTION_MODE=external
    else
      TRANSCRIPTION_MODE=off
    fi
  fi
  if [[ -z ${VOICEOVER_MODE:-} ]]; then
    if [[ ,$requested_profiles, == *,voiceover-cpu,* || ,$requested_profiles, == *,voiceover-local,* ]]; then
      VOICEOVER_MODE=managed
    elif [[ -n ${TTS_BASE_URL:-} ]]; then
      VOICEOVER_MODE=external
    else
      VOICEOVER_MODE=off
    fi
  fi

  local mode
  for mode in LLM_MODE TRANSCRIPTION_MODE VOICEOVER_MODE; do
    [[ ${!mode} == managed || ${!mode} == external || ${!mode} == off ]] || {
      production_die "$mode must be managed, external, or off"
      return 1
    }
  done

  COMPOSE_PROFILES=""

  case $LLM_MODE in
    managed)
      production_append_profile llm-local
      AI_PROVIDER=ollama
      AI_ENDPOINT=http://ollama-local:11434
      AI_MODEL=${AI_MODEL:-qwen3-vl:8b-instruct}
      ;;
    external)
      [[ -n ${AI_ENDPOINT:-} ]] || { production_die "AI_ENDPOINT is required when LLM_MODE=external"; return 1; }
      AI_PROVIDER=${AI_PROVIDER:-ollama}
      AI_MODEL=${AI_MODEL:-qwen3-vl:8b-instruct}
      ;;
    off) AI_ENDPOINT=; AI_API_KEY= ;;
  esac
  case $TRANSCRIPTION_MODE in
    managed)
      production_append_profile transcription-local
      TRANSCRIPTION_ENDPOINT=http://transcription-gpu:8787/v1
      TRANSCRIPTION_MODEL=${TRANSCRIPTION_MODEL:-large-v3-turbo}
      [[ -n ${TRANSCRIPTION_API_KEY:-} ]] || { production_die "TRANSCRIPTION_API_KEY is required for managed transcription"; return 1; }
      ;;
    external)
      [[ -n ${TRANSCRIPTION_ENDPOINT:-} ]] || { production_die "TRANSCRIPTION_ENDPOINT is required when TRANSCRIPTION_MODE=external"; return 1; }
      ;;
    off) TRANSCRIPTION_ENDPOINT=; TRANSCRIPTION_API_KEY= ;;
  esac
  case $VOICEOVER_MODE in
    managed)
      production_append_profile voiceover-local
      TTS_BASE_URL=http://voiceover-cpu:8880/v1
      ;;
    external)
      [[ -n ${TTS_BASE_URL:-} ]] || { production_die "TTS_BASE_URL is required when VOICEOVER_MODE=external"; return 1; }
      ;;
    off) TTS_BASE_URL=; TTS_API_KEY= ;;
  esac

  export TLS_MODE CADDY_CONFIG_FILE COMPOSE_PROFILES
  export LLM_MODE AI_PROVIDER AI_ENDPOINT AI_API_KEY AI_MODEL
  export TRANSCRIPTION_MODE TRANSCRIPTION_ENDPOINT TRANSCRIPTION_API_KEY TRANSCRIPTION_MODEL
  export VOICEOVER_MODE TTS_BASE_URL TTS_API_KEY
}

production_load_compose() {
  cd "$production_root"
  production_env_file=${ENV_FILE:-deploy/production.env}
  if [[ $production_env_file != /* ]]; then
    production_env_file="$production_root/$production_env_file"
  fi
  [[ -f $production_env_file ]] || { production_die "missing environment file: $production_env_file"; return 1; }
  production_check_env_permissions "$production_env_file" || return 1

  set -a
  # shellcheck disable=SC1090
  source "$production_env_file"
  set +a

  production_configure_modes || return 1

  IMAGE_SOURCE=${IMAGE_SOURCE:-ghcr}
  [[ $IMAGE_SOURCE == ghcr || $IMAGE_SOURCE == build ]] || {
    production_die "IMAGE_SOURCE must be ghcr or build"
    return 1
  }

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

production_export_internal_ca() {
  [[ ${TLS_MODE:-public} == internal ]] || return 0
  local destination=${INTERNAL_CA_FILE:-$production_root/deploy/infosteed-local-ca.crt}
  [[ $destination == /* ]] || destination=$production_root/$destination
  local temporary
  temporary=$(mktemp "$production_root/deploy/.infosteed-local-ca.XXXXXX")
  if ! "${production_compose[@]}" cp \
    caddy:/data/caddy/pki/authorities/local/root.crt "$temporary" >/dev/null; then
    rm -f "$temporary"
    production_die "could not export Caddy's internal root certificate"
  fi
  chmod 644 "$temporary"
  mv "$temporary" "$destination"
  printf 'Internal CA certificate: %s\n' "$destination"
  openssl x509 -in "$destination" -noout -fingerprint -sha256
}

production_describe_host_certificate() {
  command -v openssl >/dev/null 2>&1 || return 0
  command -v timeout >/dev/null 2>&1 || return 0
  local certificate
  certificate=$(
    timeout 5 openssl s_client -connect 127.0.0.1:443 -servername "$APP_DOMAIN" </dev/null 2>/dev/null |
      openssl x509 -noout -subject -issuer -fingerprint -sha256 2>/dev/null
  ) || return 0
  [[ -n $certificate ]] || return 0
  printf 'Certificate currently served on 127.0.0.1:443:\n%s\n' "$certificate" >&2
}

production_verify_host_https() {
  local wait_seconds=${1:-60}
  [[ $wait_seconds =~ ^[0-9]+$ ]] || {
    production_die "host HTTPS verification timeout must be a non-negative integer"
    return 1
  }

  local -a curl_args=(
    --noproxy '*'
    --silent
    --show-error
    --fail
    --connect-timeout 3
    --max-time 8
    --resolve "$APP_DOMAIN:443:127.0.0.1"
  )
  if [[ $TLS_MODE == internal ]]; then
    local ca_file=${INTERNAL_CA_FILE:-$production_root/deploy/infosteed-local-ca.crt}
    [[ $ca_file == /* ]] || ca_file=$production_root/$ca_file
    [[ -f $ca_file ]] || {
      production_die "internal CA certificate is missing: $ca_file"
      return 1
    }
    curl_args+=(--cacert "$ca_file")
  fi

  local temporary response_error deadline
  temporary=$(mktemp -d "${TMPDIR:-/tmp}/infosteed-host-https-check.XXXXXX")
  response_error=$temporary/curl-error
  deadline=$((SECONDS + wait_seconds))

  while true; do
    : >"$response_error"
    if curl "${curl_args[@]}" "https://$APP_DOMAIN/api/system/info" \
        >"$temporary/system-info" 2>"$response_error" &&
      grep -Fq '"productSlug":"infosteed"' "$temporary/system-info" &&
      grep -Fq "\"releaseVersion\":\"$RELEASE_VERSION\"" "$temporary/system-info" &&
      grep -Fq "\"releaseCommit\":\"$RELEASE_COMMIT\"" "$temporary/system-info" &&
      curl "${curl_args[@]}" "https://$APP_DOMAIN/" \
        >"$temporary/index.html" 2>"$response_error" &&
      grep -Fq '<title>InfoSteed Editor</title>' "$temporary/index.html"; then
      rm -rf "$temporary"
      return 0
    fi
    (( SECONDS < deadline )) || break
    sleep 2
  done

  printf 'Host-published HTTPS did not serve this InfoSteed release at https://%s.\n' "$APP_DOMAIN" >&2
  if [[ -s $response_error ]]; then
    printf 'Last HTTPS error: %s\n' "$(tr '\n' ' ' <"$response_error")" >&2
  else
    printf 'The HTTPS response did not contain the expected InfoSteed product and release metadata.\n' >&2
  fi
  production_describe_host_certificate
  printf '%s\n' \
    'Another ingress, Kubernetes ServiceLB, or reverse proxy may still own ports 80 or 443.' \
    'The InfoSteed containers were left running for diagnosis.' >&2
  rm -rf "$temporary"
  return 1
}
