# Deploy InfoSteed

## Local evaluation

Use `docker-compose.yml` to evaluate InfoSteed from a local checkout. It publishes the web application on `127.0.0.1:8080` and keeps the API, PostgreSQL, MinIO, transcription, TTS, and worker ports private. The file contains development credentials, so never use it on an internet-facing host.

## Production

Use `deploy/compose.production.yml` for a production installation on Linux amd64. Caddy manages HTTPS. Set every required image variable to both a version tag and an immutable digest. Compose will reject missing domains, source metadata, setup token, extension origin, or secrets.

Copy the example environment file, replace every placeholder, and validate the resulting configuration before starting the services:

```bash
cp deploy/production.env.example deploy/production.env
# Edit deploy/production.env with your domain, image digests, and secrets.
docker compose --env-file deploy/production.env -f deploy/compose.production.yml config --quiet
docker compose --env-file deploy/production.env -f deploy/compose.production.yml pull
docker compose --env-file deploy/production.env -f deploy/compose.production.yml up -d
```

Open the HTTPS domain from `APP_DOMAIN`. On the first visit, create the administrator account with the `SETUP_TOKEN` from `deploy/production.env`.

Set `SETUP_TOKEN` to at least 32 random bytes, distribute it out of band to the first administrator, and replace it after setup. Use a separate MinIO root account and application service account. Never expose PostgreSQL, MinIO, API, transcription, TTS, or render-worker ports to the host.

For a small team, start with 4 CPU cores, 8 GB RAM, 40 GB of application and database storage, and temporary render space at least three times the size of your largest recording. Allow another 4 cores and 4 GB RAM if you enable the optional CPU voiceover profile. GPU transcription requirements depend on the model and GPU runtime you select. Monitor both persistent storage and temporary render space.

The core readiness check covers PostgreSQL and your configured object storage. AI, transcription, TTS, and rendering report their status separately. If those optional services are unavailable, you can still generate guides locally, play recordings, and use the standard editor.

The beta images support Linux amd64 only. Do not deploy them on arm64.

You can configure external S3-compatible object storage and OpenAI-compatible transcription or TTS endpoints with the existing environment variables. You are responsible for operating and troubleshooting those external services; they are outside the default supported topology.

Before an upgrade, follow the [backup and upgrade instructions](backup-and-upgrade.md). For details about the services and stored data, see the [architecture summary](architecture.md).
