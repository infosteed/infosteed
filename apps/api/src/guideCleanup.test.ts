// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recording } from "@infosteed/shared";
import { compareScreenshots } from "@infosteed/image-processor";
import { cleanupGuideEvents } from "./guideCleanup.js";

vi.mock("@infosteed/image-processor", () => ({
  compareScreenshots: vi.fn(),
  prepareAiScreenshotDataUrl: vi.fn(
    async () => "data:image/png;base64,dGVzdA==",
  ),
}));

type Event = Recording["events"][number];

function click(ordinal: number, patch: Partial<Event> = {}): Event {
  return {
    id: `00000000-0000-4000-8000-${String(ordinal + 1).padStart(12, "0")}`,
    ordinal,
    captureSessionId: null,
    actionType: "click",
    pageTitle: "App",
    sanitizedUrl: "https://example.test/app",
    elementName: "Save",
    elementRole: "button",
    labelText: "Save",
    boundingBox: {
      x: 100,
      y: 50,
      width: 80,
      height: 32,
      devicePixelRatio: 1,
      scrollX: 0,
      scrollY: 0,
    },
    metadata: {
      capture: {
        timestampMs: 1_000 + ordinal * 500,
        clickPoint: {
          x: 140,
          y: 66,
          viewportWidth: 1280,
          viewportHeight: 720,
        },
      },
    },
    ...patch,
  };
}

function screenshots(events: Event[]) {
  return new Map(
    events.map((event, index) => [event.id, Buffer.from([index])]),
  );
}

describe("guide cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(compareScreenshots).mockResolvedValue({
      dimensionsMatch: true,
      meanDifference: 0,
      changedPixelRatio: 0,
    });
  });

  it("collapses an unchanged retry run toward the final click", async () => {
    const events = [click(0), click(1), click(2)];
    const result = await cleanupGuideEvents({
      events,
      screenshots: screenshots(events),
    });

    expect(result.events.map((event) => event.id)).toEqual([events[2].id]);
    expect(result.stats).toEqual({
      candidates: 2,
      collapsed: 2,
      vetoed: 0,
      fallbacks: 2,
    });
  });

  it("requires the bot to agree when a cleanup classifier is available", async () => {
    const events = [click(0), click(1), click(2)];
    const classifyGuideCleanup = vi
      .fn()
      .mockResolvedValueOnce({
        decision: "collapse",
        confidence: 0.95,
        reason: "retry",
      })
      .mockResolvedValueOnce({
        decision: "keep",
        confidence: 0.99,
        reason: "cumulative control",
      });
    const result = await cleanupGuideEvents({
      events,
      screenshots: screenshots(events),
      provider: {
        generateStep: vi.fn(),
        classifyGuideCleanup,
      },
    });

    expect(result.events.map((event) => event.id)).toEqual([
      events[1].id,
      events[2].id,
    ]);
    expect(result.stats).toMatchObject({ collapsed: 1, vetoed: 1 });
    expect(classifyGuideCleanup).toHaveBeenCalledTimes(2);
  });

  it("uses deterministic cleanup when the bot fails", async () => {
    const events = [click(0), click(1)];
    const result = await cleanupGuideEvents({
      events,
      screenshots: screenshots(events),
      provider: {
        generateStep: vi.fn(),
        classifyGuideCleanup: vi.fn().mockRejectedValue(new Error("timeout")),
      },
    });

    expect(result.events).toEqual([events[1]]);
    expect(result.stats).toMatchObject({ collapsed: 1, fallbacks: 1 });
  });

  it.each([
    { decision: "uncertain" as const, confidence: 0.99 },
    { decision: "collapse" as const, confidence: 0.79 },
  ])(
    "preserves candidates for $decision bot results",
    async (classification) => {
      const events = [click(0), click(1)];
      const result = await cleanupGuideEvents({
        events,
        screenshots: screenshots(events),
        provider: {
          generateStep: vi.fn(),
          classifyGuideCleanup: vi.fn().mockResolvedValue({
            ...classification,
            reason: "Not confident enough",
          }),
        },
      });

      expect(result.events).toEqual(events);
      expect(result.stats).toMatchObject({ collapsed: 0, vetoed: 1 });
    },
  );

  it("uses deterministic cleanup for malformed bot output", async () => {
    const events = [click(0), click(1)];
    const result = await cleanupGuideEvents({
      events,
      screenshots: screenshots(events),
      provider: {
        generateStep: vi.fn(),
        classifyGuideCleanup: vi.fn().mockResolvedValue({
          decision: "delete",
          confidence: 4,
          reason: "invalid",
        }),
      } as never,
    });

    expect(result.events).toEqual([events[1]]);
    expect(result.stats).toMatchObject({ collapsed: 1, fallbacks: 1 });
  });

  it("preserves intentional repeats when the screenshot changes", async () => {
    vi.mocked(compareScreenshots).mockResolvedValue({
      dimensionsMatch: true,
      meanDifference: 0.02,
      changedPixelRatio: 0.02,
    });
    const events = [click(0), click(1)];
    const result = await cleanupGuideEvents({
      events,
      screenshots: screenshots(events),
    });

    expect(result.events).toEqual(events);
    expect(result.stats.candidates).toBe(0);
  });

  it.each([
    ["URL", { sanitizedUrl: "https://example.test/other" }],
    ["target", { elementName: "Cancel", labelText: "Cancel" }],
    ["role", { elementRole: "link" }],
    ["session", { captureSessionId: "10000000-0000-4000-8000-000000000001" }],
    [
      "timing",
      {
        metadata: {
          capture: {
            timestampMs: 10_000,
            clickPoint: {
              x: 140,
              y: 66,
              viewportWidth: 1280,
              viewportHeight: 720,
            },
          },
        },
      },
    ],
    [
      "position",
      {
        boundingBox: {
          x: 500,
          y: 300,
          width: 80,
          height: 32,
          devicePixelRatio: 1,
          scrollX: 0,
          scrollY: 0,
        },
        metadata: {
          capture: {
            timestampMs: 1_500,
            clickPoint: {
              x: 540,
              y: 316,
              viewportWidth: 1280,
              viewportHeight: 720,
            },
          },
        },
      },
    ],
  ])("preserves clicks with different %s evidence", async (_name, patch) => {
    const events = [click(0), click(1, patch as Partial<Event>)];
    const result = await cleanupGuideEvents({
      events,
      screenshots: screenshots(events),
    });
    expect(result.events).toEqual(events);
  });

  it("preserves candidates without timestamps or screenshots", async () => {
    const withoutTimestamp = click(0, { metadata: {} });
    const next = click(1);
    expect(
      (
        await cleanupGuideEvents({
          events: [withoutTimestamp, next],
          screenshots: screenshots([withoutTimestamp, next]),
        })
      ).events,
    ).toHaveLength(2);
    expect(
      (
        await cleanupGuideEvents({
          events: [click(0), next],
          screenshots: new Map(),
        })
      ).events,
    ).toHaveLength(2);
  });
});
