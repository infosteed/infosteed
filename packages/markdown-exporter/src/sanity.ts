// SPDX-License-Identifier: AGPL-3.0-only
import { createGzip } from "node:zlib";
import { fromMarkdown } from "mdast-util-from-markdown";
import { pack } from "tar-stream";
import type { GuideItem, Recording } from "@infosteed/shared";
import type { ExportImage } from "./index.js";
import { exportImageFilename } from "./image-filenames.js";

interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  children?: MdastNode[];
}

export interface SanitySpan {
  _key: string;
  _type: "span";
  marks: string[];
  text: string;
}

export interface SanityLinkMarkDefinition {
  _key: string;
  _type: "link";
  href: string;
  title?: string;
}

export interface SanityPortableTextBlock {
  _key: string;
  _type: "block";
  style: string;
  markDefs: SanityLinkMarkDefinition[];
  children: SanitySpan[];
  listItem?: "bullet" | "number";
  level?: number;
}

export interface SanityImageImport {
  _type: "image";
  _sanityAsset: string;
  alt?: string;
}

export interface SanityWorkflowStep {
  _key: string;
  _type: "workflowStep";
  title: string;
  instruction: SanityPortableTextBlock[];
  image?: SanityImageImport;
  source: GuideItem["source"];
  userEdited: boolean;
}

export interface SanityGuideCallout {
  _key: string;
  _type: "guideCallout";
  tone: "tip" | "alert";
  title: string;
  body: SanityPortableTextBlock[];
}

export interface SanityWorkflowGuideDocument {
  _id: string;
  _type: "workflowGuide";
  title: string;
  purpose: SanityPortableTextBlock[];
  audience: string | null;
  content: Array<
    SanityPortableTextBlock | SanityWorkflowStep | SanityGuideCallout
  >;
  source: {
    _type: "infosteedSource";
    recordingId: string;
    createdAt: string;
    updatedAt: string;
    finalizedAt: string | null;
  };
}

interface MarkdownContext {
  definitions: Map<string, { url: string; title?: string }>;
  nextBlock: number;
}

function guideItems(recording: Recording): GuideItem[] {
  if (recording.items.length > 0) return recording.items;
  return recording.steps.map((step) => ({
    id: step.id,
    recordingId: step.recordingId,
    eventId: step.eventId,
    ordinal: step.ordinal,
    kind: "step",
    title: step.title,
    body: step.instruction,
    imageFilename: step.imageFilename,
    altText: step.altText,
    source: step.source,
    userEdited: step.userEdited,
  }));
}

function safeKeyPart(value: string): string {
  const result = value
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return result || "content";
}

function definitionIdentifier(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function collectDefinitions(
  tree: MdastNode,
): Map<string, { url: string; title?: string }> {
  const definitions = new Map<string, { url: string; title?: string }>();
  for (const node of tree.children ?? []) {
    if (node.type !== "definition" || !node.identifier || !node.url) continue;
    definitions.set(definitionIdentifier(node.identifier), {
      url: node.url,
      ...(node.title ? { title: node.title } : {}),
    });
  }
  return definitions;
}

function makeBlock(
  nodes: MdastNode[],
  keyPrefix: string,
  context: MarkdownContext,
  options: {
    style?: string;
    listItem?: "bullet" | "number";
    level?: number;
  } = {},
): SanityPortableTextBlock {
  const blockKey = `${safeKeyPart(keyPrefix)}-block-${context.nextBlock++}`;
  const markDefs: SanityLinkMarkDefinition[] = [];
  const children: SanitySpan[] = [];
  let nextSpan = 0;
  let nextLink = 0;

  function addSpan(text: string, marks: string[]) {
    children.push({
      _key: `${blockKey}-span-${nextSpan++}`,
      _type: "span",
      marks,
      text,
    });
  }

  function walk(node: MdastNode, marks: string[]) {
    if (node.type === "text") {
      addSpan(node.value ?? "", marks);
      return;
    }
    if (node.type === "inlineCode") {
      addSpan(node.value ?? "", [...marks, "code"]);
      return;
    }
    if (node.type === "break") {
      addSpan("\n", marks);
      return;
    }
    if (node.type === "image" || node.type === "imageReference") {
      addSpan(node.value ?? "", marks);
      return;
    }
    if (node.type === "html") {
      addSpan(node.value ?? "", marks);
      return;
    }

    let nextMarks = marks;
    if (node.type === "strong") nextMarks = [...marks, "strong"];
    if (node.type === "emphasis") nextMarks = [...marks, "em"];

    if (node.type === "link" || node.type === "linkReference") {
      const reference =
        node.type === "linkReference"
          ? context.definitions.get(definitionIdentifier(node.identifier))
          : undefined;
      const href = node.url ?? reference?.url;
      if (href) {
        const markKey = `${blockKey}-link-${nextLink++}`;
        const title = node.title ?? reference?.title;
        markDefs.push({
          _key: markKey,
          _type: "link",
          href,
          ...(title ? { title } : {}),
        });
        nextMarks = [...marks, markKey];
      }
    }

    for (const child of node.children ?? []) walk(child, nextMarks);
  }

  for (const node of nodes) walk(node, []);
  if (children.length === 0) addSpan("", []);

  return {
    _key: blockKey,
    _type: "block",
    style: options.style ?? "normal",
    markDefs,
    children,
    ...(options.listItem
      ? { listItem: options.listItem, level: options.level ?? 1 }
      : {}),
  };
}

function markdownNodeText(node: MdastNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(markdownNodeText).join("");
}

function blocksFromNodes(
  nodes: MdastNode[],
  keyPrefix: string,
  context: MarkdownContext,
  list?: { listItem: "bullet" | "number"; level: number },
): SanityPortableTextBlock[] {
  const blocks: SanityPortableTextBlock[] = [];

  for (const node of nodes) {
    if (node.type === "definition") continue;
    if (node.type === "paragraph") {
      blocks.push(makeBlock(node.children ?? [], keyPrefix, context, list));
      continue;
    }
    if (node.type === "heading") {
      blocks.push(
        makeBlock(node.children ?? [], keyPrefix, context, {
          style: `h${node.depth ?? 2}`,
          ...list,
        }),
      );
      continue;
    }
    if (node.type === "blockquote") {
      for (const child of node.children ?? []) {
        if (child.type === "paragraph") {
          blocks.push(
            makeBlock(child.children ?? [], keyPrefix, context, {
              style: "blockquote",
              ...list,
            }),
          );
        } else {
          blocks.push(...blocksFromNodes([child], keyPrefix, context, list));
        }
      }
      continue;
    }
    if (node.type === "list") {
      const listItem = node.ordered ? "number" : "bullet";
      const level = (list?.level ?? 0) + 1;
      for (const item of node.children ?? []) {
        blocks.push(
          ...blocksFromNodes(item.children ?? [], keyPrefix, context, {
            listItem,
            level,
          }),
        );
      }
      continue;
    }
    if (node.type === "code") {
      blocks.push(
        makeBlock(
          [{ type: "inlineCode", value: node.value ?? "" }],
          keyPrefix,
          context,
          {
            style: "normal",
            ...list,
          },
        ),
      );
      continue;
    }
    if (node.type === "thematicBreak") {
      blocks.push(
        makeBlock([{ type: "text", value: "—" }], keyPrefix, context, list),
      );
      continue;
    }
    if (node.children) {
      blocks.push(...blocksFromNodes(node.children, keyPrefix, context, list));
      continue;
    }
    if (node.value)
      blocks.push(
        makeBlock(
          [{ type: "text", value: markdownNodeText(node) }],
          keyPrefix,
          context,
          list,
        ),
      );
  }

  return blocks;
}

export function markdownToPortableText(
  markdown: string,
  keyPrefix: string,
): SanityPortableTextBlock[] {
  if (!markdown.trim()) return [];
  const tree = fromMarkdown(markdown) as MdastNode;
  const context: MarkdownContext = {
    definitions: collectDefinitions(tree),
    nextBlock: 0,
  };
  return blocksFromNodes(tree.children ?? [], keyPrefix, context);
}

function headingBlock(title: string, itemId: string): SanityPortableTextBlock {
  const context: MarkdownContext = { definitions: new Map(), nextBlock: 0 };
  return makeBlock(
    [{ type: "text", value: title }],
    `${itemId}-heading`,
    context,
    { style: "h2" },
  );
}

export function buildSanityWorkflowGuideDocument(
  recording: Recording,
): SanityWorkflowGuideDocument {
  const content: SanityWorkflowGuideDocument["content"] = [];

  for (const item of guideItems(recording)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)) {
    if (item.kind === "header") {
      content.push(headingBlock(item.title, item.id));
      if (item.body && item.body !== item.title) {
        content.push(...markdownToPortableText(item.body, `${item.id}-body`));
      }
      continue;
    }
    if (item.kind === "tip" || item.kind === "alert") {
      content.push({
        _key: item.id,
        _type: "guideCallout",
        tone: item.kind,
        title: item.title,
        body: markdownToPortableText(item.body, `${item.id}-body`),
      });
      continue;
    }

    content.push({
      _key: item.id,
      _type: "workflowStep",
      title: item.title,
      instruction: markdownToPortableText(item.body, `${item.id}-instruction`),
      ...(item.imageFilename
        ? {
            image: {
              _type: "image" as const,
              _sanityAsset: `image@file://./images/${item.imageFilename}`,
              ...(item.altText ? { alt: item.altText } : {}),
            },
          }
        : {}),
      source: item.source,
      userEdited: item.userEdited,
    });
  }

  return {
    _id: `infosteed-${recording.id}`,
    _type: "workflowGuide",
    title: recording.title,
    purpose: recording.purpose
      ? markdownToPortableText(recording.purpose, `${recording.id}-purpose`)
      : [],
    audience: recording.audience,
    content,
    source: {
      _type: "infosteedSource",
      recordingId: recording.id,
      createdAt: recording.createdAt,
      updatedAt: recording.updatedAt,
      finalizedAt: recording.finalizedAt,
    },
  };
}

function validateImageFilename(filename: string): void {
  if (
    !filename ||
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    /[\0-\x1f\x7f]/.test(filename)
  ) {
    throw new Error(`Invalid image filename: ${filename}`);
  }
}

function validatedImages(
  recording: Recording,
  images: ExportImage[],
): ExportImage[] {
  const available = new Map<string, ExportImage>();
  for (const image of images) {
    validateImageFilename(image.filename);
    if (available.has(image.filename))
      throw new Error(`Duplicate image filename: ${image.filename}`);
    available.set(image.filename, image);
  }

  const referenced = new Set<string>();
  for (const item of guideItems(recording)) {
    if (item.kind !== "step" || !item.imageFilename) continue;
    validateImageFilename(item.imageFilename);
    if (!available.has(item.imageFilename))
      throw new Error(`Referenced image is missing: ${item.imageFilename}`);
    referenced.add(item.imageFilename);
  }

  return [...referenced].sort().map((filename) => available.get(filename)!);
}

async function gzipTar(
  entries: Array<{ name: string; content: Buffer }>,
): Promise<Buffer> {
  const archive = pack();
  const gzip = createGzip();
  archive.pipe(gzip);

  const output = (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of gzip)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  })();

  for (const entry of entries) {
    archive.entry(
      { name: entry.name, size: entry.content.byteLength },
      entry.content,
    );
  }
  archive.finalize();
  return output;
}

export async function buildSanityImportTarGz(
  recording: Recording,
  images: ExportImage[],
  imageFilenameSuffix?: string,
): Promise<Buffer> {
  const selectedImages = validatedImages(recording, images);
  const document = buildSanityWorkflowGuideDocument(
    recordingWithExportImageFilenames(recording, imageFilenameSuffix),
  );
  const ndjson = Buffer.from(`${JSON.stringify(document)}\n`, "utf8");
  return gzipTar([
    { name: "data.ndjson", content: ndjson },
    ...selectedImages.map((image) => ({
      name: `images/${exportImageFilename(image.filename, imageFilenameSuffix)}`,
      content: Buffer.from(image.content),
    })),
  ]);
}

function recordingWithExportImageFilenames(
  recording: Recording,
  imageFilenameSuffix?: string,
): Recording {
  if (!imageFilenameSuffix) return recording;
  const rename = (filename: string | null) =>
    filename ? exportImageFilename(filename, imageFilenameSuffix) : filename;
  return {
    ...recording,
    steps: recording.steps.map((step) => ({
      ...step,
      imageFilename: rename(step.imageFilename),
    })),
    items: recording.items.map((item) => ({
      ...item,
      imageFilename: rename(item.imageFilename),
    })),
  };
}
