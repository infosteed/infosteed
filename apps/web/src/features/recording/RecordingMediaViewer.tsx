// SPDX-License-Identifier: AGPL-3.0-only
import { RecordingGenerationStatus } from "../../components/RecordingGenerationStatus";
import { VideoGuidePlayer } from "../../components/RecordingWorkspace";
import { t } from "../../i18n";
import { openLibrary } from "../../navigation";
import type { RecordingController } from "./useRecordingController";

export function RecordingMediaViewer({
  controller,
}: {
  controller: RecordingController;
}) {
  const { recording, video, setVideo, viewOnly, load } = controller;
  if (!recording) return null;

  return (
    <>
      {recording.captureMode !== "guide" && video && (
        <RecordingGenerationStatus
          captureMode={recording.captureMode}
          status={video.transcriptionStatus}
        />
      )}

      {viewOnly && recording.captureMode !== "guide" && video && (
        <VideoGuidePlayer
          recording={recording}
          video={video}
          editable={
            recording.userRole === "admin" ||
            recording.userRole === "owner" ||
            recording.userRole === "editor"
          }
          onVideoChanged={setVideo}
          onRecordingChanged={() => void load()}
          onVideoDeleted={() => {
            if (recording.captureMode === "video") openLibrary();
            else setVideo(undefined);
          }}
        />
      )}
      {viewOnly && recording.captureMode !== "guide" && !video && (
        <div className="capture-status error">
          {t(
            "Video metadata is unavailable or this draft has not been published.",
          )}
        </div>
      )}
    </>
  );
}
