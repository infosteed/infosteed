// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type {
  VideoEditRecipe,
  VideoEditorState,
  VoiceoverGeneration,
} from "@infosteed/shared";
import {
  captionCuesEqual,
  materializeVideoCaptions,
  parseVideoTimestamp,
  subtractVideoRange,
  videoTimeLabel,
  videoTimestampLabel,
  voiceoverCaptionCues,
} from "./model";

describe("video editor model", () => {
  it("formats time without producing negative labels", () => {
    expect(videoTimeLabel(-100)).toBe("0:00");
    expect(videoTimeLabel(65_900)).toBe("1:05");
  });

  it("formats and parses precise editor timestamps", () => {
    expect(videoTimestampLabel(65_009)).toBe("1:05.009");
    expect(parseVideoTimestamp("1:05")).toBe(65_000);
    expect(parseVideoTimestamp("1:05.2")).toBe(65_200);
    expect(parseVideoTimestamp("1:05.02")).toBe(65_020);
    expect(parseVideoTimestamp("1:05.002")).toBe(65_002);
    expect(parseVideoTimestamp("1:5")).toBeNull();
    expect(parseVideoTimestamp("1:65.000")).toBeNull();
  });

  it("maps generated speech to caption timing and caps it at the source end", () => {
    const generation = {
      cues: [
        {
          id: "one",
          sourceStartMs: 1_000,
          sourceEndMs: 2_000,
          durationMs: 2_500,
          text: "Generated narration",
        },
        {
          id: "two",
          sourceStartMs: 9_000,
          sourceEndMs: 9_500,
          durationMs: 2_000,
          text: "Capped narration",
        },
        {
          id: "three",
          sourceStartMs: 5_000,
          sourceEndMs: 6_500,
          durationMs: null,
          text: "Fallback narration",
        },
      ],
    } as VoiceoverGeneration;
    const captions = voiceoverCaptionCues(generation, 10_000);

    expect(captions.map((cue) => cue.sourceEndMs)).toEqual([
      3_500, 10_000, 6_500,
    ]);
    expect(captionCuesEqual(captions, [...captions])).toBe(true);
    expect(
      captionCuesEqual(captions, [
        ...captions.slice(0, 1),
        { ...captions[1], text: "Changed" },
        captions[2],
      ]),
    ).toBe(false);
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
