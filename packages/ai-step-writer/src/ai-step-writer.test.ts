// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recordingEventSchema } from "@infosteed/shared";
import {
  deterministicInstruction,
  deterministicOverview,
  generatedStepCandidateSchema,
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

function aiCandidate(
  overrides: Partial<{
    actionType: string;
    elementName: string | null;
    elementRole: string | null;
    title: string;
    instruction: string;
    altText: string;
  }> = {},
) {
  return {
    actionType: clickEvent.actionType,
    elementName: clickEvent.elementName,
    elementRole: clickEvent.elementRole,
    title: "Click Login",
    instruction: "Click **Login**.",
    altText: "Login control",
    ...overrides,
  };
}

describe("AI step writer", () => {
  it("creates deterministic click instructions", () => {
    expect(deterministicInstruction(clickEvent).instruction).toBe(
      "Click **Login**.",
    );
  });

  it("localizes deterministic generated content", () => {
    expect(deterministicInstruction(clickEvent, "ga").instruction).toBe(
      "Cliceáil **Login**.",
    );
    expect(deterministicInstruction(clickEvent, "fr").instruction).toBe(
      "Cliquez sur **Login**.",
    );
    expect(deterministicInstruction(clickEvent, "de").instruction).toBe(
      "Klicken Sie auf **Login**.",
    );
    expect(
      deterministicOverview({
        outputLocale: "fr",
        currentTitle: "",
        items: [{ kind: "step", title: "Login", body: "Login" }],
        events: [],
      }),
    ).toEqual({
      title: "Guide du flux de travail",
      overview:
        "Suivez ce guide 1 pour terminer le flux de travail enregistré.",
    });
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
          return generatedStepCandidateSchema.parse({
            actionType: clickEvent.actionType,
            elementName: clickEvent.elementName,
            elementRole: clickEvent.elementRole,
            title: "",
            instruction: "",
            altText: "",
          });
        },
      },
      { current: clickEvent, outputLocale: "en" },
    );

    expect(generated.source).toBe("deterministic");
    expect(generated.instruction).toBe("Click **Login**.");
  });

  it("clamps long provider fields instead of falling back", async () => {
    const generated = await writeStep(
      {
        async generateStep() {
          return aiCandidate({
            altText: "Login button ".repeat(30),
          });
        },
      },
      { current: clickEvent, outputLocale: "en" },
    );

    expect(generated.source).toBe("ai");
    expect(generated.altText.length).toBeLessThanOrEqual(160);
    expect(generated.altText.endsWith("...")).toBe(true);
  });

  it("keeps semantic-control instructions deterministic while retaining safe AI context", async () => {
    const generated = await writeStep(
      {
        async generateStep() {
          return aiCandidate({
            title: "Use Login",
            instruction: "Click Login.",
            altText: "Login on the sign-in screen",
          });
        },
      },
      { current: clickEvent, outputLocale: "en" },
    );

    expect(generated).toEqual({
      title: "Use Login",
      instruction: "Click **Login**.",
      altText: "Login on the sign-in screen",
      source: "ai",
    });
  });

  it.each([
    ["action type", { actionType: "navigation" }],
    ["element name", { elementName: "Register" }],
    ["element role", { elementRole: "link" }],
    ["different target", { instruction: "Click Register." }],
    ["trailing outcome", { instruction: "Click Login to sign in." }],
    ["extra sentence", { instruction: "Click Login. Continue." }],
  ])("rejects AI output that changes the %s", async (_label, override) => {
    const generated = await writeStep(
      {
        async generateStep() {
          return aiCandidate(override);
        },
      },
      { current: clickEvent, outputLocale: "en" },
    );

    expect(generated.source).toBe("deterministic");
    expect(generated.instruction).toBe("Click **Login**.");
  });

  it("accepts a validated direct instruction for a non-semantic target", async () => {
    const genericEvent = {
      ...clickEvent,
      elementName: "ACCOUNT",
      elementRole: "p",
    };
    const generated = await writeStep(
      {
        async generateStep() {
          return aiCandidate({
            elementName: "ACCOUNT",
            elementRole: "p",
            title: "Choose ACCOUNT",
            instruction: "Click ACCOUNT.",
            altText: "ACCOUNT heading",
          });
        },
      },
      { current: genericEvent, outputLocale: "en" },
    );

    expect(generated).toMatchObject({
      instruction: "Click ACCOUNT.",
      source: "ai",
    });
  });

  it("replays the captured 24-event fidelity regression without changing targets", async () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/action-fidelity-recording.json", import.meta.url),
        "utf8",
      ),
    ) as {
      events: unknown[];
      items: Array<{
        eventId: string;
        title: string;
        body: string;
        altText: string;
      }>;
    };
    const events = fixture.events.map((event) =>
      recordingEventSchema.parse(event),
    );
    const itemsByEvent = new Map(
      fixture.items.map((item) => [item.eventId, item]),
    );

    expect(events).toHaveLength(24);
    expect(
      events.every((event) => event.sanitizedUrl === "https://example.test/"),
    ).toBe(true);

    const results = [];
    for (const [index, current] of events.entries()) {
      const captured = itemsByEvent.get(current.id ?? "");
      expect(captured).toBeDefined();
      const generated = await writeStep(
        {
          async generateStep() {
            return {
              actionType: current.actionType,
              elementName: current.elementName ?? null,
              elementRole: current.elementRole ?? null,
              title: captured!.title,
              instruction: captured!.body,
              altText: captured!.altText,
            };
          },
        },
        {
          current,
          previous: events[index - 1],
          next: events[index + 1],
          outputLocale: "en",
        },
      );
      expect(generated.instruction).toContain(`**${current.elementName}**`);
      results.push(generated);
    }

    for (const ordinal of [0, 4, 5, 6, 21, 22]) {
      expect(results[ordinal].source).toBe("deterministic");
      expect(results[ordinal].instruction).toBe(
        deterministicInstruction(events[ordinal]).instruction,
      );
    }
  });

  it("uses nearby transcript context for chapter generation with deterministic fallback", async () => {
    let contextSeen = "";
    const generated = await writeChapter(
      {
        async generateStep() {
          return aiCandidate();
        },
        async generateChapter(context) {
          contextSeen = context.transcriptAfter ?? "";
          return { title: "Sign in to the workspace" };
        },
      },
      {
        outputLocale: "en",
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
          outputLocale: "en",
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
      expect(String(init?.body)).toContain("Irish (Gaeilge)");
      expect(String(init?.body)).toContain("AUTHORITATIVE_ACTION");
      expect(String(init?.body)).toContain('\\"elementName\\":\\"Login\\"');
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
                        actionType: "click",
                        elementName: "Login",
                        elementRole: "button",
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
        outputLocale: "ga",
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
    let requestedBody = "";
    globalThis.fetch = (async (_url, init) => {
      requestedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          response: "",
          thinking: JSON.stringify({
            actionType: "click",
            elementName: "Login",
            elementRole: "button",
            title: "Open Login",
            instruction: "Click Login.",
            altText: "Login control",
          }),
          done_reason: "stop",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const provider = new OllamaNativeStepWriter({
        endpoint: "http://127.0.0.1:11434",
        model: "qwen3-vl:8b",
        timeoutMs: 1000,
      });
      const generated = await provider.generateStep({
        outputLocale: "de",
        current: clickEvent,
        screenshotDataUrl: "data:image/png;base64,abc",
      });

      expect(generated.title).toBe("Open Login");
      expect(requestedBody).toContain("German (Deutsch)");
      expect(requestedBody).toContain("AUTHORITATIVE_ACTION");
      expect(requestedBody).toContain('\\"elementRole\\":\\"button\\"');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
