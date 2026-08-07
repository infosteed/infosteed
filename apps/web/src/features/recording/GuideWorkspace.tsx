// SPDX-License-Identifier: AGPL-3.0-only
import React from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  FileText,
  GripVertical,
  Lightbulb,
  Menu,
  MousePointer,
} from "lucide-react";
import {
  GuideDisplayPreview,
  GuideItemEditor,
  GuideOverviewEditor,
  InsertBar,
} from "../../components/RecordingWorkspace";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "../../components/ui/sheet";
import { t } from "../../i18n";
import type { RecordingController } from "./useRecordingController";
import { GuideIconButton } from "../guide/GuideIconButton";

export function GuideWorkspace({
  controller,
  showViewNavigation = false,
}: {
  controller: RecordingController;
  showViewNavigation?: boolean;
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
  const pendingOutlineScroll = React.useRef<string>();
  const pendingClosePosition = React.useRef<{
    itemId: string;
    top: number;
  }>();
  const [mobileOutlineOpen, setMobileOutlineOpen] = React.useState(false);
  const [activeOutlineItemId, setActiveOutlineItemId] = React.useState(
    selectedItemId || "overview",
  );

  const scrollToGuideItem = React.useCallback((itemId: string) => {
    const target = document.getElementById(`guide-item-${itemId}`);
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const selectFromOutline = (itemId: string) => {
    setActiveOutlineItemId(itemId);
    if (selectedItemId === itemId) {
      scrollToGuideItem(itemId);
      return;
    }
    pendingOutlineScroll.current = itemId;
    setSelectedItemId(itemId);
  };

  const selectInlineItem = (itemId: string) => {
    pendingOutlineScroll.current = itemId;
    setActiveOutlineItemId(itemId);
    setSelectedItemId(itemId);
  };

  const closeInlineEditor = (itemId: string) => {
    const target = document.getElementById(`guide-item-${itemId}`);
    if (target) {
      pendingClosePosition.current = {
        itemId,
        top: target.getBoundingClientRect().top,
      };
    }
    setSelectedItemId("");
  };

  const navigateFromOutline = (itemId: string) => {
    if (viewOnly) {
      setActiveOutlineItemId(itemId);
      scrollToGuideItem(itemId);
      return;
    }
    selectFromOutline(itemId);
  };

  React.useEffect(() => {
    if (pendingOutlineScroll.current !== selectedItemId) return;
    pendingOutlineScroll.current = undefined;
    scrollToGuideItem(selectedItemId);
  }, [scrollToGuideItem, selectedItemId]);

  React.useLayoutEffect(() => {
    const pending = pendingClosePosition.current;
    if (!pending || selectedItemId) return undefined;
    pendingClosePosition.current = undefined;

    const restorePosition = () => {
      const target = document.getElementById(`guide-item-${pending.itemId}`);
      if (!target) return;
      const delta = target.getBoundingClientRect().top - pending.top;
      if (Math.abs(delta) > 0.5) {
        window.scrollBy({ top: delta, left: 0, behavior: "auto" });
      }
    };

    restorePosition();
    const animationFrame = window.requestAnimationFrame(restorePosition);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [selectedItemId]);

  React.useEffect(() => {
    if ((viewOnly && !showViewNavigation) || recording?.captureMode === "video")
      return;

    const targets = ["overview", ...items.map((item) => item.id)];
    const updateActiveOutlineItem = () => {
      const readingLine = Math.min(120, window.innerHeight * 0.2);
      let nextId: string | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const itemId of targets) {
        const target = document.getElementById(`guide-item-${itemId}`);
        if (!target) continue;
        const rect = target.getBoundingClientRect();
        if (rect.height <= 0) continue;

        if (rect.top <= readingLine && rect.bottom > readingLine) {
          nextId = itemId;
          break;
        }

        const distance = Math.min(
          Math.abs(rect.top - readingLine),
          Math.abs(rect.bottom - readingLine),
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nextId = itemId;
        }
      }

      if (nextId) {
        setActiveOutlineItemId((current) =>
          current === nextId ? current : nextId,
        );
      }
    };

    updateActiveOutlineItem();
    window.addEventListener("scroll", updateActiveOutlineItem, {
      passive: true,
    });
    window.addEventListener("resize", updateActiveOutlineItem);
    document.addEventListener("scroll", updateActiveOutlineItem, true);
    return () => {
      window.removeEventListener("scroll", updateActiveOutlineItem);
      window.removeEventListener("resize", updateActiveOutlineItem);
      document.removeEventListener("scroll", updateActiveOutlineItem, true);
    };
  }, [items, recording?.captureMode, showViewNavigation, viewOnly]);

  if (!recording) return null;

  const overviewButton = (onNavigate: (itemId: string) => void) => (
    <button
      className={`${activeOutlineItemId === "overview" ? "active" : ""}${!viewOnly && selectedItemId === "overview" ? " selected" : ""}`}
      type="button"
      aria-current={activeOutlineItemId === "overview" ? "location" : undefined}
      onClick={() => onNavigate("overview")}
    >
      <FileText className="size-4" />
      <span>{t("Overview")}</span>
    </button>
  );

  const outlineItemButtons = (onNavigate: (itemId: string) => void) =>
    items.map((item) => {
      const Icon =
        item.kind === "tip"
          ? Lightbulb
          : item.kind === "alert"
            ? AlertTriangle
            : item.kind === "header"
              ? FileText
              : MousePointer;
      const outlineTitle = item.title || item.body || t("Untitled");
      return (
        <button
          key={item.id}
          className={`${activeOutlineItemId === item.id ? "active" : ""}${!viewOnly && selectedItemId === item.id ? " selected" : ""}`}
          type="button"
          aria-current={
            activeOutlineItemId === item.id ? "location" : undefined
          }
          onClick={() => onNavigate(item.id)}
        >
          <Icon className="size-4" />
          <span title={outlineTitle}>
            {item.kind === "step" && stepNumbers.get(item.id)
              ? `${stepNumbers.get(item.id)}. `
              : ""}
            {outlineTitle}
          </span>
          {!viewOnly && !reorderDisabled && (
            <GripVertical className="guide-outline-grip size-3" />
          )}
        </button>
      );
    });

  return (
    <>
      {captureMoreMessage && !viewOnly && (
        <div className={`capture-status ${captureMoreStatus}`} role="status">
          {captureMoreMessage}
        </div>
      )}

      {recording.captureMode !== "video" && (
        <>
          {showViewNavigation && (
            <div className="guide-mobile-outline-trigger">
              <Sheet
                open={mobileOutlineOpen}
                onOpenChange={setMobileOutlineOpen}
              >
                <SheetTrigger asChild>
                  <GuideIconButton label={t("Open guide outline")}>
                    <Menu aria-hidden="true" />
                  </GuideIconButton>
                </SheetTrigger>
                <SheetContent className="guide-mobile-outline-sheet">
                  <SheetHeader className="guide-mobile-outline-head">
                    <SheetTitle>{t("Outline")}</SheetTitle>
                    <SheetDescription className="sr-only">
                      {t("Guide outline")}
                    </SheetDescription>
                    <span>{items.length}</span>
                  </SheetHeader>
                  <ScrollArea className="guide-mobile-outline-scroll">
                    {overviewButton((itemId) => {
                      navigateFromOutline(itemId);
                      setMobileOutlineOpen(false);
                    })}
                    {outlineItemButtons((itemId) => {
                      navigateFromOutline(itemId);
                      setMobileOutlineOpen(false);
                    })}
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            </div>
          )}
          <div
            className={`layout${viewOnly ? " layout-view-only" : ""}${showViewNavigation ? " layout-view-navigation" : ""}`}
          >
            {(!viewOnly || showViewNavigation) && (
              <aside className="guide-outline" aria-label={t("Guide outline")}>
                <div className="guide-panel-head">
                  <p>{t("Outline")}</p>
                  <span>{items.length}</span>
                </div>
                {overviewButton(navigateFromOutline)}
                <ScrollArea className="guide-outline-scroll">
                  {outlineItemButtons(navigateFromOutline)}
                </ScrollArea>
              </aside>
            )}
            <section className="steps document-canvas">
              <GuideOverviewEditor
                elementId="guide-item-overview"
                recording={recording}
                isSelected={selectedItemId === "overview"}
                onSelect={() => selectInlineItem("overview")}
                onCloseEdit={() => closeInlineEditor("overview")}
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
                      isSelected={selectedItemId === item.id}
                      onSelect={() => selectInlineItem(item.id)}
                      onCloseEdit={() => closeInlineEditor(item.id)}
                      editable={!viewOnly}
                      onDraftChange={updateLocalItem}
                      onSaved={load}
                      controls={
                        !viewOnly ? (
                          <div
                            className="reorder-controls"
                            aria-label={t("Reorder {title}", {
                              title: item.title,
                            })}
                            onClick={(event) => event.stopPropagation()}
                            onFocus={(event) => event.stopPropagation()}
                          >
                            <GuideIconButton
                              className="drag-handle"
                              label={t("Drag {title}", { title: item.title })}
                              draggable={!reorderDisabled}
                              disabled={reorderDisabled}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  item.id,
                                );
                                setDraggingItemId(item.id);
                              }}
                              onDragEnd={() => {
                                setDraggingItemId(undefined);
                                setDropTarget(undefined);
                              }}
                            >
                              <GripVertical aria-hidden="true" />
                            </GuideIconButton>
                            <GuideIconButton
                              label={t("Move up")}
                              disabled={reorderDisabled || index === 0}
                              onClick={() => void moveItemBy(item.id, -1)}
                            >
                              <ArrowUp aria-hidden="true" />
                            </GuideIconButton>
                            <GuideIconButton
                              label={t("Move down")}
                              disabled={
                                reorderDisabled || index === items.length - 1
                              }
                              onClick={() => void moveItemBy(item.id, 1)}
                            >
                              <ArrowDown aria-hidden="true" />
                            </GuideIconButton>
                          </div>
                        ) : undefined
                      }
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
        </>
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
