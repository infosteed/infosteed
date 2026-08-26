// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  projectForImport,
  scribeImportCompletionStatus,
} from "./scribeImportWorker";
import type {
  ScribeImportAssetRow,
  ScribeImportJobRow,
} from "./repositories/scribeImports";

const markdown = `# Imported guide
#### [Made by Example with Scribe](https://scribehow.com/example)

1\\. Open [Settings](https://example.com/settings)

2\\. Select **Save**

![](https://images.example.com/save.png)
`;

function job(): ScribeImportJobRow {
  const now = new Date("2026-08-12T12:00:00.000Z");
  return {
    id: "00000000-0000-4000-8000-000000000080",
    created_by_user_id: "00000000-0000-4000-8000-000000000001",
    project_id: "00000000-0000-4000-8000-000000000002",
    status: "processing",
    original_filename: "guide.md",
    source_markdown: markdown,
    source_url: "https://scribehow.com/example",
    recording_id: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
  };
}

describe("Scribe import worker", () => {
  it.each([
    [0, "completed"],
    [1, "completed_with_warnings"],
    [3, "completed_with_warnings"],
    [4, "failed"],
  ] as const)("maps %i missing images to %s", (count, expected) => {
    expect(scribeImportCompletionStatus(count)).toBe(expected);
  });

  it("builds a finalized project while preserving missing-image steps", () => {
    const asset: ScribeImportAssetRow = {
      id: "00000000-0000-4000-8000-000000000081",
      job_id: job().id,
      step_ordinal: 1,
      source_url: "https://images.example.com/save.png",
      filename: "scribe-step-002.webp",
      status: "downloaded",
      attempts: 1,
      next_attempt_at: null,
      source_byte_size: 3,
      image_data: Buffer.from([1, 2, 3]),
      error_message: null,
    };
    const project = projectForImport(job(), [asset]);

    expect(project.version).toBe(2);
    expect(project.recording.state).toBe("finalized");
    expect(project.items).toHaveLength(2);
    expect(project.items[0].imageFilename).toBeNull();
    expect(project.items[0].body).toContain("[Settings]");
    expect(project.items[1].imageFilename).toBe("scribe-step-002.webp");
    expect(project.screenshots).toHaveLength(1);
    expect(project.recording.events[0].metadata).toMatchObject({
      importedFrom: "scribe-markdown",
    });
  });
});
