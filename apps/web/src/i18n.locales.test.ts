// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createI18n, type TranslationCatalog } from "@infosteed/i18n";

const catalogs = ["en", "ga", "fr", "de"].map(
  (locale) =>
    JSON.parse(
      readFileSync(
        new URL(`./locales/${locale}.json`, import.meta.url),
        "utf8",
      ),
    ) as TranslationCatalog,
);

describe("bundled locales", () => {
  it("matches regional browser preferences to a bundled base locale", () => {
    const localized = createI18n({
      catalogs,
      storageKey: "test.locale",
      preferredLocales: ["fr-CA"],
    });
    expect(localized.locale).toBe("fr");
    expect(localized.t("Language")).toBe("Langue");
  });

  it("uses Irish plural categories beyond English one/other", () => {
    const localized = createI18n({
      catalogs,
      storageKey: "test.locale",
      storedLocale: "ga",
    });
    expect(localized.plural("{count} project", "{count} projects", 2)).toBe(
      "2 thionscadal",
    );
    expect(localized.plural("{count} project", "{count} projects", 7)).toBe(
      "7 dtionscadal",
    );
  });
});
