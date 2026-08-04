# Official release status

InfoSteed is preparing `v0.1.0-beta.2` as a Linux amd64 deployment-reliability candidate. Do not treat an untagged checkout as a supported release.

The repository already includes the application, dual GHCR/source-build production Compose configuration, extension packaging, backup tools, automated checks, and tag-triggered release workflow.

## What remains before publishing beta.2

The project owner still needs to confirm and publish the following project details:

- legal clearance for the product name and slug;
- the copyright holder and, if commercial terms are offered, the contracting entity and approved licence;
- the production domain and browser-store publisher, and public visibility for the four `ghcr.io/infosteed` packages;
- the stable extension ID and public manifest key;
- approved contributor, security, and moderation contacts.

These are publication controls, not settings that you need to run InfoSteed. They do not block local development or private evaluation.

## Evidence provided with an official candidate

An official candidate will not be published until the release owner has:

- exercised guide, video, and combined capture with the signed extension, including permission loss, child-tab handoff, recovery, and server changes;
- tested transcription, voiceover, and rendering through success, failure, retry, restart, and cache reuse;
- restored a realistic backup after rebuilding the deployment and compared database records with stored objects;
- scanned and signed the final images and verified their SBOMs and provenance;
- completed a one-week private installation soak.

The resulting evidence will identify the candidate commit and immutable image digests. Beta.2 must also be tested as an in-place upgrade from beta.1, including removal of its temporary Compose and internal-TLS workarounds.
