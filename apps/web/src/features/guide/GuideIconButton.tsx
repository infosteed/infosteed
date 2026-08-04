// SPDX-License-Identifier: AGPL-3.0-only
import React, { forwardRef } from "react";
import { cn } from "../../lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";

export const GuideIconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
    active?: boolean;
    tone?: "default" | "danger";
    tooltip?: boolean;
  }
>(function GuideIconButton(
  {
    label,
    active = false,
    tone = "default",
    tooltip = true,
    className,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={tooltip ? undefined : label}
      className={cn(
        "guide-icon-button",
        active && "active",
        tone === "danger" && "danger",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );

  if (!tooltip) return button;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});
