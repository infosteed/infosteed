// SPDX-License-Identifier: AGPL-3.0-only
import {
  guideCleanupClassificationSchema,
  type AiStepWriterProvider,
} from "@infosteed/ai-step-writer";
import {
  compareScreenshots,
  prepareAiScreenshotDataUrl,
} from "@infosteed/image-processor";
import type { BoundingBox, Recording } from "@infosteed/shared";

type StoredRecordingEvent = Recording["events"][number];

const MAX_ELAPSED_MS = 2_500;
const MAX_POINT_DISTANCE = 12;
const MIN_BOUNDING_BOX_OVERLAP = 0.85;
const MAX_MEAN_SCREENSHOT_DIFFERENCE = 0.015;
const MAX_CHANGED_PIXEL_RATIO = 0.01;
const MIN_BOT_CONFIDENCE = 0.8;

export interface GuideCleanupStats {
  candidates: number;
  collapsed: number;
  vetoed: number;
  fallbacks: number;
}

export interface GuideCleanupResult {
  events: StoredRecordingEvent[];
  excludedEventIds: Set<string>;
  stats: GuideCleanupStats;
}

export interface GuideCleanupLogger {
  info(value: unknown, message: string): void;
}

type CaptureEvidence = {
  timestampMs: number;
  clickPoint?: {
    x: number;
    y: number;
    viewportWidth: number;
    viewportHeight: number;
  };
};

function normalized(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function captureEvidence(
  event: StoredRecordingEvent,
): CaptureEvidence | undefined {
  const value = event.metadata.capture;
  if (!value || typeof value !== "object") return undefined;
  const capture = value as Record<string, unknown>;
  if (
    typeof capture.timestampMs !== "number" ||
    !Number.isFinite(capture.timestampMs)
  )
    return undefined;
  const pointValue = capture.clickPoint;
  let clickPoint: CaptureEvidence["clickPoint"];
  if (pointValue && typeof pointValue === "object") {
    const point = pointValue as Record<string, unknown>;
    if (
      typeof point.x === "number" &&
      Number.isFinite(point.x) &&
      typeof point.y === "number" &&
      Number.isFinite(point.y) &&
      typeof point.viewportWidth === "number" &&
      point.viewportWidth > 0 &&
      typeof point.viewportHeight === "number" &&
      point.viewportHeight > 0
    ) {
      clickPoint = {
        x: point.x,
        y: point.y,
        viewportWidth: point.viewportWidth,
        viewportHeight: point.viewportHeight,
      };
    }
  }
  return { timestampMs: capture.timestampMs, clickPoint };
}

function pointDistance(
  earlier: CaptureEvidence,
  later: CaptureEvidence,
): number | null {
  if (!earlier.clickPoint || !later.clickPoint) return null;
  if (
    earlier.clickPoint.viewportWidth !== later.clickPoint.viewportWidth ||
    earlier.clickPoint.viewportHeight !== later.clickPoint.viewportHeight
  )
    return null;
  return Math.hypot(
    earlier.clickPoint.x - later.clickPoint.x,
    earlier.clickPoint.y - later.clickPoint.y,
  );
}

function boundingBoxOverlap(
  earlier: BoundingBox | undefined,
  later: BoundingBox | undefined,
): number | null {
  if (!earlier || !later) return null;
  const left = Math.max(earlier.x, later.x);
  const top = Math.max(earlier.y, later.y);
  const right = Math.min(earlier.x + earlier.width, later.x + later.width);
  const bottom = Math.min(earlier.y + earlier.height, later.y + later.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union =
    earlier.width * earlier.height + later.width * later.height - intersection;
  return union > 0 ? intersection / union : null;
}

function sameSemanticTarget(
  earlier: StoredRecordingEvent,
  later: StoredRecordingEvent,
): boolean {
  const earlierName = normalized(earlier.elementName);
  const laterName = normalized(later.elementName);
  const earlierLabel = normalized(earlier.labelText);
  const laterLabel = normalized(later.labelText);
  return (
    Boolean(earlierName || earlierLabel) &&
    earlierName === laterName &&
    earlierLabel === laterLabel &&
    normalized(earlier.elementRole) === normalized(later.elementRole)
  );
}

export async function cleanupGuideEvents(input: {
  events: StoredRecordingEvent[];
  screenshots: Map<string, Buffer>;
  provider?: AiStepWriterProvider;
  logger?: GuideCleanupLogger;
}): Promise<GuideCleanupResult> {
  const excludedEventIds = new Set<string>();
  const stats: GuideCleanupStats = {
    candidates: 0,
    collapsed: 0,
    vetoed: 0,
    fallbacks: 0,
  };

  for (let index = 0; index < input.events.length - 1; index += 1) {
    const earlier = input.events[index];
    const later = input.events[index + 1];
    if (
      earlier.actionType !== "click" ||
      later.actionType !== "click" ||
      (earlier.captureSessionId ?? null) !== (later.captureSessionId ?? null) ||
      earlier.sanitizedUrl !== later.sanitizedUrl ||
      !sameSemanticTarget(earlier, later)
    )
      continue;

    const earlierCapture = captureEvidence(earlier);
    const laterCapture = captureEvidence(later);
    if (!earlierCapture || !laterCapture) continue;
    const elapsedMs = laterCapture.timestampMs - earlierCapture.timestampMs;
    if (elapsedMs < 0 || elapsedMs > MAX_ELAPSED_MS) continue;

    const distance = pointDistance(earlierCapture, laterCapture);
    const overlap = boundingBoxOverlap(earlier.boundingBox, later.boundingBox);
    if (
      !(distance !== null && distance <= MAX_POINT_DISTANCE) &&
      !(overlap !== null && overlap >= MIN_BOUNDING_BOX_OVERLAP)
    )
      continue;

    const earlierImage = input.screenshots.get(earlier.id);
    const laterImage = input.screenshots.get(later.id);
    if (!earlierImage || !laterImage) continue;
    let difference: Awaited<ReturnType<typeof compareScreenshots>>;
    try {
      difference = await compareScreenshots(earlierImage, laterImage);
    } catch {
      continue;
    }
    if (
      !difference.dimensionsMatch ||
      difference.meanDifference > MAX_MEAN_SCREENSHOT_DIFFERENCE ||
      difference.changedPixelRatio > MAX_CHANGED_PIXEL_RATIO
    )
      continue;

    stats.candidates += 1;
    let collapse = true;
    if (input.provider?.classifyGuideCleanup) {
      try {
        const screenshotDataUrls = (await Promise.all([
          prepareAiScreenshotDataUrl(earlierImage),
          prepareAiScreenshotDataUrl(laterImage),
        ])) as [string, string];
        const classification = guideCleanupClassificationSchema.parse(
          await input.provider.classifyGuideCleanup({
            earlier,
            later,
            screenshotDataUrls,
            evidence: {
              elapsedMs,
              pointDistance: distance,
              boundingBoxOverlap: overlap,
              meanScreenshotDifference: difference.meanDifference,
              changedPixelRatio: difference.changedPixelRatio,
            },
          }),
        );
        collapse =
          classification.decision === "collapse" &&
          classification.confidence >= MIN_BOT_CONFIDENCE;
        if (!collapse) stats.vetoed += 1;
      } catch {
        stats.fallbacks += 1;
      }
    } else {
      stats.fallbacks += 1;
    }

    if (collapse) {
      excludedEventIds.add(earlier.id);
      stats.collapsed += 1;
    }
  }

  input.logger?.info({ guideCleanup: stats }, "Guide action cleanup completed");
  return {
    events: input.events.filter((event) => !excludedEventIds.has(event.id)),
    excludedEventIds,
    stats,
  };
}
