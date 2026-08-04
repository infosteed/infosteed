// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { libraryApiMocks } from "../../test/apiMocks";
import { recordingListItem } from "../../test/fixtures";
import { useLibraryController } from "./useLibraryController";

describe("library controller", () => {
  afterEach(cleanup);

  it("loads and reloads recordings when filters change", async () => {
    const api = libraryApiMocks();
    const { result } = renderHook(() => useLibraryController(api));

    await waitFor(() => expect(result.current.guides).toHaveLength(1));
    act(() => {
      result.current.setSearch("onboarding");
      result.current.setScope("shared");
      result.current.setSort("title");
    });

    await waitFor(() =>
      expect(api.listRecordings).toHaveBeenLastCalledWith({
        search: "onboarding",
        projectId: "",
        scope: "shared",
        sort: "title",
      }),
    );
  });

  it("creates projects and clears the draft name", async () => {
    const api = libraryApiMocks();
    const { result } = renderHook(() => useLibraryController(api));
    await waitFor(() => expect(result.current.projects).toHaveLength(1));

    act(() => result.current.setNewProjectName("  Product tours  "));
    await act(() => result.current.addProject());

    expect(api.createProject).toHaveBeenCalledWith({
      name: "Product tours",
      private: true,
    });
    expect(result.current.newProjectName).toBe("");
  });

  it("imports, deletes, and restores recordings through named commands", async () => {
    const api = libraryApiMocks();
    const guide = recordingListItem();
    const { result } = renderHook(() => useLibraryController(api));
    await waitFor(() => expect(result.current.guides).toHaveLength(1));

    const file = {
      text: async () => JSON.stringify({ version: 2 }),
    } as File;
    await act(() => result.current.importRecordingProject(file));
    expect(api.importProject).toHaveBeenCalledWith({ version: 2 }, undefined);
    expect(api.openRecording).toHaveBeenCalledWith(guide.id);

    await act(() => result.current.deleteGuide(guide));
    expect(api.deleteRecording).toHaveBeenCalledWith(guide.id);

    await act(() => result.current.restoreGuide(guide));
    expect(api.restoreRecording).toHaveBeenCalledWith(guide.id);
  });
});
