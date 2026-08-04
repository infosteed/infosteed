#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)
# shellcheck source=ai-common.sh
source "$script_dir/ai-common.sh"

deep=false
case ${1:-} in "") ;; --deep) deep=true ;; -h|--help) echo "Usage: scripts/doctor-ai-services.sh [--deep]"; exit 0 ;; *) echo "Usage: scripts/doctor-ai-services.sh [--deep]" >&2; exit 2 ;; esac
failures=0
pass() { printf '[ok] %s\n' "$*"; }
fail() { printf '[failed] %s\n' "$*" >&2; failures=$((failures + 1)); }
note() { printf '[info] %s\n' "$*"; }

if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then pass "Docker Compose v2 is available"; else fail "Docker Compose v2 is unavailable"; fi
if command -v nvidia-smi >/dev/null; then
  pass "NVIDIA host driver is available"
  nvidia-smi --query-gpu=index,uuid,name,memory.total,memory.used --format=csv,noheader || fail "GPU inventory failed"
  nvidia-smi --query-compute-apps=gpu_uuid,pid,used_memory --format=csv,noheader 2>/dev/null || true
else
  fail "nvidia-smi is unavailable"
fi
if docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q nvidia; then
  pass "Docker NVIDIA runtime is configured"
else
  fail "Docker NVIDIA runtime is not configured"
  note "Install NVIDIA Container Toolkit from https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
  note "After installing the toolkit, the explicit Docker step is: sudo nvidia-ctk runtime configure --runtime=docker"
fi
df -h "$repo_root" | tail -n 1

env_file=${AI_ENV_FILE:-$repo_root/deploy/ai-services.env}
if [[ -f $env_file ]]; then
  if ai_check_secret_file "$env_file"; then pass "AI environment file is private"; else fail "AI environment permissions are unsafe"; fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
  ai_compose=(docker compose --env-file "$env_file" -f "$repo_root/deploy/compose.ai-services.yml")
  if "${ai_compose[@]}" config --quiet; then pass "AI Compose configuration is valid"; else fail "AI Compose configuration is invalid"; fi
  "${ai_compose[@]}" ps -a || fail "AI container state could not be read"
  for service in ollama transcription voiceover; do
    container_id=$("${ai_compose[@]}" ps -q "$service" 2>/dev/null || true)
    [[ -z $container_id ]] || docker inspect --format "$service GPU requests: {{json .HostConfig.DeviceRequests}}" "$container_id"
  done
  if [[ ${OLLAMA_INSTALL_MODE:-off} == existing && -n ${OLLAMA_ENDPOINT:-} ]]; then
    if ollama_tags=$(curl -fsS --max-time 10 "${OLLAMA_ENDPOINT%/}/api/tags"); then
      pass "existing Ollama responds and was not modified"
      if grep -Fq "${AI_MODEL:-qwen3-vl:8b}" <<<"$ollama_tags"; then pass "configured Ollama model is installed"; else fail "configured Ollama model is missing"; fi
    else
      fail "existing Ollama is unreachable"
    fi
  fi
  if [[ -n ${AI_BIND_ADDRESS:-} ]]; then
    if [[ ,${COMPOSE_PROFILES:-}, == *,ollama,* ]]; then
      if curl -fsS --max-time 10 "http://$AI_BIND_ADDRESS:11434/api/tags" >/dev/null; then pass "Ollama endpoint responds"; else fail "Ollama endpoint is unreachable"; fi
    fi
    if [[ ,${COMPOSE_PROFILES:-}, == *,transcription,* ]]; then
      if curl -fsS --max-time 10 "http://$AI_BIND_ADDRESS:8787/health" >/dev/null; then pass "transcription endpoint responds"; else fail "transcription endpoint is unreachable"; fi
    fi
    if [[ ,${COMPOSE_PROFILES:-}, == *,voiceover,* ]]; then
      if curl -fsS --max-time 10 "http://$AI_BIND_ADDRESS:8880/health" >/dev/null; then pass "voiceover endpoint responds"; else fail "voiceover endpoint is unreachable"; fi
    fi
    if [[ $deep == true && ,${COMPOSE_PROFILES:-}, == *,ollama,* ]]; then
      curl -fsS --max-time 300 -H 'Content-Type: application/json' \
        -d "{\"model\":\"${AI_MODEL:-qwen3-vl:8b}\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply OK\"}],\"stream\":false}" \
        "http://$AI_BIND_ADDRESS:11434/api/chat" >/dev/null && pass "deep Ollama request completed" || fail "deep Ollama request failed"
    fi
    if [[ $deep == true && ,${COMPOSE_PROFILES:-}, == *,transcription,* ]]; then
      deep_dir=$(mktemp -d)
      if command -v python3 >/dev/null && python3 - "$deep_dir/check.wav" <<'PY'
import struct, sys, wave
with wave.open(sys.argv[1], "wb") as target:
    target.setnchannels(1)
    target.setsampwidth(2)
    target.setframerate(8000)
    target.writeframes(struct.pack("<800h", *([0] * 800)))
PY
      then
        auth=()
        [[ -z ${TRANSCRIPTION_API_KEY:-} ]] || auth=(-H "Authorization: Bearer $TRANSCRIPTION_API_KEY")
        if curl -fsS --max-time 600 "${auth[@]}" \
          -F "file=@$deep_dir/check.wav;type=audio/wav" \
          -F "model=${TRANSCRIPTION_MODEL:-large-v3-turbo}" \
          -F 'response_format=verbose_json' \
          "http://$AI_BIND_ADDRESS:8787/v1/audio/transcriptions" >/dev/null; then
          pass "deep authenticated transcription completed"
        else
          fail "deep authenticated transcription failed"
        fi
      else
        fail "python3 is required to generate the deep transcription sample"
      fi
      rm -rf "$deep_dir"
    fi
    if [[ $deep == true && ,${COMPOSE_PROFILES:-}, == *,voiceover,* ]]; then
      if curl -fsS --max-time 300 -H 'Content-Type: application/json' \
        -d '{"model":"kokoro","input":"InfoSteed check","voice":"af_heart","response_format":"wav"}' \
        "http://$AI_BIND_ADDRESS:8880/v1/audio/speech" >/dev/null; then
        pass "deep voiceover request completed"
      else
        fail "deep voiceover request failed"
      fi
    fi
  fi
else
  note "No managed AI environment file found at $env_file; host prerequisites only were checked"
fi

if ((failures)); then printf '%d AI diagnostic check(s) failed.\n' "$failures" >&2; exit 1; fi
pass "AI service diagnostics completed"
