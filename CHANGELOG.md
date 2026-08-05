# Changelog

All notable changes are documented here. The project uses Semantic Versioning once a stable release exists.

## [Unreleased]

## [0.1.0-beta.6] - 2026-08-05

### Changed

- Improved narration rewriting so generated scripts flow coherently across timed cues and recover safely from altered cue structures.
- Improved standard and template-based Word exports with structured numbered headings and clearer template validation.
- Strengthened production deployment diagnostics, remote AI-service configuration, and HTTPS certificate verification.

## [0.1.0-beta.5] - 2026-08-05

This signed candidate was superseded before public publication. Its tag and published images remain immutable and must not be republished as the supported beta.

### Added

- Added administrator-managed Word `.docx` templates with upload validation, compatibility reporting, default-template selection, and localized management controls.
- Added template-based Word export that fills tagged content controls while preserving the template's cover, layout, styles, headers, footers, numbering, document properties, and table of contents.

### Changed

- Reworked the public README around product capabilities while retaining the detailed development and operations guide in `README.technical.md`.
- Reduced routine GitHub Actions work with selective integration checks, dependency and BuildKit caching, cancellation of superseded runs, weekly container security scans, and stricter release-time artifact reuse and verification.

## [0.1.0-beta.4] - 2026-08-05

### Added

- Added light, dark, and system-following themes, with each signed-in user's preference persisted across sessions.
- Added Irish, French, and German catalogs for the web application and Chromium extension, including localized deterministic and AI-generated guide text, transcript-informed chapter titles, and narration.
- Added a Wiziwig-compatible HTML ZIP export containing a pasteable, inline-styled guide fragment and its referenced images.

### Changed

- Stabilized the redesigned application shell, library, administration, recording workspace, guide editor, and video editor across desktop and responsive layouts.
- Improved recording routes and combined video-and-guide presentation, and added responsive guide-outline navigation with clearer reordering and editing controls.
- Added database migrations for persisted theme preferences and recording AI-output locales.
- Corrected release, deployment, security, privacy, translation, and architecture documentation and added automated release-metadata validation to CI and tagged releases.

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
