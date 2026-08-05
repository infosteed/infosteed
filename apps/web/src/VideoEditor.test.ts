// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { clampVideoInspectorWidth } from "./VideoEditor";

describe("video editor layout", () => {
  it("clamps the inspector while reserving preview width", () => {
    expect(clampVideoInspectorWidth(200, 1_920)).toBe(420);
    expect(clampVideoInspectorWidth(900, 1_920)).toBe(820);
    expect(clampVideoInspectorWidth(680, 1_300)).toBe(572);
  });
});
