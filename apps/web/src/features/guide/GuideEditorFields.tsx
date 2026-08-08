// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from "react";
import type { NormalizedRect } from "@infosteed/shared";
import {
  Check,
  Code2,
  Crop,
  Eraser,
  Link,
  List,
  ListOrdered,
  MousePointer2,
  MousePointer2Off,
  ScanLine,
  Trash2,
  X,
} from "lucide-react";
import { sourceImageUrl } from "../../api";
import { t } from "../../i18n";
import { useImageEditorController } from "./useGuideWorkspaceControllers";
import { GuideIconButton } from "./GuideIconButton";

const minimumRectSize = 0.01;

type RectHandle = "move" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

type ImageDrag =
  | {
      kind: "draw";
      mode: "highlight" | "crop" | "redact";
      start: { x: number; y: number };
    }
  | {
      kind: "adjust-highlight";
      handle: RectHandle;
      start: { x: number; y: number };
      initial: NormalizedRect;
    };

function clampRect(rect: NormalizedRect): NormalizedRect {
  const x = Math.max(0, Math.min(1 - minimumRectSize, rect.x));
  const y = Math.max(0, Math.min(1 - minimumRectSize, rect.y));
  return {
    x,
    y,
    width: Math.max(minimumRectSize, Math.min(1 - x, rect.width)),
    height: Math.max(minimumRectSize, Math.min(1 - y, rect.height)),
  };
}

function rectBetween(
  start: { x: number; y: number },
  end: { x: number; y: number },
): NormalizedRect {
  return clampRect({
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });
}

export function adjustImageSelection(
  initial: NormalizedRect,
  handle: RectHandle,
  deltaX: number,
  deltaY: number,
): NormalizedRect {
  if (handle === "move") {
    return {
      ...initial,
      x: Math.max(0, Math.min(1 - initial.width, initial.x + deltaX)),
      y: Math.max(0, Math.min(1 - initial.height, initial.y + deltaY)),
    };
  }

  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;

  if (handle.includes("w"))
    left = Math.max(0, Math.min(right - minimumRectSize, left + deltaX));
  if (handle.includes("e"))
    right = Math.min(1, Math.max(left + minimumRectSize, right + deltaX));
  if (handle.includes("n"))
    top = Math.max(0, Math.min(bottom - minimumRectSize, top + deltaY));
  if (handle.includes("s"))
    bottom = Math.min(1, Math.max(top + minimumRectSize, bottom + deltaY));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function ImageEditor({
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
  const drag = useRef<ImageDrag>();
  const [mode, setMode] = useState<"highlight" | "crop" | "redact">(
    "highlight",
  );
  const { operations, setOperations, save } = useImageEditorController({
    recordingId,
    filename,
    onClose,
    onSaved,
  });

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

  function updateDrag(event: React.PointerEvent) {
    const currentDrag = drag.current;
    const end = point(event);
    if (!currentDrag || !end) return;

    if (currentDrag.kind === "adjust-highlight") {
      const rect = adjustImageSelection(
        currentDrag.initial,
        currentDrag.handle,
        end.x - currentDrag.start.x,
        end.y - currentDrag.start.y,
      );
      setOperations((current) => ({ ...current, highlight: rect }));
      return;
    }

    if (currentDrag.mode === "redact") return;
    const rect = rectBetween(currentDrag.start, end);
    setOperations((current) =>
      currentDrag.mode === "highlight"
        ? { ...current, highlight: rect }
        : { ...current, crop: rect },
    );
  }

  function finishDrag(event: React.PointerEvent) {
    const currentDrag = drag.current;
    const end = point(event);
    updateDrag(event);
    drag.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!currentDrag || currentDrag.kind !== "draw" || !end) return;
    if (currentDrag.mode === "redact") {
      const rect = rectBetween(currentDrag.start, end);
      setOperations((current) => ({
        ...current,
        redactions: [...(current.redactions ?? []), rect],
      }));
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="image-editor">
        <div className="modal-head">
          <h2>{t("Edit Image")}</h2>
          <GuideIconButton label={t("Close")} onClick={onClose}>
            <X aria-hidden="true" />
          </GuideIconButton>
        </div>
        <div className="editor-tools">
          <GuideIconButton
            label={t("Highlight")}
            active={mode === "highlight"}
            onClick={() => setMode("highlight")}
          >
            <MousePointer2 aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Clear Highlight")}
            onClick={() =>
              setOperations((current) => ({ ...current, highlight: null }))
            }
          >
            <MousePointer2Off aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Crop / Zoom")}
            active={mode === "crop"}
            onClick={() => setMode("crop")}
          >
            <Crop aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Clear Crop")}
            onClick={() =>
              setOperations((current) => ({ ...current, crop: undefined }))
            }
          >
            <Eraser aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Redact")}
            active={mode === "redact"}
            onClick={() => setMode("redact")}
          >
            <ScanLine aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Clear Redactions")}
            tone="danger"
            onClick={() => setOperations({ ...operations, redactions: [] })}
          >
            <Trash2 aria-hidden="true" />
          </GuideIconButton>
        </div>
        <div
          className="image-edit-surface"
          onPointerDown={(event) => {
            const start = point(event);
            if (!start) return;
            const handle = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-highlight-handle]",
            )?.dataset.highlightHandle as RectHandle | undefined;
            drag.current =
              handle && operations.highlight
                ? {
                    kind: "adjust-highlight",
                    handle,
                    start,
                    initial: operations.highlight,
                  }
                : { kind: "draw", mode, start };
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }}
          onPointerMove={updateDrag}
          onPointerUp={finishDrag}
          onPointerCancel={(event) => {
            drag.current = undefined;
            event.currentTarget.releasePointerCapture?.(event.pointerId);
          }}
        >
          <img
            ref={imageRef}
            src={sourceImageUrl(recordingId, filename)}
            alt=""
            draggable={false}
          />
          {operations.highlight && (
            <span
              className="highlight-box"
              style={rectStyle(operations.highlight)}
              data-highlight-handle="move"
              aria-label={t("Highlight")}
            >
              {(["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const).map(
                (handle) => (
                  <span
                    key={handle}
                    className="highlight-handle"
                    data-highlight-handle={handle}
                    aria-hidden="true"
                  />
                ),
              )}
            </span>
          )}
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
        <div className="actions guide-action-toolbar">
          <GuideIconButton
            label={t("Save Image Edits")}
            onClick={() => void save()}
          >
            <Check aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton label={t("Cancel")} onClick={onClose}>
            <X aria-hidden="true" />
          </GuideIconButton>
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

export function MarkdownAssistantField({
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
    const url = window.prompt(t("Link URL"), "https://");
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
      <div
        className="markdown-toolbar"
        aria-label={t("{field} formatting", { field: ariaLabel })}
      >
        <GuideIconButton
          label={t("Bold")}
          type="button"
          onClick={() => wrap("**")}
        >
          B
        </GuideIconButton>
        <GuideIconButton
          label={t("Italic")}
          type="button"
          onClick={() => wrap("*")}
        >
          I
        </GuideIconButton>
        <GuideIconButton label={t("Link")} type="button" onClick={link}>
          <Link aria-hidden="true" />
        </GuideIconButton>
        <GuideIconButton
          label={t("Code")}
          type="button"
          onClick={() => wrap("`")}
        >
          <Code2 aria-hidden="true" />
        </GuideIconButton>
        <GuideIconButton
          label={t("Bullet list")}
          type="button"
          onClick={() => list(false)}
        >
          <List aria-hidden="true" />
        </GuideIconButton>
        <GuideIconButton
          label={t("Numbered list")}
          type="button"
          onClick={() => list(true)}
        >
          <ListOrdered aria-hidden="true" />
        </GuideIconButton>
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
