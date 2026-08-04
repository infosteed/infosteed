// SPDX-License-Identifier: AGPL-3.0-only
import type {
  BrandingSettings,
  CurrentUser,
  GuideItem,
  Project,
  ProjectMember,
  Recording,
  RecordingListItem,
  RecordingTranscript,
  RecordingVideo,
  VideoEditRecipe,
  VideoEditorState,
} from "@infosteed/shared";

export const fixtureIds = {
  user: "00000000-0000-4000-8000-000000000001",
  otherUser: "00000000-0000-4000-8000-000000000002",
  project: "00000000-0000-4000-8000-000000000010",
  recording: "00000000-0000-4000-8000-000000000020",
  item: "00000000-0000-4000-8000-000000000030",
  video: "00000000-0000-4000-8000-000000000040",
} as const;

export function currentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: fixtureIds.user,
    username: "owner",
    displayName: "Recording Owner",
    role: "admin",
    enabled: true,
    twoFactorEnabled: false,
    twoFactorRequired: false,
    ...overrides,
  };
}

export function branding(
  overrides: Partial<BrandingSettings> = {},
): BrandingSettings {
  return { displayName: "InfoSteed", iconDataUrl: null, ...overrides };
}

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: fixtureIds.project,
    ownerUserId: fixtureIds.user,
    name: "Onboarding",
    description: null,
    private: true,
    role: "owner",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

export function projectMember(
  overrides: Partial<ProjectMember> = {},
): ProjectMember {
  return {
    projectId: fixtureIds.project,
    userId: fixtureIds.user,
    username: "owner",
    displayName: "Recording Owner",
    role: "owner",
    enabled: true,
    ...overrides,
  };
}

export function guideItem(overrides: Partial<GuideItem> = {}): GuideItem {
  return {
    id: fixtureIds.item,
    recordingId: fixtureIds.recording,
    eventId: null,
    ordinal: 0,
    kind: "step",
    title: "Open settings",
    body: "Open the settings page.",
    imageFilename: null,
    altText: null,
    source: "manual",
    userEdited: true,
    ...overrides,
  };
}

export function recording(overrides: Partial<Recording> = {}): Recording {
  const item = guideItem();
  return {
    id: fixtureIds.recording,
    title: "Configure the workspace",
    purpose: "Prepare a new workspace",
    audience: "Administrators",
    ownerUserId: fixtureIds.user,
    projectId: fixtureIds.project,
    userRole: "owner",
    deletedAt: null,
    restorableUntil: null,
    captureMode: "guide",
    state: "finalized",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    finalizedAt: "2026-01-02T00:00:00.000Z",
    events: [],
    steps: [],
    items: [item],
    ...overrides,
  };
}

export function recordingListItem(
  overrides: Partial<RecordingListItem> = {},
): RecordingListItem {
  return {
    id: fixtureIds.recording,
    title: "Configure the workspace",
    overview: "Prepare a new workspace.",
    projectId: fixtureIds.project,
    projectName: "Onboarding",
    ownerUserId: fixtureIds.user,
    ownerDisplayName: "Recording Owner",
    updatedAt: "2026-01-02T00:00:00.000Z",
    finalizedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: null,
    restorableUntil: null,
    stepCount: 1,
    userRole: "owner",
    thumbnailFilename: null,
    captureMode: "guide",
    ...overrides,
  };
}

export function recordingVideo(
  overrides: Partial<RecordingVideo> = {},
): RecordingVideo {
  return {
    id: fixtureIds.video,
    recordingId: fixtureIds.recording,
    status: "ready",
    durationMs: 10_000,
    captureSettings: {
      tabAudio: true,
      microphone: false,
      webcam: false,
      maxWidth: 1920,
      maxHeight: 1080,
      frameRate: 30,
    },
    rawAssetsComplete: true,
    recovered: false,
    errorMessage: null,
    transcriptionStatus: "ready",
    transcriptionAvailable: true,
    transcriptionLanguage: "en",
    transcriptionErrorMessage: null,
    publishedAt: null,
    editingAvailable: true,
    renderWorkerAvailable: true,
    playbackVersionId: null,
    effectiveDurationMs: 10_000,
    assets: [],
    chapters: [],
    ...overrides,
  };
}

export function recordingTranscript(
  overrides: Partial<RecordingTranscript> = {},
): RecordingTranscript {
  return {
    status: "ready",
    model: "fixture",
    language: "en",
    languageProbability: 1,
    durationMs: 10_000,
    sourceAssetKind: "transcription",
    text: "Open settings.",
    segments: [],
    cues: [],
    words: [],
    errorMessage: null,
    ...overrides,
  };
}

export function videoEditRecipe(
  overrides: Partial<VideoEditRecipe> = {},
): VideoEditRecipe {
  return {
    version: 1,
    sourceDurationMs: 10_000,
    keepRanges: [{ startMs: 0, endMs: 10_000 }],
    webcam: { visible: false, centerX: 0.8, centerY: 0.8, diameter: 0.2 },
    audio: { tabGain: 1, microphoneGain: 1, voiceoverGain: 1 },
    voiceover: { enabled: false, assetId: null, generationId: null },
    chapters: [],
    captions: { mode: "transcript" },
    ...overrides,
  };
}

export function videoEditorState(
  overrides: Partial<VideoEditorState> = {},
): VideoEditorState {
  return {
    draft: {
      revision: 1,
      recipe: videoEditRecipe(),
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
    versions: [],
    renders: [],
    sourceAssets: [],
    transcriptCues: [],
    workerAvailable: true,
    voiceover: null,
    voiceoverAvailable: false,
    ...overrides,
  };
}
