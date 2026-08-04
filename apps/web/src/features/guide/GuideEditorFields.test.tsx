// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownAssistantField } from "./GuideEditorFields";

describe("guide editor fields", () => {
  afterEach(cleanup);

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
});
