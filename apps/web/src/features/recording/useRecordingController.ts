// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateGuideMarkdown } from "@infosteed/markdown-exporter";
import type {
  CurrentUser,
  GuideItem,
  Recording,
  RecordingProject,
  RecordingVideo,
} from "@infosteed/shared";
import {
  deleteRecording,
  getRecording,
  getRecordingVideo,
  importProject,
  reorderItems,
} from "../../api";
import { errorMessage } from "../../errors";
import {
  moveGuideItem,
  orderedItems,
  reorderGuideItemsForDrop,
  type DropPosition,
} from "../../guide/model";
import { t } from "../../i18n";
import { openLibrary, openRecording } from "../../navigation";
import { startExistingCapture } from "../../components/RecordingWorkspace";

export function useRecordingController(
  recordingId: string | null,
  user: CurrentUser | undefined,
) {
  const [recording, setRecording] = useState<Recording>();
  const [video, setVideo] = useState<RecordingVideo>();
  const [error, setError] = useState<string>();
  const [rightPanelMode, setRightPanelMode] = useState<"display" | "markdown">(
    "display",
  );
  const [imageVersions, setImageVersions] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [selectedItemId, setSelectedItemId] = useState("");
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
  const [captureMoreMessage, setCaptureMoreMessage] = useState<string>();
  const [reorderBusy, setReorderBusy] = useState(false);
  const [draggingItemId, setDraggingItemId] = useState<string>();
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

  const load = useCallback(async () => {
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
      setError(errorMessage(loadError));
    }
  }, [recordingId, user]);

  useEffect(() => {
    setRecording(undefined);
    setVideo(undefined);
    setViewOnly(true);
    setSelectedItemId("");
    setPreviewOpen(false);
    setAccessOpen(false);
    setVersionsOpen(false);
    void load();
  }, [load, user?.id]);

  async function handleProjectImport(file?: File) {
    if (!file) return;
    try {
      const imported = await importProject(
        JSON.parse(await file.text()) as RecordingProject,
      );
      openRecording(imported.id);
    } catch (importError) {
      setError(errorMessage(importError));
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
    openLibrary();
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
        t(
          "Capture started. Use the extension popup to pause or stop when you are done.",
        ),
      );
    } catch (captureError) {
      setCaptureMoreStatus("error");
      setCaptureMoreMessage(errorMessage(captureError));
    }
  }

  const items = useMemo(
    () => (recording ? orderedItems(recording) : []),
    [recording],
  );

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
      setError(errorMessage(reorderError));
      await load();
    } finally {
      setReorderBusy(false);
      setDraggingItemId(undefined);
      setDropTarget(undefined);
    }
  }

  async function moveItemBy(itemId: string, delta: -1 | 1) {
    const next = moveGuideItem(items, itemId, delta);
    if (next) await persistItemOrder(next);
  }

  async function dropItem(
    itemId: string,
    targetId: string,
    position: DropPosition,
  ) {
    const next = reorderGuideItemsForDrop(items, itemId, targetId, position);
    if (next) await persistItemOrder(next);
    else {
      setDraggingItemId(undefined);
      setDropTarget(undefined);
    }
  }

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
  const stepNumbers = useMemo(() => {
    let stepNumber = 0;
    return new Map(
      items.map((item) => [
        item.id,
        item.kind === "step" ? ++stepNumber : undefined,
      ]),
    );
  }, [items]);

  return {
    recording,
    setRecording,
    video,
    setVideo,
    error,
    rightPanelMode,
    setRightPanelMode,
    imageVersions,
    setImageVersions,
    selectedItemId,
    setSelectedItemId,
    viewOnly,
    setViewOnly,
    previewOpen,
    setPreviewOpen,
    headerMoreOpen,
    setHeaderMoreOpen,
    accessOpen,
    setAccessOpen,
    versionsOpen,
    setVersionsOpen,
    previewAutoScroll,
    setPreviewAutoScroll,
    deleteCurrentOpen,
    setDeleteCurrentOpen,
    captureMoreStatus,
    captureMoreMessage,
    reorderBusy,
    draggingItemId,
    setDraggingItemId,
    dropTarget,
    setDropTarget,
    importInputRef,
    headerMoreRef,
    setPreviewScrollRef,
    load,
    handleProjectImport,
    confirmDeleteCurrentGuide,
    bumpImageVersion,
    updateLocalItem,
    handleCaptureMore,
    moveItemBy,
    dropItem,
    markdown,
    eventsById,
    items,
    stepNumbers,
    reorderDisabled: reorderBusy || Boolean(selectedItemId),
  };
}

export type RecordingController = ReturnType<typeof useRecordingController>;
