#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
release_version=$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$script_dir/../package.json")
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/bin"

cat >"$test_root/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_LOG"
if [[ -n ${DOCKER_FAIL_PATTERN:-} && " $* " == *"$DOCKER_FAIL_PATTERN"* ]]; then exit 1; fi
if [[ " $* " == *"select count(*) from recording_video_assets"* ]]; then
  printf '%s\n' "${MOCK_UNFINISHED_UPLOADS:-0}"
fi
if [[ ${1:-} == info ]]; then
  printf '{"nvidia":{}}\n'
fi
if [[ ${1:-} == inspect ]]; then
  printf 'healthy\n'
fi
if [[ " $* " == *" ps -q "* ]]; then
  printf 'fake-container-id\n'
fi
if [[ " $* " == *" cp "* ]]; then
  destination=${!#}
  printf 'test certificate\n' >"$destination"
fi
EOF
chmod 755 "$test_root/bin/docker"

cat >"$test_root/bin/nvidia-smi" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '0, GPU-test-0000, Test GPU\n'
EOF
chmod 755 "$test_root/bin/nvidia-smi"

cat >"$test_root/bin/ss" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod 755 "$test_root/bin/ss"

cat >"$test_root/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$CURL_LOG"
url=${!#}
case ${CURL_MODE:-success} in
  certificate_error)
    printf 'curl: (60) SSL certificate problem: self-signed certificate\n' >&2
    exit 60
    ;;
  http_503)
    printf 'curl: (22) The requested URL returned error: 503\n' >&2
    exit 22
    ;;
esac
if [[ $url == */api/system/info ]]; then
  case ${CURL_MODE:-success} in
    wrong_product)
      printf '{"productSlug":"other","releaseVersion":"%s","releaseCommit":"%s"}\n' "$RELEASE_VERSION" "$RELEASE_COMMIT"
      ;;
    wrong_release)
      printf '{"productSlug":"infosteed","releaseVersion":"0.0.0-wrong","releaseCommit":"%s"}\n' "$RELEASE_COMMIT"
      ;;
    wrong_commit)
      printf '{"productSlug":"infosteed","releaseVersion":"%s","releaseCommit":"0000000000000000000000000000000000000000"}\n' "$RELEASE_VERSION"
      ;;
    *)
      printf '{"productSlug":"infosteed","releaseVersion":"%s","releaseCommit":"%s"}\n' "$RELEASE_VERSION" "$RELEASE_COMMIT"
      ;;
  esac
else
  if [[ ${CURL_MODE:-success} == wrong_web ]]; then
    printf '<title>Something Else</title>\n'
  else
    printf '<title>InfoSteed Editor</title>\n'
  fi
fi
EOF
chmod 755 "$test_root/bin/curl"

cat >"$test_root/bin/openssl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case ${1:-} in
  s_client) printf '%s\n' 'test certificate' ;;
  x509)
    if [[ " $* " != *" -in "* ]]; then cat >/dev/null; fi
    printf 'subject=CN=intercepting-proxy\nissuer=CN=test\nsha256 Fingerprint=00:11\n'
    ;;
  *) exec /usr/bin/openssl "$@" ;;
esac
EOF
chmod 755 "$test_root/bin/openssl"

export PATH="$test_root/bin:$PATH"
export DOCKER_LOG="$test_root/docker.log"
export CURL_LOG="$test_root/curl.log"
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
grep -q '^TLS_MODE=public$' "$ENV_FILE"
grep -q '^LLM_MODE=off$' "$ENV_FILE"
grep -q -- '-f deploy/compose.production.yml -f deploy/compose.build.yml' "$DOCKER_LOG"
grep -q 'build --pull' "$DOCKER_LOG"
grep -q 'up -d --remove-orphans --pull never --wait' "$DOCKER_LOG"
grep -q -- "--noproxy \*.*--resolve guides.example.test:443:127.0.0.1.*https://guides.example.test/api/system/info" "$CURL_LOG"
if grep -q -- '--cacert' "$CURL_LOG"; then
  echo "public TLS host verification unexpectedly used a private CA" >&2
  exit 1
fi
(
  # shellcheck source=production-compose.sh
  source "$script_dir/production-compose.sh"
  production_load_compose
  [[ $CADDY_CONFIG_FILE == ./Caddyfile ]]
  [[ " ${production_compose[*]} " != *" compose.external-tls.yml "* ]]
)

for curl_mode in certificate_error http_503 wrong_product wrong_release wrong_commit wrong_web; do
  verify_output="$test_root/verify-$curl_mode.log"
  if CURL_MODE=$curl_mode PRODUCTION_HOST_VERIFY_TIMEOUT=0 \
    "$script_dir/deploy-production.sh" --allow-dirty >"$verify_output" 2>&1; then
    echo "deploy-production.sh accepted failed host verification mode $curl_mode" >&2
    exit 1
  fi
  grep -q 'Host-published HTTPS did not serve this InfoSteed release' "$verify_output"
  if grep -q 'is healthy at' "$verify_output"; then
    echo "deploy-production.sh claimed health after failed host verification mode $curl_mode" >&2
    exit 1
  fi
  if [[ $curl_mode == certificate_error ]]; then
    grep -q 'Certificate currently served on 127.0.0.1:443' "$verify_output"
  fi
done

doctor_env="$test_root/doctor-production.env"
sed 's/^APP_DOMAIN=.*/APP_DOMAIN=localhost/' "$ENV_FILE" >"$doctor_env"
chmod 600 "$doctor_env"
ENV_FILE="$doctor_env" "$script_dir/doctor-production.sh" >/dev/null
if CURL_MODE=wrong_product ENV_FILE="$doctor_env" \
  "$script_dir/doctor-production.sh" >"$test_root/doctor-failure.log" 2>&1; then
  echo "doctor-production.sh accepted the wrong host-published product" >&2
  exit 1
fi
grep -q 'host-published HTTPS does not serve this InfoSteed release' "$test_root/doctor-failure.log"

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

"$script_dir/configure-ai-services.sh" \
  --llm off --transcription off --voiceover off >/dev/null
grep -q '^LLM_MODE=off$' "$ENV_FILE"
grep -q '^TRANSCRIPTION_MODE=off$' "$ENV_FILE"
grep -q '^VOICEOVER_MODE=off$' "$ENV_FILE"
test -n "$(find "$test_root" -maxdepth 1 -name 'production.env.backup.*' -print -quit)"

token_file="$test_root/transcription.token"
printf 'test-token-012345678901234567890123456789\n' >"$token_file"
chmod 600 "$token_file"

internal_env="$test_root/internal-production.env"
internal_ca="$test_root/infosteed-local-ca.crt"
ENV_FILE="$internal_env" INTERNAL_CA_FILE="$internal_ca" "$script_dir/install-production.sh" \
  --source build --allow-dirty --tls internal \
  --domain internal.example.test \
  --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop >/dev/null
grep -q '^TLS_MODE=internal$' "$internal_env"
grep -q '^ACME_EMAIL=$' "$internal_env"
test -f "$internal_ca"
grep -q -- "--resolve internal.example.test:443:127.0.0.1.*--cacert $internal_ca" "$CURL_LOG"
(
  # shellcheck source=production-compose.sh
  source "$script_dir/production-compose.sh"
  ENV_FILE="$internal_env" production_load_compose
  [[ $CADDY_CONFIG_FILE == ./Caddyfile.internal ]]
  [[ " ${production_compose[*]} " != *" compose.external-tls.yml "* ]]
)

external_certs="$test_root/external-certs"
mkdir -p "$external_certs"
printf 'test full chain\n' >"$external_certs/fullchain.pem"
printf 'test private key\n' >"$external_certs/key.pem"
chmod 644 "$external_certs/fullchain.pem"
chmod 640 "$external_certs/key.pem"
external_env="$test_root/external-tls-production.env"
ENV_FILE="$external_env" "$script_dir/install-production.sh" \
  --source build --allow-dirty --tls external \
  --tls-cert-host-path "$external_certs" \
  --domain external.example.test \
  --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop >/dev/null
grep -q '^TLS_MODE=external$' "$external_env"
grep -Fqx "TLS_CERT_HOST_PATH=$external_certs" "$external_env"
grep -q '^TLS_CERT_FILE=/certs/fullchain.pem$' "$external_env"
grep -q '^TLS_KEY_FILE=/certs/key.pem$' "$external_env"
(
  # shellcheck source=production-compose.sh
  source "$script_dir/production-compose.sh"
  ENV_FILE="$external_env" production_load_compose
  [[ $CADDY_CONFIG_FILE == ./Caddyfile.external ]]
  [[ " ${production_compose[*]} " == *" -f deploy/compose.external-tls.yml "* ]]
)
grep -q -- 'run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile' "$DOCKER_LOG"
ENV_FILE="$external_env" "$script_dir/restart-production-proxy.sh" >/dev/null
grep -q -- '-f deploy/compose.external-tls.yml restart caddy' "$DOCKER_LOG"
external_doctor_env="$test_root/external-doctor-production.env"
sed 's/^APP_DOMAIN=.*/APP_DOMAIN=localhost/' "$external_env" >"$external_doctor_env"
chmod 600 "$external_doctor_env"
ENV_FILE="$external_doctor_env" "$script_dir/doctor-production.sh" >"$test_root/external-doctor.log"
grep -q 'external certificate and key are readable by hardened Caddy' "$test_root/external-doctor.log"

missing_external_path_env="$test_root/missing-external-path.env"
sed 's|^TLS_CERT_HOST_PATH=.*|TLS_CERT_HOST_PATH=|' "$external_env" >"$missing_external_path_env"
chmod 600 "$missing_external_path_env"
if ENV_FILE="$missing_external_path_env" "$script_dir/deploy-production.sh" --allow-dirty >/dev/null 2>&1; then
  echo "deploy-production.sh accepted external TLS without TLS_CERT_HOST_PATH" >&2
  exit 1
fi

invalid_external_file_env="$test_root/invalid-external-file.env"
sed 's|^TLS_CERT_FILE=.*|TLS_CERT_FILE=/outside/fullchain.pem|' "$external_env" >"$invalid_external_file_env"
chmod 600 "$invalid_external_file_env"
if ENV_FILE="$invalid_external_file_env" "$script_dir/deploy-production.sh" --allow-dirty >/dev/null 2>&1; then
  echo "deploy-production.sh accepted a certificate path outside /certs" >&2
  exit 1
fi

missing_external_key_env="$test_root/missing-external-key.env"
sed 's|^TLS_KEY_FILE=.*|TLS_KEY_FILE=/certs/missing-key.pem|' "$external_env" >"$missing_external_key_env"
chmod 600 "$missing_external_key_env"
if ENV_FILE="$missing_external_key_env" "$script_dir/deploy-production.sh" --allow-dirty >/dev/null 2>&1; then
  echo "deploy-production.sh accepted a missing external TLS private key" >&2
  exit 1
fi

invalid_tls_mode_env="$test_root/invalid-tls-mode.env"
sed 's/^TLS_MODE=.*/TLS_MODE=unsupported/' "$external_env" >"$invalid_tls_mode_env"
chmod 600 "$invalid_tls_mode_env"
if ENV_FILE="$invalid_tls_mode_env" "$script_dir/deploy-production.sh" --allow-dirty >/dev/null 2>&1; then
  echo "deploy-production.sh accepted an unsupported TLS mode" >&2
  exit 1
fi

ENV_FILE="$ENV_FILE" "$script_dir/configure-ai-services.sh" \
  --llm managed --llm-model qwen3-vl:8b --llm-gpu 0 \
  --transcription managed --transcription-model large-v3-turbo --transcription-gpu 0 \
  --voiceover managed >/dev/null
grep -q '^LLM_MODE=managed$' "$ENV_FILE"
grep -q '^TRANSCRIPTION_MODE=managed$' "$ENV_FILE"
grep -q '^VOICEOVER_MODE=managed$' "$ENV_FILE"
grep -Eq '^TRANSCRIPTION_API_KEY=[0-9a-f]{64}$' "$ENV_FILE"

legacy_env="$test_root/legacy-production.env"
awk '
  /^RELEASE_VERSION=/ { print "RELEASE_VERSION=0.1.0-beta.1"; next }
  { print }
  END { print "COMPOSE_FILE=deploy/compose.production.yml:deploy/compose.hotfix.yml" }
' "$ENV_FILE" >"$legacy_env"
chmod 600 "$legacy_env"
ENV_FILE="$legacy_env" "$script_dir/upgrade-production.sh" \
  --allow-dirty --allow-without-backup >/dev/null
grep -Fqx "RELEASE_VERSION=$release_version" "$legacy_env"
if grep -q '^COMPOSE_FILE=' "$legacy_env"; then
  echo "upgrade-production.sh retained the known beta.1 hotfix selector" >&2
  exit 1
fi
grep -q '^LLM_MODE=managed$' "$legacy_env"
grep -q '^AI_MODEL=qwen3-vl:8b-instruct$' "$legacy_env"
"$script_dir/configure-ai-services.sh" \
  --llm external --llm-provider ollama --llm-endpoint http://192.0.2.10:11434 --llm-model qwen3-vl:8b \
  --transcription external --transcription-endpoint http://192.0.2.10:8787/v1 \
  --transcription-model large-v3-turbo --transcription-token-file "$token_file" \
  --voiceover external --voiceover-endpoint http://192.0.2.10:8880/v1 >/dev/null
grep -q '^LLM_MODE=external$' "$ENV_FILE"
grep -q '^AI_ENDPOINT=http://192.0.2.10:11434$' "$ENV_FILE"
grep -q '^TRANSCRIPTION_API_KEY=test-token-' "$ENV_FILE"
grep -q '^TTS_BASE_URL=http://192.0.2.10:8880/v1$' "$ENV_FILE"

external_legacy_env="$test_root/external-legacy-production.env"
awk '
  /^RELEASE_VERSION=/ { print "RELEASE_VERSION=0.1.0-beta.1"; next }
  { print }
' "$ENV_FILE" >"$external_legacy_env"
chmod 600 "$external_legacy_env"
ENV_FILE="$external_legacy_env" "$script_dir/upgrade-production.sh" \
  --allow-dirty --allow-without-backup >/dev/null
grep -q '^LLM_MODE=external$' "$external_legacy_env"
grep -q '^AI_MODEL=qwen3-vl:8b$' "$external_legacy_env"

ENV_FILE="$ENV_FILE" "$script_dir/configure-ai-services.sh" \
  --llm managed --llm-model custom-vision:8b --llm-gpu 0 \
  --transcription off --voiceover off >/dev/null
custom_legacy_env="$test_root/custom-legacy-production.env"
awk '
  /^RELEASE_VERSION=/ { print "RELEASE_VERSION=0.1.0-beta.1"; next }
  { print }
' "$ENV_FILE" >"$custom_legacy_env"
chmod 600 "$custom_legacy_env"
ENV_FILE="$custom_legacy_env" "$script_dir/upgrade-production.sh" \
  --allow-dirty --allow-without-backup >/dev/null
grep -q '^LLM_MODE=managed$' "$custom_legacy_env"
grep -q '^AI_MODEL=custom-vision:8b$' "$custom_legacy_env"

AI_ENV_FILE="$test_root/ai-services.env" \
AI_CONNECTION_FILE="$test_root/ai-services.connection.env" \
  "$script_dir/install-ai-services.sh" \
    --bind-address 192.0.2.20 --allow-client 192.0.2.10 \
    --ollama off --transcription off --voiceover managed >/dev/null
[[ $(stat -c '%a' "$test_root/ai-services.env") == 600 ]]
[[ $(stat -c '%a' "$test_root/ai-services.connection.env") == 600 ]]
grep -q '^VOICEOVER_MODE=external$' "$test_root/ai-services.connection.env"
grep -q '^TTS_BASE_URL=http://192.0.2.20:8880/v1$' "$test_root/ai-services.connection.env"

chmod 644 "$token_file"
if "$script_dir/configure-ai-services.sh" \
  --llm off --transcription external --transcription-endpoint http://192.0.2.10:8787/v1 \
  --transcription-token-file "$token_file" --voiceover off >/dev/null 2>&1; then
  echo "configure-ai-services.sh accepted a readable secret file" >&2
  exit 1
fi
chmod 600 "$token_file"

if "$script_dir/deploy-production.sh" --unknown >/dev/null 2>&1; then
  echo "deploy-production.sh accepted an unknown option" >&2
  exit 1
fi
if "$script_dir/restore.sh" >/dev/null 2>&1; then
  echo "restore.sh accepted missing confirmation arguments" >&2
  exit 1
fi
if "$script_dir/install-ai-services.sh" --help >/dev/null 2>&1; then :; else
  echo "install-ai-services.sh --help failed" >&2
  exit 1
fi

printf 'Production deployment script checks passed.\n'

source "$script_dir/production-compose.sh"
# Storage mode validation must happen before any Docker operation.
storage_test_env="$test_root/storage.env"
sed '/^STORAGE_MODE=/d; /^GARAGE_RPC_SECRET=/d' "$ENV_FILE" > "$storage_test_env"
printf 'MINIO_ROOT_USER=legacy\nMINIO_ROOT_PASSWORD=legacy-secret\n' >> "$storage_test_env"
chmod 600 "$storage_test_env"
: > "$DOCKER_LOG"
if ENV_FILE="$storage_test_env" "$script_dir/deploy-production.sh" --allow-dirty >"$test_root/storage-legacy.log" 2>&1; then
  echo 'Legacy MinIO was accepted without migration' >&2; exit 1
fi
grep -q 'migrate-storage.sh' "$test_root/storage-legacy.log"
if grep -Eq 'pull|build|up -d' "$DOCKER_LOG"; then echo 'Legacy rejection mutated Docker' >&2; exit 1; fi
sed '/^MINIO_/d' "$storage_test_env" > "$test_root/external-storage.env"
printf 'STORAGE_MODE=external\nS3_ENDPOINT=https://s3.example.test\nS3_REGION=test-region\nS3_BUCKET=external-bucket\n' >> "$test_root/external-storage.env"
chmod 600 "$test_root/external-storage.env"
(
  ENV_FILE="$test_root/external-storage.env" production_load_compose
  [[ " ${production_compose[*]} " != *'compose.garage.yml'* ]]
)
printf 'Storage mode checks passed.\n'
external_install_env="$test_root/external-install.env"
ENV_FILE="$external_install_env" S3_ENDPOINT=https://s3.example.test S3_REGION=us-east-1 \
  S3_BUCKET=external-media S3_ACCESS_KEY_ID=external-key S3_SECRET_ACCESS_KEY=external-secret \
  "$script_dir/install-production.sh" --source build --allow-dirty --storage external --tls internal \
  --domain external-storage.example.test --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop >/dev/null
grep -q '^STORAGE_MODE=external$' "$external_install_env"
grep -q '^S3_BUCKET=external-media$' "$external_install_env"

# Restore orchestration must name the database, stop before inspection and verify before restart.
restore_fixture="$test_root/restore-fixture"
mkdir -p "$restore_fixture/objects"
printf 'fixture database dump\n' > "$restore_fixture/postgres.dump"
printf 'format_version=2\n' > "$restore_fixture/manifest.txt"
printf '{"formatVersion":2,"objects":[]}\n' > "$restore_fixture/objects.json"
touch "$restore_fixture/complete"
(cd "$restore_fixture" && sha256sum postgres.dump manifest.txt objects.json > checksums.sha256)
: > "$DOCKER_LOG"
"$script_dir/restore.sh" --confirm-replace-target "$restore_fixture" >/dev/null
grep -q 'pg_restore --exit-on-error --no-owner -U app -d app' "$DOCKER_LOG"
stop_line=$(grep -n ' stop caddy web api video-render-worker' "$DOCKER_LOG" | head -1 | cut -d: -f1)
inspect_line=$(grep -n 'select count' "$DOCKER_LOG" | head -1 | cut -d: -f1)
verify_line=$(grep -n 'storage-tools verify' "$DOCKER_LOG" | head -1 | cut -d: -f1)
start_line=$(grep -n ' up -d' "$DOCKER_LOG" | head -1 | cut -d: -f1)
((stop_line < inspect_line && verify_line < start_line))
: > "$DOCKER_LOG"
if DOCKER_FAIL_PATTERN='storage-tools restore' "$script_dir/restore.sh" --confirm-replace-target "$restore_fixture" >/dev/null 2>&1; then
  echo 'Restore accepted an upload failure' >&2; exit 1
fi
if grep -q ' up -d' "$DOCKER_LOG"; then echo 'Failed restore restarted writers' >&2; exit 1; fi
printf 'Restore orchestration checks passed.\n'

# A staged migration must refuse unfinished uploads before taking a database snapshot.
migration_fixture="$test_root/migration-state"
mkdir -m 700 "$migration_fixture"
cp "$ENV_FILE" "$migration_fixture/source.env"
cp "$ENV_FILE" "$migration_fixture/target.env"
printf 'services: {}\n' > "$migration_fixture/source.compose.yml"
touch "$migration_fixture/prepare.done"
: > "$DOCKER_LOG"
if MOCK_UNFINISHED_UPLOADS=1 "$script_dir/migrate-storage.sh" backup "$ENV_FILE" "$ENV_FILE" "$migration_fixture" >"$test_root/pending.log" 2>&1; then
  echo 'Migration accepted identical source and target files' >&2; exit 1
fi
# Use separate, otherwise matching protected config files for the actual pending check.
cp "$ENV_FILE" "$test_root/migration-target.env"
if MOCK_UNFINISHED_UPLOADS=1 "$script_dir/migrate-storage.sh" backup "$ENV_FILE" "$test_root/migration-target.env" "$migration_fixture" >"$test_root/pending.log" 2>&1; then
  echo 'Migration accepted unfinished uploads' >&2; exit 1
fi
grep -q 'Unfinished uploads exist' "$test_root/pending.log"
if grep -Eq 'pg_dump|storage-tools backup| up -d' "$DOCKER_LOG"; then echo 'Pending upload refusal copied data or restarted writers' >&2; exit 1; fi
printf 'Migration preflight checks passed.\n'
