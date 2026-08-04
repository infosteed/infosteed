// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { Recording } from "@infosteed/shared";
import { buildVideoChapters } from "./videoChapters";

function recording(captureMode: Recording["captureMode"]): Recording {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Capture",
    purpose: null,
    audience: null,
    captureMode,
    state: "finalized",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    finalizedAt: "2026-01-01T00:00:00.000Z",
    events: [
      {
        id: "20000000-0000-4000-8000-000000000002",
        ordinal: 1,
        actionType: "click",
        pageTitle: "Page",
        sanitizedUrl: "https://example.com/",
        elementName: "Save",
        videoOffsetMs: 2200,
        metadata: {},
      },
      {
        id: "20000000-0000-4000-8000-000000000001",
        ordinal: 0,
        actionType: "input",
        pageTitle: "Page",
        sanitizedUrl: "https://example.com/",
        labelText: "Name",
        videoOffsetMs: 900,
        metadata: {},
      },
    ],
    steps: [],
    items:
      captureMode === "both"
        ? [
            {
              id: "30000000-0000-4000-8000-000000000001",
              recordingId: "10000000-0000-4000-8000-000000000001",
              eventId: "20000000-0000-4000-8000-000000000002",
              ordinal: 0,
              kind: "step",
              title: "Save your changes",
              body: "Save.",
              imageFilename: null,
              altText: null,
              source: "manual",
              userEdited: true,
            },
          ]
        : [],
  };
}

describe("buildVideoChapters", () => {
  it("creates stable ordered action chapters for Video Only", () => {
    const chapters = buildVideoChapters(recording("video"));
    expect(chapters.map((chapter) => chapter.offsetMs)).toEqual([900, 2200]);
    expect(chapters.map((chapter) => chapter.title)).toEqual([
      "Enter Name",
      "Click Save",
    ]);
    expect(chapters[0].id).toBe("event-20000000-0000-4000-8000-000000000001");
  });

  it("uses transcript-aware title overrides for Video Only", () => {
    const chapters = buildVideoChapters(
      recording("video"),
      new Map([["20000000-0000-4000-8000-000000000001", "Name the new map"]]),
    );
    expect(chapters[0].title).toBe("Name the new map");
  });

  it("uses the edited guide title for synchronized recordings", () => {
    expect(buildVideoChapters(recording("both"))[1]).toMatchObject({
      title: "Save your changes",
      guideItemId: "30000000-0000-4000-8000-000000000001",
    });
  });

  it("returns no chapters for Guide Only", () => {
    expect(buildVideoChapters(recording("guide"))).toEqual([]);
  });
});
