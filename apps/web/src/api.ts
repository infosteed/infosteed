// SPDX-License-Identifier: AGPL-3.0-only
import type {
  BrandingSettings,
  CurrentUser,
  GuideVersion,
  GuideVersionListItem,
  GuideItem,
  GuideItemKind,
  GuideStep,
  Project,
  ProjectMember,
  Recording,
  RecordingVideo,
  VideoEditDraft,
  VideoEditRecipe,
  VideoEditVersion,
  VideoEditorState,
  VideoMp4Export,
  VideoRender,
  VoiceoverCueInput,
  VoiceoverGeneration,
  VoiceoverVoice,
  RecordingTranscript,
  RecordingListItem,
  RecordingProject,
  ScreenshotEditOperations,
  UserDirectoryEntry,
} from "@infosteed/shared";
import type { PublicSystemInfo } from "@infosteed/shared";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";
let csrfToken: string | undefined;

function methodOf(init?: RequestInit): string {
  return String(init?.method ?? "GET").toUpperCase();
}

function needsCsrf(path: string, init?: RequestInit): boolean {
  const method = methodOf(init);
  return (
    ["POST", "PATCH", "DELETE", "PUT"].includes(method) &&
    path !== "/auth/login" &&
    path !== "/setup/admin"
  );
}

async function getCsrfToken(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const response = await fetch(`${API_BASE}/auth/csrf`, {
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
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (needsCsrf(path, init)) {
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken());
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 403 && needsCsrf(path, init)) {
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken(true));
    const retry = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
    if (!retry.ok) {
      const detail = await retry.text().catch(() => "");
      throw new Error(
        `API request failed: ${retry.status}${detail ? ` ${detail}` : ""}`,
      );
    }
    return retry.json() as Promise<T>;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `API request failed: ${response.status}${detail ? ` ${detail}` : ""}`,
    );
  }
  return response.json() as Promise<T>;
}

async function requestResponse(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (needsCsrf(path, init))
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken());
  let response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 403 && needsCsrf(path, init)) {
    headers.set(PRODUCT_IDENTIFIERS.csrfHeader, await getCsrfToken(true));
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
  }
  return response;
}

async function download(path: string): Promise<Response> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `API request failed: ${response.status}${detail ? ` ${detail}` : ""}`,
    );
  }
  return response;
}

export function setupStatus(): Promise<{ required: boolean }> {
  return request("/setup/status");
}

export function setupAdmin(input: {
  username: string;
  displayName: string;
  password: string;
  setupToken: string;
}) {
  csrfToken = undefined;
  return request<{ user: CurrentUser }>("/setup/admin", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function systemInfo(): Promise<PublicSystemInfo> {
  return request("/system/info");
}

export function login(input: { username: string; password: string }) {
  csrfToken = undefined;
  return request<{ user: CurrentUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function logout() {
  csrfToken = undefined;
  return request<{ ok: true }>("/auth/logout", { method: "POST" });
}

export function logoutAll() {
  csrfToken = undefined;
  return request<{ ok: true }>("/auth/logout-all", { method: "POST" });
}

export interface AdminSystemStatus {
  protocolVersion: number;
  providers: Record<string, string>;
  workers: Record<string, string>;
  queues: Record<string, number>;
}

export function getAdminSystemStatus(): Promise<AdminSystemStatus> {
  return request("/admin/system/status");
}

export function me() {
  return request<{ user: CurrentUser }>("/auth/me");
}

export function listRecordings(query: {
  search?: string;
  projectId?: string;
  scope?: "all" | "owned" | "shared" | "trash";
  sort?: "recent" | "title";
}) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return request<{ items: RecordingListItem[]; total: number }>(
    `/recordings?${params}`,
  );
}

export function deleteRecording(recordingId: string) {
  return requestResponse(`/recordings/${recordingId}`, { method: "DELETE" });
}

export function restoreRecording(recordingId: string) {
  return request<Recording>(`/recordings/${recordingId}/restore`, {
    method: "POST",
  });
}

export function listProjects() {
  return request<{ projects: Project[] }>("/projects");
}

export function createProject(input: {
  name: string;
  description?: string | null;
  private?: boolean;
}) {
  return request<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateProject(
  id: string,
  patch: { name?: string; description?: string | null; private?: boolean },
) {
  return request<Project>(`/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function listUsers() {
  return request<{ users: CurrentUser[] }>("/users");
}

export function listUserDirectory() {
  return request<{ users: UserDirectoryEntry[] }>("/users/directory");
}

export function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  role: "admin" | "user";
}) {
  return request<CurrentUser>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUser(
  id: string,
  patch: {
    displayName?: string;
    role?: "admin" | "user";
    enabled?: boolean;
    password?: string;
  },
) {
  return request<CurrentUser>(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function getBranding() {
  return request<BrandingSettings>("/settings/branding");
}

export function updateBranding(patch: Partial<BrandingSettings>) {
  return request<BrandingSettings>("/settings/branding", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function listProjectMembers(projectId: string) {
  return request<{ members: ProjectMember[] }>(
    `/projects/${projectId}/members`,
  );
}

export function setProjectMember(
  projectId: string,
  input: { userId: string; role: "editor" | "viewer" },
) {
  return request<ProjectMember>(`/projects/${projectId}/members`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function removeProjectMember(projectId: string, userId: string) {
  return requestResponse(`/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
}

export function getRecording(id: string): Promise<Recording> {
  return request(`/recordings/${id}`);
}

export function getRecordingVideo(
  recordingId: string,
): Promise<RecordingVideo> {
  return request(`/recordings/${recordingId}/video`);
}

export function getRecordingTranscript(
  recordingId: string,
): Promise<RecordingTranscript> {
  return request(`/recordings/${recordingId}/video/transcript`);
}

export function retryRecordingTranscript(
  recordingId: string,
): Promise<RecordingTranscript> {
  return request(`/recordings/${recordingId}/video/transcript/retry`, {
    method: "POST",
  });
}

export function recordingCaptionsUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/video/captions.vtt`;
}

export function publishRecordingVideo(
  recordingId: string,
): Promise<RecordingVideo> {
  return request(`/recordings/${recordingId}/video/publish`, {
    method: "POST",
  });
}

export function unpublishRecordingVideo(
  recordingId: string,
): Promise<RecordingVideo> {
  return request(`/recordings/${recordingId}/video/unpublish`, {
    method: "POST",
  });
}

export function deleteRecordingVideo(recordingId: string): Promise<Response> {
  return requestResponse(`/recordings/${recordingId}/video`, {
    method: "DELETE",
  });
}

export function recordingVideoContentUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/video/content`;
}

export function getVideoEditor(recordingId: string): Promise<VideoEditorState> {
  return request(`/recordings/${recordingId}/video/editor`);
}

export function saveVideoEditor(
  recordingId: string,
  expectedRevision: number,
  recipe: VideoEditRecipe,
): Promise<VideoEditDraft> {
  return request(`/recordings/${recordingId}/video/editor`, {
    method: "PUT",
    body: JSON.stringify({ expectedRevision, recipe }),
  });
}

export function resetVideoEditor(recordingId: string): Promise<VideoEditDraft> {
  return request(`/recordings/${recordingId}/video/editor/reset`, {
    method: "POST",
  });
}

export function createVideoEditVersion(
  recordingId: string,
  name: string,
): Promise<VideoEditVersion> {
  return request(`/recordings/${recordingId}/video/edit-versions`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function restoreVideoEditVersion(
  recordingId: string,
  versionId: string,
): Promise<VideoEditDraft> {
  return request(
    `/recordings/${recordingId}/video/edit-versions/${versionId}/restore`,
    { method: "POST" },
  );
}

export function createVideoRender(
  recordingId: string,
  expectedRevision: number,
  name?: string,
): Promise<VideoRender> {
  return request(`/recordings/${recordingId}/video/renders`, {
    method: "POST",
    body: JSON.stringify({ expectedRevision, name: name || null }),
  });
}

export function getVideoRender(
  recordingId: string,
  renderId: string,
): Promise<VideoRender> {
  return request(`/recordings/${recordingId}/video/renders/${renderId}`);
}

export function cancelVideoRender(
  recordingId: string,
  renderId: string,
): Promise<Response> {
  return requestResponse(
    `/recordings/${recordingId}/video/renders/${renderId}`,
    { method: "DELETE" },
  );
}

export function publishVideoRender(
  recordingId: string,
  renderId: string,
): Promise<RecordingVideo> {
  return request(
    `/recordings/${recordingId}/video/renders/${renderId}/publish`,
    { method: "POST" },
  );
}

export function recordingVideoAssetUrl(
  recordingId: string,
  kind: string,
): string {
  return `${API_BASE}/recordings/${recordingId}/video/assets/${encodeURIComponent(kind)}/content`;
}

export function recordingVideoRenderUrl(
  recordingId: string,
  renderId: string,
): string {
  return `${API_BASE}/recordings/${recordingId}/video/renders/${renderId}/content`;
}

export function createVideoMp4Export(
  recordingId: string,
  renderId: string,
): Promise<VideoMp4Export> {
  return request(
    `/recordings/${recordingId}/video/renders/${renderId}/mp4-export`,
    { method: "POST" },
  );
}

export function getVideoMp4Export(
  recordingId: string,
  renderId: string,
): Promise<VideoMp4Export> {
  return request(
    `/recordings/${recordingId}/video/renders/${renderId}/mp4-export`,
  );
}

export function recordingVideoMp4ExportUrl(
  recordingId: string,
  renderId: string,
): string {
  return `${API_BASE}/recordings/${recordingId}/video/renders/${renderId}/mp4-export/content`;
}

export function listVoiceoverVoices(
  recordingId: string,
): Promise<{ voices: VoiceoverVoice[]; defaultVoice: string }> {
  return request(`/recordings/${recordingId}/video/voiceover/voices`);
}

export function rewriteVoiceoverScript(
  recordingId: string,
  cues: VoiceoverCueInput[],
  style: "concise" | "natural" | "instructional",
): Promise<{ cues: VoiceoverCueInput[] }> {
  return request(`/recordings/${recordingId}/video/voiceover/script`, {
    method: "POST",
    body: JSON.stringify({ cues, style }),
  });
}

export function generateVoiceover(
  recordingId: string,
  input: { voice: string; speed: number; cues: VoiceoverCueInput[] },
): Promise<VoiceoverGeneration> {
  return request(`/recordings/${recordingId}/video/voiceover/generations`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getVoiceoverGeneration(
  recordingId: string,
  generationId: string,
): Promise<VoiceoverGeneration> {
  return request(
    `/recordings/${recordingId}/video/voiceover/generations/${generationId}`,
  );
}

export function voiceoverCueUrl(
  recordingId: string,
  generationId: string,
  cueId: string,
): string {
  return `${API_BASE}/recordings/${recordingId}/video/voiceover/generations/${generationId}/cues/${encodeURIComponent(cueId)}/content`;
}

export function moveRecordingToProject(
  recordingId: string,
  projectId: string,
): Promise<Recording> {
  return request(`/recordings/${recordingId}/project`, {
    method: "PATCH",
    body: JSON.stringify({ projectId }),
  });
}

export function updateRecording(
  id: string,
  patch: { title?: string; purpose?: string | null; audience?: string | null },
): Promise<Recording> {
  return request(`/recordings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function generateOverview(
  id: string,
): Promise<Recording & { overviewSource?: "ai" | "deterministic" }> {
  return request(`/recordings/${id}/generate-overview`, { method: "POST" });
}

export function updateStep(
  recordingId: string,
  step: Pick<GuideStep, "id" | "title" | "instruction" | "altText">,
) {
  return request<GuideStep>(`/recordings/${recordingId}/steps/${step.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: step.title,
      instruction: step.instruction,
      altText: step.altText ?? undefined,
    }),
  });
}

export function addItem(
  recordingId: string,
  input: {
    kind: GuideItemKind;
    afterItemId?: string | null;
    title?: string;
    body?: string;
  },
) {
  return request<GuideItem>(`/recordings/${recordingId}/items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateItem(
  recordingId: string,
  item: Pick<GuideItem, "id" | "title" | "body" | "altText">,
) {
  return request<GuideItem>(`/recordings/${recordingId}/items/${item.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: item.title,
      body: item.body,
      altText: item.altText ?? undefined,
    }),
  });
}

export function replaceItemImage(
  recordingId: string,
  itemId: string,
  input: {
    contentType: "image/png" | "image/jpeg" | "image/webp";
    imageBase64: string;
  },
) {
  return request<GuideItem>(
    `/recordings/${recordingId}/items/${itemId}/image`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

export function deleteItemImage(recordingId: string, itemId: string) {
  return request<GuideItem>(
    `/recordings/${recordingId}/items/${itemId}/image`,
    { method: "DELETE" },
  );
}

export function deleteStep(recordingId: string, stepId: string) {
  return requestResponse(`/recordings/${recordingId}/steps/${stepId}`, {
    method: "DELETE",
  });
}

export function deleteItem(recordingId: string, itemId: string) {
  return requestResponse(`/recordings/${recordingId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export function listGuideVersions(recordingId: string) {
  return request<{ versions: GuideVersionListItem[] }>(
    `/recordings/${recordingId}/versions`,
  );
}

export function createGuideVersion(
  recordingId: string,
  message?: string | null,
) {
  return request<GuideVersionListItem>(`/recordings/${recordingId}/versions`, {
    method: "POST",
    body: JSON.stringify({ message: message ?? null }),
  });
}

export function getGuideVersion(recordingId: string, versionId: string) {
  return request<GuideVersion>(
    `/recordings/${recordingId}/versions/${versionId}`,
  );
}

export function restoreGuideVersion(recordingId: string, versionId: string) {
  return request<Recording>(
    `/recordings/${recordingId}/versions/${versionId}/restore`,
    { method: "POST" },
  );
}

export function reorderItems(recordingId: string, itemIds: string[]) {
  return request<Recording>(`/recordings/${recordingId}/items/reorder`, {
    method: "POST",
    body: JSON.stringify({ itemIds }),
  });
}

export function regenerateStep(recordingId: string, stepId: string) {
  return request<GuideStep>(
    `/recordings/${recordingId}/steps/${stepId}/regenerate`,
    { method: "POST" },
  );
}

export function importProject(project: RecordingProject, projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return request<Recording>(`/recordings/import${query}`, {
    method: "POST",
    body: JSON.stringify(project),
  });
}

export function getImageEdits(recordingId: string, filename: string) {
  return request<ScreenshotEditOperations>(
    `/recordings/${recordingId}/images/${filename}/edits`,
  );
}

export function updateImageEdits(
  recordingId: string,
  filename: string,
  operations: ScreenshotEditOperations,
) {
  return request<{ ok: true }>(
    `/recordings/${recordingId}/images/${filename}/edits`,
    {
      method: "PATCH",
      body: JSON.stringify(operations),
    },
  );
}

export function imageUrl(recordingId: string, filename: string): string {
  return `${API_BASE}/recordings/${recordingId}/images/${filename}`;
}

export function sourceImageUrl(recordingId: string, filename: string): string {
  return `${API_BASE}/recordings/${recordingId}/images/${filename}/source`;
}

export function exportUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/export`;
}

export function htmlExportUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/export/html`;
}

export function sanityExportUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/export/sanity`;
}

export function pdfExportUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/export/pdf`;
}

export function wordExportUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/export/word`;
}

export function projectExportUrl(recordingId: string): string {
  return `${API_BASE}/recordings/${recordingId}/project`;
}

export { download };
