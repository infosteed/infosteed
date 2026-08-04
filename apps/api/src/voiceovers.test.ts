// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  requeueStaleVoiceovers,
  voiceoverClipHash,
  voiceoverOverlongByMs,
} from "./repositories/voiceovers";

describe("voiceover caching and retries", () => {
  it("reuses unchanged cue hashes while changing only the edited cue", () => {
    const base = {
      provider: "openai-compatible",
      model: "kokoro",
      voice: "af_heart",
      speed: 1,
    };
    const first = voiceoverClipHash({ ...base, text: "First cue" });
    const same = voiceoverClipHash({ ...base, text: "  First   cue " });
    const edited = voiceoverClipHash({ ...base, text: "Changed cue" });
    expect(same).toBe(first);
    expect(edited).not.toBe(first);
  });

  it("detects generated speech that exceeds the cue without truncating it", () => {
    expect(voiceoverOverlongByMs(2_700, 1_000, 3_000)).toBe(700);
    expect(voiceoverOverlongByMs(1_500, 1_000, 3_000)).toBe(0);
  });

  it("requeues interrupted jobs up to the retry limit", async () => {
    let sql = "";
    const db = {
      query: async (statement: string) => {
        sql = statement;
        return { rowCount: 2, rows: [] };
      },
    };
    expect(await requeueStaleVoiceovers(db as never)).toBe(2);
    expect(sql).toContain("attempts < 3");
    expect(sql).toContain("then 'queued' else 'failed'");
  });
});
