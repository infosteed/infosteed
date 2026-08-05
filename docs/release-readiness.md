# Official release status

`v0.1.0-beta.9` is an unpublished InfoSteed release candidate. Beta.8 and earlier beta tags are unpublished, superseded candidates; do not treat them or an untagged checkout as supported.

The repository already includes the application, dual GHCR/source-build production Compose configuration, Chrome extension packaging for beta.9, backup tools, automated checks, and tag-triggered release workflow.

The beta.9 release sequence is documented in [`release-process.md`](release-process.md): successful CI and CodeQL on the candidate commit, a manual Container security rehearsal on that same commit, a signed immutable tag, verification of the generated draft and published image digests, a private soak, and publication of the existing draft.

## What remains before publication

The release owner must confirm and publish the following project and deployment details:

- legal clearance for the product name and slug;
- the copyright holder and, if commercial terms are offered, the contracting entity and approved licence;
- the production domain and browser-store publisher, and public visibility for the four `ghcr.io/infosteed` packages;
- the stable extension ID and public manifest key;
- approved contributor, security, and moderation contacts.

These are publication controls, not settings required to run InfoSteed locally or evaluate the candidate privately.

## Release and deployment evidence

Beta.9 must not be published until the release owner has retained evidence that they have:

- recorded successful CI, CodeQL, and manual Container security workflow URLs for the exact candidate commit;
- confirmed that the rehearsal completed the dependency audit, full-history secret scan, extension SBOM, four image builds, four container SBOMs, and all high/critical vulnerability gates without publishing an image;
- exercised guide, video, and combined capture with the signed Chrome extension, including permission loss, child-tab handoff, recovery, and server changes;
- exercised optional and required 2FA enrollment, normal and recovery-code login, code regeneration, self-service disablement, administrator reset, operator reset, session revocation, and recovery after deployment-wide enrollment is disabled;
- validated web and extension locale selection, English fallback, placeholders, plural forms, and right-to-left direction with a non-production test catalog;
- exercised the redesigned library, project, shared, trash, administration, guide, recording, and video-editor layouts at desktop and responsive widths;
- uploaded, inspected, selected, exported with, and deleted Word templates, including rejection of malformed, unsafe, oversized, macro-enabled, and externally linked documents;
- tested transcription, voiceover, and rendering through success, failure, retry, restart, and cache reuse;
- restored a realistic backup after rebuilding the deployment and compared database records with stored objects;
- verified the signed tag and successful Publish release workflow for the same candidate commit;
- confirmed that the workflow-created draft contains only the beta.9 Chrome extension packages, checksums, SBOM, deployment bundle, `production-images.env`, and `SHA256SUMS` without deleting or recreating the draft;
- scanned and signed the final images, verified their SBOMs and provenance, recorded all four immutable digests, and tested anonymous access after making the packages public;
- tested both GHCR and source-build installation paths from the candidate artifacts;
- completed a one-week private installation soak.

The resulting evidence must identify the beta.9 release commit and immutable image digests. Beta.9 upgrade validation covers beta.1 through beta.8. The beta.1 path must include removal of its temporary Compose and internal-TLS workarounds.

Do not move or recreate the beta.8 tag, overwrite its images, or publish its draft as the supported beta. Retain the beta.8 draft as unpublished and mark it superseded. The same immutability rule applies to every earlier candidate tag and image.
