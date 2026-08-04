// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useState } from "react";
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
} from "../api";
import { errorMessage } from "../errors";
import { plural, t } from "../i18n";
import { BrandMark, productLogoUrl } from "./BrandMark";

export function AdminPanel({ onClose }: { onClose: () => void }) {
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
  const [error, setError] = useState<string | undefined>();
  const [systemStatus, setSystemStatus] =
    useState<Awaited<ReturnType<typeof getAdminSystemStatus>>>();
  const [twoFactorResetUser, setTwoFactorResetUser] = useState<
    CurrentUser | undefined
  >();
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
      if (nextProjectId) {
        setMembers((await listProjectMembers(nextProjectId)).members);
      } else {
        setMembers([]);
      }
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

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
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

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
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

  async function confirmTwoFactorReset(event: React.FormEvent) {
    event.preventDefault();
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

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <div>
          <p>{t("Admin")}</p>
          <h1>{t("Workspace Settings")}</h1>
        </div>
        <button onClick={onClose}>{t("Close Admin")}</button>
      </header>
      <div className="admin-shell">
        <nav className="admin-sidebar" aria-label={t("Admin sections")}>
          <button
            onClick={() =>
              document.getElementById("admin-branding")?.scrollIntoView()
            }
          >
            {t("Branding")}
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-users")?.scrollIntoView()
            }
          >
            {t("Users")}
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-projects")?.scrollIntoView()
            }
          >
            {t("Projects")}
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-system")?.scrollIntoView()
            }
          >
            {t("System")}
          </button>
        </nav>
        <section className="admin-content">
          <article id="admin-system" className="admin-section">
            <div className="section-title">
              <div>
                <p>{t("Operations")}</p>
                <h2>{t("Providers and workers")}</h2>
              </div>
              <span className="status-pill neutral">
                {t("Protocol {protocol}", {
                  protocol: systemStatus?.protocolVersion ?? "-",
                })}
              </span>
            </div>
            <div className="settings-strip">
              {Object.entries(systemStatus?.providers ?? {}).map(
                ([name, value]) => (
                  <span key={name}>
                    <strong>{name}</strong>: {value}
                  </span>
                ),
              )}
              {Object.entries(systemStatus?.workers ?? {}).map(
                ([name, value]) => (
                  <span key={name}>
                    <strong>{name} worker</strong>: {value}
                  </span>
                ),
              )}
              {Object.entries(systemStatus?.queues ?? {}).map(
                ([name, value]) => (
                  <span key={name}>
                    <strong>{name} queued</strong>: {value}
                  </span>
                ),
              )}
            </div>
          </article>
          <article id="admin-branding" className="admin-section">
            <div className="section-title">
              <div>
                <p>{t("Deployment")}</p>
                <h2>{t("Branding")}</h2>
              </div>
              <span className="status-pill neutral">{t("Global")}</span>
            </div>
            <div className="settings-strip">
              <div className="brand-tile">
                {branding.iconDataUrl ? (
                  <BrandMark
                    className="brand-preview"
                    src={branding.iconDataUrl}
                  />
                ) : (
                  <BrandMark className="brand-preview" src={productLogoUrl} />
                )}
              </div>
              <label>
                {t("Display name")}
                <input
                  value={branding.displayName}
                  onChange={(event) =>
                    setBranding({
                      ...branding,
                      displayName: event.target.value,
                    })
                  }
                  onBlur={() =>
                    void updateBranding({ displayName: branding.displayName })
                  }
                />
              </label>
              <label className="file-picker">
                <input
                  type="file"
                  accept="image/png,image/webp,image/svg+xml"
                  onChange={(event) => void readIcon(event.target.files?.[0])}
                />
                {t("Upload Icon")}
              </label>
            </div>
          </article>

          <article id="admin-users" className="admin-section">
            <div className="section-title">
              <div>
                <p>{t("Access")}</p>
                <h2>{t("Users")}</h2>
              </div>
              <span className="status-pill neutral">
                {t("{count} total", { count: users.length })}
              </span>
            </div>
            <form
              className="create-user-bar"
              onSubmit={(event) => void addUser(event)}
            >
              <input
                placeholder={t("Username")}
                value={newUser.username}
                onChange={(event) =>
                  setNewUser({ ...newUser, username: event.target.value })
                }
              />
              <input
                placeholder={t("Display name")}
                value={newUser.displayName}
                onChange={(event) =>
                  setNewUser({ ...newUser, displayName: event.target.value })
                }
              />
              <input
                type="password"
                placeholder={t("Temporary password")}
                value={newUser.password}
                onChange={(event) =>
                  setNewUser({ ...newUser, password: event.target.value })
                }
              />
              <select
                value={newUser.role}
                onChange={(event) =>
                  setNewUser({
                    ...newUser,
                    role: event.target.value as "admin" | "user",
                  })
                }
              >
                <option value="user">{t("User")}</option>
                <option value="admin">{t("Admin")}</option>
              </select>
              <button>{t("Create")}</button>
            </form>
            <div className="admin-table">
              {users.map((user) => (
                <div key={user.id} className="admin-row">
                  <div>
                    <strong>{user.displayName}</strong>
                    <span>{user.username}</span>
                  </div>
                  <span
                    className={`status-pill ${user.enabled ? "success" : "danger"}`}
                  >
                    {user.enabled ? t("Enabled") : t("Disabled")}
                  </span>
                  <span
                    className={`status-pill ${user.twoFactorEnabled ? "success" : "neutral"}`}
                  >
                    {user.twoFactorEnabled ? t("2FA enabled") : t("2FA off")}
                  </span>
                  <select
                    value={user.role}
                    onChange={(event) =>
                      void updateUser(user.id, {
                        role: event.target.value as "admin" | "user",
                      }).then(load)
                    }
                  >
                    <option value="user">{t("User")}</option>
                    <option value="admin">{t("Admin")}</option>
                  </select>
                  <button
                    onClick={() =>
                      void updateUser(user.id, { enabled: !user.enabled }).then(
                        load,
                      )
                    }
                  >
                    {user.enabled ? t("Disable") : t("Enable")}
                  </button>
                  <button
                    onClick={() =>
                      void updateUser(user.id, {
                        twoFactorRequired: !user.twoFactorRequired,
                      }).then(load, (updateError) =>
                        setError(errorMessage(updateError)),
                      )
                    }
                  >
                    {user.twoFactorRequired
                      ? t("Make 2FA Optional")
                      : t("Require 2FA")}
                  </button>
                  <button onClick={() => setTwoFactorResetUser(user)}>
                    {t("Reset 2FA")}
                  </button>
                </div>
              ))}
            </div>
          </article>

          <article id="admin-projects" className="admin-section">
            <div className="section-title">
              <div>
                <p>{t("Sharing")}</p>
                <h2>{t("Projects and Members")}</h2>
              </div>
              <span className="status-pill neutral">
                {plural("{count} project", "{count} projects", projects.length)}
              </span>
            </div>
            <div className="project-manager">
              <div className="project-list">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={
                      selectedProjectId === project.id ? "active" : undefined
                    }
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span>{project.name}</span>
                    <small>
                      {project.private ? t("Private") : t("Shared")}
                    </small>
                  </button>
                ))}
              </div>
              <div className="member-panel">
                {projects
                  .filter((project) => project.id === selectedProjectId)
                  .map((project) => (
                    <div key={project.id} className="member-head">
                      <div>
                        <strong>{project.name}</strong>
                        <span>
                          {project.description ?? t("No description set")}
                        </span>
                      </div>
                      <button
                        onClick={() => void toggleProjectPrivate(project)}
                      >
                        {project.private ? t("Make Shared") : t("Make Private")}
                      </button>
                    </div>
                  ))}
                <form
                  className="member-form"
                  onSubmit={(event) => void addMember(event)}
                >
                  <select
                    value={memberUserId}
                    onChange={(event) => setMemberUserId(event.target.value)}
                  >
                    <option value="">{t("Select user")}</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName} ({user.username})
                      </option>
                    ))}
                  </select>
                  <select
                    value={memberRole}
                    onChange={(event) =>
                      setMemberRole(event.target.value as "editor" | "viewer")
                    }
                  >
                    <option value="viewer">{t("Viewer")}</option>
                    <option value="editor">{t("Editor")}</option>
                  </select>
                  <button>{t("Add Member")}</button>
                </form>
                <div className="admin-table">
                  {members.map((member) => (
                    <div key={member.userId} className="admin-row">
                      <div>
                        <strong>{member.displayName}</strong>
                        <span>{member.username}</span>
                      </div>
                      <span
                        className={`status-pill ${member.role === "owner" ? "owner" : "neutral"}`}
                      >
                        {t(member.role)}
                      </span>
                      <span
                        className={`status-pill ${member.enabled ? "success" : "danger"}`}
                      >
                        {member.enabled ? t("Enabled") : t("Disabled")}
                      </span>
                      <button
                        disabled={member.role === "owner"}
                        onClick={() =>
                          void removeProjectMember(
                            member.projectId,
                            member.userId,
                          ).then(() =>
                            listProjectMembers(member.projectId).then(
                              (result) => setMembers(result.members),
                            ),
                          )
                        }
                      >
                        {t("Remove")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
      {twoFactorResetUser && (
        <div className="modal-backdrop">
          <form
            className="confirm-dialog two-factor-reset-dialog"
            onSubmit={(event) => void confirmTwoFactorReset(event)}
          >
            <h2>{t("Reset 2FA")}</h2>
            <p>
              {t("Reset 2FA for {username}. Their sessions will be revoked.", {
                username: twoFactorResetUser.username,
              })}
            </p>
            <label>
              {t("Your current password")}
              <input
                type="password"
                value={twoFactorResetProof.currentPassword}
                onChange={(event) =>
                  setTwoFactorResetProof({
                    ...twoFactorResetProof,
                    currentPassword: event.target.value,
                  })
                }
                autoComplete="current-password"
              />
            </label>
            <label>
              {t("Your 2FA or recovery code")}
              <input
                value={twoFactorResetProof.code}
                onChange={(event) =>
                  setTwoFactorResetProof({
                    ...twoFactorResetProof,
                    code: event.target.value,
                  })
                }
                autoComplete="one-time-code"
              />
            </label>
            <div className="confirm-actions">
              <button
                type="button"
                onClick={() => setTwoFactorResetUser(undefined)}
              >
                {t("Cancel")}
              </button>
              <button className="danger-action">{t("Reset 2FA")}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
