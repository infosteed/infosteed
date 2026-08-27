# Deploy InfoSteed

InfoSteed installs the core application first. LLM, transcription, and voiceover services are configured afterward and can each be managed by InfoSteed, supplied by another host, or disabled.

`v0.1.0-beta.15` is an unpublished InfoSteed release candidate. Beta.14 and earlier beta tags were superseded without public application publication. Use the commands below only after the signed beta.15 tag exists; do not deploy an untagged checkout as a supported release.

## Choose a topology

| Layout            | Application host                                          | AI configuration                             |
| ----------------- | --------------------------------------------------------- | -------------------------------------------- |
| Core only         | App, PostgreSQL, MinIO, Caddy, renderer                   | All services `off`                           |
| One host          | Core plus selected Ollama, Whisper, and Kokoro containers | Selected services `managed`                  |
| Split hosts       | Core on one machine; selected AI containers on another    | App uses `external` endpoints                |
| Existing services | Core plus operator-provided Ollama or compatible APIs     | Matching services `external`                 |
| Cloud provider    | Core only                                                 | OpenAI-compatible endpoint and protected key |

## Requirements

- Linux amd64, Docker Engine, Docker Compose v2, Git, OpenSSL, and curl.
- A clean checkout of the exact release tag.
- A hostname resolving to the application host.
- TCP 443 reachable by intended clients. Public ACME mode also requires public inbound access as described below.
- NVIDIA drivers and NVIDIA Container Toolkit only when a managed GPU service is selected.

Do not run the development `docker-compose.yml` on an exposed host. It contains development credentials.

## Check the host before installing

Make sure an old web server or Kubernetes ingress does not already own ports 80 and 443:

```bash
sudo ss -ltnp | grep -E ':(80|443)\b' || true
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
systemctl is-active k3s || true
kubectl get services,ingress -A 2>/dev/null || true
```

Do not rely on `ss` alone. Kubernetes ServiceLB and similar components can redirect traffic with host-port or firewall rules without appearing as an ordinary listening process. If the machine already runs an ingress controller, decide which proxy will own 80 and 443 before starting InfoSteed.

## Install the core application

```bash
git clone https://github.com/infosteed/infosteed.git
cd infosteed
git checkout v0.1.0-beta.15
```

For a publicly resolvable host, use public ACME certificates:

```bash
./scripts/install-production.sh \
  --source ghcr \
  --tls public \
  --domain infosteed.example.com \
  --email admin@example.com \
  --extension-origin chrome-extension://mdhecibghobakiihpoeenmjfgegnkinp
```

For private DNS or a LAN-only host, use Caddy's internal CA:

```bash
./scripts/install-production.sh \
  --source ghcr \
  --tls internal \
  --domain infosteed.internal \
  --extension-origin chrome-extension://mdhecibghobakiihpoeenmjfgegnkinp
```

To avoid a registry dependency, replace `--source ghcr` with `--source build`. A source build requires a clean checkout unless `--allow-dirty` is explicitly accepted.

The installer creates `deploy/production.env` with mode `0600`, generates independent database, object-storage, and setup secrets, validates Compose, starts the stack, and waits for health. It then connects through the host-published HTTPS port and confirms that the certificate, web application, product identity, version, and commit all belong to this deployment. It never overwrites an existing environment file.

The setup token is an administrator credential. Do not paste it into chat, issue trackers, or shared logs. Save it privately, create the first administrator, and rotate it afterward without printing the replacement:

```bash
new_setup_token=$(openssl rand -hex 32)
sed -i "s/^SETUP_TOKEN=.*/SETUP_TOKEN=$new_setup_token/" deploy/production.env
unset new_setup_token
./scripts/deploy-production.sh
```

If the token is disclosed before the administrator exists, replace it immediately and use only the replacement for setup.

For internal TLS, the installer exports the public root certificate to `deploy/infosteed-local-ca.crt`. Trust it on each client using [Internal HTTPS](internal-https.md).

## Private/LAN HTTPS with a publicly trusted certificate

Use external TLS when InfoSteed must remain reachable only on a private network but clients should receive a publicly trusted certificate. The public hostname can resolve through split or internal DNS to the server's LAN address. The router or firewall should not forward TCP 80 or 443 to the server when the service is intended to remain private.

Issue the certificate separately with a DNS-01-capable client such as acme.sh, Certbot, or lego. DNS-01 proves control through DNS and does not require public inbound access to the InfoSteed host. In this mode Caddy only reads the supplied certificate and key; it does not create an ACME account, answer challenges, or renew the certificate.

Create a dedicated host directory and have the certificate manager install stable files into it. Provider-neutral acme.sh commands have this shape; replace `dns_provider` and the provider-specific environment variables with those documented by the DNS plugin:

```bash
# Export the environment variables required by your chosen DNS plugin.
acme.sh --issue --dns dns_yourprovider -d mt.example.com --ecc

# First create this directory with ownership that lets the certificate manager
# replace the files while keeping them unavailable to untrusted users.
acme.sh --install-cert \
  -d mt.example.com \
  --ecc \
  --key-file /srv/infosteed-certs/key.pem \
  --fullchain-file /srv/infosteed-certs/fullchain.pem \
  --reloadcmd 'cd /opt/infosteed && ENV_FILE=deploy/production.env ./scripts/restart-production-proxy.sh'
```

Do not copy DNS API credentials into `production.env`; InfoSteed and Caddy do not need them. For Internet.bs, the provider-specific issuance step is:

```bash
export INTERNETBS_API_KEY=REPLACE_WITH_API_KEY
export INTERNETBS_API_PASSWORD=REPLACE_WITH_API_PASSWORD
acme.sh --issue --dns dns_internetbs -d mt.example.com --ecc
```

Protect those credentials according to the certificate client's guidance and remove them from the interactive shell when finished. Install InfoSteed after the certificate files exist:

```bash
./scripts/install-production.sh \
  --source ghcr \
  --tls external \
  --tls-cert-host-path /srv/infosteed-certs \
  --domain mt.example.com \
  --extension-origin chrome-extension://mdhecibghobakiihpoeenmjfgegnkinp
```

The default container paths are `/certs/fullchain.pem` and `/certs/key.pem`; change `TLS_CERT_FILE` or `TLS_KEY_FILE` in `deploy/production.env` only when the files have different paths below the mounted `/certs` directory. `TLS_CERT_HOST_PATH` must be an absolute host directory. The external-only Compose overlay mounts that directory at `/certs` read-only and does not alter Caddy's dropped capabilities or `no-new-privileges` setting.

The Caddy process must be able to traverse every parent directory and read both files; the account running InfoSteed's deployment scripts must also be able to traverse the host path and stat the files. A typical setup makes the certificate mode `0644`, the private key mode `0640`, and gives the key suitable ownership or a group readable by the container process. Avoid making the private key world-readable. Rootless Docker or user-namespace remapping may require matching the remapped container UID/GID. Deployment validates the Caddy configuration inside the same hardened container, so an unreadable key fails before the running proxy is replaced.

The external certificate manager owns renewal. It replaces the two files in the mounted host directory and must then restart Caddy so the new certificate is loaded. Because InfoSteed disables Caddy's admin API, use the project command shown in `--reloadcmd`, not `caddy reload`. Run it manually after any certificate replacement when the certificate client cannot invoke it:

```bash
ENV_FILE=deploy/production.env ./scripts/restart-production-proxy.sh
```

The script derives both the external Caddyfile and certificate mount from `TLS_MODE`, validates that Caddy can read them, restarts only the proxy, and verifies the host-published HTTPS endpoint.

To migrate an existing public or internal deployment, first install the certificate files, then add the three `TLS_CERT_*` settings shown in `deploy/production.env.example`, change `TLS_MODE=external`, and run `./scripts/deploy-production.sh`. No `CADDY_CONFIG_FILE` or manual Compose selector is needed. To leave external mode, change `TLS_MODE` back to `public` or `internal` and deploy again; the certificate directory will no longer be mounted.

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

Managed defaults are Ollama with `qwen3-vl:8b-instruct`, GPU Whisper with `large-v3-turbo`, and CPU Kokoro. A non-interactive single-host configuration is:

```bash
./scripts/configure-ai-services.sh \
  --llm managed --llm-model qwen3-vl:8b-instruct --llm-gpu 0 \
  --transcription managed --transcription-model large-v3-turbo --transcription-gpu 0 \
  --voiceover managed
```

Managed Ollama and Whisper require the NVIDIA container runtime. A GPU UUID is safer than an index when hardware order may change:

```bash
nvidia-smi --query-gpu=index,uuid,name,memory.total --format=csv
```

The services may share a GPU, but simultaneous requests can exhaust VRAM. Select separate indices or UUIDs when available.

For existing or split-host services, follow [AI services](ai-services.md). Credentials must be entered at the silent prompt, read from a mode-`0600` file, or imported from the protected connection file. They are not accepted directly as command arguments.

## Install the browser extension offline

The beta.15 API image bundles the unchanged Chrome browser extension package. Its Chrome Web Store release remains at extension version `0.1.0` and does not require resubmission for this application-only release. Sign in as an administrator, open **Administration**, select **Browser Extensions**, and download `extension-offline.zip`.

The matching GitHub Release assets are an alternative when the deployment is not yet running. Assets on a draft release are visible only to an authenticated repository owner; the public download URL returns `404` until that draft is published. Do not use GitHub's automatically generated source-code ZIP as the extension. Build output under `artifacts/` and `apps/extension/dist/` remains deliberately ignored by Git.

Extract `extension-offline.zip` to a permanent directory, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the directory containing `manifest.json`. For the official package, verify that Chrome reports this extension ID:

```text
mdhecibghobakiihpoeenmjfgegnkinp
```

The origin passed to the installer must use the same ID:

```text
chrome-extension://mdhecibghobakiihpoeenmjfgegnkinp
```

## Operate the stack

All production operations use the source and profiles recorded in `production.env`:

```bash
./scripts/doctor-production.sh
./scripts/doctor-production.sh --deep
./scripts/backup.sh /srv/backups/infosteed
./scripts/upgrade-production.sh
```

`scripts/production-compose.sh` is a library sourced by the operational scripts; running it directly does nothing. To inspect the core stack yourself, use:

```bash
docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yml ps -a
```

The normal doctor checks configuration, DNS, HTTPS, containers, and provider reachability. `--deep` performs small billable or compute-consuming LLM, transcription, and voiceover requests.

Do not delete versioned images or named volumes during routine upgrades. See [Back up, restore, and upgrade](backup-and-upgrade.md) and [Deployment troubleshooting](deployment-troubleshooting.md).

## Capacity guidance

Start the core application with 4 CPU cores, 8 GB RAM, 40 GB persistent storage, and render scratch space at least three times the largest recording. Allow additional disk for local builds and model caches. CPU Kokoro benefits from another 4 CPU cores and 4 GB RAM. Ollama and Whisper requirements depend on model and quantization.

## GHCR visibility and zero-cost controls

The organization owner must make the four InfoSteed GHCR packages public and enable inherited repository permissions. Public images can then be pulled anonymously. Set GitHub Actions and Packages spending budgets to `$0`, do not enable larger runners, and retain the local source-build path if GitHub policy changes.
