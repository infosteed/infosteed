// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../../i18n";
import {
  materializeVideoCaptions,
  videoTimestampLabel,
} from "../../video-editor/model";
import type { VideoEditorController } from "./useVideoEditorController";
import { VideoTimeInput } from "./VideoTimeInput";

export function VideoCaptionsPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const {
    panel,
    narrationView,
    state,
    recipe,
    playheadMs,
    voiceover,
    selectedNarrationCueId,
    setSelectedNarrationCueId,
    seekToSourceMs,
    change,
  } = controller;
  if (
    !state ||
    !recipe ||
    panel !== "narration" ||
    narrationView !== "captions"
  )
    return null;

  const locked =
    voiceover?.status === "queued" || voiceover?.status === "processing";
  const cues = materializeVideoCaptions(state, recipe);

  function updateCues(next: typeof cues) {
    change({ ...recipe!, captions: { mode: "manual", cues: next } });
  }

  return (
    <fieldset
      className="video-edit-list inspector-panel-list"
      disabled={locked}
    >
      <div className="inspector-panel-heading">
        <div>
          <strong>{t("Captions")}</strong>
          <small>
            {recipe.captions.mode === "transcript"
              ? t("Using transcript · {count} cues", { count: cues.length })
              : t("Edited captions · {count} cues", { count: cues.length })}
          </small>
        </div>
        <div className="inspector-heading-actions">
          <button
            disabled={playheadMs >= recipe.sourceDurationMs}
            onClick={() => {
              const id = crypto.randomUUID();
              const sourceStartMs = Math.min(
                playheadMs,
                recipe.sourceDurationMs - 1,
              );
              updateCues([
                ...cues,
                {
                  id,
                  sourceStartMs,
                  sourceEndMs: Math.min(
                    recipe.sourceDurationMs,
                    sourceStartMs + 2_000,
                  ),
                  text: t("New caption"),
                },
              ]);
              setSelectedNarrationCueId(id);
            }}
          >
            {t("Add at playhead")}
          </button>
          {recipe.captions.mode === "manual" && (
            <button
              onClick={() => {
                change({ ...recipe, captions: { mode: "transcript" } });
                setSelectedNarrationCueId(undefined);
              }}
            >
              {t("Reset to transcript")}
            </button>
          )}
        </div>
      </div>

      {locked && (
        <p className="inspector-notice">
          {t(
            "Voiceover generation is in progress. Captions will unlock when synchronization finishes.",
          )}
        </p>
      )}

      {cues.map((cue, index) => {
        const selected = selectedNarrationCueId === cue.id;
        return (
          <div
            className={`inspector-item${selected ? " selected" : ""}`}
            key={cue.id}
          >
            <button
              aria-expanded={selected}
              className="inspector-item-summary"
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
              </span>
              <span aria-hidden="true">{selected ? "−" : "+"}</span>
            </button>

            {selected && (
              <div className="inspector-item-details">
                <label>
                  <span>{t("Caption text")}</span>
                  <textarea
                    value={cue.text}
                    onChange={(event) =>
                      updateCues(
                        cues.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, text: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <div className="cue-times">
                  <VideoTimeInput
                    label={t("Start")}
                    max={cue.sourceEndMs - 1}
                    value={cue.sourceStartMs}
                    onChange={(value) =>
                      updateCues(
                        cues.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, sourceStartMs: value }
                            : item,
                        ),
                      )
                    }
                  />
                  <VideoTimeInput
                    label={t("End")}
                    max={recipe.sourceDurationMs}
                    min={cue.sourceStartMs + 1}
                    value={cue.sourceEndMs}
                    onChange={(value) =>
                      updateCues(
                        cues.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, sourceEndMs: value }
                            : item,
                        ),
                      )
                    }
                  />
                </div>
                <div className="inspector-item-actions wrap-actions">
                  <button
                    disabled={playheadMs >= cue.sourceEndMs}
                    onClick={() =>
                      updateCues(
                        cues.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, sourceStartMs: playheadMs }
                            : item,
                        ),
                      )
                    }
                  >
                    {t("Start at playhead")}
                  </button>
                  <button
                    disabled={playheadMs <= cue.sourceStartMs}
                    onClick={() =>
                      updateCues(
                        cues.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, sourceEndMs: playheadMs }
                            : item,
                        ),
                      )
                    }
                  >
                    {t("End at playhead")}
                  </button>
                  <button
                    disabled={cue.sourceEndMs - cue.sourceStartMs < 200}
                    onClick={() => {
                      const midpoint = Math.round(
                        (cue.sourceStartMs + cue.sourceEndMs) / 2,
                      );
                      const firstId = crypto.randomUUID();
                      const next = [...cues];
                      next.splice(
                        index,
                        1,
                        { ...cue, id: firstId, sourceEndMs: midpoint },
                        {
                          ...cue,
                          id: crypto.randomUUID(),
                          sourceStartMs: midpoint,
                        },
                      );
                      updateCues(next);
                      setSelectedNarrationCueId(firstId);
                    }}
                  >
                    {t("Split")}
                  </button>
                  <button
                    disabled={index === 0}
                    onClick={() => {
                      const previous = cues[index - 1];
                      const next = [...cues];
                      next.splice(index - 1, 2, {
                        ...previous,
                        sourceEndMs: cue.sourceEndMs,
                        text: `${previous.text} ${cue.text}`.trim(),
                      });
                      updateCues(next);
                      setSelectedNarrationCueId(previous.id);
                    }}
                  >
                    {t("Merge previous")}
                  </button>
                  <button
                    className="danger-action"
                    onClick={() => {
                      updateCues(
                        cues.filter((_item, itemIndex) => itemIndex !== index),
                      );
                      setSelectedNarrationCueId(undefined);
                    }}
                  >
                    {t("Delete")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
