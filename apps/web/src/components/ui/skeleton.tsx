// Derived from shadcn/ui (MIT); locally modified for InfoSteed.
// SPDX-License-Identifier: MIT AND AGPL-3.0-only
import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
