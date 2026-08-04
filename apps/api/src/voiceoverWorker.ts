// SPDX-License-Identifier: AGPL-3.0-only
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";
import type { ApiConfig } from "./config.js";
import type { Pool } from "./db.js";
import type { VideoStorage } from "./videoStorage.js";
import type { TtsProvider } from "./ttsProvider.js";
import {
  buildNormalizeVoiceoverArguments,
  buildVoiceoverTimelineArguments,
} from "./voiceoverAudio.js";
import {
  claimNextVoiceover,
  completeVoiceoverCue,
  completeVoiceoverGeneration,
  failVoiceoverCue,
  failVoiceoverGeneration,
  findVoiceoverClip,
  requeueStaleVoiceovers,
  saveVoiceoverClip,
  voiceoverOverlongByMs,
  type VoiceoverClipRow,
  type VoiceoverCueRow,
} from "./repositories/voiceovers.js";

function bodyStream(value: unknown): Readable {
  if (value instanceof Readable) return value;
  if (value && typeof value === "object" && Symbol.asyncIterator in value)
    return Readable.from(value as AsyncIterable<Uint8Array>);
  throw new Error("Object storage returned a non-streaming voiceover body");
}

function safeError(error: unknown): string {
  if (!(error instanceof Error))
    return "Voiceover generation could not be completed";
  if (error.name === "TimeoutError" || error.name === "AbortError")
    return "The local TTS provider timed out";
  const status = /TTS provider failed with (\d{3})/.exec(error.message)?.[1];
  if (status) return `The local TTS provider returned HTTP ${status}`;
  if (error.message.includes("selected voice")) return error.message;
  if (error.message.includes("configuration changed")) return error.message;
  return "Voiceover generation could not be completed";
}

async function run(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted)
        reject(
          Object.assign(new Error("Voiceover generation stopped"), {
            name: "AbortError",
          }),
        );
      else if (code === 0) resolve();
      else reject(new Error(stderr || `Media command exited with ${code}`));
    });
  });
}

async function probeDuration(
  command: string,
  filePath: string,
  timeoutMs: number,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        return reject(new Error(stderr || `FFprobe exited with ${code}`));
      const seconds = Number(
        (JSON.parse(stdout) as { format?: { duration?: string } }).format
          ?.duration,
      );
      if (!Number.isFinite(seconds) || seconds <= 0)
        return reject(new Error("Generated voiceover clip has no duration"));
      resolve(Math.round(seconds * 1000));
    });
  });
}

async function uploadBuffer(
  storage: VideoStorage,
  key: string,
  contentType: string,
  bytes: Buffer,
): Promise<void> {
  const uploadId = await storage.createMultipartUpload(key, contentType);
  try {
    const parts: Array<{ partNumber: number; etag: string }> = [];
    const partSize = 8 * 1024 * 1024;
    for (
      let offset = 0, partNumber = 1;
      offset < bytes.length;
      offset += partSize, partNumber += 1
    ) {
      const body = bytes.subarray(
        offset,
        Math.min(bytes.length, offset + partSize),
      );
      parts.push({
        partNumber,
        etag: await storage.uploadPart(key, uploadId, partNumber, body),
      });
    }
    await storage.completeMultipartUpload(key, uploadId, parts);
  } catch (error) {
    await storage.abortMultipartUpload(key, uploadId).catch(() => undefined);
    throw error;
  }
}

export class VoiceoverWorker {
  private stopped = false;
  private draining = false;
  private wakeRequested = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private controller: AbortController | undefined;
  private drainPromise: Promise<void> | undefined;

  constructor(
    private readonly config: ApiConfig,
    private readonly pool: Pool,
    private readonly storage: VideoStorage,
    private readonly provider: TtsProvider | undefined,
    private readonly log: {
      info(value: unknown, message: string): void;
      warn(value: unknown, message: string): void;
    },
  ) {}

  async start(): Promise<void> {
    if (!this.provider || !this.storage.enabled) return;
    const recovered = await requeueStaleVoiceovers(this.pool);
    if (recovered)
      this.log.info({ recovered }, "Requeued stale voiceover jobs");
    this.timer = setInterval(() => this.wake(), 15_000);
    this.timer.unref();
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    await this.drainPromise;
  }

  wake(): void {
    if (this.stopped || !this.provider || !this.storage.enabled) return;
    if (this.draining) {
      this.wakeRequested = true;
      return;
    }
    this.draining = true;
    this.drainPromise = this.drain().finally(() => {
      this.draining = false;
      this.drainPromise = undefined;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        this.wake();
      }
    });
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const job = await claimNextVoiceover(this.pool);
      if (!job) return;
      const controller = new AbortController();
      this.controller = controller;
      let activeCue: VoiceoverCueRow | undefined;
      try {
        if (
          job.generation.provider !== this.provider?.id ||
          job.generation.model !== this.provider.model
        ) {
          throw new Error(
            "The TTS provider configuration changed; request a new voiceover generation",
          );
        }
        const workDir = await mkdtemp(
          path.join(
            this.config.TTS_TEMP_DIR ?? tmpdir(),
            `${PRODUCT_IDENTIFIERS.tempPrefix}voiceover-`,
          ),
        );
        try {
          const timelineClips: Array<{ path: string; sourceStartMs: number }> =
            [];
          for (const cue of job.cues) {
            activeCue = cue;
            if (this.stopped)
              throw Object.assign(new Error("Stopped"), { name: "AbortError" });
            let clip: VoiceoverClipRow | null = await findVoiceoverClip(
              this.pool,
              cue.content_hash,
            );
            const clipPath = path.join(workDir, `${cue.ordinal}.wav`);
            if (clip) {
              const object = await this.storage.getObject(clip.storage_key);
              await pipeline(
                bodyStream(object.body),
                createWriteStream(clipPath),
              );
            } else {
              const providerBytes = await this.provider.synthesize({
                text: cue.text,
                voice: job.generation.voice,
                speed: job.generation.speed,
                signal: controller.signal,
              });
              const providerPath = path.join(
                workDir,
                `${cue.ordinal}-provider-audio`,
              );
              await writeFile(providerPath, providerBytes);
              await run(
                this.config.TTS_FFMPEG_PATH,
                buildNormalizeVoiceoverArguments(providerPath, clipPath),
                this.config.TTS_TIMEOUT_MS,
                controller.signal,
              );
              const durationMs = await probeDuration(
                this.config.TTS_FFPROBE_PATH,
                clipPath,
                this.config.TTS_TIMEOUT_MS,
              );
              const normalized = await readFile(clipPath);
              const storageKey = `voiceovers/cache/${cue.content_hash}.wav`;
              await uploadBuffer(
                this.storage,
                storageKey,
                "audio/wav",
                normalized,
              );
              clip = await saveVoiceoverClip(this.pool, {
                hash: cue.content_hash,
                provider: job.generation.provider,
                model: job.generation.model,
                voice: job.generation.voice,
                speed: job.generation.speed,
                text: cue.text,
                storageKey,
                byteSize: normalized.byteLength,
                durationMs,
              });
            }
            await completeVoiceoverCue(
              this.pool,
              job.generation.id,
              cue.cue_id,
              clip,
              voiceoverOverlongByMs(
                clip.duration_ms,
                cue.source_start_ms,
                cue.source_end_ms,
              ),
            );
            timelineClips.push({
              path: clipPath,
              sourceStartMs: cue.source_start_ms,
            });
            activeCue = undefined;
          }
          const timelinePath = path.join(workDir, "voiceover.wav");
          await run(
            this.config.TTS_FFMPEG_PATH,
            buildVoiceoverTimelineArguments(
              job.generation.source_duration_ms,
              timelineClips,
              timelinePath,
            ),
            this.config.TTS_TIMEOUT_MS * Math.max(1, timelineClips.length),
            controller.signal,
          );
          const durationMs = await probeDuration(
            this.config.TTS_FFPROBE_PATH,
            timelinePath,
            this.config.TTS_TIMEOUT_MS,
          );
          const timeline = await readFile(timelinePath);
          const storageKey = `videos/${job.generation.recording_id}/voiceovers/${job.generation.id}.wav`;
          await uploadBuffer(this.storage, storageKey, "audio/wav", timeline);
          await completeVoiceoverGeneration(this.pool, {
            generationId: job.generation.id,
            storageKey,
            byteSize: (await stat(timelinePath)).size,
            durationMs,
          });
          this.log.info(
            { generationId: job.generation.id },
            "Voiceover generation completed",
          );
        } finally {
          await rm(workDir, { recursive: true, force: true });
        }
      } catch (error) {
        if (!this.stopped) {
          const message = safeError(error);
          if (activeCue)
            await failVoiceoverCue(
              this.pool,
              job.generation.id,
              activeCue.cue_id,
              message,
            ).catch(() => undefined);
          await failVoiceoverGeneration(
            this.pool,
            job.generation.id,
            message,
          ).catch(() => undefined);
          this.log.warn(
            { error, generationId: job.generation.id },
            "Voiceover generation failed",
          );
        }
      } finally {
        this.controller = undefined;
      }
    }
  }
}
