// SPDX-License-Identifier: AGPL-3.0-only
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { readConfig } from "../config";
import type { Pool } from "../db";
import type { VideoStorage } from "../videoStorage";
import { registerSystemRoutes } from "./system";

describe("system routes", () => {
  it("returns readiness and public release information", async () => {
    const pool = {
      query: vi.fn(async (sql: string) => ({
        rows: sql.includes("count(*)") ? [{ count: "1" }] : [{ value: 1 }],
      })),
    } as unknown as Pool;
    const videoStorage = {
      enabled: false,
      checkHealth: vi.fn(async () => true),
    } as unknown as VideoStorage;
    const app = Fastify();
    registerSystemRoutes(app, {
      config: readConfig({
        NODE_ENV: "test",
        APP_SOURCE_URL: "https://github.com/example/infosteed",
        RELEASE_COMMIT: "abc123",
      }),
      pool,
      videoStorage,
    });

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      ok: true,
      checks: { postgres: true, objectStorage: true },
    });
    const info = await app.inject({ method: "GET", url: "/system/info" });
    expect(info.json()).toMatchObject({
      productName: "InfoSteed",
      releaseCommit: "abc123",
      setupRequired: false,
      exactSourceUrl: "https://github.com/example/infosteed/tree/abc123",
    });
    await app.close();
  });
});
