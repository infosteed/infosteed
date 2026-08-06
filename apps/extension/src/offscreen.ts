// SPDX-License-Identifier: AGPL-3.0-only
import type {
  OutputLocale,
  RecordingVideo,
  VideoAssetKind,
  VideoCaptureSettings,
} from "@infosteed/shared";
import {
  ActiveRecordingClock,
  chooseTranscriptionAudioSource,
  chooseVideoRecorderOptions,
  shouldAutoPauseUpload,
  TRANSCRIPTION_AUDIO_BITS_PER_SECOND,
} from "@infosteed/recorder-core";
import {
  configureRuntimeSettings,
  finalizeVideo,
  initializeVideo,
  uploadVideoPart,
  type ExtensionSettings,
} from "./apiClient";
import { t } from "./i18n";

const PART_BYTES = 8 * 1024 * 1024;
const MAX_BACKLOG_BYTES = 128 * 1024 * 1024;
const MAX_DURATION_MS = 3_600_000;

interface StartMessage {
  type: "offscreen-start";
  recordingId: string;
  tabId: number;
  streamId: string;
  settings: VideoCaptureSettings;
  connection: ExtensionSettings;
  outputLocale: OutputLocale;
}

interface SwitchTabMessage {
  type: "offscreen-switch-tab";
  tabId: number;
  streamId: string;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MultipartUploader {
  private blobs: Blob[] = [];
  private bytes = 0;
  private partNumber = 0;
  private partStartMs = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly recordingId: string,
    readonly assetId: string,
    private readonly clock: ActiveRecordingClock,
    private readonly backlog: { bytes: number; pauseRequested: boolean },
  ) {}

  add(blob: Blob) {
    if (!blob.size) return;
    if (this.blobs.length === 0) this.partStartMs = this.clock.elapsed();
    this.blobs.push(blob);
    this.bytes += blob.size;
    this.backlog.bytes += blob.size;
    if (
      shouldAutoPauseUpload(this.backlog.bytes, MAX_BACKLOG_BYTES) &&
      !this.backlog.pauseRequested
    ) {
      this.backlog.pauseRequested = true;
      void chrome.runtime.sendMessage({ type: "video-upload-backlog" });
    }
    if (this.bytes >= PART_BYTES) this.queueFlush();
  }

  private queueFlush() {
    if (this.bytes === 0) return;
    const body = new Blob(this.blobs, { type: "application/octet-stream" });
    const startedAtMs = this.partStartMs;
    const endedAtMs = this.clock.elapsed();
    const partNumber = ++this.partNumber;
    this.blobs = [];
    this.bytes = 0;
    this.chain = this.chain.then(async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          await uploadVideoPart(
            this.recordingId,
            this.assetId,
            partNumber,
            body,
            startedAtMs,
            endedAtMs,
          );
          this.backlog.bytes -= body.size;
          return;
        } catch (error) {
          lastError = error;
          await delay(500 * 2 ** attempt);
        }
      }
      throw lastError;
    });
  }

  async finish() {
    this.queueFlush();
    await this.chain;
  }
}

class OffscreenRecorder {
  private clock = new ActiveRecordingClock();
  private mediaRecorders: MediaRecorder[] = [];
  private uploaders: MultipartUploader[] = [];
  private streams: MediaStream[] = [];
  private audioContext?: AudioContext;
  private mixedAudio?: MediaStreamAudioDestinationNode;
  private screenAudio?: MediaStreamAudioDestinationNode;
  private transcriptionAudio?: MediaStreamAudioDestinationNode;
  private tabAudioSource?: MediaStreamAudioSourceNode;
  private tabVideo?: HTMLVideoElement;
  private currentTabStream?: MediaStream;
  private currentTabId?: number;
  private settings?: VideoCaptureSettings;
  private drawTimer?: number;
  private durationTimer?: number;
  private recordingId = "";
  private outputLocale: OutputLocale = "en";
  private stopping = false;
  private backlog = { bytes: 0, pauseRequested: false };

  elapsed() {
    return this.clock.elapsed();
  }

  private videoRecorderOptions(
    stream: MediaStream,
    videoBitsPerSecond: number,
  ): MediaRecorderOptions & { mimeType: string } {
    return chooseVideoRecorderOptions({
      hasAudio: stream.getAudioTracks().length > 0,
      isSupported: (mimeType) => MediaRecorder.isTypeSupported(mimeType),
      videoBitsPerSecond,
      audioBitsPerSecond: 128_000,
    });
  }

  private audioMimeType() {
    return MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
  }

  private async tabStream(streamId: string, settings: VideoCaptureSettings) {
    const constraints = {
      audio: settings.tabAudio
        ? ({
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId,
            },
          } as unknown as MediaTrackConstraints)
        : false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
          maxWidth: settings.maxWidth,
          maxHeight: settings.maxHeight,
          maxFrameRate: settings.frameRate,
        },
      } as unknown as MediaTrackConstraints,
    };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  private watchTabStream(stream: MediaStream, tabId: number) {
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (!this.stopping && this.currentTabStream === stream) {
        void chrome.runtime.sendMessage({ type: "captured-tab-ended", tabId });
      }
    });
  }

  private connectTabAudio(stream: MediaStream) {
    this.tabAudioSource?.disconnect();
    this.tabAudioSource = undefined;
    const tracks = stream.getAudioTracks();
    if (
      !tracks.length ||
      !this.audioContext ||
      !this.mixedAudio ||
      !this.screenAudio
    )
      return;
    const source = this.audioContext.createMediaStreamSource(
      new MediaStream(tracks),
    );
    source.connect(this.mixedAudio);
    source.connect(this.screenAudio);
    if (!this.settings?.microphone) source.connect(this.transcriptionAudio!);
    source.connect(this.audioContext.destination);
    this.tabAudioSource = source;
  }

  async switchTab(message: SwitchTabMessage) {
    if (!this.settings || !this.tabVideo || !this.currentTabStream)
      throw new Error(t("No active tab recording to switch"));
    if (this.currentTabId === message.tabId) return { tabId: message.tabId };

    const previous = this.currentTabStream;
    const next = await this.tabStream(message.streamId, this.settings);
    try {
      this.tabVideo.srcObject = new MediaStream(next.getVideoTracks());
      await this.tabVideo.play();
      this.currentTabStream = next;
      this.currentTabId = message.tabId;
      this.watchTabStream(next, message.tabId);
      this.connectTabAudio(next);
      this.streams.push(next);
      this.streams = this.streams.filter((stream) => stream !== previous);
      previous.getTracks().forEach((track) => track.stop());
      return { tabId: message.tabId };
    } catch (error) {
      next.getTracks().forEach((track) => track.stop());
      this.tabVideo.srcObject = new MediaStream(previous.getVideoTracks());
      await this.tabVideo.play().catch(() => undefined);
      throw error;
    }
  }

  async start(message: StartMessage) {
    if (this.mediaRecorders.length)
      throw new Error(t("A video recording is already active"));
    configureRuntimeSettings(message.connection);
    this.recordingId = message.recordingId;
    this.outputLocale = message.outputLocale;
    this.settings = message.settings;
    const tab = await this.tabStream(message.streamId, message.settings);
    this.currentTabStream = tab;
    this.currentTabId = message.tabId;
    this.watchTabStream(tab, message.tabId);
    this.streams.push(tab);
    const microphone = message.settings.microphone
      ? await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: message.settings.microphoneDeviceId
              ? { exact: message.settings.microphoneDeviceId }
              : undefined,
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        })
      : undefined;
    const camera = message.settings.webcam
      ? await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: message.settings.cameraDeviceId
              ? { exact: message.settings.cameraDeviceId }
              : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        })
      : undefined;
    if (microphone) this.streams.push(microphone);
    if (camera) this.streams.push(camera);

    this.tabVideo = document.createElement("video");
    this.tabVideo.srcObject = new MediaStream(tab.getVideoTracks());
    this.tabVideo.muted = true;
    await this.tabVideo.play();
    const cameraVideo = document.createElement("video");
    if (camera) {
      cameraVideo.srcObject = camera;
      cameraVideo.muted = true;
      await cameraVideo.play();
    }

    const videoSettings = tab.getVideoTracks()[0].getSettings();
    const width = Math.min(
      message.settings.maxWidth,
      videoSettings.width ?? message.settings.maxWidth,
    );
    const height = Math.min(
      message.settings.maxHeight,
      videoSettings.height ?? message.settings.maxHeight,
    );
    const compositeCanvas =
      document.querySelector<HTMLCanvasElement>("#composite")!;
    const screenCanvas = document.createElement("canvas");
    compositeCanvas.width = screenCanvas.width = width;
    compositeCanvas.height = screenCanvas.height = height;
    const compositeContext = compositeCanvas.getContext("2d")!;
    const screenContext = screenCanvas.getContext("2d")!;
    const compositeVideo = compositeCanvas.captureStream(0);
    const screenVideo = screenCanvas.captureStream(0);
    const compositeTrack =
      compositeVideo.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const screenTrack =
      screenVideo.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    const draw = () => {
      if (!this.tabVideo || this.tabVideo.readyState < 2) return;
      screenContext.drawImage(this.tabVideo, 0, 0, width, height);
      compositeContext.drawImage(screenCanvas, 0, 0, width, height);
      if (camera && cameraVideo.readyState >= 2) {
        const size = Math.round(Math.min(width, height) * 0.22);
        const margin = Math.round(size * 0.16);
        const x = width - size - margin;
        const y = height - size - margin;
        compositeContext.save();
        compositeContext.beginPath();
        compositeContext.arc(
          x + size / 2,
          y + size / 2,
          size / 2,
          0,
          Math.PI * 2,
        );
        compositeContext.clip();
        compositeContext.translate(x + size, y);
        compositeContext.scale(-1, 1);
        compositeContext.drawImage(cameraVideo, 0, 0, size, size);
        compositeContext.restore();
        compositeContext.lineWidth = Math.max(3, size * 0.025);
        compositeContext.strokeStyle = "white";
        compositeContext.beginPath();
        compositeContext.arc(
          x + size / 2,
          y + size / 2,
          size / 2 - compositeContext.lineWidth / 2,
          0,
          Math.PI * 2,
        );
        compositeContext.stroke();
      }
      screenTrack.requestFrame();
      compositeTrack.requestFrame();
    };
    draw();
    // Offscreen extension documents are hidden, so requestAnimationFrame can be
    // suspended after the first frame. Explicit timer-driven frames also keep the
    // MediaRecorder tracks stable while their source tab changes.
    this.drawTimer = window.setInterval(
      draw,
      Math.round(1000 / message.settings.frameRate),
    );

    this.audioContext = new AudioContext();
    this.mixedAudio = this.audioContext.createMediaStreamDestination();
    this.screenAudio = this.audioContext.createMediaStreamDestination();
    this.transcriptionAudio = this.audioContext.createMediaStreamDestination();
    this.connectTabAudio(tab);
    if (microphone?.getAudioTracks().length) {
      const microphoneSource =
        this.audioContext.createMediaStreamSource(microphone);
      microphoneSource.connect(this.mixedAudio);
      microphoneSource.connect(this.transcriptionAudio);
    }

    const hasTabAudio = tab.getAudioTracks().length > 0;
    const hasMicrophoneAudio = Boolean(microphone?.getAudioTracks().length);
    const composite = new MediaStream(compositeVideo.getVideoTracks());
    if (hasTabAudio || hasMicrophoneAudio) {
      this.mixedAudio.stream
        .getAudioTracks()
        .forEach((track) => composite.addTrack(track));
    }
    const screen = new MediaStream(screenVideo.getVideoTracks());
    if (hasTabAudio) {
      this.screenAudio.stream
        .getAudioTracks()
        .forEach((track) => screen.addTrack(track));
    }
    this.streams.push(composite);
    this.streams.push(screen);
    const compositeRecorderOptions = this.videoRecorderOptions(
      composite,
      4_000_000,
    );
    const screenRecorderOptions = this.videoRecorderOptions(screen, 4_000_000);
    const specs: Array<{
      kind: VideoAssetKind;
      stream: MediaStream;
      mimeType: string;
      width?: number;
      height?: number;
      recorderOptions: MediaRecorderOptions;
    }> = [
      {
        kind: "composite",
        stream: composite,
        mimeType: compositeRecorderOptions.mimeType,
        width,
        height,
        recorderOptions: compositeRecorderOptions,
      },
      {
        kind: "screen",
        stream: screen,
        mimeType: screenRecorderOptions.mimeType,
        width,
        height,
        recorderOptions: screenRecorderOptions,
      },
    ];
    if (camera) {
      const recorderOptions = this.videoRecorderOptions(camera, 1_500_000);
      specs.push({
        kind: "camera",
        stream: camera,
        mimeType: recorderOptions.mimeType,
        width: camera.getVideoTracks()[0].getSettings().width,
        height: camera.getVideoTracks()[0].getSettings().height,
        recorderOptions,
      });
    }
    if (microphone)
      specs.push({
        kind: "microphone",
        stream: microphone,
        mimeType: this.audioMimeType(),
        recorderOptions: {
          mimeType: this.audioMimeType(),
          audioBitsPerSecond: 128_000,
        },
      });
    if (
      chooseTranscriptionAudioSource(
        Boolean(microphone),
        message.settings.tabAudio,
      ) !== "none"
    ) {
      specs.push({
        kind: "transcription",
        stream: this.transcriptionAudio.stream,
        mimeType: this.audioMimeType(),
        recorderOptions: {
          mimeType: this.audioMimeType(),
          audioBitsPerSecond: TRANSCRIPTION_AUDIO_BITS_PER_SECOND,
        },
      });
    }

    const video = await initializeVideo(message.recordingId, {
      captureSettings: message.settings,
      assets: specs.map((spec) => ({
        kind: spec.kind,
        mimeType: spec.mimeType.split(";")[0],
        codec: spec.mimeType.includes("codecs=")
          ? spec.mimeType.split("codecs=")[1]
          : null,
        width: spec.width ?? null,
        height: spec.height ?? null,
      })),
    });
    const assets = new Map(video.assets.map((asset) => [asset.kind, asset]));
    this.clock.start();
    for (const spec of specs) {
      const asset = assets.get(spec.kind);
      if (!asset)
        throw new Error(
          t("Server did not initialize {kind}", { kind: spec.kind }),
        );
      const uploader = new MultipartUploader(
        message.recordingId,
        asset.id,
        this.clock,
        this.backlog,
      );
      const recorder = new MediaRecorder(spec.stream, spec.recorderOptions);
      recorder.ondataavailable = (event) => uploader.add(event.data);
      recorder.start(2000);
      this.uploaders.push(uploader);
      this.mediaRecorders.push(recorder);
    }
    this.durationTimer = window.setInterval(() => {
      void chrome.runtime.sendMessage({
        type: "video-offset-progress",
        offsetMs: this.clock.elapsed(),
      });
      if (this.clock.elapsed() >= MAX_DURATION_MS)
        void chrome.runtime.sendMessage({ type: "video-duration-limit" });
    }, 1000);
    return { videoId: video.id };
  }

  pause() {
    this.mediaRecorders.forEach((recorder) => {
      if (recorder.state === "recording") recorder.pause();
    });
    this.clock.pause();
  }

  resume() {
    this.mediaRecorders.forEach((recorder) => {
      if (recorder.state === "paused") recorder.resume();
    });
    this.clock.resume();
    this.backlog.pauseRequested = false;
  }

  async stop(recovered = false): Promise<RecordingVideo> {
    if (this.stopping)
      throw new Error(t("Video finalization is already in progress"));
    this.stopping = true;
    if (this.durationTimer) clearInterval(this.durationTimer);
    const durationMs = this.clock.elapsed();
    await chrome.runtime.sendMessage({
      type: "video-offset-progress",
      offsetMs: durationMs,
    });
    const stopped = this.mediaRecorders.map(
      (recorder) =>
        new Promise<void>((resolve) => {
          if (recorder.state === "inactive") return resolve();
          recorder.addEventListener("stop", () => resolve(), { once: true });
          recorder.stop();
        }),
    );
    await Promise.all(stopped);
    await Promise.all(this.uploaders.map((uploader) => uploader.finish()));
    const result = await finalizeVideo(this.recordingId, {
      outputLocale: this.outputLocale,
      durationMs,
      recovered,
      assets: this.uploaders.map((uploader) => ({
        assetId: uploader.assetId,
        durationMs,
      })),
    });
    if (this.drawTimer) clearInterval(this.drawTimer);
    this.drawTimer = undefined;
    this.streams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
    await this.audioContext?.close();
    this.mediaRecorders = [];
    this.uploaders = [];
    this.tabAudioSource = undefined;
    this.mixedAudio = undefined;
    this.screenAudio = undefined;
    this.transcriptionAudio = undefined;
    this.tabVideo = undefined;
    this.currentTabStream = undefined;
    this.currentTabId = undefined;
    this.settings = undefined;
    this.stopping = false;
    await chrome.runtime.sendMessage({ type: "video-offset-clear" });
    return result;
  }
}

const recorder = new OffscreenRecorder();

chrome.runtime.onMessage.addListener(
  (
    message:
      StartMessage | SwitchTabMessage | { type: string; recovered?: boolean },
    _sender,
    sendResponse,
  ) => {
    if (
      ![
        "offscreen-start",
        "offscreen-switch-tab",
        "offscreen-pause",
        "offscreen-resume",
        "offscreen-offset",
        "offscreen-stop",
      ].includes(message.type)
    ) {
      return false;
    }
    void (async () => {
      if (message.type === "offscreen-start")
        return recorder.start(message as StartMessage);
      if (message.type === "offscreen-switch-tab")
        return recorder.switchTab(message as SwitchTabMessage);
      if (message.type === "offscreen-pause") {
        recorder.pause();
        return { ok: true };
      }
      if (message.type === "offscreen-resume") {
        recorder.resume();
        return { ok: true };
      }
      if (message.type === "offscreen-offset")
        return { offsetMs: recorder.elapsed() };
      if (message.type === "offscreen-stop")
        return recorder.stop(message.recovered ?? false);
      return undefined;
    })()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  },
);
