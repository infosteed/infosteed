// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "../db";
import { csrfTokenForSession, issueCsrfToken, verifyCsrfToken } from "./auth";

function sessionPool(active: boolean): Pool {
  return {
    query: vi.fn().mockResolvedValue({
      rows: active ? [{ active: true }] : [],
    }),
  } as unknown as Pool;
}

describe("session CSRF tokens", () => {
  it("issues one stable token for each session", async () => {
    const pool = sessionPool(true);

    const first = await issueCsrfToken(pool, "session-a");
    const second = await issueCsrfToken(pool, "session-a");

    expect(first).toBe(second);
    expect(first).not.toBe(await issueCsrfToken(pool, "session-b"));
  });

  it("accepts only the matching token for a live session", async () => {
    const pool = sessionPool(true);
    const token = csrfTokenForSession("session-a");

    await expect(verifyCsrfToken(pool, "session-a", token)).resolves.toBe(true);
    await expect(verifyCsrfToken(pool, "session-a", undefined)).resolves.toBe(
      false,
    );
    await expect(
      verifyCsrfToken(pool, "session-a", "incorrect-token"),
    ).resolves.toBe(false);
    await expect(
      verifyCsrfToken(pool, "session-a", "é".repeat(token.length)),
    ).resolves.toBe(false);
    await expect(verifyCsrfToken(pool, "session-b", token)).resolves.toBe(
      false,
    );
  });

  it("rejects tokens after their session expires", async () => {
    await expect(
      verifyCsrfToken(
        sessionPool(false),
        "expired-session",
        csrfTokenForSession("expired-session"),
      ),
    ).resolves.toBe(false);
  });
});
