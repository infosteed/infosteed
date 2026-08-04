// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef, useState } from "react";
import type {
  GuideItem,
  GuideItemKind,
  NormalizedRect,
  Recording,
  RecordingTranscript,
  RecordingVideo,
  ScreenshotEditOperations,
} from "@infosteed/shared";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";
import {
  addItem,
  deleteItem,
  deleteItemImage,
  deleteRecordingVideo,
  generateOverview,
  getImageEdits,
  getRecordingTranscript,
  getRecordingVideo,
  imageUrl,
  publishRecordingVideo,
  recordingCaptionsUrl,
  recordingVideoContentUrl,
  regenerateStep,
  replaceItemImage,
  retryRecordingTranscript,
  sourceImageUrl,
  unpublishRecordingVideo,
  updateImageEdits,
  updateItem,
  updateRecording,
} from "../api";
import { errorMessage } from "../errors";
import { guideSourceLabel } from "../guide/source";
import { currentRecordingId } from "../navigation";
import { ConfirmDialog } from "./ConfirmDialog";

interface GuideSection {
  id: string;
  title: string;
  items: GuideItem[];
}

export function useRecordingId() {
  return currentRecordingId();
}

function itemFromStep(step: Recording["steps"][number]): GuideItem {
  return {
    id: step.id,
    recordingId: step.recordingId,
    eventId: step.eventId,
    ordinal: step.ordinal,
    kind: "step",
    title: step.title,
    body: step.instruction,
    imageFilename: step.imageFilename,
    altText: step.altText,
    source: step.source,
    userEdited: step.userEdited,
  };
}

export function orderedItems(recording: Recording): GuideItem[] {
  const items =
    recording.items.length > 0
      ? recording.items
      : recording.steps.map(itemFromStep);
  return items.slice().sort((a, b) => a.ordinal - b.ordinal);
}

export type DropPosition = "before" | "after";

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
      current = { id: "section-steps", title: "Steps", items: [] };
      sections.push(current);
    }
    current.items.push(item);
  }

  return sections.length > 0
    ? sections
    : [{ id: "section-steps", title: "Steps", items: [] }];
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
          "InfoSteed extension did not respond. Reload the extension and this page, then try again.",
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
      else reject(new Error(data.result?.error ?? "Could not start capture."));
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

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
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
  const showNav = sections.length > 1 || sections[0]?.title !== "Steps";

  return (
    <div
      ref={scrollRef}
      className={showNav ? "rendered-shell with-nav" : "rendered-shell"}
      onWheel={onUserScroll}
      onTouchStart={onUserScroll}
    >
      {showNav && (
        <nav className="section-nav" aria-label="Guide sections">
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
                    <strong>{item.kind === "tip" ? "Tip" : "Alert"}</strong>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState<"chapters" | "transcript">("chapters");
  const [transcript, setTranscript] = useState<RecordingTranscript>();

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const next = await getRecordingTranscript(recording.id);
        if (disposed) return;
        setTranscript(next);
        if (
          (next.status === "ready" || next.status === "failed") &&
          video.transcriptionStatus !== next.status
        ) {
          onVideoChanged(await getRecordingVideo(recording.id));
          onRecordingChanged();
        }
      } catch {
        // Video playback does not depend on transcript availability.
      }
    };
    void load();
    if (
      video.transcriptionStatus === "pending" ||
      video.transcriptionStatus === "processing"
    ) {
      timer = window.setInterval(() => void load(), 3_000);
    }
    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
    };
  }, [recording.id, video.transcriptionStatus]);

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

  async function togglePublished() {
    setBusy(true);
    setError(undefined);
    try {
      onVideoChanged(
        video.status === "published"
          ? await unpublishRecordingVideo(recording.id)
          : await publishRecordingVideo(recording.id),
      );
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const consequence =
      recording.captureMode === "video"
        ? "This removes the video and moves the empty recording to Trash."
        : "This removes the video and raw tracks. The written guide will remain.";
    if (!window.confirm(`${consequence} Continue?`)) return;
    setBusy(true);
    try {
      const response = await deleteRecordingVideo(recording.id);
      if (!response.ok) throw new Error(await response.text());
      onVideoDeleted();
    } catch (actionError) {
      setError(errorMessage(actionError));
      setBusy(false);
    }
  }

  function seek(offsetMs: number) {
    if (!player.current) return;
    player.current.currentTime = offsetMs / 1000;
    void player.current.play();
  }

  async function retryTranscript() {
    setBusy(true);
    setError(undefined);
    try {
      const next = await retryRecordingTranscript(recording.id);
      setTranscript(next);
      onVideoChanged(await getRecordingVideo(recording.id));
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  const playable = video.status === "ready" || video.status === "published";
  return (
    <section className="video-guide-player" aria-label="Recording video">
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
                label={transcript.language ?? "Captions"}
                src={recordingCaptionsUrl(recording.id)}
                default
              />
            )}
          </video>
        ) : (
          <div className="video-processing">
            <strong>Video {video.status}</strong>
            <p>The uploaded recording is not ready for playback yet.</p>
          </div>
        )}
      </div>
      <aside className="video-chapters">
        <div className="video-chapter-head">
          <div>
            <strong>{panel === "chapters" ? "Chapters" : "Transcript"}</strong>
            <small>
              {panel === "chapters"
                ? `${video.chapters.length} captured actions`
                : transcript?.language
                  ? `Language: ${transcript.language}`
                  : "Narration"}
            </small>
          </div>
          <span className={`video-status ${video.status}`}>{video.status}</span>
        </div>
        <div className="video-panel-tabs" role="tablist">
          <button
            className={panel === "chapters" ? "active" : ""}
            onClick={() => setPanel("chapters")}
          >
            Chapters
          </button>
          <button
            className={panel === "transcript" ? "active" : ""}
            onClick={() => setPanel("transcript")}
          >
            Transcript
          </button>
        </div>
        {panel === "chapters" ? (
          <div className="chapter-list">
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
              <p>No actions were captured for chapters.</p>
            )}
          </div>
        ) : (
          <div className="chapter-list transcript-list">
            {transcript?.cues.map((segment) => (
              <button key={segment.id} onClick={() => seek(segment.startMs)}>
                <time>{formatVideoTime(segment.startMs)}</time>
                <span>{segment.text}</span>
              </button>
            ))}
            {(transcript?.status === "pending" ||
              transcript?.status === "processing") && (
              <p>
                Transcription is {transcript.status}. The video remains ready to
                use.
              </p>
            )}
            {transcript?.status === "disabled" && (
              <p>
                {video.transcriptionAvailable
                  ? "No transcript has been generated yet."
                  : "Transcription is not configured."}
              </p>
            )}
            {transcript?.status === "failed" && (
              <p className="transcript-error">
                Transcription failed:{" "}
                {transcript.errorMessage ?? "Provider unavailable"}
              </p>
            )}
            {transcript?.status === "ready" && transcript.cues.length === 0 && (
              <p>No speech was detected.</p>
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
                ? "Generate transcript"
                : "Retry transcription"}
            </button>
          )}
        {!video.rawAssetsComplete && (
          <p className="raw-warning">
            The playback video is ready, but one or more raw editing tracks
            could not be saved.
          </p>
        )}
        {editable && playable && (
          <div className="video-actions">
            <button disabled={busy} onClick={() => void togglePublished()}>
              {video.status === "published" ? "Unpublish" : "Publish video"}
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void navigator.clipboard.writeText(window.location.href)
              }
            >
              Copy link
            </button>
            <button
              className="danger-action"
              disabled={busy}
              onClick={() => void discard()}
            >
              Discard video
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </aside>
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
  async function insert(kind: GuideItemKind) {
    await addItem(recordingId, { kind, afterItemId });
    onAdded();
  }

  return (
    <div className="insert-bar">
      <button onClick={() => void insert("step")}>Step</button>
      <button onClick={() => void insert("tip")}>Tip</button>
      <button onClick={() => void insert("alert")}>Alert</button>
      <button onClick={() => void insert("header")}>Header</button>
    </div>
  );
}

function clampRect(rect: NormalizedRect): NormalizedRect {
  return {
    x: Math.max(0, Math.min(1, rect.x)),
    y: Math.max(0, Math.min(1, rect.y)),
    width: Math.max(0.01, Math.min(1 - rect.x, rect.width)),
    height: Math.max(0.01, Math.min(1 - rect.y, rect.height)),
  };
}

function ImageEditor({
  recordingId,
  filename,
  onClose,
  onSaved,
}: {
  recordingId: string;
  filename: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | undefined>();
  const [mode, setMode] = useState<"crop" | "redact">("crop");
  const [operations, setOperations] = useState<ScreenshotEditOperations>({
    redactions: [],
  });

  useEffect(() => {
    void getImageEdits(recordingId, filename).then(setOperations);
  }, [filename, recordingId]);

  function point(
    event: React.PointerEvent,
  ): { x: number; y: number } | undefined {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function finishDrag(event: React.PointerEvent) {
    const start = dragStart.current;
    const end = point(event);
    dragStart.current = undefined;
    if (!start || !end) return;
    const rect = clampRect({
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
    if (mode === "crop") setOperations({ ...operations, crop: rect });
    else
      setOperations({
        ...operations,
        redactions: [...(operations.redactions ?? []), rect],
      });
  }

  async function save() {
    await updateImageEdits(recordingId, filename, operations);
    onSaved();
    onClose();
  }

  return (
    <div className="modal-backdrop">
      <div className="image-editor">
        <div className="modal-head">
          <h2>Edit Image</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="editor-tools">
          <button
            className={mode === "crop" ? "active" : undefined}
            onClick={() => setMode("crop")}
          >
            Crop / Zoom
          </button>
          <button
            className={mode === "redact" ? "active" : undefined}
            onClick={() => setMode("redact")}
          >
            Redact
          </button>
          <button
            onClick={() =>
              setOperations({ redactions: operations.redactions ?? [] })
            }
          >
            Clear Crop
          </button>
          <button
            onClick={() => setOperations({ ...operations, redactions: [] })}
          >
            Clear Redactions
          </button>
        </div>
        <div
          className="image-edit-surface"
          onPointerDown={(event) => {
            dragStart.current = point(event);
          }}
          onPointerUp={finishDrag}
        >
          <img
            ref={imageRef}
            src={sourceImageUrl(recordingId, filename)}
            alt=""
            draggable={false}
          />
          {operations.crop && (
            <span className="crop-box" style={rectStyle(operations.crop)} />
          )}
          {(operations.redactions ?? []).map((redaction, index) => (
            <span
              key={index}
              className="redact-box"
              style={rectStyle(redaction)}
            />
          ))}
        </div>
        <div className="actions">
          <button onClick={() => void save()}>Save Image Edits</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function rectStyle(rect: NormalizedRect): React.CSSProperties {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  };
}

function MarkdownAssistantField({
  value,
  onChange,
  rows,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  rows: number;
  ariaLabel: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function replaceRange(nextValue: string, start: number, end: number) {
    onChange(nextValue);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(start, end);
    });
  }

  function wrap(prefix: string, suffix = prefix) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || "text";
    const replacement = `${prefix}${selected}${suffix}`;
    replaceRange(
      value.slice(0, start) + replacement + value.slice(end),
      start + prefix.length,
      start + prefix.length + selected.length,
    );
  }

  function link() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || "link text";
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    const replacement = `[${selected}](${url})`;
    replaceRange(
      value.slice(0, start) + replacement + value.slice(end),
      start + 1,
      start + 1 + selected.length,
    );
  }

  function list(ordered: boolean) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const nextBreak = value.indexOf("\n", end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const replacement = lines
      .map((line, index) => {
        const cleaned = line.replace(/^\s*(?:[-*]|\d+\.)\s+/, "");
        if (!cleaned.trim()) return line;
        return ordered ? `${index + 1}. ${cleaned}` : `- ${cleaned}`;
      })
      .join("\n");
    replaceRange(
      value.slice(0, lineStart) + replacement + value.slice(lineEnd),
      lineStart,
      lineStart + replacement.length,
    );
  }

  return (
    <div className="markdown-field">
      <div className="markdown-toolbar" aria-label={`${ariaLabel} formatting`}>
        <button
          type="button"
          aria-label="Bold"
          title="Bold"
          onClick={() => wrap("**")}
        >
          B
        </button>
        <button
          type="button"
          aria-label="Italic"
          title="Italic"
          onClick={() => wrap("*")}
        >
          I
        </button>
        <button type="button" aria-label="Link" title="Link" onClick={link}>
          link
        </button>
        <button
          type="button"
          aria-label="Code"
          title="Code"
          onClick={() => wrap("`")}
        >
          &lt;/&gt;
        </button>
        <button
          type="button"
          aria-label="Bullet list"
          title="Bullet list"
          onClick={() => list(false)}
        >
          -
        </button>
        <button
          type="button"
          aria-label="Numbered list"
          title="Numbered list"
          onClick={() => list(true)}
        >
          1.
        </button>
      </div>
      <textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
      />
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
}) {
  const [draft, setDraft] = useState(item);
  const [editingImage, setEditingImage] = useState(false);
  const [deleteImageOpen, setDeleteImageOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | undefined>();
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const lastSavedRef = useRef(item);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dirty =
    draft.title !== lastSavedRef.current.title ||
    draft.body !== lastSavedRef.current.body ||
    draft.altText !== lastSavedRef.current.altText;
  const needsReview =
    item.kind === "step" &&
    (item.source === "deterministic" ||
      !event?.elementName ||
      /^(div|span|i|svg|path|canvas|field|element)$/i.test(
        event.elementRole ?? "",
      ));

  useEffect(() => {
    setDraft(item);
    lastSavedRef.current = item;
    setSaveState("saved");
  }, [item.id]);

  useEffect(() => {
    if (!dirty) return undefined;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void updateItem(recordingId, draft)
        .then(() => {
          lastSavedRef.current = draft;
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [dirty, draft, recordingId]);

  function updateDraft(patch: Partial<GuideItem>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onDraftChange(next);
  }

  async function remove() {
    await deleteItem(recordingId, item.id);
    onSaved();
  }

  async function uploadImage(file?: File) {
    if (!file) return;
    if (
      file.type !== "image/png" &&
      file.type !== "image/jpeg" &&
      file.type !== "image/webp"
    ) {
      setImageError("Upload a PNG, JPEG, or WebP image.");
      return;
    }
    setImageBusy(true);
    try {
      const updated = await replaceItemImage(recordingId, item.id, {
        contentType: file.type,
        imageBase64: await fileToBase64(file),
      });
      setDraft(updated);
      lastSavedRef.current = updated;
      onDraftChange(updated);
      if (updated.imageFilename) onImageSaved(updated.imageFilename);
      onSaved();
      setImageError(undefined);
    } catch (uploadError) {
      setImageError(errorMessage(uploadError));
    } finally {
      setImageBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  }

  async function deleteImage() {
    setImageBusy(true);
    try {
      const updated = await deleteItemImage(recordingId, item.id);
      setDraft(updated);
      lastSavedRef.current = updated;
      onDraftChange(updated);
      setDeleteImageOpen(false);
      onSaved();
      setImageError(undefined);
    } catch (deleteError) {
      setImageError(errorMessage(deleteError));
    } finally {
      setImageBusy(false);
    }
  }

  const imageFilename = item.imageFilename;

  if (!isSelected) {
    if (item.kind !== "step") {
      return (
        <article
          className={`guide-item display-item ${item.kind}${editable ? "" : " view-only"}`}
          onClick={editable ? onSelect : undefined}
          tabIndex={editable ? 0 : undefined}
          onFocus={editable ? onSelect : undefined}
        >
          {(editable || item.kind !== "header") && (
            <div className="display-marker">
              {item.kind === "tip"
                ? "Tip"
                : item.kind === "alert"
                  ? "Alert"
                  : "Header"}
            </div>
          )}
          <div>
            <h3>{item.title}</h3>
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
        </div>
        {editable && (
          <div className="meta-row display-meta">
            <span className={`source ${item.source}`}>
              {guideSourceLabel(item.source)}
            </span>
            {needsReview && <span className="review">Review</span>}
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
        <label className="field-label">
          {item.kind === "header" ? "Section title" : "Title"}
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
          {item.kind === "header" ? "Section description" : "Body"}
        </label>
        <MarkdownAssistantField
          ariaLabel={item.kind === "header" ? "Section description" : "Body"}
          value={draft.body}
          onChange={(body) => updateDraft({ body })}
          rows={3}
        />
        <div className="actions">
          <span className={`save-state ${saveState}`}>
            {saveState === "saving"
              ? "Saving..."
              : saveState === "error"
                ? "Save failed"
                : "Saved"}
          </span>
          <button onClick={onCloseEdit}>Done</button>
          <button onClick={() => void remove()}>Delete</button>
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
        {needsReview && <span className="review">Review</span>}
        {event && (
          <span title={event.sanitizedUrl}>
            {event.actionType} · {event.elementRole ?? "element"} ·{" "}
            {event.pageTitle}
          </span>
        )}
      </div>
      <label className="field-label">Instruction</label>
      <MarkdownAssistantField
        ariaLabel="Instruction"
        value={draft.body}
        onChange={(body) => updateDraft({ body })}
        rows={3}
      />
      <label className="field-label">Image description</label>
      <input
        aria-label="Image description"
        value={draft.altText ?? ""}
        onChange={(event) => updateDraft({ altText: event.target.value })}
      />
      {event?.elementName && (
        <p className="raw-target">Captured target: {event.elementName}</p>
      )}
      {imageFilename && (
        <div className="image-block">
          <img
            src={versionedImageUrl(recordingId, imageFilename, imageVersion)}
            alt=""
          />
          <div className="image-actions">
            <button onClick={() => setEditingImage(true)}>Crop / Redact</button>
            <button
              disabled={imageBusy}
              onClick={() => imageInputRef.current?.click()}
            >
              Replace Image
            </button>
            <button
              className="danger-action"
              disabled={imageBusy}
              onClick={() => setDeleteImageOpen(true)}
            >
              Delete Image
            </button>
          </div>
        </div>
      )}
      {!imageFilename && item.eventId && (
        <div className="image-empty">
          <button
            disabled={imageBusy}
            onClick={() => imageInputRef.current?.click()}
          >
            Upload Image
          </button>
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
      <div className="actions">
        <span className={`save-state ${saveState}`}>
          {saveState === "saving"
            ? "Saving..."
            : saveState === "error"
              ? "Save failed"
              : "Saved"}
        </span>
        <button onClick={onCloseEdit}>Done</button>
        <button
          disabled={!item.eventId}
          onClick={async () =>
            void (await regenerateStep(recordingId, item.id), onSaved())
          }
        >
          Regenerate
        </button>
        <button onClick={() => void remove()}>Delete</button>
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
          title="Delete image?"
          body="Remove this screenshot from the step? The guide text stays in place, and the deletion is captured in version history."
          confirmLabel="Delete Image"
          tone="danger"
          onCancel={() => setDeleteImageOpen(false)}
          onConfirm={() => void deleteImage()}
        />
      )}
    </article>
  );
}

export function GuideOverviewEditor({
  recording,
  isSelected,
  onSelect,
  onCloseEdit,
  editable,
  onDraftChange,
  onSaved,
}: {
  recording: Recording;
  isSelected: boolean;
  onSelect: () => void;
  onCloseEdit: () => void;
  editable: boolean;
  onDraftChange: (recording: Recording) => void;
  onSaved: (recording: Recording) => void;
}) {
  const [draft, setDraft] = useState({
    title: recording.title,
    purpose: recording.purpose ?? "",
  });
  const [generating, setGenerating] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const lastSavedRef = useRef({
    title: recording.title,
    purpose: recording.purpose ?? "",
  });
  const dirty =
    draft.title !== lastSavedRef.current.title ||
    draft.purpose !== lastSavedRef.current.purpose;

  useEffect(() => {
    setDraft({ title: recording.title, purpose: recording.purpose ?? "" });
    lastSavedRef.current = {
      title: recording.title,
      purpose: recording.purpose ?? "",
    };
    setSaveState("saved");
  }, [recording.id]);

  useEffect(() => {
    if (!dirty) return undefined;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void updateRecording(recording.id, {
        title: draft.title,
        purpose: draft.purpose.trim() || null,
      })
        .then(() => {
          lastSavedRef.current = draft;
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [dirty, draft, recording.id]);

  function updateDraft(patch: Partial<typeof draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    onDraftChange({
      ...recording,
      title: next.title,
      purpose: next.purpose.trim() || null,
    });
  }

  async function generate() {
    setGenerating(true);
    try {
      const updated = await generateOverview(recording.id);
      const nextDraft = {
        title: updated.title,
        purpose: updated.purpose ?? "",
      };
      setDraft(nextDraft);
      lastSavedRef.current = nextDraft;
      setSaveState("saved");
      onSaved(updated);
    } finally {
      setGenerating(false);
    }
  }

  if (!isSelected) {
    return (
      <section
        className={`guide-overview display-overview${editable ? "" : " view-only"}`}
        onClick={editable ? onSelect : undefined}
        tabIndex={editable ? 0 : undefined}
        onFocus={editable ? onSelect : undefined}
      >
        <p>Workflow Guide</p>
        <h2>{recording.title}</h2>
        {recording.purpose && (
          <p className="overview-text">{recording.purpose}</p>
        )}
      </section>
    );
  }

  return (
    <section className="guide-overview selected-overview">
      <label className="field-label">Guide title</label>
      <input
        value={draft.title}
        onChange={(event) => updateDraft({ title: event.target.value })}
      />
      <label className="field-label">Overview</label>
      <MarkdownAssistantField
        ariaLabel="Overview"
        value={draft.purpose}
        onChange={(purpose) => updateDraft({ purpose })}
        rows={3}
      />
      <div className="actions">
        <span className={`save-state ${saveState}`}>
          {saveState === "saving"
            ? "Saving..."
            : saveState === "error"
              ? "Save failed"
              : "Saved"}
        </span>
        <button onClick={onCloseEdit}>Done</button>
        <button disabled={generating} onClick={() => void generate()}>
          {generating ? "Generating..." : "Generate Overview"}
        </button>
      </div>
    </section>
  );
}
