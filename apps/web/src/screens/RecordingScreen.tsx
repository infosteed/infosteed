// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import type { CurrentUser } from "@infosteed/shared";
import type { BrandingSettings } from "@infosteed/shared";
import { AlertTriangle } from "lucide-react";
import { VideoEditor } from "../VideoEditor";
import { BrandMark } from "../components/BrandMark";
import { AppShell } from "../components/design/AppShell";
import { GuideWorkspace } from "../features/recording/GuideWorkspace";
import { RecordingDrawers } from "../features/recording/RecordingDrawers";
import { RecordingHeader } from "../features/recording/RecordingHeader";
import { RecordingMediaViewer } from "../features/recording/RecordingMediaViewer";
import type { RecordingController } from "../features/recording/useRecordingController";
import { t } from "../i18n";
import { resolveRecordingView, type AppView } from "../navigation";

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
  const { recording, video, setVideo, error, viewOnly, setViewOnly, load } =
    recordingController;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const guideEditRouteApplied = useRef(false);

  useEffect(() => {
    if (
      !guideEditRouteApplied.current &&
      requestedView === "guide-edit" &&
      recording &&
      recording.captureMode !== "video" &&
      recording.userRole &&
      ["admin", "owner", "editor"].includes(recording.userRole)
    ) {
      guideEditRouteApplied.current = true;
      setViewOnly(false);
    }
  }, [recording, requestedView, setViewOnly]);

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

  const contentView = resolveRecordingView(
    requestedView,
    recording.captureMode,
  );
  const showVideo = contentView === "video" || contentView === "both";
  const showGuide = contentView === "guide" || contentView === "both";
  const combinedView = viewOnly && showVideo && showGuide && Boolean(video);
  const emptyFinalizedGuide =
    recording.captureMode !== "video" &&
    recording.state === "finalized" &&
    recording.events.length === 0 &&
    recording.steps.length === 0 &&
    recording.items.length === 0;

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
        <RecordingHeader
          controller={recordingController}
          contentView={contentView}
        />
        {emptyFinalizedGuide && (
          <div className="empty-guide-warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>{t("No guide actions were captured")}</strong>
              <p>
                {t(
                  "This recording has no captured guide steps. You can add steps manually or record the workflow again.",
                )}
              </p>
            </div>
          </div>
        )}
        <div className="recording-workspace-container">
          <div
            className={`recording-workspace${combinedView ? " combined" : ""}`}
          >
            <div className="recording-video-column">
              {showVideo && (
                <RecordingMediaViewer controller={recordingController} />
              )}
            </div>
            <div className="recording-guide-column">
              {showGuide && (
                <GuideWorkspace
                  controller={recordingController}
                  showViewNavigation={viewOnly && contentView === "guide"}
                />
              )}
            </div>
          </div>
        </div>
        <RecordingDrawers user={user} controller={recordingController} />
      </div>
    </AppShell>
  );
}
