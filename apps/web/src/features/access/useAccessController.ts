// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from "react";
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
} from "../../api";
import { errorMessage } from "../../errors";
import {
  canManageProjectMembers,
  canMoveRecording,
  editableProjects as projectsEditableByUser,
} from "./model";

export function useAccessController({
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
  const [error, setError] = useState<string>();
  const [memberRemoveCandidate, setMemberRemoveCandidate] =
    useState<ProjectMember>();
  const [moveCandidateProjectId, setMoveCandidateProjectId] =
    useState<string>();
  const currentProject = projects.find(
    (project) => project.id === recording.projectId,
  );
  const canManageMembers = canManageProjectMembers(user, currentProject);
  const canMoveGuide = canMoveRecording(recording);
  const editableProjects = projectsEditableByUser(projects);
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

  async function addMember() {
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

  return {
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
  };
}
