// SPDX-License-Identifier: AGPL-3.0-only
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import {
  PRODUCT_IDENTIFIERS,
  videoEditRecipeSchema,
  videoEditedDurationMs,
  type VideoEditRecipe,
} from "@infosteed/shared";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadRenderConfig } from "./config.js";
import { buildFfmpegArguments } from "./render.js";

interface AssetRow {
  id: string;
  kind:
    | "composite"
    | "screen"
    | "camera"
    | "microphone"
    | "transcription"
    | "voiceover";
  storage_key: string;
  width: number | null;
  height: number | null;
}

interface JobRow {
  id: string;
  video_id: string;
  recording_id: string;
  recipe: VideoEditRecipe;
  attempts: number;
  raw_assets_complete: boolean;
}

const config = loadRenderConfig();
const ffmpegCheck = spawnSync(config.VIDEO_RENDER_FFMPEG_PATH, ["-version"], {
  encoding: "utf8",
});
const ffprobeCheck = spawnSync(config.VIDEO_RENDER_FFPROBE_PATH, ["-version"], {
  encoding: "utf8",
});
if (ffmpegCheck.status !== 0 || ffprobeCheck.status !== 0) {
  throw new Error(
    "FFmpeg and FFprobe must be installed and available to the video render worker",
  );
}

const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const workerId = `${process.pid}-${randomUUID()}`;
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials:
    config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
});

function log(message: string, detail?: unknown): void {
  const suffix =
    detail === undefined
      ? ""
      : ` ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
  process.stdout.write(`[video-render-worker] ${message}${suffix}\n`);
}

function safeRenderError(error: unknown, canceled: boolean): string {
  if (canceled) return "Render canceled";
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No completed screen or composite"))
    return "No completed source video is available";
  if (message.includes("duration does not match"))
    return "Rendered duration did not match the requested edit";
  if (message.includes("Object storage"))
    return "Object storage could not save the rendered video";
  return "FFmpeg could not render this edit";
}

async function heartbeat(): Promise<void> {
  await pool.query(
    `insert into recording_video_render_workers (id) values ($1)
     on conflict (id) do update set heartbeat_at = now()`,
    [workerId],
  );
}

async function claim(): Promise<{ job: JobRow; assets: AssetRow[] } | null> {
  const result = await pool.query<JobRow>(
    `with candidate as (
       select id from recording_video_renders where status = 'queued' order by created_at
       for update skip locked limit 1
     )
     update recording_video_renders r set status = 'processing', attempts = attempts + 1,
       started_at = now(), heartbeat_at = now(), updated_at = now(), error_message = null
     from candidate, recording_video_edit_versions ev, recording_videos v
     where r.id = candidate.id and ev.id = r.edit_version_id and v.id = r.video_id
     returning r.id, r.video_id, v.recording_id, ev.recipe, r.attempts, v.raw_assets_complete`,
  );
  const row = result.rows[0];
  if (!row) return null;
  const assets = await pool.query<AssetRow>(
    "select id, kind, storage_key, width, height from recording_video_assets where video_id = $1 and status = 'complete' order by kind",
    [row.video_id],
  );
  return {
    job: { ...row, recipe: videoEditRecipeSchema.parse(row.recipe) },
    assets: assets.rows,
  };
}

async function download(
  storageKey: string,
  destination: string,
): Promise<void> {
  const result = await s3.send(
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: storageKey }),
  );
  if (!result.Body)
    throw new Error("Object storage returned an empty source asset");
  const source =
    result.Body instanceof Readable
      ? result.Body
      : Readable.fromWeb(result.Body.transformToWebStream() as never);
  await pipeline(source, createWriteStream(destination));
}

async function uploadMultipart(
  storageKey: string,
  sourcePath: string,
): Promise<number> {
  const file = await stat(sourcePath);
  const created = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: config.S3_BUCKET,
      Key: storageKey,
      ContentType: "video/webm",
    }),
  );
  if (!created.UploadId)
    throw new Error("Object storage did not create a render upload");
  try {
    const parts: Array<{ ETag: string; PartNumber: number }> = [];
    const handle = await open(sourcePath, "r");
    try {
      const partSize = 8 * 1024 * 1024;
      let position = 0;
      let partNumber = 1;
      while (position < file.size) {
        const buffer = Buffer.alloc(Math.min(partSize, file.size - position));
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          position,
        );
        const uploaded = await s3.send(
          new UploadPartCommand({
            Bucket: config.S3_BUCKET,
            Key: storageKey,
            UploadId: created.UploadId,
            PartNumber: partNumber,
            Body:
              bytesRead === buffer.length
                ? buffer
                : buffer.subarray(0, bytesRead),
            ContentLength: bytesRead,
          }),
        );
        if (!uploaded.ETag)
          throw new Error(
            "Object storage did not return an ETag for a render part",
          );
        parts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
        position += bytesRead;
        partNumber += 1;
      }
    } finally {
      await handle.close();
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: config.S3_BUCKET,
        Key: storageKey,
        UploadId: created.UploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  } catch (error) {
    await s3
      .send(
        new AbortMultipartUploadCommand({
          Bucket: config.S3_BUCKET,
          Key: storageKey,
          UploadId: created.UploadId,
        }),
      )
      .catch(() => undefined);
    throw error;
  }
  return file.size;
}

async function probe(filePath: string): Promise<{
  durationMs: number;
  width: number;
  height: number;
  frameRate: number;
  hasAudio: boolean;
}> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(config.VIDEO_RENDER_FFPROBE_PATH, [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      filePath,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(stderr || `FFprobe exited with ${code}`)),
    );
  });
  const parsed = JSON.parse(output) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      duration?: string;
    }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.width || !video.height)
    throw new Error("Rendered media has no video stream");
  const frameParts = (video.avg_frame_rate ?? "30/1").split("/").map(Number);
  return {
    durationMs: Math.round(
      Number(parsed.format?.duration ?? video.duration ?? 0) * 1000,
    ),
    width: video.width,
    height: video.height,
    frameRate: frameParts[1] ? frameParts[0] / frameParts[1] : 30,
    hasAudio: Boolean(
      parsed.streams?.some((stream) => stream.codec_type === "audio"),
    ),
  };
}

async function render(job: JobRow, assets: AssetRow[]): Promise<void> {
  const temporaryRoot = config.VIDEO_RENDER_TEMP_DIR ?? tmpdir();
  const workDir = await mkdtemp(
    path.join(temporaryRoot, `${PRODUCT_IDENTIFIERS.tempPrefix}render-`),
  );
  try {
    const screen = assets.find((asset) => asset.kind === "screen");
    const composite = assets.find((asset) => asset.kind === "composite");
    const base = job.raw_assets_complete
      ? (screen ?? composite)
      : (composite ?? screen);
    if (!base)
      throw new Error("No completed screen or composite source is available");
    const camera = job.raw_assets_complete
      ? assets.find((asset) => asset.kind === "camera")
      : undefined;
    const microphone = job.raw_assets_complete
      ? assets.find((asset) => asset.kind === "microphone")
      : undefined;
    const voiceover = job.recipe.voiceover.enabled
      ? assets.find(
          (asset) =>
            asset.kind === "voiceover" &&
            asset.id === job.recipe.voiceover.assetId,
        )
      : undefined;
    if (
      job.recipe.voiceover.enabled &&
      job.recipe.voiceover.assetId &&
      !voiceover
    ) {
      throw new Error("The selected voiceover asset is unavailable");
    }
    const basePath = path.join(workDir, "base.webm");
    const cameraPath = camera ? path.join(workDir, "camera.webm") : undefined;
    const microphonePath = microphone
      ? path.join(workDir, "microphone.webm")
      : undefined;
    const voiceoverPath = voiceover
      ? path.join(workDir, "voiceover.wav")
      : undefined;
    await download(base.storage_key, basePath);
    if (camera && cameraPath) await download(camera.storage_key, cameraPath);
    if (microphone && microphonePath)
      await download(microphone.storage_key, microphonePath);
    if (voiceover && voiceoverPath)
      await download(voiceover.storage_key, voiceoverPath);
    const baseProbe = await probe(basePath);
    const outputPath = path.join(workDir, "render.webm");
    const outputDuration = videoEditedDurationMs(job.recipe);
    const args = buildFfmpegArguments({
      basePath,
      cameraPath: job.recipe.webcam.visible ? cameraPath : undefined,
      microphonePath,
      voiceoverPath,
      baseHasAudio: baseProbe.hasAudio,
      width: base.width ?? baseProbe.width,
      height: base.height ?? baseProbe.height,
      frameRate: baseProbe.frameRate,
      recipe: job.recipe,
      outputPath,
    });
    await new Promise<void>((resolve, reject) => {
      const child = spawn(config.VIDEO_RENDER_FFMPEG_PATH, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timeout = setTimeout(
        () => child.kill("SIGTERM"),
        config.VIDEO_RENDER_TIMEOUT_MS,
      );
      const cancellationTimer = setInterval(() => {
        void pool
          .query<{ cancel_requested: boolean }>(
            "select cancel_requested from recording_video_renders where id = $1 and status = 'processing'",
            [job.id],
          )
          .then((result) => {
            if (
              (!result.rows[0] || result.rows[0].cancel_requested) &&
              !canceled
            ) {
              canceled = true;
              child.kill("SIGTERM");
            }
          })
          .catch(() => undefined);
      }, 2_000);
      let stderr = "";
      let canceled = false;
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-12_000);
      });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        if (!line.startsWith("out_time_ms=")) return;
        const renderedMs = Number(line.slice("out_time_ms=".length)) / 1000;
        void pool
          .query<{ cancel_requested: boolean }>(
            `update recording_video_renders set progress = greatest(progress, $2), heartbeat_at = now(), updated_at = now()
           where id = $1 and status = 'processing' returning cancel_requested`,
            [job.id, Math.min(0.99, Math.max(0, renderedMs / outputDuration))],
          )
          .then((result) => {
            if (result.rows[0]?.cancel_requested && !canceled) {
              canceled = true;
              child.kill("SIGTERM");
            }
          })
          .catch(() => undefined);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        clearInterval(cancellationTimer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        clearInterval(cancellationTimer);
        if (canceled)
          reject(
            Object.assign(new Error("Render canceled"), { canceled: true }),
          );
        else if (code === 0) resolve();
        else reject(new Error(stderr || `FFmpeg exited with ${code}`));
      });
    });
    const resultProbe = await probe(outputPath);
    if (
      Math.abs(resultProbe.durationMs - outputDuration) >
      Math.max(1_000, outputDuration * 0.03)
    ) {
      throw new Error("Rendered duration does not match the edit recipe");
    }
    const stillActive = await pool.query<{ cancel_requested: boolean }>(
      "select cancel_requested from recording_video_renders where id = $1 and status = 'processing'",
      [job.id],
    );
    if (!stillActive.rows[0] || stillActive.rows[0].cancel_requested) {
      throw Object.assign(new Error("Render canceled"), { canceled: true });
    }
    const storageKey = `videos/${job.recording_id}/renders/${job.id}.webm`;
    const byteSize = await uploadMultipart(storageKey, outputPath);
    const completed = await pool.query(
      `update recording_video_renders set status = 'ready', progress = 1, storage_key = $2,
       mime_type = 'video/webm', codec = 'vp9,opus', byte_size = $3, duration_ms = $4,
       completed_at = now(), heartbeat_at = now(), updated_at = now(), error_message = null
       where id = $1 and status = 'processing' and not cancel_requested`,
      [job.id, storageKey, byteSize, resultProbe.durationMs],
    );
    if ((completed.rowCount ?? 0) === 0) {
      await s3
        .send(
          new DeleteObjectCommand({
            Bucket: config.S3_BUCKET,
            Key: storageKey,
          }),
        )
        .catch(() => undefined);
      throw Object.assign(
        new Error("Render was deleted before upload completed"),
        { canceled: true },
      );
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function workLoop(slot: number): Promise<void> {
  while (!stopping) {
    const claimed = await claim().catch((error) => {
      log(
        `slot ${slot} could not claim a job`,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    });
    if (!claimed) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      continue;
    }
    log("render started", {
      renderId: claimed.job.id,
      recordingId: claimed.job.recording_id,
    });
    try {
      await render(claimed.job, claimed.assets);
      log("render completed", { renderId: claimed.job.id });
    } catch (error) {
      const canceled = Boolean((error as { canceled?: boolean }).canceled);
      const message = error instanceof Error ? error.message : String(error);
      const safeMessage = safeRenderError(error, canceled);
      await pool.query(
        `update recording_video_renders set status = $2, error_message = $3,
         completed_at = now(), updated_at = now() where id = $1`,
        [claimed.job.id, canceled ? "canceled" : "failed", safeMessage],
      );
      log(canceled ? "render canceled" : "render failed", {
        renderId: claimed.job.id,
        error: message,
      });
    }
  }
}

let stopping = false;
await pool.query(
  `update recording_video_renders set status = case when attempts < 2 then 'queued' else 'failed' end,
   error_message = 'Previous render worker stopped before completion', updated_at = now()
   where status = 'processing' and heartbeat_at < now() - ($1::text || ' milliseconds')::interval`,
  [config.VIDEO_RENDER_STALE_MS],
);
await heartbeat();
const heartbeatTimer = setInterval(
  () =>
    void heartbeat().catch((error) => log("heartbeat failed", String(error))),
  10_000,
);
const loops = Array.from(
  { length: config.VIDEO_RENDER_CONCURRENCY },
  (_value, index) => workLoop(index + 1),
);
log("started", { workerId, concurrency: config.VIDEO_RENDER_CONCURRENCY });

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  await Promise.allSettled(loops);
  await pool
    .query("delete from recording_video_render_workers where id = $1", [
      workerId,
    ])
    .catch(() => undefined);
  s3.destroy();
  await pool.end();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
await Promise.all(loops);
