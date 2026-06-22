import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { BidiValue } from "./BidiValue";

const kpiTone = cva("inline-flex items-center justify-center rounded-full p-1", {
  variants: {
    tone: {
      primary: "bg-primary/10 text-primary",
      accent: "bg-accent/10 text-accent",
      warning: "bg-warning/10 text-warning",
      danger: "bg-danger/10 text-danger",
      success: "bg-success/10 text-success",
      info: "bg-info/10 text-info",
      muted: "bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { tone: "primary" },
});

export interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  tone?: VariantProps<typeof kpiTone>["tone"];
  trend?: { direction: "up" | "down"; text: string };
  /** When true, value is wrapped in <BidiValue> for LTR isolation. */
  isolateValue?: boolean;
  className?: string;
}

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  trend,
  isolateValue = true,
  className,
}: KpiCardProps) {
  return (
    <Card className={cn("h-full", className)}>
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-muted-foreground">{label}</span>
          {icon ? <span className={cn(kpiTone({ tone }))}>{icon}</span> : null}
        </div>
        <div className="font-heading text-2xl font-bold text-foreground">
          {isolateValue ? <BidiValue size="xl">{value}</BidiValue> : value}
        </div>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        {trend ? (
          <div className="flex items-center gap-1 text-xs">
            {trend.direction === "up" ? (
              <TrendingUp className="h-3 w-3 text-success" aria-hidden />
            ) : (
              <TrendingDown className="h-3 w-3 text-danger" aria-hidden />
            )}
            <span className={trend.direction === "up" ? "text-success" : "text-danger"} dir="rtl">
              {trend.text}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export const kpiIcons = {
  alert: AlertTriangle,
  success: CheckCircle2,
  info: Info,
  danger: XCircle,
};
