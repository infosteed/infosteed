// SPDX-License-Identifier: AGPL-3.0-only
import React from "react";
import { applyDocumentLocale } from "@infosteed/i18n";
import { i18n, t } from "../i18n";

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  function changeLocale(locale: string) {
    i18n.setLocale(locale);
    applyDocumentLocale(i18n);
    window.location.reload();
  }

  return (
    <label className={compact ? "language-select compact" : "language-select"}>
      <span>{t("Language")}</span>
      <select
        aria-label={t("Language")}
        value={i18n.locale}
        onChange={(event) => changeLocale(event.target.value)}
      >
        {i18n.catalogs.map((catalog) => (
          <option key={catalog.locale} value={catalog.locale}>
            {catalog.name}
          </option>
        ))}
      </select>
    </label>
  );
}
