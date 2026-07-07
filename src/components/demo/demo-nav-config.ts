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
 * Updated 2026-07-07:
 *   - Added icon names to each item + category for sidebar icon rendering.
 *   - Icons are rendered as inline SVG in the sidebar component.
 */

export interface DemoNavItem {
  id: string;
  labelAr: string;
  href: string;
  /** Icon name for sidebar rendering (maps to inline SVG in sidebar component). */
  icon?: string;
}

export interface DemoNavCategory {
  id: string;
  labelAr: string;
  items: ReadonlyArray<DemoNavItem>;
  /** Icon name for the category header (collapsed mode). */
  icon?: string;
}

export const DEMO_NAV_CATEGORIES: ReadonlyArray<DemoNavCategory> = [
  {
    id: "dashboard",
    labelAr: "لوحة المعلومات",
    icon: "dashboard",
    items: [
      { id: "demo-dashboard", labelAr: "لوحة التحكم", href: "/demo/owner/dashboard", icon: "dashboard" },
      { id: "demo-reviews", labelAr: "مركز الاعتماد والمتابعة", href: "/demo/owner/reviews", icon: "check" },
    ],
  },
  {
    id: "overviews",
    labelAr: "نظرات عامة",
    icon: "chart",
    items: [
      { id: "demo-inventory", labelAr: "نظرة عامة على المخزون", href: "/demo/owner/inventory", icon: "boxes" },
      { id: "demo-sales", labelAr: "نظرة عامة على المبيعات", href: "/demo/owner/sales", icon: "trending" },
    ],
  },
  {
    id: "master-data",
    labelAr: "البيانات الأساسية",
    icon: "database",
    items: [
      { id: "demo-parties", labelAr: "الموردون والعملاء والمصانع", href: "/demo/owner/parties", icon: "users" },
    ],
  },
  {
    id: "reports",
    labelAr: "التقارير",
    icon: "document",
    items: [
      { id: "demo-activity", labelAr: "النشاطات والإشعارات", href: "/demo/owner/activity", icon: "bell" },
      { id: "demo-user-activity", labelAr: "سجل نشاط المستخدمين", href: "/demo/owner/user-activity", icon: "history" },
    ],
  },
  {
    id: "operations",
    labelAr: "العمليات / مهام الإدخال",
    icon: "edit",
    items: [
      { id: "demo-purchase", labelAr: "إدخال الشراء", href: "/demo/owner/purchase", icon: "cart" },
      { id: "demo-sales-entry", labelAr: "إدخال البيع", href: "/demo/owner/sales-entry", icon: "receipt" },
      { id: "demo-operation", labelAr: "إدخال التشغيل", href: "/demo/owner/operation", icon: "factory" },
      { id: "demo-yarn-movement", labelAr: "حركة الخيوط", href: "/demo/owner/yarn-movement", icon: "transfer" },
    ],
  },
];
