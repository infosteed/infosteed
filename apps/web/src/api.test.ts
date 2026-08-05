// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { wiziwigExportUrl } from "./api";

describe("web API URLs", () => {
  it("builds the Wiziwig export URL", () => {
    expect(wiziwigExportUrl("recording-id")).toBe(
      "/api/recordings/recording-id/export/wiziwig",
    );
  });
});
