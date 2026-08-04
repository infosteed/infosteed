// SPDX-License-Identifier: AGPL-3.0-only
import type { CaptureMode, TranscriptionStatus } from "@infosteed/shared";

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
      ? "transcript and AI guide"
      : "transcript and AI chapter titles";

  return (
    <div
      className="recording-generation-status"
      role="status"
      aria-live="polite"
    >
      <span className="recording-generation-spinner" aria-hidden="true" />
      <div>
        <strong>Generating your {work}…</strong>
        <p>You can start editing while this finishes.</p>
      </div>
    </div>
  );
}
