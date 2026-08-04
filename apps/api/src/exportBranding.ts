// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { convertImageToPng } from "@infosteed/image-processor";
import type { ExportBranding } from "@infosteed/markdown-exporter";
import type { BrandingSettings } from "@infosteed/shared";

const sharedEntryUrl = pathToFileURL(
  createRequire(import.meta.url).resolve("@infosteed/shared"),
);
const productLogoUrl = new URL(
  "../assets/infosteed-horse-logo.svg",
  sharedEntryUrl,
);
const productLogoSvg = readFileSync(productLogoUrl);

export const productLogoDataUrl = `data:image/svg+xml;base64,${productLogoSvg.toString("base64")}`;

export function resolveExportBranding(
  branding: BrandingSettings,
): BrandingSettings {
  return {
    ...branding,
    iconDataUrl: branding.iconDataUrl || productLogoDataUrl,
  };
}

function imageDataUrlToBuffer(dataUrl: string): Buffer | null {
  const match =
    /^data:image\/(?:png|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl,
    );
  return match ? Buffer.from(match[1], "base64") : null;
}

export async function resolveDocxExportBranding(
  branding: BrandingSettings,
): Promise<ExportBranding> {
  const resolved = resolveExportBranding(branding);
  const icon = imageDataUrlToBuffer(resolved.iconDataUrl!);
  if (!icon) return resolved;

  return {
    ...resolved,
    docxIcon: {
      filename: "branding-icon.png",
      content: await convertImageToPng(icon),
      contentType: "image/png",
    },
  };
}
