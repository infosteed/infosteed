# Configure AI services

InfoSteed treats the LLM, transcription, and voiceover providers independently. Changing one does not require moving the others.

## One-host managed services

Run `scripts/configure-ai-services.sh` on the application host and choose `managed` for the services to install. The wizard validates the NVIDIA runtime and selected GPU before pulling images. It prepares models while the old application remains available, backs up `production.env`, and recreates only affected services after validation.

Managed endpoints stay inside Docker networking:

- Ollama: `http://ollama-local:11434`
- Whisper: `http://transcription-gpu:8787/v1`
- Kokoro: `http://voiceover-cpu:8880/v1`

No AI port is published on the host in this layout.

## Existing service on the application host

For a native Ollama service, ensure it listens on an address reachable from Docker. The API container can use:

```text
http://host.docker.internal:11434
```

Choose `external`, provider `ollama`, that endpoint, and `qwen3-vl:8b` in the wizard. InfoSteed adds Docker's `host-gateway` mapping but never changes the native Ollama service.

Check the host service first:

```bash
curl -fsS http://127.0.0.1:11434/api/tags
ollama list
```

Then test from the InfoSteed API container. A provider can work on the host and still be unreachable from Docker:

```bash
docker exec infosteed-api-1 node -e '
fetch("http://host.docker.internal:11434/api/tags")
  .then(r => { console.log("Ollama:", r.status); process.exit(r.ok ? 0 : 1) })
  .catch(error => { console.error(error.message); process.exit(1) })
'
```

Test transcription the same way, replacing the example hostname with the address reachable from the API container:

```bash
docker exec infosteed-api-1 node -e '
fetch("http://transcription.internal:8787/health")
  .then(async r => {
    console.log("Transcription:", r.status, await r.text())
    process.exit(r.ok ? 0 : 1)
  })
  .catch(error => { console.error(error.message); process.exit(1) })
'
```

A service published only on a particular host address must be configured with an address the API container can reach; host loopback is not enough.

## Existing Ollama and Whisper, managed voiceover

This mixed layout keeps a native Ollama service and an existing GPU Whisper container while adding InfoSteed's CPU Kokoro container. First check whether the existing Whisper container requires a token. This example uses the standard InfoSteed transcription container name:

```bash
docker inspect infosteed-whisper-transcription-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -q '^WHISPER_API_TOKEN=.\+' \
  && echo 'token-required' \
  || echo 'no-token'
```

If it prints `token-required`, copy the value to a temporary mode-`0600` file without displaying it:

```bash
umask 077
token_file=$(mktemp /tmp/infosteed-transcription-token.XXXXXX)
docker inspect infosteed-whisper-transcription-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^WHISPER_API_TOKEN=//p' >"$token_file"
test -s "$token_file" || { echo 'transcription token was not found' >&2; exit 1; }
```

Configure the providers, replacing `transcription.internal` with the address reachable from the API container:

```bash
./scripts/configure-ai-services.sh \
  --llm external \
  --llm-provider ollama \
  --llm-endpoint http://host.docker.internal:11434 \
  --llm-model qwen3-vl:8b \
  --transcription external \
  --transcription-endpoint http://transcription.internal:8787/v1 \
  --transcription-model large-v3-turbo \
  --transcription-token-file "$token_file" \
  --voiceover managed
```

If Whisper printed `no-token`, omit `--transcription-token-file` from the command. Managed voiceover runs on CPU at `http://voiceover-cpu:8880/v1` inside the Compose network and does not publish port 8880 on the host.

After configuration, remove any temporary token copy and run a real request through each provider:

```bash
if [[ -n ${token_file:-} ]]; then
  rm -f "$token_file"
  unset token_file
fi
./scripts/doctor-production.sh --deep
```

The configuration script copies the token into mode-`0600` `deploy/production.env`. Do not put the token directly on the command line. A mode-`0600` secret file must be owned by the account running the configuration script; a root-owned file under `/etc` is not readable by an ordinary operator account.

## Split-host managed services

On the AI host, check existing workloads before doing anything:

```bash
nvidia-smi
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
systemctl is-active ollama || true
sudo docker info --format '{{json .Runtimes}}'
```

InfoSteed will not install or change GPU drivers, CUDA, Docker, OpenWebUI, or native Ollama. If the NVIDIA runtime is missing, use NVIDIA's current Container Toolkit installation guide, review its package simulation, and explicitly configure Docker afterward.

Install only the selected services. This example preserves an existing Ollama, installs Whisper on GPU 0, and leaves Kokoro on the application host:

```bash
./scripts/install-ai-services.sh \
  --bind-address 192.0.2.20 \
  --allow-client 192.0.2.10 \
  --ollama existing \
  --ollama-endpoint http://192.0.2.20:11434 \
  --transcription managed \
  --transcription-gpu 0 \
  --voiceover off
```

The installer verifies existing Ollama without modifying it, generates a Whisper token, starts only selected containers, and creates:

- `deploy/ai-services.env`: service configuration and secrets.
- `deploy/ai-services.connection.env`: the protected app-side connection bundle.

Both files have mode `0600`. Transfer only the connection file through a secure channel, then on the application host run:

```bash
./scripts/configure-ai-services.sh \
  --from-file /secure/path/ai-services.connection.env
```

Delete the transferred copy after configuration if it is no longer needed. Retain the original AI environment file for service upgrades.

## Network restrictions

Managed split-host ports are bound only to `--bind-address`, but binding is not a firewall. Permit the application host and deny other clients:

| Service | TCP port |
| ------- | -------: |
| Ollama  |    11434 |
| Whisper |     8787 |
| Kokoro  |     8880 |

Use the host's existing firewall manager. Review rules before applying them; the installer only prints the required source and ports and does not modify firewall state.

## Hugging Face model downloads

Whisper preloads its model before becoming healthy. The model cache is persistent. `HF_HUB_DISABLE_XET=1` is the default because ordinary HTTP downloads are easier to diagnose on restricted networks. Set `HF_TOKEN` in the protected AI environment only if rate limits require it.

Watch startup and cache growth with:

```bash
sudo docker compose \
  --env-file deploy/ai-services.env \
  -f deploy/compose.ai-services.yml \
  logs -f transcription

sudo docker compose \
  --env-file deploy/ai-services.env \
  -f deploy/compose.ai-services.yml \
  exec transcription \
  sh -c 'find /models -type f -printf "%s %p\n" | sort -nr | head'
```

`Application startup complete` and a healthy `/health` response mean the model loaded successfully.

## External OpenAI-compatible providers

Choose `external` in the app wizard. Select `openai-compatible` for the LLM and provide its base endpoint, model, and API key through the silent prompt or a protected file. Transcription must expose `/audio/transcriptions`; voiceover must expose `/audio/speech`. The wizard validates the resolved Compose configuration before replacing the API container.

## Diagnostics

On the AI host:

```bash
./scripts/doctor-ai-services.sh
./scripts/doctor-ai-services.sh --deep
```

On the application host:

```bash
./scripts/doctor-production.sh
./scripts/doctor-production.sh --deep
```

The normal checks are non-destructive. Deep checks perform real inference.
