// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  downloadRemoteImage,
  RemoteImageDownloadError,
  resolvePublicAddresses,
} from "./remoteImageDownloader";

describe("remote image downloader security", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ])("rejects non-public address %s", async (address) => {
    await expect(resolvePublicAddresses(address)).rejects.toBeInstanceOf(
      RemoteImageDownloadError,
    );
  });

  it("accepts public literal addresses", async () => {
    await expect(resolvePublicAddresses("8.8.8.8")).resolves.toEqual([
      { address: "8.8.8.8", family: 4 },
    ]);
  });

  it.each([
    "http://example.com/image.png",
    "https://user:secret@example.com/image.png",
    "not a URL",
  ])("rejects unsafe URL %s before requesting it", async (url) => {
    await expect(
      downloadRemoteImage(url, { maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(RemoteImageDownloadError);
  });
});
