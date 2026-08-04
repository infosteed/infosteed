// SPDX-License-Identifier: AGPL-3.0-only
import JSZip from "jszip";
import type { GuideItem, GuideStep, Recording } from "@infosteed/shared";

const REMOTE_IMAGE_PATTERNS = [
  /https?:\/\//i,
  /s3:\/\//i,
  /blob:/i,
  /data:/i,
  /chrome-extension:/i,
];

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

export function slugifyFilename(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "step";
}

export function makeStepImageFilename(ordinal: number, title: string): string {
  const number = String(ordinal + 1).padStart(3, "0");
  return `step-${number}-${slugifyFilename(title)}.webp`;
}

function itemsForRecording(
  recording: Pick<Recording, "steps"> & Partial<Pick<Recording, "items">>,
): GuideItem[] {
  if (recording.items && recording.items.length > 0) return recording.items;
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

export interface GuideExportSection {
  id: string;
  title: string;
  items: GuideItem[];
}

export function sectionsForGuideItems(
  items: GuideItem[],
): GuideExportSection[] {
  const sections: GuideExportSection[] = [];
  let current: GuideExportSection | undefined;

  for (const item of items.slice().sort((a, b) => a.ordinal - b.ordinal)) {
    if (item.kind === "header") {
      current = { id: `section-${item.id}`, title: item.title, items: [item] };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { id: "section-steps", title: "Steps", items: [] };
      sections.push(current);
    }
    current.items.push(item);
  }

  return sections.length > 0
    ? sections
    : [{ id: "section-steps", title: "Steps", items: [] }];
}

export function stepFromItem(item: GuideItem): GuideStep {
  return {
    id: item.id,
    recordingId: item.recordingId,
    eventId: item.eventId,
    ordinal: item.ordinal,
    title: item.title,
    instruction: item.body,
    imageFilename: item.imageFilename,
    altText: item.altText,
    source: item.source,
    userEdited: item.userEdited,
  };
}

export function generateGuideMarkdown(
  recording: Pick<Recording, "title" | "steps"> &
    Partial<Pick<Recording, "items" | "purpose">>,
): string {
  const lines = [`# ${escapeMarkdown(recording.title)}`, ""];
  if (recording.purpose) lines.push(recording.purpose, "");
  let stepNumber = 0;

  itemsForRecording(recording)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .forEach((item) => {
      if (item.kind === "header") {
        lines.push(`## ${escapeMarkdown(item.title)}`);
        if (item.body && item.body !== item.title) lines.push("", item.body);
      } else if (item.kind === "tip") {
        lines.push(`> **Tip:** ${item.body}`);
      } else if (item.kind === "alert") {
        lines.push(`> **Alert:** ${item.body}`);
      } else {
        stepNumber += 1;
        lines.push(`${stepNumber}. ${item.body}`);
      }

      if (item.kind === "step" && item.imageFilename) {
        lines.push("");
        lines.push(
          `   ![${escapeMarkdown(item.altText ?? item.title)}](./images/${item.imageFilename})`,
        );
      }
      lines.push("");
    });

  return lines.join("\n").trimEnd() + "\n";
}

export function validateLocalImageReferences(
  markdown: string,
  availableImages: Set<string>,
): string[] {
  const errors: string[] = [];
  const imageRefPattern = /!\[[^\]]*]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = imageRefPattern.exec(markdown))) {
    const reference = match[1];
    if (REMOTE_IMAGE_PATTERNS.some((pattern) => pattern.test(reference))) {
      errors.push(
        `Remote or unsafe image reference is not allowed: ${reference}`,
      );
    }
    if (!reference.startsWith("./images/")) {
      errors.push(`Image reference must use ./images/: ${reference}`);
    }
    const filename = reference.replace("./images/", "");
    if (filename.includes("/") || filename.includes("..")) {
      errors.push(`Image filename must stay inside images/: ${reference}`);
    }
    if (!availableImages.has(filename)) {
      errors.push(`Referenced image is missing: ${reference}`);
    }
  }

  return errors;
}

export interface ExportImage {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
}

export interface ExportBranding {
  displayName?: string | null;
  iconDataUrl?: string | null;
  docxIcon?: ExportImage | null;
}

export async function buildWorkflowZip(
  recording: Recording,
  images: ExportImage[],
): Promise<Buffer> {
  const zip = new JSZip();
  const root = zip.folder("workflow-guide");
  if (!root) throw new Error("Could not create workflow-guide folder");

  const imageFolder = root.folder("images");
  if (!imageFolder) throw new Error("Could not create images folder");

  const availableImages = new Set(images.map((image) => image.filename));
  const markdown = generateGuideMarkdown(recording);
  const errors = validateLocalImageReferences(markdown, availableImages);
  if (errors.length > 0) throw new Error(errors.join("; "));

  root.file("guide.md", markdown);
  root.file(
    "recording.json",
    JSON.stringify(
      {
        ...recording,
        events: recording.events.map((event) => ({
          ...event,
          metadata: event.metadata ?? {},
        })),
      },
      null,
      2,
    ),
  );

  for (const image of images) {
    if (image.filename.includes("/") || image.filename.includes("..")) {
      throw new Error(`Invalid image filename: ${image.filename}`);
    }
    imageFolder.file(image.filename, image.content);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function imageFilenamesForSteps(steps: GuideStep[]): string[] {
  return steps.flatMap((step) =>
    step.imageFilename ? [step.imageFilename] : [],
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function docxRuns(value: string): string {
  const runs: string[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex)
      runs.push(
        `<w:r><w:t xml:space="preserve">${escapeXml(value.slice(lastIndex, match.index))}</w:t></w:r>`,
      );
    runs.push(
      `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(match[1])}</w:t></w:r>`,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length)
    runs.push(
      `<w:r><w:t xml:space="preserve">${escapeXml(value.slice(lastIndex))}</w:t></w:r>`,
    );
  return runs.join("");
}

function docxParagraph(value: string, style?: string): string {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}${docxRuns(value)}</w:p>`;
}

function docxImage(
  relId: string,
  name: string,
  altText: string,
  size?: { cx: number; cy: number },
): string {
  const cx = size?.cx ?? 5_486_400;
  const cy = size?.cy ?? 3_429_000;
  return `<w:p><w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${cx}" cy="${cy}"/>
      <wp:docPr id="${escapeXml(relId.replace(/\D/g, "") || "1")}" name="${escapeXml(name)}" descr="${escapeXml(altText)}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(name)}" descr="${escapeXml(altText)}"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r></w:p>`;
}

function basenameWithoutExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export async function buildWorkflowDocx(
  recording: Recording,
  images: ExportImage[],
  branding?: ExportBranding,
): Promise<Buffer> {
  const zip = new JSZip();
  const imageMap = new Map(images.map((image) => [image.filename, image]));
  const mediaFiles: Array<{
    sourceFilename: string;
    mediaFilename: string;
    image: ExportImage;
    relId: string;
  }> = [];
  const body: string[] = [];

  if (branding?.docxIcon) {
    const mediaFilename = "branding-icon.png";
    const relId = `rId${mediaFiles.length + 1}`;
    mediaFiles.push({
      sourceFilename: branding.docxIcon.filename,
      mediaFilename,
      image: branding.docxIcon,
      relId,
    });
    body.push(
      docxImage(relId, mediaFilename, branding.displayName ?? "Brand icon", {
        cx: 609_600,
        cy: 609_600,
      }),
    );
  }

  body.push(docxParagraph(recording.title, "Title"));
  if (recording.purpose) body.push(docxParagraph(recording.purpose));

  let stepNumber = 0;
  for (const item of itemsForRecording(recording)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)) {
    if (item.kind === "header") {
      body.push(docxParagraph(item.title, "Heading1"));
      if (item.body && item.body !== item.title)
        body.push(docxParagraph(item.body));
      continue;
    }

    if (item.kind === "tip" || item.kind === "alert") {
      body.push(
        docxParagraph(`${item.kind === "tip" ? "Tip" : "Alert"}: ${item.body}`),
      );
      continue;
    }

    stepNumber += 1;
    body.push(docxParagraph(`${stepNumber}. ${item.body}`));
    if (item.imageFilename) {
      const image = imageMap.get(item.imageFilename);
      if (!image)
        throw new Error(
          `Referenced image is missing for Word export: ${item.imageFilename}`,
        );
      const relId = `rId${mediaFiles.length + 1}`;
      const mediaFilename = `${basenameWithoutExtension(item.imageFilename)}.png`;
      mediaFiles.push({
        sourceFilename: item.imageFilename,
        mediaFilename,
        image,
        relId,
      });
      body.push(docxImage(relId, mediaFilename, item.altText ?? item.title));
    }
  }

  const relationships = mediaFiles
    .map(
      (file) =>
        `<Relationship Id="${file.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escapeXml(file.mediaFilename)}"/>`,
    )
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
</w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="w14 wp14"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );

  for (const file of mediaFiles) {
    if (file.mediaFilename.includes("/") || file.mediaFilename.includes("..")) {
      throw new Error(
        `Invalid Word export image filename: ${file.sourceFilename}`,
      );
    }
    zip.file(`word/media/${file.mediaFilename}`, file.image.content);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function renderInlineMarkdownHtml(value: string): string {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function buildEmbeddedHtml(
  recording: Recording,
  images: ExportImage[],
  branding?: ExportBranding,
): string {
  const imageData = new Map(
    images.map((image) => [
      image.filename,
      `data:${image.contentType ?? "image/webp"};base64,${Buffer.from(image.content).toString("base64")}`,
    ]),
  );
  let stepNumber = 0;
  const sections = sectionsForGuideItems(itemsForRecording(recording));
  const showNav = sections.length > 1 || sections[0]?.title !== "Steps";
  const nav = showNav
    ? `<nav class="section-nav" aria-label="Guide sections">${sections
        .map(
          (section, index) =>
            `<a href="#${escapeHtml(section.id)}"><span>${escapeHtml(section.title)}</span><small>${index + 1}</small></a>`,
        )
        .join("")}</nav>`
    : "";
  const brandIcon = branding?.iconDataUrl
    ? `<img class="brand-icon" src="${escapeHtml(branding.iconDataUrl)}" alt="${escapeHtml(
        branding.displayName ?? "Deployment icon",
      )}" />`
    : "";
  const body = sections
    .map((section) => {
      const content = section.items
        .map((item) => {
          if (item.kind === "header") {
            return `<section class="guide-section"><h2>${escapeHtml(item.title)}</h2>${
              item.body && item.body !== item.title
                ? `<p>${renderInlineMarkdownHtml(item.body)}</p>`
                : ""
            }</section>`;
          }
          if (item.kind === "tip" || item.kind === "alert") {
            const label = item.kind === "tip" ? "Tip" : "Alert";
            return `<aside class="callout ${item.kind}"><strong>${label}</strong><p>${renderInlineMarkdownHtml(item.body)}</p></aside>`;
          }

          stepNumber += 1;
          const image = item.imageFilename
            ? imageData.get(item.imageFilename)
            : undefined;
          return `<section class="step"><div class="step-number">${stepNumber}</div><div class="step-body"><p>${renderInlineMarkdownHtml(
            item.body,
          )}</p>${
            image
              ? `<img src="${image}" alt="${escapeHtml(item.altText ?? item.title)}" />`
              : ""
          }</div></section>`;
        })
        .join("\n");
      return `<section id="${escapeHtml(section.id)}" class="guide-section-group">${content}</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(recording.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f6f8; color: #111827; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .guide-layout { max-width: 1180px; margin: 0 auto; padding: 40px 28px; display: grid; grid-template-columns: minmax(0, 920px); justify-content: center; gap: 32px; }
    .guide-layout.with-nav { grid-template-columns: 220px minmax(0, 920px); align-items: start; justify-content: initial; }
    main { background: #fff; min-height: 100vh; padding: 40px 28px; }
    .title-row { position: relative; padding-right: 78px; }
    .brand-icon { position: absolute; top: 0; right: 0; width: 52px; height: 52px; object-fit: contain; border: 0; border-radius: 8px; }
    h1 { margin: 0 0 28px; font-size: 30px; line-height: 1.2; }
    .overview { margin: -12px 0 30px; color: #475467; font-size: 17px; }
    h2 { margin: 28px 0 10px; font-size: 22px; }
    .section-nav { position: sticky; top: 24px; overflow: hidden; border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; }
    .section-nav a { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 11px 13px; border-bottom: 1px solid #eaecf0; color: #344054; text-decoration: none; }
    .section-nav a:last-child { border-bottom: 0; }
    .section-nav a:hover { background: #eff8ff; color: #175cd3; }
    .section-nav small { color: #667085; font-size: 12px; }
    .step { display: grid; grid-template-columns: 42px 1fr; gap: 16px; margin: 0 0 30px; page-break-inside: avoid; }
    .step-number { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: #dbeafe; color: #1d4ed8; font-weight: 700; }
    .step-body p { margin: 4px 0 12px; }
    img { display: block; max-width: 100%; border: 1px solid #d0d5dd; border-radius: 6px; }
    .callout { margin: 18px 0 26px; padding: 14px 16px; border-left: 4px solid; border-radius: 6px; page-break-inside: avoid; }
    .callout p { margin: 6px 0 0; }
    .tip { background: #eff8ff; border-color: #2e90fa; }
    .alert { background: #fffaeb; border-color: #f79009; }
    .guide-section { margin: 28px 0 16px; page-break-after: avoid; }
    .guide-section-group { scroll-margin-top: 24px; }
    @media (max-width: 860px) { .guide-layout.with-nav { grid-template-columns: 1fr; } .section-nav { position: static; } }
    @media print { body { background: #fff; } .guide-layout { display: block; max-width: 920px; padding: 0; } main { padding: 24px; } .section-nav { display: none; } }
  </style>
</head>
<body>
  <div class="${showNav ? "guide-layout with-nav" : "guide-layout"}">
    ${nav}
    <main>
      <div class="title-row">
        ${brandIcon}
        <h1>${escapeHtml(recording.title)}</h1>
        ${recording.purpose ? `<p class="overview">${renderInlineMarkdownHtml(recording.purpose)}</p>` : ""}
      </div>
      ${body}
    </main>
  </div>
</body>
</html>`;
}
