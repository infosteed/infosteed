// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        secondary: "border-border bg-secondary text-secondary-foreground",
        success:
          "border-[var(--success-border)] bg-[var(--success-surface)] text-[var(--success-foreground)]",
        warning:
          "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-foreground)]",
        danger:
          "border-[var(--danger-border)] bg-[var(--danger-surface)] text-[var(--danger-foreground)]",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}
