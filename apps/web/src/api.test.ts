// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { deleteUser, imageExportUrl, wiziwigExportUrl } from "./api";

describe("web API URLs", () => {
  it("builds the Wiziwig export URL", () => {
    expect(wiziwigExportUrl("recording-id")).toBe(
      "/api/recordings/recording-id/export/wiziwig",
    );
  });

  it("builds image export URLs with the requested format", () => {
    expect(imageExportUrl("recording-id", "png")).toBe(
      "/api/recordings/recording-id/export/images?format=png",
    );
    expect(imageExportUrl("recording-id", "jpg")).toBe(
      "/api/recordings/recording-id/export/images?format=jpg",
    );
  });

  it("deletes users through the admin API", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/auth/csrf")
        return Promise.resolve(
          new Response(JSON.stringify({ csrfToken: "csrf-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;
    try {
      await deleteUser("user-id");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls.at(-1)).toMatchObject({
      url: "/api/users/user-id",
      init: {
        method: "DELETE",
      },
    });
  });
});
