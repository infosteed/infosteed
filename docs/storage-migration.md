# Move the existing MinIO deployment to Garage

This is a one-time storage migration with a maintenance window. Application upgrades are a separate operation. Keep the original MinIO volumes and the migration state until acceptance and an off-host backup are complete. Single-node Garage has no redundancy.

## Prepare configuration and tooling

Run from the new checkout with the old deployment still running. The migration script recovers the original production Compose file from the source `RELEASE_COMMIT`; keep that commit available locally. Existing custom `COMPOSE_FILE` paths must still contain the old working configuration. Do not run the new installer or deploy script against the legacy environment.

Build the tools image separately so the existing application image tag is not overwritten:

```bash
docker build -f apps/api/Dockerfile -t infosteed/storage-tools:garage .
cp -p deploy/production.env deploy/garage.env
chmod 600 deploy/garage.env
```

Keep the destination's release metadata, first-party image overrides, database, TLS, AI settings and bucket name identical to the source. Remove `MINIO_*` entries and add:

```dotenv
STORAGE_MODE=garage
STORAGE_TOOLS_IMAGE=infosteed/storage-tools:garage
STORAGE_TOOLS_PULL_POLICY=never
S3_ENDPOINT=http://garage:3900
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true
GARAGE_RPC_SECRET=REPLACE_WITH_OUTPUT_OF_openssl_rand_-hex_32
S3_ACCESS_KEY_ID=GK_REPLACE_WITH_OUTPUT_OF_openssl_rand_-hex_16
S3_SECRET_ACCESS_KEY=REPLACE_WITH_OUTPUT_OF_openssl_rand_-hex_32
```

Generate the values on the deployment host using `openssl rand -hex 32` (and `openssl rand -hex 16` for the access key suffix). Do not paste credentials into chat or commit either environment file. For a nondefault original Compose project, preserve its name in the destination Compose selection. Preparation rejects changed app images, release environment, mounts, ports or database settings.

The state directory contains secrets, an image archive, a database dump and media. Keep it private and ensure enough free space for the image archive and a full object backup, in addition to Garage's copied data.

```bash
scripts/migrate-storage.sh prepare deploy/production.env deploy/garage.env storage-migration
```

Preparation pulls Garage and tools, starts only Garage, confirms its bucket is empty, snapshots source configuration and saves the running source images. It does not stop writers. The script freezes application image IDs in both saved configurations.

## Maintenance and copy

Prevent users and extension clients from starting new recordings. Allow in-flight uploads and jobs to finish. The backup stage stops ingress, API and renderer and refuses unfinished upload rows. If an abandoned upload must be discarded, use the existing repository cleanup function explicitly through the original API container before the maintenance stop:

```bash
# Replace ASSET_UUID only after confirming that this recording may be discarded.
docker compose --env-file deploy/production.env -f storage-migration/source.compose.yml exec -T api \
  node --input-type=module -e 'import {createPool} from "./dist/db.js"; import {failAbandonedAsset} from "./dist/repositories/videos.js"; const db=createPool(process.env.DATABASE_URL); try { await failAbandonedAsset(db, process.argv[1]); } finally { await db.end(); }' ASSET_UUID
```

If backup refused pending uploads, the API is stopped. To run that cleanup without restarting writers, use the original image as a one-off container with the same command and environment (`run --rm --no-deps -T --entrypoint node api ...`). This changes the selected asset's status and removes its upload ID; the old provider's unfinished multipart data remains on MinIO and is not copied.

Run stages in order:

```bash
scripts/migrate-storage.sh backup deploy/production.env deploy/garage.env storage-migration
scripts/migrate-storage.sh restore deploy/production.env deploy/garage.env storage-migration
scripts/migrate-storage.sh verify deploy/production.env deploy/garage.env storage-migration
```

The verified v2 backup is the migration source. Restore copies its completed objects, preserving keys, bytes and recorded metadata; it does not restore or change PostgreSQL. It can resume interrupted transfers only with the same recorded configuration and backup, verifying existing destination objects before skipping them. Verification checks the exact key set and downloads every destination object to verify its SHA-256. It does not use multipart ETags as hashes.

Failure leaves writers stopped. A failed backup has no completion marker: preserve it for diagnosis and prepare a fresh state directory rather than treating partial bytes as a valid snapshot. Re-running restore or verify is supported. Do not edit the recorded environment files between stages.

## Cutover and acceptance

```bash
scripts/migrate-storage.sh cutover deploy/production.env deploy/garage.env storage-migration
```

Cutover rechecks the backup and Garage, then starts the exact original app images against Garage. It does not invoke the upgrade command or remove MinIO containers. The API can mutate data as soon as it starts, even before public ingress is opened.

Before allowing normal use, verify existing media playback and seeking, a new recording, rendering, an MP4 download, voiceover/transcription if configured, and deletion of the test recording. Create and test a new Garage backup. Keep using `ENV_FILE=deploy/garage.env` for operational commands until acceptance; afterwards replace `deploy/production.env` with the accepted destination file, keeping the original private copy in the migration directory. Keep the explicit tools-image setting until the deployed API image includes the CLI.

## Rollback

After cutover has been attempted, rollback restores the coordinated pre-cutover database and object backup. It discards writes made after that snapshot. Stop user activity first and preserve any new work separately if needed.

```bash
scripts/migrate-storage.sh rollback deploy/production.env deploy/garage.env storage-migration
```

Rollback stops both configurations' writers, validates the backup, restores MinIO objects and PostgreSQL, verifies restored objects and starts the preserved original image IDs. If images were removed from Docker's cache, load `storage-migration/source-images.tar` first. After rollback, operate with the preserved source Compose configuration or check out the original release before using its scripts. The new installer deliberately continues to reject the legacy environment. Do not switch only the endpoint.

A failure before cutover leaves the source stores unchanged except for explicitly discarded unfinished uploads. Once the failure is understood, the preserved source services can be restarted with `docker compose --env-file storage-migration/source.env -f storage-migration/source.compose.yml up -d --no-deps --pull never api video-render-worker web caddy`.
