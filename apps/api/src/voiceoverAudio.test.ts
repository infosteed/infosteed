// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { buildVoiceoverTimelineArguments } from "./voiceoverAudio";

describe("voiceover source timeline", () => {
  it("places clips at source timestamps, keeps silence, and uses the longest duration", () => {
    const args = buildVoiceoverTimelineArguments(
      10_000,
      [
        { path: "/tmp/one.wav", sourceStartMs: 500 },
        { path: "/tmp/two.wav", sourceStartMs: 8_000 },
      ],
      "/tmp/out.wav",
    );
    const filters = args[args.indexOf("-filter_complex") + 1];
    expect(filters).toContain("adelay=500|500");
    expect(filters).toContain("adelay=8000|8000");
    expect(filters).toContain("amix=inputs=3:duration=longest");
    expect(args).toContain("anullsrc=r=24000:cl=mono");
    expect(args).not.toContain("-shortest");
  });
});
