// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { guideItem, recording } from "../test/fixtures";
import { moveGuideItem, orderedItems, reorderGuideItemsForDrop } from "./model";

describe("guide workspace model", () => {
  const first = guideItem({ id: "first", ordinal: 0, title: "First" });
  const second = guideItem({ id: "second", ordinal: 1, title: "Second" });
  const third = guideItem({ id: "third", ordinal: 2, title: "Third" });

  it("orders guide items by ordinal", () => {
    expect(
      orderedItems(recording({ items: [third, first, second] })).map(
        (item) => item.id,
      ),
    ).toEqual(["first", "second", "third"]);
  });

  it("calculates drag-and-drop ordering", () => {
    expect(
      reorderGuideItemsForDrop(
        [first, second, third],
        "first",
        "third",
        "after",
      )?.map((item) => item.id),
    ).toEqual(["second", "third", "first"]);
  });

  it("calculates keyboard ordering without mutating the source", () => {
    const items = [first, second, third];
    expect(moveGuideItem(items, "second", -1)?.map((item) => item.id)).toEqual([
      "second",
      "first",
      "third",
    ]);
    expect(items.map((item) => item.id)).toEqual(["first", "second", "third"]);
  });
});
