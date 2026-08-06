// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { AuthenticatedRouteContext } from "./context.js";

interface ExtensionArtifactDefinition {
  id: string;
  browser: "chrome" | "firefox";
  capability: "full" | "guide-only";
  filename: string;
  contentType: string;
  releaseEnabled: boolean;
}

const extensionArtifacts: ExtensionArtifactDefinition[] = [
  {
    id: "chrome-offline",
    browser: "chrome",
    capability: "full",
    filename: "extension-offline.zip",
    contentType: "application/zip",
    releaseEnabled: true,
  },
  {
    id: "firefox-offline",
    browser: "firefox",
    capability: "guide-only",
    filename: "firefox-offline.xpi",
    contentType: "application/x-xpinstall",
    releaseEnabled: false,
  },
];

function safeAttachmentFilename(filename: string): string {
  return filename.replace(/["\r\n\\/]/g, "_");
}

function artifactPath(
  directory: string,
  artifact: ExtensionArtifactDefinition,
) {
  return path.resolve(directory, artifact.filename);
}

async function artifactSummary(
  directory: string,
  artifact: ExtensionArtifactDefinition,
) {
  const absolutePath = artifactPath(directory, artifact);
  try {
    const details = await stat(absolutePath);
    if (!details.isFile()) throw new Error("Not a file");
    return {
      ...artifact,
      byteSize: details.size,
      sha256: createHash("sha256")
        .update(await readFile(absolutePath))
        .digest("hex"),
      installStatus: "available" as const,
    };
  } catch {
    return {
      ...artifact,
      byteSize: null,
      sha256: null,
      installStatus: "missing" as const,
    };
  }
}

export function registerExtensionRoutes(
  app: FastifyInstance,
  context: AuthenticatedRouteContext,
): void {
  const { config, requireAdmin, httpError } = context;

  async function sendArtifact(
    reply: FastifyReply,
    artifact: ExtensionArtifactDefinition,
  ) {
    const absolutePath = artifactPath(config.EXTENSION_ARTIFACT_DIR, artifact);
    const details = await stat(absolutePath).catch(() => undefined);
    if (!details?.isFile()) throw httpError(404, "Extension artifact missing");
    return reply
      .header("content-type", artifact.contentType)
      .header(
        "content-disposition",
        `attachment; filename="${safeAttachmentFilename(artifact.filename)}"`,
      )
      .header("content-length", String(details.size))
      .send(createReadStream(absolutePath));
  }

  app.get("/downloads/extension-offline.zip", async (_request, reply) => {
    const artifact = extensionArtifacts.find(
      (candidate) =>
        candidate.releaseEnabled &&
        candidate.filename === "extension-offline.zip",
    );
    if (!artifact) throw httpError(404, "Extension artifact not found");
    return sendArtifact(reply, artifact);
  });

  app.get("/admin/extensions", async (request) => {
    requireAdmin(request);
    const artifacts = await Promise.all(
      extensionArtifacts
        .filter((artifact) => artifact.releaseEnabled)
        .map((artifact) =>
          artifactSummary(config.EXTENSION_ARTIFACT_DIR, artifact),
        ),
    );
    return {
      artifacts: artifacts.map(
        ({ releaseEnabled: _, ...artifact }) => artifact,
      ),
    };
  });

  app.get<{ Params: { id: string } }>(
    "/admin/extensions/:id/download",
    async (request, reply) => {
      requireAdmin(request);
      const artifact = extensionArtifacts.find(
        (candidate) =>
          candidate.releaseEnabled && candidate.id === request.params.id,
      );
      if (!artifact) throw httpError(404, "Extension artifact not found");
      return sendArtifact(reply, artifact);
    },
  );
}
