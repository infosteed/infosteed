# Security Policy

## Supported versions

`v0.1.0-beta.4` is InfoSteed's current public prerelease, and `v0.1.0-beta.6` is being prepared. Beta and untagged builds may contain breaking changes and receive no formal security-support commitment.

After the first public beta, security fixes will be provided for the latest published beta only. If you administer an InfoSteed deployment, subscribe to GitHub release notifications and take a verified backup before upgrading.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private vulnerability reporting. The project will publish an additional private reporting address before its first public release.

The project aims to acknowledge a report within 5 business days and provide a status update within 10 business days. Reports should include affected versions, reproduction steps, impact, and any suggested mitigation. Please avoid accessing data that is not yours and do not disrupt a deployment.

No public release will be published without an active private reporting channel and a named security contact.

## Scope

Security support covers the version-pinned Docker Compose deployment on Linux amd64. If you run a fork, unsupported architecture, development configuration, or external AI provider, you are responsible for securing and maintaining those changes.
