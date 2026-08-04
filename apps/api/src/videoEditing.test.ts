// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  defaultVideoEditRecipe,
  videoMediaHash,
} from "./repositories/videoEditing";

describe("video edit recipes", () => {
  it("creates an original-media recipe with stable action chapters", () => {
    const recipe = defaultVideoEditRecipe(
      10_000,
      [
        {
          id: "event-one",
          eventId: "00000000-0000-4000-8000-000000000001",
          guideItemId: null,
          title: "Open map",
          offsetMs: 2_000,
          ordinal: 0,
        },
      ],
      { webcam: true, screenWidth: 1920, screenHeight: 1080 },
    );
    expect(recipe.keepRanges).toEqual([{ startMs: 0, endMs: 10_000 }]);
    expect(recipe.chapters[0]).toMatchObject({
      title: "Open map",
      sourceOffsetMs: 2_000,
    });
    expect(recipe.webcam.visible).toBe(true);
  });

  it("does not re-encode for caption and chapter metadata changes", () => {
    const original = defaultVideoEditRecipe(10_000, [], { webcam: false });
    const metadataOnly = {
      ...original,
      chapters: [
        {
          id: "custom",
          eventId: null,
          guideItemId: null,
          title: "Intro",
          sourceOffsetMs: 500,
          ordinal: 0,
          hidden: false,
          custom: true,
          titleEdited: true,
          offsetEdited: true,
        },
      ],
      captions: {
        mode: "manual" as const,
        cues: [
          { id: "cue", sourceStartMs: 0, sourceEndMs: 1_000, text: "Hello" },
        ],
      },
    };
    expect(videoMediaHash(metadataOnly)).toBe(videoMediaHash(original));
  });

  it("includes voiceover identity, enablement, and gain in the media hash", () => {
    const original = defaultVideoEditRecipe(10_000, [], { webcam: false });
    const voiced = {
      ...original,
      audio: { ...original.audio, voiceoverGain: 0.8 },
      voiceover: {
        enabled: true,
        assetId: "00000000-0000-4000-8000-000000000010",
        generationId: "00000000-0000-4000-8000-000000000011",
      },
    };
    expect(videoMediaHash(voiced)).not.toBe(videoMediaHash(original));
  });
});
