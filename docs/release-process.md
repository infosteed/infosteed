# Release process

## Ownership

The repository owner approves tags, registry publication, browser-store uploads, and public announcements. Automation builds and verifies candidates but does not publish an unreviewed branch.

## Candidate verification

From a clean checkout:

1. Install dependencies from the frozen lockfile.
2. Run formatting, SPDX, licence-notice, type, unit, Python, production-build, dependency, secret, CodeQL, container, and HTTP integration checks.
3. Build the Linux amd64 images and validate the local and production Compose configurations, including optional profiles.
4. Back up and restore a populated installation.
5. Build the extension twice from the same commit and compare the packaged contents.
6. Generate checksums, SBOMs, provenance, notices, and release notes.

High or critical production vulnerabilities stop a release. Any accepted lower-severity finding needs an owner, justification, and expiry date.

## Publication

After the requirements in `release-readiness.md` are met, the owner creates a signed tag such as `v0.1.0-beta.1`. The tag workflow creates candidate evidence for review. Browser-store submission remains manual.

Release notes identify migrations, known limitations, supported versions, backup requirements, image digests, and rollback instructions. A candidate completes a one-week private soak before public beta publication.

## Rollback

Database migrations are forward-only. Stop services that write data, restore the verified pre-upgrade database and object-store backup, and then start the previous immutable image set. Never run an older image against a newer database.
