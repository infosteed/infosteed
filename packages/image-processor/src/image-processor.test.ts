// SPDX-License-Identifier: AGPL-3.0-only
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  applyScreenshotEdits,
  convertImageToJpeg,
  convertImageToPng,
  prepareAiScreenshotDataUrl,
  screenshotHighlightRect,
  viewportBoxToPixels,
} from "./index";

async function testImage() {
  return sharp({
    create: {
      width: 100,
      height: 80,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

describe("image processor edits", () => {
  it("maps viewport boxes without adding page scroll offsets", () => {
    expect(
      viewportBoxToPixels(
        {
          x: 10,
          y: 12,
          width: 40,
          height: 30,
          devicePixelRatio: 2,
          scrollX: 500,
          scrollY: 300,
        },
        1000,
        800,
      ),
    ).toEqual({ x: 20, y: 24, width: 80, height: 60 });
  });

  it("normalizes captured highlight boxes for the editor", async () => {
    await expect(
      screenshotHighlightRect(await testImage(), {
        x: 10,
        y: 5,
        width: 20,
        height: 10,
        devicePixelRatio: 2,
        scrollX: 0,
        scrollY: 0,
      }),
    ).resolves.toEqual({ x: 0.2, y: 0.125, width: 0.4, height: 0.25 });
  });

  it("preserves dimensions without edits", async () => {
    const output = await applyScreenshotEdits(await testImage(), {
      redactions: [],
    });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(80);
  });

  it("crops to the normalized rectangle", async () => {
    const output = await applyScreenshotEdits(await testImage(), {
      crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      redactions: [],
    });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(50);
    expect(metadata.height).toBe(40);
  });

  it("fills redaction regions with black pixels", async () => {
    const output = await applyScreenshotEdits(await testImage(), {
      redactions: [{ x: 0, y: 0, width: 0.5, height: 0.5 }],
    });
    const pixel = await sharp(output)
      .raw()
      .extract({ left: 10, top: 10, width: 1, height: 1 })
      .toBuffer();

    expect([...pixel]).toEqual([0, 0, 0]);
  });

  it("renders an editable highlight before applying other edits", async () => {
    const output = await applyScreenshotEdits(await testImage(), {
      highlight: { x: 0.2, y: 0.25, width: 0.4, height: 0.5 },
      redactions: [],
    });
    const inside = await sharp(output)
      .raw()
      .extract({ left: 30, top: 30, width: 1, height: 1 })
      .toBuffer();
    const outside = await sharp(output)
      .raw()
      .extract({ left: 80, top: 70, width: 1, height: 1 })
      .toBuffer();

    expect([...inside]).not.toEqual([255, 255, 255]);
    expect([...outside]).toEqual([255, 255, 255]);
  });

  it("prepares AI screenshots as PNG data URLs", async () => {
    const dataUrl = await prepareAiScreenshotDataUrl(await testImage());

    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("converts screenshots to requested export formats", async () => {
    const png = await sharp(
      await convertImageToPng(await testImage()),
    ).metadata();
    const jpeg = await sharp(
      await convertImageToJpeg(await testImage()),
    ).metadata();

    expect(png.format).toBe("png");
    expect(jpeg.format).toBe("jpeg");
  });
});
