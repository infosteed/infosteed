// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceoverGeneration } from "@infosteed/shared";
import { videoEditRecipe, videoEditorState } from "../../test/fixtures";
import { VideoCaptionsPanel } from "./VideoCaptionsPanel";
import { VideoInspectorTabs } from "./VideoInspectorTabs";
import { VideoTimeInput } from "./VideoTimeInput";
import type { VideoEditorController } from "./useVideoEditorController";

afterEach(cleanup);

describe("video editor inspector", () => {
  it("groups captions and voiceover under one Narration tab", () => {
    const setPanel = vi.fn();
    render(
      <VideoInspectorTabs
        controller={
          {
            panel: "chapters",
            setPanel,
          } as unknown as VideoEditorController
        }
      />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.queryByRole("tab", { name: "Captions" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Narration" }));
    expect(setPanel).toHaveBeenCalledWith("narration");
  });

  it("locks caption mutation while generation can replace the track", () => {
    const recipe = videoEditRecipe({
      captions: {
        mode: "manual",
        cues: [
          {
            id: "caption-one",
            sourceStartMs: 1_000,
            sourceEndMs: 2_000,
            text: "Caption text",
          },
        ],
      },
    });
    const voiceover = {
      status: "processing",
      progress: 0.5,
    } as VoiceoverGeneration;
    render(
      <VideoCaptionsPanel
        controller={
          {
            panel: "narration",
            narrationView: "captions",
            state: videoEditorState(),
            recipe,
            playheadMs: 1_000,
            voiceover,
            selectedNarrationCueId: undefined,
            setSelectedNarrationCueId: vi.fn(),
            seekToSourceMs: vi.fn(),
            change: vi.fn(),
          } as unknown as VideoEditorController
        }
      />,
    );

    expect((screen.getByRole("group") as HTMLFieldSetElement).disabled).toBe(
      true,
    );
    expect(
      screen.getByText(/captions will unlock when synchronization finishes/i),
    ).not.toBeNull();
  });

  it("commits valid timestamps, reports invalid values, and restores on Escape", () => {
    const onChange = vi.fn();
    render(
      <VideoTimeInput
        label="Start"
        max={10_000}
        value={1_000}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText("Start");

    fireEvent.change(input, { target: { value: "0:02.250" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(2_250);

    fireEvent.change(input, { target: { value: "bad" } });
    fireEvent.blur(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("0:01.000");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });
});
