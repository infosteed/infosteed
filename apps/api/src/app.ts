// SPDX-License-Identifier: AGPL-3.0-only
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import { chromium } from "playwright";
import {
  annotateScreenshot,
  applyScreenshotEdits,
  convertImageToJpeg,
  convertImageToPng,
  prepareAiScreenshotDataUrl,
  screenshotHighlightRect,
} from "@infosteed/image-processor";
import {
  buildEmbeddedHtml,
  buildGuideImagesZip,
  buildTemplatedWorkflowDocx,
  buildWiziwigZip,
  buildWorkflowDocx,
  buildWorkflowZip,
} from "@infosteed/markdown-exporter";
import type { WiziwigImageExportFormat } from "@infosteed/markdown-exporter";
import { buildSanityImportTarGz } from "@infosteed/markdown-exporter/sanity";
import {
  createGuideItemRequestSchema,
  createGuideVersionRequestSchema,
  createRecordingRequestSchema,
  loginRequestSchema,
  twoFactorEnrollmentConfirmRequestSchema,
  twoFactorEnrollmentStartRequestSchema,
  twoFactorLoginRequestSchema,
  twoFactorProofRequestSchema,
  moveRecordingProjectRequestSchema,
  recordingProjectSchema,
  reorderGuideItemsRequestSchema,
  reorderGuideStepsRequestSchema,
  replaceGuideItemImageRequestSchema,
  screenshotEditOperationsSchema,
  setupAdminRequestSchema,
  updateOwnPasswordRequestSchema,
  updateOwnPreferencesRequestSchema,
  updateRecordingRequestSchema,
  updateGuideItemRequestSchema,
  updateGuideStepRequestSchema,
  uploadEventsRequestSchema,
  uploadScreenshotRequestSchema,
  initializeVideoRequestSchema,
  finalizeVideoRequestSchema,
  saveVideoEditRecipeRequestSchema,
  createVideoEditVersionRequestSchema,
  createVideoRenderRequestSchema,
  createVoiceoverRequestSchema,
  rewriteNarrationScriptRequestSchema,
  outputLocaleRequestSchema,
  videoAssetKindSchema,
  videoEditedDurationMs,
  videoRecipeCaptions,
  videoRecipeChapters,
  PRODUCT_IDENTIFIERS,
  PROTOCOL_VERSION,
  boundingBoxSchema,
} from "@infosteed/shared";
import type {
  RecordingProject,
  ScreenshotEditOperations,
  VideoChapter,
} from "@infosteed/shared";
import type { ApiConfig } from "./config.js";
import { createAiProvider } from "./aiProvider.js";
import type { Pool } from "./db.js";
import { withTransaction } from "./db.js";
import {
  resolveDocxExportBranding,
  resolveExportBranding,
} from "./exportBranding.js";
import {
  generateGuideSteps,
  generateGuideStepsForCaptureSession,
} from "./guideGeneration.js";
import {
  addGuideItem,
  addManualStep,
  createCaptureSession,
  createRecording,
  deleteGuideItemImage,
  deleteGuideStep,
  finalizeCaptureSession,
  finalizeRecording,
  findCaptureSession,
  findProjectScreenshotByFilename,
  findScreenshotByFilename,
  getRecording,
  importRecordingProject,
  insertEvents,
  insertScreenshot,
  listProjectScreenshotsForRecording,
  listScreenshotsForRecording,
  mergeWithNextStep,
  reorderGuideSteps,
  replaceGuideItemImage,
  restoreRecording,
  screenshotsByEvent,
  setRecordingState,
  softDeleteRecording,
  updateGuideItem,
  updateRecordingSummary,
  updateGuideStep,
  updateScreenshotEdits,
  upsertGeneratedStep,
} from "./repositories/recordings.js";
import type { ScreenshotRow } from "./repositories/recordings.js";
import {
  canEditProject,
  canManageProject,
  countUsers,
  createSession,
  deleteSession,
  deleteUserSessions,
  ensurePersonalProject,
  findUserByUsername,
  findUserWithPassword,
  getBranding,
  getProjectRole,
  getSessionUser,
  isLoginRateLimited,
  issueCsrfToken,
  listAccessibleRecordings,
  moveRecordingToProject,
  passwordNeedsRehash,
  recordLoginAttempt,
  recordingAccessRole,
  setupFirstAdmin,
  updateOwnPassword,
  updateOwnThemePreference,
  verifyCsrfToken,
  verifyPassword,
  writeAuditEvent,
} from "./repositories/auth.js";
import type { AuthUser } from "./repositories/auth.js";
import {
  confirmTwoFactorEnrollment,
  createEnrollmentChallenge,
  createTwoFactorContinuation,
  getTwoFactorContinuationPurpose,
  getTwoFactorStatus,
  replaceRecoveryCodes,
  resetUserTwoFactor,
  userHasTwoFactor,
  verifyExistingSecondFactor,
  verifyLoginSecondFactor,
} from "./repositories/twoFactor.js";
import {
  buildGuideVersionSnapshot,
  createGuideVersion,
  getGuideVersion,
  listGuideVersions,
  restoreGuideVersionCore,
} from "./repositories/versions.js";
import type { GuideVersionSnapshot } from "./repositories/versions.js";
import { writeGuideOverview, writeStep } from "@infosteed/ai-step-writer";
import { buildVideoChapters } from "./videoChapters.js";
import { createVideoStorage, type VideoStorage } from "./videoStorage.js";
import { createTranscriptionProvider } from "./transcriptionProvider.js";
import { TranscriptionWorker } from "./transcriptionWorker.js";
import { transcriptAround, transcriptToWebVtt } from "./transcriptContext.js";
import {
  completeVideoAsset,
  createVideo,
  deleteVideoRows,
  getRecordingVideo,
  getVideoAsset,
  getVideoRows,
  getRecordingTranscript,
  listVideoChapterTitles,
  listVideoParts,
  markVideoReady,
  queueVideoTranscription,
  retryTranscription,
  saveVideoPart,
  setVideoPublished,
} from "./repositories/videos.js";
import {
  createVideoEditVersion,
  createVideoRender,
  getOrCreateVideoEditDraft,
  getPublishedVideoEditRecipe,
  getSourceAssetsForEditor,
  getVideoRender,
  listRenderStorageForVideo,
  listVideoEditVersions,
  listVideoRenders,
  mapSourceAssetForEditor,
  publishVideoRender,
  requestRenderCancellation,
  resetVideoEditDraft,
  resolvePublishedRenderStorageKey,
  restoreVideoEditVersion,
  saveVideoEditDraft,
  videoRenderWorkerAvailable,
} from "./repositories/videoEditing.js";
import {
  getVideoMp4Export,
  listExportStorageForVideo,
  queueVideoMp4Export,
} from "./repositories/videoExports.js";
import { createTtsProvider } from "./ttsProvider.js";
import { VoiceoverWorker } from "./voiceoverWorker.js";
import { rewriteNarrationScript } from "./narrationScript.js";
import {
  getLatestVoiceoverGeneration,
  getVoiceoverCueClip,
  getVoiceoverGeneration,
  queueVoiceoverGeneration,
} from "./repositories/voiceovers.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerWordTemplateRoutes } from "./routes/wordTemplates.js";
import { registerExtensionRoutes } from "./routes/extensions.js";
import {
  findUserDisplayName,
  getDefaultWordTemplate,
  getWordTemplate,
} from "./repositories/wordTemplates.js";

export interface RegisteredRoute {
  method: string;
  url: string;
}

const routeInventories = new WeakMap<FastifyInstance, RegisteredRoute[]>();

export function registeredRoutes(app: FastifyInstance): RegisteredRoute[] {
  return (routeInventories.get(app) ?? [])
    .slice()
    .sort((left, right) =>
      `${left.url}:${left.method}`.localeCompare(
        `${right.url}:${right.method}`,
      ),
    );
}

export function buildApp(
  config: ApiConfig,
  pool: Pool,
  videoStorage: VideoStorage = createVideoStorage(config),
) {
  const app = Fastify({
    logger: true,
    trustProxy: config.TRUST_PROXY_HOPS === 1 ? 1 : false,
  });
  const routeInventory: RegisteredRoute[] = [];
  routeInventories.set(app, routeInventory);
  app.addHook("onRoute", (route) => {
    for (const method of Array.isArray(route.method)
      ? route.method
      : [route.method]) {
      routeInventory.push({ method, url: route.url });
    }
  });
  const provider = createAiProvider(config);
  const transcriptionProvider = createTranscriptionProvider(config);
  const transcriptionAvailable = Boolean(transcriptionProvider);
  const transcriptionWorker = new TranscriptionWorker(
    pool,
    videoStorage,
    transcriptionProvider,
    provider,
    app.log,
  );
  const ttsProvider = createTtsProvider(config);
  const voiceoverWorker = new VoiceoverWorker(
    config,
    pool,
    videoStorage,
    ttsProvider,
    app.log,
  );
  const httpError = (statusCode: number, message: string) =>
    Object.assign(new Error(message), { statusCode });
  const requestUsers = new WeakMap<FastifyRequest, AuthUser>();
  const requestSessionIds = new WeakMap<FastifyRequest, string>();

  function exportTimestampSuffix(date = new Date()): string {
    return date
      .toISOString()
      .replace(/Z$/, "")
      .replace(/[^0-9A-Za-z]/g, "");
  }

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );
  app.addHook("onReady", async () => {
    await transcriptionWorker.start();
    await voiceoverWorker.start();
  });
  app.addHook("onClose", async () => {
    await Promise.all([transcriptionWorker.stop(), voiceoverWorker.stop()]);
  });

  function parseCookies(header: string | undefined): Map<string, string> {
    const cookies = new Map<string, string>();
    for (const part of (header ?? "").split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      if (!rawName) continue;
      cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
    }
    return cookies;
  }

  function makeSessionCookie(sessionId: string, maxAgeSeconds: number): string {
    const secure = config.COOKIE_SECURE ? "; Secure" : "";
    return `${config.SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
  }

  function clearSessionCookie(): string {
    const secure = config.COOKIE_SECURE ? "; Secure" : "";
    return `${config.SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  }

  function validSetupToken(provided: string): boolean {
    if (!config.SETUP_TOKEN) return false;
    const expected = Buffer.from(config.SETUP_TOKEN);
    const actual = Buffer.from(provided);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  function currentUser(request: FastifyRequest): AuthUser {
    const user = requestUsers.get(request);
    if (!user) throw httpError(401, "Login required");
    return user;
  }

  function currentSessionId(request: FastifyRequest): string {
    const sessionId = requestSessionIds.get(request);
    if (!sessionId) throw httpError(401, "Login required");
    return sessionId;
  }

  async function resolveScreenshotEditOperations(
    screenshot: ScreenshotRow,
    operations = screenshot.edit_operations ?? { redactions: [] },
  ): Promise<ScreenshotEditOperations> {
    if (
      operations.highlight !== undefined ||
      !screenshot.target_box ||
      !screenshot.original_image
    )
      return operations;

    const targetBox = boundingBoxSchema.safeParse(screenshot.target_box);
    if (!targetBox.success) return operations;
    return {
      ...operations,
      highlight: await screenshotHighlightRect(
        screenshot.original_image,
        targetBox.data,
      ),
    };
  }

  function requestMetadata(request: FastifyRequest) {
    const userAgent = request.headers["user-agent"];
    return {
      ipAddress: request.ip,
      userAgent: Array.isArray(userAgent)
        ? userAgent.join(" ")
        : (userAgent ?? null),
    };
  }

  async function audit(
    request: FastifyRequest,
    eventType: string,
    entityType?: string | null,
    entityId?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    const actor = requestUsers.get(request);
    await writeAuditEvent(pool, {
      actorUserId: actor?.id ?? null,
      eventType,
      entityType,
      entityId,
      ...requestMetadata(request),
      metadata,
    });
  }

  async function twoFactorIssuer(): Promise<string> {
    return (await getBranding(pool)).displayName || "InfoSteed";
  }

  async function requireCurrentPassword(userId: string, password: string) {
    const user = await findUserWithPassword(pool, userId);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw httpError(401, "Current password is incorrect");
    }
    return user;
  }

  async function requireCurrentPasswordAndSecondFactor(
    userId: string,
    password: string,
    code: string,
  ) {
    const user = await requireCurrentPassword(userId, password);
    const verified = await withTransaction(pool, async (client) =>
      verifyExistingSecondFactor(client, config, { userId, code }),
    );
    if (!verified.ok) throw httpError(401, "Second-factor code is incorrect");
    return { user, usedRecoveryCode: verified.recovery };
  }

  async function ensureGuideActive(recordingId: string) {
    const recording = await getRecording(pool, recordingId);
    if (!recording) throw httpError(404, "Recording not found");
    if (recording.deletedAt)
      throw httpError(409, "Restore this guide before changing it");
    return recording;
  }

  async function createAutoVersion(
    request: FastifyRequest,
    recordingId: string,
  ) {
    const recording = await getRecording(pool, recordingId);
    if (!recording || recording.deletedAt) return;
    const snapshot = await buildGuideVersionSnapshot(pool, recordingId);
    await createGuideVersion(pool, {
      recordingId,
      userId: currentUser(request).id,
      versionType: "auto",
      snapshot,
      coalesceAuto: true,
    });
  }

  async function requireRecordingRead(
    request: FastifyRequest,
    recordingId: string,
  ) {
    const role = await recordingAccessRole(
      pool,
      currentUser(request),
      recordingId,
    );
    if (!role) throw httpError(404, "Recording not found");
    return role;
  }

  async function requireRecordingWrite(
    request: FastifyRequest,
    recordingId: string,
  ) {
    const role = await requireRecordingRead(request, recordingId);
    if (!canEditProject(role))
      throw httpError(403, "You do not have editor access to this guide");
    return role;
  }

  async function videoChapters(recordingId: string): Promise<VideoChapter[]> {
    const recording = await getRecording(pool, recordingId);
    const titles = recording
      ? await listVideoChapterTitles(pool, recordingId)
      : new Map<string, string>();
    return recording ? buildVideoChapters(recording, titles) : [];
  }

  async function videoResponse(recordingId: string) {
    const published = await getPublishedVideoEditRecipe(pool, recordingId);
    const video = await getRecordingVideo(
      pool,
      recordingId,
      published
        ? videoRecipeChapters(published.recipe)
        : await videoChapters(recordingId),
      transcriptionAvailable,
    );
    if (!video) return null;
    return {
      ...video,
      editingAvailable: config.VIDEO_RENDER_ENABLED && videoStorage.enabled,
      renderWorkerAvailable:
        config.VIDEO_RENDER_ENABLED && (await videoRenderWorkerAvailable(pool)),
      playbackVersionId: published?.versionId ?? null,
      effectiveDurationMs: published
        ? videoEditedDurationMs(published.recipe)
        : video.durationMs,
    };
  }

  async function playbackTranscript(recordingId: string) {
    const transcript = await getRecordingTranscript(pool, recordingId);
    if (!transcript) return null;
    const published = await getPublishedVideoEditRecipe(pool, recordingId);
    if (!published) return transcript;
    const cues = videoRecipeCaptions(published.recipe, transcript.cues);
    return {
      ...transcript,
      durationMs: videoEditedDurationMs(published.recipe),
      text: cues
        .map((cue) => cue.text)
        .join(" ")
        .trim(),
      segments: cues,
      cues,
      words: [],
    };
  }

  async function requireProjectManage(
    request: FastifyRequest,
    projectId: string,
  ) {
    const role = await getProjectRole(pool, currentUser(request), projectId);
    if (!canManageProject(role))
      throw httpError(
        role ? 403 : 404,
        "You do not have owner access to this project",
      );
    return role;
  }

  async function requireProjectRead(
    request: FastifyRequest,
    projectId: string,
  ) {
    const role = await getProjectRole(pool, currentUser(request), projectId);
    if (!role) throw httpError(404, "Project not found");
    return role;
  }

  function requireAdmin(request: FastifyRequest) {
    const user = currentUser(request);
    if (user.role !== "admin") throw httpError(403, "Admin access required");
    return user;
  }

  app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = new Set([config.WEB_ORIGIN, ...config.EXTENSION_ORIGINS]);
      const developmentLocalhost =
        config.NODE_ENV !== "production" &&
        (/^http:\/\/localhost:\d+$/.test(origin) ||
          /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
      if (allowed.has(origin) || developmentLocalhost) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  app.register(rateLimit, { global: false });

  app.addHook("preHandler", async (request) => {
    if (request.method === "OPTIONS") return;
    const path = request.url.split("?")[0];
    const publicRoutes = new Set([
      "/health/live",
      "/health/ready",
      "/system/info",
      "/setup/status",
      "/setup/admin",
      "/auth/login",
      "/auth/login/2fa",
      "/downloads/extension-offline.zip",
    ]);
    const setupRequired = (await countUsers(pool)) === 0;
    if (setupRequired) {
      if (publicRoutes.has(path)) return;
      throw httpError(428, "Initial admin setup required");
    }
    if (publicRoutes.has(path)) return;

    const sessionId = parseCookies(request.headers.cookie).get(
      config.SESSION_COOKIE_NAME,
    );
    if (!sessionId) throw httpError(401, "Login required");
    const user = await getSessionUser(pool, sessionId);
    if (!user) throw httpError(401, "Login required");
    requestUsers.set(request, user);
    requestSessionIds.set(request, sessionId);

    if (request.method === "GET") return;
    const csrfToken = request.headers[PRODUCT_IDENTIFIERS.csrfHeader];
    if (
      !(await verifyCsrfToken(
        pool,
        sessionId,
        Array.isArray(csrfToken) ? csrfToken[0] : csrfToken,
      ))
    ) {
      throw httpError(403, "Invalid or missing CSRF token");
    }
  });

  registerSystemRoutes(app, { config, pool, videoStorage });

  app.post(
    "/setup/admin",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = setupAdminRequestSchema.parse(request.body);
      if (!config.SETUP_TOKEN)
        throw httpError(
          503,
          "Initial setup is not enabled until SETUP_TOKEN is configured",
        );
      if (!validSetupToken(input.setupToken))
        throw httpError(403, "Invalid setup token");
      if ((await countUsers(pool)) > 0)
        throw httpError(409, "Setup is already complete");
      const { setupToken: _setupToken, ...adminInput } = input;
      let admin: Awaited<ReturnType<typeof setupFirstAdmin>>;
      try {
        admin = await withTransaction(pool, (client) =>
          setupFirstAdmin(client, adminInput),
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Setup is already complete"
        )
          throw httpError(409, error.message);
        throw error;
      }
      const session = await createSession(pool, admin.id, config.SESSION_DAYS);
      await writeAuditEvent(pool, {
        actorUserId: admin.id,
        eventType: "setup_admin_created",
        entityType: "user",
        entityId: admin.id,
        ...requestMetadata(request),
      });
      return reply
        .header(
          "set-cookie",
          makeSessionCookie(session.id, config.SESSION_DAYS * 24 * 60 * 60),
        )
        .code(201)
        .send({ user: admin });
    },
  );

  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = loginRequestSchema.parse(request.body);
      const meta = requestMetadata(request);
      if (
        await isLoginRateLimited(pool, {
          username: input.username,
          ipAddress: meta.ipAddress,
        })
      ) {
        await writeAuditEvent(pool, {
          actorUserId: null,
          eventType: "login_blocked",
          entityType: "user",
          entityId: null,
          ...meta,
          metadata: { username: input.username },
        });
        throw httpError(
          429,
          "Too many failed login attempts. Try again shortly.",
        );
      }
      const user = await findUserByUsername(pool, input.username);
      if (
        !user ||
        !user.enabled ||
        !(await verifyPassword(input.password, user.passwordHash))
      ) {
        await recordLoginAttempt(pool, {
          username: input.username,
          ipAddress: meta.ipAddress,
          success: false,
        });
        await writeAuditEvent(pool, {
          actorUserId: user?.id ?? null,
          eventType: "login_failed",
          entityType: "user",
          entityId: user?.id ?? null,
          ...meta,
          metadata: {
            username: input.username,
            enabled: user?.enabled ?? null,
          },
        });
        throw httpError(401, "Invalid username or password");
      }
      await recordLoginAttempt(pool, {
        username: input.username,
        ipAddress: meta.ipAddress,
        success: true,
      });
      if (passwordNeedsRehash(user.passwordHash)) {
        await updateOwnPassword(pool, user.id, input.password);
      }
      if (user.twoFactorEnabled) {
        const continuation = await createTwoFactorContinuation(pool, config, {
          userId: user.id,
          purpose: "login",
        });
        await writeAuditEvent(pool, {
          actorUserId: user.id,
          eventType: "login_second_factor_required",
          entityType: "user",
          entityId: user.id,
          ...meta,
        });
        return reply.send({
          status: "two_factor_required",
          continuationToken: continuation.token,
        });
      }
      if (user.twoFactorRequired) {
        if (!config.TWO_FACTOR_ENABLED) {
          await writeAuditEvent(pool, {
            actorUserId: user.id,
            eventType: "login_two_factor_enrollment_blocked",
            entityType: "user",
            entityId: user.id,
            ...meta,
          });
          throw httpError(
            503,
            "Two-factor enrollment is required for this account but disabled for this deployment",
          );
        }
        const challenge = await createEnrollmentChallenge(pool, config, {
          userId: user.id,
          username: user.username,
          issuer: await twoFactorIssuer(),
          appDomain: config.APP_DOMAIN,
          purpose: "enrollment_login",
        });
        await writeAuditEvent(pool, {
          actorUserId: user.id,
          eventType: "login_two_factor_enrollment_required",
          entityType: "user",
          entityId: user.id,
          ...meta,
        });
        return reply.send({
          status: "two_factor_enrollment_required",
          ...challenge,
        });
      }
      await writeAuditEvent(pool, {
        actorUserId: user.id,
        eventType: "login_succeeded",
        entityType: "user",
        entityId: user.id,
        ...meta,
      });
      const session = await createSession(pool, user.id, config.SESSION_DAYS);
      const { passwordHash: _passwordHash, ...current } = user;
      return reply
        .header(
          "set-cookie",
          makeSessionCookie(session.id, config.SESSION_DAYS * 24 * 60 * 60),
        )
        .send({ user: current });
    },
  );

  app.post(
    "/auth/login/2fa",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = twoFactorLoginRequestSchema.parse(request.body);
      const meta = requestMetadata(request);
      const purpose = await getTwoFactorContinuationPurpose(
        pool,
        input.continuationToken,
      );
      if (purpose === "login") {
        const result = await withTransaction(pool, (client) =>
          verifyLoginSecondFactor(client, config, input),
        );
        if (!result.ok) {
          await writeAuditEvent(pool, {
            actorUserId: null,
            eventType: "login_second_factor_failed",
            ...meta,
          });
          throw httpError(401, "Invalid or expired second-factor code");
        }
        const loaded = await findUserWithPassword(pool, result.userId);
        if (!loaded || !loaded.enabled)
          throw httpError(401, "Invalid or expired second-factor code");
        const session = await createSession(
          pool,
          result.userId,
          config.SESSION_DAYS,
        );
        const { passwordHash: _passwordHash, ...current } = loaded;
        await writeAuditEvent(pool, {
          actorUserId: result.userId,
          eventType: result.usedRecoveryCode
            ? "login_succeeded_with_recovery_code"
            : "login_succeeded",
          entityType: "user",
          entityId: result.userId,
          ...meta,
        });
        return reply
          .header(
            "set-cookie",
            makeSessionCookie(session.id, config.SESSION_DAYS * 24 * 60 * 60),
          )
          .send({ user: current });
      }
      if (purpose === "enrollment_login") {
        const result = await withTransaction(pool, (client) =>
          confirmTwoFactorEnrollment(client, config, {
            continuationToken: input.continuationToken,
            code: input.code,
            allowedPurpose: "enrollment_login",
          }),
        );
        if (!result.ok) {
          await writeAuditEvent(pool, {
            actorUserId: null,
            eventType: "login_two_factor_enrollment_failed",
            ...meta,
            metadata: { reason: result.reason },
          });
          throw httpError(401, "Invalid or expired second-factor code");
        }
        const loaded = await findUserWithPassword(pool, result.userId);
        if (!loaded || !loaded.enabled)
          throw httpError(401, "Invalid or expired second-factor code");
        await deleteUserSessions(pool, result.userId);
        const session = await createSession(
          pool,
          result.userId,
          config.SESSION_DAYS,
        );
        const { passwordHash: _passwordHash, ...current } = loaded;
        await writeAuditEvent(pool, {
          actorUserId: result.userId,
          eventType: "two_factor_enrolled",
          entityType: "user",
          entityId: result.userId,
          ...meta,
          metadata: { duringLogin: true },
        });
        await writeAuditEvent(pool, {
          actorUserId: result.userId,
          eventType: "login_succeeded",
          entityType: "user",
          entityId: result.userId,
          ...meta,
        });
        return reply
          .header(
            "set-cookie",
            makeSessionCookie(session.id, config.SESSION_DAYS * 24 * 60 * 60),
          )
          .send({ user: current, recoveryCodes: result.recoveryCodes });
      }
      await writeAuditEvent(pool, {
        actorUserId: null,
        eventType: "login_second_factor_failed",
        ...meta,
        metadata: { reason: "invalid_continuation" },
      });
      throw httpError(401, "Invalid or expired second-factor code");
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    const sessionId = parseCookies(request.headers.cookie).get(
      config.SESSION_COOKIE_NAME,
    );
    await audit(request, "logout", "session", sessionId ?? null);
    if (sessionId) await deleteSession(pool, sessionId);
    return reply.header("set-cookie", clearSessionCookie()).send({ ok: true });
  });

  app.post("/auth/logout-all", async (request, reply) => {
    const user = currentUser(request);
    await deleteUserSessions(pool, user.id);
    await audit(request, "logout_all", "user", user.id);
    return reply.header("set-cookie", clearSessionCookie()).send({ ok: true });
  });

  app.get("/auth/me", async (request) => ({ user: currentUser(request) }));

  app.patch("/auth/me/preferences", async (request) => {
    const parsed = updateOwnPreferencesRequestSchema.safeParse(request.body);
    if (!parsed.success) throw httpError(400, "Invalid theme preference");
    const user = await updateOwnThemePreference(
      pool,
      currentUser(request).id,
      parsed.data.themePreference,
    );
    if (!user) throw httpError(404, "User not found");
    return { user };
  });

  app.get("/auth/csrf", async (request) => ({
    csrfToken: await issueCsrfToken(pool, currentSessionId(request)),
  }));

  app.patch("/auth/me/password", async (request) => {
    const input = updateOwnPasswordRequestSchema.parse(request.body);
    const user = await findUserWithPassword(pool, currentUser(request).id);
    if (
      !user ||
      !(await verifyPassword(input.currentPassword, user.passwordHash))
    ) {
      throw httpError(401, "Current password is incorrect");
    }
    await updateOwnPassword(pool, user.id, input.newPassword);
    await deleteUserSessions(pool, user.id, currentSessionId(request));
    await audit(request, "password_changed", "user", user.id);
    return { ok: true };
  });

  app.get("/auth/me/2fa", async (request) => ({
    ...(await getTwoFactorStatus(pool, currentUser(request).id)),
    enrollmentAvailable: config.TWO_FACTOR_ENABLED,
  }));

  app.post("/auth/me/2fa/enrollment/start", async (request) => {
    const input = twoFactorEnrollmentStartRequestSchema.parse(request.body);
    const user = await requireCurrentPassword(
      currentUser(request).id,
      input.currentPassword,
    );
    if (!config.TWO_FACTOR_ENABLED)
      throw httpError(503, "Two-factor enrollment is disabled");
    if (await userHasTwoFactor(pool, user.id))
      throw httpError(409, "Two-factor authentication is already enabled");
    const challenge = await createEnrollmentChallenge(pool, config, {
      userId: user.id,
      username: user.username,
      issuer: await twoFactorIssuer(),
      appDomain: config.APP_DOMAIN,
      purpose: "account_enrollment",
    });
    await audit(request, "two_factor_enrollment_started", "user", user.id);
    return challenge;
  });

  app.post("/auth/me/2fa/enrollment/confirm", async (request) => {
    const input = twoFactorEnrollmentConfirmRequestSchema.parse(request.body);
    const result = await withTransaction(pool, (client) =>
      confirmTwoFactorEnrollment(client, config, {
        continuationToken: input.continuationToken,
        code: input.code,
        allowedPurpose: "account_enrollment",
        expectedUserId: currentUser(request).id,
      }),
    );
    if (!result.ok)
      throw httpError(401, "Invalid or expired second-factor code");
    await deleteUserSessions(pool, result.userId, currentSessionId(request));
    await audit(request, "two_factor_enrolled", "user", result.userId);
    return { recoveryCodes: result.recoveryCodes };
  });

  app.post("/auth/me/2fa/recovery-codes/regenerate", async (request) => {
    const input = twoFactorProofRequestSchema.parse(request.body);
    const user = currentUser(request);
    if (!user.twoFactorEnabled)
      throw httpError(409, "Two-factor authentication is not enabled");
    const proof = await requireCurrentPasswordAndSecondFactor(
      user.id,
      input.currentPassword,
      input.code,
    );
    const recoveryCodes = await withTransaction(pool, (client) =>
      replaceRecoveryCodes(client, user.id),
    );
    await audit(
      request,
      "two_factor_recovery_codes_regenerated",
      "user",
      user.id,
      {
        usedRecoveryCode: proof.usedRecoveryCode,
      },
    );
    return { recoveryCodes };
  });

  app.delete("/auth/me/2fa", async (request) => {
    const input = twoFactorProofRequestSchema.parse(request.body);
    const user = currentUser(request);
    if (!user.twoFactorEnabled)
      throw httpError(409, "Two-factor authentication is not enabled");
    const proof = await requireCurrentPasswordAndSecondFactor(
      user.id,
      input.currentPassword,
      input.code,
    );
    await withTransaction(pool, (client) =>
      resetUserTwoFactor(client, user.id),
    );
    await deleteUserSessions(pool, user.id, currentSessionId(request));
    await audit(request, "two_factor_disabled", "user", user.id, {
      usedRecoveryCode: proof.usedRecoveryCode,
    });
    return { ok: true };
  });

  registerUserRoutes(app, {
    config,
    pool,
    videoStorage,
    currentUser,
    requireAdmin,
    requireProjectRead,
    requireProjectManage,
    audit,
    httpError,
    guideWriterConfigured: Boolean(provider),
    transcriptionConfigured: Boolean(transcriptionProvider),
    voiceoverConfigured: Boolean(ttsProvider),
    renderWorkerAvailable: () => videoRenderWorkerAvailable(pool),
  });

  registerProjectRoutes(app, {
    config,
    pool,
    videoStorage,
    currentUser,
    requireAdmin,
    requireProjectRead,
    requireProjectManage,
    audit,
    httpError,
  });

  registerWordTemplateRoutes(app, {
    config,
    pool,
    videoStorage,
    currentUser,
    requireAdmin,
    requireProjectRead,
    requireProjectManage,
    audit,
    httpError,
  });
  registerExtensionRoutes(app, {
    config,
    pool,
    videoStorage,
    currentUser,
    requireAdmin,
    requireProjectRead,
    requireProjectManage,
    audit,
    httpError,
  });

  app.get("/recordings", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    return listAccessibleRecordings(pool, currentUser(request), {
      search: query.search,
      projectId: query.projectId,
      scope:
        query.scope === "owned" ||
        query.scope === "shared" ||
        query.scope === "trash"
          ? query.scope
          : "all",
      sort: query.sort === "title" ? "title" : "recent",
      limit: Math.min(100, Math.max(1, Number(query.limit ?? 48))),
      offset: Math.max(0, Number(query.offset ?? 0)),
    });
  });

  app.post("/recordings", async (request, reply) => {
    const user = currentUser(request);
    const input = createRecordingRequestSchema.parse(request.body);
    const project = input.projectId
      ? {
          id: input.projectId,
          role: await getProjectRole(pool, user, input.projectId),
        }
      : {
          ...(await ensurePersonalProject(pool, user)),
          role: "owner" as const,
        };
    if (!canEditProject(project.role))
      throw httpError(403, "You do not have editor access to this project");
    const recording = await createRecording(pool, {
      ...input,
      ownerUserId: user.id,
      projectId: project.id,
    });
    return reply.code(201).send(recording);
  });

  app.get("/capabilities/video", async () => ({
    enabled: videoStorage.enabled,
    maxDurationMs: 3_600_000,
    maxWidth: 1920,
    maxHeight: 1080,
    frameRate: 30,
    container: "video/webm",
    editing: {
      enabled: config.VIDEO_RENDER_ENABLED && videoStorage.enabled,
      workerAvailable:
        config.VIDEO_RENDER_ENABLED && (await videoRenderWorkerAvailable(pool)),
      outputContainer: "video/webm",
      maxKeepRanges: 200,
    },
    transcription: {
      enabled: Boolean(transcriptionProvider),
      model: transcriptionProvider?.model ?? null,
      maxUploadBytes: transcriptionProvider?.maxUploadBytes ?? null,
    },
  }));

  app.get("/capabilities", async () => ({
    protocolVersion: PROTOCOL_VERSION,
    guide: { enabled: true, deterministicFallback: true },
    video: { enabled: videoStorage.enabled },
    rendering: {
      enabled: config.VIDEO_RENDER_ENABLED && videoStorage.enabled,
      workerAvailable:
        config.VIDEO_RENDER_ENABLED && (await videoRenderWorkerAvailable(pool)),
    },
    transcription: { enabled: Boolean(transcriptionProvider) },
    voiceover: { enabled: Boolean(ttsProvider) },
  }));

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      if (!videoStorage.enabled)
        throw httpError(503, "Video storage is not configured");
      const recording = await ensureGuideActive(request.params.id);
      if (recording.captureMode === "guide")
        throw httpError(409, "Guide Only recordings cannot initialize video");
      if (await getVideoRows(pool, request.params.id))
        throw httpError(409, "Video is already initialized for this recording");
      const input = initializeVideoRequestSchema.parse(request.body);
      if (
        new Set(input.assets.map((asset) => asset.kind)).size !==
        input.assets.length
      ) {
        throw httpError(400, "Video asset kinds must be unique");
      }

      const uploads: Array<{
        kind: (typeof input.assets)[number]["kind"];
        storageKey: string;
        uploadId: string;
      }> = [];
      try {
        for (const asset of input.assets) {
          const storageKey = `recordings/${request.params.id}/${asset.kind}.webm`;
          uploads.push({
            kind: asset.kind,
            storageKey,
            uploadId: await videoStorage.createMultipartUpload(
              storageKey,
              asset.mimeType,
            ),
          });
        }
        const videoId = await withTransaction(pool, (client) =>
          createVideo(client, {
            recordingId: request.params.id,
            userId: currentUser(request).id,
            request: input,
            uploads,
          }),
        );
        const video = await getRecordingVideo(
          pool,
          request.params.id,
          [],
          transcriptionAvailable,
        );
        await audit(
          request,
          "video_capture_started",
          "recording",
          request.params.id,
          { videoId, captureMode: recording.captureMode },
        );
        return reply.code(201).send(video);
      } catch (error) {
        await Promise.allSettled(
          uploads.map((upload) =>
            videoStorage.abortMultipartUpload(
              upload.storageKey,
              upload.uploadId,
            ),
          ),
        );
        throw error;
      }
    },
  );

  app.put<{ Params: { id: string; assetId: string; partNumber: string } }>(
    "/recordings/:id/video/assets/:assetId/parts/:partNumber",
    { bodyLimit: 16 * 1024 * 1024 },
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const partNumber = Number(request.params.partNumber);
      if (
        !Number.isInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > 10_000
      )
        throw httpError(400, "Invalid part number");
      const body = request.body as Buffer;
      if (!Buffer.isBuffer(body) || body.byteLength === 0)
        throw httpError(400, "Video part is empty");
      const asset = await getVideoAsset(
        pool,
        request.params.id,
        request.params.assetId,
      );
      if (!asset || !asset.multipart_upload_id || asset.status !== "uploading")
        throw httpError(409, "Video asset is not accepting parts");
      const etag = await videoStorage.uploadPart(
        asset.storage_key,
        asset.multipart_upload_id,
        partNumber,
        body,
      );
      const startedAtMs = Number(
        request.headers[PRODUCT_IDENTIFIERS.videoStartHeader],
      );
      const endedAtMs = Number(
        request.headers[PRODUCT_IDENTIFIERS.videoEndHeader],
      );
      await saveVideoPart(pool, {
        assetId: asset.id,
        partNumber,
        etag,
        byteSize: body.byteLength,
        startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : undefined,
        endedAtMs: Number.isFinite(endedAtMs) ? endedAtMs : undefined,
      });
      return reply.send({ etag, partNumber });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/finalize",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = finalizeVideoRequestSchema.parse(request.body);
      const rows = await getVideoRows(pool, request.params.id);
      if (!rows) throw httpError(404, "Video not found");
      if (rows.video.status === "ready" || rows.video.status === "published") {
        return videoResponse(request.params.id);
      }
      const completed = new Set<string>();
      let compositeComplete = false;

      for (const requested of input.assets) {
        const asset = rows.assets.find(
          (candidate) => candidate.id === requested.assetId,
        );
        if (
          !asset ||
          !asset.multipart_upload_id ||
          asset.status !== "uploading"
        )
          continue;
        const parts = await listVideoParts(pool, asset.id);
        if (parts.length === 0) {
          if (asset.kind === "composite")
            throw httpError(409, "Composite video has no uploaded parts");
          continue;
        }
        try {
          await videoStorage.completeMultipartUpload(
            asset.storage_key,
            asset.multipart_upload_id,
            parts.map((part) => ({
              partNumber: part.part_number,
              etag: part.etag,
            })),
          );
          await completeVideoAsset(
            pool,
            asset.id,
            requested.durationMs ?? input.durationMs,
          );
          completed.add(asset.id);
          if (asset.kind === "composite") compositeComplete = true;
        } catch (error) {
          if (asset.kind === "composite") throw error;
          request.log.warn(
            { error, assetId: asset.id },
            "Raw video asset could not be finalized",
          );
        }
      }
      if (!compositeComplete)
        throw httpError(409, "Composite video is required");
      const rawAssets = rows.assets.filter(
        (asset) => asset.kind !== "composite",
      );
      await markVideoReady(pool, request.params.id, {
        durationMs: input.durationMs,
        recovered: input.recovered,
        rawAssetsComplete: rawAssets.every((asset) => completed.has(asset.id)),
      });

      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");
      const transcriptionQueued = Boolean(transcriptionProvider);
      await withTransaction(pool, async (client) => {
        await finalizeRecording(client, request.params.id);
        await queueVideoTranscription(
          client,
          request.params.id,
          transcriptionQueued,
          input.outputLocale,
        );
        if (recording.captureMode === "both" && !transcriptionQueued) {
          const latest = await getRecording(client, request.params.id);
          if (latest)
            await generateGuideSteps(
              client,
              latest,
              provider,
              false,
              [],
              input.outputLocale,
              "overwrite",
            );
        }
      });
      if (recording.captureMode === "both" && !transcriptionQueued)
        await createAutoVersion(request, request.params.id);
      if (transcriptionQueued) transcriptionWorker.wake();
      await audit(
        request,
        "video_capture_finalized",
        "recording",
        request.params.id,
        {
          recovered: input.recovered,
          rawAssetsComplete: rawAssets.every((asset) =>
            completed.has(asset.id),
          ),
        },
      );
      return videoResponse(request.params.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/video",
    async (request) => {
      const role = await requireRecordingRead(request, request.params.id);
      const video = await videoResponse(request.params.id);
      if (!video) throw httpError(404, "Video not found");
      if (video.status !== "published" && !canEditProject(role))
        throw httpError(404, "Video not found");
      return video;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/video/transcript",
    async (request) => {
      const role = await requireRecordingRead(request, request.params.id);
      const video = await getRecordingVideo(
        pool,
        request.params.id,
        [],
        transcriptionAvailable,
      );
      if (!video) throw httpError(404, "Video not found");
      if (video.status !== "published" && !canEditProject(role))
        throw httpError(404, "Video not found");
      const transcript = await playbackTranscript(request.params.id);
      if (!transcript) throw httpError(404, "Transcript not found");
      return transcript;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/video/captions.vtt",
    async (request, reply) => {
      const role = await requireRecordingRead(request, request.params.id);
      const video = await getRecordingVideo(
        pool,
        request.params.id,
        [],
        transcriptionAvailable,
      );
      if (!video) throw httpError(404, "Video not found");
      if (video.status !== "published" && !canEditProject(role))
        throw httpError(404, "Video not found");
      const transcript = await playbackTranscript(request.params.id);
      if (!transcript || transcript.status !== "ready")
        throw httpError(404, "Captions are not ready");
      reply.header("content-type", "text/vtt; charset=utf-8");
      reply.header(
        "content-disposition",
        `inline; filename="infosteed-${request.params.id}.vtt"`,
      );
      return reply.send(transcriptToWebVtt(transcript.cues));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/transcript/retry",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      if (!transcriptionProvider)
        throw httpError(503, "Transcription is not configured");
      const { outputLocale } = outputLocaleRequestSchema.parse(
        request.body ?? {},
      );
      if (!(await retryTranscription(pool, request.params.id, outputLocale))) {
        throw httpError(409, "Transcription is already pending or processing");
      }
      transcriptionWorker.wake();
      await audit(
        request,
        "video_transcription_retried",
        "recording",
        request.params.id,
      );
      return getRecordingTranscript(pool, request.params.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/video/content",
    async (request, reply) => {
      const role = await requireRecordingRead(request, request.params.id);
      const rows = await getVideoRows(pool, request.params.id);
      if (!rows) throw httpError(404, "Video not found");
      if (rows.video.status !== "published" && !canEditProject(role))
        throw httpError(404, "Video not found");
      const composite = rows.assets.find(
        (asset) => asset.kind === "composite" && asset.status === "complete",
      );
      if (!composite) throw httpError(404, "Composite video not found");
      const publishedStorageKey = await resolvePublishedRenderStorageKey(
        pool,
        request.params.id,
      );
      const rangeHeader = request.headers.range;
      const object = await videoStorage.getObject(
        publishedStorageKey ?? composite.storage_key,
        rangeHeader,
      );
      if (object.contentType) reply.header("content-type", object.contentType);
      reply.header("accept-ranges", "bytes");
      if (object.contentLength !== undefined)
        reply.header("content-length", object.contentLength);
      if (object.contentRange)
        reply.header("content-range", object.contentRange);
      if (object.etag) reply.header("etag", object.etag);
      if (rangeHeader && object.contentRange) reply.code(206);
      return reply.send(object.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/video/editor",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");
      if (recording.captureMode === "guide")
        throw httpError(
          409,
          "Guide Only recordings do not have a video editor",
        );
      const chapters = await videoChapters(request.params.id);
      const draft = await getOrCreateVideoEditDraft(
        pool,
        request.params.id,
        chapters,
      );
      if (!draft)
        throw httpError(409, "The source video is not ready for editing");
      const [versions, renders, assets, transcript, voiceover] =
        await Promise.all([
          listVideoEditVersions(pool, request.params.id),
          listVideoRenders(pool, request.params.id),
          getSourceAssetsForEditor(pool, request.params.id),
          getRecordingTranscript(pool, request.params.id),
          getLatestVoiceoverGeneration(pool, request.params.id),
        ]);
      return {
        draft,
        versions,
        renders,
        sourceAssets: assets.map(mapSourceAssetForEditor),
        transcriptCues: transcript?.cues ?? [],
        workerAvailable:
          config.VIDEO_RENDER_ENABLED &&
          (await videoRenderWorkerAvailable(pool)),
        voiceover,
        voiceoverAvailable: Boolean(ttsProvider && videoStorage.enabled),
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    "/recordings/:id/video/editor",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = saveVideoEditRecipeRequestSchema.parse(request.body);
      const current = await getOrCreateVideoEditDraft(
        pool,
        request.params.id,
        await videoChapters(request.params.id),
      );
      if (!current)
        throw httpError(409, "The source video is not ready for editing");
      if (input.recipe.sourceDurationMs !== current.recipe.sourceDurationMs) {
        throw httpError(400, "The source video duration cannot be changed");
      }
      const saved = await saveVideoEditDraft(
        pool,
        request.params.id,
        currentUser(request).id,
        input.expectedRevision,
        input.recipe,
      );
      if (!saved)
        throw httpError(
          409,
          "The video edit draft was changed by another editor",
        );
      return saved;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/editor/reset",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const draft = await resetVideoEditDraft(
        pool,
        request.params.id,
        currentUser(request).id,
        await videoChapters(request.params.id),
      );
      if (!draft)
        throw httpError(409, "The source video is not ready for editing");
      await audit(request, "video_edit_reset", "recording", request.params.id);
      return draft;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/video/voiceover/voices",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      if (!ttsProvider) throw httpError(503, "Local TTS is not configured");
      return {
        voices: await ttsProvider.listVoices(),
        defaultVoice: ttsProvider.defaultVoice,
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/voiceover/script",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = rewriteNarrationScriptRequestSchema.parse(request.body);
      return { cues: await rewriteNarrationScript(config, input) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/voiceover/generations",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      if (!ttsProvider || !videoStorage.enabled)
        throw httpError(503, "Local TTS is not configured");
      const input = createVoiceoverRequestSchema.parse(request.body);
      const installed = await ttsProvider.listVoices();
      if (!installed.some((voice) => voice.id === input.voice))
        throw httpError(400, "The selected voice is not installed");
      const generation = await withTransaction(pool, (client) =>
        queueVoiceoverGeneration(client, {
          recordingId: request.params.id,
          userId: currentUser(request).id,
          provider: ttsProvider.id,
          model: ttsProvider.model,
          request: input,
        }),
      );
      if (!generation)
        throw httpError(409, "Voiceover cues must fit within the source video");
      voiceoverWorker.wake();
      await audit(
        request,
        "voiceover_generation_queued",
        "recording",
        request.params.id,
        { generationId: generation.id },
      );
      return reply.code(202).send(generation);
    },
  );

  app.get<{ Params: { id: string; generationId: string } }>(
    "/recordings/:id/video/voiceover/generations/:generationId",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const generation = await getVoiceoverGeneration(
        pool,
        request.params.id,
        request.params.generationId,
      );
      if (!generation) throw httpError(404, "Voiceover generation not found");
      return generation;
    },
  );

  app.get<{ Params: { id: string; generationId: string; cueId: string } }>(
    "/recordings/:id/video/voiceover/generations/:generationId/cues/:cueId/content",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const clip = await getVoiceoverCueClip(
        pool,
        request.params.id,
        request.params.generationId,
        request.params.cueId,
      );
      if (!clip) throw httpError(404, "Generated voiceover cue not found");
      const object = await videoStorage.getObject(
        clip.storageKey,
        request.headers.range,
      );
      reply.header("content-type", clip.mimeType);
      reply.header("accept-ranges", "bytes");
      if (object.contentLength !== undefined)
        reply.header("content-length", object.contentLength);
      if (object.contentRange)
        reply.header("content-range", object.contentRange);
      if (object.etag) reply.header("etag", object.etag);
      if (request.headers.range && object.contentRange) reply.code(206);
      return reply.send(object.body);
    },
  );

  app.get<{ Params: { id: string; kind: string } }>(
    "/recordings/:id/video/assets/:kind/content",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const kind = videoAssetKindSchema.parse(request.params.kind);
      const assets = await getSourceAssetsForEditor(pool, request.params.id);
      const asset = assets.find((candidate) => candidate.kind === kind);
      if (!asset) throw httpError(404, "Video source asset not found");
      const rangeHeader = request.headers.range;
      const object = await videoStorage.getObject(
        asset.storage_key,
        rangeHeader,
      );
      if (object.contentType) reply.header("content-type", object.contentType);
      reply.header("accept-ranges", "bytes");
      if (object.contentLength !== undefined)
        reply.header("content-length", object.contentLength);
      if (object.contentRange)
        reply.header("content-range", object.contentRange);
      if (object.etag) reply.header("etag", object.etag);
      if (rangeHeader && object.contentRange) reply.code(206);
      return reply.send(object.body);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/video/edit-versions",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      return { versions: await listVideoEditVersions(pool, request.params.id) };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/edit-versions",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      await getOrCreateVideoEditDraft(
        pool,
        request.params.id,
        await videoChapters(request.params.id),
      );
      const input = createVideoEditVersionRequestSchema.parse(request.body);
      const version = await createVideoEditVersion(pool, {
        recordingId: request.params.id,
        userId: currentUser(request).id,
        versionType: "named",
        name: input.name,
      });
      if (!version) throw httpError(409, "The video edit draft is unavailable");
      await audit(
        request,
        "video_edit_version_created",
        "recording",
        request.params.id,
        { versionId: version.id },
      );
      return reply.code(201).send(version);
    },
  );

  app.post<{ Params: { id: string; versionId: string } }>(
    "/recordings/:id/video/edit-versions/:versionId/restore",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const draft = await restoreVideoEditVersion(pool, {
        recordingId: request.params.id,
        versionId: request.params.versionId,
        userId: currentUser(request).id,
      });
      if (!draft) throw httpError(404, "Video edit version not found");
      await audit(
        request,
        "video_edit_version_restored",
        "recording",
        request.params.id,
        { versionId: request.params.versionId },
      );
      return draft;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/renders",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      if (!config.VIDEO_RENDER_ENABLED || !videoStorage.enabled)
        throw httpError(503, "Video rendering is not configured");
      await getOrCreateVideoEditDraft(
        pool,
        request.params.id,
        await videoChapters(request.params.id),
      );
      const input = createVideoRenderRequestSchema.parse(request.body);
      const render = await createVideoRender(pool, {
        recordingId: request.params.id,
        userId: currentUser(request).id,
        expectedRevision: input.expectedRevision,
        name: input.name,
      });
      if (!render)
        throw httpError(
          409,
          "Render revision does not match the current edit draft",
        );
      await audit(
        request,
        "video_render_queued",
        "recording",
        request.params.id,
        { renderId: render.id, status: render.status },
      );
      return reply.code(202).send(render);
    },
  );

  app.get<{ Params: { id: string; renderId: string } }>(
    "/recordings/:id/video/renders/:renderId",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const render = await getVideoRender(
        pool,
        request.params.id,
        request.params.renderId,
      );
      if (!render) throw httpError(404, "Video render not found");
      const { storageKey: _storageKey, ...publicRender } = render;
      return publicRender;
    },
  );

  app.delete<{ Params: { id: string; renderId: string } }>(
    "/recordings/:id/video/renders/:renderId",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      if (
        !(await requestRenderCancellation(
          pool,
          request.params.id,
          request.params.renderId,
        ))
      ) {
        throw httpError(
          409,
          "Only queued or processing renders can be canceled",
        );
      }
      await audit(
        request,
        "video_render_canceled",
        "recording",
        request.params.id,
        { renderId: request.params.renderId },
      );
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string; renderId: string } }>(
    "/recordings/:id/video/renders/:renderId/content",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const render = await getVideoRender(
        pool,
        request.params.id,
        request.params.renderId,
      );
      if (!render || render.status !== "ready")
        throw httpError(404, "Completed video render not found");
      const rows = await getVideoRows(pool, request.params.id);
      const composite = rows?.assets.find(
        (asset) => asset.kind === "composite" && asset.status === "complete",
      );
      const storageKey = render.storageKey ?? composite?.storage_key;
      if (!storageKey) throw httpError(404, "Rendered video content not found");
      const rangeHeader = request.headers.range;
      const object = await videoStorage.getObject(storageKey, rangeHeader);
      if (object.contentType) reply.header("content-type", object.contentType);
      reply.header("accept-ranges", "bytes");
      if (object.contentLength !== undefined)
        reply.header("content-length", object.contentLength);
      if (object.contentRange)
        reply.header("content-range", object.contentRange);
      if (object.etag) reply.header("etag", object.etag);
      if (rangeHeader && object.contentRange) reply.code(206);
      return reply.send(object.body);
    },
  );

  app.post<{ Params: { id: string; renderId: string } }>(
    "/recordings/:id/video/renders/:renderId/mp4-export",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      if (!config.VIDEO_RENDER_ENABLED || !videoStorage.enabled)
        throw httpError(503, "MP4 export is not configured");
      const exported = await queueVideoMp4Export(
        pool,
        request.params.id,
        request.params.renderId,
      );
      if (!exported)
        throw httpError(409, "A ready video render is required for MP4 export");
      await audit(
        request,
        exported.status === "ready"
          ? "video_mp4_export_reused"
          : "video_mp4_export_queued",
        "recording",
        request.params.id,
        { renderId: request.params.renderId, exportId: exported.id },
      );
      return reply.code(exported.status === "ready" ? 200 : 202).send(exported);
    },
  );

  app.get<{ Params: { id: string; renderId: string } }>(
    "/recordings/:id/video/renders/:renderId/mp4-export",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const exported = await getVideoMp4Export(
        pool,
        request.params.id,
        request.params.renderId,
      );
      if (!exported) throw httpError(404, "MP4 export not found");
      const { storageKey: _storageKey, ...publicExport } = exported;
      return publicExport;
    },
  );

  app.get<{ Params: { id: string; renderId: string } }>(
    "/recordings/:id/video/renders/:renderId/mp4-export/content",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const exported = await getVideoMp4Export(
        pool,
        request.params.id,
        request.params.renderId,
      );
      if (!exported || exported.status !== "ready" || !exported.storageKey)
        throw httpError(404, "Completed MP4 export not found");
      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");
      const filename =
        recording.title.replace(/[^a-z0-9-_]+/gi, "-").slice(0, 120) || "video";
      const rangeHeader = request.headers.range;
      const object = await videoStorage.getObject(
        exported.storageKey,
        rangeHeader,
      );
      reply.header("content-type", "video/mp4");
      reply.header(
        "content-disposition",
        `attachment; filename="${filename}.mp4"`,
      );
      reply.header("accept-ranges", "bytes");
      if (object.contentLength !== undefined)
        reply.header("content-length", object.contentLength);
      if (object.contentRange)
        reply.header("content-range", object.contentRange);
      if (object.etag) reply.header("etag", object.etag);
      if (rangeHeader && object.contentRange) reply.code(206);
      return reply.send(object.body);
    },
  );

  app.post<{ Params: { id: string; renderId: string } }>(
    "/recordings/:id/video/renders/:renderId/publish",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      if (
        !(await publishVideoRender(
          pool,
          request.params.id,
          request.params.renderId,
          config.VIDEO_RENDER_RETENTION_DAYS,
        ))
      ) {
        throw httpError(
          409,
          "Only a completed render of the current edit revision can be published",
        );
      }
      await audit(
        request,
        "video_render_published",
        "recording",
        request.params.id,
        { renderId: request.params.renderId },
      );
      const video = await videoResponse(request.params.id);
      if (!video) throw httpError(404, "Video not found");
      return video;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/publish",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const rows = await getVideoRows(pool, request.params.id);
      if (
        !rows ||
        !["ready", "published"].includes(rows.video.status) ||
        !rows.assets.some(
          (asset) => asset.kind === "composite" && asset.status === "complete",
        )
      ) {
        throw httpError(
          409,
          "A ready composite video is required before publishing",
        );
      }
      await setVideoPublished(pool, request.params.id, true);
      await audit(request, "video_published", "recording", request.params.id);
      return videoResponse(request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/video/unpublish",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      await setVideoPublished(pool, request.params.id, false);
      await audit(request, "video_unpublished", "recording", request.params.id);
      return videoResponse(request.params.id);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/recordings/:id/video",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const recording = await getRecording(pool, request.params.id);
      const rows = await getVideoRows(pool, request.params.id);
      if (!recording || !rows) throw httpError(404, "Video not found");
      transcriptionWorker.cancel(request.params.id);
      const derived = await listRenderStorageForVideo(pool, request.params.id);
      const exports = await listExportStorageForVideo(pool, request.params.id);
      const deletionResults = await Promise.allSettled([
        ...rows.assets.map((asset) =>
          asset.multipart_upload_id
            ? videoStorage.abortMultipartUpload(
                asset.storage_key,
                asset.multipart_upload_id,
              )
            : videoStorage.deleteObject(asset.storage_key),
        ),
        ...derived.map((asset) => videoStorage.deleteObject(asset.storageKey)),
        ...exports.map((asset) => videoStorage.deleteObject(asset.storageKey)),
      ]);
      if (deletionResults.some((result) => result.status === "rejected")) {
        throw httpError(
          502,
          "One or more video objects could not be deleted; retry the request",
        );
      }
      await deleteVideoRows(pool, request.params.id);
      if (recording.captureMode === "video")
        await softDeleteRecording(
          pool,
          request.params.id,
          currentUser(request).id,
        );
      await audit(request, "video_deleted", "recording", request.params.id, {
        captureMode: recording.captureMode,
      });
      return reply.code(204).send();
    },
  );

  app.post(
    "/recordings/import",
    { bodyLimit: 100 * 1024 * 1024 },
    async (request, reply) => {
      const user = currentUser(request);
      const query = request.query as Record<string, string | undefined>;
      const project = recordingProjectSchema.parse(request.body);
      const targetProjectId = query.projectId;
      const targetProject = targetProjectId
        ? {
            id: targetProjectId,
            role: await getProjectRole(pool, user, targetProjectId),
          }
        : {
            ...(await ensurePersonalProject(pool, user)),
            role: "owner" as const,
          };
      if (!canEditProject(targetProject.role))
        throw httpError(403, "You do not have editor access to this project");
      const recording = await withTransaction(pool, (client) =>
        importRecordingProject(client, project, {
          ownerUserId: user.id,
          projectId: targetProject.id,
        }),
      );
      return reply.code(201).send(recording);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/events",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const input = uploadEventsRequestSchema.parse(request.body);
      const events = await withTransaction(pool, async (client) => {
        if (input.captureSessionId) {
          const session = await findCaptureSession(
            client,
            request.params.id,
            input.captureSessionId,
          );
          if (!session) throw httpError(404, "Capture session not found");
          if (session.status !== "recording")
            throw httpError(409, "Capture session is not active");
        }
        return insertEvents(client, request.params.id, input.events, {
          captureSessionId: input.captureSessionId,
        });
      });
      return reply.code(201).send({ events });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/capture-sessions",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const session = await withTransaction(pool, (client) =>
        createCaptureSession(client, {
          recordingId: request.params.id,
          startedByUserId: currentUser(request).id,
        }),
      );
      await audit(
        request,
        "capture_session_started",
        "recording",
        request.params.id,
        { captureSessionId: session.id },
      );
      return reply.code(201).send({
        captureSessionId: session.id,
        recordingId: session.recordingId,
        status: session.status,
      });
    },
  );

  app.post<{ Params: { id: string; sessionId: string } }>(
    "/recordings/:id/capture-sessions/:sessionId/finalize",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const { outputLocale } = outputLocaleRequestSchema.parse(
        request.body ?? {},
      );
      const session = await findCaptureSession(
        pool,
        request.params.id,
        request.params.sessionId,
      );
      if (!session) throw httpError(404, "Capture session not found");
      if (session.status === "finalized") {
        const recording = await getRecording(pool, request.params.id);
        if (!recording) throw httpError(404, "Recording not found");
        return recording;
      }

      const updated = await withTransaction(pool, async (client) => {
        await finalizeCaptureSession(
          client,
          request.params.id,
          request.params.sessionId,
        );
        await finalizeRecording(client, request.params.id);
        const recording = await getRecording(client, request.params.id);
        if (!recording) throw httpError(404, "Recording not found");
        await generateGuideStepsForCaptureSession(
          client,
          recording,
          request.params.sessionId,
          provider,
          [],
          outputLocale,
          "fill",
        );
        return getRecording(client, request.params.id);
      });
      await createAutoVersion(request, request.params.id);
      await audit(
        request,
        "capture_session_finalized",
        "recording",
        request.params.id,
        {
          captureSessionId: request.params.sessionId,
        },
      );
      return updated;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/pause",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      await setRecordingState(pool, request.params.id, "paused");
      return getRecording(pool, request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/resume",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      await setRecordingState(pool, request.params.id, "recording");
      return getRecording(pool, request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/screenshots",
    { bodyLimit: 25 * 1024 * 1024 },
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const recording = await ensureGuideActive(request.params.id);
      if (recording.captureMode === "video")
        throw httpError(409, "Video Only recordings do not accept screenshots");
      const input = uploadScreenshotRequestSchema.parse(request.body);
      const original = Buffer.from(input.imageBase64, "base64");
      const annotated = await annotateScreenshot(original, input.targetBox);
      await insertScreenshot(pool, {
        recordingId: request.params.id,
        eventId: input.eventId,
        filename: input.filename.endsWith(".webp")
          ? input.filename
          : `${input.filename}.webp`,
        contentType: input.contentType,
        originalImage: original,
        annotatedImage: annotated,
        targetBox: input.targetBox,
      });
      return reply.code(201).send({ ok: true });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/finalize",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const { outputLocale } = outputLocaleRequestSchema.parse(
        request.body ?? {},
      );
      const current = await ensureGuideActive(request.params.id);
      if (current.captureMode !== "guide")
        throw httpError(
          409,
          "Video recordings must be finalized through the video endpoint",
        );
      const updated = await withTransaction(pool, async (client) => {
        await finalizeRecording(client, request.params.id);
        const recording = await getRecording(client, request.params.id);
        if (!recording) throw httpError(404, "Recording not found");
        const transcript = await getRecordingTranscript(
          client,
          request.params.id,
        );
        await generateGuideSteps(
          client,
          recording,
          provider,
          false,
          transcript?.cues ?? [],
          outputLocale,
          "overwrite",
        );
        return getRecording(client, request.params.id);
      });
      await createAutoVersion(request, request.params.id);
      return updated;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/generate-guide",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const { outputLocale } = outputLocaleRequestSchema.parse(
        request.body ?? {},
      );
      const updated = await withTransaction(pool, async (client) => {
        const recording = await getRecording(client, request.params.id);
        if (!recording) throw httpError(404, "Recording not found");
        const transcript = await getRecordingTranscript(
          client,
          request.params.id,
        );
        await generateGuideSteps(
          client,
          recording,
          provider,
          false,
          transcript?.cues ?? [],
          outputLocale,
          "fill",
        );
        return getRecording(client, request.params.id);
      });
      await createAutoVersion(request, request.params.id);
      return updated;
    },
  );

  app.get<{ Params: { id: string } }>("/recordings/:id", async (request) => {
    const role = await requireRecordingRead(request, request.params.id);
    const recording = await getRecording(pool, request.params.id);
    if (!recording) throw httpError(404, "Recording not found");
    return { ...recording, userRole: role };
  });

  app.patch<{ Params: { id: string } }>("/recordings/:id", async (request) => {
    await requireRecordingWrite(request, request.params.id);
    const patch = updateRecordingRequestSchema.parse(request.body);
    const recording = await updateRecordingSummary(
      pool,
      request.params.id,
      patch,
    );
    if (!recording) throw httpError(404, "Recording not found");
    await createAutoVersion(request, request.params.id);
    return recording;
  });

  app.patch<{ Params: { id: string } }>(
    "/recordings/:id/project",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = moveRecordingProjectRequestSchema.parse(request.body);
      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");
      if (recording.deletedAt)
        throw httpError(
          409,
          "Restore this guide before moving it to another project",
        );
      const destinationRole = await getProjectRole(
        pool,
        currentUser(request),
        input.projectId,
      );
      if (!canEditProject(destinationRole))
        throw httpError(
          403,
          "You do not have editor access to the destination project",
        );
      await moveRecordingToProject(pool, request.params.id, input.projectId);
      await audit(request, "guide_moved", "recording", request.params.id, {
        fromProjectId: recording.projectId,
        toProjectId: input.projectId,
      });
      await createAutoVersion(request, request.params.id);
      const updated = await getRecording(pool, request.params.id);
      if (!updated) throw httpError(404, "Recording not found");
      return {
        ...updated,
        userRole: await recordingAccessRole(
          pool,
          currentUser(request),
          request.params.id,
        ),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/generate-overview",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const { outputLocale } = outputLocaleRequestSchema.parse(
        request.body ?? {},
      );
      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");
      const items = (
        recording.items.length > 0
          ? recording.items
          : recording.steps.map((step) => ({
              kind: "step" as const,
              title: step.title,
              body: step.instruction,
            }))
      ).map((item) => ({
        kind: item.kind,
        title: item.title,
        body: item.kind === "step" ? item.body : item.body,
      }));
      const generated = await writeGuideOverview(provider, {
        outputLocale,
        currentTitle: recording.title,
        purpose: recording.purpose,
        audience: recording.audience,
        items,
        events: recording.events.map((event) => ({
          actionType: event.actionType,
          pageTitle: event.pageTitle,
          elementName: event.elementName,
          elementRole: event.elementRole,
          nearbyHeading: event.nearbyHeading,
        })),
      });
      const updated = await updateRecordingSummary(pool, request.params.id, {
        title: generated.title,
        purpose: generated.overview,
      });
      if (!updated) throw httpError(404, "Recording not found");
      await createAutoVersion(request, request.params.id);
      return { ...updated, overviewSource: generated.source };
    },
  );

  app.get<{ Params: { id: string; filename: string } }>(
    "/recordings/:id/images/:filename",
    async (request, reply) => {
      await requireRecordingRead(request, request.params.id);
      const screenshot = await findScreenshotByFilename(
        pool,
        request.params.id,
        request.params.filename,
      );
      if (!screenshot) throw httpError(404, "Screenshot not found");
      return reply
        .header("content-type", "image/webp")
        .header("cache-control", "no-store")
        .send(screenshot.annotated_image);
    },
  );

  app.get<{ Params: { id: string; filename: string } }>(
    "/recordings/:id/images/:filename/source",
    async (request, reply) => {
      await requireRecordingRead(request, request.params.id);
      const screenshot = await findProjectScreenshotByFilename(
        pool,
        request.params.id,
        request.params.filename,
      );
      if (!screenshot) throw httpError(404, "Screenshot not found");
      return reply
        .header("content-type", screenshot.content_type)
        .header("cache-control", "no-store")
        .send(screenshot.original_image ?? screenshot.annotated_image);
    },
  );

  app.get<{ Params: { id: string; filename: string } }>(
    "/recordings/:id/images/:filename/edits",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const screenshot = await findProjectScreenshotByFilename(
        pool,
        request.params.id,
        request.params.filename,
      );
      if (!screenshot) throw httpError(404, "Screenshot not found");
      return resolveScreenshotEditOperations(screenshot);
    },
  );

  app.patch<{ Params: { id: string; filename: string } }>(
    "/recordings/:id/images/:filename/edits",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const requestedOperations = screenshotEditOperationsSchema.parse(
        request.body,
      );
      const screenshot = await findProjectScreenshotByFilename(
        pool,
        request.params.id,
        request.params.filename,
      );
      if (!screenshot) throw httpError(404, "Screenshot not found");
      const editOperations = await resolveScreenshotEditOperations(
        screenshot,
        requestedOperations,
      );
      const editedImage = await applyScreenshotEdits(
        screenshot.original_image ?? screenshot.annotated_image,
        editOperations,
      );
      await updateScreenshotEdits(pool, {
        recordingId: request.params.id,
        filename: request.params.filename,
        editOperations,
        editedImage,
      });
      await createAutoVersion(request, request.params.id);
      return reply.code(200).send({ ok: true });
    },
  );

  app.patch<{ Params: { id: string; stepId: string } }>(
    "/recordings/:id/steps/:stepId",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const patch = updateGuideStepRequestSchema.parse(request.body);
      const step = await updateGuideStep(
        pool,
        request.params.id,
        request.params.stepId,
        patch,
      );
      if (!step) throw httpError(404, "Step not found");
      await createAutoVersion(request, request.params.id);
      return step;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/items",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      const input = createGuideItemRequestSchema.parse(request.body);
      const item = await withTransaction(pool, (client) =>
        addGuideItem(client, request.params.id, {
          kind: input.kind,
          title: input.title,
          body: input.body,
          afterItemId: input.afterItemId,
        }),
      );
      await createAutoVersion(request, request.params.id);
      return reply.code(201).send(item);
    },
  );

  app.patch<{ Params: { id: string; itemId: string } }>(
    "/recordings/:id/items/:itemId",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const patch = updateGuideItemRequestSchema.parse(request.body);
      const item = await updateGuideItem(
        pool,
        request.params.id,
        request.params.itemId,
        patch,
      );
      if (!item) throw httpError(404, "Guide item not found");
      await createAutoVersion(request, request.params.id);
      return item;
    },
  );

  app.put<{ Params: { id: string; itemId: string } }>(
    "/recordings/:id/items/:itemId/image",
    { bodyLimit: 25 * 1024 * 1024 },
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = replaceGuideItemImageRequestSchema.parse(request.body);
      const original = Buffer.from(input.imageBase64, "base64");
      const annotated = await annotateScreenshot(original);
      let item;
      try {
        item = await replaceGuideItemImage(pool, {
          recordingId: request.params.id,
          itemId: request.params.itemId,
          contentType: input.contentType,
          originalImage: original,
          annotatedImage: annotated,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes("event-backed")) {
          throw httpError(400, error.message);
        }
        throw error;
      }
      if (!item) throw httpError(404, "Guide item not found");
      await createAutoVersion(request, request.params.id);
      return item;
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    "/recordings/:id/items/:itemId/image",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const item = await deleteGuideItemImage(
        pool,
        request.params.id,
        request.params.itemId,
      );
      if (!item) throw httpError(404, "Guide item not found");
      await createAutoVersion(request, request.params.id);
      return item;
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    "/recordings/:id/items/:itemId",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      await deleteGuideStep(pool, request.params.id, request.params.itemId);
      await createAutoVersion(request, request.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/items/reorder",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = reorderGuideItemsRequestSchema.parse(request.body);
      await withTransaction(pool, (client) =>
        reorderGuideSteps(client, request.params.id, input.itemIds),
      );
      await createAutoVersion(request, request.params.id);
      return getRecording(pool, request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/steps",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = updateGuideStepRequestSchema
        .extend({
          title: updateGuideStepRequestSchema.shape.title.unwrap(),
          instruction: updateGuideStepRequestSchema.shape.instruction.unwrap(),
        })
        .parse(request.body);
      const step = await addManualStep(pool, request.params.id, input);
      await createAutoVersion(request, request.params.id);
      return step;
    },
  );

  app.delete<{ Params: { id: string; stepId: string } }>(
    "/recordings/:id/steps/:stepId",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      await deleteGuideStep(pool, request.params.id, request.params.stepId);
      await createAutoVersion(request, request.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/steps/reorder",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const input = reorderGuideStepsRequestSchema.parse(request.body);
      await withTransaction(pool, (client) =>
        reorderGuideSteps(client, request.params.id, input.stepIds),
      );
      await createAutoVersion(request, request.params.id);
      return getRecording(pool, request.params.id);
    },
  );

  app.post<{ Params: { id: string; stepId: string } }>(
    "/recordings/:id/steps/:stepId/merge-next",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const merged = await withTransaction(pool, async (client) => {
        const merged = await mergeWithNextStep(
          client,
          request.params.id,
          request.params.stepId,
        );
        if (!merged) throw httpError(404, "Step not found");
        return merged;
      });
      await createAutoVersion(request, request.params.id);
      return merged;
    },
  );

  app.post<{ Params: { id: string; stepId: string } }>(
    "/recordings/:id/steps/:stepId/split",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const patch = updateGuideStepRequestSchema.parse(request.body);
      const instruction = patch.instruction;
      if (!instruction)
        throw httpError(
          400,
          "Provide instruction text containing the first split step",
        );
      const first = instruction.split("\n\n")[0]?.trim();
      if (!first)
        throw httpError(
          400,
          "Provide instruction text containing the first split step",
        );
      const updated = await updateGuideStep(
        pool,
        request.params.id,
        request.params.stepId,
        { instruction: first },
      );
      if (!updated) throw httpError(404, "Step not found");
      await addManualStep(pool, request.params.id, {
        title: patch.title ?? `${updated.title} continued`,
        instruction:
          instruction.slice(first.length).trim() ||
          "Continue with the next step.",
        altText: patch.altText,
      });
      await createAutoVersion(request, request.params.id);
      return getRecording(pool, request.params.id);
    },
  );

  app.post<{ Params: { id: string; stepId: string } }>(
    "/recordings/:id/steps/:stepId/regenerate",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const { outputLocale } = outputLocaleRequestSchema.parse(
        request.body ?? {},
      );
      const generatedStep = await withTransaction(pool, async (client) => {
        const recording = await getRecording(client, request.params.id);
        if (!recording) throw httpError(404, "Recording not found");
        const existing = recording.steps.find(
          (step) => step.id === request.params.stepId,
        );
        if (!existing?.eventId)
          throw httpError(400, "Only event-backed steps can be regenerated");
        const eventIndex = recording.events.findIndex(
          (event) => event.id === existing.eventId,
        );
        const event = recording.events[eventIndex];
        const screenshot = (await screenshotsByEvent(client, recording.id)).get(
          event.id,
        );
        const transcript = await getRecordingTranscript(client, recording.id);
        const screenshotDataUrl = screenshot
          ? await prepareAiScreenshotDataUrl(screenshot.annotated_image)
          : undefined;
        const generated = await writeStep(provider, {
          outputLocale,
          workflowPurpose: recording.purpose,
          audience: recording.audience,
          current: event,
          previous: recording.events[eventIndex - 1],
          next: recording.events[eventIndex + 1],
          ...transcriptAround(transcript?.cues ?? [], event.videoOffsetMs),
          screenshotDataUrl,
        });
        return upsertGeneratedStep(client, {
          recordingId: recording.id,
          eventId: event.id,
          ordinal: existing.ordinal,
          title: generated.title,
          instruction: generated.instruction,
          imageFilename: existing.imageFilename,
          altText: generated.altText,
          source: generated.source,
          overwriteUserEdited: true,
        });
      });
      await createAutoVersion(request, request.params.id);
      return generatedStep;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/versions",
    async (request) => {
      await requireRecordingRead(request, request.params.id);
      await ensureGuideActive(request.params.id);
      return listGuideVersions(pool, request.params.id);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/versions",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      await ensureGuideActive(request.params.id);
      const input = createGuideVersionRequestSchema.parse(request.body);
      const snapshot = await buildGuideVersionSnapshot(pool, request.params.id);
      const version = await createGuideVersion(pool, {
        recordingId: request.params.id,
        userId: currentUser(request).id,
        versionType: "named",
        message: input.message,
        snapshot,
      });
      return reply.code(201).send(version);
    },
  );

  app.get<{ Params: { id: string; versionId: string } }>(
    "/recordings/:id/versions/:versionId",
    async (request) => {
      await requireRecordingRead(request, request.params.id);
      await ensureGuideActive(request.params.id);
      const version = await getGuideVersion(
        pool,
        request.params.id,
        request.params.versionId,
      );
      if (!version) throw httpError(404, "Version not found");
      return version;
    },
  );

  app.post<{ Params: { id: string; versionId: string } }>(
    "/recordings/:id/versions/:versionId/restore",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      await ensureGuideActive(request.params.id);
      const version = await getGuideVersion(
        pool,
        request.params.id,
        request.params.versionId,
      );
      if (!version) throw httpError(404, "Version not found");
      const snapshot = version.snapshot as unknown as GuideVersionSnapshot;
      const screenshotEdits = await withTransaction(pool, (client) =>
        restoreGuideVersionCore(client, request.params.id, snapshot),
      );
      for (const screenshotEdit of screenshotEdits) {
        const screenshot = await findProjectScreenshotByFilename(
          pool,
          request.params.id,
          screenshotEdit.filename,
        );
        if (!screenshot) continue;
        const editOperations = await resolveScreenshotEditOperations(
          screenshot,
          screenshotEdit.editOperations,
        );
        const editedImage = await applyScreenshotEdits(
          screenshot.original_image ?? screenshot.annotated_image,
          editOperations,
        );
        await updateScreenshotEdits(pool, {
          recordingId: request.params.id,
          filename: screenshotEdit.filename,
          editOperations,
          editedImage,
        });
      }
      const restoredSnapshot = await buildGuideVersionSnapshot(
        pool,
        request.params.id,
      );
      await createGuideVersion(pool, {
        recordingId: request.params.id,
        userId: currentUser(request).id,
        versionType: "restore",
        message: `Restored ${version.versionType} version from ${version.createdAt}`,
        snapshot: restoredSnapshot,
      });
      await audit(
        request,
        "guide_version_restored",
        "recording",
        request.params.id,
        { versionId: request.params.versionId },
      );
      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");
      return {
        ...recording,
        userRole: await recordingAccessRole(
          pool,
          currentUser(request),
          request.params.id,
        ),
      };
    },
  );

  async function loadRecordingAndImages(recordingId: string) {
    const recording = await getRecording(pool, recordingId);
    if (!recording) throw httpError(404, "Recording not found");
    const screenshots = await listScreenshotsForRecording(pool, recordingId);
    const images = screenshots.map((screenshot) => ({
      filename: screenshot.filename,
      content: screenshot.annotated_image,
      contentType: screenshot.content_type,
    }));
    return { recording, images };
  }

  async function loadRecordingAndWiziwigImages(
    recordingId: string,
    format: WiziwigImageExportFormat,
  ) {
    const { recording, images } = await loadRecordingAndImages(recordingId);
    if (format === "webp") return { recording, images };

    return {
      recording,
      images: await Promise.all(
        images.map(async (image) => ({
          filename: image.filename,
          content: await convertImageToJpeg(Buffer.from(image.content)),
          contentType: "image/jpeg",
        })),
      ),
    };
  }

  async function loadRecordingAndOriginalImages(
    recordingId: string,
    format: "png" | "jpg",
  ) {
    const recording = await getRecording(pool, recordingId);
    if (!recording) throw httpError(404, "Recording not found");
    const screenshots = await listProjectScreenshotsForRecording(
      pool,
      recordingId,
    );
    const images = await Promise.all(
      screenshots.map(async (screenshot) => {
        if (!screenshot.original_image) {
          throw httpError(
            409,
            `Screenshot ${screenshot.filename} is missing its original image`,
          );
        }
        const source = Buffer.from(screenshot.original_image);
        return {
          filename: screenshot.filename,
          content:
            format === "jpg"
              ? await convertImageToJpeg(source)
              : await convertImageToPng(source),
          contentType: format === "jpg" ? "image/jpeg" : "image/png",
        };
      }),
    );
    return { recording, images };
  }

  async function getExportBranding() {
    return resolveExportBranding(await getBranding(pool));
  }

  async function getDocxBranding() {
    return resolveDocxExportBranding(await getBranding(pool));
  }

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/export",
    async (request, reply) => {
      await requireRecordingRead(request, request.params.id);
      const { recording, images } = await loadRecordingAndImages(
        request.params.id,
      );
      const zip = await buildWorkflowZip(
        recording,
        images,
        exportTimestampSuffix(),
      );

      return reply
        .header("content-type", "application/zip")
        .header(
          "content-disposition",
          'attachment; filename="workflow-guide.zip"',
        )
        .send(zip);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/export/html",
    async (request, reply) => {
      await requireRecordingRead(request, request.params.id);
      const { recording, images } = await loadRecordingAndImages(
        request.params.id,
      );
      const html = buildEmbeddedHtml(
        recording,
        images,
        await getExportBranding(),
      );

      return reply
        .header("content-type", "text/html; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="${PRODUCT_IDENTIFIERS.exportPrefix}-${recording.id}.html"`,
        )
        .send(html);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { format?: WiziwigImageExportFormat };
  }>("/recordings/:id/export/wiziwig", async (request, reply) => {
    await requireRecordingRead(request, request.params.id);
    const format = request.query.format === "webp" ? "webp" : "jpg";
    const { recording, images } = await loadRecordingAndWiziwigImages(
      request.params.id,
      format,
    );
    const zip = await buildWiziwigZip(
      recording,
      images,
      format,
      exportTimestampSuffix(),
    );

    return reply
      .header("content-type", "application/zip")
      .header(
        "content-disposition",
        `attachment; filename="${PRODUCT_IDENTIFIERS.exportPrefix}-${recording.id}-wiziwig.zip"`,
      )
      .send(zip);
  });

  app.get<{
    Params: { id: string };
    Querystring: { format?: "png" | "jpg" };
  }>("/recordings/:id/export/images", async (request, reply) => {
    await requireRecordingRead(request, request.params.id);
    const format = request.query.format === "jpg" ? "jpg" : "png";
    const { recording, images } = await loadRecordingAndOriginalImages(
      request.params.id,
      format,
    );
    const zip = await buildGuideImagesZip(
      recording,
      images,
      format,
      exportTimestampSuffix(),
    );

    return reply
      .header("content-type", "application/zip")
      .header(
        "content-disposition",
        `attachment; filename="${PRODUCT_IDENTIFIERS.exportPrefix}-${recording.id}-images-${format}.zip"`,
      )
      .send(zip);
  });

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/export/sanity",
    async (request, reply) => {
      await requireRecordingRead(request, request.params.id);
      const { recording, images } = await loadRecordingAndImages(
        request.params.id,
      );
      const archive = await buildSanityImportTarGz(
        recording,
        images,
        exportTimestampSuffix(),
      );

      return reply
        .header("content-type", "application/gzip")
        .header(
          "content-disposition",
          `attachment; filename="${PRODUCT_IDENTIFIERS.exportPrefix}-${recording.id}-sanity.tar.gz"`,
        )
        .send(archive);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { templateId?: string };
  }>("/recordings/:id/export/word", async (request, reply) => {
    await requireRecordingRead(request, request.params.id);
    const { recording, images } = await loadRecordingAndImages(
      request.params.id,
    );
    const wordImages = await Promise.all(
      images.map(async (image) => ({
        filename: image.filename,
        content: await convertImageToPng(Buffer.from(image.content)),
        contentType: "image/png",
      })),
    );
    const selection = request.query.templateId;
    if (
      selection &&
      selection !== "standard" &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        selection,
      )
    )
      throw httpError(400, "Invalid Word template id");
    const template =
      selection === "standard"
        ? null
        : selection
          ? await getWordTemplate(pool, selection)
          : await getDefaultWordTemplate(pool);
    if (selection && selection !== "standard" && !template)
      throw httpError(404, "Word template not found");

    const user = currentUser(request);
    const author =
      (await findUserDisplayName(pool, recording.ownerUserId)) ??
      user.displayName;
    const finalized = recording.state === "finalized";
    const docx = template
      ? await buildTemplatedWorkflowDocx(
          template.content,
          recording,
          wordImages,
          {
            title: recording.title,
            purpose: recording.purpose ?? "",
            author,
            status: finalized ? "Final" : "Draft",
            version: finalized ? "1.0" : "0.1",
            date: new Intl.DateTimeFormat("en-GB", {
              dateStyle: "long",
              timeZone: "UTC",
            }).format(new Date()),
            approver: "",
            changeLogDetails: "Initial InfoSteed export",
          },
          exportTimestampSuffix(),
        )
      : await buildWorkflowDocx(
          recording,
          wordImages,
          await getDocxBranding(),
          exportTimestampSuffix(),
        );

    return reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header(
        "content-disposition",
        `attachment; filename="${PRODUCT_IDENTIFIERS.exportPrefix}-${recording.id}.docx"`,
      )
      .send(docx);
  });

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/export/pdf",
    async (request, reply) => {
      await requireRecordingRead(request, request.params.id);
      const { recording, images } = await loadRecordingAndImages(
        request.params.id,
      );
      const html = buildEmbeddedHtml(
        recording,
        images,
        await getExportBranding(),
      );
      const browser = await chromium.launch({ headless: true }).catch(() => {
        throw httpError(
          500,
          "PDF export requires Playwright Chromium. Run `pnpm exec playwright install chromium`.",
        );
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });
        const pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
        });
        return reply
          .header("content-type", "application/pdf")
          .header(
            "content-disposition",
            `attachment; filename="${PRODUCT_IDENTIFIERS.exportPrefix}-${recording.id}.pdf"`,
          )
          .send(pdf);
      } finally {
        await browser.close();
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/recordings/:id/project",
    async (request, reply) => {
      await requireRecordingRead(request, request.params.id);
      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");

      const screenshots = await listProjectScreenshotsForRecording(
        pool,
        request.params.id,
      );
      const project: RecordingProject = {
        version: 2,
        recording,
        items: recording.items,
        screenshots: screenshots.map((screenshot) => {
          if (!screenshot.original_image) {
            throw new Error(
              `Screenshot ${screenshot.filename} is missing its original image`,
            );
          }

          return {
            eventId: screenshot.event_id,
            filename: screenshot.filename,
            contentType:
              screenshot.content_type as RecordingProject["screenshots"][number]["contentType"],
            byteSize: screenshot.byte_size,
            originalImageBase64: screenshot.original_image.toString("base64"),
            annotatedImageBase64: screenshot.annotated_image.toString("base64"),
            editedImageBase64: screenshot.edited_image?.toString("base64"),
            editOperations: screenshot.edit_operations ?? { redactions: [] },
            targetBox:
              screenshot.target_box as RecordingProject["screenshots"][number]["targetBox"],
          };
        }),
      };

      return reply
        .header("content-type", "application/json")
        .header(
          "content-disposition",
          `attachment; filename="infosteed-project-${recording.id}.json"`,
        )
        .send(project);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/recordings/:id",
    async (request, reply) => {
      await requireRecordingWrite(request, request.params.id);
      await softDeleteRecording(
        pool,
        request.params.id,
        currentUser(request).id,
      );
      await audit(request, "guide_deleted", "recording", request.params.id);
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/recordings/:id/restore",
    async (request) => {
      await requireRecordingWrite(request, request.params.id);
      const restored = await restoreRecording(pool, request.params.id);
      if (!restored)
        throw httpError(
          409,
          "Guide can only be restored within 10 days of deletion",
        );
      await audit(request, "guide_restored", "recording", request.params.id);
      const recording = await getRecording(pool, request.params.id);
      if (!recording) throw httpError(404, "Recording not found");
      return recording;
    },
  );

  return app;
}
