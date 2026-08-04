// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { videoEditRecipeSchema } from "@infosteed/shared";
import { buildFfmpegArguments } from "./render";

function recipe() {
  return videoEditRecipeSchema.parse({
    version: 1,
    sourceDurationMs: 20_000,
    keepRanges: [
      { startMs: 0, endMs: 4_000 },
      { startMs: 8_000, endMs: 15_000 },
    ],
    webcam: { visible: true, centerX: 0.75, centerY: 0.7, diameter: 0.2 },
    audio: { tabGain: 0.5, microphoneGain: 1.25 },
    chapters: [],
    captions: { mode: "transcript" },
  });
}

describe("FFmpeg render arguments", () => {
  it("builds cuts, webcam composition, and independent audio mixing without a shell", () => {
    const args = buildFfmpegArguments({
      basePath: "/tmp/base.webm",
      cameraPath: "/tmp/camera.webm",
      microphonePath: "/tmp/microphone.webm",
      baseHasAudio: true,
      width: 1920,
      height: 1080,
      frameRate: 30,
      recipe: recipe(),
      outputPath: "/tmp/output.webm",
    });
    const filters = args[args.indexOf("-filter_complex") + 1];
    expect(filters).toContain("trim=start=0.000:end=4.000");
    expect(filters).toContain("trim=start=8.000:end=15.000");
    expect(filters).toContain("alphamerge");
    expect(filters).toContain("volume=0.500");
    expect(filters).toContain("volume=1.250");
    expect(args).toContain("libvpx-vp9");
    expect(args).toContain("libopus");
  });

  it("renders video without adding an audio mapping when the source is silent", () => {
    const silent = recipe();
    silent.webcam.visible = false;
    const args = buildFfmpegArguments({
      basePath: "/tmp/base.webm",
      baseHasAudio: false,
      width: 1280,
      height: 720,
      frameRate: 24,
      recipe: silent,
      outputPath: "/tmp/output.webm",
    });
    expect(args).not.toContain("[outa]");
    expect(args).not.toContain("libopus");
  });

  it("mixes voiceover as a third limited source and cuts it with the source timeline", () => {
    const withVoiceover = recipe();
    withVoiceover.voiceover = {
      enabled: true,
      assetId: "00000000-0000-4000-8000-000000000010",
      generationId: "00000000-0000-4000-8000-000000000011",
    };
    withVoiceover.audio.voiceoverGain = 0.8;
    const args = buildFfmpegArguments({
      basePath: "/tmp/base.webm",
      microphonePath: "/tmp/microphone.webm",
      voiceoverPath: "/tmp/voiceover.wav",
      baseHasAudio: true,
      width: 1920,
      height: 1080,
      frameRate: 30,
      recipe: withVoiceover,
      outputPath: "/tmp/output.webm",
    });
    const filters = args[args.indexOf("-filter_complex") + 1];
    expect(filters).toContain("volume=0.800[voicea]");
    expect(filters).toContain(
      "amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95",
    );
    expect(filters).toContain("atrim=start=8.000:end=15.000");
  });

  it("can render voiceover when the original video has no audio", () => {
    const voiceOnly = recipe();
    voiceOnly.voiceover.enabled = true;
    voiceOnly.voiceover.assetId = "00000000-0000-4000-8000-000000000010";
    const args = buildFfmpegArguments({
      basePath: "/tmp/base.webm",
      voiceoverPath: "/tmp/voiceover.wav",
      baseHasAudio: false,
      width: 1280,
      height: 720,
      frameRate: 24,
      recipe: voiceOnly,
      outputPath: "/tmp/output.webm",
    });
    expect(args).toContain("[outa]");
    expect(args).toContain("libopus");
  });
});
