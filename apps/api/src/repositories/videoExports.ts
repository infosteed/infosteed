// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { VideoMp4Export } from "@infosteed/shared";
import type { Pool, PoolClient } from "../db.js";

type Db = Pool | PoolClient;

interface ExportRow {
  id: string;
  render_id: string;
  status: VideoMp4Export["status"];
  progress: number;
  byte_size: string | number;
  error_message: string | null;
  storage_key: string | null;
  created_at: Date;
  completed_at: Date | null;
}

function mapExport(row: ExportRow): VideoMp4Export {
  return {
    id: row.id,
    renderId: row.render_id,
    status: row.status,
    progress: row.progress,
    byteSize: Number(row.byte_size),
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export async function getVideoMp4Export(
  db: Db,
  recordingId: string,
  renderId: string,
): Promise<(VideoMp4Export & { storageKey: string | null }) | null> {
  const result = await db.query<ExportRow>(
    `select e.* from recording_video_exports e
     join recording_videos v on v.id = e.video_id
     where v.recording_id = $1 and e.render_id = $2`,
    [recordingId, renderId],
  );
  const row = result.rows[0];
  return row ? { ...mapExport(row), storageKey: row.storage_key } : null;
}

export async function queueVideoMp4Export(
  db: Db,
  recordingId: string,
  renderId: string,
): Promise<VideoMp4Export | null> {
  const result = await db.query<ExportRow>(
    `insert into recording_video_exports (id, video_id, render_id, status)
     select $3, r.video_id, r.id, 'queued' from recording_video_renders r
     join recording_videos v on v.id = r.video_id
     where v.recording_id = $1 and r.id = $2 and r.status = 'ready'
     on conflict (render_id) do update set
       status = case when recording_video_exports.status = 'failed' then 'queued' else recording_video_exports.status end,
       progress = case when recording_video_exports.status = 'failed' then 0 else recording_video_exports.progress end,
       attempts = case when recording_video_exports.status = 'failed' then 0 else recording_video_exports.attempts end,
       storage_key = case when recording_video_exports.status = 'failed' then null else recording_video_exports.storage_key end,
       mime_type = case when recording_video_exports.status = 'failed' then null else recording_video_exports.mime_type end,
       codec = case when recording_video_exports.status = 'failed' then null else recording_video_exports.codec end,
       byte_size = case when recording_video_exports.status = 'failed' then 0 else recording_video_exports.byte_size end,
       error_message = case when recording_video_exports.status = 'failed' then null else recording_video_exports.error_message end,
       started_at = case when recording_video_exports.status = 'failed' then null else recording_video_exports.started_at end,
       heartbeat_at = case when recording_video_exports.status = 'failed' then null else recording_video_exports.heartbeat_at end,
       completed_at = case when recording_video_exports.status = 'failed' then null else recording_video_exports.completed_at end,
       updated_at = now()
     returning *`,
    [recordingId, renderId, randomUUID()],
  );
  return result.rows[0] ? mapExport(result.rows[0]) : null;
}

export async function listExportStorageForVideo(
  db: Db,
  recordingId: string,
): Promise<Array<{ exportId: string; storageKey: string }>> {
  const result = await db.query<{ id: string; storage_key: string }>(
    `select e.id, e.storage_key from recording_video_exports e
     join recording_videos v on v.id = e.video_id
     where v.recording_id = $1 and e.storage_key is not null`,
    [recordingId],
  );
  return result.rows.map((row) => ({
    exportId: row.id,
    storageKey: row.storage_key,
  }));
}

export async function listExpiredExportOutputs(
  db: Db,
): Promise<Array<{ exportId: string; storageKey: string | null }>> {
  const result = await db.query<{ id: string; storage_key: string | null }>(
    `select e.id, e.storage_key from recording_video_exports e
     join recording_video_renders r on r.id = e.render_id
     where r.cleanup_after < now()`,
  );
  return result.rows.map((row) => ({
    exportId: row.id,
    storageKey: row.storage_key,
  }));
}

export async function deleteVideoMp4Export(
  db: Db,
  exportId: string,
): Promise<void> {
  await db.query("delete from recording_video_exports where id = $1", [
    exportId,
  ]);
}
