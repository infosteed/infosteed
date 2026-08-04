// SPDX-License-Identifier: AGPL-3.0-only
import type {
  CaptureMode,
  CurrentUser,
  InitializeVideoRequest,
  RecordingEventInput,
  RecordingVideo,
  VideoCaptureSettings,
} from "@infosteed/shared";
import type { PublicSystemInfo } from "@infosteed/shared";
import { PRODUCT_IDENTIFIERS, PROTOCOL_VERSION } from "@infosteed/shared";
import { t } from "./i18n";

export interface ExtensionSettings {
  apiBaseUrl: string;
  webEditorUrl: string;
}

export interface ServerConnection {
  serverOrigin: string;
  systemInfo: PublicSystemInfo;
}

let runtimeSettingsOverride: ExtensionSettings | undefined;

export function configureRuntimeSettings(settings: ExtensionSettings): void {
  runtimeSettingsOverride = settings;
}

export async function getSettings(): Promise<ExtensionSettings> {
  if (runtimeSettingsOverride) return runtimeSettingsOverride;
  const stored = await chrome.storage.local.get("serverOrigin");
  if (!stored.serverOrigin)
    throw new Error(
      t("Configure a self-hosted server before using the extension"),
    );
  return {
    apiBaseUrl: `${stored.serverOrigin}/api`,
    webEditorUrl: stored.serverOrigin,
  };
}

let csrfToken: string | undefined;

export function clearConnectionCaches(): void {
  csrfToken = undefined;
  runtimeSettingsOverride = undefined;
}

export function normalizeServerOrigin(value: string): string {
  const url = new URL(value.trim());
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(
      t("Use HTTPS. Plain HTTP is allowed only for localhost and 127.0.0.1"),
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      t(
        "Enter only the server origin, without credentials, a path, query, or fragment",
      ),
    );
  }
  return url.origin;
}

export async function inspectServer(
  serverOrigin: string,
): Promise<PublicSystemInfo> {
  const response = await fetch(`${serverOrigin}/api/system/info`, {
    credentials: "include",
  });
  if (!response.ok)
    throw new Error(
      t("Server check failed with HTTP {status}", { status: response.status }),
    );
  const info = (await response.json()) as PublicSystemInfo;
  if (info.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      t(
        "Incompatible server protocol {actual}; this extension requires protocol {required}",
        { actual: info.protocolVersion, required: PROTOCOL_VERSION },
      ),
    );
  }
  if (!info.productName || !info.releaseVersion || !info.productSlug)
    throw new Error(t("The selected origin is not a compatible server"));
  return info;
}

async function registerWebBridge(serverOrigin: string): Promise<void> {
  await chrome.scripting
    .unregisterContentScripts({
      ids: [PRODUCT_IDENTIFIERS.extensionBridgeChannel],
    })
    .catch(() => undefined);
  await chrome.scripting.registerContentScripts([
    {
      id: PRODUCT_IDENTIFIERS.extensionBridgeChannel,
      matches: [`${serverOrigin}/*`],
      js: ["contentScript.js"],
      runAt: "document_idle",
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
}

export async function connectServer(value: string): Promise<ServerConnection> {
  const serverOrigin = normalizeServerOrigin(value);
  const current = await chrome.storage.local.get([
    "serverOrigin",
    "recorderStatus",
    "recordingId",
  ]);
  if (
    current.serverOrigin !== serverOrigin &&
    ((current.recorderStatus ?? "idle") !== "idle" || current.recordingId)
  ) {
    throw new Error(
      t("Finish or discard the current recording before changing servers"),
    );
  }
  const granted = await chrome.permissions.request({
    origins: [`${serverOrigin}/*`],
  });
  if (!granted) throw new Error(t("Server permission was not granted"));
  try {
    const systemInfo = await inspectServer(serverOrigin);
    await chrome.storage.local.set({
      serverOrigin,
      connectedSystemInfo: systemInfo,
    });
    await chrome.storage.local.remove(["apiBaseUrl", "webEditorUrl"]);
    clearConnectionCaches();
    await registerWebBridge(serverOrigin);
    if (current.serverOrigin && current.serverOrigin !== serverOrigin) {
      await chrome.permissions.remove({
        origins: [`${current.serverOrigin}/*`],
      });
    }
    return { serverOrigin, systemInfo };
  } catch (error) {
    await chrome.permissions.remove({ origins: [`${serverOrigin}/*`] });
    throw error;
  }
}

export async function disconnectServer(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "serverOrigin",
    "recorderStatus",
    "recordingId",
  ]);
  if ((stored.recorderStatus ?? "idle") !== "idle" || stored.recordingId) {
    throw new Error(
      t("Finish or discard the current recording before disconnecting"),
    );
  }
  if (stored.serverOrigin)
    await chrome.permissions.remove({ origins: [`${stored.serverOrigin}/*`] });
  await chrome.scripting
    .unregisterContentScripts({
      ids: [PRODUCT_IDENTIFIERS.extensionBridgeChannel],
    })
    .catch(() => undefined);
  await chrome.storage.local.remove([
    "serverOrigin",
    "connectedSystemInfo",
    "apiBaseUrl",
    "webEditorUrl",
  ]);
  clearConnectionCaches();
}

function methodOf(init?: RequestInit): string {
  return String(init?.method ?? "GET").toUpperCase();
}

async function getCsrfToken(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const settings = await getSettings();
  const response = await fetch(`${settings.apiBaseUrl}/auth/csrf`, {
    credentials: "include",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `API request failed: ${response.status}${detail ? ` ${detail}` : ""}`,
    );
  }
  csrfToken = ((await response.json()) as { csrfToken: string }).csrfToken;
  return csrfToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const settings = await getSettings();
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const needsCsrf = ["POST", "PATCH", "DELETE", "PUT"].includes(methodOf(init));
  if (needsCsrf)
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken());
  let response = await fetch(`${settings.apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 403 && needsCsrf) {
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken(true));
    response = await fetch(`${settings.apiBaseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `API request failed: ${response.status}${detail ? ` ${detail}` : ""}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function createRecording(
  title: string,
  captureMode: CaptureMode = "guide",
): Promise<{ id: string }> {
  return request("/recordings", {
    method: "POST",
    body: JSON.stringify({ title, captureMode }),
  });
}

export async function getCurrentUser(): Promise<CurrentUser> {
  const result = await request<{ user: CurrentUser }>("/auth/me");
  await getCsrfToken(true);
  return result.user;
}

export async function uploadEvents(
  recordingId: string,
  events: RecordingEventInput[],
) {
  return uploadEventsForSession(recordingId, events);
}

export async function uploadEventsForSession(
  recordingId: string,
  events: RecordingEventInput[],
  captureSessionId?: string,
) {
  return request<{
    events: Array<RecordingEventInput & { id: string; ordinal: number }>;
  }>(`/recordings/${recordingId}/events`, {
    method: "POST",
    body: JSON.stringify({ captureSessionId, events }),
  });
}

export async function uploadScreenshot(
  recordingId: string,
  input: {
    eventId: string;
    filename: string;
    contentType: "image/png" | "image/jpeg";
    imageBase64: string;
    targetBox?: unknown;
  },
) {
  return request<{ ok: true }>(`/recordings/${recordingId}/screenshots`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function finalizeRecording(recordingId: string) {
  return request(`/recordings/${recordingId}/finalize`, { method: "POST" });
}

export async function createCaptureSession(recordingId: string) {
  return request<{
    captureSessionId: string;
    recordingId: string;
    status: "recording";
  }>(`/recordings/${recordingId}/capture-sessions`, { method: "POST" });
}

export async function finalizeCaptureSession(
  recordingId: string,
  captureSessionId: string,
) {
  return request(
    `/recordings/${recordingId}/capture-sessions/${captureSessionId}/finalize`,
    { method: "POST" },
  );
}

export async function pauseRecording(recordingId: string) {
  return request(`/recordings/${recordingId}/pause`, { method: "POST" });
}

export async function resumeRecording(recordingId: string) {
  return request(`/recordings/${recordingId}/resume`, { method: "POST" });
}

export async function getVideoCapability() {
  return request<{
    enabled: boolean;
    maxDurationMs: number;
    maxWidth: number;
    maxHeight: number;
    frameRate: number;
  }>("/capabilities/video");
}

export async function initializeVideo(
  recordingId: string,
  input: InitializeVideoRequest,
): Promise<RecordingVideo> {
  return request(`/recordings/${recordingId}/video`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadVideoPart(
  recordingId: string,
  assetId: string,
  partNumber: number,
  body: Blob,
  startedAtMs: number,
  endedAtMs: number,
) {
  return request<{ etag: string; partNumber: number }>(
    `/recordings/${recordingId}/video/assets/${assetId}/parts/${partNumber}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        [PRODUCT_IDENTIFIERS.videoStartHeader]: String(startedAtMs),
        [PRODUCT_IDENTIFIERS.videoEndHeader]: String(endedAtMs),
      },
      body,
    },
  );
}

export async function finalizeVideo(
  recordingId: string,
  input: {
    durationMs: number;
    recovered?: boolean;
    assets: Array<{ assetId: string; durationMs?: number }>;
  },
): Promise<RecordingVideo> {
  return request(`/recordings/${recordingId}/video/finalize`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getRecordingVideo(
  recordingId: string,
): Promise<RecordingVideo> {
  return request(`/recordings/${recordingId}/video`);
}

export async function deleteRecordingVideo(recordingId: string): Promise<void> {
  const settings = await getSettings();
  const headers = new Headers({
    [PRODUCT_IDENTIFIERS.csrfHeader]: await getCsrfToken(),
  });
  let response = await fetch(
    `${settings.apiBaseUrl}/recordings/${recordingId}/video`,
    {
      method: "DELETE",
      headers,
      credentials: "include",
    },
  );
  if (response.status === 403) {
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken(true));
    response = await fetch(
      `${settings.apiBaseUrl}/recordings/${recordingId}/video`,
      { method: "DELETE", headers, credentials: "include" },
    );
  }
  if (!response.ok)
    throw new Error(
      `API request failed: ${response.status} ${await response.text().catch(() => "")}`.trim(),
    );
}

export async function deleteRecording(recordingId: string): Promise<void> {
  const settings = await getSettings();
  const headers = new Headers({
    [PRODUCT_IDENTIFIERS.csrfHeader]: await getCsrfToken(),
  });
  let response = await fetch(
    `${settings.apiBaseUrl}/recordings/${recordingId}`,
    {
      method: "DELETE",
      headers,
      credentials: "include",
    },
  );
  if (response.status === 403) {
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken(true));
    response = await fetch(`${settings.apiBaseUrl}/recordings/${recordingId}`, {
      method: "DELETE",
      headers,
      credentials: "include",
    });
  }
  if (!response.ok)
    throw new Error(
      `API request failed: ${response.status} ${await response.text().catch(() => "")}`.trim(),
    );
}

export type { VideoCaptureSettings };
