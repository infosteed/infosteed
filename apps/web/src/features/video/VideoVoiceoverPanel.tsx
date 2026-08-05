// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../../i18n";
import {
  captionCuesEqual,
  materializeVideoCaptions,
  videoTimestampLabel,
  voiceoverCaptionCues,
} from "../../video-editor/model";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoVoiceoverPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const {
    panel,
    narrationView,
    setNarrationView,
    state,
    recipe,
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
    selectedNarrationCueId,
    setSelectedNarrationCueId,
    seekToSourceMs,
    rewriteScript,
    previewVoiceoverCue,
    requestVoiceover,
  } = controller;
  if (
    !state ||
    !recipe ||
    panel !== "narration" ||
    narrationView !== "voiceover"
  )
    return null;

  const running =
    voiceover?.status === "queued" || voiceover?.status === "processing";
  const attached =
    voiceover?.status === "ready" &&
    recipe.voiceover.generationId === voiceover.id &&
    recipe.voiceover.assetId === voiceover.assetId;
  const captionsSynchronized = Boolean(
    attached &&
    captionCuesEqual(
      materializeVideoCaptions(state, recipe),
      voiceoverCaptionCues(voiceover!, recipe.sourceDurationMs),
    ),
  );
  const scriptMatchesGeneration = Boolean(
    voiceover &&
    narrationCues.length === voiceover.cues.length &&
    narrationCues.every((cue, index) => {
      const generated = voiceover.cues[index];
      return (
        generated?.id === cue.id &&
        generated.sourceStartMs === cue.sourceStartMs &&
        generated.sourceEndMs === cue.sourceEndMs &&
        generated.text === cue.text
      );
    }),
  );

  function useEditedCaptions() {
    const cues = materializeVideoCaptions(state!, recipe!);
    setNarrationCues(cues);
    setSelectedNarrationCueId(cues[0]?.id);
    setRewriteNotice(undefined);
  }

  return (
    <div className="video-edit-list inspector-panel-list voiceover-panel">
      {!state.voiceoverAvailable && (
        <p className="raw-warning">
          {t(
            "Local TTS is not configured. Start the optional Kokoro service and set TTS_BASE_URL.",
          )}
        </p>
      )}

      <div className="inspector-panel-heading voiceover-heading">
        <div>
          <strong>{t("AI voiceover")}</strong>
          <small>
            {t("Generation replaces captions and retimes them to speech.")}
          </small>
        </div>
      </div>

      <fieldset className="voiceover-settings" disabled={running}>
        <div className="voiceover-setting-grid">
          <label>
            {t("Voice")}
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
            {t("Speed")}
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
          <label>
            {t("Script style")}
            <select
              value={scriptStyle}
              onChange={(event) =>
                setScriptStyle(event.target.value as typeof scriptStyle)
              }
            >
              <option value="natural">{t("Natural")}</option>
              <option value="concise">{t("Concise")}</option>
              <option value="instructional">{t("Instructional")}</option>
            </select>
          </label>
        </div>
        <div className="voiceover-workflow-actions">
          <button onClick={useEditedCaptions}>
            {t("Use edited captions")}
          </button>
          <button
            disabled={rewritingScript || narrationCues.length === 0}
            onClick={() => void rewriteScript()}
          >
            {rewritingScript
              ? t("Rewriting locally...")
              : t("Rewrite with local model")}
          </button>
          <button
            className="primary-action"
            disabled={
              !state.voiceoverAvailable || !voice || narrationCues.length === 0
            }
            onClick={() => void requestVoiceover()}
          >
            {voiceover ? t("Generate new voiceover") : t("Generate voiceover")}
          </button>
        </div>
        <small>
          {t(
            "Script changes remain staged. Captions update only after generation succeeds.",
          )}
        </small>
        {rewriteNotice && <p className="rewrite-success">{rewriteNotice}</p>}
      </fieldset>

      {voiceover && (
        <div className={`voiceover-state voiceover-state-${voiceover.status}`}>
          <div>
            <strong>
              {running
                ? t("Generating voiceover")
                : voiceover.status === "failed"
                  ? t("Voiceover generation failed")
                  : !scriptMatchesGeneration
                    ? t("Script changed")
                    : captionsSynchronized
                      ? t("Voiceover ready · captions synchronized")
                      : attached
                        ? t("Captions edited after voiceover")
                        : t("Voiceover ready")}
            </strong>
            <small>
              {!running && !scriptMatchesGeneration
                ? t("Regenerate to update the voiceover and captions.")
                : attached && !captionsSynchronized
                  ? t(
                      "Use edited captions before regenerating to resynchronize.",
                    )
                  : t("Generation: {status}", { status: t(voiceover.status) })}
            </small>
          </div>
          {running && <progress max={1} value={voiceover.progress} />}
          {voiceover.errorMessage && (
            <p className="error">{voiceover.errorMessage}</p>
          )}
          {voiceover.cues.some((cue) => cue.overlongByMs > 0) && (
            <p className="raw-warning">
              {t(
                "Some speech overlaps a later cue. Review the highlighted narration.",
              )}
            </p>
          )}
          {attached && (
            <button onClick={() => setNarrationView("captions")}>
              {t("Review captions")}
            </button>
          )}
        </div>
      )}

      {narrationCues.map((cue, index) => {
        const generated = voiceover?.cues.find((item) => item.id === cue.id);
        const selected = selectedNarrationCueId === cue.id;
        return (
          <div
            className={`inspector-item${selected ? " selected" : ""}${generated?.overlongByMs ? " overlong-cue" : ""}`}
            key={cue.id}
          >
            <button
              aria-expanded={selected}
              className="inspector-item-summary"
              disabled={running}
              onClick={() => {
                setSelectedNarrationCueId(selected ? undefined : cue.id);
                seekToSourceMs(cue.sourceStartMs);
              }}
            >
              <span className="inspector-item-time caption-time">
                {videoTimestampLabel(cue.sourceStartMs)}
                <span>→</span>
                {videoTimestampLabel(cue.sourceEndMs)}
              </span>
              <span className="inspector-item-copy">
                <strong>{cue.text}</strong>
                <small>
                  {generated?.durationMs
                    ? t("Speech {duration}", {
                        duration: videoTimestampLabel(generated.durationMs),
                      })
                    : t("Not generated")}
                </small>
              </span>
              <span aria-hidden="true">{selected ? "−" : "+"}</span>
            </button>

            {selected && (
              <div className="inspector-item-details">
                <label>
                  <span>{t("Narration text")}</span>
                  <textarea
                    disabled={running}
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
                </label>
                {Boolean(generated?.overlongByMs) && (
                  <strong className="error">
                    {t("Speech runs {seconds}s beyond this cue.", {
                      seconds: (generated!.overlongByMs / 1000).toFixed(1),
                    })}
                  </strong>
                )}
                {generated?.errorMessage && (
                  <span className="error">{generated.errorMessage}</span>
                )}
                <div className="inspector-item-actions">
                  <button
                    disabled={generated?.status !== "ready"}
                    onClick={() => previewVoiceoverCue(cue.id)}
                  >
                    {t("Preview cue")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <small>
        {t(
          "Only installed stock voices are available. Voice cloning is not supported.",
        )}
      </small>
    </div>
  );
}
