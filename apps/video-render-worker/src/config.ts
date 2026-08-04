// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const optional = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);
const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const schema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .default("postgres://infosteed:infosteed@localhost:54329/infosteed"),
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().trim().min(1),
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: z
    .preprocess(
      (value) =>
        typeof value === "boolean" ? value : value === "true" || value === "1",
      z.boolean(),
    )
    .default(true),
  VIDEO_RENDER_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .max(8)
    .default(1),
  VIDEO_RENDER_FFMPEG_PATH: z.string().trim().min(1).default("ffmpeg"),
  VIDEO_RENDER_FFPROBE_PATH: z.string().trim().min(1).default("ffprobe"),
  VIDEO_RENDER_TEMP_DIR: optional,
  VIDEO_RENDER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(14_400_000),
  VIDEO_RENDER_STALE_MS: z.coerce.number().int().positive().default(300_000),
});

export type RenderConfig = z.infer<typeof schema>;

export function loadRenderConfig(): RenderConfig {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(currentDirectory, "../../../.env"),
  ];
  for (const envFile of candidates) {
    if (!existsSync(envFile)) continue;
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
      if (!match || line.trim().startsWith("#")) continue;
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] ??= value;
    }
    break;
  }
  return schema.parse(process.env);
}
