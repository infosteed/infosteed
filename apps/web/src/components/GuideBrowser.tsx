// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type { BrandingSettings, CurrentUser } from "@infosteed/shared";
import {
  ArchiveRestore,
  Grid2X2,
  Import,
  LayoutList,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import {
  confirmTwoFactorEnrollment,
  disableTwoFactor,
  getTwoFactorStatus,
  imageUrl,
  regenerateTwoFactorRecoveryCodes,
  startTwoFactorEnrollment,
} from "../api";
import { errorMessage } from "../errors";
import { plural, t } from "../i18n";
import {
  recordingAge,
  recordingDaysUntil,
  type LibraryScope,
  type LibrarySort,
} from "../features/library/model";
import { useLibraryController } from "../features/library/useLibraryController";
import { recordingUrl } from "../navigation";
import { BrandMark, productLogoUrl } from "./BrandMark";
import { ConfirmDialog } from "./ConfirmDialog";
import { LanguageSelect } from "./LanguageSelect";
import { ActionMenu } from "./design/ActionMenu";
import { AppShell } from "./design/AppShell";
import { EmptyState } from "./design/EmptyState";
import { PageHeader } from "./design/PageHeader";
import { StatusBadge } from "./design/StatusBadge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu";

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
  const {
    guides,
    projects,
    search,
    setSearch,
    projectId,
    setProjectId,
    scope,
    setScope,
    sort,
    setSort,
    view,
    setView,
    error,
    newProjectName,
    setNewProjectName,
    deleteCandidate,
    setDeleteCandidate,
    addProject,
    importRecordingProject,
    deleteGuide,
    restoreGuide,
  } = useLibraryController();
  const [securityOpen, setSecurityOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(file?: File) {
    try {
      await importRecordingProject(file);
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  return (
    <AppShell
      user={user}
      branding={branding}
      active="library"
      collapsed={sidebarCollapsed}
      onCollapsedChange={setSidebarCollapsed}
      onOpenAdmin={user.role === "admin" ? onOpenAdmin : undefined}
      onOpenSecurity={() => setSecurityOpen(true)}
      onLogout={onLogout}
      onLogoutAll={onLogoutAll}
      topbar={
        <>
          <nav className="breadcrumbs" aria-label={t("Breadcrumbs")}>
            <span>{t("Library")}</span>
            <span>{scope === "trash" ? t("Trash") : t("Recordings")}</span>
          </nav>
          <div className="topbar-actions">
            <LanguageSelect compact />
          </div>
        </>
      }
    >
      <section className="browser-page">
        {securityOpen && (
          <AccountSecurityDialog onClose={() => setSecurityOpen(false)} />
        )}
        <PageHeader
          eyebrow={t("Library")}
          title={scope === "trash" ? t("Trash") : t("Recordings")}
          description={
            <>
              {plural(
                "{count} accessible recording",
                "{count} accessible recordings",
                guides.length,
              )}
            </>
          }
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => importInputRef.current?.click()}
              >
                <Import className="size-4" />
                {t("Import Project")}
              </Button>
              <Dialog
                open={projectDialogOpen}
                onOpenChange={setProjectDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button type="button">
                    <Plus className="size-4" />
                    {t("New project")}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("New project")}</DialogTitle>
                    <DialogDescription>
                      {t(
                        "Create a private project for a focused set of recordings.",
                      )}
                    </DialogDescription>
                  </DialogHeader>
                  <form
                    className="new-project-dialog"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void addProject().then(() => setProjectDialogOpen(false));
                    }}
                  >
                    <label>
                      {t("Project name")}
                      <input
                        autoFocus
                        placeholder={t("New private project")}
                        value={newProjectName}
                        onChange={(event) =>
                          setNewProjectName(event.target.value)
                        }
                      />
                    </label>
                    <div className="dialog-actions">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setProjectDialogOpen(false)}
                      >
                        {t("Cancel")}
                      </Button>
                      <Button type="submit">{t("Create Project")}</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </>
          }
        />
        <div className="browser-shell">
          <div className="library-filterbar">
            <label className="library-search">
              <Search className="size-4" aria-hidden="true" />
              <span>{t("Search recordings")}</span>
              <input
                placeholder={t("Search recordings")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
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
            <input
              ref={importInputRef}
              className="hidden-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as LibraryScope)}
            >
              <option value="all">{t("All access")}</option>
              <option value="owned">{t("Owned")}</option>
              <option value="shared">{t("Shared")}</option>
              <option value="trash">{t("Trash")}</option>
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as LibrarySort)}
            >
              <option value="recent">{t("Recent")}</option>
              <option value="title">{t("Title")}</option>
            </select>
            <Button
              type="button"
              variant="outline"
              onClick={() => setView(view === "grid" ? "list" : "grid")}
            >
              {view === "grid" ? (
                <LayoutList className="size-4" />
              ) : (
                <Grid2X2 className="size-4" />
              )}
              {view === "grid" ? t("List") : t("Grid")}
            </Button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className={view === "grid" ? "guide-grid" : "guide-list"}>
          {guides.length === 0 && (
            <EmptyState
              title={t("No recordings found")}
              description={t("Try another search, project, or access filter.")}
            />
          )}
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
                <StatusBadge className="guide-type-badge" variant="secondary">
                  {guide.captureMode === "both"
                    ? t("Video + Guide")
                    : guide.captureMode === "video"
                      ? t("Video")
                      : t("Guide")}
                </StatusBadge>
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
                <div className="guide-meta-grid">
                  <span>{guide.projectName ?? t("Private")}</span>
                  <span>{guide.ownerDisplayName ?? t("Unknown owner")}</span>
                  <span>
                    {guide.deletedAt
                      ? t("Deleted {age} · {remaining}", {
                          age: recordingAge(guide.deletedAt),
                          remaining: recordingDaysUntil(guide.restorableUntil),
                        })
                      : recordingAge(guide.updatedAt)}
                  </span>
                  <span>
                    {plural("{count} step", "{count} steps", guide.stepCount)}
                  </span>
                </div>
              </a>
              <div className="guide-card-actions">
                <StatusBadge variant="outline">{t(guide.userRole)}</StatusBadge>
                <ActionMenu label={t("Recording actions")}>
                  <DropdownMenuItem asChild>
                    <a
                      href={recordingUrl(
                        guide.id,
                        guide.captureMode === "guide" ? undefined : "video",
                      )}
                    >
                      {t("Open")}
                    </a>
                  </DropdownMenuItem>
                  {guide.deletedAt ? (
                    <DropdownMenuItem onSelect={() => void restoreGuide(guide)}>
                      <ArchiveRestore className="mr-2 size-4" />
                      {t("Restore")}
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-red-700 focus:text-red-700"
                        onSelect={() => setDeleteCandidate(guide)}
                      >
                        <Trash2 className="mr-2 size-4" />
                        {t("Delete")}
                      </DropdownMenuItem>
                    </>
                  )}
                </ActionMenu>
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
    </AppShell>
  );
}
