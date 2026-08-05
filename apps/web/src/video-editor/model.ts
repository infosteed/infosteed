// SPDX-License-Identifier: AGPL-3.0-only
import type {
  EditableCaptionCue,
  VideoEditRecipe,
  VideoEditorState,
  VoiceoverGeneration,
} from "@infosteed/shared";

export function videoTimeLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function videoTimestampLabel(milliseconds: number): string {
  const bounded = Math.max(0, Math.round(milliseconds));
  const minutes = Math.floor(bounded / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1_000);
  const millis = bounded % 1_000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseVideoTimestamp(value: string): number | null {
  const match = /^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[3] ?? "").padEnd(3, "0");
  const result =
    Number(match[1]) * 60_000 +
    Number(match[2]) * 1_000 +
    Number(fraction || 0);
  return Number.isSafeInteger(result) ? result : null;
}

export function voiceoverCaptionCues(
  generation: VoiceoverGeneration,
  sourceDurationMs: number,
): EditableCaptionCue[] {
  return generation.cues.map((cue) => ({
    id: cue.id,
    sourceStartMs: cue.sourceStartMs,
    sourceEndMs: Math.min(
      sourceDurationMs,
      cue.durationMs === null
        ? cue.sourceEndMs
        : cue.sourceStartMs + cue.durationMs,
    ),
    text: cue.text,
  }));
}

export function captionCuesEqual(
  left: EditableCaptionCue[],
  right: EditableCaptionCue[],
): boolean {
  return (
    left.length === right.length &&
    left.every((cue, index) => {
      const candidate = right[index];
      return (
        candidate?.id === cue.id &&
        candidate.sourceStartMs === cue.sourceStartMs &&
        candidate.sourceEndMs === cue.sourceEndMs &&
        candidate.text === cue.text
      );
    })
  );
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
