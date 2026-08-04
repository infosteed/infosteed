// SPDX-License-Identifier: AGPL-3.0-only
import type { Recording } from "@infosteed/shared";
import { recordingVideoMp4ExportUrl, recordingVideoRenderUrl } from "../../api";
import { t } from "../../i18n";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoRenderControls({
  recording,
  controller,
}: {
  recording: Recording;
  controller: VideoEditorController;
}) {
  const {
    state,
    saving,
    savePaused,
    render,
    mp4Export,
    candidatePreview,
    setCandidatePreview,
    requestRender,
    requestMp4Export,
    cancelActiveRender,
    publishChanges,
    resetAllEdits,
  } = controller;

  if (!state) return null;

  return (
    <div className="render-controls">
      <button
        className="render-preview-button"
        disabled={
          saving ||
          savePaused ||
          render?.status === "processing" ||
          render?.status === "queued"
        }
        onClick={() => void requestRender()}
      >
        {t("Render preview")}
      </button>
      {render && (
        <div className="render-status">
          <strong>{t("Render: {status}", { status: t(render.status) })}</strong>
          <progress max={1} value={render.progress} />
          {render.errorMessage && (
            <p className="error">{render.errorMessage}</p>
          )}
          {(render.status === "queued" || render.status === "processing") && (
            <button onClick={() => void cancelActiveRender()}>
              {t("Cancel")}
            </button>
          )}
          {render.status === "ready" && (
            <>
              <button
                onClick={() => setCandidatePreview((current) => !current)}
              >
                {candidatePreview ? t("Preview source") : t("Preview render")}
              </button>
              <a
                href={recordingVideoRenderUrl(recording.id, render.id)}
                download={`${recording.title.replace(/[^a-z0-9-_]+/gi, "-") || "video"}.webm`}
              >
                {t("Download render")}
              </a>
              {!mp4Export && (
                <button
                  disabled={!state.workerAvailable}
                  onClick={() => void requestMp4Export()}
                >
                  {t("Create MP4")}
                </button>
              )}
              {mp4Export &&
                (mp4Export.status === "queued" ||
                  mp4Export.status === "processing") && (
                  <div className="mp4-export-status">
                    <strong>
                      {t("MP4: {status}", {
                        status: t(mp4Export.status),
                      })}
                    </strong>
                    <progress max={1} value={mp4Export.progress} />
                  </div>
                )}
              {mp4Export?.status === "failed" && (
                <div className="mp4-export-status">
                  <p className="error">{mp4Export.errorMessage}</p>
                  <button
                    disabled={!state.workerAvailable}
                    onClick={() => void requestMp4Export()}
                  >
                    {t("Retry MP4")}
                  </button>
                </div>
              )}
              {mp4Export?.status === "ready" && (
                <a
                  href={recordingVideoMp4ExportUrl(recording.id, render.id)}
                  download={`${recording.title.replace(/[^a-z0-9-_]+/gi, "-") || "video"}.mp4`}
                >
                  {t("Download MP4")}
                </a>
              )}
              <button
                className="publish-button"
                disabled={render.stale}
                onClick={() => void publishChanges()}
              >
                {t("Publish changes")}
              </button>
            </>
          )}
        </div>
      )}
      {!state.workerAvailable && mp4Export?.status !== "ready" && (
        <p className="raw-warning">
          {t(
            "The render worker is offline. Start it before requesting a render or MP4 conversion.",
          )}
        </p>
      )}
      <button className="danger-action" onClick={() => void resetAllEdits()}>
        {t("Reset all edits")}
      </button>
    </div>
  );
}
