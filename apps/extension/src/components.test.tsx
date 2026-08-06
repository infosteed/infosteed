// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Popup } from "./popup";
import { Setup } from "./setup";
import { Options } from "./options";
import { getCurrentUser, getVideoCapability } from "./apiClient";

vi.mock("./apiClient", () => ({
  connectServer: vi.fn(),
  disconnectServer: vi.fn(),
  getCurrentUser: vi.fn(),
  getSettings: vi.fn(),
  getVideoCapability: vi.fn(),
}));

const storageGet = vi.fn();
const storageSet = vi.fn();
const sendMessage = vi.fn();

describe("extension presentation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "chrome", {
      configurable: true,
      value: {
        storage: { local: { get: storageGet, set: storageSet } },
        runtime: {
          sendMessage,
          openOptionsPage: vi.fn(),
        },
        tabs: { create: vi.fn() },
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([]),
        getUserMedia: vi.fn(),
      },
    });
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      username: "owner",
      displayName: "Recording Owner",
      role: "admin",
      enabled: true,
      twoFactorRequired: false,
      twoFactorEnabled: false,
      themePreference: "system",
    });
    vi.mocked(getVideoCapability).mockResolvedValue({
      enabled: true,
      maxDurationMs: 3_600_000,
      maxWidth: 1920,
      maxHeight: 1080,
      frameRate: 30,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("shows recording controls without raw diagnostics", async () => {
    const input = userEvent.setup();
    storageGet.mockResolvedValue({
      recorderStatus: "recording",
      recordingId: "00000000-0000-4000-8000-000000000099",
      captureMode: "both",
      serverOrigin: "https://recordings.example.test",
    });
    sendMessage.mockResolvedValue({ recoveryAvailable: false });

    render(<Popup />);

    expect(
      await screen.findByText("Signed in as Recording Owner"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByText(/Output:.*Video \+ Guide/)).toBeTruthy();
    expect(
      screen.queryByText(/00000000-0000-4000-8000-000000000099/),
    ).toBeNull();
    expect(screen.queryByText(/^App:/)).toBeNull();
    expect(document.querySelector(".product-brand .product-mark")).toBeTruthy();
    await input.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ type: "pause-recording" }),
    );
  });

  it("offers recovery for interrupted recordings", async () => {
    storageGet.mockResolvedValue({
      recorderStatus: "idle",
      serverOrigin: "https://recordings.example.test",
    });
    sendMessage.mockResolvedValue({ recoveryAvailable: true });

    render(<Popup />);

    expect(await screen.findByText("Interrupted video found")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Recover video" })).toBeTruthy();
  });

  it("offers pending child-tab follow for guide-only recordings", async () => {
    const input = userEvent.setup();
    storageGet.mockResolvedValue({
      recorderStatus: "recording",
      recordingId: "00000000-0000-4000-8000-000000000099",
      captureMode: "guide",
      serverOrigin: "https://recordings.example.test",
    });
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === "get-recorder-state") {
        return {
          recoveryAvailable: false,
          followPending: true,
          pendingTabTitle: "Child app",
        };
      }
      return { ok: true };
    });

    render(<Popup />);

    expect(await screen.findByText("New app tab detected")).toBeTruthy();
    expect(
      screen.getByText("Switch the recording to “Child app”."),
    ).toBeTruthy();
    await input.click(screen.getByRole("button", { name: "Follow this tab" }));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith({ type: "follow-pending-tab" }),
    );
  });

  it("offers all three recording outputs during setup", async () => {
    storageGet.mockResolvedValue({});
    render(<Setup />);

    expect(
      await screen.findByRole("radio", { name: /Video \+ Guide/ }),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Video Only/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Guide Only/ })).toBeTruthy();
    expect(
      screen.getByText("A screenshot-based guide you can review and edit."),
    ).toBeTruthy();
    expect(screen.getByText("Recording a public demo?")).toBeTruthy();
    expect(
      screen.getByText(
        "Use a clean browser profile, close password-manager and other sensitive overlays, and review every screenshot before publishing or sharing.",
      ),
    ).toBeTruthy();
    expect(
      document.querySelector(".product-header .product-mark"),
    ).toBeTruthy();
  });

  it("limits Firefox setup to guide-only capture", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_INFOSTEED_EXTENSION_TARGET", "firefox");
    storageGet.mockResolvedValue({});
    const { Setup: FirefoxSetup } = await import("./setup");

    render(<FirefoxSetup />);

    expect(
      await screen.findByText("Firefox support is Guide Only in this version."),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: /Video \+ Guide/ }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("radio", { name: /Video Only/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("radio", { name: /Guide Only/ })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("shows product identity on the extension options page", async () => {
    storageGet.mockResolvedValue({});
    render(<Options />);

    expect(
      await screen.findByRole("heading", {
        name: "Connect your self-hosted server",
      }),
    ).toBeTruthy();
    expect(
      document.querySelector(".product-header .product-mark"),
    ).toBeTruthy();
  });
});
