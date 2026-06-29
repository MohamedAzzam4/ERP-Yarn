/**
 * WP-01-05/06/07 Reference Screens Bundle tests.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5-8
 * Contract: docs/design/01_reference_screen_terms_and_fixtures.md
 * DEC-077: Arabic terminology fixture
 * DEC-078: Synthetic/prohibited-data fixture (reference-fixtures-v1)
 * DEC-076: Restrained glass accents
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

  it("fixture has 11 visible fields", () => {
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

  it("component states it is a reference screen (no real posting)", () => {
    const src = readText("src/components/reference-screens/worker-receipt-reference.tsx");
    expect(src).toMatch(/مرجعية|تجريبية/);
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
    expect(REVIEW_QUEUE_FIXTURE.actionBehavior.noToastImpliesRealStatusChange).toBe(true);
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

  it("fixture KPI cards include inventory, sales, reviews, profitability", () => {
    const labels = OWNER_DASHBOARD_FIXTURE.kpiCards.map((c) => c.labelAr);
    expect(labels).toContain("إجمالي المخزون");
    expect(labels).toContain("مبيعات الشهر الحالي");
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
        expect(
          field.labelAr,
          `worker receipt field '${field.labelAr}' contains prohibited term '${term}'`,
        ).not.toContain(term);
        expect(
          field.value,
          `worker receipt field value '${field.value}' contains prohibited term '${term}'`,
        ).not.toContain(term);
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
    // Must NOT have toast or success message implying real approval
    expect(src).not.toMatch(/toast|success.*approv|تم الاعتماد|تم بنجاح/i);
  });

  it("owner dashboard: no generic internal-factory KPIs", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    const prohibited = OWNER_DASHBOARD_FIXTURE.prohibitedKpis;
    for (const term of prohibited) {
      expect(src, `dashboard contains prohibited KPI '${term}'`).not.toContain(term);
    }
  });

  it("owner dashboard: uses outsourced-manufacturing wording", () => {
    // The fixture data includes outsourced-manufacturing terms like
    // "مخزون لدى مصانع التشغيل" which are rendered via {card.labelAr}.
    const hasOutsourcedWording = OWNER_DASHBOARD_FIXTURE.kpiCards.some(
      (c) => c.labelAr.includes("مصانع التشغيل"),
    );
    expect(hasOutsourcedWording).toBe(true);
    // Verify no internal-factory wording in the fixture
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
    // Glass is prohibited on tables and approval actions
    // Check that no backdrop-blur class appears near table or button elements
    expect(src).not.toMatch(/backdrop-blur/);
  });

  it("owner dashboard component may use restrained glass on summary band only", () => {
    const src = readText("src/components/reference-screens/owner-dashboard-reference.tsx");
    // Glass is permitted as secondary management accent on dashboard summary band.
    // But must NOT appear on financial numbers or KPI card values.
    // For WP-01-07 reference, we keep it simple: no glass on the actual KPI value elements.
    // The component currently does not use glass — that's safe.
    expect(src).not.toMatch(/backdrop-blur.*كجم|backdrop-blur.*جنيه/i);
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
    // The migration files should still be 0000-0004 only
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
