#!/usr/bin/env bash
set -euo pipefail

compose=false
integration=false
python=false

for path in "$@"; do
  case "$path" in
    whisper/*|.github/workflows/ci.yml|.github/scripts/classify-paths*)
      python=true
      ;;
  esac
  case "$path" in
    deploy/*|scripts/*.sh|infra/*|migrations/*|docker-compose.yml|docker.env.example|.env.example|*/Dockerfile|Dockerfile|.github/workflows/ci.yml|.github/scripts/classify-paths*)
      compose=true
      ;;
  esac
  case "$path" in
    apps/*|packages/*|tests/e2e/*|migrations/*|infra/*|docker-compose.yml|docker.env.example|package.json|pnpm-lock.yaml|pnpm-workspace.yaml|tsconfig.base.json|.github/workflows/ci.yml|.github/scripts/classify-paths*)
      integration=true
      ;;
  esac
done

printf 'compose=%s\nintegration=%s\npython=%s\n' \
  "$compose" "$integration" "$python"
