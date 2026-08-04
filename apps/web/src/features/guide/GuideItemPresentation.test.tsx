// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuideItemEditor } from "../../components/RecordingWorkspace";
import { guideItem } from "../../test/fixtures";

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
});
