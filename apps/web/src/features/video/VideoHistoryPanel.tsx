// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../../i18n";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoHistoryPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const { panel, state, saveNamedVersion, restoreVersion } = controller;
  if (!state || panel !== "history") return null;

  return (
    <div className="video-edit-list">
      <button
        onClick={() => {
          const name = window.prompt(t("Version name"));
          if (name) void saveNamedVersion(name);
        }}
      >
        {t("Save named version")}
      </button>
      {state.versions.map((version) => (
        <div className="edit-row" key={version.id}>
          <strong>
            {version.name ??
              t("{type} version", { type: t(version.versionType) })}
          </strong>
          <small>
            {new Date(version.createdAt).toLocaleString()}
            {version.publishedAt ? t(" - published") : ""}
          </small>
          <button onClick={() => void restoreVersion(version.id)}>
            {t("Restore to draft")}
          </button>
        </div>
      ))}
    </div>
  );
}
