// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { buildApp, registeredRoutes } from "./app";
import { readConfig } from "./config";
import type { Pool } from "./db";
import type { VideoStorage } from "./videoStorage";

const unused = async (): Promise<never> => {
  throw new Error("This dependency is not used while registering routes");
};

const disabledStorage: VideoStorage = {
  enabled: false,
  close() {},
  checkHealth: async () => true,
  createMultipartUpload: unused,
  uploadPart: unused,
  completeMultipartUpload: unused,
  abortMultipartUpload: unused,
  getObject: unused,
  deleteObject: unused,
};

describe("API route contract", () => {
  it("preserves every registered method and path", () => {
    const app = buildApp(
      readConfig({ NODE_ENV: "test", VIDEO_RENDER_ENABLED: "false" }),
      {} as Pool,
      disabledStorage,
    );

    expect(registeredRoutes(app)).toMatchSnapshot();
  });
});
