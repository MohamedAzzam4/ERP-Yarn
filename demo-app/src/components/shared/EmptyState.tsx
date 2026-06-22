import * as React from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <div className="space-y-1">
        <p className="font-heading text-base font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground" dir="rtl">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "جاري التحميل..." }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 rounded-lg border border-border bg-surface px-6 py-12 text-sm text-muted-foreground"
    >
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-accent"
        aria-hidden
      />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  title = "تعذّر تحميل البيانات",
  description = "حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-6 py-12 text-center"
    >
      <p className="font-heading text-base font-semibold text-danger">{title}</p>
      <p className="text-sm text-muted-foreground" dir="rtl">
        {description}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-danger-foreground hover:bg-danger/90"
        >
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  );
}
