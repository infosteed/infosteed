# Supported Deployment

## Local evaluation

`docker-compose.yml` builds from the local checkout and publishes only the web application on `127.0.0.1:8080`. It contains development credentials and is not suitable for an internet-facing host. The API is reached through `/api`; PostgreSQL, MinIO, transcription, TTS, and worker ports remain private.

## Production

`deploy/compose.production.yml` is the supported Linux amd64 beta topology. Caddy manages HTTPS. Every required image variable must contain a version tag and immutable digest. The Compose file rejects absent domains, source metadata, setup token, extension origin, and secrets.

Set `SETUP_TOKEN` to at least 32 random bytes, distribute it out of band to the first administrator, and replace it after setup. Use a separate MinIO root account and application service account. Never expose PostgreSQL, MinIO, API, transcription, TTS, or render-worker ports to the host.

Baseline capacity for a small team is 4 CPU cores, 8 GB RAM, 40 GB application/database storage, and temporary render space at least three times the largest source recording. The optional CPU voiceover profile benefits from 4 additional cores and 4 GB RAM. The optional GPU transcription profile depends on its selected model and GPU runtime. Monitor storage growth and render temporary space.

Core readiness checks PostgreSQL and configured object storage. Optional AI, transcription, TTS, and rendering workers report capability/status separately and do not make guide creation unavailable. Deterministic guide generation, playback, and ordinary editing remain available without AI services.

Only Linux amd64 images are published for the beta. arm64 is unsupported.

External S3-compatible object storage and external OpenAI-compatible transcription/TTS endpoints can be configured with existing environment variables. Those topologies are administrator-managed and are not supported-by-default configurations.
