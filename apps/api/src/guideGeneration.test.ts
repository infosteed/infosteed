// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Recording } from "@infosteed/shared";
import { writeGuideOverview, writeStep } from "@infosteed/ai-step-writer";
import { cleanupGuideEvents } from "./guideCleanup.js";
import {
  generateGuideSteps,
  generateGuideStepsForCaptureSession,
} from "./guideGeneration.js";
import {
  originalScreenshotsByEvent,
  screenshotsByEvent,
  updateRecordingSummary,
  upsertGeneratedStep,
} from "./repositories/recordings.js";

vi.mock("./repositories/recordings.js", () => ({
  originalScreenshotsByEvent: vi.fn(),
  screenshotsByEvent: vi.fn(),
  updateRecordingSummary: vi.fn(),
  upsertGeneratedStep: vi.fn(),
}));

vi.mock("./guideCleanup.js", () => ({
  cleanupGuideEvents: vi.fn(),
}));

vi.mock("@infosteed/ai-step-writer", () => ({
  writeGuideOverview: vi.fn((provider: any, context: any) =>
    provider?.generateOverview
      ? provider.generateOverview(context).then((generated: object) => ({
          ...generated,
          source: "ai",
        }))
      : Promise.resolve({
          title: context.currentTitle,
          overview: "Follow this guide to complete the recorded workflow.",
          source: "deterministic",
        }),
  ),
  writeStep: vi.fn((provider: any, context: any) =>
    provider?.generateStep
      ? provider.generateStep(context).then((generated: object) => ({
          ...generated,
          source: "ai",
        }))
      : Promise.resolve({
          title: "Click Update",
          instruction: "Click **Update**.",
          altText: "Update on Record Dashboard | Azimap",
          source: "deterministic",
        }),
  ),
}));

const event = {
  id: "20000000-0000-4000-8000-000000000001",
  ordinal: 0,
  actionType: "click" as const,
  pageTitle: "Record Dashboard | Azimap",
  sanitizedUrl: "https://example.com/map",
  elementName: "Update",
  elementRole: "button",
  nearbyHeading: "Update Attributes",
  metadata: {},
};

const repeatedEvent = {
  ...event,
  id: "20000000-0000-4000-8000-000000000002",
  ordinal: 1,
};

function recording(patch: Partial<Recording> = {}): Recording {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    title: "Record Dashboard | Azimap",
    purpose: null,
    audience: null,
    captureMode: "guide",
    state: "finalized",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    finalizedAt: "2026-01-01T00:00:00.000Z",
    events: [event],
    steps: [],
    items: [],
    ...patch,
  };
}

describe("guide generation summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(screenshotsByEvent).mockResolvedValue(new Map());
    vi.mocked(originalScreenshotsByEvent).mockResolvedValue(new Map());
    vi.mocked(cleanupGuideEvents).mockImplementation(async ({ events }) => ({
      events,
      excludedEventIds: new Set(),
      stats: { candidates: 0, collapsed: 0, vetoed: 0, fallbacks: 0 },
    }));
    vi.mocked(upsertGeneratedStep).mockResolvedValue({
      id: "30000000-0000-4000-8000-000000000001",
      recordingId: "10000000-0000-4000-8000-000000000001",
      eventId: event.id,
      ordinal: 0,
      title: "Update attributes",
      instruction: "Click Update to save the attribute changes.",
      imageFilename: null,
      altText: "Update button in the attributes form",
      source: "ai",
      userEdited: false,
    });
    vi.mocked(updateRecordingSummary).mockResolvedValue(null);
  });

  it("stores generated title and overview during initial guide generation", async () => {
    await generateGuideSteps(
      { query: vi.fn() } as never,
      recording(),
      {
        async generateStep() {
          return {
            actionType: "click",
            elementName: "Update",
            elementRole: "button",
            title: "Update attributes",
            instruction: "Click Update to save the attribute changes.",
            altText: "Update button in the attributes form",
          };
        },
        async generateOverview() {
          return {
            title: "Update Business Attributes",
            overview: "Update a selected map feature's business attributes.",
          };
        },
      },
      false,
      [],
      "en",
      "overwrite",
    );

    expect(updateRecordingSummary).toHaveBeenCalledWith(
      expect.anything(),
      "10000000-0000-4000-8000-000000000001",
      {
        title: "Update Business Attributes",
        purpose: "Update a selected map feature's business attributes.",
      },
    );
  });

  it("preserves existing title and overview in fill mode", async () => {
    await generateGuideSteps(
      { query: vi.fn() } as never,
      recording({
        title: "Edited title",
        purpose: "Edited overview",
      }),
      undefined,
      false,
      [],
      "en",
      "fill",
    );

    expect(updateRecordingSummary).not.toHaveBeenCalled();
    expect(cleanupGuideEvents).not.toHaveBeenCalled();
  });

  it("uses the cleaned sequence for steps, neighbors, and overview context", async () => {
    const finalEvent = {
      ...event,
      id: "20000000-0000-4000-8000-000000000003",
      ordinal: 2,
      elementName: "Publish",
    };
    vi.mocked(cleanupGuideEvents).mockResolvedValue({
      events: [repeatedEvent, finalEvent],
      excludedEventIds: new Set([event.id]),
      stats: { candidates: 1, collapsed: 1, vetoed: 0, fallbacks: 1 },
    });

    await generateGuideSteps(
      { query: vi.fn() } as never,
      recording({ events: [event, repeatedEvent, finalEvent] }),
      undefined,
      false,
      [],
      "en",
      "overwrite",
      { cleanupMode: "new-capture-cleanup" },
    );

    expect(cleanupGuideEvents).toHaveBeenCalledTimes(1);
    expect(upsertGeneratedStep).toHaveBeenCalledTimes(2);
    expect(upsertGeneratedStep).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ eventId: repeatedEvent.id, ordinal: 0 }),
    );
    expect(vi.mocked(writeStep).mock.calls[0]?.[1]).toMatchObject({
      current: repeatedEvent,
      previous: undefined,
      next: finalEvent,
    });
    expect(vi.mocked(writeGuideOverview).mock.calls.at(-1)?.[1].events).toEqual(
      [
        expect.objectContaining({ elementName: "Update" }),
        expect.objectContaining({ elementName: "Publish" }),
      ],
    );
  });

  it("cleans only the newly appended capture session", async () => {
    const sessionId = "40000000-0000-4000-8000-000000000001";
    const existing = event;
    const firstSessionEvent = {
      ...repeatedEvent,
      captureSessionId: sessionId,
    };
    const keptSessionEvent = {
      ...repeatedEvent,
      id: "20000000-0000-4000-8000-000000000004",
      ordinal: 2,
      captureSessionId: sessionId,
    };
    vi.mocked(cleanupGuideEvents).mockResolvedValue({
      events: [keptSessionEvent],
      excludedEventIds: new Set([firstSessionEvent.id]),
      stats: { candidates: 1, collapsed: 1, vetoed: 0, fallbacks: 1 },
    });

    await generateGuideStepsForCaptureSession(
      { query: vi.fn() } as never,
      recording({ events: [existing, firstSessionEvent, keptSessionEvent] }),
      sessionId,
      undefined,
      [],
      "en",
      "fill",
      { cleanupMode: "new-capture-cleanup" },
    );

    expect(vi.mocked(cleanupGuideEvents).mock.calls[0]?.[0].events).toEqual([
      firstSessionEvent,
      keptSessionEvent,
    ]);
    expect(upsertGeneratedStep).toHaveBeenCalledTimes(1);
    expect(upsertGeneratedStep).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: keptSessionEvent.id }),
    );
    expect(vi.mocked(writeStep).mock.calls[0]?.[1].previous).toEqual(existing);
  });
});
