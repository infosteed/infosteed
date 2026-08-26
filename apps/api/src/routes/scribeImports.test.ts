// SPDX-License-Identifier: AGPL-3.0-only
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerScribeImportRoutes } from "./scribeImports";
import {
  createScribeImportJob,
  getScribeImportJobForUser,
  listScribeImportJobsForUser,
  retryScribeImportJob,
} from "../repositories/scribeImports";

vi.mock("../db", () => ({
  withTransaction: vi.fn(async (_pool, work) => work(_pool)),
}));
vi.mock("../repositories/auth", () => ({
  ensurePersonalProject: vi.fn(),
}));
vi.mock("../repositories/scribeImports", () => ({
  createScribeImportJob: vi.fn(),
  getScribeImportJobForUser: vi.fn(),
  listScribeImportJobsForUser: vi.fn(),
  retryScribeImportJob: vi.fn(),
}));

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "owner",
  displayName: "Owner",
  role: "user" as const,
  enabled: true,
  twoFactorEnabled: false,
  twoFactorRequired: false,
  themePreference: "system" as const,
};
const projectId = "00000000-0000-4000-8000-000000000002";
const job = {
  id: "00000000-0000-4000-8000-000000000003",
  status: "queued" as const,
  originalFilename: "guide.md",
  sourceUrl: null,
  totalImages: 0,
  processedImages: 0,
  downloadedImages: 0,
  failedImages: [],
  recordingId: null,
  errorMessage: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  updatedAt: "2026-08-12T12:00:00.000Z",
  completedAt: null,
};

function app() {
  const server = Fastify();
  const requireProjectWrite = vi.fn().mockResolvedValue("owner");
  const wakeScribeImportWorker = vi.fn();
  registerScribeImportRoutes(server, {
    config: {} as never,
    pool: {} as never,
    videoStorage: {} as never,
    currentUser: () => user,
    requireAdmin: () => user,
    requireProjectRead: vi.fn(),
    requireProjectWrite,
    requireProjectManage: vi.fn(),
    audit: vi.fn(),
    httpError: (statusCode, message) =>
      Object.assign(new Error(message), { statusCode }),
    wakeScribeImportWorker,
  });
  return { server, requireProjectWrite, wakeScribeImportWorker };
}

describe("Scribe import routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createScribeImportJob).mockResolvedValue(job);
    vi.mocked(listScribeImportJobsForUser).mockResolvedValue([job]);
    vi.mocked(getScribeImportJobForUser).mockResolvedValue(job);
    vi.mocked(retryScribeImportJob).mockResolvedValue(true);
  });

  it("validates, authorizes, and queues a Markdown import", async () => {
    const { server, requireProjectWrite, wakeScribeImportWorker } = app();
    const response = await server.inject({
      method: "POST",
      url: "/imports/scribe-markdown",
      payload: {
        markdown: "# Guide\n\n1\\. Do it",
        originalFilename: "guide.md",
        projectId,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(requireProjectWrite).toHaveBeenCalledWith(
      expect.anything(),
      projectId,
    );
    expect(createScribeImportJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: user.id, projectId }),
    );
    expect(wakeScribeImportWorker).toHaveBeenCalled();
    await server.close();
  });

  it("rejects malformed Markdown before queueing", async () => {
    const { server } = app();
    const response = await server.inject({
      method: "POST",
      url: "/imports/scribe-markdown",
      payload: {
        markdown: "not a Scribe export",
        originalFilename: "guide.md",
        projectId,
      },
    });
    expect(response.statusCode).toBe(400);
    expect(createScribeImportJob).not.toHaveBeenCalled();
    await server.close();
  });

  it("lists only the current user's jobs and retries failed work", async () => {
    const { server, wakeScribeImportWorker } = app();
    const listed = await server.inject({
      method: "GET",
      url: "/imports/scribe-markdown",
    });
    expect(listed.json()).toEqual({ jobs: [job] });
    expect(listScribeImportJobsForUser).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
    );

    const retried = await server.inject({
      method: "POST",
      url: `/imports/scribe-markdown/${job.id}/retry`,
    });
    expect(retried.statusCode).toBe(200);
    expect(retryScribeImportJob).toHaveBeenCalledWith(
      expect.anything(),
      job.id,
      user.id,
    );
    expect(wakeScribeImportWorker).toHaveBeenCalled();
    await server.close();
  });
});
