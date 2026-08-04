// SPDX-License-Identifier: AGPL-3.0-only
import React, { useCallback, useEffect, useState } from "react";
import type {
  CurrentUser,
  Project,
  ProjectMember,
  Recording,
  UserDirectoryEntry,
} from "@infosteed/shared";
import {
  listProjectMembers,
  listProjects,
  listUserDirectory,
  moveRecordingToProject,
  removeProjectMember,
  setProjectMember,
} from "../api";
import { errorMessage } from "../errors";
import { t } from "../i18n";
import { ConfirmDialog } from "./ConfirmDialog";

export function GuideShareMovePanel({
  recording,
  user,
  onChanged,
}: {
  recording: Recording;
  user: CurrentUser;
  onChanged: (recording: Recording) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>([]);
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"viewer" | "editor">("viewer");
  const [destinationProjectId, setDestinationProjectId] = useState(
    recording.projectId ?? "",
  );
  const [error, setError] = useState<string | undefined>();
  const [memberRemoveCandidate, setMemberRemoveCandidate] = useState<
    ProjectMember | undefined
  >();
  const [moveCandidateProjectId, setMoveCandidateProjectId] = useState<
    string | undefined
  >();
  const currentProject = projects.find(
    (project) => project.id === recording.projectId,
  );
  const canManageMembers =
    user.role === "admin" || currentProject?.role === "owner";
  const canMoveGuide =
    recording.userRole === "admin" ||
    recording.userRole === "owner" ||
    recording.userRole === "editor";
  const editableProjects = projects.filter(
    (project) => project.role === "owner" || project.role === "editor",
  );
  const existingMemberIds = new Set(members.map((member) => member.userId));
  const memberOptions = directory.filter(
    (entry) => !existingMemberIds.has(entry.id),
  );

  const load = useCallback(async () => {
    try {
      const [projectResult, directoryResult] = await Promise.all([
        listProjects(),
        listUserDirectory(),
      ]);
      setProjects(projectResult.projects);
      setDirectory(directoryResult.users);
      if (recording.projectId) {
        const memberResult = await listProjectMembers(recording.projectId);
        setMembers(memberResult.members);
      } else {
        setMembers([]);
      }
      setDestinationProjectId(recording.projectId ?? "");
      setError(undefined);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [recording.projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!recording.projectId || !memberUserId) return;
    try {
      await setProjectMember(recording.projectId, {
        userId: memberUserId,
        role: memberRole,
      });
      setMemberUserId("");
      await load();
    } catch (addError) {
      setError(errorMessage(addError));
    }
  }

  async function removeMember(member: ProjectMember) {
    const response = await removeProjectMember(member.projectId, member.userId);
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    setMemberRemoveCandidate(undefined);
    await load();
  }

  async function moveGuide(projectId: string) {
    if (!projectId || projectId === recording.projectId) return;
    try {
      const updated = await moveRecordingToProject(recording.id, projectId);
      setMoveCandidateProjectId(undefined);
      onChanged(updated);
      setError(undefined);
    } catch (moveError) {
      setError(errorMessage(moveError));
    }
  }

  return (
    <section className="share-panel">
      <div className="share-panel-head">
        <div>
          <p>{t("Project Access")}</p>
          <h2>{currentProject?.name ?? t("No project")}</h2>
        </div>
        {currentProject && (
          <span className="status-pill neutral">
            {t(currentProject.role ?? "viewer")}
          </span>
        )}
      </div>
      <div className="share-panel-grid">
        <div className="share-box">
          <div className="share-box-head">
            <strong>{t("Members")}</strong>
            {!canManageMembers && <span>{t("View only")}</span>}
          </div>
          {canManageMembers && recording.projectId && (
            <form
              className="member-form compact"
              onSubmit={(event) => void addMember(event)}
            >
              <select
                value={memberUserId}
                onChange={(event) => setMemberUserId(event.target.value)}
              >
                <option value="">{t("Select user")}</option>
                {memberOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName} ({entry.username})
                  </option>
                ))}
              </select>
              <select
                value={memberRole}
                onChange={(event) =>
                  setMemberRole(event.target.value as "viewer" | "editor")
                }
              >
                <option value="viewer">{t("Viewer")}</option>
                <option value="editor">{t("Editor")}</option>
              </select>
              <button>{t("Add")}</button>
            </form>
          )}
          <div className="compact-member-list">
            {members.map((member) => (
              <div key={member.userId} className="compact-member-row">
                <div>
                  <strong>{member.displayName}</strong>
                  <span>{member.username}</span>
                </div>
                <span
                  className={`status-pill ${member.role === "owner" ? "owner" : "neutral"}`}
                >
                  {t(member.role)}
                </span>
                {canManageMembers && member.role !== "owner" && (
                  <button onClick={() => setMemberRemoveCandidate(member)}>
                    {t("Remove")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="share-box">
          <div className="share-box-head">
            <strong>{t("Move Guide")}</strong>
            <span>{t("Access follows project")}</span>
          </div>
          <div className="move-controls">
            <select
              disabled={!canMoveGuide}
              value={destinationProjectId}
              onChange={(event) => setDestinationProjectId(event.target.value)}
            >
              <option value="">{t("Select destination project")}</option>
              {editableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              disabled={
                !canMoveGuide ||
                !destinationProjectId ||
                destinationProjectId === recording.projectId
              }
              onClick={() => setMoveCandidateProjectId(destinationProjectId)}
            >
              {t("Move")}
            </button>
          </div>
          <p className="share-note">
            {t(
              "Moving preserves the guide owner, but viewers/editors are recalculated from the destination project.",
            )}
          </p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {memberRemoveCandidate && (
        <ConfirmDialog
          title={t("Remove project member?")}
          body={t(
            'Remove {member} from "{project}"? They will lose access to guides in this project unless they have access another way.',
            {
              member: memberRemoveCandidate.displayName,
              project: currentProject?.name ?? t("this project"),
            },
          )}
          confirmLabel={t("Remove Member")}
          tone="danger"
          onCancel={() => setMemberRemoveCandidate(undefined)}
          onConfirm={() => void removeMember(memberRemoveCandidate)}
        />
      )}
      {moveCandidateProjectId && (
        <ConfirmDialog
          title={t("Move guide?")}
          body={t(
            'Move "{title}" to "{project}"? Access will change immediately because users inherit guide access from the destination project.',
            {
              title: recording.title,
              project:
                projects.find(
                  (project) => project.id === moveCandidateProjectId,
                )?.name ?? t("the selected project"),
            },
          )}
          confirmLabel={t("Move Guide")}
          onCancel={() => setMoveCandidateProjectId(undefined)}
          onConfirm={() => void moveGuide(moveCandidateProjectId)}
        />
      )}
    </section>
  );
}
