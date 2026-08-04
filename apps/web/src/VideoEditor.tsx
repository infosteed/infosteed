// SPDX-License-Identifier: AGPL-3.0-only
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  videoEditedDurationMs,
  videoOutputToSourceMs,
  videoRecipeCaptions,
  videoSourceToOutputMs,
  type EditableCaptionCue,
  type Recording,
  type RecordingVideo,
  type VideoEditDraft,
  type VideoEditRecipe,
  type VideoEditorState,
  type VideoRender,
  type VoiceoverCueInput,
  type VoiceoverGeneration,
  type VoiceoverVoice,
} from "@infosteed/shared";
import {
  cancelVideoRender,
  createVideoEditVersion,
  createVideoRender,
  getVideoEditor,
  getVideoRender,
  generateVoiceover,
  getVoiceoverGeneration,
  listVoiceoverVoices,
  publishVideoRender,
  recordingVideoAssetUrl,
  recordingVideoRenderUrl,
  resetVideoEditor,
  rewriteVoiceoverScript,
  restoreVideoEditVersion,
  saveVideoEditor,
  voiceoverCueUrl,
} from "./api";

interface Props {
  recording: Recording;
  video: RecordingVideo;
  onPublished(video: RecordingVideo): void;
}

function timeLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function subtractRange(
  recipe: VideoEditRecipe,
  startMs: number,
  endMs: number,
): VideoEditRecipe {
  const keepRanges = recipe.keepRanges.flatMap((range) => {
    if (endMs <= range.startMs || startMs >= range.endMs) return [range];
    const output = [];
    if (startMs - range.startMs >= 100)
      output.push({ startMs: range.startMs, endMs: startMs });
    if (range.endMs - endMs >= 100)
      output.push({ startMs: endMs, endMs: range.endMs });
    return output;
  });
  return keepRanges.reduce(
    (total, range) => total + range.endMs - range.startMs,
    0,
  ) >= 500
    ? { ...recipe, keepRanges }
    : recipe;
}

function materializeCaptions(
  state: VideoEditorState,
  recipe: VideoEditRecipe,
): EditableCaptionCue[] {
  if (recipe.captions.mode === "manual") return recipe.captions.cues;
  return state.transcriptCues.map((cue) => ({
    id: `caption-${cue.id}-${cue.startMs}`,
    sourceStartMs: cue.startMs,
    sourceEndMs: cue.endMs,
    text: cue.text,
  }));
}

export function VideoEditor({ recording, video, onPublished }: Props) {
  const [state, setState] = useState<VideoEditorState>();
  const [recipe, setRecipe] = useState<VideoEditRecipe>();
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [savePaused, setSavePaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState<
    "chapters" | "captions" | "voiceover" | "history"
  >("chapters");
  const [render, setRender] = useState<VideoRender>();
  const [candidatePreview, setCandidatePreview] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [previewTimeMs, setPreviewTimeMs] = useState(0);
  const [cutStartMs, setCutStartMs] = useState(0);
  const [cutEndMs, setCutEndMs] = useState(1000);
  const [past, setPast] = useState<VideoEditRecipe[]>([]);
  const [future, setFuture] = useState<VideoEditRecipe[]>([]);
  const [voices, setVoices] = useState<VoiceoverVoice[]>([]);
  const [voice, setVoice] = useState("");
  const [voiceoverSpeed, setVoiceoverSpeed] = useState(1);
  const [narrationCues, setNarrationCues] = useState<VoiceoverCueInput[]>([]);
  const [voiceover, setVoiceover] = useState<VoiceoverGeneration>();
  const [scriptStyle, setScriptStyle] = useState<
    "concise" | "natural" | "instructional"
  >("natural");
  const [rewritingScript, setRewritingScript] = useState(false);
  const screenVideo = useRef<HTMLVideoElement>(null);
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const microphoneAudio = useRef<HTMLAudioElement>(null);
  const saveGeneration = useRef(0);

  const load = useCallback(async () => {
    const next = await getVideoEditor(recording.id);
    setState(next);
    setRecipe(next.draft.recipe);
    setRevision(next.draft.revision);
    setRender(next.renders[0]);
    setDirty(false);
    setSavePaused(false);
    setPast([]);
    setFuture([]);
    setVoiceover(next.voiceover ?? undefined);
    const initialCues =
      next.voiceover?.cues.map((cue) => ({
        id: cue.id,
        sourceStartMs: cue.sourceStartMs,
        sourceEndMs: cue.sourceEndMs,
        text: cue.text,
      })) ?? materializeCaptions(next, next.draft.recipe);
    setNarrationCues(initialCues);
    if (next.voiceoverAvailable) {
      void listVoiceoverVoices(recording.id)
        .then((result) => {
          setVoices(result.voices);
          setVoice(next.voiceover?.voice ?? result.defaultVoice);
        })
        .catch((loadError) =>
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          ),
        );
    }
  }, [recording.id]);

  useEffect(() => {
    void load().catch((loadError) =>
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      ),
    );
  }, [load]);

  function change(next: VideoEditRecipe) {
    if (!recipe) return;
    setPast((items) => [...items.slice(-49), recipe]);
    setFuture([]);
    setRecipe(next);
    setDirty(true);
    saveGeneration.current += 1;
  }

  const persist = useCallback(async (): Promise<VideoEditDraft | undefined> => {
    if (!recipe || savePaused || !dirty)
      return recipe
        ? { revision, recipe, updatedAt: new Date().toISOString() }
        : undefined;
    const generation = saveGeneration.current;
    setSaving(true);
    try {
      const saved = await saveVideoEditor(recording.id, revision, recipe);
      setRevision(saved.revision);
      if (saveGeneration.current === generation) setDirty(false);
      setError(undefined);
      return saved;
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : String(saveError);
      if (message.includes("409")) setSavePaused(true);
      setError(message);
      return undefined;
    } finally {
      setSaving(false);
    }
  }, [dirty, recipe, recording.id, revision, savePaused]);

  useEffect(() => {
    if (!dirty || savePaused) return;
    const timer = window.setTimeout(() => void persist(), 650);
    return () => window.clearTimeout(timer);
  }, [dirty, persist, savePaused]);

  useEffect(() => {
    if (
      !render ||
      (render.status !== "queued" && render.status !== "processing")
    )
      return;
    const timer = window.setInterval(() => {
      void getVideoRender(recording.id, render.id)
        .then((next) => {
          setRender(next);
          if (
            next.status === "ready" ||
            next.status === "failed" ||
            next.status === "canceled"
          ) {
            void getVideoEditor(recording.id).then(setState);
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [recording.id, render]);

  useEffect(() => {
    if (
      !voiceover ||
      (voiceover.status !== "queued" && voiceover.status !== "processing")
    )
      return;
    const timer = window.setInterval(() => {
      void getVoiceoverGeneration(recording.id, voiceover.id)
        .then((next) => {
          setVoiceover(next);
          setState((current) =>
            current ? { ...current, voiceover: next } : current,
          );
        })
        .catch(() => undefined);
    }, 1200);
    return () => window.clearInterval(timer);
  }, [recording.id, voiceover?.id, voiceover?.status]);

  useEffect(() => {
    if (!recipe || voiceover?.status !== "ready" || !voiceover.assetId) return;
    if (
      recipe.voiceover.generationId === voiceover.id &&
      recipe.voiceover.assetId === voiceover.assetId
    )
      return;
    change({
      ...recipe,
      voiceover: {
        enabled: true,
        generationId: voiceover.id,
        assetId: voiceover.assetId,
      },
    });
  }, [voiceover?.status, voiceover?.assetId, voiceover?.id]);

  const assets = useMemo(
    () => new Set(state?.sourceAssets.map((asset) => asset.kind) ?? []),
    [state],
  );
  const hasScreen = video.rawAssetsComplete && assets.has("screen");
  const hasCamera = video.rawAssetsComplete && assets.has("camera");
  const hasMicrophone = video.rawAssetsComplete && assets.has("microphone");
  const previewAsset = state?.sourceAssets.find(
    (asset) => asset.kind === (hasScreen ? "screen" : "composite"),
  );
  const previewWidth = previewAsset?.width ?? 1920;
  const previewHeight = previewAsset?.height ?? 1080;
  const bubbleWidthRatio = recipe
    ? (recipe.webcam.diameter * Math.min(previewWidth, previewHeight)) /
      previewWidth
    : 0;
  const bubbleHeightRatio = recipe
    ? (recipe.webcam.diameter * Math.min(previewWidth, previewHeight)) /
      previewHeight
    : 0;
  const effectiveCaptions = useMemo(
    () =>
      recipe && state ? videoRecipeCaptions(recipe, state.transcriptCues) : [],
    [recipe, state],
  );
  const sourceCaptions = useMemo(
    () =>
      recipe && state
        ? recipe.captions.mode === "manual"
          ? recipe.captions.cues.map((cue, id) => ({
              id,
              startMs: cue.sourceStartMs,
              endMs: cue.sourceEndMs,
              text: cue.text,
            }))
          : state.transcriptCues
        : [],
    [recipe, state],
  );
  const currentCaption = (
    candidatePreview ? effectiveCaptions : sourceCaptions
  ).find(
    (cue) =>
      (candidatePreview ? previewTimeMs : playheadMs) >= cue.startMs &&
      (candidatePreview ? previewTimeMs : playheadMs) < cue.endMs,
  );

  useEffect(() => {
    if (!recipe) return;
    if (screenVideo.current)
      screenVideo.current.volume = candidatePreview
        ? 1
        : Math.min(1, recipe.audio.tabGain / 2);
    if (microphoneAudio.current)
      microphoneAudio.current.volume = Math.min(
        1,
        recipe.audio.microphoneGain / 2,
      );
  }, [candidatePreview, recipe?.audio.microphoneGain, recipe?.audio.tabGain]);

  function syncSecondary(sourceSeconds: number) {
    if (
      cameraVideo.current &&
      Math.abs(cameraVideo.current.currentTime - sourceSeconds) > 0.25
    )
      cameraVideo.current.currentTime = sourceSeconds;
    if (
      microphoneAudio.current &&
      Math.abs(microphoneAudio.current.currentTime - sourceSeconds) > 0.25
    )
      microphoneAudio.current.currentTime = sourceSeconds;
  }

  function sourceTimeUpdate() {
    if (!recipe || !screenVideo.current) return;
    if (candidatePreview) {
      const outputMs = Math.round(screenVideo.current.currentTime * 1000);
      setPreviewTimeMs(outputMs);
      setPlayheadMs(videoOutputToSourceMs(recipe, outputMs) ?? 0);
      return;
    }
    let sourceMs = Math.round(screenVideo.current.currentTime * 1000);
    const range = recipe.keepRanges.find(
      (candidate) =>
        sourceMs >= candidate.startMs && sourceMs < candidate.endMs,
    );
    if (!range) {
      const next = recipe.keepRanges.find(
        (candidate) => candidate.startMs > sourceMs,
      );
      if (next) {
        sourceMs = next.startMs;
        screenVideo.current.currentTime = sourceMs / 1000;
      } else {
        screenVideo.current.pause();
      }
    }
    setPlayheadMs(sourceMs);
    setPreviewTimeMs(videoSourceToOutputMs(recipe, sourceMs) ?? 0);
    syncSecondary(sourceMs / 1000);
  }

  function playbackStarted() {
    void cameraVideo.current?.play().catch(() => undefined);
    void microphoneAudio.current?.play().catch(() => undefined);
  }

  function playbackPaused() {
    cameraVideo.current?.pause();
    microphoneAudio.current?.pause();
  }

  async function requestRender() {
    const saved = await persist();
    if (!saved && dirty) return;
    try {
      const next = await createVideoRender(
        recording.id,
        saved?.revision ?? revision,
        `Edit ${new Date().toLocaleString()}`,
      );
      setRender(next);
      setCandidatePreview(false);
      setError(undefined);
    } catch (renderError) {
      setError(
        renderError instanceof Error
          ? renderError.message
          : String(renderError),
      );
    }
  }

  async function requestVoiceover() {
    if (!voice || narrationCues.length === 0) return;
    try {
      const next = await generateVoiceover(recording.id, {
        voice,
        speed: voiceoverSpeed,
        cues: narrationCues,
      });
      setVoiceover(next);
      setState((current) =>
        current ? { ...current, voiceover: next } : current,
      );
      setError(undefined);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : String(generationError),
      );
    }
  }

  async function rewriteScript() {
    setRewritingScript(true);
    try {
      const result = await rewriteVoiceoverScript(
        recording.id,
        narrationCues,
        scriptStyle,
      );
      setNarrationCues(result.cues);
      setError(undefined);
    } catch (rewriteError) {
      setError(
        rewriteError instanceof Error
          ? rewriteError.message
          : String(rewriteError),
      );
    } finally {
      setRewritingScript(false);
    }
  }

  function previewVoiceoverCue(cueId: string) {
    if (!voiceover) return;
    const audio = new Audio();
    audio.crossOrigin = "use-credentials";
    audio.src = voiceoverCueUrl(recording.id, voiceover.id, cueId);
    void audio
      .play()
      .catch((previewError) =>
        setError(
          previewError instanceof Error
            ? previewError.message
            : String(previewError),
        ),
      );
  }

  if (!state || !recipe)
    return (
      <main className="video-editor-shell">
        <p>{error ?? "Loading video editor..."}</p>
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
      <header className="video-editor-header">
        <div>
          <p>Video editor</p>
          <h1>{recording.title}</h1>
        </div>
        <div className="header-actions">
          <span className={savePaused ? "save-state conflict" : "save-state"}>
            {savePaused
              ? "Save conflict"
              : saving
                ? "Saving..."
                : dirty
                  ? "Unsaved"
                  : "Saved"}
          </span>
          <button
            onClick={() =>
              window.location.assign(`/?recordingId=${recording.id}&view=video`)
            }
          >
            Back to recording
          </button>
        </div>
      </header>

      {error && (
        <div className="capture-status error">
          {error}
          {savePaused && (
            <>
              <button onClick={() => void load()}>Reload server draft</button>
              <button
                onClick={() =>
                  void getVideoEditor(recording.id).then((latest) => {
                    setRevision(latest.draft.revision);
                    setSavePaused(false);
                    setDirty(true);
                    setError(undefined);
                    saveGeneration.current += 1;
                  })
                }
              >
                Retry local draft
              </button>
            </>
          )}
        </div>
      )}

      <section className="video-editor-grid">
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
              <strong>{timeLabel(outputDuration)} edited</strong>
              <span>
                {timeLabel(recipe.sourceDurationMs - outputDuration)} removed
              </span>
            </div>
            <input
              aria-label="Video playhead"
              type="range"
              min={0}
              max={recipe.sourceDurationMs}
              value={playheadMs}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPlayheadMs(next);
                const mediaMs = candidatePreview
                  ? (videoSourceToOutputMs(recipe, next) ?? 0)
                  : next;
                if (screenVideo.current)
                  screenVideo.current.currentTime = mediaMs / 1000;
                syncSecondary(next / 1000);
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
                onClick={() => change(subtractRange(recipe, 0, playheadMs))}
              >
                Trim start to playhead
              </button>
              <button
                disabled={playheadMs >= recipe.sourceDurationMs}
                onClick={() =>
                  change(
                    subtractRange(recipe, playheadMs, recipe.sourceDurationMs),
                  )
                }
              >
                Trim end to playhead
              </button>
              <label>
                Cut from{" "}
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
                to{" "}
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
                  change(subtractRange(recipe, cutStartMs, cutEndMs))
                }
              >
                Cut selection
              </button>
              <button
                disabled={past.length === 0}
                onClick={() => {
                  const previous = past.at(-1);
                  if (!previous) return;
                  setFuture((items) => [recipe, ...items]);
                  setPast((items) => items.slice(0, -1));
                  setRecipe(previous);
                  setDirty(true);
                  saveGeneration.current += 1;
                }}
              >
                Undo
              </button>
              <button
                disabled={future.length === 0}
                onClick={() => {
                  const next = future[0];
                  setPast((items) => [...items, recipe]);
                  setFuture((items) => items.slice(1));
                  setRecipe(next);
                  setDirty(true);
                  saveGeneration.current += 1;
                }}
              >
                Redo
              </button>
            </div>
          </div>

          <div className="video-edit-media-controls">
            <fieldset disabled={!hasCamera || candidatePreview}>
              <legend>Webcam bubble</legend>
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
                Show webcam
              </label>
              <label>
                Size{" "}
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
              {!hasCamera && (
                <small>The independent camera track is unavailable.</small>
              )}
            </fieldset>
            <fieldset disabled={candidatePreview}>
              <legend>Audio mix</legend>
              <label>
                Tab audio{" "}
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
                Microphone{" "}
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
                AI voiceover{" "}
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
                Enable voiceover
              </label>
            </fieldset>
          </div>
        </div>

        <aside className="video-editor-sidebar">
          <div className="video-panel-tabs">
            <button
              className={panel === "chapters" ? "active" : ""}
              onClick={() => setPanel("chapters")}
            >
              Chapters
            </button>
            <button
              className={panel === "captions" ? "active" : ""}
              onClick={() => setPanel("captions")}
            >
              Captions
            </button>
            <button
              className={panel === "voiceover" ? "active" : ""}
              onClick={() => setPanel("voiceover")}
            >
              AI voiceover
            </button>
            <button
              className={panel === "history" ? "active" : ""}
              onClick={() => setPanel("history")}
            >
              History
            </button>
          </div>

          {panel === "chapters" && (
            <div className="video-edit-list">
              <button
                onClick={() =>
                  change({
                    ...recipe,
                    chapters: [
                      ...recipe.chapters,
                      {
                        id: crypto.randomUUID(),
                        eventId: null,
                        guideItemId: null,
                        title: "New chapter",
                        sourceOffsetMs: playheadMs,
                        ordinal: recipe.chapters.length,
                        hidden: false,
                        custom: true,
                        titleEdited: true,
                        offsetEdited: true,
                      },
                    ],
                  })
                }
              >
                Add chapter at playhead
              </button>
              {recipe.chapters.map((chapter, index) => {
                const outputMs = videoSourceToOutputMs(
                  recipe,
                  chapter.sourceOffsetMs,
                );
                return (
                  <div
                    className={
                      chapter.hidden || outputMs === null
                        ? "edit-row muted"
                        : "edit-row"
                    }
                    key={chapter.id}
                  >
                    <input
                      value={chapter.title}
                      onChange={(event) =>
                        change({
                          ...recipe,
                          chapters: recipe.chapters.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  title: event.target.value,
                                  titleEdited: true,
                                }
                              : item,
                          ),
                        })
                      }
                    />
                    <label>
                      Source ms{" "}
                      <input
                        type="number"
                        min={0}
                        max={recipe.sourceDurationMs}
                        value={chapter.sourceOffsetMs}
                        onChange={(event) =>
                          change({
                            ...recipe,
                            chapters: recipe.chapters.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    sourceOffsetMs: Number(event.target.value),
                                    offsetEdited: true,
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                    </label>
                    <small>
                      {outputMs === null
                        ? "Removed by cut"
                        : `Edited time ${timeLabel(outputMs)}`}
                    </small>
                    <button
                      onClick={() =>
                        change({
                          ...recipe,
                          chapters: recipe.chapters.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, hidden: !item.hidden }
                              : item,
                          ),
                        })
                      }
                    >
                      {chapter.hidden ? "Restore" : "Hide"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {panel === "captions" && (
            <div className="video-edit-list video-edit-caption-list">
              <div className="caption-actions">
                <button
                  onClick={() => {
                    const cues = materializeCaptions(state, recipe);
                    change({
                      ...recipe,
                      captions: {
                        mode: "manual",
                        cues: [
                          ...cues,
                          {
                            id: crypto.randomUUID(),
                            sourceStartMs: playheadMs,
                            sourceEndMs: Math.min(
                              recipe.sourceDurationMs,
                              playheadMs + 2000,
                            ),
                            text: "New caption",
                          },
                        ],
                      },
                    });
                  }}
                >
                  Add caption
                </button>
                {recipe.captions.mode === "manual" && (
                  <button
                    onClick={() =>
                      change({ ...recipe, captions: { mode: "transcript" } })
                    }
                  >
                    Reset to transcript
                  </button>
                )}
              </div>
              {(recipe.captions.mode === "manual"
                ? recipe.captions.cues
                : materializeCaptions(state, recipe)
              ).map((cue, index) => (
                <div className="edit-row" key={cue.id}>
                  <textarea
                    value={cue.text}
                    onChange={(event) => {
                      const cues = materializeCaptions(state, recipe).map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, text: event.target.value }
                            : item,
                      );
                      change({ ...recipe, captions: { mode: "manual", cues } });
                    }}
                  />
                  <div className="cue-times">
                    <input
                      type="number"
                      value={cue.sourceStartMs}
                      onChange={(event) => {
                        const cues = materializeCaptions(state, recipe).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  sourceStartMs: Number(event.target.value),
                                }
                              : item,
                        );
                        change({
                          ...recipe,
                          captions: { mode: "manual", cues },
                        });
                      }}
                    />
                    <input
                      type="number"
                      value={cue.sourceEndMs}
                      onChange={(event) => {
                        const cues = materializeCaptions(state, recipe).map(
                          (item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  sourceEndMs: Number(event.target.value),
                                }
                              : item,
                        );
                        change({
                          ...recipe,
                          captions: { mode: "manual", cues },
                        });
                      }}
                    />
                  </div>
                  <button
                    onClick={() =>
                      change({
                        ...recipe,
                        captions: {
                          mode: "manual",
                          cues: materializeCaptions(state, recipe).filter(
                            (_item, itemIndex) => itemIndex !== index,
                          ),
                        },
                      })
                    }
                  >
                    Delete
                  </button>
                  <button
                    disabled={cue.sourceEndMs - cue.sourceStartMs < 200}
                    onClick={() => {
                      const midpoint = Math.round(
                        (cue.sourceStartMs + cue.sourceEndMs) / 2,
                      );
                      const cues = materializeCaptions(state, recipe);
                      cues.splice(
                        index,
                        1,
                        {
                          ...cue,
                          id: crypto.randomUUID(),
                          sourceEndMs: midpoint,
                        },
                        {
                          ...cue,
                          id: crypto.randomUUID(),
                          sourceStartMs: midpoint,
                        },
                      );
                      change({ ...recipe, captions: { mode: "manual", cues } });
                    }}
                  >
                    Split
                  </button>
                  <button
                    disabled={index === 0}
                    onClick={() => {
                      const cues = materializeCaptions(state, recipe);
                      const previous = cues[index - 1];
                      cues.splice(index - 1, 2, {
                        ...previous,
                        sourceEndMs: cue.sourceEndMs,
                        text: `${previous.text} ${cue.text}`.trim(),
                      });
                      change({ ...recipe, captions: { mode: "manual", cues } });
                    }}
                  >
                    Merge previous
                  </button>
                </div>
              ))}
            </div>
          )}

          {panel === "voiceover" && (
            <div className="video-edit-list voiceover-panel">
              {!state.voiceoverAvailable && (
                <p className="raw-warning">
                  Local TTS is not configured. Start the optional Kokoro service
                  and set TTS_BASE_URL.
                </p>
              )}
              <div className="voiceover-settings">
                <label>
                  Voice{" "}
                  <select
                    disabled={!state.voiceoverAvailable || voices.length === 0}
                    value={voice}
                    onChange={(event) => setVoice(event.target.value)}
                  >
                    {voices.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Speed{" "}
                  <select
                    value={voiceoverSpeed}
                    onChange={(event) =>
                      setVoiceoverSpeed(Number(event.target.value))
                    }
                  >
                    {[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((value) => (
                      <option key={value} value={value}>
                        {value}x
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() =>
                    setNarrationCues(materializeCaptions(state, recipe))
                  }
                >
                  Use edited captions
                </button>
                <label>
                  Script style{" "}
                  <select
                    value={scriptStyle}
                    onChange={(event) =>
                      setScriptStyle(event.target.value as typeof scriptStyle)
                    }
                  >
                    <option value="natural">Natural</option>
                    <option value="concise">Concise</option>
                    <option value="instructional">Instructional</option>
                  </select>
                </label>
                <button
                  disabled={rewritingScript || narrationCues.length === 0}
                  onClick={() => void rewriteScript()}
                >
                  {rewritingScript
                    ? "Rewriting locally..."
                    : "Rewrite with local model"}
                </button>
                <small>
                  The rewrite keeps cue timing but turns literal captions into
                  narration. You can edit every cue before synthesis.
                </small>
              </div>
              {voiceover && (
                <div className="voiceover-progress">
                  <strong>Generation: {voiceover.status}</strong>
                  <progress max={1} value={voiceover.progress} />
                  {voiceover.errorMessage && (
                    <p className="error">{voiceover.errorMessage}</p>
                  )}
                  {voiceover.cues.some((cue) => cue.overlongByMs > 0) && (
                    <p className="raw-warning">
                      Some speech is longer than its cue. It is not truncated
                      and may overlap later narration.
                    </p>
                  )}
                </div>
              )}
              {narrationCues.map((cue, index) => {
                const generated = voiceover?.cues.find(
                  (item) => item.id === cue.id,
                );
                return (
                  <div
                    className={
                      generated?.overlongByMs
                        ? "edit-row overlong-cue"
                        : "edit-row"
                    }
                    key={cue.id}
                  >
                    <textarea
                      value={cue.text}
                      onChange={(event) =>
                        setNarrationCues((items) =>
                          items.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, text: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                    <small>
                      {timeLabel(cue.sourceStartMs)}–
                      {timeLabel(cue.sourceEndMs)}
                      {generated?.durationMs
                        ? ` · speech ${timeLabel(generated.durationMs)}`
                        : ""}
                    </small>
                    {Boolean(generated?.overlongByMs) && (
                      <strong className="error">
                        Over by {(generated!.overlongByMs / 1000).toFixed(1)}s
                      </strong>
                    )}
                    {generated?.errorMessage && (
                      <span className="error">{generated.errorMessage}</span>
                    )}
                    <button
                      disabled={generated?.status !== "ready"}
                      onClick={() => previewVoiceoverCue(cue.id)}
                    >
                      Preview cue
                    </button>
                  </div>
                );
              })}
              <button
                disabled={
                  !state.voiceoverAvailable ||
                  !voice ||
                  narrationCues.length === 0 ||
                  voiceover?.status === "queued" ||
                  voiceover?.status === "processing"
                }
                onClick={() => void requestVoiceover()}
              >
                {voiceover
                  ? "Generate / regenerate voiceover"
                  : "Generate voiceover"}
              </button>
              <small>
                Only installed stock voices are available. Voice cloning is not
                supported.
              </small>
            </div>
          )}

          {panel === "history" && (
            <div className="video-edit-list">
              <button
                onClick={() => {
                  const name = window.prompt("Version name");
                  if (name)
                    void persist()
                      .then(() => createVideoEditVersion(recording.id, name))
                      .then(() => load())
                      .catch((versionError) => setError(String(versionError)));
                }}
              >
                Save named version
              </button>
              {state.versions.map((version) => (
                <div className="edit-row" key={version.id}>
                  <strong>
                    {version.name ?? `${version.versionType} version`}
                  </strong>
                  <small>
                    {new Date(version.createdAt).toLocaleString()}
                    {version.publishedAt ? " - published" : ""}
                  </small>
                  <button
                    onClick={() =>
                      void restoreVideoEditVersion(recording.id, version.id)
                        .then(() => load())
                        .catch((restoreError) => setError(String(restoreError)))
                    }
                  >
                    Restore to draft
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="render-controls">
            <button
              disabled={
                saving ||
                savePaused ||
                render?.status === "processing" ||
                render?.status === "queued"
              }
              onClick={() => void requestRender()}
            >
              Render preview
            </button>
            {render && (
              <div className="render-status">
                <strong>Render: {render.status}</strong>
                <progress max={1} value={render.progress} />
                {render.errorMessage && (
                  <p className="error">{render.errorMessage}</p>
                )}
                {(render.status === "queued" ||
                  render.status === "processing") && (
                  <button
                    onClick={() =>
                      void cancelVideoRender(recording.id, render.id)
                        .then(() => getVideoRender(recording.id, render.id))
                        .then(setRender)
                    }
                  >
                    Cancel
                  </button>
                )}
                {render.status === "ready" && (
                  <>
                    <button
                      onClick={() => setCandidatePreview((current) => !current)}
                    >
                      {candidatePreview ? "Preview source" : "Preview render"}
                    </button>
                    <a
                      href={recordingVideoRenderUrl(recording.id, render.id)}
                      download={`${recording.title.replace(/[^a-z0-9-_]+/gi, "-") || "video"}.webm`}
                    >
                      Download render
                    </a>
                    <button
                      disabled={render.stale}
                      onClick={() =>
                        void publishVideoRender(recording.id, render.id)
                          .then((published) => {
                            onPublished(published);
                            window.location.assign(
                              `/?recordingId=${recording.id}&view=video`,
                            );
                          })
                          .catch((publishError) =>
                            setError(String(publishError)),
                          )
                      }
                    >
                      Publish changes
                    </button>
                  </>
                )}
              </div>
            )}
            {!state.workerAvailable && render?.status !== "ready" && (
              <p className="raw-warning">
                The render worker is offline. Start it before requesting a
                media-changing render.
              </p>
            )}
            <button
              className="danger-action"
              onClick={() =>
                void resetVideoEditor(recording.id).then(() => load())
              }
            >
              Reset all edits
            </button>
          </div>
        </aside>
      </section>
      {video.status === "published" && (
        <footer className="video-editor-live-note">
          The currently published video remains live until you publish a
          completed replacement.
        </footer>
      )}
    </main>
  );
}
