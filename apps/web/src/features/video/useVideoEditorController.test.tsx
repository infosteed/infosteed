// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceoverGeneration } from "@infosteed/shared";
import {
  createVideoRender,
  getVideoEditor,
  getVideoMp4Export,
  publishVideoRender,
  rewriteVoiceoverScript,
  saveVideoEditor,
} from "../../api";
import { openRecording } from "../../navigation";
import {
  recording,
  recordingVideo,
  videoEditRecipe,
  videoEditorState,
} from "../../test/fixtures";
import { useVideoEditorController } from "./useVideoEditorController";

vi.mock("../../api", () => ({
  cancelVideoRender: vi.fn(),
  createVideoMp4Export: vi.fn(),
  createVideoEditVersion: vi.fn(),
  createVideoRender: vi.fn(),
  generateVoiceover: vi.fn(),
  getRecordingVideo: vi.fn(),
  getVideoEditor: vi.fn(),
  getVideoMp4Export: vi.fn(),
  getVideoRender: vi.fn(),
  getVoiceoverGeneration: vi.fn(),
  listVoiceoverVoices: vi.fn(),
  publishVideoRender: vi.fn(),
  resetVideoEditor: vi.fn(),
  rewriteVoiceoverScript: vi.fn(),
  restoreVideoEditVersion: vi.fn(),
  saveVideoEditor: vi.fn(),
  voiceoverCueUrl: vi.fn(() => "/voiceover"),
}));

vi.mock("../../navigation", () => ({
  openRecording: vi.fn(),
}));

describe("video editor controller", () => {
  const readyVoiceover: VoiceoverGeneration = {
    id: "00000000-0000-4000-8000-000000000060",
    status: "ready",
    progress: 1,
    provider: "fixture",
    model: "fixture",
    voice: "fixture",
    speed: 1,
    scriptHash: "fixture",
    assetId: "00000000-0000-4000-8000-000000000061",
    errorMessage: null,
    attempts: 1,
    cues: [
      {
        id: "cue-1",
        ordinal: 0,
        sourceStartMs: 1_000,
        sourceEndMs: 3_000,
        text: "Generated narration",
        contentHash: "cue-1",
        status: "ready",
        durationMs: 2_700,
        overlongByMs: 700,
        errorMessage: null,
      },
      {
        id: "cue-2",
        ordinal: 1,
        sourceStartMs: 9_000,
        sourceEndMs: 9_500,
        text: "Ends at the video boundary",
        contentHash: "cue-2",
        status: "ready",
        durationMs: 2_000,
        overlongByMs: 1_500,
        errorMessage: null,
      },
      {
        id: "cue-3",
        ordinal: 2,
        sourceStartMs: 5_000,
        sourceEndMs: 6_500,
        text: "Duration unavailable",
        contentHash: "cue-3",
        status: "ready",
        durationMs: null,
        overlongByMs: 0,
        errorMessage: null,
      },
    ],
    createdAt: "2026-01-03T00:00:00.000Z",
    completedAt: "2026-01-03T00:01:00.000Z",
  };

  beforeEach(() => {
    vi.mocked(getVideoEditor).mockResolvedValue(videoEditorState());
    vi.mocked(saveVideoEditor).mockResolvedValue({
      revision: 2,
      recipe: videoEditRecipe(),
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderController() {
    return renderHook(() =>
      useVideoEditorController({
        recording: recording({ captureMode: "video" }),
        video: recordingVideo(),
        onPublished: vi.fn(),
        onGenerationFinished: vi.fn(),
      }),
    );
  }

  it("loads the draft and saves changed recipes with the current revision", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.recipe).toBeDefined());

    const changed = videoEditRecipe({
      audio: { tabGain: 0.5, microphoneGain: 1, voiceoverGain: 1 },
    });
    act(() => result.current.change(changed));
    await act(() => result.current.persist());

    expect(saveVideoEditor).toHaveBeenCalledWith(
      expect.any(String),
      1,
      changed,
    );
    expect(result.current.dirty).toBe(false);
  });

  it("marks a ready preview stale as soon as the recipe changes", async () => {
    vi.mocked(getVideoEditor).mockResolvedValue(
      videoEditorState({
        renders: [
          {
            id: "00000000-0000-4000-8000-000000000070",
            editVersionId: "00000000-0000-4000-8000-000000000071",
            status: "ready",
            progress: 1,
            durationMs: 10_000,
            byteSize: 1_024,
            errorMessage: null,
            stale: false,
            createdAt: "2026-01-03T00:00:00.000Z",
            completedAt: "2026-01-03T00:01:00.000Z",
          },
        ],
      }),
    );
    vi.mocked(getVideoMp4Export).mockRejectedValue(new Error("No export"));
    const { result } = renderController();
    await waitFor(() => expect(result.current.render?.status).toBe("ready"));

    act(() =>
      result.current.change(
        videoEditRecipe({
          audio: { tabGain: 0.75, microphoneGain: 1, voiceoverGain: 1 },
        }),
      ),
    );

    expect(result.current.render?.stale).toBe(true);
  });

  it("pauses autosave when the server reports a revision conflict", async () => {
    vi.mocked(saveVideoEditor).mockRejectedValueOnce(new Error("409 conflict"));
    const { result } = renderController();
    await waitFor(() => expect(result.current.recipe).toBeDefined());

    act(() =>
      result.current.change(videoEditRecipe({ sourceDurationMs: 9000 })),
    );
    await act(() => result.current.persist());

    expect(result.current.savePaused).toBe(true);
    expect(result.current.error).toContain("409");
  });

  it("maintains undo and redo history around recipe changes", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.recipe).toBeDefined());
    const changed = videoEditRecipe({
      webcam: { visible: true, centerX: 0.5, centerY: 0.5, diameter: 0.2 },
    });

    act(() => result.current.change(changed));
    act(() => result.current.undo());
    expect(result.current.recipe?.webcam.visible).toBe(false);
    act(() => result.current.redo());
    expect(result.current.recipe?.webcam.visible).toBe(true);
  });

  it("attaches a completed voiceover and synchronizes captions to its speech", async () => {
    const previousRecipe = videoEditRecipe({
      voiceover: {
        enabled: true,
        assetId: "00000000-0000-4000-8000-000000000062",
        generationId: "00000000-0000-4000-8000-000000000063",
      },
      captions: {
        mode: "manual",
        cues: [
          {
            id: "old-caption",
            sourceStartMs: 0,
            sourceEndMs: 500,
            text: "Old caption",
          },
        ],
      },
    });
    vi.mocked(getVideoEditor).mockResolvedValue(
      videoEditorState({
        draft: {
          revision: 1,
          recipe: previousRecipe,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        voiceover: readyVoiceover,
      }),
    );

    const { result } = renderController();

    await waitFor(() =>
      expect(result.current.recipe?.voiceover.generationId).toBe(
        readyVoiceover.id,
      ),
    );
    expect(result.current.recipe?.voiceover).toEqual({
      enabled: true,
      assetId: readyVoiceover.assetId,
      generationId: readyVoiceover.id,
    });
    expect(result.current.recipe?.captions).toEqual({
      mode: "manual",
      cues: [
        {
          id: "cue-1",
          sourceStartMs: 1_000,
          sourceEndMs: 3_700,
          text: "Generated narration",
        },
        {
          id: "cue-2",
          sourceStartMs: 9_000,
          sourceEndMs: 10_000,
          text: "Ends at the video boundary",
        },
        {
          id: "cue-3",
          sourceStartMs: 5_000,
          sourceEndMs: 6_500,
          text: "Duration unavailable",
        },
      ],
    });

    act(() => result.current.undo());
    expect(result.current.recipe).toEqual(previousRecipe);
  });

  it("does not overwrite caption edits after the voiceover is attached", async () => {
    const editedCaptions = {
      mode: "manual" as const,
      cues: [
        {
          id: "edited-caption",
          sourceStartMs: 2_000,
          sourceEndMs: 4_000,
          text: "Edited after generation",
        },
      ],
    };
    const attachedRecipe = videoEditRecipe({
      voiceover: {
        enabled: true,
        assetId: readyVoiceover.assetId,
        generationId: readyVoiceover.id,
      },
      captions: editedCaptions,
    });
    vi.mocked(getVideoEditor).mockResolvedValue(
      videoEditorState({
        draft: {
          revision: 1,
          recipe: attachedRecipe,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        voiceover: readyVoiceover,
      }),
    );

    const { result } = renderController();

    await waitFor(() => expect(result.current.recipe).toBeDefined());
    expect(result.current.recipe?.captions).toEqual(editedCaptions);
    expect(result.current.dirty).toBe(false);
  });

  it("requests a render only after persisting the draft", async () => {
    vi.mocked(createVideoRender).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000050",
      editVersionId: "00000000-0000-4000-8000-000000000051",
      status: "queued",
      progress: 0,
      durationMs: null,
      byteSize: 0,
      errorMessage: null,
      stale: false,
      createdAt: "2026-01-03T00:00:00.000Z",
      completedAt: null,
    });
    vi.mocked(publishVideoRender).mockResolvedValue(recordingVideo());
    const { result } = renderController();
    await waitFor(() => expect(result.current.recipe).toBeDefined());

    await act(() => result.current.requestRender());

    expect(createVideoRender).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
    );
    expect(result.current.render?.status).toBe("queued");
  });

  it("switches inspector panels and publishes the completed render", async () => {
    const completedRender = {
      id: "00000000-0000-4000-8000-000000000050",
      editVersionId: "00000000-0000-4000-8000-000000000051",
      status: "ready" as const,
      progress: 1,
      durationMs: 10_000,
      byteSize: 1024,
      errorMessage: null,
      stale: false,
      createdAt: "2026-01-03T00:00:00.000Z",
      completedAt: "2026-01-03T00:01:00.000Z",
    };
    vi.mocked(getVideoEditor).mockResolvedValue(
      videoEditorState({ renders: [completedRender] }),
    );
    vi.mocked(getVideoMp4Export).mockRejectedValue(
      new Error("No MP4 export yet"),
    );
    vi.mocked(publishVideoRender).mockResolvedValue(recordingVideo());
    const onPublished = vi.fn();
    const recordingFixture = recording({ captureMode: "video" });
    const { result } = renderHook(() =>
      useVideoEditorController({
        recording: recordingFixture,
        video: recordingVideo(),
        onPublished,
        onGenerationFinished: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.render).toEqual(completedRender));

    act(() => {
      result.current.setPanel("narration");
      result.current.setNarrationView("captions");
    });
    expect(result.current.panel).toBe("narration");
    expect(result.current.narrationView).toBe("captions");
    await act(() => result.current.publishChanges());

    expect(publishVideoRender).toHaveBeenCalledWith(
      recordingFixture.id,
      completedRender.id,
    );
    expect(onPublished).toHaveBeenCalledOnce();
    expect(openRecording).toHaveBeenCalledWith(recordingFixture.id, "video");
  });

  it("rewrites narration with the selected speed and reports changed cues", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.recipe).toBeDefined());
    act(() =>
      result.current.setNarrationCues([
        {
          id: "cue-1",
          sourceStartMs: 0,
          sourceEndMs: 4_000,
          text: "rough captions",
        },
      ]),
    );
    const rewritten = result.current.narrationCues.map((cue) => ({
      ...cue,
      text: `Rewritten ${cue.id}`,
    }));
    vi.mocked(rewriteVoiceoverScript).mockResolvedValue({ cues: rewritten });

    act(() => result.current.setVoiceoverSpeed(1.25));
    await act(() => result.current.rewriteScript());

    expect(rewriteVoiceoverScript).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      "natural",
      expect.any(String),
      1.25,
    );
    expect(result.current.narrationCues).toEqual(rewritten);
    expect(result.current.rewriteNotice).toContain(String(rewritten.length));
  });

  it("preserves narration when rewriting fails", async () => {
    vi.mocked(rewriteVoiceoverScript).mockRejectedValue(
      new Error("No usable narration"),
    );
    const { result } = renderController();
    await waitFor(() => expect(result.current.recipe).toBeDefined());
    act(() =>
      result.current.setNarrationCues([
        {
          id: "cue-1",
          sourceStartMs: 0,
          sourceEndMs: 4_000,
          text: "keep this narration",
        },
      ]),
    );
    const before = result.current.narrationCues;

    await act(() => result.current.rewriteScript());

    expect(result.current.narrationCues).toEqual(before);
    expect(result.current.rewriteNotice).toBeUndefined();
    expect(result.current.error).toContain("No usable narration");
  });
});
