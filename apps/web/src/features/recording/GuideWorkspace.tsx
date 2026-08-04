// SPDX-License-Identifier: AGPL-3.0-only
import React from "react";
import {
  AlertTriangle,
  FileText,
  GripVertical,
  Lightbulb,
  MousePointer,
} from "lucide-react";
import {
  GuideDisplayPreview,
  GuideItemEditor,
  GuideOverviewEditor,
  InsertBar,
} from "../../components/RecordingWorkspace";
import { ScrollArea } from "../../components/ui/scroll-area";
import { t } from "../../i18n";
import type { RecordingController } from "./useRecordingController";

export function GuideWorkspace({
  controller,
}: {
  controller: RecordingController;
}) {
  const {
    recording,
    setRecording,
    rightPanelMode,
    setRightPanelMode,
    imageVersions,
    selectedItemId,
    setSelectedItemId,
    viewOnly,
    previewOpen,
    setPreviewOpen,
    headerMoreOpen,
    accessOpen,
    setAccessOpen,
    setVersionsOpen,
    previewAutoScroll,
    setPreviewAutoScroll,
    captureMoreStatus,
    captureMoreMessage,
    draggingItemId,
    setDraggingItemId,
    dropTarget,
    setDropTarget,
    setPreviewScrollRef,
    load,
    bumpImageVersion,
    updateLocalItem,
    moveItemBy,
    dropItem,
    markdown,
    eventsById,
    items,
    stepNumbers,
    reorderDisabled,
  } = controller;
  if (!recording) return null;
  const selectedItem = items.find((item) => item.id === selectedItemId);

  return (
    <>
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
            aria-label={t("Open preview")}
          >
            <span className="burger-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {t("Preview")}
          </button>
        )}

      {recording.captureMode !== "video" && (
        <div className="layout">
          {!viewOnly && (
            <aside className="guide-outline" aria-label={t("Guide outline")}>
              <div className="guide-panel-head">
                <p>{t("Outline")}</p>
                <span>{items.length}</span>
              </div>
              <button
                className={selectedItemId === "overview" ? "active" : ""}
                type="button"
                onClick={() => setSelectedItemId("overview")}
              >
                <FileText className="size-4" />
                <span>{t("Overview")}</span>
              </button>
              <ScrollArea className="guide-outline-scroll">
                {items.map((item, index) => {
                  const Icon =
                    item.kind === "tip"
                      ? Lightbulb
                      : item.kind === "alert"
                        ? AlertTriangle
                        : item.kind === "header"
                          ? FileText
                          : MousePointer;
                  return (
                    <button
                      key={item.id}
                      className={selectedItemId === item.id ? "active" : ""}
                      type="button"
                      onClick={() => setSelectedItemId(item.id)}
                    >
                      <Icon className="size-4" />
                      <span>
                        {item.kind === "step" && stepNumbers.get(item.id)
                          ? `${stepNumbers.get(item.id)}. `
                          : ""}
                        {item.title || item.body || t("Untitled")}
                      </span>
                      {!reorderDisabled && (
                        <GripVertical className="guide-outline-grip size-3" />
                      )}
                    </button>
                  );
                })}
              </ScrollArea>
            </aside>
          )}
          <section className="steps document-canvas">
            <GuideOverviewEditor
              recording={recording}
              isSelected={false}
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
                      aria-label={t("Reorder {title}", { title: item.title })}
                    >
                      <button
                        className="drag-handle"
                        draggable={!reorderDisabled}
                        disabled={reorderDisabled}
                        title={t("Drag to reorder")}
                        aria-label={t("Drag {title}", { title: item.title })}
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
                        {t("Move up")}
                      </button>
                      <button
                        disabled={reorderDisabled || index === items.length - 1}
                        onClick={() => void moveItemBy(item.id, 1)}
                      >
                        {t("Move down")}
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
                    isSelected={false}
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
          {!viewOnly && (
            <aside
              className="guide-properties"
              aria-label={t("Step properties")}
            >
              <div className="guide-panel-head">
                <p>{t("Properties")}</p>
                {selectedItem && <span>{t(selectedItem.kind)}</span>}
              </div>
              {!selectedItemId && (
                <div className="properties-empty">
                  <strong>{t("Select a step")}</strong>
                  <p>
                    {t(
                      "Choose a guide item to edit its text, image, and metadata.",
                    )}
                  </p>
                </div>
              )}
              {selectedItemId === "overview" && (
                <GuideOverviewEditor
                  recording={recording}
                  isSelected
                  onSelect={() => setSelectedItemId("overview")}
                  onCloseEdit={() => setSelectedItemId("")}
                  editable
                  onDraftChange={(updated) => setRecording(updated)}
                  onSaved={(updated) => setRecording(updated)}
                />
              )}
              {selectedItem && (
                <GuideItemEditor
                  recordingId={recording.id}
                  item={selectedItem}
                  event={
                    selectedItem.eventId
                      ? eventsById.get(selectedItem.eventId)
                      : undefined
                  }
                  stepNumber={stepNumbers.get(selectedItem.id)}
                  imageVersion={
                    selectedItem.imageFilename
                      ? imageVersions.get(selectedItem.imageFilename)
                      : undefined
                  }
                  onImageSaved={bumpImageVersion}
                  isSelected
                  onSelect={() => setSelectedItemId(selectedItem.id)}
                  onCloseEdit={() => setSelectedItemId("")}
                  editable
                  onDraftChange={updateLocalItem}
                  onSaved={load}
                />
              )}
            </aside>
          )}
        </div>
      )}
      {recording.captureMode !== "video" && previewOpen && (
        <section className="preview-drawer" aria-label={t("Guide preview")}>
          <div className="preview-head">
            <h2>
              {rightPanelMode === "display"
                ? t("Display Preview")
                : t("Markdown")}
            </h2>
            <div className="segmented">
              {!previewAutoScroll && (
                <button
                  onClick={() => {
                    setPreviewAutoScroll(true);
                  }}
                >
                  {t("Sync scroll")}
                </button>
              )}
              <button
                className={rightPanelMode === "display" ? "active" : undefined}
                onClick={() => setRightPanelMode("display")}
              >
                {t("Preview")}
              </button>
              <button
                className={rightPanelMode === "markdown" ? "active" : undefined}
                onClick={() => setRightPanelMode("markdown")}
              >
                {t("Markdown")}
              </button>
              <button onClick={() => setPreviewOpen(false)}>
                {t("Close")}
              </button>
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
    </>
  );
}
