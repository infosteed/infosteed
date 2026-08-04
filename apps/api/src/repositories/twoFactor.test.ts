// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { readConfig } from "../config";
import type { Pool } from "../db";
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  validateTwoFactorStartup,
} from "./twoFactor";

const userId = "00000000-0000-4000-8000-000000000001";
const goodKey =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const wrongKey =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

function poolWithCredential(secretCiphertext?: string): Pool {
  return {
    async query() {
      return secretCiphertext
        ? {
            rows: [
              {
                user_id: userId,
                secret_ciphertext: secretCiphertext,
                last_accepted_counter: null,
              },
            ],
          }
        : { rows: [] };
    },
  } as unknown as Pool;
}

describe("two-factor secret encryption", () => {
  it("round-trips secrets with user-bound authenticated encryption", () => {
    const config = readConfig({ TWO_FACTOR_ENCRYPTION_KEY: goodKey });
    const ciphertext = encryptTwoFactorSecret(config, userId, "BASE32SECRET");

    expect(decryptTwoFactorSecret(config, userId, ciphertext)).toBe(
      "BASE32SECRET",
    );
    expect(() =>
      decryptTwoFactorSecret(
        config,
        "00000000-0000-4000-8000-000000000002",
        ciphertext,
      ),
    ).toThrow();
  });

  it("rejects tampered ciphertext and wrong startup keys", async () => {
    const config = readConfig({ TWO_FACTOR_ENCRYPTION_KEY: goodKey });
    const ciphertext = encryptTwoFactorSecret(config, userId, "BASE32SECRET");
    const tampered = ciphertext.replace(
      /.$/,
      ciphertext.endsWith("A") ? "B" : "A",
    );

    expect(() => decryptTwoFactorSecret(config, userId, tampered)).toThrow();
    await expect(
      validateTwoFactorStartup(
        poolWithCredential(ciphertext),
        readConfig({ TWO_FACTOR_ENCRYPTION_KEY: wrongKey }),
      ),
    ).rejects.toThrow();
  });

  it("fails startup when credentials exist without a configured key", async () => {
    const config = readConfig({ TWO_FACTOR_ENCRYPTION_KEY: goodKey });
    const ciphertext = encryptTwoFactorSecret(config, userId, "BASE32SECRET");

    await expect(
      validateTwoFactorStartup(poolWithCredential(ciphertext), readConfig({})),
    ).rejects.toThrow(/required/);
  });
});
