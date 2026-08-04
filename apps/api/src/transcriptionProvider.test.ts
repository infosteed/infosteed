// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleTranscriptionProvider } from "./transcriptionProvider";

async function bodyText(body: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function input(opened: () => void = () => undefined) {
  return {
    openAudio: async () => {
      opened();
      return (async function* () {
        yield Buffer.from("audio");
      })();
    },
    byteSize: 5,
    filename: "narration.webm",
    contentType: "audio/webm",
    model: "large-v3-turbo",
    prompt: "InfoSteed, Sligo",
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAiCompatibleTranscriptionProvider", () => {
  it("streams the standard multipart contract with optional authentication", async () => {
    let uploaded = "";
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        uploaded = await bodyText(init?.body);
        return new Response(
          JSON.stringify({
            text: " Open the map ",
            language: "en",
            language_probability: 0.98,
            duration: 1.5,
            segments: [{ id: 0, start: 0, end: 1.5, text: " Open the map " }],
            words: [{ word: " Open", start: 0, end: 0.4, probability: 0.9 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleTranscriptionProvider({
      endpoint: "https://speech.example/v1/",
      apiKey: "secret",
      model: "large-v3-turbo",
      timeoutMs: 1_000,
      maxUploadBytes: 100,
    });

    const result = await provider.transcribe(input());

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://speech.example/v1/audio/transcriptions",
    );
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get("authorization"),
    ).toBe("Bearer secret");
    expect(uploaded).toContain('name="response_format"\r\n\r\nverbose_json');
    expect(uploaded).toContain('name="timestamp_granularities[]"\r\n\r\nword');
    expect(uploaded).toContain('name="prompt"\r\n\r\nInfoSteed, Sligo');
    expect(result).toMatchObject({
      text: "Open the map",
      language: "en",
      durationMs: 1500,
    });
    expect(result.words[0]).toMatchObject({
      text: "Open",
      startMs: 0,
      endMs: 400,
      probability: 0.9,
    });
  });

  it("reopens the audio stream and retries without word timestamps", async () => {
    let calls = 0;
    let opens = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        calls += 1;
        const body = await bodyText(init?.body);
        if (calls === 1) {
          expect(body).toContain("word");
          return new Response("word timestamp granularity is unsupported", {
            status: 400,
          });
        }
        expect(body).not.toContain("\r\n\r\nword\r\n");
        return new Response(
          JSON.stringify({
            text: "Bonjour",
            language: "fr",
            duration: 0.8,
            segments: [{ start: 0, end: 0.8, text: "Bonjour" }],
          }),
          { status: 200 },
        );
      }),
    );
    const provider = new OpenAiCompatibleTranscriptionProvider({
      endpoint: "http://localhost:8787/v1",
      model: "large-v3-turbo",
      timeoutMs: 1_000,
      maxUploadBytes: 100,
    });

    const result = await provider.transcribe(
      input(() => {
        opens += 1;
      }),
    );

    expect(opens).toBe(2);
    expect(result.words).toEqual([]);
    expect(result.languageProbability).toBeNull();
  });

  it("normalizes hosted responses with words nested inside segments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await bodyText(init?.body);
        return new Response(
          JSON.stringify({
            text: "Hola",
            language: "es",
            language_confidence: 0.87,
            segments: [
              {
                start: 0,
                end: 1,
                text: "Hola",
                words: [{ text: "Hola", start: 0, end: 1 }],
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );
    const provider = new OpenAiCompatibleTranscriptionProvider({
      endpoint: "https://speech.example/v1",
      model: "hosted-whisper",
      timeoutMs: 1_000,
      maxUploadBytes: 100,
    });
    const result = await provider.transcribe(input());
    expect(result.languageProbability).toBe(0.87);
    expect(result.words).toEqual([
      { startMs: 0, endMs: 1000, text: "Hola", probability: null },
    ]);
  });

  it("rejects oversized audio before contacting the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleTranscriptionProvider({
      endpoint: "http://localhost:8787/v1",
      model: "tiny",
      timeoutMs: 1_000,
      maxUploadBytes: 4,
    });
    await expect(provider.transcribe(input())).rejects.toThrow(
      /provider limit is 4 bytes/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed hosted responses instead of leaking provider shapes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        await bodyText(init?.body);
        return new Response(
          JSON.stringify({ text: "Hello", segments: [{ start: "now" }] }),
          { status: 200 },
        );
      }),
    );
    const provider = new OpenAiCompatibleTranscriptionProvider({
      endpoint: "https://speech.example/v1",
      model: "hosted-whisper",
      timeoutMs: 1_000,
      maxUploadBytes: 100,
    });
    await expect(provider.transcribe(input())).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("aborts provider calls at the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Timed out", "AbortError")),
              { once: true },
            );
          }),
      ),
    );
    const provider = new OpenAiCompatibleTranscriptionProvider({
      endpoint: "https://speech.example/v1",
      model: "hosted-whisper",
      timeoutMs: 5,
      maxUploadBytes: 100,
    });
    await expect(provider.transcribe(input())).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
