// SPDX-License-Identifier: AGPL-3.0-only
import type { Pool } from "./db.js";
import type { VideoStorage } from "./videoStorage.js";
import {
  failAbandonedAsset,
  hardDeleteExpiredRecording,
  listAbandonedUploads,
  listExpiredDeletedRecordings,
} from "./repositories/videos.js";
import {
  expireRenderOutput,
  expireMetadataOnlyRenders,
  listExpiredRenderOutputs,
  listRenderStorageForVideo,
} from "./repositories/videoEditing.js";
import {
  deleteVideoMp4Export,
  listExpiredExportOutputs,
  listExportStorageForVideo,
} from "./repositories/videoExports.js";
import {
  deleteOrphanedVoiceoverClip,
  listOrphanedVoiceoverClips,
} from "./repositories/voiceovers.js";

export async function cleanupVideos(
  pool: Pool,
  storage: VideoStorage,
): Promise<void> {
  if (storage.enabled) {
    for (const asset of await listAbandonedUploads(pool)) {
      if (asset.multipart_upload_id) {
        await storage
          .abortMultipartUpload(asset.storage_key, asset.multipart_upload_id)
          .catch(() => undefined);
      }
      await failAbandonedAsset(pool, asset.id);
    }
    for (const exported of await listExpiredExportOutputs(pool)) {
      if (exported.storageKey) await storage.deleteObject(exported.storageKey);
      await deleteVideoMp4Export(pool, exported.exportId);
    }
    for (const render of await listExpiredRenderOutputs(pool)) {
      await storage.deleteObject(render.storageKey);
      await expireRenderOutput(pool, render.renderId);
    }
  }
  await expireMetadataOnlyRenders(pool);
  for (const recording of await listExpiredDeletedRecordings(pool)) {
    const renders = await listRenderStorageForVideo(
      pool,
      recording.recordingId,
    );
    const exports = await listExportStorageForVideo(
      pool,
      recording.recordingId,
    );
    const hasStoredMedia =
      recording.assets.length > 0 || renders.length > 0 || exports.length > 0;
    if (hasStoredMedia && !storage.enabled) continue;
    const results = await Promise.allSettled([
      ...recording.assets.map((asset) =>
        asset.multipart_upload_id
          ? storage.abortMultipartUpload(
              asset.storage_key,
              asset.multipart_upload_id,
            )
          : storage.deleteObject(asset.storage_key),
      ),
      ...renders.map((render) => storage.deleteObject(render.storageKey)),
      ...exports.map((exported) => storage.deleteObject(exported.storageKey)),
    ]);
    if (results.every((result) => result.status === "fulfilled")) {
      await hardDeleteExpiredRecording(pool, recording.recordingId);
    }
  }
  if (storage.enabled) {
    for (const clip of await listOrphanedVoiceoverClips(pool)) {
      await storage.deleteObject(clip.storage_key);
      await deleteOrphanedVoiceoverClip(pool, clip.id);
    }
  }
}
