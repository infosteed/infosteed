# Support Policy

`v0.1.0-beta.13` is an unpublished InfoSteed release candidate. Beta.12 and earlier beta tags were superseded without public publication. Private candidate evaluation is best-effort and is not a production support commitment.

After publication, the supported deployment will be the production Docker Compose bundle on Linux amd64 using its pinned container versions. The latest published beta will receive security and data-loss fixes; older published betas will be supported only long enough to perform the documented backup and forward upgrade.

Community support is provided through public GitHub issues after publication. Include the application version, release commit, sanitized Compose configuration, relevant structured logs, and reproduction steps. Never attach recordings, speech text, media URLs, tokens, passwords, private hostnames, or database dumps.

The following are not supported by default: Kubernetes, high availability, arm64, modified production images, third-party browser builds, externally managed AI providers, and non-S3 object stores. The documented production source-build overlay is supported when built from a clean official release tag; other direct source installations remain the administrator's responsibility.

Security reports follow `SECURITY.md`. Commercial support terms are not published in this repository; see `COMMERCIAL-LICENSE.md`.
