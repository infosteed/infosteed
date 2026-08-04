# Release readiness

InfoSteed is preparing its first supported self-hosted beta for Linux amd64. The source tree includes the application, production Compose configuration, extension packaging, backup tools, CI checks, and release-evidence workflow.

## Publication requirements

Publication remains closed until maintainers record:

- legal clearance for the product name and slug;
- the copyright holder and, if commercial terms are offered, the contracting entity and approved licence;
- the public repository, image namespace, production domain, and browser-store publisher;
- the stable extension ID and public manifest key;
- approved contributor, security, and moderation contacts.

These are release controls, not runtime configuration. Development and private evaluation do not depend on them.

## Candidate exercises

Before publishing a candidate, maintainers must:

- exercise guide, video, and combined capture with the signed extension, including permission loss, child-tab handoff, recovery, and server changes;
- test transcription, voiceover, and rendering through success, failure, retry, restart, and cache reuse;
- restore a realistic backup after rebuilding the deployment and compare database records and stored objects;
- scan and sign the final images and verify their SBOMs and provenance;
- complete a one-week private installation soak before opening the public beta.

Evidence must identify the candidate commit and immutable image digests. Upgrade testing from a previous beta begins once a previous beta exists.
