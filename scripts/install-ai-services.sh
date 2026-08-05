#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
# shellcheck source=ai-common.sh
source "$script_dir/ai-common.sh"

bind_address="" allow_client=""
ollama_mode=off transcription_mode=off voiceover_mode=off
llm_gpu=0 transcription_gpu=0 llm_model=qwen3-vl:8b-instruct transcription_model=large-v3-turbo
ollama_endpoint="" wait_timeout=3600

usage() {
  cat >&2 <<'EOF'
Usage: scripts/install-ai-services.sh [options]
  --bind-address ADDRESS
  --allow-client ADDRESS
  --ollama managed|existing|off
  --ollama-endpoint URL
  --llm-model MODEL
  --llm-gpu INDEX_OR_UUID
  --transcription managed|off
  --transcription-model MODEL
  --transcription-gpu INDEX_OR_UUID
  --voiceover managed|off
  --wait-timeout SECONDS
EOF
}

while (($#)); do
  case $1 in -h|--help) usage; exit 0 ;; esac
  (($# >= 2)) || { usage; exit 2; }
  case $1 in
    --bind-address) bind_address=$2 ;;
    --allow-client) allow_client=$2 ;;
    --ollama) ollama_mode=$2 ;;
    --ollama-endpoint) ollama_endpoint=$2 ;;
    --llm-model) llm_model=$2 ;;
    --llm-gpu) llm_gpu=$2 ;;
    --transcription) transcription_mode=$2 ;;
    --transcription-model) transcription_model=$2 ;;
    --transcription-gpu) transcription_gpu=$2 ;;
    --voiceover) voiceover_mode=$2 ;;
    --wait-timeout) wait_timeout=$2 ;;
    *) usage; exit 2 ;;
  esac
  shift 2
done

[[ $(uname -m) == x86_64 || $(uname -m) == amd64 ]] || ai_die "managed AI images support Linux amd64 only"
command -v docker >/dev/null || ai_die "docker is required"
docker compose version >/dev/null || ai_die "Docker Compose v2 is required"
command -v openssl >/dev/null || ai_die "openssl is required"
[[ $ollama_mode == managed || $ollama_mode == existing || $ollama_mode == off ]] || ai_die "--ollama must be managed, existing, or off"
[[ $transcription_mode == managed || $transcription_mode == off ]] || ai_die "--transcription must be managed or off"
[[ $voiceover_mode == managed || $voiceover_mode == off ]] || ai_die "--voiceover must be managed or off"
[[ $wait_timeout =~ ^[1-9][0-9]*$ ]] || ai_die "--wait-timeout must be a positive integer"
for pair in "AI_MODEL=$llm_model" "LLM_GPU_DEVICE=$llm_gpu" "TRANSCRIPTION_MODEL=$transcription_model" "TRANSCRIPTION_GPU_DEVICE=$transcription_gpu"; do
  ai_validate_safe_value "${pair%%=*}" "${pair#*=}"
done

if [[ $ollama_mode == managed || $transcription_mode == managed || $voiceover_mode == managed ]]; then
  [[ -n $bind_address ]] || ai_die "--bind-address is required for managed services"
  [[ -n $allow_client ]] || ai_die "--allow-client is required for managed services"
  [[ $bind_address =~ ^[A-Fa-f0-9:.]+$ ]] || ai_die "invalid bind address"
  [[ $allow_client =~ ^[A-Fa-f0-9:./]+$ ]] || ai_die "invalid allowed client address"
fi

if command -v ss >/dev/null; then
  [[ $ollama_mode != managed ]] || ! ss -ltnH | awk '{print $4}' | grep -Eq '(^|:)11434$' || ai_die "TCP port 11434 is already in use"
  [[ $transcription_mode != managed ]] || ! ss -ltnH | awk '{print $4}' | grep -Eq '(^|:)8787$' || ai_die "TCP port 8787 is already in use"
  [[ $voiceover_mode != managed ]] || ! ss -ltnH | awk '{print $4}' | grep -Eq '(^|:)8880$' || ai_die "TCP port 8880 is already in use"
fi

if [[ $ollama_mode == existing ]]; then
  command -v curl >/dev/null || ai_die "curl is required to audit an existing Ollama service"
  [[ -n $ollama_endpoint ]] || {
    [[ -n $bind_address ]] || ai_die "--ollama-endpoint is required when no bind address is supplied"
    ollama_endpoint="http://$bind_address:11434"
  }
  ai_validate_url OLLAMA_ENDPOINT "$ollama_endpoint"
  if ! ollama_tags=$(curl -fsS --max-time 10 "${ollama_endpoint%/}/api/tags"); then
    ai_die "existing Ollama did not respond at $ollama_endpoint; no changes were made"
  fi
  if ! grep -Fq "$llm_model" <<<"$ollama_tags"; then
    ai_die "existing Ollama does not have $llm_model; review and run 'ollama pull $llm_model' yourself"
  fi
  printf 'Existing Ollama responded; it will not be modified.\n'
fi

if [[ $ollama_mode == managed || $transcription_mode == managed ]]; then
  command -v nvidia-smi >/dev/null || ai_die "nvidia-smi is required; InfoSteed will not install or change NVIDIA drivers"
  docker info --format '{{json .Runtimes}}' | grep -q nvidia ||
    ai_die "Docker's NVIDIA runtime is unavailable; run scripts/doctor-ai-services.sh for checked setup guidance"
  available_gpus=$(nvidia-smi --query-gpu=index,uuid,name --format=csv,noheader)
  printf 'Detected GPUs:\n%s\n' "$available_gpus"
  if [[ $ollama_mode == managed ]]; then
    printf '%s\n' "$available_gpus" | awk -F', *' -v wanted="$llm_gpu" '$1 == wanted || $2 == wanted { found=1 } END { exit !found }' ||
      ai_die "Ollama GPU not found: $llm_gpu"
  fi
  if [[ $transcription_mode == managed ]]; then
    printf '%s\n' "$available_gpus" | awk -F', *' -v wanted="$transcription_gpu" '$1 == wanted || $2 == wanted { found=1 } END { exit !found }' ||
      ai_die "transcription GPU not found: $transcription_gpu"
  fi
fi

[[ $ollama_mode != managed || $transcription_mode != managed || $llm_gpu != "$transcription_gpu" ]] ||
  printf 'Warning: Ollama and Whisper will share GPU %s; simultaneous requests may exhaust VRAM.\n' "$llm_gpu" >&2

env_file=${AI_ENV_FILE:-$repo_root/deploy/ai-services.env}
connection_file=${AI_CONNECTION_FILE:-$repo_root/deploy/ai-services.connection.env}
if [[ -f $env_file ]]; then
  ai_check_secret_file "$env_file"
  ai_die "$env_file already exists; preserve it and edit or remove it explicitly before reinstalling"
fi

release_version=$(sed -n 's/^  "version": "\([^"]*\)",$/\1/p' "$repo_root/package.json")
[[ -n $release_version ]] || ai_die "could not read release version"
transcription_token=""
[[ $transcription_mode != managed ]] || transcription_token=$(openssl rand -hex 32)
profiles=()
[[ $ollama_mode != managed ]] || profiles+=(ollama)
[[ $transcription_mode != managed ]] || profiles+=(transcription)
[[ $voiceover_mode != managed ]] || profiles+=(voiceover)
compose_profiles=$(IFS=,; printf '%s' "${profiles[*]}")

temporary_env=$(mktemp "$repo_root/deploy/.ai-services.env.XXXXXX")
trap 'rm -f "$temporary_env"' EXIT
umask 077
cat >"$temporary_env" <<EOF
RELEASE_VERSION=$release_version
COMPOSE_PROFILES=$compose_profiles
AI_BIND_ADDRESS=$bind_address
AI_ALLOW_CLIENT=$allow_client
OLLAMA_INSTALL_MODE=$ollama_mode
OLLAMA_ENDPOINT=$ollama_endpoint
AI_MODEL=$llm_model
LLM_GPU_DEVICE=$llm_gpu
TRANSCRIPTION_MODEL=$transcription_model
TRANSCRIPTION_GPU_DEVICE=$transcription_gpu
TRANSCRIPTION_API_KEY=$transcription_token
TRANSCRIPTION_MAX_UPLOAD_BYTES=25000000
HF_HUB_DISABLE_XET=1
HF_TOKEN=
EOF
chmod 600 "$temporary_env"
mv "$temporary_env" "$env_file"
trap - EXIT

if ((${#profiles[@]})); then
  ai_compose=(docker compose --env-file "$env_file" -f "$repo_root/deploy/compose.ai-services.yml")
  ai_install_failed() {
    local status=$?
    trap - ERR
    printf 'AI service installation failed. Running safe diagnostics; existing non-InfoSteed services were not changed.\n' >&2
    AI_ENV_FILE="$env_file" "$script_dir/doctor-ai-services.sh" || true
    exit "$status"
  }
  trap ai_install_failed ERR
  "${ai_compose[@]}" config --quiet
  printf 'Pulling selected AI service images. Existing containers and services are not modified.\n'
  "${ai_compose[@]}" pull
  if [[ $ollama_mode == managed ]]; then
    ai_start_and_wait_service ollama "$wait_timeout" "" "${ai_compose[@]}"
    "${ai_compose[@]}" run --rm ollama-model-init
  fi
  [[ $transcription_mode != managed ]] || ai_start_and_wait_service transcription "$wait_timeout" /models "${ai_compose[@]}"
  [[ $voiceover_mode != managed ]] || ai_start_and_wait_service voiceover "$wait_timeout" "" "${ai_compose[@]}"
  trap - ERR
fi

llm_connection_mode=off llm_connection_endpoint=""
if [[ $ollama_mode == managed ]]; then
  llm_connection_mode=external
  llm_connection_endpoint="http://$bind_address:11434"
elif [[ $ollama_mode == existing ]]; then
  llm_connection_mode=external
  llm_connection_endpoint=$ollama_endpoint
fi
transcription_connection_mode=off transcription_connection_endpoint=""
if [[ $transcription_mode == managed ]]; then
  transcription_connection_mode=external
  transcription_connection_endpoint="http://$bind_address:8787/v1"
fi
voiceover_connection_mode=off voiceover_connection_endpoint=""
if [[ $voiceover_mode == managed ]]; then
  voiceover_connection_mode=external
  voiceover_connection_endpoint="http://$bind_address:8880/v1"
fi

temporary_connection=$(mktemp "$repo_root/deploy/.ai-services.connection.XXXXXX")
cat >"$temporary_connection" <<EOF
LLM_MODE=$llm_connection_mode
AI_PROVIDER=ollama
AI_ENDPOINT=$llm_connection_endpoint
AI_API_KEY=
AI_MODEL=$llm_model
TRANSCRIPTION_MODE=$transcription_connection_mode
TRANSCRIPTION_ENDPOINT=$transcription_connection_endpoint
TRANSCRIPTION_API_KEY=$transcription_token
TRANSCRIPTION_MODEL=$transcription_model
VOICEOVER_MODE=$voiceover_connection_mode
TTS_BASE_URL=$voiceover_connection_endpoint
TTS_API_KEY=
EOF
chmod 600 "$temporary_connection"
mv "$temporary_connection" "$connection_file"

printf 'AI service configuration: %s\n' "$env_file"
printf 'Protected application connection file: %s\n' "$connection_file"
if [[ -n $allow_client ]]; then
  printf 'Restrict TCP ports 11434, 8787, and 8880 to %s in the host firewall as applicable.\n' "$allow_client"
fi
printf 'Copy the connection file securely to the application host, then run:\n'
printf '  scripts/configure-ai-services.sh --from-file /secure/path/ai-services.connection.env\n'
