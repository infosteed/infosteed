// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../db.js";
import type {
  CreateVoiceoverRequest,
  VoiceoverCue,
  VoiceoverGeneration,
} from "@infosteed/shared";

type Db = Pool | PoolClient;

interface GenerationRow {
  id: string;
  video_id: string;
  recording_id?: string;
  status: VoiceoverGeneration["status"];
  progress: number;
  attempts: number;
  provider: string;
  model: string;
  voice: string;
  speed: number;
  script_hash: string;
  asset_id: string | null;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export interface VoiceoverCueRow {
  generation_id: string;
  cue_id: string;
  ordinal: number;
  source_start_ms: number;
  source_end_ms: number;
  text: string;
  content_hash: string;
  status: VoiceoverCue["status"];
  clip_id: string | null;
  duration_ms: number | null;
  overlong_by_ms: number;
  error_message: string | null;
  storage_key?: string | null;
}

export interface VoiceoverClipRow {
  id: string;
  content_hash: string;
  storage_key: string;
  byte_size: string | number;
  duration_ms: number;
}

export async function listOrphanedVoiceoverClips(
  db: Db,
): Promise<VoiceoverClipRow[]> {
  const result = await db.query<VoiceoverClipRow>(
    `select clip.* from recording_voiceover_clips clip
     where not exists (
       select 1 from recording_voiceover_generation_cues cue where cue.clip_id = clip.id
     ) and clip.created_at < now() - interval '1 day'`,
  );
  return result.rows;
}

export async function deleteOrphanedVoiceoverClip(
  db: Db,
  id: string,
): Promise<void> {
  await db.query(
    `delete from recording_voiceover_clips clip where clip.id = $1 and not exists (
       select 1 from recording_voiceover_generation_cues cue where cue.clip_id = clip.id
     )`,
    [id],
  );
}

export interface VoiceoverJob {
  generation: GenerationRow & {
    recording_id: string;
    source_duration_ms: number;
  };
  cues: VoiceoverCueRow[];
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function voiceoverClipHash(input: {
  provider: string;
  model: string;
  voice: string;
  speed: number;
  text: string;
}): string {
  return stableHash({ ...input, text: input.text.trim().replace(/\s+/g, " ") });
}

export function voiceoverRequestHash(input: {
  provider: string;
  model: string;
  request: CreateVoiceoverRequest;
}): string {
  return stableHash({
    provider: input.provider,
    model: input.model,
    voice: input.request.voice,
    speed: input.request.speed,
    cues: input.request.cues.map((cue) => ({
      id: cue.id,
      sourceStartMs: cue.sourceStartMs,
      sourceEndMs: cue.sourceEndMs,
      text: cue.text.trim().replace(/\s+/g, " "),
    })),
  });
}

export function voiceoverOverlongByMs(
  durationMs: number,
  sourceStartMs: number,
  sourceEndMs: number,
): number {
  return Math.max(0, durationMs - (sourceEndMs - sourceStartMs));
}

function mapCue(row: VoiceoverCueRow): VoiceoverCue {
  return {
    id: row.cue_id,
    ordinal: row.ordinal,
    sourceStartMs: row.source_start_ms,
    sourceEndMs: row.source_end_ms,
    text: row.text,
    contentHash: row.content_hash,
    status: row.status,
    durationMs: row.duration_ms,
    overlongByMs: row.overlong_by_ms,
    errorMessage: row.error_message,
  };
}

async function mapGeneration(
  db: Db,
  row: GenerationRow,
): Promise<VoiceoverGeneration> {
  const cues = await db.query<VoiceoverCueRow>(
    "select * from recording_voiceover_generation_cues where generation_id = $1 order by ordinal",
    [row.id],
  );
  return {
    id: row.id,
    status: row.status,
    progress: row.progress,
    provider: row.provider,
    model: row.model,
    voice: row.voice,
    speed: row.speed,
    scriptHash: row.script_hash,
    assetId: row.asset_id,
    errorMessage: row.error_message,
    attempts: row.attempts,
    cues: cues.rows.map(mapCue),
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export async function queueVoiceoverGeneration(
  db: Db,
  input: {
    recordingId: string;
    userId: string;
    provider: string;
    model: string;
    request: CreateVoiceoverRequest;
  },
): Promise<VoiceoverGeneration | null> {
  const video = await db.query<{ id: string; duration_ms: number | null }>(
    "select id, duration_ms from recording_videos where recording_id = $1 and status in ('ready', 'published')",
    [input.recordingId],
  );
  const videoRow = video.rows[0];
  if (!videoRow?.duration_ms) return null;
  const sourceDurationMs = videoRow.duration_ms;
  if (input.request.cues.some((cue) => cue.sourceEndMs > sourceDurationMs))
    return null;
  const requestHash = voiceoverRequestHash(input);
  const scriptHash = stableHash(
    input.request.cues.map((cue) => ({
      id: cue.id,
      start: cue.sourceStartMs,
      end: cue.sourceEndMs,
      text: cue.text,
    })),
  );
  const inserted = await db.query<GenerationRow>(
    `insert into recording_voiceover_generations
       (id, video_id, created_by_user_id, status, provider, model, voice, speed, script_hash, request_hash)
     values ($1, $2, $3, 'queued', $4, $5, $6, $7, $8, $9)
     on conflict (video_id, request_hash) do update set
       status = case when recording_voiceover_generations.status = 'failed' then 'queued' else recording_voiceover_generations.status end,
       progress = case when recording_voiceover_generations.status = 'failed' then 0 else recording_voiceover_generations.progress end,
       error_message = case when recording_voiceover_generations.status = 'failed' then null else recording_voiceover_generations.error_message end,
       completed_at = case when recording_voiceover_generations.status = 'failed' then null else recording_voiceover_generations.completed_at end,
       updated_at = now()
     returning *`,
    [
      randomUUID(),
      videoRow.id,
      input.userId,
      input.provider,
      input.model,
      input.request.voice,
      input.request.speed,
      scriptHash,
      requestHash,
    ],
  );
  const generation = inserted.rows[0];
  for (let ordinal = 0; ordinal < input.request.cues.length; ordinal += 1) {
    const cue = input.request.cues[ordinal];
    const contentHash = voiceoverClipHash({
      provider: input.provider,
      model: input.model,
      voice: input.request.voice,
      speed: input.request.speed,
      text: cue.text,
    });
    await db.query(
      `insert into recording_voiceover_generation_cues
         (generation_id, cue_id, ordinal, source_start_ms, source_end_ms, text, content_hash)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (generation_id, cue_id) do nothing`,
      [
        generation.id,
        cue.id,
        ordinal,
        cue.sourceStartMs,
        cue.sourceEndMs,
        cue.text,
        contentHash,
      ],
    );
  }
  return mapGeneration(db, generation);
}

export async function getVoiceoverGeneration(
  db: Db,
  recordingId: string,
  generationId: string,
): Promise<VoiceoverGeneration | null> {
  const result = await db.query<GenerationRow>(
    `select g.* from recording_voiceover_generations g join recording_videos v on v.id = g.video_id
     where v.recording_id = $1 and g.id = $2`,
    [recordingId, generationId],
  );
  return result.rows[0] ? mapGeneration(db, result.rows[0]) : null;
}

export async function getLatestVoiceoverGeneration(
  db: Db,
  recordingId: string,
): Promise<VoiceoverGeneration | null> {
  const result = await db.query<GenerationRow>(
    `select g.* from recording_voiceover_generations g join recording_videos v on v.id = g.video_id
     where v.recording_id = $1 order by g.created_at desc limit 1`,
    [recordingId],
  );
  return result.rows[0] ? mapGeneration(db, result.rows[0]) : null;
}

export async function claimNextVoiceover(db: Db): Promise<VoiceoverJob | null> {
  const result = await db.query<
    GenerationRow & { recording_id: string; source_duration_ms: number }
  >(
    `with candidate as (
       select id from recording_voiceover_generations where status = 'queued' order by created_at
       for update skip locked limit 1
     )
     update recording_voiceover_generations g set status = 'processing', attempts = attempts + 1,
       started_at = now(), heartbeat_at = now(), updated_at = now(), error_message = null
     from candidate, recording_videos v
     where g.id = candidate.id and v.id = g.video_id
     returning g.*, v.recording_id, v.duration_ms as source_duration_ms`,
  );
  const generation = result.rows[0];
  if (!generation) return null;
  const cues = await db.query<VoiceoverCueRow>(
    "select * from recording_voiceover_generation_cues where generation_id = $1 order by ordinal",
    [generation.id],
  );
  return { generation, cues: cues.rows };
}

export async function findVoiceoverClip(
  db: Db,
  contentHash: string,
): Promise<VoiceoverClipRow | null> {
  const result = await db.query<VoiceoverClipRow>(
    "select * from recording_voiceover_clips where content_hash = $1",
    [contentHash],
  );
  return result.rows[0] ?? null;
}

export async function saveVoiceoverClip(
  db: Db,
  input: {
    hash: string;
    provider: string;
    model: string;
    voice: string;
    speed: number;
    text: string;
    storageKey: string;
    byteSize: number;
    durationMs: number;
  },
): Promise<VoiceoverClipRow> {
  const result = await db.query<VoiceoverClipRow>(
    `insert into recording_voiceover_clips
       (id, content_hash, provider, model, voice, speed, text, storage_key, byte_size, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (content_hash) do update set content_hash = excluded.content_hash returning *`,
    [
      randomUUID(),
      input.hash,
      input.provider,
      input.model,
      input.voice,
      input.speed,
      input.text,
      input.storageKey,
      input.byteSize,
      input.durationMs,
    ],
  );
  return result.rows[0];
}

export async function completeVoiceoverCue(
  db: Db,
  generationId: string,
  cueId: string,
  clip: VoiceoverClipRow,
  overlongByMs: number,
): Promise<void> {
  await db.query(
    `update recording_voiceover_generation_cues set status = 'ready', clip_id = $3, duration_ms = $4,
       overlong_by_ms = $5, error_message = null
     where generation_id = $1 and cue_id = $2`,
    [generationId, cueId, clip.id, clip.duration_ms, overlongByMs],
  );
  await db.query(
    `update recording_voiceover_generations set progress = (
       select count(*) filter (where status = 'ready')::double precision / greatest(count(*), 1)
       from recording_voiceover_generation_cues where generation_id = $1
     ), heartbeat_at = now(), updated_at = now() where id = $1`,
    [generationId],
  );
}

export async function failVoiceoverCue(
  db: Db,
  generationId: string,
  cueId: string,
  message: string,
): Promise<void> {
  await db.query(
    `update recording_voiceover_generation_cues set status = 'failed', error_message = $3
     where generation_id = $1 and cue_id = $2`,
    [generationId, cueId, message.slice(0, 500)],
  );
}

export async function completeVoiceoverGeneration(
  db: Db,
  input: {
    generationId: string;
    storageKey: string;
    byteSize: number;
    durationMs: number;
  },
): Promise<{ assetId: string }> {
  const current = await db.query<{ video_id: string; asset_id: string | null }>(
    `select g.video_id, g.asset_id from recording_voiceover_generations g where g.id = $1`,
    [input.generationId],
  );
  const row = current.rows[0];
  if (!row) throw new Error("Voiceover generation was deleted");
  let assetId = row.asset_id;
  if (!assetId) {
    const candidateId = randomUUID();
    const asset = await db.query<{ id: string }>(
      `insert into recording_video_assets
         (id, video_id, kind, mime_type, codec, storage_key, byte_size, duration_ms, status, completed_at)
       values ($1, $2, 'voiceover', 'audio/wav', 'pcm_s16le', $3, $4, $5, 'complete', now())
       on conflict (storage_key) do update set storage_key = excluded.storage_key returning id`,
      [
        candidateId,
        row.video_id,
        input.storageKey,
        input.byteSize,
        input.durationMs,
      ],
    );
    assetId = asset.rows[0].id;
  }
  await db.query(
    `update recording_voiceover_generations set status = 'ready', progress = 1, asset_id = $2,
       completed_at = now(), heartbeat_at = now(), updated_at = now(), error_message = null where id = $1`,
    [input.generationId, assetId],
  );
  return { assetId };
}

export async function failVoiceoverGeneration(
  db: Db,
  generationId: string,
  message: string,
): Promise<void> {
  await db.query(
    `update recording_voiceover_generations set status = 'failed', error_message = $2,
       completed_at = now(), updated_at = now() where id = $1`,
    [generationId, message.slice(0, 500)],
  );
}

export async function requeueStaleVoiceovers(db: Db): Promise<number> {
  const result = await db.query(
    `update recording_voiceover_generations set status = case when attempts < 3 then 'queued' else 'failed' end,
       error_message = 'Previous voiceover worker stopped before completion', updated_at = now()
     where status = 'processing'`,
  );
  return result.rowCount ?? 0;
}

export async function getVoiceoverCueClip(
  db: Db,
  recordingId: string,
  generationId: string,
  cueId: string,
): Promise<{ storageKey: string; mimeType: string } | null> {
  const result = await db.query<{ storage_key: string; mime_type: string }>(
    `select clip.storage_key, clip.mime_type from recording_voiceover_generation_cues cue
     join recording_voiceover_generations g on g.id = cue.generation_id
     join recording_videos v on v.id = g.video_id
     join recording_voiceover_clips clip on clip.id = cue.clip_id
     where v.recording_id = $1 and g.id = $2 and cue.cue_id = $3 and cue.status = 'ready'`,
    [recordingId, generationId, cueId],
  );
  return result.rows[0]
    ? {
        storageKey: result.rows[0].storage_key,
        mimeType: result.rows[0].mime_type,
      }
    : null;
}

export async function listVoiceoverStorageForVideo(
  db: Db,
  recordingId: string,
): Promise<Array<{ storageKey: string }>> {
  const result = await db.query<{ storage_key: string }>(
    `select distinct a.storage_key from recording_video_assets a join recording_videos v on v.id = a.video_id
     where v.recording_id = $1 and a.kind = 'voiceover'`,
    [recordingId],
  );
  return result.rows.map((row) => ({ storageKey: row.storage_key }));
}
