// SPDX-License-Identifier: AGPL-3.0-only
import {
  applyDocumentLocale,
  createI18n,
  type TranslationCatalog,
} from "@infosteed/i18n";

const localeModules = import.meta.glob("./locales/*.json", {
  eager: true,
  import: "default",
}) as Record<string, TranslationCatalog>;

export const i18n = createI18n({
  catalogs: Object.values(localeModules),
  storageKey: "infosteed.web.locale",
});

applyDocumentLocale(i18n);

export const t = i18n.t;
export const plural = i18n.plural;
