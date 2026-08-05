// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import type { Recording } from "@infosteed/shared";
import { ConfirmDestructiveAction } from "@/components/design/ConfirmDestructiveAction";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDestructiveItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const [confirmReset, setConfirmReset] = useState(false);

  if (!state) return null;

  const running =
    render?.status === "queued" || render?.status === "processing";
  const ready = render?.status === "ready" && !render.stale;
  const needsRender =
    !render ||
    render.stale ||
    render.status === "failed" ||
    render.status === "canceled" ||
    render.status === "expired";
  const renderDisabled = saving || savePaused || running;
  const safeTitle = recording.title.replace(/[^a-z0-9-_]+/gi, "-") || "video";

  let status = t("No preview yet");
  if (render?.stale) status = t("Preview out of date");
  else if (running)
    status = t("Rendering preview · {percent}%", {
      percent: Math.round(render.progress * 100),
    });
  else if (render?.status === "ready") status = t("Preview ready");
  else if (render?.status === "failed") status = t("Preview failed");
  else if (render?.status === "canceled") status = t("Preview canceled");
  else if (render?.status === "expired") status = t("Preview expired");

  return (
    <div className="render-controls output-bar">
      {!state.workerAvailable && needsRender && (
        <p className="raw-warning output-warning">
          {t("The render worker is offline.")}
        </p>
      )}
      <div className="output-status">
        <span
          className={`output-status-dot${ready ? " ready" : running ? " running" : ""}`}
        />
        <span>
          <strong>{status}</strong>
          {mp4Export &&
            (mp4Export.status === "queued" ||
              mp4Export.status === "processing") && (
              <small>
                {t("MP4 {percent}%", {
                  percent: Math.round(mp4Export.progress * 100),
                })}
              </small>
            )}
          {mp4Export?.status === "failed" && (
            <small className="error">{mp4Export.errorMessage}</small>
          )}
        </span>
      </div>

      {running && (
        <progress
          aria-label={t("Render progress")}
          max={1}
          value={render.progress}
        />
      )}

      <div className="output-actions">
        {needsRender && (
          <button
            className="primary-action"
            disabled={renderDisabled || !state.workerAvailable}
            onClick={() => void requestRender()}
          >
            {render?.status === "failed"
              ? t("Retry preview")
              : t("Render preview")}
          </button>
        )}
        {running && (
          <button onClick={() => void cancelActiveRender()}>
            {t("Cancel")}
          </button>
        )}
        {ready && (
          <>
            <button onClick={() => setCandidatePreview((current) => !current)}>
              {candidatePreview ? t("View source") : t("View preview")}
            </button>
            <button
              className="primary-action"
              onClick={() => void publishChanges()}
            >
              {t("Publish")}
            </button>
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label={t("More output actions")}>{t("More")}</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {render?.status === "ready" && (
              <>
                <DropdownMenuItem
                  onSelect={() => setCandidatePreview((current) => !current)}
                >
                  {candidatePreview ? t("Preview source") : t("Preview render")}
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    download={`${safeTitle}.webm`}
                    href={recordingVideoRenderUrl(recording.id, render.id)}
                  >
                    {t("Download WebM")}
                  </a>
                </DropdownMenuItem>
                {!mp4Export && (
                  <DropdownMenuItem
                    disabled={!state.workerAvailable}
                    onSelect={() => void requestMp4Export()}
                  >
                    {t("Create MP4")}
                  </DropdownMenuItem>
                )}
                {mp4Export?.status === "failed" && (
                  <DropdownMenuItem
                    disabled={!state.workerAvailable}
                    onSelect={() => void requestMp4Export()}
                  >
                    {t("Retry MP4")}
                  </DropdownMenuItem>
                )}
                {mp4Export?.status === "ready" && (
                  <DropdownMenuItem asChild>
                    <a
                      download={`${safeTitle}.mp4`}
                      href={recordingVideoMp4ExportUrl(recording.id, render.id)}
                    >
                      {t("Download MP4")}
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuDestructiveItem onSelect={() => setConfirmReset(true)}>
              {t("Reset all edits")}
            </DropdownMenuDestructiveItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ConfirmDestructiveAction
        body={t(
          "This restores the original edit recipe, including cuts, narration, layout, and audio settings.",
        )}
        confirmLabel={t("Reset all edits")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void resetAllEdits();
        }}
        open={confirmReset}
        title={t("Reset every video edit?")}
      />
    </div>
  );
}
