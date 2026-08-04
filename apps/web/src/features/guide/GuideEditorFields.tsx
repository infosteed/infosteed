// SPDX-License-Identifier: AGPL-3.0-only
import React, { useRef, useState } from "react";
import type { NormalizedRect } from "@infosteed/shared";
import { sourceImageUrl } from "../../api";
import { t } from "../../i18n";
import { useImageEditorController } from "./useGuideWorkspaceControllers";

function clampRect(rect: NormalizedRect): NormalizedRect {
  return {
    x: Math.max(0, Math.min(1, rect.x)),
    y: Math.max(0, Math.min(1, rect.y)),
    width: Math.max(0.01, Math.min(1 - rect.x, rect.width)),
    height: Math.max(0.01, Math.min(1 - rect.y, rect.height)),
  };
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
  const dragStart = useRef<{ x: number; y: number } | undefined>();
  const [mode, setMode] = useState<"crop" | "redact">("crop");
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

  return (
    <div className="modal-backdrop">
      <div className="image-editor">
        <div className="modal-head">
          <h2>{t("Edit Image")}</h2>
          <button onClick={onClose}>{t("Close")}</button>
        </div>
        <div className="editor-tools">
          <button
            className={mode === "crop" ? "active" : undefined}
            onClick={() => setMode("crop")}
          >
            {t("Crop / Zoom")}
          </button>
          <button
            className={mode === "redact" ? "active" : undefined}
            onClick={() => setMode("redact")}
          >
            {t("Redact")}
          </button>
          <button
            onClick={() =>
              setOperations({ redactions: operations.redactions ?? [] })
            }
          >
            {t("Clear Crop")}
          </button>
          <button
            onClick={() => setOperations({ ...operations, redactions: [] })}
          >
            {t("Clear Redactions")}
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
          <button onClick={() => void save()}>{t("Save Image Edits")}</button>
          <button onClick={onClose}>{t("Cancel")}</button>
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
        <button
          type="button"
          aria-label={t("Bold")}
          title={t("Bold")}
          onClick={() => wrap("**")}
        >
          B
        </button>
        <button
          type="button"
          aria-label={t("Italic")}
          title={t("Italic")}
          onClick={() => wrap("*")}
        >
          I
        </button>
        <button
          type="button"
          aria-label={t("Link")}
          title={t("Link")}
          onClick={link}
        >
          link
        </button>
        <button
          type="button"
          aria-label={t("Code")}
          title={t("Code")}
          onClick={() => wrap("`")}
        >
          &lt;/&gt;
        </button>
        <button
          type="button"
          aria-label={t("Bullet list")}
          title={t("Bullet list")}
          onClick={() => list(false)}
        >
          -
        </button>
        <button
          type="button"
          aria-label={t("Numbered list")}
          title={t("Numbered list")}
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
