// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef } from "react";
import type { GuideItem, Recording, RecordingVideo } from "@infosteed/shared";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";
import {
  Check,
  Crop,
  Eye,
  EyeOff,
  Heading,
  ImageOff,
  ImageUp,
  Lightbulb,
  Link2,
  ListVideo,
  MousePointerClick,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  VideoOff,
  WandSparkles,
  X,
} from "lucide-react";
import {
  imageUrl,
  recordingCaptionsUrl,
  recordingVideoContentUrl,
} from "../api";
import { orderedItems } from "../guide/model";
export { orderedItems } from "../guide/model";
export type { DropPosition } from "../guide/model";
import { guideSourceLabel } from "../guide/source";
import { plural, t } from "../i18n";
import { currentRecordingId } from "../navigation";
import {
  ImageEditor,
  MarkdownAssistantField,
} from "../features/guide/GuideEditorFields";
import {
  useGuideItemEditorController,
  useGuideOverviewController,
  useInsertController,
  useVideoGuidePlayerController,
} from "../features/guide/useGuideWorkspaceControllers";
import { GuideIconButton } from "../features/guide/GuideIconButton";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface GuideSection {
  id: string;
  title: string;
  items: GuideItem[];
}

export function useRecordingId() {
  return currentRecordingId();
}

function sectionsForItems(items: GuideItem[]): GuideSection[] {
  const sections: GuideSection[] = [];
  let current: GuideSection | undefined;

  for (const item of items) {
    if (item.kind === "header") {
      current = { id: `section-${item.id}`, title: item.title, items: [item] };
      sections.push(current);
      continue;
    }

    if (!current) {
      current = { id: "section-steps", title: t("Steps"), items: [] };
      sections.push(current);
    }
    current.items.push(item);
  }

  return sections.length > 0
    ? sections
    : [{ id: "section-steps", title: t("Steps"), items: [] }];
}

function renderInlineMarkdown(value: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex)
      nodes.push(value.slice(lastIndex, match.index));
    nodes.push(<strong key={`${match.index}-${match[1]}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function versionedImageUrl(
  recordingId: string,
  filename: string,
  version: number | undefined,
): string {
  return version
    ? `${imageUrl(recordingId, filename)}?v=${version}`
    : imageUrl(recordingId, filename);
}

export function startExistingCapture(recordingId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(
        new Error(
          t(
            "InfoSteed extension did not respond. Reload the extension and this page, then try again.",
          ),
        ),
      );
    }, 5000);

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as {
        source?: string;
        type?: string;
        requestId?: string;
        result?: { ok?: boolean; error?: string };
      };
      if (
        data.source !== PRODUCT_IDENTIFIERS.extensionMessageSource ||
        data.type !== "start-capture-existing-result" ||
        data.requestId !== requestId
      ) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      if (data.result?.ok) resolve();
      else
        reject(new Error(data.result?.error ?? t("Could not start capture.")));
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: PRODUCT_IDENTIFIERS.webMessageSource,
        type: "start-capture-existing",
        recordingId,
        requestId,
      },
      window.location.origin,
    );
  });
}

export function GuideDisplayPreview({
  recording,
  imageVersions,
  scrollRef,
  onUserScroll,
}: {
  recording: Recording;
  imageVersions: Map<string, number>;
  scrollRef: (element: HTMLElement | null) => void;
  onUserScroll: () => void;
}) {
  let stepNumber = 0;
  const sections = sectionsForItems(orderedItems(recording));
  const showNav = sections.length > 1 || sections[0]?.title !== t("Steps");

  return (
    <div
      ref={scrollRef}
      className={showNav ? "rendered-shell with-nav" : "rendered-shell"}
      onWheel={onUserScroll}
      onTouchStart={onUserScroll}
    >
      {showNav && (
        <nav className="section-nav" aria-label={t("Guide sections")}>
          {sections.map((section, index) => (
            <a key={section.id} href={`#${section.id}`}>
              {section.title}
              <span>{index + 1}</span>
            </a>
          ))}
        </nav>
      )}
      <div className="rendered-guide">
        <h1>{recording.title}</h1>
        {recording.purpose && (
          <p className="rendered-overview">
            {renderInlineMarkdown(recording.purpose)}
          </p>
        )}
        {sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            className="rendered-section-group"
          >
            {section.items.map((item) => {
              if (item.kind === "header") {
                return (
                  <div key={item.id} className="rendered-section">
                    <h2>{item.title}</h2>
                    {item.body !== item.title && (
                      <p>{renderInlineMarkdown(item.body)}</p>
                    )}
                  </div>
                );
              }
              if (item.kind === "tip" || item.kind === "alert") {
                return (
                  <aside
                    key={item.id}
                    className={`rendered-callout ${item.kind}`}
                  >
                    <strong>
                      {item.kind === "tip" ? t("Tip") : t("Alert")}
                    </strong>
                    <p>{renderInlineMarkdown(item.body)}</p>
                  </aside>
                );
              }

              stepNumber += 1;
              return (
                <section key={item.id} className="rendered-step">
                  <span>{stepNumber}</span>
                  <div>
                    <p>{renderInlineMarkdown(item.body)}</p>
                    {item.imageFilename && (
                      <img
                        src={versionedImageUrl(
                          recording.id,
                          item.imageFilename,
                          imageVersions.get(item.imageFilename),
                        )}
                        alt={item.altText ?? item.title}
                      />
                    )}
                  </div>
                </section>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

function formatVideoTime(offsetMs: number) {
  const seconds = Math.floor(offsetMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VideoGuidePlayer({
  recording,
  video,
  editable,
  onVideoChanged,
  onRecordingChanged,
  onVideoDeleted,
}: {
  recording: Recording;
  video: RecordingVideo;
  editable: boolean;
  onVideoChanged: (video: RecordingVideo) => void;
  onRecordingChanged: () => void;
  onVideoDeleted: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const {
    busy,
    error,
    panel,
    setPanel,
    panelOpen,
    setPanelOpen,
    transcript,
    togglePublished,
    discard,
    retryTranscript,
  } = useVideoGuidePlayerController({
    recording,
    video,
    onVideoChanged,
    onRecordingChanged,
    onVideoDeleted,
  });
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const chaptersTab = useRef<HTMLButtonElement>(null);
  const transcriptTab = useRef<HTMLButtonElement>(null);
  const panelId = `video-navigation-${recording.id}`;

  function closePanel(restoreFocus = true) {
    setPanelOpen(false);
    if (restoreFocus) panelTrigger.current?.focus();
  }

  function selectPanel(next: "chapters" | "transcript") {
    setPanel(next);
    window.requestAnimationFrame(() => {
      (next === "chapters" ? chaptersTab : transcriptTab).current?.focus();
    });
  }

  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement) closePanel(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  function openChapter(offsetMs: number, guideItemId: string | null) {
    if (player.current) {
      player.current.currentTime = offsetMs / 1000;
      void player.current.play();
    }
    if (recording.captureMode === "both" && guideItemId) {
      const element = document.getElementById(`guide-item-${guideItemId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.classList.add("chapter-highlight");
      window.setTimeout(
        () => element?.classList.remove("chapter-highlight"),
        1800,
      );
    }
  }

  function seek(offsetMs: number) {
    if (!player.current) return;
    player.current.currentTime = offsetMs / 1000;
    void player.current.play();
  }

  const playable = video.status === "ready" || video.status === "published";
  return (
    <section className="video-guide-player" aria-label={t("Recording video")}>
      <div className="video-stage-shell">
        <div className="video-stage">
          {playable ? (
            <video
              ref={player}
              controls
              preload="metadata"
              crossOrigin="use-credentials"
              src={recordingVideoContentUrl(recording.id)}
            >
              {transcript?.status === "ready" && (
                <track
                  kind="captions"
                  srcLang={transcript.language ?? "und"}
                  label={transcript.language ?? t("Captions")}
                  src={recordingCaptionsUrl(recording.id)}
                  default
                />
              )}
            </video>
          ) : (
            <div className="video-processing">
              <strong>
                {t("Video {status}", { status: t(video.status) })}
              </strong>
              <p>
                {t("The uploaded recording is not ready for playback yet.")}
              </p>
            </div>
          )}
        </div>
        <button
          ref={panelTrigger}
          className="video-panel-trigger"
          type="button"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <ListVideo aria-hidden="true" />
          <span>{t("Chapters")}</span>
          <span className="video-panel-count" aria-hidden="true">
            {video.chapters.length}
          </span>
        </button>
        <aside
          id={panelId}
          className={`video-chapters-drawer${panelOpen ? " open" : ""}`}
          aria-label={t("Chapters and transcript")}
          aria-hidden={!panelOpen}
          {...(!panelOpen ? { inert: "" } : {})}
        >
          <div className="video-chapter-head">
            <div>
              <strong>
                {panel === "chapters" ? t("Chapters") : t("Transcript")}
              </strong>
              <small>
                {panel === "chapters"
                  ? plural(
                      "{count} captured action",
                      "{count} captured actions",
                      video.chapters.length,
                    )
                  : transcript?.language
                    ? t("Language: {language}", {
                        language: transcript.language,
                      })
                    : t("Narration")}
              </small>
            </div>
            <button
              className="video-panel-close"
              type="button"
              aria-label={t("Close chapters and transcript")}
              onClick={() => closePanel()}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div
            className="video-panel-tabs"
            role="tablist"
            aria-label={t("Video navigation")}
          >
            <button
              ref={chaptersTab}
              id={`${panelId}-chapters-tab`}
              type="button"
              role="tab"
              aria-selected={panel === "chapters"}
              aria-controls={`${panelId}-chapters-panel`}
              tabIndex={panel === "chapters" ? 0 : -1}
              className={panel === "chapters" ? "active" : ""}
              onClick={() => setPanel("chapters")}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectPanel("transcript");
                }
              }}
            >
              {t("Chapters")}
            </button>
            <button
              ref={transcriptTab}
              id={`${panelId}-transcript-tab`}
              type="button"
              role="tab"
              aria-selected={panel === "transcript"}
              aria-controls={`${panelId}-transcript-panel`}
              tabIndex={panel === "transcript" ? 0 : -1}
              className={panel === "transcript" ? "active" : ""}
              onClick={() => setPanel("transcript")}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectPanel("chapters");
                }
              }}
            >
              {t("Transcript")}
            </button>
          </div>
          {panel === "chapters" ? (
            <div
              id={`${panelId}-chapters-panel`}
              className="chapter-list"
              role="tabpanel"
              aria-labelledby={`${panelId}-chapters-tab`}
            >
              {video.chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  onClick={() =>
                    openChapter(chapter.offsetMs, chapter.guideItemId)
                  }
                >
                  <time>{formatVideoTime(chapter.offsetMs)}</time>
                  <span>{chapter.title}</span>
                </button>
              ))}
              {video.chapters.length === 0 && (
                <p>{t("No actions were captured for chapters.")}</p>
              )}
            </div>
          ) : (
            <div
              id={`${panelId}-transcript-panel`}
              className="chapter-list transcript-list"
              role="tabpanel"
              aria-labelledby={`${panelId}-transcript-tab`}
            >
              {transcript?.cues.map((segment) => (
                <button key={segment.id} onClick={() => seek(segment.startMs)}>
                  <time>{formatVideoTime(segment.startMs)}</time>
                  <span>{segment.text}</span>
                </button>
              ))}
              {(transcript?.status === "pending" ||
                transcript?.status === "processing") && (
                <p>
                  {t(
                    "Transcription is {status}. The video remains ready to use.",
                    {
                      status: t(transcript.status),
                    },
                  )}
                </p>
              )}
              {transcript?.status === "disabled" && (
                <p>
                  {video.transcriptionAvailable
                    ? t("No transcript has been generated yet.")
                    : t("Transcription is not configured.")}
                </p>
              )}
              {transcript?.status === "failed" && (
                <p className="transcript-error">
                  {t("Transcription failed: {error}", {
                    error: transcript.errorMessage ?? t("Provider unavailable"),
                  })}
                </p>
              )}
              {transcript?.status === "ready" &&
                transcript.cues.length === 0 && (
                  <p>{t("No speech was detected.")}</p>
                )}
            </div>
          )}
          {editable &&
            video.transcriptionAvailable &&
            (transcript?.status === "failed" ||
              transcript?.status === "disabled") && (
              <button
                className="retry-transcript"
                disabled={busy}
                onClick={() => void retryTranscript()}
              >
                {transcript.status === "disabled"
                  ? t("Generate transcript")
                  : t("Retry transcription")}
              </button>
            )}
        </aside>
      </div>
      <footer className="video-player-footer">
        <span className={`video-status ${video.status}`}>
          {t(video.status)}
        </span>
        {editable && playable && (
          <div className="video-actions">
            <GuideIconButton
              label={
                video.status === "published"
                  ? t("Unpublish")
                  : t("Publish video")
              }
              disabled={busy}
              onClick={() => void togglePublished()}
            >
              {video.status === "published" ? (
                <EyeOff aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
            </GuideIconButton>
            <GuideIconButton
              label={t("Copy link")}
              disabled={busy}
              onClick={() =>
                void navigator.clipboard.writeText(window.location.href)
              }
            >
              <Link2 aria-hidden="true" />
            </GuideIconButton>
            <GuideIconButton
              label={t("Discard video")}
              tone="danger"
              disabled={busy}
              onClick={() => void discard()}
            >
              <VideoOff aria-hidden="true" />
            </GuideIconButton>
          </div>
        )}
      </footer>
      {(!video.rawAssetsComplete || error) && (
        <div className="video-player-messages">
          {!video.rawAssetsComplete && (
            <p className="raw-warning">
              {t(
                "The playback video is ready, but one or more raw editing tracks could not be saved.",
              )}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </section>
  );
}

export function InsertBar({
  recordingId,
  afterItemId,
  onAdded,
}: {
  recordingId: string;
  afterItemId?: string | null;
  onAdded: () => void;
}) {
  const insert = useInsertController({ recordingId, afterItemId, onAdded });

  return (
    <div className="insert-bar">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <GuideIconButton label={t("Add guide item")} tooltip={false}>
            <Plus aria-hidden="true" />
          </GuideIconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onSelect={() => void insert("step")}>
            <MousePointerClick />
            {t("Step")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void insert("tip")}>
            <Lightbulb />
            {t("Tip")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void insert("alert")}>
            <TriangleAlert />
            {t("Alert")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void insert("header")}>
            <Heading />
            {t("Header")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function GuideItemEditor({
  recordingId,
  item,
  event,
  stepNumber,
  imageVersion,
  onImageSaved,
  isSelected,
  onSelect,
  onCloseEdit,
  editable,
  onDraftChange,
  onSaved,
  controls,
}: {
  recordingId: string;
  item: GuideItem;
  event?: Recording["events"][number];
  stepNumber?: number;
  imageVersion?: number;
  onImageSaved: (filename: string) => void;
  isSelected: boolean;
  onSelect: () => void;
  onCloseEdit: () => void;
  editable: boolean;
  onDraftChange: (item: GuideItem) => void;
  onSaved: () => void;
  controls?: React.ReactNode;
}) {
  const {
    draft,
    editingImage,
    setEditingImage,
    deleteImageOpen,
    setDeleteImageOpen,
    imageBusy,
    imageError,
    saveState,
    imageInputRef,
    updateDraft,
    remove,
    uploadImage,
    deleteImage,
    regenerate,
  } = useGuideItemEditorController({
    recordingId,
    item,
    onImageSaved,
    onDraftChange,
    onSaved,
  });
  const needsReview =
    item.kind === "step" &&
    (item.source === "deterministic" ||
      !event?.elementName ||
      /^(div|span|i|svg|path|canvas|field|element)$/i.test(
        event.elementRole ?? "",
      ));

  const imageFilename = item.imageFilename;
  const kindLabel =
    item.kind === "tip"
      ? t("Tip")
      : item.kind === "alert"
        ? t("Alert")
        : t("Header");
  const repeatsKind =
    (item.kind === "tip" || item.kind === "alert") &&
    item.title.trim().localeCompare(kindLabel, undefined, {
      sensitivity: "base",
    }) === 0;

  if (!isSelected) {
    if (item.kind !== "step") {
      return (
        <article
          className={`guide-item display-item ${item.kind}${editable ? "" : " view-only"}`}
          onClick={editable ? onSelect : undefined}
          tabIndex={editable ? 0 : undefined}
          onFocus={editable ? onSelect : undefined}
        >
          <div className="guide-item-head">
            {(editable || item.kind !== "header") && (
              <div className="display-marker">{kindLabel}</div>
            )}
            {controls}
          </div>
          <div>
            {!repeatsKind && <h3>{item.title}</h3>}
            {item.body && item.body !== item.title && (
              <p>{renderInlineMarkdown(item.body)}</p>
            )}
          </div>
        </article>
      );
    }

    return (
      <article
        className={`${needsReview ? "display-item needs-review" : "display-item"}${editable ? "" : " view-only"}`}
        onClick={editable ? onSelect : undefined}
        tabIndex={editable ? 0 : undefined}
        onFocus={editable ? onSelect : undefined}
      >
        <div className="display-step-head">
          <span>{stepNumber}</span>
          <div>
            <p>{renderInlineMarkdown(item.body)}</p>
          </div>
          {controls}
        </div>
        {editable && (
          <div className="meta-row display-meta">
            <span className={`source ${item.source}`}>
              {guideSourceLabel(item.source)}
            </span>
            {needsReview && <span className="review">{t("Review")}</span>}
          </div>
        )}
        {imageFilename && (
          <div className="image-block">
            <img
              src={versionedImageUrl(recordingId, imageFilename, imageVersion)}
              alt=""
            />
          </div>
        )}
      </article>
    );
  }

  if (item.kind !== "step") {
    return (
      <article className={`guide-item selected-item ${item.kind}`}>
        <div className="guide-item-controls">{controls}</div>
        <label className="field-label">
          {item.kind === "header" ? t("Section title") : t("Title")}
        </label>
        <div className="step-head">
          <span>
            {item.kind === "tip" ? "T" : item.kind === "alert" ? "!" : "H"}
          </span>
          <input
            value={draft.title}
            onChange={(event) => updateDraft({ title: event.target.value })}
          />
        </div>
        <label className="field-label">
          {item.kind === "header" ? t("Section description") : t("Body")}
        </label>
        <MarkdownAssistantField
          ariaLabel={
            item.kind === "header" ? t("Section description") : t("Body")
          }
          value={draft.body}
          onChange={(body) => updateDraft({ body })}
          rows={3}
        />
        <div className="actions guide-action-toolbar">
          <span className={`save-state ${saveState}`}>
            {saveState === "saving"
              ? t("Saving...")
              : saveState === "error"
                ? t("Save failed")
                : t("Saved")}
          </span>
          <GuideIconButton label={t("Done")} onClick={onCloseEdit}>
            <Check aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Delete")}
            tone="danger"
            onClick={() => void remove()}
          >
            <Trash2 aria-hidden="true" />
          </GuideIconButton>
        </div>
      </article>
    );
  }

  return (
    <article
      className={needsReview ? "selected-item needs-review" : "selected-item"}
    >
      <div className="step-edit-head">
        <span>{stepNumber}</span>
        <span className={`source ${item.source}`}>{item.source}</span>
        {needsReview && <span className="review">{t("Review")}</span>}
        {event && (
          <span title={event.sanitizedUrl}>
            {event.actionType} · {event.elementRole ?? "element"} ·{" "}
            {event.pageTitle}
          </span>
        )}
        <div className="guide-item-controls">{controls}</div>
      </div>
      <label className="field-label">{t("Instruction")}</label>
      <MarkdownAssistantField
        ariaLabel={t("Instruction")}
        value={draft.body}
        onChange={(body) => updateDraft({ body })}
        rows={3}
      />
      <label className="field-label">{t("Image description")}</label>
      <input
        aria-label={t("Image description")}
        value={draft.altText ?? ""}
        onChange={(event) => updateDraft({ altText: event.target.value })}
      />
      {event?.elementName && (
        <p className="raw-target">
          {t("Captured target: {target}", { target: event.elementName })}
        </p>
      )}
      {imageFilename && (
        <div className="image-block">
          <img
            src={versionedImageUrl(recordingId, imageFilename, imageVersion)}
            alt=""
          />
        </div>
      )}
      <input
        ref={imageInputRef}
        className="hidden-file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => void uploadImage(event.target.files?.[0])}
      />
      {imageError && <p className="error">{imageError}</p>}
      <div className="actions guide-action-toolbar">
        <span className={`save-state ${saveState}`}>
          {saveState === "saving"
            ? t("Saving...")
            : saveState === "error"
              ? t("Save failed")
              : t("Saved")}
        </span>
        {imageFilename ? (
          <>
            <GuideIconButton
              label={t("Crop / Redact")}
              onClick={() => setEditingImage(true)}
            >
              <Crop aria-hidden="true" />
            </GuideIconButton>
            <GuideIconButton
              label={t("Replace Image")}
              disabled={imageBusy}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImageUp aria-hidden="true" />
            </GuideIconButton>
            <GuideIconButton
              label={t("Delete Image")}
              tone="danger"
              disabled={imageBusy}
              onClick={() => setDeleteImageOpen(true)}
            >
              <ImageOff aria-hidden="true" />
            </GuideIconButton>
            <span className="guide-toolbar-divider" aria-hidden="true" />
          </>
        ) : (
          item.eventId && (
            <>
              <GuideIconButton
                label={t("Upload Image")}
                disabled={imageBusy}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImageUp aria-hidden="true" />
              </GuideIconButton>
              <span className="guide-toolbar-divider" aria-hidden="true" />
            </>
          )
        )}
        <GuideIconButton label={t("Done")} onClick={onCloseEdit}>
          <Check aria-hidden="true" />
        </GuideIconButton>
        <GuideIconButton
          label={t("Regenerate")}
          disabled={!item.eventId}
          onClick={() => void regenerate()}
        >
          <RefreshCw aria-hidden="true" />
        </GuideIconButton>
        <GuideIconButton
          label={t("Delete")}
          tone="danger"
          onClick={() => void remove()}
        >
          <Trash2 aria-hidden="true" />
        </GuideIconButton>
      </div>
      {editingImage && imageFilename && (
        <ImageEditor
          recordingId={recordingId}
          filename={imageFilename}
          onClose={() => setEditingImage(false)}
          onSaved={() => {
            onImageSaved(imageFilename);
            onSaved();
          }}
        />
      )}
      {deleteImageOpen && (
        <ConfirmDialog
          title={t("Delete image?")}
          body={t(
            "Remove this screenshot from the step? The guide text stays in place, and the deletion is captured in version history.",
          )}
          confirmLabel={t("Delete Image")}
          tone="danger"
          onCancel={() => setDeleteImageOpen(false)}
          onConfirm={() => void deleteImage()}
        />
      )}
    </article>
  );
}

export function GuideOverviewEditor({
  elementId,
  recording,
  isSelected,
  onSelect,
  onCloseEdit,
  editable,
  onDraftChange,
  onSaved,
}: {
  elementId?: string;
  recording: Recording;
  isSelected: boolean;
  onSelect: () => void;
  onCloseEdit: () => void;
  editable: boolean;
  onDraftChange: (recording: Recording) => void;
  onSaved: (recording: Recording) => void;
}) {
  const { draft, generating, saveState, updateDraft, generate } =
    useGuideOverviewController({ recording, onDraftChange, onSaved });

  if (!isSelected) {
    return (
      <section
        id={elementId}
        className={`guide-overview display-overview${editable ? "" : " view-only"}`}
        onClick={editable ? onSelect : undefined}
        tabIndex={editable ? 0 : undefined}
        onFocus={editable ? onSelect : undefined}
      >
        <p>{t("Workflow Guide")}</p>
        <h2>{recording.title}</h2>
        {recording.purpose && (
          <p className="overview-text">{recording.purpose}</p>
        )}
      </section>
    );
  }

  return (
    <section id={elementId} className="guide-overview selected-overview">
      <label className="field-label">{t("Guide title")}</label>
      <input
        value={draft.title}
        onChange={(event) => updateDraft({ title: event.target.value })}
      />
      <label className="field-label">{t("Overview")}</label>
      <MarkdownAssistantField
        ariaLabel={t("Overview")}
        value={draft.purpose}
        onChange={(purpose) => updateDraft({ purpose })}
        rows={3}
      />
      <div className="actions guide-action-toolbar">
        <span className={`save-state ${saveState}`}>
          {saveState === "saving"
            ? t("Saving...")
            : saveState === "error"
              ? t("Save failed")
              : t("Saved")}
        </span>
        <GuideIconButton label={t("Done")} onClick={onCloseEdit}>
          <Check aria-hidden="true" />
        </GuideIconButton>
        <GuideIconButton
          label={generating ? t("Generating...") : t("Generate Overview")}
          disabled={generating}
          onClick={() => void generate()}
        >
          <WandSparkles aria-hidden="true" />
        </GuideIconButton>
      </div>
    </section>
  );
}
