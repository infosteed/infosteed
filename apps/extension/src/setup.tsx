// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CaptureMode, VideoCaptureSettings } from "@infosteed/shared";
import { getVideoCapability } from "./apiClient";
import { errorMessage } from "./errors";
import "./setup.css";

interface DeviceChoice {
  microphoneDeviceId?: string;
  cameraDeviceId?: string;
}

export function Setup() {
  const [captureMode, setCaptureMode] = useState<CaptureMode>("both");
  const [videoEnabled, setVideoEnabled] = useState<boolean | undefined>();
  const [tabAudio, setTabAudio] = useState(true);
  const [microphone, setMicrophone] = useState(true);
  const [webcam, setWebcam] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [choice, setChoice] = useState<DeviceChoice>({});
  const [previewing, setPreviewing] = useState(false);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [consent, setConsent] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);
  const previewStream = useRef<MediaStream>();
  const meterFrame = useRef<number>();

  function stopPreview() {
    if (meterFrame.current) cancelAnimationFrame(meterFrame.current);
    previewStream.current?.getTracks().forEach((track) => track.stop());
    previewStream.current = undefined;
    if (previewRef.current) previewRef.current.srcObject = null;
    setPreviewing(false);
    setLevel(0);
  }

  async function enablePreview() {
    stopPreview();
    setError(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: microphone
          ? {
              deviceId: choice.microphoneDeviceId
                ? { exact: choice.microphoneDeviceId }
                : undefined,
            }
          : false,
        video: webcam
          ? {
              deviceId: choice.cameraDeviceId
                ? { exact: choice.cameraDeviceId }
                : undefined,
              width: 640,
              height: 360,
            }
          : false,
      });
      previewStream.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play();
      }
      const nextDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(nextDevices);
      setPreviewing(true);

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        context
          .createMediaStreamSource(new MediaStream([audioTrack]))
          .connect(analyser);
        const values = new Uint8Array(analyser.frequencyBinCount);
        const measure = () => {
          analyser.getByteFrequencyData(values);
          setLevel(
            values.reduce((sum, value) => sum + value, 0) /
              Math.max(1, values.length) /
              255,
          );
          meterFrame.current = requestAnimationFrame(measure);
        };
        measure();
      }
    } catch (previewError) {
      setError(errorMessage(previewError));
    }
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const settings: VideoCaptureSettings = {
      tabAudio,
      microphone,
      webcam,
      microphoneDeviceId: choice.microphoneDeviceId || null,
      cameraDeviceId: choice.cameraDeviceId || null,
      maxWidth: 1920,
      maxHeight: 1080,
      frameRate: 30,
    };
    try {
      if (
        captureMode !== "guide" &&
        (microphone || webcam) &&
        !previewStream.current
      ) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: microphone
            ? {
                deviceId: choice.microphoneDeviceId
                  ? { exact: choice.microphoneDeviceId }
                  : undefined,
              }
            : false,
          video: webcam
            ? {
                deviceId: choice.cameraDeviceId
                  ? { exact: choice.cameraDeviceId }
                  : undefined,
              }
            : false,
        });
        permissionStream.getTracks().forEach((track) => track.stop());
      }
      stopPreview();
      const result = await chrome.runtime.sendMessage({
        type: "start-recording",
        captureMode,
        videoSettings: settings,
      });
      if (!result?.ok)
        throw new Error(result?.error ?? "Could not start recording");
      window.close();
    } catch (startError) {
      setError(errorMessage(startError));
      setBusy(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [capability, stored] = await Promise.all([
          getVideoCapability(),
          chrome.storage.local.get([
            "videoDeviceChoice",
            "videoCaptureSettings",
          ]),
        ]);
        setVideoEnabled(capability.enabled);
        if (!capability.enabled) setCaptureMode("guide");
        if (stored.videoDeviceChoice) setChoice(stored.videoDeviceChoice);
        if (stored.videoCaptureSettings) {
          setTabAudio(stored.videoCaptureSettings.tabAudio ?? true);
          setMicrophone(stored.videoCaptureSettings.microphone ?? true);
          setWebcam(stored.videoCaptureSettings.webcam ?? false);
        }
        setDevices(await navigator.mediaDevices.enumerateDevices());
      } catch (loadError) {
        setVideoEnabled(false);
        setCaptureMode("guide");
        setError(errorMessage(loadError));
      }
    })();
    return stopPreview;
  }, []);

  useEffect(() => {
    void chrome.storage.local.set({
      videoDeviceChoice: choice,
      videoCaptureSettings: { tabAudio, microphone, webcam },
    });
  }, [choice, tabAudio, microphone, webcam]);

  const usesVideo = captureMode !== "guide";
  const microphones = devices.filter((device) => device.kind === "audioinput");
  const cameras = devices.filter((device) => device.kind === "videoinput");

  return (
    <main>
      <header>
        <div>
          <p>InfoSteed</p>
          <h1>What do you want to create?</h1>
        </div>
      </header>
      <div
        className="mode-grid"
        role="radiogroup"
        aria-label="Recording output"
      >
        {(
          [
            [
              "both",
              "Video + Guide",
              "A narrated video and an editable guide with synchronized chapters.",
            ],
            [
              "video",
              "Video Only",
              "A shareable video with chapters generated from your actions.",
            ],
            [
              "guide",
              "Guide Only",
              "A screenshot-based guide you can review and edit.",
            ],
          ] as const
        ).map(([value, title, description]) => (
          <button
            key={value}
            className={captureMode === value ? "mode active" : "mode"}
            role="radio"
            aria-checked={captureMode === value}
            disabled={value !== "guide" && videoEnabled === false}
            onClick={() => setCaptureMode(value)}
          >
            <strong>
              {title}
              {value === "both" && <span>Default</span>}
            </strong>
            <small>{description}</small>
          </button>
        ))}
      </div>
      {videoEnabled === false && (
        <p className="notice">
          Video storage is not configured. Guide Only remains available.
        </p>
      )}

      {usesVideo && (
        <section className="media-panel">
          <h2>Audio and camera</h2>
          <label>
            <input
              type="checkbox"
              checked={tabAudio}
              onChange={(event) => setTabAudio(event.target.checked)}
            />{" "}
            Tab audio
          </label>
          <label>
            <input
              type="checkbox"
              checked={microphone}
              onChange={(event) => setMicrophone(event.target.checked)}
            />{" "}
            Microphone narration
          </label>
          {microphone && (
            <select
              value={choice.microphoneDeviceId ?? ""}
              onChange={(event) =>
                setChoice((current) => ({
                  ...current,
                  microphoneDeviceId: event.target.value || undefined,
                }))
              }
            >
              <option value="">Default microphone</option>
              {microphones.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Microphone"}
                </option>
              ))}
            </select>
          )}
          <label>
            <input
              type="checkbox"
              checked={webcam}
              onChange={(event) => setWebcam(event.target.checked)}
            />{" "}
            Webcam bubble
          </label>
          {webcam && (
            <select
              value={choice.cameraDeviceId ?? ""}
              onChange={(event) =>
                setChoice((current) => ({
                  ...current,
                  cameraDeviceId: event.target.value || undefined,
                }))
              }
            >
              <option value="">Default camera</option>
              {cameras.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Camera"}
                </option>
              ))}
            </select>
          )}
          {(microphone || webcam) && (
            <button
              className="secondary"
              onClick={() =>
                previewing ? stopPreview() : void enablePreview()
              }
            >
              {previewing ? "Stop device preview" : "Enable device preview"}
            </button>
          )}
          <div className="device-preview">
            {webcam && <video ref={previewRef} muted playsInline />}
            {microphone && (
              <div className="meter" aria-label="Microphone level">
                <span style={{ width: `${Math.round(level * 100)}%` }} />
              </div>
            )}
          </div>
        </section>
      )}

      <section className="consent-panel">
        <h2>Review capture consent</h2>
        <p>
          The selected self-hosted server will receive page titles and sanitized
          URLs, interaction metadata, and screenshots. Depending on your choices
          it will also receive video, microphone audio, tab audio, webcam video,
          transcription text, narration text, and generated speech.
        </p>
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />{" "}
          I understand and have permission to capture and transfer this data to
          the selected server.
        </label>
      </section>

      <footer>
        <p>Maximum 1080p at 30fps, 60 minutes</p>
        <button
          className="primary"
          disabled={busy || videoEnabled === undefined || !consent}
          onClick={() => void start()}
        >
          {busy ? "Starting..." : "Start recording"}
        </button>
      </footer>
      {error && <p className="error">{error}</p>}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Setup />);
