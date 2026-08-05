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
      { outputLocale: "ga", cues: source, style: "instructional" },
      fetcher as typeof fetch,
    );
    expect(result).toEqual([
      { ...source[0], text: "Choose Reports to continue." },
    ]);
    expect(requestedUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(requestedBody)).toMatchObject({ think: false });
    expect(requestedBody).toContain("Irish (Gaeilge)");
  });

  it("flows a restructured model response across the original timed cues", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                cues: [
                  {
                    id: "merged-cue",
                    text: "Open the reports page, then choose this month's summary.",
                  },
                ],
              }),
            },
          }),
          { status: 200 },
        ),
    );
    const result = await rewriteNarrationScript(
      readConfig({
        AI_PROVIDER: "ollama",
        AI_ENDPOINT: "http://127.0.0.1:11434",
        AI_MODEL: "local",
      }),
      {
        outputLocale: "en",
        cues: [
          {
            id: "cue-1",
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            text: "reports",
          },
          {
            id: "cue-2",
            sourceStartMs: 1_000,
            sourceEndMs: 3_000,
            text: "summary",
          },
        ],
        style: "natural",
      },
      fetcher as typeof fetch,
    );

    expect(result).toEqual([
      {
        id: "cue-1",
        sourceStartMs: 0,
        sourceEndMs: 1_000,
        text: "Open the reports",
      },
      {
        id: "cue-2",
        sourceStartMs: 1_000,
        sourceEndMs: 3_000,
        text: "page, then choose this month's summary.",
      },
    ]);
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
          outputLocale: "en",
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
