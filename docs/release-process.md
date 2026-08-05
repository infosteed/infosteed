# Publishing an InfoSteed release

Only the repository owner approves official tags, GHCR publication, browser-store uploads, and announcements. Pushing a signed `v*` tag authorizes container publication; an untagged `main` commit never publishes an image.

## Verify and tag

From a clean checkout, run the formatting, SPDX, licence-notice, type, unit, Python, production-build, dependency, secret, CodeQL, container, Compose, and HTTP integration checks. Exercise backup and restore with populated data and compare two extension packages built from the same commit.

The root package version must exactly match the tag without its `v` prefix:

```bash
version=$(node -p "require('./package.json').version")
corepack pnpm release-metadata:check -- --release-tag "v$version"
git tag -s "v$version"
git push origin "v$version"
```

Tag-mode metadata validation requires the matching changelog entry to carry an ISO release date rather than `Unreleased`. It also verifies active deployment documentation, environment examples, runtime defaults, shared metadata, and workspace manifests against the root package version.

The tag workflow verifies the version, publishes Linux amd64 API, web, render-worker, and transcription images to GHCR, attaches SBOM and provenance metadata, and creates a draft GitHub Release containing extension packages, checksums, deployment files, and image references. Release tags and `sha-<commit>` tags are never overwritten; there is no floating `latest` or `edge` tag.

The owner reviews the draft and the items in [`release-readiness.md`](release-readiness.md), verifies all four packages are public, tests anonymous pulls and both production installation paths, then publishes the GitHub Release and submits the browser extension manually. Release notes must list migrations, limitations, supported versions, backup requirements, image references, and rollback instructions.

Do not publish a candidate with a high- or critical-severity production vulnerability. Record an owner, justification, and expiry for any accepted lower-severity finding. Run the candidate privately for one week before its public-beta announcement.

## Rollback

Database migrations are forward-only. Stop writers, use `scripts/restore.sh --confirm-replace-target` with the verified pre-upgrade backup, and start the previous versioned image set. Never run an older image against a newer database.
