// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listWordTemplates } from "../../api";
import { RecordingHeader } from "./RecordingHeader";
import type { RecordingController } from "./useRecordingController";

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  listWordTemplates: vi.fn(),
}));

const templates = [
  {
    id: "00000000-0000-4000-8000-000000000020",
    name: "QA Main",
    originalFilename: "qa.docx",
    sha256: "a".repeat(64),
    isDefault: true,
    inspection: {
      valid: true,
      foundTags: ["INFOSTEED_REPORT_BODY"],
      missingRequiredTags: [],
      warnings: [],
    },
    uploadedByUserId: null,
    uploadedByDisplayName: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "00000000-0000-4000-8000-000000000021",
    name: "Operations",
    originalFilename: "operations.docx",
    sha256: "b".repeat(64),
    isDefault: false,
    inspection: {
      valid: true,
      foundTags: ["INFOSTEED_REPORT_BODY"],
      missingRequiredTags: [],
      warnings: [],
    },
    uploadedByUserId: null,
    uploadedByDisplayName: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

describe("recording Word template exports", () => {
  beforeEach(() => {
    vi.mocked(listWordTemplates).mockResolvedValue({ templates });
  });

  it("offers the default, standard and alternate Word templates", async () => {
    const controller = {
      recording: {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Guide",
        purpose: null,
        audience: null,
        captureMode: "guide",
        state: "finalized",
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        finalizedAt: new Date(0).toISOString(),
        events: [],
        steps: [],
        items: [],
        userRole: "admin",
      },
      viewOnly: false,
      setViewOnly: vi.fn(),
      setSelectedItemId: vi.fn(),
      previewOpen: false,
      setPreviewOpen: vi.fn(),
      headerMoreRef: { current: null },
      setHeaderMoreOpen: vi.fn(),
      setAccessOpen: vi.fn(),
      setVersionsOpen: vi.fn(),
      captureMoreStatus: "idle",
      handleCaptureMore: vi.fn(),
      importInputRef: { current: null },
      handleProjectImport: vi.fn(),
      setDeleteCurrentOpen: vi.fn(),
    } as unknown as RecordingController;

    render(<RecordingHeader controller={controller} contentView="guide" />);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Word — QA Main" })).toBeTruthy(),
    );
    expect(
      screen
        .getByRole("link", { name: "Word — Standard" })
        .getAttribute("href"),
    ).toContain("templateId=standard");
    expect(
      screen
        .getByRole("link", { name: "Word — Operations" })
        .getAttribute("href"),
    ).toContain(templates[1].id);
  });
});
