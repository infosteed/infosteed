// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  OUTPUT_LOCALE_NAMES,
  type OutputLocale,
  type RecordingEvent,
} from "@infosteed/shared";

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
  outputLocale: OutputLocale;
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
  outputLocale: OutputLocale;
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
  outputLocale: OutputLocale;
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

export function targetLanguageInstruction(locale: OutputLocale): string {
  return `Write all human-readable output in ${OUTPUT_LOCALE_NAMES[locale]}. Preserve literal product names, application labels, and control text from the source context in their original language.`;
}

type DeterministicCopy = {
  map: string;
  highlightedField: string;
  highlightedRole: (role: string) => string;
  highlightedArea: string;
  mapPointTitle: string;
  mapPointInstruction: (region: string) => string;
  mapPointAlt: (region: string) => string;
  enterTitle: (label: string) => string;
  enterInstruction: (label: string) => string;
  fieldAlt: (label: string) => string;
  selectTitle: (label: string) => string;
  selectInstruction: (value: string, label: string) => string;
  listAlt: (label: string) => string;
  requiredOption: string;
  list: string;
  chooseTitle: (target: string) => string;
  chooseInstruction: (target: string) => string;
  optionAlt: (target: string) => string;
  openTitle: (title: string) => string;
  openInstruction: (title: string) => string;
  submitTitle: (target: string) => string;
  submitInstruction: (target: string) => string;
  submitAlt: (target: string) => string;
  clickTitle: (target: string) => string;
  clickInstruction: (target: string) => string;
  clickAlt: (target: string, page: string) => string;
  workflowGuide: string;
  overview: (steps: number | string, sections: string) => string;
  sectionJoin: (sections: string) => string;
  stepByStep: string;
};

const deterministicCopy: Record<OutputLocale, DeterministicCopy> = {
  en: {
    map: "the map",
    highlightedField: "the highlighted field",
    highlightedRole: (role) => `the highlighted ${role}`,
    highlightedArea: "the highlighted area",
    mapPointTitle: "Click the highlighted map point",
    mapPointInstruction: (region) =>
      `Click the highlighted point in the ${bold(`${region} of the map`)}.`,
    mapPointAlt: (region) => `Highlighted point in the ${region} of the map`,
    enterTitle: (label) => `Enter ${label}`,
    enterInstruction: (label) =>
      `Enter the required value in the ${bold(label)} field.`,
    fieldAlt: (label) => `${label} field`,
    selectTitle: (label) => `Select ${label}`,
    selectInstruction: (value, label) =>
      `Select ${bold(value)} from the ${bold(label)} list.`,
    listAlt: (label) => `${label} list`,
    requiredOption: "the required option",
    list: "the list",
    chooseTitle: (target) => `Choose ${target}`,
    chooseInstruction: (target) => `Choose ${bold(target)}.`,
    optionAlt: (target) => `${target} option`,
    openTitle: (title) => `Open ${title}`,
    openInstruction: (title) => `Open ${bold(title)}.`,
    submitTitle: (target) => `Submit ${target}`,
    submitInstruction: (target) => `Submit the form using ${bold(target)}.`,
    submitAlt: (target) => `${target} submit control`,
    clickTitle: (target) => `Click ${target}`,
    clickInstruction: (target) => `Click ${bold(target)}.`,
    clickAlt: (target, page) => `${target} on ${page}`,
    workflowGuide: "Workflow guide",
    overview: (steps, sections) =>
      `Follow this ${steps} guide${sections} to complete the recorded workflow.`,
    sectionJoin: (sections) => ` across ${sections}`,
    stepByStep: "step-by-step",
  },
  ga: {
    map: "an léarscáil",
    highlightedField: "an réimse aibhsithe",
    highlightedRole: (role) => `an ${role} aibhsithe`,
    highlightedArea: "an limistéar aibhsithe",
    mapPointTitle: "Cliceáil pointe aibhsithe na léarscáile",
    mapPointInstruction: (region) =>
      `Cliceáil an pointe aibhsithe i ${bold(`${region} den léarscáil`)}.`,
    mapPointAlt: (region) => `Pointe aibhsithe i ${region} den léarscáil`,
    enterTitle: (label) => `Cuir ${label} isteach`,
    enterInstruction: (label) =>
      `Cuir an luach riachtanach isteach sa réimse ${bold(label)}.`,
    fieldAlt: (label) => `Réimse ${label}`,
    selectTitle: (label) => `Roghnaigh ${label}`,
    selectInstruction: (value, label) =>
      `Roghnaigh ${bold(value)} ón liosta ${bold(label)}.`,
    listAlt: (label) => `Liosta ${label}`,
    requiredOption: "an rogha riachtanach",
    list: "an liosta",
    chooseTitle: (target) => `Roghnaigh ${target}`,
    chooseInstruction: (target) => `Roghnaigh ${bold(target)}.`,
    optionAlt: (target) => `Rogha ${target}`,
    openTitle: (title) => `Oscail ${title}`,
    openInstruction: (title) => `Oscail ${bold(title)}.`,
    submitTitle: (target) => `Cuir ${target} isteach`,
    submitInstruction: (target) => `Cuir an fhoirm isteach le ${bold(target)}.`,
    submitAlt: (target) => `Rialtán seolta ${target}`,
    clickTitle: (target) => `Cliceáil ${target}`,
    clickInstruction: (target) => `Cliceáil ${bold(target)}.`,
    clickAlt: (target, page) => `${target} ar ${page}`,
    workflowGuide: "Treoir sreafa oibre",
    overview: (steps, sections) =>
      `Lean an treoir ${steps} seo${sections} chun an sreabhadh oibre taifeadta a chur i gcrích.`,
    sectionJoin: (sections) => ` trí ${sections}`,
    stepByStep: "céim ar chéim",
  },
  fr: {
    map: "la carte",
    highlightedField: "le champ mis en évidence",
    highlightedRole: (role) => `l’élément ${role} mis en évidence`,
    highlightedArea: "la zone mise en évidence",
    mapPointTitle: "Cliquer sur le point indiqué sur la carte",
    mapPointInstruction: (region) =>
      `Cliquez sur le point indiqué dans ${bold(`${region} de la carte`)}.`,
    mapPointAlt: (region) => `Point indiqué dans ${region} de la carte`,
    enterTitle: (label) => `Saisir ${label}`,
    enterInstruction: (label) =>
      `Saisissez la valeur requise dans le champ ${bold(label)}.`,
    fieldAlt: (label) => `Champ ${label}`,
    selectTitle: (label) => `Sélectionner ${label}`,
    selectInstruction: (value, label) =>
      `Sélectionnez ${bold(value)} dans la liste ${bold(label)}.`,
    listAlt: (label) => `Liste ${label}`,
    requiredOption: "l’option requise",
    list: "la liste",
    chooseTitle: (target) => `Choisir ${target}`,
    chooseInstruction: (target) => `Choisissez ${bold(target)}.`,
    optionAlt: (target) => `Option ${target}`,
    openTitle: (title) => `Ouvrir ${title}`,
    openInstruction: (title) => `Ouvrez ${bold(title)}.`,
    submitTitle: (target) => `Envoyer avec ${target}`,
    submitInstruction: (target) =>
      `Envoyez le formulaire à l’aide de ${bold(target)}.`,
    submitAlt: (target) => `Commande d’envoi ${target}`,
    clickTitle: (target) => `Cliquer sur ${target}`,
    clickInstruction: (target) => `Cliquez sur ${bold(target)}.`,
    clickAlt: (target, page) => `${target} sur ${page}`,
    workflowGuide: "Guide du flux de travail",
    overview: (steps, sections) =>
      `Suivez ce guide ${steps}${sections} pour terminer le flux de travail enregistré.`,
    sectionJoin: (sections) => ` couvrant ${sections}`,
    stepByStep: "étape par étape",
  },
  de: {
    map: "die Karte",
    highlightedField: "das hervorgehobene Feld",
    highlightedRole: (role) => `das hervorgehobene ${role}-Element`,
    highlightedArea: "den hervorgehobenen Bereich",
    mapPointTitle: "Hervorgehobenen Kartenpunkt anklicken",
    mapPointInstruction: (region) =>
      `Klicken Sie auf den hervorgehobenen Punkt in ${bold(`${region} der Karte`)}.`,
    mapPointAlt: (region) => `Hervorgehobener Punkt in ${region} der Karte`,
    enterTitle: (label) => `${label} eingeben`,
    enterInstruction: (label) =>
      `Geben Sie den erforderlichen Wert in das Feld ${bold(label)} ein.`,
    fieldAlt: (label) => `Feld ${label}`,
    selectTitle: (label) => `${label} auswählen`,
    selectInstruction: (value, label) =>
      `Wählen Sie ${bold(value)} aus der Liste ${bold(label)} aus.`,
    listAlt: (label) => `Liste ${label}`,
    requiredOption: "die erforderliche Option",
    list: "die Liste",
    chooseTitle: (target) => `${target} auswählen`,
    chooseInstruction: (target) => `Wählen Sie ${bold(target)} aus.`,
    optionAlt: (target) => `Option ${target}`,
    openTitle: (title) => `${title} öffnen`,
    openInstruction: (title) => `Öffnen Sie ${bold(title)}.`,
    submitTitle: (target) => `${target} absenden`,
    submitInstruction: (target) =>
      `Senden Sie das Formular mit ${bold(target)} ab.`,
    submitAlt: (target) => `Steuerelement zum Absenden: ${target}`,
    clickTitle: (target) => `${target} anklicken`,
    clickInstruction: (target) => `Klicken Sie auf ${bold(target)}.`,
    clickAlt: (target, page) => `${target} auf ${page}`,
    workflowGuide: "Arbeitsablauf-Anleitung",
    overview: (steps, sections) =>
      `Folgen Sie dieser ${steps}-Anleitung${sections}, um den aufgezeichneten Arbeitsablauf abzuschließen.`,
    sectionJoin: (sections) => ` für ${sections}`,
    stepByStep: "Schritt-für-Schritt",
  },
};

function targetName(event: RecordingEvent, locale: OutputLocale): string {
  const copy = deterministicCopy[locale];
  const raw = event.elementName || event.labelText;
  if (raw) return raw;
  if (event.elementRole === "canvas") return copy.map;
  if (event.elementRole === "field") return copy.highlightedField;
  if (
    event.elementRole &&
    !/^(div|span|i|svg|path|element)$/i.test(event.elementRole)
  ) {
    return copy.highlightedRole(event.elementRole);
  }
  return copy.highlightedArea;
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
  const copy = deterministicCopy[context.outputLocale];
  const stepCount = context.items.filter((item) => item.kind === "step").length;
  const sections = context.items
    .filter((item) => item.kind === "header")
    .map((item) => item.title);
  const title =
    context.currentTitle.replace(/^Record\s+/i, "").trim() ||
    copy.workflowGuide;
  const sectionText =
    sections.length > 0
      ? copy.sectionJoin(sections.slice(0, 3).join(", "))
      : "";
  return {
    title,
    overview: copy.overview(stepCount || copy.stepByStep, sectionText),
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

export function deterministicInstruction(
  event: RecordingEvent,
  outputLocale: OutputLocale = "en",
): GeneratedStep {
  const copy = deterministicCopy[outputLocale];
  const target = targetName(event, outputLocale);

  if (event.actionType === "click" && event.elementRole === "canvas") {
    const region = canvasRegion(event);
    if (region) {
      return {
        title: copy.mapPointTitle,
        instruction: copy.mapPointInstruction(region),
        altText: copy.mapPointAlt(region),
      };
    }
  }

  if (event.actionType === "input") {
    const label = event.labelText || event.elementName || copy.highlightedField;
    return {
      title: copy.enterTitle(label),
      instruction: copy.enterInstruction(label),
      altText: copy.fieldAlt(label),
    };
  }

  if (event.actionType === "select") {
    const safeValue =
      typeof event.metadata.selectedValue === "string"
        ? event.metadata.selectedValue
        : copy.requiredOption;
    const label = event.labelText || event.elementName || copy.list;
    return {
      title: copy.selectTitle(label),
      instruction: copy.selectInstruction(safeValue, label),
      altText: copy.listAlt(label),
    };
  }

  if (event.actionType === "checkbox" || event.actionType === "radio") {
    return {
      title: copy.chooseTitle(target),
      instruction: copy.chooseInstruction(target),
      altText: copy.optionAlt(target),
    };
  }

  if (event.actionType === "navigation") {
    return {
      title: copy.openTitle(event.pageTitle),
      instruction: copy.openInstruction(event.pageTitle),
      altText: event.pageTitle,
    };
  }

  if (event.actionType === "submit") {
    return {
      title: copy.submitTitle(target),
      instruction: copy.submitInstruction(target),
      altText: copy.submitAlt(target),
    };
  }

  return {
    title: copy.clickTitle(target),
    instruction: copy.clickInstruction(target),
    altText: copy.clickAlt(target, event.pageTitle),
  };
}

export async function writeStep(
  provider: AiStepWriterProvider | undefined,
  context: StepWritingContext,
): Promise<GeneratedStep & { source: "ai" | "deterministic" }> {
  if (!provider) {
    return {
      ...deterministicInstruction(context.current, context.outputLocale),
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
      ...deterministicInstruction(context.current, context.outputLocale),
      source: "deterministic",
    };
  }
}

export async function writeChapter(
  provider: AiStepWriterProvider | undefined,
  context: ChapterWritingContext,
): Promise<GeneratedChapter & { source: "ai" | "deterministic" }> {
  const fallback = {
    title: deterministicInstruction(context.current, context.outputLocale)
      .title,
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

async function postProviderJson<T>(input: {
  options: OpenAiCompatibleProviderOptions;
  path: string;
  body: unknown;
  providerName: "AI provider" | "Ollama provider";
  authenticate?: boolean;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.options.timeoutMs ?? 30_000,
  );
  const response = await fetch(
    input.options.endpoint.replace(/\/$/, "") + input.path,
    {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(input.authenticate && input.options.apiKey
          ? { authorization: `Bearer ${input.options.apiKey}` }
          : {}),
      },
      body: JSON.stringify(input.body),
    },
  ).finally(() => clearTimeout(timeout));

  if (!response.ok)
    throw new Error(`${input.providerName} failed with ${response.status}`);
  return (await response.json()) as T;
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
    const language = targetLanguageInstruction(context.outputLocale);
    const jsonContract =
      'Return exactly one compact JSON object: {"title":"...","overview":"..."}. No markdown outside JSON.';

    const json = await postProviderJson<{
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string; reasoning?: string };
      }>;
    }>({
      options: this.options,
      path: "/chat/completions",
      providerName: "AI provider",
      authenticate: true,
      body: {
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
              language +
              " " +
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
      },
    });
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
      "\n" +
      targetLanguageInstruction(context.outputLocale) +
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

    const json = await postProviderJson<{
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string; reasoning?: string };
      }>;
    }>({
      options: this.options,
      path: "/chat/completions",
      providerName: "AI provider",
      authenticate: true,
      body: {
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
      },
    });
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
    const jsonContract =
      'Return exactly one compact JSON object: {"title":"..."}. No markdown outside JSON.';
    const json = await postProviderJson<{
      choices?: Array<{ message?: { content?: string } }>;
    }>({
      options: this.options,
      path: "/chat/completions",
      providerName: "AI provider",
      authenticate: true,
      body: {
        model: this.options.model,
        temperature: 0.1,
        max_tokens: 128,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Write concise action-oriented video chapter titles. ${targetLanguageInstruction(context.outputLocale)} ${jsonContract}`,
          },
          {
            role: "user",
            content:
              JSON.stringify(context) +
              "\nUse the action and nearby narration. Do not invent an outcome.\n" +
              jsonContract,
          },
        ],
      },
    });
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
    const json = await postProviderJson<{
      response?: string;
      thinking?: string;
      done_reason?: string;
    }>({
      options: this.options,
      path: "/api/generate",
      providerName: "Ollama provider",
      body: {
        model: this.options.model,
        prompt:
          "/no_think\nReturn ONLY JSON with keys title and overview for this whole browser workflow. " +
          "The overview must be 1-2 concise sentences.\n" +
          targetLanguageInstruction(context.outputLocale) +
          "\n" +
          JSON.stringify(context) +
          "\n/no_think",
        stream: false,
        format: "json",
        think: false,
        options: {
          num_predict: 512,
          temperature: 0,
        },
      },
    });
    if (json.response) return parseGeneratedOverview(json.response);
    if (json.thinking) return parseGeneratedOverview(json.thinking);
    throw new Error(
      `Ollama provider returned no overview. done_reason=${json.done_reason ?? "unknown"}`,
    );
  }

  async generateStep(context: StepWritingContext): Promise<GeneratedStep> {
    const imageBase64 = context.screenshotDataUrl?.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      "",
    );
    const prompt =
      "Return ONLY JSON with keys title, instruction, altText for this browser workflow step.\n" +
      "Do not include prose outside JSON.\n" +
      targetLanguageInstruction(context.outputLocale) +
      "\n" +
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

    const json = await postProviderJson<{
      response?: string;
      thinking?: string;
      done_reason?: string;
    }>({
      options: this.options,
      path: "/api/generate",
      providerName: "Ollama provider",
      body: {
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
      },
    });
    if (json.response) return parseGeneratedStep(json.response);
    if (json.thinking) return parseGeneratedStep(json.thinking);
    throw new Error(
      `Ollama provider returned no response. done_reason=${json.done_reason ?? "unknown"}`,
    );
  }

  async generateChapter(
    context: ChapterWritingContext,
  ): Promise<GeneratedChapter> {
    const json = await postProviderJson<{
      response?: string;
      thinking?: string;
    }>({
      options: this.options,
      path: "/api/generate",
      providerName: "Ollama provider",
      body: {
        model: this.options.model,
        prompt:
          "Return ONLY JSON with one key, title, containing a concise action-oriented video chapter name. " +
          "Use nearby narration but do not invent an outcome.\n" +
          targetLanguageInstruction(context.outputLocale) +
          "\n" +
          JSON.stringify(context),
        stream: false,
        format: "json",
        think: false,
        options: { num_predict: 128, temperature: 0 },
      },
    });
    if (json.response) return parseGeneratedChapter(json.response);
    if (json.thinking) return parseGeneratedChapter(json.thinking);
    throw new Error("Ollama provider returned no chapter title");
  }
}
