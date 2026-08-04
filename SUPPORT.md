# Support Policy

The supported beta deployment is the production Docker Compose bundle on Linux amd64, using its pinned container versions. The latest beta receives security and data-loss fixes. Older betas are supported only long enough to perform the documented backup and forward upgrade.

Community support is provided through public GitHub issues after publication. Include the application version, release commit, sanitized Compose configuration, relevant structured logs, and reproduction steps. Never attach recordings, speech text, media URLs, tokens, passwords, private hostnames, or database dumps.

The following are not supported by default: Kubernetes, high availability, arm64, direct source installations in production, modified images, third-party browser builds, externally managed AI providers, and non-S3 object stores. They may work but are the administrator's responsibility.

Security reports follow `SECURITY.md`. Commercial support terms are not published in this repository; see `COMMERCIAL-LICENSE.md`.
