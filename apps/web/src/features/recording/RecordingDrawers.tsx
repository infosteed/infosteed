// SPDX-License-Identifier: AGPL-3.0-only
import type { CurrentUser } from "@infosteed/shared";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../../components/ui/sheet";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { GuideShareMovePanel } from "../../components/GuideShareMovePanel";
import { GuideVersionsPanel } from "../../components/GuideVersionsPanel";
import { t } from "../../i18n";
import type { RecordingController } from "./useRecordingController";

export function RecordingDrawers({
  user,
  controller,
}: {
  user: CurrentUser;
  controller: RecordingController;
}) {
  const {
    recording,
    setRecording,
    setImageVersions,
    setSelectedItemId,
    accessOpen,
    setAccessOpen,
    versionsOpen,
    setVersionsOpen,
    deleteCurrentOpen,
    setDeleteCurrentOpen,
    load,
    confirmDeleteCurrentGuide,
  } = controller;
  if (!recording) return null;

  return (
    <>
      {accessOpen && (
        <Sheet open={accessOpen} onOpenChange={setAccessOpen}>
          <SheetContent aria-label={t("Guide access")}>
            <SheetHeader>
              <p className="ui-eyebrow">{t("Access")}</p>
              <SheetTitle>{recording.title}</SheetTitle>
            </SheetHeader>
            <GuideShareMovePanel
              recording={recording}
              user={user}
              onChanged={(updated) => {
                setRecording(updated);
                void load();
              }}
            />
          </SheetContent>
        </Sheet>
      )}
      {versionsOpen && (
        <section className="side-drawer" aria-label={t("Guide versions")}>
          <div className="preview-head">
            <h2>{t("Versions")}</h2>
            <button onClick={() => setVersionsOpen(false)}>{t("Close")}</button>
          </div>
          <GuideVersionsPanel
            recording={recording}
            onRestored={(updated) => {
              setRecording(updated);
              setSelectedItemId("");
              setImageVersions(new Map());
              void load();
            }}
          />
        </section>
      )}
      {deleteCurrentOpen && (
        <ConfirmDialog
          title={
            recording.captureMode === "guide"
              ? t("Delete guide?")
              : t("Delete recording?")
          }
          body={t(
            '"{title}" will move to Trash and can be restored for 10 days.',
            {
              title: recording.title,
            },
          )}
          confirmLabel={
            recording.captureMode === "guide"
              ? t("Delete Guide")
              : t("Delete Recording")
          }
          tone="danger"
          onCancel={() => setDeleteCurrentOpen(false)}
          onConfirm={() => void confirmDeleteCurrentGuide()}
        />
      )}
    </>
  );
}
