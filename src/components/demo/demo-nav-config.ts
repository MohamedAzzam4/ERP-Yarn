/**
 * Demo navigation configuration — stakeholder visual demo track.
 *
 * This file is the demo parallel of `src/components/shells/nav-config.ts`.
 * It does NOT import `server-only`, so it is safe to import from client
 * components (the demo shell + sidebar).
 *
 * All hrefs point to `/demo/*` routes. No real business routes are linked.
 * The real `nav-config.ts` and its tests are untouched.
 *
 * Restructured 2026-07-06:
 *   - العمليات category now contains ONLY the 4 grouped input destinations:
 *     إدخال الشراء / إدخال البيع / إدخال التشغيل / حركة الخيوط
 *   - Old input entries removed from sidebar (إدخال الخيوط, استلام خام جديد,
 *     الإنتاج لدى مصانع التشغيل).
 *   - Overview pages (نظرة عامة على المخزون, نظرة عامة على المبيعات) moved
 *     to a new "نظرات عامة" category.
 *   - Old routes /demo/owner/yarn-entry and /demo/worker/raw-receipt redirect
 *     to /demo/owner/purchase (the new grouped purchase input page).
 */

export interface DemoNavItem {
  id: string;
  labelAr: string;
  href: string;
}

export interface DemoNavCategory {
  id: string;
  labelAr: string;
  items: ReadonlyArray<DemoNavItem>;
}

export const DEMO_NAV_CATEGORIES: ReadonlyArray<DemoNavCategory> = [
  {
    id: "dashboard",
    labelAr: "لوحة المعلومات",
    items: [
      { id: "demo-dashboard", labelAr: "لوحة التحكم", href: "/demo/owner/dashboard" },
      { id: "demo-reviews", labelAr: "مركز الاعتماد والمتابعة", href: "/demo/owner/reviews" },
    ],
  },
  {
    // العمليات = input destinations only (restructured 2026-07-06)
    id: "operations",
    labelAr: "العمليات",
    items: [
      { id: "demo-purchase", labelAr: "إدخال الشراء", href: "/demo/owner/purchase" },
      { id: "demo-sales-entry", labelAr: "إدخال البيع", href: "/demo/owner/sales-entry" },
      { id: "demo-operation", labelAr: "إدخال التشغيل", href: "/demo/owner/operation" },
      { id: "demo-yarn-movement", labelAr: "حركة الخيوط", href: "/demo/owner/yarn-movement" },
    ],
  },
  {
    // Overview pages moved here from العمليات (new category 2026-07-06)
    id: "overviews",
    labelAr: "نظرات عامة",
    items: [
      { id: "demo-inventory", labelAr: "نظرة عامة على المخزون", href: "/demo/owner/inventory" },
      { id: "demo-sales", labelAr: "نظرة عامة على المبيعات", href: "/demo/owner/sales" },
    ],
  },
  {
    id: "master-data",
    labelAr: "البيانات الأساسية",
    items: [
      { id: "demo-parties", labelAr: "الموردون والعملاء والمصانع", href: "/demo/owner/parties" },
    ],
  },
  {
    id: "reports",
    labelAr: "التقارير",
    items: [
      { id: "demo-activity", labelAr: "النشاطات والإشعارات", href: "/demo/owner/activity" },
    ],
  },
];
