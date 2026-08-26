// SPDX-License-Identifier: AGPL-3.0-only
import sharp from "sharp";
import type {
  BoundingBox,
  NormalizedRect,
  ScreenshotEditOperations,
} from "@infosteed/shared";

export function viewportBoxToPixels(
  box: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
) {
  // captureVisibleTab produces a viewport image, while getBoundingClientRect
  // already returns viewport coordinates. Page scroll must not be added again.
  const x = Math.max(
    0,
    Math.min(canvasWidth - 1, Math.round(box.x * box.devicePixelRatio)),
  );
  const y = Math.max(
    0,
    Math.min(canvasHeight - 1, Math.round(box.y * box.devicePixelRatio)),
  );
  const width = Math.max(1, Math.round(box.width * box.devicePixelRatio));
  const height = Math.max(1, Math.round(box.height * box.devicePixelRatio));
  return { x, y, width, height };
}

function highlightSvg(
  box: BoundingBox,
  canvasWidth: number,
  canvasHeight: number,
): Buffer {
  const { x, y, width, height } = viewportBoxToPixels(
    box,
    canvasWidth,
    canvasHeight,
  );

  return Buffer.from(`
    <svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${Math.min(width, canvasWidth - x)}" height="${Math.min(height, canvasHeight - y)}" rx="6" ry="6"
        fill="rgba(255, 214, 10, 0.16)" stroke="rgba(255, 159, 10, 0.95)" stroke-width="4"/>
    </svg>
  `);
}

function normalizedHighlightSvg(
  rect: NormalizedRect,
  canvasWidth: number,
  canvasHeight: number,
): Buffer {
  const { left, top, width, height } = clampRect(
    rect,
    canvasWidth,
    canvasHeight,
  );

  return Buffer.from(`
    <svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="6" ry="6"
        fill="rgba(255, 214, 10, 0.16)" stroke="rgba(255, 159, 10, 0.95)" stroke-width="4"/>
    </svg>
  `);
}

export async function originalToWebp(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().webp({ quality: 82 }).toBuffer();
}

export async function importedRasterToWebp(input: Buffer): Promise<Buffer> {
  const image = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (
    !metadata.format ||
    !["jpeg", "png", "webp", "gif"].includes(metadata.format)
  )
    throw new Error("Unsupported imported image format");
  return image.rotate().webp({ quality: 82 }).toBuffer();
}

export async function annotateScreenshot(
  input: Buffer,
  box?: BoundingBox,
): Promise<Buffer> {
  const base = sharp(input).rotate();
  if (!box) return base.webp({ quality: 82 }).toBuffer();
  const metadata = await base.clone().metadata();
  const width = metadata.width ?? 1;
  const height = metadata.height ?? 1;

  return base
    .composite([{ input: highlightSvg(box, width, height), top: 0, left: 0 }])
    .webp({ quality: 82 })
    .toBuffer();
}

export async function screenshotHighlightRect(
  input: Buffer,
  box: BoundingBox,
): Promise<NormalizedRect> {
  const { info } = await sharp(input).rotate().toBuffer({
    resolveWithObject: true,
  });
  const canvasWidth = info.width;
  const canvasHeight = info.height;
  const pixels = viewportBoxToPixels(box, canvasWidth, canvasHeight);
  const width = Math.min(pixels.width, canvasWidth - pixels.x);
  const height = Math.min(pixels.height, canvasHeight - pixels.y);

  return {
    x: pixels.x / canvasWidth,
    y: pixels.y / canvasHeight,
    width: width / canvasWidth,
    height: height / canvasHeight,
  };
}

export async function prepareAiScreenshotDataUrl(
  input: Buffer,
  maxDimension = 1280,
): Promise<string> {
  const png = await sharp(input)
    .rotate()
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return `data:image/png;base64,${png.toString("base64")}`;
}

export interface ScreenshotDifference {
  dimensionsMatch: boolean;
  meanDifference: number;
  changedPixelRatio: number;
}

export async function compareScreenshots(
  before: Buffer,
  after: Buffer,
): Promise<ScreenshotDifference> {
  const [beforeMetadata, afterMetadata] = await Promise.all([
    sharp(before).rotate().metadata(),
    sharp(after).rotate().metadata(),
  ]);
  const dimensionsMatch =
    beforeMetadata.width === afterMetadata.width &&
    beforeMetadata.height === afterMetadata.height;
  if (!dimensionsMatch) {
    return {
      dimensionsMatch: false,
      meanDifference: 1,
      changedPixelRatio: 1,
    };
  }

  const normalize = (input: Buffer) =>
    sharp(input)
      .rotate()
      .resize(96, 96, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer();
  const [beforePixels, afterPixels] = await Promise.all([
    normalize(before),
    normalize(after),
  ]);
  let totalDifference = 0;
  let changedPixels = 0;
  const changedPixelThreshold = 0.08 * 255;
  for (let index = 0; index < beforePixels.length; index += 1) {
    const difference = Math.abs(beforePixels[index] - afterPixels[index]);
    totalDifference += difference;
    if (difference > changedPixelThreshold) changedPixels += 1;
  }

  return {
    dimensionsMatch: true,
    meanDifference: totalDifference / beforePixels.length / 255,
    changedPixelRatio: changedPixels / beforePixels.length,
  };
}

export async function convertImageToPng(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().png({ compressionLevel: 9 }).toBuffer();
}

export async function convertImageToJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

function clampRect(rect: NormalizedRect, width: number, height: number) {
  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)));
  const right = Math.max(
    left + 1,
    Math.min(width, Math.round((rect.x + rect.width) * width)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(height, Math.round((rect.y + rect.height) * height)),
  );

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function redactSvg(
  rects: ReturnType<typeof clampRect>[],
  width: number,
  height: number,
): Buffer {
  const boxes = rects
    .map(
      (rect) =>
        `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" fill="#000000"/>`,
    )
    .join("");

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${boxes}</svg>`,
  );
}

export async function applyScreenshotEdits(
  input: Buffer,
  operations: ScreenshotEditOperations,
): Promise<Buffer> {
  const oriented = await sharp(input).rotate().toBuffer({
    resolveWithObject: true,
  });
  const sourceWidth = oriented.info.width;
  const sourceHeight = oriented.info.height;
  const crop = operations.crop
    ? clampRect(operations.crop, sourceWidth, sourceHeight)
    : undefined;
  const offsetLeft = crop?.left ?? 0;
  const offsetTop = crop?.top ?? 0;
  const outputWidth = crop?.width ?? sourceWidth;
  const outputHeight = crop?.height ?? sourceHeight;

  const redactions = (operations.redactions ?? [])
    .map((redaction) => clampRect(redaction, sourceWidth, sourceHeight))
    .map((rect) => ({
      left: rect.left - offsetLeft,
      top: rect.top - offsetTop,
      width: rect.width,
      height: rect.height,
    }))
    .filter(
      (rect) =>
        rect.left < outputWidth &&
        rect.top < outputHeight &&
        rect.left + rect.width > 0 &&
        rect.top + rect.height > 0,
    )
    .map((rect) => ({
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      width: Math.min(rect.width, outputWidth - Math.max(0, rect.left)),
      height: Math.min(rect.height, outputHeight - Math.max(0, rect.top)),
    }));

  const highlightedInput = operations.highlight
    ? await sharp(oriented.data)
        .composite([
          {
            input: normalizedHighlightSvg(
              operations.highlight,
              sourceWidth,
              sourceHeight,
            ),
            top: 0,
            left: 0,
          },
        ])
        .toBuffer()
    : oriented.data;

  let image = sharp(highlightedInput);
  if (crop) image = image.extract(crop);
  if (redactions.length > 0) {
    image = image.composite([
      {
        input: redactSvg(redactions, outputWidth, outputHeight),
        left: 0,
        top: 0,
      },
    ]);
  }

  return image.webp({ quality: 82 }).toBuffer();
}
