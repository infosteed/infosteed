// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import {
  normalizeGuideOutlineTitle,
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

export const guideCleanupClassificationSchema = z.object({
  decision: z.enum(["collapse", "keep", "uncertain"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(160),
});

const generatedStepInputSchema = z.object({
  title: z.string().trim().min(1),
  instruction: z.string().trim().min(1),
  altText: z.string().trim().min(1),
});

export const generatedStepCandidateSchema = generatedStepInputSchema.extend({
  actionType: z.string().min(1),
  elementName: z.string().nullable(),
  elementRole: z.string().nullable(),
});

export type GeneratedStep = z.infer<typeof generatedStepSchema>;
export type GeneratedStepCandidate = z.infer<
  typeof generatedStepCandidateSchema
>;
export type GeneratedOverview = z.infer<typeof generatedOverviewSchema>;
export type GeneratedChapter = z.infer<typeof generatedChapterSchema>;
export type GuideCleanupClassification = z.infer<
  typeof guideCleanupClassificationSchema
>;

export interface GuideCleanupClassificationContext {
  earlier: RecordingEvent;
  later: RecordingEvent;
  screenshotDataUrls: [string, string];
  evidence: {
    elapsedMs: number;
    pointDistance: number | null;
    boundingBoxOverlap: number | null;
    meanScreenshotDifference: number;
    changedPixelRatio: number;
  };
}

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
  generateStep(context: StepWritingContext): Promise<GeneratedStepCandidate>;
  generateOverview?(context: GuideOverviewContext): Promise<GeneratedOverview>;
  generateChapter?(context: ChapterWritingContext): Promise<GeneratedChapter>;
  classifyGuideCleanup?(
    context: GuideCleanupClassificationContext,
  ): Promise<GuideCleanupClassification>;
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

function normalizeGeneratedStepCandidate(
  value: unknown,
): GeneratedStepCandidate {
  const parsed = generatedStepCandidateSchema.parse(value);
  return {
    actionType: parsed.actionType,
    elementName: parsed.elementName,
    elementRole: parsed.elementRole,
    title: clampText(
      normalizeGuideOutlineTitle(parsed.title, parsed.instruction),
      120,
    ),
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

function normalizeGuideCleanupClassification(
  value: unknown,
): GuideCleanupClassification {
  return guideCleanupClassificationSchema.parse(value);
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

const imperativePrefixes: Record<
  OutputLocale,
  Record<RecordingEvent["actionType"], string[]>
> = {
  en: {
    click: ["click"],
    input: ["enter", "type"],
    select: ["select", "choose"],
    checkbox: ["choose", "select", "check"],
    radio: ["choose", "select"],
    submit: ["submit"],
    navigation: ["open"],
    keyboard: ["press"],
    modal: ["click", "close", "open"],
  },
  ga: {
    click: ["cliceáil"],
    input: ["cuir"],
    select: ["roghnaigh"],
    checkbox: ["roghnaigh"],
    radio: ["roghnaigh"],
    submit: ["seol"],
    navigation: ["oscail"],
    keyboard: ["brúigh"],
    modal: ["cliceáil", "dún", "oscail"],
  },
  fr: {
    click: ["cliquez"],
    input: ["saisissez"],
    select: ["sélectionnez", "choisissez"],
    checkbox: ["choisissez", "sélectionnez"],
    radio: ["choisissez", "sélectionnez"],
    submit: ["envoyez"],
    navigation: ["ouvrez"],
    keyboard: ["appuyez"],
    modal: ["cliquez", "fermez", "ouvrez"],
  },
  de: {
    click: ["klicken sie"],
    input: ["geben sie"],
    select: ["wählen sie"],
    checkbox: ["wählen sie"],
    radio: ["wählen sie"],
    submit: ["senden sie"],
    navigation: ["öffnen sie"],
    keyboard: ["drücken sie"],
    modal: ["klicken sie", "schließen sie", "öffnen sie"],
  },
};

function plainGeneratedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\\([*_`])/g, "$1")
    .replace(/[*_`'\"“”‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedForMatch(value: string): string {
  return plainGeneratedText(value).toLocaleLowerCase();
}

function includesTarget(value: string, target: string): boolean {
  return normalizedForMatch(value).includes(normalizedForMatch(target));
}

function isInternalLikeTarget(value: string): boolean {
  const normalized = plainGeneratedText(value);
  if (!normalized) return true;
  if (normalized.length > 60) return true;
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+(?:Btn|Button|Link|Input)?$/u.test(normalized))
    return true;
  if (
    /(?:^|[_-])(btn|button|input|link|el|elem|node|ctl|ctrl)(?:$|[_-])/i.test(
      normalized,
    )
  )
    return true;
  if (/^[a-z0-9_-]{12,}$/i.test(normalized) && !/\s/.test(normalized))
    return true;
  return false;
}

function relevantWords(value: string | undefined | null): string[] {
  if (!value) return [];
  return plainGeneratedText(value)
    .toLocaleLowerCase()
    .split(/[^a-z0-9À-ž]+/iu)
    .filter((word) => word.length >= 4);
}

function stemForGrounding(word: string): string {
  return word
    .replace(/(?:attributes?)$/u, "attribute")
    .replace(/(?:ges|ces|ses)$/u, "ge")
    .replace(/(?:ing|ed|es|s)$/u, "");
}

function groundedWords(context: StepWritingContext): Set<string> {
  return new Set(
    [
      ...relevantWords(context.current.elementName),
      ...relevantWords(context.current.labelText),
      ...relevantWords(context.current.nearbyHeading),
      ...relevantWords(context.current.pageTitle),
      ...relevantWords(context.transcriptBefore),
      ...relevantWords(context.transcriptAfter),
    ].map(stemForGrounding),
  );
}

function validateGroundedClause(
  clause: string,
  context: StepWritingContext,
): void {
  if (!clause) return;
  if (context.screenshotBase64 || context.screenshotDataUrl) return;

  const words = relevantWords(clause);
  if (words.length === 0) return;

  const grounded = groundedWords(context);
  const hasGrounding = words.some((word) => {
    const stem = stemForGrounding(word);
    return grounded.has(stem);
  });
  if (!hasGrounding)
    throw new Error("AI instruction added an ungrounded outcome");
}

function validateInstructionShape(
  instruction: string,
  context: StepWritingContext,
): void {
  const currentName = context.current.elementName;
  if (!currentName) throw new Error("AI output cannot be target-validated");

  const plainInstruction = plainGeneratedText(instruction);
  const comparableInstruction = plainInstruction.toLocaleLowerCase();
  const prefixes =
    imperativePrefixes[context.outputLocale][context.current.actionType];
  const prefix = prefixes.find(
    (candidate) =>
      comparableInstruction === candidate ||
      comparableInstruction.startsWith(`${candidate} `),
  );
  if (!prefix) {
    throw new Error("AI instruction did not preserve the recorded action");
  }

  if (/[;:()[\]{}\n\r]/.test(plainInstruction)) {
    throw new Error("AI instruction added unsupported punctuation");
  }
  const innerSentenceMarks = plainInstruction.replace(/[.!?]\s*$/u, "");
  if (/[.!?]/.test(innerSentenceMarks)) {
    throw new Error("AI instruction added an extra sentence");
  }

  const weakTarget = isInternalLikeTarget(currentName);
  const comparableTarget = normalizedForMatch(currentName);
  const targetIndex = comparableInstruction.indexOf(comparableTarget);
  if (!weakTarget) {
    if (
      targetIndex < 0 ||
      comparableInstruction.lastIndexOf(comparableTarget) !== targetIndex
    ) {
      throw new Error("AI instruction did not preserve the recorded target");
    }
    const beforeTarget = comparableInstruction.slice(0, targetIndex).trim();
    const afterTarget = comparableInstruction
      .slice(targetIndex + comparableTarget.length)
      .replace(/^[.!?]\s*/u, "")
      .replace(/[.!?]$/u, "")
      .trim();
    if (beforeTarget !== prefix && !beforeTarget.startsWith(`${prefix} `)) {
      throw new Error("AI instruction did not preserve the recorded action");
    }
    validateGroundedClause(afterTarget, context);
    return;
  }

  const afterPrefix = plainInstruction
    .slice(prefix.length)
    .replace(/[.!?]$/u, "")
    .trim();
  if (!afterPrefix)
    throw new Error("AI instruction did not identify the current target");
  validateGroundedClause(
    afterPrefix.replace(/^.+?\b(to|for|in|on)\b/iu, "$1"),
    context,
  );
}

function validateGeneratedAuthority(
  generated: GeneratedStepCandidate,
  context: StepWritingContext,
): void {
  const currentName = context.current.elementName ?? null;
  const currentRole = context.current.elementRole ?? null;
  if (
    generated.actionType !== context.current.actionType ||
    generated.elementName !== currentName ||
    generated.elementRole !== currentRole
  ) {
    throw new Error("AI output changed the authoritative recorded action");
  }
  if (!currentName) throw new Error("AI output cannot be target-validated");
  const weakTarget = isInternalLikeTarget(currentName);

  for (const [field, value] of [
    ["title", generated.title],
    ["instruction", generated.instruction],
    ["alt text", generated.altText],
  ] as const) {
    if (!weakTarget && !includesTarget(value, currentName))
      throw new Error(`AI ${field} did not preserve the recorded target`);
  }

  for (const neighbor of [context.previous, context.next]) {
    const neighborName = neighbor?.elementName;
    if (
      !neighborName ||
      normalizedForMatch(neighborName) === normalizedForMatch(currentName)
    )
      continue;
    if (
      includesTarget(generated.title, neighborName) ||
      includesTarget(generated.instruction, neighborName) ||
      includesTarget(generated.altText, neighborName)
    ) {
      throw new Error("AI output substituted an adjacent recorded target");
    }
  }

  validateInstructionShape(generated.instruction, context);
}

function acceptedGeneratedStep(
  generated: GeneratedStepCandidate,
  context: StepWritingContext,
): GeneratedStep & { source: "ai" } {
  validateGeneratedAuthority(generated, context);
  return {
    title: clampText(
      normalizeGuideOutlineTitle(generated.title, generated.instruction),
      120,
    ),
    instruction: generated.instruction,
    altText: generated.altText,
    source: "ai",
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
    const generated = normalizeGeneratedStepCandidate(
      await provider.generateStep(context),
    );
    return acceptedGeneratedStep(generated, context);
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

function parseGeneratedStep(value: string): GeneratedStepCandidate {
  const trimmed = value.trim();
  try {
    return normalizeGeneratedStepCandidate(JSON.parse(trimmed));
  } catch {
    // Fall through to extracting a JSON object from provider wrapper text.
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objectMatch)
    throw new Error("AI provider response did not contain a JSON object");
  return normalizeGeneratedStepCandidate(JSON.parse(objectMatch[0]));
}

function parseGuideCleanupClassification(
  value: string,
): GuideCleanupClassification {
  const trimmed = value.trim();
  try {
    return normalizeGuideCleanupClassification(JSON.parse(trimmed));
  } catch {
    // Fall through to extracting a JSON object from provider wrapper text.
  }
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!objectMatch)
    throw new Error("AI cleanup response did not contain a JSON object");
  return normalizeGuideCleanupClassification(JSON.parse(objectMatch[0]));
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
  ): Promise<GeneratedStepCandidate> {
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
    const authoritativeAction = {
      actionType: context.current.actionType,
      elementName: context.current.elementName ?? null,
      elementRole: context.current.elementRole ?? null,
    };
    const jsonContract =
      'Return exactly one compact JSON object: {"actionType":"...","elementName":"... or null","elementRole":"... or null","title":"...","instruction":"...","altText":"..."}. No markdown outside JSON. No reasoning.';
    const userText =
      "/no_think\n" +
      JSON.stringify(stepContext) +
      "\n" +
      targetLanguageInstruction(context.outputLocale) +
      "\nAUTHORITATIVE_ACTION=" +
      JSON.stringify(authoritativeAction) +
      "\nCopy every AUTHORITATIVE_ACTION value exactly into the matching JSON field. The current action, element name, and role override the screenshot, transcript, previous event, and next event. Write one direct imperative instruction that starts with the recorded action, identifies the current target, and may add one short context clause only when it is grounded in visible UI text, nearby headings, screenshot evidence, or transcript context. Prefer visible product and control language over internal IDs such as camelCase button names. Do not mention adjacent targets, invent outcomes, or include multiple actions. For internal-looking elementName values, keep elementName unchanged in JSON while using the visible human label in title, instruction, and altText. Never put a step number, total step count, or wording like Step X of Y in the title.\n" +
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
            content: `/no_think\nWrite concise browser workflow instructions. ${jsonContract} Treat AUTHORITATIVE_ACTION as immutable machine metadata. Never infer a different action or target from the screenshot or neighboring events. Prefer visible product and control labels over mechanical words or internal IDs like div, canvas, field, i, camelCase names, or full page text.\n/no_think`,
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

  async generateStep(
    context: StepWritingContext,
  ): Promise<GeneratedStepCandidate> {
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

  async classifyGuideCleanup(
    context: GuideCleanupClassificationContext,
  ): Promise<GuideCleanupClassification> {
    const jsonContract =
      'Return exactly one compact JSON object: {"decision":"collapse|keep|uncertain","confidence":0.0,"reason":"..."}. No markdown or reasoning.';
    const prompt =
      "/no_think\nReview two adjacent browser clicks that deterministic checks consider possible duplicate documentation. Collapse only when the earlier click is a retry or redundant repetition of the later click. Keep intentional cumulative controls such as zoom, increment, pagination, carousel navigation, and any action with a meaningful state change. When unsure, return uncertain.\n" +
      JSON.stringify({
        earlier: context.earlier,
        later: context.later,
        evidence: context.evidence,
      }) +
      "\n" +
      jsonContract +
      "\n/no_think";
    const content = [
      { type: "text", text: prompt },
      ...context.screenshotDataUrls.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
    ];
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
        temperature: 0,
        max_tokens: 256,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "/no_think\nClassify repeated browser actions conservatively. " +
              jsonContract +
              "\n/no_think",
          },
          { role: "user", content },
        ],
      },
    });
    const response =
      json.choices?.[0]?.message?.content ??
      json.choices?.[0]?.message?.reasoning;
    if (!response)
      throw new Error("AI provider returned no cleanup classification");
    return parseGuideCleanupClassification(response);
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

  async generateStep(
    context: StepWritingContext,
  ): Promise<GeneratedStepCandidate> {
    const imageBase64 = context.screenshotDataUrl?.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      "",
    );
    const authoritativeAction = {
      actionType: context.current.actionType,
      elementName: context.current.elementName ?? null,
      elementRole: context.current.elementRole ?? null,
    };
    const prompt =
      "Return ONLY JSON with keys actionType, elementName, elementRole, title, instruction, altText for this browser workflow step.\n" +
      "Do not include prose outside JSON.\n" +
      targetLanguageInstruction(context.outputLocale) +
      "\nAUTHORITATIVE_ACTION=" +
      JSON.stringify(authoritativeAction) +
      "\nCopy every AUTHORITATIVE_ACTION value exactly into the matching JSON field. The current action, element name, and role override the image, transcript, previous event, and next event. Write one direct imperative instruction that starts with the recorded action, identifies the current target, and may add one short context clause only when it is grounded in visible UI text, nearby headings, screenshot evidence, or transcript context. Prefer visible product and control language over internal IDs such as camelCase button names. Do not mention adjacent targets, invent outcomes, or include multiple actions. For internal-looking elementName values, keep elementName unchanged in JSON while using the visible human label in title, instruction, and altText. Never put a step number, total step count, or wording like Step X of Y in the title.\n" +
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

  async classifyGuideCleanup(
    context: GuideCleanupClassificationContext,
  ): Promise<GuideCleanupClassification> {
    const images = context.screenshotDataUrls.map((url) =>
      url.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ""),
    );
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
          "/no_think\nReturn ONLY JSON with decision, confidence, and reason. Review two adjacent browser clicks that passed strict deterministic duplicate checks. Collapse only when the earlier click is a retry or redundant repetition. Keep intentional cumulative controls such as zoom, increment, pagination, or carousel navigation. Return uncertain when unsure.\n" +
          JSON.stringify({
            earlier: context.earlier,
            later: context.later,
            evidence: context.evidence,
          }) +
          "\n/no_think",
        images,
        stream: false,
        format: "json",
        think: false,
        options: { num_predict: 256, temperature: 0 },
      },
    });
    const response = json.response ?? json.thinking;
    if (!response)
      throw new Error(
        `Ollama provider returned no cleanup classification. done_reason=${json.done_reason ?? "unknown"}`,
      );
    return parseGuideCleanupClassification(response);
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
