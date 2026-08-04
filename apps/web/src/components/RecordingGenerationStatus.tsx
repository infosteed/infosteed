// SPDX-License-Identifier: AGPL-3.0-only
import type { CaptureMode, TranscriptionStatus } from "@infosteed/shared";
import { t } from "../i18n";

export function RecordingGenerationStatus({
  captureMode,
  status,
}: {
  captureMode: CaptureMode;
  status: TranscriptionStatus;
}) {
  if (status !== "pending" && status !== "processing") return null;

  const work =
    captureMode === "both"
      ? t("transcript and AI guide")
      : t("transcript and AI chapter titles");

  return (
    <div
      className="recording-generation-status"
      role="status"
      aria-live="polite"
    >
      <span className="recording-generation-spinner" aria-hidden="true" />
      <div>
        <strong>{t("Generating your {work}…", { work })}</strong>
        <p>{t("You can start editing while this finishes.")}</p>
      </div>
    </div>
  );
}
