// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { readConfig } from "./config";
import { rewriteNarrationScript } from "./narrationScript";

describe("local caption-to-script rewriting", () => {
  it("preserves cue ids and timing while accepting rewritten narration", async () => {
    let requestedUrl = "";
    let requestedBody = "";
    const fetcher = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        requestedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                cues: [{ id: "cue-1", text: "Choose Reports to continue." }],
              }),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const source = [
      {
        id: "cue-1",
        sourceStartMs: 1_000,
        sourceEndMs: 3_500,
        text: "reports",
      },
    ];
    const result = await rewriteNarrationScript(
      readConfig({
        AI_PROVIDER: "ollama",
        AI_ENDPOINT: "http://127.0.0.1:11434",
        AI_MODEL: "qwen2.5:7b",
      }),
      { cues: source, style: "instructional" },
      fetcher as typeof fetch,
    );
    expect(result).toEqual([
      { ...source[0], text: "Choose Reports to continue." },
    ]);
    expect(requestedUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(requestedBody)).toMatchObject({ think: false });
  });

  it("rejects a model response that drops cues", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { content: '{"cues":[]}' } }), {
          status: 200,
        }),
    );
    await expect(
      rewriteNarrationScript(
        readConfig({
          AI_PROVIDER: "ollama",
          AI_ENDPOINT: "http://127.0.0.1:11434",
          AI_MODEL: "local",
        }),
        {
          cues: [
            {
              id: "cue-1",
              sourceStartMs: 0,
              sourceEndMs: 1_000,
              text: "Hello",
            },
          ],
          style: "natural",
        },
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("cue structure");
  });

  it("returns a useful gateway timeout for a slow local model", async () => {
    const fetcher = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );

    await expect(
      rewriteNarrationScript(
        readConfig({
          AI_PROVIDER: "ollama",
          AI_ENDPOINT: "http://127.0.0.1:11434",
          AI_MODEL: "local",
          AI_SCRIPT_TIMEOUT_MS: "5",
        }),
        {
          cues: [
            {
              id: "cue-1",
              sourceStartMs: 0,
              sourceEndMs: 1_000,
              text: "Hello",
            },
          ],
          style: "natural",
        },
        fetcher as typeof fetch,
      ),
    ).rejects.toMatchObject({
      statusCode: 504,
      message: expect.stringContaining("AI_SCRIPT_TIMEOUT_MS"),
    });
  });
});
