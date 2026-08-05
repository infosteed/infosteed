// SPDX-License-Identifier: AGPL-3.0-only
import { useAdminController } from "../features/admin/useAdminController";
import { wordTemplateFileUrl } from "../api";
import { plural, t } from "../i18n";
import { BrandMark, productLogoUrl } from "./BrandMark";
import { StatusBadge } from "./design/StatusBadge";

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const controller = useAdminController();
  const {
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
    wordTemplates,
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
    uploadTemplate,
    renameTemplate,
    setDefaultTemplate,
    removeTemplate,
    addMember,
    toggleProjectPrivate,
    updateUserRole,
    toggleUserEnabled,
    toggleTwoFactorRequirement,
    removeMember,
    confirmTwoFactorReset,
  } = controller;

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
              document.getElementById("admin-word-templates")?.scrollIntoView()
            }
          >
            {t("Word Templates")}
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
            <div className="operations-grid">
              {Object.entries(systemStatus?.providers ?? {}).map(
                ([name, value]) => (
                  <div key={name} className="operation-card">
                    <span>{t("Provider")}</span>
                    <strong>{name}</strong>
                    <StatusBadge
                      variant={value === "configured" ? "success" : "warning"}
                    >
                      {value}
                    </StatusBadge>
                  </div>
                ),
              )}
              {Object.entries(systemStatus?.workers ?? {}).map(
                ([name, value]) => (
                  <div key={name} className="operation-card">
                    <span>{t("Worker")}</span>
                    <strong>{name}</strong>
                    <StatusBadge
                      variant={
                        value === "ready" || value === "enabled"
                          ? "success"
                          : "warning"
                      }
                    >
                      {value}
                    </StatusBadge>
                  </div>
                ),
              )}
              {Object.entries(systemStatus?.queues ?? {}).map(
                ([name, value]) => (
                  <div key={name} className="operation-card">
                    <span>{t("Queue")}</span>
                    <strong>{name}</strong>
                    <StatusBadge variant={value > 0 ? "warning" : "outline"}>
                      {t("{count} queued", { count: value })}
                    </StatusBadge>
                  </div>
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
                  onBlur={() => void updateBrandingName()}
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
          <article id="admin-word-templates" className="admin-section">
            <div className="section-title">
              <div>
                <p>{t("Exports")}</p>
                <h2>{t("Word Templates")}</h2>
              </div>
              <span className="status-pill neutral">
                {t("{count} templates", { count: wordTemplates.length })}
              </span>
            </div>
            <p className="settings-help">
              {t(
                "Templates must contain one block content control tagged INFOSTEED_REPORT_BODY. Tagged metadata controls are filled automatically.",
              )}
            </p>
            <p className="settings-help">
              {t(
                "For 1/1.1 numbering, use Word's built-in Heading 1 and Heading 2 styles linked to the same multilevel list. Compatibility warnings appear after upload.",
              )}
            </p>
            <div className="template-upload-strip">
              <label className="file-picker">
                <input
                  type="file"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => {
                    void uploadTemplate(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
                {t("Upload Word Template")}
              </label>
            </div>
            <div className="admin-table">
              {wordTemplates.map((template) => (
                <div key={template.id} className="admin-row">
                  <div>
                    <input
                      aria-label={t("Template name")}
                      defaultValue={template.name}
                      onBlur={(event) => {
                        if (event.target.value.trim() !== template.name)
                          void renameTemplate(template.id, event.target.value);
                      }}
                    />
                    <small>{template.originalFilename}</small>
                    <small>
                      {t("Tags: {tags}", {
                        tags: template.inspection.foundTags.join(", "),
                      })}
                    </small>
                    {template.inspection.warnings.map((warning) => (
                      <small key={warning}>{warning}</small>
                    ))}
                  </div>
                  <div className="admin-row-actions">
                    {template.isDefault ? (
                      <StatusBadge variant="success">
                        {t("Default")}
                      </StatusBadge>
                    ) : (
                      <button
                        onClick={() => void setDefaultTemplate(template.id)}
                      >
                        {t("Set Default")}
                      </button>
                    )}
                    <a href={wordTemplateFileUrl(template.id)}>
                      {t("Download")}
                    </a>
                    <button
                      className="danger-action"
                      onClick={() => void removeTemplate(template.id)}
                    >
                      {t("Delete")}
                    </button>
                  </div>
                </div>
              ))}
              {wordTemplates.length === 0 && (
                <p>{t("No Word templates uploaded.")}</p>
              )}
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
              onSubmit={(event) => {
                event.preventDefault();
                void addUser();
              }}
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
                      void updateUserRole(
                        user.id,
                        event.target.value as "admin" | "user",
                      )
                    }
                  >
                    <option value="user">{t("User")}</option>
                    <option value="admin">{t("Admin")}</option>
                  </select>
                  <button onClick={() => void toggleUserEnabled(user)}>
                    {user.enabled ? t("Disable") : t("Enable")}
                  </button>
                  <button onClick={() => void toggleTwoFactorRequirement(user)}>
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
                        onClick={() => void removeMember(member)}
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
            onSubmit={(event) => {
              event.preventDefault();
              void confirmTwoFactorReset();
            }}
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
