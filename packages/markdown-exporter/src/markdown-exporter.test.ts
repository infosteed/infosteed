// SPDX-License-Identifier: AGPL-3.0-only
import JSZip from "jszip";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";
import { describe, expect, it } from "vitest";
import {
  buildEmbeddedHtml,
  buildWorkflowDocx,
  buildWorkflowZip,
  escapeMarkdown,
  generateGuideMarkdown,
  makeStepImageFilename,
  sectionsForGuideItems,
  validateLocalImageReferences,
} from "./index";
import {
  buildSanityImportTarGz,
  buildSanityWorkflowGuideDocument,
  markdownToPortableText,
} from "./sanity";
import type { Recording } from "@infosteed/shared";

async function readTarGz(buffer: Buffer): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const archive = extract();
  const gunzip = createGunzip();

  const completed = new Promise<void>((resolve, reject) => {
    gunzip.on("error", reject);
    archive.on("error", reject);
    archive.on("finish", resolve);
    archive.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk) =>
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
      );
      stream.on("error", reject);
      stream.on("end", () => {
        files.set(header.name, Buffer.concat(chunks));
        next();
      });
      stream.resume();
    });
  });

  Readable.from(buffer).pipe(gunzip).pipe(archive);
  await completed;
  return files;
}

const recording: Recording = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Update a customer record",
  purpose: null,
  audience: null,
  captureMode: "guide",
  state: "finalized",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  finalizedAt: new Date(0).toISOString(),
  events: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      ordinal: 0,
      actionType: "click",
      pageTitle: "Customers",
      sanitizedUrl: "https://example.com/customers",
      elementName: "Customers",
      metadata: {},
    },
  ],
  steps: [
    {
      id: "00000000-0000-4000-8000-000000000003",
      recordingId: "00000000-0000-4000-8000-000000000001",
      eventId: "00000000-0000-4000-8000-000000000002",
      ordinal: 0,
      title: "Open customers",
      instruction: "Click **Customers**.",
      imageFilename: "step-001-open-customers.webp",
      altText: "Customers navigation",
      source: "deterministic",
      userEdited: false,
    },
  ],
  items: [
    {
      id: "00000000-0000-4000-8000-000000000004",
      recordingId: "00000000-0000-4000-8000-000000000001",
      eventId: null,
      ordinal: 0,
      kind: "header",
      title: "Before you start",
      body: "Before you start",
      imageFilename: null,
      altText: null,
      source: "manual",
      userEdited: true,
    },
    {
      id: "00000000-0000-4000-8000-000000000005",
      recordingId: "00000000-0000-4000-8000-000000000001",
      eventId: null,
      ordinal: 1,
      kind: "tip",
      title: "Tip",
      body: "Use the search box for long lists.",
      imageFilename: null,
      altText: null,
      source: "manual",
      userEdited: true,
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      recordingId: "00000000-0000-4000-8000-000000000001",
      eventId: "00000000-0000-4000-8000-000000000002",
      ordinal: 2,
      kind: "step",
      title: "Open customers",
      body: "Click **Customers**.",
      imageFilename: "step-001-open-customers.webp",
      altText: "Customers navigation",
      source: "deterministic",
      userEdited: false,
    },
    {
      id: "00000000-0000-4000-8000-000000000006",
      recordingId: "00000000-0000-4000-8000-000000000001",
      eventId: null,
      ordinal: 3,
      kind: "alert",
      title: "Alert",
      body: "Do not save until all fields are checked.",
      imageFilename: null,
      altText: null,
      source: "manual",
      userEdited: true,
    },
  ],
};

describe("markdown exporter", () => {
  it("escapes markdown control characters", () => {
    expect(escapeMarkdown("A [link] *bold*")).toBe("A \\[link\\] \\*bold\\*");
  });

  it("creates deterministic screenshot filenames", () => {
    expect(makeStepImageFilename(0, "Open Login Page!")).toBe(
      "step-001-open-login-page.webp",
    );
  });

  it("uses only local relative image references", () => {
    const markdown = generateGuideMarkdown(recording);
    expect(markdown).toContain(
      "![Customers navigation](./images/step-001-open-customers.webp)",
    );
    expect(markdown).toContain("> **Tip:** Use the search box for long lists.");
    expect(markdown).toContain(
      "> **Alert:** Do not save until all fields are checked.",
    );
    expect(
      validateLocalImageReferences(
        markdown,
        new Set(["step-001-open-customers.webp"]),
      ),
    ).toEqual([]);
  });

  it("rejects remote and unsafe image URLs", () => {
    const errors = validateLocalImageReferences(
      "![x](https://example.com/image.webp)",
      new Set(),
    );
    expect(errors.join("\n")).toContain("Remote or unsafe");
  });

  it("builds the required ZIP structure", async () => {
    const zipBuffer = await buildWorkflowZip(recording, [
      {
        filename: "step-001-open-customers.webp",
        content: Buffer.from("image"),
      },
    ]);
    const zip = await JSZip.loadAsync(zipBuffer);

    expect(zip.file("workflow-guide/guide.md")).toBeTruthy();
    expect(zip.file("workflow-guide/recording.json")).toBeTruthy();
    expect(
      zip.file("workflow-guide/images/step-001-open-customers.webp"),
    ).toBeTruthy();
  });

  it("converts supported markdown and nested lists to Portable Text", () => {
    const blocks = markdownToPortableText(
      "First **bold**, *italic*, `code`, and [link](https://example.com).\n\n- Parent\n  - Child\n\n1. First\n2. Second",
      "markdown-test",
    );

    expect(
      blocks[0].children.find((span) => span.text === "bold")?.marks,
    ).toContain("strong");
    expect(
      blocks[0].children.find((span) => span.text === "italic")?.marks,
    ).toContain("em");
    expect(
      blocks[0].children.find((span) => span.text === "code")?.marks,
    ).toContain("code");
    const linkSpan = blocks[0].children.find((span) => span.text === "link");
    expect(blocks[0].markDefs).toEqual([
      expect.objectContaining({
        _key: linkSpan?.marks[0],
        _type: "link",
        href: "https://example.com",
      }),
    ]);
    expect(
      blocks
        .filter((block) => block.listItem === "bullet")
        .map((block) => block.level),
    ).toEqual([1, 2]);
    expect(blocks.filter((block) => block.listItem === "number")).toHaveLength(
      2,
    );
  });

  it("maps ordered guide items to a deterministic Sanity document", () => {
    const input = {
      ...recording,
      purpose: "For **support** teams.\n\n- Check access",
      audience: "Agents",
    };
    const first = buildSanityWorkflowGuideDocument(input);
    const second = buildSanityWorkflowGuideDocument(input);

    expect(first).toEqual(second);
    expect(first._id).toBe(`infosteed-${recording.id}`);
    expect(first._type).toBe("workflowGuide");
    expect(first.purpose).toHaveLength(2);
    expect(first.content.map((item) => item._type)).toEqual([
      "block",
      "guideCallout",
      "workflowStep",
      "guideCallout",
    ]);
    expect(first.content.every((item) => Boolean(item._key))).toBe(true);
    expect(first.source).toEqual({
      _type: "infosteedSource",
      recordingId: recording.id,
      createdAt: recording.createdAt,
      updatedAt: recording.updatedAt,
      finalizedAt: recording.finalizedAt,
    });
  });

  it("builds a Sanity dataset archive with only referenced images", async () => {
    const archiveBuffer = await buildSanityImportTarGz(recording, [
      {
        filename: "step-001-open-customers.webp",
        content: Buffer.from("referenced"),
      },
      { filename: "unused.webp", content: Buffer.from("unused") },
    ]);
    const files = await readTarGz(archiveBuffer);
    const ndjson = files.get("data.ndjson")?.toString("utf8") ?? "";
    const lines = ndjson.trimEnd().split("\n");
    const document = JSON.parse(lines[0]);

    expect(lines).toHaveLength(1);
    expect(document._id).toBe(`infosteed-${recording.id}`);
    expect(document.content[2].image).toEqual({
      _type: "image",
      _sanityAsset: "image@file://./images/step-001-open-customers.webp",
      alt: "Customers navigation",
    });
    expect(files.get("images/step-001-open-customers.webp")?.toString()).toBe(
      "referenced",
    );
    expect(files.has("images/unused.webp")).toBe(false);
  });

  it("validates Sanity archive image inputs", async () => {
    await expect(buildSanityImportTarGz(recording, [])).rejects.toThrow(
      "Referenced image is missing",
    );
    await expect(
      buildSanityImportTarGz(recording, [
        {
          filename: "step-001-open-customers.webp",
          content: Buffer.from("one"),
        },
        {
          filename: "step-001-open-customers.webp",
          content: Buffer.from("two"),
        },
      ]),
    ).rejects.toThrow("Duplicate image filename");
    await expect(
      buildSanityImportTarGz(recording, [
        { filename: "../unsafe.webp", content: Buffer.from("unsafe") },
      ]),
    ).rejects.toThrow("Invalid image filename");
  });

  it("exports a Sanity guide whose steps do not have images", async () => {
    const imageFree = {
      ...recording,
      steps: recording.steps.map((step) => ({ ...step, imageFilename: null })),
      items: recording.items.map((item) =>
        item.kind === "step" ? { ...item, imageFilename: null } : item,
      ),
    };
    const files = await readTarGz(await buildSanityImportTarGz(imageFree, []));

    expect([...files.keys()]).toEqual(["data.ndjson"]);
    expect(
      JSON.parse(files.get("data.ndjson")!.toString("utf8")).content[2].image,
    ).toBeUndefined();
  });

  it("builds self-contained HTML with embedded images and guide blocks", () => {
    const html = buildEmbeddedHtml(recording, [
      {
        filename: "step-001-open-customers.webp",
        content: Buffer.from("image"),
        contentType: "image/webp",
      },
    ]);

    expect(html).toContain("data:image/webp;base64,");
    expect(html).toContain("Before you start");
    expect(html).toContain('class="section-nav"');
    expect(html).toContain(
      'href="#section-00000000-0000-4000-8000-000000000004"',
    );
    expect(html).toContain('class="callout tip"');
    expect(html).toContain('class="callout alert"');
  });

  it("builds a Word docx with embedded image media", async () => {
    const docxBuffer = await buildWorkflowDocx(
      recording,
      [
        {
          filename: "step-001-open-customers.webp",
          content: Buffer.from("png-image"),
          contentType: "image/png",
        },
      ],
      {
        displayName: "Acme Support",
        docxIcon: {
          filename: "branding-icon.png",
          content: Buffer.from("brand-image"),
          contentType: "image/png",
        },
      },
    );
    const docx = await JSZip.loadAsync(docxBuffer);
    const documentXml = await docx.file("word/document.xml")?.async("string");

    expect(docx.file("[Content_Types].xml")).toBeTruthy();
    expect(docx.file("word/_rels/document.xml.rels")).toBeTruthy();
    expect(docx.file("word/media/branding-icon.png")).toBeTruthy();
    expect(docx.file("word/media/step-001-open-customers.png")).toBeTruthy();
    expect(documentXml).toContain("Update a customer record");
    expect(documentXml).toContain("Acme Support");
    expect(documentXml).toContain("Click ");
  });

  it("derives ordered sections from header guide items", () => {
    const secondHeader = {
      ...recording.items[0],
      id: "00000000-0000-4000-8000-000000000007",
      ordinal: 4,
      title: "Review changes",
      body: "Review changes",
    };
    const secondStep = {
      ...recording.items[2],
      id: "00000000-0000-4000-8000-000000000008",
      ordinal: 5,
      title: "Save changes",
      body: "Click **Save**.",
      imageFilename: null,
    };

    const sections = sectionsForGuideItems([
      ...recording.items,
      secondHeader,
      secondStep,
    ]);

    expect(sections.map((section) => section.title)).toEqual([
      "Before you start",
      "Review changes",
    ]);
    expect(
      sections.map((section) => section.items.map((item) => item.kind)),
    ).toEqual([
      ["header", "tip", "step", "alert"],
      ["header", "step"],
    ]);
  });

  it("omits HTML section nav for the single fallback section", () => {
    const html = buildEmbeddedHtml({ ...recording, items: [] }, [
      {
        filename: "step-001-open-customers.webp",
        content: Buffer.from("image"),
        contentType: "image/webp",
      },
    ]);

    expect(html).not.toContain('class="section-nav"');
    expect(html).toContain("Click <strong>Customers</strong>.");
  });
});
