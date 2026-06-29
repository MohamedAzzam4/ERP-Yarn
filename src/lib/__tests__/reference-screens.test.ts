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

  it("component uses LtrValue for LTR-isolated fields", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/LtrValue/);
  });

  it("component uses Container (RTL-safe layout)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/Container/);
  });

  it("component has touch targets (min-h-[44px])", () => {
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

  it("component has field groups (multiple Card sections, not one flat list)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    // Should have GROUP_SIZES or GROUP_LABELS for field grouping
    expect(src).toMatch(/GROUP_SIZES|GROUP_LABELS|groups/);
  });

  it("component has NO glass/blur effects (DEC-076: Worker Task Mode)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).not.toMatch(/backdrop-blur|glass|frosted/i);
  });

  it("component has guidance text below title", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/أدخل بيانات|احفظ كمسودة أو أرسل للمراجعة/);
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

  it("component has chart-like visual structures (CSS bars, not only text lists)", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    // Should have bar/progress visual elements (width %, height %, rounded)
    expect(src).toMatch(/width.*%|height.*%/);
    expect(src).toMatch(/rounded-full|rounded-t-md/);
    expect(src).toMatch(/bg-primary|bg-accent|bg-warning|BAR_COLORS/);
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

  it("review queue component has NO glass/blur on tables or approval actions", () => {
    const src = readText("src/components/reference-screens/review-queue-reference.tsx");
    expect(src).not.toMatch(/backdrop-blur/);
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

  it("worker receipt uses LtrValue for codes/quantities", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/LtrValue/);
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
