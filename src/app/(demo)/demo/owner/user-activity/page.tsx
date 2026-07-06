/**
 * User Activity History — سجل نشاط المستخدمين
 *
 * Route: /demo/owner/user-activity
 *
 * Lets the executive/accountant select a demo user and view everything that
 * user has done in the demo. All data is SYNTHETIC — no real audit log.
 *
 * Access:
 *   - Executive persona: ✅ (visible in sidebar)
 *   - Accountant persona: ✅ (visible in sidebar)
 *   - Data-entry persona: ❌ (sidebar hidden, page not linked from task hub)
 *
 * Demo-only: no real DB, no API mutation, no real audit log.
 */
"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoCompactHeading, DemoFooterNote } from "@/components/demo/demo-charts";
import {
  DEMO_ACTIVITY_USERS,
  DEMO_USER_ACTIVITIES,
  getActivitiesByUser,
  getActivitySummaryByUser,
  type DemoActivityStatus,
} from "@/lib/fixtures/demo-fixtures";

const STATUS_CONFIG: Record<DemoActivityStatus, { labelAr: string; classes: string; dot: string; border: string }> = {
  draft: { labelAr: "مسودة", classes: "bg-warning/10 text-warning", dot: "bg-warning", border: "border-warning/20" },
  submitted: { labelAr: "مرسل للمراجعة", classes: "bg-info/10 text-info", dot: "bg-info", border: "border-info/20" },
  needs_edit: { labelAr: "يحتاج تعديل", classes: "bg-danger/10 text-danger", dot: "bg-danger", border: "border-danger/20" },
  approved: { labelAr: "معتمد", classes: "bg-success/10 text-success", dot: "bg-success", border: "border-success/20" },
};

export default function DemoUserActivityPage() {
  const [selectedUserId, setSelectedUserId] = React.useState<string>(DEMO_ACTIVITY_USERS[0]!.id);

  const selectedUser = DEMO_ACTIVITY_USERS.find((u) => u.id === selectedUserId);
  const activities = getActivitiesByUser(selectedUserId);
  const summary = getActivitySummaryByUser(selectedUserId);

  return (
    <DemoShell
      userName="ERP-Yarn"
      roleLabel="رئيس مجلس الإدارة / العضو المنتدب التنفيذي"
      breadcrumbs={[{ label: "التقارير" }, { label: "سجل نشاط المستخدمين" }]}
    >
      <DemoCompactHeading
        titleAr="سجل نشاط المستخدمين"
        subtitleAr="اختر مستخدماً لعرض جميع عملياته — بيانات تجريبية للعرض"
      />

      {/* User selector */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="user-select" className="text-sm font-medium text-muted-foreground mb-1 block">
                اختر المستخدم
              </label>
              <select
                id="user-select"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {DEMO_ACTIVITY_USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nameAr} — {u.roleLabelAr}
                  </option>
                ))}
              </select>
            </div>
            {selectedUser && (
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{selectedUser.nameAr}</span>
                {" — "}
                {selectedUser.roleLabelAr}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-6 sm:grid-cols-3 lg:grid-cols-5">
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-primary" aria-hidden="true" />
          <CardContent className="relative p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">إجمالي العمليات</p>
            <p className="text-2xl font-bold text-foreground tabular-nums" dir="ltr">
              <LtrValue>{summary.total}</LtrValue>
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-warning" aria-hidden="true" />
          <CardContent className="relative p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">مسودات</p>
            <p className="text-2xl font-bold text-foreground tabular-nums" dir="ltr">
              <LtrValue>{summary.drafts}</LtrValue>
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-info" aria-hidden="true" />
          <CardContent className="relative p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">مرسل للمراجعة</p>
            <p className="text-2xl font-bold text-foreground tabular-nums" dir="ltr">
              <LtrValue>{summary.submitted}</LtrValue>
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-danger" aria-hidden="true" />
          <CardContent className="relative p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">يحتاج تعديل</p>
            <p className="text-2xl font-bold text-foreground tabular-nums" dir="ltr">
              <LtrValue>{summary.needsEdit}</LtrValue>
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-success" aria-hidden="true" />
          <CardContent className="relative p-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">آخر نشاط</p>
            <p className="text-sm font-bold text-foreground tabular-nums" dir="ltr">
              <LtrValue>{summary.lastActivity}</LtrValue>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Activity timeline/table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">
            سجل النشاط — {selectedUser?.nameAr ?? ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activities.length === 0 ? (
            <p className="p-8 text-center text-muted-foreground">
              لا يوجد نشاط مسجل لهذا المستخدم في العرض التفاعلي
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-border bg-primary/5">
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">التاريخ والوقت</th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">نوع العملية</th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">المستند / الرقم المرجعي</th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">القسم</th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">ملاحظة مختصرة</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((act, idx) => {
                    const status = STATUS_CONFIG[act.status]!;
                    return (
                      <tr
                        key={idx}
                        className="border-b border-border transition-colors duration-150 hover:bg-primary/5"
                      >
                        <td className="p-3">
                          <LtrValue className="text-muted-foreground">{act.dateTime}</LtrValue>
                        </td>
                        <td className="p-3 text-foreground">{act.operationTypeAr}</td>
                        <td className="p-3">
                          {act.documentRef === "—" ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <LtrValue className="font-medium text-foreground">{act.documentRef}</LtrValue>
                          )}
                        </td>
                        <td className="p-3 text-muted-foreground">{act.sectionAr}</td>
                        <td className="p-3">
                          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", status.classes, status.border)}>
                            <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} aria-hidden="true" />
                            {status.labelAr}
                          </span>
                        </td>
                        <td className="p-3 text-muted-foreground">{act.noteAr}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
            بيانات تجريبية للعرض — لا تمثل سجل تدقيق حقيقي
          </p>
        </CardContent>
      </Card>

      <DemoFooterNote text="بيانات تجريبية للعرض — لا تمثل سجل تدقيق حقيقي. لا يتم تسجيل أو ترحيل أي بيانات فعلية." />
    </DemoShell>
  );
}
