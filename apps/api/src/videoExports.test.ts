// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "./db";
import {
  getVideoMp4Export,
  listExpiredExportOutputs,
  queueVideoMp4Export,
} from "./repositories/videoExports";

const row = {
  id: "00000000-0000-4000-8000-000000000010",
  render_id: "00000000-0000-4000-8000-000000000020",
  status: "ready" as const,
  progress: 1,
  byte_size: "4096",
  error_message: null,
  storage_key: "videos/recording/exports/export.mp4",
  created_at: new Date("2026-08-04T10:00:00.000Z"),
  completed_at: new Date("2026-08-04T10:01:00.000Z"),
};

describe("MP4 export repository", () => {
  it("maps a cached export without exposing its storage key", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const exported = await getVideoMp4Export(
      { query } as unknown as Pool,
      "recording-id",
      row.render_id,
    );
    expect(exported).toMatchObject({
      id: row.id,
      renderId: row.render_id,
      status: "ready",
      byteSize: 4096,
      storageKey: row.storage_key,
    });
  });

  it("creates idempotently and requeues a failed export", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...row, status: "queued", progress: 0 }],
    });
    const exported = await queueVideoMp4Export(
      { query } as unknown as Pool,
      "recording-id",
      row.render_id,
    );
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain("r.status = 'ready'");
    expect(sql).toContain("on conflict (render_id)");
    expect(sql).toContain("status = 'failed'");
    expect(exported?.status).toBe("queued");
  });

  it("rejects a render that is not ready", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      queueVideoMp4Export(
        { query } as unknown as Pool,
        "recording-id",
        row.render_id,
      ),
    ).resolves.toBeNull();
  });

  it("lists cached exports whose parent render is expiring", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    await expect(
      listExpiredExportOutputs({ query } as unknown as Pool),
    ).resolves.toEqual([{ exportId: row.id, storageKey: row.storage_key }]);
    expect(query.mock.calls[0][0]).toContain("r.cleanup_after < now()");
  });
});
