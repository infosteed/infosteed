// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from "fastify";
import { PRODUCT_METADATA, PROTOCOL_VERSION } from "@infosteed/shared";
import { countUsers } from "../repositories/auth.js";
import type { ApiRouteContext } from "./context.js";

export function registerSystemRoutes(
  app: FastifyInstance,
  { config, pool, videoStorage }: ApiRouteContext,
): void {
  app.get("/health/live", async () => ({ ok: true }));

  app.get("/health/ready", async (_request, reply) => {
    const checks = { postgres: false, objectStorage: false };
    try {
      await pool.query("select 1");
      checks.postgres = true;
      checks.objectStorage = await videoStorage.checkHealth();
    } catch {
      return reply.code(503).send({ ok: false, checks });
    }
    return { ok: true, checks };
  });

  app.get("/system/info", async () => {
    const sourceUrl = config.APP_SOURCE_URL ?? "";
    return {
      productName: PRODUCT_METADATA.displayName,
      productSlug: PRODUCT_METADATA.slug,
      releaseVersion: config.RELEASE_VERSION,
      releaseCommit: config.RELEASE_COMMIT,
      sourceUrl,
      exactSourceUrl:
        sourceUrl && config.RELEASE_COMMIT !== "development"
          ? `${sourceUrl.replace(/\/$/, "")}/tree/${encodeURIComponent(config.RELEASE_COMMIT)}`
          : sourceUrl,
      protocolVersion: PROTOCOL_VERSION,
      setupRequired: (await countUsers(pool)) === 0,
      minimumExtensionVersion: PRODUCT_METADATA.minimumExtensionVersion,
    };
  });

  app.get("/setup/status", async () => ({
    required: (await countUsers(pool)) === 0,
  }));
}
