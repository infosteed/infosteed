// SPDX-License-Identifier: AGPL-3.0-only
import React, { useEffect, useRef } from "react";
import type { ScribeMarkdownImportJob } from "@infosteed/shared";
import {
  AlertTriangle,
  ExternalLink,
  FileJson,
  FileText,
  RotateCcw,
} from "lucide-react";
import { t } from "../i18n";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

function statusLabel(job: ScribeMarkdownImportJob): string {
  if (job.status === "queued") return t("Queued");
  if (job.status === "processing") return t("Downloading screenshots");
  if (job.status === "completed_with_warnings")
    return t("Completed with missing screenshots");
  if (job.status === "completed") return t("Completed");
  return t("Failed");
}

export function ScribeMarkdownImportDialog({
  open,
  onOpenChange,
  jobs,
  busy,
  error,
  onLoad,
  onImportProject,
  onImportScribe,
  onRetry,
  onOpenGuide,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  jobs: ScribeMarkdownImportJob[];
  busy: boolean;
  error?: string;
  onLoad(): Promise<void>;
  onImportProject(): void;
  onImportScribe(file?: File): Promise<void>;
  onRetry(jobId: string): Promise<void>;
  onOpenGuide(recordingId: string): void;
}) {
  const markdownInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) void onLoad();
  }, [onLoad, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scribe-import-dialog">
        <DialogHeader>
          <DialogTitle>{t("Import guide")}</DialogTitle>
          <DialogDescription>
            {t(
              "Import an InfoSteed project or migrate a Scribe Markdown export with its screenshots.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="scribe-import-choices">
          <Button type="button" variant="outline" onClick={onImportProject}>
            <FileJson className="size-4" />
            {t("InfoSteed Project")}
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => markdownInput.current?.click()}
          >
            <FileText className="size-4" />
            {t("Scribe Markdown")}
          </Button>
          <input
            ref={markdownInput}
            className="hidden-file"
            type="file"
            accept="text/markdown,.md"
            onChange={(event) => {
              const file = event.target.files?.[0];
              void onImportScribe(file).finally(() => {
                event.target.value = "";
              });
            }}
          />
        </div>

        {error && <p className="error">{error}</p>}

        {jobs.length > 0 && (
          <section className="scribe-import-jobs">
            <h3>{t("Recent Scribe imports")}</h3>
            {jobs.map((job) => {
              const active =
                job.status === "queued" || job.status === "processing";
              const missedUrls = job.failedImages
                .map((failure) => `${failure.url}\n${failure.error}`)
                .join("\n\n");
              return (
                <article key={job.id} className="scribe-import-job">
                  <div className="scribe-import-job-head">
                    <div>
                      <strong>{job.originalFilename}</strong>
                      <span>{statusLabel(job)}</span>
                    </div>
                    {job.recordingId && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onOpenGuide(job.recordingId!)}
                      >
                        <ExternalLink className="size-4" />
                        {t("Open guide")}
                      </Button>
                    )}
                    {job.status === "failed" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void onRetry(job.id)}
                      >
                        <RotateCcw className="size-4" />
                        {t("Retry")}
                      </Button>
                    )}
                  </div>
                  <progress
                    max={Math.max(1, job.totalImages)}
                    value={job.processedImages}
                    aria-label={t("Screenshot import progress")}
                  />
                  <p>
                    {t("{processed} of {total} screenshots processed", {
                      processed: job.processedImages,
                      total: job.totalImages,
                    })}
                  </p>
                  {job.errorMessage && (
                    <p className="error">{job.errorMessage}</p>
                  )}
                  {!active && job.failedImages.length > 0 && (
                    <div className="scribe-import-failures">
                      <p>
                        <AlertTriangle className="size-4" aria-hidden="true" />
                        {t("These screenshot URLs could not be imported:")}
                      </p>
                      <textarea
                        readOnly
                        rows={Math.min(8, job.failedImages.length * 2)}
                        value={missedUrls}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void navigator.clipboard.writeText(missedUrls)
                        }
                      >
                        {t("Copy missed URLs")}
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
