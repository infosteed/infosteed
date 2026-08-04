// SPDX-License-Identifier: AGPL-3.0-only
import { plural, t } from "../../i18n";

export type LibraryScope = "all" | "owned" | "shared" | "trash";
export type LibrarySort = "recent" | "title";
export type LibraryView = "grid" | "list";

export function recordingAge(value: string, now = Date.now()): string {
  const diffMs = now - new Date(value).getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (days === 0) return t("today");
  if (days === 1) return t("1 day ago");
  if (days < 31) return plural("{count} day ago", "{count} days ago", days);
  const months = Math.floor(days / 30);
  return plural("{count} month ago", "{count} months ago", months);
}

export function recordingDaysUntil(
  value: string | null | undefined,
  now = Date.now(),
): string {
  if (!value) return "";
  const days = Math.ceil((new Date(value).getTime() - now) / 86_400_000);
  if (days <= 0) return t("expires today");
  return plural("{count} day left", "{count} days left", days);
}
