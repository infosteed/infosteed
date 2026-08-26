// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { RecordingProject } from "@infosteed/shared";
import { importedRasterToWebp } from "@infosteed/image-processor";
import type { ApiConfig } from "./config.js";
import type { Pool } from "./db.js";
import { withTransaction } from "./db.js";
import { importRecordingProject } from "./repositories/recordings.js";
import { writeAuditEvent } from "./repositories/auth.js";
import {
  claimNextScribeImportWork,
  cleanupExpiredScribeImports,
  completeScribeImportAsset,
  completeScribeImportJob,
  downloadedScribeImportBytes,
  failScribeImportAsset,
  failScribeImportJob,
  listScribeImportAssets,
  retryScribeImportAsset,
  type ScribeImportAssetRow,
  type ScribeImportJobRow,
} from "./repositories/scribeImports.js";
import { parseScribeMarkdown } from "./scribeMarkdown.js";
import {
  downloadRemoteImage,
  RemoteImageDownloadError,
} from "./remoteImageDownloader.js";

const WORKER_LOCK = 748394024;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeError(error: unknown): string {
  if (error instanceof RemoteImageDownloadError) return error.message;
  if (
    error instanceof Error &&
    /image|input buffer|unsupported/i.test(error.message)
  )
    return "Screenshot is not a supported image";
  return "Screenshot could not be processed";
}

function firstStepUrl(body: string, sourceUrl: string | null): string {
  const match = /\]\((https?:\/\/[^\s)]+)(?:\s+[^)]*)?\)/i.exec(body);
  const candidate = match?.[1] ?? sourceUrl;
  if (!candidate) return "about:blank";
  try {
    return new URL(candidate).toString();
  } catch {
    return "about:blank";
  }
}

export function projectForImport(
  job: ScribeImportJobRow,
  assets: ScribeImportAssetRow[],
): Extract<RecordingProject, { version: 2 }> {
  const parsed = parseScribeMarkdown(job.source_markdown);
  const sourceRecordingId = randomUUID();
  const now = new Date().toISOString();
  const assetsByOrdinal = new Map(
    assets
      .filter((asset) => asset.status === "downloaded" && asset.image_data)
      .map((asset) => [asset.step_ordinal, asset]),
  );
  const events = parsed.steps.map((step) => ({
    id: randomUUID(),
    recordingId: sourceRecordingId,
    ordinal: step.ordinal,
    actionType: "navigation" as const,
    pageTitle: parsed.title,
    sanitizedUrl: firstStepUrl(step.body, parsed.sourceUrl),
    elementName: step.outlineTitle,
    metadata: {
      importedFrom: "scribe-markdown",
      sourceUrl: parsed.sourceUrl,
      sourceImageUrl: step.imageUrl,
    },
  }));
  const items = parsed.steps.map((step) => {
    const event = events[step.ordinal];
    const asset = assetsByOrdinal.get(step.ordinal);
    return {
      id: randomUUID(),
      recordingId: sourceRecordingId,
      eventId: event.id,
      ordinal: step.ordinal,
      kind: "step" as const,
      title: step.outlineTitle,
      body: step.body,
      imageFilename: asset?.filename ?? null,
      altText: asset ? (step.imageAlt ?? step.outlineTitle) : null,
      source: "manual" as const,
      userEdited: true,
    };
  });
  return {
    version: 2,
    recording: {
      id: sourceRecordingId,
      title: parsed.title,
      purpose: parsed.purpose,
      audience: null,
      captureMode: "guide",
      state: "finalized",
      createdAt: now,
      updatedAt: now,
      finalizedAt: now,
      events,
      steps: items.map((item) => ({
        id: item.id,
        recordingId: item.recordingId,
        eventId: item.eventId,
        ordinal: item.ordinal,
        title: item.title,
        instruction: item.body,
        imageFilename: item.imageFilename,
        altText: item.altText,
        source: item.source,
        userEdited: item.userEdited,
      })),
      items,
    },
    items,
    screenshots: assets.flatMap((asset) =>
      asset.status === "downloaded" && asset.image_data
        ? [
            {
              eventId: events[asset.step_ordinal].id,
              filename: asset.filename,
              contentType: "image/webp" as const,
              byteSize: asset.image_data.byteLength,
              originalImageBase64: asset.image_data.toString("base64"),
              annotatedImageBase64: asset.image_data.toString("base64"),
            },
          ]
        : [],
    ),
  };
}

export class ScribeImportWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lockClient: PoolClient | undefined;
  private draining = false;
  private stopped = false;
  private lastRequestStartedAt = 0;
  private lastCleanupAt = 0;

  constructor(
    private readonly config: ApiConfig,
    private readonly pool: Pool,
    private readonly log: {
      info(value: unknown, message: string): void;
      warn(value: unknown, message: string): void;
    },
  ) {}

  async start(): Promise<void> {
    if (this.config.NODE_ENV === "test") return;
    await cleanupExpiredScribeImports(this.pool);
    this.lastCleanupAt = Date.now();
    this.timer = setInterval(() => this.wake(), 1_000);
    this.timer.unref();
    this.wake();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.draining) await wait(25);
    if (this.lockClient) {
      await this.lockClient
        .query("select pg_advisory_unlock($1)", [WORKER_LOCK])
        .catch(() => undefined);
      this.lockClient.release();
      this.lockClient = undefined;
    }
  }

  wake(): void {
    if (this.stopped || this.draining) return;
    this.draining = true;
    void this.drain()
      .catch((error) => this.log.warn(error, "Scribe import worker failed"))
      .finally(() => {
        this.draining = false;
      });
  }

  private async ensureLock(): Promise<boolean> {
    if (this.lockClient) {
      try {
        await this.lockClient.query("select 1");
        return true;
      } catch {
        this.lockClient.release(true);
        this.lockClient = undefined;
      }
    }
    const client = await this.pool.connect();
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [WORKER_LOCK],
    );
    if (!result.rows[0]?.locked) {
      client.release();
      return false;
    }
    this.lockClient = client;
    return true;
  }

  private async drain(): Promise<void> {
    if (!(await this.ensureLock())) return;
    if (Date.now() - this.lastCleanupAt >= 24 * 60 * 60 * 1000) {
      await cleanupExpiredScribeImports(this.pool);
      this.lastCleanupAt = Date.now();
    }
    while (!this.stopped) {
      if (!(await this.ensureLock())) return;
      const work = await claimNextScribeImportWork(this.pool);
      if (!work) return;
      if (work.asset) await this.processAsset(work.job, work.asset);
      else await this.finalize(work.job);
    }
  }

  private async processAsset(
    job: ScribeImportJobRow,
    asset: ScribeImportAssetRow,
  ): Promise<void> {
    const elapsed = Date.now() - this.lastRequestStartedAt;
    if (elapsed < this.config.SCRIBE_IMPORT_IMAGE_DELAY_MS)
      await wait(this.config.SCRIBE_IMPORT_IMAGE_DELAY_MS - elapsed);
    this.lastRequestStartedAt = Date.now();
    try {
      const downloadedBytes = await downloadedScribeImportBytes(
        this.pool,
        job.id,
      );
      const remaining =
        this.config.SCRIBE_IMPORT_TOTAL_IMAGE_MAX_BYTES - downloadedBytes;
      if (remaining <= 0)
        throw new RemoteImageDownloadError(
          "Import exceeds the total screenshot byte limit",
        );
      const downloaded = await downloadRemoteImage(asset.source_url, {
        maxBytes: Math.min(
          this.config.SCRIBE_IMPORT_IMAGE_MAX_BYTES,
          remaining,
        ),
        timeoutMs: this.config.SCRIBE_IMPORT_IMAGE_TIMEOUT_MS,
      });
      const webp = await importedRasterToWebp(downloaded.body);
      await completeScribeImportAsset(this.pool, asset.id, {
        sourceByteSize: downloaded.body.byteLength,
        imageData: webp,
      });
    } catch (error) {
      const message = safeError(error);
      const attempt = asset.attempts + 1;
      if (
        error instanceof RemoteImageDownloadError &&
        error.retryable &&
        attempt < MAX_ATTEMPTS
      ) {
        const delay =
          error.retryAfterMs ?? RETRY_DELAYS_MS[Math.min(asset.attempts, 3)];
        await retryScribeImportAsset(this.pool, asset.id, {
          error: message,
          nextAttemptAt: new Date(Date.now() + delay),
        });
      } else {
        await failScribeImportAsset(this.pool, asset.id, message);
      }
    }
  }

  private async finalize(job: ScribeImportJobRow): Promise<void> {
    const assets = await listScribeImportAssets(this.pool, job.id);
    const failed = assets.filter((asset) => asset.status === "failed");
    if (scribeImportCompletionStatus(failed.length) === "failed") {
      await failScribeImportJob(
        this.pool,
        job.id,
        `${failed.length} screenshots could not be downloaded; the limit is 3`,
      );
      return;
    }
    try {
      const project = projectForImport(job, assets);
      const recording = await withTransaction(this.pool, async (client) => {
        const imported = await importRecordingProject(client, project, {
          ownerUserId: job.created_by_user_id,
          projectId: job.project_id,
        });
        await completeScribeImportJob(
          client,
          job.id,
          imported.id,
          failed.length > 0,
        );
        await writeAuditEvent(client, {
          actorUserId: job.created_by_user_id,
          eventType: "scribe_markdown_import_completed",
          entityType: "recording",
          entityId: imported.id,
          metadata: { jobId: job.id, missingImages: failed.length },
        });
        return imported;
      });
      this.log.info(
        { jobId: job.id, recordingId: recording.id },
        "Scribe Markdown import completed",
      );
    } catch (error) {
      await failScribeImportJob(
        this.pool,
        job.id,
        error instanceof Error
          ? `Guide could not be created: ${error.message}`
          : "Guide could not be created",
      );
    }
  }
}

export function scribeImportCompletionStatus(
  failedImages: number,
): "completed" | "completed_with_warnings" | "failed" {
  if (failedImages > 3) return "failed";
  return failedImages > 0 ? "completed_with_warnings" : "completed";
}
