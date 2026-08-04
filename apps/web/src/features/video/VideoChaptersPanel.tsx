// SPDX-License-Identifier: AGPL-3.0-only
import { videoSourceToOutputMs } from "@infosteed/shared";
import { t } from "../../i18n";
import { videoTimeLabel } from "../../video-editor/model";
import type { VideoEditorController } from "./useVideoEditorController";

export function VideoChaptersPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const { panel, state, recipe, playheadMs, change } = controller;
  if (!state || !recipe || panel !== "chapters") return null;

  return (
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
                title: t("New chapter"),
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
        {t("Add chapter at playhead")}
      </button>
      {recipe.chapters.map((chapter, index) => {
        const outputMs = videoSourceToOutputMs(recipe, chapter.sourceOffsetMs);
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
              {t("Source ms")}{" "}
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
                ? t("Removed by cut")
                : t("Edited time {time}", {
                    time: videoTimeLabel(outputMs),
                  })}
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
              {chapter.hidden ? t("Restore") : t("Hide")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
