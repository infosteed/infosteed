// SPDX-License-Identifier: AGPL-3.0-only
import * as React from "react";
import { cn } from "@/lib/utils";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Sidebar({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <aside
      className={cn(
        "flex h-full w-64 shrink-0 flex-col border-r border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}

export function SidebarHeader(props: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-3", props.className)} {...props} />;
}

export function SidebarContent(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("min-h-0 flex-1 p-2", props.className)} {...props} />
  );
}

export function SidebarFooter(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("border-t border-border p-3", props.className)}
      {...props}
    />
  );
}
