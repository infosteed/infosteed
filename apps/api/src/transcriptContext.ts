// SPDX-License-Identifier: AGPL-3.0-only
import type {
  Recording,
  TranscriptSegment,
  TranscriptWord,
} from "@infosteed/shared";

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

export function buildTranscriptionPrompt(recording: Recording): string {
  const candidates = [
    recording.title,
    recording.purpose,
    recording.audience,
    ...recording.events.flatMap((event) => [
      event.pageTitle,
      event.elementName,
      event.labelText,
      event.nearbyHeading,
    ]),
  ];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const value = clean(candidate);
    const key = value?.toLocaleLowerCase();
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }
  return values.join(", ").slice(0, 4_000);
}

export function transcriptAround(
  segments: TranscriptSegment[],
  offsetMs: number | undefined,
  beforeMs = 7_000,
  afterMs = 3_000,
): { transcriptBefore?: string; transcriptAfter?: string } {
  if (offsetMs === undefined) return {};
  const before = segments
    .filter(
      (segment) =>
        segment.startMs < offsetMs && segment.endMs >= offsetMs - beforeMs,
    )
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  const after = segments
    .filter(
      (segment) =>
        segment.startMs >= offsetMs && segment.startMs <= offsetMs + afterMs,
    )
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");
  return {
    transcriptBefore: before || undefined,
    transcriptAfter: after || undefined,
  };
}

function effectiveWordStart(word: TranscriptWord): number {
  return word.endMs - word.startMs > 2_000
    ? Math.max(word.startMs, word.endMs - 800)
    : word.startMs;
}

export function buildTranscriptCues(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
): TranscriptSegment[] {
  if (words.length === 0) return segments;
  const ordered = [...words]
    .filter((word) => word.text.trim() && word.endMs >= word.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (ordered.length === 0) return segments;

  const groups: Array<{ startMs: number; endMs: number; words: string[] }> = [];
  for (const word of ordered) {
    const startMs = effectiveWordStart(word);
    const previous = groups.at(-1);
    if (
      !previous ||
      startMs - previous.endMs > 1_600 ||
      startMs - previous.startMs > 7_000
    ) {
      groups.push({ startMs, endMs: word.endMs, words: [word.text.trim()] });
    } else {
      previous.endMs = Math.max(previous.endMs, word.endMs);
      previous.words.push(word.text.trim());
    }
  }
  return groups.map((group, id) => ({
    id,
    startMs: group.startMs,
    endMs: group.endMs,
    text: group.words.join(" "),
  }));
}

function timestamp(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const ms = Math.floor(safe % 1_000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function transcriptToWebVtt(segments: TranscriptSegment[]): string {
  const cues = segments
    .filter((segment) => segment.text.trim() && segment.endMs > segment.startMs)
    .map(
      (segment, index) =>
        `${index + 1}\n${timestamp(segment.startMs)} --> ${timestamp(segment.endMs)}\n${segment.text.replace(/\s+/g, " ").replace(/-->/g, "--\\>").trim()}`,
    );
  return `WEBVTT\n\n${cues.join("\n\n")}${cues.length ? "\n" : ""}`;
}
