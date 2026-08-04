// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { RecordingEvent } from "@infosteed/shared";

export const generatedStepSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(500),
  altText: z.string().trim().min(1).max(160),
});

export const generatedOverviewSchema = z.object({
  title: z.string().trim().min(1).max(160),
  overview: z.string().trim().min(1).max(500),
});

export const generatedChapterSchema = z.object({
  title: z.string().trim().min(1).max(120),
});

const generatedStepInputSchema = z.object({
  title: z.string().trim().min(1),
  instruction: z.string().trim().min(1),
  altText: z.string().trim().min(1),
});

export type GeneratedStep = z.infer<typeof generatedStepSchema>;
export type GeneratedOverview = z.infer<typeof generatedOverviewSchema>;
export type GeneratedChapter = z.infer<typeof generatedChapterSchema>;

export interface StepWritingContext {
  workflowPurpose?: string | null;
  audience?: string | null;
  current: RecordingEvent;
  previous?: RecordingEvent;
  next?: RecordingEvent;
  screenshotBase64?: string;
  screenshotDataUrl?: string;
  transcriptBefore?: string;
  transcriptAfter?: string;
}

export interface ChapterWritingContext {
  recordingTitle: string;
  workflowPurpose?: string | null;
  audience?: string | null;
  current: RecordingEvent;
  previous?: RecordingEvent;
  next?: RecordingEvent;
  transcriptBefore?: string;
  transcriptAfter?: string;
}

export interface AiStepWriterProvider {
  generateStep(context: StepWritingContext): Promise<GeneratedStep>;
  generateOverview?(context: GuideOverviewContext): Promise<GeneratedOverview>;
  generateChapter?(context: ChapterWritingContext): Promise<GeneratedChapter>;
}

export interface GuideOverviewContext {
  currentTitle: string;
  purpose?: string | null;
  audience?: string | null;
  items: Array<{
    kind: "step" | "tip" | "alert" | "header";
    title: string;
    body: string;
  }>;
  events: Array<{
    actionType: string;
    pageTitle: string;
    elementName?: string;
    elementRole?: string;
    nearbyHeading?: string;
  }>;
}

function bold(value: string): string {
  return `**${value.replace(/\*/g, "\\*")}**`;
}

function targetName(event: RecordingEvent): string {
  const raw = event.elementName || event.labelText;
  if (raw) return raw;
  if (event.elementRole === "canvas") return "the map";
  if (event.elementRole === "field") return "the highlighted field";
  if (
    event.elementRole &&
    !/^(div|span|i|svg|path|element)$/i.test(event.elementRole)
  ) {
    return `the highlighted ${event.elementRole}`;
  }
  return "the highlighted area";
}

function canvasRegion(event: RecordingEvent): string | undefined {
  const position = event.metadata.canvasPosition;
  if (!position || typeof position !== "object") return undefined;
  const region = (position as { region?: unknown }).region;
  return typeof region === "string" && region.length <= 40 ? region : undefined;
}

function clampText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 3).trimEnd() + "...";
}

function normalizeGeneratedStep(value: unknown): GeneratedStep {
  const parsed = generatedStepInputSchema.parse(value);
  return {
    title: clampText(parsed.title, 120),
    instruction: clampText(parsed.instruction, 500),
    altText: clampText(parsed.altText, 160),
  };
}

function normalizeGeneratedOverview(value: unknown): GeneratedOverview {
  const parsed = generatedOverviewSchema.parse(value);
  return {
    title: clampText(parsed.title, 160),
    overview: clampText(parsed.overview, 500),
  };
}

function normalizeGeneratedChapter(value: unknown): GeneratedChapter {
  const parsed = generatedChapterSchema.parse(value);
  return { title: clampText(parsed.title, 120) };
}

function parseGeneratedOverview(value: string): GeneratedOverview {
  const trimmed = value.trim();
  try {
    return normalizeGeneratedOverview(JSON.parse(trimmed));
  } catch {
    // Fall through to extracting a JSON object from provider wrapper text.
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objectMatch)
    throw new Error("AI provider response did not contain a JSON object");
  return normalizeGeneratedOverview(JSON.parse(objectMatch[0]));
}

function parseGeneratedChapter(value: string): GeneratedChapter {
  const trimmed = value.trim();
  try {
    return normalizeGeneratedChapter(JSON.parse(trimmed));
  } catch {
    // Fall through to extracting a JSON object from provider wrapper text.
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objectMatch)
    throw new Error("AI provider response did not contain a JSON object");
  return normalizeGeneratedChapter(JSON.parse(objectMatch[0]));
}

export function deterministicOverview(
  context: GuideOverviewContext,
): GeneratedOverview {
  const stepCount = context.items.filter((item) => item.kind === "step").length;
  const sections = context.items
    .filter((item) => item.kind === "header")
    .map((item) => item.title);
  const title =
    context.currentTitle.replace(/^Record\s+/i, "").trim() || "Workflow guide";
  const sectionText =
    sections.length > 0 ? ` across ${sections.slice(0, 3).join(", ")}` : "";
  return {
    title,
    overview: `Follow this ${stepCount || "step-by-step"} guide${sectionText} to complete the recorded workflow.`,
  };
}

export async function writeGuideOverview(
  provider: AiStepWriterProvider | undefined,
  context: GuideOverviewContext,
): Promise<GeneratedOverview & { source: "ai" | "deterministic" }> {
  if (!provider?.generateOverview)
    return { ...deterministicOverview(context), source: "deterministic" };

  try {
    const generated = normalizeGeneratedOverview(
      await provider.generateOverview(context),
    );
    return { ...generated, source: "ai" };
  } catch (error) {
    console.warn(
      "InfoSteed AI overview generation failed; using deterministic fallback.",
      error instanceof Error ? error.message : error,
    );
    return { ...deterministicOverview(context), source: "deterministic" };
  }
}

export function deterministicInstruction(event: RecordingEvent): GeneratedStep {
  const target = targetName(event);

  if (event.actionType === "click" && event.elementRole === "canvas") {
    const region = canvasRegion(event);
    if (region) {
      return {
        title: "Click the highlighted map point",
        instruction: `Click the highlighted point in the ${bold(`${region} of the map`)}.`,
        altText: `Highlighted point in the ${region} of the map`,
      };
    }
  }

  if (event.actionType === "input") {
    const label = event.labelText || event.elementName || "the field";
    return {
      title: `Enter ${label}`,
      instruction: `Enter the required value in the ${bold(label)} field.`,
      altText: `${label} field`,
    };
  }

  if (event.actionType === "select") {
    const safeValue =
      typeof event.metadata.selectedValue === "string"
        ? event.metadata.selectedValue
        : "the required option";
    const label = event.labelText || event.elementName || "the list";
    return {
      title: `Select ${label}`,
      instruction: `Select ${bold(safeValue)} from the ${bold(label)} list.`,
      altText: `${label} list`,
    };
  }

  if (event.actionType === "checkbox" || event.actionType === "radio") {
    return {
      title: `Choose ${target}`,
      instruction: `Choose ${bold(target)}.`,
      altText: `${target} option`,
    };
  }

  if (event.actionType === "navigation") {
    return {
      title: `Open ${event.pageTitle}`,
      instruction: `Open ${bold(event.pageTitle)}.`,
      altText: event.pageTitle,
    };
  }

  if (event.actionType === "submit") {
    return {
      title: `Submit ${target}`,
      instruction: `Submit the form using ${bold(target)}.`,
      altText: `${target} submit control`,
    };
  }

  return {
    title: `Click ${target}`,
    instruction: `Click ${bold(target)}.`,
    altText: `${target} on ${event.pageTitle}`,
  };
}

export async function writeStep(
  provider: AiStepWriterProvider | undefined,
  context: StepWritingContext,
): Promise<GeneratedStep & { source: "ai" | "deterministic" }> {
  if (!provider) {
    return {
      ...deterministicInstruction(context.current),
      source: "deterministic",
    };
  }

  try {
    const generated = normalizeGeneratedStep(
      await provider.generateStep(context),
    );
    return { ...generated, source: "ai" };
  } catch (error) {
    console.warn(
      "InfoSteed AI step generation failed; using deterministic fallback.",
      error instanceof Error ? error.message : error,
    );
    return {
      ...deterministicInstruction(context.current),
      source: "deterministic",
    };
  }
}

export async function writeChapter(
  provider: AiStepWriterProvider | undefined,
  context: ChapterWritingContext,
): Promise<GeneratedChapter & { source: "ai" | "deterministic" }> {
  const fallback = {
    title: deterministicInstruction(context.current).title,
    source: "deterministic" as const,
  };
  if (!provider?.generateChapter) return fallback;

  try {
    return {
      ...normalizeGeneratedChapter(await provider.generateChapter(context)),
      source: "ai",
    };
  } catch (error) {
    console.warn(
      "InfoSteed AI chapter generation failed; using deterministic fallback.",
      error instanceof Error ? error.message : error,
    );
    return fallback;
  }
}

export interface OpenAiCompatibleProviderOptions {
  endpoint: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

function parseGeneratedStep(value: string): GeneratedStep {
  const trimmed = value.trim();
  try {
    return normalizeGeneratedStep(JSON.parse(trimmed));
  } catch {
    // Fall through to extracting a JSON object from provider wrapper text.
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objectMatch)
    throw new Error("AI provider response did not contain a JSON object");
  return normalizeGeneratedStep(JSON.parse(objectMatch[0]));
}

export class OpenAiCompatibleStepWriter implements AiStepWriterProvider {
  constructor(private readonly options: OpenAiCompatibleProviderOptions) {}

  async generateOverview(
    context: GuideOverviewContext,
  ): Promise<GeneratedOverview> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );
    const jsonContract =
      'Return exactly one compact JSON object: {"title":"...","overview":"..."}. No markdown outside JSON.';

    const response = await fetch(
      this.options.endpoint.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.1,
          max_tokens: 512,
          think: false,
          options: {
            think: false,
            num_predict: 512,
          },
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "/no_think\nWrite Scribe-style guide titles and short overview blurbs. Use normal product language. Do not invent company names. " +
                jsonContract +
                "\n/no_think",
            },
            {
              role: "user",
              content:
                "/no_think\n" +
                JSON.stringify(context) +
                "\nCreate a concise how-to title and a 1-2 sentence overview for the whole recorded workflow.\n" +
                jsonContract +
                "\n/no_think",
            },
          ],
        }),
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok)
      throw new Error(`AI provider failed with ${response.status}`);
    const json = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string; reasoning?: string };
      }>;
    };
    const choice = json.choices?.[0];
    if (choice?.message?.content)
      return parseGeneratedOverview(choice.message.content);
    if (choice?.message?.reasoning)
      return parseGeneratedOverview(choice.message.reasoning);
    throw new Error(
      `AI provider returned no overview. finish_reason=${choice?.finish_reason ?? "unknown"}`,
    );
  }

  private async requestStep(
    context: StepWritingContext,
    includeScreenshot: boolean,
  ): Promise<GeneratedStep> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );

    const stepContext = {
      workflowPurpose: context.workflowPurpose,
      audience: context.audience,
      current: context.current,
      previous: context.previous,
      next: context.next,
      transcriptBefore: context.transcriptBefore,
      transcriptAfter: context.transcriptAfter,
      hasScreenshot:
        includeScreenshot &&
        Boolean(context.screenshotDataUrl || context.screenshotBase64),
    };
    const jsonContract =
      'Return exactly one compact JSON object: {"title":"...","instruction":"...","altText":"..."}. No markdown outside JSON. No reasoning.';
    const userText =
      "/no_think\n" +
      JSON.stringify(stepContext) +
      "\nWrite what the user should do, not raw accessibility text. Prefer visible product words, nearby headings, and the screenshot. Ignore page furniture like item counts, pagination, and sort controls unless those were the clicked target.\n" +
      jsonContract +
      "\n/no_think";

    const userContent =
      includeScreenshot && context.screenshotDataUrl
        ? [
            { type: "text", text: userText },
            {
              type: "image_url",
              image_url: { url: context.screenshotDataUrl },
            },
          ]
        : userText;

    const response = await fetch(
      this.options.endpoint.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.1,
          max_tokens: 2048,
          think: false,
          options: {
            think: false,
            num_predict: 2048,
          },
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `/no_think\nWrite concise browser workflow instructions. ${jsonContract} Do not invent actions or outcomes. Avoid mechanical words like div, canvas, field, i, or full page text.\n/no_think`,
            },
            {
              role: "user",
              content: userContent,
            },
          ],
        }),
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok)
      throw new Error(`AI provider failed with ${response.status}`);
    const json = (await response.json()) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string; reasoning?: string };
      }>;
    };
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (content) return parseGeneratedStep(content);

    if (choice?.message?.reasoning) {
      try {
        return parseGeneratedStep(choice.message.reasoning);
      } catch {
        // Reasoning-only responses from thinking models often contain prose without final JSON.
      }
    }

    {
      const reason = choice?.finish_reason
        ? ` finish_reason=${choice.finish_reason}`
        : "";
      const reasoning = choice?.message?.reasoning
        ? ` reasoning=${choice.message.reasoning.slice(0, 160)}`
        : "";
      throw new Error(`AI provider returned no content.${reason}${reasoning}`);
    }
  }

  async generateStep(context: StepWritingContext): Promise<GeneratedStep> {
    try {
      return await this.requestStep(context, true);
    } catch (error) {
      if (!context.screenshotDataUrl) throw error;
      console.warn(
        "InfoSteed AI image step generation failed; retrying without screenshot.",
        error instanceof Error ? error.message : error,
      );
      return this.requestStep(context, false);
    }
  }

  async generateChapter(
    context: ChapterWritingContext,
  ): Promise<GeneratedChapter> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );
    const jsonContract =
      'Return exactly one compact JSON object: {"title":"..."}. No markdown outside JSON.';
    const response = await fetch(
      this.options.endpoint.replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.options.model,
          temperature: 0.1,
          max_tokens: 128,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `Write concise action-oriented video chapter titles. ${jsonContract}`,
            },
            {
              role: "user",
              content:
                JSON.stringify(context) +
                "\nUse the action and nearby narration. Do not invent an outcome.\n" +
                jsonContract,
            },
          ],
        }),
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok)
      throw new Error(`AI provider failed with ${response.status}`);
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned no chapter title");
    return parseGeneratedChapter(content);
  }
}

export class OllamaNativeStepWriter implements AiStepWriterProvider {
  constructor(private readonly options: OpenAiCompatibleProviderOptions) {}

  async generateOverview(
    context: GuideOverviewContext,
  ): Promise<GeneratedOverview> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );

    const response = await fetch(
      this.options.endpoint.replace(/\/$/, "") + "/api/generate",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          prompt:
            "/no_think\nReturn ONLY JSON with keys title and overview for this whole browser workflow. " +
            "The overview must be 1-2 concise sentences.\n" +
            JSON.stringify(context) +
            "\n/no_think",
          stream: false,
          format: "json",
          think: false,
          options: {
            num_predict: 512,
            temperature: 0,
          },
        }),
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok)
      throw new Error(`Ollama provider failed with ${response.status}`);
    const json = (await response.json()) as {
      response?: string;
      thinking?: string;
      done_reason?: string;
    };
    if (json.response) return parseGeneratedOverview(json.response);
    if (json.thinking) return parseGeneratedOverview(json.thinking);
    throw new Error(
      `Ollama provider returned no overview. done_reason=${json.done_reason ?? "unknown"}`,
    );
  }

  async generateStep(context: StepWritingContext): Promise<GeneratedStep> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );
    const imageBase64 = context.screenshotDataUrl?.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      "",
    );
    const prompt =
      "Return ONLY JSON with keys title, instruction, altText for this browser workflow step.\n" +
      "Do not include prose outside JSON.\n" +
      JSON.stringify({
        workflowPurpose: context.workflowPurpose,
        audience: context.audience,
        current: context.current,
        previous: context.previous,
        next: context.next,
        transcriptBefore: context.transcriptBefore,
        transcriptAfter: context.transcriptAfter,
        hasScreenshot: Boolean(imageBase64),
      });

    const response = await fetch(
      this.options.endpoint.replace(/\/$/, "") + "/api/generate",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          prompt,
          images: imageBase64 ? [imageBase64] : undefined,
          stream: false,
          format: "json",
          think: false,
          options: {
            num_predict: 2048,
            temperature: 0,
          },
        }),
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok)
      throw new Error(`Ollama provider failed with ${response.status}`);
    const json = (await response.json()) as {
      response?: string;
      thinking?: string;
      done_reason?: string;
    };
    if (json.response) return parseGeneratedStep(json.response);
    if (json.thinking) return parseGeneratedStep(json.thinking);
    throw new Error(
      `Ollama provider returned no response. done_reason=${json.done_reason ?? "unknown"}`,
    );
  }

  async generateChapter(
    context: ChapterWritingContext,
  ): Promise<GeneratedChapter> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 30_000,
    );
    const response = await fetch(
      this.options.endpoint.replace(/\/$/, "") + "/api/generate",
      {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          prompt:
            "Return ONLY JSON with one key, title, containing a concise action-oriented video chapter name. " +
            "Use nearby narration but do not invent an outcome.\n" +
            JSON.stringify(context),
          stream: false,
          format: "json",
          think: false,
          options: { num_predict: 128, temperature: 0 },
        }),
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok)
      throw new Error(`Ollama provider failed with ${response.status}`);
    const json = (await response.json()) as {
      response?: string;
      thinking?: string;
    };
    if (json.response) return parseGeneratedChapter(json.response);
    if (json.thinking) return parseGeneratedChapter(json.thinking);
    throw new Error("Ollama provider returned no chapter title");
  }
}
