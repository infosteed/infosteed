// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../../i18n";
import { VideoCaptionsPanel } from "./VideoCaptionsPanel";
import type { VideoEditorController } from "./useVideoEditorController";
import { VideoVoiceoverPanel } from "./VideoVoiceoverPanel";

export function VideoNarrationPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const { panel, narrationView, setNarrationView } = controller;
  if (panel !== "narration") return null;

  return (
    <div className="narration-panel">
      <div
        aria-label={t("Narration panels")}
        className="narration-panel-tabs"
        role="tablist"
      >
        <button
          aria-selected={narrationView === "captions"}
          className={narrationView === "captions" ? "active" : ""}
          onClick={() => setNarrationView("captions")}
          role="tab"
        >
          {t("Captions")}
        </button>
        <button
          aria-selected={narrationView === "voiceover"}
          className={narrationView === "voiceover" ? "active" : ""}
          onClick={() => setNarrationView("voiceover")}
          role="tab"
        >
          {t("AI voiceover")}
        </button>
      </div>
      <VideoCaptionsPanel controller={controller} />
      <VideoVoiceoverPanel controller={controller} />
    </div>
  );
}
