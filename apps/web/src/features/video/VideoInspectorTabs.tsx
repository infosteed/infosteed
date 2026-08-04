// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../../i18n";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoInspectorTabs({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const { panel, setPanel } = controller;
  return (
    <div className="video-panel-tabs">
      <button
        className={panel === "chapters" ? "active" : ""}
        onClick={() => setPanel("chapters")}
      >
        {t("Chapters")}
      </button>
      <button
        className={panel === "captions" ? "active" : ""}
        onClick={() => setPanel("captions")}
      >
        {t("Captions")}
      </button>
      <button
        className={panel === "voiceover" ? "active" : ""}
        onClick={() => setPanel("voiceover")}
      >
        {t("AI voiceover")}
      </button>
      <button
        className={panel === "history" ? "active" : ""}
        onClick={() => setPanel("history")}
      >
        {t("History")}
      </button>
    </div>
  );
}
