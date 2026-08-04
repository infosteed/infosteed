#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin"

cat >"$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_LOG"
EOF
chmod 755 "$test_root/bin/docker"

export PATH="$test_root/bin:$PATH"
export DOCKER_LOG="$test_root/docker.log"
export ENV_FILE="$test_root/production.env"

"$script_dir/install-production.sh" \
  --source build \
  --allow-dirty \
  --domain guides.example.test \
  --email admin@example.test \
  --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop >/dev/null

[[ $(stat -c '%a' "$ENV_FILE") == 600 ]]
grep -q '^IMAGE_SOURCE=build$' "$ENV_FILE"
grep -Eq '^RELEASE_COMMIT=[0-9a-f]{40}$' "$ENV_FILE"
grep -Eq '^LOCAL_IMAGE_TAG=sha-[0-9a-f]{12}$' "$ENV_FILE"
grep -Eq '^SETUP_TOKEN=[0-9a-f]{64}$' "$ENV_FILE"
grep -Eq '^POSTGRES_PASSWORD=[0-9a-f]{64}$' "$ENV_FILE"
grep -q -- '-f deploy/compose.production.yml -f deploy/compose.build.yml' "$DOCKER_LOG"
grep -q 'build --pull' "$DOCKER_LOG"
grep -q 'up -d --remove-orphans --pull never --wait' "$DOCKER_LOG"

checksum_before=$(sha256sum "$ENV_FILE")
"$script_dir/install-production.sh" --allow-dirty >/dev/null
checksum_after=$(sha256sum "$ENV_FILE")
[[ $checksum_before == "$checksum_after" ]]

chmod 640 "$ENV_FILE"
if "$script_dir/install-production.sh" --allow-dirty >/dev/null 2>&1; then
  echo "install-production.sh accepted a group-readable secret file" >&2
  exit 1
fi
chmod 600 "$ENV_FILE"

if "$script_dir/deploy-production.sh" --unknown >/dev/null 2>&1; then
  echo "deploy-production.sh accepted an unknown option" >&2
  exit 1
fi
if "$script_dir/restore.sh" >/dev/null 2>&1; then
  echo "restore.sh accepted missing confirmation arguments" >&2
  exit 1
fi

printf 'Production deployment script checks passed.\n'
