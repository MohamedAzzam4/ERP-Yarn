/**
 * Central route registry for the showcase. Each entry declares:
 *  - path: the React Router path
 *  - labelAr: navigation label
 *  - group: which section the route belongs to (for the all-screens index)
 *  - roles: which demo roles may see the route in navigation
 *  - workerFriendly: whether the route is appropriate for Worker Task Mode
 *  - financial: whether the route contains financial data (used for redaction tests)
 *  - element: lazy-imported element factory
 *
 * Direct route entry must also respect demo role visibility — implemented
 * by the RouteGuard component (see shells/RouteGuard.tsx).
 */
import type { Role } from "@/types";
import type { ComponentType } from "react";

export interface RouteEntry {
  path: string;
  labelAr: string;
  group:
    | "access"
    | "dashboards"
    | "warehouse"
    | "production"
    | "quality"
    | "management"
    | "migration"
    | "traceability"
    | "reports"
    | "admin";
  roles: Role[];
  financial: boolean;
  element: () => Promise<{ default: ComponentType }>;
  /** Optional short description shown in the all-screens index. */
  descriptionAr?: string;
}

export const ROUTES: RouteEntry[] = [
  // Access & shared shells
  {
    path: "/login",
    labelAr: "تسجيل الدخول التفاعلي",
    group: "access",
    roles: ["owner", "accountant", "warehouse", "production", "quality"],
    financial: false,
    element: () => import("@/screens/auth/DemoLogin"),
    descriptionAr: "شاشة دخول العرض — أداة اختيار دور، وليست مصادقة فعلية.",
  },
  {
    path: "/recovery",
    labelAr: "استعادة الحساب",
    group: "access",
    roles: ["owner", "accountant", "warehouse", "production", "quality"],
    financial: false,
    element: () => import("@/screens/auth/PasswordRecovery"),
    descriptionAr: "شاشة عرضية لاستعادة الحساب — بانتظار قرار المالك.",
  },
  {
    path: "/worker",
    labelAr: "وضع مهام العامل",
    group: "access",
    roles: ["warehouse", "production", "quality"],
    financial: false,
    element: () => import("@/screens/shared/WorkerHome"),
    descriptionAr: "الصفحة الرئيسية لوضع مهام العامل — بطاقات مهام كبيرة بلا بيانات مالية.",
  },
  {
    path: "/all-screens",
    labelAr: "عرض جميع الشاشات",
    group: "access",
    roles: ["owner"],
    financial: false,
    element: () => import("@/screens/shared/AllScreensIndex"),
    descriptionAr: "فهرس شامل لكل شاشات العرض للمالك.",
  },

  // Dashboards
  {
    path: "/dashboard/owner",
    labelAr: "لوحة المالك",
    group: "dashboards",
    roles: ["owner"],
    financial: true,
    element: () => import("@/screens/dashboards/OwnerDashboard"),
    descriptionAr: "مؤشرات شاملة: مخزون، اعتمادات، أرصدة، ربحية تقريبية، تنبيهات.",
  },
  {
    path: "/dashboard/accountant",
    labelAr: "لوحة المحاسب",
    group: "dashboards",
    roles: ["accountant", "owner"],
    financial: true,
    element: () => import("@/screens/dashboards/AccountantDashboard"),
    descriptionAr: "قوائم المراجعة، الأرصدة، المدفوعات، التكاليف المباشرة، تحذيرات الترحيل.",
  },

  // Warehouse worker
  {
    path: "/warehouse/raw-receipt",
    labelAr: "استلام خام",
    group: "warehouse",
    roles: ["warehouse", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/warehouse/RawMaterialReceipt"),
    descriptionAr: "تسجيل استلام رسالة خام — مرجع بصري إلزامي.",
  },
  {
    path: "/warehouse/transfer",
    labelAr: "نقل مخزون",
    group: "warehouse",
    roles: ["warehouse", "owner", "accountant", "production"],
    financial: false,
    element: () => import("@/screens/warehouse/StockTransfer"),
    descriptionAr: "نقل مخزون بين المواقع في خطوة واحدة.",
  },
  {
    path: "/warehouse/return-receipt",
    labelAr: "استلام مرتجع",
    group: "warehouse",
    roles: ["warehouse", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/warehouse/ReturnReceipt"),
    descriptionAr: "استلام مرتجع عميل فعليًا في مخزن المرتجعات.",
  },
  {
    path: "/warehouse/activity",
    labelAr: "نشاط المخزن الأخير",
    group: "warehouse",
    roles: ["warehouse", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/warehouse/WarehouseActivity"),
    descriptionAr: "آخر عمليات المخزن التي سجّلها العامل الحالي.",
  },

  // Production worker
  {
    path: "/production/material-issue",
    labelAr: "صرف للإنتاج",
    group: "production",
    roles: ["production", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/production/MaterialIssue"),
    descriptionAr: "صرف مدخلات من مخزون المصنع إلى أمر إنتاج.",
  },
  {
    path: "/production/single-yarn-receipt",
    labelAr: "استلام إنتاج فرد",
    group: "production",
    roles: ["production", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/production/SingleYarnReceipt"),
    descriptionAr: "تسجيل لوت فرد ناتج من الإنتاج مع الكمية والهالك.",
  },
  {
    path: "/production/twisted-yarn-receipt",
    labelAr: "استلام إنتاج زوى",
    group: "production",
    roles: ["production", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/production/TwistedYarnReceipt"),
    descriptionAr: "تسجيل لوت زوى ناتج من مصنع الزوى.",
  },
  {
    path: "/production/wip-return",
    labelAr: "مرتجع ودائع",
    group: "production",
    roles: ["production", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/production/WipReturn"),
    descriptionAr: "طلب إرجاع ما تبقى من مدخلات غير معالَجة من ودائع الإنتاج.",
  },
  {
    path: "/production/activity",
    labelAr: "نشاط الإنتاج الأخير",
    group: "production",
    roles: ["production", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/production/ProductionActivity"),
    descriptionAr: "آخر عمليات الإنتاج التي سجّلها العامل الحالي.",
  },

  // Quality worker
  {
    path: "/quality/test-entry",
    labelAr: "تسجيل اختبار جودة",
    group: "quality",
    roles: ["quality", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/quality/QualityTestEntry"),
    descriptionAr: "إدخال نتائج اختبارات الجودة على رسالة خام أو لوت.",
  },
  {
    path: "/quality/hold-release",
    labelAr: "حجز/رفع HOLD",
    group: "quality",
    roles: ["quality", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/quality/HoldRelease"),
    descriptionAr: "عرض مخزون محجوز ورفع الحجز بعد المراجعة.",
  },
  {
    path: "/quality/activity",
    labelAr: "نشاط الجودة الأخير",
    group: "quality",
    roles: ["quality", "owner", "accountant"],
    financial: false,
    element: () => import("@/screens/quality/QualityActivity"),
    descriptionAr: "آخر عمليات الجودة التي سجّلها العامل الحالي.",
  },

  // Management workflows
  {
    path: "/management/approvals",
    labelAr: "مركز الاعتمادات",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/ApprovalCenter"),
    descriptionAr: "قائمة مراجعة موحدة لكل الاعتمادات عالية المخاطر.",
  },
  {
    path: "/management/inventory/balances",
    labelAr: "أرصدة المخزون",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/InventoryBalances"),
    descriptionAr: "أرصدة المخزون حسب الموقع والصنف والرسالة/اللوت.",
  },
  {
    path: "/management/inventory/movements",
    labelAr: "حركة المخازن",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/InventoryMovements"),
    descriptionAr: "سجل حركة المخازن مع الفلاتر والبحث.",
  },
  {
    path: "/management/inventory/reservations",
    labelAr: "الحجوزات",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/Reservations"),
    descriptionAr: "حجوزات المخزون المرتبطة بالمبيعات قيد الاعتماد.",
  },
  {
    path: "/management/production-orders",
    labelAr: "أوامر الإنتاج وودائع",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/ProductionOrders"),
    descriptionAr: "أوامر الإنتاج وودائع العمل مع التكلفة والمستحق.",
  },
  {
    path: "/management/production-orders/:orderId",
    labelAr: "تفاصيل أمر إنتاج",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/ProductionOrderDetail"),
    descriptionAr: "تفاصيل أمر إنتاج فردي مع تتبع الودائع.",
  },
  {
    path: "/management/sales",
    labelAr: "المبيعات",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/SalesList"),
    descriptionAr: "قائمة المبيعات مع الفلاتر والبحث.",
  },
  {
    path: "/management/sales/:saleId",
    labelAr: "تفاصيل/مسودة بيع",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/SalesDraft"),
    descriptionAr: "تفاصيل بيع أو مسودة بيع مع حجز المخزون.",
  },
  {
    path: "/management/payments",
    labelAr: "المدفوعات",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/Payments"),
    descriptionAr: "المدفوعات الواردة والصادرة وحالتها.",
  },
  {
    path: "/management/statements/:partyType/:partyId",
    labelAr: "كشف حساب",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/AccountStatements"),
    descriptionAr: "كشف حساب عميل/مورد/مصنع مع الأرصدة.",
  },
  {
    path: "/management/direct-cost-review",
    labelAr: "مراجعة التكاليف المباشرة",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/DirectCostReview"),
    descriptionAr: "مراجعة التكاليف المباشرة وتأكيد المسؤولية والمُكلَّف.",
  },
  {
    path: "/management/quality-review",
    labelAr: "مراجعة الجودة",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/QualityReview"),
    descriptionAr: "مراجعة اختبارات الجودة والمخزون المحتاج لمراجعة.",
  },
  {
    path: "/management/complaints",
    labelAr: "الشكاوى",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/Complaints"),
    descriptionAr: "إدارة الشكاوى وتحقيقات الجودة.",
  },
  {
    path: "/management/returns",
    labelAr: "المرتجعات والاستبدال",
    group: "management",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/management/ReturnsFlow"),
    descriptionAr: "اعتماد المرتجعات والتصنيف والمعالجة المالية والاستبدال.",
  },

  // Migration, traceability, reports, admin
  {
    path: "/migration/staging",
    labelAr: "ترحيل تاريخي — تجميع",
    group: "migration",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/migration/MigrationStaging"),
    descriptionAr: "عرض دفعات الترحيل التاريخي في مرحلة التجميع (للقراءة فقط).",
  },
  {
    path: "/migration/validation",
    labelAr: "ترحيل تاريخي — تحقق",
    group: "migration",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/migration/MigrationValidation"),
    descriptionAr: "التحقق والمطابقة لدفعة الترحيل التاريخي.",
  },
  {
    path: "/migration/approval",
    labelAr: "ترحيل تاريخي — اعتماد",
    group: "migration",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/migration/MigrationApproval"),
    descriptionAr: "اعتماد مزدوج للمالك والمحاسب قبل الالتزام.",
  },
  {
    path: "/traceability",
    labelAr: "تتبّع سلسلة الدفعة/اللوت",
    group: "traceability",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/traceability/Traceability"),
    descriptionAr: "تتبّع من الرسالة الخام إلى البيع/المرتجع/التصحيح.",
  },
  {
    path: "/reports",
    labelAr: "التقارير",
    group: "reports",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/reports/ReportsHub"),
    descriptionAr: "مركز تقارير مع فلاتر ورسومات وجداول.",
  },
  {
    path: "/admin/backup",
    labelAr: "حالة النسخ/الاستعادة",
    group: "admin",
    roles: ["owner", "accountant"],
    financial: true,
    element: () => import("@/screens/admin/BackupRestore"),
    descriptionAr: "عرض حالة النسخ الاحتياطي والاستعادة (عرض فقط).",
  },
  {
    path: "/admin/settings",
    labelAr: "الإعدادات",
    group: "admin",
    roles: ["owner", "accountant"],
    financial: false,
    element: () => import("@/screens/admin/Settings"),
    descriptionAr: "إعدادات الشركة والمصطلحات والقيم المؤجلة.",
  },
  {
    path: "/admin/users",
    labelAr: "المستخدمون والصلاحيات",
    group: "admin",
    roles: ["owner"],
    financial: false,
    element: () => import("@/screens/admin/UserManagement"),
    descriptionAr: "إدارة المستخدمين والصلاحيات — المالك فقط.",
  },
];

export const ROUTE_GROUPS: Record<RouteEntry["group"], string> = {
  access: "الوصول والأطر المشتركة",
  dashboards: "اللوحات",
  warehouse: "عامل المخزن",
  production: "عامل الإنتاج",
  quality: "عامل الجودة",
  management: "إدارة العمليات",
  migration: "الترحيل التاريخي",
  traceability: "التتبّع",
  reports: "التقارير",
  admin: "الإدارة",
};

export function routeByPath(path: string): RouteEntry | undefined {
  return ROUTES.find((r) => r.path === path);
}

/** Resolve a parametrized path against the registry by matching the prefix. */
export function routeByActualPath(actualPath: string): RouteEntry | undefined {
  // Try exact match first.
  const exact = ROUTES.find((r) => r.path === actualPath);
  if (exact) return exact;
  // Then try prefix match on the static segment.
  for (const r of ROUTES) {
    const staticSeg = r.path.split("/:")[0];
    if (staticSeg && actualPath.startsWith(staticSeg)) {
      // Make sure we don't match a longer path incorrectly — pick the longest static prefix.
      return r;
    }
  }
  return undefined;
}
