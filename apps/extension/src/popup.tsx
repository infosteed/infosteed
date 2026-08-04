// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentUser, getSettings } from "./apiClient";
import { BrandMark } from "./BrandMark";
import "./popup.css";

type Status = "idle" | "recording" | "paused" | "finalizing";
type AuthState = "checking" | "signed-in" | "signed-out";

function send(type: string) {
  return chrome.runtime.sendMessage({ type });
}

export function Popup() {
  const [status, setStatus] = useState<Status>("idle");
  const [recordingId, setRecordingId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [displayName, setDisplayName] = useState<string | undefined>();
  const [apiBaseUrl, setApiBaseUrl] = useState<string>("");
  const [webEditorUrl, setWebEditorUrl] = useState<string>("");
  const [captureMode, setCaptureMode] = useState<
    "guide" | "video" | "both" | undefined
  >();
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [followPending, setFollowPending] = useState(false);
  const [pendingTabTitle, setPendingTabTitle] = useState<string | undefined>();
  const [configured, setConfigured] = useState(false);

  async function refresh() {
    const stored = await chrome.storage.local.get([
      "recorderStatus",
      "recordingId",
      "captureMode",
      "serverOrigin",
    ]);
    const recorder = await chrome.runtime
      .sendMessage({ type: "get-recorder-state" })
      .catch(() => undefined);
    setStatus(stored.recorderStatus ?? "idle");
    setRecordingId(stored.recordingId);
    setCaptureMode(stored.captureMode);
    setRecoveryAvailable(Boolean(recorder?.recoveryAvailable));
    setFollowPending(Boolean(recorder?.followPending));
    setPendingTabTitle(recorder?.pendingTabTitle);
    setConfigured(Boolean(stored.serverOrigin));
    setApiBaseUrl(stored.serverOrigin ? `${stored.serverOrigin}/api` : "");
    setWebEditorUrl(stored.serverOrigin ?? "");
  }

  async function refreshAuth() {
    setAuthState("checking");
    const stored = await chrome.storage.local.get("serverOrigin");
    if (!stored.serverOrigin) {
      await refresh();
      setDisplayName(undefined);
      setAuthState("signed-out");
      return;
    }
    try {
      const [user] = await Promise.all([getCurrentUser(), refresh()]);
      setDisplayName(user.displayName || user.username);
      setAuthState("signed-in");
    } catch {
      await refresh();
      setDisplayName(undefined);
      setAuthState("signed-out");
    }
  }

  async function openSignIn() {
    const settings = await getSettings();
    await chrome.tabs.create({ url: settings.webEditorUrl });
  }

  async function openOptions() {
    await chrome.runtime.openOptionsPage();
  }

  async function act(type: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    if (type === "stop-recording") setStatus("finalizing");
    try {
      const result = await send(type);
      if (!result?.ok) {
        setError(result?.error ?? "Action failed");
        await refreshAuth();
      } else {
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  const signedOut = authState === "signed-out";
  const controlsDisabled =
    busy || !configured || signedOut || authState === "checking";

  return (
    <main>
      <header>
        <div className="product-brand">
          <BrandMark />
          <h1>InfoSteed</h1>
        </div>
        <span data-status={status}>{status}</span>
      </header>

      <div className={`auth-panel ${authState}`}>
        <div>
          <strong>
            {!configured
              ? "Server not configured"
              : authState === "checking"
                ? "Checking login..."
                : signedOut
                  ? "Not signed in"
                  : `Signed in as ${displayName}`}
          </strong>
          <p>Server: {webEditorUrl || "none"}</p>
        </div>
        {!configured ? (
          <button onClick={() => void openOptions()}>Configure</button>
        ) : signedOut ? (
          <button onClick={() => void openSignIn()}>Sign in</button>
        ) : (
          <button disabled={busy} onClick={() => void refreshAuth()}>
            Refresh
          </button>
        )}
      </div>

      {configured && (
        <button
          className="configure-link"
          disabled={status !== "idle" || recoveryAvailable}
          onClick={() => void openOptions()}
        >
          Server settings and permissions
        </button>
      )}

      {signedOut && (
        <p className="hint">
          Log in to the web app using the same API host. Cookies for localhost
          and 127.0.0.1 are separate.
        </p>
      )}

      {recoveryAvailable && (
        <div className="recovery-panel">
          <strong>Interrupted video found</strong>
          <p>
            Finalize the parts uploaded before the browser closed, or discard
            the interrupted recording.
          </p>
          <div>
            <button disabled={busy} onClick={() => act("recover-video")}>
              Recover video
            </button>
            <button disabled={busy} onClick={() => act("discard-recovery")}>
              Discard
            </button>
          </div>
        </div>
      )}

      {followPending && !recoveryAvailable && (
        <div className="follow-panel">
          <strong>New app tab detected</strong>
          <p>
            {pendingTabTitle
              ? `Switch the recording to “${pendingTabTitle}”.`
              : "Switch the recording to this tab."}
          </p>
          <button
            disabled={controlsDisabled}
            onClick={() => act("follow-pending-tab")}
          >
            Follow this tab
          </button>
        </div>
      )}

      {status !== "finalizing" && !recoveryAvailable && (
        <section>
          {status === "idle" && (
            <button
              disabled={controlsDisabled}
              onClick={() => act("open-recording-setup")}
            >
              Start recording
            </button>
          )}
          {status === "recording" && (
            <button
              disabled={controlsDisabled}
              onClick={() => act("pause-recording")}
            >
              Pause
            </button>
          )}
          {status === "paused" && (
            <button
              disabled={controlsDisabled}
              onClick={() => act("resume-recording")}
            >
              Resume
            </button>
          )}
          {status !== "idle" && (
            <button
              disabled={controlsDisabled}
              onClick={() => act("stop-recording")}
            >
              Stop
            </button>
          )}
        </section>
      )}

      {status === "finalizing" && (
        <div className="progress-panel" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>Finalizing recording...</strong>
            <p>
              Completing uploads and preparing your selected output. Keep this
              window open until the preview appears.
            </p>
          </div>
        </div>
      )}
      {captureMode && status !== "idle" && (
        <p className="id">
          Output:{" "}
          {captureMode === "both"
            ? "Video + Guide"
            : captureMode === "video"
              ? "Video Only"
              : "Guide Only"}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Popup />);
