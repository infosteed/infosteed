// SPDX-License-Identifier: AGPL-3.0-only
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { importLegacy, loadManifest } from "./storageAdmin.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "infosteed-storage-test-"));
  roots.push(root);
  await mkdir(path.join(root, "objects"));
  await writeFile(path.join(root, "objects/000000000000"), "video");
  const entry = {
    key: "../../untrusted/s3-key",
    file: "objects/000000000000",
    size: 5,
    sha256: createHash("sha256").update("video").digest("hex"),
    contentType: "audio/webm",
    metadata: {},
  };
  await writeFile(
    path.join(root, "objects.json"),
    JSON.stringify({ formatVersion: 2, objects: [entry] }),
  );
  return { root, entry };
}
describe("portable storage backup validation", () => {
  it("keeps object keys separate from local paths", async () => {
    const { root } = await fixture();
    expect((await loadManifest(root)).objects[0].key).toBe(
      "../../untrusted/s3-key",
    );
  });
  it("rejects corrupt bytes before restore", async () => {
    const { root } = await fixture();
    await writeFile(path.join(root, "objects/000000000000"), "wrong");
    await expect(loadManifest(root)).rejects.toThrow("checksum");
  });
  it.each(["../outside", "/etc/passwd", "objects/../objects.json"])(
    "rejects unsafe payload filename %s",
    async (file) => {
      const { root, entry } = await fixture();
      await writeFile(
        path.join(root, "objects.json"),
        JSON.stringify({ formatVersion: 2, objects: [{ ...entry, file }] }),
      );
      await expect(loadManifest(root)).rejects.toThrow();
    },
  );
  it("rejects duplicate keys and payloads", async () => {
    const { root, entry } = await fixture();
    await writeFile(
      path.join(root, "objects.json"),
      JSON.stringify({ formatVersion: 2, objects: [entry, entry] }),
    );
    await expect(loadManifest(root)).rejects.toThrow("Duplicate");
  });
  it("rejects symbolic links", async () => {
    const { root } = await fixture();
    await rm(path.join(root, "objects/000000000000"));
    await symlink("../objects.json", path.join(root, "objects/000000000000"));
    await expect(loadManifest(root)).rejects.toThrow("Unsafe");
  });
  it("converts v1 bytes without changing the source, preferring database MIME types", async () => {
    const { root } = await fixture();
    const source = path.join(root, "legacy"),
      target = path.join(root, "converted");
    await mkdir(path.join(source, "objects/recordings"), { recursive: true });
    await writeFile(
      path.join(source, "objects/recordings/microphone.webm"),
      "audio",
    );
    await writeFile(
      path.join(root, "mime.json"),
      JSON.stringify({ "recordings/microphone.webm": "audio/webm" }),
    );
    await importLegacy(source, target, path.join(root, "mime.json"));
    expect((await loadManifest(target)).objects[0].contentType).toBe(
      "audio/webm",
    );
    expect(
      await readFile(
        path.join(source, "objects/recordings/microphone.webm"),
        "utf8",
      ),
    ).toBe("audio");
  });
});
