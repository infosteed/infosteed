# Architecture Summary

InfoSteed records sanitized browser actions and optional active-tab video in a Chromium Manifest V3 extension. PostgreSQL stores structured content and video metadata; S3-compatible object storage holds WebM media.

The design keeps the core path local and deterministic. AI generation is optional through an OpenAI-compatible provider interface. If the provider is absent or fails validation, deterministic instructions are used.

## Repository Tree

```text
apps/
  extension/           Chromium MV3 recorder and popup controls
  api/                 Fastify API, migration runner, pg repositories
  web/                 React guide editor and Markdown preview
packages/
  shared/              Zod schemas and shared DTOs
  recorder-core/       Event normalization, element naming, privacy helpers
  ai-step-writer/      Provider interface, AI schema validation, fallback writer
  markdown-exporter/   Markdown and ZIP export validation/generation
  image-processor/     Sharp WebP conversion and target annotation helpers
migrations/            Ordered SQL migrations
infra/                 Docker Compose for PostgreSQL and MinIO
docs/                  Architecture, permissions, threat model, acceptance tests
tests/e2e/             Playwright vertical-slice test
```

## Database Schema

The schema uses direct SQL through `pg`, explicit parameters, foreign keys, indexes, and JSONB only for flexible metadata.

```text
schema_migrations(version primary key, applied_at)
recordings(id, title, purpose, audience, capture_mode, state, created_at, updated_at, finalized_at)
recording_events(id, recording_id, ordinal, action_type, page_title, sanitized_url, video_offset_ms, element metadata, bounding_box jsonb, metadata jsonb, created_at)
screenshots(id, recording_id, event_id, filename, content_type, byte_size, original_image, annotated_image, target_box jsonb, created_at)
guide_steps(id, recording_id, event_id, ordinal, title, instruction, image_filename, alt_text, source, user_edited, created_at, updated_at)
recording_videos(id, recording_id, status, duration_ms, capture_settings, publish/recovery metadata, transcription status)
recording_video_assets(id, video_id, kind, codec, storage_key, multipart metadata, status)
recording_video_parts(asset_id, part_number, etag, byte_size, timing metadata)
recording_video_transcripts(video_id, provider-neutral text, language, duration, segments jsonb, words jsonb)
recording_video_chapter_titles(video_id, event_id, generated title, source)
recording_voiceover_generations(id, video_id, status, provider/model/voice/speed, hashes, asset reference, retry metadata)
recording_voiceover_generation_cues(generation_id, cue id/timing/text/hash, cached clip reference, duration, overlong/error state)
recording_voiceover_clips(id, content_hash, provider/model/voice/speed/text, storage key, probed duration)
```

## Extension Permission List

- `activeTab`: capture screenshots of the active tab only while the user is recording.
- `tabs`: read the active tab title and URL context.
- `scripting`: inject the content recorder into pages.
- `storage`: keep local recording state and API base URL.
- `tabCapture`: obtain a user-initiated stream for the selected active tab.
- `offscreen`: keep MediaRecorder, canvas composition, audio mixing, and uploads outside the MV3 service worker.
- `webNavigation`: associate app-created tabs and windows with the recorded source tab.
- Optional host permission requested only for the administrator-selected HTTPS origin, with HTTP permitted only on localhost.

The extension does not request cookie, history, downloads, bookmarks, webRequest, or browser storage permissions.

Video is recorded as a composite WebM plus clean-screen and enabled camera/microphone raw tracks. When audio is enabled, an additional 48 kbps Opus WebM track contains microphone narration or, when no microphone is selected, tab audio. The offscreen document mixes microphone and tab audio, reconnects captured tab audio to local output, composites the webcam only into recorded output, and uploads approximately 8 MiB multipart parts. User actions carry pause-adjusted offsets so chapters and guide steps stay synchronized.

Video finalization queues transcription in PostgreSQL without delaying playback. One API worker claims jobs atomically and streams the compact audio asset, or an older microphone/composite fallback, to a provider-neutral adapter. The first adapter uses the OpenAI-compatible `/audio/transcriptions` multipart contract. Normalized text, language, segments, and words are stored in PostgreSQL; provider responses are not exposed to the rest of the product. The optional FastAPI service in `whisper/` is one compatible provider and can be replaced by a hosted endpoint through configuration.

Video editing stores an autosaved source-clock recipe rather than modifying media. Immutable edit versions snapshot keep ranges, webcam layout, tab/microphone gains, chapter overrides, and transcript-backed or manual captions. A separate render worker claims PostgreSQL jobs with row locking, downloads immutable raw assets, renders VP9/Opus WebM through FFmpeg, validates it with FFprobe, and uploads the result to object storage. Publication atomically changes the selected edit version, so an existing published render remains available throughout editing and rendering. Metadata-only versions reuse existing media by hash. Edited chapters and WebVTT captions use the same source-to-output time mapping as FFmpeg cuts.

Voiceover generation follows the transcription job pattern inside the API process. The OpenAI-compatible TTS adapter receives one bounded script cue at a time. Normalized WAV clips are content-addressed by provider, model, stock voice, speed, and normalized text; unchanged cues therefore survive regeneration. FFprobe records each real duration and overlong cues remain untrimmed and visible as warnings. FFmpeg assembles the cached clips against source timestamps with silence between cues. The edit recipe references the ready voiceover asset and its generation, and the render worker mixes it as an optional third audio source before applying the same source-clock keep ranges. The provider adapter is independent of Kokoro-FastAPI so additional adapters can be added without changing persistence or rendering.

App-created child tabs are tracked as a parent/child trail. Guide Only follows an active HTTP(S) child automatically. Chrome grants `tabCapture` access per tab after a user invokes the extension, so Video Only and Video + Guide mark a detected child with an extension badge; the user clicks the extension in that tab and chooses **Follow this tab**. The offscreen recorder then replaces its tab input while retaining stable canvas and mixed-audio output tracks, keeping MediaRecorder, upload parts, elapsed time, microphone, and webcam continuous. Closing the child returns capture to the most recent open parent tab.

## Threat Model Summary

- Sensitive values are redacted in the content script and validated again by shared schemas.
- Password, token, cookie, payment-card, private-key, API-key, hidden field, local path, and browser storage values are never captured.
- Ordinary input values are represented as categories such as `<username>` instead of literal values.
- URLs are sanitized before persistence by removing credentials, hashes, and query strings.
- Webpage text is treated as untrusted. The AI provider receives only bounded, sanitized step context, never full DOM dumps.
- Exports are validated so Markdown image references cannot point to remote URLs, extension URLs, blob URLs, or data URLs.
- The backend uses parameterized SQL only and transactions for multi-step writes.

## Vertical-Slice Acceptance Tests

1. Start a recording from the extension popup.
2. Click a visible button in a test page.
3. Confirm the content script emits one meaningful click step with accessible element metadata.
4. Confirm the background worker captures a screenshot and posts event plus screenshot to the API.
5. Finalize the recording and generate a deterministic instruction.
6. Open the web editor and confirm the generated step is editable.
7. Export a ZIP.
8. Extract the ZIP and confirm it contains:
   - `workflow-guide/guide.md`
   - `workflow-guide/recording.json`
   - `workflow-guide/images/<deterministic-step-file>.webp`
9. Confirm `guide.md` references only `./images/...`.
10. Confirm no image reference contains `http://`, `https://`, `s3://`, `blob:`, `data:`, or `chrome-extension:`.

Sanity exports use a separate gzip-compressed tar archive containing `data.ndjson` and only the local WebP images
referenced by the guide. The NDJSON document uses Portable Text plus structured workflow-step and callout blocks; the
Sanity CLI resolves each local `_sanityAsset` directive during dataset import.
