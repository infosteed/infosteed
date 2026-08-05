# Official release status

No InfoSteed release has been published. InfoSteed is preparing `v0.1.0-beta.8` as its next release candidate. Earlier beta tags are unpublished candidates; do not treat them or an untagged checkout as supported.

The repository already includes the application, dual GHCR/source-build production Compose configuration, extension packaging, backup tools, automated checks, and tag-triggered release workflow.

The release sequence is documented in [`release-process.md`](release-process.md): successful CI and CodeQL on the candidate commit, a manual Container security rehearsal on that same commit, a signed immutable tag, verification of the generated draft and published image digests, a private soak, and publication of the existing draft.

## What remains before publishing beta.8

The project owner still needs to confirm and publish the following project details:

- legal clearance for the product name and slug;
- the copyright holder and, if commercial terms are offered, the contracting entity and approved licence;
- the production domain and browser-store publisher, and public visibility for the four `ghcr.io/infosteed` packages;
- the stable extension ID and public manifest key;
- approved contributor, security, and moderation contacts.

These are publication controls, not settings that you need to run InfoSteed. They do not block local development or private evaluation.

## Evidence provided with an official candidate

An official candidate will not be published until the release owner has:

- recorded successful CI, CodeQL, and manual Container security workflow URLs for the exact candidate commit;
- confirmed that the rehearsal completed the dependency audit, full-history secret scan, extension SBOM, four image builds, four container SBOMs, and all high/critical vulnerability gates without publishing an image;
- exercised guide, video, and combined capture with the signed extension, including permission loss, child-tab handoff, recovery, and server changes;
- exercised optional and required 2FA enrollment, normal and recovery-code login, code regeneration, self-service disablement, administrator reset, operator reset, session revocation, and recovery after deployment-wide enrollment is disabled;
- validated web and extension locale selection, English fallback, placeholders, plural forms, and right-to-left direction with a non-production test catalog;
- exercised the redesigned library, project, shared, trash, administration, guide, recording, and video-editor layouts at desktop and responsive widths;
- uploaded, inspected, selected, exported with, and deleted Word templates, including rejection of malformed, unsafe, oversized, macro-enabled, and externally linked documents;
- tested transcription, voiceover, and rendering through success, failure, retry, restart, and cache reuse;
- restored a realistic backup after rebuilding the deployment and compared database records with stored objects;
- verified the signed tag and successful Publish release workflow for the same candidate commit;
- confirmed that the workflow-created draft contains the extension packages, checksums, SBOM, deployment bundle, `production-images.env`, and `SHA256SUMS` without deleting or recreating the draft;
- scanned and signed the final images, verified their SBOMs and provenance, recorded all four immutable digests, and tested anonymous access after making the packages public;
- tested both GHCR and source-build installation paths from the candidate artifacts;
- completed a one-week private installation soak.

The resulting evidence will identify the beta.8 candidate commit and immutable image digests. Beta.8 must be tested as an in-place upgrade from beta.1, beta.2, beta.3, beta.4, beta.5, beta.6, and beta.7. The beta.1 path must include removal of its temporary Compose and internal-TLS workarounds.

Do not move or recreate the beta.3 tag, overwrite its images, or publish its stale draft deployment bundle. Any existing beta.3 draft must remain unpublished or be marked superseded by the release owner outside this repository.
