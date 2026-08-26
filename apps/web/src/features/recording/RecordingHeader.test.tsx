// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  afterEach(cleanup);

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

  it("explains manual Confluence import and downloads the standard DOCX", async () => {
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: "Confluence (DOCX)" }));

    expect(
      screen.getByRole("heading", { name: "Export to Confluence" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/does not stay synchronized with InfoSteed/),
    ).toBeTruthy();
    expect(screen.getByText("How to import")).toBeTruthy();
    expect(screen.getByText(/Templates and import/)).toBeTruthy();
    const download = screen.getByRole("link", { name: "Download DOCX" });
    expect(download.getAttribute("href")).toContain(
      "/recordings/00000000-0000-4000-8000-000000000001/export/word?templateId=standard",
    );
  });
});
