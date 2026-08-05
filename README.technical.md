# InfoSteed

InfoSteed is a self-hosted browser recorder for teams that need to keep workflow documentation and source media under their own control. A Chromium extension captures the work; the web application turns it into an editable guide, a video, or both.

## What it does

- Choose Video + Guide (default), Video Only, or Guide Only from the extension setup page.
- Capture active-tab video and audio with microphone narration and an optional webcam bubble.
- Follow app-created child tabs. Guide Only switches automatically; video modes show an extension badge and continue after the user clicks **Follow this tab**, as required by Chrome's per-tab capture grant.
- Pause/resume, upload crash-resistant WebM chunks, recover interrupted uploads, preview, publish, and share within a project.
- Capture one or more click actions from the active tab.
- Capture a visible-tab screenshot for each click.
- Upload events and screenshots to a Fastify API backed by PostgreSQL.
- Generate local guide instructions without an AI key.
- Preview and edit generated steps in a React web editor.
- Export a ZIP containing `guide.md`, `recording.json`, and local WebP images.
- Export a Sanity CLI-compatible `.tar.gz` containing a Portable Text guide and its referenced images.
- Transcribe narration asynchronously with a local or hosted OpenAI-compatible Whisper endpoint, add captions, and use nearby speech to improve synchronized chapter and guide titles.
- Edit video non-destructively with source-clock cuts, independent chapters and captions, webcam layout, audio levels, durable preview renders, and explicit replacement publishing.
- Build editable narration from captions (or rewrite it with a configured local language model), synthesize it cue-by-cue with a local OpenAI-compatible TTS service, and mix it into rendered videos.
- Protect accounts with optional TOTP two-factor authentication, one-time recovery codes, and administrator-enforced enrollment.
- Localize the web application and extension through validated JSON catalogs with plural and right-to-left support.

See [Sanity import setup](docs/sanity/README.md) for the one-time Studio schema installation and import commands.

## Local Development

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d
export S3_ENDPOINT=http://localhost:59000 S3_BUCKET=infosteed-videos
export S3_ACCESS_KEY_ID=infosteed S3_SECRET_ACCESS_KEY=infosteed-video-secret
pnpm dev:api
pnpm --filter @infosteed/video-render-worker dev
pnpm dev:web
pnpm dev:extension
```

Load `apps/extension/dist` as an unpacked extension in Chromium after running the extension build or dev task.

## Self-hosted deployment

`v0.1.0-beta.4` is the current public prerelease, and `v0.1.0-beta.5` is being prepared. Beta builds are intended for evaluation and are not a production support commitment.

Use the supported local and production instructions in [docs/deployment.md](docs/deployment.md). Production uses Caddy-managed public or internal HTTPS, versioned GHCR images by default, an equivalent source-build fallback, internal-only application data services, and a mandatory 32-byte first-admin setup token. Ollama, Whisper, and Kokoro can each be managed locally, connected externally, or disabled; see [AI services](docs/ai-services.md). Back up before every upgrade using [docs/backup-and-upgrade.md](docs/backup-and-upgrade.md).

Connect the extension to your server from its Options page. The extension requests access only to that origin, verifies `/api/system/info` and protocol compatibility, and injects the recorder only after you start a recording. See [Privacy and data handling](docs/privacy-policy.md).

### Local Docker Compose

The root compose file runs PostgreSQL, MinIO object storage, the Fastify API, and the built React web UI behind nginx.

```bash
cp docker.env.example .env.docker
# edit .env.docker, especially database/object-storage passwords and WEB_ORIGIN
docker compose --env-file .env.docker up -d --build
```

Open `http://localhost:8080` by default. On first run, the app asks for the `SETUP_TOKEN` from the deployment environment before creating the first administrator.

The web container proxies API paths to the API container, so the browser normally uses same-origin relative API calls. For a reverse proxy or HTTPS deployment, set:

```text
WEB_ORIGIN=https://your-infosteed-host.example
COOKIE_SECURE=true
```

For Ollama running on the Docker host, use `host.docker.internal`:

```text
AI_PROVIDER=openai-compatible
AI_ENDPOINT=http://host.docker.internal:11434/v1
AI_MODEL=qwen3-vl:8b
AI_API_KEY=
```

Persistent data lives in the `infosteed-postgres` and `infosteed-minio` Docker volumes. External S3-compatible services can replace MinIO by setting the `S3_*` variables. When S3 is not configured, the API advertises video as unavailable and the extension keeps Guide Only enabled.

## Environment

The API defaults are suitable for local development:

```text
DATABASE_URL=postgres://infosteed:infosteed@localhost:54329/infosteed
PORT=3777
AI_ENDPOINT=
AI_API_KEY=
AI_MODEL=
S3_ENDPOINT=http://localhost:59000
S3_BUCKET=infosteed-videos
S3_ACCESS_KEY_ID=infosteed
S3_SECRET_ACCESS_KEY=infosteed-video-secret
```

When no AI endpoint/key is configured, InfoSteed uses deterministic local step writing.

## Video Transcription

InfoSteed talks directly to any OpenAI-compatible transcription endpoint. For the bundled local provider, install its small API layer into the existing environment and start one worker:

```bash
whisper/.venv-stt/bin/pip install -r whisper/requirements.txt
whisper/start-api.sh
```

Then configure the API:

```text
TRANSCRIPTION_PROVIDER=openai-compatible
TRANSCRIPTION_ENDPOINT=http://127.0.0.1:8787/v1
TRANSCRIPTION_API_KEY=
TRANSCRIPTION_MODEL=large-v3-turbo
TRANSCRIPTION_TIMEOUT_MS=5400000
TRANSCRIPTION_MAX_UPLOAD_BYTES=25000000
```

The local service defaults to CUDA `int8_float16` when a GPU is available and CPU `int8` otherwise. It automatically detects the spoken language and retains word and segment timestamps. Set `WHISPER_API_TOKEN` and the matching `TRANSCRIPTION_API_KEY` to protect it. Set `WHISPER_PRELOAD=true` to load the model at startup. Model files use `WHISPER_MODEL_CACHE` or the Hugging Face cache.

For Docker, enable the optional GPU service and point the API at its internal address:

```bash
TRANSCRIPTION_ENDPOINT=http://transcription:8787/v1 docker compose --profile transcription up -d --build
```

The container does not publish port 8787. Add an explicit port mapping only for local debugging. To switch to a hosted service, change only `TRANSCRIPTION_ENDPOINT`, `TRANSCRIPTION_API_KEY`, `TRANSCRIPTION_MODEL`, and, when required, `TRANSCRIPTION_MAX_UPLOAD_BYTES`. Video playback and publishing continue when transcription is disabled or fails.

## Video Editing and Rendering

Video Only and Video + Guide recordings have a separate **Edit video** workspace. The editor autosaves a non-destructive recipe while the original composite and raw tracks remain unchanged. A published video stays live while an editor creates and reviews a replacement. Only **Publish changes** switches project viewers to the completed candidate.

For native development, install FFmpeg and FFprobe, keep the same `DATABASE_URL` and `S3_*` settings used by the API in `.env`, and start the durable worker:

```bash
sudo apt-get install ffmpeg
corepack pnpm --filter @infosteed/video-render-worker dev
```

The root Compose deployment starts `video-render-worker` automatically. It renders one VP9/Opus WebM at a time by default. Configure it with:

```text
VIDEO_RENDER_ENABLED=true
VIDEO_RENDER_CONCURRENCY=1
VIDEO_RENDER_FFMPEG_PATH=ffmpeg
VIDEO_RENDER_FFPROBE_PATH=ffprobe
VIDEO_RENDER_TEMP_DIR=
VIDEO_RENDER_TIMEOUT_MS=14400000
VIDEO_RENDER_STALE_MS=300000
VIDEO_RENDER_RETENTION_DAYS=7
```

The worker may run on another host as long as it can reach PostgreSQL and the configured S3-compatible bucket. Raw sources and recipe history remain until the recording is deleted. Superseded rendered objects are cleaned after the retention window and can be recreated from their saved recipe.

Ready renders keep WebM as their preview and publication format. Editors can choose **Create MP4** to queue an on-demand H.264/AAC download. The worker caches one MP4 per render, reports conversion progress in the editor, and removes the cached file with its parent render or recording.

## Local voiceovers

The video editor's **AI voiceover** panel starts with the current edited captions. Editors can use them verbatim or choose **Rewrite with local model** to turn terse captions into cue-aligned narration. Script rewriting uses the configured `AI_*` Ollama/OpenAI-compatible endpoint and has a separate `AI_SCRIPT_TIMEOUT_MS` limit (five minutes by default) because rewriting a complete caption track takes longer than generating one guide step. Every cue remains editable before speech generation.

Speech generation uses a provider-neutral OpenAI-compatible `/v1/audio/speech` client. The optional Compose profile runs the CPU Kokoro-FastAPI image pinned to `v0.2.4`:

```bash
cp docker.env.example .env.docker
# Set TTS_BASE_URL=http://kokoro:8880/v1 in .env.docker
docker compose --env-file .env.docker --profile voiceover up -d --build
```

For native development, start the profile in `infra/docker-compose.yml` and configure:

```bash
docker compose -f infra/docker-compose.yml --profile voiceover up -d
# .env
TTS_BASE_URL=http://127.0.0.1:58880/v1
TTS_MODEL=kokoro
TTS_DEFAULT_VOICE=af_heart
TTS_VOICES=af_heart,af_bella,af_nicole,am_adam,am_michael,bf_emma,bm_george
```

`TTS_VOICES` is the server-side allow-list shown in the editor. Only stock installed voices are supported; InfoSteed does not upload, train, combine, or clone voices. `TTS_API_KEY`, `TTS_TIMEOUT_MS`, `TTS_MAX_RESPONSE_BYTES`, `TTS_FFMPEG_PATH`, `TTS_FFPROBE_PATH`, and `TTS_TEMP_DIR` are also configurable. Another OpenAI-compatible provider can be used by changing `TTS_BASE_URL`, `TTS_MODEL`, and the voice list.

Generation is a durable PostgreSQL job. It synthesizes and normalizes each cue to mono 24 kHz PCM WAV, caches clips by provider/model/voice/speed/text hash, probes real durations, and assembles a source-clock track with silence between cues. Unchanged cues reuse their cached clip. Speech is not clipped to a cue; overlong cues are reported in the editor and may overlap subsequent narration. The render worker applies the same keep-range cuts to the voiceover as video, tab audio, and microphone audio, then mixes all enabled inputs through the existing limiter.

InfoSteed does not automatically lower tab audio beneath narration. Editors set tab, microphone, and voiceover levels independently.

Kokoro-FastAPI and Kokoro-82M are separate Apache-2.0 projects; review their upstream notices and the terms of any alternative model or voice pack before deployment. The pinned image includes stock model assets and is not part of InfoSteed. See [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) and [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).

## Ollama AI

For local Ollama with the OpenAI-compatible API, use:

```text
AI_ENDPOINT=http://127.0.0.1:11434/v1
AI_MODEL=qwen3-vl:8b
AI_API_KEY=
AI_TIMEOUT_MS=30000
AI_SCRIPT_TIMEOUT_MS=300000
```

The API calls `/chat/completions` and validates the returned JSON with Zod. If Ollama is unavailable, the model is missing, the request times out, or the response is invalid, guide generation falls back to deterministic local instructions.

`qwen3-vl:8b` can spend tens of seconds loading on first use. For reliable AI output, keep the model warm before recording:

```bash
curl -s http://127.0.0.1:11434/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"qwen3-vl:8b","stream":false,"max_tokens":32,"messages":[{"role":"user","content":"/no_think\nReply with: ok"}]}'
```

## Translations

The web app and extension use contributor-friendly JSON catalogs, automatic
browser-language matching, English fallback, plural rules, and right-to-left
document direction. English, Irish, French, and German catalogs are bundled.
See [Translating InfoSteed](docs/translating.md) to add a language and validate
its placeholders and coverage.

## License

InfoSteed is licensed under the [GNU Affero General Public License v3.0](LICENSE). If you modify the software and make that modified version available to users over a network, those users must be offered the corresponding source code as required by the licence.

Third-party components remain subject to their own licences; see the generated [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Security reports, support scope, contribution restrictions, and the release process are documented in [SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [docs/release-process.md](docs/release-process.md).
