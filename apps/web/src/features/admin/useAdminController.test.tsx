// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteUser,
  deleteWordTemplate,
  getAdminSystemStatus,
  getBranding,
  listAdminExtensions,
  listProjects,
  listUsers,
  listWordTemplates,
  updateWordTemplate,
  uploadWordTemplate,
} from "../../api";
import { useAdminController } from "./useAdminController";

vi.mock("../../api", () => ({
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  deleteWordTemplate: vi.fn(),
  getAdminSystemStatus: vi.fn(),
  getBranding: vi.fn(),
  listAdminExtensions: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjects: vi.fn(),
  listUsers: vi.fn(),
  listWordTemplates: vi.fn(),
  removeProjectMember: vi.fn(),
  resetUserTwoFactor: vi.fn(),
  setProjectMember: vi.fn(),
  updateBranding: vi.fn(),
  updateProject: vi.fn(),
  updateUser: vi.fn(),
  updateWordTemplate: vi.fn(),
  uploadWordTemplate: vi.fn(),
}));

const template = {
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
};

describe("admin Word templates controller", () => {
  beforeEach(() => {
    vi.mocked(listUsers).mockResolvedValue({ users: [] });
    vi.mocked(getBranding).mockResolvedValue({
      displayName: "InfoSteed",
      iconDataUrl: null,
    });
    vi.mocked(listProjects).mockResolvedValue({ projects: [] });
    vi.mocked(getAdminSystemStatus).mockResolvedValue({
      protocolVersion: 1,
      providers: {},
      workers: {},
      queues: {},
    });
    vi.mocked(listWordTemplates).mockResolvedValue({ templates: [template] });
    vi.mocked(listAdminExtensions).mockResolvedValue({
      artifacts: [
        {
          id: "chrome-offline",
          browser: "chrome",
          capability: "full",
          filename: "extension-offline.zip",
          contentType: "application/zip",
          byteSize: 6,
          sha256: "b".repeat(64),
          installStatus: "available",
        },
      ],
    });
    vi.mocked(uploadWordTemplate).mockResolvedValue(template);
    vi.mocked(updateWordTemplate).mockResolvedValue(template);
    vi.mocked(deleteWordTemplate).mockResolvedValue(undefined);
    vi.mocked(deleteUser).mockResolvedValue(
      new Response(null, { status: 204 }),
    );
  });

  it("loads, uploads, selects and deletes templates", async () => {
    const { result } = renderHook(() => useAdminController());
    await waitFor(() =>
      expect(result.current.wordTemplates).toEqual([template]),
    );
    expect(result.current.extensionArtifacts).toHaveLength(1);

    const file = new File(["docx"], "Operations.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await act(() => result.current.uploadTemplate(file));
    expect(uploadWordTemplate).toHaveBeenCalledWith({
      name: "Operations",
      file,
    });

    await act(() => result.current.setDefaultTemplate(template.id));
    expect(updateWordTemplate).toHaveBeenCalledWith(template.id, {
      isDefault: true,
    });

    await act(() => result.current.removeTemplate(template.id));
    expect(deleteWordTemplate).toHaveBeenCalledWith(template.id);
  });

  it("deletes users and reloads admin data", async () => {
    const { result } = renderHook(() => useAdminController());
    await waitFor(() =>
      expect(result.current.wordTemplates).toEqual([template]),
    );
    const listCallsBeforeDelete = vi.mocked(listUsers).mock.calls.length;

    await act(() =>
      result.current.removeUser({
        id: "00000000-0000-4000-8000-000000000001",
        username: "old.user",
        displayName: "Old User",
        role: "user",
        enabled: false,
        twoFactorEnabled: false,
        twoFactorRequired: false,
        themePreference: "system",
      }),
    );

    expect(deleteUser).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(listUsers).toHaveBeenCalledTimes(listCallsBeforeDelete + 1);
  });
});
