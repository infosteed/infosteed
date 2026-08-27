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

`scripts/production-compose.sh` is a library used by those scripts, not a command wrapper. Running `./scripts/production-compose.sh ps` produces no status output.

## The installer says the containers are healthy, but HTTPS fails

Container health does not prove that traffic on the host's port 443 reaches Caddy. Start by checking what certificate is actually served:

```bash
openssl s_client \
  -connect 127.0.0.1:443 \
  -servername infosteed.internal </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -fingerprint -sha256
```

Then bypass DNS and proxy settings while keeping the correct hostname for TLS:

```bash
curl --noproxy '*' -vk \
  --resolve infosteed.internal:443:127.0.0.1 \
  https://infosteed.internal/
```

If the certificate says `Kubernetes Ingress Controller Fake Certificate`, or the response is an nginx 503/404 that never appears in the InfoSteed web log, another ingress owns the host port. Inspect both Docker and Kubernetes:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
systemctl is-active k3s || true
kubectl get services,ingress -A 2>/dev/null || true
kubectl get deployments,daemonsets -A 2>/dev/null \
  | grep -Ei 'ingress|nginx|traefik' || true
```

`ss` may show no listener because Kubernetes ServiceLB can claim ports through host-port or firewall rules. A 503 changing to 404 after an Ingress is deleted means the route is gone but the controller still owns 443.

Check each InfoSteed hop directly:

```bash
docker exec infosteed-web-1 wget -S -O- http://127.0.0.1:8080/
docker exec infosteed-caddy-1 wget -S -O- http://web:8080/
docker exec infosteed-caddy-1 wget -S -O- http://api:3777/health/ready
docker logs --since 2m infosteed-web-1
docker logs --tail 150 infosteed-caddy-1
```

If the direct requests return 200 but the HTTPS request does not appear in the web access log, fix the host-level ingress conflict. Restarting healthy application containers will not repair it.

## Retire an obsolete Kubernetes ingress carefully

Deleting an application Ingress removes its route; deleting the ingress-controller workload releases its proxy; uninstalling Kubernetes removes the cluster. These are different operations.

Before deleting a namespace, inspect its storage:

```bash
kubectl get pvc,pv -n NAMESPACE
```

A persistent volume with reclaim policy `Delete` is removed with its claim. Back up anything needed before deleting the namespace.

For K3s, `k3s-killall.sh` stops the cluster and clears its networking rules without deleting the cluster datastore. `k3s-uninstall.sh` removes K3s, its local datastore, and local persistent-volume data. Use the uninstall script only when the whole cluster is intentionally being retired; follow the current [K3s stopping](https://docs.k3s.io/upgrades/killall) and [uninstall](https://docs.k3s.io/installation/uninstall) guidance rather than force-deleting guessed resources.

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
- External mode requires a valid certificate and key below `TLS_CERT_HOST_PATH`; renewals must run `scripts/restart-production-proxy.sh` after replacing them.
- Confirm `TLS_MODE` in `production.env`; do not edit the committed Caddyfile.

```bash
sudo docker compose --env-file deploy/production.env \
  -f deploy/compose.production.yml logs --tail=200 caddy
openssl s_client \
  -connect infosteed.internal:443 \
  -servername infosteed.internal </dev/null
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

Host-side curl only proves that the host can reach the provider. Test from the API container as well:

```bash
docker exec infosteed-api-1 node -e '
fetch("http://host.docker.internal:11434/api/tags")
  .then(r => { console.log(r.status); process.exit(r.ok ? 0 : 1) })
  .catch(error => { console.error(error.message); process.exit(1) })
'
```

For a native service on the application host, use `host.docker.internal`, not `127.0.0.1`. A service bound only to the host loopback address remains unreachable from Docker; bind it to a controlled host address and restrict access with the firewall. For another host, check its bind address and allowed source network. Never publish PostgreSQL, MinIO, or application-internal ports to solve an AI routing problem.
