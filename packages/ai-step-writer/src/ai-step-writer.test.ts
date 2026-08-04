// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  deterministicInstruction,
  generatedStepSchema,
  OllamaNativeStepWriter,
  OpenAiCompatibleStepWriter,
  writeChapter,
  writeStep,
} from "./index";

const clickEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  ordinal: 0,
  actionType: "click" as const,
  pageTitle: "App",
  sanitizedUrl: "https://example.com/app",
  elementName: "Login",
  elementRole: "button",
  metadata: {},
};

describe("AI step writer", () => {
  it("creates deterministic click instructions", () => {
    expect(deterministicInstruction(clickEvent).instruction).toBe(
      "Click **Login**.",
    );
  });

  it("uses human fallback names for generic captured targets", () => {
    expect(
      deterministicInstruction({
        ...clickEvent,
        elementName: undefined,
        elementRole: "canvas",
      }).instruction,
    ).toBe("Click **the map**.");

    expect(
      deterministicInstruction({
        ...clickEvent,
        elementName: undefined,
        elementRole: "i",
      }).instruction,
    ).toBe("Click **the highlighted area**.");
  });

  it("describes the highlighted position of canvas clicks", () => {
    expect(
      deterministicInstruction({
        ...clickEvent,
        elementName: undefined,
        elementRole: "canvas",
        metadata: {
          canvasPosition: {
            xRatio: 0.8,
            yRatio: 0.2,
            region: "upper-right area",
          },
        },
      }),
    ).toEqual({
      title: "Click the highlighted map point",
      instruction:
        "Click the highlighted point in the **upper-right area of the map**.",
      altText: "Highlighted point in the upper-right area of the map",
    });
  });

  it("falls back when provider output fails schema validation", async () => {
    const generated = await writeStep(
      {
        async generateStep() {
          return generatedStepSchema.parse({
            title: "",
            instruction: "",
            altText: "",
          });
        },
      },
      { current: clickEvent },
    );

    expect(generated.source).toBe("deterministic");
    expect(generated.instruction).toBe("Click **Login**.");
  });

  it("clamps long provider fields instead of falling back", async () => {
    const generated = await writeStep(
      {
        async generateStep() {
          return {
            title: "Click Login",
            instruction: "Click **Login**.",
            altText: "Login button ".repeat(30),
          };
        },
      },
      { current: clickEvent },
    );

    expect(generated.source).toBe("ai");
    expect(generated.altText.length).toBeLessThanOrEqual(160);
    expect(generated.altText.endsWith("...")).toBe(true);
  });

  it("uses nearby transcript context for chapter generation with deterministic fallback", async () => {
    let contextSeen = "";
    const generated = await writeChapter(
      {
        async generateStep() {
          return deterministicInstruction(clickEvent);
        },
        async generateChapter(context) {
          contextSeen = context.transcriptAfter ?? "";
          return { title: "Sign in to the workspace" };
        },
      },
      {
        recordingTitle: "Account setup",
        current: clickEvent,
        transcriptAfter: "Now sign in to the workspace",
      },
    );
    expect(generated).toMatchObject({
      title: "Sign in to the workspace",
      source: "ai",
    });
    expect(contextSeen).toContain("sign in");
    expect(
      (
        await writeChapter(undefined, {
          recordingTitle: "Account setup",
          current: clickEvent,
        })
      ).title,
    ).toBe("Click Login");
  });

  it("retries without screenshots when an image request returns only reasoning", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async (_url, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body));
      const hasImage = Array.isArray(body.messages[1].content);
      return new Response(
        JSON.stringify(
          hasImage
            ? {
                choices: [
                  {
                    finish_reason: "length",
                    message: {
                      content: "",
                      reasoning: "Got it, let's break this down.",
                    },
                  },
                ],
              }
            : {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        title: "Click Login",
                        instruction: "Click **Login**.",
                        altText: "Login button",
                      }),
                    },
                  },
                ],
              },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const provider = new OpenAiCompatibleStepWriter({
        endpoint: "http://example.test/v1",
        model: "qwen3-vl:8b",
        timeoutMs: 1000,
      });
      const generated = await provider.generateStep({
        current: clickEvent,
        screenshotDataUrl: "data:image/png;base64,abc",
      });

      expect(calls).toBe(2);
      expect(generated.title).toBe("Click Login");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses native Ollama thinking when vision response is empty", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          response: "",
          thinking: JSON.stringify({
            title: "Sligo Business Data",
            instruction: "View business locations in Sligo using map layers.",
            altText: "Sligo business data map",
          }),
          done_reason: "stop",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    try {
      const provider = new OllamaNativeStepWriter({
        endpoint: "http://127.0.0.1:11434",
        model: "qwen3-vl:8b",
        timeoutMs: 1000,
      });
      const generated = await provider.generateStep({
        current: clickEvent,
        screenshotDataUrl: "data:image/png;base64,abc",
      });

      expect(generated.title).toBe("Sligo Business Data");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
