// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { configureRuntimeSettings, getSettings } from "./apiClient";

describe("offscreen API configuration", () => {
  it("uses injected settings without accessing chrome.storage", async () => {
    configureRuntimeSettings({
      apiBaseUrl: "http://127.0.0.1:3777",
      webEditorUrl: "http://127.0.0.1:5173",
    });
    await expect(getSettings()).resolves.toEqual({
      apiBaseUrl: "http://127.0.0.1:3777",
      webEditorUrl: "http://127.0.0.1:5173",
    });
  });
});
