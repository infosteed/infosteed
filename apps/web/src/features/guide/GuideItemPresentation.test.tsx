// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuideItemEditor } from "../../components/RecordingWorkspace";
import { guideItem } from "../../test/fixtures";

vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return {
    ...actual,
    getImageEdits: vi.fn().mockResolvedValue({ redactions: [] }),
    updateImageEdits: vi.fn().mockResolvedValue({ ok: true }),
  };
});

describe("guide item presentation", () => {
  afterEach(cleanup);

  function renderItem(title: string) {
    return render(
      <GuideItemEditor
        recordingId="recording-id"
        item={guideItem({ kind: "tip", title, body: "Helpful context" })}
        onImageSaved={vi.fn()}
        isSelected={false}
        onSelect={vi.fn()}
        onCloseEdit={vi.fn()}
        editable
        onDraftChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
  }

  it("hides a generic kind title but keeps a custom title", () => {
    const generic = renderItem("Tip");
    expect(
      generic.container.querySelector(".display-marker")?.textContent,
    ).toBe("Tip");
    expect(generic.container.querySelector("h3")).toBeNull();
    generic.unmount();

    const custom = renderItem("Check permissions");
    expect(custom.container.querySelector("h3")?.textContent).toBe(
      "Check permissions",
    );
  });

  it("marks a captured paragraph click for review without suppressing it", () => {
    const rendered = render(
      <GuideItemEditor
        recordingId="recording-id"
        item={guideItem({
          eventId: "00000000-0000-4000-8000-000000000099",
          source: "ai",
          userEdited: false,
          body: "Click ACCOUNT.",
        })}
        event={{
          id: "00000000-0000-4000-8000-000000000099",
          ordinal: 0,
          actionType: "click",
          pageTitle: "Security",
          sanitizedUrl: "https://example.test/security",
          elementName: "ACCOUNT",
          elementRole: "p",
          metadata: {},
        }}
        stepNumber={1}
        onImageSaved={vi.fn()}
        isSelected={false}
        onSelect={vi.fn()}
        onCloseEdit={vi.fn()}
        editable
        onDraftChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(rendered.container.textContent).toContain("Click ACCOUNT.");
    expect(rendered.container.querySelector(".needs-review")).not.toBeNull();
    expect(rendered.container.querySelector(".review")?.textContent).toBe(
      "Review",
    );
  });

  it("opens the image editor by clicking the screenshot", () => {
    const rendered = render(
      <GuideItemEditor
        recordingId="recording-id"
        item={guideItem({ imageFilename: "step.webp" })}
        stepNumber={1}
        imageVersion={1}
        onImageSaved={vi.fn()}
        isSelected
        onSelect={vi.fn()}
        onCloseEdit={vi.fn()}
        editable
        onDraftChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(
      rendered.container.querySelector(".edit-image-trigger") as HTMLElement,
    );

    expect(screen.getByRole("heading", { name: "Edit Image" })).toBeTruthy();
  });
});
