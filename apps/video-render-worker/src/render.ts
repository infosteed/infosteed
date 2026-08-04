// SPDX-License-Identifier: AGPL-3.0-only
import type { VideoEditRecipe } from "@infosteed/shared";

export interface RenderInputs {
  basePath: string;
  cameraPath?: string;
  microphonePath?: string;
  voiceoverPath?: string;
  baseHasAudio: boolean;
  width: number;
  height: number;
  frameRate: number;
  recipe: VideoEditRecipe;
  outputPath: string;
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}

export function buildFfmpegArguments(input: RenderInputs): string[] {
  const args = ["-hide_banner", "-y", "-i", input.basePath];
  let cameraIndex: number | undefined;
  let microphoneIndex: number | undefined;
  let voiceoverIndex: number | undefined;
  if (input.cameraPath) {
    cameraIndex = 1;
    args.push("-i", input.cameraPath);
  }
  if (input.microphonePath) {
    microphoneIndex = cameraIndex === undefined ? 1 : 2;
    args.push("-i", input.microphonePath);
  }
  if (input.voiceoverPath && input.recipe.voiceover.enabled) {
    voiceoverIndex =
      1 +
      Number(cameraIndex !== undefined) +
      Number(microphoneIndex !== undefined);
    args.push("-i", input.voiceoverPath);
  }

  const filters: string[] = [];
  if (cameraIndex !== undefined && input.recipe.webcam.visible) {
    const size = Math.max(
      2,
      Math.round(
        (Math.min(input.width, input.height) * input.recipe.webcam.diameter) /
          2,
      ) * 2,
    );
    const x = Math.max(
      0,
      Math.min(
        input.width - size,
        Math.round(input.recipe.webcam.centerX * input.width - size / 2),
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        input.height - size,
        Math.round(input.recipe.webcam.centerY * input.height - size / 2),
      ),
    );
    filters.push(
      `[${cameraIndex}:v]setpts=PTS-STARTPTS,hflip,scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size},format=rgba[camraw]`,
      `color=c=white:s=${size}x${size},format=gray,geq=lum='if(lte((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),(W/2)*(W/2)),255,0)'[cammask]`,
      `[camraw][cammask]alphamerge[camcircle]`,
      `[0:v]setpts=PTS-STARTPTS[screenbase]`,
      `[screenbase][camcircle]overlay=${x}:${y}:eof_action=pass:shortest=0[basev]`,
    );
  } else {
    filters.push("[0:v]setpts=PTS-STARTPTS[basev]");
  }

  const audioInputs: string[] = [];
  if (input.baseHasAudio) {
    filters.push(`[0:a]volume=${input.recipe.audio.tabGain.toFixed(3)}[taba]`);
    audioInputs.push("[taba]");
  }
  if (microphoneIndex !== undefined) {
    filters.push(
      `[${microphoneIndex}:a]volume=${input.recipe.audio.microphoneGain.toFixed(3)}[mica]`,
    );
    audioInputs.push("[mica]");
  }
  if (voiceoverIndex !== undefined) {
    filters.push(
      `[${voiceoverIndex}:a]volume=${input.recipe.audio.voiceoverGain.toFixed(3)}[voicea]`,
    );
    audioInputs.push("[voicea]");
  }
  // Ducking extension point: derive a side-chain from [voicea] and compress [taba]
  // here before assembling audioInputs. The MVP deliberately keeps independent gains.
  const hasAudio = audioInputs.length > 0;
  if (audioInputs.length > 1) {
    filters.push(
      `${audioInputs.join("")}amix=inputs=${audioInputs.length}:duration=longest:normalize=0,alimiter=limit=0.95[basea]`,
    );
  } else if (audioInputs.length === 1) {
    filters.push(`${audioInputs[0]}alimiter=limit=0.95[basea]`);
  }

  const rangeCount = input.recipe.keepRanges.length;
  if (rangeCount > 1) {
    filters.push(
      `[basev]split=${rangeCount}${input.recipe.keepRanges.map((_range, index) => `[vsource${index}]`).join("")}`,
    );
    if (hasAudio)
      filters.push(
        `[basea]asplit=${rangeCount}${input.recipe.keepRanges.map((_range, index) => `[asource${index}]`).join("")}`,
      );
  }
  input.recipe.keepRanges.forEach((range, index) => {
    const videoSource = rangeCount === 1 ? "basev" : `vsource${index}`;
    filters.push(
      `[${videoSource}]trim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},setpts=PTS-STARTPTS[v${index}]`,
    );
    if (hasAudio) {
      const audioSource = rangeCount === 1 ? "basea" : `asource${index}`;
      filters.push(
        `[${audioSource}]atrim=start=${seconds(range.startMs)}:end=${seconds(range.endMs)},asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
  });
  const concatInputs = input.recipe.keepRanges
    .map((_range, index) =>
      hasAudio ? `[v${index}][a${index}]` : `[v${index}]`,
    )
    .join("");
  filters.push(
    `${concatInputs}concat=n=${rangeCount}:v=1:a=${hasAudio ? 1 : 0}[outv]${hasAudio ? "[outa]" : ""}`,
  );

  args.push("-filter_complex", filters.join(";"), "-map", "[outv]");
  if (hasAudio) args.push("-map", "[outa]");
  args.push(
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "32",
    "-b:v",
    "0",
    "-cpu-used",
    "4",
    "-row-mt",
    "1",
    "-deadline",
    "good",
    "-r",
    String(Math.min(30, Math.max(1, input.frameRate))),
    "-pix_fmt",
    "yuv420p",
  );
  if (hasAudio) args.push("-c:a", "libopus", "-b:a", "128k");
  args.push("-progress", "pipe:1", "-nostats", input.outputPath);
  return args;
}
