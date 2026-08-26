// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        limit: 48,
        offset: 0,
      }),
    );
  });

  it("reports initial and query loading without treating stale responses as complete", async () => {
    const api = libraryApiMocks();
    let resolveInitial!: (value: {
      items: ReturnType<typeof recordingListItem>[];
      total: number;
    }) => void;
    vi.mocked(api.listRecordings).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInitial = resolve;
      }),
    );
    const { result } = renderHook(() => useLibraryController(api));

    expect(result.current.isLoading).toBe(true);
    await act(async () => resolveInitial({ items: [], total: 0 }));
    expect(result.current.isLoading).toBe(false);
  });

  it("appends the next page and tracks the server total", async () => {
    const api = libraryApiMocks();
    const first = recordingListItem({ id: "recording-1", title: "First" });
    const second = recordingListItem({ id: "recording-2", title: "Second" });
    vi.mocked(api.listRecordings)
      .mockResolvedValueOnce({ items: [first], total: 2 })
      .mockResolvedValueOnce({ items: [second], total: 2 });
    const { result } = renderHook(() => useLibraryController(api));

    await waitFor(() => expect(result.current.guides).toEqual([first]));
    expect(result.current.total).toBe(2);
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());

    expect(api.listRecordings).toHaveBeenLastCalledWith({
      search: "",
      projectId: "",
      scope: "all",
      sort: "recent",
      limit: 48,
      offset: 1,
    });
    expect(result.current.guides).toEqual([first, second]);
    expect(result.current.hasMore).toBe(false);
  });

  it("prevents duplicate load-more requests and allows retry after failure", async () => {
    const api = libraryApiMocks();
    const first = recordingListItem({ id: "recording-1" });
    const second = recordingListItem({ id: "recording-2" });
    let rejectPage!: (reason: Error) => void;
    const failedPage = new Promise<{ items: (typeof first)[]; total: number }>(
      (_resolve, reject) => {
        rejectPage = reject;
      },
    );
    vi.mocked(api.listRecordings)
      .mockResolvedValueOnce({ items: [first], total: 2 })
      .mockReturnValueOnce(failedPage)
      .mockResolvedValueOnce({ items: [second], total: 2 });
    const { result } = renderHook(() => useLibraryController(api));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    act(() => {
      void result.current.loadMore();
      void result.current.loadMore();
    });
    expect(api.listRecordings).toHaveBeenCalledTimes(2);
    expect(result.current.isLoadingMore).toBe(true);

    await act(async () => rejectPage(new Error("Could not load more")));
    expect(result.current.guides).toEqual([first]);
    expect(result.current.error).toBe("Could not load more");

    await act(() => result.current.loadMore());
    expect(result.current.guides).toEqual([first, second]);
    expect(result.current.error).toBeUndefined();
  });

  it("ignores an old load-more response after filters change", async () => {
    const api = libraryApiMocks();
    const first = recordingListItem({ id: "recording-1", title: "First" });
    const stale = recordingListItem({ id: "recording-2", title: "Stale" });
    const filtered = recordingListItem({
      id: "recording-3",
      title: "Filtered",
    });
    let resolveStalePage!: (value: {
      items: (typeof stale)[];
      total: number;
    }) => void;
    const stalePage = new Promise<{ items: (typeof stale)[]; total: number }>(
      (resolve) => {
        resolveStalePage = resolve;
      },
    );
    vi.mocked(api.listRecordings)
      .mockResolvedValueOnce({ items: [first], total: 2 })
      .mockReturnValueOnce(stalePage)
      .mockResolvedValueOnce({ items: [filtered], total: 1 });
    const { result } = renderHook(() => useLibraryController(api));
    await waitFor(() => expect(result.current.guides).toEqual([first]));

    act(() => void result.current.loadMore());
    act(() => result.current.setSearch("filtered"));
    await waitFor(() => expect(result.current.guides).toEqual([filtered]));

    await act(async () => resolveStalePage({ items: [stale], total: 2 }));
    expect(result.current.guides).toEqual([filtered]);
    expect(result.current.total).toBe(1);
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

  it("queues, reloads, and retries Scribe Markdown imports", async () => {
    const api = libraryApiMocks();
    const job = {
      id: "00000000-0000-4000-8000-000000000090",
      status: "queued" as const,
      originalFilename: "guide.md",
      sourceUrl: "https://scribehow.com/example",
      totalImages: 2,
      processedImages: 0,
      downloadedImages: 0,
      failedImages: [],
      recordingId: null,
      errorMessage: null,
      createdAt: "2026-08-12T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
      completedAt: null,
    };
    vi.mocked(api.createScribeMarkdownImport).mockResolvedValue(job);
    vi.mocked(api.listScribeMarkdownImports).mockResolvedValue({ jobs: [job] });
    vi.mocked(api.retryScribeMarkdownImport).mockResolvedValue(job);
    const { result } = renderHook(() => useLibraryController(api));
    await waitFor(() => expect(result.current.guides).toHaveLength(1));

    await act(() => result.current.loadScribeImports());
    expect(result.current.scribeImports).toEqual([job]);

    const file = {
      name: "guide.md",
      text: async () => "# Guide\n\n1\\. Do it",
    } as File;
    await act(() => result.current.importScribeMarkdown(file));
    expect(api.createScribeMarkdownImport).toHaveBeenCalledWith({
      markdown: "# Guide\n\n1\\. Do it",
      originalFilename: "guide.md",
      projectId: undefined,
    });

    await act(() => result.current.retryScribeImport(job.id));
    expect(api.retryScribeMarkdownImport).toHaveBeenCalledWith(job.id);
  });
});
