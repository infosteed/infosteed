// SPDX-License-Identifier: AGPL-3.0-only
import type { ApiConfig } from "../config.js";
import type { Pool } from "../db.js";
import type { VideoStorage } from "../videoStorage.js";
import type { FastifyRequest } from "fastify";
import type { AuthUser } from "../repositories/auth.js";

export interface ApiRouteContext {
  config: ApiConfig;
  pool: Pool;
  videoStorage: VideoStorage;
}

export interface AuthenticatedRouteContext extends ApiRouteContext {
  currentUser(request: FastifyRequest): AuthUser;
  requireAdmin(request: FastifyRequest): AuthUser;
  requireProjectRead(
    request: FastifyRequest,
    projectId: string,
  ): Promise<unknown>;
  requireProjectWrite(
    request: FastifyRequest,
    projectId: string,
  ): Promise<unknown>;
  requireProjectManage(
    request: FastifyRequest,
    projectId: string,
  ): Promise<unknown>;
  audit(
    request: FastifyRequest,
    eventType: string,
    entityType?: string | null,
    entityId?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  httpError(
    statusCode: number,
    message: string,
  ): Error & {
    statusCode: number;
  };
}
