// SPDX-License-Identifier: AGPL-3.0-only
import type {
  EditableCaptionCue,
  VideoEditRecipe,
  VideoEditorState,
} from "@infosteed/shared";

export function videoTimeLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function subtractVideoRange(
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

export function materializeVideoCaptions(
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
