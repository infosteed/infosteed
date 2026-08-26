// SPDX-License-Identifier: AGPL-3.0-only
import type { PoolClient } from "./db.js";
import {
  originalScreenshotsByEvent,
  screenshotsByEvent,
  updateRecordingSummary,
  upsertGeneratedStep,
} from "./repositories/recordings.js";
import {
  writeGuideOverview,
  writeStep,
  type AiStepWriterProvider,
} from "@infosteed/ai-step-writer";
import { prepareAiScreenshotDataUrl } from "@infosteed/image-processor";
import type {
  GuideItem,
  GuideStep,
  OutputLocale,
  Recording,
  TranscriptSegment,
} from "@infosteed/shared";
import { transcriptAround } from "./transcriptContext.js";
import { cleanupGuideEvents, type GuideCleanupLogger } from "./guideCleanup.js";

export type GuideSummaryMode = "skip" | "fill" | "overwrite";
export type GuideCleanupMode = "none" | "new-capture-cleanup";

export interface GuideGenerationOptions {
  cleanupMode?: GuideCleanupMode;
  logger?: GuideCleanupLogger;
}

function overviewItems(
  recording: Recording,
  generatedSteps: GuideStep[],
): Array<{ kind: GuideItem["kind"]; title: string; body: string }> {
  const generatedEventIds = new Set(
    generatedSteps.map((step) => step.eventId).filter(Boolean),
  );
  const existingItems = recording.items.filter(
    (item) => !item.eventId || !generatedEventIds.has(item.eventId),
  );
  return [
    ...existingItems.map((item) => ({
      kind: item.kind,
      title: item.title,
      body: item.body,
      ordinal: item.ordinal,
    })),
    ...generatedSteps.map((step) => ({
      kind: "step" as const,
      title: step.title,
      body: step.instruction,
      ordinal: step.ordinal,
    })),
  ]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map(({ kind, title, body }) => ({ kind, title, body }));
}

async function generateGuideSummary(
  client: PoolClient,
  recording: Recording,
  provider: AiStepWriterProvider | undefined,
  steps: GuideStep[],
  events: Recording["events"],
  outputLocale: OutputLocale,
  mode: GuideSummaryMode,
) {
  if (mode === "skip") return;
  const titleMissing = recording.title.trim().length === 0;
  const overviewMissing = !recording.purpose?.trim();
  if (mode === "fill" && !titleMissing && !overviewMissing) return;

  const generated = await writeGuideOverview(provider, {
    outputLocale,
    currentTitle: recording.title,
    purpose: recording.purpose,
    audience: recording.audience,
    items: overviewItems(recording, steps),
    events: events.map((event) => ({
      actionType: event.actionType,
      pageTitle: event.pageTitle,
      elementName: event.elementName,
      elementRole: event.elementRole,
      nearbyHeading: event.nearbyHeading,
    })),
  });

  await updateRecordingSummary(client, recording.id, {
    title: mode === "overwrite" || titleMissing ? generated.title : undefined,
    purpose:
      mode === "overwrite" || overviewMissing ? generated.overview : undefined,
  });
}

export async function generateGuideSteps(
  client: PoolClient,
  recording: Recording,
  provider?: AiStepWriterProvider,
  overwriteUserEdited = false,
  transcriptSegments: TranscriptSegment[] = [],
  outputLocale: OutputLocale = "en",
  summaryMode: GuideSummaryMode = "skip",
  options: GuideGenerationOptions = {},
) {
  const screenshots = await screenshotsByEvent(client, recording.id);
  let guideEvents = recording.events;
  if (options.cleanupMode === "new-capture-cleanup") {
    const cleanupScreenshots = await originalScreenshotsByEvent(
      client,
      recording.id,
    );
    guideEvents = (
      await cleanupGuideEvents({
        events: recording.events,
        screenshots: cleanupScreenshots,
        provider,
        logger: options.logger,
      })
    ).events;
  }
  const steps = [];

  for (let index = 0; index < guideEvents.length; index += 1) {
    const current = guideEvents[index];
    const screenshot = screenshots.get(current.id);
    const screenshotDataUrl = screenshot
      ? await prepareAiScreenshotDataUrl(screenshot.annotated_image)
      : undefined;
    const generated = await writeStep(provider, {
      outputLocale,
      workflowPurpose: recording.purpose,
      audience: recording.audience,
      current,
      previous: guideEvents[index - 1],
      next: guideEvents[index + 1],
      ...transcriptAround(transcriptSegments, current.videoOffsetMs),
      screenshotDataUrl,
    });

    steps.push(
      await upsertGeneratedStep(client, {
        recordingId: recording.id,
        eventId: current.id,
        ordinal: index,
        title: generated.title,
        instruction: generated.instruction,
        imageFilename: screenshot?.filename ?? null,
        altText: generated.altText,
        source: generated.source,
        overwriteUserEdited,
      }),
    );
  }

  await generateGuideSummary(
    client,
    recording,
    provider,
    steps,
    guideEvents,
    outputLocale,
    summaryMode,
  );

  return steps;
}

export async function generateGuideStepsForCaptureSession(
  client: PoolClient,
  recording: Recording,
  captureSessionId: string,
  provider?: AiStepWriterProvider,
  transcriptSegments: TranscriptSegment[] = [],
  outputLocale: OutputLocale = "en",
  summaryMode: GuideSummaryMode = "skip",
  options: GuideGenerationOptions = {},
) {
  const screenshots = await screenshotsByEvent(client, recording.id);
  let sessionEvents = recording.events.filter(
    (event) => event.captureSessionId === captureSessionId,
  );
  let contextEvents = recording.events;
  if (options.cleanupMode === "new-capture-cleanup") {
    const cleanupScreenshots = await originalScreenshotsByEvent(
      client,
      recording.id,
    );
    const cleanup = await cleanupGuideEvents({
      events: sessionEvents,
      screenshots: cleanupScreenshots,
      provider,
      logger: options.logger,
    });
    sessionEvents = cleanup.events;
    contextEvents = recording.events.filter(
      (event) => !cleanup.excludedEventIds.has(event.id),
    );
  }
  const steps = [];
  let appendOrdinal =
    recording.items.length > 0
      ? Math.max(...recording.items.map((item) => item.ordinal)) + 1
      : 0;

  for (const current of sessionEvents) {
    const eventIndex = contextEvents.findIndex(
      (event) => event.id === current.id,
    );
    const screenshot = screenshots.get(current.id);
    const screenshotDataUrl = screenshot
      ? await prepareAiScreenshotDataUrl(screenshot.annotated_image)
      : undefined;
    const generated = await writeStep(provider, {
      outputLocale,
      workflowPurpose: recording.purpose,
      audience: recording.audience,
      current,
      previous: contextEvents[eventIndex - 1],
      next: contextEvents[eventIndex + 1],
      ...transcriptAround(transcriptSegments, current.videoOffsetMs),
      screenshotDataUrl,
    });

    steps.push(
      await upsertGeneratedStep(client, {
        recordingId: recording.id,
        eventId: current.id,
        ordinal: appendOrdinal,
        title: generated.title,
        instruction: generated.instruction,
        imageFilename: screenshot?.filename ?? null,
        altText: generated.altText,
        source: generated.source,
      }),
    );
    appendOrdinal += 1;
  }

  await generateGuideSummary(
    client,
    recording,
    provider,
    steps,
    contextEvents,
    outputLocale,
    summaryMode,
  );

  return steps;
}
