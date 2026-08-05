#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

assert_classification() {
  local expected=$1
  shift
  local actual
  actual=$("$script_dir/classify-paths.sh" "$@")
  if [[ $actual != "$expected" ]]; then
    printf 'Classification failed for: %s\nExpected:\n%s\nActual:\n%s\n' \
      "$*" "$expected" "$actual" >&2
    return 1
  fi
}

assert_classification \
  $'compose=false\nintegration=false\npython=false' \
  docs/deployment.md
assert_classification \
  $'compose=false\nintegration=true\npython=false' \
  apps/web/src/App.tsx packages/shared/src/index.ts
assert_classification \
  $'compose=true\nintegration=false\npython=false' \
  deploy/compose.production.yml scripts/deploy-production.sh
assert_classification \
  $'compose=false\nintegration=false\npython=true' \
  whisper/app.py
assert_classification \
  $'compose=true\nintegration=true\npython=true' \
  .github/workflows/ci.yml
