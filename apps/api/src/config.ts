// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";

const optionalEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);
const optionalUrlEnv = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);
const commaSeparatedOrigins = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  z.array(z.string().url()).default([]),
);
const booleanEnv = z.preprocess(
  (value) =>
    typeof value === "boolean" ? value : value === "true" || value === "1",
  z.boolean(),
);

const configSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z
      .string()
      .url()
      .default("postgres://infosteed:infosteed@localhost:54329/infosteed"),
    PORT: z.coerce.number().int().positive().default(3777),
    HOST: z.string().default("127.0.0.1"),
    AI_PROVIDER: z
      .enum(["openai-compatible", "ollama"])
      .default("openai-compatible"),
    AI_ENDPOINT: optionalUrlEnv,
    AI_API_KEY: optionalEnv,
    AI_MODEL: optionalEnv,
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    AI_SCRIPT_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
    TRANSCRIPTION_PROVIDER: z
      .enum(["openai-compatible"])
      .default("openai-compatible"),
    TRANSCRIPTION_ENDPOINT: optionalUrlEnv,
    TRANSCRIPTION_API_KEY: optionalEnv,
    TRANSCRIPTION_MODEL: z.string().trim().min(1).default("large-v3-turbo"),
    TRANSCRIPTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5_400_000),
    TRANSCRIPTION_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25_000_000),
    TTS_BASE_URL: optionalUrlEnv,
    TTS_API_KEY: optionalEnv,
    TTS_MODEL: z.string().trim().min(1).default("kokoro"),
    TTS_DEFAULT_VOICE: z.string().trim().min(1).default("af_heart"),
    TTS_VOICES: z
      .string()
      .trim()
      .min(1)
      .default(
        "af_heart,af_bella,af_nicole,am_adam,am_michael,bf_emma,bm_george",
      ),
    TTS_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    TTS_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25_000_000),
    TTS_FFMPEG_PATH: z.string().trim().min(1).default("ffmpeg"),
    TTS_FFPROBE_PATH: z.string().trim().min(1).default("ffprobe"),
    TTS_TEMP_DIR: optionalEnv,
    VIDEO_RENDER_ENABLED: booleanEnv.default(true),
    VIDEO_RENDER_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .max(8)
      .default(1),
    VIDEO_RENDER_FFMPEG_PATH: z.string().trim().min(1).default("ffmpeg"),
    VIDEO_RENDER_FFPROBE_PATH: z.string().trim().min(1).default("ffprobe"),
    VIDEO_RENDER_TEMP_DIR: optionalEnv,
    VIDEO_RENDER_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(14_400_000),
    VIDEO_RENDER_STALE_MS: z.coerce.number().int().positive().default(300_000),
    VIDEO_RENDER_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
    WEB_ORIGIN: z.string().default("http://localhost:5173"),
    EXTENSION_ORIGINS: commaSeparatedOrigins,
    APP_SOURCE_URL: optionalUrlEnv,
    RELEASE_VERSION: z.string().trim().min(1).default("0.1.0-beta.8"),
    RELEASE_COMMIT: z.string().trim().min(1).default("development"),
    APP_DOMAIN: optionalEnv,
    TWO_FACTOR_ENABLED: booleanEnv.default(false),
    TWO_FACTOR_ENCRYPTION_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/)
        .optional(),
    ),
    ACME_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().email().optional(),
    ),
    SETUP_TOKEN: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(32).max(1024).optional(),
    ),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
    S3_ENDPOINT: optionalUrlEnv,
    S3_REGION: z.string().default("us-east-1"),
    S3_BUCKET: optionalEnv,
    S3_ACCESS_KEY_ID: optionalEnv,
    S3_SECRET_ACCESS_KEY: optionalEnv,
    S3_FORCE_PATH_STYLE: booleanEnv.default(true),
    SESSION_COOKIE_NAME: z.string().default(PRODUCT_IDENTIFIERS.sessionCookie),
    SESSION_DAYS: z.coerce.number().int().positive().default(7),
    COOKIE_SECURE: z
      .preprocess((value) => value === "true" || value === "1", z.boolean())
      .default(false),
  })
  .superRefine((config, context) => {
    if (config.TWO_FACTOR_ENABLED && !config.TWO_FACTOR_ENCRYPTION_KEY) {
      context.addIssue({
        code: "custom",
        path: ["TWO_FACTOR_ENCRYPTION_KEY"],
        message: "Required when TWO_FACTOR_ENABLED is true",
      });
    }
    if (config.NODE_ENV !== "production") return;
    if (!config.APP_SOURCE_URL)
      context.addIssue({
        code: "custom",
        path: ["APP_SOURCE_URL"],
        message: "Required in production",
      });
    if (!config.APP_DOMAIN)
      context.addIssue({
        code: "custom",
        path: ["APP_DOMAIN"],
        message: "Required in production",
      });
    if (!config.SETUP_TOKEN)
      context.addIssue({
        code: "custom",
        path: ["SETUP_TOKEN"],
        message: "Required in production",
      });
    if (!config.COOKIE_SECURE)
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message: "Must be true in production",
      });
    if (!config.WEB_ORIGIN.startsWith("https://"))
      context.addIssue({
        code: "custom",
        path: ["WEB_ORIGIN"],
        message: "Must use HTTPS in production",
      });
    if (config.TRUST_PROXY_HOPS !== 1)
      context.addIssue({
        code: "custom",
        path: ["TRUST_PROXY_HOPS"],
        message: "Must be exactly 1 in production",
      });
  });

export type ApiConfig = z.infer<typeof configSchema>;

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadDotEnv(): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(currentDir, "../../../.env"),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
      if (!match) continue;
      process.env[match[1]] ??= unquoteEnvValue(match[2]);
    }
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return configSchema.parse(env);
}
