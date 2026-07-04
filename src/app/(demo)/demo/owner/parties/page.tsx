/**
 * Demo Parties (Suppliers / Customers / Factories) — stakeholder visual demo.
 *
 * Route: /demo/owner/parties
 *
 * Shows master-data lists with balances, relationship summaries, and
 * active/inactive visual status. Three tables grouped by party type,
 * with a top summary strip.
 *
 * All data is synthetic (DEMO_PARTIES). No Supabase. No real transaction logic.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { cn } from "@/lib/cn";
import { DemoShell } from "@/components/demo/demo-shell";
import { DemoPageHeader, DemoFooterNote } from "@/components/demo/demo-charts";
import { DEMO_PARTIES } from "@/lib/fixtures/demo-fixtures";

function parseNumeric(value: string): number {
  const m = value.match(/-?[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

const TYPE_LABEL: Record<string, string> = {
  supplier: "مورد",
  customer: "عميل",
  factory: "مصنع تشغيل",
};

const TYPE_ACCENT: Record<string, { line: string; chip: string }> = {
  supplier: { line: "bg-primary", chip: "bg-primary/10 text-primary" },
  customer: { line: "bg-success", chip: "bg-success/10 text-success" },
  factory: { line: "bg-accent", chip: "bg-accent/10 text-accent" },
};

function PartyTable({ parties, type }: { parties: typeof DEMO_PARTIES; type: "supplier" | "customer" | "factory" }) {
  const accent = TYPE_ACCENT[type]!;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-heading-4 text-foreground">
            {type === "supplier" ? "الموردون" : type === "customer" ? "العملاء" : "مصانع التشغيل"}
          </CardTitle>
          <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", accent.chip)}>
            {parties.length} {TYPE_LABEL[type]}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" role="table">
            <thead>
              <tr className="border-b border-border bg-primary/5">
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الكود</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الاسم</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الفئة</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الرصيد (جنيه)</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">أوامر نشطة</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">بداية العلاقة</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">آخر معاملة</th>
                <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => {
                const balNum = parseNumeric(p.balanceEgp);
                return (
                  <tr key={p.code} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                    <td className="p-3"><LtrValue className="text-muted-foreground">{p.code}</LtrValue></td>
                    <td className="p-3 text-foreground">{p.nameAr}</td>
                    <td className="p-3 text-muted-foreground">{p.categoryAr}</td>
                    <td className="p-3">
                      <LtrValue className={cn(
                        "font-bold",
                        balNum > 0 ? "text-success" : balNum < 0 ? "text-warning" : "text-muted-foreground",
                      )}>
                        {p.balanceEgp}
                      </LtrValue>
                    </td>
                    <td className="p-3"><LtrValue className="text-foreground">{p.activeOrders}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-muted-foreground">{p.relationshipStart}</LtrValue></td>
                    <td className="p-3"><LtrValue className="text-muted-foreground">{p.lastTransactionDate}</LtrValue></td>
                    <td className="p-3">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                        p.status === "active"
                          ? "bg-success/10 text-success border-success/20"
                          : "bg-muted text-muted-foreground border-border",
                      )}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                        {p.status === "active" ? "نشط" : "غير نشط"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DemoPartiesPage() {
  const suppliers = DEMO_PARTIES.filter((p) => p.type === "supplier");
  const customers = DEMO_PARTIES.filter((p) => p.type === "customer");
  const factories = DEMO_PARTIES.filter((p) => p.type === "factory");

  const totalSuppliersPayable = suppliers.reduce((s, p) => s + Math.abs(Math.min(0, parseNumeric(p.balanceEgp))), 0);
  const totalCustomersReceivable = customers.reduce((s, p) => s + Math.max(0, parseNumeric(p.balanceEgp)), 0);
  const totalFactoriesPayable = factories.reduce((s, p) => s + Math.abs(Math.min(0, parseNumeric(p.balanceEgp))), 0);

  return (
    <DemoShell
      userName="رئيس مجلس الإدارة / العضو المنتدب التنفيذي"
      breadcrumbs={[{ label: "البيانات الأساسية" }, { label: "الموردون والعملاء والمصانع" }]}
    >
      <DemoPageHeader
        titleAr="الموردون والعملاء والمصانع"
        subtitleAr="قوائم البيانات الأساسية مع الأرصدة وملخصات العلاقات — الحالة النشطة/غير النشطة للعرض فقط"
      />

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-primary" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">عدد الموردين</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{suppliers.length}</LtrValue>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              مستحق للموردين: <LtrValue className="font-bold text-warning">{totalSuppliersPayable.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</LtrValue>
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-success" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">عدد العملاء</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{customers.length}</LtrValue>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              مستحق لك من العملاء: <LtrValue className="font-bold text-success">{totalCustomersReceivable.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</LtrValue>
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-accent" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">عدد مصانع التشغيل</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{factories.length}</LtrValue>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              مستحق للمصانع: <LtrValue className="font-bold text-warning">{totalFactoriesPayable.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} جنيه</LtrValue>
            </p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden border-border bg-surface">
          <div className="pointer-events-none absolute right-0 top-5 bottom-5 w-[3px] rounded-full bg-warning" aria-hidden="true" />
          <CardContent className="relative p-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">إجمالي غير النشطين</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">
              <LtrValue>{DEMO_PARTIES.filter((p) => p.status === "inactive").length}</LtrValue>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">بدون أوامر نشطة حالياً</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <PartyTable parties={suppliers} type="supplier" />
        <PartyTable parties={customers} type="customer" />
        <PartyTable parties={factories} type="factory" />
      </div>

      <DemoFooterNote />
    </DemoShell>
  );
}
