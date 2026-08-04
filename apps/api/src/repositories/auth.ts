// SPDX-License-Identifier: AGPL-3.0-only
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import {
  Algorithm,
  hash as argonHash,
  verify as argonVerify,
} from "@node-rs/argon2";
import type { Pool, PoolClient } from "../db.js";
import type {
  AuditEvent,
  BrandingSettings,
  CurrentUser,
  Project,
  ProjectMember,
  ProjectRole,
  RecordingListItem,
  UserDirectoryEntry,
  UserRole,
} from "@infosteed/shared";

type Db = Pool | PoolClient;

const scrypt = promisify(scryptCallback);
const HASH_PREFIX = "scrypt:v1";
const ARGON_PREFIX = "$argon2";
const KEY_LENGTH = 64;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  enabled: boolean;
  two_factor_required: boolean;
  two_factor_enabled?: boolean;
}

interface ProjectRow {
  id: string;
  owner_user_id: string;
  name: string;
  description: string | null;
  private: boolean;
  role?: ProjectRole;
  created_at: Date;
  updated_at: Date;
}

interface ProjectMemberRow {
  project_id: string;
  user_id: string;
  username: string;
  display_name: string;
  role: ProjectRole;
  enabled: boolean;
}

interface RecordingListRow {
  id: string;
  title: string;
  purpose: string | null;
  project_id: string | null;
  project_name: string | null;
  owner_user_id: string | null;
  owner_display_name: string | null;
  updated_at: Date;
  finalized_at: Date | null;
  deleted_at: Date | null;
  restorable_until: Date | null;
  step_count: string | number;
  user_role: "admin" | ProjectRole;
  thumbnail_filename: string | null;
  capture_mode: RecordingListItem["captureMode"];
}

interface AuditEventRow {
  id: string;
  actor_user_id: string | null;
  actor_display_name?: string | null;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export type AuthUser = CurrentUser;

function mapUser(row: UserRow): CurrentUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    enabled: row.enabled,
    twoFactorEnabled: Boolean(row.two_factor_enabled),
    twoFactorRequired: row.two_factor_required,
  };
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    description: row.description,
    private: row.private,
    role: row.role,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapProjectMember(row: ProjectMemberRow): ProjectMember {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    enabled: row.enabled,
  };
}

function mapRecordingListItem(row: RecordingListRow): RecordingListItem {
  return {
    id: row.id,
    title: row.title,
    overview: row.purpose,
    projectId: row.project_id,
    projectName: row.project_name,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    updatedAt: row.updated_at.toISOString(),
    finalizedAt: row.finalized_at?.toISOString() ?? null,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    restorableUntil: row.restorable_until?.toISOString() ?? null,
    stepCount: Number(row.step_count),
    userRole: row.user_role,
    thumbnailFilename: row.thumbnail_filename,
    captureMode: row.capture_mode,
  };
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    actorDisplayName: row.actor_display_name ?? null,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function hashPasswordScrypt(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  if (encoded.startsWith(ARGON_PREFIX)) return argonVerify(encoded, password);
  const [prefix, saltText, hashText] = encoded.split("$");
  if (prefix !== HASH_PREFIX || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = (await scrypt(
    password,
    Buffer.from(saltText, "base64url"),
    expected.length,
  )) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordNeedsRehash(encoded: string): boolean {
  return !encoded.startsWith(ARGON_PREFIX);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export async function countUsers(db: Db): Promise<number> {
  const result = await db.query<{ count: string }>(
    "select count(*) as count from users",
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function createUser(
  db: Db,
  input: {
    username: string;
    displayName: string;
    password: string;
    role: UserRole;
  },
): Promise<CurrentUser> {
  const result = await db.query<UserRow>(
    `
      insert into users (id, username, display_name, password_hash, role)
      values ($1, $2, $3, $4, $5)
      returning *
    `,
    [
      randomUUID(),
      input.username.trim(),
      input.displayName.trim(),
      await hashPassword(input.password),
      input.role,
    ],
  );
  return mapUser(result.rows[0]);
}

export async function updateUser(
  db: Db,
  userId: string,
  patch: {
    displayName?: string;
    role?: UserRole;
    enabled?: boolean;
    password?: string;
    twoFactorRequired?: boolean;
  },
): Promise<CurrentUser | null> {
  const passwordHash = patch.password
    ? await hashPassword(patch.password)
    : null;
  const result = await db.query<UserRow>(
    `
      update users
      set
        display_name = coalesce($2, display_name),
        role = coalesce($3, role),
        enabled = coalesce($4, enabled),
        password_hash = coalesce($5, password_hash),
        two_factor_required = coalesce($6, two_factor_required),
        updated_at = now()
      where id = $1
      returning *
    `,
    [
      userId,
      patch.displayName ?? null,
      patch.role ?? null,
      patch.enabled ?? null,
      passwordHash,
      patch.twoFactorRequired ?? null,
    ],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function updateOwnPassword(
  db: Db,
  userId: string,
  password: string,
): Promise<void> {
  await db.query(
    "update users set password_hash = $2, updated_at = now() where id = $1",
    [userId, await hashPassword(password)],
  );
}

export async function findUserByUsername(
  db: Db,
  username: string,
): Promise<(CurrentUser & { passwordHash: string }) | null> {
  const result = await db.query<UserRow>(
    `
      select u.*, exists(
        select 1 from user_totp_credentials c where c.user_id = u.id
      ) as two_factor_enabled
      from users u
      where lower(u.username) = lower($1)
    `,
    [username],
  );
  const row = result.rows[0];
  return row ? { ...mapUser(row), passwordHash: row.password_hash } : null;
}

export async function findUserWithPassword(
  db: Db,
  userId: string,
): Promise<(CurrentUser & { passwordHash: string }) | null> {
  const result = await db.query<UserRow>(
    `
      select u.*, exists(
        select 1 from user_totp_credentials c where c.user_id = u.id
      ) as two_factor_enabled
      from users u
      where u.id = $1
    `,
    [userId],
  );
  const row = result.rows[0];
  return row ? { ...mapUser(row), passwordHash: row.password_hash } : null;
}

export async function listUsers(db: Db): Promise<CurrentUser[]> {
  const result = await db.query<UserRow>(
    `
      select u.*, exists(
        select 1 from user_totp_credentials c where c.user_id = u.id
      ) as two_factor_enabled
      from users u
      order by u.display_name, u.username
    `,
  );
  return result.rows.map(mapUser);
}

export async function listUserDirectory(db: Db): Promise<UserDirectoryEntry[]> {
  const result = await db.query<
    Pick<UserRow, "id" | "username" | "display_name">
  >(
    "select id, username, display_name from users where enabled = true order by display_name, username",
  );
  return result.rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
  }));
}

export async function createSession(
  db: Db,
  userId: string,
  ttlDays: number,
): Promise<{ id: string; expiresAt: Date }> {
  const id = randomUUID();
  const result = await db.query<{ expires_at: Date }>(
    "insert into sessions (id, user_id, expires_at) values ($1, $2, now() + ($3::text || ' days')::interval) returning expires_at",
    [id, userId, ttlDays],
  );
  return { id, expiresAt: result.rows[0].expires_at };
}

export async function issueCsrfToken(
  db: Db,
  sessionId: string,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(
    "update sessions set csrf_token_hash = $2, csrf_token_created_at = now() where id = $1",
    [sessionId, tokenHash(token)],
  );
  return token;
}

export async function verifyCsrfToken(
  db: Db,
  sessionId: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  const result = await db.query<{ csrf_token_hash: string | null }>(
    "select csrf_token_hash from sessions where id = $1 and expires_at > now()",
    [sessionId],
  );
  const expected = result.rows[0]?.csrf_token_hash;
  if (!expected) return false;
  const actual = tokenHash(token);
  return (
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.query("delete from sessions where id = $1", [sessionId]);
}

export async function deleteUserSessions(
  db: Db,
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  if (exceptSessionId) {
    await db.query("delete from sessions where user_id = $1 and id <> $2", [
      userId,
      exceptSessionId,
    ]);
    return;
  }
  await db.query("delete from sessions where user_id = $1", [userId]);
}

export async function getSessionUser(
  db: Db,
  sessionId: string,
): Promise<CurrentUser | null> {
  await db.query("delete from sessions where expires_at <= now()");
  const result = await db.query<UserRow>(
    `
      select u.*, exists(
        select 1 from user_totp_credentials c where c.user_id = u.id
      ) as two_factor_enabled
      from sessions s
      join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now() and u.enabled = true
    `,
    [sessionId],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function recordLoginAttempt(
  db: Db,
  input: { username: string; ipAddress: string; success: boolean },
): Promise<void> {
  await db.query(
    "delete from auth_login_attempts where created_at < now() - interval '1 day'",
  );
  if (input.success) {
    await db.query(
      "delete from auth_login_attempts where lower(username) = lower($1) and ip_address = $2",
      [input.username, input.ipAddress],
    );
  }
  await db.query(
    "insert into auth_login_attempts (id, username, ip_address, success) values ($1, lower($2), $3, $4)",
    [randomUUID(), input.username, input.ipAddress, input.success],
  );
}

export async function isLoginRateLimited(
  db: Db,
  input: { username: string; ipAddress: string },
): Promise<boolean> {
  const result = await db.query<{ recent_count: string; window_count: string }>(
    `
      select
        count(*) filter (where created_at >= now() - interval '1 minute' and success = false) as recent_count,
        count(*) filter (where created_at >= now() - interval '15 minutes' and success = false) as window_count
      from auth_login_attempts
      where lower(username) = lower($1) and ip_address = $2
    `,
    [input.username, input.ipAddress],
  );
  const row = result.rows[0];
  return (
    Number(row?.recent_count ?? 0) >= 5 || Number(row?.window_count ?? 0) >= 20
  );
}

export async function writeAuditEvent(
  db: Db,
  input: {
    actorUserId?: string | null;
    eventType: string;
    entityType?: string | null;
    entityId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    "delete from audit_events where created_at < now() - interval '1 year'",
  );
  await db.query(
    `
      insert into audit_events (
        id, actor_user_id, event_type, entity_type, entity_id,
        ip_address, user_agent, metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      randomUUID(),
      input.actorUserId ?? null,
      input.eventType,
      input.entityType ?? null,
      input.entityId ?? null,
      input.ipAddress ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function listAuditEvents(
  db: Db,
  filters: {
    eventType?: string;
    actorUserId?: string;
    entityId?: string;
    from?: string;
    to?: string;
    limit?: number;
  },
): Promise<{ events: AuditEvent[] }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filters.eventType) {
    params.push(filters.eventType);
    where.push(`ae.event_type = $${params.length}`);
  }
  if (filters.actorUserId) {
    params.push(filters.actorUserId);
    where.push(`ae.actor_user_id = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId);
    where.push(`ae.entity_id = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    where.push(`ae.created_at >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    where.push(`ae.created_at <= $${params.length}`);
  }
  params.push(filters.limit ?? 100);
  const result = await db.query<AuditEventRow>(
    `
      select ae.*, u.display_name as actor_display_name
      from audit_events ae
      left join users u on u.id = ae.actor_user_id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by ae.created_at desc
      limit $${params.length}
    `,
    params,
  );
  return { events: result.rows.map(mapAuditEvent) };
}

export async function ensurePersonalProject(
  db: Db,
  user: Pick<CurrentUser, "id" | "displayName">,
): Promise<Project> {
  const existing = await db.query<ProjectRow>(
    `
      select p.*, pm.role
      from projects p
      join project_members pm on pm.project_id = p.id and pm.user_id = $1
      where p.owner_user_id = $1 and pm.role = 'owner'
      order by p.created_at
      limit 1
    `,
    [user.id],
  );
  if (existing.rows[0]) return mapProject(existing.rows[0]);

  const projectId = randomUUID();
  const result = await db.query<ProjectRow>(
    `
      insert into projects (id, owner_user_id, name, description, private)
      values ($1, $2, $3, $4, true)
      returning *
    `,
    [
      projectId,
      user.id,
      `${user.displayName}'s Guides`,
      "Private personal guide workspace",
    ],
  );
  await db.query(
    "insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')",
    [projectId, user.id],
  );
  return mapProject({ ...result.rows[0], role: "owner" });
}

export async function setupFirstAdmin(
  db: Db,
  input: { username: string; displayName: string; password: string },
): Promise<CurrentUser> {
  await db.query("select pg_advisory_xact_lock(748394022)");
  if ((await countUsers(db)) > 0) throw new Error("Setup is already complete");
  const admin = await createUser(db, { ...input, role: "admin" });
  const project = await ensurePersonalProject(db, admin);
  await db.query(
    "update recordings set owner_user_id = $1, project_id = $2 where owner_user_id is null or project_id is null",
    [admin.id, project.id],
  );
  return admin;
}

export async function listProjects(
  db: Db,
  user: CurrentUser,
): Promise<Project[]> {
  if (user.role === "admin") {
    const result = await db.query<ProjectRow>(
      `
        select p.*, coalesce(pm.role, 'owner') as role
        from projects p
        left join project_members pm on pm.project_id = p.id and pm.user_id = $1
        order by p.updated_at desc, p.name
      `,
      [user.id],
    );
    return result.rows.map(mapProject);
  }

  const result = await db.query<ProjectRow>(
    `
      select p.*, pm.role
      from projects p
      join project_members pm on pm.project_id = p.id
      where pm.user_id = $1
      order by p.updated_at desc, p.name
    `,
    [user.id],
  );
  return result.rows.map(mapProject);
}

export async function createProject(
  db: Db,
  user: CurrentUser,
  input: { name: string; description?: string | null; private?: boolean },
): Promise<Project> {
  const projectId = randomUUID();
  const result = await db.query<ProjectRow>(
    `
      insert into projects (id, owner_user_id, name, description, private)
      values ($1, $2, $3, $4, $5)
      returning *
    `,
    [
      projectId,
      user.id,
      input.name,
      input.description ?? null,
      input.private ?? true,
    ],
  );
  await db.query(
    "insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')",
    [projectId, user.id],
  );
  return mapProject({ ...result.rows[0], role: "owner" });
}

export async function getProjectRole(
  db: Db,
  user: CurrentUser,
  projectId: string,
): Promise<ProjectRole | "admin" | null> {
  if (user.role === "admin") return "admin";
  const result = await db.query<{ role: ProjectRole }>(
    "select role from project_members where project_id = $1 and user_id = $2",
    [projectId, user.id],
  );
  return result.rows[0]?.role ?? null;
}

export function canEditProject(role: ProjectRole | "admin" | null): boolean {
  return role === "admin" || role === "owner" || role === "editor";
}

export function canManageProject(role: ProjectRole | "admin" | null): boolean {
  return role === "admin" || role === "owner";
}

export async function updateProject(
  db: Db,
  projectId: string,
  patch: { name?: string; description?: string | null; private?: boolean },
): Promise<Project | null> {
  const result = await db.query<ProjectRow>(
    `
      update projects
      set
        name = coalesce($2, name),
        description = case when $3::boolean then $4 else description end,
        private = coalesce($5, private),
        updated_at = now()
      where id = $1
      returning *
    `,
    [
      projectId,
      patch.name ?? null,
      Object.prototype.hasOwnProperty.call(patch, "description"),
      patch.description ?? null,
      patch.private ?? null,
    ],
  );
  return result.rows[0] ? mapProject(result.rows[0]) : null;
}

export async function listProjectMembers(
  db: Db,
  projectId: string,
): Promise<ProjectMember[]> {
  const result = await db.query<ProjectMemberRow>(
    `
      select pm.project_id, pm.user_id, u.username, u.display_name, pm.role, u.enabled
      from project_members pm
      join users u on u.id = pm.user_id
      where pm.project_id = $1
      order by pm.role, u.display_name, u.username
    `,
    [projectId],
  );
  return result.rows.map(mapProjectMember);
}

export async function upsertProjectMember(
  db: Db,
  projectId: string,
  userId: string,
  role: "editor" | "viewer",
): Promise<ProjectMember | null> {
  await db.query(
    `
      insert into project_members (project_id, user_id, role)
      values ($1, $2, $3)
      on conflict (project_id, user_id) do update set role = excluded.role
    `,
    [projectId, userId, role],
  );
  const members = await listProjectMembers(db, projectId);
  return members.find((member) => member.userId === userId) ?? null;
}

export async function deleteProjectMember(
  db: Db,
  projectId: string,
  userId: string,
): Promise<void> {
  await db.query(
    "delete from project_members where project_id = $1 and user_id = $2 and role <> 'owner'",
    [projectId, userId],
  );
}

export async function recordingAccessRole(
  db: Db,
  user: CurrentUser,
  recordingId: string,
): Promise<ProjectRole | "admin" | null> {
  if (user.role === "admin") return "admin";
  const result = await db.query<{
    role: ProjectRole | null;
    owner_user_id: string | null;
  }>(
    `
      select r.owner_user_id, pm.role
      from recordings r
      left join project_members pm on pm.project_id = r.project_id and pm.user_id = $2
      where r.id = $1
    `,
    [recordingId, user.id],
  );
  const row = result.rows[0];
  if (!row) return null;
  if (row.owner_user_id === user.id) return "owner";
  return row.role ?? null;
}

export async function moveRecordingToProject(
  db: Db,
  recordingId: string,
  projectId: string,
): Promise<void> {
  await db.query(
    "update recordings set project_id = $2, updated_at = now() where id = $1",
    [recordingId, projectId],
  );
}

export async function listAccessibleRecordings(
  db: Db,
  user: CurrentUser,
  input: {
    search?: string;
    projectId?: string;
    scope?: "owned" | "shared" | "trash" | "all";
    sort?: "recent" | "title";
    limit?: number;
    offset?: number;
  },
): Promise<{ items: RecordingListItem[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [user.id];
  if (user.role !== "admin")
    where.push("(r.owner_user_id = $1 or pm.user_id = $1)");
  if (input.scope === "trash") {
    where.push("r.deleted_at is not null");
  } else {
    where.push("r.deleted_at is null");
  }
  if (input.search) {
    params.push(`%${input.search}%`);
    where.push(
      `(r.title ilike $${params.length} or coalesce(r.purpose, '') ilike $${params.length})`,
    );
  }
  if (input.projectId) {
    params.push(input.projectId);
    where.push(`r.project_id = $${params.length}`);
  }
  if (input.scope === "owned") where.push("r.owner_user_id = $1");
  if (input.scope === "shared")
    where.push("r.owner_user_id is distinct from $1");

  const whereSql = where.length > 0 ? `where ${where.join(" and ")}` : "";
  const orderSql =
    input.sort === "title"
      ? "order by lower(r.title), r.updated_at desc"
      : "order by r.updated_at desc";
  params.push(input.limit ?? 48);
  const limitIndex = params.length;
  params.push(input.offset ?? 0);
  const offsetIndex = params.length;

  const result = await db.query<RecordingListRow & { total_count: string }>(
    `
      select
        r.id,
        r.title,
        r.purpose,
        r.capture_mode,
        r.project_id,
        p.name as project_name,
        r.owner_user_id,
        owner.display_name as owner_display_name,
        r.updated_at,
        r.finalized_at,
        r.deleted_at,
        case when r.deleted_at is null then null else r.deleted_at + interval '10 days' end as restorable_until,
        count(gi.id) filter (where gi.kind = 'step') as step_count,
        case
          when $1::uuid = r.owner_user_id then 'owner'
          when $1::uuid is null then 'admin'
          else coalesce(pm.role, 'viewer')
        end as user_role,
        (
          select s.filename
          from screenshots s
          where s.recording_id = r.id
          order by s.filename
          limit 1
        ) as thumbnail_filename,
        count(*) over() as total_count
      from recordings r
      left join projects p on p.id = r.project_id
      left join users owner on owner.id = r.owner_user_id
      left join project_members pm on pm.project_id = r.project_id and pm.user_id = $1
      left join guide_items gi on gi.recording_id = r.id
      ${whereSql}
      group by r.id, p.name, owner.display_name, pm.role
      ${orderSql}
      limit $${limitIndex} offset $${offsetIndex}
    `,
    params,
  );
  return {
    items: result.rows.map((row) =>
      mapRecordingListItem({
        ...row,
        user_role: user.role === "admin" ? "admin" : row.user_role,
      }),
    ),
    total: Number(result.rows[0]?.total_count ?? 0),
  };
}

export async function getBranding(db: Db): Promise<BrandingSettings> {
  const result = await db.query<{ value: BrandingSettings }>(
    "select value from app_settings where key = 'branding'",
  );
  return {
    displayName: result.rows[0]?.value?.displayName ?? "InfoSteed",
    iconDataUrl: result.rows[0]?.value?.iconDataUrl ?? null,
  };
}

export async function updateBranding(
  db: Db,
  patch: Partial<BrandingSettings>,
): Promise<BrandingSettings> {
  const current = await getBranding(db);
  const next = {
    displayName: patch.displayName ?? current.displayName,
    iconDataUrl: Object.prototype.hasOwnProperty.call(patch, "iconDataUrl")
      ? (patch.iconDataUrl ?? null)
      : (current.iconDataUrl ?? null),
  };
  await db.query(
    `
      insert into app_settings (key, value, updated_at)
      values ('branding', $1::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `,
    [JSON.stringify(next)],
  );
  return next;
}
