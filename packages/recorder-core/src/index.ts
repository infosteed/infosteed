// SPDX-License-Identifier: AGPL-3.0-only
import type {
  ActionType,
  BoundingBox,
  RecordingEventInput,
} from "@infosteed/shared";

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passcode/i,
  /token/i,
  /api[-_\s]?key/i,
  /secret/i,
  /private[-_\s]?key/i,
  /cookie/i,
  /card/i,
  /cvv/i,
  /cvc/i,
  /iban/i,
  /routing/i,
  /ssn/i,
];

const USERNAME_PATTERNS = [/user(name)?/i, /email/i, /login/i];

export interface ElementHints {
  tagName?: string;
  type?: string | null;
  role?: string | null;
  name?: string | null;
  id?: string | null;
  labelText?: string | null;
  ariaLabel?: string | null;
  placeholder?: string | null;
  title?: string | null;
  text?: string | null;
  autocomplete?: string | null;
}

export interface RawRecorderEvent {
  actionType: ActionType;
  timestamp: number;
  pageTitle: string;
  url: string;
  element: ElementHints;
  boundingBox?: BoundingBox;
  value?: string;
  selectedValue?: string;
  key?: string;
  nearbyHeading?: string;
  canvasPosition?: {
    xRatio: number;
    yRatio: number;
    region: string;
  };
}

export function sanitizeUrl(rawUrl: string): string {
  if (rawUrl === "about:blank") return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "about:blank";
  }
}

export function isSensitiveField(hints: ElementHints): boolean {
  const haystack = [
    hints.type,
    hints.role,
    hints.name,
    hints.id,
    hints.labelText,
    hints.ariaLabel,
    hints.placeholder,
    hints.title,
    hints.autocomplete,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    hints.type === "password" ||
    SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(haystack))
  );
}

export function inputCategoryFor(hints: ElementHints): string {
  if (isSensitiveField(hints)) return "<redacted>";

  const haystack = [
    hints.name,
    hints.id,
    hints.labelText,
    hints.ariaLabel,
    hints.placeholder,
    hints.autocomplete,
  ]
    .filter(Boolean)
    .join(" ");

  if (USERNAME_PATTERNS.some((pattern) => pattern.test(haystack)))
    return "<username>";
  if (/search/i.test(haystack)) return "<search term>";
  if (/reference|ref/i.test(haystack)) return "<reference number>";
  if (/date/i.test(haystack)) return "<date>";
  if (hints.type === "number") return "<number>";
  return "<value>";
}

export function elementRoleFor(hints: ElementHints): string {
  if (hints.role) return hints.role;
  const tag = hints.tagName?.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "select") return "list";
  if (tag === "textarea" || tag === "input") return "field";
  if (tag === "dialog") return "dialog";
  return tag ?? "element";
}

function isNoisyName(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (normalized.length > 80) return true;
  if (normalized.split(" ").length > 10) return true;
  if (/^(div|span|i|svg|path|canvas|field|element)$/i.test(normalized))
    return true;
  if (
    /\b(previous|next|filters?|items?|page \d+ of \d+|updated|all)\b/i.test(
      normalized,
    ) &&
    normalized.split(" ").length > 5
  ) {
    return true;
  }
  return false;
}

export function accessibleNameFor(hints: ElementHints): string | undefined {
  const priorityCandidates = [
    hints.ariaLabel,
    hints.labelText,
    hints.placeholder,
    hints.title,
    hints.name,
    hints.id,
  ];
  const priorityName = priorityCandidates
    .map((value) => value?.trim())
    .find(
      (value): value is string =>
        typeof value === "string" && value.length > 0 && !isNoisyName(value),
    );

  if (priorityName) return priorityName;

  const textName = hints.text?.trim();
  return textName && !isNoisyName(textName) ? textName : undefined;
}

function eventKey(event: RawRecorderEvent): string {
  return [
    event.actionType,
    sanitizeUrl(event.url),
    elementRoleFor(event.element),
    accessibleNameFor(event.element) ?? "",
    event.element.labelText ?? "",
  ].join("|");
}

export function normalizeRawEvents(
  rawEvents: RawRecorderEvent[],
): RecordingEventInput[] {
  const normalized: RecordingEventInput[] = [];
  let lastKey = "";
  let lastTypingKey = "";

  for (const raw of rawEvents.sort((a, b) => a.timestamp - b.timestamp)) {
    if (
      raw.actionType === "keyboard" &&
      !["Enter", "Tab", "Escape"].includes(raw.key ?? "")
    )
      continue;

    const key = eventKey(raw);
    if (raw.actionType === "click" && key === lastKey) continue;

    if (raw.actionType === "input") {
      if (key === lastTypingKey) {
        const previous = normalized.at(-1);
        if (previous?.actionType === "input") {
          previous.inputCategory = inputCategoryFor(raw.element);
          continue;
        }
      }
      lastTypingKey = key;
    }

    lastKey = key;

    normalized.push({
      actionType: raw.actionType,
      pageTitle: raw.pageTitle || "Untitled page",
      sanitizedUrl: sanitizeUrl(raw.url),
      elementName: accessibleNameFor(raw.element),
      elementRole: elementRoleFor(raw.element),
      labelText: raw.element.labelText ?? undefined,
      nearbyHeading: raw.nearbyHeading,
      inputCategory:
        raw.actionType === "input" ? inputCategoryFor(raw.element) : undefined,
      boundingBox: raw.boundingBox,
      metadata: {
        canvasPosition: raw.canvasPosition,
        selectedValue:
          raw.actionType === "select" && !isSensitiveField(raw.element)
            ? raw.selectedValue
            : undefined,
        key: raw.actionType === "keyboard" ? raw.key : undefined,
      },
    });
  }

  return normalized;
}

export class ActiveRecordingClock {
  private startedAt = 0;
  private running = false;
  private pausedAt?: number;
  private pausedTotal = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  start(): void {
    this.startedAt = this.now();
    this.running = true;
    this.pausedAt = undefined;
    this.pausedTotal = 0;
  }

  pause(): void {
    if (this.running && this.pausedAt === undefined) this.pausedAt = this.now();
  }

  resume(): void {
    if (this.pausedAt !== undefined) {
      this.pausedTotal += this.now() - this.pausedAt;
      this.pausedAt = undefined;
    }
  }

  elapsed(): number {
    if (!this.running) return 0;
    return Math.max(
      0,
      Math.round(
        (this.pausedAt ?? this.now()) - this.startedAt - this.pausedTotal,
      ),
    );
  }
}

export function chooseVideoMimeType(
  isSupported: (mimeType: string) => boolean,
): string {
  for (const mimeType of [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ]) {
    if (mimeType === "video/webm" || isSupported(mimeType)) return mimeType;
  }
  return "video/webm";
}

export function shouldAutoPauseUpload(
  pendingBytes: number,
  limitBytes = 128 * 1024 * 1024,
): boolean {
  return pendingBytes >= limitBytes;
}

export const TRANSCRIPTION_AUDIO_BITS_PER_SECOND = 48_000;

export function chooseTranscriptionAudioSource(
  microphoneAvailable: boolean,
  tabAudioAvailable: boolean,
): "microphone" | "tab" | "none" {
  if (microphoneAvailable) return "microphone";
  if (tabAudioAvailable) return "tab";
  return "none";
}
