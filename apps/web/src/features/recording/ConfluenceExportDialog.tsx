// SPDX-License-Identifier: AGPL-3.0-only
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { wordExportUrl } from "../../api";
import { t } from "../../i18n";

export function ConfluenceExportDialog({
  recordingId,
  open,
  onOpenChange,
}: {
  recordingId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Export to Confluence")}</DialogTitle>
          <DialogDescription>
            {t(
              "Download the guide as a Word document, then import it into Confluence. This creates a copy and does not stay synchronized with InfoSteed.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <h3 className="m-0 font-semibold">{t("How to import")}</h3>
          <ol className="m-0 grid list-decimal gap-2 pl-5 text-muted-foreground">
            <li>{t("In Confluence, create a blank page or live doc.")}</li>
            <li>{t("Open More actions → Templates and import.")}</li>
            <li>
              {t(
                "Select Import → Word document (.docx) and choose the downloaded file.",
              )}
            </li>
            <li>
              {t(
                "Review the draft, set its location and permissions, then publish.",
              )}
            </li>
          </ol>
          <p className="m-0 text-xs text-muted-foreground">
            {t(
              "Confluence Data Center: use Import Word Document, choose Don't split if prompted, and ask an administrator if the Office Connector action is unavailable.",
            )}
          </p>
        </div>
        <div className="dialog-actions">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("Close")}
            </Button>
          </DialogClose>
          <Button asChild>
            <a
              href={wordExportUrl(recordingId, "standard")}
              onClick={() => onOpenChange(false)}
            >
              {t("Download DOCX")}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
