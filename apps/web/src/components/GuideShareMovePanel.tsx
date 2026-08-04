// SPDX-License-Identifier: AGPL-3.0-only
import React from "react";
import type { CurrentUser, Recording } from "@infosteed/shared";
import { Shield, UserMinus } from "lucide-react";
import { useAccessController } from "../features/access/useAccessController";
import { t } from "../i18n";
import { Button } from "./ui/button";
import { StatusBadge } from "./design/StatusBadge";
import { UserAvatar } from "./design/UserAvatar";
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
  const {
    projects,
    members,
    memberUserId,
    setMemberUserId,
    memberRole,
    setMemberRole,
    destinationProjectId,
    setDestinationProjectId,
    error,
    memberRemoveCandidate,
    setMemberRemoveCandidate,
    moveCandidateProjectId,
    setMoveCandidateProjectId,
    currentProject,
    canManageMembers,
    canMoveGuide,
    editableProjects,
    memberOptions,
    addMember,
    removeMember,
    moveGuide,
  } = useAccessController({ recording, user, onChanged });

  return (
    <section className="share-panel">
      <div className="share-panel-head">
        <div>
          <p>{t("Project Access")}</p>
          <h2>{currentProject?.name ?? t("No project")}</h2>
        </div>
        {currentProject && (
          <StatusBadge
            variant={currentProject.role === "owner" ? "default" : "outline"}
          >
            {t(currentProject.role ?? "viewer")}
          </StatusBadge>
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
              onSubmit={(event) => {
                event.preventDefault();
                void addMember();
              }}
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
              <Button type="submit" size="sm">
                {t("Add")}
              </Button>
            </form>
          )}
          <div className="compact-member-list">
            {members.map((member) => (
              <div key={member.userId} className="compact-member-row">
                <UserAvatar name={member.displayName} />
                <div>
                  <strong>{member.displayName}</strong>
                  <span>{member.username}</span>
                </div>
                <StatusBadge
                  variant={member.role === "owner" ? "default" : "outline"}
                >
                  {member.role === "owner" && (
                    <Shield className="mr-1 size-3" />
                  )}
                  {t(member.role)}
                </StatusBadge>
                {canManageMembers && member.role !== "owner" && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("Remove")}
                    onClick={() => setMemberRemoveCandidate(member)}
                  >
                    <UserMinus className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="share-box advanced">
          <div className="share-box-head">
            <strong>{t("Advanced")}</strong>
            <span>{t("Access follows project")}</span>
          </div>
          <h3>{t("Move Guide")}</h3>
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
