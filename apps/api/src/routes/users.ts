// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from "fastify";
import {
  adminTwoFactorResetRequestSchema,
  createUserRequestSchema,
  PROTOCOL_VERSION,
  updateUserRequestSchema,
} from "@infosteed/shared";
import { withTransaction } from "../db.js";
import {
  createUser,
  deleteUserSessions,
  ensurePersonalProject,
  findUserWithPassword,
  listAuditEvents,
  listUserDirectory,
  listUsers,
  updateUser,
  verifyPassword,
} from "../repositories/auth.js";
import {
  resetUserTwoFactor,
  userHasTwoFactor,
  verifyExistingSecondFactor,
} from "../repositories/twoFactor.js";
import type { AuthenticatedRouteContext } from "./context.js";

interface UserRouteContext extends AuthenticatedRouteContext {
  guideWriterConfigured: boolean;
  transcriptionConfigured: boolean;
  voiceoverConfigured: boolean;
  renderWorkerAvailable(): Promise<boolean>;
}

export function registerUserRoutes(
  app: FastifyInstance,
  context: UserRouteContext,
): void {
  const {
    config,
    pool,
    videoStorage,
    currentUser,
    requireAdmin,
    audit,
    httpError,
  } = context;

  async function requireAdminStepUp(
    adminId: string,
    currentPassword: string,
    code?: string,
  ): Promise<{ usedRecoveryCode: boolean }> {
    const admin = await findUserWithPassword(pool, adminId);
    if (
      !admin ||
      !(await verifyPassword(currentPassword, admin.passwordHash))
    ) {
      throw httpError(401, "Current password is incorrect");
    }
    if (!(await userHasTwoFactor(pool, adminId)))
      return { usedRecoveryCode: false };
    if (!code) throw httpError(401, "Second-factor code is required");
    const verified = await withTransaction(pool, (client) =>
      verifyExistingSecondFactor(client, config, { userId: adminId, code }),
    );
    if (!verified.ok) throw httpError(401, "Second-factor code is incorrect");
    return { usedRecoveryCode: verified.recovery };
  }

  app.get("/users", async (request) => {
    requireAdmin(request);
    return { users: await listUsers(pool) };
  });

  app.get("/admin/audit-events", async (request) => {
    requireAdmin(request);
    const query = request.query as Record<string, string | undefined>;
    return listAuditEvents(pool, {
      eventType: query.eventType,
      actorUserId: query.actorUserId,
      entityId: query.entityId,
      from: query.from,
      to: query.to,
      limit: Math.min(500, Math.max(1, Number(query.limit ?? 100))),
    });
  });

  app.get("/admin/system/status", async (request) => {
    requireAdmin(request);
    const queues = await pool.query<{
      transcription_queued: string;
      render_queued: string;
      voiceover_queued: string;
    }>(`
      select
        (select count(*) from recording_videos where transcription_status = 'pending') as transcription_queued,
        (select count(*) from recording_video_renders where status = 'queued') as render_queued,
        (select count(*) from recording_voiceover_generations where status = 'queued') as voiceover_queued
    `);
    const row = queues.rows[0];
    const objectStorageHealthy = await videoStorage
      .checkHealth()
      .catch(() => false);
    return {
      protocolVersion: PROTOCOL_VERSION,
      providers: {
        guideWriter: context.guideWriterConfigured
          ? "configured"
          : "deterministic",
        transcription: context.transcriptionConfigured
          ? "configured"
          : "disabled",
        voiceover: context.voiceoverConfigured ? "configured" : "disabled",
        objectStorage: videoStorage.enabled
          ? objectStorageHealthy
            ? "ready"
            : "unavailable"
          : "disabled",
        twoFactorEnrollment: config.TWO_FACTOR_ENABLED ? "enabled" : "disabled",
      },
      workers: {
        renderer:
          config.VIDEO_RENDER_ENABLED && (await context.renderWorkerAvailable())
            ? "ready"
            : "unavailable",
        transcription: context.transcriptionConfigured ? "enabled" : "disabled",
        voiceover: context.voiceoverConfigured ? "enabled" : "disabled",
      },
      queues: {
        transcription: Number(row?.transcription_queued ?? 0),
        rendering: Number(row?.render_queued ?? 0),
        voiceover: Number(row?.voiceover_queued ?? 0),
      },
    };
  });

  app.get("/users/directory", async () => ({
    users: await listUserDirectory(pool),
  }));

  app.post("/users", async (request, reply) => {
    requireAdmin(request);
    const input = createUserRequestSchema.parse(request.body);
    const user = await withTransaction(pool, async (client) => {
      const created = await createUser(client, input);
      await ensurePersonalProject(client, created);
      return created;
    });
    await audit(request, "user_created", "user", user.id, { role: user.role });
    return reply.code(201).send(user);
  });

  app.patch<{ Params: { id: string } }>("/users/:id", async (request) => {
    requireAdmin(request);
    const patch = updateUserRequestSchema.parse(request.body);
    if (patch.twoFactorRequired === true && !config.TWO_FACTOR_ENABLED)
      throw httpError(503, "Two-factor enrollment is disabled");
    const previous = await pool.query<{ two_factor_required: boolean }>(
      "select two_factor_required from users where id = $1",
      [request.params.id],
    );
    if (!previous.rows[0]) throw httpError(404, "User not found");
    const user = await updateUser(pool, request.params.id, patch);
    if (!user) throw httpError(404, "User not found");
    if (
      patch.password ||
      patch.enabled === false ||
      (patch.twoFactorRequired === true &&
        previous.rows[0].two_factor_required === false)
    )
      await deleteUserSessions(pool, user.id);
    await audit(
      request,
      patch.password
        ? "password_reset"
        : patch.twoFactorRequired !== undefined
          ? "two_factor_requirement_changed"
          : "user_updated",
      "user",
      user.id,
      {
        role: patch.role,
        enabled: patch.enabled,
        twoFactorRequired: patch.twoFactorRequired,
      },
    );
    return user;
  });

  app.post<{ Params: { id: string } }>(
    "/users/:id/2fa/reset",
    async (request) => {
      const admin = requireAdmin(request);
      if (request.params.id === currentUser(request).id)
        throw httpError(
          409,
          "Use self-service disablement for your own account",
        );
      const input = adminTwoFactorResetRequestSchema.parse(request.body);
      const proof = await requireAdminStepUp(
        admin.id,
        input.currentPassword,
        input.code,
      );
      const target = await pool.query<{
        id: string;
        two_factor_required: boolean;
      }>("select id, two_factor_required from users where id = $1", [
        request.params.id,
      ]);
      if (!target.rows[0]) throw httpError(404, "User not found");
      await withTransaction(pool, async (client) => {
        await resetUserTwoFactor(client, request.params.id);
        await deleteUserSessions(client, request.params.id);
      });
      await audit(
        request,
        "two_factor_admin_reset",
        "user",
        request.params.id,
        {
          preservedRequirement: target.rows[0].two_factor_required,
          usedRecoveryCode: proof.usedRecoveryCode,
        },
      );
      return { ok: true };
    },
  );
}
