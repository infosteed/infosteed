// SPDX-License-Identifier: AGPL-3.0-only
import type { GuideItem, Recording } from "@infosteed/shared";

export type DropPosition = "before" | "after";

function itemFromStep(step: Recording["steps"][number]): GuideItem {
  return {
    id: step.id,
    recordingId: step.recordingId,
    eventId: step.eventId,
    ordinal: step.ordinal,
    kind: "step",
    title: step.title,
    body: step.instruction,
    imageFilename: step.imageFilename,
    altText: step.altText,
    source: step.source,
    userEdited: step.userEdited,
  };
}

export function orderedItems(recording: Recording): GuideItem[] {
  const items =
    recording.items.length > 0
      ? recording.items
      : recording.steps.map(itemFromStep);
  return items.slice().sort((left, right) => left.ordinal - right.ordinal);
}

export function reorderGuideItemsForDrop(
  items: GuideItem[],
  itemId: string,
  targetId: string,
  position: DropPosition,
): GuideItem[] | undefined {
  const source = items.find((item) => item.id === itemId);
  if (!source || itemId === targetId) return undefined;
  const withoutSource = items.filter((item) => item.id !== itemId);
  const targetIndex = withoutSource.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return undefined;
  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  return [
    ...withoutSource.slice(0, insertIndex),
    source,
    ...withoutSource.slice(insertIndex),
  ];
}

export function moveGuideItem(
  items: GuideItem[],
  itemId: string,
  delta: -1 | 1,
): GuideItem[] | undefined {
  const index = items.findIndex((item) => item.id === itemId);
  if (index < 0 || !items[index + delta]) return undefined;
  const next = items.slice();
  next.splice(index, 1);
  next.splice(index + delta, 0, items[index]);
  return next;
}
