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
    <div
      aria-label={t("Editor panels")}
      className="video-panel-tabs"
      role="tablist"
    >
      <button
        aria-selected={panel === "chapters"}
        className={panel === "chapters" ? "active" : ""}
        onClick={() => setPanel("chapters")}
        role="tab"
      >
        {t("Chapters")}
      </button>
      <button
        aria-selected={panel === "narration"}
        className={panel === "narration" ? "active" : ""}
        onClick={() => setPanel("narration")}
        role="tab"
      >
        {t("Narration")}
      </button>
      <button
        aria-selected={panel === "history"}
        className={panel === "history" ? "active" : ""}
        onClick={() => setPanel("history")}
        role="tab"
      >
        {t("History")}
      </button>
    </div>
  );
}
