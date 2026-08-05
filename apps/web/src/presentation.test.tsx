// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { errorMessage } from "./errors";
import { guideSourceLabel } from "./guide/source";
import { recordingUrl, resolveRecordingView } from "./navigation";
import { RecordingGenerationStatus } from "./components/RecordingGenerationStatus";
import { recordingListItem } from "./test/fixtures";
import { ThemeProvider } from "./theme";
import {
  createProject,
  getBranding,
  getTwoFactorStatus,
  listProjects,
  listRecordings,
  me,
  setupStatus,
  updateMyPreferences,
} from "./api";

vi.mock("./api", () => ({
  setupStatus: vi.fn(),
  me: vi.fn(),
  getBranding: vi.fn(),
  getTwoFactorStatus: vi.fn(),
  listRecordings: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  importProject: vi.fn(),
  deleteRecording: vi.fn(),
  restoreRecording: vi.fn(),
  updateMyPreferences: vi.fn(),
}));

const currentUser = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "owner",
  displayName: "Recording Owner",
  role: "admin" as const,
  enabled: true,
  twoFactorEnabled: false,
  twoFactorRequired: false,
  themePreference: "system" as const,
};

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

describe("web presentation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.mocked(setupStatus).mockResolvedValue({ required: false });
    vi.mocked(me).mockResolvedValue({ user: currentUser });
    vi.mocked(getBranding).mockResolvedValue({
      displayName: "InfoSteed",
      iconDataUrl: null,
    });
    vi.mocked(getTwoFactorStatus).mockResolvedValue({
      enabled: false,
      required: false,
      recoveryCodesRemaining: 0,
      enrollmentAvailable: false,
    });
    vi.mocked(listRecordings).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(listProjects).mockResolvedValue({ projects: [] });
    vi.mocked(updateMyPreferences).mockImplementation(async (preference) => ({
      user: { ...currentUser, themePreference: preference },
    }));
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("uses the recording library vocabulary", async () => {
    renderApp();

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

  it("uses the authenticated account appearance over the browser cache", async () => {
    localStorage.setItem("infosteed.web.theme", "dark");
    vi.mocked(me).mockResolvedValue({
      user: { ...currentUser, themePreference: "light" },
    });
    renderApp();

    await screen.findByRole("heading", { name: "Recordings" });
    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(false),
    );
    expect(localStorage.getItem("infosteed.web.theme")).toBe("light");
  });

  it("searches the recording library", async () => {
    const input = userEvent.setup();
    renderApp();
    const search = await screen.findByPlaceholderText("Search recordings");

    await input.type(search, "onboarding");

    await waitFor(() =>
      expect(listRecordings).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "onboarding" }),
      ),
    );
  });

  it("loads more recordings and shows the server total", async () => {
    const input = userEvent.setup();
    vi.mocked(listRecordings)
      .mockResolvedValueOnce({
        items: [
          recordingListItem({ id: "recording-1", title: "First recording" }),
        ],
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          recordingListItem({ id: "recording-2", title: "Second recording" }),
        ],
        total: 2,
      });
    renderApp();

    expect(await screen.findByText("2 accessible recordings")).toBeTruthy();
    await input.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Second recording")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("uses query-backed library navigation states", async () => {
    window.history.replaceState({}, "", "/?library=shared&scope=shared");
    renderApp();

    expect(await screen.findByRole("heading", { name: "Shared" })).toBeTruthy();
    await waitFor(() =>
      expect(listRecordings).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: "shared", sort: "recent" }),
      ),
    );
    expect(
      screen.getByRole("link", { name: "Trash" }).getAttribute("href"),
    ).toBe("/?library=trash&scope=trash");
  });

  it("renders stable recording action menus with destructive separation", async () => {
    const input = userEvent.setup();
    vi.mocked(listRecordings).mockResolvedValue({
      items: [
        recordingListItem({
          title: "Publish payroll steps",
          captureMode: "both",
        }),
      ],
      total: 1,
    });
    renderApp();

    await screen.findByText("Publish payroll steps");
    expect(
      screen
        .getByRole("link", { name: "Open Publish payroll steps" })
        .getAttribute("href"),
    ).toContain("view=both");
    await input.click(
      screen.getByRole("button", { name: "Recording actions" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "View both" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "View video" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "View guide" })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Delete/ }).className,
    ).toContain("text-destructive");
  });

  it("shows account security in compact status cards", async () => {
    const input = userEvent.setup();
    renderApp();

    await input.click(
      await screen.findByRole("button", {
        name: "Account menu for Recording Owner",
      }),
    );
    await input.click(
      await screen.findByRole("menuitem", { name: "Security" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Security" }),
    ).toBeTruthy();
    expect(document.querySelector(".security-status-grid")).toBeTruthy();
    expect(screen.getByText("Optional")).toBeTruthy();
  });

  it("keeps library and account actions in one place each", async () => {
    const input = userEvent.setup();
    renderApp();

    expect(await screen.findByRole("link", { name: "Trash" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Administration" })).toBeNull();

    await input.click(
      screen.getByRole("button", {
        name: "Account menu for Recording Owner",
      }),
    );
    const menu = await screen.findByRole("menu");

    expect(
      within(menu).getByRole("menuitem", { name: "Administration" }),
    ).toBeTruthy();
    expect(within(menu).queryByRole("menuitem", { name: "Trash" })).toBeNull();
  });

  it("saves an account theme preference from the account menu", async () => {
    const input = userEvent.setup();
    renderApp();

    await input.click(
      await screen.findByRole("button", {
        name: "Account menu for Recording Owner",
      }),
    );
    await input.click(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    );

    await waitFor(() =>
      expect(updateMyPreferences).toHaveBeenCalledWith("dark"),
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("infosteed.web.theme")).toBe("dark");
  });

  it("restores the previous theme when account synchronization fails", async () => {
    const input = userEvent.setup();
    vi.mocked(updateMyPreferences).mockRejectedValueOnce(new Error("offline"));
    renderApp();

    await input.click(
      await screen.findByRole("button", {
        name: "Account menu for Recording Owner",
      }),
    );
    await input.click(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    );

    await waitFor(() =>
      expect(document.documentElement.classList.contains("dark")).toBe(false),
    );
    expect(localStorage.getItem("infosteed.web.theme")).toBe("system");
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
    renderApp();

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
    renderApp();

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
    renderApp();

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
    expect(recordingUrl("abc", "video")).toBe("/?recordingId=abc&view=video");
    expect(recordingUrl("abc", "guide")).toBe("/?recordingId=abc&view=guide");
    expect(recordingUrl("abc", "both")).toBe("/?recordingId=abc&view=both");
    expect(resolveRecordingView("video", "both")).toBe("video");
    expect(resolveRecordingView("guide", "both")).toBe("guide");
    expect(resolveRecordingView("both", "both")).toBe("both");
    expect(resolveRecordingView("video", "guide")).toBe("guide");
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
