// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { errorMessage } from "./errors";
import { guideSourceLabel } from "./guide/source";
import { recordingUrl } from "./navigation";
import { RecordingGenerationStatus } from "./components/RecordingGenerationStatus";
import {
  createProject,
  getBranding,
  listProjects,
  listRecordings,
  me,
  setupStatus,
} from "./api";

vi.mock("./api", () => ({
  setupStatus: vi.fn(),
  me: vi.fn(),
  getBranding: vi.fn(),
  listRecordings: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  importProject: vi.fn(),
  deleteRecording: vi.fn(),
  restoreRecording: vi.fn(),
}));

const currentUser = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "owner",
  displayName: "Recording Owner",
  role: "admin" as const,
  enabled: true,
  twoFactorEnabled: false,
  twoFactorRequired: false,
};

describe("web presentation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.mocked(setupStatus).mockResolvedValue({ required: false });
    vi.mocked(me).mockResolvedValue({ user: currentUser });
    vi.mocked(getBranding).mockResolvedValue({
      displayName: "InfoSteed",
      iconDataUrl: null,
    });
    vi.mocked(listRecordings).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(listProjects).mockResolvedValue({ projects: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the recording library vocabulary", async () => {
    render(<App />);

    expect(
      await screen.findByRole("navigation", { name: "Primary navigation" }),
    ).toBeTruthy();
    expect(
      document.querySelector(".app-brand .brand-mark")?.getAttribute("src"),
    ).toContain("infosteed-horse-logo.svg");
    expect(screen.getAllByText("Library").length).toBeGreaterThan(0);
    expect(
      await screen.findByRole("heading", { name: "Recordings" }),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Search recordings")).toBeTruthy();
  });

  it("searches the recording library", async () => {
    const input = userEvent.setup();
    render(<App />);
    const search = await screen.findByPlaceholderText("Search recordings");

    await input.type(search, "onboarding");

    await waitFor(() =>
      expect(listRecordings).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "onboarding" }),
      ),
    );
  });

  it("creates a project from the primary dialog", async () => {
    const input = userEvent.setup();
    vi.mocked(createProject).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000010",
      name: "Launch guides",
      description: null,
      private: true,
      ownerUserId: currentUser.id,
      role: "owner",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    render(<App />);

    await input.click(
      await screen.findByRole("button", { name: "New project" }),
    );
    await input.type(screen.getByLabelText("Project name"), "Launch guides");
    await input.click(screen.getByRole("button", { name: "Create Project" }));

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith({
        name: "Launch guides",
        private: true,
      }),
    );
  });

  it("shows first-run setup when no administrator exists", async () => {
    vi.mocked(setupStatus).mockResolvedValue({ required: true });
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Create the first admin" }),
    ).toBeTruthy();
    expect(document.querySelector(".auth-brand .brand-mark")).toBeTruthy();
  });

  it("uses a custom deployment icon instead of the product fallback", async () => {
    const customIcon = "data:image/png;base64,Y3VzdG9t";
    vi.mocked(getBranding).mockResolvedValue({
      displayName: "Acme Support",
      iconDataUrl: customIcon,
    });
    render(<App />);

    expect(await screen.findByText("Acme Support")).toBeTruthy();
    expect(
      document.querySelector(".app-brand .brand-mark")?.getAttribute("src"),
    ).toBe(customIcon);
  });

  it("presents internal source values as product language", () => {
    expect(guideSourceLabel("deterministic")).toBe("Generated locally");
    expect(guideSourceLabel("ai")).toBe("AI generated");
    expect(guideSourceLabel("manual")).toBe("Edited");
  });

  it("builds stable recording URLs and error messages", () => {
    expect(recordingUrl("abc", "video-edit")).toBe(
      "/?recordingId=abc&view=video-edit",
    );
    expect(errorMessage(new Error("Unavailable"))).toBe("Unavailable");
    expect(errorMessage("Unavailable")).toBe("Unavailable");
  });

  it("shows progress while the transcript and AI guide are generated", () => {
    const { rerender } = render(
      <RecordingGenerationStatus captureMode="both" status="processing" />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "Generating your transcript and AI guide",
    );
    expect(
      document.querySelector(".recording-generation-spinner"),
    ).toBeTruthy();

    rerender(<RecordingGenerationStatus captureMode="both" status="ready" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
