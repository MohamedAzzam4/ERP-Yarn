import * as React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("space-y-2", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="مسار التنقل" className="text-xs text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            {breadcrumbs.map((b, i) => (
              <li key={i} className="flex items-center gap-1">
                {i > 0 ? <span aria-hidden>/</span> : null}
                {b.href ? (
                  <a href={b.href} className="hover:text-foreground hover:underline">
                    {b.label}
                  </a>
                ) : (
                  <span className="text-foreground">{b.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-bold text-foreground">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground" dir="rtl">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
