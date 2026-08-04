// SPDX-License-Identifier: AGPL-3.0-only
import { cn } from "@/lib/utils";

export function initialsFor(name: string | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

export function UserAvatar({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  return (
    <span className={cn("ui-avatar", className)} aria-hidden="true">
      {initialsFor(name)}
    </span>
  );
}
