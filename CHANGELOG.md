# Changelog

All notable changes are documented here. The project uses Semantic Versioning once a stable release exists.

## [Unreleased]

## [0.1.0-beta.4] - Unreleased

### Changed

- Stabilized the redesigned application shell, recording workspace, guide editor, and video editor across desktop and responsive layouts.
- Corrected release, deployment, security, privacy, and architecture documentation and added automated release-metadata validation.

## [0.1.0-beta.3] - 2026-08-04

This signed candidate was superseded before public publication. Its tag and published images remain immutable; its stale draft artifacts must not be published as the supported beta.

### Added

- Added optional TOTP two-factor authentication with enforced enrollment, one-time recovery codes, self-service management, administrator reset, and an operator recovery command.
- Added shared JSON-catalog localization for the web application and Chromium extension, including locale persistence, plural rules, and right-to-left document direction.

### Changed

- Redesigned the web application shell, library, administration, guide, recording, and video-editing experiences with Tailwind, shadcn, and Radix primitives.
- Updated third-party notices for the redesigned frontend dependencies.
- Hardened beta.3 deployment and secret checks.

## [0.1.0-beta.2] - 2026-08-04

This signed deployment-reliability candidate was not publicly published.

### Changed

- Fixed hardened PostgreSQL and MinIO initialization on clean production hosts.
- Added public and private-CA HTTPS modes without requiring tracked-file edits.
- Added independently managed, external, or disabled Ollama, Whisper, and Kokoro services.
- Added transactional AI configuration, split-host installation, diagnostics, and beta.1 migration guidance.

## [0.1.0-beta.1] - 2026-08-04

This signed initial candidate was not publicly published. See the [official release status](docs/release-readiness.md) for current availability.
