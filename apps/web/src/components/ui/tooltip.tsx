// Derived from shadcn/ui (MIT); locally modified for InfoSteed.
// SPDX-License-Identifier: MIT AND AGPL-3.0-only
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: TooltipPrimitive.TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
