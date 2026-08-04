// SPDX-License-Identifier: AGPL-3.0-only
import type { FastifyInstance } from "fastify";
import {
  createProjectRequestSchema,
  updateBrandingSettingsRequestSchema,
  updateProjectMemberRequestSchema,
  updateProjectRequestSchema,
} from "@infosteed/shared";
import {
  createProject,
  deleteProjectMember,
  getBranding,
  listProjectMembers,
  listProjects,
  updateBranding,
  updateProject,
  upsertProjectMember,
} from "../repositories/auth.js";
import type { AuthenticatedRouteContext } from "./context.js";

export function registerProjectRoutes(
  app: FastifyInstance,
  context: AuthenticatedRouteContext,
): void {
  const {
    pool,
    currentUser,
    requireAdmin,
    requireProjectRead,
    requireProjectManage,
    audit,
    httpError,
  } = context;

  app.get("/projects", async (request) => ({
    projects: await listProjects(pool, currentUser(request)),
  }));

  app.post("/projects", async (request, reply) => {
    const input = createProjectRequestSchema.parse(request.body);
    const project = await createProject(pool, currentUser(request), input);
    return reply.code(201).send(project);
  });

  app.patch<{ Params: { id: string } }>("/projects/:id", async (request) => {
    await requireProjectManage(request, request.params.id);
    const patch = updateProjectRequestSchema.parse(request.body);
    const project = await updateProject(pool, request.params.id, patch);
    if (!project) throw httpError(404, "Project not found");
    return project;
  });

  app.get<{ Params: { id: string } }>(
    "/projects/:id/members",
    async (request) => {
      await requireProjectRead(request, request.params.id);
      return { members: await listProjectMembers(pool, request.params.id) };
    },
  );

  app.put<{ Params: { id: string } }>(
    "/projects/:id/members",
    async (request, reply) => {
      await requireProjectManage(request, request.params.id);
      const input = updateProjectMemberRequestSchema.parse(request.body);
      const member = await upsertProjectMember(
        pool,
        request.params.id,
        input.userId,
        input.role,
      );
      if (!member) throw httpError(404, "User not found");
      await audit(
        request,
        "share_member_upserted",
        "project",
        request.params.id,
        { userId: input.userId, role: input.role },
      );
      return reply.code(201).send(member);
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/projects/:id/members/:userId",
    async (request, reply) => {
      await requireProjectManage(request, request.params.id);
      await deleteProjectMember(pool, request.params.id, request.params.userId);
      await audit(
        request,
        "share_member_removed",
        "project",
        request.params.id,
        { userId: request.params.userId },
      );
      return reply.code(204).send();
    },
  );

  app.get("/settings/branding", async () => getBranding(pool));

  app.patch("/settings/branding", async (request) => {
    requireAdmin(request);
    const patch = updateBrandingSettingsRequestSchema.parse(request.body);
    if (patch.iconDataUrl) {
      const isAllowed =
        /^data:image\/(?:png|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(
          patch.iconDataUrl,
        );
      if (!isAllowed || patch.iconDataUrl.length > 1_500_000) {
        throw httpError(
          400,
          "Icon must be a PNG, WebP, or SVG data URL under 1.5 MB",
        );
      }
    }
    const branding = await updateBranding(pool, patch);
    await audit(request, "branding_updated", "settings", "branding", {
      displayName: patch.displayName,
      iconChanged: Object.prototype.hasOwnProperty.call(patch, "iconDataUrl"),
    });
    return branding;
  });
}
