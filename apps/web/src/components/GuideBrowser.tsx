// SPDX-License-Identifier: AGPL-3.0-only
import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  BrandingSettings,
  CurrentUser,
  Project,
  RecordingListItem,
  RecordingProject,
} from "@infosteed/shared";
import {
  createProject,
  deleteRecording,
  imageUrl,
  importProject,
  listProjects,
  listRecordings,
  restoreRecording,
} from "../api";
import { errorMessage } from "../errors";
import { openRecording, recordingUrl } from "../navigation";
import { ConfirmDialog } from "./ConfirmDialog";

function versionedImageUrl(
  recordingId: string,
  filename: string,
  version: number | undefined,
): string {
  return version
    ? `${imageUrl(recordingId, filename)}?v=${version}`
    : imageUrl(recordingId, filename);
}

function age(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function daysUntil(value: string | null | undefined): string {
  if (!value) return "";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "expires today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

export function GuideBrowser({
  user,
  branding,
  onOpenAdmin,
  onLogout,
  onLogoutAll,
}: {
  user: CurrentUser;
  branding: BrandingSettings;
  onOpenAdmin: () => void;
  onLogout: () => void;
  onLogoutAll: () => void;
}) {
  const [guides, setGuides] = useState<RecordingListItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scope, setScope] = useState<"all" | "owned" | "shared" | "trash">(
    "all",
  );
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [error, setError] = useState<string | undefined>();
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<
    RecordingListItem | undefined
  >();
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [guideResult, projectResult] = await Promise.all([
        listRecordings({ search, projectId, scope, sort }),
        listProjects(),
      ]);
      setGuides(guideResult.items);
      setProjects(projectResult.projects);
      setError(undefined);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [projectId, scope, search, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addProject(event: React.FormEvent) {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    await createProject({ name: newProjectName.trim(), private: true });
    setNewProjectName("");
    await load();
  }

  async function handleImport(file?: File) {
    if (!file) return;
    try {
      const project = JSON.parse(await file.text()) as RecordingProject;
      const imported = await importProject(project, projectId || undefined);
      openRecording(imported.id);
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function deleteGuide(guide: RecordingListItem) {
    const response = await deleteRecording(guide.id);
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    setDeleteCandidate(undefined);
    await load();
  }

  async function restoreGuide(guide: RecordingListItem) {
    await restoreRecording(guide.id);
    await load();
  }

  return (
    <main className="browser-page">
      <header>
        <div>
          <p>Library</p>
          <div className="brand-heading">
            {branding.iconDataUrl && <img src={branding.iconDataUrl} alt="" />}
            <h1>{branding.displayName || "InfoSteed"}</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="user-chip">{user.displayName}</span>
          {user.role === "admin" && (
            <button onClick={onOpenAdmin}>Admin</button>
          )}
          <button onClick={onLogout}>Log Out</button>
          <button onClick={onLogoutAll}>Log Out All Sessions</button>
        </div>
      </header>
      <section className="browser-shell">
        <div className="browser-head">
          <div>
            <h2>{scope === "trash" ? "Trash" : "Recordings"}</h2>
            <p>
              {guides.length} accessible recording
              {guides.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="browser-controls">
            <input
              placeholder="Search recordings"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button onClick={() => importInputRef.current?.click()}>
              Import Project
            </button>
            <input
              ref={importInputRef}
              className="hidden-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="all">All access</option>
              <option value="owned">Owned</option>
              <option value="shared">Shared</option>
              <option value="trash">Trash</option>
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="recent">Recent</option>
              <option value="title">Title</option>
            </select>
            <button onClick={() => setView(view === "grid" ? "list" : "grid")}>
              {view === "grid" ? "List" : "Grid"}
            </button>
          </div>
        </div>
        <form
          className="quick-project"
          onSubmit={(event) => void addProject(event)}
        >
          <input
            placeholder="New private project"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
          />
          <button>Create Project</button>
        </form>
        {error && <p className="error">{error}</p>}
        <div className={view === "grid" ? "guide-grid" : "guide-list"}>
          {guides.map((guide) => (
            <article
              key={guide.id}
              className={`guide-card${guide.deletedAt ? " deleted" : ""}`}
            >
              <div className="guide-thumb">
                {guide.thumbnailFilename ? (
                  <img
                    src={versionedImageUrl(
                      guide.id,
                      guide.thumbnailFilename,
                      undefined,
                    )}
                    alt=""
                  />
                ) : (
                  <span>{guide.title.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <a
                className="guide-open"
                href={recordingUrl(
                  guide.id,
                  guide.captureMode === "guide" ? undefined : "video",
                )}
              >
                <p>
                  {guide.projectName ?? "Private"} ·{" "}
                  {guide.captureMode === "both"
                    ? "Video + Guide"
                    : guide.captureMode === "video"
                      ? "Video"
                      : "Guide"}
                </p>
                <h3>{guide.title}</h3>
                {guide.overview && (
                  <p className="guide-snippet">{guide.overview}</p>
                )}
                <small>
                  {guide.deletedAt
                    ? `Deleted ${age(guide.deletedAt)} · ${daysUntil(guide.restorableUntil)}`
                    : age(guide.updatedAt)}{" "}
                  · {guide.ownerDisplayName ?? "Unknown owner"} ·{" "}
                  {guide.stepCount} steps · {guide.userRole}
                </small>
              </a>
              <div className="guide-card-actions">
                {guide.deletedAt ? (
                  <button onClick={() => void restoreGuide(guide)}>
                    Restore
                  </button>
                ) : (
                  <button
                    className="danger-action"
                    onClick={() => setDeleteCandidate(guide)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      {deleteCandidate && (
        <ConfirmDialog
          title="Delete guide?"
          body={`"${deleteCandidate.title}" will move to Trash and can be restored for 10 days.`}
          confirmLabel="Delete Guide"
          tone="danger"
          onCancel={() => setDeleteCandidate(undefined)}
          onConfirm={() => void deleteGuide(deleteCandidate)}
        />
      )}
    </main>
  );
}
