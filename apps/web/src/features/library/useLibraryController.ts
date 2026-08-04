// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from "react";
import type {
  Project,
  RecordingListItem,
  RecordingProject,
} from "@infosteed/shared";
import {
  createProject,
  deleteRecording,
  importProject,
  listProjects,
  listRecordings,
  restoreRecording,
} from "../../api";
import { errorMessage } from "../../errors";
import { openRecording } from "../../navigation";
import type { LibraryScope, LibrarySort, LibraryView } from "./model";

export interface LibraryControllerDependencies {
  listRecordings: typeof listRecordings;
  listProjects: typeof listProjects;
  createProject: typeof createProject;
  importProject: typeof importProject;
  deleteRecording: typeof deleteRecording;
  restoreRecording: typeof restoreRecording;
  openRecording: typeof openRecording;
}

const libraryDependencies: LibraryControllerDependencies = {
  listRecordings,
  listProjects,
  createProject,
  importProject,
  deleteRecording,
  restoreRecording,
  openRecording,
};

function initialLibraryScope(): LibraryScope {
  const value = new URLSearchParams(window.location.search).get("scope");
  return value === "owned" || value === "shared" || value === "trash"
    ? value
    : "all";
}

function initialLibrarySort(): LibrarySort {
  return new URLSearchParams(window.location.search).get("sort") === "title"
    ? "title"
    : "recent";
}

export function useLibraryController(
  dependencies: LibraryControllerDependencies = libraryDependencies,
) {
  const [guides, setGuides] = useState<RecordingListItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState(
    () => new URLSearchParams(window.location.search).get("projectId") ?? "",
  );
  const [scope, setScope] = useState<LibraryScope>(initialLibraryScope);
  const [sort, setSort] = useState<LibrarySort>(initialLibrarySort);
  const [view, setView] = useState<LibraryView>("grid");
  const [error, setError] = useState<string>();
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<RecordingListItem>();

  const load = useCallback(async () => {
    try {
      const [guideResult, projectResult] = await Promise.all([
        dependencies.listRecordings({ search, projectId, scope, sort }),
        dependencies.listProjects(),
      ]);
      setGuides(guideResult.items);
      setProjects(projectResult.projects);
      setError(undefined);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [dependencies, projectId, scope, search, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addProject() {
    if (!newProjectName.trim()) return;
    await dependencies.createProject({
      name: newProjectName.trim(),
      private: true,
    });
    setNewProjectName("");
    await load();
  }

  async function importRecordingProject(file?: File) {
    if (!file) return;
    try {
      const imported = await dependencies.importProject(
        JSON.parse(await file.text()) as RecordingProject,
        projectId || undefined,
      );
      dependencies.openRecording(imported.id);
    } catch (importError) {
      setError(errorMessage(importError));
    }
  }

  async function deleteGuide(guide: RecordingListItem) {
    const response = await dependencies.deleteRecording(guide.id);
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    setDeleteCandidate(undefined);
    await load();
  }

  async function restoreGuide(guide: RecordingListItem) {
    await dependencies.restoreRecording(guide.id);
    await load();
  }

  return {
    guides,
    projects,
    search,
    setSearch,
    projectId,
    setProjectId,
    scope,
    setScope,
    sort,
    setSort,
    view,
    setView,
    error,
    newProjectName,
    setNewProjectName,
    deleteCandidate,
    setDeleteCandidate,
    addProject,
    importRecordingProject,
    deleteGuide,
    restoreGuide,
  };
}
