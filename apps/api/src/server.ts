// SPDX-License-Identifier: AGPL-3.0-only
import { buildApp } from "./app.js";
import { loadDotEnv, readConfig } from "./config.js";
import { createPool, runMigrations } from "./db.js";
import { createVideoStorage } from "./videoStorage.js";
import { cleanupVideos } from "./videoCleanup.js";

loadDotEnv();
const config = readConfig();
const pool = createPool(config.DATABASE_URL);

await runMigrations(pool);

const videoStorage = createVideoStorage(config);
const app = buildApp(config, pool, videoStorage);
await app.listen({ host: config.HOST, port: config.PORT });
await cleanupVideos(pool, videoStorage).catch((error) =>
  app.log.error(error, "Initial video cleanup failed"),
);
const cleanupTimer = setInterval(
  () => {
    void cleanupVideos(pool, videoStorage).catch((error) =>
      app.log.error(error, "Scheduled video cleanup failed"),
    );
  },
  60 * 60 * 1000,
);
cleanupTimer.unref();
app.log.info(
  {
    aiProvider:
      config.AI_ENDPOINT && config.AI_MODEL ? config.AI_PROVIDER : "disabled",
    aiTimeoutMs: config.AI_TIMEOUT_MS,
    aiScriptTimeoutMs: config.AI_SCRIPT_TIMEOUT_MS,
    transcriptionProvider: config.TRANSCRIPTION_ENDPOINT
      ? config.TRANSCRIPTION_PROVIDER
      : "disabled",
    transcriptionMaxUploadBytes: config.TRANSCRIPTION_MAX_UPLOAD_BYTES,
    textToSpeechProvider: config.TTS_BASE_URL ? "configured" : "disabled",
    releaseVersion: config.RELEASE_VERSION,
    releaseCommit: config.RELEASE_COMMIT,
  },
  "InfoSteed API started",
);

const shutdown = async () => {
  clearInterval(cleanupTimer);
  await app.close();
  videoStorage.close();
  await pool.end();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
