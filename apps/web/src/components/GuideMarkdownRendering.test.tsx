// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guideItem, recording } from "../test/fixtures";
import { GuideDisplayPreview } from "./RecordingWorkspace";

describe("guide Markdown rendering", () => {
  afterEach(cleanup);

  it("preserves paragraph breaks in overviews, tips, and alerts", () => {
    render(
      <GuideDisplayPreview
        recording={recording({
          purpose: "Overview first.\n\nOverview second.",
          items: [
            guideItem({
              id: "tip",
              ordinal: 0,
              kind: "tip",
              title: "Tip",
              body: "Tip first.\n\nTip second.",
            }),
            guideItem({
              id: "alert",
              ordinal: 1,
              kind: "alert",
              title: "Alert",
              body: "Alert first.\n\nAlert second.",
            }),
          ],
        })}
        imageVersions={new Map()}
        scrollRef={vi.fn()}
        onUserScroll={vi.fn()}
      />,
    );

    for (const [first, second] of [
      ["Overview first.", "Overview second."],
      ["Tip first.", "Tip second."],
      ["Alert first.", "Alert second."],
    ]) {
      const firstParagraph = screen.getByText(first).closest("p");
      const secondParagraph = screen.getByText(second).closest("p");
      expect(firstParagraph).toBeTruthy();
      expect(secondParagraph).toBeTruthy();
      expect(secondParagraph).not.toBe(firstParagraph);
    }
  });
});
