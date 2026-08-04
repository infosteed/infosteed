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
  setProjectMember,
  updateBranding,
  updateProject,
  updateUser,
} from "../api";
import { errorMessage } from "../errors";
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

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <div>
          <p>Admin</p>
          <h1>Workspace Settings</h1>
        </div>
        <button onClick={onClose}>Close Admin</button>
      </header>
      <div className="admin-shell">
        <nav className="admin-sidebar" aria-label="Admin sections">
          <button
            onClick={() =>
              document.getElementById("admin-branding")?.scrollIntoView()
            }
          >
            Branding
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-users")?.scrollIntoView()
            }
          >
            Users
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-projects")?.scrollIntoView()
            }
          >
            Projects
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-system")?.scrollIntoView()
            }
          >
            System
          </button>
        </nav>
        <section className="admin-content">
          <article id="admin-system" className="admin-section">
            <div className="section-title">
              <div>
                <p>Operations</p>
                <h2>Providers and workers</h2>
              </div>
              <span className="status-pill neutral">
                Protocol {systemStatus?.protocolVersion ?? "-"}
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
                <p>Deployment</p>
                <h2>Branding</h2>
              </div>
              <span className="status-pill neutral">Global</span>
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
                Display name
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
                Upload Icon
              </label>
            </div>
          </article>

          <article id="admin-users" className="admin-section">
            <div className="section-title">
              <div>
                <p>Access</p>
                <h2>Users</h2>
              </div>
              <span className="status-pill neutral">{users.length} total</span>
            </div>
            <form
              className="create-user-bar"
              onSubmit={(event) => void addUser(event)}
            >
              <input
                placeholder="Username"
                value={newUser.username}
                onChange={(event) =>
                  setNewUser({ ...newUser, username: event.target.value })
                }
              />
              <input
                placeholder="Display name"
                value={newUser.displayName}
                onChange={(event) =>
                  setNewUser({ ...newUser, displayName: event.target.value })
                }
              />
              <input
                type="password"
                placeholder="Temporary password"
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
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button>Create</button>
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
                    {user.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <select
                    value={user.role}
                    onChange={(event) =>
                      void updateUser(user.id, {
                        role: event.target.value as "admin" | "user",
                      }).then(load)
                    }
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() =>
                      void updateUser(user.id, { enabled: !user.enabled }).then(
                        load,
                      )
                    }
                  >
                    {user.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              ))}
            </div>
          </article>

          <article id="admin-projects" className="admin-section">
            <div className="section-title">
              <div>
                <p>Sharing</p>
                <h2>Projects and Members</h2>
              </div>
              <span className="status-pill neutral">
                {projects.length} projects
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
                    <small>{project.private ? "Private" : "Shared"}</small>
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
                          {project.description ?? "No description set"}
                        </span>
                      </div>
                      <button
                        onClick={() => void toggleProjectPrivate(project)}
                      >
                        {project.private ? "Make Shared" : "Make Private"}
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
                    <option value="">Select user</option>
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
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button>Add Member</button>
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
                        {member.role}
                      </span>
                      <span
                        className={`status-pill ${member.enabled ? "success" : "danger"}`}
                      >
                        {member.enabled ? "Enabled" : "Disabled"}
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
                        Remove
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
    </main>
  );
}
