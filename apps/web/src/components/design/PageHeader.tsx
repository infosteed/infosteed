// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("ui-page-header", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="ui-subtitle">{description}</p>}
      </div>
      {actions && <div className="ui-toolbar">{actions}</div>}
    </header>
  );
}
