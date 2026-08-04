# Release Process

## Ownership

The repository owner performs all commits, pushes, tags, GitHub repository changes, registry publication, Store uploads, and public announcements. Automation may build and verify artifacts, but it must not publish from an unreviewed branch.

## Pre-release gates

Before the first public beta, record the cleared product name and slug, copyright holder, commercial contact and contracting entity, GitHub owner, GHCR namespace, production domain, Chrome Web Store publisher, lawyer-approved CLA, commercial licence, security contact, stable extension ID, and public manifest key.

Confirm that a case-insensitive scan contains no previous internal product references or obsolete product names. Confirm the licence and generated notices with counsel. Enable private vulnerability reporting. Keep external pull requests disabled until the CLA workflow is active.

## Candidate verification

From a clean checkout:

1. Install with the frozen lockfile.
2. Run formatting, SPDX, notices, typecheck, unit tests, Python tests, production builds, dependency audit, secret scan, CodeQL, container scan, and browser integration tests.
3. Build every Linux amd64 image and validate local and production Compose configurations, including optional profiles.
4. Create and restore a versioned backup from realistic persisted data.
5. Build both extension ZIPs from the same commit and compare their content manifest.
6. Generate checksums, SBOMs, provenance, notices, and release notes.

High or critical production vulnerabilities fail the release. Any lower finding requires a reviewed allow-list entry with an owner, justification, and expiry date.

## Release

The owner creates a signed tag such as `v0.1.0-beta.1`. The tag pipeline builds immutable amd64 images and release artifacts. The owner reviews every checksum and signature before approving GHCR or GitHub publication. Chrome Web Store submission remains manual.

Release notes list migrations, known limitations, supported versions, backup requirements, image digests, and rollback instructions. Run a one-week private installation soak followed by at least a two-week public beta before considering another maturity level.

## Rollback

Database migrations are forward-only. Rollback means stopping write-producing services, restoring the verified pre-upgrade database and object-store backup, and starting the previous immutable image set. Never run an older image against a newer database.
