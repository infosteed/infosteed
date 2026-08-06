// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminController } from "../features/admin/useAdminController";
import { AdminPanel } from "./AdminPanel";

vi.mock("../features/admin/useAdminController", () => ({
  useAdminController: vi.fn(),
}));

function controller() {
  return {
    users: [],
    projects: [],
    members: [],
    selectedProjectId: "",
    setSelectedProjectId: vi.fn(),
    memberUserId: "",
    setMemberUserId: vi.fn(),
    memberRole: "viewer" as const,
    setMemberRole: vi.fn(),
    branding: { displayName: "InfoSteed", iconDataUrl: null },
    setBranding: vi.fn(),
    wordTemplates: [],
    extensionArtifacts: [
      {
        id: "chrome-offline",
        browser: "chrome" as const,
        capability: "full" as const,
        filename: "extension-offline.zip",
        contentType: "application/zip",
        byteSize: 1024,
        sha256: "a".repeat(64),
        installStatus: "available" as const,
      },
      {
        id: "firefox-offline",
        browser: "firefox" as const,
        capability: "guide-only" as const,
        filename: "firefox-offline.xpi",
        contentType: "application/x-xpinstall",
        byteSize: 2048,
        sha256: "b".repeat(64),
        installStatus: "available" as const,
      },
    ],
    newUser: {
      username: "",
      displayName: "",
      password: "",
      role: "user" as const,
    },
    setNewUser: vi.fn(),
    error: undefined,
    systemStatus: {
      protocolVersion: 1,
      providers: {},
      workers: {},
      queues: {},
    },
    twoFactorResetUser: undefined,
    setTwoFactorResetUser: vi.fn(),
    twoFactorResetProof: { currentPassword: "", code: "" },
    setTwoFactorResetProof: vi.fn(),
    addUser: vi.fn(),
    readIcon: vi.fn(),
    updateBrandingName: vi.fn(),
    uploadTemplate: vi.fn(),
    renameTemplate: vi.fn(),
    setDefaultTemplate: vi.fn(),
    removeTemplate: vi.fn(),
    addMember: vi.fn(),
    toggleProjectPrivate: vi.fn(),
    updateUserRole: vi.fn(),
    toggleUserEnabled: vi.fn(),
    removeUser: vi.fn(),
    toggleTwoFactorRequirement: vi.fn(),
    removeMember: vi.fn(),
    confirmTwoFactorReset: vi.fn(),
  };
}

describe("AdminPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders bundled browser extension downloads", () => {
    vi.mocked(useAdminController).mockReturnValue(controller());

    render(<AdminPanel onClose={vi.fn()} />);

    expect(screen.getAllByText("Browser Extensions").length).toBeGreaterThan(0);
    expect(screen.getByText("extension-offline.zip")).toBeTruthy();
    expect(screen.getByText("firefox-offline.xpi")).toBeTruthy();
    expect(screen.getByText("Video and guide capture")).toBeTruthy();
    expect(screen.getByText("Guide Only")).toBeTruthy();
    expect(
      screen.getByText(
        "For Firefox, install the signed XPI with your managed browser policy or temporary add-on workflow.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Download" })
        .map((link) => link.getAttribute("href")),
    ).toContain("/api/admin/extensions/chrome-offline/download");
    expect(
      screen
        .getAllByRole("link", { name: "Download" })
        .map((link) => link.getAttribute("href")),
    ).toContain("/api/admin/extensions/firefox-offline/download");
  });

  it("hides Firefox messaging when the API supplies Chrome only", () => {
    const chromeOnly = controller();
    chromeOnly.extensionArtifacts = [chromeOnly.extensionArtifacts[0]];
    vi.mocked(useAdminController).mockReturnValue(chromeOnly);

    render(<AdminPanel onClose={vi.fn()} />);

    expect(screen.getByText("extension-offline.zip")).toBeTruthy();
    expect(screen.queryByText("firefox-offline.xpi")).toBeNull();
    expect(
      screen.queryByText(
        "For Firefox, install the signed XPI with your managed browser policy or temporary add-on workflow.",
      ),
    ).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: "Download" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/api/admin/extensions/chrome-offline/download"]);
  });
});
