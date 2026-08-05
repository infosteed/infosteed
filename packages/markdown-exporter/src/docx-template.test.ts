// SPDX-License-Identifier: AGPL-3.0-only
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { Recording } from "@infosteed/shared";
import {
  buildTemplatedWorkflowDocx,
  inspectWordTemplate,
} from "./docx-template.js";

const recording: Recording = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Customer guide",
  purpose: "Update customer records.",
  audience: null,
  captureMode: "guide",
  state: "finalized",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  finalizedAt: new Date(0).toISOString(),
  events: [],
  steps: [],
  items: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      recordingId: "00000000-0000-4000-8000-000000000001",
      eventId: null,
      ordinal: 0,
      kind: "step",
      title: "Open customers",
      body: "Click **Customers**.",
      imageFilename: "step.webp",
      altText: "Customer list",
      source: "manual",
      userEdited: true,
    },
  ],
};

async function template(options?: {
  bodyTag?: boolean;
  externalRelationship?: boolean;
}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${options?.externalRelationship ? '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>' : ""}</Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style><w:style w:type="paragraph" w:styleId="BodyText"><w:name w:val="Body Text"/></w:style></w:styles>`,
  );
  zip.file(
    "word/numbering.xml",
    `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading1"/><w:lvlText w:val="%1"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading2"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Preserved cover</w:t></w:r></w:p><w:sdt><w:sdtPr><w:tag w:val="INFOSTEED_TITLE"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Old title</w:t></w:r></w:p></w:sdtContent></w:sdt>${options?.bodyTag === false ? "" : '<w:sdt><w:sdtPr><w:tag w:val="INFOSTEED_REPORT_BODY"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Body placeholder</w:t></w:r></w:p></w:sdtContent></w:sdt>'}<w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1134" w:right="1134"/></w:sectPr></w:body></w:document>`,
  );
  zip.file(
    "word/header1.xml",
    `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:sdt><w:sdtPr><w:tag w:val="INFOSTEED_TITLE"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Old header</w:t></w:r></w:p></w:sdtContent></w:sdt></w:hdr>`,
  );
  zip.file(
    "docProps/custom.xml",
    `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property name="Status"><vt:lpwstr>Draft</vt:lpwstr></property><property name="Revision"><vt:lpwstr>0.0</vt:lpwstr></property></Properties>`,
  );
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old title</dc:title><dc:creator>Old author</dc:creator><cp:lastModifiedBy>Old author</cp:lastModifiedBy></cp:coreProperties>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Word template exporter", () => {
  it("validates tagged templates", async () => {
    await expect(inspectWordTemplate(await template())).resolves.toMatchObject({
      valid: true,
      foundTags: ["INFOSTEED_REPORT_BODY", "INFOSTEED_TITLE"],
      missingRequiredTags: [],
      warnings: [],
    });
  });

  it("reports incompatible template styles and multilevel numbering", async () => {
    const missingStyles = await JSZip.loadAsync(await template());
    const styles = await missingStyles.file("word/styles.xml")!.async("string");
    missingStyles.file(
      "word/styles.xml",
      styles
        .replace(
          /<w:style w:type="paragraph" w:styleId="Heading2">.*?<\/w:style>/,
          "",
        )
        .replace(
          /<w:style w:type="paragraph" w:styleId="BodyText">.*?<\/w:style>/,
          "",
        ),
    );
    await expect(
      inspectWordTemplate(
        await missingStyles.generateAsync({ type: "nodebuffer" }),
      ),
    ).resolves.toMatchObject({
      warnings: [
        expect.stringContaining("no Heading2 style"),
        expect.stringContaining("no BodyText style"),
      ],
    });

    const badNumbering = await JSZip.loadAsync(await template());
    const numbering = await badNumbering
      .file("word/numbering.xml")!
      .async("string");
    badNumbering.file(
      "word/numbering.xml",
      numbering.replace('w:val="%1.%2"', 'w:val="%2"'),
    );
    await expect(
      inspectWordTemplate(
        await badNumbering.generateAsync({ type: "nodebuffer" }),
      ),
    ).resolves.toMatchObject({
      warnings: [expect.stringContaining("%1.%2")],
    });
  });

  it("rejects missing anchors and external relationships", async () => {
    await expect(
      inspectWordTemplate(await template({ bodyTag: false })),
    ).rejects.toThrow("no INFOSTEED_REPORT_BODY");
    await expect(
      inspectWordTemplate(await template({ externalRelationship: true })),
    ).rejects.toThrow("external relationship");
  });

  it("rejects oversized, active, unsafe and unsafe-XML templates", async () => {
    await expect(
      inspectWordTemplate(Buffer.alloc(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow("10 MB or smaller");

    const active = await JSZip.loadAsync(await template());
    active.file("word/vbaProject.bin", "macro");
    await expect(
      inspectWordTemplate(await active.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow("active content");

    const unsafe = await JSZip.loadAsync(await template());
    unsafe.file("../outside.txt", "unsafe");
    await expect(
      inspectWordTemplate(await unsafe.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow("unsafe archive path");

    const xml = await JSZip.loadAsync(await template());
    const document = await xml.file("word/document.xml")!.async("string");
    xml.file("word/document.xml", `<!DOCTYPE document>${document}`);
    await expect(
      inspectWordTemplate(await xml.generateAsync({ type: "nodebuffer" })),
    ).rejects.toThrow("document type declaration");
  });

  it("preserves the package and injects metadata, body, images and field refresh", async () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(2_000, 16);
    png.writeUInt32BE(1_000, 20);
    const output = await buildTemplatedWorkflowDocx(
      await template(),
      recording,
      [{ filename: "step.webp", content: png, contentType: "image/png" }],
      {
        title: recording.title,
        purpose: recording.purpose!,
        author: "Test User",
        status: "Final",
        version: "1.0",
        date: "5 August 2026",
        approver: "",
        changeLogDetails: "Initial InfoSteed export",
      },
    );
    const zip = await JSZip.loadAsync(output);
    const document = await zip.file("word/document.xml")!.async("string");
    const header = await zip.file("word/header1.xml")!.async("string");
    const settings = await zip.file("word/settings.xml")!.async("string");
    const properties = await zip.file("docProps/custom.xml")!.async("string");
    const core = await zip.file("docProps/core.xml")!.async("string");

    expect(document).toContain("Preserved cover");
    expect(document).toContain("Customer guide");
    expect(document).toContain("Steps");
    expect(document).toContain("Open customers");
    expect(document).toContain('w:val="Heading2"');
    expect(document).toContain("Click ");
    expect(document).toContain("Customers");
    expect(document).not.toContain('<w:t xml:space="preserve">1. </w:t>');
    expect(document).not.toContain("Body placeholder");
    expect(header).toContain("Customer guide");
    expect(settings).toContain("updateFields");
    expect(settings).toContain('w:val="true"');
    expect(properties).toContain("Final");
    expect(properties).toContain("1.0");
    expect(core).toContain("Customer guide");
    expect(core).toContain("Test User");
    expect(zip.file("word/media/infosteed-step-001.png")).toBeTruthy();
  });
});
