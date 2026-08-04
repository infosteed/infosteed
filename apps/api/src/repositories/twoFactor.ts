// SPDX-License-Identifier: AGPL-3.0-only
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import type { ApiConfig } from "../config.js";
import type { Pool, PoolClient } from "../db.js";

type Db = Pool | PoolClient;

const TOTP_ALGORITHM = "SHA1";
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30;
const TOTP_SECRET_BYTES = 20;
const TOTP_WINDOW = 1;
const CONTINUATION_TTL_MS = 5 * 60 * 1000;
const CONTINUATION_MAX_ATTEMPTS = 5;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 16;

export type TwoFactorContinuationPurpose =
  "login" | "enrollment_login" | "account_enrollment";

interface TotpCredentialRow {
  user_id: string;
  secret_ciphertext: string;
  last_accepted_counter: string | number | null;
}

interface ContinuationRow {
  id: string;
  user_id: string;
  purpose: TwoFactorContinuationPurpose;
  totp_secret_ciphertext: string | null;
  expires_at: Date;
  attempts: number;
}

interface CipherEnvelope {
  v: 1;
  alg: "AES-256-GCM";
  iv: string;
  tag: string;
  data: string;
}

export interface TwoFactorEnrollmentChallenge {
  continuationToken: string;
  manualSecret: string;
  otpauthUri: string;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function recoveryHash(code: string): string {
  return tokenHash(normalizeRecoveryCode(code));
}

export function normalizeRecoveryCode(code: string): string {
  return code
    .trim()
    .replace(/[\s-]+/g, "")
    .toUpperCase();
}

function encryptionKey(config: ApiConfig): Buffer {
  if (!config.TWO_FACTOR_ENCRYPTION_KEY)
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY is required for 2FA secrets");
  return Buffer.from(config.TWO_FACTOR_ENCRYPTION_KEY, "hex");
}

export function encryptTwoFactorSecret(
  config: ApiConfig,
  userId: string,
  secret: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(config), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const envelope: CipherEnvelope = {
    v: 1,
    alg: "AES-256-GCM",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url"),
  };
  return JSON.stringify(envelope);
}

export function decryptTwoFactorSecret(
  config: ApiConfig,
  userId: string,
  ciphertext: string,
): string {
  const envelope = JSON.parse(ciphertext) as CipherEnvelope;
  if (envelope.v !== 1 || envelope.alg !== "AES-256-GCM")
    throw new Error("Unsupported 2FA secret envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(config),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function createTotp(
  secret: string,
  issuer: string,
  label: string,
): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer,
    label,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

function acceptedCounter(delta: number, timestamp = Date.now()): number {
  return OTPAuth.TOTP.counter({ period: TOTP_PERIOD, timestamp }) + delta;
}

function verifyTotpSecret(
  secret: string,
  code: string,
  lastAcceptedCounter: string | number | null,
): { ok: true; counter: number } | { ok: false } {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const timestamp = Date.now();
  const delta = OTPAuth.TOTP.validate({
    token: code,
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    timestamp,
    window: TOTP_WINDOW,
  });
  if (delta === null) return { ok: false };
  const counter = acceptedCounter(delta, timestamp);
  if (lastAcceptedCounter !== null && counter <= Number(lastAcceptedCounter)) {
    return { ok: false };
  }
  return { ok: true, counter };
}

export function buildTotpLabel(input: {
  username: string;
  appDomain?: string;
}): string {
  return input.appDomain
    ? `${input.username}@${input.appDomain}`
    : input.username;
}

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: TOTP_SECRET_BYTES }).base32;
}

export function buildTotpUri(input: {
  issuer: string;
  label: string;
  secret: string;
}): string {
  return createTotp(input.secret, input.issuer, input.label).toString();
}

function generateContinuationToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateRecoveryCode(): string {
  return randomBytes(RECOVERY_CODE_BYTES)
    .toString("base64url")
    .toUpperCase()
    .match(/.{1,4}/g)!
    .join("-");
}

export async function userHasTwoFactor(
  db: Db,
  userId: string,
): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(
    "select exists(select 1 from user_totp_credentials where user_id = $1) as exists",
    [userId],
  );
  return Boolean(result.rows[0]?.exists);
}

export async function getTwoFactorStatus(
  db: Db,
  userId: string,
): Promise<{
  enabled: boolean;
  required: boolean;
  recoveryCodesRemaining: number;
}> {
  const result = await db.query<{
    two_factor_required: boolean;
    enabled: boolean;
    recovery_codes_remaining: string;
  }>(
    `
      select
        u.two_factor_required,
        exists(select 1 from user_totp_credentials c where c.user_id = u.id) as enabled,
        (
          select count(*)
          from user_recovery_codes rc
          where rc.user_id = u.id and rc.consumed_at is null
        ) as recovery_codes_remaining
      from users u
      where u.id = $1
    `,
    [userId],
  );
  const row = result.rows[0];
  return {
    enabled: Boolean(row?.enabled),
    required: Boolean(row?.two_factor_required),
    recoveryCodesRemaining: Number(row?.recovery_codes_remaining ?? 0),
  };
}

export async function createTwoFactorContinuation(
  db: Db,
  config: ApiConfig,
  input: {
    userId: string;
    purpose: TwoFactorContinuationPurpose;
    secret?: string;
  },
): Promise<{ token: string }> {
  const token = generateContinuationToken();
  const secretCiphertext = input.secret
    ? encryptTwoFactorSecret(config, input.userId, input.secret)
    : null;
  await db.query(
    "delete from two_factor_continuations where expires_at <= now() or attempts >= $1",
    [CONTINUATION_MAX_ATTEMPTS],
  );
  await db.query(
    `
      insert into two_factor_continuations (
        id, user_id, token_hash, purpose, totp_secret_ciphertext, expires_at
      )
      values ($1, $2, $3, $4, $5, $6)
    `,
    [
      randomUUID(),
      input.userId,
      tokenHash(token),
      input.purpose,
      secretCiphertext,
      new Date(Date.now() + CONTINUATION_TTL_MS),
    ],
  );
  return { token };
}

export async function createEnrollmentChallenge(
  db: Db,
  config: ApiConfig,
  input: {
    userId: string;
    username: string;
    issuer: string;
    appDomain?: string;
    purpose: "enrollment_login" | "account_enrollment";
  },
): Promise<TwoFactorEnrollmentChallenge> {
  const secret = generateTotpSecret();
  const label = buildTotpLabel({
    username: input.username,
    appDomain: input.appDomain,
  });
  const continuation = await createTwoFactorContinuation(db, config, {
    userId: input.userId,
    purpose: input.purpose,
    secret,
  });
  return {
    continuationToken: continuation.token,
    manualSecret: secret,
    otpauthUri: buildTotpUri({ issuer: input.issuer, label, secret }),
  };
}

export async function getTwoFactorContinuationPurpose(
  db: Db,
  token: string,
): Promise<TwoFactorContinuationPurpose | null> {
  const result = await db.query<{
    purpose: TwoFactorContinuationPurpose;
    expires_at: Date;
    attempts: number;
  }>(
    `
      select purpose, expires_at, attempts
      from two_factor_continuations
      where token_hash = $1
    `,
    [tokenHash(token)],
  );
  const row = result.rows[0];
  if (
    !row ||
    row.expires_at.getTime() <= Date.now() ||
    row.attempts >= CONTINUATION_MAX_ATTEMPTS
  ) {
    return null;
  }
  return row.purpose;
}

async function lockContinuation(
  db: Db,
  token: string,
): Promise<ContinuationRow | null> {
  const result = await db.query<ContinuationRow>(
    `
      select *
      from two_factor_continuations
      where token_hash = $1
      for update
    `,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

async function failContinuation(db: Db, row: ContinuationRow): Promise<void> {
  const nextAttempts = row.attempts + 1;
  await db.query(
    `
      update two_factor_continuations
      set attempts = $2,
        expires_at = case when $2 >= $3 then now() else expires_at end
      where id = $1
    `,
    [row.id, nextAttempts, CONTINUATION_MAX_ATTEMPTS],
  );
}

async function deleteContinuation(db: Db, id: string): Promise<void> {
  await db.query("delete from two_factor_continuations where id = $1", [id]);
}

export async function verifyLoginSecondFactor(
  db: Db,
  config: ApiConfig,
  input: { continuationToken: string; code: string },
): Promise<
  { ok: true; userId: string; usedRecoveryCode: boolean } | { ok: false }
> {
  const row = await lockContinuation(db, input.continuationToken);
  if (
    !row ||
    row.purpose !== "login" ||
    row.expires_at.getTime() <= Date.now() ||
    row.attempts >= CONTINUATION_MAX_ATTEMPTS
  ) {
    return { ok: false };
  }
  const result = await verifyExistingSecondFactor(db, config, {
    userId: row.user_id,
    code: input.code,
  });
  if (!result.ok) {
    await failContinuation(db, row);
    return { ok: false };
  }
  await deleteContinuation(db, row.id);
  return { ok: true, userId: row.user_id, usedRecoveryCode: result.recovery };
}

export async function confirmTwoFactorEnrollment(
  db: Db,
  config: ApiConfig,
  input: {
    continuationToken: string;
    code: string;
    allowedPurpose: "enrollment_login" | "account_enrollment";
    expectedUserId?: string;
  },
): Promise<
  | { ok: true; userId: string; recoveryCodes: string[] }
  | { ok: false; reason: "invalid" | "expired" }
> {
  const row = await lockContinuation(db, input.continuationToken);
  if (!row || row.purpose !== input.allowedPurpose)
    return { ok: false, reason: "invalid" };
  if (input.expectedUserId && row.user_id !== input.expectedUserId)
    return { ok: false, reason: "invalid" };
  if (
    row.expires_at.getTime() <= Date.now() ||
    row.attempts >= CONTINUATION_MAX_ATTEMPTS ||
    !row.totp_secret_ciphertext
  ) {
    return { ok: false, reason: "expired" };
  }
  const secret = decryptTwoFactorSecret(
    config,
    row.user_id,
    row.totp_secret_ciphertext,
  );
  const verified = verifyTotpSecret(secret, input.code, null);
  if (!verified.ok) {
    await failContinuation(db, row);
    return { ok: false, reason: "invalid" };
  }
  await db.query(
    `
      insert into user_totp_credentials (
        user_id, secret_ciphertext, last_accepted_counter, updated_at
      )
      values ($1, $2, $3, now())
      on conflict (user_id) do update
      set secret_ciphertext = excluded.secret_ciphertext,
        last_accepted_counter = excluded.last_accepted_counter,
        updated_at = now()
    `,
    [row.user_id, row.totp_secret_ciphertext, verified.counter],
  );
  const recoveryCodes = await replaceRecoveryCodes(db, row.user_id);
  await deleteContinuation(db, row.id);
  return { ok: true, userId: row.user_id, recoveryCodes };
}

export async function verifyExistingSecondFactor(
  db: Db,
  config: ApiConfig,
  input: { userId: string; code: string },
): Promise<{ ok: true; recovery: boolean } | { ok: false }> {
  const credential = await db.query<TotpCredentialRow>(
    `
      select *
      from user_totp_credentials
      where user_id = $1
      for update
    `,
    [input.userId],
  );
  const row = credential.rows[0];
  if (!row) return { ok: false };
  const normalized = normalizeRecoveryCode(input.code);
  if (/^\d{6}$/.test(normalized)) {
    const secret = decryptTwoFactorSecret(
      config,
      input.userId,
      row.secret_ciphertext,
    );
    const verified = verifyTotpSecret(
      secret,
      normalized,
      row.last_accepted_counter,
    );
    if (verified.ok) {
      await db.query(
        "update user_totp_credentials set last_accepted_counter = $2, updated_at = now() where user_id = $1",
        [input.userId, verified.counter],
      );
      return { ok: true, recovery: false };
    }
  }
  const hash = recoveryHash(normalized);
  const recovery = await db.query<{ id: string; code_hash: string }>(
    `
      select id, code_hash
      from user_recovery_codes
      where user_id = $1 and consumed_at is null
      for update
    `,
    [input.userId],
  );
  for (const recoveryRow of recovery.rows) {
    if (
      hash.length === recoveryRow.code_hash.length &&
      timingSafeEqual(Buffer.from(hash), Buffer.from(recoveryRow.code_hash))
    ) {
      await db.query(
        "update user_recovery_codes set consumed_at = now() where id = $1",
        [recoveryRow.id],
      );
      return { ok: true, recovery: true };
    }
  }
  return { ok: false };
}

export async function replaceRecoveryCodes(
  db: Db,
  userId: string,
): Promise<string[]> {
  const codes = Array.from(
    { length: RECOVERY_CODE_COUNT },
    generateRecoveryCode,
  );
  await db.query("delete from user_recovery_codes where user_id = $1", [
    userId,
  ]);
  for (const code of codes) {
    await db.query(
      "insert into user_recovery_codes (id, user_id, code_hash) values ($1, $2, $3)",
      [randomUUID(), userId, recoveryHash(code)],
    );
  }
  return codes;
}

export async function resetUserTwoFactor(
  db: Db,
  userId: string,
): Promise<void> {
  await db.query("delete from user_totp_credentials where user_id = $1", [
    userId,
  ]);
  await db.query("delete from user_recovery_codes where user_id = $1", [
    userId,
  ]);
  await db.query("delete from two_factor_continuations where user_id = $1", [
    userId,
  ]);
}

export async function deleteUserTwoFactor(
  db: Db,
  userId: string,
): Promise<void> {
  await resetUserTwoFactor(db, userId);
}

export async function validateTwoFactorStartup(
  db: Db,
  config: ApiConfig,
): Promise<void> {
  const result = await db.query<TotpCredentialRow>(
    "select * from user_totp_credentials order by created_at limit 1",
  );
  const row = result.rows[0];
  if (config.TWO_FACTOR_ENABLED && !config.TWO_FACTOR_ENCRYPTION_KEY) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY is required when 2FA is enabled",
    );
  }
  if (!row) return;
  if (!config.TWO_FACTOR_ENCRYPTION_KEY) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY is required because 2FA credentials exist",
    );
  }
  decryptTwoFactorSecret(config, row.user_id, row.secret_ciphertext);
}
