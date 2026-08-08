// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjustImageSelection,
  ImageEditor,
  MarkdownAssistantField,
} from "./GuideEditorFields";

const imageEditorController = vi.hoisted(() => ({
  operations: {
    highlight: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
    crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    redactions: [],
  },
  setOperations: vi.fn(),
  save: vi.fn(),
}));

vi.mock("./useGuideWorkspaceControllers", () => ({
  useImageEditorController: () => imageEditorController,
}));

describe("guide editor fields", () => {
  afterEach(() => {
    cleanup();
    imageEditorController.setOperations.mockReset();
  });

  it("preserves the markdown formatting commands", () => {
    const onChange = vi.fn();
    render(
      <MarkdownAssistantField
        value="Write the guide"
        onChange={onChange}
        rows={4}
        ariaLabel="Instruction"
      />,
    );

    const textarea = screen.getByRole("textbox", {
      name: "Instruction",
    }) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(onChange).toHaveBeenCalledWith("**Write** the guide");
  });

  it("moves an image highlight without letting it leave the image", () => {
    expect(
      adjustImageSelection(
        { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
        "move",
        0.7,
        -0.5,
      ),
    ).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.2 });
  });

  it("resizes an image highlight from its handles", () => {
    expect(
      adjustImageSelection(
        { x: 0.2, y: 0.3, width: 0.4, height: 0.2 },
        "se",
        0.15,
        0.25,
      ),
    ).toEqual({ x: 0.2, y: 0.3, width: 0.55, height: 0.45 });
  });

  it("pairs each image action with its clear action", () => {
    const { container } = render(
      <ImageEditor
        recordingId="recording"
        filename="step.webp"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(
      Array.from(container.querySelectorAll(".editor-tools button")).map(
        (button) => button.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Highlight",
      "Clear Highlight",
      "Crop / Zoom",
      "Clear Crop",
      "Redact",
      "Clear Redactions",
    ]);
  });

  it("clears a crop without changing the highlight", () => {
    render(
      <ImageEditor
        recordingId="recording"
        filename="step.webp"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Crop" }));

    const update = imageEditorController.setOperations.mock.calls[0]?.[0];
    expect(update(imageEditorController.operations)).toEqual({
      ...imageEditorController.operations,
      crop: undefined,
    });
  });
});
