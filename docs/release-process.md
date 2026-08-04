# Publishing an InfoSteed release

This process applies when you publish a build for other people to install. It is not required for local development or a private evaluation checkout.

## Ownership

Only the repository owner can approve official tags, registry publication, browser-store uploads, and public announcements. The automated workflow prepares evidence for review; it does not turn an unreviewed branch into an official release.

## Verify a candidate

Start from a clean checkout of the exact commit you intend to tag:

1. Install dependencies from the frozen lockfile.
2. Run the formatting, SPDX, licence-notice, type, unit, Python, production-build, dependency, secret, CodeQL, container, and HTTP integration checks.
3. Build the Linux amd64 images and validate the local and production Compose configurations, including optional profiles.
4. Back up and restore a populated installation.
5. Build the extension twice from the same commit and compare the packaged contents.
6. Generate checksums, SBOMs, provenance, notices, and release notes.

Do not publish a candidate with a high- or critical-severity production vulnerability. Record an owner, justification, and expiry date for any accepted lower-severity finding.

## Publication

Once the status items in [`release-readiness.md`](release-readiness.md) are complete, the repository owner creates a signed tag such as `v0.1.0-beta.1`. The tag workflow creates the candidate evidence for review. Submit the browser extension to the browser store manually.

In the release notes, list migrations, known limitations, supported versions, backup requirements, image digests, and rollback instructions. Run the candidate privately for one week before publishing it as a public beta.

## Rollback

Database migrations are forward-only. To roll back, stop every service that writes data, restore the verified pre-upgrade database and object-store backup, and start the previous immutable image set. Never run an older image against a newer database.
