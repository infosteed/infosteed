// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseScribeMarkdown,
  ScribeMarkdownParseError,
} from "./scribeMarkdown";

describe("Scribe Markdown parser", () => {
  it("parses the supplied Scribe export fixture", async () => {
    const markdown = await readFile(
      new URL("../../../temp/screibemdexport.md", import.meta.url),
      "utf8",
    );
    const parsed = parseScribeMarkdown(markdown);

    expect(parsed.title).toBe("Create Heat Map in Azimap Platform");
    expect(parsed.sourceUrl).toContain("scribehow.com/");
    expect(parsed.steps).toHaveLength(13);
    expect(parsed.steps.filter((step) => step.imageUrl)).toHaveLength(12);
    expect(parsed.steps[0].imageUrl).toBeNull();
    expect(parsed.steps[0].body).toContain(
      "[YOURMAP](https://azimuth.azimap.com/",
    );
    expect(parsed.steps[1].imageUrl).toContain(
      "colony-recorder.s3.us-west-1.amazonaws.com",
    );
  });

  it("accepts ordinary numbering and preserves multiline Markdown", () => {
    const parsed = parseScribeMarkdown(`# Example

1. Select **Settings** and use:

- [Profile](https://example.com/profile)
- Security

![](https://images.example.com/one.png)

2. Save the form
`);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0].body).toContain("**Settings**");
    expect(parsed.steps[0].body).toContain("- Security");
    expect(parsed.steps[0].outlineTitle).toContain("Select Settings");
  });

  it.each([
    ["missing title", "1\\. Do something"],
    ["missing steps", "# Title\n\nNothing to do"],
    [
      "image outside a step",
      "# Title\n\n![](https://example.com/outside.png)\n\n1\\. Do something",
    ],
    [
      "multiple step images",
      "# Title\n\n1\\. Do something\n\n![](https://example.com/one.png)\n![](https://example.com/two.png)",
    ],
    [
      "insecure image",
      "# Title\n\n1\\. Do something\n\n![](http://example.com/one.png)",
    ],
  ])("rejects %s", (_name, markdown) => {
    expect(() => parseScribeMarkdown(markdown)).toThrow(
      ScribeMarkdownParseError,
    );
  });

  it("enforces the 500-step limit", () => {
    const steps = Array.from(
      { length: 501 },
      (_, index) => `${index + 1}\\. Step ${index + 1}`,
    ).join("\n\n");
    expect(() => parseScribeMarkdown(`# Too many\n\n${steps}`)).toThrow(
      /more than 500 steps/,
    );
  });
});
