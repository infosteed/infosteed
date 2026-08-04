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
  ScanLine,
  Trash2,
  X,
} from "lucide-react";
import { sourceImageUrl } from "../../api";
import { t } from "../../i18n";
import { useImageEditorController } from "./useGuideWorkspaceControllers";
import { GuideIconButton } from "./GuideIconButton";

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
          <GuideIconButton label={t("Close")} onClick={onClose}>
            <X aria-hidden="true" />
          </GuideIconButton>
        </div>
        <div className="editor-tools">
          <GuideIconButton
            label={t("Crop / Zoom")}
            active={mode === "crop"}
            onClick={() => setMode("crop")}
          >
            <Crop aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Redact")}
            active={mode === "redact"}
            onClick={() => setMode("redact")}
          >
            <ScanLine aria-hidden="true" />
          </GuideIconButton>
          <GuideIconButton
            label={t("Clear Crop")}
            onClick={() =>
              setOperations({ redactions: operations.redactions ?? [] })
            }
          >
            <Eraser aria-hidden="true" />
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
