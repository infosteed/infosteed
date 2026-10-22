// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from "react";
import type { CurrentUser } from "@infosteed/shared";
import { errorMessage } from "../errors";
import { t } from "../i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";

export function PasswordResetDialog({
  user,
  onClose,
  onReset,
  onSuccess,
}: {
  user: CurrentUser;
  onClose: () => void;
  onReset: (userId: string, password: string) => Promise<void>;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (saving) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (saving) event.preventDefault();
        }}
      >
        <DialogTitle>{t("Reset password")}</DialogTitle>
        <DialogDescription>
          {t(
            "Set a new password for {username}. This signs them out of all existing sessions.",
            { username: user.username },
          )}
        </DialogDescription>
        <form
          className="password-reset-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving) return;
            setSaving(true);
            setError(undefined);
            try {
              await onReset(user.id, password);
              setPassword("");
              onSuccess();
            } catch (resetError) {
              setError(errorMessage(resetError));
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            {t("New password")}
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              maxLength={256}
              required
              disabled={saving}
              aria-describedby="reset-password-hint"
            />
          </label>
          <p id="reset-password-hint" className="share-note">
            {t("Use 10 to 256 characters.")}
          </p>
          <button
            type="button"
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? t("Hide password") : t("Show password")}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button type="button" disabled={saving} onClick={onClose}>
              {t("Cancel")}
            </button>
            <button
              type="submit"
              className="primary-action"
              disabled={saving || password.length < 10}
            >
              {saving ? t("Saving...") : t("Reset password")}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
