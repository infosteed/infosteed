// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { readConfig } from "./config";
import { createTtsProvider } from "./ttsProvider";

describe("OpenAI-compatible TTS provider", () => {
  it("sends the configured model, stock voice, speed, and WAV format", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedInit = init;
        return new Response(new Uint8Array([82, 73, 70, 70]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      },
    );
    const provider = createTtsProvider(
      readConfig({
        TTS_BASE_URL: "http://127.0.0.1:8880/v1",
        TTS_API_KEY: "local-key",
        TTS_MODEL: "kokoro",
        TTS_VOICES: "af_heart,am_adam",
      }),
      fetcher as typeof fetch,
    )!;
    const audio = await provider.synthesize({
      text: "Hello",
      voice: "af_heart",
      speed: 1.25,
    });
    expect(audio.byteLength).toBe(4);
    expect(requestedUrl).toBe("http://127.0.0.1:8880/v1/audio/speech");
    expect(JSON.parse(String(requestedInit?.body))).toMatchObject({
      model: "kokoro",
      voice: "af_heart",
      speed: 1.25,
      response_format: "wav",
    });
    expect(
      (requestedInit?.headers as Record<string, string>).authorization,
    ).toBe("Bearer local-key");
  });

  it("rejects voices outside the configured stock list", async () => {
    const provider = createTtsProvider(
      readConfig({
        TTS_BASE_URL: "http://127.0.0.1:8880/v1",
        TTS_VOICES: "af_heart",
      }),
    )!;
    await expect(
      provider.synthesize({ text: "Hello", voice: "custom-clone", speed: 1 }),
    ).rejects.toThrow("not installed");
  });
});
