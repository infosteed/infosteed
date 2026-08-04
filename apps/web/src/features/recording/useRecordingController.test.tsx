// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteRecording,
  getRecording,
  getRecordingVideo,
  importProject,
  reorderItems,
} from "../../api";
import { openLibrary, openRecording } from "../../navigation";
import { currentUser, guideItem, recording } from "../../test/fixtures";
import { useRecordingController } from "./useRecordingController";

vi.mock("../../api", () => ({
  deleteRecording: vi.fn(),
  getRecording: vi.fn(),
  getRecordingVideo: vi.fn(),
  importProject: vi.fn(),
  reorderItems: vi.fn(),
}));

vi.mock("../../navigation", () => ({
  openLibrary: vi.fn(),
  openRecording: vi.fn(),
}));

vi.mock("../../components/RecordingWorkspace", () => ({
  startExistingCapture: vi.fn(),
}));

describe("recording controller", () => {
  const userFixture = currentUser();
  const first = guideItem({ id: "first", ordinal: 0, title: "First" });
  const second = guideItem({ id: "second", ordinal: 1, title: "Second" });

  beforeEach(() => {
    vi.mocked(getRecording).mockResolvedValue(
      recording({ items: [first, second] }),
    );
    vi.mocked(getRecordingVideo).mockRejectedValue(new Error("No video"));
    vi.mocked(reorderItems).mockResolvedValue(
      recording({ items: [second, first] }),
    );
    vi.mocked(deleteRecording).mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.mocked(importProject).mockResolvedValue(recording());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderController() {
    return renderHook(() =>
      useRecordingController(recording().id, userFixture),
    );
  }

  it("owns guide selection, editing, preview, access, and version panel state", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.recording).toBeDefined());

    act(() => {
      result.current.setSelectedItemId(first.id);
      result.current.setViewOnly(false);
      result.current.setPreviewOpen(true);
      result.current.setAccessOpen(true);
      result.current.setVersionsOpen(true);
      result.current.bumpImageVersion("step.png");
    });

    expect(result.current.selectedItemId).toBe(first.id);
    expect(result.current.viewOnly).toBe(false);
    expect(result.current.previewOpen).toBe(true);
    expect(result.current.accessOpen).toBe(true);
    expect(result.current.versionsOpen).toBe(true);
    expect(result.current.imageVersions.get("step.png")).toBe(1);
    expect(result.current.reorderDisabled).toBe(true);
  });

  it("updates guide items locally and persists keyboard reordering", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() =>
      result.current.updateLocalItem({ ...first, title: "Updated first" }),
    );
    expect(result.current.recording?.items[0]?.title).toBe("Updated first");

    await act(() => result.current.moveItemBy(first.id, 1));
    expect(reorderItems).toHaveBeenCalledWith(recording().id, [
      second.id,
      first.id,
    ]);
  });

  it("imports and deletes through named recording commands", async () => {
    const { result } = renderController();
    await waitFor(() => expect(result.current.recording).toBeDefined());

    const file = {
      text: async () => JSON.stringify({ version: 2 }),
    } as File;
    await act(() => result.current.handleProjectImport(file));
    expect(importProject).toHaveBeenCalledWith({ version: 2 });
    expect(openRecording).toHaveBeenCalledWith(recording().id);

    await act(() => result.current.confirmDeleteCurrentGuide());
    expect(deleteRecording).toHaveBeenCalledWith(recording().id);
    expect(openLibrary).toHaveBeenCalledOnce();
  });
});
