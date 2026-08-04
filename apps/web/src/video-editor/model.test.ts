// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { VideoEditRecipe, VideoEditorState } from "@infosteed/shared";
import {
  materializeVideoCaptions,
  subtractVideoRange,
  videoTimeLabel,
} from "./model";

describe("video editor model", () => {
  it("formats time without producing negative labels", () => {
    expect(videoTimeLabel(-100)).toBe("0:00");
    expect(videoTimeLabel(65_900)).toBe("1:05");
  });

  it("removes a source-clock range while retaining viable media", () => {
    const recipe = {
      keepRanges: [{ startMs: 0, endMs: 10_000 }],
    } as VideoEditRecipe;
    expect(subtractVideoRange(recipe, 2_000, 4_000).keepRanges).toEqual([
      { startMs: 0, endMs: 2_000 },
      { startMs: 4_000, endMs: 10_000 },
    ]);
  });

  it("materializes transcript captions without changing source timing", () => {
    const state = {
      transcriptCues: [
        { id: "one", startMs: 100, endMs: 500, text: "Open settings" },
      ],
    } as unknown as VideoEditorState;
    const recipe = { captions: { mode: "transcript" } } as VideoEditRecipe;

    expect(materializeVideoCaptions(state, recipe)).toEqual([
      {
        id: "caption-one-100",
        sourceStartMs: 100,
        sourceEndMs: 500,
        text: "Open settings",
      },
    ]);
  });
});
