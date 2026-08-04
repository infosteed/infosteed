// SPDX-License-Identifier: AGPL-3.0-only
import type { Recording } from "@infosteed/shared";
import { t } from "../../i18n";
import { openRecording } from "../../navigation";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoEditorHeader({
  recording,
  controller,
}: {
  recording: Recording;
  controller: VideoEditorController;
}) {
  const { savePaused, saving, dirty } = controller;
  return (
    <header className="video-editor-header">
      <div>
        <p>{t("Video editor")}</p>
        <h1>{recording.title}</h1>
      </div>
      <div className="header-actions">
        <span className={savePaused ? "save-state conflict" : "save-state"}>
          {savePaused
            ? t("Save conflict")
            : saving
              ? t("Saving...")
              : dirty
                ? t("Unsaved")
                : t("Saved")}
        </span>
        <button onClick={() => openRecording(recording.id, "video")}>
          {t("Back to recording")}
        </button>
      </div>
    </header>
  );
}

export function VideoEditorError({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const { error, savePaused, load, retryLocalDraft } = controller;
  if (!error) return null;
  return (
    <div className="capture-status error">
      {error}
      {savePaused && (
        <>
          <button onClick={() => void load()}>
            {t("Reload server draft")}
          </button>
          <button onClick={() => void retryLocalDraft()}>
            {t("Retry local draft")}
          </button>
        </>
      )}
    </div>
  );
}
