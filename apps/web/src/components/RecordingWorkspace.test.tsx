// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsertBar } from "./RecordingWorkspace";

const mocks = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue(undefined),
  useInsertController: vi.fn(),
}));

vi.mock("../features/guide/useGuideWorkspaceControllers", () => ({
  useInsertController: mocks.useInsertController,
}));

describe("guide insertion menu", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers every guide kind from one position-aware add button", async () => {
    mocks.useInsertController.mockReturnValue(mocks.insert);
    render(
      <InsertBar
        recordingId="recording-id"
        afterItemId="previous-item"
        onAdded={vi.fn()}
      />,
    );

    expect(mocks.useInsertController).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: "recording-id",
        afterItemId: "previous-item",
      }),
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);

    for (const [label, kind] of [
      ["Step", "step"],
      ["Tip", "tip"],
      ["Alert", "alert"],
      ["Header", "header"],
    ] as const) {
      fireEvent.keyDown(
        screen.getByRole("button", { name: "Add guide item" }),
        {
          key: "Enter",
          code: "Enter",
        },
      );
      fireEvent.click(await screen.findByRole("menuitem", { name: label }));
      expect(mocks.insert).toHaveBeenLastCalledWith(kind);
    }
  });
});
