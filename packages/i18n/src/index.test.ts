// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createI18n } from "./index";

const catalogs = [
  { locale: "en", name: "English", messages: {} },
  {
    locale: "es",
    name: "Español",
    messages: {
      "Hello {name}": "Hola {name}",
      "{count} recording.other": "{count} grabaciones",
    },
  },
] as const;

describe("i18n", () => {
  it("matches a regional browser locale and interpolates values", () => {
    const i18n = createI18n({
      catalogs,
      storageKey: "test-locale",
      preferredLocales: ["es-MX"],
      storedLocale: null,
    });
    expect(i18n.locale).toBe("es");
    expect(i18n.t("Hello {name}", { name: "Ada" })).toBe("Hola Ada");
  });

  it("falls back to the English source and supports plural forms", () => {
    const i18n = createI18n({
      catalogs,
      storageKey: "test-locale",
      preferredLocales: ["es"],
      storedLocale: null,
    });
    expect(i18n.t("Untranslated")).toBe("Untranslated");
    expect(i18n.plural("{count} recording", "{count} recordings", 2)).toBe(
      "2 grabaciones",
    );
  });

  it("gives a stored choice priority over browser preferences", () => {
    const i18n = createI18n({
      catalogs,
      storageKey: "test-locale",
      preferredLocales: ["es"],
      storedLocale: "en-GB",
    });
    expect(i18n.locale).toBe("en");
  });
});
