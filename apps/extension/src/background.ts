// SPDX-License-Identifier: AGPL-3.0-only
import type {
  CaptureMode,
  RecordingEventInput,
  VideoCaptureSettings,
} from "@infosteed/shared";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";
import {
  createCaptureSession,
  createRecording,
  finalizeCaptureSession,
  finalizeRecording,
  finalizeVideo,
  getRecordingVideo,
  deleteRecordingVideo,
  deleteRecording,
  getSettings,
  pauseRecording,
  resumeRecording,
  uploadEventsForSession,
  uploadScreenshot,
} from "./apiClient";

interface RecorderState {
  status: "idle" | "recording" | "paused" | "finalizing";
  recordingId?: string;
  captureSessionId?: string;
  captureMode?: CaptureMode;
  targetTabId?: number;
  tabTrail?: number[];
  pendingFollowTabId?: number;
  pendingFollowOpenerTabId?: number;
}

interface PreparedScreenshot {
  createdAt: number;
  dataUrl: Promise<string>;
}
const preparedScreenshots = new Map<string, PreparedScreenshot>();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get("serverOrigin").then((stored) => {
    if (!stored.serverOrigin) return chrome.runtime.openOptionsPage();
  });
});

async function getState(): Promise<RecorderState> {
  const stored = await chrome.storage.local.get([
    "recorderStatus",
    "recordingId",
    "captureSessionId",
    "captureMode",
    "recordingTargetTabId",
    "recordingTabTrail",
    "recordingPendingFollowTabId",
    "recordingPendingFollowOpenerTabId",
  ]);
  return {
    status: stored.recorderStatus ?? "idle",
    recordingId: stored.recordingId,
    captureSessionId: stored.captureSessionId,
    captureMode: stored.captureMode,
    targetTabId: stored.recordingTargetTabId,
    tabTrail: Array.isArray(stored.recordingTabTrail)
      ? stored.recordingTabTrail.filter((tabId): tabId is number =>
          Number.isInteger(tabId),
        )
      : undefined,
    pendingFollowTabId: Number.isInteger(stored.recordingPendingFollowTabId)
      ? stored.recordingPendingFollowTabId
      : undefined,
    pendingFollowOpenerTabId: Number.isInteger(
      stored.recordingPendingFollowOpenerTabId,
    )
      ? stored.recordingPendingFollowOpenerTabId
      : undefined,
  };
}

async function setState(state: RecorderState): Promise<void> {
  await chrome.storage.local.set({
    recorderStatus: state.status,
    recordingId: state.recordingId,
    captureSessionId: state.captureSessionId,
    captureMode: state.captureMode,
    recordingTargetTabId: state.targetTabId,
    recordingTabTrail: state.tabTrail,
    recordingPendingFollowTabId: state.pendingFollowTabId,
    recordingPendingFollowOpenerTabId: state.pendingFollowOpenerTabId,
  });
  const remove = [
    !state.recordingId && "recordingId",
    !state.captureSessionId && "captureSessionId",
    !state.captureMode && "captureMode",
    state.targetTabId === undefined && "recordingTargetTabId",
    !state.tabTrail?.length && "recordingTabTrail",
    state.pendingFollowTabId === undefined && "recordingPendingFollowTabId",
    state.pendingFollowOpenerTabId === undefined &&
      "recordingPendingFollowOpenerTabId",
  ].filter(Boolean) as string[];
  if (remove.length) await chrome.storage.local.remove(remove);
  const followPending =
    state.status !== "idle" && state.pendingFollowTabId !== undefined;
  await chrome.action.setBadgeText({ text: followPending ? "!" : "" });
  if (followPending)
    await chrome.action.setBadgeBackgroundColor({ color: "#f79009" });
  await chrome.action.setTitle({
    title: followPending
      ? "InfoSteed — click to follow the new tab"
      : "InfoSteed",
  });
}

function dataUrlToBase64(dataUrl: string) {
  return dataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
}
function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "click"
  );
}
function cleanupPreparedScreenshots() {
  const cutoff = Date.now() - 5000;
  for (const [captureId, screenshot] of preparedScreenshots)
    if (screenshot.createdAt < cutoff) preparedScreenshots.delete(captureId);
}
function captureVisibleTab(windowId?: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(
    windowId ?? chrome.windows.WINDOW_ID_CURRENT,
    { format: "jpeg", quality: 85 },
  );
}
function tabMediaStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) =>
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const error = chrome.runtime.lastError;
      if (error || !streamId)
        reject(
          new Error(error?.message ?? "Chrome could not capture this tab"),
        );
      else resolve(streamId);
    }),
  );
}

async function ensureContentRecorder(targetTabId: number): Promise<void> {
  const ping = async () => {
    const response = await chrome.tabs
      .sendMessage(targetTabId, { type: PRODUCT_IDENTIFIERS.recorderPing })
      .catch(() => undefined);
    return response?.ok === true;
  };
  if (await ping()) return;

  // The content script replaces its own prior listeners, including scripts left
  // behind by a service-worker restart, so reinjection is safe and idempotent.
  await chrome.scripting.executeScript({
    target: { tabId: targetTabId, allFrames: true },
    files: ["contentScript.js"],
  });
  const installed = await chrome.scripting.executeScript({
    target: { tabId: targetTabId, frameIds: [0] },
    func: () =>
      Boolean(
        (window as Window & { __infosteedRecorderInstallation?: unknown })
          .__infosteedRecorderInstallation,
      ),
  });
  if (!installed.some((result) => result.result === true)) {
    throw new Error(
      "The action recorder could not start in this tab. Reload the page and try again.",
    );
  }
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification:
      "Record the captured tab with optional microphone and camera while the MV3 service worker sleeps",
  });
}

async function offscreen<T>(
  type: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok)
    throw new Error(response?.error ?? "The video recorder did not respond");
  return response.result as T;
}

function isRecordableTab(tab: chrome.tabs.Tab): boolean {
  return /^https?:/i.test(tab.url ?? tab.pendingUrl ?? "");
}

let tabHandoff: Promise<unknown> = Promise.resolve();
const pendingChildOpeners = new Map<number, number>();
function enqueueTabHandoff<T>(operation: () => Promise<T>): Promise<T> {
  const result = tabHandoff.then(operation, operation);
  tabHandoff = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function injectContentRecorderWhenPossible(
  tab: chrome.tabs.Tab,
): Promise<void> {
  if (!tab.id || !isRecordableTab(tab)) return;
  try {
    await ensureContentRecorder(tab.id);
  } catch (error) {
    // Declarative content-script injection still runs as the new page loads. A
    // programmatic injection can race the first navigation of a new tab.
    console.warn(
      "Could not inject the recorder into the followed tab yet",
      error,
    );
  }
}

async function followChildTab(
  tabId: number,
  openerTabId: number,
): Promise<boolean> {
  const current = await getState();
  if (
    (current.status !== "recording" && current.status !== "paused") ||
    current.targetTabId !== openerTabId
  )
    return false;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab?.id || !tab.active || !isRecordableTab(tab)) return false;

  if (current.captureMode === "video" || current.captureMode === "both") {
    if (current.pendingFollowTabId !== tab.id) {
      await setState({
        ...current,
        pendingFollowTabId: tab.id,
        pendingFollowOpenerTabId: openerTabId,
      });
    }
    return true;
  }
  const trail = current.tabTrail?.length ? current.tabTrail : [openerTabId];
  await setState({
    ...current,
    targetTabId: tab.id,
    tabTrail: [...trail.filter((candidate) => candidate !== tab.id), tab.id],
    pendingFollowTabId: undefined,
    pendingFollowOpenerTabId: undefined,
  });
  pendingChildOpeners.delete(tab.id);
  await injectContentRecorderWhenPossible(tab);
  return true;
}

async function followPendingVideoTab(): Promise<void> {
  const current = await getState();
  if (
    (current.captureMode !== "video" && current.captureMode !== "both") ||
    current.pendingFollowTabId === undefined
  ) {
    throw new Error("There is no new tab waiting to be followed");
  }
  if (current.pendingFollowOpenerTabId !== current.targetTabId)
    throw new Error("The pending tab no longer belongs to the recorded tab");
  const tab = await chrome.tabs
    .get(current.pendingFollowTabId)
    .catch(() => undefined);
  if (!tab?.id || !tab.active || !isRecordableTab(tab))
    throw new Error(
      "Activate the new app tab, then click Follow this tab again",
    );

  await ensureContentRecorder(tab.id);
  const streamId = await tabMediaStreamId(tab.id);
  await offscreen("offscreen-switch-tab", { tabId: tab.id, streamId });
  const trail = current.tabTrail?.length
    ? current.tabTrail
    : current.targetTabId === undefined
      ? []
      : [current.targetTabId];
  await setState({
    ...current,
    targetTabId: tab.id,
    tabTrail: [...trail.filter((candidate) => candidate !== tab.id), tab.id],
    pendingFollowTabId: undefined,
    pendingFollowOpenerTabId: undefined,
  });
  pendingChildOpeners.delete(tab.id);
  await injectContentRecorderWhenPossible(tab);
}

async function returnFromClosedTab(tabId: number): Promise<boolean> {
  const current = await getState();
  if (current.status === "idle" || current.status === "finalizing") return true;
  if (current.pendingFollowTabId === tabId) {
    await setState({
      ...current,
      pendingFollowTabId: undefined,
      pendingFollowOpenerTabId: undefined,
    });
    return true;
  }
  const trail = (
    current.tabTrail?.length
      ? current.tabTrail
      : current.targetTabId !== undefined
        ? [current.targetTabId]
        : []
  ).filter((candidate) => candidate !== tabId);
  if (current.targetTabId !== tabId) {
    if (trail.length !== current.tabTrail?.length)
      await setState({ ...current, tabTrail: trail });
    return true;
  }

  for (let index = trail.length - 1; index >= 0; index -= 1) {
    const fallbackTab = await chrome.tabs
      .get(trail[index])
      .catch(() => undefined);
    if (!fallbackTab?.id || !isRecordableTab(fallbackTab)) continue;
    if (current.captureMode === "video" || current.captureMode === "both") {
      try {
        const streamId = await tabMediaStreamId(fallbackTab.id);
        await offscreen("offscreen-switch-tab", {
          tabId: fallbackTab.id,
          streamId,
        });
      } catch (error) {
        console.warn("Could not resume capture from a parent tab", error);
        continue;
      }
    }
    await setState({
      ...current,
      targetTabId: fallbackTab.id,
      tabTrail: trail.slice(0, index + 1),
    });
    await injectContentRecorderWhenPossible(fallbackTab);
    return true;
  }
  return false;
}

async function stopCurrentRecording(recovered = false) {
  const current = await getState();
  if (!current.recordingId) return;
  await setState({ ...current, status: "finalizing" });
  try {
    if (current.captureMode === "video" || current.captureMode === "both") {
      await offscreen("offscreen-stop", { recovered });
    } else if (current.captureSessionId) {
      await finalizeCaptureSession(
        current.recordingId,
        current.captureSessionId,
      );
    } else {
      await finalizeRecording(current.recordingId);
    }
    const settings = await getSettings();
    const view = current.captureMode === "guide" ? "" : "&view=video";
    await chrome.tabs.create({
      url: `${settings.webEditorUrl}/?recordingId=${current.recordingId}${view}`,
    });
    await setState({ status: "idle" });
  } catch (error) {
    if (
      (current.captureMode === "video" || current.captureMode === "both") &&
      (await chrome.offscreen.hasDocument())
    ) {
      await chrome.offscreen.closeDocument();
      await setState({ ...current, status: "paused" });
    } else {
      await setState(current);
    }
    throw error;
  }
}

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.id || tab.openerTabId === undefined) return;
  pendingChildOpeners.set(tab.id, tab.openerTabId);
  if (!tab.active) return;
  void enqueueTabHandoff(() => followChildTab(tab.id!, tab.openerTabId!)).catch(
    (error) => {
      console.warn("Could not follow the newly opened tab", error);
    },
  );
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.tabs
    .get(tabId)
    .then((tab) => {
      const openerTabId = tab.openerTabId ?? pendingChildOpeners.get(tabId);
      if (openerTabId === undefined) return;
      return enqueueTabHandoff(() => followChildTab(tabId, openerTabId));
    })
    .catch((error) =>
      console.warn("Could not follow the activated child tab", error),
    );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  void enqueueTabHandoff(async () => {
    const current = await getState();
    const openerTabId = tab.openerTabId ?? pendingChildOpeners.get(tabId);
    if (
      tab.active &&
      openerTabId !== undefined &&
      openerTabId === current.targetTabId
    ) {
      return followChildTab(tabId, openerTabId);
    }
    if (tabId === current.targetTabId)
      await injectContentRecorderWhenPossible(tab);
    return false;
  }).catch((error) =>
    console.warn("Could not prepare the followed tab", error),
  );
});

chrome.tabs.onRemoved.addListener((tabId) => {
  pendingChildOpeners.delete(tabId);
  void enqueueTabHandoff(async () => {
    if (!(await returnFromClosedTab(tabId))) await stopCurrentRecording();
  }).catch((error) =>
    console.warn("Could not return from the closed recorded tab", error),
  );
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(
  ({ sourceTabId, tabId }) => {
    pendingChildOpeners.set(tabId, sourceTabId);
    void enqueueTabHandoff(() => followChildTab(tabId, sourceTabId)).catch(
      (error) => {
        console.warn(
          "Could not follow the newly created navigation target",
          error,
        );
      },
    );
  },
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    if (message.type === "open-recording-setup") {
      const tab = (
        await chrome.tabs.query({ active: true, currentWindow: true })
      )[0];
      if (!tab?.id || !tab.url?.match(/^https?:/))
        throw new Error("Open the browser tab you want to record first");
      await chrome.storage.local.set({ setupTargetTabId: tab.id });
      await chrome.tabs.create({
        url: chrome.runtime.getURL("src/setup.html"),
      });
      return { ok: true };
    }

    if (message.type === "get-recorder-state") {
      const state = await getState();
      const videoMode =
        state.captureMode === "video" || state.captureMode === "both";
      const pendingTab =
        state.pendingFollowTabId === undefined
          ? undefined
          : await chrome.tabs
              .get(state.pendingFollowTabId)
              .catch(() => undefined);
      return {
        ok: true,
        state,
        recoveryAvailable:
          videoMode &&
          state.status !== "idle" &&
          !(await chrome.offscreen.hasDocument()),
        followPending: Boolean(pendingTab),
        pendingTabTitle: pendingTab?.title,
      };
    }

    if (message.type === "follow-pending-tab") {
      await enqueueTabHandoff(followPendingVideoTab);
      return { ok: true };
    }

    if (message.type === "recover-video") {
      const current = await getState();
      if (
        !current.recordingId ||
        (current.captureMode !== "video" && current.captureMode !== "both")
      )
        throw new Error("No video recording can be recovered");
      const [video, storedOffset] = await Promise.all([
        getRecordingVideo(current.recordingId),
        chrome.storage.local.get("lastVideoOffsetMs"),
      ]);
      await setState({ ...current, status: "finalizing" });
      try {
        await finalizeVideo(current.recordingId, {
          durationMs: Math.max(0, Number(storedOffset.lastVideoOffsetMs) || 0),
          recovered: true,
          assets: video.assets
            .filter((asset) => asset.status === "uploading")
            .map((asset) => ({ assetId: asset.id })),
        });
        const settings = await getSettings();
        await chrome.tabs.create({
          url: `${settings.webEditorUrl}/?recordingId=${current.recordingId}&view=video`,
        });
        await chrome.storage.local.remove("lastVideoOffsetMs");
        await setState({ status: "idle" });
        return { ok: true };
      } catch (error) {
        await setState(current);
        throw error;
      }
    }

    if (message.type === "discard-recovery") {
      const current = await getState();
      if (!current.recordingId)
        throw new Error("No interrupted recording to discard");
      await deleteRecordingVideo(current.recordingId);
      await chrome.storage.local.remove("lastVideoOffsetMs");
      await setState({ status: "idle" });
      return { ok: true };
    }

    if (message.type === "start-recording") {
      const captureMode = (message.captureMode ?? "guide") as CaptureMode;
      const stored = await chrome.storage.local.get("setupTargetTabId");
      const targetTabId = Number(stored.setupTargetTabId);
      const tab = Number.isInteger(targetTabId)
        ? await chrome.tabs.get(targetTabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.id)
        throw new Error("The tab selected for recording is no longer open");
      await ensureContentRecorder(tab.id);
      const recording = await createRecording(
        tab.title ? `Record ${tab.title}` : "Browser workflow",
        captureMode,
      );
      if (captureMode !== "guide") {
        try {
          await ensureOffscreenDocument();
          const streamId = await tabMediaStreamId(tab.id);
          const connection = await getSettings();
          await offscreen("offscreen-start", {
            recordingId: recording.id,
            tabId: tab.id,
            streamId,
            settings: message.videoSettings as VideoCaptureSettings,
            connection,
          });
        } catch (error) {
          if (await chrome.offscreen.hasDocument())
            await chrome.offscreen.closeDocument();
          await deleteRecordingVideo(recording.id).catch(() => undefined);
          await deleteRecording(recording.id).catch(() => undefined);
          throw error;
        }
      }
      await setState({
        status: "recording",
        recordingId: recording.id,
        captureMode,
        targetTabId: tab.id,
        tabTrail: [tab.id],
      });
      await chrome.storage.local.remove("setupTargetTabId");
      return { ok: true, recordingId: recording.id };
    }

    if (message.type === "start-recording-existing") {
      if (typeof message.recordingId !== "string")
        throw new Error("Missing recording id");
      if (sender.tab?.id !== undefined)
        await ensureContentRecorder(sender.tab.id);
      const session = await createCaptureSession(message.recordingId);
      await setState({
        status: "recording",
        recordingId: session.recordingId,
        captureSessionId: session.captureSessionId,
        captureMode: "guide",
        targetTabId: sender.tab?.id,
        tabTrail: sender.tab?.id === undefined ? undefined : [sender.tab.id],
      });
      return {
        ok: true,
        recordingId: session.recordingId,
        captureSessionId: session.captureSessionId,
      };
    }

    if (message.type === "pause-recording") {
      const current = await getState();
      if (current.recordingId) await pauseRecording(current.recordingId);
      if (current.captureMode === "video" || current.captureMode === "both")
        await offscreen("offscreen-pause");
      await setState({ ...current, status: "paused" });
      return { ok: true };
    }

    if (message.type === "resume-recording") {
      const current = await getState();
      if (!current.recordingId) throw new Error("No recording to resume");
      await resumeRecording(current.recordingId);
      if (current.captureMode === "video" || current.captureMode === "both")
        await offscreen("offscreen-resume");
      await setState({ ...current, status: "recording" });
      return { ok: true };
    }

    if (message.type === "stop-recording") {
      await stopCurrentRecording();
      return { ok: true };
    }
    if (message.type === "video-duration-limit") {
      await stopCurrentRecording();
      return { ok: true };
    }
    if (message.type === "captured-tab-ended") {
      const tabId = Number(message.tabId);
      if (Number.isInteger(tabId)) {
        await enqueueTabHandoff(async () => {
          if (!(await returnFromClosedTab(tabId))) await stopCurrentRecording();
        });
      }
      return { ok: true };
    }
    if (message.type === "video-upload-backlog") {
      const current = await getState();
      if (current.status === "recording") {
        if (current.recordingId) await pauseRecording(current.recordingId);
        await offscreen("offscreen-pause");
        await setState({ ...current, status: "paused" });
      }
      return { ok: true };
    }

    if (message.type === "video-offset-progress") {
      const offsetMs = Number(message.offsetMs);
      if (Number.isFinite(offsetMs) && offsetMs >= 0)
        await chrome.storage.local.set({ lastVideoOffsetMs: offsetMs });
      return { ok: true };
    }

    if (message.type === "video-offset-clear") {
      await chrome.storage.local.remove("lastVideoOffsetMs");
      return { ok: true };
    }

    if (message.type === "prepare-action-screenshot") {
      const current = await getState();
      if (
        current.status !== "recording" ||
        !current.recordingId ||
        current.captureMode === "video" ||
        (current.targetTabId !== undefined &&
          sender.tab?.id !== current.targetTabId) ||
        typeof message.captureId !== "string"
      ) {
        return { ok: true, skipped: true };
      }
      cleanupPreparedScreenshots();
      const dataUrl = captureVisibleTab(sender.tab?.windowId).catch((error) => {
        preparedScreenshots.delete(message.captureId);
        throw error;
      });
      preparedScreenshots.set(message.captureId, {
        createdAt: Date.now(),
        dataUrl,
      });
      void dataUrl.catch(() => undefined);
      return { ok: true };
    }

    if (message.type === "record-action") {
      const current = await getState();
      if (
        current.status !== "recording" ||
        !current.recordingId ||
        (current.targetTabId !== undefined &&
          sender.tab?.id !== current.targetTabId)
      )
        return { ok: true, skipped: true };
      const event: RecordingEventInput = { ...message.event };
      if (current.captureMode === "video" || current.captureMode === "both") {
        const timing = await offscreen<{ offsetMs: number }>(
          "offscreen-offset",
        );
        event.videoOffsetMs = timing.offsetMs;
      }
      const prepared =
        typeof message.captureId === "string"
          ? preparedScreenshots.get(message.captureId)?.dataUrl
          : undefined;
      if (typeof message.captureId === "string")
        preparedScreenshots.delete(message.captureId);
      const saved = await uploadEventsForSession(
        current.recordingId,
        [event],
        current.captureSessionId,
      );
      const savedEvent = saved.events[0];
      if (current.captureMode !== "video") {
        let dataUrl: string;
        try {
          dataUrl = prepared
            ? await prepared
            : await captureVisibleTab(sender.tab?.windowId);
        } catch {
          dataUrl = await captureVisibleTab(sender.tab?.windowId);
        }
        const filename = `step-${String(savedEvent.ordinal + 1).padStart(3, "0")}-${slug(savedEvent.elementName ?? savedEvent.actionType)}.webp`;
        await uploadScreenshot(current.recordingId, {
          eventId: savedEvent.id,
          filename,
          contentType: "image/jpeg",
          imageBase64: dataUrlToBase64(dataUrl),
          targetBox: savedEvent.boundingBox,
        });
      }
      return { ok: true, eventId: savedEvent.id };
    }

    return { ok: false, error: "Unknown message type" };
  })()
    .then(sendResponse)
    .catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        detail.includes("API request failed: 401") ||
        detail.includes("API request failed: 428")
      ) {
        void getSettings().then((settings) =>
          chrome.tabs.create({ url: settings.webEditorUrl }),
        );
        sendResponse({
          ok: false,
          error: "Login required. Opened InfoSteed so you can sign in.",
        });
        return;
      }
      sendResponse({ ok: false, error: detail });
    });
  return true;
});
