// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import type { CurrentUser } from "@infosteed/shared";
import type { BrandingSettings } from "@infosteed/shared";
import { VideoEditor } from "../VideoEditor";
import { BrandMark } from "../components/BrandMark";
import { AppShell } from "../components/design/AppShell";
import { GuideWorkspace } from "../features/recording/GuideWorkspace";
import { RecordingDrawers } from "../features/recording/RecordingDrawers";
import { RecordingHeader } from "../features/recording/RecordingHeader";
import { RecordingMediaViewer } from "../features/recording/RecordingMediaViewer";
import type { RecordingController } from "../features/recording/useRecordingController";
import { t } from "../i18n";
import type { AppView } from "../navigation";

export function RecordingScreen({
  user,
  branding,
  requestedView,
  recordingController,
  onOpenAdmin,
  onLogout,
  onLogoutAll,
}: {
  user: CurrentUser;
  branding: BrandingSettings;
  requestedView: AppView | null;
  recordingController: RecordingController;
  onOpenAdmin: () => void;
  onLogout: () => void;
  onLogoutAll: () => void;
}) {
  const { recording, video, setVideo, error, viewOnly, load } =
    recordingController;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  if (error) return <main className="empty">{error}</main>;
  if (!recording)
    return (
      <main className="empty product-loading">
        <BrandMark />
        <p>{t("Loading recording...")}</p>
      </main>
    );
  if (
    requestedView === "video-edit" &&
    video &&
    recording.captureMode !== "guide"
  ) {
    return (
      <VideoEditor
        recording={recording}
        video={video}
        onPublished={setVideo}
        onGenerationFinished={() => void load()}
      />
    );
  }

  return (
    <AppShell
      user={user}
      branding={branding}
      active="recording"
      collapsed={sidebarCollapsed}
      onCollapsedChange={setSidebarCollapsed}
      onOpenAdmin={user.role === "admin" ? onOpenAdmin : undefined}
      onLogout={onLogout}
      onLogoutAll={onLogoutAll}
      topbar={
        <nav className="breadcrumbs" aria-label={t("Breadcrumbs")}>
          <a href="/">{t("Library")}</a>
          <span>{recording.title}</span>
        </nav>
      }
    >
      <div
        className={
          viewOnly ? "view-only-mode recording-page" : "recording-page"
        }
      >
        <RecordingHeader controller={recordingController} />
        <RecordingMediaViewer controller={recordingController} />
        <GuideWorkspace controller={recordingController} />
        <RecordingDrawers user={user} controller={recordingController} />
      </div>
    </AppShell>
  );
}
