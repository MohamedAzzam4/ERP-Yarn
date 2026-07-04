/**
 * Demo Activity / Logs / Notifications — stakeholder visual demo.
 *
 * Route: /demo/owner/activity
 *
 * Shows:
 *   - Collapsible activity strips — multiple strips can stay open at once.
 *   - Notification panel mirroring the topbar dropdown, plus a refresh button
 *     (manual alternative to real-time — no actual data fetch).
 *   - "Last refreshed" indicator that updates on click.
 *
 * All data is synthetic (DEMO_ACTIVITY_STRIPS, DEMO_NOTIFICATIONS).
 * No Supabase. No real-time backend. No real transaction logic.
 */
"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoPageHeader, DemoFooterNote } from "@/components/demo/demo-charts";
import {
  DEMO_ACTIVITY_STRIPS,
  DEMO_NOTIFICATIONS,
  type DemoActivityStrip,
  type DemoNotification,
} from "@/lib/fixtures/demo-fixtures";

const SEVERITY_STYLE: Record<DemoActivityStrip["severity"], { dot: string; chip: string; labelAr: string }> = {
  info: { dot: "bg-info", chip: "bg-info/10 text-info border-info/20", labelAr: "معلومة" },
  warning: { dot: "bg-warning", chip: "bg-warning/10 text-warning border-warning/20", labelAr: "تحذير" },
  danger: { dot: "bg-danger", chip: "bg-danger/10 text-danger border-danger/20", labelAr: "حرج" },
  success: { dot: "bg-success", chip: "bg-success/10 text-success border-success/20", labelAr: "تم" },
};

const NOTIF_SEVERITY: Record<DemoNotification["severity"], string> = {
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-danger",
  success: "bg-success",
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("transition-transform duration-200", open ? "rotate-0" : "-rotate-90")}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(spinning ? "animate-spin" : "")}
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export default function DemoActivityPage() {
  // Default the first 2 strips open so the visitor immediately sees the pattern.
  const [openIds, setOpenIds] = React.useState<Set<string>>(() => new Set([DEMO_ACTIVITY_STRIPS[0]!.id, DEMO_ACTIVITY_STRIPS[1]!.id]));

  const [refreshing, setRefreshing] = React.useState(false);
  const [lastRefreshed, setLastRefreshed] = React.useState<string>("20/06/2026 10:24");
  const [done, setDone] = React.useState(false);

  const onRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    setDone(false);
    window.setTimeout(() => {
      setRefreshing(false);
      setDone(true);
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, "0");
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const yyyy = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      setLastRefreshed(`${dd}/${mm}/${yyyy} ${hh}:${mi}`);
      window.setTimeout(() => setDone(false), 1800);
    }, 700);
  };

  const expandAll = () => setOpenIds(new Set(DEMO_ACTIVITY_STRIPS.map((s) => s.id)));
  const collapseAll = () => setOpenIds(new Set());

  return (
    <DemoShell
      userName="رئيس مجلس الإدارة / العضو المنتدب التنفيذي"
      breadcrumbs={[{ label: "التقارير" }, { label: "النشاطات والإشعارات" }]}
    >
      <DemoPageHeader
        titleAr="النشاطات والإشعارات"
        subtitleAr="شرائط نشاط قابلة للطي (يمكن فتح أكثر من شريط معاً)، لوحة إشعارات، وزر تحديث يدوي"
      />

      {/* Refresh bar */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">آخر تحديث:</span>
            <LtrValue className="font-medium text-foreground">{lastRefreshed}</LtrValue>
            {done && (
              <span className="rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success" role="status">
                تم التحديث
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              className="min-h-[44px]"
              aria-label="تحديث النشاطات يدوياً"
            >
              <RefreshIcon spinning={refreshing} />
              <span className="mr-2">{refreshing ? "جاري التحديث..." : "تحديث يدوي"}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={expandAll} className="min-h-[44px]">
              فتح الكل
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={collapseAll} className="min-h-[44px]">
              طي الكل
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Activity strips */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-foreground">آخر النشاطات</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {DEMO_ACTIVITY_STRIPS.map((strip) => (
                  <ActivityStripWrapper
                    key={strip.id}
                    strip={strip}
                    open={openIds.has(strip.id)}
                    onToggle={() =>
                      setOpenIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(strip.id)) next.delete(strip.id);
                        else next.add(strip.id);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                ملاحظة: يمكن إبقاء أكثر من شريط مفتوحاً في نفس الوقت. زر «تحديث يدوي»
                بديل لتحديث البيانات في الوقت الفعلي غير المتاح في هذا العرض التفاعلي.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Notifications panel */}
        <div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-heading-4 text-foreground">الإشعارات</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {DEMO_NOTIFICATIONS.map((n) => (
                  <li
                    key={n.id}
                    className={cn(
                      "rounded-lg border border-border p-3",
                      n.read ? "bg-surface" : "bg-primary/5 border-primary/20",
                    )}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className={cn("inline-block h-2 w-2 rounded-full", NOTIF_SEVERITY[n.severity])} aria-hidden="true" />
                      <span className="text-sm font-medium text-foreground">{n.titleAr}</span>
                      {!n.read && (
                        <span className="mr-auto rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          جديد
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{n.bodyAr}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground" dir="ltr">
                      <LtrValue>{n.date}</LtrValue>
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <DemoFooterNote />
    </DemoShell>
  );
}

// Wrapper that lets the parent manage open state for each strip while still
// using the same internal layout as ActivityStrip.
function ActivityStripWrapper({
  strip,
  open,
  onToggle,
}: {
  strip: DemoActivityStrip;
  open: boolean;
  onToggle: () => void;
}) {
  const sev = SEVERITY_STYLE[strip.severity]!;
  return (
    <div className="rounded-lg border border-border overflow-hidden transition-colors duration-200 hover:border-primary/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`activity-${strip.id}`}
        className="flex w-full items-center gap-3 bg-surface px-3 py-3 text-right transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", sev.dot)} aria-hidden="true" />
        <span className="text-xs font-medium text-muted-foreground">{strip.categoryAr}</span>
        <LtrValue className="font-medium text-foreground">{strip.document}</LtrValue>
        <span className="hidden sm:block text-sm text-muted-foreground truncate flex-1">{strip.summaryAr}</span>
        <span className="mr-auto flex items-center gap-2 text-xs text-muted-foreground" dir="ltr">
          <LtrValue>{strip.date}</LtrValue>
          <span aria-hidden="true">·</span>
          <LtrValue>{strip.timeAr}</LtrValue>
        </span>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium", sev.chip)}>
          {sev.labelAr}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div id={`activity-${strip.id}`} className="border-t border-border bg-muted/40 px-4 py-3">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">المستند</dt>
              <dd><LtrValue className="font-medium text-foreground">{strip.document}</LtrValue></dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">الفاعل</dt>
              <dd className="text-foreground">{strip.actorAr}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">التاريخ والوقت</dt>
              <dd className="text-foreground" dir="ltr">
                <LtrValue>{strip.date}</LtrValue>
                {" · "}
                <LtrValue>{strip.timeAr}</LtrValue>
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">التفاصيل</dt>
              <dd className="text-foreground leading-relaxed">{strip.summaryAr}</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted-foreground">ملاحظة</dt>
              <dd className="text-xs text-muted-foreground">
                عرض تفاعلي — لا يوجد سجل تدقيق فعلي. في النسخة التشغيلية، يتم تسجيل هذه
                الأحداث في سجل التدقيق غير القابل للتعديل مع التواقيع الرقمية.
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
