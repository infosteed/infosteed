// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../db.js";
import type {
  InitializeVideoRequest,
  RecordingTranscript,
  RecordingVideo,
  RecordingVideoAsset,
  TranscriptSegment,
  TranscriptWord,
  TranscriptionStatus,
  VideoChapter,
} from "@infosteed/shared";
import { buildTranscriptCues } from "../transcriptContext.js";

type Db = Pool | PoolClient;

interface VideoRow {
  id: string;
  recording_id: string;
  status: RecordingVideo["status"];
  duration_ms: number | null;
  capture_settings: RecordingVideo["captureSettings"];
  raw_assets_complete: boolean;
  recovered: boolean;
  error_message: string | null;
  transcription_status: TranscriptionStatus;
  transcription_language: string | null;
  transcription_error_message: string | null;
  published_at: Date | null;
}

export interface VideoAssetRow {
  id: string;
  video_id: string;
  kind: RecordingVideoAsset["kind"];
  mime_type: string;
  codec: string | null;
  width: number | null;
  height: number | null;
  storage_key: string;
  multipart_upload_id: string | null;
  byte_size: string | number;
  duration_ms: number | null;
  status: RecordingVideoAsset["status"];
}

function mapAsset(row: VideoAssetRow): RecordingVideoAsset {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    codec: row.codec,
    width: row.width,
    height: row.height,
    byteSize: Number(row.byte_size),
    durationMs: row.duration_ms,
    status: row.status,
  };
}

export async function createVideo(
  db: Db,
  input: {
    recordingId: string;
    userId: string;
    request: InitializeVideoRequest;
    uploads: Array<{
      kind: RecordingVideoAsset["kind"];
      storageKey: string;
      uploadId: string;
    }>;
  },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into recording_videos (id, recording_id, created_by_user_id, status, capture_settings)
     values ($1, $2, $3, 'recording', $4::jsonb)`,
    [
      id,
      input.recordingId,
      input.userId,
      JSON.stringify(input.request.captureSettings),
    ],
  );
  for (const asset of input.request.assets) {
    const upload = input.uploads.find(
      (candidate) => candidate.kind === asset.kind,
    );
    if (!upload) throw new Error(`Missing multipart upload for ${asset.kind}`);
    await db.query(
      `insert into recording_video_assets (
         id, video_id, kind, mime_type, codec, width, height, storage_key, multipart_upload_id, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'uploading')`,
      [
        randomUUID(),
        id,
        asset.kind,
        asset.mimeType,
        asset.codec ?? null,
        asset.width ?? null,
        asset.height ?? null,
        upload.storageKey,
        upload.uploadId,
      ],
    );
  }
  return id;
}

export async function getVideoAsset(
  db: Db,
  recordingId: string,
  assetId: string,
): Promise<VideoAssetRow | null> {
  const result = await db.query<VideoAssetRow>(
    `select a.* from recording_video_assets a
     join recording_videos v on v.id = a.video_id
     where v.recording_id = $1 and a.id = $2`,
    [recordingId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function saveVideoPart(
  db: Db,
  input: {
    assetId: string;
    partNumber: number;
    etag: string;
    byteSize: number;
    startedAtMs?: number;
    endedAtMs?: number;
  },
): Promise<void> {
  await db.query(
    `insert into recording_video_parts (asset_id, part_number, etag, byte_size, started_at_ms, ended_at_ms)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (asset_id, part_number) do update set
       etag = excluded.etag, byte_size = excluded.byte_size,
       started_at_ms = excluded.started_at_ms, ended_at_ms = excluded.ended_at_ms,
       uploaded_at = now()`,
    [
      input.assetId,
      input.partNumber,
      input.etag,
      input.byteSize,
      input.startedAtMs ?? null,
      input.endedAtMs ?? null,
    ],
  );
  await db.query(
    `update recording_videos set updated_at = now()
     where id = (select video_id from recording_video_assets where id = $1)`,
    [input.assetId],
  );
}

export async function listVideoParts(db: Db, assetId: string) {
  const result = await db.query<{
    part_number: number;
    etag: string;
    byte_size: number;
  }>(
    "select part_number, etag, byte_size from recording_video_parts where asset_id = $1 order by part_number",
    [assetId],
  );
  return result.rows;
}

export async function completeVideoAsset(
  db: Db,
  assetId: string,
  durationMs?: number,
): Promise<void> {
  await db.query(
    `update recording_video_assets a set
       status = 'complete', multipart_upload_id = null,
       byte_size = coalesce((select sum(byte_size) from recording_video_parts where asset_id = a.id), 0),
       duration_ms = $2, completed_at = now()
     where a.id = $1`,
    [assetId, durationMs ?? null],
  );
}

export async function markVideoReady(
  db: Db,
  recordingId: string,
  input: { durationMs: number; recovered: boolean; rawAssetsComplete: boolean },
): Promise<void> {
  await db.query(
    `update recording_videos set status = 'ready', duration_ms = $2, recovered = $3,
       raw_assets_complete = $4, ready_at = now(), updated_at = now(), error_message = null
     where recording_id = $1`,
    [recordingId, input.durationMs, input.recovered, input.rawAssetsComplete],
  );
}

export async function setVideoPublished(
  db: Db,
  recordingId: string,
  published: boolean,
): Promise<void> {
  await db.query(
    `update recording_videos set status = $2, published_at = case when $3 then now() else null end, updated_at = now()
     where recording_id = $1 and status in ('ready', 'published')`,
    [recordingId, published ? "published" : "ready", published],
  );
}

export async function getVideoRows(
  db: Db,
  recordingId: string,
): Promise<{ video: VideoRow; assets: VideoAssetRow[] } | null> {
  const videos = await db.query<VideoRow>(
    "select * from recording_videos where recording_id = $1",
    [recordingId],
  );
  const video = videos.rows[0];
  if (!video) return null;
  const assets = await db.query<VideoAssetRow>(
    "select * from recording_video_assets where video_id = $1 order by kind",
    [video.id],
  );
  return { video, assets: assets.rows };
}

export async function getRecordingVideo(
  db: Db,
  recordingId: string,
  chapters: VideoChapter[],
  transcriptionAvailable = false,
): Promise<RecordingVideo | null> {
  const rows = await getVideoRows(db, recordingId);
  if (!rows) return null;
  return {
    id: rows.video.id,
    recordingId: rows.video.recording_id,
    status: rows.video.status,
    durationMs: rows.video.duration_ms,
    captureSettings: rows.video.capture_settings,
    rawAssetsComplete: rows.video.raw_assets_complete,
    recovered: rows.video.recovered,
    errorMessage: rows.video.error_message,
    transcriptionStatus: rows.video.transcription_status,
    transcriptionAvailable,
    transcriptionLanguage: rows.video.transcription_language,
    transcriptionErrorMessage: rows.video.transcription_error_message,
    publishedAt: rows.video.published_at?.toISOString() ?? null,
    assets: rows.assets.map(mapAsset),
    chapters,
  };
}

interface TranscriptRow {
  model: string;
  source_asset_kind: RecordingVideoAsset["kind"];
  language: string | null;
  language_probability: number | null;
  duration_ms: number | null;
  transcript_text: string;
  segments: TranscriptSegment[];
  words: TranscriptWord[];
}

export interface TranscriptionJob {
  videoId: string;
  recordingId: string;
  createdByUserId: string | null;
  sourceAsset: VideoAssetRow;
}

export async function queueVideoTranscription(
  db: Db,
  recordingId: string,
  enabled: boolean,
): Promise<void> {
  await db.query(
    `update recording_videos set transcription_status = $2,
       transcription_error_message = null, transcription_started_at = null,
       transcription_completed_at = null, updated_at = now()
     where recording_id = $1`,
    [recordingId, enabled ? "pending" : "disabled"],
  );
}

export async function requeueStaleTranscriptions(db: Db): Promise<number> {
  const result = await db.query(
    `update recording_videos set transcription_status = 'pending',
       transcription_error_message = 'Previous transcription worker stopped before completion', updated_at = now()
     where transcription_status = 'processing'`,
  );
  return result.rowCount ?? 0;
}

export async function claimNextTranscription(
  db: Db,
): Promise<TranscriptionJob | null> {
  const claimed = await db.query<
    VideoRow & { created_by_user_id: string | null }
  >(
    `with candidate as (
       select id from recording_videos
       where transcription_status = 'pending'
       order by updated_at, created_at
       for update skip locked
       limit 1
     )
     update recording_videos v set transcription_status = 'processing',
       transcription_started_at = now(), transcription_error_message = null, updated_at = now()
     from candidate where v.id = candidate.id
     returning v.*`,
  );
  const video = claimed.rows[0];
  if (!video) return null;
  const assets = await db.query<VideoAssetRow>(
    `select * from recording_video_assets
     where video_id = $1 and status = 'complete' and kind in ('transcription', 'microphone', 'composite')
     order by case kind when 'transcription' then 0 when 'microphone' then 1 else 2 end
     limit 1`,
    [video.id],
  );
  const sourceAsset = assets.rows[0];
  if (!sourceAsset) {
    await failTranscription(
      db,
      video.recording_id,
      "No completed audio asset is available",
    );
    return null;
  }
  return {
    videoId: video.id,
    recordingId: video.recording_id,
    createdByUserId: video.created_by_user_id,
    sourceAsset,
  };
}

export async function completeTranscription(
  db: Db,
  input: {
    job: TranscriptionJob;
    model: string;
    language: string | null;
    languageProbability: number | null;
    durationMs: number | null;
    text: string;
    segments: TranscriptSegment[];
    words: TranscriptWord[];
  },
): Promise<void> {
  await db.query(
    `insert into recording_video_transcripts (
       video_id, model, source_asset_kind, language, language_probability,
       duration_ms, transcript_text, segments, words
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
     on conflict (video_id) do update set
       model = excluded.model, source_asset_kind = excluded.source_asset_kind,
       language = excluded.language, language_probability = excluded.language_probability,
       duration_ms = excluded.duration_ms, transcript_text = excluded.transcript_text,
       segments = excluded.segments, words = excluded.words, updated_at = now()`,
    [
      input.job.videoId,
      input.model,
      input.job.sourceAsset.kind,
      input.language,
      input.languageProbability,
      input.durationMs,
      input.text,
      JSON.stringify(input.segments),
      JSON.stringify(input.words),
    ],
  );
  await db.query(
    `update recording_videos set transcription_status = 'ready', transcription_language = $2,
       transcription_error_message = null, transcription_completed_at = now(), updated_at = now()
     where recording_id = $1`,
    [input.job.recordingId, input.language],
  );
}

export async function failTranscription(
  db: Db,
  recordingId: string,
  message: string,
): Promise<void> {
  await db.query(
    `update recording_videos set transcription_status = 'failed',
       transcription_error_message = $2, transcription_completed_at = now(), updated_at = now()
     where recording_id = $1`,
    [recordingId, message.slice(0, 500)],
  );
}

export async function retryTranscription(
  db: Db,
  recordingId: string,
): Promise<boolean> {
  const result = await db.query(
    `update recording_videos set transcription_status = 'pending',
       transcription_error_message = null, transcription_started_at = null,
       transcription_completed_at = null, updated_at = now()
     where recording_id = $1 and transcription_status in ('disabled', 'failed', 'ready')`,
    [recordingId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getRecordingTranscript(
  db: Db,
  recordingId: string,
): Promise<RecordingTranscript | null> {
  const result = await db.query<VideoRow & Partial<TranscriptRow>>(
    `select v.*, t.model, t.source_asset_kind, t.language, t.language_probability,
       t.duration_ms as transcript_duration_ms, t.transcript_text, t.segments, t.words
     from recording_videos v
     left join recording_video_transcripts t on t.video_id = v.id
     where v.recording_id = $1`,
    [recordingId],
  );
  const row = result.rows[0] as
    | (VideoRow &
        Partial<TranscriptRow> & { transcript_duration_ms?: number | null })
    | undefined;
  if (!row) return null;
  const segments = row.segments ?? [];
  const words = row.words ?? [];
  return {
    status: row.transcription_status,
    model: row.model ?? null,
    language: row.language ?? row.transcription_language,
    languageProbability: row.language_probability ?? null,
    durationMs: row.transcript_duration_ms ?? null,
    sourceAssetKind: row.source_asset_kind ?? null,
    text: row.transcript_text ?? "",
    segments,
    cues: buildTranscriptCues(segments, words),
    words,
    errorMessage: row.transcription_error_message,
  };
}

export async function upsertVideoChapterTitle(
  db: Db,
  input: {
    videoId: string;
    eventId: string;
    title: string;
    source: "ai" | "deterministic";
  },
): Promise<void> {
  await db.query(
    `insert into recording_video_chapter_titles (video_id, event_id, title, source)
     values ($1, $2, $3, $4)
     on conflict (video_id, event_id) do update set
       title = excluded.title, source = excluded.source, updated_at = now()`,
    [input.videoId, input.eventId, input.title, input.source],
  );
}

export async function listVideoChapterTitles(
  db: Db,
  recordingId: string,
): Promise<Map<string, string>> {
  const result = await db.query<{ event_id: string; title: string }>(
    `select c.event_id, c.title from recording_video_chapter_titles c
     join recording_videos v on v.id = c.video_id
     where v.recording_id = $1`,
    [recordingId],
  );
  return new Map(result.rows.map((row) => [row.event_id, row.title]));
}

export async function deleteVideoRows(
  db: Db,
  recordingId: string,
): Promise<void> {
  await db.query("delete from recording_videos where recording_id = $1", [
    recordingId,
  ]);
}

export async function listAbandonedUploads(db: Db): Promise<VideoAssetRow[]> {
  const result = await db.query<VideoAssetRow>(
    `select a.* from recording_video_assets a join recording_videos v on v.id = a.video_id
     where a.status = 'uploading' and v.updated_at < now() - interval '24 hours'`,
  );
  return result.rows;
}

export async function failAbandonedAsset(
  db: Db,
  assetId: string,
): Promise<void> {
  const asset = await db.query<{ video_id: string }>(
    "update recording_video_assets set status = 'failed', multipart_upload_id = null where id = $1 returning video_id",
    [assetId],
  );
  if (asset.rows[0]) {
    await db.query(
      `update recording_videos set status = 'failed', error_message = 'Upload abandoned after 24 hours', updated_at = now()
       where id = $1 and status in ('initializing', 'recording', 'finalizing')`,
      [asset.rows[0].video_id],
    );
  }
}

export async function listExpiredDeletedRecordings(
  db: Db,
): Promise<Array<{ recordingId: string; assets: VideoAssetRow[] }>> {
  const recordings = await db.query<{ id: string }>(
    "select id from recordings where deleted_at < now() - interval '10 days' order by id",
  );
  const result = await db.query<VideoAssetRow & { recording_id: string }>(
    `select a.*, v.recording_id from recording_video_assets a
     join recording_videos v on v.id = a.video_id
     join recordings r on r.id = v.recording_id
     where r.deleted_at < now() - interval '10 days'
     order by v.recording_id`,
  );
  const grouped = new Map<string, VideoAssetRow[]>();
  for (const row of result.rows) {
    const assets = grouped.get(row.recording_id) ?? [];
    assets.push(row);
    grouped.set(row.recording_id, assets);
  }
  return recordings.rows.map(({ id }) => ({
    recordingId: id,
    assets: grouped.get(id) ?? [],
  }));
}

export async function hardDeleteExpiredRecording(
  db: Db,
  recordingId: string,
): Promise<void> {
  await db.query(
    "delete from recordings where id = $1 and deleted_at < now() - interval '10 days'",
    [recordingId],
  );
}
