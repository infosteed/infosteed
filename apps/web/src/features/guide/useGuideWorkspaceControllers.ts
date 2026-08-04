// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import type {
  GuideItem,
  GuideItemKind,
  Recording,
  RecordingTranscript,
  RecordingVideo,
  ScreenshotEditOperations,
} from "@infosteed/shared";
import {
  addItem,
  deleteItem,
  deleteItemImage,
  deleteRecordingVideo,
  generateOverview,
  getImageEdits,
  getRecordingTranscript,
  getRecordingVideo,
  publishRecordingVideo,
  regenerateStep,
  replaceItemImage,
  retryRecordingTranscript,
  unpublishRecordingVideo,
  updateImageEdits,
  updateItem,
  updateRecording,
} from "../../api";
import { errorMessage } from "../../errors";
import { t } from "../../i18n";

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function useVideoGuidePlayerController({
  recording,
  video,
  onVideoChanged,
  onRecordingChanged,
  onVideoDeleted,
}: {
  recording: Recording;
  video: RecordingVideo;
  onVideoChanged: (video: RecordingVideo) => void;
  onRecordingChanged: () => void;
  onVideoDeleted: () => void;
}) {
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
        if (next.status === "ready" || next.status === "failed") {
          if (video.transcriptionStatus !== next.status)
            onVideoChanged(await getRecordingVideo(recording.id));
          if (recording.captureMode === "both") onRecordingChanged();
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
        ? t("This removes the video and moves the empty recording to Trash.")
        : t(
            "This removes the video and raw tracks. The written guide will remain.",
          );
    if (!window.confirm(t("{consequence} Continue?", { consequence }))) return;
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

  return {
    busy,
    error,
    panel,
    setPanel,
    transcript,
    togglePublished,
    discard,
    retryTranscript,
  };
}

export function useInsertController({
  recordingId,
  afterItemId,
  onAdded,
}: {
  recordingId: string;
  afterItemId?: string | null;
  onAdded: () => void;
}) {
  return async function insert(kind: GuideItemKind) {
    await addItem(recordingId, { kind, afterItemId });
    onAdded();
  };
}

export function useGuideItemEditorController({
  recordingId,
  item,
  onImageSaved,
  onDraftChange,
  onSaved,
}: {
  recordingId: string;
  item: GuideItem;
  onImageSaved: (filename: string) => void;
  onDraftChange: (item: GuideItem) => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const [editingImage, setEditingImage] = useState(false);
  const [deleteImageOpen, setDeleteImageOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string>();
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const lastSavedRef = useRef(item);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dirty =
    draft.title !== lastSavedRef.current.title ||
    draft.body !== lastSavedRef.current.body ||
    draft.altText !== lastSavedRef.current.altText;

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
      setImageError(t("Upload a PNG, JPEG, or WebP image."));
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

  async function regenerate() {
    await regenerateStep(recordingId, item.id);
    onSaved();
  }

  return {
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
  };
}

export function useGuideOverviewController({
  recording,
  onDraftChange,
  onSaved,
}: {
  recording: Recording;
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

  return { draft, generating, saveState, updateDraft, generate };
}

export function useImageEditorController({
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
  const [operations, setOperations] = useState<ScreenshotEditOperations>({
    redactions: [],
  });

  useEffect(() => {
    void getImageEdits(recordingId, filename).then(setOperations);
  }, [filename, recordingId]);

  async function save() {
    await updateImageEdits(recordingId, filename, operations);
    onSaved();
    onClose();
  }

  return { operations, setOperations, save };
}
