// SPDX-License-Identifier: AGPL-3.0-only
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../db.js";
import {
  videoEditRecipeSchema,
  videoEditedDurationMs,
  type RecordingVideoAsset,
  type TranscriptSegment,
  type VideoChapter,
  type VideoEditDraft,
  type VideoEditRecipe,
  type VideoEditVersion,
  type VideoRender,
} from "@infosteed/shared";
import type { VideoAssetRow } from "./videos.js";

type Db = Pool | PoolClient;

interface DraftRow {
  revision: number;
  recipe: VideoEditRecipe;
  updated_at: Date;
}

interface VersionRow {
  id: string;
  revision: number;
  version_type: VideoEditVersion["versionType"];
  name: string | null;
  recipe: VideoEditRecipe;
  media_hash: string;
  created_by_user_id: string | null;
  created_at: Date;
  published_at: Date | null;
}

export interface RenderRow {
  id: string;
  video_id: string;
  edit_version_id: string;
  reused_render_id: string | null;
  media_hash: string;
  status: VideoRender["status"];
  progress: number;
  attempts: number;
  storage_key: string | null;
  mime_type: string | null;
  codec: string | null;
  byte_size: string | number;
  duration_ms: number | null;
  error_message: string | null;
  cancel_requested: boolean;
  started_at: Date | null;
  heartbeat_at: Date | null;
  completed_at: Date | null;
  cleanup_after: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VideoRenderJob {
  render: RenderRow;
  recordingId: string;
  recipe: VideoEditRecipe;
  assets: VideoAssetRow[];
}

function mapVersion(row: VersionRow): VideoEditVersion {
  return {
    id: row.id,
    revision: row.revision,
    versionType: row.version_type,
    name: row.name,
    recipe: videoEditRecipeSchema.parse(row.recipe),
    mediaHash: row.media_hash,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    publishedAt: row.published_at?.toISOString() ?? null,
  };
}

function mapRender(row: RenderRow, draftRevision?: number): VideoRender {
  return {
    id: row.id,
    editVersionId: row.edit_version_id,
    status: row.status,
    progress: row.progress,
    durationMs: row.duration_ms,
    byteSize: Number(row.byte_size),
    errorMessage: row.error_message,
    stale:
      draftRevision !== undefined &&
      row.status === "ready" &&
      row.edit_version_id !== "" &&
      false,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

export function defaultVideoEditRecipe(
  durationMs: number,
  chapters: VideoChapter[],
  input: {
    webcam: boolean;
    screenWidth?: number | null;
    screenHeight?: number | null;
  },
): VideoEditRecipe {
  const width = input.screenWidth ?? 1920;
  const height = input.screenHeight ?? 1080;
  const sizePixels = Math.min(width, height) * 0.22;
  const marginPixels = sizePixels * 0.16;
  return videoEditRecipeSchema.parse({
    version: 1,
    sourceDurationMs: durationMs,
    keepRanges: [{ startMs: 0, endMs: durationMs }],
    webcam: {
      visible: input.webcam,
      centerX: (width - marginPixels - sizePixels / 2) / width,
      centerY: (height - marginPixels - sizePixels / 2) / height,
      diameter: 0.22,
    },
    audio: { tabGain: 1, microphoneGain: 1, voiceoverGain: 1 },
    voiceover: { enabled: false, assetId: null, generationId: null },
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      eventId: chapter.eventId,
      guideItemId: chapter.guideItemId,
      title: chapter.title,
      sourceOffsetMs: chapter.offsetMs,
      ordinal: chapter.ordinal,
      hidden: false,
      custom: false,
      titleEdited: false,
      offsetEdited: false,
    })),
    captions: { mode: "transcript" },
  });
}

export function videoMediaHash(recipe: VideoEditRecipe): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        keepRanges: recipe.keepRanges,
        webcam: recipe.webcam,
        audio: recipe.audio,
        voiceover: recipe.voiceover,
      }),
    )
    .digest("hex");
}

export async function getOrCreateVideoEditDraft(
  db: Db,
  recordingId: string,
  chapters: VideoChapter[],
): Promise<VideoEditDraft | null> {
  const existing = await db.query<DraftRow & { video_id: string }>(
    `select d.video_id, d.revision, d.recipe, d.updated_at from recording_video_edit_drafts d
     join recording_videos v on v.id = d.video_id where v.recording_id = $1`,
    [recordingId],
  );
  if (existing.rows[0]) {
    const current = existing.rows[0];
    const parsed = videoEditRecipeSchema.parse(current.recipe);
    const baseById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const synchronized = {
      ...parsed,
      chapters: parsed.chapters.map((chapter) => {
        if (chapter.custom) return chapter;
        const base = baseById.get(chapter.id);
        if (!base) return chapter;
        return {
          ...chapter,
          eventId: base.eventId,
          guideItemId: base.guideItemId,
          title: chapter.titleEdited ? chapter.title : base.title,
          sourceOffsetMs: chapter.offsetEdited
            ? chapter.sourceOffsetMs
            : base.offsetMs,
          ordinal: base.ordinal,
        };
      }),
    };
    const known = new Set(synchronized.chapters.map((chapter) => chapter.id));
    for (const base of chapters) {
      if (known.has(base.id)) continue;
      synchronized.chapters.push({
        id: base.id,
        eventId: base.eventId,
        guideItemId: base.guideItemId,
        title: base.title,
        sourceOffsetMs: base.offsetMs,
        ordinal: base.ordinal,
        hidden: false,
        custom: false,
        titleEdited: false,
        offsetEdited: false,
      });
    }
    const next = videoEditRecipeSchema.parse(synchronized);
    if (JSON.stringify(next) !== JSON.stringify(parsed)) {
      const updated = await db.query<DraftRow>(
        `update recording_video_edit_drafts set revision = revision + 1, recipe = $2::jsonb, updated_at = now()
         where video_id = $1 returning revision, recipe, updated_at`,
        [current.video_id, JSON.stringify(next)],
      );
      return {
        revision: updated.rows[0].revision,
        recipe: videoEditRecipeSchema.parse(updated.rows[0].recipe),
        updatedAt: updated.rows[0].updated_at.toISOString(),
      };
    }
    return {
      revision: current.revision,
      recipe: parsed,
      updatedAt: current.updated_at.toISOString(),
    };
  }
  const source = await db.query<{
    video_id: string;
    duration_ms: number | null;
    capture_settings: { webcam?: boolean };
    width: number | null;
    height: number | null;
  }>(
    `select v.id as video_id, v.duration_ms, v.capture_settings, a.width, a.height
     from recording_videos v
     left join recording_video_assets a on a.video_id = v.id and a.kind = 'screen'
     where v.recording_id = $1`,
    [recordingId],
  );
  const row = source.rows[0];
  if (!row?.duration_ms || row.duration_ms < 500) return null;
  const recipe = defaultVideoEditRecipe(row.duration_ms, chapters, {
    webcam: Boolean(row.capture_settings.webcam),
    screenWidth: row.width,
    screenHeight: row.height,
  });
  const inserted = await db.query<DraftRow>(
    `insert into recording_video_edit_drafts (video_id, revision, recipe)
     values ($1, 0, $2::jsonb)
     on conflict (video_id) do update set video_id = excluded.video_id
     returning revision, recipe, updated_at`,
    [row.video_id, JSON.stringify(recipe)],
  );
  return {
    revision: inserted.rows[0].revision,
    recipe: videoEditRecipeSchema.parse(inserted.rows[0].recipe),
    updatedAt: inserted.rows[0].updated_at.toISOString(),
  };
}

export async function saveVideoEditDraft(
  db: Db,
  recordingId: string,
  userId: string,
  expectedRevision: number,
  recipe: VideoEditRecipe,
): Promise<VideoEditDraft | null> {
  const parsed = videoEditRecipeSchema.parse(recipe);
  const result = await db.query<DraftRow>(
    `update recording_video_edit_drafts d set revision = revision + 1, recipe = $4::jsonb,
       updated_by_user_id = $3, updated_at = now()
     from recording_videos v
     where d.video_id = v.id and v.recording_id = $1 and d.revision = $2
     returning d.revision, d.recipe, d.updated_at`,
    [recordingId, expectedRevision, userId, JSON.stringify(parsed)],
  );
  const row = result.rows[0];
  return row
    ? {
        revision: row.revision,
        recipe: videoEditRecipeSchema.parse(row.recipe),
        updatedAt: row.updated_at.toISOString(),
      }
    : null;
}

export async function resetVideoEditDraft(
  db: Db,
  recordingId: string,
  userId: string,
  chapters: VideoChapter[],
): Promise<VideoEditDraft | null> {
  const current = await getOrCreateVideoEditDraft(db, recordingId, chapters);
  if (!current) return null;
  const source = await db.query<{
    capture_settings: { webcam?: boolean };
    width: number | null;
    height: number | null;
  }>(
    `select v.capture_settings, a.width, a.height from recording_videos v
     left join recording_video_assets a on a.video_id = v.id and a.kind = 'screen'
     where v.recording_id = $1`,
    [recordingId],
  );
  const defaults = defaultVideoEditRecipe(
    current.recipe.sourceDurationMs,
    chapters,
    {
      webcam: Boolean(source.rows[0]?.capture_settings.webcam),
      screenWidth: source.rows[0]?.width,
      screenHeight: source.rows[0]?.height,
    },
  );
  return saveVideoEditDraft(
    db,
    recordingId,
    userId,
    current.revision,
    defaults,
  );
}

export async function listVideoEditVersions(
  db: Db,
  recordingId: string,
): Promise<VideoEditVersion[]> {
  const result = await db.query<VersionRow>(
    `select ev.* from recording_video_edit_versions ev
     join recording_videos v on v.id = ev.video_id
     where v.recording_id = $1 order by ev.created_at desc limit 100`,
    [recordingId],
  );
  return result.rows.map(mapVersion);
}

export async function createVideoEditVersion(
  db: Db,
  input: {
    recordingId: string;
    userId: string;
    versionType: VideoEditVersion["versionType"];
    name?: string | null;
    expectedRevision?: number;
  },
): Promise<VideoEditVersion | null> {
  const draft = await db.query<DraftRow & { video_id: string }>(
    `select d.*, v.id as video_id from recording_video_edit_drafts d
     join recording_videos v on v.id = d.video_id
     where v.recording_id = $1${input.expectedRevision === undefined ? "" : " and d.revision = $2"}`,
    input.expectedRevision === undefined
      ? [input.recordingId]
      : [input.recordingId, input.expectedRevision],
  );
  const row = draft.rows[0];
  if (!row) return null;
  const recipe = videoEditRecipeSchema.parse(row.recipe);
  const version = await db.query<VersionRow>(
    `insert into recording_video_edit_versions
       (id, video_id, revision, version_type, name, recipe, media_hash, created_by_user_id)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) returning *`,
    [
      randomUUID(),
      row.video_id,
      row.revision,
      input.versionType,
      input.name ?? null,
      JSON.stringify(recipe),
      videoMediaHash(recipe),
      input.userId,
    ],
  );
  return mapVersion(version.rows[0]);
}

export async function restoreVideoEditVersion(
  db: Db,
  input: { recordingId: string; versionId: string; userId: string },
): Promise<VideoEditDraft | null> {
  const result = await db.query<DraftRow>(
    `update recording_video_edit_drafts d set revision = revision + 1, recipe = ev.recipe,
       updated_by_user_id = $3, updated_at = now()
     from recording_videos v, recording_video_edit_versions ev
     where d.video_id = v.id and ev.video_id = v.id and v.recording_id = $1 and ev.id = $2
     returning d.revision, d.recipe, d.updated_at`,
    [input.recordingId, input.versionId, input.userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  await createVideoEditVersion(db, {
    recordingId: input.recordingId,
    userId: input.userId,
    versionType: "restore",
    name: "Restored edit version",
  });
  return {
    revision: row.revision,
    recipe: videoEditRecipeSchema.parse(row.recipe),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listVideoRenders(
  db: Db,
  recordingId: string,
): Promise<VideoRender[]> {
  const revision = await db.query<{ revision: number }>(
    `select d.revision from recording_video_edit_drafts d join recording_videos v on v.id = d.video_id where v.recording_id = $1`,
    [recordingId],
  );
  const result = await db.query<RenderRow & { edit_revision: number }>(
    `select r.*, ev.revision as edit_revision from recording_video_renders r
     join recording_videos v on v.id = r.video_id
     join recording_video_edit_versions ev on ev.id = r.edit_version_id
     where v.recording_id = $1 order by r.created_at desc limit 30`,
    [recordingId],
  );
  return result.rows.map((row) => ({
    ...mapRender(row),
    stale: row.edit_revision !== revision.rows[0]?.revision,
  }));
}

export async function createVideoRender(
  db: Db,
  input: {
    recordingId: string;
    userId: string;
    expectedRevision: number;
    name?: string | null;
  },
): Promise<VideoRender | null> {
  const version = await createVideoEditVersion(db, {
    recordingId: input.recordingId,
    userId: input.userId,
    versionType: "render",
    name: input.name,
    expectedRevision: input.expectedRevision,
  });
  if (!version) return null;
  const video = await db.query<{
    id: string;
    duration_ms: number;
    capture_settings: { webcam?: boolean };
    width: number | null;
    height: number | null;
  }>(
    `select v.id, v.duration_ms, v.capture_settings, a.width, a.height from recording_videos v
     left join recording_video_assets a on a.video_id = v.id and a.kind = 'screen'
     where v.recording_id = $1`,
    [input.recordingId],
  );
  const videoRow = video.rows[0];
  if (!videoRow) return null;
  const defaultRecipe = defaultVideoEditRecipe(
    videoRow.duration_ms,
    version.recipe.chapters.map((chapter) => ({
      id: chapter.id,
      eventId: chapter.eventId,
      guideItemId: chapter.guideItemId,
      title: chapter.title,
      offsetMs: chapter.sourceOffsetMs,
      ordinal: chapter.ordinal,
    })),
    {
      webcam: Boolean(videoRow.capture_settings.webcam),
      screenWidth: videoRow.width,
      screenHeight: videoRow.height,
    },
  );
  const originalMedia =
    videoMediaHash(version.recipe) === videoMediaHash(defaultRecipe);
  const reusable = originalMedia
    ? undefined
    : (
        await db.query<RenderRow>(
          `select * from recording_video_renders where video_id = $1 and media_hash = $2 and status = 'ready'
     order by completed_at desc limit 1`,
          [videoRow.id, version.mediaHash],
        )
      ).rows[0];
  const status: RenderRow["status"] =
    originalMedia || reusable ? "ready" : "queued";
  const result = await db.query<RenderRow>(
    `insert into recording_video_renders
       (id, video_id, edit_version_id, reused_render_id, media_hash, status, progress, duration_ms, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, case when $6 = 'ready' then now() else null end)
     returning *`,
    [
      randomUUID(),
      videoRow.id,
      version.id,
      reusable?.id ?? null,
      version.mediaHash,
      status,
      status === "ready" ? 1 : 0,
      originalMedia
        ? videoEditedDurationMs(version.recipe)
        : (reusable?.duration_ms ?? null),
    ],
  );
  return mapRender(result.rows[0], input.expectedRevision);
}

export async function getVideoRender(
  db: Db,
  recordingId: string,
  renderId: string,
): Promise<(VideoRender & { storageKey: string | null }) | null> {
  const result = await db.query<
    RenderRow & {
      resolved_storage_key: string | null;
      edit_revision: number;
      draft_revision: number;
    }
  >(
    `with recursive resolved as (
       select r.*, r.storage_key as resolved_storage_key from recording_video_renders r where r.id = $2
       union all
       select parent.*, parent.storage_key from recording_video_renders parent
       join resolved child on parent.id = child.reused_render_id where child.resolved_storage_key is null
     )
     select target.*, coalesce((select resolved_storage_key from resolved where resolved_storage_key is not null limit 1), target.storage_key) as resolved_storage_key,
       ev.revision as edit_revision, d.revision as draft_revision
     from recording_video_renders target
     join recording_videos v on v.id = target.video_id
     join recording_video_edit_versions ev on ev.id = target.edit_version_id
     join recording_video_edit_drafts d on d.video_id = v.id
     where v.recording_id = $1 and target.id = $2`,
    [recordingId, renderId],
  );
  const row = result.rows[0];
  return row
    ? {
        ...mapRender(row),
        stale: row.edit_revision !== row.draft_revision,
        storageKey: row.resolved_storage_key,
      }
    : null;
}

export async function requestRenderCancellation(
  db: Db,
  recordingId: string,
  renderId: string,
): Promise<boolean> {
  const result = await db.query(
    `update recording_video_renders r set cancel_requested = true,
       status = case when status = 'queued' then 'canceled' else status end, updated_at = now()
     from recording_videos v where r.video_id = v.id and v.recording_id = $1 and r.id = $2
       and r.status in ('queued', 'processing')`,
    [recordingId, renderId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function publishVideoRender(
  db: Db,
  recordingId: string,
  renderId: string,
  retentionDays = 7,
): Promise<boolean> {
  const result = await db.query<{ edit_version_id: string }>(
    `with candidate as (
       select r.edit_version_id from recording_video_renders r
       join recording_videos v on v.id = r.video_id
       join recording_video_edit_versions ev on ev.id = r.edit_version_id
       join recording_video_edit_drafts d on d.video_id = v.id
       where v.recording_id = $1 and r.id = $2 and r.status = 'ready' and ev.revision = d.revision
     ), updated as (
       update recording_videos v set published_edit_version_id = candidate.edit_version_id,
         status = 'published', published_at = now(), updated_at = now()
       from candidate where v.recording_id = $1 returning candidate.edit_version_id
     )
     update recording_video_edit_versions ev set published_at = now()
     from updated where ev.id = updated.edit_version_id returning ev.id as edit_version_id`,
    [recordingId, renderId],
  );
  const published = (result.rowCount ?? 0) > 0;
  if (published) {
    await db.query(
      `update recording_video_renders old set cleanup_after = now() + ($3::text || ' days')::interval, updated_at = now()
       from recording_videos v, recording_video_renders current
       where old.video_id = v.id and current.id = $2 and current.video_id = v.id and v.recording_id = $1
         and old.id <> current.id and old.status = 'ready'
         and old.id is distinct from current.reused_render_id and old.cleanup_after is null`,
      [recordingId, renderId, retentionDays],
    );
  }
  return published;
}

export async function getPublishedVideoEditRecipe(
  db: Db,
  recordingId: string,
): Promise<{
  versionId: string;
  recipe: VideoEditRecipe;
  render: RenderRow | null;
} | null> {
  const result = await db.query<VersionRow & { render_id: string | null }>(
    `select ev.*, r.id as render_id from recording_videos v
     join recording_video_edit_versions ev on ev.id = v.published_edit_version_id
     left join recording_video_renders r on r.edit_version_id = ev.id
     where v.recording_id = $1`,
    [recordingId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const render = row.render_id
    ? ((
        await db.query<RenderRow>(
          "select * from recording_video_renders where id = $1",
          [row.render_id],
        )
      ).rows[0] ?? null)
    : null;
  return {
    versionId: row.id,
    recipe: videoEditRecipeSchema.parse(row.recipe),
    render,
  };
}

export async function resolvePublishedRenderStorageKey(
  db: Db,
  recordingId: string,
): Promise<string | null> {
  const result = await db.query<{ storage_key: string | null }>(
    `with recursive chain as (
       select r.id, r.reused_render_id, r.storage_key from recording_videos v
       join recording_video_renders r on r.edit_version_id = v.published_edit_version_id
       where v.recording_id = $1
       union all
       select parent.id, parent.reused_render_id, parent.storage_key
       from recording_video_renders parent join chain child on parent.id = child.reused_render_id
     ) select storage_key from chain where storage_key is not null limit 1`,
    [recordingId],
  );
  return result.rows[0]?.storage_key ?? null;
}

export async function videoRenderWorkerAvailable(db: Db): Promise<boolean> {
  const result = await db.query(
    "select 1 from recording_video_render_workers where heartbeat_at > now() - interval '30 seconds' limit 1",
  );
  return (result.rowCount ?? 0) > 0;
}

export async function claimNextVideoRender(
  db: Db,
): Promise<VideoRenderJob | null> {
  const claimed = await db.query<
    RenderRow & { recording_id: string; recipe: VideoEditRecipe }
  >(
    `with candidate as (
       select id from recording_video_renders where status = 'queued' order by created_at
       for update skip locked limit 1
     )
     update recording_video_renders r set status = 'processing', attempts = attempts + 1,
       started_at = now(), heartbeat_at = now(), updated_at = now(), error_message = null
     from candidate, recording_video_edit_versions ev, recording_videos v
     where r.id = candidate.id and ev.id = r.edit_version_id and v.id = r.video_id
     returning r.*, v.recording_id, ev.recipe`,
  );
  const row = claimed.rows[0];
  if (!row) return null;
  const assets = await db.query<VideoAssetRow>(
    "select * from recording_video_assets where video_id = $1 and status = 'complete' order by kind",
    [row.video_id],
  );
  return {
    render: row,
    recordingId: row.recording_id,
    recipe: videoEditRecipeSchema.parse(row.recipe),
    assets: assets.rows,
  };
}

export async function updateVideoRenderProgress(
  db: Db,
  renderId: string,
  progress: number,
): Promise<boolean> {
  const result = await db.query<{ cancel_requested: boolean }>(
    `update recording_video_renders set progress = greatest(progress, $2), heartbeat_at = now(), updated_at = now()
     where id = $1 and status = 'processing' returning cancel_requested`,
    [renderId, Math.max(0, Math.min(0.99, progress))],
  );
  return Boolean(result.rows[0]?.cancel_requested);
}

export async function completeVideoRender(
  db: Db,
  input: {
    renderId: string;
    storageKey: string;
    byteSize: number;
    durationMs: number;
  },
): Promise<void> {
  await db.query(
    `update recording_video_renders set status = 'ready', progress = 1, storage_key = $2,
       mime_type = 'video/webm', codec = 'vp9,opus', byte_size = $3, duration_ms = $4,
       completed_at = now(), heartbeat_at = now(), updated_at = now(), error_message = null
     where id = $1`,
    [input.renderId, input.storageKey, input.byteSize, input.durationMs],
  );
}

export async function failVideoRender(
  db: Db,
  renderId: string,
  message: string,
  canceled = false,
): Promise<void> {
  await db.query(
    `update recording_video_renders set status = $2, error_message = $3, completed_at = now(), updated_at = now()
     where id = $1`,
    [renderId, canceled ? "canceled" : "failed", message.slice(0, 500)],
  );
}

export async function heartbeatVideoRenderWorker(
  db: Db,
  workerId: string,
): Promise<void> {
  await db.query(
    `insert into recording_video_render_workers (id) values ($1)
     on conflict (id) do update set heartbeat_at = now()`,
    [workerId],
  );
}

export async function requeueStaleVideoRenders(
  db: Db,
  staleMs: number,
): Promise<number> {
  const result = await db.query(
    `update recording_video_renders set status = case when attempts < 2 then 'queued' else 'failed' end,
       error_message = 'Previous render worker stopped before completion', updated_at = now()
     where status = 'processing' and heartbeat_at < now() - ($1::text || ' milliseconds')::interval`,
    [staleMs],
  );
  return result.rowCount ?? 0;
}

export async function listRenderStorageForVideo(
  db: Db,
  recordingId: string,
): Promise<Array<{ storageKey: string }>> {
  const result = await db.query<{ storage_key: string }>(
    `select distinct r.storage_key from recording_video_renders r
     join recording_videos v on v.id = r.video_id where v.recording_id = $1 and r.storage_key is not null`,
    [recordingId],
  );
  return result.rows.map((row) => ({ storageKey: row.storage_key }));
}

export async function listExpiredRenderOutputs(
  db: Db,
): Promise<Array<{ renderId: string; storageKey: string }>> {
  const result = await db.query<{ id: string; storage_key: string }>(
    `select r.id, r.storage_key from recording_video_renders r
     join recording_videos v on v.id = r.video_id
     where r.cleanup_after < now() and r.storage_key is not null
       and r.edit_version_id is distinct from v.published_edit_version_id
       and not exists (
         select 1 from recording_video_renders child
         where child.reused_render_id = r.id and child.status = 'ready' and child.cleanup_after is null
       )`,
  );
  return result.rows.map((row) => ({
    renderId: row.id,
    storageKey: row.storage_key,
  }));
}

export async function expireRenderOutput(
  db: Db,
  renderId: string,
): Promise<void> {
  await db.query(
    `update recording_video_renders set status = 'expired', storage_key = null, byte_size = 0, updated_at = now()
     where id = $1 and cleanup_after < now()`,
    [renderId],
  );
}

export async function expireMetadataOnlyRenders(db: Db): Promise<void> {
  await db.query(
    `update recording_video_renders set status = 'expired', updated_at = now()
     where cleanup_after < now() and storage_key is null and status = 'ready'`,
  );
}

export async function getSourceAssetsForEditor(
  db: Db,
  recordingId: string,
): Promise<VideoAssetRow[]> {
  const result = await db.query<VideoAssetRow>(
    `select a.* from recording_video_assets a join recording_videos v on v.id = a.video_id
     where v.recording_id = $1 and a.status = 'complete' order by a.kind`,
    [recordingId],
  );
  return result.rows;
}

export function mapSourceAssetForEditor(
  row: VideoAssetRow,
): RecordingVideoAsset {
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

export function effectiveCaptionsForRecipe(
  recipe: VideoEditRecipe,
  sourceCues: TranscriptSegment[],
): TranscriptSegment[] {
  return recipe.captions.mode === "transcript"
    ? sourceCues
    : recipe.captions.cues.map((cue, id) => ({
        id,
        startMs: cue.sourceStartMs,
        endMs: cue.sourceEndMs,
        text: cue.text,
      }));
}
