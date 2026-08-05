// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  videoOutputToSourceMs,
  videoRecipeCaptions,
  videoSourceToOutputMs,
  type Recording,
  type RecordingVideo,
  type VideoEditDraft,
  type VideoEditRecipe,
  type VideoEditorState,
  type VideoMp4Export,
  type VideoRender,
  type VoiceoverCueInput,
  type VoiceoverGeneration,
  type VoiceoverVoice,
} from "@infosteed/shared";
import {
  cancelVideoRender,
  createVideoMp4Export,
  createVideoEditVersion,
  createVideoRender,
  generateVoiceover,
  getRecordingVideo,
  getVideoEditor,
  getVideoMp4Export,
  getVideoRender,
  getVoiceoverGeneration,
  listVoiceoverVoices,
  publishVideoRender,
  resetVideoEditor,
  rewriteVoiceoverScript,
  restoreVideoEditVersion,
  saveVideoEditor,
  voiceoverCueUrl,
} from "../../api";
import { errorMessage } from "../../errors";
import { currentOutputLocale, t } from "../../i18n";
import { openRecording } from "../../navigation";
import { materializeVideoCaptions } from "../../video-editor/model";

export interface VideoEditorControllerOptions {
  recording: Recording;
  video: RecordingVideo;
  onPublished(video: RecordingVideo): void;
  onGenerationFinished(): void;
}

type Props = VideoEditorControllerOptions;

export function useVideoEditorController({
  recording,
  video,
  onPublished,
  onGenerationFinished,
}: Props) {
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
  const [mp4Export, setMp4Export] = useState<VideoMp4Export>();
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
  const [rewriteNotice, setRewriteNotice] = useState<string>();
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
      })) ?? materializeVideoCaptions(next, next.draft.recipe);
    setNarrationCues(initialCues);
    if (next.voiceoverAvailable) {
      void listVoiceoverVoices(recording.id)
        .then((result) => {
          setVoices(result.voices);
          setVoice(next.voiceover?.voice ?? result.defaultVoice);
        })
        .catch((loadError) => setError(errorMessage(loadError)));
    }
  }, [recording.id]);

  useEffect(() => {
    void load().catch((loadError) => setError(errorMessage(loadError)));
  }, [load]);

  useEffect(() => {
    if (
      video.transcriptionStatus !== "pending" &&
      video.transcriptionStatus !== "processing"
    )
      return;

    let disposed = false;
    let polling = false;
    const refreshGeneration = async () => {
      if (polling) return;
      polling = true;
      try {
        const nextVideo = await getRecordingVideo(recording.id);
        if (disposed) return;
        if (
          nextVideo.transcriptionStatus === "ready" ||
          nextVideo.transcriptionStatus === "failed"
        ) {
          const latest = await getVideoEditor(recording.id);
          if (disposed) return;
          setState((current) =>
            current
              ? { ...current, transcriptCues: latest.transcriptCues }
              : latest,
          );
          onPublished(nextVideo);
          onGenerationFinished();
        } else {
          onPublished(nextVideo);
        }
      } catch {
        // The next poll can recover from a temporary request failure.
      } finally {
        polling = false;
      }
    };

    const timer = window.setInterval(() => void refreshGeneration(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [recording.id, video.transcriptionStatus]);

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
      const message = errorMessage(saveError);
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
    if (!render || render.status !== "ready") {
      setMp4Export(undefined);
      return;
    }
    let active = true;
    void getVideoMp4Export(recording.id, render.id)
      .then((exported) => {
        if (active) setMp4Export(exported);
      })
      .catch(() => {
        if (active) setMp4Export(undefined);
      });
    return () => {
      active = false;
    };
  }, [recording.id, render?.id, render?.status]);

  useEffect(() => {
    if (
      !render ||
      !mp4Export ||
      (mp4Export.status !== "queued" && mp4Export.status !== "processing")
    )
      return;
    const timer = window.setInterval(() => {
      void getVideoMp4Export(recording.id, render.id)
        .then(setMp4Export)
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [recording.id, render?.id, mp4Export?.id, mp4Export?.status]);

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
        t("Edit {date}", { date: new Date().toLocaleString() }),
      );
      setRender(next);
      setMp4Export(undefined);
      setCandidatePreview(false);
      setError(undefined);
    } catch (renderError) {
      setError(errorMessage(renderError));
    }
  }

  async function requestMp4Export() {
    if (!render || render.status !== "ready") return;
    try {
      setMp4Export(await createVideoMp4Export(recording.id, render.id));
      setError(undefined);
    } catch (exportError) {
      setError(errorMessage(exportError));
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
      setError(errorMessage(generationError));
    }
  }

  async function rewriteScript() {
    setRewriteNotice(undefined);
    setRewritingScript(true);
    try {
      const before = new Map(narrationCues.map((cue) => [cue.id, cue.text]));
      const result = await rewriteVoiceoverScript(
        recording.id,
        narrationCues,
        scriptStyle,
        currentOutputLocale(),
        voiceoverSpeed,
      );
      setNarrationCues(result.cues);
      const changed = result.cues.filter(
        (cue) => before.get(cue.id)?.trim() !== cue.text.trim(),
      ).length;
      setRewriteNotice(
        t("Rewrote {count} narration cues.", { count: changed }),
      );
      setError(undefined);
    } catch (rewriteError) {
      setError(errorMessage(rewriteError));
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
      .catch((previewError) => setError(errorMessage(previewError)));
  }

  async function retryLocalDraft() {
    try {
      const latest = await getVideoEditor(recording.id);
      setRevision(latest.draft.revision);
      setSavePaused(false);
      setDirty(true);
      setError(undefined);
      saveGeneration.current += 1;
    } catch (retryError) {
      setError(errorMessage(retryError));
    }
  }

  async function saveNamedVersion(name: string) {
    try {
      await persist();
      await createVideoEditVersion(recording.id, name);
      await load();
    } catch (versionError) {
      setError(errorMessage(versionError));
    }
  }

  async function restoreVersion(versionId: string) {
    try {
      await restoreVideoEditVersion(recording.id, versionId);
      await load();
    } catch (restoreError) {
      setError(errorMessage(restoreError));
    }
  }

  async function cancelActiveRender() {
    if (!render) return;
    await cancelVideoRender(recording.id, render.id);
    setRender(await getVideoRender(recording.id, render.id));
  }

  async function publishChanges() {
    if (!render) return;
    try {
      const published = await publishVideoRender(recording.id, render.id);
      onPublished(published);
      openRecording(recording.id, "video");
    } catch (publishError) {
      setError(errorMessage(publishError));
    }
  }

  async function resetAllEdits() {
    await resetVideoEditor(recording.id);
    await load();
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous || !recipe) return;
    setFuture((items) => [recipe, ...items]);
    setPast((items) => items.slice(0, -1));
    setRecipe(previous);
    setDirty(true);
    saveGeneration.current += 1;
  }

  function redo() {
    const next = future[0];
    if (!next || !recipe) return;
    setPast((items) => [...items, recipe]);
    setFuture((items) => items.slice(1));
    setRecipe(next);
    setDirty(true);
    saveGeneration.current += 1;
  }

  return {
    state,
    setState,
    recipe,
    setRecipe,
    revision,
    setRevision,
    dirty,
    setDirty,
    savePaused,
    setSavePaused,
    saving,
    error,
    setError,
    panel,
    setPanel,
    render,
    setRender,
    mp4Export,
    setMp4Export,
    candidatePreview,
    setCandidatePreview,
    playheadMs,
    setPlayheadMs,
    previewTimeMs,
    cutStartMs,
    setCutStartMs,
    cutEndMs,
    setCutEndMs,
    past,
    setPast,
    future,
    setFuture,
    voices,
    voice,
    setVoice,
    voiceoverSpeed,
    setVoiceoverSpeed,
    narrationCues,
    setNarrationCues,
    voiceover,
    scriptStyle,
    setScriptStyle,
    rewritingScript,
    rewriteNotice,
    setRewriteNotice,
    screenVideo,
    cameraVideo,
    microphoneAudio,
    saveGeneration,
    load,
    change,
    persist,
    hasScreen,
    hasCamera,
    hasMicrophone,
    bubbleWidthRatio,
    bubbleHeightRatio,
    effectiveCaptions,
    sourceCaptions,
    currentCaption,
    syncSecondary,
    sourceTimeUpdate,
    playbackStarted,
    playbackPaused,
    requestRender,
    requestMp4Export,
    requestVoiceover,
    rewriteScript,
    previewVoiceoverCue,
    retryLocalDraft,
    saveNamedVersion,
    restoreVersion,
    cancelActiveRender,
    publishChanges,
    resetAllEdits,
    undo,
    redo,
  };
}

export type VideoEditorController = ReturnType<typeof useVideoEditorController>;
