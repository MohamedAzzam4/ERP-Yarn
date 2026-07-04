/**
 * Demo Inventory Overview — stakeholder visual demo.
 *
 * Route: /demo/owner/inventory
 *
 * Revised 2026-07-05:
 *   - Inventory composition now clearly shows 3 layers: خامات / شعيرات / خيوط
 *     (in addition to under-processing at factories)
 *   - Added "أرصدة الخيوط بالمخازن" section with full yarn stock table inspired
 *     by the stakeholder Excel (تاريخ التخزين، شركة، رقم الأمر، نمرة، ...،
 *     نتائج المراجعة الفنية RKM/Elongn/U%/Tin/Tick/Neps/Hairs)
 *   - Added yarn distribution by company bar chart
 *   - Updated userName: "مالك النظام" → "رئيس مجلس الإدارة / العضو المنتدب التنفيذي"
 *
 * All data is synthetic (DEMO_LOCATIONS, DEMO_INVENTORY_MOVEMENTS,
 * DEMO_YARN_STOCK, DEMO_YARN_BY_COMPANY). No Supabase. No real transaction logic.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import { DemoShell } from "@/components/demo/demo-shell";
import {
  DemoDonutChart,
  DemoLocationBars,
  DemoPageHeader,
  DemoFooterNote,
} from "@/components/demo/demo-charts";
import {
  DEMO_LOCATIONS,
  DEMO_INVENTORY_MOVEMENTS,
  DEMO_YARN_STOCK,
  DEMO_YARN_BY_COMPANY,
  DEMO_YARN_KPIS,
} from "@/lib/fixtures/demo-fixtures";

function parseNumeric(value: string): number {
  const m = value.match(/-?[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

const DIRECTION_ICON: Record<"in" | "out" | "transfer", { glyph: string; classes: string; labelAr: string }> = {
  in: { glyph: "↓", classes: "bg-success/10 text-success", labelAr: "وارد" },
  out: { glyph: "↑", classes: "bg-danger/10 text-danger", labelAr: "منصرف" },
  transfer: { glyph: "→", classes: "bg-info/10 text-info", labelAr: "نقل" },
};

export default function DemoInventoryOverviewPage() {
  const totalStockKg = DEMO_LOCATIONS.reduce((s, l) => s + parseNumeric(l.totalStockKg), 0);
  const totalRawKg = DEMO_LOCATIONS.reduce((s, l) => s + parseNumeric(l.rawKg), 0);
  const totalWipKg = DEMO_LOCATIONS.reduce((s, l) => s + parseNumeric(l.wipKg), 0);
  const totalFinishedKg = DEMO_LOCATIONS.reduce((s, l) => s + parseNumeric(l.finishedKg), 0);

  const locationBars = DEMO_LOCATIONS.map((l) => ({ label: l.nameAr, value: l.totalStockKg + " كجم" }));

  // Three-layer inventory composition: خامات / شعيرات / خيوط + لدى مصانع التشغيل
  // (revised 2026-07-05 — was خام/تحت التشغيل/خيط جاهز, now explicitly includes
  // شعيرات as a distinct layer per stakeholder request)
  const compositionSegments = [
    { value: totalRawKg, color: "var(--color-primary)", label: "خامات" },
    { value: 4800, color: "var(--color-warning)", label: "شعيرات" },
    { value: parseNumeric(DEMO_YARN_KPIS.totalCurrentBalanceKg), color: "var(--color-success)", label: "خيوط" },
    { value: totalWipKg, color: "var(--color-accent)", label: "لدى مصانع التشغيل" },
  ];

  const yarnByCompanyBars = DEMO_YARN_BY_COMPANY.map((c) => ({
    label: c.companyAr,
    value: c.currentBalanceKg + " كجم",
  }));

  const lowStock = DEMO_LOCATIONS.filter((l) => l.status === "low_stock");
  const negativeStock = DEMO_LOCATIONS.filter((l) => l.status === "negative_stock");

  return (
    <DemoShell
      userName="رئيس مجلس الإدارة / العضو المنتدب التنفيذي"
      breadcrumbs={[{ label: "العمليات" }, { label: "نظرة عامة على المخزون" }]}
    >
      <DemoPageHeader
        titleAr="نظرة عامة على المخزون"
        subtitleAr="إجمالي المخزون (خامات / شعيرات / خيوط)، أرصدة الخيوط بالمخازن، التوزيع حسب الموقع، وآخر الحركات"
      />

      {/* Total stock KPI cards — 4 layers */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-primary" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">إجمالي المخزون</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalStockKg.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} كجم</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">إجمالي</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-primary" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">الخامات</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{totalRawKg.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} كجم</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">خامات</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-warning" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">الشعيرات</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>4,800.000 كجم</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">شعيرات</span>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-success" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">الخيوط (الرصيد الحالي)</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{DEMO_YARN_KPIS.totalCurrentBalanceKg} كجم</LtrValue>
            </p>
            <span className="mt-2 inline-block rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">خيوط</span>
          </CardContent>
        </Card>
      </div>

      {/* Alerts — low/negative stock */}
      {(lowStock.length > 0 || negativeStock.length > 0) && (
        <Card className="mb-6 border-danger/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-danger flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
              تنبيهات المخزون
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {negativeStock.map((loc) => (
                <div key={loc.code} className="rounded-lg border border-danger/30 bg-danger/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-danger">مخزون سالب</span>
                    <span className="rounded-md bg-danger/10 px-1.5 py-0.5 text-[10px] font-medium text-danger">حرج</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">
                    {loc.nameAr} · <LtrValue className="text-muted-foreground">{loc.code}</LtrValue>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    إجمالي الرصيد: <LtrValue className="font-bold text-danger">{loc.totalStockKg} كجم</LtrValue>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    تحت التشغيل: <LtrValue className="font-bold text-danger">{loc.wipKg} كجم</LtrValue> — تحقق من حركات الإصدار والاستلام.
                  </p>
                </div>
              ))}
              {lowStock.map((loc) => (
                <div key={loc.code} className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-warning">مخزون منخفض</span>
                    <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning">تحذير</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">
                    {loc.nameAr} · <LtrValue className="text-muted-foreground">{loc.code}</LtrValue>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    إجمالي الرصيد: <LtrValue className="font-bold text-foreground">{loc.totalStockKg} كجم</LtrValue>
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts: location + composition + yarn by company */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">المخزون حسب الموقع</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoLocationBars data={locationBars} />
          </CardContent>
        </Card>
        <Card className="border-primary/15 bg-surface/80 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">التقسيم حسب الحالة</CardTitle>
          </CardHeader>
          <CardContent>
            <DemoDonutChart segments={compositionSegments} totalLabelAr="كجم" />
          </CardContent>
        </Card>
      </div>

      {/* أرصدة الخيوط بالمخازن — main yarn stock section (NEW 2026-07-05) */}
      <Card className="mb-6 border-primary/20">
        <CardHeader className="pb-3 border-b border-border bg-gradient-to-l from-primary/8 to-transparent">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-heading-4 text-foreground flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-success" aria-hidden="true" />
              أرصدة الخيوط بالمخازن
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-success/10 px-2 py-0.5 font-medium text-success">
                الرصيد الحالي: <LtrValue>{DEMO_YARN_KPIS.totalCurrentBalanceKg} كجم</LtrValue>
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                إجمالي المنتج: <LtrValue>{DEMO_YARN_KPIS.totalProducedKg} كجم</LtrValue>
              </span>
              <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
                الشكاير: <LtrValue>{DEMO_YARN_KPIS.totalBales}</LtrValue>
              </span>
              <span className="rounded-md bg-warning/10 px-2 py-0.5 font-medium text-warning">
                تحتاج مراجعة فنية: <LtrValue>{DEMO_YARN_KPIS.itemsNeedingTechnicalReview}</LtrValue>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-primary/5">
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">تاريخ التخزين</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الشركة</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">رقم الأمر</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">نمرة</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">م. برم الفرد</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">م. برم الزوى</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">مكان التخزين</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">كونز</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">إجمالي المنتج (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الرصيد الحالي (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">عدد شيكارة</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">RKM</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Elongn</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">U%</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tin</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tick</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Neps</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hairs</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_YARN_STOCK.map((row, idx) => (
                  <tr key={idx} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                    <td className="p-3"><LtrValue className="text-muted-foreground">{row.storageDate}</LtrValue></td>
                    <td className="p-3 text-foreground">{row.companyAr}</td>
                    <td className="p-3"><LtrValue className="font-medium text-foreground">{row.orderNumber}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.yarnCount}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.twistSingle}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.twistDouble}</LtrValue></td>
                    <td className="p-3 text-muted-foreground">{row.storageLocationAr}</td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.cones}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.totalProducedKg}</LtrValue></td>
                    <td className="p-3"><LtrValue className="font-bold text-foreground">{row.currentBalanceKg}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.balesCount}</LtrValue></td>
                    <td className="p-3"><LtrValue className={cn(row.needsTechnicalReview ? "text-warning" : "text-foreground")}>{row.rkm}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.elongation}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.uPercent}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.thin}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.thick}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.neps}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-foreground">{row.hairiness}</LtrValue></td>
                    <td className="p-3">
                      {row.needsTechnicalReview ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
                          تحتاج مراجعة فنية
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                          سليمة
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
            بيانات تجريبية مستوحاة من جدول «أرصدة الخيوط بالمخازن» — لا تمثل بيانات عميل فعلية.
            القيم المسجلة في RKM و Elongn و U% و Tin و Tick و Neps و Hairs هي نتائج
            مراجعة فنية للخيط وتؤثر على سعر البيع.
          </p>
        </CardContent>
      </Card>

      {/* Yarn distribution by company */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">توزيع الخيوط حسب الشركة</CardTitle>
        </CardHeader>
        <CardContent>
          <DemoLocationBars data={yarnByCompanyBars} />
        </CardContent>
      </Card>

      {/* Detailed location table */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">تفاصيل المواقع</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" role="table">
              <thead>
                <tr className="border-b border-border bg-primary/5">
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الكود</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الموقع</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">النوع</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">خامات (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">تحت التشغيل (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">جاهز (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الإجمالي (كجم)</th>
                  <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {DEMO_LOCATIONS.map((loc) => (
                  <tr key={loc.code} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                    <td className="p-3"><LtrValue className="text-muted-foreground">{loc.code}</LtrValue></td>
                    <td className="p-3 text-foreground">{loc.nameAr}</td>
                    <td className="p-3 text-muted-foreground">
                      {loc.type === "warehouse" ? "مخزن" : loc.type === "external_factory" ? "مصنع تشغيل" : "منطقة تخزين"}
                    </td>
                    <td className="p-3"><LtrValue className="text-foreground">{loc.rawKg}</LtrValue></td>
                    <td className="p-3">
                      <LtrValue className={cn(parseNumeric(loc.wipKg) < 0 ? "font-bold text-danger" : "text-foreground")}>{loc.wipKg}</LtrValue>
                    </td>
                    <td className="p-3"><LtrValue className="text-foreground">{loc.finishedKg}</LtrValue></td>
                    <td className="p-3"><LtrValue className="font-bold text-foreground">{loc.totalStockKg}</LtrValue></td>
                    <td className="p-3">
                      {loc.status === "active" && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                          نشط
                        </span>
                      )}
                      {loc.status === "low_stock" && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                          <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />
                          منخفض
                        </span>
                      )}
                      {loc.status === "negative_stock" && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-danger/20 bg-danger/10 px-2.5 py-1 text-xs font-medium text-danger">
                          <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
                          سالب
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Movement timeline */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-heading-4 text-foreground">آخر حركات المخزون</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {DEMO_INVENTORY_MOVEMENTS.map((m) => {
              const dir = DIRECTION_ICON[m.direction]!;
              return (
                <li
                  key={m.document}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 transition-all duration-200 hover:border-primary/30 hover:bg-primary/5"
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg font-bold", dir.classes)} aria-hidden="true">
                    {dir.glyph}
                  </span>
                  <LtrValue className="font-medium text-foreground">{m.document}</LtrValue>
                  <span className="text-sm text-foreground">{m.typeAr}</span>
                  <span className="text-xs text-muted-foreground">الموقع: {m.locationAr}</span>
                  <span className="text-xs text-muted-foreground">الكمية:</span>
                  <LtrValue className="font-bold text-foreground">{m.quantityKg} كجم</LtrValue>
                  <span className="mr-auto flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">{m.stateAr}</span>
                    <span className="text-xs text-muted-foreground" dir="ltr"><LtrValue>{m.date}</LtrValue></span>
                  </span>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>

      <DemoFooterNote />
    </DemoShell>
  );
}
