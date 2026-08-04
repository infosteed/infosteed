// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  branding,
  currentUser,
  recording,
  recordingVideo,
} from "../test/fixtures";
import type { RecordingController } from "../features/recording/useRecordingController";
import { RecordingScreen } from "./RecordingScreen";

vi.mock("../components/design/AppShell", () => ({
  AppShell: ({
    children,
    topbar,
  }: {
    children: React.ReactNode;
    topbar: React.ReactNode;
  }) => (
    <div>
      {topbar}
      {children}
    </div>
  ),
}));
vi.mock("../features/recording/RecordingHeader", () => ({
  RecordingHeader: () => <header />,
}));
vi.mock("../features/recording/RecordingMediaViewer", () => ({
  RecordingMediaViewer: () => <section data-testid="media-viewer" />,
}));
vi.mock("../features/recording/GuideWorkspace", () => ({
  GuideWorkspace: ({
    showViewNavigation,
  }: {
    showViewNavigation?: boolean;
  }) => (
    <section
      data-testid="guide-workspace"
      data-view-navigation={String(Boolean(showViewNavigation))}
    />
  ),
}));
vi.mock("../features/recording/RecordingDrawers", () => ({
  RecordingDrawers: () => null,
}));

describe("recording screen workspace", () => {
  afterEach(cleanup);

  function controller(captureMode: "guide" | "video" | "both") {
    return {
      recording: recording({ captureMode }),
      video: captureMode === "guide" ? undefined : recordingVideo(),
      error: undefined,
      viewOnly: true,
      setViewOnly: vi.fn(),
      setVideo: vi.fn(),
      load: vi.fn(),
    } as unknown as RecordingController;
  }

  function renderScreen(
    recordingController: RecordingController,
    requestedView: "video" | "guide" | "both" | null = null,
  ) {
    return render(
      <RecordingScreen
        user={currentUser()}
        branding={branding()}
        requestedView={requestedView}
        recordingController={recordingController}
        onOpenAdmin={vi.fn()}
        onLogout={vi.fn()}
        onLogoutAll={vi.fn()}
      />,
    );
  }

  it("only enables the combined responsive layout for video plus guide views", () => {
    const { container, rerender } = renderScreen(controller("both"));
    expect(
      container.querySelector(".recording-workspace")?.className,
    ).toContain("combined");

    rerender(
      <RecordingScreen
        user={currentUser()}
        branding={branding()}
        requestedView={null}
        recordingController={controller("guide")}
        onOpenAdmin={vi.fn()}
        onLogout={vi.fn()}
        onLogoutAll={vi.fn()}
      />,
    );
    expect(
      container.querySelector(".recording-workspace")?.className,
    ).not.toContain("combined");

    rerender(
      <RecordingScreen
        user={currentUser()}
        branding={branding()}
        requestedView={null}
        recordingController={controller("video")}
        onOpenAdmin={vi.fn()}
        onLogout={vi.fn()}
        onLogoutAll={vi.fn()}
      />,
    );
    expect(
      container.querySelector(".recording-workspace")?.className,
    ).not.toContain("combined");
  });

  it("renders exactly the content selected by the recording view route", () => {
    const recordingController = controller("both");
    const { container, rerender } = renderScreen(recordingController, "video");

    expect(
      container.querySelector('[data-testid="media-viewer"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="guide-workspace"]'),
    ).toBeNull();
    expect(
      container.querySelector(".recording-workspace")?.className,
    ).not.toContain("combined");

    rerender(
      <RecordingScreen
        user={currentUser()}
        branding={branding()}
        requestedView="guide"
        recordingController={recordingController}
        onOpenAdmin={vi.fn()}
        onLogout={vi.fn()}
        onLogoutAll={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="media-viewer"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="guide-workspace"]'),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="guide-workspace"]')
        ?.getAttribute("data-view-navigation"),
    ).toBe("true");

    rerender(
      <RecordingScreen
        user={currentUser()}
        branding={branding()}
        requestedView="both"
        recordingController={recordingController}
        onOpenAdmin={vi.fn()}
        onLogout={vi.fn()}
        onLogoutAll={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-testid="media-viewer"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="guide-workspace"]'),
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-testid="guide-workspace"]')
        ?.getAttribute("data-view-navigation"),
    ).toBe("false");
    expect(
      container.querySelector(".recording-workspace")?.className,
    ).toContain("combined");
  });
});
