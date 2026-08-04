# Deploy InfoSteed

## Local evaluation

Use `docker-compose.yml` to evaluate InfoSteed from a local checkout. It publishes the web application on `127.0.0.1:8080` and contains development credentials, so never use it on an internet-facing host.

## Production requirements

Production supports Linux amd64 with Docker Engine, Docker Compose v2, Git, OpenSSL, a public DNS record pointing at the host, and inbound TCP ports 80 and 443. Caddy obtains and renews HTTPS certificates. PostgreSQL, MinIO, the API, transcription, TTS, and render-worker ports remain internal.

Check out an official version tag before installation:

```bash
git clone https://github.com/infosteed/infosteed.git
cd infosteed
git checkout v0.1.0-beta.1
```

### Install from GHCR

The default path pulls versioned public images from GitHub Container Registry:

```bash
./scripts/install-production.sh \
  --domain guides.example.com \
  --email admin@example.com \
  --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

### Build locally

To avoid any registry dependency, build the identical production services from the checked-out source:

```bash
./scripts/install-production.sh \
  --source build \
  --domain guides.example.com \
  --email admin@example.com \
  --extension-origin chrome-extension://abcdefghijklmnopabcdefghijklmnop
```

The installer supports interactive prompts when these values are omitted. In a non-interactive shell all three flags are required. It creates `deploy/production.env` with mode `0600`, generates independent secrets, validates the release checkout and Compose configuration, prepares images, starts the stack, and waits for health checks. Re-running it uses the existing configuration without replacing secrets.

Open the HTTPS domain and create the first administrator with the setup token printed by the installer. Rotate `SETUP_TOKEN` in `deploy/production.env` after setup.

Set `IMAGE_SOURCE=ghcr` or `IMAGE_SOURCE=build` to persist the deployment path. Full `WEB_IMAGE`, `API_IMAGE`, `RENDER_IMAGE`, and `TRANSCRIPTION_IMAGE` overrides remain available for mirrors or digest-pinned deployments. Optional profiles are enabled with `COMPOSE_PROFILES=transcription-gpu`, `COMPOSE_PROFILES=voiceover-cpu`, or a comma-separated combination.

For a small team, start with 4 CPU cores, 8 GB RAM, 40 GB of application and database storage, and temporary render space at least three times the size of the largest recording. A local source build needs additional temporary disk and memory. Allow another 4 cores and 4 GB RAM for the optional CPU voiceover profile. GPU transcription requirements depend on the selected model and NVIDIA runtime.

The readiness check covers PostgreSQL and configured object storage. Optional AI, transcription, TTS, and rendering report status separately; guide generation, recording playback, and the standard editor remain usable if an optional provider is unavailable.

## GHCR package visibility and cost control

The first tagged release creates `infosteed-api`, `infosteed-web`, `infosteed-video-render-worker`, and `infosteed-transcription` packages under the `infosteed` organization. An organization owner must open each package's settings once, connect it to this repository if necessary, set visibility to **Public**, and enable inherited repository permissions. Public images can then be pulled anonymously.

GitHub currently documents public packages and standard Actions runners for public repositories as free. To prevent accidental paid usage if policy or configuration changes, set Actions and Packages budgets to `$0` in the organization billing settings, do not enable larger runners, and retain the source-build installation path. See [GitHub Packages billing](https://docs.github.com/en/billing/concepts/product-billing/github-packages) and [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Before an upgrade, follow [Back up, restore, and upgrade](backup-and-upgrade.md). For service and storage details, see the [architecture summary](architecture.md).
