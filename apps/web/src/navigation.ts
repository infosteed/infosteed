// SPDX-License-Identifier: AGPL-3.0-only
export type RecordingView = "video" | "guide" | "both";
export type AppView = RecordingView | "video-edit" | "guide-edit" | "legal";

const appViews: readonly AppView[] = [
  "video",
  "guide",
  "both",
  "video-edit",
  "guide-edit",
  "legal",
];

export function currentRecordingId(location: Location = window.location) {
  return new URLSearchParams(location.search).get("recordingId");
}

export function currentView(location: Location = window.location) {
  const value = new URLSearchParams(location.search).get("view");
  return appViews.includes(value as AppView) ? (value as AppView) : null;
}

export function resolveRecordingView(
  requestedView: AppView | null,
  captureMode: RecordingView,
): RecordingView {
  if (requestedView === "guide-edit") return "guide";
  if (
    requestedView === "video" ||
    requestedView === "guide" ||
    requestedView === "both"
  ) {
    if (requestedView === "both") return captureMode;
    if (requestedView === "video" && captureMode === "guide") return "guide";
    if (requestedView === "guide" && captureMode === "video") return "video";
    return requestedView;
  }
  return captureMode;
}

export function recordingUrl(recordingId: string, view?: AppView): string {
  const query = new URLSearchParams({ recordingId });
  if (view) query.set("view", view);
  return `/?${query.toString()}`;
}

export function openRecording(recordingId: string, view?: AppView): void {
  window.location.assign(recordingUrl(recordingId, view));
}

export function openLibrary(): void {
  window.location.assign("/");
}
