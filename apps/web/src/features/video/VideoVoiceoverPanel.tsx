// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../../i18n";
import {
  materializeVideoCaptions,
  videoTimeLabel,
} from "../../video-editor/model";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoVoiceoverPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const {
    panel,
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
    rewriteScript,
    previewVoiceoverCue,
    requestVoiceover,
  } = controller;
  if (!state || !recipe || panel !== "voiceover") return null;

  return (
    <div className="video-edit-list voiceover-panel">
      {!state.voiceoverAvailable && (
        <p className="raw-warning">
          {t(
            "Local TTS is not configured. Start the optional Kokoro service and set TTS_BASE_URL.",
          )}
        </p>
      )}
      <div className="voiceover-settings">
        <label>
          {t("Voice")}{" "}
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
          {t("Speed")}{" "}
          <select
            value={voiceoverSpeed}
            onChange={(event) => setVoiceoverSpeed(Number(event.target.value))}
          >
            {[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((value) => (
              <option key={value} value={value}>
                {value}x
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() => {
            setNarrationCues(materializeVideoCaptions(state, recipe));
            setRewriteNotice(undefined);
          }}
        >
          {t("Use edited captions")}
        </button>
        <label>
          {t("Script style")}{" "}
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
        <button
          disabled={rewritingScript || narrationCues.length === 0}
          onClick={() => void rewriteScript()}
        >
          {rewritingScript
            ? t("Rewriting locally...")
            : t("Rewrite with local model")}
        </button>
        <small>
          {t(
            "The rewrite keeps cue timing but turns literal captions into narration. You can edit every cue before synthesis.",
          )}
        </small>
        {rewriteNotice && <p className="rewrite-success">{rewriteNotice}</p>}
      </div>
      {voiceover && (
        <div className="voiceover-progress">
          <strong>
            {t("Generation: {status}", { status: t(voiceover.status) })}
          </strong>
          <progress max={1} value={voiceover.progress} />
          {voiceover.errorMessage && (
            <p className="error">{voiceover.errorMessage}</p>
          )}
          {voiceover.cues.some((cue) => cue.overlongByMs > 0) && (
            <p className="raw-warning">
              {t(
                "Some speech is longer than its cue. It is not truncated and may overlap later narration.",
              )}
            </p>
          )}
        </div>
      )}
      {narrationCues.map((cue, index) => {
        const generated = voiceover?.cues.find((item) => item.id === cue.id);
        return (
          <div
            className={
              generated?.overlongByMs ? "edit-row overlong-cue" : "edit-row"
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
              {videoTimeLabel(cue.sourceStartMs)}–
              {videoTimeLabel(cue.sourceEndMs)}
              {generated?.durationMs
                ? t(" · speech {duration}", {
                    duration: videoTimeLabel(generated.durationMs),
                  })
                : ""}
            </small>
            {Boolean(generated?.overlongByMs) && (
              <strong className="error">
                {t("Over by {seconds}s", {
                  seconds: (generated!.overlongByMs / 1000).toFixed(1),
                })}
              </strong>
            )}
            {generated?.errorMessage && (
              <span className="error">{generated.errorMessage}</span>
            )}
            <button
              disabled={generated?.status !== "ready"}
              onClick={() => previewVoiceoverCue(cue.id)}
            >
              {t("Preview cue")}
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
          ? t("Generate / regenerate voiceover")
          : t("Generate voiceover")}
      </button>
      <small>
        {t(
          "Only installed stock voices are available. Voice cloning is not supported.",
        )}
      </small>
    </div>
  );
}
