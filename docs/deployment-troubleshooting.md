# Deployment troubleshooting

Start with the safe diagnostic commands:

```bash
./scripts/doctor-production.sh
./scripts/doctor-ai-services.sh   # only on a managed AI host
```

## Inspect the application stack

```bash
sudo docker compose \
  --env-file deploy/production.env \
  -f deploy/compose.production.yml \
  ps -a
```

Use the same Compose files selected in `production.env`; the project scripts do this automatically.

## PostgreSQL is unhealthy

```bash
sudo docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yml logs --tail=200 postgres
```

Beta.2 runs the hardened image as `postgres`. Errors mentioning `chmod` or switching users usually indicate a beta.1 Compose file or an unsupported bind-mounted data directory. Do not delete the data volume to make the error disappear.

## MinIO initialization never completes

```bash
sudo docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yml logs --tail=200 minio minio-init
```

Beta.2 gives the MinIO client a writable `/tmp/.mc` configuration directory. Verify object-storage credentials are populated and the environment file remains mode `0600`.

## Web repeatedly restarts

The production web service waits for API health. Inspect the dependency first:

```bash
sudo docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yml logs --tail=200 api web
```

An nginx warning about a read-only configuration file is harmless when the container subsequently becomes healthy.

## TLS handshake failure

- Public mode requires public DNS and inbound TCP 80/443 for ACME.
- Internal mode requires clients to trust the exported Caddy root certificate.
- Confirm `TLS_MODE` in `production.env`; do not edit the committed Caddyfile.

```bash
sudo docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yml logs --tail=200 caddy
openssl s_client -connect mtl.infosteed.com:443 -servername mtl.infosteed.com </dev/null
```

## Docker cannot select a GPU

This means the host driver may work while Docker's NVIDIA runtime is absent or unconfigured:

```bash
nvidia-smi
sudo docker info --format '{{json .Runtimes}}'
dpkg -l | grep -E 'nvidia-container|libnvidia-container'
```

InfoSteed never changes the driver or CUDA installation. Follow NVIDIA's Container Toolkit documentation for the host distribution, simulate package changes before installing, then explicitly configure the Docker runtime and restart Docker during an approved maintenance window.

## Whisper appears stuck

The first preload downloads several gigabytes and keeps the service in startup state. Check logs, disk, cache growth, DNS, and outbound HTTPS. Beta.2 defaults to `HF_HUB_DISABLE_XET=1`. A stable `.incomplete` file size indicates a network stall; restarting the container resumes from the persistent cache.

## Provider works on the host but not in InfoSteed

Test from the API container's network with `doctor-production.sh`. For a native service on the application host, use `host.docker.internal`, not `127.0.0.1`. For another host, check bind addresses and firewall source restrictions. Never publish database, MinIO, or application-internal ports to solve an AI routing problem.
