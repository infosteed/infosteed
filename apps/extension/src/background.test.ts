// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./apiClient", () => ({
  createCaptureSession: vi.fn(),
  createRecording: vi.fn(),
  deleteRecording: vi.fn(),
  deleteRecordingVideo: vi.fn(),
  finalizeCaptureSession: vi.fn(),
  finalizeRecording: vi.fn(),
  finalizeVideo: vi.fn(),
  getRecordingVideo: vi.fn(),
  getSettings: vi.fn(),
  pauseRecording: vi.fn(),
  resumeRecording: vi.fn(),
  uploadEventsForSession: vi.fn(),
  uploadScreenshot: vi.fn(),
}));

vi.mock("./i18n", () => ({
  t: (key: string, values?: Record<string, string>) =>
    values
      ? Object.entries(values).reduce(
          (text, [name, value]) => text.replace(`{${name}}`, value),
          key,
        )
      : key,
}));

function createEvent<T extends (...args: never[]) => void>() {
  const listeners: T[] = [];
  return {
    addListener: vi.fn((listener: T) => {
      listeners.push(listener);
    }),
    emit: (...args: Parameters<T>) => {
      for (const listener of listeners) listener(...args);
    },
  };
}

function tab(overrides: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    active: false,
    autoDiscardable: true,
    discarded: false,
    groupId: -1,
    highlighted: false,
    id: 1,
    incognito: false,
    index: 0,
    pinned: false,
    selected: false,
    status: "complete",
    windowId: 1,
    ...overrides,
  };
}

describe("extension background tab handoff", () => {
  const store = new Map<string, unknown>();
  const tabs = new Map<number, chrome.tabs.Tab>();
  let onUpdated: ReturnType<
    typeof createEvent<
      (
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab,
      ) => void
    >
  >;
  let onMessage: ReturnType<
    typeof createEvent<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => void
    >
  >;
  let executeScript: ReturnType<typeof vi.fn>;
  let setBadgeText: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    store.clear();
    tabs.clear();
    executeScript = vi.fn().mockResolvedValue([{ result: true }]);
    setBadgeText = vi.fn().mockResolvedValue(undefined);
    onUpdated = createEvent();

    const onInstalled = createEvent<() => void>();
    const onCreated = createEvent<(tab: chrome.tabs.Tab) => void>();
    const onActivated = createEvent<
      (activeInfo: chrome.tabs.TabActiveInfo) => void
    >();
    const onRemoved = createEvent<(tabId: number) => void>();
    const onCreatedNavigationTarget = createEvent<
      (details: chrome.webNavigation.WebNavigationSourceCallbackDetails) => void
    >();
    onMessage = createEvent<
      (
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: unknown) => void,
      ) => void
    >();

    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        action: {
          setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
          setBadgeText,
          setTitle: vi.fn().mockResolvedValue(undefined),
        },
        offscreen: {
          closeDocument: vi.fn().mockResolvedValue(undefined),
          createDocument: vi.fn().mockResolvedValue(undefined),
          hasDocument: vi.fn().mockResolvedValue(false),
          Reason: { USER_MEDIA: "USER_MEDIA" },
        },
        runtime: {
          getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
          lastError: undefined,
          onInstalled,
          onMessage,
          openOptionsPage: vi.fn().mockResolvedValue(undefined),
          sendMessage: vi.fn(),
        },
        scripting: {
          executeScript,
        },
        storage: {
          local: {
            get: vi.fn(async (keys?: string | string[]) => {
              if (typeof keys === "string") return { [keys]: store.get(keys) };
              if (Array.isArray(keys)) {
                return Object.fromEntries(
                  keys.map((key) => [key, store.get(key)]),
                );
              }
              return Object.fromEntries(store);
            }),
            remove: vi.fn(async (keys: string | string[]) => {
              for (const key of Array.isArray(keys) ? keys : [keys])
                store.delete(key);
            }),
            set: vi.fn(async (values: Record<string, unknown>) => {
              for (const [key, value] of Object.entries(values))
                store.set(key, value);
            }),
          },
        },
        tabCapture: {
          getMediaStreamId: vi.fn(),
        },
        tabs: {
          captureVisibleTab: vi.fn(),
          create: vi.fn().mockResolvedValue(undefined),
          get: vi.fn(async (tabId: number) => tabs.get(tabId)),
          onActivated,
          onCreated,
          onRemoved,
          onUpdated,
          query: vi.fn().mockResolvedValue([]),
          sendMessage: vi.fn().mockResolvedValue(undefined),
        },
        webNavigation: {
          onCreatedNavigationTarget,
        },
        windows: {
          WINDOW_ID_CURRENT: -2,
        },
      },
    });

    await import("./background");
  });

  function sendBackgroundMessage(message: unknown) {
    return new Promise<unknown>((resolve) => {
      onMessage.emit(message, {}, resolve);
    });
  }

  it("auto-follows a guide-only pending child tab when it becomes recordable", async () => {
    store.set("recorderStatus", "recording");
    store.set("recordingId", "00000000-0000-4000-8000-000000000099");
    store.set("captureMode", "guide");
    store.set("recordingTargetTabId", 1);
    store.set("recordingTabTrail", [1]);
    store.set("recordingPendingFollowTabId", 2);
    store.set("recordingPendingFollowOpenerTabId", 1);
    tabs.set(
      2,
      tab({
        active: true,
        id: 2,
        title: "Child app",
        url: "https://child.example.test/app",
      }),
    );

    onUpdated.emit(
      2,
      { status: "complete" },
      tab({
        active: true,
        id: 2,
        title: "Child app",
        url: "https://child.example.test/app",
      }),
    );

    await vi.waitFor(() =>
      expect(store.get("recordingTargetTabId")).toBe(2),
    );
    expect(store.get("recordingTabTrail")).toEqual([1, 2]);
    expect(store.has("recordingPendingFollowTabId")).toBe(false);
    expect(store.has("recordingPendingFollowOpenerTabId")).toBe(false);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 2, allFrames: true },
      files: ["contentScript.js"],
    });
    expect(setBadgeText).toHaveBeenLastCalledWith({ text: "" });
  });

  it("keeps guide-only pending child tabs out of the manual follow prompt", async () => {
    store.set("recorderStatus", "recording");
    store.set("recordingId", "00000000-0000-4000-8000-000000000099");
    store.set("captureMode", "guide");
    store.set("recordingTargetTabId", 1);
    store.set("recordingPendingFollowTabId", 2);
    store.set("recordingPendingFollowOpenerTabId", 1);
    tabs.set(2, tab({ id: 2, title: "Child app" }));

    await expect(
      sendBackgroundMessage({ type: "get-recorder-state" }),
    ).resolves.toMatchObject({
      ok: true,
      followPending: false,
      pendingTabTitle: "Child app",
    });
  });

  it("reports pending child tabs for video-mode manual follow", async () => {
    store.set("recorderStatus", "recording");
    store.set("recordingId", "00000000-0000-4000-8000-000000000099");
    store.set("captureMode", "both");
    store.set("recordingTargetTabId", 1);
    store.set("recordingPendingFollowTabId", 2);
    store.set("recordingPendingFollowOpenerTabId", 1);
    tabs.set(2, tab({ id: 2, title: "Child app" }));

    await expect(
      sendBackgroundMessage({ type: "get-recorder-state" }),
    ).resolves.toMatchObject({
      ok: true,
      followPending: true,
      pendingTabTitle: "Child app",
    });
  });
});
