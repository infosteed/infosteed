// SPDX-License-Identifier: AGPL-3.0-only
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type { ApiConfig } from "./config.js";

export interface VideoStorage {
  readonly enabled: boolean;
  close(): void;
  checkHealth(): Promise<boolean>;
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<string>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  getObject(
    key: string,
    range?: string,
  ): Promise<{
    body: unknown;
    contentLength?: number;
    contentRange?: string;
    contentType?: string;
    etag?: string;
  }>;
  deleteObject(key: string): Promise<void>;
}

function disabled(): VideoStorage {
  const unavailable = async (): Promise<never> => {
    throw Object.assign(new Error("Video storage is not configured"), {
      statusCode: 503,
    });
  };
  return {
    enabled: false,
    close() {},
    async checkHealth() {
      return true;
    },
    createMultipartUpload: unavailable,
    uploadPart: unavailable,
    completeMultipartUpload: unavailable,
    abortMultipartUpload: unavailable,
    getObject: unavailable,
    deleteObject: unavailable,
  };
}

export function createVideoStorage(config: ApiConfig): VideoStorage {
  if (!config.S3_BUCKET) return disabled();

  const bucket = config.S3_BUCKET;
  let bucketReady: Promise<void> | undefined;
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  function ensureBucket(): Promise<void> {
    bucketReady ??= (async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return;
      } catch (error) {
        const statusCode = (
          error as { $metadata?: { httpStatusCode?: number } }
        ).$metadata?.httpStatusCode;
        const errorName = (error as { name?: string }).name;
        if (
          statusCode !== 404 &&
          errorName !== "NotFound" &&
          errorName !== "NoSuchBucket"
        )
          throw error;
      }

      try {
        await client.send(
          new CreateBucketCommand({
            Bucket: bucket,
            CreateBucketConfiguration:
              config.S3_REGION === "us-east-1"
                ? undefined
                : { LocationConstraint: config.S3_REGION as never },
          }),
        );
      } catch (createError) {
        // A concurrent API instance may have created the bucket after our HEAD.
        try {
          await client.send(new HeadBucketCommand({ Bucket: bucket }));
        } catch {
          throw createError;
        }
      }
    })().catch((error) => {
      bucketReady = undefined;
      throw error;
    });
    return bucketReady;
  }

  return {
    enabled: true,
    close() {
      client.destroy();
    },
    async checkHealth() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    },
    async createMultipartUpload(key, contentType) {
      await ensureBucket();
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
        }),
      );
      if (!result.UploadId)
        throw new Error("Object storage did not return a multipart upload id");
      return result.UploadId;
    },
    async uploadPart(key, uploadId, partNumber, body) {
      const result = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: body.byteLength,
        }),
      );
      if (!result.ETag)
        throw new Error(
          "Object storage did not return an ETag for the uploaded part",
        );
      return result.ETag;
    },
    async completeMultipartUpload(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((part) => ({
                PartNumber: part.partNumber,
                ETag: part.etag,
              })),
          },
        }),
      );
    },
    async abortMultipartUpload(key, uploadId) {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    },
    async getObject(key, range) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
      );
      return {
        body: result.Body,
        contentLength: result.ContentLength,
        contentRange: result.ContentRange,
        contentType: result.ContentType,
        etag: result.ETag,
      };
    },
    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
