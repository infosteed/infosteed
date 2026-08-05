// SPDX-License-Identifier: AGPL-3.0-only
import { videoEditedDurationMs } from "@infosteed/shared";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { recordingVideoAssetUrl, recordingVideoRenderUrl } from "./api";
import { RecordingGenerationStatus } from "./components/RecordingGenerationStatus";
import {
  VideoEditorError,
  VideoEditorHeader,
} from "./features/video/VideoEditorChrome";
import { VideoChaptersPanel } from "./features/video/VideoChaptersPanel";
import { VideoHistoryPanel } from "./features/video/VideoHistoryPanel";
import { VideoInspectorTabs } from "./features/video/VideoInspectorTabs";
import { VideoNarrationPanel } from "./features/video/VideoNarrationPanel";
import { VideoRenderControls } from "./features/video/VideoRenderControls";
import {
  useVideoEditorController,
  type VideoEditorControllerOptions,
} from "./features/video/useVideoEditorController";
import { t } from "./i18n";
import {
  materializeVideoCaptions,
  subtractVideoRange,
  videoTimeLabel,
} from "./video-editor/model";

type Props = VideoEditorControllerOptions;

const INSPECTOR_WIDTH_KEY = "infosteed.videoEditor.inspectorWidth";
const MIN_INSPECTOR_WIDTH = 420;
const MAX_INSPECTOR_WIDTH = 820;
const MIN_PREVIEW_WIDTH = 720;

export function clampVideoInspectorWidth(
  width: number,
  viewportWidth: number,
): number {
  const available = Math.max(
    MIN_INSPECTOR_WIDTH,
    viewportWidth - MIN_PREVIEW_WIDTH - 8,
  );
  return Math.round(
    Math.max(
      MIN_INSPECTOR_WIDTH,
      Math.min(MAX_INSPECTOR_WIDTH, available, width),
    ),
  );
}

function responsiveInspectorWidth(viewportWidth: number): number {
  return clampVideoInspectorWidth(viewportWidth * 0.36, viewportWidth);
}

export function VideoEditor(props: Props) {
  const { recording, video } = props;
  const controller = useVideoEditorController(props);
  const [inspectorWidth, setInspectorWidth] = useState<number | undefined>(
    () => {
      if (typeof window === "undefined") return undefined;
      const stored = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
      return Number.isFinite(stored) && stored > 0
        ? clampVideoInspectorWidth(stored, window.innerWidth)
        : undefined;
    },
  );
  const resizeStart = useRef<{
    pointerId: number;
    clientX: number;
    width: number;
  }>();
  const {
    state,
    recipe,
    error,
    render,
    candidatePreview,
    playheadMs,
    cutStartMs,
    setCutStartMs,
    cutEndMs,
    setCutEndMs,
    past,
    future,
    screenVideo,
    cameraVideo,
    microphoneAudio,
    change,
    hasScreen,
    hasCamera,
    hasMicrophone,
    bubbleWidthRatio,
    bubbleHeightRatio,
    currentCaption,
    seekToSourceMs,
    sourceTimeUpdate,
    playbackStarted,
    playbackPaused,
    undo,
    redo,
  } = controller;

  useEffect(() => {
    const clampStoredWidth = () =>
      setInspectorWidth((current) =>
        current === undefined
          ? undefined
          : clampVideoInspectorWidth(current, window.innerWidth),
      );
    window.addEventListener("resize", clampStoredWidth);
    return () => window.removeEventListener("resize", clampStoredWidth);
  }, []);

  function currentInspectorWidth() {
    return inspectorWidth ?? responsiveInspectorWidth(window.innerWidth);
  }

  function persistInspectorWidth(width: number) {
    const next = clampVideoInspectorWidth(width, window.innerWidth);
    setInspectorWidth(next);
    localStorage.setItem(INSPECTOR_WIDTH_KEY, String(next));
  }

  function resizeInspector(event: ReactPointerEvent<HTMLDivElement>) {
    const start = resizeStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setInspectorWidth(
      clampVideoInspectorWidth(
        start.width - (event.clientX - start.clientX),
        window.innerWidth,
      ),
    );
  }

  if (!state || !recipe)
    return (
      <main className="video-editor-shell">
        <p>{error ?? t("Loading video editor...")}</p>
      </main>
    );

  const baseKind = hasScreen ? "screen" : "composite";
  const previewSource =
    candidatePreview && render?.status === "ready"
      ? recordingVideoRenderUrl(recording.id, render.id)
      : recordingVideoAssetUrl(recording.id, baseKind);
  const outputDuration = videoEditedDurationMs(recipe);

  return (
    <main className="video-editor-shell">
      <VideoEditorHeader recording={recording} controller={controller} />

      <RecordingGenerationStatus
        captureMode={recording.captureMode}
        status={video.transcriptionStatus}
      />

      <VideoEditorError controller={controller} />

      <section
        className="video-editor-grid"
        style={
          {
            "--video-inspector-width": inspectorWidth
              ? `${inspectorWidth}px`
              : undefined,
          } as CSSProperties
        }
      >
        <div className="video-editor-preview-column">
          <div
            className="video-edit-stage"
            onPointerMove={(event) => {
              if (
                event.buttons !== 1 ||
                !hasCamera ||
                !recipe.webcam.visible ||
                candidatePreview
              )
                return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const radiusX = bubbleWidthRatio / 2;
              const radiusY = bubbleHeightRatio / 2;
              change({
                ...recipe,
                webcam: {
                  ...recipe.webcam,
                  centerX: Math.max(
                    radiusX,
                    Math.min(
                      1 - radiusX,
                      (event.clientX - bounds.left) / bounds.width,
                    ),
                  ),
                  centerY: Math.max(
                    radiusY,
                    Math.min(
                      1 - radiusY,
                      (event.clientY - bounds.top) / bounds.height,
                    ),
                  ),
                },
              });
            }}
          >
            <video
              key={previewSource}
              ref={screenVideo}
              controls
              crossOrigin="use-credentials"
              src={previewSource}
              onTimeUpdate={sourceTimeUpdate}
              onPlay={playbackStarted}
              onPause={playbackPaused}
            />
            {!candidatePreview && hasCamera && recipe.webcam.visible && (
              <video
                ref={cameraVideo}
                className="video-edit-webcam"
                crossOrigin="use-credentials"
                muted
                src={recordingVideoAssetUrl(recording.id, "camera")}
                style={{
                  left: `${(recipe.webcam.centerX - bubbleWidthRatio / 2) * 100}%`,
                  top: `${(recipe.webcam.centerY - bubbleHeightRatio / 2) * 100}%`,
                  width: `${bubbleWidthRatio * 100}%`,
                }}
              />
            )}
            {!candidatePreview && hasMicrophone && (
              <audio
                ref={microphoneAudio}
                crossOrigin="use-credentials"
                src={recordingVideoAssetUrl(recording.id, "microphone")}
              />
            )}
            {currentCaption && (
              <div className="video-edit-caption">{currentCaption.text}</div>
            )}
          </div>

          <div className="video-timeline">
            <div className="timeline-summary">
              <strong>
                {t("{duration} edited", {
                  duration: videoTimeLabel(outputDuration),
                })}
              </strong>
              <span>
                {videoTimeLabel(recipe.sourceDurationMs - outputDuration)}{" "}
                {t("removed")}
              </span>
            </div>
            <input
              aria-label={t("Video playhead")}
              type="range"
              min={0}
              max={recipe.sourceDurationMs}
              value={playheadMs}
              onChange={(event) => {
                seekToSourceMs(Number(event.target.value));
              }}
            />
            <div className="timeline-ranges">
              {recipe.keepRanges.map((range) => (
                <span
                  key={`${range.startMs}-${range.endMs}`}
                  style={{
                    left: `${(range.startMs / recipe.sourceDurationMs) * 100}%`,
                    width: `${((range.endMs - range.startMs) / recipe.sourceDurationMs) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="cut-controls">
              <button
                disabled={playheadMs <= 0}
                onClick={() =>
                  change(subtractVideoRange(recipe, 0, playheadMs))
                }
              >
                {t("Trim start to playhead")}
              </button>
              <button
                disabled={playheadMs >= recipe.sourceDurationMs}
                onClick={() =>
                  change(
                    subtractVideoRange(
                      recipe,
                      playheadMs,
                      recipe.sourceDurationMs,
                    ),
                  )
                }
              >
                {t("Trim end to playhead")}
              </button>
              <label>
                {t("Cut from")}{" "}
                <input
                  type="number"
                  min={0}
                  max={recipe.sourceDurationMs}
                  value={cutStartMs}
                  onChange={(event) =>
                    setCutStartMs(Number(event.target.value))
                  }
                />{" "}
                ms
              </label>
              <label>
                {t("to")}{" "}
                <input
                  type="number"
                  min={0}
                  max={recipe.sourceDurationMs}
                  value={cutEndMs}
                  onChange={(event) => setCutEndMs(Number(event.target.value))}
                />{" "}
                ms
              </label>
              <button
                disabled={cutEndMs <= cutStartMs}
                onClick={() =>
                  change(subtractVideoRange(recipe, cutStartMs, cutEndMs))
                }
              >
                {t("Cut selection")}
              </button>
              <button disabled={past.length === 0} onClick={undo}>
                {t("Undo")}
              </button>
              <button disabled={future.length === 0} onClick={redo}>
                {t("Redo")}
              </button>
            </div>
          </div>
          <div className="video-edit-media-controls">
            {hasCamera && (
              <fieldset disabled={candidatePreview}>
                <legend>{t("Webcam bubble")}</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={recipe.webcam.visible}
                    onChange={(event) =>
                      change({
                        ...recipe,
                        webcam: {
                          ...recipe.webcam,
                          visible: event.target.checked,
                        },
                      })
                    }
                  />{" "}
                  {t("Show webcam")}
                </label>
                <label>
                  {t("Size")}{" "}
                  <input
                    type="range"
                    min={0.1}
                    max={0.4}
                    step={0.01}
                    value={recipe.webcam.diameter}
                    onChange={(event) =>
                      change({
                        ...recipe,
                        webcam: {
                          ...recipe.webcam,
                          diameter: Number(event.target.value),
                        },
                      })
                    }
                  />
                </label>
              </fieldset>
            )}
            <fieldset disabled={candidatePreview}>
              <legend>{t("Audio mix")}</legend>
              <label>
                {t("Tab audio")}{" "}
                <input
                  disabled={!hasScreen}
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={recipe.audio.tabGain}
                  onChange={(event) =>
                    change({
                      ...recipe,
                      audio: {
                        ...recipe.audio,
                        tabGain: Number(event.target.value),
                      },
                    })
                  }
                />{" "}
                {Math.round(recipe.audio.tabGain * 100)}%
              </label>
              <label>
                {t("Microphone")}{" "}
                <input
                  disabled={!hasMicrophone}
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={recipe.audio.microphoneGain}
                  onChange={(event) =>
                    change({
                      ...recipe,
                      audio: {
                        ...recipe.audio,
                        microphoneGain: Number(event.target.value),
                      },
                    })
                  }
                />{" "}
                {Math.round(recipe.audio.microphoneGain * 100)}%
              </label>
              <label>
                {t("AI voiceover")}{" "}
                <input
                  disabled={!recipe.voiceover.assetId}
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={recipe.audio.voiceoverGain}
                  onChange={(event) =>
                    change({
                      ...recipe,
                      audio: {
                        ...recipe.audio,
                        voiceoverGain: Number(event.target.value),
                      },
                    })
                  }
                />{" "}
                {Math.round(recipe.audio.voiceoverGain * 100)}%
              </label>
              <label>
                <input
                  type="checkbox"
                  disabled={!recipe.voiceover.assetId}
                  checked={recipe.voiceover.enabled}
                  onChange={(event) =>
                    change({
                      ...recipe,
                      voiceover: {
                        ...recipe.voiceover,
                        enabled: event.target.checked,
                      },
                    })
                  }
                />{" "}
                {t("Enable voiceover")}
              </label>
            </fieldset>
          </div>
        </div>

        <div
          aria-label={t("Resize inspector")}
          aria-orientation="vertical"
          aria-valuemax={clampVideoInspectorWidth(
            MAX_INSPECTOR_WIDTH,
            typeof window === "undefined" ? 1920 : window.innerWidth,
          )}
          aria-valuemin={MIN_INSPECTOR_WIDTH}
          aria-valuenow={Math.round(
            typeof window === "undefined" ? 680 : currentInspectorWidth(),
          )}
          className="video-editor-resizer"
          onDoubleClick={() => {
            setInspectorWidth(undefined);
            localStorage.removeItem(INSPECTOR_WIDTH_KEY);
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const direction = event.key === "ArrowLeft" ? 1 : -1;
            persistInspectorWidth(
              currentInspectorWidth() + direction * (event.shiftKey ? 48 : 16),
            );
          }}
          onPointerCancel={(event) => {
            resizeStart.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerDown={(event) => {
            resizeStart.current = {
              pointerId: event.pointerId,
              clientX: event.clientX,
              width: currentInspectorWidth(),
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={resizeInspector}
          onPointerUp={(event) => {
            if (resizeStart.current?.pointerId === event.pointerId)
              persistInspectorWidth(currentInspectorWidth());
            resizeStart.current = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          role="separator"
          tabIndex={0}
        />
        <aside className="video-editor-sidebar">
          <VideoInspectorTabs controller={controller} />
          <div className="video-editor-sidebar-scroll">
            <VideoChaptersPanel controller={controller} />
            <VideoNarrationPanel controller={controller} />
            <VideoHistoryPanel controller={controller} />
          </div>
          <VideoRenderControls recording={recording} controller={controller} />
        </aside>
      </section>
      {video.status === "published" && (
        <footer className="video-editor-live-note">
          {t(
            "The currently published video remains live until you publish a completed replacement.",
          )}
        </footer>
      )}
    </main>
  );
}
