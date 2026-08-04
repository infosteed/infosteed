// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type {
  GuideItem,
  GuideVersion,
  GuideVersionListItem,
  ScreenshotEditOperations,
} from "@infosteed/shared";
import type { Pool, PoolClient } from "../db.js";
import {
  getRecording,
  listProjectScreenshotsForRecording,
} from "./recordings.js";

type Db = Pool | PoolClient;

export interface GuideVersionSnapshot {
  recording: {
    title: string;
    purpose: string | null;
    audience: string | null;
    projectId: string | null;
  };
  items: GuideItem[];
  screenshotEdits: Array<{
    filename: string;
    editOperations: ScreenshotEditOperations;
  }>;
}

interface VersionRow {
  id: string;
  recording_id: string;
  created_by_user_id: string | null;
  created_by_display_name: string | null;
  version_type: "auto" | "named" | "restore";
  message: string | null;
  snapshot: GuideVersionSnapshot;
  created_at: Date;
  updated_at: Date;
}

function mapVersionList(row: VersionRow): GuideVersionListItem {
  return {
    id: row.id,
    recordingId: row.recording_id,
    createdByUserId: row.created_by_user_id,
    createdByDisplayName: row.created_by_display_name,
    versionType: row.version_type,
    message: row.message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapVersion(row: VersionRow): GuideVersion {
  return {
    ...mapVersionList(row),
    snapshot: row.snapshot as unknown as Record<string, unknown>,
  };
}

export async function buildGuideVersionSnapshot(
  db: Db,
  recordingId: string,
): Promise<GuideVersionSnapshot> {
  const recording = await getRecording(db, recordingId);
  if (!recording) throw new Error("Recording not found");
  const screenshots = await listProjectScreenshotsForRecording(db, recordingId);
  return {
    recording: {
      title: recording.title,
      purpose: recording.purpose,
      audience: recording.audience,
      projectId: recording.projectId ?? null,
    },
    items: recording.items,
    screenshotEdits: screenshots.map((screenshot) => ({
      filename: screenshot.filename,
      editOperations: screenshot.edit_operations ?? { redactions: [] },
    })),
  };
}

export async function createGuideVersion(
  db: Db,
  input: {
    recordingId: string;
    userId: string;
    versionType: "auto" | "named" | "restore";
    message?: string | null;
    snapshot: GuideVersionSnapshot;
    coalesceAuto?: boolean;
  },
): Promise<GuideVersionListItem> {
  if (input.coalesceAuto && input.versionType === "auto") {
    const existing = await db.query<VersionRow>(
      `
        select gv.*, u.display_name as created_by_display_name
        from guide_versions gv
        left join users u on u.id = gv.created_by_user_id
        where gv.recording_id = $1
          and gv.created_by_user_id = $2
          and gv.version_type = 'auto'
          and gv.created_at >= now() - interval '5 minutes'
        order by gv.created_at desc
        limit 1
      `,
      [input.recordingId, input.userId],
    );
    if (existing.rows[0]) {
      const updated = await db.query<VersionRow>(
        `
          update guide_versions
          set snapshot = $2::jsonb, updated_at = now()
          where id = $1
          returning *, (select display_name from users where id = created_by_user_id) as created_by_display_name
        `,
        [existing.rows[0].id, JSON.stringify(input.snapshot)],
      );
      return mapVersionList(updated.rows[0]);
    }
  }

  const result = await db.query<VersionRow>(
    `
      insert into guide_versions (
        id, recording_id, created_by_user_id, version_type, message, snapshot
      )
      values ($1, $2, $3, $4, $5, $6::jsonb)
      returning *, (select display_name from users where id = created_by_user_id) as created_by_display_name
    `,
    [
      randomUUID(),
      input.recordingId,
      input.userId,
      input.versionType,
      input.message ?? null,
      JSON.stringify(input.snapshot),
    ],
  );
  return mapVersionList(result.rows[0]);
}

export async function listGuideVersions(
  db: Db,
  recordingId: string,
): Promise<{ versions: GuideVersionListItem[] }> {
  const result = await db.query<VersionRow>(
    `
      select gv.*, u.display_name as created_by_display_name
      from guide_versions gv
      left join users u on u.id = gv.created_by_user_id
      where gv.recording_id = $1
      order by gv.created_at desc
    `,
    [recordingId],
  );
  return { versions: result.rows.map(mapVersionList) };
}

export async function getGuideVersion(
  db: Db,
  recordingId: string,
  versionId: string,
): Promise<GuideVersion | null> {
  const result = await db.query<VersionRow>(
    `
      select gv.*, u.display_name as created_by_display_name
      from guide_versions gv
      left join users u on u.id = gv.created_by_user_id
      where gv.recording_id = $1 and gv.id = $2
    `,
    [recordingId, versionId],
  );
  return result.rows[0] ? mapVersion(result.rows[0]) : null;
}

export async function restoreGuideVersionCore(
  db: Db,
  recordingId: string,
  snapshot: GuideVersionSnapshot,
): Promise<GuideVersionSnapshot["screenshotEdits"]> {
  await db.query(
    `
      update recordings
      set title = $2, purpose = $3, audience = $4, project_id = $5, updated_at = now()
      where id = $1 and deleted_at is null
    `,
    [
      recordingId,
      snapshot.recording.title,
      snapshot.recording.purpose,
      snapshot.recording.audience,
      snapshot.recording.projectId,
    ],
  );
  await db.query("delete from guide_items where recording_id = $1", [
    recordingId,
  ]);
  for (const item of snapshot.items
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)) {
    await db.query(
      `
        insert into guide_items (
          id, recording_id, event_id, ordinal, kind, title, body,
          image_filename, alt_text, source, user_edited
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        item.id,
        recordingId,
        item.eventId,
        item.ordinal,
        item.kind,
        item.title,
        item.body,
        item.imageFilename,
        item.altText,
        item.source,
        item.userEdited,
      ],
    );
  }
  return snapshot.screenshotEdits ?? [];
}
