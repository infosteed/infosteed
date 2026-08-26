// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from "fastify";
import { createScribeMarkdownImportRequestSchema } from "@infosteed/shared";
import { withTransaction } from "../db.js";
import { ensurePersonalProject } from "../repositories/auth.js";
import {
  createScribeImportJob,
  getScribeImportJobForUser,
  listScribeImportJobsForUser,
  retryScribeImportJob,
} from "../repositories/scribeImports.js";
import {
  parseScribeMarkdown,
  ScribeMarkdownParseError,
} from "../scribeMarkdown.js";
import type { AuthenticatedRouteContext } from "./context.js";

interface ScribeImportRouteContext extends AuthenticatedRouteContext {
  wakeScribeImportWorker(): void;
}

export function registerScribeImportRoutes(
  app: FastifyInstance,
  context: ScribeImportRouteContext,
): void {
  const {
    pool,
    currentUser,
    requireProjectWrite,
    audit,
    httpError,
    wakeScribeImportWorker,
  } = context;

  app.post(
    "/imports/scribe-markdown",
    { bodyLimit: 12 * 1024 * 1024 },
    async (request, reply) => {
      const input = createScribeMarkdownImportRequestSchema.parse(request.body);
      let parsed;
      try {
        parsed = parseScribeMarkdown(input.markdown);
      } catch (error) {
        if (error instanceof ScribeMarkdownParseError)
          throw httpError(400, error.message);
        throw error;
      }
      const user = currentUser(request);
      const projectId = input.projectId
        ? input.projectId
        : (await ensurePersonalProject(pool, user)).id;
      await requireProjectWrite(request, projectId);
      const job = await withTransaction(pool, (client) =>
        createScribeImportJob(client, {
          userId: user.id,
          projectId,
          originalFilename: input.originalFilename,
          markdown: input.markdown,
          parsed,
        }),
      );
      await audit(request, "scribe_markdown_import_queued", "import", job.id, {
        projectId,
        imageCount: job.totalImages,
      });
      wakeScribeImportWorker();
      return reply.code(202).send(job);
    },
  );

  app.get("/imports/scribe-markdown", async (request) => ({
    jobs: await listScribeImportJobsForUser(pool, currentUser(request).id),
  }));

  app.get<{ Params: { id: string } }>(
    "/imports/scribe-markdown/:id",
    async (request) => {
      const job = await getScribeImportJobForUser(
        pool,
        request.params.id,
        currentUser(request).id,
      );
      if (!job) throw httpError(404, "Import not found");
      return job;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/imports/scribe-markdown/:id/retry",
    async (request) => {
      const user = currentUser(request);
      const retried = await withTransaction(pool, (client) =>
        retryScribeImportJob(client, request.params.id, user.id),
      );
      if (!retried) throw httpError(409, "Only failed imports can be retried");
      await audit(
        request,
        "scribe_markdown_import_retried",
        "import",
        request.params.id,
      );
      wakeScribeImportWorker();
      const job = await getScribeImportJobForUser(
        pool,
        request.params.id,
        user.id,
      );
      if (!job) throw httpError(404, "Import not found");
      return job;
    },
  );
}
