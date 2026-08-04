#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python_bin="$script_dir/.venv-stt/bin/python"

if [[ ! -x "$python_bin" ]]; then
  echo "Missing $python_bin. Create the environment and install requirements.txt first." >&2
  exit 1
fi

exec "$python_bin" -m uvicorn app:app \
  --app-dir "$script_dir" \
  --host "${WHISPER_HOST:-127.0.0.1}" \
  --port "${WHISPER_PORT:-8787}" \
  --workers 1
