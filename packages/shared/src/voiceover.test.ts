// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createVoiceoverRequestSchema, videoEditRecipeSchema } from "./index";

describe("voiceover schemas", () => {
  it("keeps legacy version-one edit recipes compatible", () => {
    const recipe = videoEditRecipeSchema.parse({
      version: 1,
      sourceDurationMs: 10_000,
      keepRanges: [{ startMs: 0, endMs: 10_000 }],
      webcam: { visible: false, centerX: 0.5, centerY: 0.5, diameter: 0.2 },
      audio: { tabGain: 1, microphoneGain: 1 },
      chapters: [],
      captions: { mode: "transcript" },
    });
    expect(recipe.audio.voiceoverGain).toBe(1);
    expect(recipe.voiceover).toEqual({
      enabled: false,
      assetId: null,
      generationId: null,
    });
  });

  it("validates bounded stock-voice generation input", () => {
    expect(
      createVoiceoverRequestSchema.parse({
        voice: "af_heart",
        speed: 1.1,
        cues: [
          {
            id: "cue-1",
            sourceStartMs: 100,
            sourceEndMs: 2_000,
            text: "Welcome.",
          },
        ],
      }).speed,
    ).toBe(1.1);
    expect(() =>
      createVoiceoverRequestSchema.parse({
        voice: "af_heart",
        speed: 4,
        cues: [
          {
            id: "cue-1",
            sourceStartMs: 100,
            sourceEndMs: 2_000,
            text: "Welcome.",
          },
        ],
      }),
    ).toThrow();
  });
});
