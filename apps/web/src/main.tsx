// SPDX-License-Identifier: AGPL-3.0-only
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { generateGuideMarkdown } from "@infosteed/markdown-exporter";
import type {
  BrandingSettings,
  CurrentUser,
  GuideVersion,
  GuideVersionListItem,
  GuideItem,
  GuideItemKind,
  NormalizedRect,
  Project,
  ProjectMember,
  Recording,
  RecordingVideo,
  RecordingTranscript,
  RecordingListItem,
  RecordingProject,
  ScreenshotEditOperations,
  UserDirectoryEntry,
} from "@infosteed/shared";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";
import {
  addItem,
  createGuideVersion,
  createProject,
  createUser,
  deleteItemImage,
  deleteItem,
  deleteRecording,
  exportUrl,
  generateOverview,
  getBranding,
  getAdminSystemStatus,
  getImageEdits,
  getRecording,
  getRecordingVideo,
  getRecordingTranscript,
  getGuideVersion,
  htmlExportUrl,
  imageUrl,
  importProject,
  listProjects,
  listGuideVersions,
  listProjectMembers,
  listRecordings,
  listUserDirectory,
  listUsers,
  login,
  logout,
  logoutAll,
  me,
  moveRecordingToProject,
  pdfExportUrl,
  projectExportUrl,
  regenerateStep,
  replaceItemImage,
  restoreRecording,
  restoreGuideVersion,
  reorderItems,
  sanityExportUrl,
  publishRecordingVideo,
  unpublishRecordingVideo,
  deleteRecordingVideo,
  recordingVideoContentUrl,
  recordingCaptionsUrl,
  retryRecordingTranscript,
  setupAdmin,
  systemInfo,
  setupStatus,
  sourceImageUrl,
  removeProjectMember,
  setProjectMember,
  updateBranding,
  updateProject,
  updateRecording,
  updateImageEdits,
  updateItem,
  updateUser,
  wordExportUrl,
} from "./api";
import "./styles.css";
import { VideoEditor } from "./VideoEditor";

interface GuideSection {
  id: string;
  title: string;
  items: GuideItem[];
}

function useRecordingId() {
  return new URLSearchParams(window.location.search).get("recordingId");
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

function orderedItems(recording: Recording): GuideItem[] {
  const items =
    recording.items.length > 0
      ? recording.items
      : recording.steps.map(itemFromStep);
  return items.slice().sort((a, b) => a.ordinal - b.ordinal);
}

type DropPosition = "before" | "after";

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

function startExistingCapture(recordingId: string): Promise<void> {
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

function GuideDisplayPreview({
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

function VideoGuidePlayer({
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
      setError(
        actionError instanceof Error
          ? actionError.message
          : String(actionError),
      );
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
      setError(
        actionError instanceof Error
          ? actionError.message
          : String(actionError),
      );
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
      setError(
        actionError instanceof Error
          ? actionError.message
          : String(actionError),
      );
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

function InsertBar({
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

function GuideItemEditor({
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
      setImageError(
        uploadError instanceof Error
          ? uploadError.message
          : String(uploadError),
      );
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
      setImageError(
        deleteError instanceof Error
          ? deleteError.message
          : String(deleteError),
      );
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
            <span className={`source ${item.source}`}>{item.source}</span>
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

function GuideOverviewEditor({
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

function AuthForm({
  mode,
  onDone,
}: {
  mode: "setup" | "login";
  onDone: (user: CurrentUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      const result =
        mode === "setup"
          ? await setupAdmin({
              username,
              displayName: displayName || username,
              password,
              setupToken,
            })
          : await login({ username, password });
      onDone(result.user);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : String(submitError),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <p>{mode === "setup" ? "First Run" : "InfoSteed"}</p>
        <h1>{mode === "setup" ? "Create the first admin" : "Sign in"}</h1>
        <label>
          Username
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
          />
        </label>
        {mode === "setup" && (
          <label>
            Display name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={
              mode === "setup" ? "new-password" : "current-password"
            }
          />
        </label>
        {mode === "setup" && (
          <label>
            Setup token
            <input
              type="password"
              value={setupToken}
              onChange={(event) => setSetupToken(event.target.value)}
              autoComplete="off"
              minLength={32}
            />
          </label>
        )}
        <button disabled={submitting}>
          {submitting
            ? "Working..."
            : mode === "setup"
              ? "Create Admin"
              : "Log In"}
        </button>
        {error && <p className="error">{error}</p>}
        <a href="/?view=legal">About and legal</a>
      </form>
    </main>
  );
}

function age(value: string): string {
  const diffMs = Date.now() - new Date(value).getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function daysUntil(value: string | null | undefined): string {
  if (!value) return "";
  const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "expires today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = "default",
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="confirm-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            className={tone === "danger" ? "danger-action" : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function GuideBrowser({
  user,
  branding,
  onOpenAdmin,
  onLogout,
  onLogoutAll,
}: {
  user: CurrentUser;
  branding: BrandingSettings;
  onOpenAdmin: () => void;
  onLogout: () => void;
  onLogoutAll: () => void;
}) {
  const [guides, setGuides] = useState<RecordingListItem[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scope, setScope] = useState<"all" | "owned" | "shared" | "trash">(
    "all",
  );
  const [sort, setSort] = useState<"recent" | "title">("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [error, setError] = useState<string | undefined>();
  const [newProjectName, setNewProjectName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<
    RecordingListItem | undefined
  >();
  const importInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [guideResult, projectResult] = await Promise.all([
        listRecordings({ search, projectId, scope, sort }),
        listProjects(),
      ]);
      setGuides(guideResult.items);
      setProjects(projectResult.projects);
      setError(undefined);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    }
  }, [projectId, scope, search, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addProject(event: React.FormEvent) {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    await createProject({ name: newProjectName.trim(), private: true });
    setNewProjectName("");
    await load();
  }

  async function handleImport(file?: File) {
    if (!file) return;
    try {
      const project = JSON.parse(await file.text()) as RecordingProject;
      const imported = await importProject(project, projectId || undefined);
      window.location.assign(`/?recordingId=${imported.id}`);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : String(importError),
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function deleteGuide(guide: RecordingListItem) {
    const response = await deleteRecording(guide.id);
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    setDeleteCandidate(undefined);
    await load();
  }

  async function restoreGuide(guide: RecordingListItem) {
    await restoreRecording(guide.id);
    await load();
  }

  return (
    <main className="browser-page">
      <header>
        <div>
          <p>My Guides</p>
          <div className="brand-heading">
            {branding.iconDataUrl && <img src={branding.iconDataUrl} alt="" />}
            <h1>{branding.displayName || "InfoSteed"}</h1>
          </div>
        </div>
        <div className="header-actions">
          <span className="user-chip">{user.displayName}</span>
          {user.role === "admin" && (
            <button onClick={onOpenAdmin}>Admin</button>
          )}
          <button onClick={onLogout}>Log Out</button>
          <button onClick={onLogoutAll}>Log Out All Sessions</button>
        </div>
      </header>
      <section className="browser-shell">
        <div className="browser-head">
          <div>
            <h2>{scope === "trash" ? "Trash" : "Recents"}</h2>
            <p>
              {guides.length} accessible guide{guides.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="browser-controls">
            <input
              placeholder="Search guides"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button onClick={() => importInputRef.current?.click()}>
              Import Project
            </button>
            <input
              ref={importInputRef}
              className="hidden-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as typeof scope)}
            >
              <option value="all">All access</option>
              <option value="owned">Owned</option>
              <option value="shared">Shared</option>
              <option value="trash">Trash</option>
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="recent">Recent</option>
              <option value="title">Title</option>
            </select>
            <button onClick={() => setView(view === "grid" ? "list" : "grid")}>
              {view === "grid" ? "List" : "Grid"}
            </button>
          </div>
        </div>
        <form
          className="quick-project"
          onSubmit={(event) => void addProject(event)}
        >
          <input
            placeholder="New private project"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
          />
          <button>Create Project</button>
        </form>
        {error && <p className="error">{error}</p>}
        <div className={view === "grid" ? "guide-grid" : "guide-list"}>
          {guides.map((guide) => (
            <article
              key={guide.id}
              className={`guide-card${guide.deletedAt ? " deleted" : ""}`}
            >
              <div className="guide-thumb">
                {guide.thumbnailFilename ? (
                  <img
                    src={versionedImageUrl(
                      guide.id,
                      guide.thumbnailFilename,
                      undefined,
                    )}
                    alt=""
                  />
                ) : (
                  <span>{guide.title.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <a
                className="guide-open"
                href={`/?recordingId=${guide.id}${guide.captureMode === "guide" ? "" : "&view=video"}`}
              >
                <p>
                  {guide.projectName ?? "Private"} ·{" "}
                  {guide.captureMode === "both"
                    ? "Video + Guide"
                    : guide.captureMode === "video"
                      ? "Video"
                      : "Guide"}
                </p>
                <h3>{guide.title}</h3>
                {guide.overview && (
                  <p className="guide-snippet">{guide.overview}</p>
                )}
                <small>
                  {guide.deletedAt
                    ? `Deleted ${age(guide.deletedAt)} · ${daysUntil(guide.restorableUntil)}`
                    : age(guide.updatedAt)}{" "}
                  · {guide.ownerDisplayName ?? "Unknown owner"} ·{" "}
                  {guide.stepCount} steps · {guide.userRole}
                </small>
              </a>
              <div className="guide-card-actions">
                {guide.deletedAt ? (
                  <button onClick={() => void restoreGuide(guide)}>
                    Restore
                  </button>
                ) : (
                  <button
                    className="danger-action"
                    onClick={() => setDeleteCandidate(guide)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      {deleteCandidate && (
        <ConfirmDialog
          title="Delete guide?"
          body={`"${deleteCandidate.title}" will move to Trash and can be restored for 10 days.`}
          confirmLabel="Delete Guide"
          tone="danger"
          onCancel={() => setDeleteCandidate(undefined)}
          onConfirm={() => void deleteGuide(deleteCandidate)}
        />
      )}
    </main>
  );
}

function AdminPanel({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<CurrentUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"editor" | "viewer">("viewer");
  const [branding, setBranding] = useState<BrandingSettings>({
    displayName: "InfoSteed",
    iconDataUrl: null,
  });
  const [newUser, setNewUser] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "user" as "admin" | "user",
  });
  const [error, setError] = useState<string | undefined>();
  const [systemStatus, setSystemStatus] =
    useState<Awaited<ReturnType<typeof getAdminSystemStatus>>>();

  async function load() {
    try {
      const [userResult, brandingResult, projectResult, nextSystemStatus] =
        await Promise.all([
          listUsers(),
          getBranding(),
          listProjects(),
          getAdminSystemStatus(),
        ]);
      setUsers(userResult.users);
      setBranding(brandingResult);
      setProjects(projectResult.projects);
      setSystemStatus(nextSystemStatus);
      const nextProjectId =
        selectedProjectId || projectResult.projects[0]?.id || "";
      setSelectedProjectId(nextProjectId);
      if (nextProjectId) {
        setMembers((await listProjectMembers(nextProjectId)).members);
      } else {
        setMembers([]);
      }
      setError(undefined);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setMembers([]);
      return;
    }
    void listProjectMembers(selectedProjectId).then((result) =>
      setMembers(result.members),
    );
  }, [selectedProjectId]);

  async function addUser(event: React.FormEvent) {
    event.preventDefault();
    await createUser(newUser);
    setNewUser({ username: "", displayName: "", password: "", role: "user" });
    await load();
  }

  async function readIcon(file?: File) {
    if (!file) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setBranding(await updateBranding({ iconDataUrl: dataUrl }));
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProjectId || !memberUserId) return;
    await setProjectMember(selectedProjectId, {
      userId: memberUserId,
      role: memberRole,
    });
    setMembers((await listProjectMembers(selectedProjectId)).members);
  }

  async function toggleProjectPrivate(project: Project) {
    await updateProject(project.id, { private: !project.private });
    await load();
  }

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <div>
          <p>Admin</p>
          <h1>Workspace Settings</h1>
        </div>
        <button onClick={onClose}>Close Admin</button>
      </header>
      <div className="admin-shell">
        <nav className="admin-sidebar" aria-label="Admin sections">
          <button
            onClick={() =>
              document.getElementById("admin-branding")?.scrollIntoView()
            }
          >
            Branding
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-users")?.scrollIntoView()
            }
          >
            Users
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-projects")?.scrollIntoView()
            }
          >
            Projects
          </button>
          <button
            onClick={() =>
              document.getElementById("admin-system")?.scrollIntoView()
            }
          >
            System
          </button>
        </nav>
        <section className="admin-content">
          <article id="admin-system" className="admin-section">
            <div className="section-title">
              <div>
                <p>Operations</p>
                <h2>Providers and workers</h2>
              </div>
              <span className="status-pill neutral">
                Protocol {systemStatus?.protocolVersion ?? "-"}
              </span>
            </div>
            <div className="settings-strip">
              {Object.entries(systemStatus?.providers ?? {}).map(
                ([name, value]) => (
                  <span key={name}>
                    <strong>{name}</strong>: {value}
                  </span>
                ),
              )}
              {Object.entries(systemStatus?.workers ?? {}).map(
                ([name, value]) => (
                  <span key={name}>
                    <strong>{name} worker</strong>: {value}
                  </span>
                ),
              )}
              {Object.entries(systemStatus?.queues ?? {}).map(
                ([name, value]) => (
                  <span key={name}>
                    <strong>{name} queued</strong>: {value}
                  </span>
                ),
              )}
            </div>
          </article>
          <article id="admin-branding" className="admin-section">
            <div className="section-title">
              <div>
                <p>Deployment</p>
                <h2>Branding</h2>
              </div>
              <span className="status-pill neutral">Global</span>
            </div>
            <div className="settings-strip">
              <div className="brand-tile">
                {branding.iconDataUrl ? (
                  <img
                    className="brand-preview"
                    src={branding.iconDataUrl}
                    alt=""
                  />
                ) : (
                  <span>SA</span>
                )}
              </div>
              <label>
                Display name
                <input
                  value={branding.displayName}
                  onChange={(event) =>
                    setBranding({
                      ...branding,
                      displayName: event.target.value,
                    })
                  }
                  onBlur={() =>
                    void updateBranding({ displayName: branding.displayName })
                  }
                />
              </label>
              <label className="file-picker">
                <input
                  type="file"
                  accept="image/png,image/webp,image/svg+xml"
                  onChange={(event) => void readIcon(event.target.files?.[0])}
                />
                Upload Icon
              </label>
            </div>
          </article>

          <article id="admin-users" className="admin-section">
            <div className="section-title">
              <div>
                <p>Access</p>
                <h2>Users</h2>
              </div>
              <span className="status-pill neutral">{users.length} total</span>
            </div>
            <form
              className="create-user-bar"
              onSubmit={(event) => void addUser(event)}
            >
              <input
                placeholder="Username"
                value={newUser.username}
                onChange={(event) =>
                  setNewUser({ ...newUser, username: event.target.value })
                }
              />
              <input
                placeholder="Display name"
                value={newUser.displayName}
                onChange={(event) =>
                  setNewUser({ ...newUser, displayName: event.target.value })
                }
              />
              <input
                type="password"
                placeholder="Temporary password"
                value={newUser.password}
                onChange={(event) =>
                  setNewUser({ ...newUser, password: event.target.value })
                }
              />
              <select
                value={newUser.role}
                onChange={(event) =>
                  setNewUser({
                    ...newUser,
                    role: event.target.value as "admin" | "user",
                  })
                }
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button>Create</button>
            </form>
            <div className="admin-table">
              {users.map((user) => (
                <div key={user.id} className="admin-row">
                  <div>
                    <strong>{user.displayName}</strong>
                    <span>{user.username}</span>
                  </div>
                  <span
                    className={`status-pill ${user.enabled ? "success" : "danger"}`}
                  >
                    {user.enabled ? "Enabled" : "Disabled"}
                  </span>
                  <select
                    value={user.role}
                    onChange={(event) =>
                      void updateUser(user.id, {
                        role: event.target.value as "admin" | "user",
                      }).then(load)
                    }
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() =>
                      void updateUser(user.id, { enabled: !user.enabled }).then(
                        load,
                      )
                    }
                  >
                    {user.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
              ))}
            </div>
          </article>

          <article id="admin-projects" className="admin-section">
            <div className="section-title">
              <div>
                <p>Sharing</p>
                <h2>Projects and Members</h2>
              </div>
              <span className="status-pill neutral">
                {projects.length} projects
              </span>
            </div>
            <div className="project-manager">
              <div className="project-list">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className={
                      selectedProjectId === project.id ? "active" : undefined
                    }
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <span>{project.name}</span>
                    <small>{project.private ? "Private" : "Shared"}</small>
                  </button>
                ))}
              </div>
              <div className="member-panel">
                {projects
                  .filter((project) => project.id === selectedProjectId)
                  .map((project) => (
                    <div key={project.id} className="member-head">
                      <div>
                        <strong>{project.name}</strong>
                        <span>
                          {project.description ?? "No description set"}
                        </span>
                      </div>
                      <button
                        onClick={() => void toggleProjectPrivate(project)}
                      >
                        {project.private ? "Make Shared" : "Make Private"}
                      </button>
                    </div>
                  ))}
                <form
                  className="member-form"
                  onSubmit={(event) => void addMember(event)}
                >
                  <select
                    value={memberUserId}
                    onChange={(event) => setMemberUserId(event.target.value)}
                  >
                    <option value="">Select user</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.displayName} ({user.username})
                      </option>
                    ))}
                  </select>
                  <select
                    value={memberRole}
                    onChange={(event) =>
                      setMemberRole(event.target.value as "editor" | "viewer")
                    }
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                  </select>
                  <button>Add Member</button>
                </form>
                <div className="admin-table">
                  {members.map((member) => (
                    <div key={member.userId} className="admin-row">
                      <div>
                        <strong>{member.displayName}</strong>
                        <span>{member.username}</span>
                      </div>
                      <span
                        className={`status-pill ${member.role === "owner" ? "owner" : "neutral"}`}
                      >
                        {member.role}
                      </span>
                      <span
                        className={`status-pill ${member.enabled ? "success" : "danger"}`}
                      >
                        {member.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <button
                        disabled={member.role === "owner"}
                        onClick={() =>
                          void removeProjectMember(
                            member.projectId,
                            member.userId,
                          ).then(() =>
                            listProjectMembers(member.projectId).then(
                              (result) => setMembers(result.members),
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </article>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    </main>
  );
}

function GuideShareMovePanel({
  recording,
  user,
  onChanged,
}: {
  recording: Recording;
  user: CurrentUser;
  onChanged: (recording: Recording) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [directory, setDirectory] = useState<UserDirectoryEntry[]>([]);
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"viewer" | "editor">("viewer");
  const [destinationProjectId, setDestinationProjectId] = useState(
    recording.projectId ?? "",
  );
  const [error, setError] = useState<string | undefined>();
  const [memberRemoveCandidate, setMemberRemoveCandidate] = useState<
    ProjectMember | undefined
  >();
  const [moveCandidateProjectId, setMoveCandidateProjectId] = useState<
    string | undefined
  >();
  const currentProject = projects.find(
    (project) => project.id === recording.projectId,
  );
  const canManageMembers =
    user.role === "admin" || currentProject?.role === "owner";
  const canMoveGuide =
    recording.userRole === "admin" ||
    recording.userRole === "owner" ||
    recording.userRole === "editor";
  const editableProjects = projects.filter(
    (project) => project.role === "owner" || project.role === "editor",
  );
  const existingMemberIds = new Set(members.map((member) => member.userId));
  const memberOptions = directory.filter(
    (entry) => !existingMemberIds.has(entry.id),
  );

  const load = useCallback(async () => {
    try {
      const [projectResult, directoryResult] = await Promise.all([
        listProjects(),
        listUserDirectory(),
      ]);
      setProjects(projectResult.projects);
      setDirectory(directoryResult.users);
      if (recording.projectId) {
        const memberResult = await listProjectMembers(recording.projectId);
        setMembers(memberResult.members);
      } else {
        setMembers([]);
      }
      setDestinationProjectId(recording.projectId ?? "");
      setError(undefined);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    }
  }, [recording.projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    if (!recording.projectId || !memberUserId) return;
    try {
      await setProjectMember(recording.projectId, {
        userId: memberUserId,
        role: memberRole,
      });
      setMemberUserId("");
      await load();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : String(addError));
    }
  }

  async function removeMember(member: ProjectMember) {
    const response = await removeProjectMember(member.projectId, member.userId);
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    setMemberRemoveCandidate(undefined);
    await load();
  }

  async function moveGuide(projectId: string) {
    if (!projectId || projectId === recording.projectId) return;
    try {
      const updated = await moveRecordingToProject(recording.id, projectId);
      setMoveCandidateProjectId(undefined);
      onChanged(updated);
      setError(undefined);
    } catch (moveError) {
      setError(
        moveError instanceof Error ? moveError.message : String(moveError),
      );
    }
  }

  return (
    <section className="share-panel">
      <div className="share-panel-head">
        <div>
          <p>Project Access</p>
          <h2>{currentProject?.name ?? "No project"}</h2>
        </div>
        {currentProject && (
          <span className="status-pill neutral">
            {currentProject.role ?? "viewer"}
          </span>
        )}
      </div>
      <div className="share-panel-grid">
        <div className="share-box">
          <div className="share-box-head">
            <strong>Members</strong>
            {!canManageMembers && <span>View only</span>}
          </div>
          {canManageMembers && recording.projectId && (
            <form
              className="member-form compact"
              onSubmit={(event) => void addMember(event)}
            >
              <select
                value={memberUserId}
                onChange={(event) => setMemberUserId(event.target.value)}
              >
                <option value="">Select user</option>
                {memberOptions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName} ({entry.username})
                  </option>
                ))}
              </select>
              <select
                value={memberRole}
                onChange={(event) =>
                  setMemberRole(event.target.value as "viewer" | "editor")
                }
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
              </select>
              <button>Add</button>
            </form>
          )}
          <div className="compact-member-list">
            {members.map((member) => (
              <div key={member.userId} className="compact-member-row">
                <div>
                  <strong>{member.displayName}</strong>
                  <span>{member.username}</span>
                </div>
                <span
                  className={`status-pill ${member.role === "owner" ? "owner" : "neutral"}`}
                >
                  {member.role}
                </span>
                {canManageMembers && member.role !== "owner" && (
                  <button onClick={() => setMemberRemoveCandidate(member)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="share-box">
          <div className="share-box-head">
            <strong>Move Guide</strong>
            <span>Access follows project</span>
          </div>
          <div className="move-controls">
            <select
              disabled={!canMoveGuide}
              value={destinationProjectId}
              onChange={(event) => setDestinationProjectId(event.target.value)}
            >
              <option value="">Select destination project</option>
              {editableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button
              disabled={
                !canMoveGuide ||
                !destinationProjectId ||
                destinationProjectId === recording.projectId
              }
              onClick={() => setMoveCandidateProjectId(destinationProjectId)}
            >
              Move
            </button>
          </div>
          <p className="share-note">
            Moving preserves the guide owner, but viewers/editors are
            recalculated from the destination project.
          </p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {memberRemoveCandidate && (
        <ConfirmDialog
          title="Remove project member?"
          body={`Remove ${memberRemoveCandidate.displayName} from "${currentProject?.name ?? "this project"}"? They will lose access to guides in this project unless they have access another way.`}
          confirmLabel="Remove Member"
          tone="danger"
          onCancel={() => setMemberRemoveCandidate(undefined)}
          onConfirm={() => void removeMember(memberRemoveCandidate)}
        />
      )}
      {moveCandidateProjectId && (
        <ConfirmDialog
          title="Move guide?"
          body={`Move "${recording.title}" to "${
            projects.find((project) => project.id === moveCandidateProjectId)
              ?.name ?? "the selected project"
          }"? Access will change immediately because users inherit guide access from the destination project.`}
          confirmLabel="Move Guide"
          onCancel={() => setMoveCandidateProjectId(undefined)}
          onConfirm={() => void moveGuide(moveCandidateProjectId)}
        />
      )}
    </section>
  );
}

function GuideVersionsPanel({
  recording,
  onRestored,
}: {
  recording: Recording;
  onRestored: (recording: Recording) => void;
}) {
  const [versions, setVersions] = useState<GuideVersionListItem[]>([]);
  const [selected, setSelected] = useState<GuideVersion | undefined>();
  const [message, setMessage] = useState("");
  const [restoreCandidate, setRestoreCandidate] = useState<
    GuideVersionListItem | undefined
  >();
  const [error, setError] = useState<string | undefined>();
  const snapshot = selected?.snapshot as
    | {
        recording?: {
          title?: string;
          purpose?: string | null;
          projectId?: string | null;
        };
        items?: GuideItem[];
        screenshotEdits?: Array<unknown>;
      }
    | undefined;

  const load = useCallback(async () => {
    try {
      const result = await listGuideVersions(recording.id);
      setVersions(result.versions);
      setError(undefined);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    }
  }, [recording.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveVersion(event: React.FormEvent) {
    event.preventDefault();
    try {
      const version = await createGuideVersion(recording.id, message);
      setMessage("");
      await load();
      setSelected(await getGuideVersion(recording.id, version.id));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    }
  }

  async function selectVersion(version: GuideVersionListItem) {
    try {
      setSelected(await getGuideVersion(recording.id, version.id));
      setError(undefined);
    } catch (selectError) {
      setError(
        selectError instanceof Error
          ? selectError.message
          : String(selectError),
      );
    }
  }

  async function restoreVersion(version: GuideVersionListItem) {
    try {
      const restored = await restoreGuideVersion(recording.id, version.id);
      setRestoreCandidate(undefined);
      onRestored(restored);
      await load();
      setSelected(undefined);
      setError(undefined);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error
          ? restoreError.message
          : String(restoreError),
      );
    }
  }

  return (
    <section className="versions-panel">
      <form
        className="version-save"
        onSubmit={(event) => void saveVersion(event)}
      >
        <label>
          Version note
          <input
            value={message}
            placeholder="Optional release note"
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <button>Save Version</button>
      </form>
      <div className="versions-grid">
        <div className="version-list">
          {versions.map((version) => (
            <button
              key={version.id}
              className={selected?.id === version.id ? "active" : undefined}
              onClick={() => void selectVersion(version)}
            >
              <span
                className={`status-pill ${version.versionType === "restore" ? "owner" : "neutral"}`}
              >
                {version.versionType}
              </span>
              <strong>{version.message || "Untitled snapshot"}</strong>
              <small>
                {version.createdByDisplayName ?? "Unknown"} ·{" "}
                {new Date(version.createdAt).toLocaleString()}
              </small>
            </button>
          ))}
          {versions.length === 0 && (
            <p className="muted">No versions saved yet.</p>
          )}
        </div>
        <div className="version-detail">
          {selected ? (
            <>
              <div className="share-box-head">
                <strong>
                  {snapshot?.recording?.title ?? "Version detail"}
                </strong>
                <button onClick={() => setRestoreCandidate(selected)}>
                  Restore
                </button>
              </div>
              <p>
                {snapshot?.recording?.purpose ?? "No overview in this version."}
              </p>
              <dl>
                <div>
                  <dt>Items</dt>
                  <dd>{snapshot?.items?.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Image edits</dt>
                  <dd>{snapshot?.screenshotEdits?.length ?? 0}</dd>
                </div>
                <div>
                  <dt>Project</dt>
                  <dd>{snapshot?.recording?.projectId ?? "None"}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="muted">
              Select a version to preview its saved title, overview, items, and
              image edit metadata.
            </p>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {restoreCandidate && (
        <ConfirmDialog
          title="Restore version?"
          body={`Restore "${recording.title}" from the ${restoreCandidate.versionType} version created ${new Date(
            restoreCandidate.createdAt,
          ).toLocaleString()}? This creates a new restore version so history stays intact.`}
          confirmLabel="Restore Version"
          onCancel={() => setRestoreCandidate(undefined)}
          onConfirm={() => void restoreVersion(restoreCandidate)}
        />
      )}
    </section>
  );
}

function LegalView() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof systemInfo>>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    void systemInfo()
      .then(setInfo)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
  }, []);
  return (
    <main className="legal-page">
      <p>About and legal</p>
      <h1>{info?.productName ?? "InfoSteed"}</h1>
      {error && <p className="error">{error}</p>}
      <dl>
        <dt>Version</dt>
        <dd>{info?.releaseVersion ?? "Loading..."}</dd>
        <dt>Commit</dt>
        <dd>{info?.releaseCommit ?? "Loading..."}</dd>
        <dt>Protocol</dt>
        <dd>{info?.protocolVersion ?? "Loading..."}</dd>
      </dl>
      <h2>GNU Affero General Public License</h2>
      <p>
        This program is free software under AGPL-3.0-only. It is provided
        without any warranty, to the extent permitted by law.
      </p>
      {info?.exactSourceUrl ? (
        <p>
          <a href={info.exactSourceUrl}>
            Corresponding source for this exact version
          </a>
        </p>
      ) : (
        <p>The administrator has not configured the public source URL.</p>
      )}
      <p>
        <a href="/LICENSE">Read the full AGPL text</a>
      </p>
      <h2>Commercial licensing</h2>
      <p>
        The commercial-licensing contact and contracting entity will be
        published before a commercial offer is made.
      </p>
      <p>
        <a href="/">Return to the application</a>
      </p>
    </main>
  );
}

function App() {
  const recordingId = useRecordingId();
  const requestedView = new URLSearchParams(window.location.search).get("view");
  const [setupRequired, setSetupRequired] = useState<boolean | undefined>();
  const [user, setUser] = useState<CurrentUser | undefined>();
  const [branding, setBranding] = useState<BrandingSettings>({
    displayName: "InfoSteed",
    iconDataUrl: null,
  });
  const [authChecked, setAuthChecked] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [recording, setRecording] = useState<Recording | undefined>();
  const [video, setVideo] = useState<RecordingVideo | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [rightPanelMode, setRightPanelMode] = useState<"display" | "markdown">(
    "display",
  );
  const [imageVersions, setImageVersions] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [viewOnly, setViewOnly] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [previewAutoScroll, setPreviewAutoScroll] = useState(true);
  const [previewScrollElement, setPreviewScrollElement] =
    useState<HTMLElement | null>(null);
  const [deleteCurrentOpen, setDeleteCurrentOpen] = useState(false);
  const [captureMoreStatus, setCaptureMoreStatus] = useState<
    "idle" | "starting" | "started" | "error"
  >("idle");
  const [captureMoreMessage, setCaptureMoreMessage] = useState<
    string | undefined
  >();
  const [reorderBusy, setReorderBusy] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState<string | undefined>();
  const [dropTarget, setDropTarget] = useState<
    { itemId: string; position: DropPosition } | undefined
  >();
  const importInputRef = useRef<HTMLInputElement>(null);
  const headerMoreRef = useRef<HTMLDetailsElement>(null);
  const setPreviewScrollRef = useCallback((element: HTMLElement | null) => {
    setPreviewScrollElement(element);
  }, []);

  useEffect(() => {
    function closeMoreMenu(event: PointerEvent) {
      if (!headerMoreRef.current?.contains(event.target as Node))
        headerMoreRef.current?.removeAttribute("open");
    }
    function closeMoreMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape")
        headerMoreRef.current?.removeAttribute("open");
    }
    document.addEventListener("pointerdown", closeMoreMenu);
    document.addEventListener("keydown", closeMoreMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMoreMenu);
      document.removeEventListener("keydown", closeMoreMenuWithKeyboard);
    };
  }, []);

  async function refreshAuth() {
    const status = await setupStatus();
    setSetupRequired(status.required);
    if (status.required) {
      setAuthChecked(true);
      return;
    }
    try {
      const result = await me();
      setUser(result.user);
      setBranding(await getBranding());
    } catch {
      setUser(undefined);
    } finally {
      setAuthChecked(true);
    }
  }

  async function load() {
    if (!recordingId || !user) return;
    try {
      const nextRecording = await getRecording(recordingId);
      setRecording(nextRecording);
      if (nextRecording.captureMode === "guide") setVideo(undefined);
      else {
        try {
          setVideo(await getRecordingVideo(recordingId));
        } catch {
          setVideo(undefined);
        }
      }
      setError(undefined);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      );
    }
  }

  async function handleProjectImport(file?: File) {
    if (!file) return;

    try {
      const project = JSON.parse(await file.text()) as RecordingProject;
      const imported = await importProject(project);
      window.location.assign(`/?recordingId=${imported.id}`);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : String(importError),
      );
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function confirmDeleteCurrentGuide() {
    if (!recording) return;
    const response = await deleteRecording(recording.id);
    if (!response.ok) {
      setError(await response.text());
      return;
    }
    window.location.assign("/");
  }

  function bumpImageVersion(filename: string) {
    setImageVersions((versions) => {
      const next = new Map(versions);
      next.set(filename, (next.get(filename) ?? 0) + 1);
      return next;
    });
  }

  function updateLocalItem(nextItem: GuideItem) {
    setRecording((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) =>
          item.id === nextItem.id ? nextItem : item,
        ),
        steps: current.steps.map((step) =>
          step.id === nextItem.id
            ? {
                ...step,
                title: nextItem.title,
                instruction: nextItem.body,
                altText: nextItem.altText,
              }
            : step,
        ),
      };
    });
  }

  async function handleCaptureMore() {
    if (!recording) return;
    setCaptureMoreStatus("starting");
    setCaptureMoreMessage(undefined);
    try {
      await startExistingCapture(recording.id);
      setCaptureMoreStatus("started");
      setCaptureMoreMessage(
        "Capture started. Use the extension popup to pause or stop when you are done.",
      );
    } catch (captureError) {
      setCaptureMoreStatus("error");
      setCaptureMoreMessage(
        captureError instanceof Error
          ? captureError.message
          : String(captureError),
      );
    }
  }

  async function persistItemOrder(nextItems: GuideItem[]) {
    if (!recording || reorderBusy) return;
    setReorderBusy(true);
    try {
      const updated = await reorderItems(
        recording.id,
        nextItems.map((item) => item.id),
      );
      setRecording(updated);
      setError(undefined);
    } catch (reorderError) {
      setError(
        reorderError instanceof Error
          ? reorderError.message
          : String(reorderError),
      );
      await load();
    } finally {
      setReorderBusy(false);
      setDraggingItemId(undefined);
      setDropTarget(undefined);
    }
  }

  function reorderedItemsForDrop(
    itemId: string,
    targetId: string,
    position: DropPosition,
  ): GuideItem[] | undefined {
    const source = items.find((item) => item.id === itemId);
    if (!source || itemId === targetId) return undefined;
    const withoutSource = items.filter((item) => item.id !== itemId);
    const targetIndex = withoutSource.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) return undefined;
    const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    return [
      ...withoutSource.slice(0, insertIndex),
      source,
      ...withoutSource.slice(insertIndex),
    ];
  }

  async function moveItemBy(itemId: string, delta: -1 | 1) {
    const index = items.findIndex((item) => item.id === itemId);
    const target = items[index + delta];
    if (!target) return;
    const next = items.slice();
    next.splice(index, 1);
    next.splice(index + delta, 0, items[index]);
    await persistItemOrder(next);
  }

  async function dropItem(
    itemId: string,
    targetId: string,
    position: DropPosition,
  ) {
    const next = reorderedItemsForDrop(itemId, targetId, position);
    if (next) await persistItemOrder(next);
    else {
      setDraggingItemId(undefined);
      setDropTarget(undefined);
    }
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  useEffect(() => {
    setRecording(undefined);
    setVideo(undefined);
    setViewOnly(true);
    setSelectedItemId("");
    setPreviewOpen(false);
    setAccessOpen(false);
    setVersionsOpen(false);
    void load();
  }, [recordingId, user?.id]);

  const markdown = useMemo(
    () => (recording ? generateGuideMarkdown(recording) : ""),
    [recording],
  );

  useEffect(() => {
    if (!previewAutoScroll || !previewScrollElement) return undefined;
    const element = previewScrollElement;

    function syncPreviewScroll() {
      const documentElement = document.documentElement;
      const pageMax = Math.max(
        1,
        documentElement.scrollHeight - window.innerHeight,
      );
      const previewMax = Math.max(
        0,
        element.scrollHeight - element.clientHeight,
      );
      element.scrollTop = (window.scrollY / pageMax) * previewMax;
    }

    syncPreviewScroll();
    window.addEventListener("scroll", syncPreviewScroll, { passive: true });
    window.addEventListener("resize", syncPreviewScroll);
    return () => {
      window.removeEventListener("scroll", syncPreviewScroll);
      window.removeEventListener("resize", syncPreviewScroll);
    };
  }, [
    previewAutoScroll,
    previewScrollElement,
    recording,
    markdown,
    rightPanelMode,
  ]);

  const eventsById = useMemo(
    () => new Map(recording?.events.map((event) => [event.id, event]) ?? []),
    [recording],
  );
  const items = useMemo(
    () => (recording ? orderedItems(recording) : []),
    [recording],
  );
  const stepNumbers = useMemo(() => {
    let stepNumber = 0;
    return new Map(
      items.map((item) => [
        item.id,
        item.kind === "step" ? ++stepNumber : undefined,
      ]),
    );
  }, [items]);
  const reorderDisabled = reorderBusy || Boolean(selectedItemId);

  const importControl = (
    <>
      <button
        onClick={() => {
          headerMoreRef.current?.removeAttribute("open");
          importInputRef.current?.click();
        }}
      >
        Import Project
      </button>
      <input
        ref={importInputRef}
        className="hidden-file"
        type="file"
        accept="application/json,.json"
        onChange={(event) => void handleProjectImport(event.target.files?.[0])}
      />
    </>
  );

  if (requestedView === "legal") return <LegalView />;

  if (!authChecked) return <main className="empty">Loading InfoSteed...</main>;
  if (setupRequired) {
    return (
      <AuthForm
        mode="setup"
        onDone={(nextUser) => {
          setUser(nextUser);
          setSetupRequired(false);
          void getBranding().then(setBranding);
        }}
      />
    );
  }
  if (!user) {
    return (
      <AuthForm
        mode="login"
        onDone={(nextUser) => {
          setUser(nextUser);
          setSetupRequired(false);
          void getBranding().then(setBranding);
        }}
      />
    );
  }
  if (adminOpen) {
    return (
      <AdminPanel
        onClose={() => {
          setAdminOpen(false);
          void getBranding().then(setBranding);
        }}
      />
    );
  }
  if (!recordingId) {
    return (
      <GuideBrowser
        user={user}
        branding={branding}
        onOpenAdmin={() => setAdminOpen(true)}
        onLogout={() => void logout().then(() => setUser(undefined))}
        onLogoutAll={() => {
          if (window.confirm("Log out every session for this account?"))
            void logoutAll().then(() => setUser(undefined));
        }}
      />
    );
  }
  if (error) return <main className="empty">{error}</main>;
  if (!recording) return <main className="empty">Loading recording...</main>;
  if (
    requestedView === "video-edit" &&
    video &&
    recording.captureMode !== "guide"
  ) {
    return (
      <VideoEditor recording={recording} video={video} onPublished={setVideo} />
    );
  }

  return (
    <main className={viewOnly ? "view-only-mode" : undefined}>
      <header>
        <div>
          <p>
            {recording.captureMode === "both"
              ? "Video + Workflow Guide"
              : recording.captureMode === "video"
                ? "Video Recording"
                : "Workflow Guide"}
          </p>
          <h1>{recording.title}</h1>
        </div>
        <div className="header-actions">
          <a href="/">My Guides</a>
          {(recording.userRole === "admin" ||
            recording.userRole === "owner" ||
            recording.userRole === "editor") &&
            recording.captureMode !== "video" && (
              <button
                onClick={() => {
                  setViewOnly((current) => {
                    if (!current) {
                      setSelectedItemId("");
                      setPreviewOpen(false);
                      setAccessOpen(false);
                      setVersionsOpen(false);
                    }
                    return !current;
                  });
                }}
              >
                {viewOnly ? "Edit guide" : "Close guide editor"}
              </button>
            )}
          {viewOnly &&
            (recording.userRole === "admin" ||
              recording.userRole === "owner" ||
              recording.userRole === "editor") &&
            recording.captureMode !== "guide" && (
              <button
                onClick={() =>
                  window.location.assign(
                    `/?recordingId=${recording.id}&view=video-edit`,
                  )
                }
              >
                Edit video
              </button>
            )}
          {!viewOnly && recording.captureMode !== "video" && (
            <>
              <button
                disabled={captureMoreStatus === "starting"}
                onClick={() => void handleCaptureMore()}
              >
                {captureMoreStatus === "starting"
                  ? "Starting Capture..."
                  : "Capture More"}
              </button>
              <details
                ref={headerMoreRef}
                className="header-more-menu"
                onToggle={(event) =>
                  setHeaderMoreOpen(event.currentTarget.open)
                }
              >
                <summary>More</summary>
                <div className="header-more-panel">
                  <button
                    onClick={() => {
                      headerMoreRef.current?.removeAttribute("open");
                      setAccessOpen(true);
                      setPreviewOpen(false);
                      setVersionsOpen(false);
                    }}
                  >
                    Access
                  </button>
                  <button
                    onClick={() => {
                      headerMoreRef.current?.removeAttribute("open");
                      setVersionsOpen(true);
                      setPreviewOpen(false);
                      setAccessOpen(false);
                    }}
                  >
                    Versions
                  </button>
                  {importControl}
                  <span className="header-more-label">Export</span>
                  <a href={projectExportUrl(recording.id)}>Project</a>
                  <a href={htmlExportUrl(recording.id)}>HTML</a>
                  <a href={wordExportUrl(recording.id)}>Word</a>
                  <a href={pdfExportUrl(recording.id)}>PDF</a>
                  <a href={sanityExportUrl(recording.id)}>Sanity</a>
                  <a href={exportUrl(recording.id)}>ZIP</a>
                  <button
                    className="danger-action header-more-danger"
                    onClick={() => {
                      headerMoreRef.current?.removeAttribute("open");
                      setDeleteCurrentOpen(true);
                    }}
                  >
                    Delete{" "}
                    {recording.captureMode === "guide" ? "Guide" : "Recording"}
                  </button>
                </div>
              </details>
            </>
          )}
          {recording.captureMode === "video" && (
            <>
              <button
                onClick={() => {
                  setAccessOpen(true);
                  setPreviewOpen(false);
                  setVersionsOpen(false);
                }}
              >
                Access
              </button>
              <button
                className="danger-action"
                onClick={() => setDeleteCurrentOpen(true)}
              >
                Delete Recording
              </button>
            </>
          )}
        </div>
      </header>

      {viewOnly && recording.captureMode !== "guide" && video && (
        <VideoGuidePlayer
          recording={recording}
          video={video}
          editable={
            recording.userRole === "admin" ||
            recording.userRole === "owner" ||
            recording.userRole === "editor"
          }
          onVideoChanged={setVideo}
          onRecordingChanged={() => void load()}
          onVideoDeleted={() => {
            if (recording.captureMode === "video") window.location.assign("/");
            else setVideo(undefined);
          }}
        />
      )}
      {viewOnly && recording.captureMode !== "guide" && !video && (
        <div className="capture-status error">
          Video metadata is unavailable or this draft has not been published.
        </div>
      )}

      {captureMoreMessage && !viewOnly && (
        <div className={`capture-status ${captureMoreStatus}`} role="status">
          {captureMoreMessage}
        </div>
      )}

      {recording.captureMode !== "video" &&
        !viewOnly &&
        !previewOpen &&
        !headerMoreOpen && (
          <button
            className="preview-toggle"
            onClick={() => {
              setPreviewOpen(true);
              setAccessOpen(false);
              setVersionsOpen(false);
            }}
            aria-label="Open preview"
          >
            <span className="burger-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Preview
          </button>
        )}

      {recording.captureMode !== "video" && (
        <div className="layout">
          <section className="steps">
            <GuideOverviewEditor
              recording={recording}
              isSelected={!viewOnly && selectedItemId === "overview"}
              onSelect={() => setSelectedItemId("overview")}
              onCloseEdit={() => setSelectedItemId("")}
              editable={!viewOnly}
              onDraftChange={(updated) => setRecording(updated)}
              onSaved={(updated) => setRecording(updated)}
            />
            {!viewOnly && (
              <InsertBar
                recordingId={recording.id}
                afterItemId={null}
                onAdded={load}
              />
            )}
            {items.map((item, index) => (
              <React.Fragment key={item.id}>
                <div
                  id={`guide-item-${item.id}`}
                  className={`reorderable-item${
                    dropTarget?.itemId === item.id
                      ? ` drop-${dropTarget.position}`
                      : ""
                  }${draggingItemId === item.id ? " dragging" : ""}`}
                  onDragOver={(event) => {
                    if (
                      viewOnly ||
                      reorderDisabled ||
                      !draggingItemId ||
                      draggingItemId === item.id
                    )
                      return;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setDropTarget({
                      itemId: item.id,
                      position:
                        event.clientY < rect.top + rect.height / 2
                          ? "before"
                          : "after",
                    });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggingItemId) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const position =
                      event.clientY < rect.top + rect.height / 2
                        ? "before"
                        : "after";
                    void dropItem(draggingItemId, item.id, position);
                  }}
                >
                  {!viewOnly && (
                    <div
                      className="reorder-controls"
                      aria-label={`Reorder ${item.title}`}
                    >
                      <button
                        className="drag-handle"
                        draggable={!reorderDisabled}
                        disabled={reorderDisabled}
                        title="Drag to reorder"
                        aria-label={`Drag ${item.title}`}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", item.id);
                          setDraggingItemId(item.id);
                        }}
                        onDragEnd={() => {
                          setDraggingItemId(undefined);
                          setDropTarget(undefined);
                        }}
                      >
                        ::
                      </button>
                      <button
                        disabled={reorderDisabled || index === 0}
                        onClick={() => void moveItemBy(item.id, -1)}
                      >
                        Move up
                      </button>
                      <button
                        disabled={reorderDisabled || index === items.length - 1}
                        onClick={() => void moveItemBy(item.id, 1)}
                      >
                        Move down
                      </button>
                    </div>
                  )}
                  <GuideItemEditor
                    recordingId={recording.id}
                    item={item}
                    event={
                      item.eventId ? eventsById.get(item.eventId) : undefined
                    }
                    stepNumber={stepNumbers.get(item.id)}
                    imageVersion={
                      item.imageFilename
                        ? imageVersions.get(item.imageFilename)
                        : undefined
                    }
                    onImageSaved={bumpImageVersion}
                    isSelected={!viewOnly && selectedItemId === item.id}
                    onSelect={() => setSelectedItemId(item.id)}
                    onCloseEdit={() => setSelectedItemId("")}
                    editable={!viewOnly}
                    onDraftChange={updateLocalItem}
                    onSaved={load}
                  />
                </div>
                {!viewOnly && (
                  <InsertBar
                    recordingId={recording.id}
                    afterItemId={item.id}
                    onAdded={load}
                  />
                )}
              </React.Fragment>
            ))}
          </section>
        </div>
      )}
      {recording.captureMode !== "video" && previewOpen && (
        <section className="preview-drawer" aria-label="Guide preview">
          <div className="preview-head">
            <h2>
              {rightPanelMode === "display" ? "Display Preview" : "Markdown"}
            </h2>
            <div className="segmented">
              {!previewAutoScroll && (
                <button
                  onClick={() => {
                    setPreviewAutoScroll(true);
                  }}
                >
                  Sync scroll
                </button>
              )}
              <button
                className={rightPanelMode === "display" ? "active" : undefined}
                onClick={() => setRightPanelMode("display")}
              >
                Preview
              </button>
              <button
                className={rightPanelMode === "markdown" ? "active" : undefined}
                onClick={() => setRightPanelMode("markdown")}
              >
                Markdown
              </button>
              <button onClick={() => setPreviewOpen(false)}>Close</button>
            </div>
          </div>
          {rightPanelMode === "display" ? (
            <GuideDisplayPreview
              recording={recording}
              imageVersions={imageVersions}
              scrollRef={setPreviewScrollRef}
              onUserScroll={() => setPreviewAutoScroll(false)}
            />
          ) : (
            <pre
              ref={setPreviewScrollRef}
              onWheel={() => setPreviewAutoScroll(false)}
              onTouchStart={() => setPreviewAutoScroll(false)}
            >
              {markdown}
            </pre>
          )}
        </section>
      )}
      {accessOpen && (
        <section className="side-drawer" aria-label="Guide access">
          <div className="preview-head">
            <h2>Access</h2>
            <button onClick={() => setAccessOpen(false)}>Close</button>
          </div>
          <GuideShareMovePanel
            recording={recording}
            user={user}
            onChanged={(updated) => {
              setRecording(updated);
              void load();
            }}
          />
        </section>
      )}
      {versionsOpen && (
        <section className="side-drawer" aria-label="Guide versions">
          <div className="preview-head">
            <h2>Versions</h2>
            <button onClick={() => setVersionsOpen(false)}>Close</button>
          </div>
          <GuideVersionsPanel
            recording={recording}
            onRestored={(updated) => {
              setRecording(updated);
              setSelectedItemId("");
              setImageVersions(new Map());
              void load();
            }}
          />
        </section>
      )}
      {deleteCurrentOpen && (
        <ConfirmDialog
          title={`Delete ${recording.captureMode === "guide" ? "guide" : "recording"}?`}
          body={`"${recording.title}" will move to Trash and can be restored for 10 days.`}
          confirmLabel={`Delete ${recording.captureMode === "guide" ? "Guide" : "Recording"}`}
          tone="danger"
          onCancel={() => setDeleteCurrentOpen(false)}
          onConfirm={() => void confirmDeleteCurrentGuide()}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
