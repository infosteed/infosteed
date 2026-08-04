# Official release status

InfoSteed has not yet published its first supported self-hosted beta. The current target is Linux amd64. You can use the repository for development and private evaluation, but do not treat an untagged checkout as a supported release.

The repository already includes the application, dual GHCR/source-build production Compose configuration, extension packaging, backup tools, automated checks, and tag-triggered release workflow.

## What remains before the first public beta

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

The resulting evidence will identify the candidate commit and immutable image digests. Upgrade testing from a previous beta will begin when there is a previous beta to test.
