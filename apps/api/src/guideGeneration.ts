// SPDX-License-Identifier: AGPL-3.0-only
import type { PoolClient } from "./db.js";
import {
  screenshotsByEvent,
  upsertGeneratedStep,
} from "./repositories/recordings.js";
import {
  writeStep,
  type AiStepWriterProvider,
} from "@infosteed/ai-step-writer";
import { prepareAiScreenshotDataUrl } from "@infosteed/image-processor";
import type { Recording, TranscriptSegment } from "@infosteed/shared";
import { transcriptAround } from "./transcriptContext.js";

export async function generateGuideSteps(
  client: PoolClient,
  recording: Recording,
  provider?: AiStepWriterProvider,
  overwriteUserEdited = false,
  transcriptSegments: TranscriptSegment[] = [],
) {
  const screenshots = await screenshotsByEvent(client, recording.id);
  const steps = [];

  for (let index = 0; index < recording.events.length; index += 1) {
    const current = recording.events[index];
    const screenshot = screenshots.get(current.id);
    const screenshotDataUrl = screenshot
      ? await prepareAiScreenshotDataUrl(screenshot.annotated_image)
      : undefined;
    const generated = await writeStep(provider, {
      workflowPurpose: recording.purpose,
      audience: recording.audience,
      current,
      previous: recording.events[index - 1],
      next: recording.events[index + 1],
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

  return steps;
}

export async function generateGuideStepsForCaptureSession(
  client: PoolClient,
  recording: Recording,
  captureSessionId: string,
  provider?: AiStepWriterProvider,
  transcriptSegments: TranscriptSegment[] = [],
) {
  const screenshots = await screenshotsByEvent(client, recording.id);
  const sessionEvents = recording.events.filter(
    (event) => event.captureSessionId === captureSessionId,
  );
  const steps = [];
  let appendOrdinal =
    recording.items.length > 0
      ? Math.max(...recording.items.map((item) => item.ordinal)) + 1
      : 0;

  for (const current of sessionEvents) {
    const eventIndex = recording.events.findIndex(
      (event) => event.id === current.id,
    );
    const screenshot = screenshots.get(current.id);
    const screenshotDataUrl = screenshot
      ? await prepareAiScreenshotDataUrl(screenshot.annotated_image)
      : undefined;
    const generated = await writeStep(provider, {
      workflowPurpose: recording.purpose,
      audience: recording.audience,
      current,
      previous: recording.events[eventIndex - 1],
      next: recording.events[eventIndex + 1],
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

  return steps;
}
