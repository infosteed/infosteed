// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  ActiveRecordingClock,
  chooseVideoMimeType,
  chooseTranscriptionAudioSource,
  inputCategoryFor,
  isSensitiveField,
  normalizeRawEvents,
  sanitizeUrl,
  shouldAutoPauseUpload,
  TRANSCRIPTION_AUDIO_BITS_PER_SECOND,
} from "./index";

describe("recorder core privacy and normalization", () => {
  it("removes credentials, query strings, and hashes from URLs", () => {
    expect(
      sanitizeUrl("https://user:pass@example.com/path?token=secret#frag"),
    ).toBe("https://example.com/path");
  });

  it("detects sensitive password and token fields", () => {
    expect(isSensitiveField({ type: "password", labelText: "Password" })).toBe(
      true,
    );
    expect(isSensitiveField({ labelText: "API key" })).toBe(true);
  });

  it("uses placeholders for ordinary and username inputs", () => {
    expect(inputCategoryFor({ labelText: "Username" })).toBe("<username>");
    expect(inputCategoryFor({ labelText: "Reference" })).toBe(
      "<reference number>",
    );
    expect(inputCategoryFor({ labelText: "Display name" })).toBe("<value>");
  });

  it("deduplicates repeated clicks into one meaningful event", () => {
    const events = normalizeRawEvents([
      {
        actionType: "click",
        timestamp: 1,
        pageTitle: "Login",
        url: "https://example.com/login?x=1",
        element: { tagName: "button", text: "Login" },
      },
      {
        actionType: "click",
        timestamp: 2,
        pageTitle: "Login",
        url: "https://example.com/login?x=2",
        element: { tagName: "button", text: "Login" },
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0].elementName).toBe("Login");
  });

  it("drops noisy page chrome text as an accessible name", () => {
    const [event] = normalizeRawEvents([
      {
        actionType: "click",
        timestamp: 1,
        pageTitle: "Datasets",
        url: "https://example.com/datasets",
        element: {
          tagName: "div",
          text: "Datasets 488 items Filters Previous Page 1 of 41 Next 12 24 48 96 All 12 Updated Name ID",
        },
      },
    ]);

    expect(event.elementName).toBeUndefined();
    expect(event.elementRole).toBe("div");
  });

  it("preserves a canvas click's normalized position", () => {
    const [event] = normalizeRawEvents([
      {
        actionType: "click",
        timestamp: 1,
        pageTitle: "Map",
        url: "https://example.com/map",
        element: { tagName: "canvas" },
        canvasPosition: {
          xRatio: 0.72,
          yRatio: 0.25,
          region: "upper-right area",
        },
      },
    ]);

    expect(event.metadata?.canvasPosition).toEqual({
      xRatio: 0.72,
      yRatio: 0.25,
      region: "upper-right area",
    });
  });

  it("does not retain typed values", () => {
    const [event] = normalizeRawEvents([
      {
        actionType: "input",
        timestamp: 1,
        pageTitle: "Login",
        url: "https://example.com/login",
        element: { tagName: "input", labelText: "Username" },
        value: "private@example.com",
      },
    ]);

    expect(JSON.stringify(event)).not.toContain("private@example.com");
    expect(event.inputCategory).toBe("<username>");
  });

  it("excludes paused time from video chapter offsets", () => {
    let now = 100;
    const clock = new ActiveRecordingClock(() => now);
    clock.start();
    now = 1100;
    expect(clock.elapsed()).toBe(1000);
    clock.pause();
    now = 5100;
    expect(clock.elapsed()).toBe(1000);
    clock.resume();
    now = 6100;
    expect(clock.elapsed()).toBe(2000);
  });

  it("selects codec fallback and detects upload pressure", () => {
    expect(chooseVideoMimeType((mime) => mime.includes("vp8"))).toContain(
      "vp8",
    );
    expect(chooseVideoMimeType(() => false)).toBe("video/webm");
    expect(shouldAutoPauseUpload(127, 128)).toBe(false);
    expect(shouldAutoPauseUpload(128, 128)).toBe(true);
  });

  it("prefers narration and keeps a one-hour transcription asset below 25 MB", () => {
    expect(chooseTranscriptionAudioSource(true, true)).toBe("microphone");
    expect(chooseTranscriptionAudioSource(false, true)).toBe("tab");
    expect(chooseTranscriptionAudioSource(false, false)).toBe("none");
    expect((TRANSCRIPTION_AUDIO_BITS_PER_SECOND * 3_600) / 8).toBeLessThan(
      25_000_000,
    );
  });
});
