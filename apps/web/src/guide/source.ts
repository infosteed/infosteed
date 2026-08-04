// SPDX-License-Identifier: AGPL-3.0-only
import type { GuideItem } from "@infosteed/shared";

export function guideSourceLabel(source: GuideItem["source"]): string {
  if (source === "deterministic") return "Generated locally";
  if (source === "ai") return "AI generated";
  return "Edited";
}
