// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import JSZip from "jszip";
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
    two_factor_required: false,
    theme_preference: "system",
    created_at: new Date(),
    updated_at: new Date(),
  };
  return {
    async query(sql: string, values?: unknown[]) {
      if (sql.includes("count(*) as count from users"))
        return { rows: [{ count: "1" }] };
      if (sql.includes("delete from sessions")) return { rows: [] };
      if (sql.includes("join users u")) return { rows: [user] };
      if (sql.includes("set theme_preference = $2"))
        return {
          rows: [{ ...user, theme_preference: values?.[1] }],
        };
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
      if (sql.includes("select r.owner_user_id, pm.role")) {
        return {
          rows: [
            {
              owner_user_id: "00000000-0000-4000-8000-000000000099",
              role: "viewer",
            },
          ],
        };
      }
      if (sql.includes("from recording_video_exports")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000030",
              render_id: "00000000-0000-4000-8000-000000000020",
              status: "ready",
              progress: 1,
              byte_size: "4",
              error_message: null,
              storage_key: "videos/recording/exports/export.mp4",
              created_at: new Date("2026-08-04T10:00:00.000Z"),
              completed_at: new Date("2026-08-04T10:01:00.000Z"),
            },
          ],
        };
      }
      if (sql.includes("select * from recordings where id")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000010",
              title: "Example recording",
              purpose: null,
              audience: null,
              owner_user_id: user.id,
              project_id: "00000000-0000-4000-8000-000000000040",
              deleted_at: null,
              capture_mode: "video",
              state: "ready",
              created_at: new Date("2026-08-04T09:00:00.000Z"),
              updated_at: new Date("2026-08-04T10:00:00.000Z"),
              finalized_at: new Date("2026-08-04T10:00:00.000Z"),
            },
          ],
        };
      }
      if (
        sql.includes("select * from recording_events") ||
        sql.includes("select * from guide_items")
      )
        return { rows: [] };
      if (sql.includes("from screenshots")) return { rows: [] };
      if (sql.trim() === "select 1") return { rows: [{ "?column?": 1 }] };
      throw new Error(`Unexpected test query: ${sql}`);
    },
  } as unknown as Pool;
}

function appFor(
  role?: "admin" | "user",
  csrfToken?: string,
  videoStorage: VideoStorage = storage,
) {
  return buildApp(
    readConfig({ NODE_ENV: "test", VIDEO_RENDER_ENABLED: "false" }),
    testPool(role, csrfToken),
    videoStorage,
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

  it("protects the Wiziwig export without a session", async () => {
    const app = appFor();
    openApps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/recordings/00000000-0000-4000-8000-000000000010/export/wiziwig",
    });

    expect(response.statusCode).toBe(401);
  });

  it("serves the Wiziwig export as a named ZIP attachment", async () => {
    const app = appFor("admin");
    openApps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/recordings/00000000-0000-4000-8000-000000000010/export/wiziwig",
      headers: { cookie: "infosteed_session=session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="infosteed-guide-00000000-0000-4000-8000-000000000010-wiziwig.zip"',
    );
    const zip = await JSZip.loadAsync(response.rawPayload);
    expect(zip.file("guide.html")).toBeTruthy();
  });

  it("protects MP4 export status and download routes", async () => {
    const app = appFor();
    openApps.push(app);
    const base =
      "/recordings/00000000-0000-4000-8000-000000000010/video/renders/00000000-0000-4000-8000-000000000020/mp4-export";
    const [status, content] = await Promise.all([
      app.inject({ method: "GET", url: base }),
      app.inject({ method: "GET", url: `${base}/content` }),
    ]);
    expect(status.statusCode).toBe(401);
    expect(content.statusCode).toBe(401);
  });

  it("requires editor access for MP4 export status", async () => {
    const app = appFor("user");
    openApps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/recordings/00000000-0000-4000-8000-000000000010/video/renders/00000000-0000-4000-8000-000000000020/mp4-export",
      headers: { cookie: "infosteed_session=session" },
    });
    expect(response.statusCode).toBe(403);
  });

  it("serves completed MP4 exports as named attachments", async () => {
    const mp4Storage: VideoStorage = {
      ...storage,
      enabled: true,
      async getObject() {
        return {
          body: Buffer.from("mp4"),
          contentLength: 3,
          contentType: "video/mp4",
          etag: '"export-etag"',
        };
      },
    };
    const app = appFor("admin", undefined, mp4Storage);
    openApps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/recordings/00000000-0000-4000-8000-000000000010/video/renders/00000000-0000-4000-8000-000000000020/mp4-export/content",
      headers: { cookie: "infosteed_session=session" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("video/mp4");
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="Example-recording.mp4"',
    );
    expect(response.body).toBe("mp4");
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

  it("updates the current user's theme preference", async () => {
    const token = "test-csrf-token";
    const app = appFor("user", token);
    openApps.push(app);
    const response = await app.inject({
      method: "PATCH",
      url: "/auth/me/preferences",
      headers: {
        cookie: "infosteed_session=session",
        "x-csrf-token": token,
      },
      payload: { themePreference: "dark" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.themePreference).toBe("dark");
  });

  it("rejects invalid theme preferences", async () => {
    const token = "test-csrf-token";
    const app = appFor("user", token);
    openApps.push(app);
    const response = await app.inject({
      method: "PATCH",
      url: "/auth/me/preferences",
      headers: {
        cookie: "infosteed_session=session",
        "x-csrf-token": token,
      },
      payload: { themePreference: "midnight" },
    });

    expect(response.statusCode).toBe(400);
  });
});
