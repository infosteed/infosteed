// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useRef, useState } from "react";
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

const RECORDINGS_PAGE_SIZE = 48;

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
  const [total, setTotal] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState(
    () => new URLSearchParams(window.location.search).get("projectId") ?? "",
  );
  const [scope, setScope] = useState<LibraryScope>(initialLibraryScope);
  const [sort, setSort] = useState<LibrarySort>(initialLibrarySort);
  const [view, setView] = useState<LibraryView>("grid");
  const [error, setError] = useState<string>();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<RecordingListItem>();
  const requestVersion = useRef(0);
  const loadingMore = useRef(false);
  const queryKey = JSON.stringify({ search, projectId, scope, sort });
  const queryKeyRef = useRef(queryKey);
  queryKeyRef.current = queryKey;

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const requestedQueryKey = JSON.stringify({
      search,
      projectId,
      scope,
      sort,
    });
    loadingMore.current = false;
    setIsLoadingMore(false);
    try {
      const [guideResult, projectResult] = await Promise.all([
        dependencies.listRecordings({
          search,
          projectId,
          scope,
          sort,
          limit: RECORDINGS_PAGE_SIZE,
          offset: 0,
        }),
        dependencies.listProjects(),
      ]);
      if (
        version !== requestVersion.current ||
        requestedQueryKey !== queryKeyRef.current
      )
        return;
      setGuides(guideResult.items);
      setTotal(guideResult.total);
      setProjects(projectResult.projects);
      setError(undefined);
    } catch (loadError) {
      if (
        version !== requestVersion.current ||
        requestedQueryKey !== queryKeyRef.current
      )
        return;
      setError(errorMessage(loadError));
    }
  }, [dependencies, projectId, scope, search, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (loadingMore.current || guides.length >= total) return;

    const version = requestVersion.current;
    const requestedQueryKey = queryKey;
    loadingMore.current = true;
    setIsLoadingMore(true);
    try {
      const result = await dependencies.listRecordings({
        search,
        projectId,
        scope,
        sort,
        limit: RECORDINGS_PAGE_SIZE,
        offset: guides.length,
      });
      if (
        version !== requestVersion.current ||
        requestedQueryKey !== queryKeyRef.current
      )
        return;
      setGuides((current) => [...current, ...result.items]);
      setTotal(result.total);
      setError(undefined);
    } catch (loadError) {
      if (
        version === requestVersion.current &&
        requestedQueryKey === queryKeyRef.current
      )
        setError(errorMessage(loadError));
    } finally {
      if (
        version === requestVersion.current &&
        requestedQueryKey === queryKeyRef.current
      ) {
        loadingMore.current = false;
        setIsLoadingMore(false);
      }
    }
  }

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
    total,
    hasMore: guides.length < total,
    isLoadingMore,
    loadMore,
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
