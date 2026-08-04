// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import type {
  BrandingSettings,
  CurrentUser,
  Project,
  ProjectMember,
} from "@infosteed/shared";
import {
  createUser,
  getAdminSystemStatus,
  getBranding,
  listProjectMembers,
  listProjects,
  listUsers,
  removeProjectMember,
  resetUserTwoFactor,
  setProjectMember,
  updateBranding,
  updateProject,
  updateUser,
} from "../../api";
import { errorMessage } from "../../errors";

export function useAdminController() {
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"editor" | "viewer">("viewer");
  const [branding, setBranding] = useState<BrandingSettings>({
    displayName: "InfoSteed",
    iconDataUrl: null,
  });
  const [newUser, setNewUser] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "user" as "admin" | "user",
  });
  const [error, setError] = useState<string>();
  const [systemStatus, setSystemStatus] =
    useState<Awaited<ReturnType<typeof getAdminSystemStatus>>>();
  const [twoFactorResetUser, setTwoFactorResetUser] = useState<CurrentUser>();
  const [twoFactorResetProof, setTwoFactorResetProof] = useState({
    currentPassword: "",
    code: "",
  });

  async function load() {
    try {
      const [userResult, brandingResult, projectResult, nextSystemStatus] =
        await Promise.all([
          listUsers(),
          getBranding(),
          listProjects(),
          getAdminSystemStatus(),
        ]);
      setUsers(userResult.users);
      setBranding(brandingResult);
      setProjects(projectResult.projects);
      setSystemStatus(nextSystemStatus);
      const nextProjectId =
        selectedProjectId || projectResult.projects[0]?.id || "";
      setSelectedProjectId(nextProjectId);
      setMembers(
        nextProjectId ? (await listProjectMembers(nextProjectId)).members : [],
      );
      setError(undefined);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setMembers([]);
      return;
    }
    void listProjectMembers(selectedProjectId).then((result) =>
      setMembers(result.members),
    );
  }, [selectedProjectId]);

  async function addUser() {
    await createUser(newUser);
    setNewUser({ username: "", displayName: "", password: "", role: "user" });
    await load();
  }

  async function readIcon(file?: File) {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setBranding(await updateBranding({ iconDataUrl: dataUrl }));
  }

  async function updateBrandingName() {
    await updateBranding({ displayName: branding.displayName });
  }

  async function addMember() {
    if (!selectedProjectId || !memberUserId) return;
    await setProjectMember(selectedProjectId, {
      userId: memberUserId,
      role: memberRole,
    });
    setMembers((await listProjectMembers(selectedProjectId)).members);
  }

  async function toggleProjectPrivate(project: Project) {
    await updateProject(project.id, { private: !project.private });
    await load();
  }

  async function updateUserRole(userId: string, role: "admin" | "user") {
    await updateUser(userId, { role });
    await load();
  }

  async function toggleUserEnabled(user: CurrentUser) {
    await updateUser(user.id, { enabled: !user.enabled });
    await load();
  }

  async function toggleTwoFactorRequirement(user: CurrentUser) {
    try {
      await updateUser(user.id, {
        twoFactorRequired: !user.twoFactorRequired,
      });
      await load();
    } catch (updateError) {
      setError(errorMessage(updateError));
    }
  }

  async function removeMember(member: ProjectMember) {
    await removeProjectMember(member.projectId, member.userId);
    setMembers((await listProjectMembers(member.projectId)).members);
  }

  async function confirmTwoFactorReset() {
    if (!twoFactorResetUser) return;
    try {
      await resetUserTwoFactor(twoFactorResetUser.id, {
        currentPassword: twoFactorResetProof.currentPassword,
        code: twoFactorResetProof.code || undefined,
      });
      setTwoFactorResetUser(undefined);
      setTwoFactorResetProof({ currentPassword: "", code: "" });
      await load();
    } catch (resetError) {
      setError(errorMessage(resetError));
    }
  }

  return {
    users,
    projects,
    members,
    selectedProjectId,
    setSelectedProjectId,
    memberUserId,
    setMemberUserId,
    memberRole,
    setMemberRole,
    branding,
    setBranding,
    newUser,
    setNewUser,
    error,
    systemStatus,
    twoFactorResetUser,
    setTwoFactorResetUser,
    twoFactorResetProof,
    setTwoFactorResetProof,
    addUser,
    readIcon,
    updateBrandingName,
    addMember,
    toggleProjectPrivate,
    updateUserRole,
    toggleUserEnabled,
    toggleTwoFactorRequirement,
    removeMember,
    confirmTwoFactorReset,
  };
}
