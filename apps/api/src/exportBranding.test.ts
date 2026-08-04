// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  productLogoDataUrl,
  resolveDocxExportBranding,
  resolveExportBranding,
} from "./exportBranding.js";

describe("export branding", () => {
  it("uses the InfoSteed product mark when no deployment icon is configured", () => {
    const branding = resolveExportBranding({
      displayName: "InfoSteed",
      iconDataUrl: null,
    });

    expect(branding.iconDataUrl).toBe(productLogoDataUrl);
    expect(branding.iconDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(
      Buffer.from(branding.iconDataUrl!.split(",")[1], "base64").toString(
        "utf8",
      ),
    ).toContain("<svg");
  });

  it("preserves a custom deployment icon and display name", () => {
    const customIcon = "data:image/png;base64,Y3VzdG9t";

    expect(
      resolveExportBranding({
        displayName: "Acme Support",
        iconDataUrl: customIcon,
      }),
    ).toEqual({
      displayName: "Acme Support",
      iconDataUrl: customIcon,
    });
  });

  it("converts the default product mark to PNG for Word exports", async () => {
    const branding = await resolveDocxExportBranding({
      displayName: "InfoSteed",
      iconDataUrl: null,
    });

    expect(branding.docxIcon?.filename).toBe("branding-icon.png");
    expect(branding.docxIcon?.contentType).toBe("image/png");
    expect(branding.docxIcon?.content.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });
});
