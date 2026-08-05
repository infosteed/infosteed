# Privacy and data handling

This page describes the data handled by a standard InfoSteed deployment. If you operate InfoSteed for other people, publish a privacy notice that identifies your organization, contact details, InfoSteed domain, retention periods, external service providers, and the law that applies to your deployment.

The browser extension sends captured data only to the server that a user selects and approves. Depending on the chosen recording mode and the capabilities you enable, your server can receive page titles, sanitized URLs, interaction metadata, screenshots, video, tab audio, microphone audio, webcam video, transcripts, narration text, and generated speech.

A standard deployment also stores account and access information including usernames, display names, password hashes, roles, project membership, sessions, login-attempt records, and audit events that can include an IP address and user-agent string. When 2FA is used, TOTP secrets are encrypted with the deployment's backed-up encryption key; recovery codes and temporary continuation tokens are stored only as hashes. Pending continuation records also contain their purpose, expiry, and failed-attempt count. These authentication records stay within the deployment and are not sent to configured AI, transcription, or text-to-speech providers.

InfoSteed does not enable telemetry by default and does not require a hosted AI service. If you configure external S3-compatible storage, transcription, language-model, or text-to-speech services, tell your users which providers receive their data and link to those providers' data-handling terms.

The extension asks for access to the selected server and active recording tab only after a user action. Disconnecting a server clears the extension's cached authentication state. Account recovery can revoke all server-side sessions and remove 2FA credentials, recovery codes, and pending continuations. You control server-side retention and deletion through your deployment and its storage systems.

Tell your users how to request access, correction, export, or deletion of their data. Report security issues using the process in [`SECURITY.md`](../SECURITY.md), without attaching recorded content.
