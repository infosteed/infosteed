// SPDX-License-Identifier: AGPL-3.0-only
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusBadge({ className, ...props }: BadgeProps) {
  return <Badge className={cn("status-token", className)} {...props} />;
}
