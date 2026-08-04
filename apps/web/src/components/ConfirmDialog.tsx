// SPDX-License-Identifier: AGPL-3.0-only
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
    <div className="modal-backdrop" role="presentation">
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button onClick={onCancel}>{t("Cancel")}</button>
          <button
            className={tone === "danger" ? "danger-action" : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
