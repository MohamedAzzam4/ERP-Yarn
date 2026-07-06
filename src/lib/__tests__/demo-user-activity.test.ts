/**
 * Tests for user activity history page (added 2026-07-06).
 *
 * Verifies:
 *   - سجل نشاط المستخدمين page exists
 *   - It is visible to executive/accountant navigation (in sidebar التقارير)
 *   - It is NOT visible in data-entry task hub
 *   - User selector exists
 *   - Fixture activities are filterable by user
 *   - Summary counts derive from selected user fixture data
 *   - No API/database mutation is introduced
 *   - main branch untouched
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DEMO_ACTIVITY_USERS,
  DEMO_USER_ACTIVITIES,
  getActivitiesByUser,
  getActivitySummaryByUser,
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
// Page existence
// ---------------------------------------------------------------------------

describe("User activity — page exists", () => {
  it("user-activity page exists at /demo/owner/user-activity", () => {
    expect(fileExists("src/app/(demo)/demo/owner/user-activity/page.tsx")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Navigation visibility
// ---------------------------------------------------------------------------

describe("User activity — navigation", () => {
  it("سجل نشاط المستخدمين is in التقارير category", () => {
    const reports = DEMO_NAV_CATEGORIES.find((c: { id: string }) => c.id === "reports");
    expect(reports).toBeDefined();
    const hrefs = reports!.items.map((i: { href: string }) => i.href);
    expect(hrefs).toContain("/demo/owner/user-activity");
  });

  it("nav label is 'سجل نشاط المستخدمين'", () => {
    const reports = DEMO_NAV_CATEGORIES.find((c: { id: string }) => c.id === "reports");
    const item = reports!.items.find((i: { href: string }) => i.href === "/demo/owner/user-activity");
    expect(item).toBeDefined();
    expect(item!.labelAr).toBe("سجل نشاط المستخدمين");
  });

  it("user-activity is NOT in the data-entry task hub (4 cards only)", () => {
    const src = readText("src/app/(demo)/demo/data-entry/page.tsx");
    expect(src).not.toContain("/demo/owner/user-activity");
    expect(src).not.toContain("سجل نشاط المستخدمين");
  });

  it("user-activity is NOT in the operations/input category", () => {
    const operations = DEMO_NAV_CATEGORIES.find((c: { id: string }) => c.id === "operations");
    if (operations) {
      const hrefs = operations.items.map((i: { href: string }) => i.href);
      expect(hrefs).not.toContain("/demo/owner/user-activity");
    }
  });
});

// ---------------------------------------------------------------------------
// User selector
// ---------------------------------------------------------------------------

describe("User activity — user selector", () => {
  it("page has a user selector dropdown", () => {
    const src = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");
    expect(src).toContain("اختر المستخدم");
    expect(src).toContain("<select");
    expect(src).toContain("selectedUserId");
  });

  it("page uses DEMO_ACTIVITY_USERS for the selector options", () => {
    const src = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");
    expect(src).toContain("DEMO_ACTIVITY_USERS");
  });
});

// ---------------------------------------------------------------------------
// Fixture data — filterable by user
// ---------------------------------------------------------------------------

describe("User activity — fixture filtering", () => {
  it("DEMO_ACTIVITY_USERS has exactly 4 users", () => {
    expect(DEMO_ACTIVITY_USERS.length).toBe(4);
  });

  it("DEMO_ACTIVITY_USERS includes the required names", () => {
    const names = DEMO_ACTIVITY_USERS.map((u) => u.nameAr);
    expect(names).toContain("أحمد فتحي");
    expect(names).toContain("محمد عباسي");
    expect(names).toContain("المدير المالي");
    expect(names).toContain("رئيس مجلس الإدارة");
  });

  it("getActivitiesByUser returns only activities for the specified user", () => {
    const ahmedActivities = getActivitiesByUser("ahmed-fathy");
    expect(ahmedActivities.length).toBeGreaterThan(0);
    expect(ahmedActivities.every((a) => a.userId === "ahmed-fathy")).toBe(true);

    const accountantActivities = getActivitiesByUser("accountant");
    expect(accountantActivities.length).toBeGreaterThan(0);
    expect(accountantActivities.every((a) => a.userId === "accountant")).toBe(true);
  });

  it("getActivitiesByUser returns empty array for unknown user", () => {
    const unknown = getActivitiesByUser("nonexistent-user");
    expect(unknown.length).toBe(0);
  });

  it("DEMO_USER_ACTIVITIES has activities for all 4 users", () => {
    const userIds = new Set(DEMO_USER_ACTIVITIES.map((a) => a.userId));
    expect(userIds.has("ahmed-fathy")).toBe(true);
    expect(userIds.has("mohamed-abbasi")).toBe(true);
    expect(userIds.has("accountant")).toBe(true);
    expect(userIds.has("executive")).toBe(true);
  });

  it("fixture activities include the required operation types", () => {
    const types = DEMO_USER_ACTIVITIES.map((a) => a.operationTypeAr);
    expect(types).toContain("إنشاء مسودة شراء خامات");
    expect(types).toContain("إرسال بيانات بيع خيوط للمراجعة");
    expect(types).toContain("تعديل حركة خيوط");
    expect(types).toContain("إضافة قيمة غير موجودة بالقائمة: مصنع جديد");
    expect(types).toContain("حفظ مسودة تشغيل خيوط لدى الشركات");
    expect(types).toContain("إرسال إدخال تشغيل للمراجعة");
  });
});

// ---------------------------------------------------------------------------
// Summary counts derived from fixture data
// ---------------------------------------------------------------------------

describe("User activity — summary counts", () => {
  it("getActivitySummaryByUser returns correct total count", () => {
    const ahmedSummary = getActivitySummaryByUser("ahmed-fathy");
    const ahmedActivities = getActivitiesByUser("ahmed-fathy");
    expect(ahmedSummary.total).toBe(ahmedActivities.length);
  });

  it("summary drafts count matches fixture data", () => {
    const ahmedSummary = getActivitySummaryByUser("ahmed-fathy");
    const ahmedDrafts = getActivitiesByUser("ahmed-fathy").filter((a) => a.status === "draft");
    expect(ahmedSummary.drafts).toBe(ahmedDrafts.length);
  });

  it("summary submitted count matches fixture data", () => {
    const accountantSummary = getActivitySummaryByUser("accountant");
    const accountantSubmitted = getActivitiesByUser("accountant").filter((a) => a.status === "submitted");
    expect(accountantSummary.submitted).toBe(accountantSubmitted.length);
  });

  it("summary needsEdit count matches fixture data", () => {
    const ahmedSummary = getActivitySummaryByUser("ahmed-fathy");
    const ahmedNeedsEdit = getActivitiesByUser("ahmed-fathy").filter((a) => a.status === "needs_edit");
    expect(ahmedSummary.needsEdit).toBe(ahmedNeedsEdit.length);
  });

  it("summary lastActivity is the first activity's dateTime", () => {
    const ahmedSummary = getActivitySummaryByUser("ahmed-fathy");
    const ahmedActivities = getActivitiesByUser("ahmed-fathy");
    expect(ahmedSummary.lastActivity).toBe(ahmedActivities[0]!.dateTime);
  });

  it("page renders 5 summary cards (إجمالي العمليات, مسودات, مرسل للمراجعة, يحتاج تعديل, آخر نشاط)", () => {
    const src = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");
    expect(src).toContain("إجمالي العمليات");
    expect(src).toContain("مسودات");
    expect(src).toContain("مرسل للمراجعة");
    expect(src).toContain("يحتاج تعديل");
    expect(src).toContain("آخر نشاط");
  });
});

// ---------------------------------------------------------------------------
// Page content — compact heading + helper note
// ---------------------------------------------------------------------------

describe("User activity — page content", () => {
  it("uses DemoCompactHeading (not DemoPageHeader)", () => {
    const src = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");
    expect(src).toContain("DemoCompactHeading");
    expect(src).not.toContain("DemoPageHeader");
  });

  it("includes helper note about demo data", () => {
    const src = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");
    expect(src).toContain("بيانات تجريبية للعرض — لا تمثل سجل تدقيق حقيقي");
  });

  it("activity table has the required columns", () => {
    const src = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");
    expect(src).toContain("التاريخ والوقت");
    expect(src).toContain("نوع العملية");
    expect(src).toContain("المستند / الرقم المرجعي");
    expect(src).toContain("القسم");
    expect(src).toContain("الحالة");
    expect(src).toContain("ملاحظة مختصرة");
  });
});

// ---------------------------------------------------------------------------
// No API/database mutation
// ---------------------------------------------------------------------------

describe("User activity — no mutation", () => {
  it("page has no API/DB calls", () => {
    const src = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/useMutation/);
    expect(src).not.toMatch(/useSWR/);
    expect(src).not.toMatch(/useQuery/);
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/createClient/);
  });

  it("fixtures have no API/DB imports", () => {
    const src = readText("src/lib/fixtures/demo-fixtures.ts");
    // The fixture helpers (getActivitiesByUser, getActivitySummaryByUser) are pure functions
    expect(src).not.toMatch(/import.*supabase/i);
    expect(src).not.toMatch(/createClient/);
  });
});

// ---------------------------------------------------------------------------
// Main branch untouched
// ---------------------------------------------------------------------------

describe("User activity — main untouched", () => {
  it("real nav-config.ts is NOT modified (no user-activity route)", () => {
    const src = readText("src/components/shells/nav-config.ts");
    expect(src).not.toContain("/demo/owner/user-activity");
    expect(src).not.toContain("سجل نشاط المستخدمين");
  });
});
