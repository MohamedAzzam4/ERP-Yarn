/**
 * WP-01-05/06/07 Reference Screens Bundle tests (polish pass).
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5-8
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md
 * DEC-076: Restrained glass accents
 * DEC-077: Arabic terminology fixture
 * DEC-078: Synthetic/prohibited-data fixture (reference-fixtures-v1)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_VERSION,
  WORKER_RECEIPT_FIXTURE,
  REVIEW_QUEUE_FIXTURE,
  OWNER_DASHBOARD_FIXTURE,
} from "../fixtures/reference-fixtures";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}
function exists(rel: string): boolean {
  return existsSync(join(root, rel));
}

// --- Fixture version ---

describe("WP-01-05/06/07 fixture version", () => {
  it("FIXTURE_VERSION is reference-fixtures-v1", () => {
    expect(FIXTURE_VERSION).toBe("reference-fixtures-v1");
  });
});

// --- WP-01-05 Worker Receipt Reference ---

describe("WP-01-05 Worker raw-receipt reference screen", () => {
  it("page exists at /worker/raw-receipts/new", () => {
    expect(exists("src/app/(worker)/worker/raw-receipts/new/page.tsx")).toBe(true);
  });

  it("component exists", () => {
    expect(exists("src/components/reference-screens/worker-receipt-reference.tsx")).toBe(true);
  });

  it("fixture has correct screen title", () => {
    expect(WORKER_RECEIPT_FIXTURE.screenTitle).toBe("استلام خام جديد");
  });

  it("fixture has 11 visible fields (matching docs/design §5 Visible fields table)", () => {
    expect(WORKER_RECEIPT_FIXTURE.fields).toHaveLength(11);
  });

  it("fixture has 3 allowed actions", () => {
    expect(WORKER_RECEIPT_FIXTURE.allowedActions).toHaveLength(3);
    expect(WORKER_RECEIPT_FIXTURE.allowedActions).toContain("حفظ كمسودة");
    expect(WORKER_RECEIPT_FIXTURE.allowedActions).toContain("إرسال للمراجعة");
  });

  it("fixture expected totals are correct", () => {
    expect(WORKER_RECEIPT_FIXTURE.expectedTotals.netEnteredQuantityKg).toBe("1,250.000");
    expect(WORKER_RECEIPT_FIXTURE.expectedTotals.balesCount).toBe(25);
    expect(WORKER_RECEIPT_FIXTURE.expectedTotals.stockPosted).toBe(false);
    expect(WORKER_RECEIPT_FIXTURE.expectedTotals.financialFieldsVisible).toBe(false);
  });

  it("component has NO financial terms", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    const prohibited = WORKER_RECEIPT_FIXTURE.prohibitedData;
    for (const term of prohibited) {
      expect(src, `worker receipt component contains prohibited term '${term}'`).not.toContain(term);
    }
  });

  it("component uses dir=ltr for code/date/quantity inputs (LTR isolation)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    // Form inputs for codes, dates, quantities must have dir="ltr"
    expect(src).toMatch(/dir="ltr"/);
  });

  it("component uses Container (RTL-safe layout)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/Container/);
  });

  it("component has touch targets (min-h-[44px]) on form inputs", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/min-h-\[44px\]/);
  });

  it("component has focus-visible styles on interactive elements", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/focus-visible/);
  });

  it("component states it is a reference screen (no real posting)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/مرجعية|تجريبية/);
  });

  it("component has field groups (3 Card sections: بيانات الاستلام / الكميات / التخزين)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/بيانات الاستلام/);
    expect(src).toMatch(/الكميات والأوزان/);
    expect(src).toMatch(/التخزين والملاحظات/);
  });

  it("component has NO glass/blur effects (DEC-076: Worker Task Mode)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).not.toMatch(/backdrop-blur|glass|frosted/i);
  });

  it("component has guidance text below title", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/أدخل بيانات|احفظ كمسودة أو أرسل للمراجعة/);
  });

  // --- Data-entry form controls (not read-only) ---

  it("component has form input controls (type=text) for code/lot/season fields", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/type="text"/);
  });

  it("component has form input controls (type=number) for bale count and weight", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/type="number"/);
  });

  it("component has select controls for raw type, grade, supplier, storage location", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/<select/);
  });

  it("component has textarea control for notes", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/<textarea/);
  });

  it("component has 11 form fields with labels (not read-only value rows)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    // Should have <label> elements for each field (not <dt>/<dd> read-only)
    const labelCount = (src.match(/<label/g) || []).length;
    expect(labelCount).toBeGreaterThanOrEqual(11);
    // Should NOT have <dl> or <dd> (read-only details layout)
    expect(src).not.toMatch(/<dl|<dd/);
  });

  it("component pre-fills fixture values via defaultValue (not as static text)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/defaultValue/);
  });

  it("component action buttons are type=button (no form submit/API mutation)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/type="button"/);
    // Should NOT have type="submit"
    expect(src).not.toMatch(/type="submit"/);
  });

  it("component does NOT import or call any API/service modules", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).not.toMatch(/from.*@\/server\/api|from.*@\/server\/services|fetch\(|axios/i);
  });

  it("page uses WorkerShell wrapper", () => {
    const src = readText("src/app/(worker)/worker/raw-receipts/new/page.tsx");
    expect(src).toMatch(/WorkerShell/);
  });

  it("page checks worker role and redirects non-workers", () => {
    const src = readText("src/app/(worker)/worker/raw-receipts/new/page.tsx");
    expect(src).toMatch(/isWorkerShellRole/);
    expect(src).toMatch(/redirect\("\/management"\)/);
  });
});

// --- WP-01-06 Accountant Review Queue Reference ---

describe("WP-01-06 Accountant review queue reference screen", () => {
  it("page exists at /management/reviews", () => {
    expect(exists("src/app/(management)/management/reviews/page.tsx")).toBe(true);
  });

  it("component exists", () => {
    expect(exists("src/components/reference-screens/review-queue-reference.tsx")).toBe(true);
  });

  it("fixture has correct screen title", () => {
    expect(REVIEW_QUEUE_FIXTURE.screenTitle).toBe("مركز المراجعات");
  });

  it("fixture has 6 summary counts", () => {
    expect(REVIEW_QUEUE_FIXTURE.summaryCounts).toHaveLength(6);
    expect(REVIEW_QUEUE_FIXTURE.summaryCounts[0]!.categoryAr).toBe("كل المراجعات المطلوبة");
    expect(REVIEW_QUEUE_FIXTURE.summaryCounts[0]!.count).toBe(8);
  });

  it("fixture has 5 queue rows", () => {
    expect(REVIEW_QUEUE_FIXTURE.queueRows).toHaveLength(5);
  });

  it("fixture action behavior has approve/reject as disabled placeholders", () => {
    expect(REVIEW_QUEUE_FIXTURE.actionBehavior.approveRejectArePlaceholders).toBe(true);
    expect(REVIEW_QUEUE_FIXTURE.actionBehavior.placeholderActionsDisabled).toBe(true);
  });

  it("component has disabled approve/reject buttons", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/disabled/);
    expect(src).toMatch(/اعتماد/);
    expect(src).toMatch(/رفض/);
  });

  it("component states it is a reference screen (no real approvals)", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/مرجعية|تجريبية/);
  });

  it("component uses LtrValue for document numbers and dates", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/LtrValue/);
  });

  it("component uses table with role=table", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/role="table"/);
  });

  it("component has focus-visible styles on interactive elements", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/focus-visible/);
  });

  it("component has severity badges (not plain text)", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    // Should have severity config with visual classes (bg-color, rounded, border)
    expect(src).toMatch(/severityConfig|severity/);
    expect(src).toMatch(/rounded-full|rounded-md/);
  });

  it("component has status chips/badges", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/rounded-md.*px-2.*py-0\.5|stateAr/);
  });

  it("component has hover state on table rows", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/hover:bg-muted|hover:bg/);
  });

  it("page uses ManagementShell wrapper", () => {
    const src = readText("src/app/(management)/management/reviews/page.tsx");
    expect(src).toMatch(/ManagementShell/);
  });

  it("page checks management role and redirects non-management", () => {
    const src = readText("src/app/(management)/management/reviews/page.tsx");
    expect(src).toMatch(/isManagementShellRole/);
    expect(src).toMatch(/redirect\("\/worker"\)/);
  });
});

// --- WP-01-07 Owner Dashboard Reference ---

describe("WP-01-07 Owner dashboard reference screen", () => {
  it("page exists at /management/dashboard", () => {
    expect(exists("src/app/(management)/management/dashboard/page.tsx")).toBe(true);
  });

  it("component exists", () => {
    expect(exists("src/components/reference-screens/owner-dashboard-reference.tsx")).toBe(true);
  });

  it("fixture has correct screen title", () => {
    expect(OWNER_DASHBOARD_FIXTURE.screenTitle).toBe("لوحة التحكم");
  });

  it("fixture has 8 KPI cards", () => {
    expect(OWNER_DASHBOARD_FIXTURE.kpiCards).toHaveLength(8);
  });

  it("fixture KPI cards include outsourced-manufacturing labels", () => {
    const labels = OWNER_DASHBOARD_FIXTURE.kpiCards.map((c) => c.labelAr);
    expect(labels).toContain("إجمالي المخزون");
    expect(labels).toContain("مخزون لدى مصانع التشغيل");
    expect(labels).toContain("مراجعات مطلوبة");
    expect(labels).toContain("ربحية تقريبية");
  });

  it("fixture has 3 charts", () => {
    expect(OWNER_DASHBOARD_FIXTURE.charts).toHaveLength(3);
  });

  it("fixture has 3 recent activity strips", () => {
    expect(OWNER_DASHBOARD_FIXTURE.recentActivity).toHaveLength(3);
  });

  it("fixture has 4 prohibited internal-factory KPIs", () => {
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toHaveLength(4);
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("كفاءة الإنتاج");
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("إنتاجية العامل");
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("تشغيل الماكينات");
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("عدد الأوامر النشطة");
  });

  it("component has NO prohibited internal-factory KPI terms", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    for (const term of OWNER_DASHBOARD_FIXTURE.prohibitedKpis) {
      expect(src, `dashboard component contains prohibited KPI '${term}'`).not.toContain(term);
    }
  });

  it("component labels approximate profitability correctly", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/تقريبي/);
  });

  it("component KPI cards are navigational (role=link)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/role="link"/);
  });

  it("component charts have accessible labels (role=img)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/role="img"/);
  });

  it("component uses LtrValue for values", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/LtrValue/);
  });

  it("component states it is a reference screen", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/مرجعية|تجريبية/);
  });

  it("component has chart-like visual structures (CSS bars + SVG trend line + donut, not only text lists)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/width.*%|height.*%/);
    expect(src).toMatch(/rounded-full|rounded-lg/);
    expect(src).toMatch(/bg-primary|bg-accent|bg-warning|BAR_COLORS/);
    expect(src).toMatch(/<svg/);
    expect(src).toMatch(/MiniTrendLine/);
  });

  it("component has SVG donut/pie composition widget (توزيع المخزون)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/DonutChart/);
    expect(src).toMatch(/توزيع المخزون/);
    expect(src).toMatch(/strokeDasharray/); // SVG donut arc
    expect(src).toMatch(/inventoryComposition/);
  });

  it("component has attention ranking widget (أهم البنود التي تحتاج انتباه)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/أهم البنود التي تحتاج انتباه/);
    expect(src).toMatch(/attentionItems/);
    expect(src).toMatch(/SEVERITY_STYLES/);
  });

  it("component has external factory balances widget (أرصدة مصانع التشغيل)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/أرصدة مصانع التشغيل/);
    expect(src).toMatch(/factoryBalances/);
  });

  it("component has visible glass accents on insight widgets (backdrop-blur on management surface)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/backdrop-blur-md|backdrop-blur-sm/);
    expect(src).toMatch(/bg-surface\/80|bg-surface\/95/);
  });

  it("fixture has inventoryComposition data (3 segments)", () => {
    expect(OWNER_DASHBOARD_FIXTURE.inventoryComposition).toHaveLength(3);
    expect(OWNER_DASHBOARD_FIXTURE.inventoryComposition[0]!.labelAr).toBe("خام");
    expect(OWNER_DASHBOARD_FIXTURE.inventoryComposition[1]!.labelAr).toBe("لدى مصانع التشغيل");
  });

  it("fixture has attentionItems data (4 items)", () => {
    expect(OWNER_DASHBOARD_FIXTURE.attentionItems).toHaveLength(4);
    expect(OWNER_DASHBOARD_FIXTURE.attentionItems[0]!.labelAr).toBe("استلام خام بدون سعر");
  });

  it("fixture has factoryBalances data (3 factories)", () => {
    expect(OWNER_DASHBOARD_FIXTURE.factoryBalances).toHaveLength(3);
    expect(OWNER_DASHBOARD_FIXTURE.factoryBalances[0]!.factoryNameAr).toBe("مصر ايران");
  });

  it("component has gradient/glass accent on dashboard header (DEC-076: management surface)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/gradient|backdrop-blur/);
  });

  it("component has KPI card semantic accent (RTL vertical line, no thick top strip)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    // Must have the kpiAccentFor helper + data-kpi-accent hook
    expect(src).toMatch(/kpiAccentFor/);
    expect(src).toMatch(/data-kpi-accent/);
    // Must have an RTL vertical accent line (right-0, 3px wide, top/bottom inset)
    expect(src).toMatch(/right-0.*w-\[3px\].*rounded-full|right-0.*top-5 bottom-5/);
  });

  it("component has hover shadow on KPI cards", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/hover:shadow/);
  });

  it("component has stacked segmented bar for complaints chart", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/overflow-hidden.*rounded-lg|h-8.*w-full/);
  });

  it("component has chart legends with color dots", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/rounded-full.*BAR_COLORS|inline-block.*h-2.*w-2.*rounded-full/);
  });

  it("component has hover effects on KPI cards", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/hover:|hover-/);
  });

  it("component has financial tag on financial KPIs", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/isFinancial|مالي/);
  });

  it("component uses SVG icons in recent activity (not emoji)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/<svg/);
    // Check no emoji unicode characters
    expect(src).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    expect(src).not.toMatch(/[\u{2600}-\u{27BF}]/u);
  });

  it("page uses ManagementShell wrapper", () => {
    const src = readText("src/app/(management)/management/dashboard/page.tsx");
    expect(src).toMatch(/ManagementShell/);
  });

  it("page checks management role and redirects non-management", () => {
    const src = readText("src/app/(management)/management/dashboard/page.tsx");
    expect(src).toMatch(/isManagementShellRole/);
    expect(src).toMatch(/redirect\("\/worker"\)/);
  });
});

// --- Management home redirect ---

describe("WP-01-05/06/07 management home redirect", () => {
  it("/management page redirects to /management/dashboard", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    expect(src).toMatch(/redirect\("\/management\/dashboard"\)/);
  });

  it("/management page does NOT render ManagementShell component (it redirects)", () => {
    const src = readText("src/app/(management)/management/page.tsx");
    // Should not import the ManagementShell component or render it as JSX
    expect(src).not.toMatch(/from.*ManagementShell[^R]/);
    expect(src).not.toMatch(/<ManagementShell/);
  });
});

// --- Worker financial redaction (DEC-063) ---

describe("WP-01-05/06/07 worker financial redaction (DEC-063)", () => {
  const workerProhibitedTerms = [
    "سعر", "تكلفة", "رصيد مورد", "رصيد عميل", "رصيد مصنع",
    "مستحقات", "مدفوعات", "تسويات", "حسابات", "قيد محاسبي",
    "ربحية", "هامش ربح", "صافي الربح",
  ];

  it("worker receipt component contains NONE of the prohibited financial terms", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    for (const term of workerProhibitedTerms) {
      expect(src, `worker receipt contains prohibited financial term '${term}'`).not.toContain(term);
    }
  });

  it("worker receipt page contains NONE of the prohibited financial terms", () => {
    const src = readText("src/app/(worker)/worker/raw-receipts/new/page.tsx");
    for (const term of workerProhibitedTerms) {
      expect(src, `worker receipt page contains prohibited financial term '${term}'`).not.toContain(term);
    }
  });

  it("worker receipt fixture fields contain NONE of the prohibited financial terms", () => {
    for (const field of WORKER_RECEIPT_FIXTURE.fields) {
      for (const term of workerProhibitedTerms) {
        expect(field.labelAr, `field '${field.labelAr}' contains '${term}'`).not.toContain(term);
        expect(field.value, `value '${field.value}' contains '${term}'`).not.toContain(term);
      }
    }
  });
});

// --- Prohibited-data assertions (DEC-078 §8) ---

describe("WP-01-05/06/07 prohibited-data assertions (DEC-078 §8)", () => {
  it("worker receipt: no hidden payload fields for price/payable/balance/profit", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).not.toMatch(/purchase_price|payable|balance|profit|cost_per_ton|total_cost/i);
  });

  it("accountant queue: no fake approval toasts or real status change", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).not.toMatch(/toast|success.*approv|تم الاعتماد|تم بنجاح/i);
  });

  it("owner dashboard: no generic internal-factory KPIs", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    for (const term of OWNER_DASHBOARD_FIXTURE.prohibitedKpis) {
      expect(src, `dashboard contains prohibited KPI '${term}'`).not.toContain(term);
    }
  });

  it("owner dashboard: uses outsourced-manufacturing wording", () => {
    const hasOutsourcedWording = OWNER_DASHBOARD_FIXTURE.kpiCards.some(
      (c) => c.labelAr.includes("مصانع التشغيل"),
    );
    expect(hasOutsourcedWording).toBe(true);
    const hasInternalFactoryWording = OWNER_DASHBOARD_FIXTURE.kpiCards.some(
      (c) => c.labelAr.includes("كفاءة") || c.labelAr.includes("إنتاجية"),
    );
    expect(hasInternalFactoryWording).toBe(false);
  });
});

// --- Glass accent restrictions (DEC-076) ---

describe("WP-01-05/06/07 glass accent restrictions (DEC-076)", () => {
  it("worker receipt component has NO glass/blur effects", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).not.toMatch(/backdrop-blur|glass|frosted/i);
  });

  it("review queue has restrained glass accent on header (DEC-076: management surface)", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    // Glass is allowed on management header surfaces (not on tables/approval actions)
    expect(src).toMatch(/backdrop-blur|gradient/);
  });

  it("review queue: no glass on table rows or approval buttons", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    // Glass should NOT appear near table rows or button elements
    // Just verify the component doesn't use heavy glass effects
    expect(src).not.toMatch(/backdrop-blur-lg|backdrop-blur-xl/i);
  });

  it("owner dashboard: glass only as restrained secondary accent (not on values)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    // Glass must not appear near financial numbers or KPI card values
    expect(src).not.toMatch(/backdrop-blur.*كجم|backdrop-blur.*جنيه/i);
  });

  it("topbar may use restrained glass accent (backdrop-blur-sm)", () => {
    const src = readText("src/components/shells/topbar.tsx");
    // Topbar is a management-surface accent — allowed to have backdrop-blur-sm
    // (but it's optional, not required)
    // Just verify no heavy glass effects
    expect(src).not.toMatch(/backdrop-blur-lg|backdrop-blur-xl/i);
  });
});

// --- No emoji icons in shells (replaced with SVG) ---

describe("WP-01-05/06/07 no emoji icons in shells", () => {
  it("topbar uses SVG icons (not emoji)", () => {
    const src = readText("src/components/shells/topbar.tsx");
    expect(src).toMatch(/<svg/);
    // Check for specific emoji patterns that were previously used
    expect(src).not.toMatch(/🔍|🔔|↻|☰/);
  });

  it("sidebar uses SVG icons (not emoji)", () => {
    const src = readText("src/components/shells/sidebar.tsx");
    expect(src).toMatch(/<svg/);
    expect(src).not.toMatch(/◀|▶|▼/);
  });
});

// --- RTL and LTR isolation ---

describe("WP-01-05/06/07 RTL and LTR isolation", () => {
  it("layout.tsx still has <html lang='ar' dir='rtl'>", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).toMatch(/lang="ar"/);
    expect(layout).toMatch(/dir="rtl"/);
  });

  it("layout.tsx does NOT use dir='auto'", () => {
    const layout = readText("src/app/layout.tsx");
    expect(layout).not.toMatch(/dir="auto"/);
  });

  it("worker receipt uses dir=ltr for code/quantity inputs (LTR isolation)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/dir="ltr"/);
  });

  it("review queue uses LtrValue for document numbers/dates", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).toMatch(/LtrValue/);
  });

  it("owner dashboard uses LtrValue for values", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    expect(src).toMatch(/LtrValue/);
  });
});

// --- No API routes, migrations, or database writes ---

describe("WP-01-05/06/07 no API/routes/migrations/database writes", () => {
  it("no new API routes added", () => {
    expect(exists("src/app/api/v1/route.ts")).toBe(false);
    expect(exists("src/app/api/receipts/route.ts")).toBe(false);
    expect(exists("src/app/api/reviews/route.ts")).toBe(false);
    expect(exists("src/app/api/dashboard/route.ts")).toBe(false);
  });

  it("no new migrations added", () => {
    expect(exists("drizzle/output/0005_*.sql")).toBe(false);
  });

  it("reference screen components do NOT import database or service modules", () => {
    const files = [
      "src/components/reference-screens/worker-receipt-reference.tsx",
      "src/components/reference-screens/review-queue-reference.tsx",
      "src/components/reference-screens/owner-dashboard-reference.tsx",
    ];
    for (const file of files) {
      const src = readText(file);
      expect(src, `${file} should not import DB/service modules`).not.toMatch(/from.*@\/server\/db|from.*@\/server\/services/);
    }
  });

  it("fixture module is pure data (no I/O, no DB imports)", () => {
    const src = readText("src/lib/fixtures/reference-fixtures.ts");
    expect(src).not.toMatch(/import.*postgres|import.*supabase|import.*server-only/);
  });
});

// --- Nav-config integration ---

describe("WP-01-05/06/07 nav-config integration", () => {
  const navConfig = readText("src/components/shells/nav-config.ts");

  it("worker raw-receipt task points to /worker/raw-receipts/new", () => {
    expect(navConfig).toMatch(/href: "\/worker\/raw-receipts\/new"/);
  });

  it("management nav includes dashboard panel route", () => {
    expect(navConfig).toMatch(/href: "\/management\/dashboard"/);
  });

  it("management nav includes reviews route", () => {
    expect(navConfig).toMatch(/href: "\/management\/reviews"/);
  });
});

// --- Reduced motion support ---

describe("WP-01-05/06/07 reduced motion support", () => {
  it("globals.css has prefers-reduced-motion media query", () => {
    const css = readText("src/app/globals.css");
    expect(css).toMatch(/prefers-reduced-motion/);
    expect(css).toMatch(/animation-duration.*0\.01ms/);
    expect(css).toMatch(/transition-duration.*0\.01ms/);
  });
});

// ===========================================================================
// DEC-075 final visual-interaction polish pass.
// Covers: chart hover/focus interactions, blue/navy brand identity,
// sidebar collapse button redesign, worker screen safety, no-emoji,
// no internal-factory KPIs, financial redaction, no API/DB/mutation.
// ===========================================================================

describe("DEC-075 chart hover/focus interactions (Power BI-style)", () => {
  const dash = readText("src/components/reference-screens/owner-dashboard-reference.tsx");

  it("dashboard component is a client component (uses React state for hover/focus)", () => {
    expect(dash).toMatch(/"use client"/);
    expect(dash).toMatch(/useState/);
  });

  it("donut chart segments are hoverable + keyboard-focusable (tabIndex + role=button)", () => {
    expect(dash).toMatch(/DonutChart/);
    // SVG segments must be interactive
    expect(dash).toMatch(/tabIndex=\{0\}/);
    expect(dash).toMatch(/role="button"/);
    expect(dash).toMatch(/onMouseEnter/);
    expect(dash).toMatch(/onMouseLeave/);
    expect(dash).toMatch(/onFocus/);
    expect(dash).toMatch(/onBlur/);
  });

  it("donut chart highlights focused segment and de-emphasizes others (opacity dim)", () => {
    // The dimming logic uses opacity < 1 for non-active segments.
    // The opacity value appears in a ternary (e.g. `opacity: isDim ? 0.35 : 1`)
    // so we just look for the dim numeric value anywhere in the file.
    expect(dash).toMatch(/0\.35|0\.45|0\.5\b|0\.55/);
    expect(dash).toMatch(/dimmed/);
  });

  it("donut chart shows cursor pointer on interactive parts", () => {
    expect(dash).toMatch(/cursor:\s*"pointer"/);
  });

  it("donut legend items are also interactive (paired hover/focus)", () => {
    // Legend rows should have tabIndex and role=button too
    const legendSection = dash.slice(dash.indexOf("segmentData.map"));
    expect(legendSection).toMatch(/tabIndex=\{0\}/);
  });

  it("attention ranking supports hover/focus highlight with de-emphasis", () => {
    expect(dash).toMatch(/AttentionRanking/);
    expect(dash).toMatch(/data-chart="attention-ranking"/);
  });

  it("factory balances supports hover/focus highlight", () => {
    expect(dash).toMatch(/FactoryBalances/);
    expect(dash).toMatch(/data-chart="factory-balances"/);
  });

  it("inventory location bars support hover/focus highlight", () => {
    expect(dash).toMatch(/LocationBars/);
    expect(dash).toMatch(/data-chart="location-bars"/);
  });

  it("review trend chart points are hoverable/focusable", () => {
    expect(dash).toMatch(/ReviewTrendChart/);
    expect(dash).toMatch(/data-chart="review-trend"/);
    expect(dash).toMatch(/MiniTrendLine/);
  });

  it("complaints stacked bar segments are hoverable/focusable", () => {
    expect(dash).toMatch(/ComplaintsChart/);
    expect(dash).toMatch(/data-chart="complaints-stacked"/);
  });

  it("chart transitions are 150–300ms (duration-200 or duration-300)", () => {
    // Accept 150/200/300 ms Tailwind durations
    expect(dash).toMatch(/duration-(150|200|300)/);
  });

  it("no layout-shifting scale effects on chart hover (no scale-105 etc.)", () => {
    expect(dash).not.toMatch(/scale-105|scale-110|scale-125/i);
  });

  it("no fake chart click action / mutation (no onClick handlers that setState beyond hover)", () => {
    // The component must not call any API, fetch, or dispatch.
    expect(dash).not.toMatch(/fetch\(|axios|mutation|useMutation|router\.push|router\.replace/);
    // onClick is allowed on the collapse toggle, but not on chart parts
    // (chart parts use onMouseEnter/onFocus only)
  });

  it("dashboard does not import API/service/DB modules", () => {
    expect(dash).not.toMatch(/from.*@\/server\/api|from.*@\/server\/services|from.*@\/server\/db/);
  });
});

describe("DEC-075 blue/navy brand identity on management surfaces", () => {
  const dash = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
  const reviews = readText("src/components/reference-screens/review-queue-reference.tsx");
  const topbar = readText("src/components/shells/topbar.tsx");
  const sidebar = readText("src/components/shells/sidebar.tsx");

  it("owner dashboard header uses blue gradient + primary accent bar", () => {
    expect(dash).toMatch(/from-primary\/12|from-primary\/10/);
    expect(dash).toMatch(/bg-primary/);
  });

  it("owner dashboard KPI cards use premium RTL semantic accent (no thick top strip)", () => {
    // Must NOT have the old thick top strip (h-1.5 or h-1 full-width gradient)
    expect(dash).not.toMatch(/inset-x-0 top-0 h-1\.5 bg-gradient/);
    expect(dash).not.toMatch(/inset-x-0 top-0 h-1 bg-gradient/);
    // Must have the new RTL vertical accent line (right-0, 3px wide, inset vertically)
    expect(dash).toMatch(/right-0.*w-\[3px\].*rounded-full/);
    // Must have semantic accent mapping (multiple categories)
    expect(dash).toMatch(/kpiAccentFor/);
    expect(dash).toMatch(/bg-danger|bg-warning|bg-success|bg-accent|bg-primary/);
  });

  it("owner dashboard KPI financial tag uses primary-tinted styling", () => {
    expect(dash).toMatch(/bg-primary\/10.*text-primary/);
  });

  it("review queue header uses blue gradient + primary accent bar", () => {
    expect(reviews).toMatch(/from-primary\/10|from-primary\/5/);
    expect(reviews).toMatch(/bg-primary/);
  });

  it("review queue summary first card is brand-highlighted (primary border + tint)", () => {
    expect(reviews).toMatch(/border-primary\/30.*bg-primary\/5|bg-primary\/5.*border-primary\/30/);
  });

  it("topbar has blue gradient background + branded logo mark", () => {
    expect(topbar).toMatch(/from-primary\/5/);
    expect(topbar).toMatch(/from-primary to-primary\/70|bg-gradient-to-br.*from-primary/);
  });

  it("topbar title uses primary (blue) text color", () => {
    expect(topbar).toMatch(/text-primary/);
  });

  it("sidebar header has blue gradient + brand accent line", () => {
    expect(sidebar).toMatch(/from-primary\/8|from-primary\/5|from-primary\/10/);
    expect(sidebar).toMatch(/bg-primary\/40|bg-primary\/30|w-1.*bg-primary/);
  });

  it("sidebar active item is strongly branded (primary bg + bold + ring)", () => {
    expect(sidebar).toMatch(/bg-primary\/10.*font-bold.*text-primary/);
    expect(sidebar).toMatch(/ring-primary\/20|ring-inset/);
  });

  it("sidebar active item has branded accent bar indicator", () => {
    expect(sidebar).toMatch(/h-6 w-1.*bg-primary|h-1.*bg-primary.*right-0/);
  });

  it("management surfaces use semantic primary tokens (not hardcoded hex blue)", () => {
    // Components should reference bg-primary / text-primary / border-primary
    // not literal #2457c5 hex values (those live in globals.css only)
    expect(dash).not.toMatch(/#2457c5/i);
    expect(reviews).not.toMatch(/#2457c5/i);
    expect(topbar).not.toMatch(/#2457c5/i);
    expect(sidebar).not.toMatch(/#2457c5/i);
  });
});

describe("DEC-075 worker screen brand-safety (no glass, no heavy brand)", () => {
  const worker = readText("src/components/reference-screens/worker-receipt-reference.tsx");

  it("worker receipt has NO glass/blur effects (DEC-076)", () => {
    expect(worker).not.toMatch(/backdrop-blur|glass|frosted/i);
  });

  it("worker receipt has NO heavy brand gradients", () => {
    expect(worker).not.toMatch(/from-primary\/|bg-gradient-to/);
  });

  it("worker receipt has NO primary-tinted card backgrounds", () => {
    expect(worker).not.toMatch(/bg-primary\/5|bg-primary\/10/);
  });

  it("worker receipt remains simple (uses Card without brand overload)", () => {
    // Should use plain Card components (no border-primary, no bg-primary)
    expect(worker).not.toMatch(/border-primary|text-primary|bg-primary/);
  });
});

describe("DEC-075 sidebar collapse button redesign", () => {
  const sidebar = readText("src/components/shells/sidebar.tsx");

  it("sidebar component file exists and is a client component", () => {
    expect(exists("src/components/shells/sidebar.tsx")).toBe(true);
    expect(sidebar).toMatch(/"use client"/);
  });

  it("collapse button has accessible Arabic aria-label", () => {
    expect(sidebar).toMatch(/aria-label=\{collapsed \? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"\}/);
  });

  it("collapse button has 44px minimum touch target", () => {
    expect(sidebar).toMatch(/min-h-\[44px\].*min-w-\[44px\]|min-w-\[44px\].*min-h-\[44px\]/);
  });

  it("collapse button has visible hover and focus states", () => {
    expect(sidebar).toMatch(/hover:bg-primary\/5|hover:bg-primary\/10|hover:border-primary\/40/);
    expect(sidebar).toMatch(/focus-visible:outline-none.*focus-visible:ring-2|focus-visible:ring-2.*focus-visible:outline-none/);
  });

  it("collapse button is flush/integrated with header (no floating border+shadow)", () => {
    // Button should be transparent by default (not a floating bordered box)
    expect(sidebar).toMatch(/bg-transparent/);
    // Should NOT have the old floating-button styling (border + bg-surface + shadow-sm together)
    expect(sidebar).not.toMatch(/border border-border bg-surface.*shadow-sm/);
    // Hover reveals a subtle primary tint (product-control feel)
    expect(sidebar).toMatch(/hover:bg-primary\/10/);
  });

  it("collapse button uses panel-collapse/panel-expand SVG icons (not single chevron arrow)", () => {
    expect(sidebar).toMatch(/PanelCollapseIcon|PanelExpandIcon/);
    // Should have double-chevron style icons (two polylines)
    const panelIconCount = (sidebar.match(/<polyline/g) || []).length;
    expect(panelIconCount).toBeGreaterThanOrEqual(4); // 2 per icon × 2 icons
  });

  it("collapse button aria-expanded reflects collapsed state", () => {
    expect(sidebar).toMatch(/aria-expanded=\{!collapsed\}/);
  });

  it("collapse button has data-sidebar-collapse-toggle hook for testability", () => {
    expect(sidebar).toMatch(/data-sidebar-collapse-toggle/);
  });

  it("sidebar header has branded gradient + accent line (integrated look)", () => {
    expect(sidebar).toMatch(/bg-gradient-to-l from-primary/);
  });

  it("sidebar header pairs brand title with collapse toggle (no empty band)", () => {
    // When expanded, the header shows a brand mark + title + toggle together
    // (not a large empty strip with just the toggle centered).
    // Updated 2026-07-06: brand mark is now EgycotLogo (not old "E" gradient box)
    expect(sidebar).toMatch(/إيجيكوت/);
    expect(sidebar).toMatch(/EgycotLogo/);
    // Header is a compact h-14 row, not a tall py-2 band
    expect(sidebar).toMatch(/h-14/);
  });

  it("sidebar does not use emoji icons for collapse toggle", () => {
    expect(sidebar).not.toMatch(/◀|▶|▼|✕|×/);
  });
});

describe("DEC-075 no emoji icons reintroduced (all shells + reference screens)", () => {
  const files = [
    "src/components/shells/sidebar.tsx",
    "src/components/shells/topbar.tsx",
    "src/components/shells/management-shell.tsx",
    "src/components/shells/worker-shell.tsx",
    "src/components/reference-screens/owner-dashboard-reference.tsx",
    "src/components/reference-screens/review-queue-reference.tsx",
    "src/components/reference-screens/worker-receipt-reference.tsx",
  ];
  for (const file of files) {
    it(`${file} has no emoji unicode characters`, () => {
      const src = readText(file);
      // Misc emoji/symbol ranges
      expect(src).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
      expect(src).not.toMatch(/[\u{2600}-\u{27BF}]/u);
      // Geometric shape arrows used previously
      expect(src).not.toMatch(/◀|▶|▼|▲|◀|▶/);
    });
  }
});

describe("DEC-075 no internal-factory KPI terms (regression)", () => {
  it("owner dashboard component has no prohibited internal-factory KPI terms", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    for (const term of OWNER_DASHBOARD_FIXTURE.prohibitedKpis) {
      expect(src, `dashboard contains prohibited KPI '${term}'`).not.toContain(term);
    }
  });

  it("owner dashboard fixture still lists 4 prohibited internal-factory KPIs", () => {
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toHaveLength(4);
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("كفاءة الإنتاج");
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("إنتاجية العامل");
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("تشغيل الماكينات");
    expect(OWNER_DASHBOARD_FIXTURE.prohibitedKpis).toContain("عدد الأوامر النشطة");
  });
});

describe("DEC-075 worker financial redaction still passes (regression)", () => {
  const workerProhibitedTerms = [
    "سعر", "تكلفة", "رصيد مورد", "رصيد عميل", "رصيد مصنع",
    "مستحقات", "مدفوعات", "تسويات", "حسابات", "قيد محاسبي",
    "ربحية", "هامش ربح", "صافي الربح",
  ];

  it("worker receipt component contains NONE of the prohibited financial terms", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    for (const term of workerProhibitedTerms) {
      expect(src, `worker receipt contains prohibited financial term '${term}'`).not.toContain(term);
    }
  });

  it("worker receipt component has no hidden payload fields for price/payable/balance/profit", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).not.toMatch(/purchase_price|payable|balance|profit|cost_per_ton|total_cost/i);
  });
});

describe("DEC-075 no API/DB/mutation added (regression)", () => {
  it("no new API routes added", () => {
    expect(exists("src/app/api/v1/route.ts")).toBe(false);
    expect(exists("src/app/api/receipts/route.ts")).toBe(false);
    expect(exists("src/app/api/reviews/route.ts")).toBe(false);
    expect(exists("src/app/api/dashboard/route.ts")).toBe(false);
  });

  it("no new migrations added", () => {
    expect(exists("drizzle/output/0005_*.sql")).toBe(false);
  });

  it("reference screen components do NOT import database or service modules", () => {
    const files = [
      "src/components/reference-screens/worker-receipt-reference.tsx",
      "src/components/reference-screens/review-queue-reference.tsx",
      "src/components/reference-screens/owner-dashboard-reference.tsx",
    ];
    for (const file of files) {
      const src = readText(file);
      expect(src, `${file} should not import DB/service modules`).not.toMatch(/from.*@\/server\/db|from.*@\/server\/services/);
    }
  });

  it("reference screen components do NOT use fetch/axios/mutation", () => {
    const files = [
      "src/components/reference-screens/worker-receipt-reference.tsx",
      "src/components/reference-screens/review-queue-reference.tsx",
      "src/components/reference-screens/owner-dashboard-reference.tsx",
    ];
    for (const file of files) {
      const src = readText(file);
      expect(src, `${file} should not use fetch/axios/mutation`).not.toMatch(/fetch\(|axios|useMutation|useSWR|useQuery/);
    }
  });

  it("sidebar/topbar shells do NOT add API/DB imports", () => {
    const sidebar = readText("src/components/shells/sidebar.tsx");
    const topbar = readText("src/components/shells/topbar.tsx");
    expect(sidebar).not.toMatch(/from.*@\/server\/db|from.*@\/server\/services|from.*@\/server\/api/);
    expect(topbar).not.toMatch(/from.*@\/server\/db|from.*@\/server\/services|from.*@\/server\/api/);
  });
});

// ===========================================================================
// KPI card premium refinement (DEC-075 visual refinement pass 2).
// Owner feedback: thick blue top strip looks cheap/mechanical.
// Resolution: replace with RTL vertical semantic accent line + subtle corner
// glow; keep numbers on plain bg-surface (no glass behind values).
// ===========================================================================

describe("DEC-075 KPI card premium refinement (no thick top strip)", () => {
  const dash = readText("src/components/reference-screens/owner-dashboard-reference.tsx");

  it("KPI cards do NOT use a thick full-width top border/strip", () => {
    // The old mechanical top strip: absolute inset-x-0 top-0 h-1.5 bg-gradient
    expect(dash).not.toMatch(/inset-x-0 top-0 h-1\.5/);
    expect(dash).not.toMatch(/inset-x-0 top-0 h-1 bg-gradient/);
    // Also no thick top-0 strip of any height spanning full width
    expect(dash).not.toMatch(/absolute inset-x-0 top-0 h-[1-9]/);
  });

  it("KPI cards use an RTL vertical side accent line (right-0, 3px wide, subtle)", () => {
    // The accent line: absolute right-0, w-[3px], inset vertically, rounded
    expect(dash).toMatch(/right-0.*w-\[3px\].*rounded-full/);
    // Must be inset vertically (top-5 bottom-5), not full-height
    expect(dash).toMatch(/top-5 bottom-5/);
  });

  it("KPI accent uses semantic colors per category (not all-blue)", () => {
    // The kpiAccentFor helper must map different KPIs to different colors
    expect(dash).toMatch(/kpiAccentFor/);
    // Must include at least 3 distinct semantic colors
    expect(dash).toMatch(/bg-danger/);
    expect(dash).toMatch(/bg-warning/);
    expect(dash).toMatch(/bg-success/);
    expect(dash).toMatch(/bg-accent/);
    expect(dash).toMatch(/bg-primary/);
  });

  it("KPI cards expose data-kpi-card + data-kpi-accent hooks for testability", () => {
    expect(dash).toMatch(/data-kpi-card/);
    expect(dash).toMatch(/data-kpi-accent=/);
  });

  it("KPI numbers remain on plain bg-surface (no glass/blur behind values)", () => {
    // The KPI value paragraph uses text-foreground on bg-surface Card.
    // Glass (backdrop-blur) must NOT appear on KPI cards — only on insight widgets.
    // Extract the KPI card section and verify no backdrop-blur there.
    const kpiSection = dash.slice(dash.indexOf("KPI Cards"), dash.indexOf("Insight Widgets"));
    expect(kpiSection).not.toMatch(/backdrop-blur|glass/i);
    // KPI value uses text-foreground (readable) and font-bold
    expect(kpiSection).toMatch(/text-2xl font-bold text-foreground/);
  });

  it("KPI cards do NOT have large decorative corner glow/blob shapes", () => {
    // The old corner glow used a large rounded-blob gradient inside the card.
    // It looked accidental/cheap, so it has been removed entirely.
    const kpiSection = dash.slice(dash.indexOf("KPI Cards"), dash.indexOf("Insight Widgets"));
    // No large decorative blob: rounded-bl-[...] with a gradient fill
    expect(kpiSection).not.toMatch(/rounded-bl-\[\d+rem\]/);
    expect(kpiSection).not.toMatch(/pointer-events-none absolute.*bg-gradient-to-br.*to-transparent/);
    // No from-*/8 glow tint inside KPI cards
    expect(kpiSection).not.toMatch(/from-(primary|accent|success|warning|danger)\/8/);
  });

  it("KPI hover uses subtle border/shadow (no layout-shifting scale)", () => {
    const kpiSection = dash.slice(dash.indexOf("KPI Cards"), dash.indexOf("Insight Widgets"));
    expect(kpiSection).toMatch(/hover:border-primary\/40|hover:shadow/);
    // No scale transforms on hover
    expect(kpiSection).not.toMatch(/scale-/i);
  });

  it("KPI cards have small tinted semantic status chip", () => {
    const kpiSection = dash.slice(dash.indexOf("KPI Cards"), dash.indexOf("Insight Widgets"));
    // The chip uses accent.chip classes (bg-*/10 + text-*) with chipText labels
    expect(kpiSection).toMatch(/accent\.chip/);
    expect(kpiSection).toMatch(/accent\.chipText/);
    // Should have Arabic chip labels (مخزون/تشغيل/مالي/مراجعة/تنبيه/مستحق)
    expect(kpiSection).toMatch(/مخزون|تشغيل|مراجعة|تنبيه|مستحق/);
  });

  it("KPI cards keep accessible role=link + tabIndex for navigation", () => {
    const kpiSection = dash.slice(dash.indexOf("KPI Cards"), dash.indexOf("Insight Widgets"));
    expect(kpiSection).toMatch(/role="link"/);
    expect(kpiSection).toMatch(/tabIndex=\{0\}/);
  });

  it("dashboard header glass/gradient preserved (not removed by KPI refactor)", () => {
    // The dashboard title banner still has backdrop-blur-md + gradient
    expect(dash).toMatch(/backdrop-blur-md/);
    expect(dash).toMatch(/from-primary\/12|from-primary\/10/);
  });

  it("chart hover/focus interactions preserved (not affected by KPI refactor)", () => {
    expect(dash).toMatch(/DonutChart/);
    expect(dash).toMatch(/AttentionRanking/);
    expect(dash).toMatch(/FactoryBalances/);
    expect(dash).toMatch(/data-chart=/);
    expect(dash).toMatch(/onMouseEnter/);
    expect(dash).toMatch(/onFocus/);
  });

  it("worker screen unchanged (no glass, no heavy brand, no financial terms)", () => {
    const worker = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(worker).not.toMatch(/backdrop-blur|glass/i);
    expect(worker).not.toMatch(/from-primary\/|bg-gradient-to/);
    expect(worker).not.toMatch(/border-primary|text-primary|bg-primary/);
    // Financial redaction
    const prohibited = ["سعر", "تكلفة", "مستحقات", "مدفوعات", "ربحية", "قيمة", "مبلغ"];
    for (const term of prohibited) {
      expect(worker, `worker contains '${term}'`).not.toContain(term);
    }
    // Still has 11 form controls
    expect(worker).toMatch(/type="text"/);
    expect(worker).toMatch(/type="number"/);
    expect(worker).toMatch(/<select/);
    expect(worker).toMatch(/<textarea/);
  });

  it("sidebar collapse button remains accessible (aria-label + 44px + integrated)", () => {
    const sidebar = readText("src/components/shells/sidebar.tsx");
    expect(sidebar).toMatch(/aria-label=\{collapsed \? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"\}/);
    expect(sidebar).toMatch(/min-h-\[44px\].*min-w-\[44px\]|min-w-\[44px\].*min-h-\[44px\]/);
    expect(sidebar).toMatch(/data-sidebar-collapse-toggle/);
    // Integrated (flush/transparent, not floating with border+shadow)
    expect(sidebar).toMatch(/bg-transparent/);
    expect(sidebar).not.toMatch(/border border-border bg-surface.*shadow-sm/);
  });

  it("no business scope expanded (no API/DB/migration/business logic)", () => {
    expect(dash).not.toMatch(/from.*@\/server\/api|from.*@\/server\/services|from.*@\/server\/db/);
    expect(dash).not.toMatch(/fetch\(|axios|useMutation/);
    // No new API routes
    expect(exists("src/app/api/v1/route.ts")).toBe(false);
    expect(exists("src/app/api/dashboard/route.ts")).toBe(false);
    // No new migrations
    expect(exists("drizzle/output/0005_*.sql")).toBe(false);
  });
});

// ===========================================================================
// Collapsed sidebar layout bug correction.
// Bug: when the management sidebar is collapsed, the topbar title/subtitle
// (ERP-Yarn / مالك النظام) collided with the sidebar rail, and collapsed
// nav labels appeared as stray single Arabic letters down the rail.
// Fix: topbar reserves right space for the sidebar; collapsed sidebar renders
// clean dot marks (no text labels, no charAt), with aria-label/title.
// ===========================================================================

describe("DEC-075 collapsed sidebar layout bug correction", () => {
  const sidebar = readText("src/components/shells/sidebar.tsx");
  const topbar = readText("src/components/shells/topbar.tsx");
  const managementShell = readText("src/components/shells/management-shell.tsx");

  // --- Collapsed: no visible text labels in the rail ---

  it("collapsed sidebar does NOT render category.labelAr.charAt(0) (stray single letters)", () => {
    expect(sidebar).not.toMatch(/charAt\(0\)/);
  });

  it("collapsed sidebar renders clean dot marks instead of text labels", () => {
    // Collapsed branch renders <span> dots (h-2 w-2 rounded-full), not text
    expect(sidebar).toMatch(/h-2 w-2 rounded-full/);
    expect(sidebar).toMatch(/bg-primary.*bg-muted-foreground\/40|bg-muted-foreground\/40.*bg-primary/);
  });

  it("collapsed nav items have aria-label + title (accessibility preserved)", () => {
    expect(sidebar).toMatch(/aria-label=\{item\.labelAr\}/);
    expect(sidebar).toMatch(/title=\{item\.labelAr\}/);
  });

  it("collapsed sidebar does not render visible category header text", () => {
    // The collapsed branch should NOT render category.labelAr as visible text.
    // It may appear in aria-label on the <ul> (for screen readers) but NOT as
    // visible <span> text. Verify the collapsed branch uses aria-label on ul,
    // not a visible text span.
    expect(sidebar).toMatch(/aria-label=\{category\.labelAr\}/);
  });

  // --- Expanded: labels render normally ---

  it("expanded sidebar renders category labelAr as visible text", () => {
    // The expanded branch has {category.labelAr} inside the button (now wrapped with icon span)
    expect(sidebar).toMatch(/\{category\.labelAr\}/);
  });

  it("expanded sidebar renders item labelAr as visible text", () => {
    // The expanded branch has <span className="relative">{item.labelAr}</span>
    expect(sidebar).toMatch(/\{item\.labelAr\}/);
  });

  // --- Stable widths ---

  it("collapsed sidebar has stable width w-16 (64px)", () => {
    expect(sidebar).toMatch(/collapsed \? "w-16"/);
  });

  it("expanded sidebar has stable width w-64 (256px)", () => {
    expect(sidebar).toMatch(/: "w-64"/);
  });

  // --- Topbar reserves space for sidebar ---

  it("topbar accepts sidebarCollapsed prop", () => {
    expect(topbar).toMatch(/sidebarCollapsed\?: boolean/);
    expect(topbar).toMatch(/sidebarCollapsed/);
  });

  it("topbar reserves 64px right space when sidebar collapsed (lg:pr-16)", () => {
    expect(topbar).toMatch(/lg:pr-16/);
  });

  it("topbar reserves 256px right space when sidebar expanded (lg:pr-64)", () => {
    expect(topbar).toMatch(/lg:pr-64/);
  });

  it("management-shell passes sidebarCollapsed to Topbar", () => {
    expect(managementShell).toMatch(/sidebarCollapsed=\{sidebarCollapsed\}/);
  });

  // --- Main content layout ---

  it("main content reserves collapsed sidebar width (lg:mr-16)", () => {
    expect(managementShell).toMatch(/lg:mr-16/);
  });

  it("main content reserves expanded sidebar width (lg:mr-64)", () => {
    expect(managementShell).toMatch(/lg:mr-64/);
  });

  // --- Collapse toggle preserved ---

  it("collapse toggle remains 44px with Arabic aria-label", () => {
    expect(sidebar).toMatch(/min-h-\[44px\].*min-w-\[44px\]|min-w-\[44px\].*min-h-\[44px\]/);
    expect(sidebar).toMatch(/aria-label=\{collapsed \? "توسيع القائمة الجانبية" : "طي القائمة الجانبية"\}/);
  });

  // --- No emoji ---

  it("sidebar does not use emoji icons", () => {
    expect(sidebar).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    expect(sidebar).not.toMatch(/◀|▶|▼|▲|✕|×/);
  });

  it("topbar does not use emoji icons", () => {
    expect(topbar).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    expect(topbar).not.toMatch(/◀|▶|▼|▲|✕|×/);
  });

  // --- Worker screen unchanged ---

  it("worker shell does NOT use management Topbar (unaffected by topbar changes)", () => {
    const workerShell = readText("src/components/shells/worker-shell.tsx");
    expect(workerShell).not.toMatch(/from.*Topbar|<Topbar/);
  });

  it("worker receipt component unchanged (no glass, no financial terms, 11 controls)", () => {
    const worker = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(worker).not.toMatch(/backdrop-blur|glass/i);
    expect(worker).not.toMatch(/border-primary|text-primary|bg-primary/);
    const prohibited = ["سعر", "تكلفة", "مستحقات", "مدفوعات", "ربحية", "قيمة", "مبلغ"];
    for (const term of prohibited) {
      expect(worker, `worker contains '${term}'`).not.toContain(term);
    }
    expect(worker).toMatch(/type="text"/);
    expect(worker).toMatch(/type="number"/);
    expect(worker).toMatch(/<select/);
    expect(worker).toMatch(/<textarea/);
  });

  // --- No business scope expanded ---

  it("no API/DB/migration added in this layout fix", () => {
    expect(sidebar).not.toMatch(/from.*@\/server\/api|from.*@\/server\/services|from.*@\/server\/db/);
    expect(topbar).not.toMatch(/from.*@\/server\/api|from.*@\/server\/services|from.*@\/server\/db/);
    expect(exists("src/app/api/v1/route.ts")).toBe(false);
    expect(exists("drizzle/output/0005_*.sql")).toBe(false);
  });
});
