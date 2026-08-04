# Back up, restore, and upgrade InfoSteed

Back up PostgreSQL and object storage together. A database-only backup is incomplete because its records refer to media in the object store. The backup script pauses web, API, and worker writes while it takes the snapshot, then records the release, migrations, sizes, and checksums.

## Create a backup

Copy `deploy/production.env.example` to `deploy/production.env`, fill it with the exact deployed image references and secrets, then run:

```bash
scripts/backup.sh /srv/backups/infosteed
```

Encrypt backups before sending them off-host. Keep at least one tested copy outside the deployment host and choose a retention period appropriate for the data you record. Monitor PostgreSQL, object storage, temporary render space, and backup destination capacity.

Test a restore at least once per quarter. Always use an isolated, empty deployment for the test because restoration replaces the target data.

## Restore a backup

Choose a backup directory and pass the explicit empty-target confirmation:

```bash
scripts/restore.sh --confirm-empty-target /srv/backups/infosteed/20260804T120000Z
```

The restore command validates checksums, refuses non-empty stores, restores the database and object store, compares object counts, and then starts the core services.

## Upgrade

Run `scripts/pre-upgrade.sh` before an upgrade. It creates a backup and stops if that backup fails. Use `--allow-without-backup` only during a documented emergency in which you have explicitly accepted the risk of data loss.

Migrations are forward-only. To return to an earlier version, restore the pre-upgrade database and object-store backup and use the previous immutable image set. Never run previous images against an already migrated database.
