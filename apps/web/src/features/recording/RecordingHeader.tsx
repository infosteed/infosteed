// SPDX-License-Identifier: AGPL-3.0-only
import {
  exportUrl,
  htmlExportUrl,
  pdfExportUrl,
  projectExportUrl,
  sanityExportUrl,
  wordExportUrl,
} from "../../api";
import {
  BookOpen,
  CirclePlus,
  Clapperboard,
  Columns2,
  Ellipsis,
  Eye,
  EyeOff,
  KeyRound,
  Film,
  PanelTopClose,
  Pencil,
  Trash2,
} from "lucide-react";
import { LanguageSelect } from "../../components/LanguageSelect";
import { GuideIconButton } from "../guide/GuideIconButton";
import { t } from "../../i18n";
import { openRecording, type RecordingView } from "../../navigation";
import type { RecordingController } from "./useRecordingController";

export function RecordingHeader({
  controller,
  contentView,
}: {
  controller: RecordingController;
  contentView: RecordingView;
}) {
  const {
    recording,
    viewOnly,
    setViewOnly,
    setSelectedItemId,
    previewOpen,
    setPreviewOpen,
    headerMoreRef,
    setHeaderMoreOpen,
    setAccessOpen,
    setVersionsOpen,
    captureMoreStatus,
    handleCaptureMore,
    importInputRef,
    handleProjectImport,
    setDeleteCurrentOpen,
  } = controller;
  if (!recording) return null;

  const importControl = (
    <>
      <button
        onClick={() => {
          headerMoreRef.current?.removeAttribute("open");
          importInputRef.current?.click();
        }}
      >
        {t("Import Project")}
      </button>
      <input
        ref={importInputRef}
        className="hidden-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void handleProjectImport(event.target.files?.[0])}
      />
    </>
  );

  return (
    <header>
      <div>
        <p>
          {contentView === "both"
            ? t("Video + Workflow Guide")
            : contentView === "video"
              ? t("Video Recording")
              : t("Workflow Guide")}
        </p>
        <h1>{recording.title}</h1>
      </div>
      <div className="header-actions">
        <LanguageSelect compact iconOnly />
        {viewOnly && recording.captureMode === "both" && (
          <>
            {contentView !== "video" && (
              <GuideIconButton
                label={t("View video")}
                onClick={() => openRecording(recording.id, "video")}
              >
                <Film aria-hidden="true" />
              </GuideIconButton>
            )}
            {contentView !== "guide" && (
              <GuideIconButton
                label={t("View guide")}
                onClick={() => openRecording(recording.id, "guide")}
              >
                <BookOpen aria-hidden="true" />
              </GuideIconButton>
            )}
            {contentView !== "both" && (
              <GuideIconButton
                label={t("View both")}
                onClick={() => openRecording(recording.id, "both")}
              >
                <Columns2 aria-hidden="true" />
              </GuideIconButton>
            )}
          </>
        )}
        {(recording.userRole === "admin" ||
          recording.userRole === "owner" ||
          recording.userRole === "editor") &&
          recording.captureMode !== "video" && (
            <GuideIconButton
              label={viewOnly ? t("Edit guide") : t("Close guide editor")}
              onClick={() => {
                if (viewOnly && contentView === "video") {
                  openRecording(recording.id, "guide-edit");
                  return;
                }
                setViewOnly((current) => {
                  if (!current) {
                    setSelectedItemId("");
                    setPreviewOpen(false);
                    setAccessOpen(false);
                    setVersionsOpen(false);
                  }
                  return !current;
                });
              }}
            >
              {viewOnly ? (
                <Pencil aria-hidden="true" />
              ) : (
                <PanelTopClose aria-hidden="true" />
              )}
            </GuideIconButton>
          )}
        {viewOnly &&
          (recording.userRole === "admin" ||
            recording.userRole === "owner" ||
            recording.userRole === "editor") &&
          recording.captureMode !== "guide" && (
            <GuideIconButton
              label={t("Edit video")}
              onClick={() => openRecording(recording.id, "video-edit")}
            >
              <Clapperboard aria-hidden="true" />
            </GuideIconButton>
          )}
        {!viewOnly && recording.captureMode !== "video" && (
          <>
            <GuideIconButton
              label={previewOpen ? t("Close preview") : t("Preview")}
              onClick={() => {
                setPreviewOpen(!previewOpen);
                setAccessOpen(false);
                setVersionsOpen(false);
              }}
            >
              {previewOpen ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
            </GuideIconButton>
            <GuideIconButton
              label={
                captureMoreStatus === "starting"
                  ? t("Starting Capture...")
                  : t("Capture More")
              }
              disabled={captureMoreStatus === "starting"}
              onClick={() => void handleCaptureMore()}
            >
              <CirclePlus aria-hidden="true" />
            </GuideIconButton>
            <details
              ref={headerMoreRef}
              className="header-more-menu"
              onToggle={(event) => setHeaderMoreOpen(event.currentTarget.open)}
            >
              <summary aria-label={t("More")} title={t("More")}>
                <Ellipsis aria-hidden="true" />
              </summary>
              <div className="header-more-panel">
                <button
                  onClick={() => {
                    headerMoreRef.current?.removeAttribute("open");
                    setAccessOpen(true);
                    setPreviewOpen(false);
                    setVersionsOpen(false);
                  }}
                >
                  {t("Access")}
                </button>
                <button
                  onClick={() => {
                    headerMoreRef.current?.removeAttribute("open");
                    setVersionsOpen(true);
                    setPreviewOpen(false);
                    setAccessOpen(false);
                  }}
                >
                  {t("Versions")}
                </button>
                {importControl}
                <span className="header-more-label">{t("Export")}</span>
                <a href={projectExportUrl(recording.id)}>{t("Project")}</a>
                <a href={htmlExportUrl(recording.id)}>HTML</a>
                <a href={wordExportUrl(recording.id)}>Word</a>
                <a href={pdfExportUrl(recording.id)}>PDF</a>
                <a href={sanityExportUrl(recording.id)}>Sanity</a>
                <a href={exportUrl(recording.id)}>ZIP</a>
                <button
                  className="danger-action header-more-danger"
                  onClick={() => {
                    headerMoreRef.current?.removeAttribute("open");
                    setDeleteCurrentOpen(true);
                  }}
                >
                  {recording.captureMode === "guide"
                    ? t("Delete Guide")
                    : t("Delete Recording")}
                </button>
              </div>
            </details>
          </>
        )}
        {recording.captureMode === "video" && (
          <>
            <GuideIconButton
              label={t("Access")}
              onClick={() => {
                setAccessOpen(true);
                setPreviewOpen(false);
                setVersionsOpen(false);
              }}
            >
              <KeyRound aria-hidden="true" />
            </GuideIconButton>
            <GuideIconButton
              label={t("Delete Recording")}
              tone="danger"
              onClick={() => setDeleteCurrentOpen(true)}
            >
              <Trash2 aria-hidden="true" />
            </GuideIconButton>
          </>
        )}
      </div>
    </header>
  );
}
