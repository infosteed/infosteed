// SPDX-License-Identifier: AGPL-3.0-only
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type {
  Document as XmlDocument,
  Element as XmlElement,
  Node as XmlNode,
} from "@xmldom/xmldom";
import JSZip from "jszip";
import type { GuideItem, Recording } from "@infosteed/shared";
import type { ExportImage } from "./index.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 500;
const REQUIRED_BODY_TAG = "INFOSTEED_REPORT_BODY";

export const WORD_TEMPLATE_TEXT_TAGS = [
  "INFOSTEED_TITLE",
  "INFOSTEED_PURPOSE",
  "INFOSTEED_AUTHOR",
  "INFOSTEED_STATUS",
  "INFOSTEED_VERSION",
  "INFOSTEED_DATE",
  "INFOSTEED_APPROVER",
  "INFOSTEED_CHANGELOG_VERSION",
  "INFOSTEED_CHANGELOG_STATUS",
  "INFOSTEED_CHANGELOG_DATE",
  "INFOSTEED_CHANGELOG_DETAILS",
  "INFOSTEED_CHANGELOG_AUTHOR",
] as const;

const KNOWN_TAGS = new Set<string>([
  REQUIRED_BODY_TAG,
  ...WORD_TEMPLATE_TEXT_TAGS,
]);

export interface WordTemplateInspection {
  valid: boolean;
  foundTags: string[];
  missingRequiredTags: string[];
  warnings: string[];
}

export interface WordTemplateMetadata {
  title: string;
  purpose: string;
  author: string;
  status: string;
  version: string;
  date: string;
  approver: string;
  changeLogDetails: string;
}

function parseXml(name: string, xml: string): XmlDocument {
  if (/<!DOCTYPE/i.test(xml))
    throw new Error(`${name} contains a prohibited document type declaration`);
  const errors: string[] = [];
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") errors.push(message);
    },
  }).parseFromString(xml, "application/xml");
  if (
    errors.length > 0 ||
    document.documentElement?.localName === "parsererror"
  )
    throw new Error(`${name} contains malformed XML`);
  return document;
}

function serialize(document: XmlDocument): string {
  return new XMLSerializer().serializeToString(document);
}

function descendants(root: XmlNode, localName: string): XmlElement[] {
  const found: XmlElement[] = [];
  const visit = (node: XmlNode) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const element = child as XmlElement;
      if (element.localName === localName) found.push(element);
      visit(element);
    }
  };
  visit(root);
  return found;
}

function attr(element: XmlElement, namespace: string, name: string): string {
  return (
    element.getAttributeNS(namespace, name) ??
    element.getAttribute(`w:${name}`) ??
    element.getAttribute(name) ??
    ""
  );
}

function templateTag(sdt: XmlElement): string | undefined {
  const properties = Array.from(sdt.childNodes).find(
    (node) => node.nodeType === 1 && (node as XmlElement).localName === "sdtPr",
  ) as XmlElement | undefined;
  const tag = properties && descendants(properties, "tag")[0];
  return tag ? attr(tag, W, "val").trim() || undefined : undefined;
}

function contentControlParts(document: XmlDocument): Array<{
  element: XmlElement;
  tag: string;
}> {
  return descendants(document, "sdt").flatMap((element) => {
    const tag = templateTag(element);
    return tag ? [{ element, tag }] : [];
  });
}

function unsafeArchiveName(name: string): boolean {
  return (
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    name.split("/").includes("..")
  );
}

function prohibitedPart(name: string): boolean {
  return /(^|\/)(?:vbaProject\.bin|activeX\/|embeddings\/)|oleObject/i.test(
    name,
  );
}

function styleElements(document: XmlDocument): Map<string, XmlElement> {
  return new Map(
    descendants(document, "style").flatMap((style) => {
      const id = attr(style, W, "styleId");
      return id ? [[id, style] as const] : [];
    }),
  );
}

function styleNumbering(
  styles: Map<string, XmlElement>,
  styleId: string,
): { numId: string; level?: number } | undefined {
  const visited = new Set<string>();
  let currentId: string | undefined = styleId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const style = styles.get(currentId);
    if (!style) return undefined;
    const numbering = descendants(style, "numPr")[0];
    const numId = numbering && descendants(numbering, "numId")[0];
    if (numId) {
      const value = attr(numId, W, "val");
      if (!value || value === "0") return undefined;
      const level = descendants(numbering, "ilvl")[0];
      const parsedLevel = level ? Number(attr(level, W, "val")) : undefined;
      return {
        numId: value,
        level: Number.isInteger(parsedLevel) ? parsedLevel : undefined,
      };
    }
    const basedOn = descendants(style, "basedOn")[0];
    currentId = basedOn ? attr(basedOn, W, "val") : undefined;
  }
  return undefined;
}

function numberingDefinition(
  document: XmlDocument,
  numId: string,
): XmlElement | undefined {
  const numbering = descendants(document, "num").find(
    (item) => attr(item, W, "numId") === numId,
  );
  const abstractId = numbering && descendants(numbering, "abstractNumId")[0];
  const value = abstractId && attr(abstractId, W, "val");
  return value
    ? descendants(document, "abstractNum").find(
        (item) => attr(item, W, "abstractNumId") === value,
      )
    : undefined;
}

function levelDefinition(
  abstractNumbering: XmlElement,
  level: number,
): XmlElement | undefined {
  return descendants(abstractNumbering, "lvl").find(
    (item) => attr(item, W, "ilvl") === String(level),
  );
}

function templateFormattingWarnings(
  xmlDocuments: Map<string, XmlDocument>,
): string[] {
  const stylesDocument = xmlDocuments.get("word/styles.xml");
  if (!stylesDocument)
    return ["Template has no styles.xml; generated content will use Normal"];

  const warnings: string[] = [];
  const styles = styleElements(stylesDocument);
  const hasHeading1 = styles.has("Heading1");
  const hasHeading2 = styles.has("Heading2");
  if (!hasHeading1)
    warnings.push(
      "Template has no Heading1 style; guide sections will use bold Normal and will not be level-1 TOC entries",
    );
  if (!hasHeading2)
    warnings.push(
      "Template has no Heading2 style; steps will use manually numbered body text and will not be level-2 TOC entries",
    );
  if (!styles.has("BodyText"))
    warnings.push(
      "Template has no BodyText style; instructions, tips and alerts will use Normal",
    );
  if (!hasHeading1 || !hasHeading2) return warnings;

  const heading1Numbering = styleNumbering(styles, "Heading1");
  const heading2Numbering = styleNumbering(styles, "Heading2");
  if (
    !heading1Numbering ||
    !heading2Numbering ||
    heading1Numbering.numId !== heading2Numbering.numId ||
    (heading1Numbering.level ?? 0) !== 0 ||
    heading2Numbering.level !== 1
  ) {
    warnings.push(
      "Heading1 and Heading2 must use the same multilevel list at levels 1 and 2; step headings may not display as 1.1, 1.2",
    );
    return warnings;
  }

  const numberingDocument = xmlDocuments.get("word/numbering.xml");
  const abstractNumbering =
    numberingDocument &&
    numberingDefinition(numberingDocument, heading1Numbering.numId);
  const level1 = abstractNumbering && levelDefinition(abstractNumbering, 0);
  const level2 = abstractNumbering && levelDefinition(abstractNumbering, 1);
  if (!numberingDocument || !abstractNumbering || !level1 || !level2) {
    warnings.push(
      "Heading1 and Heading2 numbering definitions are incomplete; configure one multilevel list with levels 1 and 2",
    );
    return warnings;
  }

  const level1Format = descendants(level1, "numFmt")[0];
  const level2Format = descendants(level2, "numFmt")[0];
  const level1Text = descendants(level1, "lvlText")[0];
  const level2Text = descendants(level2, "lvlText")[0];
  const level1Pattern = level1Text ? attr(level1Text, W, "val") : "";
  const level2Pattern = level2Text ? attr(level2Text, W, "val") : "";
  if (
    !level1Format ||
    !level2Format ||
    attr(level1Format, W, "val") !== "decimal" ||
    attr(level2Format, W, "val") !== "decimal" ||
    !level1Pattern.includes("%1") ||
    level1Pattern.includes("%2") ||
    !/%1.*%2/.test(level2Pattern)
  )
    warnings.push(
      "Heading numbering should use decimal patterns %1 for Heading1 and %1.%2 for Heading2",
    );

  const restart = descendants(level2, "lvlRestart")[0];
  if (restart && attr(restart, W, "val") === "0")
    warnings.push(
      "Heading2 numbering is configured never to restart; restart level 2 after each Heading1 section",
    );
  return warnings;
}

async function loadAndValidateTemplate(
  template: Buffer | Uint8Array,
): Promise<{ zip: JSZip; inspection: WordTemplateInspection }> {
  const source = Buffer.from(template);
  if (source.length === 0) throw new Error("Word template is empty");
  if (source.length > MAX_TEMPLATE_BYTES)
    throw new Error("Word template must be 10 MB or smaller");

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(source, { checkCRC32: true });
  } catch {
    throw new Error("Word template is not a readable DOCX archive");
  }

  const files = Object.values(zip.files);
  if (files.length > MAX_ARCHIVE_ENTRIES)
    throw new Error("Word template contains too many archive entries");

  let expandedBytes = 0;
  for (const file of files) {
    const originalName =
      (file as typeof file & { unsafeOriginalName?: string })
        .unsafeOriginalName ?? file.name;
    if (unsafeArchiveName(originalName))
      throw new Error("Word template contains an unsafe archive path");
    if (prohibitedPart(file.name))
      throw new Error(
        "Word template contains macros or embedded active content",
      );
    if (file.dir) continue;
    const declaredSize = (
      file as typeof file & { _data?: { uncompressedSize?: number } }
    )._data?.uncompressedSize;
    if (declaredSize && expandedBytes + declaredSize > MAX_EXPANDED_BYTES)
      throw new Error("Expanded Word template must be 50 MB or smaller");
    const content = await file.async("uint8array");
    expandedBytes += content.byteLength;
    if (expandedBytes > MAX_EXPANDED_BYTES)
      throw new Error("Expanded Word template must be 50 MB or smaller");
  }

  const requiredParts = [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
  ];
  if (requiredParts.some((name) => !zip.file(name)))
    throw new Error("Archive is missing required Word document parts");

  const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  if (/macroEnabled|vbaProject|activeX|oleObject/i.test(contentTypes))
    throw new Error("Word template contains macros or embedded active content");

  const xmlDocuments = new Map<string, XmlDocument>();
  for (const file of files) {
    if (file.dir || !/\.(?:xml|rels)$/i.test(file.name)) continue;
    const xml = await file.async("string");
    const document = parseXml(file.name, xml);
    xmlDocuments.set(file.name, document);
    if (
      file.name.endsWith(".rels") &&
      descendants(document, "Relationship").some(
        (relationship) =>
          relationship.getAttribute("TargetMode")?.toLowerCase() === "external",
      )
    ) {
      throw new Error("Word template contains an external relationship");
    }
  }

  const document = xmlDocuments.get("word/document.xml")!;
  const documentControls = contentControlParts(document);
  const bodyControls = documentControls.filter(
    ({ tag }) => tag === REQUIRED_BODY_TAG,
  );
  if (bodyControls.length === 0) {
    const untaggedControlCount = descendants(document, "sdt").filter(
      (control) => !templateTag(control),
    ).length;
    throw new Error(
      `Word template has no ${REQUIRED_BODY_TAG} content control (${untaggedControlCount} untagged content controls found). In Microsoft Word, set the content control Tag rather than only its visible placeholder text`,
    );
  }
  if (bodyControls.length > 1)
    throw new Error(
      `Word template has ${bodyControls.length} ${REQUIRED_BODY_TAG} content controls; exactly one is required`,
    );
  if (
    (bodyControls[0].element.parentNode as XmlElement | null)?.localName !==
    "body"
  )
    throw new Error(`${REQUIRED_BODY_TAG} must be a block-level body control`);

  const foundTags = Array.from(
    new Set(
      Array.from(xmlDocuments.entries())
        .filter(
          ([name]) =>
            name === "word/document.xml" ||
            /^word\/(?:header|footer)\d+\.xml$/.test(name),
        )
        .flatMap(([, part]) => contentControlParts(part).map(({ tag }) => tag)),
    ),
  ).sort();
  const warnings = templateFormattingWarnings(xmlDocuments);
  const unknownTags = foundTags.filter(
    (tag) => tag.startsWith("INFOSTEED_") && !KNOWN_TAGS.has(tag),
  );
  if (unknownTags.length > 0)
    warnings.push(`Unknown InfoSteed tags: ${unknownTags.join(", ")}`);

  return {
    zip,
    inspection: {
      valid: true,
      foundTags,
      missingRequiredTags: [],
      warnings,
    },
  };
}

export async function inspectWordTemplate(
  template: Buffer | Uint8Array,
): Promise<WordTemplateInspection> {
  return (await loadAndValidateTemplate(template)).inspection;
}

function itemsForRecording(recording: Recording): GuideItem[] {
  if (recording.items.length > 0) return recording.items;
  return recording.steps.map((step) => ({
    id: step.id,
    recordingId: step.recordingId,
    eventId: step.eventId,
    ordinal: step.ordinal,
    kind: "step" as const,
    title: step.title,
    body: step.instruction,
    imageFilename: step.imageFilename,
    altText: step.altText,
    source: step.source,
    userEdited: step.userEdited,
  }));
}

function createWordElement(document: XmlDocument, name: string): XmlElement {
  return document.createElementNS(W, `w:${name}`);
}

function setWordAttribute(
  element: XmlElement,
  name: string,
  value: string,
): void {
  element.setAttributeNS(W, `w:${name}`, value);
}

function appendRun(
  document: XmlDocument,
  paragraph: XmlElement,
  text: string,
  bold = false,
): void {
  if (!text) return;
  const run = createWordElement(document, "r");
  if (bold) {
    const properties = createWordElement(document, "rPr");
    properties.appendChild(createWordElement(document, "b"));
    run.appendChild(properties);
  }
  const textElement = createWordElement(document, "t");
  textElement.setAttribute("xml:space", "preserve");
  textElement.appendChild(document.createTextNode(text));
  run.appendChild(textElement);
  paragraph.appendChild(run);
}

function appendInlineMarkdown(
  document: XmlDocument,
  paragraph: XmlElement,
  value: string,
): void {
  const pattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    appendRun(document, paragraph, value.slice(cursor, match.index));
    appendRun(document, paragraph, match[1], true);
    cursor = match.index + match[0].length;
  }
  appendRun(document, paragraph, value.slice(cursor));
}

function paragraph(
  document: XmlDocument,
  styleId: string,
  text: string,
  options?: { bold?: boolean; keepNext?: boolean; prefix?: string },
): XmlElement {
  const node = createWordElement(document, "p");
  const properties = createWordElement(document, "pPr");
  const style = createWordElement(document, "pStyle");
  setWordAttribute(style, "val", styleId);
  properties.appendChild(style);
  if (options?.keepNext)
    properties.appendChild(createWordElement(document, "keepNext"));
  node.appendChild(properties);
  if (options?.prefix) appendRun(document, node, options.prefix, true);
  if (options?.bold) appendRun(document, node, text, true);
  else appendInlineMarkdown(document, node, text);
  return node;
}

function pngSize(
  image: ExportImage,
  maxWidth: number,
  maxHeight = 6_858_000,
): { cx: number; cy: number } {
  const content = Buffer.from(image.content);
  if (
    content.length >= 24 &&
    content
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    const width = content.readUInt32BE(16);
    const height = content.readUInt32BE(20);
    if (width > 0 && height > 0) {
      const scale = Math.min(maxWidth / width, maxHeight / height);
      return { cx: Math.round(width * scale), cy: Math.round(height * scale) };
    }
  }
  return { cx: maxWidth, cy: Math.round(maxWidth * 0.625) };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageParagraph(
  document: XmlDocument,
  relId: string,
  name: string,
  altText: string,
  size: { cx: number; cy: number },
  drawingId: number,
): XmlElement {
  const wrapper = parseXml(
    "generated image",
    `<root xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:p><w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${size.cx}" cy="${size.cy}"/><wp:docPr id="${drawingId}" name="${escapeXml(name)}" descr="${escapeXml(altText)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(name)}" descr="${escapeXml(altText)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size.cx}" cy="${size.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></root>`,
  );
  return document.importNode(
    wrapper.documentElement!.firstChild!,
    true,
  ) as XmlElement;
}

function contentWidthEmu(document: XmlDocument, anchor: XmlElement): number {
  let section: XmlElement | undefined;
  for (
    let sibling = anchor.nextSibling;
    sibling && !section;
    sibling = sibling.nextSibling
  ) {
    if (sibling.nodeType !== 1) continue;
    const element = sibling as XmlElement;
    section =
      element.localName === "sectPr"
        ? element
        : descendants(element, "sectPr")[0];
  }
  section ??= descendants(document, "sectPr").at(-1);
  const pageSize = section && descendants(section, "pgSz")[0];
  const margins = section && descendants(section, "pgMar")[0];
  const pageWidth = Number(pageSize ? attr(pageSize, W, "w") : 11906);
  const left = Number(margins ? attr(margins, W, "left") : 1134);
  const right = Number(margins ? attr(margins, W, "right") : 1134);
  return Math.max(1_828_800, (pageWidth - left - right) * 635);
}

function styleIds(zipStyles: string | undefined): Set<string> {
  if (!zipStyles) return new Set(["Normal"]);
  const document = parseXml("word/styles.xml", zipStyles);
  return new Set(
    descendants(document, "style")
      .map((style) => attr(style, W, "styleId"))
      .filter(Boolean),
  );
}

function replaceTextControl(sdt: XmlElement, value: string): void {
  const content = descendants(sdt, "sdtContent")[0];
  if (!content) return;
  const textNodes = descendants(content, "t");
  if (textNodes.length > 0) {
    textNodes[0].textContent = value;
    textNodes[0].setAttribute("xml:space", "preserve");
    for (const text of textNodes.slice(1)) text.textContent = "";
    return;
  }
  const document = sdt.ownerDocument!;
  const paragraphNode = createWordElement(document, "p");
  appendRun(document, paragraphNode, value);
  content.appendChild(paragraphNode);
}

function nextRelationshipId(document: XmlDocument): string {
  const used = new Set(
    descendants(document, "Relationship").map((relationship) =>
      relationship.getAttribute("Id"),
    ),
  );
  let ordinal = 1;
  while (used.has(`rId${ordinal}`)) ordinal += 1;
  return `rId${ordinal}`;
}

function addRelationship(
  document: XmlDocument,
  type: string,
  target: string,
): string {
  const id = nextRelationshipId(document);
  const relationship = document.createElementNS(PACKAGE_REL, "Relationship");
  relationship.setAttribute("Id", id);
  relationship.setAttribute("Type", type);
  relationship.setAttribute("Target", target);
  document.documentElement!.appendChild(relationship);
  return id;
}

function ensurePngContentType(document: XmlDocument): void {
  if (
    descendants(document, "Default").some(
      (item) => item.getAttribute("Extension")?.toLowerCase() === "png",
    )
  )
    return;
  const item = document.createElementNS(CONTENT_TYPES, "Default");
  item.setAttribute("Extension", "png");
  item.setAttribute("ContentType", "image/png");
  document.documentElement!.appendChild(item);
}

function ensureUpdateFields(zip: JSZip): Promise<void> {
  return (async () => {
    const existing = zip.file("word/settings.xml");
    const document = existing
      ? parseXml("word/settings.xml", await existing.async("string"))
      : parseXml(
          "word/settings.xml",
          `<?xml version="1.0" encoding="UTF-8"?><w:settings xmlns:w="${W}"/>`,
        );
    let update = descendants(document, "updateFields")[0];
    if (!update) {
      update = createWordElement(document, "updateFields");
      document.documentElement!.appendChild(update);
    }
    setWordAttribute(update, "val", "true");
    zip.file("word/settings.xml", serialize(document));

    if (!existing) {
      const relationships = parseXml(
        "word/_rels/document.xml.rels",
        await zip.file("word/_rels/document.xml.rels")!.async("string"),
      );
      addRelationship(
        relationships,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings",
        "settings.xml",
      );
      zip.file("word/_rels/document.xml.rels", serialize(relationships));
      const types = parseXml(
        "[Content_Types].xml",
        await zip.file("[Content_Types].xml")!.async("string"),
      );
      const override = types.createElementNS(CONTENT_TYPES, "Override");
      override.setAttribute("PartName", "/word/settings.xml");
      override.setAttribute(
        "ContentType",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml",
      );
      types.documentElement!.appendChild(override);
      zip.file("[Content_Types].xml", serialize(types));
    }
  })();
}

function updateCustomProperties(
  zip: JSZip,
  metadata: WordTemplateMetadata,
): Promise<void> {
  return (async () => {
    const part = zip.file("docProps/custom.xml");
    if (!part) return;
    const document = parseXml(
      "docProps/custom.xml",
      await part.async("string"),
    );
    const values: Record<string, string> = {
      Status: metadata.status,
      Revision: metadata.version,
      "Issue date": metadata.date,
      Approver: metadata.approver,
    };
    for (const property of descendants(document, "property")) {
      const value = values[property.getAttribute("name") ?? ""];
      if (value === undefined) continue;
      const target = Array.from(property.childNodes).find(
        (node) => node.nodeType === 1,
      );
      if (target) target.textContent = value;
    }
    zip.file("docProps/custom.xml", serialize(document));
  })();
}

function updateCoreProperties(
  zip: JSZip,
  metadata: WordTemplateMetadata,
): Promise<void> {
  return (async () => {
    const part = zip.file("docProps/core.xml");
    if (!part) return;
    const document = parseXml("docProps/core.xml", await part.async("string"));
    const values: Record<string, string> = {
      title: metadata.title,
      creator: metadata.author,
      lastModifiedBy: metadata.author,
    };
    for (const [name, value] of Object.entries(values)) {
      for (const target of descendants(document, name))
        target.textContent = value;
    }
    zip.file("docProps/core.xml", serialize(document));
  })();
}

export async function buildTemplatedWorkflowDocx(
  template: Buffer | Uint8Array,
  recording: Recording,
  images: ExportImage[],
  metadata: WordTemplateMetadata,
): Promise<Buffer> {
  const { zip } = await loadAndValidateTemplate(template);
  const imageMap = new Map(images.map((image) => [image.filename, image]));
  const stylesPart = zip.file("word/styles.xml");
  const styles = styleIds(
    stylesPart ? await stylesPart.async("string") : undefined,
  );
  const headingStyle = styles.has("Heading1") ? "Heading1" : "Normal";
  const stepHeadingStyle = styles.has("Heading2") ? "Heading2" : undefined;
  const bodyStyle = styles.has("BodyText") ? "BodyText" : "Normal";
  const documentPart = zip.file("word/document.xml")!;
  const document = parseXml(
    "word/document.xml",
    await documentPart.async("string"),
  );
  const relationshipName = "word/_rels/document.xml.rels";
  const relationshipPart = zip.file(relationshipName);
  const relationships = relationshipPart
    ? parseXml(relationshipName, await relationshipPart.async("string"))
    : parseXml(
        relationshipName,
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PACKAGE_REL}"/>`,
      );
  const types = parseXml(
    "[Content_Types].xml",
    await zip.file("[Content_Types].xml")!.async("string"),
  );
  ensurePngContentType(types);

  const textValues: Record<(typeof WORD_TEMPLATE_TEXT_TAGS)[number], string> = {
    INFOSTEED_TITLE: metadata.title,
    INFOSTEED_PURPOSE: metadata.purpose,
    INFOSTEED_AUTHOR: metadata.author,
    INFOSTEED_STATUS: metadata.status,
    INFOSTEED_VERSION: metadata.version,
    INFOSTEED_DATE: metadata.date,
    INFOSTEED_APPROVER: metadata.approver,
    INFOSTEED_CHANGELOG_VERSION: metadata.version,
    INFOSTEED_CHANGELOG_STATUS: metadata.status,
    INFOSTEED_CHANGELOG_DATE: metadata.date,
    INFOSTEED_CHANGELOG_DETAILS: metadata.changeLogDetails,
    INFOSTEED_CHANGELOG_AUTHOR: metadata.author,
  };

  const taggedPartNames = [
    "word/document.xml",
    ...Object.keys(zip.files).filter((name) =>
      /^word\/(?:header|footer)\d+\.xml$/.test(name),
    ),
  ];
  for (const name of taggedPartNames) {
    const part = zip.file(name);
    if (!part) continue;
    const partDocument =
      name === "word/document.xml"
        ? document
        : parseXml(name, await part.async("string"));
    for (const control of contentControlParts(partDocument)) {
      if (control.tag in textValues)
        replaceTextControl(
          control.element,
          textValues[control.tag as keyof typeof textValues],
        );
    }
    if (name !== "word/document.xml") zip.file(name, serialize(partDocument));
  }

  const bodyControl = contentControlParts(document).find(
    ({ tag }) => tag === REQUIRED_BODY_TAG,
  )!;
  const content = descendants(bodyControl.element, "sdtContent")[0];
  while (content.firstChild) content.removeChild(content.firstChild);
  const items = itemsForRecording(recording)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal);
  if (!items.some((item) => item.kind === "header"))
    content.appendChild(
      paragraph(document, headingStyle, "Steps", {
        bold: headingStyle === "Normal",
      }),
    );

  let stepNumber = 0;
  let drawingId = Math.max(
    1,
    ...descendants(document, "docPr").map(
      (item) => Number(item.getAttribute("id") ?? 0) + 1,
    ),
  );
  const maxImageWidth = contentWidthEmu(document, bodyControl.element);
  for (const item of items) {
    if (item.kind === "header") {
      content.appendChild(
        paragraph(document, headingStyle, item.title, {
          bold: headingStyle === "Normal",
        }),
      );
      if (item.body && item.body !== item.title)
        content.appendChild(paragraph(document, bodyStyle, item.body));
      continue;
    }
    if (item.kind === "tip" || item.kind === "alert") {
      content.appendChild(
        paragraph(document, bodyStyle, item.body, {
          prefix: `${item.kind === "tip" ? "Tip" : "Alert"}: `,
        }),
      );
      continue;
    }

    stepNumber += 1;
    if (stepHeadingStyle) {
      content.appendChild(
        paragraph(
          document,
          stepHeadingStyle,
          item.title || `Step ${stepNumber}`,
          { keepNext: Boolean(item.body || item.imageFilename) },
        ),
      );
      if (item.body && item.body !== item.title)
        content.appendChild(
          paragraph(document, bodyStyle, item.body, {
            keepNext: Boolean(item.imageFilename),
          }),
        );
    } else {
      content.appendChild(
        paragraph(document, bodyStyle, item.body || item.title, {
          prefix: `${stepNumber}. `,
          keepNext: Boolean(item.imageFilename),
        }),
      );
    }
    if (!item.imageFilename) continue;
    const image = imageMap.get(item.imageFilename);
    if (!image)
      throw new Error(
        `Referenced image is missing for Word export: ${item.imageFilename}`,
      );
    const relId = addRelationship(
      relationships,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      `media/infosteed-step-${String(stepNumber).padStart(3, "0")}.png`,
    );
    const mediaName = `infosteed-step-${String(stepNumber).padStart(3, "0")}.png`;
    zip.file(`word/media/${mediaName}`, image.content);
    content.appendChild(
      imageParagraph(
        document,
        relId,
        mediaName,
        item.altText ?? item.title,
        pngSize(image, maxImageWidth),
        drawingId++,
      ),
    );
  }

  zip.file("word/document.xml", serialize(document));
  zip.file(relationshipName, serialize(relationships));
  zip.file("[Content_Types].xml", serialize(types));
  await ensureUpdateFields(zip);
  await updateCustomProperties(zip, metadata);
  await updateCoreProperties(zip, metadata);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
