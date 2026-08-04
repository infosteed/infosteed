// SPDX-License-Identifier: AGPL-3.0-only
import type { GuideItem } from "@infosteed/shared";
import { t } from "../i18n";

export function guideSourceLabel(source: GuideItem["source"]): string {
  if (source === "deterministic") return t("Generated locally");
  if (source === "ai") return t("AI generated");
  return t("Edited");
}
