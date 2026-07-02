/**
 * Permission-filtered navigation configuration.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md
 *   §Navigation and Information Architecture
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.1, §5.2
 * Contract: docs/contracts/11_permission_matrix.md §5, §7
 * Contract: docs/contracts/14_coding_agent_instructions.md
 *   "permission-hidden destinations must not render or be discoverable"
 */
import "server-only";
import type { RoleCode } from "@/server/security/role-codes";
import { isWorkerRole } from "@/server/security/role-codes";

// --- Worker task navigation ---

export interface WorkerTaskItem {
  id: string;
  labelAr: string;
  href: string;
  icon: string;
  roles: ReadonlyArray<RoleCode>;
  permissionKey?: string;
}

export const WORKER_TASKS: ReadonlyArray<WorkerTaskItem> = [
  { id: "raw-receipt", labelAr: "استلام خام", href: "/worker/raw-receipts/new", icon: "PackagePlus", roles: ["warehouse_employee"], permissionKey: "inventory.receive.create" },
  { id: "stock-transfer", labelAr: "نقل مخزون", href: "/worker/stock-transfer", icon: "ArrowLeftRight", roles: ["warehouse_employee"], permissionKey: "inventory.transfer.create" },
  { id: "return-receipt", labelAr: "استلام مرتجع", href: "/worker/return-receipt", icon: "Undo2", roles: ["warehouse_employee"], permissionKey: "returns.create" },
  { id: "production-entry", labelAr: "تسجيل إنتاج", href: "/worker/production-entry", icon: "Factory", roles: ["production_employee"], permissionKey: "production.issue_draft.create" },
  { id: "quality-entry", labelAr: "تسجيل جودة", href: "/worker/quality-entry", icon: "ShieldCheck", roles: ["quality_employee"], permissionKey: "quality_tests.create" },
];

export function getWorkerTasksForRole(role: RoleCode): WorkerTaskItem[] {
  return WORKER_TASKS.filter((t) => (t.roles as ReadonlyArray<string>).includes(role));
}

// --- Management navigation ---

export interface ManagementNavItem {
  id: string;
  labelAr: string;
  href: string;
  icon: string;
  roles: ReadonlyArray<RoleCode>;
  permissionKey?: string;
}

export interface ManagementNavCategory {
  id: string;
  labelAr: string;
  items: ReadonlyArray<ManagementNavItem>;
}

export const MANAGEMENT_NAV: ReadonlyArray<ManagementNavCategory> = [
  {
    id: "dashboard", labelAr: "لوحة المعلومات",
    items: [
      { id: "dashboard-home", labelAr: "الرئيسية", href: "/management", icon: "LayoutDashboard", roles: ["owner", "accountant"] },
      { id: "dashboard-panel", labelAr: "لوحة التحكم", href: "/management/dashboard", icon: "BarChart3", roles: ["owner", "accountant"] },
      { id: "reviews", labelAr: "مركز المراجعات", href: "/management/reviews", icon: "ClipboardCheck", roles: ["owner", "accountant"] },
    ],
  },
  {
    id: "inventory", labelAr: "المخزون",
    items: [
      { id: "inventory-receipts", labelAr: "استلام الخام", href: "/management/inventory/receipts", icon: "PackagePlus", roles: ["owner", "accountant"], permissionKey: "inventory.receive.approve" },
      { id: "inventory-transfers", labelAr: "النقل المخزني", href: "/management/inventory/transfers", icon: "ArrowLeftRight", roles: ["owner", "accountant"], permissionKey: "inventory.transfer.approve" },
      { id: "inventory-adjustments", labelAr: "التسويات", href: "/management/inventory/adjustments", icon: "Scale", roles: ["owner", "accountant"], permissionKey: "inventory.adjustment.approve" },
    ],
  },
  {
    id: "production", labelAr: "الإنتاج والتصنيع لدى الغير",
    items: [
      { id: "production-orders", labelAr: "أوامر الإنتاج", href: "/management/production/orders", icon: "Factory", roles: ["owner", "accountant"], permissionKey: "production.approve" },
      { id: "production-wip", labelAr: "المخزون تحت التشغيل", href: "/management/production/wip", icon: "Boxes", roles: ["owner", "accountant"] },
    ],
  },
  {
    id: "sales", labelAr: "المبيعات",
    items: [
      { id: "sales-orders", labelAr: "أوامر البيع", href: "/management/sales/orders", icon: "ShoppingCart", roles: ["owner", "accountant"], permissionKey: "sales.approve" },
      { id: "sales-returns", labelAr: "مرتجعات المبيعات", href: "/management/sales/returns", icon: "Undo2", roles: ["owner", "accountant"], permissionKey: "returns.approve" },
    ],
  },
  {
    id: "quality", labelAr: "الجودة والمرتجعات",
    items: [
      { id: "quality-tests", labelAr: "اختبارات الجودة", href: "/management/quality/tests", icon: "ShieldCheck", roles: ["owner", "accountant"] },
      { id: "complaints", labelAr: "الشكاوى", href: "/management/quality/complaints", icon: "MessageSquareWarning", roles: ["owner", "accountant"], permissionKey: "complaints.investigate" },
    ],
  },
  {
    id: "accounts", labelAr: "الحسابات والمراجعات",
    items: [
      { id: "payments", labelAr: "المدفوعات", href: "/management/accounts/payments", icon: "CreditCard", roles: ["owner", "accountant"], permissionKey: "payments.approve" },
      { id: "balances", labelAr: "الأرصدة", href: "/management/accounts/balances", icon: "Wallet", roles: ["owner", "accountant"], permissionKey: "balances.view_customer" },
      { id: "direct-costs", labelAr: "مراجعة التكاليف", href: "/management/accounts/direct-costs", icon: "Receipt", roles: ["owner", "accountant"], permissionKey: "direct_costs.review" },
    ],
  },
  {
    id: "master-data", labelAr: "البيانات الأساسية",
    items: [
      { id: "suppliers", labelAr: "الموردون", href: "/management/master-data/suppliers", icon: "Truck", roles: ["owner", "accountant"] },
      { id: "customers", labelAr: "العملاء", href: "/management/master-data/customers", icon: "UserCircle", roles: ["owner", "accountant"] },
      { id: "locations", labelAr: "المواقع", href: "/management/master-data/locations", icon: "MapPin", roles: ["owner", "accountant"] },
      { id: "factories", labelAr: "مصانع التشغيل", href: "/management/master-data/factories", icon: "Factory", roles: ["owner", "accountant"] },
      { id: "fiber-types", labelAr: "أنواع الخيوط", href: "/management/master-data/fiber-types", icon: "Layers", roles: ["owner", "accountant"] },
      { id: "product-types", labelAr: "أنواع المنتجات", href: "/management/master-data/product-types", icon: "Package", roles: ["owner", "accountant"] },
      { id: "quality-parameters", labelAr: "معايير الجودة", href: "/management/master-data/quality-parameters", icon: "ShieldCheck", roles: ["owner", "accountant"] },
    ],
  },
  {
    id: "reports", labelAr: "التقارير",
    items: [
      { id: "traceability", labelAr: "التتبع", href: "/management/reports/traceability", icon: "GitBranch", roles: ["owner", "accountant"] },
      { id: "profitability", labelAr: "الربحية", href: "/management/reports/profitability", icon: "TrendingUp", roles: ["owner"], permissionKey: "profitability.view" },
      { id: "audit", labelAr: "سجل التدقيق", href: "/management/reports/audit", icon: "ScrollText", roles: ["owner", "accountant"], permissionKey: "audit.view" },
    ],
  },
  {
    id: "administration", labelAr: "الإدارة",
    items: [
      { id: "users", labelAr: "المستخدمون", href: "/management/admin/users", icon: "Users", roles: ["owner"], permissionKey: "users.manage" },
      { id: "permissions", labelAr: "الأدوار والصلاحيات", href: "/management/admin/permissions", icon: "KeyRound", roles: ["owner"], permissionKey: "permissions.manage" },
      { id: "settings", labelAr: "الإعدادات", href: "/management/admin/settings", icon: "Settings", roles: ["owner"], permissionKey: "settings.manage" },
      { id: "migration", labelAr: "الترحيل التاريخي", href: "/management/admin/migration", icon: "Database", roles: ["owner", "accountant"], permissionKey: "migration.review" },
      { id: "backup", labelAr: "النسخ الاحتياطي", href: "/management/admin/backup", icon: "HardDrive", roles: ["owner"], permissionKey: "backup.view" },
    ],
  },
];

export function getManagementNavForRole(role: RoleCode): ManagementNavCategory[] {
  const result: ManagementNavCategory[] = [];
  for (const cat of MANAGEMENT_NAV) {
    const visibleItems = cat.items.filter((i) => (i.roles as ReadonlyArray<string>).includes(role));
    if (visibleItems.length > 0) {
      result.push({ id: cat.id, labelAr: cat.labelAr, items: visibleItems });
    }
  }
  return result;
}

// --- Role classification ---

export function isWorkerShellRole(role: RoleCode): boolean {
  return isWorkerRole(role);
}

export function isManagementShellRole(role: RoleCode): boolean {
  return role === "owner" || role === "accountant";
}

export function getDefaultShellRoute(role: RoleCode): string {
  if (isWorkerShellRole(role)) return "/worker";
  if (isManagementShellRole(role)) return "/management";
  return "/login";
}

/**
 * Deterministic default shell route for a user with one or more roles.
 *
 * When a user has multiple roles (exceptional Owner-managed case per
 * DEC-061), the shell landing page MUST NOT depend on the order of the
 * roles array returned by the database. This function applies a fixed
 * priority:
 *
 *   1. If the user has ANY management role (owner or accountant) → /management
 *   2. Else if the user has ANY worker role → /worker
 *   3. Else (no valid role) → /login?error=no_role
 *
 * Rationale: management roles have broader visibility. A user with both
 * Owner + Worker roles should land on the management shell (where the
 * Worker financial-deny ceiling is still enforced at the permission/field
 * level by WP-01-02). Landing on the worker shell would hide management
 * navigation they are entitled to.
 *
 * This function is pure and deterministic — the same roles set always
 * produces the same route regardless of array order.
 *
 * @param roles - The user's assigned role codes (from user_roles + roles).
 * @returns The deterministic shell route.
 */
export function getDefaultShellRouteForRoles(
  roles: ReadonlyArray<RoleCode>,
): string {
  // Priority 1: management roles (owner, accountant)
  if (roles.some((r) => isManagementShellRole(r))) {
    return "/management";
  }
  // Priority 2: worker roles (warehouse, production, quality)
  if (roles.some((r) => isWorkerShellRole(r))) {
    return "/worker";
  }
  // No valid role
  return "/login?error=no_role";
}

// --- Route helpers ---

export function isWorkerRoute(pathname: string): boolean {
  return pathname === "/worker" || pathname.startsWith("/worker/");
}

export function isManagementRoute(pathname: string): boolean {
  return pathname === "/management" || pathname.startsWith("/management/");
}
