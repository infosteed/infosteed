// SPDX-License-Identifier: AGPL-3.0-only
export type AppView = "video" | "video-edit" | "legal";

export function currentRecordingId(location: Location = window.location) {
  return new URLSearchParams(location.search).get("recordingId");
}

export function currentView(location: Location = window.location) {
  return new URLSearchParams(location.search).get("view") as AppView | null;
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
