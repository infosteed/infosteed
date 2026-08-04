// SPDX-License-Identifier: AGPL-3.0-only
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { generateGuideMarkdown } from "@infosteed/markdown-exporter";
import type {
  BrandingSettings,
  CurrentUser,
  GuideItem,
  GuideItemKind,
  NormalizedRect,
  Recording,
  RecordingVideo,
  RecordingTranscript,
  RecordingProject,
  ScreenshotEditOperations,
} from "@infosteed/shared";
import { PRODUCT_IDENTIFIERS } from "@infosteed/shared";
import { BrandMark } from "./components/BrandMark";
import {
  addItem,
  deleteItemImage,
  deleteItem,
  deleteRecording,
  exportUrl,
  generateOverview,
  getBranding,
  getImageEdits,
  getRecording,
  getRecordingVideo,
  getRecordingTranscript,
  htmlExportUrl,
  imageUrl,
  importProject,
  logout,
  logoutAll,
  me,
  pdfExportUrl,
  projectExportUrl,
  regenerateStep,
  replaceItemImage,
  reorderItems,
  sanityExportUrl,
  publishRecordingVideo,
  unpublishRecordingVideo,
  deleteRecordingVideo,
  recordingVideoContentUrl,
  recordingCaptionsUrl,
  retryRecordingTranscript,
  setupStatus,
  sourceImageUrl,
  updateRecording,
  updateImageEdits,
  updateItem,
  wordExportUrl,
} from "./api";
import "./styles.css";
import { VideoEditor } from "./VideoEditor";
import { RecordingGenerationStatus } from "./components/RecordingGenerationStatus";
import { errorMessage } from "./errors";
import { guideSourceLabel } from "./guide/source";
import { AuthForm } from "./components/AuthForm";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { LegalView } from "./components/LegalView";
import { GuideBrowser } from "./components/GuideBrowser";
import { AdminPanel } from "./components/AdminPanel";
import { GuideShareMovePanel } from "./components/GuideShareMovePanel";
import { GuideVersionsPanel } from "./components/GuideVersionsPanel";
import {
  GuideDisplayPreview,
  GuideItemEditor,
  GuideOverviewEditor,
  InsertBar,
  VideoGuidePlayer,
  type DropPosition,
  orderedItems,
  startExistingCapture,
  useRecordingId,
} from "./components/RecordingWorkspace";
import {
  currentRecordingId,
  currentView,
  openLibrary,
  openRecording,
} from "./navigation";

export function App() {
  const recordingId = useRecordingId();
  const requestedView = currentView();
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
      setError(errorMessage(loadError));
    }
  }

  async function handleProjectImport(file?: File) {
    if (!file) return;

    try {
      const project = JSON.parse(await file.text()) as RecordingProject;
      const imported = await importProject(project);
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
        "Capture started. Use the extension popup to pause or stop when you are done.",
      );
    } catch (captureError) {
      setCaptureMoreStatus("error");
      setCaptureMoreMessage(errorMessage(captureError));
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
      setError(errorMessage(reorderError));
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

  if (!authChecked)
    return (
      <main className="empty product-loading">
        <BrandMark />
        <p>Loading InfoSteed...</p>
      </main>
    );
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
  if (!recording)
    return (
      <main className="empty product-loading">
        <BrandMark />
        <p>Loading recording...</p>
      </main>
    );
  if (
    requestedView === "video-edit" &&
    video &&
    recording.captureMode !== "guide"
  ) {
    return (
      <VideoEditor
        recording={recording}
        video={video}
        onPublished={setVideo}
        onGenerationFinished={() => void load()}
      />
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
          <a href="/">Library</a>
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
              <button onClick={() => openRecording(recording.id, "video-edit")}>
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

      {recording.captureMode !== "guide" && video && (
        <RecordingGenerationStatus
          captureMode={recording.captureMode}
          status={video.transcriptionStatus}
        />
      )}

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
            if (recording.captureMode === "video") openLibrary();
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
