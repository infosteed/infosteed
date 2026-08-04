// SPDX-License-Identifier: AGPL-3.0-only
import { t } from "../../i18n";
import { materializeVideoCaptions } from "../../video-editor/model";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoCaptionsPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const { panel, state, recipe, playheadMs, change } = controller;
  if (!state || !recipe || panel !== "captions") return null;

  return (
    <div className="video-edit-list video-edit-caption-list">
      <div className="caption-actions">
        <button
          onClick={() => {
            const cues = materializeVideoCaptions(state, recipe);
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
                    text: t("New caption"),
                  },
                ],
              },
            });
          }}
        >
          {t("Add caption")}
        </button>
        {recipe.captions.mode === "manual" && (
          <button
            onClick={() =>
              change({ ...recipe, captions: { mode: "transcript" } })
            }
          >
            {t("Reset to transcript")}
          </button>
        )}
      </div>
      {(recipe.captions.mode === "manual"
        ? recipe.captions.cues
        : materializeVideoCaptions(state, recipe)
      ).map((cue, index) => (
        <div className="edit-row" key={cue.id}>
          <textarea
            value={cue.text}
            onChange={(event) => {
              const cues = materializeVideoCaptions(state, recipe).map(
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
                const cues = materializeVideoCaptions(state, recipe).map(
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
                const cues = materializeVideoCaptions(state, recipe).map(
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
                  cues: materializeVideoCaptions(state, recipe).filter(
                    (_item, itemIndex) => itemIndex !== index,
                  ),
                },
              })
            }
          >
            {t("Delete")}
          </button>
          <button
            disabled={cue.sourceEndMs - cue.sourceStartMs < 200}
            onClick={() => {
              const midpoint = Math.round(
                (cue.sourceStartMs + cue.sourceEndMs) / 2,
              );
              const cues = materializeVideoCaptions(state, recipe);
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
            {t("Split")}
          </button>
          <button
            disabled={index === 0}
            onClick={() => {
              const cues = materializeVideoCaptions(state, recipe);
              const previous = cues[index - 1];
              cues.splice(index - 1, 2, {
                ...previous,
                sourceEndMs: cue.sourceEndMs,
                text: `${previous.text} ${cue.text}`.trim(),
              });
              change({ ...recipe, captions: { mode: "manual", cues } });
            }}
          >
            {t("Merge previous")}
          </button>
        </div>
      ))}
    </div>
  );
}
