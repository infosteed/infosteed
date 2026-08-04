// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guideItem, recording } from "../../test/fixtures";
import { GuideWorkspace } from "./GuideWorkspace";
import type { RecordingController } from "./useRecordingController";

describe("guide workspace", () => {
  afterEach(cleanup);

  function Harness({
    viewOnly = false,
    showViewNavigation = false,
  }: {
    viewOnly?: boolean;
    showViewNavigation?: boolean;
  }) {
    const first = guideItem({
      id: "first",
      ordinal: 0,
      title: "First step",
      body: "First instruction",
      imageFilename: "first.png",
    });
    const second = guideItem({
      id: "second",
      ordinal: 1,
      title: "Second step",
      body: "Second instruction",
    });
    const recordingFixture = recording({ items: [first, second] });
    const [selectedItemId, setSelectedItemId] = useState("");

    const controller = {
      recording: recordingFixture,
      setRecording: vi.fn(),
      rightPanelMode: "display",
      setRightPanelMode: vi.fn(),
      imageVersions: new Map(),
      selectedItemId,
      setSelectedItemId,
      viewOnly,
      previewOpen: false,
      setPreviewOpen: vi.fn(),
      accessOpen: false,
      setAccessOpen: vi.fn(),
      setVersionsOpen: vi.fn(),
      previewAutoScroll: true,
      setPreviewAutoScroll: vi.fn(),
      captureMoreStatus: "idle",
      captureMoreMessage: undefined,
      draggingItemId: undefined,
      setDraggingItemId: vi.fn(),
      dropTarget: undefined,
      setDropTarget: vi.fn(),
      setPreviewScrollRef: vi.fn(),
      load: vi.fn(),
      bumpImageVersion: vi.fn(),
      updateLocalItem: vi.fn(),
      moveItemBy: vi.fn(),
      dropItem: vi.fn(),
      markdown: "",
      eventsById: new Map(),
      items: [first, second],
      stepNumbers: new Map([
        [first.id, 1],
        [second.id, 2],
      ]),
      reorderDisabled: Boolean(selectedItemId),
    } as unknown as RecordingController;

    return (
      <GuideWorkspace
        controller={controller}
        showViewNavigation={showViewNavigation}
      />
    );
  }

  it("edits only the selected guide item inline", () => {
    const { container } = render(<Harness />);

    expect(screen.queryByLabelText("Step properties")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /1\. First step/ }));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Instruction",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("First instruction");
    expect(
      screen.getAllByRole("textbox", { name: "Instruction" }),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Crop / Redact" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace Image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete Image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Crop / Redact" })
        .closest(".guide-action-toolbar"),
    ).toBe(
      screen
        .getByRole("button", { name: "Regenerate" })
        .closest(".guide-action-toolbar"),
    );
    expect(container.querySelector(".image-actions")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("textbox", { name: "Instruction" })).toBeNull();

    fireEvent.click(screen.getByText("Second instruction"));
    expect(
      (
        screen.getByRole("textbox", {
          name: "Instruction",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Second instruction");
  });

  it("edits the overview inline", () => {
    const { container } = render(<Harness />);
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(
      (container.querySelector(".selected-overview input") as HTMLInputElement)
        ?.value,
    ).toBe("Configure the workspace");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("highlights the guide item at the reading position while scrolling", () => {
    render(<Harness />);
    const rect = (top: number, bottom: number) =>
      ({
        top,
        bottom,
        height: bottom - top,
        left: 0,
        right: 100,
        width: 100,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    vi.spyOn(
      document.getElementById("guide-item-overview")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(-500, -300));
    vi.spyOn(
      document.getElementById("guide-item-first")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(-280, -40));
    vi.spyOn(
      document.getElementById("guide-item-second")!,
      "getBoundingClientRect",
    ).mockReturnValue(rect(20, 260));

    fireEvent.scroll(window);

    expect(
      screen
        .getByRole("button", { name: /2\. Second step/ })
        .getAttribute("aria-current"),
    ).toBe("location");
    expect(
      screen
        .getByRole("button", { name: "Overview" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("uses the outline for read-only guide navigation", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    render(<Harness viewOnly showViewNavigation />);

    expect(
      screen.getByRole("complementary", { name: "Guide outline" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /1\. First step/ }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(screen.queryByRole("textbox", { name: "Instruction" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Drag First step/ }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open guide outline" }));
    const mobileOutline = screen.getByRole("dialog");
    fireEvent.click(
      within(mobileOutline).getByRole("button", { name: /2\. Second step/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });
});
