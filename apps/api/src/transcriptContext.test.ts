// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  buildTranscriptCues,
  buildTranscriptionPrompt,
  transcriptAround,
  transcriptToWebVtt,
} from "./transcriptContext";
import type { Recording } from "@infosteed/shared";

const recording = {
  title: "Northstar Product Catalogue",
  purpose: "Show the Northstar product catalogue",
  audience: "GIS editors",
  events: [
    {
      pageTitle: "Northstar Outfitters",
      labelText: "Product catalogue",
      nearbyHeading: "Trail Lantern",
    },
  ],
} as Recording;

describe("transcript context", () => {
  it("deduplicates product context for the standard prompt", () => {
    expect(buildTranscriptionPrompt(recording)).toBe(
      "Northstar Product Catalogue, Show the Northstar product catalogue, GIS editors, Northstar Outfitters, Product catalogue, Trail Lantern",
    );
  });

  it("selects narration around an action", () => {
    expect(
      transcriptAround(
        [
          { id: 0, startMs: 0, endMs: 1_000, text: "Open the map" },
          { id: 1, startMs: 2_000, endMs: 3_000, text: "Choose this point" },
        ],
        1_500,
      ),
    ).toEqual({
      transcriptBefore: "Open the map",
      transcriptAfter: "Choose this point",
    });
  });

  it("writes valid WebVTT cues", () => {
    expect(
      transcriptToWebVtt([
        { id: 0, startMs: 1_250, endMs: 3_500, text: "Open the map" },
      ]),
    ).toBe("WEBVTT\n\n1\n00:00:01.250 --> 00:00:03.500\nOpen the map\n");
  });

  it("splits coarse Whisper segments into pause-delimited word cues", () => {
    const cues = buildTranscriptCues(
      [
        {
          id: 1,
          startMs: 3280,
          endMs: 19820,
          text: "View map, Click Point, Click Point",
        },
      ],
      [
        { text: "View", startMs: 3280, endMs: 4160, probability: 0.72 },
        { text: "map,", startMs: 4160, endMs: 4480, probability: 0.36 },
        { text: "Click", startMs: 8120, endMs: 8280, probability: 0.12 },
        { text: "Point,", startMs: 8280, endMs: 8740, probability: 0.49 },
        { text: "Click", startMs: 13680, endMs: 17960, probability: 0.9 },
        { text: "Point", startMs: 19400, endMs: 19820, probability: 0.94 },
      ],
    );
    expect(cues).toEqual([
      { id: 0, startMs: 3280, endMs: 4480, text: "View map," },
      { id: 1, startMs: 8120, endMs: 8740, text: "Click Point," },
      { id: 2, startMs: 17160, endMs: 19820, text: "Click Point" },
    ]);
    expect(transcriptAround(cues, 4876)).toEqual({
      transcriptBefore: "View map,",
      transcriptAfter: undefined,
    });
    expect(transcriptAround(cues, 18587)).toEqual({
      transcriptBefore: "Click Point",
      transcriptAfter: undefined,
    });
  });
});
