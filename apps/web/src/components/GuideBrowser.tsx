// SPDX-License-Identifier: AGPL-3.0-only
import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
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
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  getTwoFactorStatus,
  imageUrl,
  importProject,
  listProjects,
  listRecordings,
  regenerateTwoFactorRecoveryCodes,
  restoreRecording,
  startTwoFactorEnrollment,
} from "../api";
import { errorMessage } from "../errors";
import { plural, t } from "../i18n";
import { openRecording, recordingUrl } from "../navigation";
import { BrandMark, productLogoUrl } from "./BrandMark";
import { ConfirmDialog } from "./ConfirmDialog";
import { LanguageSelect } from "./LanguageSelect";

function AccountSecurityDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] =
    useState<Awaited<ReturnType<typeof getTwoFactorStatus>>>();
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<
    Awaited<ReturnType<typeof startTwoFactorEnrollment>> | undefined
  >();
  const [qrCode, setQrCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | undefined>();

  async function load() {
    try {
      setStatus(await getTwoFactorStatus());
      setError(undefined);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function startEnrollment(event: React.FormEvent) {
    event.preventDefault();
    try {
      const nextChallenge = await startTwoFactorEnrollment({ currentPassword });
      setChallenge(nextChallenge);
      setQrCode(await QRCode.toDataURL(nextChallenge.otpauthUri));
      setCode("");
      setError(undefined);
    } catch (startError) {
      setError(errorMessage(startError));
    }
  }

  async function confirmEnrollment(event: React.FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    try {
      const result = await confirmTwoFactorEnrollment({
        continuationToken: challenge.continuationToken,
        code,
      });
      setRecoveryCodes(result.recoveryCodes);
      setChallenge(undefined);
      setCurrentPassword("");
      setCode("");
      await load();
    } catch (confirmError) {
      setError(errorMessage(confirmError));
    }
  }

  async function regenerateCodes(event: React.FormEvent) {
    event.preventDefault();
    try {
      const result = await regenerateTwoFactorRecoveryCodes({
        currentPassword,
        code,
      });
      setRecoveryCodes(result.recoveryCodes);
      setCurrentPassword("");
      setCode("");
      await load();
    } catch (regenerateError) {
      setError(errorMessage(regenerateError));
    }
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault();
    try {
      await disableTwoFactor({ currentPassword, code });
      setRecoveryCodes([]);
      setCurrentPassword("");
      setCode("");
      await load();
    } catch (disableError) {
      setError(errorMessage(disableError));
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal-panel security-dialog">
        <header>
          <div>
            <p>{t("Account")}</p>
            <h2>{t("Security")}</h2>
          </div>
          <button onClick={onClose}>{t("Close")}</button>
        </header>
        {status && (
          <div className="settings-strip">
            <span>
              <strong>{t("2FA")}</strong>:{" "}
              {status.enabled ? t("Enabled") : t("Disabled")}
            </span>
            <span>
              <strong>{t("Requirement")}</strong>:{" "}
              {status.required ? t("Required") : t("Optional")}
            </span>
            <span>
              <strong>{t("Recovery codes")}</strong>:{" "}
              {status.recoveryCodesRemaining}
            </span>
          </div>
        )}
        {recoveryCodes.length > 0 && (
          <div className="recovery-codes">
            <p>
              {t(
                "These recovery codes are shown once. Store them somewhere safe.",
              )}
            </p>
            <pre>{recoveryCodes.join("\n")}</pre>
          </div>
        )}
        {!status?.enabled && status?.enrollmentAvailable && !challenge && (
          <form onSubmit={(event) => void startEnrollment(event)}>
            <label>
              {t("Current password")}
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button>{t("Start 2FA setup")}</button>
          </form>
        )}
        {!status?.enabled && status && !status.enrollmentAvailable && (
          <p>{t("New 2FA enrollment is disabled for this deployment.")}</p>
        )}
        {challenge && (
          <form onSubmit={(event) => void confirmEnrollment(event)}>
            <div className="two-factor-setup">
              {qrCode && <img src={qrCode} alt={t("2FA QR code")} />}
              <p>{t("Scan the QR code or enter this setup key manually.")}</p>
              <code>{challenge.manualSecret}</code>
              <small>{challenge.otpauthUri}</small>
            </div>
            <label>
              {t("Authenticator code")}
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
              />
            </label>
            <button>{t("Enable 2FA")}</button>
          </form>
        )}
        {status?.enabled && (
          <form onSubmit={(event) => void regenerateCodes(event)}>
            <label>
              {t("Current password")}
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label>
              {t("2FA or recovery code")}
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
              />
            </label>
            <button>{t("Regenerate recovery codes")}</button>
            <button
              type="button"
              className="danger-action"
              onClick={(event) =>
                void disable(event as unknown as React.FormEvent)
              }
            >
              {t("Disable 2FA")}
            </button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  );
}

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
  if (days === 0) return t("today");
  if (days === 1) return t("1 day ago");
  if (days < 31) return plural("{count} day ago", "{count} days ago", days);
  const months = Math.floor(days / 30);
  return plural("{count} month ago", "{count} months ago", months);
}

function daysUntil(value: string | null | undefined): string {
  if (!value) return "";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return t("expires today");
  return plural("{count} day left", "{count} days left", days);
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
  const [securityOpen, setSecurityOpen] = useState(false);
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
          <p>{t("Library")}</p>
          <div className="brand-heading">
            <BrandMark src={branding.iconDataUrl || productLogoUrl} />
            <h1>{branding.displayName || "InfoSteed"}</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="user-chip">{user.displayName}</span>
          {user.role === "admin" && (
            <button onClick={onOpenAdmin}>{t("Admin")}</button>
          )}
          <button onClick={() => setSecurityOpen(true)}>{t("Security")}</button>
          <LanguageSelect compact />
          <button onClick={onLogout}>{t("Log Out")}</button>
          <button onClick={onLogoutAll}>{t("Log Out All Sessions")}</button>
        </div>
      </header>
      <section className="browser-shell">
        {securityOpen && (
          <AccountSecurityDialog onClose={() => setSecurityOpen(false)} />
        )}
        <div className="browser-head">
          <div>
            <h2>{scope === "trash" ? t("Trash") : t("Recordings")}</h2>
            <p>
              {plural(
                "{count} accessible recording",
                "{count} accessible recordings",
                guides.length,
              )}
            </p>
          </div>
          <div className="browser-controls">
            <input
              placeholder={t("Search recordings")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{t("All projects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button onClick={() => importInputRef.current?.click()}>
              {t("Import Project")}
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
              <option value="all">{t("All access")}</option>
              <option value="owned">{t("Owned")}</option>
              <option value="shared">{t("Shared")}</option>
              <option value="trash">{t("Trash")}</option>
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="recent">{t("Recent")}</option>
              <option value="title">{t("Title")}</option>
            </select>
            <button onClick={() => setView(view === "grid" ? "list" : "grid")}>
              {view === "grid" ? t("List") : t("Grid")}
            </button>
          </div>
        </div>
        <form
          className="quick-project"
          onSubmit={(event) => void addProject(event)}
        >
          <input
            placeholder={t("New private project")}
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
          />
          <button>{t("Create Project")}</button>
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
                  {guide.projectName ?? t("Private")} ·{" "}
                  {guide.captureMode === "both"
                    ? t("Video + Guide")
                    : guide.captureMode === "video"
                      ? t("Video")
                      : t("Guide")}
                </p>
                <h3>{guide.title}</h3>
                {guide.overview && (
                  <p className="guide-snippet">{guide.overview}</p>
                )}
                <small>
                  {guide.deletedAt
                    ? t("Deleted {age} · {remaining}", {
                        age: age(guide.deletedAt),
                        remaining: daysUntil(guide.restorableUntil),
                      })
                    : age(guide.updatedAt)}{" "}
                  · {guide.ownerDisplayName ?? t("Unknown owner")} ·{" "}
                  {plural("{count} step", "{count} steps", guide.stepCount)} ·{" "}
                  {t(guide.userRole)}
                </small>
              </a>
              <div className="guide-card-actions">
                {guide.deletedAt ? (
                  <button onClick={() => void restoreGuide(guide)}>
                    {t("Restore")}
                  </button>
                ) : (
                  <button
                    className="danger-action"
                    onClick={() => setDeleteCandidate(guide)}
                  >
                    {t("Delete")}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      {deleteCandidate && (
        <ConfirmDialog
          title={t("Delete guide?")}
          body={t(
            '"{title}" will move to Trash and can be restored for 10 days.',
            {
              title: deleteCandidate.title,
            },
          )}
          confirmLabel={t("Delete Guide")}
          tone="danger"
          onCancel={() => setDeleteCandidate(undefined)}
          onConfirm={() => void deleteGuide(deleteCandidate)}
        />
      )}
    </main>
  );
}
