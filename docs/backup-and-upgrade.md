# Back up, restore, and upgrade InfoSteed

PostgreSQL and object storage form one backup. The backup script pauses web, API, and worker writes, records release and migration metadata, copies both stores, and writes checksums. It automatically uses the GHCR or source-build Compose configuration selected in `deploy/production.env`.

## Create and test a backup

```bash
scripts/backup.sh /srv/backups/infosteed
```

Encrypt backups before sending them off-host, retain at least one tested off-host copy, and monitor database, object-storage, render, and backup capacity.

To restore into an isolated empty installation:

```bash
scripts/restore.sh --confirm-empty-target /srv/backups/infosteed/20260804T120000Z
```

The command verifies checksums, refuses non-empty stores, restores PostgreSQL and MinIO, compares object counts, and starts the application services.

## Upgrade

Fetch tags and check out the new official release, leaving the existing `deploy/production.env` in place:

```bash
git fetch --tags
git checkout v0.1.0-beta.5
scripts/upgrade-production.sh
```

The upgrade script validates the new checkout, pulls or builds new images while the current stack runs, creates a verified backup, updates release metadata, and waits for the replacement services to become healthy. It preserves prior versioned images. `--allow-without-backup` is reserved for a documented emergency in which data-loss risk has been explicitly accepted.

Migrations are forward-only. If startup fails after an upgrade, the script restores the previous deployment configuration and prints the exact rollback command. Rollback deliberately requires confirmation because it replaces the current database and object bucket:

```bash
scripts/restore.sh --confirm-replace-target /srv/backups/infosteed/TIMESTAMP
```

Run that command only with the pre-upgrade backup named by the failed upgrade. It clears current data, restores both stores, and starts the previous image set. Never start older images against a database that may contain newer migrations.

## Upgrade from beta.1

Beta.1 installations may have a temporary `deploy/compose.hotfix.yml`, a `COMPOSE_FILE` entry in `production.env`, and a manually edited Caddyfile. Before changing tags, preserve those files and verify the working tree:

```bash
cp -p deploy/production.env deploy/production.env.beta1-backup
cp -p deploy/Caddyfile deploy/Caddyfile.beta1-backup
git status --short
```

If `deploy/Caddyfile` is the only tracked change and contains the intentional `tls internal` workaround, preserve the backup and restore the tracked file before checking out beta.2:

```bash
git restore deploy/Caddyfile
git fetch --tags
git checkout v0.1.0-beta.2
```

Then run `scripts/upgrade-production.sh`. It derives the existing AI modes, adds explicit beta.2 mode fields, validates the candidate configuration and backup, removes the known beta.1 hotfix from the active Compose selection, and moves the old overlay to a timestamped recoverable filename. Set `TLS_MODE=internal` in the protected environment before the upgrade if the previous Caddyfile workaround cannot be detected after checkout.

After success:

```bash
scripts/doctor-production.sh
curl -I https://YOUR_INFOSTEED_HOST
```

Do not delete the beta.1 environment backup or retired hotfix until the application, database, stored media, TLS, and configured providers have been verified.
