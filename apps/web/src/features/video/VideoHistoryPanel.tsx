// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "../../i18n";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoHistoryPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const { panel, state, saveNamedVersion, restoreVersion } = controller;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  if (!state || panel !== "history") return null;

  return (
    <div className="video-edit-list inspector-panel-list">
      <div className="inspector-panel-heading">
        <div>
          <strong>{t("History")}</strong>
          <small>
            {t("{count} saved versions", { count: state.versions.length })}
          </small>
        </div>
        <button onClick={() => setDialogOpen(true)}>
          {t("Save named version")}
        </button>
      </div>

      <div className="history-list" role="list">
        {state.versions.map((version) => (
          <div className="history-row" key={version.id} role="listitem">
            <span className="history-row-copy">
              <strong>
                {version.name ??
                  t("{type} version", { type: t(version.versionType) })}
              </strong>
              <small>{new Date(version.createdAt).toLocaleString()}</small>
            </span>
            {version.publishedAt && (
              <span className="status-badge">{t("Published")}</span>
            )}
            <button onClick={() => void restoreVersion(version.id)}>
              {t("Restore")}
            </button>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Save named version")}</DialogTitle>
            <DialogDescription>
              {t("Create a memorable restore point for the current draft.")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="named-version-form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed || saving) return;
              setSaving(true);
              void saveNamedVersion(trimmed).finally(() => {
                setSaving(false);
                setName("");
                setDialogOpen(false);
              });
            }}
          >
            <label>
              <span>{t("Version name")}</span>
              <input
                autoFocus
                maxLength={200}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <Button
                disabled={saving}
                onClick={() => setDialogOpen(false)}
                type="button"
                variant="outline"
              >
                {t("Cancel")}
              </Button>
              <Button disabled={saving || !name.trim()} type="submit">
                {saving ? t("Saving...") : t("Save version")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
