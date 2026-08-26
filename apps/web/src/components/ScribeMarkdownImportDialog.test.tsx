// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScribeMarkdownImportDialog } from "./ScribeMarkdownImportDialog";

describe("Scribe Markdown import dialog", () => {
  afterEach(cleanup);

  it("shows progress, missed URLs, retry, and the completed guide action", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onOpenGuide = vi.fn();
    render(
      <ScribeMarkdownImportDialog
        open
        onOpenChange={vi.fn()}
        busy={false}
        error={undefined}
        onLoad={vi.fn().mockResolvedValue(undefined)}
        onImportProject={vi.fn()}
        onImportScribe={vi.fn().mockResolvedValue(undefined)}
        onRetry={onRetry}
        onOpenGuide={onOpenGuide}
        jobs={[
          {
            id: "00000000-0000-4000-8000-000000000090",
            status: "failed",
            originalFilename: "failed.md",
            sourceUrl: null,
            totalImages: 4,
            processedImages: 4,
            downloadedImages: 0,
            failedImages: [
              {
                url: "https://images.example.com/missing.png",
                error: "HTTP 404",
              },
            ],
            recordingId: null,
            errorMessage: "Too many screenshots failed",
            createdAt: "2026-08-12T12:00:00.000Z",
            updatedAt: "2026-08-12T12:00:00.000Z",
            completedAt: "2026-08-12T12:01:00.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000091",
            status: "completed",
            originalFilename: "complete.md",
            sourceUrl: null,
            totalImages: 1,
            processedImages: 1,
            downloadedImages: 1,
            failedImages: [],
            recordingId: "00000000-0000-4000-8000-000000000092",
            errorMessage: null,
            createdAt: "2026-08-12T12:00:00.000Z",
            updatedAt: "2026-08-12T12:01:00.000Z",
            completedAt: "2026-08-12T12:01:00.000Z",
          },
        ]}
      />,
    );

    expect(screen.getByDisplayValue(/missing\.png/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000090",
    );
    await user.click(screen.getByRole("button", { name: "Open guide" }));
    expect(onOpenGuide).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000092",
    );
  });
});
