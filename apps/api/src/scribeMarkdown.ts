// SPDX-License-Identifier: AGPL-3.0-only
import { fromMarkdown } from "mdast-util-from-markdown";

const STEP_LIMIT = 500;
const STEP_BODY_LIMIT = 5_000;

interface PositionedNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  depth?: number;
  children?: PositionedNode[];
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
}

export interface ParsedScribeMarkdownStep {
  ordinal: number;
  outlineTitle: string;
  body: string;
  imageUrl: string | null;
  imageAlt: string | null;
}

export interface ParsedScribeMarkdown {
  title: string;
  purpose: string | null;
  sourceUrl: string | null;
  steps: ParsedScribeMarkdownStep[];
}

export class ScribeMarkdownParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScribeMarkdownParseError";
  }
}

function walk(node: PositionedNode, visit: (node: PositionedNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function nodeText(node: PositionedNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(nodeText).join("");
}

function markdownPlainText(markdown: string): string {
  const tree = fromMarkdown(markdown) as PositionedNode;
  return (tree.children ?? [])
    .map(nodeText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, max: number): string {
  const characters = Array.from(value);
  return characters.length <= max
    ? value
    : `${characters.slice(0, max - 1).join("")}…`;
}

function offsets(node: PositionedNode): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === "number" && typeof end === "number"
    ? { start, end }
    : null;
}

function validatedImageUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ScribeMarkdownParseError(
      `Screenshot URL is not an absolute URL: ${raw}`,
    );
  }
  if (url.protocol !== "https:")
    throw new ScribeMarkdownParseError(`Screenshot URL must use HTTPS: ${raw}`);
  if (url.username || url.password)
    throw new ScribeMarkdownParseError(
      `Screenshot URL must not contain credentials: ${raw}`,
    );
  return url.toString();
}

export function parseScribeMarkdown(markdown: string): ParsedScribeMarkdown {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const tree = fromMarkdown(normalized) as PositionedNode;
  const headings: PositionedNode[] = [];
  const images: PositionedNode[] = [];
  const codeRanges: Array<{ start: number; end: number }> = [];
  walk(tree, (node) => {
    if (node.type === "heading") headings.push(node);
    if (node.type === "image") images.push(node);
    if (node.type === "code") {
      const range = offsets(node);
      if (range) codeRanges.push(range);
    }
  });

  const titleHeading = headings.find((heading) => heading.depth === 1);
  const titleRange = titleHeading ? offsets(titleHeading) : null;
  const title = titleHeading ? nodeText(titleHeading).trim() : "";
  if (!titleHeading || !titleRange || !title)
    throw new ScribeMarkdownParseError(
      "Scribe Markdown must contain a top-level title",
    );
  if (Array.from(title).length > 500)
    throw new ScribeMarkdownParseError("Guide title exceeds 500 characters");

  const attribution = headings.find((heading) =>
    /made by[\s\S]+with scribe/i.test(nodeText(heading)),
  );
  const attributionRange = attribution ? offsets(attribution) : null;
  let sourceUrl: string | null = null;
  if (attribution) {
    walk(attribution, (node) => {
      if (
        !sourceUrl &&
        node.type === "link" &&
        typeof node.url === "string" &&
        /^https:\/\/(?:www\.)?scribehow\.com\//i.test(node.url)
      ) {
        sourceUrl = node.url;
      }
    });
  }

  const markers: Array<{ start: number; contentStart: number }> = [];
  const markerPattern = /^([ \t]*)(\d+)\\?\.[ \t]+/gm;
  for (const match of normalized.matchAll(markerPattern)) {
    const start = match.index;
    if (match[1].length > 0) continue;
    if (codeRanges.some((range) => start >= range.start && start < range.end))
      continue;
    markers.push({ start, contentStart: start + match[0].length });
  }
  if (markers.length === 0)
    throw new ScribeMarkdownParseError(
      "Scribe Markdown must contain at least one numbered step",
    );
  if (markers.length > STEP_LIMIT)
    throw new ScribeMarkdownParseError(
      `Scribe Markdown contains more than ${STEP_LIMIT} steps`,
    );

  const imageEntries = images.map((node) => {
    const range = offsets(node);
    if (!range || typeof node.url !== "string")
      throw new ScribeMarkdownParseError(
        "A screenshot could not be located in the Markdown source",
      );
    return {
      ...range,
      url: validatedImageUrl(node.url),
      alt: node.alt?.trim() || null,
    };
  });

  const assignedImages = new Set<number>();
  const steps = markers.map((marker, ordinal) => {
    const end = markers[ordinal + 1]?.start ?? normalized.length;
    const stepImages = imageEntries
      .map((image, index) => ({ image, index }))
      .filter(
        ({ image }) => image.start >= marker.contentStart && image.start < end,
      );
    if (stepImages.length > 1)
      throw new ScribeMarkdownParseError(
        `Step ${ordinal + 1} contains more than one screenshot`,
      );
    for (const entry of stepImages) assignedImages.add(entry.index);

    const rawBody = normalized.slice(marker.contentStart, end);
    const body = stepImages.length
      ? `${normalized.slice(marker.contentStart, stepImages[0].image.start)}${normalized.slice(stepImages[0].image.end, end)}`.trim()
      : rawBody.trim();
    if (!body)
      throw new ScribeMarkdownParseError(
        `Step ${ordinal + 1} has no instruction`,
      );
    if (body.length > STEP_BODY_LIMIT)
      throw new ScribeMarkdownParseError(
        `Step ${ordinal + 1} exceeds ${STEP_BODY_LIMIT} characters`,
      );
    const plainText = markdownPlainText(body);
    return {
      ordinal,
      outlineTitle: truncate(plainText || `Step ${ordinal + 1}`, 120),
      body,
      imageUrl: stepImages[0]?.image.url ?? null,
      imageAlt: stepImages[0]?.image.alt ?? null,
    };
  });

  if (assignedImages.size !== imageEntries.length)
    throw new ScribeMarkdownParseError(
      "Every screenshot must appear inside a numbered step",
    );

  let purposeMarkdown = normalized.slice(titleRange.end, markers[0].start);
  if (attributionRange) {
    const relativeStart = attributionRange.start - titleRange.end;
    const relativeEnd = attributionRange.end - titleRange.end;
    if (relativeStart >= 0) {
      purposeMarkdown = `${purposeMarkdown.slice(0, relativeStart)}${purposeMarkdown.slice(relativeEnd)}`;
    }
  }
  const purposeText = markdownPlainText(purposeMarkdown);

  return {
    title,
    purpose: purposeText ? truncate(purposeText, 500) : null,
    sourceUrl,
    steps,
  };
}
