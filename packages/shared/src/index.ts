// SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";

export const PRODUCT_METADATA = Object.freeze({
  displayName: "InfoSteed",
  slug: "infosteed",
  releaseVersion: "0.1.0-beta.11",
  protocolVersion: 1,
  minimumExtensionVersion: "0.1.0",
});

export const PUBLIC_API_PREFIX = "/api";
export const PROTOCOL_VERSION = PRODUCT_METADATA.protocolVersion;
export const PRODUCT_IDENTIFIERS = Object.freeze({
  sessionCookie: "infosteed_session",
  csrfHeader: "x-csrf-token",
  videoStartHeader: "x-infosteed-start-ms",
  videoEndHeader: "x-infosteed-end-ms",
  extensionBridgeChannel: "infosteed-web-bridge",
  extensionMessageSource: "infosteed-extension",
  webMessageSource: "infosteed-web",
  recorderPing: "infosteed-recorder-ping",
  exportPrefix: "infosteed-guide",
  tempPrefix: "infosteed-",
});

export interface PublicSystemInfo {
  productName: string;
  productSlug: string;
  releaseVersion: string;
  releaseCommit: string;
  sourceUrl: string;
  exactSourceUrl: string;
  protocolVersion: number;
  setupRequired: boolean;
  minimumExtensionVersion: string;
}

export const actionTypeSchema = z.enum([
  "click",
  "input",
  "select",
  "checkbox",
  "radio",
  "submit",
  "navigation",
  "keyboard",
  "modal",
]);

export const recordingStateSchema = z.enum([
  "recording",
  "paused",
  "finalized",
]);
export const captureModeSchema = z.enum(["guide", "video", "both"]);
export const outputLocaleSchema = z.enum(["en", "ga", "fr", "de"]);
export const outputLocaleRequestSchema = z
  .object({ outputLocale: outputLocaleSchema.default("en") })
  .default({});

export const OUTPUT_LOCALE_NAMES = {
  en: "English",
  ga: "Irish (Gaeilge)",
  fr: "French (Français)",
  de: "German (Deutsch)",
} as const satisfies Record<z.infer<typeof outputLocaleSchema>, string>;

const GUIDE_STEP_SEQUENCE_PREFIX =
  /^\s*(?:step|étape|etape|schritt|céim|ceim)\s+\d+\s*(?:(?:of|sur|von|de|as)\s+|\/\s*)\d+\s*(?::|[-–—])?\s*/iu;

export function normalizeGuideOutlineTitle(
  title: string,
  fallback = "Untitled step",
): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!GUIDE_STEP_SEQUENCE_PREFIX.test(normalized)) return normalized;

  const descriptiveTitle = normalized
    .replace(GUIDE_STEP_SEQUENCE_PREFIX, "")
    .trim();
  if (descriptiveTitle) return descriptiveTitle;

  const normalizedFallback = fallback.trim().replace(/\s+/g, " ");
  return normalizedFallback || "Untitled step";
}

export const boundingBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  devicePixelRatio: z.number().finite().positive().default(1),
  scrollX: z.number().finite().default(0),
  scrollY: z.number().finite().default(0),
});

export const normalizedRectSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0).max(1),
  height: z.number().finite().min(0).max(1),
});

export const screenshotEditOperationsSchema = z.object({
  crop: normalizedRectSchema.optional(),
  redactions: z.array(normalizedRectSchema).default([]),
});

export const safeTextSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value) => value.replace(/\s+/g, " "));

export const shortTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .transform((value) => value.replace(/\s+/g, " "));

export const usernameTextSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .transform((value) => value.replace(/\s+/g, " "));

export const recordingEventSchema = z.object({
  id: z.string().uuid().optional(),
  ordinal: z.number().int().nonnegative().optional(),
  captureSessionId: z.string().uuid().nullable().optional(),
  actionType: actionTypeSchema,
  pageTitle: safeTextSchema.default("Untitled page"),
  sanitizedUrl: z.string().url().or(z.literal("about:blank")),
  elementName: safeTextSchema.optional(),
  elementRole: safeTextSchema.optional(),
  labelText: safeTextSchema.optional(),
  nearbyHeading: safeTextSchema.optional(),
  inputCategory: safeTextSchema.optional(),
  boundingBox: boundingBoxSchema.optional(),
  videoOffsetMs: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const INTERACTIVE_CLICK_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "field",
  "link",
  "list",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

export function recordingEventNeedsReview(
  event: Pick<
    z.infer<typeof recordingEventSchema>,
    "actionType" | "elementName" | "elementRole"
  >,
): boolean {
  if (!event.elementName?.trim()) return true;
  if (event.actionType !== "click") return false;
  return !INTERACTIVE_CLICK_ROLES.has(event.elementRole?.toLowerCase() ?? "");
}

export const createRecordingRequestSchema = z.object({
  title: safeTextSchema.default("Untitled workflow"),
  purpose: safeTextSchema.optional(),
  audience: safeTextSchema.optional(),
  projectId: z.string().uuid().optional(),
  captureMode: captureModeSchema.default("guide"),
});

export const videoAssetKindSchema = z.enum([
  "composite",
  "screen",
  "camera",
  "microphone",
  "transcription",
  "voiceover",
]);
export const videoStatusSchema = z.enum([
  "initializing",
  "recording",
  "finalizing",
  "ready",
  "published",
  "failed",
]);
export const videoAssetStatusSchema = z.enum([
  "uploading",
  "complete",
  "failed",
]);
export const transcriptionStatusSchema = z.enum([
  "disabled",
  "pending",
  "processing",
  "ready",
  "failed",
]);
export const videoRenderStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "failed",
  "canceled",
  "expired",
]);
export const videoMp4ExportStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "failed",
]);
export const voiceoverGenerationStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "failed",
]);

export const videoSourceRangeSchema = z
  .object({
    startMs: z.number().int().nonnegative().max(3_600_000),
    endMs: z.number().int().positive().max(3_600_000),
  })
  .refine(
    (range) => range.endMs - range.startMs >= 100,
    "A kept range must be at least 100 ms",
  );

export const videoEditChapterSchema = z.object({
  id: z.string().min(1).max(200),
  eventId: z.string().uuid().nullable(),
  guideItemId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(120),
  sourceOffsetMs: z.number().int().nonnegative().max(3_600_000),
  ordinal: z.number().int().nonnegative(),
  hidden: z.boolean().default(false),
  custom: z.boolean().default(false),
  titleEdited: z.boolean().default(false),
  offsetEdited: z.boolean().default(false),
});

export const editableCaptionCueSchema = z
  .object({
    id: z.string().min(1).max(200),
    sourceStartMs: z.number().int().nonnegative().max(3_600_000),
    sourceEndMs: z.number().int().positive().max(3_600_000),
    text: z.string().trim().min(1).max(2_000),
  })
  .refine(
    (cue) => cue.sourceEndMs > cue.sourceStartMs,
    "Caption end must be after its start",
  );

export const videoEditRecipeSchema = z
  .object({
    version: z.literal(1),
    sourceDurationMs: z.number().int().positive().max(3_600_000),
    keepRanges: z.array(videoSourceRangeSchema).min(1).max(200),
    webcam: z.object({
      visible: z.boolean(),
      centerX: z.number().finite().min(0).max(1),
      centerY: z.number().finite().min(0).max(1),
      diameter: z.number().finite().min(0.1).max(0.4),
    }),
    audio: z.object({
      tabGain: z.number().finite().min(0).max(2),
      microphoneGain: z.number().finite().min(0).max(2),
      voiceoverGain: z.number().finite().min(0).max(2).default(1),
    }),
    voiceover: z
      .object({
        enabled: z.boolean().default(false),
        assetId: z.string().uuid().nullable().default(null),
        generationId: z.string().uuid().nullable().default(null),
      })
      .default({ enabled: false, assetId: null, generationId: null }),
    chapters: z.array(videoEditChapterSchema).max(500),
    captions: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("transcript") }),
      z.object({
        mode: z.literal("manual"),
        cues: z.array(editableCaptionCueSchema).max(20_000),
      }),
    ]),
  })
  .superRefine((recipe, context) => {
    if (
      recipe.voiceover.enabled &&
      (!recipe.voiceover.assetId || !recipe.voiceover.generationId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["voiceover", "enabled"],
        message: "An enabled voiceover requires a generated asset",
      });
    }
    let previousEnd = -1;
    let keptDuration = 0;
    recipe.keepRanges.forEach((range, index) => {
      if (range.endMs > recipe.sourceDurationMs) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keepRanges", index],
          message: "Range exceeds source duration",
        });
      }
      if (range.startMs < previousEnd) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["keepRanges", index],
          message: "Ranges must be ordered and non-overlapping",
        });
      }
      previousEnd = range.endMs;
      keptDuration += range.endMs - range.startMs;
    });
    if (keptDuration < 500) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["keepRanges"],
        message: "At least 500 ms of video must remain",
      });
    }
    const isKept = (offsetMs: number) =>
      recipe.keepRanges.some(
        (range) => offsetMs >= range.startMs && offsetMs < range.endMs,
      );
    recipe.chapters.forEach((chapter, index) => {
      if (chapter.sourceOffsetMs > recipe.sourceDurationMs) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["chapters", index, "sourceOffsetMs"],
          message: "Chapter exceeds source duration",
        });
      }
      if (
        chapter.custom &&
        !chapter.hidden &&
        !isKept(chapter.sourceOffsetMs)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["chapters", index, "sourceOffsetMs"],
          message: "Custom chapter must be inside retained video",
        });
      }
    });
    if (recipe.captions.mode === "manual") {
      recipe.captions.cues.forEach((cue, index) => {
        if (cue.sourceEndMs > recipe.sourceDurationMs) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["captions", "cues", index],
            message: "Caption exceeds source duration",
          });
        }
        if (
          !recipe.keepRanges.some(
            (range) =>
              cue.sourceEndMs > range.startMs &&
              cue.sourceStartMs < range.endMs,
          )
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["captions", "cues", index],
            message: "Caption must overlap retained video",
          });
        }
      });
    }
  });

export const saveVideoEditRecipeRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  recipe: videoEditRecipeSchema,
});

export const createVideoEditVersionRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const createVideoRenderRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().trim().max(200).nullable().optional(),
});

const voiceoverCueInputObjectSchema = z.object({
  id: z.string().min(1).max(200),
  sourceStartMs: z.number().int().nonnegative().max(3_600_000),
  sourceEndMs: z.number().int().positive().max(3_600_000),
  text: z.string().trim().min(1).max(2_000),
});
export const voiceoverCueInputSchema = voiceoverCueInputObjectSchema.refine(
  (cue) => cue.sourceEndMs > cue.sourceStartMs,
  "Cue end must be after its start",
);

export const createVoiceoverRequestSchema = z.object({
  voice: z.string().trim().min(1).max(120),
  speed: z.number().finite().min(0.5).max(2),
  cues: z.array(voiceoverCueInputSchema).min(1).max(2_000),
});

export const rewriteNarrationScriptRequestSchema = z.object({
  outputLocale: outputLocaleSchema.default("en"),
  cues: z.array(voiceoverCueInputSchema).min(1).max(500),
  style: z.enum(["concise", "natural", "instructional"]).default("natural"),
  speed: z.number().finite().min(0.5).max(2).default(1),
});

export const voiceoverVoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  language: z.string().nullable().default(null),
});

export const voiceoverCueSchema = voiceoverCueInputObjectSchema
  .extend({
    ordinal: z.number().int().nonnegative(),
    contentHash: z.string(),
    status: z.enum(["pending", "processing", "ready", "failed"]),
    durationMs: z.number().int().nonnegative().nullable(),
    overlongByMs: z.number().int().nonnegative(),
    errorMessage: z.string().nullable(),
  })
  .refine(
    (cue) => cue.sourceEndMs > cue.sourceStartMs,
    "Cue end must be after its start",
  );

export const voiceoverGenerationSchema = z.object({
  id: z.string().uuid(),
  status: voiceoverGenerationStatusSchema,
  progress: z.number().min(0).max(1),
  provider: z.string(),
  model: z.string(),
  voice: z.string(),
  speed: z.number().positive(),
  scriptHash: z.string(),
  assetId: z.string().uuid().nullable(),
  errorMessage: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  cues: z.array(voiceoverCueSchema),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const videoCaptureSettingsSchema = z.object({
  tabAudio: z.boolean().default(true),
  microphone: z.boolean().default(true),
  webcam: z.boolean().default(false),
  microphoneDeviceId: z.string().max(500).nullable().optional(),
  cameraDeviceId: z.string().max(500).nullable().optional(),
  maxWidth: z.number().int().positive().max(1920).default(1920),
  maxHeight: z.number().int().positive().max(1080).default(1080),
  frameRate: z.number().int().positive().max(30).default(30),
});

export const initializeVideoRequestSchema = z.object({
  captureSettings: videoCaptureSettingsSchema,
  assets: z
    .array(
      z.object({
        kind: videoAssetKindSchema,
        mimeType: z.string().min(1).max(200),
        codec: z.string().max(200).nullable().optional(),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(2)
    .max(5)
    .refine(
      (assets) => assets.every((asset) => asset.kind !== "voiceover"),
      "Voiceovers are generated by the server",
    )
    .refine(
      (assets) => assets.some((asset) => asset.kind === "composite"),
      "Composite asset is required",
    )
    .refine(
      (assets) => assets.some((asset) => asset.kind === "screen"),
      "Clean screen asset is required",
    ),
});

export const finalizeVideoRequestSchema = z.object({
  outputLocale: outputLocaleSchema.default("en"),
  durationMs: z.number().int().nonnegative().max(3_600_000),
  recovered: z.boolean().default(false),
  assets: z
    .array(
      z.object({
        assetId: z.string().uuid(),
        durationMs: z.number().int().nonnegative().max(3_600_000).optional(),
      }),
    )
    .min(1)
    .max(5),
});

export const videoChapterSchema = z.object({
  id: z.string(),
  eventId: z.string().uuid().nullable(),
  guideItemId: z.string().uuid().nullable(),
  title: z.string(),
  offsetMs: z.number().int().nonnegative(),
  ordinal: z.number().int().nonnegative(),
});

export const recordingVideoAssetSchema = z.object({
  id: z.string().uuid(),
  kind: videoAssetKindSchema,
  mimeType: z.string(),
  codec: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  byteSize: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  status: videoAssetStatusSchema,
});

export const recordingVideoSchema = z.object({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  status: videoStatusSchema,
  durationMs: z.number().int().nonnegative().nullable(),
  captureSettings: videoCaptureSettingsSchema,
  rawAssetsComplete: z.boolean(),
  recovered: z.boolean(),
  errorMessage: z.string().nullable(),
  transcriptionStatus: transcriptionStatusSchema,
  transcriptionAvailable: z.boolean(),
  transcriptionLanguage: z.string().nullable(),
  transcriptionErrorMessage: z.string().nullable(),
  publishedAt: z.string().nullable(),
  editingAvailable: z.boolean().optional(),
  renderWorkerAvailable: z.boolean().optional(),
  playbackVersionId: z.string().uuid().nullable().optional(),
  effectiveDurationMs: z.number().int().nonnegative().nullable().optional(),
  assets: z.array(recordingVideoAssetSchema),
  chapters: z.array(videoChapterSchema),
});

export const videoEditDraftSchema = z.object({
  revision: z.number().int().nonnegative(),
  recipe: videoEditRecipeSchema,
  updatedAt: z.string(),
});

export const videoEditVersionSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().nonnegative(),
  versionType: z.enum(["named", "render", "restore"]),
  name: z.string().nullable(),
  recipe: videoEditRecipeSchema,
  mediaHash: z.string(),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
});

export const videoRenderSchema = z.object({
  id: z.string().uuid(),
  editVersionId: z.string().uuid(),
  status: videoRenderStatusSchema,
  progress: z.number().min(0).max(1),
  durationMs: z.number().int().nonnegative().nullable(),
  byteSize: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  stale: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const videoMp4ExportSchema = z.object({
  id: z.string().uuid(),
  renderId: z.string().uuid(),
  status: videoMp4ExportStatusSchema,
  progress: z.number().min(0).max(1),
  byteSize: z.number().int().nonnegative(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const transcriptSegmentSchema = z.object({
  id: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
});

export const transcriptWordSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  probability: z.number().min(0).max(1).nullable(),
});

export const recordingTranscriptSchema = z.object({
  status: transcriptionStatusSchema,
  model: z.string().nullable(),
  language: z.string().nullable(),
  languageProbability: z.number().min(0).max(1).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  sourceAssetKind: videoAssetKindSchema.nullable(),
  text: z.string(),
  segments: z.array(transcriptSegmentSchema),
  cues: z.array(transcriptSegmentSchema),
  words: z.array(transcriptWordSchema),
  errorMessage: z.string().nullable(),
});

export const videoEditorStateSchema = z.object({
  draft: videoEditDraftSchema,
  versions: z.array(videoEditVersionSchema),
  renders: z.array(videoRenderSchema),
  sourceAssets: z.array(recordingVideoAssetSchema),
  transcriptCues: z.array(transcriptSegmentSchema),
  workerAvailable: z.boolean(),
  voiceover: voiceoverGenerationSchema.nullable().default(null),
  voiceoverAvailable: z.boolean().default(false),
});

export function videoEditedDurationMs(recipe: VideoEditRecipe): number {
  return recipe.keepRanges.reduce(
    (total, range) => total + range.endMs - range.startMs,
    0,
  );
}

export function videoSourceToOutputMs(
  recipe: VideoEditRecipe,
  sourceMs: number,
): number | null {
  let outputMs = 0;
  for (const range of recipe.keepRanges) {
    if (sourceMs >= range.startMs && sourceMs < range.endMs)
      return outputMs + sourceMs - range.startMs;
    outputMs += range.endMs - range.startMs;
  }
  return null;
}

export function videoOutputToSourceMs(
  recipe: VideoEditRecipe,
  outputMs: number,
): number | null {
  if (outputMs < 0) return null;
  let remaining = outputMs;
  for (const range of recipe.keepRanges) {
    const duration = range.endMs - range.startMs;
    if (remaining < duration) return range.startMs + remaining;
    remaining -= duration;
  }
  return outputMs === videoEditedDurationMs(recipe)
    ? (recipe.keepRanges.at(-1)?.endMs ?? null)
    : null;
}

export function videoRecipeChapters(recipe: VideoEditRecipe): VideoChapter[] {
  return recipe.chapters
    .filter((chapter) => !chapter.hidden)
    .map((chapter) => ({
      chapter,
      offsetMs: videoSourceToOutputMs(recipe, chapter.sourceOffsetMs),
    }))
    .filter(
      (entry): entry is { chapter: VideoEditChapter; offsetMs: number } =>
        entry.offsetMs !== null,
    )
    .sort(
      (left, right) =>
        left.offsetMs - right.offsetMs ||
        left.chapter.ordinal - right.chapter.ordinal,
    )
    .map(({ chapter, offsetMs }, ordinal) => ({
      id: chapter.id,
      eventId: chapter.eventId,
      guideItemId: chapter.guideItemId,
      title: chapter.title,
      offsetMs,
      ordinal,
    }));
}

export function videoRecipeCaptions(
  recipe: VideoEditRecipe,
  sourceCues: TranscriptSegment[],
): TranscriptSegment[] {
  const cues =
    recipe.captions.mode === "manual"
      ? recipe.captions.cues.map((cue, id) => ({
          id,
          startMs: cue.sourceStartMs,
          endMs: cue.sourceEndMs,
          text: cue.text,
        }))
      : sourceCues;
  const output: TranscriptSegment[] = [];
  for (const cue of cues) {
    let accumulated = 0;
    for (const range of recipe.keepRanges) {
      const startMs = Math.max(cue.startMs, range.startMs);
      const endMs = Math.min(cue.endMs, range.endMs);
      if (endMs > startMs) {
        output.push({
          id: output.length,
          startMs: accumulated + startMs - range.startMs,
          endMs: accumulated + endMs - range.startMs,
          text: cue.text,
        });
      }
      accumulated += range.endMs - range.startMs;
    }
  }
  return output;
}

export const updateRecordingRequestSchema = z.object({
  title: safeTextSchema.optional(),
  purpose: z.string().trim().max(500).nullable().optional(),
  audience: safeTextSchema.nullable().optional(),
});

export const uploadEventsRequestSchema = z.object({
  captureSessionId: z.string().uuid().optional(),
  events: z.array(recordingEventSchema).min(1).max(100),
});

export const uploadScreenshotRequestSchema = z.object({
  eventId: z.string().uuid(),
  filename: safeTextSchema,
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  imageBase64: z.string().min(1),
  targetBox: boundingBoxSchema.optional(),
});

export const replaceGuideItemImageRequestSchema = z.object({
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  imageBase64: z.string().min(1),
});

export const updateGuideStepRequestSchema = z.object({
  title: safeTextSchema.optional(),
  instruction: z.string().trim().min(1).max(5000).optional(),
  altText: safeTextSchema.optional(),
});

export const guideItemKindSchema = z.enum(["step", "tip", "alert", "header"]);

export const updateGuideItemRequestSchema = z.object({
  title: safeTextSchema.optional(),
  body: z.string().trim().min(1).max(5000).optional(),
  altText: safeTextSchema.optional(),
});

export const createGuideItemRequestSchema = z.object({
  kind: guideItemKindSchema,
  afterItemId: z.string().uuid().nullable().optional(),
  title: safeTextSchema.optional(),
  body: z.string().trim().min(1).max(5000).optional(),
});

export const reorderGuideStepsRequestSchema = z.object({
  stepIds: z.array(z.string().uuid()).min(1),
});

export const reorderGuideItemsRequestSchema = z.object({
  itemIds: z.array(z.string().uuid()).min(1),
});

export const guideStepSchema = z.object({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  eventId: z.string().uuid().nullable(),
  ordinal: z.number().int().nonnegative(),
  title: z.string(),
  instruction: z.string(),
  imageFilename: z.string().nullable(),
  altText: z.string().nullable(),
  source: z.enum(["deterministic", "ai", "manual"]),
  userEdited: z.boolean(),
});

export const guideItemSchema = z.object({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  eventId: z.string().uuid().nullable(),
  ordinal: z.number().int().nonnegative(),
  kind: guideItemKindSchema,
  title: z.string(),
  body: z.string(),
  imageFilename: z.string().nullable(),
  altText: z.string().nullable(),
  source: z.enum(["deterministic", "ai", "manual"]),
  userEdited: z.boolean(),
});

export const recordingSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  purpose: z.string().nullable(),
  audience: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  userRole: z.enum(["admin", "owner", "editor", "viewer"]).optional(),
  deletedAt: z.string().nullable().optional(),
  restorableUntil: z.string().nullable().optional(),
  captureMode: captureModeSchema.default("guide"),
  state: recordingStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  finalizedAt: z.string().nullable(),
  events: z.array(
    recordingEventSchema.extend({
      id: z.string().uuid(),
      ordinal: z.number().int().nonnegative(),
    }),
  ),
  steps: z.array(guideStepSchema),
  items: z.array(guideItemSchema).default([]),
});

export const projectScreenshotSchema = z.object({
  eventId: z.string().uuid(),
  filename: safeTextSchema,
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().nonnegative().optional(),
  originalImageBase64: z.string().min(1),
  annotatedImageBase64: z.string().min(1),
  editedImageBase64: z.string().min(1).optional(),
  editOperations: screenshotEditOperationsSchema.optional(),
  targetBox: boundingBoxSchema.optional(),
});

export const recordingProjectV1Schema = z.object({
  version: z.literal(1),
  recording: recordingSchema,
  screenshots: z.array(projectScreenshotSchema),
});

export const recordingProjectV2Schema = z.object({
  version: z.literal(2),
  recording: recordingSchema,
  items: z.array(guideItemSchema),
  screenshots: z.array(projectScreenshotSchema),
});

export const recordingProjectSchema = z.union([
  recordingProjectV1Schema,
  recordingProjectV2Schema,
]);

export const userRoleSchema = z.enum(["admin", "user"]);
export const projectRoleSchema = z.enum(["owner", "editor", "viewer"]);
export const themePreferenceSchema = z.enum(["light", "dark", "system"]);

export const setupAdminRequestSchema = z.object({
  username: usernameTextSchema,
  displayName: shortTextSchema,
  password: z.string().min(10).max(256),
  setupToken: z.string().min(32).max(1024),
});

export const loginRequestSchema = z.object({
  username: shortTextSchema,
  password: z.string().min(1).max(256),
});

export const twoFactorTokenSchema = z
  .string()
  .trim()
  .min(6)
  .max(80)
  .transform((value) => value.replace(/[\s-]+/g, "").toUpperCase());

export const twoFactorLoginRequestSchema = z.object({
  continuationToken: z.string().min(32).max(512),
  code: twoFactorTokenSchema,
});

export const updateOwnPasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(10).max(256),
});

export const updateOwnPreferencesRequestSchema = z.object({
  themePreference: themePreferenceSchema,
});

export const twoFactorEnrollmentStartRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
});

export const twoFactorEnrollmentConfirmRequestSchema = z.object({
  continuationToken: z.string().min(32).max(512),
  code: twoFactorTokenSchema,
});

export const twoFactorProofRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  code: twoFactorTokenSchema,
});

export const createUserRequestSchema = z.object({
  username: usernameTextSchema,
  displayName: shortTextSchema,
  password: z.string().min(10).max(256),
  role: userRoleSchema.default("user"),
});

export const updateUserRequestSchema = z.object({
  displayName: shortTextSchema.optional(),
  role: userRoleSchema.optional(),
  enabled: z.boolean().optional(),
  password: z.string().min(10).max(256).optional(),
  twoFactorRequired: z.boolean().optional(),
});

export const adminTwoFactorResetRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  code: twoFactorTokenSchema.optional(),
});

export const deleteUserRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  code: twoFactorTokenSchema.optional(),
});

export const createProjectRequestSchema = z.object({
  name: shortTextSchema,
  description: z.string().trim().max(500).nullable().optional(),
  private: z.boolean().default(true),
});

export const updateProjectRequestSchema = z.object({
  name: shortTextSchema.optional(),
  description: z.string().trim().max(500).nullable().optional(),
  private: z.boolean().optional(),
});

export const updateProjectMemberRequestSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["editor", "viewer"]),
});

export const moveRecordingProjectRequestSchema = z.object({
  projectId: z.string().uuid(),
});

export const csrfResponseSchema = z.object({
  csrfToken: z.string().min(32),
});

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  actorDisplayName: z.string().nullable().optional(),
  eventType: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});

export const createGuideVersionRequestSchema = z.object({
  message: z.string().trim().max(500).nullable().optional(),
});

export const guideVersionListItemSchema = z.object({
  id: z.string().uuid(),
  recordingId: z.string().uuid(),
  createdByUserId: z.string().uuid().nullable(),
  createdByDisplayName: z.string().nullable(),
  versionType: z.enum(["auto", "named", "restore"]),
  message: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const guideVersionSchema = guideVersionListItemSchema.extend({
  snapshot: z.record(z.unknown()),
});

export const brandingSettingsSchema = z.object({
  displayName: safeTextSchema.default("InfoSteed"),
  iconDataUrl: z.string().max(1_500_000).nullable().optional(),
});

export const updateBrandingSettingsRequestSchema =
  brandingSettingsSchema.partial();

export const wordTemplateInspectionSchema = z.object({
  valid: z.boolean(),
  foundTags: z.array(z.string()),
  missingRequiredTags: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const wordTemplateSummarySchema = z.object({
  id: z.string().uuid(),
  name: shortTextSchema,
  originalFilename: safeTextSchema,
  sha256: z.string().length(64),
  isDefault: z.boolean(),
  inspection: wordTemplateInspectionSchema,
  uploadedByUserId: z.string().uuid().nullable(),
  uploadedByDisplayName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const updateWordTemplateRequestSchema = z
  .object({
    name: shortTextSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.isDefault !== undefined,
    "At least one template setting is required",
  );

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  role: userRoleSchema,
  enabled: z.boolean(),
  twoFactorEnabled: z.boolean().default(false),
  twoFactorRequired: z.boolean().default(false),
  themePreference: themePreferenceSchema.default("system"),
});

export const userDirectoryEntrySchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
});

export const projectSchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  role: projectRoleSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const projectMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  role: projectRoleSchema,
  enabled: z.boolean(),
});

export const recordingListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  overview: z.string().nullable(),
  projectId: z.string().uuid().nullable(),
  projectName: z.string().nullable(),
  ownerUserId: z.string().uuid().nullable(),
  ownerDisplayName: z.string().nullable(),
  updatedAt: z.string(),
  finalizedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  restorableUntil: z.string().nullable(),
  stepCount: z.number().int().nonnegative(),
  userRole: z.enum(["admin", "owner", "editor", "viewer"]),
  thumbnailFilename: z.string().nullable(),
  captureMode: captureModeSchema.default("guide"),
});

export type ActionType = z.infer<typeof actionTypeSchema>;
export type BoundingBox = z.infer<typeof boundingBoxSchema>;
export type NormalizedRect = z.infer<typeof normalizedRectSchema>;
export type ScreenshotEditOperations = z.infer<
  typeof screenshotEditOperationsSchema
>;
export type RecordingEventInput = z.input<typeof recordingEventSchema>;
export type RecordingEvent = z.output<typeof recordingEventSchema>;
export type CaptureMode = z.infer<typeof captureModeSchema>;
export type OutputLocale = z.infer<typeof outputLocaleSchema>;
export type CreateRecordingRequest = z.infer<
  typeof createRecordingRequestSchema
>;
export type UploadEventsRequest = z.infer<typeof uploadEventsRequestSchema>;
export type UploadScreenshotRequest = z.infer<
  typeof uploadScreenshotRequestSchema
>;
export type ReplaceGuideItemImageRequest = z.infer<
  typeof replaceGuideItemImageRequestSchema
>;
export type GuideStep = z.infer<typeof guideStepSchema>;
export type GuideItem = z.infer<typeof guideItemSchema>;
export type GuideItemKind = z.infer<typeof guideItemKindSchema>;
export type Recording = z.infer<typeof recordingSchema>;
export type CreateGuideItemRequest = z.infer<
  typeof createGuideItemRequestSchema
>;
export type UpdateGuideItemRequest = z.infer<
  typeof updateGuideItemRequestSchema
>;
export type RecordingProject = z.infer<typeof recordingProjectSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;
export type ProjectRole = z.infer<typeof projectRoleSchema>;
export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type UserDirectoryEntry = z.infer<typeof userDirectoryEntrySchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectMember = z.infer<typeof projectMemberSchema>;
export type RecordingListItem = z.infer<typeof recordingListItemSchema>;
export type BrandingSettings = z.infer<typeof brandingSettingsSchema>;
export type WordTemplateInspection = z.infer<
  typeof wordTemplateInspectionSchema
>;
export type WordTemplateSummary = z.infer<typeof wordTemplateSummarySchema>;
export type UpdateWordTemplateRequest = z.infer<
  typeof updateWordTemplateRequestSchema
>;
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type GuideVersionListItem = z.infer<typeof guideVersionListItemSchema>;
export type GuideVersion = z.infer<typeof guideVersionSchema>;
export type VideoAssetKind = z.infer<typeof videoAssetKindSchema>;
export type VideoCaptureSettings = z.infer<typeof videoCaptureSettingsSchema>;
export type InitializeVideoRequest = z.infer<
  typeof initializeVideoRequestSchema
>;
export type FinalizeVideoRequest = z.infer<typeof finalizeVideoRequestSchema>;
export type VideoChapter = z.infer<typeof videoChapterSchema>;
export type RecordingVideoAsset = z.infer<typeof recordingVideoAssetSchema>;
export type RecordingVideo = z.infer<typeof recordingVideoSchema>;
export type TranscriptionStatus = z.infer<typeof transcriptionStatusSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type RecordingTranscript = z.infer<typeof recordingTranscriptSchema>;
export type VideoSourceRange = z.infer<typeof videoSourceRangeSchema>;
export type VideoEditChapter = z.infer<typeof videoEditChapterSchema>;
export type EditableCaptionCue = z.infer<typeof editableCaptionCueSchema>;
export type VideoEditRecipe = z.infer<typeof videoEditRecipeSchema>;
export type SaveVideoEditRecipeRequest = z.infer<
  typeof saveVideoEditRecipeRequestSchema
>;
export type CreateVideoRenderRequest = z.infer<
  typeof createVideoRenderRequestSchema
>;
export type VideoEditDraft = z.infer<typeof videoEditDraftSchema>;
export type VideoEditVersion = z.infer<typeof videoEditVersionSchema>;
export type VideoRender = z.infer<typeof videoRenderSchema>;
export type VideoRenderStatus = z.infer<typeof videoRenderStatusSchema>;
export type VideoEditorState = z.infer<typeof videoEditorStateSchema>;
export type VideoMp4Export = z.infer<typeof videoMp4ExportSchema>;
export type VideoMp4ExportStatus = z.infer<typeof videoMp4ExportStatusSchema>;
export type VoiceoverCueInput = z.infer<typeof voiceoverCueInputSchema>;
export type CreateVoiceoverRequest = z.infer<
  typeof createVoiceoverRequestSchema
>;
export type VoiceoverVoice = z.infer<typeof voiceoverVoiceSchema>;
export type VoiceoverCue = z.infer<typeof voiceoverCueSchema>;
export type VoiceoverGeneration = z.infer<typeof voiceoverGenerationSchema>;
