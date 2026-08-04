// SPDX-License-Identifier: AGPL-3.0-only
import {
  Group,
  Separator,
  Panel,
  type GroupProps,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return <Group className={cn("flex h-full w-full", className)} {...props} />;
}

export function ResizablePanel(props: PanelProps) {
  return <Panel {...props} />;
}

export function ResizableHandle({ className, ...props }: SeparatorProps) {
  return (
    <Separator
      className={cn(
        "relative flex w-2 items-center justify-center bg-transparent after:absolute after:inset-y-3 after:w-px after:bg-border hover:after:bg-primary",
        className,
      )}
      {...props}
    >
      <GripVertical className="z-10 size-3 rounded-sm bg-background text-muted-foreground" />
    </Separator>
  );
}
