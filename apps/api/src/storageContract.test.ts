// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  adminClient,
  backupObjects,
  listKeys,
  restoreObjects,
  verifyObjects,
} from "./storageAdmin.js";
import { createVideoStorage } from "./videoStorage.js";
import type { ApiConfig } from "./config.js";

describe.skipIf(!process.env.S3_PERSISTENCE_PHASE)(
  "S3 persistence across recreation",
  () => {
    it("preserves bytes and credentials", async () => {
      const client = adminClient();
      try {
        if (process.env.S3_PERSISTENCE_PHASE === "write")
          await client.send(
            new PutObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: "persistence-sentinel",
              Body: "persistent fixture",
              ContentType: "text/plain",
            }),
          );
        else {
          const result = await client.send(
            new GetObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: "persistence-sentinel",
            }),
          );
          expect(await result.Body!.transformToString()).toBe(
            "persistent fixture",
          );
          await client.send(
            new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET,
              Key: "persistence-sentinel",
            }),
          );
        }
      } finally {
        client.destroy();
      }
    });
  },
);

describe.skipIf(process.env.RUN_S3_CONTRACT !== "1")(
  "live S3 storage contract (dedicated empty bucket required)",
  () => {
    it("supports app multipart/ranges, exact backup/restore, metadata and safe resume", async () => {
      const client = adminClient();
      const bucket = process.env.S3_BUCKET!;
      expect(await listKeys(client, bucket)).toEqual([]);
      const root = await mkdtemp(
        path.join(os.tmpdir(), "infosteed-s3-contract-"),
      );
      const storage = createVideoStorage({
        S3_BUCKET: bucket,
        S3_REGION: process.env.S3_REGION!,
        S3_ENDPOINT: process.env.S3_ENDPOINT,
        S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
        S3_FORCE_PATH_STYLE: true,
      } as ApiConfig);
      try {
        expect(await storage.checkHealth()).toBe(true);
        const upload = await storage.createMultipartUpload(
          "video.webm",
          "video/webm",
        );
        const body = Buffer.alloc(8 * 1024 * 1024, 42),
          tail = Buffer.from("last part");
        const a = await storage.uploadPart("video.webm", upload, 1, body);
        const b = await storage.uploadPart("video.webm", upload, 2, tail);
        await storage.completeMultipartUpload("video.webm", upload, [
          { partNumber: 2, etag: b },
          { partNumber: 1, etag: a },
        ]);
        const ranged = await storage.getObject("video.webm", "bytes=1-4");
        expect(ranged.contentRange).toBe(
          `bytes 1-4/${body.length + tail.length}`,
        );
        expect(await (ranged.body as Readable).toArray()).toEqual([
          Buffer.alloc(4, 42),
        ]);
        const abort = await storage.createMultipartUpload(
          "aborted",
          "video/webm",
        );
        await storage.abortMultipartUpload("aborted", abort);
        await expect(storage.getObject("aborted")).rejects.toThrow();
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: "microphone.webm",
            Body: tail,
            ContentType: "audio/webm",
            ContentDisposition: "inline",
            CacheControl: "private",
            Metadata: { fixture: "contract" },
          }),
        );
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: "empty.wav",
            Body: Buffer.alloc(0),
            ContentType: "audio/wav",
          }),
        );
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: "nested/encoded.wav",
            Body: gzipSync("encoded fixture"),
            ContentType: "audio/wav",
            ContentEncoding: "gzip",
            Metadata: { fixture: "encoded" },
          }),
        );
        await backupObjects(client, bucket, root);
        await verifyObjects(client, bucket, root);
        await expect(restoreObjects(client, bucket, root)).rejects.toThrow(
          "not empty",
        );
        await restoreObjects(client, bucket, root, true);
        for (const key of await listKeys(client, bucket))
          await client.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: key }),
          );
        await restoreObjects(client, bucket, root);
        await verifyObjects(client, bucket, root);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: "unexpected",
            Body: "unexpected",
          }),
        );
        await expect(verifyObjects(client, bucket, root)).rejects.toThrow(
          "set differs",
        );
        await expect(
          restoreObjects(client, bucket, root, true),
        ).rejects.toThrow("Unexpected");
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: "unexpected" }),
        );
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: "microphone.webm",
            Body: "corrupt",
            ContentType: "audio/webm",
          }),
        );
        await expect(
          restoreObjects(client, bucket, root, true),
        ).rejects.toThrow("verification");
        const manifest = JSON.parse(
          await readFile(path.join(root, "objects.json"), "utf8"),
        );
        await writeFile(path.join(root, manifest.objects[0].file), "corrupt");
        await expect(
          restoreObjects(client, bucket, root, true),
        ).rejects.toThrow("checksum");
        await expect(storage.getObject("missing")).rejects.toThrow();
        const bad = adminClient({
          ...process.env,
          S3_SECRET_ACCESS_KEY: "invalid",
        });
        try {
          await expect(
            bad.send(new HeadBucketCommand({ Bucket: bucket })),
          ).rejects.toThrow();
        } finally {
          bad.destroy();
        }
        await expect(
          client.send(
            new GetObjectCommand({
              Bucket: `${bucket}-missing`,
              Key: "missing",
            }),
          ),
        ).rejects.toThrow();
      } finally {
        for (const key of await listKeys(client, bucket))
          await storage.deleteObject(key);
        storage.close();
        client.destroy();
        await rm(root, { recursive: true, force: true });
      }
    }, 180_000);
  },
);
