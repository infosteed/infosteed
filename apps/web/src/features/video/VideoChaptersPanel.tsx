// SPDX-License-Identifier: AGPL-3.0-only
import { videoSourceToOutputMs } from "@infosteed/shared";
import { t } from "../../i18n";
import { videoTimeLabel } from "../../video-editor/model";
import type { VideoEditorController } from "./useVideoEditorController";
import { VideoTimeInput } from "./VideoTimeInput";

export function VideoChaptersPanel({
  controller,
}: {
  controller: VideoEditorController;
}) {
  const {
    panel,
    state,
    recipe,
    playheadMs,
    selectedChapterId,
    setSelectedChapterId,
    seekToSourceMs,
    change,
  } = controller;
  if (!state || !recipe || panel !== "chapters") return null;

  return (
    <div className="video-edit-list inspector-panel-list">
      <div className="inspector-panel-heading">
        <div>
          <strong>{t("Chapters")}</strong>
          <small>
            {t("{count} chapter markers", { count: recipe.chapters.length })}
          </small>
        </div>
        <button
          onClick={() => {
            const id = crypto.randomUUID();
            change({
              ...recipe,
              chapters: [
                ...recipe.chapters,
                {
                  id,
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
            });
            setSelectedChapterId(id);
          }}
        >
          {t("Add at playhead")}
        </button>
      </div>

      {recipe.chapters.map((chapter, index) => {
        const outputMs = videoSourceToOutputMs(recipe, chapter.sourceOffsetMs);
        const selected = selectedChapterId === chapter.id;
        const muted = chapter.hidden || outputMs === null;
        return (
          <div
            className={`inspector-item${muted ? " muted" : ""}${selected ? " selected" : ""}`}
            key={chapter.id}
          >
            <button
              aria-expanded={selected}
              className="inspector-item-summary"
              onClick={() => {
                setSelectedChapterId(selected ? undefined : chapter.id);
                seekToSourceMs(chapter.sourceOffsetMs);
              }}
            >
              <span className="inspector-item-time">
                {outputMs === null ? t("Cut") : videoTimeLabel(outputMs)}
              </span>
              <span className="inspector-item-copy">
                <strong>{chapter.title}</strong>
                <small>
                  {chapter.hidden
                    ? t("Hidden")
                    : outputMs === null
                      ? t("Removed by cut")
                      : t("Edited time {time}", {
                          time: videoTimeLabel(outputMs),
                        })}
                </small>
              </span>
              <span aria-hidden="true">{selected ? "−" : "+"}</span>
            </button>

            {selected && (
              <div className="inspector-item-details">
                <label>
                  <span>{t("Title")}</span>
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
                </label>
                <VideoTimeInput
                  label={t("Source time")}
                  max={recipe.sourceDurationMs}
                  value={chapter.sourceOffsetMs}
                  onChange={(value) =>
                    change({
                      ...recipe,
                      chapters: recipe.chapters.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              sourceOffsetMs: value,
                              offsetEdited: true,
                            }
                          : item,
                      ),
                    })
                  }
                />
                <div className="inspector-item-actions">
                  <button
                    onClick={() =>
                      change({
                        ...recipe,
                        chapters: recipe.chapters.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                sourceOffsetMs: playheadMs,
                                offsetEdited: true,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    {t("Set to playhead")}
                  </button>
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
