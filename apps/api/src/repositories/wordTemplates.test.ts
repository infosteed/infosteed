// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "../db.js";
import { updateWordTemplate } from "./wordTemplates.js";

describe("Word template repository", () => {
  it("does not clear the default when the requested template does not exist", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const result = await updateWordTemplate(
      { query } as unknown as Pool,
      "00000000-0000-4000-8000-000000000099",
      { isDefault: true },
    );

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("for update");
  });
});
