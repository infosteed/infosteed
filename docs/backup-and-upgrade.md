# Backup, Restore, and Upgrade

The supported backup is a matched PostgreSQL custom-format dump and object-store mirror. A database-only backup is incomplete. The scripts stop web/API/worker writes while the snapshot is made and record release, migration, size, and checksum metadata.

Copy `deploy/production.env.example` to `deploy/production.env`, fill it with the exact deployed image references and secrets, then run:

```bash
scripts/backup.sh /srv/backups/infosteed
```

Encrypt backups before sending them off-host. Keep at least one tested copy outside the deployment host and apply retention appropriate to the captured data. Monitor PostgreSQL, object storage, temporary render space, and backup destination capacity. Run a destructive restore drill on an isolated empty deployment at least quarterly.

Restore accepts only an explicitly confirmed empty target:

```bash
scripts/restore.sh --confirm-empty-target /srv/backups/infosteed/20260804T120000Z
```

The restore validates checksums, refuses non-empty stores, restores both stores, compares object counts, and then starts the core services. Application-level reference verification is also exercised by the release integration suite.

Use `scripts/pre-upgrade.sh` for upgrades. It refuses to proceed unless the backup completes. `--allow-without-backup` exists only for a documented emergency where data loss is accepted.

Migrations are forward-only. Rollback means restoring the pre-upgrade backup and its previous immutable image set. Never run the previous images against an already migrated database.

Before each release, test upgrade from the preceding supported beta using persisted users, projects, guides, screenshots, videos, transcripts, voiceovers, edits, publications, and deleted items.
