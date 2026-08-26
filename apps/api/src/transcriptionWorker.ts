// SPDX-License-Identifier: AGPL-3.0-only
import {
  writeChapter,
  type AiStepWriterProvider,
} from "@infosteed/ai-step-writer";
import type { Pool } from "./db.js";
import { withTransaction } from "./db.js";
import { generateGuideSteps } from "./guideGeneration.js";
import { getRecording } from "./repositories/recordings.js";
import {
  claimNextTranscription,
  completeTranscription,
  failTranscription,
  requeueStaleTranscriptions,
  upsertVideoChapterTitle,
  type TranscriptionJob,
} from "./repositories/videos.js";
import {
  buildGuideVersionSnapshot,
  createGuideVersion,
} from "./repositories/versions.js";
import {
  buildTranscriptCues,
  buildTranscriptionPrompt,
  transcriptAround,
} from "./transcriptContext.js";
import type { TranscriptionProvider } from "./transcriptionProvider.js";
import type { VideoStorage } from "./videoStorage.js";

function audioBody(value: unknown): AsyncIterable<Uint8Array> {
  if (value && typeof value === "object" && Symbol.asyncIterator in value) {
    return value as AsyncIterable<Uint8Array>;
  }
  throw new Error("Object storage returned a non-streaming audio body");
}

function safeTranscriptionError(error: unknown): string {
  if (!(error instanceof Error)) return "Transcription could not be completed";
  if (error.message.startsWith("Audio asset is ")) return error.message;
  if (error.name === "AbortError")
    return "The transcription provider timed out";
  const providerStatus = /Transcription provider failed with (\d{3})/.exec(
    error.message,
  )?.[1];
  if (providerStatus)
    return `The transcription provider returned HTTP ${providerStatus}`;
  if (error.name === "ZodError")
    return "The transcription provider returned malformed transcript data";
  if (error.message === "No completed audio asset is available")
    return error.message;
  return "Transcription could not be completed";
}

export class TranscriptionWorker {
  private draining = false;
  private wakeRequested = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active = new Map<string, AbortController>();
  private cancelled = new Set<string>();
  private drainPromise: Promise<void> | undefined;

  constructor(
    private readonly pool: Pool,
    private readonly storage: VideoStorage,
    private readonly transcriptionProvider: TranscriptionProvider | undefined,
    private readonly guideProvider: AiStepWriterProvider | undefined,
    private readonly log: {
      info(value: unknown, message: string): void;
      warn(value: unknown, message: string): void;
    },
  ) {}

  async start(): Promise<void> {
    if (!this.transcriptionProvider) return;
    const recovered = await requeueStaleTranscriptions(this.pool);
    if (recovered)
      this.log.info({ recovered }, "Requeued stale transcription jobs");
    this.timer = setInterval(() => this.wake(), 30_000);
    this.timer.unref();
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort();
    await this.drainPromise;
  }

  cancel(recordingId: string): void {
    this.cancelled.add(recordingId);
    this.active.get(recordingId)?.abort();
  }

  wake(): void {
    if (this.stopped || !this.transcriptionProvider) return;
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
      const job = await claimNextTranscription(this.pool);
      if (!job) return;
      await this.process(job);
    }
  }

  private async process(job: TranscriptionJob): Promise<void> {
    const provider = this.transcriptionProvider;
    if (!provider) return;
    const controller = new AbortController();
    this.active.set(job.recordingId, controller);
    try {
      if (this.cancelled.has(job.recordingId)) return;
      if (Number(job.sourceAsset.byte_size) > provider.maxUploadBytes) {
        throw new Error(
          `Audio asset is ${job.sourceAsset.byte_size} bytes; provider limit is ${provider.maxUploadBytes} bytes. ` +
            "Record with the compact transcription track or increase TRANSCRIPTION_MAX_UPLOAD_BYTES.",
        );
      }
      const recording = await getRecording(this.pool, job.recordingId);
      if (!recording)
        throw new Error("Recording was deleted before transcription started");
      const transcript = await provider.transcribe({
        openAudio: async () =>
          audioBody(
            (await this.storage.getObject(job.sourceAsset.storage_key)).body,
          ),
        byteSize: Number(job.sourceAsset.byte_size),
        filename: `infosteed-${job.recordingId}.${job.sourceAsset.mime_type.includes("webm") ? "webm" : "audio"}`,
        contentType: job.sourceAsset.mime_type,
        model: provider.model,
        prompt: buildTranscriptionPrompt(recording),
        signal: controller.signal,
      });
      const transcriptCues = buildTranscriptCues(
        transcript.segments,
        transcript.words,
      );

      if (recording.captureMode === "video") {
        for (let index = 0; index < recording.events.length; index += 1) {
          const current = recording.events[index];
          const generated = await writeChapter(this.guideProvider, {
            outputLocale: job.outputLocale,
            recordingTitle: recording.title,
            workflowPurpose: recording.purpose,
            audience: recording.audience,
            current,
            previous: recording.events[index - 1],
            next: recording.events[index + 1],
            ...transcriptAround(transcriptCues, current.videoOffsetMs),
          });
          await upsertVideoChapterTitle(this.pool, {
            videoId: job.videoId,
            eventId: current.id,
            title: generated.title,
            source: generated.source,
          });
        }
      } else if (recording.captureMode === "both") {
        await withTransaction(this.pool, async (client) => {
          const latest = await getRecording(client, job.recordingId);
          if (latest)
            await generateGuideSteps(
              client,
              latest,
              this.guideProvider,
              false,
              transcriptCues,
              job.outputLocale,
              latest.items.length === 0 ? "overwrite" : "fill",
              {
                cleanupMode: "new-capture-cleanup",
                logger: this.log,
              },
            );
        });
        if (job.createdByUserId) {
          const snapshot = await buildGuideVersionSnapshot(
            this.pool,
            job.recordingId,
          );
          await createGuideVersion(this.pool, {
            recordingId: job.recordingId,
            userId: job.createdByUserId,
            versionType: "auto",
            message: "Transcript-aware guide generation",
            snapshot,
            coalesceAuto: true,
          });
        }
      }

      await completeTranscription(this.pool, {
        job,
        model: provider.model,
        language: transcript.language,
        languageProbability: transcript.languageProbability,
        durationMs: transcript.durationMs,
        text: transcript.text,
        segments: transcript.segments,
        words: transcript.words,
      });
      this.log.info(
        { recordingId: job.recordingId },
        "Video transcription completed",
      );
    } catch (error) {
      if (this.stopped || this.cancelled.has(job.recordingId)) return;
      const message = safeTranscriptionError(error);
      try {
        const recording = await getRecording(this.pool, job.recordingId);
        if (recording?.captureMode === "both" && recording.items.length === 0) {
          await withTransaction(this.pool, async (client) => {
            const latest = await getRecording(client, job.recordingId);
            if (latest)
              await generateGuideSteps(
                client,
                latest,
                this.guideProvider,
                false,
                [],
                job.outputLocale,
                latest.items.length === 0 ? "overwrite" : "fill",
                {
                  cleanupMode: "new-capture-cleanup",
                  logger: this.log,
                },
              );
          });
        }
      } catch (guideError) {
        this.log.warn(
          { error: guideError, recordingId: job.recordingId },
          "Fallback guide generation failed",
        );
      }
      await failTranscription(this.pool, job.recordingId, message).catch(
        () => undefined,
      );
      this.log.warn(
        { error, recordingId: job.recordingId },
        "Video transcription failed",
      );
    } finally {
      this.active.delete(job.recordingId);
      this.cancelled.delete(job.recordingId);
    }
  }
}
