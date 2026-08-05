// SPDX-License-Identifier: AGPL-3.0-only
export const extensionBrowserTarget =
  import.meta.env.VITE_INFOSTEED_EXTENSION_TARGET === "firefox"
    ? "firefox"
    : "chrome";
export const firefoxGuideOnly = extensionBrowserTarget === "firefox";
