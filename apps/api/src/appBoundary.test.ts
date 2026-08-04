// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { readConfig } from "./config";
import type { Pool } from "./db";
import type { VideoStorage } from "./videoStorage";

const storage: VideoStorage = {
  enabled: false,
  close() {},
  checkHealth: async () => true,
  async createMultipartUpload() {
    throw new Error("disabled");
  },
  async uploadPart() {
    throw new Error("disabled");
  },
  async completeMultipartUpload() {
    throw new Error("disabled");
  },
  async abortMultipartUpload() {
    throw new Error("disabled");
  },
  async getObject() {
    throw new Error("disabled");
  },
  async deleteObject() {
    throw new Error("disabled");
  },
};

function testPool(role: "admin" | "user" = "user", csrfToken?: string): Pool {
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    username: "tester",
    display_name: "Test User",
    password_hash: "unused",
    role,
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
  };
  return {
    async query(sql: string) {
      if (sql.includes("count(*) as count from users"))
        return { rows: [{ count: "1" }] };
      if (sql.includes("delete from sessions")) return { rows: [] };
      if (sql.includes("join users u")) return { rows: [user] };
      if (sql.includes("select csrf_token_hash from sessions")) {
        return {
          rows: [
            {
              csrf_token_hash: csrfToken
                ? createHash("sha256").update(csrfToken).digest("base64url")
                : null,
            },
          ],
        };
      }
      if (sql.trim() === "select 1") return { rows: [{ "?column?": 1 }] };
      throw new Error(`Unexpected test query: ${sql}`);
    },
  } as unknown as Pool;
}

function appFor(role?: "admin" | "user", csrfToken?: string) {
  return buildApp(
    readConfig({ NODE_ENV: "test", VIDEO_RENDER_ENABLED: "false" }),
    testPool(role, csrfToken),
    storage,
  );
}

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("API request boundaries", () => {
  it("reports liveness without authentication", async () => {
    const app = appFor();
    openApps.push(app);
    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects protected requests without a session", async () => {
    const app = appFor();
    openApps.push(app);
    const response = await app.inject({ method: "GET", url: "/users" });
    expect(response.statusCode).toBe(401);
  });

  it("enforces administrator authorization", async () => {
    const app = appFor("user");
    openApps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/users",
      headers: { cookie: "infosteed_session=session" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects state changes without a CSRF token", async () => {
    const app = appFor("admin");
    openApps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/projects",
      headers: { cookie: "infosteed_session=session" },
      payload: { name: "Docs", private: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it("validates route input after authentication and CSRF checks", async () => {
    const token = "test-csrf-token";
    const app = appFor("admin", token);
    openApps.push(app);
    const response = await app.inject({
      method: "PATCH",
      url: "/settings/branding",
      headers: {
        cookie: "infosteed_session=session",
        "x-csrf-token": token,
      },
      payload: { iconDataUrl: "not-an-image" },
    });
    expect(response.statusCode).toBe(400);
  });
});
