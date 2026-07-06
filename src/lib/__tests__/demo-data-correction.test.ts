/**
 * Tests for demo data correction + dropdown "غير موجود بالقائمة" behavior
 * + compact page headings (added 2026-07-06).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEMO_CUSTOMERS,
  DEMO_TWISTING_FACTORIES,
  DEMO_YARN_COMPANIES,
  DEMO_SUPPLIERS,
  DEMO_RAW_TYPES,
  DEMO_RAW_GRADES,
  DEMO_YARN_TYPES,
  DEMO_YARN_COUNTS,
  DEMO_STORAGE_LOCATIONS,
  DEMO_COUNTRIES,
  DEMO_CONE_COLORS,
  DEMO_TRANSFER_PURPOSES,
  DEMO_PARTIES,
  DEMO_YARN_STOCK,
  DEMO_PRODUCTION_ORDERS,
  DEMO_SALES_ORDERS,
  DEMO_CUSTOMER_BALANCES,
  DEMO_DASHBOARD_FACTORY_BALANCES,
  PURCHASE_RAW_SECTIONS,
  PURCHASE_YARN_SECTIONS,
  SALES_RAW_SECTIONS,
  SALES_YARN_SECTIONS,
  OPERATION_SPINNING_SECTIONS,
  OPERATION_TWISTING_SECTIONS,
  YARN_MOVEMENT_SECTIONS,
} from "@/lib/fixtures/demo-fixtures";

const root = process.cwd();

function readText(rel: string): string {
  return readFileSync(join(root, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// Stakeholder-approved names exist in fixtures
// ---------------------------------------------------------------------------

describe("Demo data — stakeholder-approved names", () => {
  it("DEMO_CUSTOMERS contains all 11 approved customer names", () => {
    expect(DEMO_CUSTOMERS).toContain("أحمد فتحي");
    expect(DEMO_CUSTOMERS).toContain("حمدي عبد المنصف");
    expect(DEMO_CUSTOMERS).toContain("مأمون النجار");
    expect(DEMO_CUSTOMERS).toContain("محمد عباسي");
    expect(DEMO_CUSTOMERS).toContain("محمود الغوطي");
    expect(DEMO_CUSTOMERS).toContain("محمد الجمل");
    expect(DEMO_CUSTOMERS).toContain("أحمد الجمل");
    expect(DEMO_CUSTOMERS).toContain("مرسي البكري");
    expect(DEMO_CUSTOMERS).toContain("حمودة");
    expect(DEMO_CUSTOMERS).toContain("البرلسي");
    expect(DEMO_CUSTOMERS).toContain("السهيلي");
    expect(DEMO_CUSTOMERS.length).toBe(11);
  });

  it("DEMO_TWISTING_FACTORIES contains the 2 approved twisting factories", () => {
    expect(DEMO_TWISTING_FACTORIES).toContain("مصنع أبو قمر");
    expect(DEMO_TWISTING_FACTORIES).toContain("مصنع النور");
    expect(DEMO_TWISTING_FACTORIES.length).toBe(2);
  });

  it("DEMO_YARN_COMPANIES contains all 5 approved yarn companies", () => {
    expect(DEMO_YARN_COMPANIES).toContain("شركة مصر إيران");
    expect(DEMO_YARN_COMPANIES).toContain("شركة الدلتا");
    expect(DEMO_YARN_COMPANIES).toContain("شركة شبين");
    expect(DEMO_YARN_COMPANIES).toContain("شركة الدقهلية");
    expect(DEMO_YARN_COMPANIES).toContain("شركة الوجه القبلي");
    expect(DEMO_YARN_COMPANIES.length).toBe(5);
  });

  it("DEMO_PARTIES uses approved names (no old names)", () => {
    const allNames = DEMO_PARTIES.map((p) => p.nameAr);
    // Must contain approved names
    expect(allNames).toContain("شركة مصر إيران");
    expect(allNames).toContain("مصنع أبو قمر");
    expect(allNames).toContain("محمد عباسي");
    // Must NOT contain old names
    expect(allNames).not.toContain("عثمان");
    expect(allNames).not.toContain("كارجيل");
    expect(allNames).not.toContain("عميل النسيج");
    expect(allNames).not.toContain("مصنع الغزال");
    expect(allNames).not.toContain("زوى عبدالحميد");
    expect(allNames).not.toContain("زوى ابوقمر");
  });

  it("DEMO_YARN_STOCK uses approved company names", () => {
    const companies = DEMO_YARN_STOCK.map((r) => r.companyAr);
    expect(companies).toContain("شركة مصر إيران");
    expect(companies).toContain("شركة الدلتا");
    expect(companies).toContain("شركة شبين");
    // Must NOT contain old names
    expect(companies).not.toContain("قمح دلتا");
    expect(companies).not.toContain("نسر النيل");
    expect(companies).not.toContain("غزل الشرق");
    expect(companies).not.toContain("خيوط الواحة");
  });

  it("DEMO_PRODUCTION_ORDERS uses approved factory names", () => {
    const factories = DEMO_PRODUCTION_ORDERS.map((o) => o.factoryNameAr);
    expect(factories).toContain("شركة مصر إيران");
    expect(factories).toContain("مصنع أبو قمر");
    expect(factories).toContain("مصنع النور");
    // Must NOT contain old names
    expect(factories).not.toContain("مصر ايران");
    expect(factories).not.toContain("زوى عبدالحميد");
    expect(factories).not.toContain("زوى ابوقمر");
  });

  it("DEMO_SALES_ORDERS uses approved customer names", () => {
    const customers = DEMO_SALES_ORDERS.map((o) => o.customerNameAr);
    expect(customers).toContain("محمد عباسي");
    expect(customers).toContain("محمود الغوطي");
    expect(customers).toContain("أحمد الجمل");
    // Must NOT contain old names
    expect(customers).not.toContain("عميل النسيج");
    expect(customers).not.toContain("مصنع الغزال");
  });

  it("DEMO_DASHBOARD_FACTORY_BALANCES uses approved factory names", () => {
    const factories = DEMO_DASHBOARD_FACTORY_BALANCES.map((f) => f.factoryNameAr);
    expect(factories).toContain("شركة مصر إيران");
    expect(factories).toContain("مصنع أبو قمر");
    expect(factories).toContain("مصنع النور");
  });
});

// ---------------------------------------------------------------------------
// "غير موجود بالقائمة" dropdown behavior
// ---------------------------------------------------------------------------

describe("Demo dropdowns — غير موجود بالقائمة behavior", () => {
  // Collect all select fields from all 7 form variants
  const allForms = [
    ...PURCHASE_RAW_SECTIONS,
    ...PURCHASE_YARN_SECTIONS,
    ...SALES_RAW_SECTIONS,
    ...SALES_YARN_SECTIONS,
    ...OPERATION_SPINNING_SECTIONS,
    ...OPERATION_TWISTING_SECTIONS,
    ...YARN_MOVEMENT_SECTIONS,
  ];
  const allSelectFields = allForms.flatMap((s) => s.fields.filter((f) => f.type === "select"));

  it("every select field has customLabelAr", () => {
    for (const field of allSelectFields) {
      expect(field.customLabelAr).toBeTruthy();
      expect(field.customLabelAr!.length).toBeGreaterThan(3);
    }
  });

  it("custom labels are context-specific (not generic)", () => {
    // Every custom label should start with "اكتب" and contain a meaningful noun
    for (const field of allSelectFields) {
      expect(field.customLabelAr).toMatch(/^اكتب\s+.+/);
    }
  });

  it("DemoField component implements غير موجود بالقائمة behavior", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toContain("غير موجود بالقائمة");
    expect(src).toContain("NOT_IN_LIST_VALUE");
    expect(src).toContain("showCustom");
    expect(src).toContain("customLabelAr");
  });

  it("DemoField shows inline extra field when غير موجود بالقائمة is selected", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    // The component should conditionally render an extra input when showCustom is true
    expect(src).toContain("{showCustom &&");
    // The extra field should have helper text about مراجعة
    expect(src).toContain("سيتم إرسال القيمة الجديدة للمراجعة قبل اعتمادها في القوائم");
  });

  it("DemoReviewModal shows custom value hints for select fields", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).toContain("customLabelAr");
    expect(src).toContain("غير موجود بالقائمة");
  });

  it("no old option value 'غير موجود في القائمة' (old spelling) remains", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).not.toContain("غير موجود في القائمة");
  });
});

// ---------------------------------------------------------------------------
// Compact page headings
// ---------------------------------------------------------------------------

describe("Demo compact headings — content pages use DemoCompactHeading", () => {
  const contentPages = [
    "src/app/(demo)/demo/owner/dashboard/page.tsx",
    "src/app/(demo)/demo/owner/reviews/page.tsx",
    "src/app/(demo)/demo/owner/inventory/page.tsx",
    "src/app/(demo)/demo/owner/sales/page.tsx",
    "src/app/(demo)/demo/owner/parties/page.tsx",
    "src/app/(demo)/demo/owner/activity/page.tsx",
    "src/app/(demo)/demo/owner/production/page.tsx",
  ];

  for (const page of contentPages) {
    it(`${page} uses DemoCompactHeading (not DemoPageHeader)`, () => {
      const src = readText(page);
      expect(src).toContain("DemoCompactHeading");
      expect(src).not.toContain("DemoPageHeader");
    });
  }

  it("DemoCompactHeading component exists in demo-charts.tsx", () => {
    const src = readText("src/components/demo/demo-charts.tsx");
    expect(src).toContain("export function DemoCompactHeading");
  });

  it("DemoCompactHeading does NOT use glass/gradient container", () => {
    const src = readText("src/components/demo/demo-charts.tsx");
    // Find the DemoCompactHeading function and verify it doesn't use glass classes
    const match = src.match(/export function DemoCompactHeading[\s\S]*?^}/m);
    expect(match).not.toBeNull();
    const componentSrc = match![0];
    expect(componentSrc).not.toContain("backdrop-blur");
    expect(componentSrc).not.toContain("bg-gradient");
    expect(componentSrc).not.toContain("shadow-sm");
    expect(componentSrc).not.toContain("rounded-2xl");
  });
});

// ---------------------------------------------------------------------------
// No API/database mutation
// ---------------------------------------------------------------------------

describe("Demo data correction — no mutation", () => {
  it("demo-form-shared.tsx has no API/DB calls", () => {
    const src = readText("src/components/demo/demo-form-shared.tsx");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/useMutation/);
    expect(src).not.toMatch(/supabase/i);
  });

  it("fixtures file has no API/DB imports", () => {
    const src = readText("src/lib/fixtures/demo-fixtures.ts");
    expect(src).not.toMatch(/from ["']@\/server\/db/);
    expect(src).not.toMatch(/from ["']@\/server\/services/);
    // Check for actual supabase import/usage (not comments mentioning the word)
    expect(src).not.toMatch(/import.*supabase/i);
    expect(src).not.toMatch(/createClient/);
  });
});
