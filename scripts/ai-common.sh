#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only

ai_die() {
  printf 'Error: %s\n' "$*" >&2
  return 1
}

ai_validate_mode() {
  local name=$1 value=$2
  [[ $value == managed || $value == external || $value == off ]] || {
    ai_die "$name must be managed, external, or off"
    return 1
  }
}

ai_validate_url() {
  local name=$1 value=$2
  [[ $value =~ ^https?://[^[:space:]]+$ ]] || {
    ai_die "$name must be an http:// or https:// URL"
    return 1
  }
}

ai_validate_safe_value() {
  local name=$1 value=$2
  [[ $value != *$'\n'* && $value != *$'\r'* ]] || {
    ai_die "$name must be one line"
    return 1
  }
  [[ $value =~ ^[A-Za-z0-9:/?%._,@+~=-]*$ ]] || {
    ai_die "$name contains characters that cannot be stored safely in the deployment environment"
    return 1
  }
}

ai_check_secret_file() {
  local path=$1
  [[ -f $path ]] || { ai_die "secret file not found: $path"; return 1; }
  local mode
  mode=$(stat -c '%a' "$path")
  (( (8#$mode & 077) == 0 )) || { ai_die "$path must have mode 0600 or stricter"; return 1; }
}

ai_read_secret_file() {
  local path=$1
  ai_check_secret_file "$path" || return 1
  local value
  IFS= read -r value <"$path" || true
  [[ -n $value ]] || { ai_die "secret file is empty: $path"; return 1; }
  ai_validate_safe_value secret "$value" || return 1
  printf '%s' "$value"
}

ai_update_env_file() {
  local source_file=$1 target_file=$2
  shift 2
  cp "$source_file" "$target_file"
  chmod 600 "$target_file"
  local pair key value next_file
  for pair in "$@"; do
    key=${pair%%=*}
    value=${pair#*=}
    [[ $key =~ ^[A-Z][A-Z0-9_]*$ ]] || { ai_die "invalid environment key: $key"; return 1; }
    ai_validate_safe_value "$key" "$value" || return 1
    next_file=$(mktemp "${target_file}.next.XXXXXX")
    awk -v key="$key" -v value="$value" '
      index($0, key "=") == 1 { if (!written) print key "=" value; written=1; next }
      { print }
      END { if (!written) print key "=" value }
    ' "$target_file" >"$next_file"
    chmod 600 "$next_file"
    mv "$next_file" "$target_file"
  done
}

ai_load_connection_file() {
  local path=$1
  ai_check_secret_file "$path" || return 1
  local key value
  while IFS='=' read -r key value; do
    [[ -z $key || $key == \#* ]] && continue
    case $key in
      LLM_MODE) llm_mode=$value ;;
      AI_PROVIDER) llm_provider=$value ;;
      AI_ENDPOINT) llm_endpoint=$value ;;
      AI_API_KEY) llm_api_key=$value ;;
      AI_MODEL) llm_model=$value ;;
      TRANSCRIPTION_MODE) transcription_mode=$value ;;
      TRANSCRIPTION_ENDPOINT) transcription_endpoint=$value ;;
      TRANSCRIPTION_API_KEY) transcription_api_key=$value ;;
      TRANSCRIPTION_MODEL) transcription_model=$value ;;
      VOICEOVER_MODE) voiceover_mode=$value ;;
      TTS_BASE_URL) voiceover_endpoint=$value ;;
      TTS_API_KEY) voiceover_api_key=$value ;;
      *) ai_die "unsupported key in connection file: $key"; return 1 ;;
    esac
    ai_validate_safe_value "$key" "$value" || return 1
  done <"$path"
}

ai_start_and_wait_service() {
  local service=$1 timeout=$2 cache_path=${3:-}
  shift 3
  local compose=("$@")
  "${compose[@]}" up -d "$service"
  local started_at=$SECONDS container_id state cache_size
  while ((SECONDS - started_at < timeout)); do
    container_id=$("${compose[@]}" ps -q --all "$service" 2>/dev/null || true)
    if [[ -n $container_id ]]; then
      state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
      case $state in
        healthy) printf '%s is healthy.\n' "$service"; return 0 ;;
        exited|dead)
          "${compose[@]}" logs --no-color --tail=100 "$service" >&2 || true
          ai_die "$service exited before becoming healthy"
          return 1
          ;;
      esac
      if [[ -n $cache_path ]]; then
        cache_size=$("${compose[@]}" exec -T "$service" sh -c "du -sh '$cache_path' 2>/dev/null | cut -f1" 2>/dev/null || true)
        printf 'Waiting for %s model preload: status=%s cache=%s elapsed=%ss\n' \
          "$service" "${state:-unknown}" "${cache_size:-unknown}" "$((SECONDS - started_at))"
      else
        printf 'Waiting for %s: status=%s elapsed=%ss\n' "$service" "${state:-unknown}" "$((SECONDS - started_at))"
      fi
    fi
    sleep 10
  done
  "${compose[@]}" logs --no-color --tail=100 "$service" >&2 || true
  ai_die "$service did not become healthy within ${timeout}s"
}
