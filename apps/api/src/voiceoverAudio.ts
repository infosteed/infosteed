// SPDX-License-Identifier: AGPL-3.0-only
export function buildNormalizeVoiceoverArguments(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "24000",
    "-c:a",
    "pcm_s16le",
    outputPath,
  ];
}

export function buildVoiceoverTimelineArguments(
  sourceDurationMs: number,
  clips: Array<{ path: string; sourceStartMs: number }>,
  outputPath: string,
): string[] {
  const args = [
    "-hide_banner",
    "-y",
    "-f",
    "lavfi",
    "-t",
    (sourceDurationMs / 1000).toFixed(3),
    "-i",
    "anullsrc=r=24000:cl=mono",
  ];
  for (const clip of clips) args.push("-i", clip.path);
  const filters = clips.map(
    (clip, index) =>
      `[${index + 1}:a]adelay=${clip.sourceStartMs}|${clip.sourceStartMs}[cue${index}]`,
  );
  const inputs = [
    "[0:a]",
    ...clips.map((_clip, index) => `[cue${index}]`),
  ].join("");
  filters.push(
    `${inputs}amix=inputs=${clips.length + 1}:duration=longest:normalize=0,alimiter=limit=0.95[outa]`,
  );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[outa]",
    "-ac",
    "1",
    "-ar",
    "24000",
    "-c:a",
    "pcm_s16le",
    outputPath,
  );
  return args;
}
