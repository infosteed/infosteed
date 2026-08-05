<div align="center">
  <img src="packages/shared/assets/infosteed-horse-logo.svg" alt="InfoSteed horse logo" width="112" />

# InfoSteed

**Record once. Teach everywhere.**

Turn a browser walkthrough into an editable step-by-step guide, a polished
video, or both—without handing your internal knowledge to another hosted
platform.

[![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-2563eb)](docs/deployment.md)
[![Chromium](https://img.shields.io/badge/browser-Chromium-4285f4)](apps/extension)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-0f766e)](LICENSE)
[![Status: public beta](https://img.shields.io/badge/status-public_beta-d97706)](docs/release-readiness.md)

[Why InfoSteed?](#why-infosteed) · [What you can create](#what-you-can-create) · [Explore the project](#explore-the-project)
</div>

## Show the work once

Most process documentation starts out of date. Someone performs the workflow,
then spends hours recreating it as screenshots, instructions, and a separate
training video. When the process changes, they do it all again.

InfoSteed captures the work while it happens. Your actions become synchronized
guide steps and video chapters, ready to review, improve, and share with the
people who need them.

| Record                                                              | Refine                                                            | Share                                                                            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Walk through a browser workflow with optional narration and webcam. | Edit the guide and video without changing the original recording. | Publish inside a project or export content for the tools your team already uses. |

## Why InfoSteed?

### One walkthrough, two useful formats

Create a visual guide for people who want to scan and a narrated video for
people who want to watch. Guide steps and video chapters stay connected to the
same captured actions, so you do not have to produce each format separately.

### Improve it without starting over

Rewrite instructions, adjust screenshots, trim video, rename chapters, edit
captions, balance audio, and add a generated voiceover. The original media stays
intact while you prepare and review a replacement.

### Keep operational knowledge under your control

InfoSteed is self-hosted. Recordings, screenshots, transcripts, and generated
media go to the server and storage you choose. No telemetry is enabled by
default, and language, transcription, and speech services can run locally, be
connected to a provider you trust, or remain disabled.

### Fit the way your team shares knowledge

Organize recordings in team projects, publish guides and videos, and export
portable Markdown, images, Sanity content, WebM, or MP4. Your documentation is
not trapped in a single viewing experience.

## What you can create

- **Employee onboarding** that shows new starters how work is really done.
- **Standard operating procedures** that are easier to follow and maintain.
- **Customer education** with both quick-reference guides and narrated demos.
- **Support answers** that replace repeated explanations with reusable content.
- **Internal system training** that stays on infrastructure your organization
  controls.

## Built for useful, maintainable content

- Choose a guide, a video, or both before recording.
- Capture tab audio, microphone narration, and an optional webcam bubble.
- Recover interrupted uploads instead of losing a long walkthrough.
- Edit guides, screenshots, captions, chapters, audio, and video
  non-destructively.
- Use deterministic local guide writing without configuring an AI service.
- Add optional local or hosted transcription, language-model, and speech
  services when they are valuable to your team.
- Protect access with project membership and optional administrator-enforced
  two-factor authentication.

## Self-hosted deployment

`v0.1.0-beta.4` is the current public prerelease, and `v0.1.0-beta.5` is in
development. Deployments keep recordings, screenshots, transcripts, and media
on infrastructure you control. Follow the [deployment guide](docs/deployment.md)
and review [release readiness](docs/release-readiness.md) before production use.

## Explore the project

InfoSteed is available as a public beta but should not yet be treated as a
supported production release. See the [release readiness page](docs/release-readiness.md)
for the current status.

- [See how InfoSteed is deployed](docs/deployment.md)
- [Understand privacy and data handling](docs/privacy-policy.md)
- [Review optional AI services](docs/ai-services.md)
- [Explore the architecture](docs/architecture.md)
- [Read the support policy](SUPPORT.md)
- [View the original technical README](README.technical.md)

## Licence

InfoSteed is licensed under the [GNU Affero General Public License v3.0](LICENSE).
If you make a modified version available to users over a network, those users
must be offered its corresponding source code as required by the licence.

Third-party components remain subject to their own licences; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Security reports and the
current contribution policy are covered in [SECURITY.md](SECURITY.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).
