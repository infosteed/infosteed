// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

describe("video storage configuration", () => {
  it("defaults path-style addressing on for self-hosted S3 services", () => {
    expect(readConfig({}).S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("keeps transcription disabled until an endpoint is configured", () => {
    const local = readConfig({
      TRANSCRIPTION_ENDPOINT: "http://127.0.0.1:8787/v1",
    });
    expect(local.TRANSCRIPTION_MODEL).toBe("large-v3-turbo");
    expect(local.TRANSCRIPTION_TIMEOUT_MS).toBe(5_400_000);
    expect(local.TRANSCRIPTION_MAX_UPLOAD_BYTES).toBe(25_000_000);
    expect(readConfig({}).TRANSCRIPTION_ENDPOINT).toBeUndefined();
  });

  it("allows longer local-model caption rewrites by default", () => {
    const config = readConfig({});
    expect(config.AI_TIMEOUT_MS).toBe(30_000);
    expect(config.AI_SCRIPT_TIMEOUT_MS).toBe(300_000);
  });

  it("accepts an external S3 bucket without static credentials for workload identity", () => {
    const config = readConfig({
      S3_BUCKET: "videos",
      S3_FORCE_PATH_STYLE: "false",
    });
    expect(config.S3_BUCKET).toBe("videos");
    expect(config.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("uses conservative defaults for the durable render worker", () => {
    const config = readConfig({});
    expect(config.VIDEO_RENDER_ENABLED).toBe(true);
    expect(config.VIDEO_RENDER_CONCURRENCY).toBe(1);
    expect(config.VIDEO_RENDER_TIMEOUT_MS).toBe(14_400_000);
    expect(config.VIDEO_RENDER_RETENTION_DAYS).toBe(7);
  });

  it("parses an explicit extension origin allow-list", () => {
    expect(
      readConfig({
        EXTENSION_ORIGINS:
          "chrome-extension://abc, https://extension.example.test",
      }).EXTENSION_ORIGINS,
    ).toEqual(["chrome-extension://abc", "https://extension.example.test"]);
  });

  it("rejects an unsafe production configuration", () => {
    expect(() => readConfig({ NODE_ENV: "production" })).toThrow();
  });
});
