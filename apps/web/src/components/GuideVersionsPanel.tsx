// SPDX-License-Identifier: AGPL-3.0-only
import React, { useCallback, useEffect, useState } from "react";
import type {
  GuideItem,
  GuideVersion,
  GuideVersionListItem,
  Recording,
} from "@infosteed/shared";
import {
  createGuideVersion,
  getGuideVersion,
  listGuideVersions,
  restoreGuideVersion,
} from "../api";
import { errorMessage } from "../errors";
import { ConfirmDialog } from "./ConfirmDialog";

export function GuideVersionsPanel({
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
      setError(errorMessage(loadError));
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
      setError(errorMessage(saveError));
    }
  }

  async function selectVersion(version: GuideVersionListItem) {
    try {
      setSelected(await getGuideVersion(recording.id, version.id));
      setError(undefined);
    } catch (selectError) {
      setError(errorMessage(selectError));
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
      setError(errorMessage(restoreError));
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
