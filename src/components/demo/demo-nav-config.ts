/**
 * Demo navigation configuration — stakeholder visual demo track.
 *
 * This file is the demo parallel of `src/components/shells/nav-config.ts`.
 * It does NOT import `server-only`, so it is safe to import from client
 * components (the demo shell + sidebar).
 *
 * All hrefs point to `/demo/*` routes. No real business routes are linked.
 * The real `nav-config.ts` and its tests are untouched.
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
      // Renamed 2026-07-05: was "مركز المراجعات" → "مركز الاعتماد والمتابعة"
      // (مراجعة now maps specifically to yarn/fiber result review)
      { id: "demo-reviews", labelAr: "مركز الاعتماد والمتابعة", href: "/demo/owner/reviews" },
    ],
  },
  {
    id: "operations",
    labelAr: "العمليات",
    items: [
      { id: "demo-inventory", labelAr: "نظرة عامة على المخزون", href: "/demo/owner/inventory" },
      // New 2026-07-05: yarn entry page added under inventory category per stakeholder request
      { id: "demo-yarn-entry", labelAr: "إدخال الخيوط", href: "/demo/owner/yarn-entry" },
      { id: "demo-production", labelAr: "الإنتاج لدى مصانع التشغيل", href: "/demo/owner/production" },
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
  {
    id: "worker",
    labelAr: "مهام العامل",
    items: [
      { id: "demo-worker-receipt", labelAr: "استلام خام جديد", href: "/demo/worker/raw-receipt" },
    ],
  },
];
