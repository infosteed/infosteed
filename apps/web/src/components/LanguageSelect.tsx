// SPDX-License-Identifier: AGPL-3.0-only
import React from "react";
import { applyDocumentLocale } from "@infosteed/i18n";
import { Languages } from "lucide-react";
import { i18n, t } from "../i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function LanguageSelect({
  compact = false,
  iconOnly = false,
}: {
  compact?: boolean;
  iconOnly?: boolean;
}) {
  function changeLocale(locale: string) {
    i18n.setLocale(locale);
    applyDocumentLocale(i18n);
    window.location.reload();
  }

  return (
    <div
      className={`language-select${compact ? " compact" : ""}${iconOnly ? " icon-only" : ""}`}
      title={iconOnly ? t("Language") : undefined}
    >
      <span>{t("Language")}</span>
      <Select value={i18n.locale} onValueChange={changeLocale}>
        <SelectTrigger
          aria-label={t("Language")}
          className="language-select-trigger"
        >
          <Languages aria-hidden="true" />
          <SelectValue className={iconOnly ? "sr-only" : undefined} />
        </SelectTrigger>
        <SelectContent align="end" className="language-select-content">
          {i18n.catalogs.map((catalog) => (
            <SelectItem key={catalog.locale} value={catalog.locale}>
              {catalog.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
