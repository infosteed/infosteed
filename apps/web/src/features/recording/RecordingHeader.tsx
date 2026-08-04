// SPDX-License-Identifier: AGPL-3.0-only
import {
  exportUrl,
  htmlExportUrl,
  pdfExportUrl,
  projectExportUrl,
  sanityExportUrl,
  wordExportUrl,
} from "../../api";
import { LanguageSelect } from "../../components/LanguageSelect";
import { t } from "../../i18n";
import { openRecording } from "../../navigation";
import type { RecordingController } from "./useRecordingController";

export function RecordingHeader({
  controller,
}: {
  controller: RecordingController;
}) {
  const {
    recording,
    viewOnly,
    setViewOnly,
    setSelectedItemId,
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
          {recording.captureMode === "both"
            ? t("Video + Workflow Guide")
            : recording.captureMode === "video"
              ? t("Video Recording")
              : t("Workflow Guide")}
        </p>
        <h1>{recording.title}</h1>
      </div>
      <div className="header-actions">
        <a href="/">{t("Library")}</a>
        <LanguageSelect compact />
        {(recording.userRole === "admin" ||
          recording.userRole === "owner" ||
          recording.userRole === "editor") &&
          recording.captureMode !== "video" && (
            <button
              onClick={() => {
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
              {viewOnly ? t("Edit guide") : t("Close guide editor")}
            </button>
          )}
        {viewOnly &&
          (recording.userRole === "admin" ||
            recording.userRole === "owner" ||
            recording.userRole === "editor") &&
          recording.captureMode !== "guide" && (
            <button onClick={() => openRecording(recording.id, "video-edit")}>
              {t("Edit video")}
            </button>
          )}
        {!viewOnly && recording.captureMode !== "video" && (
          <>
            <button
              disabled={captureMoreStatus === "starting"}
              onClick={() => void handleCaptureMore()}
            >
              {captureMoreStatus === "starting"
                ? t("Starting Capture...")
                : t("Capture More")}
            </button>
            <details
              ref={headerMoreRef}
              className="header-more-menu"
              onToggle={(event) => setHeaderMoreOpen(event.currentTarget.open)}
            >
              <summary>{t("More")}</summary>
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
            <button
              onClick={() => {
                setAccessOpen(true);
                setPreviewOpen(false);
                setVersionsOpen(false);
              }}
            >
              {t("Access")}
            </button>
            <button
              className="danger-action"
              onClick={() => setDeleteCurrentOpen(true)}
            >
              {t("Delete Recording")}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
