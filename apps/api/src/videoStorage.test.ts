// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "./config.js";
const { send, destroy } = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send = send;
      destroy = destroy;
    },
  };
});
import { createVideoStorage } from "./videoStorage.js";
const config = {
  S3_BUCKET: "provisioned",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: true,
} as ApiConfig;
beforeEach(() => {
  send.mockReset();
  destroy.mockReset();
});
describe("provider-independent application storage", () => {
  it("keeps storage disabled when no bucket is configured", async () => {
    const storage = createVideoStorage({ ...config, S3_BUCKET: undefined });
    expect(storage.enabled).toBe(false);
    expect(await storage.checkHealth()).toBe(true);
    await expect(
      storage.createMultipartUpload("key", "video/webm"),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(send).not.toHaveBeenCalled();
  });
  it("does not create a missing bucket", async () => {
    send.mockRejectedValue(
      Object.assign(new Error("not found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const storage = createVideoStorage(config);
    await expect(
      storage.createMultipartUpload("key", "video/webm"),
    ).rejects.toThrow("provision");
    expect(
      send.mock.calls.map(([command]) => command.constructor.name),
    ).toEqual(["HeadBucketCommand"]);
  });
  it("propagates rejected credentials instead of attempting provisioning", async () => {
    const error = Object.assign(new Error("access denied"), {
      name: "AccessDenied",
    });
    send.mockRejectedValue(error);
    await expect(
      createVideoStorage(config).createMultipartUpload("key", "video/webm"),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
