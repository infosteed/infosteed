// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifestUrl = new URL("../public/manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
  background: Record<string, unknown>;
  icons: Record<string, string>;
  action: { default_icon: Record<string, string> };
  permissions: string[];
};
const firefoxManifestUrl = new URL(
  "../manifests/firefox.json",
  import.meta.url,
);
const firefoxManifest = JSON.parse(
  readFileSync(firefoxManifestUrl, "utf8"),
) as {
  background: Record<string, unknown>;
  browser_specific_settings: {
    gecko: { id: string; strict_min_version: string };
  };
  icons: Record<string, string>;
  action: { default_icon: Record<string, string> };
  permissions: string[];
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

describe("browser-specific manifests", () => {
  it("keeps the Chrome manifest on the MV3 service-worker video path", () => {
    expect(manifest.background).toEqual({
      service_worker: "background.js",
      type: "module",
    });
    expect(manifest.permissions).toContain("tabCapture");
    expect(manifest.permissions).toContain("offscreen");
  });

  it("uses a Firefox event-page manifest without Chrome-only video APIs", () => {
    expect(firefoxManifest.background).toEqual({
      scripts: ["background.js"],
      type: "module",
    });
    expect(firefoxManifest.browser_specific_settings.gecko.id).toBe(
      "infosteed@infosteed.org",
    );
    expect(firefoxManifest.permissions).not.toContain("tabCapture");
    expect(firefoxManifest.permissions).not.toContain("offscreen");
  });
});

describe("extension manifest locales", () => {
  it("bundles every supported manifest translation", () => {
    for (const locale of ["en", "ga", "fr", "de"]) {
      const messages = JSON.parse(
        readFileSync(
          new URL(
            `../public/_locales/${locale}/messages.json`,
            import.meta.url,
          ),
          "utf8",
        ),
      ) as Record<string, { message: string }>;
      expect(Object.keys(messages).sort()).toEqual([
        "extensionActionTitle",
        "extensionDescription",
        "extensionName",
      ]);
      expect(
        Object.values(messages).every(({ message }) => message.length > 0),
      ).toBe(true);
    }
  });
});
