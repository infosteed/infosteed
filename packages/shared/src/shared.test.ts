// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  createRecordingRequestSchema,
  currentUserSchema,
  finalizeVideoRequestSchema,
  guideItemSchema,
  initializeVideoRequestSchema,
  outputLocaleRequestSchema,
  recordingProjectSchema,
  uploadScreenshotRequestSchema,
  updateOwnPreferencesRequestSchema,
  recordingEventSchema,
  videoEditRecipeSchema,
  videoEditedDurationMs,
  videoMp4ExportSchema,
  videoOutputToSourceMs,
  videoRecipeCaptions,
  videoRecipeChapters,
  videoSourceToOutputMs,
} from "./index";

describe("shared schemas", () => {
  it("validates AI output locales with an English compatibility default", () => {
    expect(outputLocaleRequestSchema.parse(undefined)).toEqual({
      outputLocale: "en",
    });
    expect(outputLocaleRequestSchema.parse({ outputLocale: "ga" })).toEqual({
      outputLocale: "ga",
    });
    expect(() =>
      outputLocaleRequestSchema.parse({ outputLocale: "es" }),
    ).toThrow();
  });

  it("defaults account appearance to system and validates updates", () => {
    const user = currentUserSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      username: "owner",
      displayName: "Recording Owner",
      role: "admin",
      enabled: true,
    });
    expect(user.themePreference).toBe("system");
    expect(
      updateOwnPreferencesRequestSchema.parse({ themePreference: "dark" }),
    ).toEqual({ themePreference: "dark" });
    expect(() =>
      updateOwnPreferencesRequestSchema.parse({ themePreference: "midnight" }),
    ).toThrow();
  });

  it("validates sanitized event payloads", () => {
    const parsed = recordingEventSchema.parse({
      actionType: "click",
      pageTitle: "Demo",
      sanitizedUrl: "https://example.com/demo",
      elementName: "Login",
    });

    expect(parsed.metadata).toEqual({});
  });

  it("rejects unsupported screenshot content types", () => {
    expect(() =>
      uploadScreenshotRequestSchema.parse({
        eventId: "00000000-0000-4000-8000-000000000001",
        filename: "step-001.webp",
        contentType: "image/gif",
        imageBase64: "abc",
      }),
    ).toThrow();
  });

  it("validates guide item block types", () => {
    for (const kind of ["step", "tip", "alert", "header"] as const) {
      expect(
        guideItemSchema.parse({
          id: "00000000-0000-4000-8000-000000000001",
          recordingId: "00000000-0000-4000-8000-000000000002",
          eventId: null,
          ordinal: 0,
          kind,
          title: "Title",
          body: "Body",
          imageFilename: null,
          altText: null,
          source: "manual",
          userEdited: true,
        }).kind,
      ).toBe(kind);
    }
  });

  it("accepts v1 and v2 project files", () => {
    const recording = {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Guide",
      purpose: null,
      audience: null,
      state: "finalized",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      finalizedAt: null,
      events: [],
      steps: [],
      items: [],
    };

    expect(
      recordingProjectSchema.parse({ version: 1, recording, screenshots: [] })
        .version,
    ).toBe(1);
    expect(
      recordingProjectSchema.parse({
        version: 2,
        recording,
        items: [],
        screenshots: [],
      }).version,
    ).toBe(2);
  });

  it("keeps existing recording clients guide-only while accepting all explicit modes", () => {
    expect(
      createRecordingRequestSchema.parse({ title: "Legacy" }).captureMode,
    ).toBe("guide");
    for (const captureMode of ["guide", "video", "both"] as const) {
      expect(
        createRecordingRequestSchema.parse({ title: "Recording", captureMode })
          .captureMode,
      ).toBe(captureMode);
    }
    expect(() =>
      createRecordingRequestSchema.parse({
        title: "Recording",
        captureMode: "invalid",
      }),
    ).toThrow();
  });

  it("validates timed actions and multipart video contracts", () => {
    expect(
      recordingEventSchema.parse({
        actionType: "click",
        pageTitle: "Demo",
        sanitizedUrl: "https://example.test",
        videoOffsetMs: 1234,
      }).videoOffsetMs,
    ).toBe(1234);
    expect(() =>
      recordingEventSchema.parse({
        actionType: "click",
        pageTitle: "Demo",
        sanitizedUrl: "https://example.test",
        videoOffsetMs: -1,
      }),
    ).toThrow();

    const initialized = initializeVideoRequestSchema.parse({
      captureSettings: {},
      assets: [
        { kind: "composite", mimeType: "video/webm" },
        { kind: "screen", mimeType: "video/webm" },
        { kind: "transcription", mimeType: "audio/webm", codec: "opus" },
      ],
    });
    expect(initialized.captureSettings).toMatchObject({
      tabAudio: true,
      microphone: true,
      webcam: false,
      frameRate: 30,
    });
    expect(() =>
      initializeVideoRequestSchema.parse({
        captureSettings: {},
        assets: [
          { kind: "screen", mimeType: "video/webm" },
          { kind: "microphone", mimeType: "audio/webm" },
        ],
      }),
    ).toThrow(/Composite/);
    expect(() =>
      initializeVideoRequestSchema.parse({
        captureSettings: {},
        assets: [
          { kind: "composite", mimeType: "video/webm" },
          { kind: "microphone", mimeType: "audio/webm" },
        ],
      }),
    ).toThrow(/Clean screen/);
    expect(
      finalizeVideoRequestSchema.parse({
        durationMs: 60_000,
        assets: [{ assetId: "00000000-0000-4000-8000-000000000001" }],
      }).recovered,
    ).toBe(false);
  });

  it("maps source media through non-destructive keep ranges", () => {
    const recipe = videoEditRecipeSchema.parse({
      version: 1,
      sourceDurationMs: 20_000,
      keepRanges: [
        { startMs: 1_000, endMs: 5_000 },
        { startMs: 8_000, endMs: 16_000 },
      ],
      webcam: { visible: false, centerX: 0.8, centerY: 0.8, diameter: 0.2 },
      audio: { tabGain: 1, microphoneGain: 0.75 },
      chapters: [
        {
          id: "one",
          eventId: null,
          guideItemId: null,
          title: "Kept",
          sourceOffsetMs: 3_000,
          ordinal: 0,
          custom: true,
        },
        {
          id: "two",
          eventId: null,
          guideItemId: null,
          title: "Cut",
          sourceOffsetMs: 6_000,
          ordinal: 1,
          hidden: false,
          custom: false,
        },
      ],
      captions: { mode: "transcript" },
    });
    expect(videoEditedDurationMs(recipe)).toBe(12_000);
    expect(videoSourceToOutputMs(recipe, 9_000)).toBe(5_000);
    expect(videoSourceToOutputMs(recipe, 6_000)).toBeNull();
    expect(videoOutputToSourceMs(recipe, 5_000)).toBe(9_000);
    expect(videoRecipeChapters(recipe).map((chapter) => chapter.title)).toEqual(
      ["Kept"],
    );
  });

  it("splits and retimes captions around cuts", () => {
    const recipe = videoEditRecipeSchema.parse({
      version: 1,
      sourceDurationMs: 10_000,
      keepRanges: [
        { startMs: 0, endMs: 3_000 },
        { startMs: 5_000, endMs: 9_000 },
      ],
      webcam: { visible: false, centerX: 0.8, centerY: 0.8, diameter: 0.2 },
      audio: { tabGain: 1, microphoneGain: 1 },
      chapters: [],
      captions: { mode: "transcript" },
    });
    expect(
      videoRecipeCaptions(recipe, [
        { id: 0, startMs: 2_000, endMs: 6_000, text: "Across cut" },
      ]),
    ).toEqual([
      { id: 0, startMs: 2_000, endMs: 3_000, text: "Across cut" },
      { id: 1, startMs: 3_000, endMs: 4_000, text: "Across cut" },
    ]);
  });

  it("rejects overlapping ranges and invalid webcam coordinates", () => {
    const base = {
      version: 1,
      sourceDurationMs: 10_000,
      keepRanges: [
        { startMs: 0, endMs: 6_000 },
        { startMs: 5_000, endMs: 9_000 },
      ],
      webcam: { visible: true, centerX: 1.01, centerY: 0.8, diameter: 0.2 },
      audio: { tabGain: 1, microphoneGain: 1 },
      chapters: [],
      captions: { mode: "transcript" },
    };
    expect(() => videoEditRecipeSchema.parse(base)).toThrow();
  });

  it("validates the public MP4 export progress contract", () => {
    expect(
      videoMp4ExportSchema.parse({
        id: "00000000-0000-4000-8000-000000000010",
        renderId: "00000000-0000-4000-8000-000000000020",
        status: "processing",
        progress: 0.5,
        byteSize: 0,
        errorMessage: null,
        createdAt: "2026-08-04T10:00:00.000Z",
        completedAt: null,
      }).status,
    ).toBe("processing");
    expect(() =>
      videoMp4ExportSchema.parse({
        id: "00000000-0000-4000-8000-000000000010",
        renderId: "00000000-0000-4000-8000-000000000020",
        status: "uploading",
        progress: 2,
        byteSize: 0,
        errorMessage: null,
        createdAt: "2026-08-04T10:00:00.000Z",
        completedAt: null,
      }),
    ).toThrow();
  });
});
