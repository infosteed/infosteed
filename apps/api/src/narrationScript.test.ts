// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { readConfig } from "./config";
import { rewriteNarrationScript } from "./narrationScript";

const source = [
  {
    id: "cue-1",
    sourceStartMs: 1_000,
    sourceEndMs: 5_000,
    text: "So first you can go to reports and then the option to",
  },
  {
    id: "cue-2",
    sourceStartMs: 5_000,
    sourceEndMs: 9_000,
    text: "click the summary button and then you can see the report",
  },
];

const validOutput = {
  cues: [
    { id: "cue-1", text: "Open Reports to begin." },
    { id: "cue-2", text: "Choose Summary to view the report." },
  ],
};

function config(provider: "ollama" | "openai-compatible" = "ollama") {
  return readConfig({
    AI_PROVIDER: provider,
    AI_ENDPOINT: "http://127.0.0.1:11434",
    AI_MODEL: "qwen3-vl:8b-instruct",
  });
}

function responseFor(value: unknown, thinking?: string): Response {
  return new Response(
    JSON.stringify({
      message: {
        content: value === undefined ? "" : JSON.stringify(value),
        thinking,
      },
      choices: [{ message: { content: JSON.stringify(value) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("local caption-to-script rewriting", () => {
  it.each([
    [0.75, 11],
    [1, 15],
    [1.5, 23],
  ])(
    "uses native Ollama JSON with speed %sx and a %s-word timing-neighborhood limit",
    async (speed, maxWords) => {
      let requestedUrl = "";
      let requestedBody = "";
      const fetcher = vi.fn(
        async (url: string | URL | Request, init?: RequestInit) => {
          requestedUrl = String(url);
          requestedBody = String(init?.body ?? "");
          return responseFor(validOutput);
        },
      );

      const result = await rewriteNarrationScript(
        config(),
        { outputLocale: "ga", cues: source, style: "instructional", speed },
        fetcher as typeof fetch,
      );

      expect(result).toEqual([
        { ...source[0], text: validOutput.cues[0].text },
        { ...source[1], text: validOutput.cues[1].text },
      ]);
      expect(requestedUrl).toBe("http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(requestedBody);
      expect(body).toMatchObject({
        model: "qwen3-vl:8b-instruct",
        stream: false,
        format: "json",
        options: { temperature: 0.1 },
      });
      expect(body).not.toHaveProperty("think");
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].content).toContain("Irish (Gaeilge)");
      expect(body.messages[1].content).toContain(`\"maxWords\":${maxWords}`);
      expect(body.messages[1].content).not.toContain("/no_think");
    },
  );

  it.each(["natural", "concise", "instructional"] as const)(
    "includes %s style guidance",
    async (style) => {
      let requestedBody = "";
      const fetcher = vi.fn(async (_url, init?: RequestInit) => {
        requestedBody = String(init?.body ?? "");
        return responseFor(validOutput);
      });
      await rewriteNarrationScript(
        config(),
        { outputLocale: "en", cues: source, style },
        fetcher as typeof fetch,
      );
      expect(JSON.parse(requestedBody).messages[1].content).toContain(
        `Style: ${style}.`,
      );
    },
  );

  it("retries a copied response with corrective feedback", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        responseFor({
          cues: source.map((cue) => ({ id: cue.id, text: cue.text })),
        }),
      )
      .mockResolvedValueOnce(responseFor(validOutput));

    await expect(
      rewriteNarrationScript(
        config(),
        { outputLocale: "en", cues: source, style: "natural", speed: 1 },
        fetcher as typeof fetch,
      ),
    ).resolves.toEqual([
      { ...source[0], text: validOutput.cues[0].text },
      { ...source[1], text: validOutput.cues[1].text },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    expect(retryBody.messages[1].content).toContain(
      "Rewrite the captions substantially instead of copying them.",
    );
  });

  it("allows a cue to borrow timing from a sparse adjacent cue", async () => {
    const shortTimedSource = [
      {
        id: "caption-1",
        sourceStartMs: 10_000,
        sourceEndMs: 12_400,
        text: "Open the settings",
      },
      {
        id: "caption-2",
        sourceStartMs: 12_400,
        sourceEndMs: 13_600,
        text: "save",
      },
    ];
    const output = {
      cues: [
        {
          id: "caption-1",
          text: "Open the customer account settings panel now",
        },
        { id: "caption-2", text: "Save." },
      ],
    };
    const fetcher = vi.fn(async () => responseFor(output));

    await expect(
      rewriteNarrationScript(
        config(),
        {
          outputLocale: "en",
          cues: shortTimedSource,
          style: "natural",
          speed: 1,
        },
        fetcher as typeof fetch,
      ),
    ).resolves.toEqual([
      { ...shortTimedSource[0], text: output.cues[0].text },
      { ...shortTimedSource[1], text: output.cues[1].text },
    ]);
  });

  it("rejects adjacent cues that exceed their combined timing slot", async () => {
    const shortTimedSource = [
      {
        id: "caption-1",
        sourceStartMs: 10_000,
        sourceEndMs: 12_400,
        text: "Open the settings",
      },
      {
        id: "caption-2",
        sourceStartMs: 12_400,
        sourceEndMs: 13_600,
        text: "save",
      },
    ];
    const output = {
      cues: [
        {
          id: "caption-1",
          text: "Open the customer account settings panel now please",
        },
        { id: "caption-2", text: "Save every visible change." },
      ],
    };
    const fetcher = vi.fn(async () => responseFor(output));

    await expect(
      rewriteNarrationScript(
        config(),
        {
          outputLocale: "en",
          cues: shortTimedSource,
          style: "natural",
          speed: 1,
        },
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("combined time slot");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "punctuation-only text",
      { cues: [{ id: "cue-1", text: "..." }, validOutput.cues[1]] },
    ],
    ["missing cue", { cues: [validOutput.cues[0]] }],
    [
      "duplicate and reordered ids",
      {
        cues: [
          { id: "cue-2", text: "Open Reports." },
          { id: "cue-2", text: "View Summary." },
        ],
      },
    ],
    [
      "over-limit cue",
      {
        cues: [
          {
            id: "cue-1",
            text: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
          },
          validOutput.cues[1],
        ],
      },
    ],
  ])("rejects %s after one corrective retry", async (_label, output) => {
    const fetcher = vi.fn(async () => responseFor(output));
    await expect(
      rewriteNarrationScript(
        config(),
        { outputLocale: "en", cues: source, style: "natural", speed: 1 },
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("after two attempts");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never parses model thinking as narration", async () => {
    const fetcher = vi.fn(async () =>
      responseFor(
        undefined,
        '<think>{"cues":[{"id":"...","text":"..."}]}</think>',
      ),
    );
    await expect(
      rewriteNarrationScript(
        config(),
        { outputLocale: "en", cues: source, style: "natural", speed: 1 },
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("non-thinking instruct model");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries malformed narration JSON and then returns an actionable error", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { content: '{"cues":[' } }), {
          status: 200,
        }),
    );
    await expect(
      rewriteNarrationScript(
        config(),
        { outputLocale: "en", cues: source, style: "natural", speed: 1 },
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("malformed narration JSON");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses the same prompt and validation with OpenAI-compatible providers", async () => {
    let requestedUrl = "";
    let requestedBody = "";
    const fetcher = vi.fn(async (url, init?: RequestInit) => {
      requestedUrl = String(url);
      requestedBody = String(init?.body ?? "");
      return responseFor(validOutput);
    });
    await rewriteNarrationScript(
      config("openai-compatible"),
      { outputLocale: "en", cues: source, style: "natural", speed: 1 },
      fetcher as typeof fetch,
    );
    expect(requestedUrl).toBe("http://127.0.0.1:11434/chat/completions");
    expect(JSON.parse(requestedBody)).toMatchObject({
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
  });

  it("returns a useful gateway timeout for a slow local model without retrying", async () => {
    const fetcher = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            {
              once: true,
            },
          );
        }),
    );

    await expect(
      rewriteNarrationScript(
        readConfig({
          AI_PROVIDER: "ollama",
          AI_ENDPOINT: "http://127.0.0.1:11434",
          AI_MODEL: "qwen3-vl:8b-instruct",
          AI_SCRIPT_TIMEOUT_MS: "5",
        }),
        { outputLocale: "en", cues: source, style: "natural", speed: 1 },
        fetcher as typeof fetch,
      ),
    ).rejects.toMatchObject({
      statusCode: 504,
      message: expect.stringContaining("AI_SCRIPT_TIMEOUT_MS"),
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
