// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fixtureIds,
  recording,
  recordingTranscript,
  recordingVideo,
} from "../test/fixtures";
import { VideoGuidePlayer } from "./RecordingWorkspace";

const mocks = vi.hoisted(() => ({
  discard: vi.fn(),
  retryTranscript: vi.fn(),
  togglePublished: vi.fn(),
  useVideoGuidePlayerController: vi.fn(),
}));

vi.mock("../features/guide/useGuideWorkspaceControllers", () => ({
  useVideoGuidePlayerController: mocks.useVideoGuidePlayerController,
}));

describe("video guide player", () => {
  beforeEach(() => {
    mocks.useVideoGuidePlayerController.mockImplementation(() => {
      const [panel, setPanel] = useState<"chapters" | "transcript">("chapters");
      const [panelOpen, setPanelOpen] = useState(false);
      return {
        busy: false,
        error: undefined,
        panel,
        setPanel,
        panelOpen,
        setPanelOpen,
        transcript: recordingTranscript(),
        togglePublished: mocks.togglePublished,
        discard: mocks.discard,
        retryTranscript: mocks.retryTranscript,
      };
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderPlayer() {
    return render(
      <>
        <div id={`guide-item-${fixtureIds.item}`} />
        <VideoGuidePlayer
          recording={recording({ captureMode: "both" })}
          video={recordingVideo({
            status: "published",
            chapters: [
              {
                id: "chapter-one",
                eventId: null,
                guideItemId: fixtureIds.item,
                title: "Open settings",
                offsetMs: 2_000,
                ordinal: 0,
              },
            ],
          })}
          editable
          onVideoChanged={vi.fn()}
          onRecordingChanged={vi.fn()}
          onVideoDeleted={vi.fn()}
        />
      </>,
    );
  }

  it("opens and closes the navigation drawer while preserving its tab", () => {
    renderPlayer();
    const trigger = screen.getByRole("button", { name: "Chapters" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(
      screen.queryByRole("complementary", {
        name: "Chapters and transcript",
      }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Unpublish" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Discard video" })).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Transcript" }));
    expect(
      screen
        .getByRole("tab", { name: "Transcript" })
        .getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: "Close chapters and transcript" }),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(
      screen
        .getByRole("tab", { name: "Transcript" })
        .getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("closes with Escape and when video fullscreen starts", () => {
    renderPlayer();
    const trigger = screen.getByRole("button", { name: "Chapters" });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.querySelector("video"),
    });
    fireEvent(document, new Event("fullscreenchange"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
  });

  it("seeks the video and linked guide item from a chapter", async () => {
    renderPlayer();
    const guideItem = document.getElementById(`guide-item-${fixtureIds.item}`)!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(guideItem, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.click(screen.getByRole("button", { name: "Chapters" }));
    fireEvent.click(screen.getByRole("button", { name: /Open settings/ }));

    const player = document.querySelector("video")!;
    expect(player.currentTime).toBe(2);
    expect(player.play).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    await waitFor(() =>
      expect(guideItem.className).toContain("chapter-highlight"),
    );
  });
});
