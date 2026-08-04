// SPDX-License-Identifier: AGPL-3.0-only
import type { CurrentUser, Project, Recording } from "@infosteed/shared";

export function canManageProjectMembers(
  user: CurrentUser,
  project: Project | undefined,
): boolean {
  return user.role === "admin" || project?.role === "owner";
}

export function canMoveRecording(recording: Recording): boolean {
  return (
    recording.userRole === "admin" ||
    recording.userRole === "owner" ||
    recording.userRole === "editor"
  );
}

export function editableProjects(projects: Project[]): Project[] {
  return projects.filter(
    (project) => project.role === "owner" || project.role === "editor",
  );
}
