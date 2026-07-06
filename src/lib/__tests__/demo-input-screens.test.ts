/**
 * Tests for the 4 grouped input destinations (restructured 2026-07-06).
 *
 * Verifies:
 *   - The four main input destinations exist as route files
 *   - Purchase page has raw/yarn tab switch
 *   - Sales page has raw/yarn tab switch
 *   - Operation page has spinning/twisting tab switch
 *   - Movement page exists
 *   - Required Arabic labels render in the fixtures
 *   - No real API/database mutation is introduced (no fetch/useMutation/useSWR)
 *   - Buttons are demo-only (type="button", no type="submit")
 *   - Old input routes redirect to the new grouped pages
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  PURCHASE_RAW_SECTIONS,
  PURCHASE_YARN_SECTIONS,
  SALES_RAW_SECTIONS,
  SALES_YARN_SECTIONS,
  OPERATION_SPINNING_SECTIONS,
  OPERATION_TWISTING_SECTIONS,
  YARN_MOVEMENT_SECTIONS,
} from "@/lib/fixtures/demo-fixtures";
import { DEMO_NAV_CATEGORIES } from "@/components/demo/demo-nav-config";

const root = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

function fileExists(rel: string): boolean {
  return existsSync(join(root, rel));
}

// ---------------------------------------------------------------------------
// Route existence
// ---------------------------------------------------------------------------

describe("Demo input screens — route existence", () => {
  it("purchase page exists at /demo/owner/purchase", () => {
    expect(fileExists("src/app/(demo)/demo/owner/purchase/page.tsx")).toBe(true);
  });

  it("sales-entry page exists at /demo/owner/sales-entry", () => {
    expect(fileExists("src/app/(demo)/demo/owner/sales-entry/page.tsx")).toBe(true);
  });

  it("operation page exists at /demo/owner/operation", () => {
    expect(fileExists("src/app/(demo)/demo/owner/operation/page.tsx")).toBe(true);
  });

  it("yarn-movement page exists at /demo/owner/yarn-movement", () => {
    expect(fileExists("src/app/(demo)/demo/owner/yarn-movement/page.tsx")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tab switches
// ---------------------------------------------------------------------------

describe("Demo input screens — tab switches", () => {
  it("purchase page has شراء خامات / شراء خيوط tabs", () => {
    const src = readText("src/app/(demo)/demo/owner/purchase/page.tsx");
    expect(src).toContain("شراء خامات");
    expect(src).toContain("شراء خيوط");
    expect(src).toContain("DemoSegmentedTabs");
  });

  it("sales-entry page has بيع خامات / بيع خيوط tabs", () => {
    const src = readText("src/app/(demo)/demo/owner/sales-entry/page.tsx");
    expect(src).toContain("بيع خامات");
    expect(src).toContain("بيع خيوط");
    expect(src).toContain("DemoSegmentedTabs");
  });

  it("operation page has تشغيل / زوي tabs", () => {
    const src = readText("src/app/(demo)/demo/owner/operation/page.tsx");
    expect(src).toContain("تشغيل خيوط لدى الشركات");
    expect(src).toContain("زوي خيوط لدى شركات");
    expect(src).toContain("DemoSegmentedTabs");
  });

  it("yarn-movement page is standalone (no tabs)", () => {
    const src = readText("src/app/(demo)/demo/owner/yarn-movement/page.tsx");
    expect(src).not.toContain("DemoSegmentedTabs");
  });
});

// ---------------------------------------------------------------------------
// Required Arabic labels in fixtures
// ---------------------------------------------------------------------------

describe("Demo input screens — required Arabic field labels", () => {
  // Collect all field labels from all 7 form variants
  const allFields = [
    ...PURCHASE_RAW_SECTIONS,
    ...PURCHASE_YARN_SECTIONS,
    ...SALES_RAW_SECTIONS,
    ...SALES_YARN_SECTIONS,
    ...OPERATION_SPINNING_SECTIONS,
    ...OPERATION_TWISTING_SECTIONS,
    ...YARN_MOVEMENT_SECTIONS,
  ].flatMap((s) => s.fields.map((f) => f.labelAr));

  it("purchase raw includes سعر الطن and إجمالي سعر الرسالة", () => {
    const labels = PURCHASE_RAW_SECTIONS.flatMap((s) => s.fields.map((f) => f.labelAr));
    expect(labels).toContain("سعر الطن");
    expect(labels).toContain("إجمالي سعر الرسالة");
  });

  it("purchase yarn includes نمرة الخيط and معامل برم الخيط", () => {
    const labels = PURCHASE_YARN_SECTIONS.flatMap((s) => s.fields.map((f) => f.labelAr));
    expect(labels).toContain("نمرة الخيط");
    expect(labels).toContain("معامل برم الخيط");
  });

  it("sales raw includes مدفوع مقدم and باقي", () => {
    const labels = SALES_RAW_SECTIONS.flatMap((s) => s.fields.map((f) => f.labelAr));
    expect(labels).toContain("مدفوع مقدم");
    expect(labels).toContain("باقي");
  });

  it("sales yarn includes معامل برم الفرد and مصنع إنتاج الزوي", () => {
    const labels = SALES_YARN_SECTIONS.flatMap((s) => s.fields.map((f) => f.labelAr));
    expect(labels).toContain("معامل برم الفرد");
    expect(labels).toContain("مصنع إنتاج الزوي / الشركة المنتجة للزوي");
  });

  it("operation spinning includes نسبة العادم and وزن الخيط الفعلي للفرد", () => {
    const labels = OPERATION_SPINNING_SECTIONS.flatMap((s) => s.fields.map((f) => f.labelAr));
    expect(labels).toContain("نسبة العادم");
    expect(labels).toContain("وزن الخيط الفعلي للفرد");
  });

  it("operation twisting includes وزن الخيط الزوي الفعلي and مصنع الزوي", () => {
    const labels = OPERATION_TWISTING_SECTIONS.flatMap((s) => s.fields.map((f) => f.labelAr));
    expect(labels).toContain("وزن الخيط الزوي الفعلي");
    expect(labels).toContain("مصنع الزوي");
  });

  it("yarn movement includes جهة النقل and الغرض من النقل", () => {
    const labels = YARN_MOVEMENT_SECTIONS.flatMap((s) => s.fields.map((f) => f.labelAr));
    expect(labels).toContain("جهة النقل");
    expect(labels).toContain("الغرض من النقل");
  });

  it("all field labels are non-empty Arabic strings", () => {
    for (const label of allFields) {
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(2);
    }
  });
});

// ---------------------------------------------------------------------------
// No real API/database mutation
// ---------------------------------------------------------------------------

describe("Demo input screens — no real mutation", () => {
  const inputPages = [
    "src/app/(demo)/demo/owner/purchase/page.tsx",
    "src/app/(demo)/demo/owner/sales-entry/page.tsx",
    "src/app/(demo)/demo/owner/operation/page.tsx",
    "src/app/(demo)/demo/owner/yarn-movement/page.tsx",
    "src/components/demo/demo-form-shared.tsx",
  ];

  for (const page of inputPages) {
    it(`${page} has no fetch/useMutation/useSWR/useQuery`, () => {
      const src = readText(page);
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/useMutation/);
      expect(src).not.toMatch(/useSWR/);
      expect(src).not.toMatch(/useQuery/);
      expect(src).not.toMatch(/supabase/i);
      expect(src).not.toMatch(/createClient/);
    });
  }

  it("form shared component buttons are type='button' (no type='submit')", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toContain('type="button"');
    expect(src).not.toMatch(/type="submit"/);
  });

  for (const page of inputPages.slice(0, 4)) {
    it(`${page} has no type="submit"`, () => {
      const src = readText(page);
      expect(src).not.toMatch(/type="submit"/);
    });
  }
});

// ---------------------------------------------------------------------------
// Old input routes redirect to new grouped pages
// ---------------------------------------------------------------------------

describe("Demo input screens — old routes redirect", () => {
  it("yarn-entry redirects to /demo/owner/purchase", () => {
    const src = readText("src/app/(demo)/demo/owner/yarn-entry/page.tsx");
    expect(src).toContain('redirect');
    expect(src).toContain("/demo/owner/purchase");
  });

  it("raw-receipt redirects to /demo/owner/purchase", () => {
    const src = readText("src/app/(demo)/demo/worker/raw-receipt/page.tsx");
    expect(src).toContain('redirect');
    expect(src).toContain("/demo/owner/purchase");
  });
});

// ---------------------------------------------------------------------------
// Sidebar navigation structure
// ---------------------------------------------------------------------------

describe("Demo input screens — sidebar structure", () => {
  it("العمليات category contains only the 4 grouped input pages", () => {
    const operations = DEMO_NAV_CATEGORIES.find((c: { id: string }) => c.id === "operations");
    expect(operations).toBeDefined();
    expect(operations!.items.map((i: { href: string }) => i.href)).toEqual([
      "/demo/owner/purchase",
      "/demo/owner/sales-entry",
      "/demo/owner/operation",
      "/demo/owner/yarn-movement",
    ]);
  });

  it("sidebar does NOT contain old input entries", () => {
    const allHrefs = DEMO_NAV_CATEGORIES.flatMap((c: { items: ReadonlyArray<{ href: string }> }) =>
      c.items.map((i: { href: string }) => i.href),
    );
    expect(allHrefs).not.toContain("/demo/owner/yarn-entry");
    expect(allHrefs).not.toContain("/demo/worker/raw-receipt");
    expect(allHrefs).not.toContain("/demo/owner/production");
  });

  it("نظرات عامة category exists with overview pages", () => {
    const overviews = DEMO_NAV_CATEGORIES.find((c: { id: string }) => c.id === "overviews");
    expect(overviews).toBeDefined();
    expect(overviews!.items.length).toBeGreaterThanOrEqual(2);
  });

  it("input section (operations) is the LAST category in the sidebar", () => {
    const lastCategory = DEMO_NAV_CATEGORIES[DEMO_NAV_CATEGORIES.length - 1];
    expect(lastCategory!.id).toBe("operations");
  });

  it("sidebar order: dashboard → overviews → master-data → reports → operations", () => {
    const ids = DEMO_NAV_CATEGORIES.map((c: { id: string }) => c.id);
    expect(ids).toEqual(["dashboard", "overviews", "master-data", "reports", "operations"]);
  });
});

// ---------------------------------------------------------------------------
// No pre-entry summary/KPI cards on input pages
// ---------------------------------------------------------------------------

describe("Demo input screens — no pre-entry summary cards", () => {
  const inputPages = [
    "src/app/(demo)/demo/owner/purchase/page.tsx",
    "src/app/(demo)/demo/owner/sales-entry/page.tsx",
    "src/app/(demo)/demo/owner/operation/page.tsx",
    "src/app/(demo)/demo/owner/yarn-movement/page.tsx",
  ];

  for (const page of inputPages) {
    it(`${page} does not render DemoSummaryCard`, () => {
      const src = readText(page);
      // Must not import or render the DemoSummaryCard component
      expect(src).not.toMatch(/DemoSummaryCard/);
    });
  }

  it("input pages use DemoFormLayout (narrow centered layout)", () => {
    for (const page of inputPages) {
      const src = readText(page);
      expect(src).toContain("DemoFormLayout");
    }
  });
});

// ---------------------------------------------------------------------------
// Review confirmation modal
// ---------------------------------------------------------------------------

describe("Demo input screens — review confirmation modal", () => {
  it("DemoReviewModal component exists in demo-form-shared.tsx", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toContain("DemoReviewModal");
    expect(src).toContain("مراجعة سريعة قبل الحفظ");
    expect(src).toContain("مراجعة سريعة قبل الإرسال");
  });

  it("DemoReviewModal has رجوع للتعديل and تأكيد actions", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toContain("رجوع للتعديل");
    expect(src).toContain("تأكيد حفظ المسودة");
    expect(src).toContain("تأكيد الإرسال للمراجعة");
  });

  it("DemoActionButtons opens review modal before processing", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toContain("openReview");
    expect(src).toContain("reviewOpen");
    expect(src).toContain("DemoReviewModal");
  });

  it("DemoActionButtons requires sections prop (to show review)", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toMatch(/sections.*DemoFormSection/);
  });

  it("all 4 input pages pass sections to DemoActionButtons", () => {
    const inputPages = [
      "src/app/(demo)/demo/owner/purchase/page.tsx",
      "src/app/(demo)/demo/owner/sales-entry/page.tsx",
      "src/app/(demo)/demo/owner/operation/page.tsx",
      "src/app/(demo)/demo/owner/yarn-movement/page.tsx",
    ];
    for (const page of inputPages) {
      const src = readText(page);
      expect(src).toContain("DemoActionButtons sections={");
    }
  });

  it("review modal has no real API/DB calls", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/useMutation/);
    expect(src).not.toMatch(/supabase/i);
  });

  it("demo helper text remains in review modal", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toContain("شاشة تجريبية للعرض — لا يتم تسجيل أو ترحيل أي بيانات");
  });
});
