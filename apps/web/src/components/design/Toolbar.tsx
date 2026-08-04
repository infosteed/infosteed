// SPDX-License-Identifier: AGPL-3.0-only
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Toolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-toolbar", className)} {...props} />;
}
