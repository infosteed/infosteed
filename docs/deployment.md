# Deploy InfoSteed

InfoSteed installs the core application first. LLM, transcription, and voiceover services are configured afterward and can each be managed by InfoSteed, supplied by another host, or disabled.

There is no supported public release yet. The commands below prepare the unpublished `v0.1.0-beta.4` candidate after its signed tag exists; do not publish or deploy the superseded `v0.1.0-beta.3` artifacts as a supported release.

## Choose a topology

| Layout            | Application host                                          | AI configuration                             |
| ----------------- | --------------------------------------------------------- | -------------------------------------------- |
| Core only         | App, PostgreSQL, MinIO, Caddy, renderer                   | All services `off`                           |
| One host          | Core plus selected Ollama, Whisper, and Kokoro containers | Selected services `managed`                  |
| Split hosts       | Core on one machine; selected AI containers on another    | App uses `external` endpoints                |
| Existing services | Core plus operator-provided Ollama or compatible APIs     | Matching services `external`                 |
| Cloud provider    | Core only                                                 | OpenAI-compatible endpoint and protected key |

The addresses `192.168.0.156` and `192.168.0.183` below are examples, not defaults.

## Requirements

- Linux amd64, Docker Engine, Docker Compose v2, Git, and OpenSSL.
- A clean checkout of the exact release tag.
- A hostname resolving to the application host.
- TCP 80 and 443 reachable by intended clients.
- NVIDIA drivers and NVIDIA Container Toolkit only when a managed GPU service is selected.

Do not run the development `docker-compose.yml` on an exposed host. It contains development credentials.

## Install the core application

```bash
git clone https://github.com/infosteed/infosteed.git
cd infosteed
git checkout v0.1.0-beta.4
```

For a publicly resolvable host, use public ACME certificates:

```bash
./scripts/install-production.sh \
  --source ghcr \
  --tls public \
  --domain guides.example.com \
  --email admin@example.com \
  --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

For private DNS or a LAN-only host, use Caddy's internal CA:

```bash
./scripts/install-production.sh \
  --source ghcr \
  --tls internal \
  --domain mtl.infosteed.com \
  --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

To avoid a registry dependency, replace `--source ghcr` with `--source build`. A source build requires a clean checkout unless `--allow-dirty` is explicitly accepted.

The installer creates `deploy/production.env` with mode `0600`, generates independent database, object-storage, and setup secrets, validates Compose, starts the stack, and waits for health. It never overwrites an existing environment file. Save the printed setup token, open the HTTPS URL, create the first administrator, and then rotate `SETUP_TOKEN` in the environment file.

For internal TLS, the installer exports the public root certificate to `deploy/infosteed-local-ca.crt`. Trust it on each client using [Internal HTTPS](internal-https.md).

## Optional two-factor authentication

Production installs also generate `TWO_FACTOR_ENCRYPTION_KEY` in `deploy/production.env` while leaving `TWO_FACTOR_ENABLED=false` by default. Back up this key with the deployment environment; enrolled accounts cannot be verified if it is lost or replaced.

Set `TWO_FACTOR_ENABLED=true` to allow new TOTP enrollment and new admin-enforced account requirements. Disabling it later stops new enrollment, but already enrolled accounts still require their authenticator or a recovery code.

For sole-admin recovery, run `scripts/reset-two-factor.sh` on the host and enter the exact username twice. The command removes the account's TOTP credential, recovery codes, and pending continuations, revokes every session, writes an audit event, and preserves whether the account is required to use 2FA. If the requirement is preserved, keep or set `TWO_FACTOR_ENABLED=true` before the next sign-in so the user can enroll a replacement authenticator. A required account cannot sign in to re-enroll while deployment-wide enrollment is disabled.

## Configure AI services

Run the interactive wizard after the core is healthy:

```bash
./scripts/configure-ai-services.sh
```

For each service, choose:

- `managed`: start the service inside the application Compose project.
- `external`: use a URL on this host, another host, or the internet.
- `off`: disable the integration.

Managed defaults are Ollama with `qwen3-vl:8b`, GPU Whisper with `large-v3-turbo`, and CPU Kokoro. A non-interactive single-host configuration is:

```bash
./scripts/configure-ai-services.sh \
  --llm managed --llm-model qwen3-vl:8b --llm-gpu 0 \
  --transcription managed --transcription-model large-v3-turbo --transcription-gpu 0 \
  --voiceover managed
```

Managed Ollama and Whisper require the NVIDIA container runtime. A GPU UUID is safer than an index when hardware order may change:

```bash
nvidia-smi --query-gpu=index,uuid,name,memory.total --format=csv
```

The services may share a GPU, but simultaneous requests can exhaust VRAM. Select separate indices or UUIDs when available.

For existing or split-host services, follow [AI services](ai-services.md). Credentials must be entered at the silent prompt, read from a mode-`0600` file, or imported from the protected connection file. They are not accepted directly as command arguments.

## Operate the stack

All production operations use the source and profiles recorded in `production.env`:

```bash
./scripts/doctor-production.sh
./scripts/doctor-production.sh --deep
./scripts/backup.sh /srv/backups/infosteed
./scripts/upgrade-production.sh
```

The normal doctor checks configuration, DNS, HTTPS, containers, and provider reachability. `--deep` performs small billable or compute-consuming LLM, transcription, and voiceover requests.

Do not delete versioned images or named volumes during routine upgrades. See [Back up, restore, and upgrade](backup-and-upgrade.md) and [Deployment troubleshooting](deployment-troubleshooting.md).

## Capacity guidance

Start the core application with 4 CPU cores, 8 GB RAM, 40 GB persistent storage, and render scratch space at least three times the largest recording. Allow additional disk for local builds and model caches. CPU Kokoro benefits from another 4 CPU cores and 4 GB RAM. Ollama and Whisper requirements depend on model and quantization.

## GHCR visibility and zero-cost controls

The organization owner must make the four InfoSteed GHCR packages public and enable inherited repository permissions. Public images can then be pulled anonymously. Set GitHub Actions and Packages spending budgets to `$0`, do not enable larger runners, and retain the local source-build path if GitHub policy changes.
