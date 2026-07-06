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
    // Label was changed from "اختر المستخدم" to "فلترة حسب المستخدم" per correction
    expect(src).toContain("فلترة حسب المستخدم");
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
// Correction tests (added 2026-07-06)
// ---------------------------------------------------------------------------

describe("User activity — corrections (filter bar + alignment + no duplication)", () => {
  const pageSrc = readText("src/app/(demo)/demo/owner/user-activity/page.tsx");

  // 1. No duplicate selected-user text outside the dropdown
  it("does NOT render selected user name as separate text outside the dropdown", () => {
    // The old code had: {selectedUser && (<div>...{selectedUser.nameAr}...</div>)}
    // This should be removed — the user name only appears in the <select> + <option>
    expect(pageSrc).not.toContain("selectedUser.nameAr");
    expect(pageSrc).not.toContain("selectedUser.roleLabelAr");
    // The selectedUser variable itself should not be used for display
    expect(pageSrc).not.toMatch(/selectedUser\./);
  });

  // 2. Filter bar is compact + blue-tinted (not large white card)
  it("filter bar uses data-demo-filter-bar attribute for identification", () => {
    expect(pageSrc).toContain("data-demo-filter-bar");
  });

  it("filter bar uses blue-tinted background (bg-primary/5) + border-primary/15", () => {
    expect(pageSrc).toContain("bg-primary/5");
    expect(pageSrc).toContain("border-primary/15");
  });

  it("filter bar uses rounded-xl (not large card with shadow)", () => {
    expect(pageSrc).toContain("rounded-xl");
  });

  it("filter bar does NOT use a large Card component", () => {
    // The filter bar should be a plain <div>, not wrapped in <Card>
    // Check that the filter bar section doesn't start with <Card
    const filterBarMatch = pageSrc.match(/data-demo-filter-bar[\s\S]*?<\/div>/);
    expect(filterBarMatch).not.toBeNull();
    // The filter bar div should not be inside a <Card> wrapper
    expect(pageSrc).not.toMatch(/<Card[^>]*>[\s\S]*?data-demo-filter-bar/);
  });

  it("filter bar label is 'فلترة حسب المستخدم' (not 'اختر المستخدم')", () => {
    expect(pageSrc).toContain("فلترة حسب المستخدم");
  });

  // 3. Table title is "سجل النشاط" + muted subtitle (no user name duplication)
  it("table title is 'سجل النشاط' without appending the selected user name", () => {
    expect(pageSrc).toContain(">سجل النشاط<");
    // Should NOT contain the old pattern: سجل النشاط — {selectedUser?.nameAr}
    expect(pageSrc).not.toContain("سجل النشاط — {selectedUser");
  });

  it("table has muted subtitle 'يعرض العمليات الخاصة بالمستخدم المحدد'", () => {
    expect(pageSrc).toContain("يعرض العمليات الخاصة بالمستخدم المحدد");
  });

  // 4. Numeric/date values right-aligned in RTL with LTR isolation
  it("summary cards use text-right alignment for numeric values", () => {
    expect(pageSrc).toContain("text-right");
  });

  it("summary card numeric values use LtrValue with inline-block", () => {
    expect(pageSrc).toContain('<LtrValue className="inline-block">');
  });

  it("date/time table cells use text-right alignment", () => {
    // The date/time cell should have text-right on the <td>
    expect(pageSrc).toMatch(/<td[^>]*text-right[^>]*>[\s\S]*?act\.dateTime/);
  });

  it("date/time values use LtrValue for LTR isolation", () => {
    expect(pageSrc).toContain('<LtrValue className="inline-block text-muted-foreground">{act.dateTime}</LtrValue>');
  });

  it("document reference cells use text-right alignment", () => {
    expect(pageSrc).toMatch(/<td[^>]*text-right[^>]*>[\s\S]*?act\.documentRef/);
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
