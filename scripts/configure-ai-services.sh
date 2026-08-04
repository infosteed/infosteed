#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=production-compose.sh
source "$script_dir/production-compose.sh"
# shellcheck source=ai-common.sh
source "$script_dir/ai-common.sh"

llm_mode="" llm_provider="" llm_endpoint="" llm_model="" llm_gpu=""
llm_api_key="" llm_api_key_file=""
transcription_mode="" transcription_endpoint="" transcription_model="" transcription_gpu=""
transcription_api_key="" transcription_token_file=""
voiceover_mode="" voiceover_endpoint="" voiceover_api_key="" voiceover_api_key_file=""
connection_file=""

usage() {
  cat >&2 <<'EOF'
Usage: scripts/configure-ai-services.sh [options]
  --from-file PATH
  --llm managed|external|off
  --llm-provider ollama|openai-compatible
  --llm-endpoint URL
  --llm-model MODEL
  --llm-gpu INDEX_OR_UUID
  --llm-api-key-file PATH
  --transcription managed|external|off
  --transcription-endpoint URL
  --transcription-model MODEL
  --transcription-gpu INDEX_OR_UUID
  --transcription-token-file PATH
  --voiceover managed|external|off
  --voiceover-endpoint URL
  --voiceover-api-key-file PATH
EOF
}

while (($#)); do
  case $1 in
    --from-file) connection_file=${2:-}; shift 2 ;;
    --llm) llm_mode=${2:-}; shift 2 ;;
    --llm-provider) llm_provider=${2:-}; shift 2 ;;
    --llm-endpoint) llm_endpoint=${2:-}; shift 2 ;;
    --llm-model) llm_model=${2:-}; shift 2 ;;
    --llm-gpu) llm_gpu=${2:-}; shift 2 ;;
    --llm-api-key-file) llm_api_key_file=${2:-}; shift 2 ;;
    --transcription) transcription_mode=${2:-}; shift 2 ;;
    --transcription-endpoint) transcription_endpoint=${2:-}; shift 2 ;;
    --transcription-model) transcription_model=${2:-}; shift 2 ;;
    --transcription-gpu) transcription_gpu=${2:-}; shift 2 ;;
    --transcription-token-file) transcription_token_file=${2:-}; shift 2 ;;
    --voiceover) voiceover_mode=${2:-}; shift 2 ;;
    --voiceover-endpoint) voiceover_endpoint=${2:-}; shift 2 ;;
    --voiceover-api-key-file) voiceover_api_key_file=${2:-}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
done

production_check_platform
command -v openssl >/dev/null || ai_die "openssl is required"
production_load_compose
current_llm_mode=$LLM_MODE
current_transcription_mode=$TRANSCRIPTION_MODE
current_voiceover_mode=$VOICEOVER_MODE
llm_api_key=${AI_API_KEY:-}
transcription_api_key=${TRANSCRIPTION_API_KEY:-}
voiceover_api_key=${TTS_API_KEY:-}

[[ -z $connection_file ]] || ai_load_connection_file "$connection_file"
if [[ -n $llm_api_key_file ]]; then llm_api_key=$(ai_read_secret_file "$llm_api_key_file"); fi
if [[ -n $transcription_token_file ]]; then transcription_api_key=$(ai_read_secret_file "$transcription_token_file"); fi
if [[ -n $voiceover_api_key_file ]]; then voiceover_api_key=$(ai_read_secret_file "$voiceover_api_key_file"); fi

prompt_mode() {
  local variable=$1 label=$2 default=$3 value=${!1}
  if [[ -z $value ]]; then
    [[ -t 0 ]] || ai_die "$label mode is required in non-interactive mode"
    read -r -p "$label mode [managed/external/off] ($default): " value
    value=${value:-$default}
    printf -v "$variable" '%s' "$value"
  fi
  ai_validate_mode "$label" "$value"
}

prompt_value() {
  local variable=$1 label=$2 default=${3:-} value=${!1}
  if [[ -z $value ]]; then
    if [[ -n $default ]]; then
      [[ -t 0 ]] || { printf -v "$variable" '%s' "$default"; return; }
      read -r -p "$label ($default): " value
      value=${value:-$default}
    else
      [[ -t 0 ]] || ai_die "$label is required in non-interactive mode"
      read -r -p "$label: " value
    fi
    printf -v "$variable" '%s' "$value"
  fi
}

prompt_optional_secret() {
  local variable=$1 label=$2 value=${!1}
  if [[ -z $value && -t 0 ]]; then
    read -r -s -p "$label (leave empty for none): " value
    printf '\n'
    printf -v "$variable" '%s' "$value"
  fi
}

prompt_mode llm_mode LLM "$current_llm_mode"
prompt_mode transcription_mode Transcription "$current_transcription_mode"
prompt_mode voiceover_mode Voiceover "$current_voiceover_mode"

case $llm_mode in
  managed)
    llm_provider=ollama
    llm_endpoint=http://ollama-local:11434
    prompt_value llm_model "Ollama model" "${AI_MODEL:-qwen3-vl:8b}"
    prompt_value llm_gpu "Ollama GPU index or UUID" "${LLM_GPU_DEVICE:-0}"
    llm_api_key=""
    ;;
  external)
    prompt_value llm_provider "LLM provider (ollama or openai-compatible)" "${AI_PROVIDER:-ollama}"
    [[ $llm_provider == ollama || $llm_provider == openai-compatible ]] || ai_die "unsupported LLM provider: $llm_provider"
    prompt_value llm_endpoint "LLM endpoint" "${AI_ENDPOINT:-}"
    ai_validate_url AI_ENDPOINT "$llm_endpoint"
    prompt_value llm_model "LLM model" "${AI_MODEL:-qwen3-vl:8b}"
    prompt_optional_secret llm_api_key "LLM API key"
    ;;
  off) llm_provider=ollama; llm_endpoint=""; llm_api_key=""; llm_model=qwen3-vl:8b ;;
esac

case $transcription_mode in
  managed)
    transcription_endpoint=http://transcription-gpu:8787/v1
    prompt_value transcription_model "Whisper model" "${TRANSCRIPTION_MODEL:-large-v3-turbo}"
    prompt_value transcription_gpu "Whisper GPU index or UUID" "${TRANSCRIPTION_GPU_DEVICE:-0}"
    [[ -n $transcription_api_key ]] || transcription_api_key=$(openssl rand -hex 32)
    ;;
  external)
    prompt_value transcription_endpoint "Transcription base URL" "${TRANSCRIPTION_ENDPOINT:-}"
    ai_validate_url TRANSCRIPTION_ENDPOINT "$transcription_endpoint"
    prompt_value transcription_model "Transcription model" "${TRANSCRIPTION_MODEL:-large-v3-turbo}"
    prompt_optional_secret transcription_api_key "Transcription bearer token"
    ;;
  off) transcription_endpoint=""; transcription_api_key=""; transcription_model=large-v3-turbo ;;
esac

case $voiceover_mode in
  managed) voiceover_endpoint=http://voiceover-cpu:8880/v1; voiceover_api_key="" ;;
  external)
    prompt_value voiceover_endpoint "Voiceover base URL" "${TTS_BASE_URL:-}"
    ai_validate_url TTS_BASE_URL "$voiceover_endpoint"
    prompt_optional_secret voiceover_api_key "Voiceover API key"
    ;;
  off) voiceover_endpoint=""; voiceover_api_key="" ;;
esac

if [[ $llm_mode == managed && $transcription_mode == managed && $llm_gpu == "$transcription_gpu" ]]; then
  printf 'Warning: Ollama and Whisper will share GPU %s; simultaneous requests may exhaust VRAM.\n' "$llm_gpu" >&2
fi

if [[ $llm_mode == managed || $transcription_mode == managed ]]; then
  command -v nvidia-smi >/dev/null || ai_die "nvidia-smi is required for managed GPU services"
  docker info --format '{{json .Runtimes}}' | grep -q nvidia ||
    ai_die "Docker's NVIDIA runtime is unavailable; InfoSteed will not modify drivers or Docker automatically"
  available_gpus=$(nvidia-smi --query-gpu=index,uuid,name --format=csv,noheader)
  if [[ $llm_mode == managed ]]; then
    printf '%s\n' "$available_gpus" | awk -F', *' -v wanted="$llm_gpu" '$1 == wanted || $2 == wanted { found=1 } END { exit !found }' ||
      ai_die "Ollama GPU not found: $llm_gpu"
  fi
  if [[ $transcription_mode == managed ]]; then
    printf '%s\n' "$available_gpus" | awk -F', *' -v wanted="$transcription_gpu" '$1 == wanted || $2 == wanted { found=1 } END { exit !found }' ||
      ai_die "transcription GPU not found: $transcription_gpu"
  fi
fi

for pair in \
  "AI_PROVIDER=$llm_provider" "AI_ENDPOINT=$llm_endpoint" "AI_API_KEY=$llm_api_key" "AI_MODEL=$llm_model" \
  "LLM_GPU_DEVICE=$llm_gpu" "TRANSCRIPTION_ENDPOINT=$transcription_endpoint" \
  "TRANSCRIPTION_API_KEY=$transcription_api_key" "TRANSCRIPTION_MODEL=$transcription_model" \
  "TRANSCRIPTION_GPU_DEVICE=$transcription_gpu" "TTS_BASE_URL=$voiceover_endpoint" "TTS_API_KEY=$voiceover_api_key"; do
  ai_validate_safe_value "${pair%%=*}" "${pair#*=}"
done

candidate=$(mktemp "$production_root/deploy/.production.env.ai.XXXXXX")
backup=$(mktemp "$production_env_file.backup.$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
rm -f "$backup"
trap 'rm -f "$candidate"' EXIT
ai_update_env_file "$production_env_file" "$candidate" \
  "LLM_MODE=$llm_mode" "TRANSCRIPTION_MODE=$transcription_mode" "VOICEOVER_MODE=$voiceover_mode" \
  "COMPOSE_PROFILES=" \
  "AI_PROVIDER=$llm_provider" "AI_ENDPOINT=$llm_endpoint" "AI_API_KEY=$llm_api_key" "AI_MODEL=$llm_model" \
  "LLM_GPU_DEVICE=$llm_gpu" \
  "TRANSCRIPTION_PROVIDER=openai-compatible" "TRANSCRIPTION_ENDPOINT=$transcription_endpoint" \
  "TRANSCRIPTION_API_KEY=$transcription_api_key" "TRANSCRIPTION_MODEL=$transcription_model" \
  "TRANSCRIPTION_GPU_DEVICE=$transcription_gpu" \
  "TTS_BASE_URL=$voiceover_endpoint" "TTS_API_KEY=$voiceover_api_key" "TTS_MODEL=kokoro" \
  "DEPLOY_WAIT_TIMEOUT=$([[ $llm_mode == managed || $transcription_mode == managed ]] && printf 3600 || printf 300)"

(
  ENV_FILE=$candidate
  production_load_compose
  "${production_compose[@]}" config --quiet
  production_prepare_images
)

cp --preserve=mode "$production_env_file" "$backup"
mv "$candidate" "$production_env_file"
trap - EXIT
if ! (
  ENV_FILE=$production_env_file
  production_load_compose
  ai_timeout=${DEPLOY_WAIT_TIMEOUT:-3600}
  if [[ $LLM_MODE == managed ]]; then
    ai_start_and_wait_service ollama-local "$ai_timeout" "" "${production_compose[@]}"
    "${production_compose[@]}" run --rm ollama-model-init
  fi
  if [[ $TRANSCRIPTION_MODE == managed ]]; then
    ai_start_and_wait_service transcription-gpu "$ai_timeout" /models "${production_compose[@]}"
  fi
  if [[ $VOICEOVER_MODE == managed ]]; then
    ai_start_and_wait_service voiceover-cpu "$ai_timeout" "" "${production_compose[@]}"
  fi
  production_start
); then
  cp --preserve=mode "$backup" "$production_env_file"
  (ENV_FILE=$production_env_file; production_load_compose; production_start) || true
  ai_die "AI configuration failed; the previous configuration was restored from $backup"
fi

printf 'AI configuration applied. Previous configuration: %s\n' "$backup"
printf 'Run scripts/doctor-production.sh to verify provider connectivity.\n'
