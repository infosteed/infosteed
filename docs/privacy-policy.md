# Privacy notes

Before a public browser-store listing, maintainers must publish a policy naming the responsible legal entity, contact details, service domain, retention periods, and applicable jurisdiction. The product behavior that policy must cover is summarized below.

The browser extension sends captured data only to the server origin selected and approved by the user. The selected server can receive page titles and sanitized URLs, interaction metadata, screenshots, video, tab audio, microphone audio, webcam video, transcripts, narration text, and generated speech, depending on the capture choices and enabled server capabilities.

The project does not enable telemetry by default and does not require a hosted AI service. Administrators may configure external S3-compatible storage, transcription, language-model, or text-to-speech providers. When they do, the administrator is responsible for disclosing those processors and their data handling terms to users.

The extension requests access to the selected server and to the active recording tab only after a user action. Disconnecting a server clears cached authentication state in the extension. Server-side retention and deletion are controlled by the administrator.

Users should contact their server administrator to access, correct, export, or delete their data. Security reports must follow `SECURITY.md` and must not include recorded content.
