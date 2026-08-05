// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { inspectWordTemplate } from "@infosteed/markdown-exporter";
import { updateWordTemplateRequestSchema } from "@infosteed/shared";
import { withTransaction } from "../db.js";
import {
  createWordTemplate,
  deleteWordTemplate,
  getWordTemplate,
  listWordTemplates,
  updateWordTemplate,
} from "../repositories/wordTemplates.js";
import type { AuthenticatedRouteContext } from "./context.js";

const uploadQuerySchema = z.object({
  name: z.string().trim().min(1).max(120),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => value.toLowerCase().endsWith(".docx"), {
      message: "Template filename must end in .docx",
    }),
  makeDefault: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

function safeAttachmentFilename(filename: string): string {
  return filename.replace(/["\r\n\\/]/g, "_");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export function registerWordTemplateRoutes(
  app: FastifyInstance,
  context: AuthenticatedRouteContext,
): void {
  const { pool, currentUser, requireAdmin, audit, httpError } = context;

  app.get("/word-templates", async (request) => {
    currentUser(request);
    return { templates: await listWordTemplates(pool) };
  });

  app.post(
    "/admin/word-templates",
    { bodyLimit: 10 * 1024 * 1024 },
    async (request, reply) => {
      const admin = requireAdmin(request);
      const query = uploadQuerySchema.parse(request.query);
      if (!Buffer.isBuffer(request.body) || request.body.length === 0)
        throw httpError(400, "Word template is empty");
      let inspection;
      try {
        inspection = await inspectWordTemplate(request.body);
      } catch (error) {
        throw httpError(
          400,
          error instanceof Error ? error.message : "Word template is invalid",
        );
      }
      try {
        const template = await withTransaction(pool, (client) =>
          createWordTemplate(client, {
            name: query.name,
            originalFilename: query.filename,
            content: request.body as Buffer,
            sha256: createHash("sha256")
              .update(request.body as Buffer)
              .digest("hex"),
            inspection,
            uploadedByUserId: admin.id,
            makeDefault: query.makeDefault,
          }),
        );
        await audit(
          request,
          "word_template_uploaded",
          "word_template",
          template.id,
          {
            name: template.name,
            filename: template.originalFilename,
            sha256: template.sha256,
            isDefault: template.isDefault,
          },
        );
        return reply.code(201).send(template);
      } catch (error) {
        if (isUniqueViolation(error))
          throw httpError(409, "A Word template with this name already exists");
        throw error;
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    "/admin/word-templates/:id",
    async (request) => {
      requireAdmin(request);
      const patch = updateWordTemplateRequestSchema.parse(request.body);
      try {
        const template = await withTransaction(pool, (client) =>
          updateWordTemplate(client, request.params.id, patch),
        );
        if (!template) throw httpError(404, "Word template not found");
        await audit(
          request,
          "word_template_updated",
          "word_template",
          template.id,
          {
            name: template.name,
            isDefault: template.isDefault,
          },
        );
        return template;
      } catch (error) {
        if (isUniqueViolation(error))
          throw httpError(409, "A Word template with this name already exists");
        throw error;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/admin/word-templates/:id",
    async (request, reply) => {
      requireAdmin(request);
      const existing = await getWordTemplate(pool, request.params.id);
      if (!existing) throw httpError(404, "Word template not found");
      await deleteWordTemplate(pool, request.params.id);
      await audit(
        request,
        "word_template_deleted",
        "word_template",
        existing.id,
        {
          name: existing.name,
          wasDefault: existing.isDefault,
        },
      );
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/word-templates/:id/file",
    async (request, reply) => {
      requireAdmin(request);
      const template = await getWordTemplate(pool, request.params.id);
      if (!template) throw httpError(404, "Word template not found");
      return reply
        .header(
          "content-type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        .header(
          "content-disposition",
          `attachment; filename="${safeAttachmentFilename(template.originalFilename)}"`,
        )
        .send(template.content);
    },
  );
}
