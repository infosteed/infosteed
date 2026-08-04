// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from "vitest";
import type { LibraryControllerDependencies } from "../features/library/useLibraryController";
import { project, recording, recordingListItem } from "./fixtures";

export function libraryApiMocks(): LibraryControllerDependencies {
  return {
    listRecordings: vi.fn().mockResolvedValue({
      items: [recordingListItem()],
      total: 1,
    }),
    listProjects: vi.fn().mockResolvedValue({ projects: [project()] }),
    createProject: vi.fn().mockResolvedValue(project()),
    importProject: vi.fn().mockResolvedValue(recording()),
    deleteRecording: vi.fn().mockResolvedValue(new Response(null)),
    restoreRecording: vi.fn().mockResolvedValue(recording()),
    openRecording: vi.fn(),
  };
}
