// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MediaWorkspace({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("media-workspace studio-dark", className)}>
      {children}
    </main>
  );
}
