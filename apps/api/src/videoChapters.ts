// SPDX-License-Identifier: AGPL-3.0-only
import { deterministicInstruction } from "@infosteed/ai-step-writer";
import type { Recording, VideoChapter } from "@infosteed/shared";

export function buildVideoChapters(
  recording: Recording,
  titleOverrides: Map<string, string> = new Map(),
): VideoChapter[] {
  if (recording.captureMode === "guide") return [];
  const itemsByEvent = new Map(
    recording.items
      .filter((item) => item.kind === "step" && item.eventId)
      .map((item) => [item.eventId!, item]),
  );
  return recording.events
    .filter((event) => event.videoOffsetMs !== undefined)
    .map((event) => {
      const item = itemsByEvent.get(event.id);
      return {
        id: item?.id ?? `event-${event.id}`,
        eventId: event.id,
        guideItemId: item?.id ?? null,
        title:
          item?.title ??
          titleOverrides.get(event.id) ??
          deterministicInstruction(event).title,
        offsetMs: event.videoOffsetMs!,
        ordinal: event.ordinal,
      };
    })
    .sort((a, b) => a.offsetMs - b.offsetMs || a.ordinal - b.ordinal);
}
