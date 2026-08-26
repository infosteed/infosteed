// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type {
  ScribeMarkdownImportFailure,
  ScribeMarkdownImportJob,
} from "@infosteed/shared";
import type { ParsedScribeMarkdown } from "../scribeMarkdown.js";
import type { Pool, PoolClient } from "../db.js";

type Db = Pool | PoolClient;

export interface ScribeImportJobRow {
  id: string;
  created_by_user_id: string;
  project_id: string;
  status: ScribeMarkdownImportJob["status"];
  original_filename: string;
  source_markdown: string;
  source_url: string | null;
  recording_id: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface ScribeImportAssetRow {
  id: string;
  job_id: string;
  step_ordinal: number;
  source_url: string;
  filename: string;
  status: "pending" | "retry" | "downloaded" | "failed";
  attempts: number;
  next_attempt_at: Date | null;
  source_byte_size: number | null;
  image_data: Buffer | null;
  error_message: string | null;
}

export interface ScribeImportWork {
  job: ScribeImportJobRow;
  asset: ScribeImportAssetRow | null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

async function jobSummary(
  db: Db,
  row: ScribeImportJobRow,
): Promise<ScribeMarkdownImportJob> {
  const assets = await db.query<{
    total: string;
    processed: string;
    downloaded: string;
  }>(
    `select count(*) as total,
       count(*) filter (where status in ('downloaded', 'failed')) as processed,
       count(*) filter (where status = 'downloaded') as downloaded
     from scribe_markdown_import_assets where job_id = $1`,
    [row.id],
  );
  const failures = await db.query<{
    source_url: string;
    error_message: string;
  }>(
    `select source_url, coalesce(error_message, 'Screenshot could not be downloaded') as error_message
     from scribe_markdown_import_assets
     where job_id = $1 and status = 'failed'
     order by step_ordinal`,
    [row.id],
  );
  const counts = assets.rows[0];
  return {
    id: row.id,
    status: row.status,
    originalFilename: row.original_filename,
    sourceUrl: row.source_url,
    totalImages: Number(counts?.total ?? 0),
    processedImages: Number(counts?.processed ?? 0),
    downloadedImages: Number(counts?.downloaded ?? 0),
    failedImages: failures.rows.map((failure): ScribeMarkdownImportFailure => ({
      url: failure.source_url,
      error: failure.error_message,
    })),
    recordingId: row.recording_id,
    errorMessage: row.error_message,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
  };
}

export async function createScribeImportJob(
  db: Db,
  input: {
    userId: string;
    projectId: string;
    originalFilename: string;
    markdown: string;
    parsed: ParsedScribeMarkdown;
  },
): Promise<ScribeMarkdownImportJob> {
  const id = randomUUID();
  const result = await db.query<ScribeImportJobRow>(
    `insert into scribe_markdown_import_jobs (
       id, created_by_user_id, project_id, status, original_filename,
       source_markdown, source_url
     ) values ($1, $2, $3, 'queued', $4, $5, $6)
     returning *`,
    [
      id,
      input.userId,
      input.projectId,
      input.originalFilename,
      input.markdown,
      input.parsed.sourceUrl,
    ],
  );
  for (const step of input.parsed.steps) {
    if (!step.imageUrl) continue;
    await db.query(
      `insert into scribe_markdown_import_assets (
         id, job_id, step_ordinal, source_url, filename, status
       ) values ($1, $2, $3, $4, $5, 'pending')`,
      [
        randomUUID(),
        id,
        step.ordinal,
        step.imageUrl,
        `scribe-step-${String(step.ordinal + 1).padStart(3, "0")}.webp`,
      ],
    );
  }
  return jobSummary(db, result.rows[0]);
}

export async function getScribeImportJobForUser(
  db: Db,
  jobId: string,
  userId: string,
): Promise<ScribeMarkdownImportJob | null> {
  const result = await db.query<ScribeImportJobRow>(
    `select * from scribe_markdown_import_jobs
     where id = $1 and created_by_user_id = $2`,
    [jobId, userId],
  );
  return result.rows[0] ? jobSummary(db, result.rows[0]) : null;
}

export async function listScribeImportJobsForUser(
  db: Db,
  userId: string,
  limit = 20,
): Promise<ScribeMarkdownImportJob[]> {
  const result = await db.query<ScribeImportJobRow>(
    `select * from scribe_markdown_import_jobs
     where created_by_user_id = $1
     order by created_at desc limit $2`,
    [userId, limit],
  );
  return Promise.all(result.rows.map((row) => jobSummary(db, row)));
}

export async function claimNextScribeImportWork(
  db: Pool,
): Promise<ScribeImportWork | null> {
  const client = await db.connect();
  try {
    await client.query("begin");
    const jobs = await client.query<ScribeImportJobRow>(
      `select j.* from scribe_markdown_import_jobs j
       where j.status in ('queued', 'processing') and (
         exists (
           select 1 from scribe_markdown_import_assets a
           where a.job_id = j.id and (
             a.status = 'pending' or
             (a.status = 'retry' and coalesce(a.next_attempt_at, now()) <= now())
           )
         ) or not exists (
           select 1 from scribe_markdown_import_assets a
           where a.job_id = j.id and a.status in ('pending', 'retry')
         )
       )
       order by j.created_at
       for update skip locked limit 1`,
    );
    const job = jobs.rows[0];
    if (!job) {
      await client.query("commit");
      return null;
    }
    const updated = await client.query<ScribeImportJobRow>(
      `update scribe_markdown_import_jobs
       set status = 'processing', updated_at = now()
       where id = $1 returning *`,
      [job.id],
    );
    const assets = await client.query<ScribeImportAssetRow>(
      `select * from scribe_markdown_import_assets
       where job_id = $1 and (
         status = 'pending' or
         (status = 'retry' and coalesce(next_attempt_at, now()) <= now())
       )
       order by step_ordinal limit 1`,
      [job.id],
    );
    await client.query("commit");
    return { job: updated.rows[0], asset: assets.rows[0] ?? null };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function downloadedScribeImportBytes(
  db: Db,
  jobId: string,
): Promise<number> {
  const result = await db.query<{ total: string }>(
    `select coalesce(sum(source_byte_size), 0) as total
     from scribe_markdown_import_assets
     where job_id = $1 and status = 'downloaded'`,
    [jobId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

export async function completeScribeImportAsset(
  db: Db,
  assetId: string,
  input: { sourceByteSize: number; imageData: Buffer },
): Promise<void> {
  await db.query(
    `update scribe_markdown_import_assets
     set status = 'downloaded', attempts = attempts + 1,
       source_byte_size = $2, image_data = $3, error_message = null,
       next_attempt_at = null, updated_at = now()
     where id = $1`,
    [assetId, input.sourceByteSize, input.imageData],
  );
}

export async function retryScribeImportAsset(
  db: Db,
  assetId: string,
  input: { error: string; nextAttemptAt: Date },
): Promise<void> {
  await db.query(
    `update scribe_markdown_import_assets
     set status = 'retry', attempts = attempts + 1, error_message = $2,
       next_attempt_at = $3, updated_at = now()
     where id = $1`,
    [assetId, input.error, input.nextAttemptAt],
  );
}

export async function failScribeImportAsset(
  db: Db,
  assetId: string,
  error: string,
): Promise<void> {
  await db.query(
    `update scribe_markdown_import_assets
     set status = 'failed', attempts = attempts + 1, error_message = $2,
       next_attempt_at = null, updated_at = now()
     where id = $1`,
    [assetId, error],
  );
}

export async function getScribeImportJobCore(
  db: Db,
  jobId: string,
): Promise<ScribeImportJobRow | null> {
  const result = await db.query<ScribeImportJobRow>(
    "select * from scribe_markdown_import_jobs where id = $1",
    [jobId],
  );
  return result.rows[0] ?? null;
}

export async function listScribeImportAssets(
  db: Db,
  jobId: string,
): Promise<ScribeImportAssetRow[]> {
  const result = await db.query<ScribeImportAssetRow>(
    `select * from scribe_markdown_import_assets
     where job_id = $1 order by step_ordinal`,
    [jobId],
  );
  return result.rows;
}

export async function completeScribeImportJob(
  db: Db,
  jobId: string,
  recordingId: string,
  warnings: boolean,
): Promise<void> {
  await db.query(
    `update scribe_markdown_import_jobs
     set status = $2, recording_id = $3, error_message = null,
       completed_at = now(), updated_at = now(), source_markdown = ''
     where id = $1`,
    [jobId, warnings ? "completed_with_warnings" : "completed", recordingId],
  );
  await db.query(
    `update scribe_markdown_import_assets set image_data = null
     where job_id = $1`,
    [jobId],
  );
}

export async function failScribeImportJob(
  db: Db,
  jobId: string,
  error: string,
): Promise<void> {
  await db.query(
    `update scribe_markdown_import_jobs
     set status = 'failed', error_message = $2,
       completed_at = now(), updated_at = now()
     where id = $1`,
    [jobId, error],
  );
}

export async function retryScribeImportJob(
  db: Db,
  jobId: string,
  userId: string,
): Promise<boolean> {
  const result = await db.query(
    `update scribe_markdown_import_jobs
     set status = 'queued', error_message = null,
       completed_at = null, updated_at = now()
     where id = $1 and created_by_user_id = $2 and status = 'failed'`,
    [jobId, userId],
  );
  if ((result.rowCount ?? 0) === 0) return false;
  await db.query(
    `update scribe_markdown_import_assets
     set status = 'retry', attempts = 0, next_attempt_at = now(),
       error_message = null, updated_at = now()
     where job_id = $1 and status = 'failed'`,
    [jobId],
  );
  return true;
}

export async function cleanupExpiredScribeImports(db: Db): Promise<number> {
  const result = await db.query(
    `delete from scribe_markdown_import_jobs
     where created_at < now() - interval '30 days'`,
  );
  return result.rowCount ?? 0;
}
