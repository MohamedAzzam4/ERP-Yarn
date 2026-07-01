/**
 * Demo Production with External Factories — stakeholder visual demo.
 *
 * Route: /demo/owner/production
 *
 * IMPORTANT wording per business model:
 *   - The yarn company does NOT manufacture internally. It outsources ginning,
 *     spinning, twisting to external factories.
 *   - Use "الإنتاج لدى مصانع التشغيل" / " outsourced manufacturing" wording.
 *   - NEVER use "تصنيع داخلي" / "manufacturing internally" / "machine
 *     utilization" / "worker productivity" / "production line efficiency"
 *     KPIs (DEC-077 / Contract 02 §Dashboards).
 *
 * Shows:
 *   - Production orders at external factories (PO-2026-*)
 *   - WIP at factory (raw issued → WIP → finished received)
 *   - Inputs (raw issued) vs outputs (finished received) + yield
 *   - Factory stock balances (raw / WIP / finished at each factory)
 *
 * All data is synthetic. No Supabase. No real transaction logic.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import { DemoShell } from "@/components/demo/demo-shell";
import {
  DemoPageHeader,
  DemoFooterNote,
} from "@/components/demo/demo-charts";
import {
  DEMO_PRODUCTION_ORDERS,
  DEMO_FACTORY_STOCK_BALANCES,
} from "@/lib/fixtures/demo-fixtures";

function parseNumeric(value: string): number {
  const m = value.match(/-?[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

const STAGE_LABEL: Record<string, string> = {
  "غزل": "غزل",
  "برم": "برم",
  "حلج": "حلج",
};

const STATE_CHIP: Record<string, string> = {
  "جاري التشغيل": "bg-info/10 text-info border-info/20",
  "مكتمل": "bg-success/10 text-success border-success/20",
  "يحتاج مراجعة": "bg-warning/10 text-warning border-warning/20",
};

export default function DemoProductionPage() {
  const totalRawIssued = DEMO_PRODUCTION_ORDERS.reduce((s, o) => s + parseNumeric(o.rawIssuedKg), 0);
  const totalWip = DEMO_PRODUCTION_ORDERS.reduce((s, o) => s + parseNumeric(o.wipKg), 0);
  const totalFinished = DEMO_PRODUCTION_ORDERS.reduce((s, o) => s + parseNumeric(o.finishedReceivedKg), 0);
  const totalFactoryStock = DEMO_FACTORY_STOCK_BALANCES.reduce((s, f) => s + parseNumeric(f.totalKg), 0);
  const totalPayable = DEMO_FACTORY_STOCK_BALANCES.reduce((s, f) => s + parseNumeric(f.payableEgp), 0);

  return (
    <DemoShell
      userName="مالك النظام"
      breadcrumbs={[{ label: "العمليات" }, { label: "الإنتاج لدى مصانع التشغيل" }]}
    >
      <DemoPageHeader
        titleAr="الإنتاج لدى مصانع التشغيل"
        subtitleAr="أوامر الإنتاج الخارجية، المخزون تحت التشغيل لدى المصانع، المدخلات والمخرجات، أرصدة المصانع"
      />

      {/* KPI strip — outsourced manufacturing only, no internal-factory KPIs */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-accent" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">أوامر الإنتاج النشطة</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{DEMO_PRODUCTION_ORDERS.filter((o) => o.stateAr === "جاري التشغيل").length}</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">تشغيل</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-primary" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">إجمالي الخام المُصرف</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalRawIssued.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} كجم</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">مدخلات</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-warning" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">المخزون تحت التشغيل لدى المصانع</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalWip.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} كجم</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">WIP</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-success" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">إجمالي المُستلم (إنتاج جاهز)</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalFinished.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} كجم</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">مخرجات</span>
          </CardContent>
        </Card>
      </div>

      {/* Production orders table */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">أوامر الإنتاج لدى مصانع التشغيل</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-primary/5">
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الأمر</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">المصنع</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الخام</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">المرحلة</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">خام مُصرف (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">تحت التشغيل (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">جاهز مُستلم (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">نسبة الاستخلاص</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">تاريخ البدء</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">تاريخ التسليم المتوقع</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_PRODUCTION_ORDERS.map((o) => (
                  <tr key={o.order} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                    <td className="p-3"><LtrValue className="font-medium text-foreground">{o.order}</LtrValue></td>
                    <td className="p-3 text-foreground">{o.factoryNameAr}</td>
                    <td className="p-3 text-muted-foreground">{o.rawMaterialAr}</td>
                    <td className="p-3"><span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{STAGE_LABEL[o.stageAr] ?? o.stageAr}</span></td>
                    <td className="p-3"><LtrValue className="text-foreground">{o.rawIssuedKg}</LtrValue></td>
                    <td className="p-3">
                      <LtrValue className={cn(parseNumeric(o.wipKg) < 0 ? "font-bold text-danger" : "text-foreground")}>{o.wipKg}</LtrValue>
                    </td>
                    <td className="p-3"><LtrValue className="text-foreground">{o.finishedReceivedKg}</LtrValue></td>
                    <td className="p-3"><LtrValue className="font-bold text-primary">{o.yieldPct}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-muted-foreground">{o.startDate}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-muted-foreground">{o.expectedFinishDate}</LtrValue></td>
                    <td className="p-3">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", STATE_CHIP[o.stateAr] ?? "bg-muted text-foreground border-border")}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                        {o.stateAr}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
            كل الأوامر مُنفذة لدى مصانع تشغيل خارجية. النسبة تحت التشغيل بالسالب في بعض
            الأوامر تشير إلى حالة تحتاج تحقق — راجع مركز المراجعات.
          </p>
        </CardContent>
      </Card>

      {/* Factory stock balances — glass accent (DEC-076 management surface) */}
      <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">أرصدة مصانع التشغيل</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-primary/5">
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الكود</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">المصنع</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">خام (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">تحت التشغيل (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">جاهز (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الإجمالي (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">مستحقات (جنيه)</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_FACTORY_STOCK_BALANCES.map((f) => (
                  <tr key={f.factoryCode} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                    <td className="p-3"><LtrValue className="text-muted-foreground">{f.factoryCode}</LtrValue></td>
                    <td className="p-3 text-foreground">{f.factoryNameAr}</td>
                    <td className="p-3"><LtrValue className="text-foreground">{f.rawKg}</LtrValue></td>
                    <td className="p-3">
                      <LtrValue className={cn(parseNumeric(f.wipKg) < 0 ? "font-bold text-danger" : "text-foreground")}>{f.wipKg}</LtrValue>
                    </td>
                    <td className="p-3"><LtrValue className="text-foreground">{f.finishedKg}</LtrValue></td>
                    <td className="p-3"><LtrValue className="font-bold text-foreground">{f.totalKg}</LtrValue></td>
                    <td className="p-3"><LtrValue className="font-bold text-warning">{f.payableEgp}</LtrValue></td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/40 font-bold">
                  <td className="p-3" colSpan={2}>الإجمالي</td>
                  <td className="p-3" colSpan={3} />
                  <td className="p-3"><LtrValue className="text-foreground">{totalFactoryStock.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</LtrValue></td>
                  <td className="p-3"><LtrValue className="text-warning">{totalPayable.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</LtrValue></td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <DemoFooterNote />
    </DemoShell>
  );
}
