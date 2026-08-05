// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../db.js";
import type {
  UpdateWordTemplateRequest,
  WordTemplateInspection,
  WordTemplateSummary,
} from "@infosteed/shared";

type Db = Pool | PoolClient;

interface WordTemplateRow {
  id: string;
  name: string;
  original_filename: string;
  content?: Buffer;
  sha256: string;
  validation_report: WordTemplateInspection;
  is_default: boolean;
  uploaded_by_user_id: string | null;
  uploaded_by_display_name: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface StoredWordTemplate extends WordTemplateSummary {
  content: Buffer;
}

function mapSummary(row: WordTemplateRow): WordTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    originalFilename: row.original_filename,
    sha256: row.sha256,
    isDefault: row.is_default,
    inspection: row.validation_report,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedByDisplayName: row.uploaded_by_display_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = `
  t.id, t.name, t.original_filename, t.sha256, t.validation_report,
  t.is_default, t.uploaded_by_user_id, uploader.display_name as uploaded_by_display_name,
  t.created_at, t.updated_at
`;

export async function listWordTemplates(
  db: Db,
): Promise<WordTemplateSummary[]> {
  const result = await db.query<WordTemplateRow>(
    `select ${SELECT_COLUMNS}
       from word_export_templates t
       left join users uploader on uploader.id = t.uploaded_by_user_id
      order by t.is_default desc, lower(t.name), t.created_at`,
  );
  return result.rows.map(mapSummary);
}

export async function getWordTemplate(
  db: Db,
  id: string,
): Promise<StoredWordTemplate | null> {
  const result = await db.query<WordTemplateRow>(
    `select ${SELECT_COLUMNS}, t.content
       from word_export_templates t
       left join users uploader on uploader.id = t.uploaded_by_user_id
      where t.id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? { ...mapSummary(row), content: row.content! } : null;
}

export async function getDefaultWordTemplate(
  db: Db,
): Promise<StoredWordTemplate | null> {
  const result = await db.query<WordTemplateRow>(
    `select ${SELECT_COLUMNS}, t.content
       from word_export_templates t
       left join users uploader on uploader.id = t.uploaded_by_user_id
      where t.is_default = true`,
  );
  const row = result.rows[0];
  return row ? { ...mapSummary(row), content: row.content! } : null;
}

export async function createWordTemplate(
  db: Db,
  input: {
    name: string;
    originalFilename: string;
    content: Buffer;
    sha256: string;
    inspection: WordTemplateInspection;
    uploadedByUserId: string;
    makeDefault: boolean;
  },
): Promise<WordTemplateSummary> {
  const id = randomUUID();
  const count = await db.query<{ count: string }>(
    "select count(*) as count from word_export_templates",
  );
  const isDefault =
    input.makeDefault || Number(count.rows[0]?.count ?? 0) === 0;
  if (isDefault)
    await db.query(
      "update word_export_templates set is_default = false, updated_at = now() where is_default = true",
    );
  await db.query(
    `insert into word_export_templates (
       id, name, original_filename, content, sha256, validation_report,
       is_default, uploaded_by_user_id
     ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      id,
      input.name,
      input.originalFilename,
      input.content,
      input.sha256,
      JSON.stringify(input.inspection),
      isDefault,
      input.uploadedByUserId,
    ],
  );
  return (await getWordTemplate(db, id))!;
}

export async function updateWordTemplate(
  db: Db,
  id: string,
  patch: UpdateWordTemplateRequest,
): Promise<WordTemplateSummary | null> {
  const existing = await db.query<{ id: string }>(
    "select id from word_export_templates where id = $1 for update",
    [id],
  );
  if (!existing.rows[0]) return null;
  if (patch.isDefault === true)
    await db.query(
      "update word_export_templates set is_default = false, updated_at = now() where is_default = true and id <> $1",
      [id],
    );
  const result = await db.query<{ id: string }>(
    `update word_export_templates
        set name = coalesce($2, name),
            is_default = coalesce($3, is_default),
            updated_at = now()
      where id = $1
      returning id`,
    [id, patch.name ?? null, patch.isDefault ?? null],
  );
  return result.rows[0] ? getWordTemplate(db, id) : null;
}

export async function deleteWordTemplate(db: Db, id: string): Promise<boolean> {
  const result = await db.query(
    "delete from word_export_templates where id = $1",
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findUserDisplayName(
  db: Db,
  id: string | null | undefined,
): Promise<string | null> {
  if (!id) return null;
  const result = await db.query<{ display_name: string }>(
    "select display_name from users where id = $1",
    [id],
  );
  return result.rows[0]?.display_name ?? null;
}
