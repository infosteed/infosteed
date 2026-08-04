// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../db.js";
import type {
  CreateRecordingRequest,
  GuideItem,
  GuideItemKind,
  GuideStep,
  Recording,
  RecordingEventInput,
  RecordingProject,
  ScreenshotEditOperations,
} from "@infosteed/shared";

type Db = Pool | PoolClient;

interface EventRow {
  id: string;
  recording_id: string;
  capture_session_id: string | null;
  ordinal: number;
  action_type: string;
  page_title: string;
  sanitized_url: string;
  element_name: string | null;
  element_role: string | null;
  label_text: string | null;
  nearby_heading: string | null;
  input_category: string | null;
  bounding_box: unknown;
  metadata: Record<string, unknown>;
  video_offset_ms: number | null;
}

interface CaptureSessionRow {
  id: string;
  recording_id: string;
  started_by_user_id: string | null;
  status: "recording" | "finalized";
  insert_after_item_id: string | null;
  created_at: Date;
  finalized_at: Date | null;
}

interface RecordingRow {
  id: string;
  title: string;
  purpose: string | null;
  audience: string | null;
  owner_user_id: string | null;
  project_id: string | null;
  deleted_at: Date | null;
  state: "recording" | "paused" | "finalized";
  capture_mode: Recording["captureMode"];
  created_at: Date;
  updated_at: Date;
  finalized_at: Date | null;
}

interface ItemRow {
  id: string;
  recording_id: string;
  event_id: string | null;
  ordinal: number;
  kind: GuideItemKind;
  title: string;
  body: string;
  image_filename: string | null;
  alt_text: string | null;
  source: "deterministic" | "ai" | "manual";
  user_edited: boolean;
}

export interface ScreenshotRow {
  id: string;
  recording_id: string;
  event_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  original_image?: Buffer;
  annotated_image: Buffer;
  edited_image?: Buffer | null;
  edit_operations?: ScreenshotEditOperations;
  target_box?: unknown;
}

function mapEvent(row: EventRow): Recording["events"][number] {
  return {
    id: row.id,
    ordinal: row.ordinal,
    captureSessionId: row.capture_session_id,
    actionType: row.action_type as Recording["events"][number]["actionType"],
    pageTitle: row.page_title,
    sanitizedUrl: row.sanitized_url,
    elementName: row.element_name ?? undefined,
    elementRole: row.element_role ?? undefined,
    labelText: row.label_text ?? undefined,
    nearbyHeading: row.nearby_heading ?? undefined,
    inputCategory: row.input_category ?? undefined,
    boundingBox: (row.bounding_box ??
      undefined) as Recording["events"][number]["boundingBox"],
    videoOffsetMs: row.video_offset_ms ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function mapItem(row: ItemRow): GuideItem {
  return {
    id: row.id,
    recordingId: row.recording_id,
    eventId: row.event_id,
    ordinal: row.ordinal,
    kind: row.kind,
    title: row.title,
    body: row.body,
    imageFilename: row.image_filename,
    altText: row.alt_text,
    source: row.source,
    userEdited: row.user_edited,
  };
}

function mapStep(item: GuideItem): GuideStep {
  return {
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
  };
}

function mapRecording(
  row: RecordingRow,
  events: Recording["events"],
  items: GuideItem[],
): Recording {
  return {
    id: row.id,
    title: row.title,
    purpose: row.purpose,
    audience: row.audience,
    ownerUserId: row.owner_user_id,
    projectId: row.project_id,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    restorableUntil: row.deleted_at
      ? new Date(row.deleted_at.getTime() + 10 * 86_400_000).toISOString()
      : null,
    captureMode: row.capture_mode,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    finalizedAt: row.finalized_at?.toISOString() ?? null,
    events,
    steps: items.filter((item) => item.kind === "step").map(mapStep),
    items,
  };
}

export async function createRecording(
  db: Db,
  input: CreateRecordingRequest & { ownerUserId?: string; projectId?: string },
): Promise<{ id: string }> {
  const id = randomUUID();
  await db.query(
    `
      insert into recordings (id, title, purpose, audience, owner_user_id, project_id, capture_mode, state)
      values ($1, $2, $3, $4, $5, $6, $7, 'recording')
    `,
    [
      id,
      input.title,
      input.purpose ?? null,
      input.audience ?? null,
      input.ownerUserId ?? null,
      input.projectId ?? null,
      input.captureMode,
    ],
  );
  return { id };
}

export async function updateRecordingSummary(
  db: Db,
  recordingId: string,
  patch: { title?: string; purpose?: string | null; audience?: string | null },
): Promise<Recording | null> {
  await db.query(
    `
      update recordings
      set
        title = coalesce($2, title),
        purpose = case when $3::boolean then $4 else purpose end,
        audience = case when $5::boolean then $6 else audience end,
        updated_at = now()
      where id = $1
    `,
    [
      recordingId,
      patch.title ?? null,
      Object.prototype.hasOwnProperty.call(patch, "purpose"),
      patch.purpose ?? null,
      Object.prototype.hasOwnProperty.call(patch, "audience"),
      patch.audience ?? null,
    ],
  );
  return getRecording(db, recordingId);
}

export async function createCaptureSession(
  db: Db,
  input: {
    recordingId: string;
    startedByUserId: string;
    insertAfterItemId?: string | null;
  },
): Promise<{ id: string; recordingId: string; status: "recording" }> {
  const id = randomUUID();
  await db.query(
    `
      insert into capture_sessions (id, recording_id, started_by_user_id, status, insert_after_item_id)
      values ($1, $2, $3, 'recording', $4)
    `,
    [
      id,
      input.recordingId,
      input.startedByUserId,
      input.insertAfterItemId ?? null,
    ],
  );
  await db.query(
    "update recordings set state = 'recording', updated_at = now() where id = $1",
    [input.recordingId],
  );
  return { id, recordingId: input.recordingId, status: "recording" };
}

export async function findCaptureSession(
  db: Db,
  recordingId: string,
  captureSessionId: string,
): Promise<CaptureSessionRow | null> {
  const result = await db.query<CaptureSessionRow>(
    "select * from capture_sessions where recording_id = $1 and id = $2",
    [recordingId, captureSessionId],
  );
  return result.rows[0] ?? null;
}

export async function finalizeCaptureSession(
  db: Db,
  recordingId: string,
  captureSessionId: string,
): Promise<void> {
  await db.query(
    `
      update capture_sessions
      set status = 'finalized', finalized_at = coalesce(finalized_at, now())
      where recording_id = $1 and id = $2
    `,
    [recordingId, captureSessionId],
  );
}

export async function insertEvents(
  db: Db,
  recordingId: string,
  events: RecordingEventInput[],
  options: { captureSessionId?: string } = {},
) {
  const maxOrdinalResult = await db.query<{ max: number | null }>(
    "select max(ordinal) as max from recording_events where recording_id = $1",
    [recordingId],
  );
  let ordinal = maxOrdinalResult.rows[0]?.max ?? -1;
  const inserted = [];

  for (const event of events) {
    ordinal += 1;
    const id = randomUUID();
    const result = await db.query<EventRow>(
      `
        insert into recording_events (
          id, recording_id, capture_session_id, ordinal, action_type, page_title, sanitized_url,
          element_name, element_role, label_text, nearby_heading, input_category,
          bounding_box, video_offset_ms, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15::jsonb)
        returning *
      `,
      [
        id,
        recordingId,
        options.captureSessionId ?? null,
        ordinal,
        event.actionType,
        event.pageTitle,
        event.sanitizedUrl,
        event.elementName ?? null,
        event.elementRole ?? null,
        event.labelText ?? null,
        event.nearbyHeading ?? null,
        event.inputCategory ?? null,
        event.boundingBox ? JSON.stringify(event.boundingBox) : null,
        event.videoOffsetMs ?? null,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
    inserted.push(mapEvent(result.rows[0]));
  }

  await db.query("update recordings set updated_at = now() where id = $1", [
    recordingId,
  ]);
  return inserted;
}

export async function insertScreenshot(
  db: Db,
  input: {
    recordingId: string;
    eventId: string;
    filename: string;
    contentType: string;
    originalImage: Buffer;
    annotatedImage: Buffer;
    targetBox?: unknown;
  },
): Promise<void> {
  await db.query(
    `
      insert into screenshots (
        id, recording_id, event_id, filename, content_type, byte_size,
        original_image, annotated_image, target_box
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      on conflict (recording_id, filename)
      do update set
        event_id = excluded.event_id,
        content_type = excluded.content_type,
        byte_size = excluded.byte_size,
        original_image = excluded.original_image,
        annotated_image = excluded.annotated_image,
        target_box = excluded.target_box,
        edit_operations = '{"redactions":[]}'::jsonb,
        edited_image = null
    `,
    [
      randomUUID(),
      input.recordingId,
      input.eventId,
      input.filename,
      input.contentType,
      input.originalImage.byteLength,
      input.originalImage,
      input.annotatedImage,
      input.targetBox ? JSON.stringify(input.targetBox) : null,
    ],
  );
}

export async function deleteGuideItemImage(
  db: Db,
  recordingId: string,
  itemId: string,
): Promise<GuideItem | null> {
  const existing = await db.query<ItemRow>(
    "select * from guide_items where recording_id = $1 and id = $2 and kind = 'step'",
    [recordingId, itemId],
  );
  const filename = existing.rows[0]?.image_filename;
  if (!existing.rows[0]) return null;

  const updated = await db.query<ItemRow>(
    `
      update guide_items
      set image_filename = null, alt_text = null, user_edited = true, updated_at = now()
      where recording_id = $1 and id = $2
      returning *
    `,
    [recordingId, itemId],
  );
  if (filename) {
    await db.query(
      "update guide_items set image_filename = null where recording_id = $1 and image_filename = $2",
      [recordingId, filename],
    );
    await db.query(
      "delete from screenshots where recording_id = $1 and filename = $2",
      [recordingId, filename],
    );
  }
  await db.query("update recordings set updated_at = now() where id = $1", [
    recordingId,
  ]);
  return mapItem(updated.rows[0]);
}

export async function replaceGuideItemImage(
  db: Db,
  input: {
    recordingId: string;
    itemId: string;
    contentType: string;
    originalImage: Buffer;
    annotatedImage: Buffer;
  },
): Promise<GuideItem | null> {
  const existing = await db.query<ItemRow>(
    "select * from guide_items where recording_id = $1 and id = $2 and kind = 'step'",
    [input.recordingId, input.itemId],
  );
  const row = existing.rows[0];
  if (!row) return null;
  if (!row.event_id)
    throw new Error("Only event-backed steps can have uploaded images");

  const filename = row.image_filename ?? `manual-${input.itemId}.webp`;
  await insertScreenshot(db, {
    recordingId: input.recordingId,
    eventId: row.event_id,
    filename,
    contentType: input.contentType,
    originalImage: input.originalImage,
    annotatedImage: input.annotatedImage,
  });
  const updated = await db.query<ItemRow>(
    `
      update guide_items
      set image_filename = $3, user_edited = true, updated_at = now()
      where recording_id = $1 and id = $2
      returning *
    `,
    [input.recordingId, input.itemId, filename],
  );
  await db.query("update recordings set updated_at = now() where id = $1", [
    input.recordingId,
  ]);
  return mapItem(updated.rows[0]);
}

export async function getRecording(
  db: Db,
  recordingId: string,
): Promise<Recording | null> {
  const recordingResult = await db.query<RecordingRow>(
    "select * from recordings where id = $1",
    [recordingId],
  );
  const recording = recordingResult.rows[0];
  if (!recording) return null;

  const eventsResult = await db.query<EventRow>(
    "select * from recording_events where recording_id = $1 order by ordinal",
    [recordingId],
  );
  const itemsResult = await db.query<ItemRow>(
    "select * from guide_items where recording_id = $1 order by ordinal",
    [recordingId],
  );

  return mapRecording(
    recording,
    eventsResult.rows.map(mapEvent),
    itemsResult.rows.map(mapItem),
  );
}

export async function listScreenshotsForRecording(
  db: Db,
  recordingId: string,
): Promise<ScreenshotRow[]> {
  const result = await db.query<ScreenshotRow>(
    `
      select
        id, recording_id, event_id, filename, content_type, byte_size,
        coalesce(edited_image, annotated_image) as annotated_image,
        edited_image,
        edit_operations
      from screenshots
      where recording_id = $1
      order by filename
    `,
    [recordingId],
  );
  return result.rows;
}

export async function listProjectScreenshotsForRecording(
  db: Db,
  recordingId: string,
): Promise<ScreenshotRow[]> {
  const result = await db.query<ScreenshotRow>(
    `
      select
        id, recording_id, event_id, filename, content_type, byte_size,
        original_image, annotated_image, edited_image, edit_operations, target_box
      from screenshots
      where recording_id = $1
      order by filename
    `,
    [recordingId],
  );
  return result.rows;
}

export async function findScreenshotByFilename(
  db: Db,
  recordingId: string,
  filename: string,
): Promise<ScreenshotRow | null> {
  const result = await db.query<ScreenshotRow>(
    `
      select
        id, recording_id, event_id, filename, content_type, byte_size,
        coalesce(edited_image, annotated_image) as annotated_image,
        edited_image,
        edit_operations
      from screenshots
      where recording_id = $1 and filename = $2
    `,
    [recordingId, filename],
  );
  return result.rows[0] ?? null;
}

export async function findProjectScreenshotByFilename(
  db: Db,
  recordingId: string,
  filename: string,
): Promise<ScreenshotRow | null> {
  const result = await db.query<ScreenshotRow>(
    `
      select
        id, recording_id, event_id, filename, content_type, byte_size,
        original_image, annotated_image, edited_image, edit_operations, target_box
      from screenshots
      where recording_id = $1 and filename = $2
    `,
    [recordingId, filename],
  );
  return result.rows[0] ?? null;
}

export async function screenshotsByEvent(
  db: Db,
  recordingId: string,
): Promise<Map<string, ScreenshotRow>> {
  const screenshots = await listScreenshotsForRecording(db, recordingId);
  return new Map(
    screenshots.map((screenshot) => [screenshot.event_id, screenshot]),
  );
}

async function nextOrdinal(
  db: Db,
  recordingId: string,
  afterItemId?: string | null,
): Promise<number> {
  if (!afterItemId) {
    await db.query(
      "update guide_items set ordinal = ordinal + 100000, updated_at = now() where recording_id = $1",
      [recordingId],
    );
    await db.query(
      "update guide_items set ordinal = ordinal - 99999, updated_at = now() where recording_id = $1",
      [recordingId],
    );
    return 0;
  }

  const anchor = await db.query<{ ordinal: number }>(
    "select ordinal from guide_items where recording_id = $1 and id = $2",
    [recordingId, afterItemId],
  );
  const ordinal = anchor.rows[0] ? anchor.rows[0].ordinal + 1 : 0;
  await db.query(
    "update guide_items set ordinal = ordinal + 100000, updated_at = now() where recording_id = $1 and ordinal >= $2",
    [recordingId, ordinal],
  );
  await db.query(
    "update guide_items set ordinal = ordinal - 99999, updated_at = now() where recording_id = $1 and ordinal >= $2",
    [recordingId, ordinal],
  );
  return ordinal;
}

async function makeOrdinalSpace(
  db: Db,
  recordingId: string,
  ordinal: number,
): Promise<void> {
  await db.query(
    "update guide_items set ordinal = ordinal + 100000, updated_at = now() where recording_id = $1 and ordinal >= $2",
    [recordingId, ordinal],
  );
  await db.query(
    "update guide_items set ordinal = ordinal - 99999, updated_at = now() where recording_id = $1 and ordinal >= $2",
    [recordingId, ordinal],
  );
}

export async function addGuideItem(
  db: Db,
  recordingId: string,
  input: {
    kind: GuideItemKind;
    title?: string;
    body?: string;
    afterItemId?: string | null;
  },
): Promise<GuideItem> {
  const ordinal = await nextOrdinal(db, recordingId, input.afterItemId);
  const defaults = {
    step: {
      title: input.title ?? "New step",
      body: input.body ?? "Describe the next action.",
    },
    tip: {
      title: input.title ?? "Tip",
      body: input.body ?? "Add helpful context for this part of the workflow.",
    },
    alert: {
      title: input.title ?? "Alert",
      body: input.body ?? "Add an important warning or prerequisite.",
    },
    header: {
      title: input.title ?? "New section",
      body: input.body ?? input.title ?? "New section",
    },
  } satisfies Record<GuideItemKind, { title: string; body: string }>;
  const item = defaults[input.kind];

  const result = await db.query<ItemRow>(
    `
      insert into guide_items (
        id, recording_id, event_id, ordinal, kind, title, body,
        image_filename, alt_text, source, user_edited
      )
      values ($1, $2, null, $3, $4, $5, $6, null, null, 'manual', true)
      returning *
    `,
    [randomUUID(), recordingId, ordinal, input.kind, item.title, item.body],
  );
  return mapItem(result.rows[0]);
}

export async function updateGuideItem(
  db: Db,
  recordingId: string,
  itemId: string,
  patch: { title?: string; body?: string; altText?: string },
): Promise<GuideItem | null> {
  const result = await db.query<ItemRow>(
    `
      update guide_items
      set
        title = coalesce($3, title),
        body = coalesce($4, body),
        alt_text = coalesce($5, alt_text),
        user_edited = true,
        updated_at = now()
      where recording_id = $1 and id = $2
      returning *
    `,
    [
      recordingId,
      itemId,
      patch.title ?? null,
      patch.body ?? null,
      patch.altText ?? null,
    ],
  );
  return result.rows[0] ? mapItem(result.rows[0]) : null;
}

export async function updateScreenshotEdits(
  db: Db,
  input: {
    recordingId: string;
    filename: string;
    editOperations: ScreenshotEditOperations;
    editedImage: Buffer;
  },
): Promise<void> {
  await db.query(
    `
      update screenshots
      set edit_operations = $3::jsonb, edited_image = $4
      where recording_id = $1 and filename = $2
    `,
    [
      input.recordingId,
      input.filename,
      JSON.stringify(input.editOperations),
      input.editedImage,
    ],
  );
}

export async function upsertGeneratedStep(
  db: Db,
  input: {
    recordingId: string;
    eventId: string | null;
    ordinal: number;
    title: string;
    instruction: string;
    imageFilename: string | null;
    altText: string | null;
    source: "deterministic" | "ai" | "manual";
    overwriteUserEdited?: boolean;
  },
): Promise<GuideStep> {
  const existing = input.eventId
    ? await db.query<ItemRow>(
        "select * from guide_items where recording_id = $1 and event_id = $2 and kind = 'step'",
        [input.recordingId, input.eventId],
      )
    : await db.query<ItemRow>(
        "select * from guide_items where recording_id = $1 and ordinal = $2 and kind = 'step'",
        [input.recordingId, input.ordinal],
      );

  if (existing.rows[0]?.user_edited && !input.overwriteUserEdited) {
    return mapStep(mapItem(existing.rows[0]));
  }

  if (existing.rows[0]) {
    const updated = await db.query<ItemRow>(
      `
        update guide_items
        set
          event_id = $3,
          title = $4,
          body = $5,
          image_filename = $6,
          alt_text = $7,
          source = $8,
          user_edited = false,
          updated_at = now()
        where recording_id = $1 and id = $2
        returning *
      `,
      [
        input.recordingId,
        existing.rows[0].id,
        input.eventId,
        input.title,
        input.instruction,
        input.imageFilename,
        input.altText,
        input.source,
      ],
    );
    return mapStep(mapItem(updated.rows[0]));
  }

  await makeOrdinalSpace(db, input.recordingId, input.ordinal);
  const result = await db.query<ItemRow>(
    `
      insert into guide_items (
        id, recording_id, event_id, ordinal, kind, title, body,
        image_filename, alt_text, source, user_edited
      )
      values ($1, $2, $3, $4, 'step', $5, $6, $7, $8, $9, false)
      returning *
    `,
    [
      randomUUID(),
      input.recordingId,
      input.eventId,
      input.ordinal,
      input.title,
      input.instruction,
      input.imageFilename,
      input.altText,
      input.source,
    ],
  );
  return mapStep(mapItem(result.rows[0]));
}

export async function updateGuideStep(
  db: Db,
  recordingId: string,
  stepId: string,
  patch: { title?: string; instruction?: string; altText?: string },
): Promise<GuideStep | null> {
  const result = await db.query<ItemRow>(
    `
      update guide_items
      set
        title = coalesce($3, title),
        body = coalesce($4, body),
        alt_text = coalesce($5, alt_text),
        user_edited = true,
        updated_at = now()
      where recording_id = $1 and id = $2 and kind = 'step'
      returning *
    `,
    [
      recordingId,
      stepId,
      patch.title ?? null,
      patch.instruction ?? null,
      patch.altText ?? null,
    ],
  );
  return result.rows[0] ? mapStep(mapItem(result.rows[0])) : null;
}

export async function deleteGuideStep(
  db: Db,
  recordingId: string,
  stepId: string,
): Promise<void> {
  await db.query(
    "delete from guide_items where recording_id = $1 and id = $2",
    [recordingId, stepId],
  );
}

export async function reorderGuideSteps(
  db: Db,
  recordingId: string,
  stepIds: string[],
): Promise<void> {
  for (let index = 0; index < stepIds.length; index += 1) {
    await db.query(
      "update guide_items set ordinal = $3, updated_at = now() where recording_id = $1 and id = $2",
      [recordingId, stepIds[index], -index - 1],
    );
  }
  for (let index = 0; index < stepIds.length; index += 1) {
    await db.query(
      "update guide_items set ordinal = $3, updated_at = now() where recording_id = $1 and id = $2",
      [recordingId, stepIds[index], index],
    );
  }
}

export async function addManualStep(
  db: Db,
  recordingId: string,
  input: {
    title: string;
    instruction: string;
    altText?: string | null;
    afterItemId?: string | null;
  },
): Promise<GuideStep> {
  const ordinal = await nextOrdinal(db, recordingId, input.afterItemId);
  const result = await db.query<ItemRow>(
    `
      insert into guide_items (
        id, recording_id, event_id, ordinal, kind, title, body,
        image_filename, alt_text, source, user_edited
      )
      values ($1, $2, null, $3, 'step', $4, $5, null, $6, 'manual', true)
      returning *
    `,
    [
      randomUUID(),
      recordingId,
      ordinal,
      input.title,
      input.instruction,
      input.altText ?? null,
    ],
  );
  return mapStep(mapItem(result.rows[0]));
}

export async function finalizeRecording(
  db: Db,
  recordingId: string,
): Promise<void> {
  await db.query(
    "update recordings set state = 'finalized', finalized_at = coalesce(finalized_at, now()), updated_at = now() where id = $1",
    [recordingId],
  );
}

export async function setRecordingState(
  db: Db,
  recordingId: string,
  state: "recording" | "paused",
): Promise<void> {
  await db.query(
    "update recordings set state = $2, updated_at = now() where id = $1",
    [recordingId, state],
  );
}

export async function deleteRecording(
  db: Db,
  recordingId: string,
): Promise<void> {
  await db.query("delete from recordings where id = $1", [recordingId]);
}

export async function softDeleteRecording(
  db: Db,
  recordingId: string,
  deletedByUserId: string,
): Promise<void> {
  await db.query(
    `
      update recordings
      set deleted_at = coalesce(deleted_at, now()), deleted_by_user_id = $2, updated_at = now()
      where id = $1
    `,
    [recordingId, deletedByUserId],
  );
}

export async function restoreRecording(
  db: Db,
  recordingId: string,
): Promise<boolean> {
  const result = await db.query(
    `
      update recordings
      set deleted_at = null, deleted_by_user_id = null, updated_at = now()
      where id = $1 and deleted_at is not null and deleted_at >= now() - interval '10 days'
    `,
    [recordingId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function importRecordingProject(
  db: Db,
  project: RecordingProject,
  ownership?: { ownerUserId: string; projectId: string },
): Promise<Recording> {
  const recordingId = randomUUID();
  const createdAt = new Date(project.recording.createdAt);
  const updatedAt = new Date();
  const finalizedAt = project.recording.finalizedAt
    ? new Date(project.recording.finalizedAt)
    : null;

  await db.query(
    `
      insert into recordings (
        id, title, purpose, audience, owner_user_id, project_id, capture_mode, state, created_at, updated_at, finalized_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `,
    [
      recordingId,
      project.recording.title,
      project.recording.purpose,
      project.recording.audience,
      ownership?.ownerUserId ?? null,
      ownership?.projectId ?? null,
      project.recording.captureMode,
      project.recording.state,
      Number.isNaN(createdAt.getTime()) ? updatedAt : createdAt,
      updatedAt,
      finalizedAt && !Number.isNaN(finalizedAt.getTime()) ? finalizedAt : null,
    ],
  );

  const eventIds = new Map<string, string>();
  const sortedEvents = project.recording.events
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal);
  for (let ordinal = 0; ordinal < sortedEvents.length; ordinal += 1) {
    const event = sortedEvents[ordinal];
    const eventId = randomUUID();
    eventIds.set(event.id, eventId);
    await db.query(
      `
        insert into recording_events (
          id, recording_id, ordinal, action_type, page_title, sanitized_url,
          element_name, element_role, label_text, nearby_heading, input_category,
          bounding_box, video_offset_ms, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb)
      `,
      [
        eventId,
        recordingId,
        ordinal,
        event.actionType,
        event.pageTitle,
        event.sanitizedUrl,
        event.elementName ?? null,
        event.elementRole ?? null,
        event.labelText ?? null,
        event.nearbyHeading ?? null,
        event.inputCategory ?? null,
        event.boundingBox ? JSON.stringify(event.boundingBox) : null,
        event.videoOffsetMs ?? null,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  }

  for (const screenshot of project.screenshots) {
    const eventId = eventIds.get(screenshot.eventId);
    if (!eventId) continue;
    const originalImage = Buffer.from(screenshot.originalImageBase64, "base64");
    const annotatedImage = Buffer.from(
      screenshot.annotatedImageBase64,
      "base64",
    );
    const editedImage = screenshot.editedImageBase64
      ? Buffer.from(screenshot.editedImageBase64, "base64")
      : null;

    await db.query(
      `
        insert into screenshots (
          id, recording_id, event_id, filename, content_type, byte_size,
          original_image, annotated_image, edited_image, edit_operations, target_box
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
      `,
      [
        randomUUID(),
        recordingId,
        eventId,
        screenshot.filename,
        screenshot.contentType,
        screenshot.byteSize ?? originalImage.byteLength,
        originalImage,
        annotatedImage,
        editedImage,
        JSON.stringify(screenshot.editOperations ?? { redactions: [] }),
        screenshot.targetBox ? JSON.stringify(screenshot.targetBox) : null,
      ],
    );
  }

  const importedItems =
    project.version === 2
      ? project.items
      : project.recording.steps.map((step) => ({
          id: step.id,
          recordingId: step.recordingId,
          eventId: step.eventId,
          ordinal: step.ordinal,
          kind: "step" as const,
          title: step.title,
          body: step.instruction,
          imageFilename: step.imageFilename,
          altText: step.altText,
          source: step.source,
          userEdited: step.userEdited,
        }));

  const sortedItems = importedItems
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal);
  for (let ordinal = 0; ordinal < sortedItems.length; ordinal += 1) {
    const item = sortedItems[ordinal];
    await db.query(
      `
        insert into guide_items (
          id, recording_id, event_id, ordinal, kind, title, body,
          image_filename, alt_text, source, user_edited
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        randomUUID(),
        recordingId,
        item.eventId ? (eventIds.get(item.eventId) ?? null) : null,
        ordinal,
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

  const imported = await getRecording(db, recordingId);
  if (!imported) throw new Error("Imported recording could not be loaded");
  return imported;
}

export async function findStep(
  db: Db,
  recordingId: string,
  stepId: string,
): Promise<GuideStep | null> {
  const result = await db.query<ItemRow>(
    "select * from guide_items where recording_id = $1 and id = $2 and kind = 'step'",
    [recordingId, stepId],
  );
  return result.rows[0] ? mapStep(mapItem(result.rows[0])) : null;
}

export async function mergeWithNextStep(
  db: Db,
  recordingId: string,
  stepId: string,
): Promise<GuideStep | null> {
  const current = await db.query<ItemRow>(
    "select * from guide_items where recording_id = $1 and id = $2 and kind = 'step'",
    [recordingId, stepId],
  );
  const row = current.rows[0];
  if (!row) return null;

  const next = await db.query<ItemRow>(
    "select * from guide_items where recording_id = $1 and ordinal > $2 and kind = 'step' order by ordinal limit 1",
    [recordingId, row.ordinal],
  );
  const nextRow = next.rows[0];
  if (!nextRow) return mapStep(mapItem(row));

  const merged = await db.query<ItemRow>(
    `
      update guide_items
      set body = $3, title = $4, user_edited = true, updated_at = now()
      where recording_id = $1 and id = $2
      returning *
    `,
    [
      recordingId,
      stepId,
      `${row.body}\n\n${nextRow.body}`,
      `${row.title} and ${nextRow.title}`,
    ],
  );
  await db.query(
    "delete from guide_items where recording_id = $1 and id = $2",
    [recordingId, nextRow.id],
  );
  return mapStep(mapItem(merged.rows[0]));
}
