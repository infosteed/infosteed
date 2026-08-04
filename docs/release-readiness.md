# Release Readiness

## Supplied

- Final product name: InfoSteed.
- Target version: 0.1.0-beta.1.
- Public licence: AGPL-3.0-only with a separate commercial-licensing path.
- Supported platform: Linux amd64 with Docker Compose and Caddy HTTPS.

The compatibility-breaking InfoSteed cutover is complete across repository paths, packages, interfaces, runtime identifiers, documentation, and test fixtures. No compatibility aliases for earlier working names are retained.

## Still required before publication

- Written confirmation that the InfoSteed name and slug are legally cleared.
- Exact copyright-owning person or company.
- Commercial-licensing contact, contracting entity, and lawyer-approved commercial licence.
- Lawyer-approved CLA granting the required relicensing rights.
- GitHub owner, GHCR namespace, production domain, and Chrome Web Store publisher identity.
- Stable Store extension ID and its public manifest key.
- Security and moderation contacts.

Until these are supplied, external contributions, public Store listing, commercial offers, and public release remain blocked.

## Technical release exercises still required

These require the final identity, signed extension, published candidate images, or elapsed soak time and therefore cannot be completed in the source tree alone:

- Run the real signed extension in Chromium through guide-only, video-only, combined capture, permission revocation, tab handoff, interrupted recovery, and server reconfiguration scenarios.
- Exercise transcription and voiceover success, failure, retry, restart, cache reuse, and render mixing against the final digest-pinned provider images.
- Create a realistic populated installation, perform a destructive rebuild and restore, and compare every database entity and object checksum.
- Test upgrade from the previous beta once a previous beta exists. This is not applicable to the first beta candidate.
- Scan and sign the final published image digests and verify the attached SBOMs and provenance.
- Complete the one-week private installation soak and minimum two-week public beta period.

Record evidence for each exercise with the candidate commit and image digests before promoting the release.
