// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifestUrl = new URL("../public/manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  icons: Record<string, string>;
  action: { default_icon: Record<string, string> };
};

function pngDimensions(relativePath: string) {
  const bytes = readFileSync(
    new URL(`../public/${relativePath}`, import.meta.url),
  );
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe("extension product icons", () => {
  it("maps every manifest icon to a correctly sized PNG", () => {
    for (const size of [16, 32, 48, 128]) {
      const path = manifest.icons[String(size)];
      expect(path).toBe(`icons/infosteed-${size}.png`);
      expect(pngDimensions(path)).toEqual({ width: size, height: size });
    }

    expect(manifest.action.default_icon).toEqual({
      "16": "icons/infosteed-16.png",
      "32": "icons/infosteed-32.png",
    });
  });
});
