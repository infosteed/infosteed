// SPDX-License-Identifier: AGPL-3.0-only
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { t } from "../i18n";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = "default",
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="confirm-dialog">
        <AlertDialogTitle id="confirm-title">{title}</AlertDialogTitle>
        <AlertDialogDescription>{body}</AlertDialogDescription>
        <div className="confirm-actions">
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              {t("Cancel")}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant={tone === "danger" ? "destructive" : "default"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
