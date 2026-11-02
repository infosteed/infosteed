# Official release status

`v0.1.0-beta.17` is an unpublished InfoSteed release candidate. Beta.16 and earlier tags are immutable, superseded application candidates.

This candidate includes Garage as the bundled storage service, provider-independent S3 operation, verified backup/restore, explicit MinIO migration and rollback, MP4 exports, administrator password resets, and security dependency updates. Local release preparation was requested by the repository owner on 2026-11-02; the owner handles GitHub pushes, release tags and publication.

## What remains before publication

Run CI, CodeQL, and Container security against the exact candidate commit before creating its signed tag. Verify the resulting Publish release workflow, generated draft, image digests, checksums, deployment archive, anonymous GHCR access, and final installation checks before publishing the same draft as a prerelease. Record the commit and run URLs below when available.

A one-week production soak of the final commit has not been recorded. This release is a beta for evaluation; do not describe it as production-qualified or claim unperformed manual browser-store, legal, translation, 2FA or AI-provider validation. No browser-store submission or public announcement is part of this GitHub publication.

## Local candidate validation

The Garage migration implementation was checked on 2026-10-22 with live S3 contract tests against Garage and SeaweedFS, persistence across Garage container recreation, six HTTP end-to-end tests in both bundled and external storage modes, real FFmpeg rendering and MP4 downloads, v1/v2 backup restoration, and a populated MinIO-to-Garage migration and coordinated rollback after new database writes. The original development media was copied and verified without deleting the MinIO source volume.

On 2026-11-02, the original native-development database was reconnected and verified to contain its existing user and recordings. Both the API and browser-facing setup routes returned `required:false`, with PostgreSQL and object-storage readiness passing. The persistent native-development volume now has a stable name independent of the debugger's Compose project.

Fresh release validation also updates the affected production dependencies, removes the unused shadcn generator CLI from the web package, and moves schema validation to the patched Zod release. The fresh production dependency audit reports zero findings at every severity. The full `pnpm check` gate, SPDX and generated notices checks, signed-tag metadata validation, production deployment/restore/migration-preflight tests, deployment archive test, four transcription contract tests, and live Garage S3 contract all pass. The candidate API, web and renderer images build locally. Initial image scanning identified fixable Ubuntu and Nginx findings. Runtime OS layers were rebuilt, Nginx was updated to pinned 1.30.6, and all four local release images now pass the configured fixable high/critical vulnerability gate. Release and security workflows refresh runtime layers before publication. Full-history and candidate-patch secret scans pass; the scanner allows only the exact public development RPC fixture and the nonfunctional production template placeholder. Exact remote commit, workflow and artifact evidence follows after publication gates complete.

## Storage and upgrade requirements

- Fresh installations default to single-node Garage; this mode has no storage redundancy. External S3 remains configurable.
- Existing MinIO deployments must complete [storage migration](storage-migration.md) before normal upgrades. Do not start the new deployment against an empty Garage bucket and assume old objects moved automatically.
- Storage migration preserves the original application images and database release. Upgrade application code separately after verified cutover.
- Format v2 backups preserve object bytes, keys and metadata. Legacy v1 backups remain readable with documented metadata limitations.
- Take a coordinated PostgreSQL/object backup before upgrading. After new writes or database migrations, rollback restores both stores and the previous image set; an endpoint switch alone is insufficient.
- Linux amd64 production images, Node.js 24 for native development, Docker Compose 2.23.1 or newer, and Chrome 116 or newer are the supported baseline.
- Chrome packages are rebuilt from the final release commit and attached with checksums. The dependency refresh can change bundled extension code; do not claim byte-for-byte equality with a previously published extension without comparison. No Chrome Web Store resubmission is performed here.

## Release evidence

The owner will record the signed tag, candidate commit, workflow run URLs, published image digests and final artifact verification after performing the GitHub release steps. The validated changes are prepared as a local commit for owner review. No tag, push or GitHub release is created during local preparation; the owner handles release signing and publication. Never move an existing tag or overwrite a versioned image; prepare a new version if publication fails after an image is published.
