/**
 * Demo fixtures — stakeholder visual demo track.
 *
 * Branch: demo/stakeholder-visual-demo
 *
 * All data is SYNTHETIC. No real client data. No Supabase reads.
 * No real transaction logic. These fixtures power the demo screens under
 * src/app/(demo)/demo/* and exist purely to showcase the ERP product vision.
 *
 * Version: demo-fixtures-v1
 *
 * Reference: docs/design/01_reference_screen_terms_and_fixtures.md (parallel
 * pattern; reference-fixtures-v1 stays untouched — this is the demo track's
 * own data layer).
 */

export const DEMO_FIXTURE_VERSION = "demo-fixtures-v1" as const;

export const DEMO_TENANT_LABEL = "ERP-Yarn — عرض تفاعلي";
export const DEMO_DATE_FORMAT = "DD/MM/YYYY";
export const DEMO_CURRENCY = "جنيه";

// ---------------------------------------------------------------------------
// Demo users (presentation aid only — NOT authentication)
// ---------------------------------------------------------------------------

export interface DemoUser {
  role: "owner" | "accountant" | "warehouse_employee" | "production_employee" | "quality_employee";
  displayNameAr: string;
  landingRoute: string;
}

// ===========================================================================
// Demo quick-login personas (added 2026-07-06)
//
// Exactly 3 quick-login choices on the /login page. The old 5-role DEMO_USERS
// array + "الدخول السريع حسب الدور" section have been removed from the demo
// home page. Login now shows only these 3 buttons.
//
// - executive: رئيس مجلس الإدارة / العضو المنتدب التنفيذي → management dashboard
// - accountant: المدير المالي → same management screens as executive
// - data-entry: مسؤول تسجيل البيانات أو المدخلات → task hub (4 cards, no sidebar)
// ===========================================================================

export type DemoPersona = "executive" | "accountant" | "data-entry";

export interface DemoQuickLogin {
  persona: DemoPersona;
  labelAr: string;
  roleLabelAr: string;
  href: string;
  descriptionAr: string;
}

export const DEMO_QUICK_LOGINS: ReadonlyArray<DemoQuickLogin> = [
  {
    persona: "executive",
    labelAr: "دخول سريع لرئيس مجلس الإدارة / العضو المنتدب التنفيذي",
    roleLabelAr: "رئيس مجلس الإدارة / العضو المنتدب التنفيذي",
    href: "/demo/executive/dashboard",
    descriptionAr: "لوحة التحكم، الاعتماد والمتابعة، نظرات عامة على المخزون والمبيعات",
  },
  {
    persona: "accountant",
    labelAr: "دخول سريع للمحاسب",
    roleLabelAr: "المدير المالي",
    href: "/demo/accountant/dashboard",
    descriptionAr: "نفس شاشات الإدارة التنفيذية — لوحة التحكم والمتابعة",
  },
  {
    persona: "data-entry",
    labelAr: "دخول سريع لمسؤول إدخال البيانات",
    roleLabelAr: "مسؤول تسجيل البيانات أو المدخلات",
    href: "/demo/data-entry",
    descriptionAr: "مهام الإدخال: شراء، بيع، تشغيل، حركة خيوط — بدون قائمة جانبية",
  },
];

// Helper: map persona → role label for topbar display
export function personaRoleLabel(persona: DemoPersona): string {
  const login = DEMO_QUICK_LOGINS.find((l) => l.persona === persona);
  return login?.roleLabelAr ?? "زائر العرض التفاعلي";
}

// Helper: map persona → display name for topbar
export function personaDisplayName(persona: DemoPersona): string {
  switch (persona) {
    case "executive":
      return "ERP-Yarn";
    case "accountant":
      return "ERP-Yarn";
    case "data-entry":
      return "ERP-Yarn";
    default:
      return "ERP-Yarn";
  }
}

export const DEMO_USERS: ReadonlyArray<DemoUser> = [
  // Stakeholder terminology (revised 2026-07-05):
  //   - مالك النظام            → رئيس مجلس الإدارة / العضو المنتدب التنفيذي
  //   - محاسب المراجعة         → المدير المالي
  //   - عامل مخزن              → مسؤول تسجيل البيانات أو المدخلات
  //   - عامل إنتاج             → مسؤول متابعة تشغيل الخيوط
  //   - مسؤول الجودة           → مدير المراجعة (مراجعة نتائج الخيوط والشعيرات،
  //                              ليست جودة ISO العامة)
  { role: "owner", displayNameAr: "رئيس مجلس الإدارة / العضو المنتدب التنفيذي", landingRoute: "/demo/owner/dashboard" },
  { role: "accountant", displayNameAr: "المدير المالي", landingRoute: "/demo/owner/reviews" },
  { role: "warehouse_employee", displayNameAr: "مسؤول تسجيل البيانات أو المدخلات", landingRoute: "/demo/owner/purchase" },
  { role: "production_employee", displayNameAr: "مسؤول متابعة تشغيل الخيوط", landingRoute: "/demo/owner/operation" },
  { role: "quality_employee", displayNameAr: "مدير المراجعة", landingRoute: "/demo/owner/reviews" },
];

// ===========================================================================
// Stakeholder-approved demo names (added 2026-07-06)
//
// These are the canonical Arabic names approved by the stakeholder for use
// across all demo screens. All previous synthetic names (عثمان, كارجيل,
// عميل النسيج, مصنع الغزال, قمح دلتا, نسر النيل, etc.) have been replaced
// with these approved names in dropdowns, tables, charts, and fixtures.
//
// DO NOT use any other customer/factory/company names in the demo.
// ===========================================================================

// Customers / local yarn buyers (عملاء / مشترو الخيوط المحليون)
export const DEMO_CUSTOMERS: ReadonlyArray<string> = [
  "أحمد فتحي",
  "حمدي عبد المنصف",
  "مأمون النجار",
  "محمد عباسي",
  "محمود الغوطي",
  "محمد الجمل",
  "أحمد الجمل",
  "مرسي البكري",
  "حمودة",
  "البرلسي",
  "السهيلي",
];

// Twisting factories (مصانع الزوي)
export const DEMO_TWISTING_FACTORIES: ReadonlyArray<string> = [
  "مصنع أبو قمر",
  "مصنع النور",
];

// Yarn manufacturing companies (شركات تصنيع الغزل)
export const DEMO_YARN_COMPANIES: ReadonlyArray<string> = [
  "شركة مصر إيران",
  "شركة الدلتا",
  "شركة شبين",
  "شركة الدقهلية",
  "شركة الوجه القبلي",
];

// Suppliers (موردون) — used in purchase raw form
export const DEMO_SUPPLIERS: ReadonlyArray<string> = [
  "أحمد فتحي",
  "حمدي عبد المنصف",
  "مأمون النجار",
  "محمد عباسي",
];

// Raw types (أنواع الخام)
export const DEMO_RAW_TYPES: ReadonlyArray<string> = [
  "قطن سودانى",
  "قطن مصري",
  "قطن أمريكي",
];

// Raw grades (أصناف الخام)
export const DEMO_RAW_GRADES: ReadonlyArray<string> = [
  "السودان",
  "مصر",
  "أمريكا",
];

// Yarn types (أنواع الخيط)
export const DEMO_YARN_TYPES: ReadonlyArray<string> = [
  "قطن مروس",
  "قطن فرد",
  "قطن مزوي",
];

// Yarn counts (نمرات الخيط)
export const DEMO_YARN_COUNTS: ReadonlyArray<string> = [
  "2/24",
  "1/24",
  "2/30",
  "2/20",
  "3/40",
];

// Storage locations (أماكن التخزين)
export const DEMO_STORAGE_LOCATIONS: ReadonlyArray<string> = [
  "مخازن",
  "31اسكندرية",
  "مخزن مصر ايران",
];

// Countries (البلد)
export const DEMO_COUNTRIES: ReadonlyArray<string> = [
  "مصر",
  "السودان",
  "تركيا",
];

// Cone colors (لون الكونز)
export const DEMO_CONE_COLORS: ReadonlyArray<string> = [
  "أبيض",
  "أصفر",
  "أخضر",
];

// Transfer purposes (الغرض من النقل)
export const DEMO_TRANSFER_PURPOSES: ReadonlyArray<string> = [
  "نقل للبيع",
  "نقل للتخزين",
  "نقل للتشغيل",
  "نقل للعميل",
];

// ---------------------------------------------------------------------------
// Locations (extended — adds storage zones for inventory overview)
// ---------------------------------------------------------------------------

export interface DemoLocation {
  code: string;
  nameAr: string;
  type: "warehouse" | "external_factory" | "storage_zone";
  totalStockKg: string;
  rawKg: string;
  wipKg: string;
  finishedKg: string;
  status: "active" | "low_stock" | "negative_stock";
}

export const DEMO_LOCATIONS: ReadonlyArray<DemoLocation> = [
  { code: "WH-ALX-31", nameAr: "31اسكندرية", type: "warehouse", totalStockKg: "12,250.000", rawKg: "9,800.000", wipKg: "0.000", finishedKg: "2,450.000", status: "active" },
  { code: "WH-MISR-01", nameAr: "مخزن مصر ايران", type: "warehouse", totalStockKg: "3,800.000", rawKg: "400.000", wipKg: "0.000", finishedKg: "3,400.000", status: "low_stock" },
  { code: "FAC-SPIN-01", nameAr: "شركة مصر إيران", type: "external_factory", totalStockKg: "3,800.000", rawKg: "1,200.000", wipKg: "1,400.000", finishedKg: "1,200.000", status: "active" },
  { code: "FAC-TWIST-01", nameAr: "مصنع أبو قمر", type: "external_factory", totalStockKg: "1,600.000", rawKg: "500.000", wipKg: "700.000", finishedKg: "400.000", status: "active" },
  { code: "FAC-TWIST-02", nameAr: "مصنع النور", type: "external_factory", totalStockKg: "800.000", rawKg: "300.000", wipKg: "-50.000", finishedKg: "550.000", status: "negative_stock" },
  { code: "WH-ZONE-B", nameAr: "منطقة تخزين ب", type: "storage_zone", totalStockKg: "200.000", rawKg: "0.000", wipKg: "0.000", finishedKg: "200.000", status: "low_stock" },
];

// ---------------------------------------------------------------------------
// Parties (extended suppliers/customers/factories with balances + status)
// ---------------------------------------------------------------------------

export interface DemoParty {
  code: string;
  nameAr: string;
  type: "supplier" | "customer" | "factory";
  categoryAr: string;
  balanceEgp: string;
  activeOrders: number;
  relationshipStart: string;
  status: "active" | "inactive";
  lastTransactionDate: string;
}

export const DEMO_PARTIES: ReadonlyArray<DemoParty> = [
  // Suppliers — using approved customer names (stakeholder uses same people as suppliers/buyers)
  { code: "SUP-001", nameAr: "أحمد فتحي", type: "supplier", categoryAr: "مورد قطن", balanceEgp: "−45,200.00", activeOrders: 2, relationshipStart: "12/03/2023", status: "active", lastTransactionDate: "20/06/2026" },
  { code: "SUP-002", nameAr: "حمدي عبد المنصف", type: "supplier", categoryAr: "مورد قطن مستورد", balanceEgp: "−120,800.00", activeOrders: 1, relationshipStart: "05/11/2022", status: "active", lastTransactionDate: "18/06/2026" },
  { code: "SUP-003", nameAr: "مأمون النجار", type: "supplier", categoryAr: "مورد قطن", balanceEgp: "0.00", activeOrders: 0, relationshipStart: "22/01/2024", status: "inactive", lastTransactionDate: "15/02/2026" },
  // Customers — stakeholder-approved local yarn buyers
  { code: "CUS-001", nameAr: "محمد عباسي", type: "customer", categoryAr: "مشتري خيوط", balanceEgp: "+85,400.00", activeOrders: 3, relationshipStart: "10/05/2023", status: "active", lastTransactionDate: "20/06/2026" },
  { code: "CUS-002", nameAr: "محمود الغوطي", type: "customer", categoryAr: "مشتري خيوط", balanceEgp: "+12,300.00", activeOrders: 1, relationshipStart: "18/09/2024", status: "active", lastTransactionDate: "19/06/2026" },
  { code: "CUS-003", nameAr: "محمد الجمل", type: "customer", categoryAr: "مشتري خيوط", balanceEgp: "0.00", activeOrders: 0, relationshipStart: "03/07/2023", status: "inactive", lastTransactionDate: "30/04/2026" },
  { code: "CUS-004", nameAr: "أحمد الجمل", type: "customer", categoryAr: "مشتري خيوط", balanceEgp: "+22,800.00", activeOrders: 1, relationshipStart: "14/02/2024", status: "active", lastTransactionDate: "18/06/2026" },
  { code: "CUS-005", nameAr: "مرسي البكري", type: "customer", categoryAr: "مشتري خيوط", balanceEgp: "+8,650.00", activeOrders: 1, relationshipStart: "22/11/2023", status: "active", lastTransactionDate: "17/06/2026" },
  // Yarn manufacturing companies — stakeholder-approved
  { code: "FAC-001", nameAr: "شركة مصر إيران", type: "factory", categoryAr: "شركة تصنيع غزل", balanceEgp: "−45,000.00", activeOrders: 2, relationshipStart: "01/01/2022", status: "active", lastTransactionDate: "20/06/2026" },
  { code: "FAC-002", nameAr: "شركة الدلتا", type: "factory", categoryAr: "شركة تصنيع غزل", balanceEgp: "−28,000.00", activeOrders: 1, relationshipStart: "14/06/2022", status: "active", lastTransactionDate: "19/06/2026" },
  { code: "FAC-003", nameAr: "شركة شبين", type: "factory", categoryAr: "شركة تصنيع غزل", balanceEgp: "−19,000.00", activeOrders: 1, relationshipStart: "20/02/2024", status: "active", lastTransactionDate: "18/06/2026" },
  // Twisting factories — stakeholder-approved
  { code: "TWIST-001", nameAr: "مصنع أبو قمر", type: "factory", categoryAr: "مصنع زوي", balanceEgp: "−12,500.00", activeOrders: 1, relationshipStart: "10/08/2023", status: "active", lastTransactionDate: "19/06/2026" },
  { code: "TWIST-002", nameAr: "مصنع النور", type: "factory", categoryAr: "مصنع زوي", balanceEgp: "−8,200.00", activeOrders: 1, relationshipStart: "05/04/2024", status: "active", lastTransactionDate: "18/06/2026" },
];

// ---------------------------------------------------------------------------
// Inventory movements (timeline)
// ---------------------------------------------------------------------------

export interface DemoInventoryMovement {
  document: string;
  date: string;
  typeAr: string;
  locationAr: string;
  quantityKg: string;
  direction: "in" | "out" | "transfer";
  stateAr: string;
}

export const DEMO_INVENTORY_MOVEMENTS: ReadonlyArray<DemoInventoryMovement> = [
  { document: "RR-2026-0007", date: "20/06/2026", typeAr: "استلام خام", locationAr: "31اسكندرية", quantityKg: "1,250.000", direction: "in", stateAr: "مرسل للمراجعة" },
  { document: "TR-2026-0004", date: "19/06/2026", typeAr: "نقل مخزون", locationAr: "مخزن شركة مصر إيران", quantityKg: "320.000", direction: "transfer", stateAr: "مرسل للمراجعة" },
  { document: "PR-2026-0003", date: "19/06/2026", typeAr: "استلام إنتاج من مصنع", locationAr: "مصنع أبو قمر", quantityKg: "640.000", direction: "in", stateAr: "مرسل للمراجعة" },
  { document: "ISS-2026-0011", date: "18/06/2026", typeAr: "صرف خام لمصنع", locationAr: "شركة مصر إيران", quantityKg: "800.000", direction: "out", stateAr: "معتمد" },
  { document: "SALE-2026-0012", date: "18/06/2026", typeAr: "صرف بيع", locationAr: "31اسكندرية", quantityKg: "410.000", direction: "out", stateAr: "معتمد" },
  { document: "ADJ-2026-0005", date: "17/06/2026", typeAr: "تسوية مخزون", locationAr: "31اسكندرية", quantityKg: "−12.500", direction: "out", stateAr: "معتمد" },
  { document: "RR-2026-0006", date: "16/06/2026", typeAr: "استلام خام", locationAr: "مخزن شركة مصر إيران", quantityKg: "980.000", direction: "in", stateAr: "معتمد" },
  { document: "RET-2026-0002", date: "15/06/2026", typeAr: "استلام مرتجع", locationAr: "31اسكندرية", quantityKg: "75.000", direction: "in", stateAr: "معتمد" },
];

// ---------------------------------------------------------------------------
// Production (external factories — outsourced manufacturing)
// ---------------------------------------------------------------------------

export interface DemoProductionOrder {
  order: string;
  factoryNameAr: string;
  factoryCode: string;
  rawMaterialAr: string;
  rawIssuedKg: string;
  wipKg: string;
  finishedReceivedKg: string;
  yieldPct: string;
  stageAr: string;
  startDate: string;
  expectedFinishDate: string;
  stateAr: string;
}

export const DEMO_PRODUCTION_ORDERS: ReadonlyArray<DemoProductionOrder> = [
  { order: "PO-2026-0014", factoryNameAr: "شركة مصر إيران", factoryCode: "FAC-001", rawMaterialAr: "قطن سودانى", rawIssuedKg: "5,000.000", wipKg: "1,400.000", finishedReceivedKg: "2,800.000", yieldPct: "84.0%", stageAr: "غزل", startDate: "05/06/2026", expectedFinishDate: "25/06/2026", stateAr: "جاري التشغيل" },
  { order: "PO-2026-0013", factoryNameAr: "مصنع أبو قمر", factoryCode: "TWIST-001", rawMaterialAr: "قطن مصري", rawIssuedKg: "1,800.000", wipKg: "700.000", finishedReceivedKg: "900.000", yieldPct: "88.9%", stageAr: "برم", startDate: "08/06/2026", expectedFinishDate: "22/06/2026", stateAr: "جاري التشغيل" },
  { order: "PO-2026-0012", factoryNameAr: "مصنع النور", factoryCode: "TWIST-002", rawMaterialAr: "قطن سودانى", rawIssuedKg: "1,200.000", wipKg: "−50.000", finishedReceivedKg: "1,150.000", yieldPct: "95.8%", stageAr: "برم", startDate: "01/06/2026", expectedFinishDate: "20/06/2026", stateAr: "يحتاج مراجعة" },
  { order: "PO-2026-0011", factoryNameAr: "شركة مصر إيران", factoryCode: "FAC-001", rawMaterialAr: "قطن مصري", rawIssuedKg: "3,000.000", wipKg: "0.000", finishedReceivedKg: "2,580.000", yieldPct: "86.0%", stageAr: "غزل", startDate: "20/05/2026", expectedFinishDate: "10/06/2026", stateAr: "مكتمل" },
  { order: "PO-2026-0010", factoryNameAr: "مصنع أبو قمر", factoryCode: "TWIST-001", rawMaterialAr: "قطن سودانى", rawIssuedKg: "2,200.000", wipKg: "0.000", finishedReceivedKg: "1,920.000", yieldPct: "87.3%", stageAr: "برم", startDate: "12/05/2026", expectedFinishDate: "02/06/2026", stateAr: "مكتمل" },
];

export interface DemoFactoryStockBalance {
  factoryCode: string;
  factoryNameAr: string;
  rawKg: string;
  wipKg: string;
  finishedKg: string;
  totalKg: string;
  payableEgp: string;
}

export const DEMO_FACTORY_STOCK_BALANCES: ReadonlyArray<DemoFactoryStockBalance> = [
  { factoryCode: "FAC-001", factoryNameAr: "شركة مصر إيران", rawKg: "1,200.000", wipKg: "1,400.000", finishedKg: "1,200.000", totalKg: "3,800.000", payableEgp: "45,000.00" },
  { factoryCode: "TWIST-001", factoryNameAr: "مصنع أبو قمر", rawKg: "500.000", wipKg: "700.000", finishedKg: "400.000", totalKg: "1,600.000", payableEgp: "28,000.00" },
  { factoryCode: "TWIST-002", factoryNameAr: "مصنع النور", rawKg: "300.000", wipKg: "−50.000", finishedKg: "550.000", totalKg: "800.000", payableEgp: "19,000.00" },
];

// ---------------------------------------------------------------------------
// Sales orders
// ---------------------------------------------------------------------------

export interface DemoSalesOrder {
  order: string;
  customerCode: string;
  customerNameAr: string;
  date: string;
  quantityKg: string;
  amountEgp: string;
  reservationStatusAr: string;
  stateAr: string;
}

export const DEMO_SALES_ORDERS: ReadonlyArray<DemoSalesOrder> = [
  { order: "SALE-2026-0012", customerCode: "CUS-001", customerNameAr: "محمد عباسي", date: "18/06/2026", quantityKg: "410.000", amountEgp: "82,000.00", reservationStatusAr: "محجوز بالكامل", stateAr: "معتمد" },
  { order: "SALE-2026-0011", customerCode: "CUS-002", customerNameAr: "محمود الغوطي", date: "17/06/2026", quantityKg: "180.000", amountEgp: "36,400.00", reservationStatusAr: "محجوز جزئياً", stateAr: "معتمد" },
  { order: "SALE-2026-0010", customerCode: "CUS-001", customerNameAr: "محمد عباسي", date: "15/06/2026", quantityKg: "320.000", amountEgp: "67,200.00", reservationStatusAr: "محجوز بالكامل", stateAr: "معتمد" },
  { order: "SALE-2026-0009", customerCode: "CUS-002", customerNameAr: "محمود الغوطي", date: "14/06/2026", quantityKg: "95.000", amountEgp: "18,050.00", reservationStatusAr: "بانتظار التحقق", stateAr: "مرسل للمراجعة" },
  { order: "SALE-2026-0008", customerCode: "CUS-004", customerNameAr: "أحمد الجمل", date: "12/06/2026", quantityKg: "260.000", amountEgp: "54,600.00", reservationStatusAr: "محجوز بالكامل", stateAr: "معتمد" },
];

export interface DemoCustomerBalance {
  customerCode: string;
  customerNameAr: string;
  totalSalesEgp: string;
  paidEgp: string;
  outstandingEgp: string;
  statusAr: string;
}

export const DEMO_CUSTOMER_BALANCES: ReadonlyArray<DemoCustomerBalance> = [
  { customerCode: "CUS-001", customerNameAr: "محمد عباسي", totalSalesEgp: "203,800.00", paidEgp: "118,400.00", outstandingEgp: "85,400.00", statusAr: "مستحق" },
  { customerCode: "CUS-002", customerNameAr: "محمود الغوطي", totalSalesEgp: "54,450.00", paidEgp: "42,150.00", outstandingEgp: "12,300.00", statusAr: "مستحق" },
  { customerCode: "CUS-003", customerNameAr: "محمد الجمل", totalSalesEgp: "0.00", paidEgp: "0.00", outstandingEgp: "0.00", statusAr: "—" },
];

// ---------------------------------------------------------------------------
// Activity timeline (collapsible strips)
// ---------------------------------------------------------------------------

export interface DemoActivityStrip {
  id: string;
  document: string;
  date: string;
  timeAr: string;
  categoryAr: string;
  summaryAr: string;
  actorAr: string;
  severity: "info" | "warning" | "danger" | "success";
}

export const DEMO_ACTIVITY_STRIPS: ReadonlyArray<DemoActivityStrip> = [
  { id: "act-1", document: "RR-2026-0007", date: "20/06/2026", timeAr: "10:24", categoryAr: "استلام خام", summaryAr: "تم إرسال استلام خام رقم RR-2026-0007 للمراجعة من قبل عامل مخزن 1 — يحتاج اعتماد ومُراجعة السعر.", actorAr: "عامل مخزن 1", severity: "info" },
  { id: "act-2", document: "PR-2026-0003", date: "19/06/2026", timeAr: "15:42", categoryAr: "استلام إنتاج", summaryAr: "تم استلام إنتاج من مصنع أبو قمر — يحتاج مراجعة تكلفة التشغيل قبل الاعتماد.", actorAr: "مسؤول متابعة تشغيل الخيوط", severity: "warning" },
  { id: "act-3", document: "PO-2026-0012", date: "18/06/2026", timeAr: "09:10", categoryAr: "إنتاج خارجي", summaryAr: "تنبيه: أمر إنتاج PO-2026-0012 لدى مصنع النور يظهر مخزون تحت التشغيل بالسالب — يحتاج تحقق فوري.", actorAr: "النظام", severity: "danger" },
  { id: "act-4", document: "SALE-2026-0012", date: "18/06/2026", timeAr: "11:30", categoryAr: "مبيعات", summaryAr: "تم اعتماد أمر البيع SALE-2026-0012 للعميل محمد عباسي بقيمة 82,000.00 جنيه وحجز المخزون بالكامل.", actorAr: "المدير المالي", severity: "success" },
  { id: "act-5", document: "MIG-2026-OPEN", date: "18/06/2026", timeAr: "08:00", categoryAr: "ترحيل تاريخي", summaryAr: "تحذير ترحيل تاريخي: يوجد 3 سجلات قديمة لا تزال مفتوحة للمراجعة قبل إغلاق مرحلة الترحيل.", actorAr: "مالك النظام", severity: "warning" },
  { id: "act-6", document: "ADJ-2026-0005", date: "17/06/2026", timeAr: "14:15", categoryAr: "تسوية مخزون", summaryAr: "تم اعتماد تسوية مخزون بكمية −12.500 كجم في موقع 31اسكندرية بعد جرد ربع سنوي.", actorAr: "محاسب المراجعة", severity: "info" },
];

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface DemoNotification {
  id: string;
  titleAr: string;
  bodyAr: string;
  date: string;
  severity: "info" | "warning" | "danger" | "success";
  read: boolean;
}

export const DEMO_NOTIFICATIONS: ReadonlyArray<DemoNotification> = [
  { id: "n-1", titleAr: "مراجعة عاجلة مطلوبة", bodyAr: "أمر الإنتاج PO-2026-0012 يحتاج مراجعة تكلفة التشغيل قبل الإغلاق.", date: "20/06/2026", severity: "warning", read: false },
  { id: "n-2", titleAr: "مخزون سالب", bodyAr: "موقع مصنع النور يظهر رصيد تحت التشغيل بالسالب — تحقق من حركات الإصدار والاستلام.", date: "20/06/2026", severity: "danger", read: false },
  { id: "n-3", titleAr: "طلب مراجعة جديد", bodyAr: "وصل استلام خام RR-2026-0007 بانتظار اعتمادك.", date: "20/06/2026", severity: "info", read: false },
  { id: "n-4", titleAr: "تم الاعتماد", bodyAr: "تم اعتماد أمر البيع SALE-2026-0012 بنجاح.", date: "18/06/2026", severity: "success", read: true },
  { id: "n-5", titleAr: "تحذير ترحيل تاريخي", bodyAr: "3 سجلات قديمة لا تزال مفتوحة للمراجعة.", date: "18/06/2026", severity: "warning", read: true },
];

// ---------------------------------------------------------------------------
// KPI navigation map — clickable KPI cards route to related demo pages
// ---------------------------------------------------------------------------

export interface DemoKpiCard {
  labelAr: string;
  value: string;
  accent: "primary" | "accent" | "success" | "warning" | "danger";
  chipText: string;
  href: string;
  isApproximate?: boolean;
}

export const DEMO_OWNER_KPI_CARDS: ReadonlyArray<DemoKpiCard> = [
  { labelAr: "إجمالي المخزون", value: "18,450.000 كجم", accent: "primary", chipText: "مخزون", href: "/demo/owner/inventory" },
  { labelAr: "مخزون لدى مصانع التشغيل", value: "6,200.000 كجم", accent: "accent", chipText: "تشغيل", href: "/demo/owner/inventory" },
  { labelAr: "مبيعات الشهر الحالي", value: "320,000.00 جنيه", accent: "success", chipText: "مالي", href: "/demo/owner/sales" },
  { labelAr: "مراجعات مطلوبة", value: "8", accent: "warning", chipText: "مراجعة", href: "/demo/owner/reviews" },
  { labelAr: "تحذيرات مهمة", value: "3", accent: "danger", chipText: "تنبيه", href: "/demo/owner/reviews" },
  { labelAr: "شكاوى مفتوحة", value: "2", accent: "danger", chipText: "تنبيه", href: "/demo/owner/reviews" },
  { labelAr: "ربحية تقريبية", value: "48,750.00 جنيه", accent: "success", chipText: "مالي", href: "/demo/owner/sales", isApproximate: true },
  { labelAr: "مستحقات مصانع", value: "92,000.00 جنيه", accent: "warning", chipText: "مستحق", href: "/demo/owner/parties" },
];

// ---------------------------------------------------------------------------
// Global search index (for the topbar quick-search)
// ---------------------------------------------------------------------------

export interface DemoSearchEntry {
  labelAr: string;
  href: string;
  groupAr: string;
  keywords: string[];
}

export const DEMO_SEARCH_ENTRIES: ReadonlyArray<DemoSearchEntry> = [
  { labelAr: "لوحة التحكم", href: "/demo/owner/dashboard", groupAr: "لوحة المعلومات", keywords: ["dashboard", "owner", "لوحة", "تحكم"] },
  { labelAr: "مركز الاعتماد والمتابعة", href: "/demo/owner/reviews", groupAr: "لوحة المعلومات", keywords: ["reviews", "مراجعات", "اعتماد", "متابعة"] },
  { labelAr: "نظرة عامة على المخزون", href: "/demo/owner/inventory", groupAr: "المخزون", keywords: ["inventory", "مخزون", "رصيد", "خيوط"] },
  { labelAr: "أرصدة الخيوط بالمخازن", href: "/demo/owner/inventory", groupAr: "المخزون", keywords: ["yarn", "خيوط", "أرصدة", "شعيرات"] },
  { labelAr: "إدخال الشراء", href: "/demo/owner/purchase", groupAr: "العمليات", keywords: ["purchase", "شراء", "خامات", "خيوط"] },
  { labelAr: "إدخال البيع", href: "/demo/owner/sales-entry", groupAr: "العمليات", keywords: ["sales", "بيع", "خامات", "خيوط"] },
  { labelAr: "إدخال التشغيل", href: "/demo/owner/operation", groupAr: "العمليات", keywords: ["operation", "تشغيل", "زوي", "مصنع"] },
  { labelAr: "حركة الخيوط", href: "/demo/owner/yarn-movement", groupAr: "العمليات", keywords: ["movement", "حركة", "خيوط", "نقل"] },
  { labelAr: "نظرة عامة على المبيعات", href: "/demo/owner/sales", groupAr: "المبيعات", keywords: ["sales", "مبيعات", "أمر بيع"] },
  { labelAr: "الموردون والعملاء والمصانع", href: "/demo/owner/parties", groupAr: "الإدارة", keywords: ["parties", "suppliers", "customers", "موردين", "عملاء", "مصانع"] },
  { labelAr: "النشاطات والإشعارات", href: "/demo/owner/activity", groupAr: "التقارير", keywords: ["activity", "notifications", "نشاط", "إشعارات"] },
  { labelAr: "سجل نشاط المستخدمين", href: "/demo/owner/user-activity", groupAr: "التقارير", keywords: ["user", "activity", "سجل", "نشاط", "مستخدمين"] },
  // Old routes /demo/owner/yarn-entry and /demo/worker/raw-receipt now redirect
  // to /demo/owner/purchase — removed from search to avoid confusion.
];

// ---------------------------------------------------------------------------
// Dashboard chart data (reused from reference-fixtures patterns but with
// demo-specific emphasis)
// ---------------------------------------------------------------------------

// Inventory composition — ثلاث طبقات واضحة: خامات / شعيرات / خيوط
// (revised 2026-07-05 to make yarn visible at the dashboard top-level)
//
// Chart color fix 2026-07-06: was using var(--color-success) for "خيوط" and
// var(--color-accent) for "لدى مصانع التشغيل" — both are #2a9d8f (teal).
// Now uses chart-N tokens which are guaranteed unique per globals.css.
export const DEMO_DASHBOARD_INVENTORY_COMPOSITION = [
  { labelAr: "خامات", valueKg: "10,200.000", color: "var(--color-chart-1)" },   // blue
  { labelAr: "شعيرات", valueKg: "4,800.000", color: "var(--color-chart-3)" },   // amber
  { labelAr: "خيوط", valueKg: "3,250.000", color: "var(--color-chart-2)" },     // teal
  { labelAr: "لدى مصانع التشغيل", valueKg: "6,200.000", color: "var(--color-chart-6)" }, // violet
] as const;

// Explicit chart color palette for donut/bar segments — guaranteed unique.
// Use this when building chart segment data programmatically.
export const DEMO_CHART_COLORS = {
  blue: "var(--color-chart-1)",    // #2457c5
  teal: "var(--color-chart-2)",    // #2a9d8f
  amber: "var(--color-chart-3)",   // #c47a12
  slate: "var(--color-chart-4)",   // #52657a
  rose: "var(--color-chart-5)",    // #c2414a
  violet: "var(--color-chart-6)",  // #7c3aed
  cyan: "var(--color-chart-7)",    // #0891b2
} as const;

export const DEMO_DASHBOARD_ATTENTION_ITEMS = [
  { labelAr: "استلام خام بدون سعر", count: 3, severity: "high" as const },
  { labelAr: "مراجعة تكلفة تشغيل", count: 2, severity: "high" as const },
  { labelAr: "مراجعة تحويل مخزون", count: 1, severity: "medium" as const },
  { labelAr: "شكوى مفتوحة", count: 2, severity: "medium" as const },
];

export const DEMO_DASHBOARD_FACTORY_BALANCES = [
  { factoryNameAr: "شركة مصر إيران", stockKg: "3,800.000", payableEgp: "45,000.00" },
  { factoryNameAr: "مصنع أبو قمر", stockKg: "1,600.000", payableEgp: "28,000.00" },
  { factoryNameAr: "مصنع النور", stockKg: "800.000", payableEgp: "19,000.00" },
];

export const DEMO_DASHBOARD_INVENTORY_BY_LOCATION = [
  { label: "31اسكندرية", value: "12,250.000 كجم" },
  { label: "مخزن مصر ايران", value: "3,800.000 كجم" },
  { label: "زوى عبدالحميد", value: "1,600.000 كجم" },
  { label: "زوى ابوقمر", value: "800.000 كجم" },
];

// Renamed 2026-07-05: was "اتجاه المراجعات" — confusing because "مراجعة"
// now maps to yarn/fiber result review. This trend tracks approval + follow-up
// requests across the demo, not just quality reviews.
export const DEMO_DASHBOARD_APPROVAL_TREND = [
  { label: "16/06", value: "4" },
  { label: "17/06", value: "6" },
  { label: "18/06", value: "5" },
  { label: "19/06", value: "7" },
  { label: "20/06", value: "8" },
];

// Back-compat alias — old exports kept so any older import path still compiles
// during the transition. New code should use DEMO_DASHBOARD_APPROVAL_TREND.
export const DEMO_DASHBOARD_REVIEW_TREND = DEMO_DASHBOARD_APPROVAL_TREND;

export const DEMO_DASHBOARD_COMPLAINTS = [
  { label: "مفتوحة", value: "2" },
  { label: "قيد التحقيق", value: "1" },
  { label: "مغلقة", value: "5" },
];

// ===========================================================================
// Yarn stock — أرصدة الخيوط بالمخازن
//
// Inspired by the stakeholder Excel "ارصدة الخيوط بالمخازن محمد.xlsx"
// (sheet: "ارصدة الخيوط بالمخازن"). All data below is SYNTHETIC — no real
// client rows. Synthetic company names ("قمح دلتا", "نسر النيل", "غزل الشرق",
// "خيوط الواحة") are used to avoid implicating any real supplier/customer.
//
// Columns mirrored from the stakeholder Excel:
//   تاريخ التخزين / شركة / رقم الأمر / نمرة / م. برم الفرد / م. برم الزوى /
//   مكان التخزين / كونز / إجمالي منتج / رصيد حالي / عدد شيكارة / نمرة /
//   م برم / RKM / Elongn / U% / Tin / Tick / Neps / Hairs
//
// Numeric values use Western numerals and are LTR-isolated at render time
// via <LtrValue>. Dates use DD/MM/YYYY.
// ===========================================================================

export interface DemoYarnStockRow {
  storageDate: string;        // تاريخ التخزين  (DD/MM/YYYY)
  companyAr: string;          // شركة
  orderNumber: string;        // رقم الأمر
  yarnCount: string;          // نمرة (e.g. "2/24", "1/24")
  twistSingle: string;        // م. برم الفرد
  twistDouble: string;        // م. برم الزوى
  storageLocationAr: string;  // مكان التخزين
  cones: string;              // كونز
  totalProducedKg: string;    // إجمالي المنتج
  currentBalanceKg: string;   // الرصيد الحالي
  balesCount: string;         // عدد شيكارة
  // Technical review results (مراجعة فنية للخيط)
  numberTwist: string;        // نمرة / م برم
  rkm: string;                // RKM
  elongation: string;         // Elongn
  uPercent: string;           // U%
  thin: string;               // Tin
  thick: string;              // Tick
  neps: string;               // Neps
  hairiness: string;          // Hairs
  needsTechnicalReview: boolean; // بنود تحتاج مراجعة فنية
}

export const DEMO_YARN_STOCK: ReadonlyArray<DemoYarnStockRow> = [
  {
    storageDate: "12/05/2026",
    companyAr: "شركة مصر إيران",
    orderNumber: "10370",
    yarnCount: "2/24",
    twistSingle: "18.5",
    twistDouble: "9.2",
    storageLocationAr: "مخازن",
    cones: "120",
    totalProducedKg: "5,400.000",
    currentBalanceKg: "1,820.000",
    balesCount: "36",
    numberTwist: "2/24",
    rkm: "16.8",
    elongation: "6.4",
    uPercent: "9.8",
    thin: "12",
    thick: "28",
    neps: "44",
    hairiness: "5.6",
    needsTechnicalReview: false,
  },
  {
    storageDate: "14/05/2026",
    companyAr: "شركة الدلتا",
    orderNumber: "10371",
    yarnCount: "1/24",
    twistSingle: "16.2",
    twistDouble: "8.1",
    storageLocationAr: "مخازن",
    cones: "95",
    totalProducedKg: "4,150.000",
    currentBalanceKg: "640.000",
    balesCount: "22",
    numberTwist: "1/24",
    rkm: "15.4",
    elongation: "5.9",
    uPercent: "10.2",
    thin: "18",
    thick: "34",
    neps: "52",
    hairiness: "6.1",
    needsTechnicalReview: true,
  },
  {
    storageDate: "20/05/2026",
    companyAr: "شركة شبين",
    orderNumber: "10378",
    yarnCount: "2/24",
    twistSingle: "19.1",
    twistDouble: "9.6",
    storageLocationAr: "مخازن",
    cones: "140",
    totalProducedKg: "6,200.000",
    currentBalanceKg: "2,150.000",
    balesCount: "44",
    numberTwist: "2/24",
    rkm: "17.2",
    elongation: "6.7",
    uPercent: "9.5",
    thin: "10",
    thick: "22",
    neps: "38",
    hairiness: "5.2",
    needsTechnicalReview: false,
  },
  {
    storageDate: "01/06/2026",
    companyAr: "شركة الدقهلية",
    orderNumber: "10493",
    yarnCount: "1/24",
    twistSingle: "15.8",
    twistDouble: "7.9",
    storageLocationAr: "مخازن",
    cones: "88",
    totalProducedKg: "3,820.000",
    currentBalanceKg: "780.000",
    balesCount: "26",
    numberTwist: "1/24",
    rkm: "14.6",
    elongation: "5.4",
    uPercent: "11.0",
    thin: "22",
    thick: "41",
    neps: "60",
    hairiness: "6.8",
    needsTechnicalReview: true,
  },
  {
    storageDate: "08/06/2026",
    companyAr: "شركة الوجه القبلي",
    orderNumber: "10512",
    yarnCount: "2/30",
    twistSingle: "21.4",
    twistDouble: "10.7",
    storageLocationAr: "مخازن",
    cones: "110",
    totalProducedKg: "4,860.000",
    currentBalanceKg: "1,420.000",
    balesCount: "32",
    numberTwist: "2/30",
    rkm: "18.1",
    elongation: "7.0",
    uPercent: "9.2",
    thin: "8",
    thick: "18",
    neps: "30",
    hairiness: "4.9",
    needsTechnicalReview: false,
  },
  {
    storageDate: "15/06/2026",
    companyAr: "شركة مصر إيران",
    orderNumber: "10534",
    yarnCount: "2/24",
    twistSingle: "18.9",
    twistDouble: "9.4",
    storageLocationAr: "مخازن",
    cones: "75",
    totalProducedKg: "3,300.000",
    currentBalanceKg: "980.000",
    balesCount: "20",
    numberTwist: "2/24",
    rkm: "16.5",
    elongation: "6.2",
    uPercent: "10.0",
    thin: "15",
    thick: "31",
    neps: "47",
    hairiness: "5.8",
    needsTechnicalReview: true,
  },
];

// ---------------------------------------------------------------------------
// Yarn distribution by company — for the donut/bar chart on dashboard +
// inventory overview.
// ---------------------------------------------------------------------------

export interface DemoYarnCompanyBalance {
  companyAr: string;
  currentBalanceKg: string;
  totalProducedKg: string;
  balesCount: string;
}

export const DEMO_YARN_BY_COMPANY: ReadonlyArray<DemoYarnCompanyBalance> = [
  { companyAr: "شركة مصر إيران", currentBalanceKg: "2,460.000", totalProducedKg: "9,550.000", balesCount: "58" },
  { companyAr: "شركة الدلتا", currentBalanceKg: "3,130.000", totalProducedKg: "9,500.000", balesCount: "64" },
  { companyAr: "شركة شبين", currentBalanceKg: "780.000", totalProducedKg: "3,820.000", balesCount: "26" },
  { companyAr: "شركة الوجه القبلي", currentBalanceKg: "1,420.000", totalProducedKg: "4,860.000", balesCount: "32" },
];

// ---------------------------------------------------------------------------
// Yarn distribution by yarn count (النمرة) — for the donut on dashboard.
// ---------------------------------------------------------------------------

export interface DemoYarnByCount {
  yarnCount: string;
  currentBalanceKg: string;
}

export const DEMO_YARN_BY_COUNT: ReadonlyArray<DemoYarnByCount> = [
  { yarnCount: "2/24", currentBalanceKg: "3,970.000" },
  { yarnCount: "1/24", currentBalanceKg: "1,420.000" },
  { yarnCount: "2/30", currentBalanceKg: "1,420.000" },
];

// ---------------------------------------------------------------------------
// Yarn dashboard KPIs (used by owner dashboard + inventory overview top strip)
// ---------------------------------------------------------------------------

export const DEMO_YARN_KPIS = {
  totalCurrentBalanceKg: "6,810.000",
  totalProducedKg: "27,730.000",
  totalBales: "180",
  companiesCount: "4",
  itemsNeedingTechnicalReview: "3",
} as const;

// ---------------------------------------------------------------------------
// Yarn entry form — fixture for the /demo/owner/yarn-entry page.
//
// Used to pre-populate the static demo form (no submit). Field order matches
// the stakeholder Excel column order so the form reads naturally to the
// stakeholder.
// ---------------------------------------------------------------------------

export interface DemoYarnEntryField {
  labelAr: string;
  value: string;
  ltr: boolean;
}

export const DEMO_YARN_ENTRY_DEFAULTS: ReadonlyArray<DemoYarnEntryField> = [
  { labelAr: "تاريخ التخزين", value: "20/06/2026", ltr: true },
  { labelAr: "الشركة", value: "قمح دلتا", ltr: false },
  { labelAr: "رقم الأمر", value: "10547", ltr: true },
  { labelAr: "نمرة الخيط", value: "2/24", ltr: true },
  { labelAr: "م. برم الفرد", value: "18.5", ltr: true },
  { labelAr: "م. برم الزوى", value: "9.2", ltr: true },
  { labelAr: "مكان التخزين", value: "مخازن", ltr: false },
  { labelAr: "كونز", value: "120", ltr: true },
  { labelAr: "إجمالي المنتج", value: "5,400.000", ltr: true },
  { labelAr: "الرصيد الحالي", value: "1,820.000", ltr: true },
  { labelAr: "عدد الشكاير", value: "36", ltr: true },
  { labelAr: "م برم", value: "2/24", ltr: true },
  { labelAr: "RKM", value: "16.8", ltr: true },
  { labelAr: "Elongn", value: "6.4", ltr: true },
  { labelAr: "U%", value: "9.8", ltr: true },
  { labelAr: "Tin", value: "12", ltr: true },
  { labelAr: "Tick", value: "28", ltr: true },
  { labelAr: "Neps", value: "44", ltr: true },
  { labelAr: "Hairs", value: "5.6", ltr: true },
];

export const DEMO_YARN_ENTRY_SECTIONS: ReadonlyArray<{
  titleAr: string;
  fieldLabelsAr: ReadonlyArray<string>;
}> = [
  {
    titleAr: "بيانات الأمر والتخزين",
    fieldLabelsAr: [
      "تاريخ التخزين",
      "الشركة",
      "رقم الأمر",
      "نمرة الخيط",
      "م. برم الفرد",
      "م. برم الزوى",
      "مكان التخزين",
    ],
  },
  {
    titleAr: "الكميات والأرصدة",
    fieldLabelsAr: [
      "كونز",
      "إجمالي المنتج",
      "الرصيد الحالي",
      "عدد الشكاير",
    ],
  },
  {
    titleAr: "نتائج المراجعة الفنية للخيط",
    fieldLabelsAr: [
      "م برم",
      "RKM",
      "Elongn",
      "U%",
      "Tin",
      "Tick",
      "Neps",
      "Hairs",
    ],
  },
];

// ===========================================================================
// Grouped input form fixtures (added 2026-07-06)
//
// 4 grouped input destinations, each with tabbed variants:
//   1. إدخال الشراء     — شراء خامات / شراء خيوط
//   2. إدخال البيع      — بيع خامات / بيع خيوط
//   3. إدخال التشغيل    — تشغيل خيوط لدى الشركات / زوي خيوط لدى شركات
//   4. حركة الخيوط      — single form
//
// All values are SYNTHETIC. No real client data. Used only to pre-populate
// the demo forms so stakeholders can immediately understand the screen.
// ===========================================================================

import type { DemoFormField, DemoFormSection } from "@/components/demo/demo-form-shared";

// --- 1a. شراء خامات (Purchase Raw Materials) ---
// Uses stakeholder-approved names from DEMO_SUPPLIERS, DEMO_RAW_TYPES, etc.
// Every select field has customLabelAr for "غير موجود بالقائمة" behavior.

export const PURCHASE_RAW_SECTIONS: ReadonlyArray<DemoFormSection> = [
  {
    titleAr: "بيانات أساسية",
    fields: [
      { labelAr: "نوع الخام", defaultValue: DEMO_RAW_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_TYPES], customLabelAr: "اكتب نوع الخام" },
      { labelAr: "صنف الخام", defaultValue: DEMO_RAW_GRADES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_GRADES], customLabelAr: "اكتب صنف الخام" },
      { labelAr: "اسم المورد", defaultValue: DEMO_SUPPLIERS[0]!, ltr: false, type: "select", options: [...DEMO_SUPPLIERS], customLabelAr: "اكتب اسم المورد" },
      { labelAr: "رقم رسالة", defaultValue: "PR-2026-0042", ltr: true },
      { labelAr: "تاريخ استلام الخام / تاريخ التخزين", defaultValue: "20/06/2026", ltr: true },
      { labelAr: "موسم إنتاج الخام", defaultValue: "2024/2025", ltr: true },
    ],
  },
  {
    titleAr: "الكميات والأوزان",
    fields: [
      { labelAr: "الكمية", defaultValue: "1,250.000", ltr: true, type: "number" },
      { labelAr: "عدد بالات الرسالة", defaultValue: "25", ltr: true, type: "number" },
      { labelAr: "وزن قائم للرسالة", defaultValue: "1,250.000", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "الأسعار والمدفوعات",
    fields: [
      { labelAr: "سعر الطن", defaultValue: "52,000.00", ltr: true, type: "number" },
      { labelAr: "إجمالي سعر الرسالة", defaultValue: "65,000.00", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "التخزين والحركة",
    fields: [
      { labelAr: "مكان التخزين", defaultValue: DEMO_STORAGE_LOCATIONS[0]!, ltr: false, type: "select", options: [...DEMO_STORAGE_LOCATIONS], customLabelAr: "اكتب مكان التخزين" },
    ],
  },
  {
    titleAr: "ملاحظات",
    fields: [
      { labelAr: "ملاحظات", defaultValue: "تم الاستلام ظاهرياً، يحتاج مراجعة الجودة", ltr: false, type: "textarea" },
    ],
  },
];

// --- 1b. شراء خيوط (Purchase Yarn) ---

export const PURCHASE_YARN_SECTIONS: ReadonlyArray<DemoFormSection> = [
  {
    titleAr: "بيانات أساسية",
    fields: [
      { labelAr: "نمرة الخيط", defaultValue: DEMO_YARN_COUNTS[0]!, ltr: true, type: "select", options: [...DEMO_YARN_COUNTS], customLabelAr: "اكتب نمرة الخيط" },
      { labelAr: "نوع الخيط", defaultValue: DEMO_YARN_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_YARN_TYPES], customLabelAr: "اكتب نوع الخيط" },
      { labelAr: "الخام", defaultValue: DEMO_RAW_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_TYPES], customLabelAr: "اكتب نوع الخام" },
      { labelAr: "معامل برم الخيط", defaultValue: "18.5", ltr: true },
      { labelAr: "التاريخ أو رقم الرسالة / رقم اللوط", defaultValue: "YPR-2026-0015", ltr: true },
      { labelAr: "لون الكونز", defaultValue: DEMO_CONE_COLORS[0]!, ltr: false, type: "select", options: [...DEMO_CONE_COLORS], customLabelAr: "اكتب لون الكونز" },
      { labelAr: "العميل", defaultValue: DEMO_CUSTOMERS[0]!, ltr: false, type: "select", options: [...DEMO_CUSTOMERS], customLabelAr: "اكتب اسم العميل" },
      { labelAr: "البلد", defaultValue: DEMO_COUNTRIES[0]!, ltr: false, type: "select", options: [...DEMO_COUNTRIES], customLabelAr: "اكتب اسم البلد" },
    ],
  },
  {
    titleAr: "الكميات والأوزان",
    fields: [
      { labelAr: "وزن قائم", defaultValue: "5,400.000", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "الأسعار والمدفوعات",
    fields: [
      { labelAr: "سعر الطن", defaultValue: "78,000.00", ltr: true, type: "number" },
      { labelAr: "إجمالي السعر", defaultValue: "421,200.00", ltr: true, type: "number" },
      { labelAr: "مدفوع مقدمًا", defaultValue: "100,000.00", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "ملاحظات",
    fields: [
      { labelAr: "ملاحظات", defaultValue: "خصم الكمية عند الاستلام", ltr: false, type: "textarea" },
    ],
  },
];

// --- 2a. بيع خامات (Sales Raw Materials) ---

export const SALES_RAW_SECTIONS: ReadonlyArray<DemoFormSection> = [
  {
    titleAr: "بيانات أساسية",
    fields: [
      { labelAr: "نوع الخام", defaultValue: DEMO_RAW_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_TYPES], customLabelAr: "اكتب نوع الخام" },
      { labelAr: "صنف الخام", defaultValue: DEMO_RAW_GRADES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_GRADES], customLabelAr: "اكتب صنف الخام" },
      { labelAr: "المشتري / العميل", defaultValue: DEMO_CUSTOMERS[0]!, ltr: false, type: "select", options: [...DEMO_CUSTOMERS], customLabelAr: "اكتب اسم العميل" },
      { labelAr: "رقم الرسالة", defaultValue: "PR-2026-0038", ltr: true },
      { labelAr: "التاريخ", defaultValue: "20/06/2026", ltr: true },
    ],
  },
  {
    titleAr: "الكميات والأوزان",
    fields: [
      { labelAr: "الكمية", defaultValue: "410.000", ltr: true, type: "number" },
      { labelAr: "عدد البال المباع", defaultValue: "8", ltr: true, type: "number" },
      { labelAr: "وزن قائم للبيع", defaultValue: "410.000", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "الأسعار والمدفوعات",
    fields: [
      { labelAr: "سعر البيع", defaultValue: "55,000.00", ltr: true, type: "number" },
      { labelAr: "إجمالي سعر البيع", defaultValue: "22,550.00", ltr: true, type: "number" },
      { labelAr: "مدفوع مقدم", defaultValue: "10,000.00", ltr: true, type: "number" },
      { labelAr: "باقي", defaultValue: "12,550.00", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "ملاحظات",
    fields: [
      { labelAr: "ملاحظات", defaultValue: "تسليم خلال 3 أيام", ltr: false, type: "textarea" },
    ],
  },
];

// --- 2b. بيع خيوط (Sales Yarn) ---

export const SALES_YARN_SECTIONS: ReadonlyArray<DemoFormSection> = [
  {
    titleAr: "بيانات أساسية",
    fields: [
      { labelAr: "العميل", defaultValue: DEMO_CUSTOMERS[0]!, ltr: false, type: "select", options: [...DEMO_CUSTOMERS], customLabelAr: "اكتب اسم العميل" },
      { labelAr: "البلد", defaultValue: DEMO_COUNTRIES[0]!, ltr: false, type: "select", options: [...DEMO_COUNTRIES], customLabelAr: "اكتب اسم البلد" },
      { labelAr: "التاريخ / تاريخ البيع", defaultValue: "20/06/2026", ltr: true },
      { labelAr: "الخيط", defaultValue: DEMO_YARN_COUNTS[0]!, ltr: true, type: "select", options: [...DEMO_YARN_COUNTS], customLabelAr: "اكتب نمرة الخيط" },
      { labelAr: "نوعه", defaultValue: DEMO_YARN_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_YARN_TYPES], customLabelAr: "اكتب نوع الخيط" },
      { labelAr: "الخام", defaultValue: DEMO_RAW_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_TYPES], customLabelAr: "اكتب نوع الخام" },
    ],
  },
  {
    titleAr: "برم ومصنع الإنتاج",
    fields: [
      { labelAr: "معامل البرم", defaultValue: "18.5", ltr: true },
      { labelAr: "معامل برم الفرد", defaultValue: "18.5", ltr: true },
      { labelAr: "معامل برم الزوي", defaultValue: "9.2", ltr: true },
      { labelAr: "مصنع إنتاج الفرد / الشركة المنتجة للفرد", defaultValue: DEMO_YARN_COMPANIES[0]!, ltr: false, type: "select", options: [...DEMO_YARN_COMPANIES], customLabelAr: "اكتب اسم الشركة المنتجة للفرد" },
      { labelAr: "مصنع إنتاج الزوي / الشركة المنتجة للزوي", defaultValue: DEMO_TWISTING_FACTORIES[0]!, ltr: false, type: "select", options: [...DEMO_TWISTING_FACTORIES], customLabelAr: "اكتب اسم مصنع الزوي" },
      { labelAr: "لون الكونز", defaultValue: DEMO_CONE_COLORS[0]!, ltr: false, type: "select", options: [...DEMO_CONE_COLORS], customLabelAr: "اكتب لون الكونز" },
    ],
  },
  {
    titleAr: "الكميات والأوزان",
    fields: [
      { labelAr: "الكمية", defaultValue: "1,820.000", ltr: true, type: "number" },
      { labelAr: "الوزن القائم", defaultValue: "1,820.000", ltr: true, type: "number" },
      { labelAr: "عدد الشكاير", defaultValue: "36", ltr: true, type: "number" },
      { labelAr: "الرسالة أو اللوط", defaultValue: "YLOT-2026-0015", ltr: true },
    ],
  },
  {
    titleAr: "الأسعار والمدفوعات",
    fields: [
      { labelAr: "سعر الطن", defaultValue: "82,000.00", ltr: true, type: "number" },
      { labelAr: "إجمالي السعر", defaultValue: "149,240.00", ltr: true, type: "number" },
      { labelAr: "المدفوع مقدم", defaultValue: "50,000.00", ltr: true, type: "number" },
      { labelAr: "باقي الحساب", defaultValue: "99,240.00", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "ملاحظات",
    fields: [
      { labelAr: "ملاحظات", defaultValue: "شحن خلال أسبوع", ltr: false, type: "textarea" },
    ],
  },
];

// --- 3a. تشغيل خيوط لدى الشركات (Spinning Operation) ---

export const OPERATION_SPINNING_SECTIONS: ReadonlyArray<DemoFormSection> = [
  {
    titleAr: "بيانات أساسية",
    fields: [
      { labelAr: "الخيط", defaultValue: DEMO_YARN_COUNTS[0]!, ltr: true, type: "select", options: [...DEMO_YARN_COUNTS], customLabelAr: "اكتب نمرة الخيط" },
      { labelAr: "نوعه", defaultValue: DEMO_YARN_TYPES[1]!, ltr: false, type: "select", options: [...DEMO_YARN_TYPES], customLabelAr: "اكتب نوع الخيط" },
      { labelAr: "الخام", defaultValue: DEMO_RAW_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_TYPES], customLabelAr: "اكتب نوع الخام" },
      { labelAr: "معامل برم الفرد", defaultValue: "18.5", ltr: true },
      { labelAr: "معامل برم الزوي", defaultValue: "9.2", ltr: true },
      { labelAr: "الشركة المنتجة للفرد", defaultValue: DEMO_YARN_COMPANIES[0]!, ltr: false, type: "select", options: [...DEMO_YARN_COMPANIES], customLabelAr: "اكتب اسم الشركة المنتجة للفرد" },
      { labelAr: "الشركة المنتجة للزوي", defaultValue: DEMO_TWISTING_FACTORIES[0]!, ltr: false, type: "select", options: [...DEMO_TWISTING_FACTORIES], customLabelAr: "اكتب اسم مصنع الزوي" },
    ],
  },
  {
    titleAr: "الكميات والأوزان",
    fields: [
      { labelAr: "وزن الخام", defaultValue: "5,000.000", ltr: true, type: "number" },
      { labelAr: "وزن الخيط المتوقع", defaultValue: "4,250.000", ltr: true, type: "number" },
      { labelAr: "وزن الخيط الفعلي للفرد", defaultValue: "2,800.000", ltr: true, type: "number" },
      { labelAr: "وزن الخيط الفعلي المزوي", defaultValue: "2,450.000", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "الأسعار والمدفوعات",
    fields: [
      { labelAr: "سعر تشغيل طن الفرد", defaultValue: "8,500.00", ltr: true, type: "number" },
      { labelAr: "سعر تشغيل طن الزوي", defaultValue: "6,200.00", ltr: true, type: "number" },
      { labelAr: "نسبة العادم", defaultValue: "15.0", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "التاريخ والملاحظات",
    fields: [
      { labelAr: "التاريخ", defaultValue: "20/06/2026", ltr: true },
      { labelAr: "ملاحظات", defaultValue: "جاري التشغيل — متوقع التسليم 25/06/2026", ltr: false, type: "textarea" },
    ],
  },
];

// --- 3b. زوي خيوط لدى شركات (Twisting Operation) ---

export const OPERATION_TWISTING_SECTIONS: ReadonlyArray<DemoFormSection> = [
  {
    titleAr: "بيانات أساسية",
    fields: [
      { labelAr: "الخيط", defaultValue: DEMO_YARN_COUNTS[0]!, ltr: true, type: "select", options: [...DEMO_YARN_COUNTS], customLabelAr: "اكتب نمرة الخيط" },
      { labelAr: "نوعه", defaultValue: DEMO_YARN_TYPES[2]!, ltr: false, type: "select", options: [...DEMO_YARN_TYPES], customLabelAr: "اكتب نوع الخيط" },
      { labelAr: "الخام", defaultValue: DEMO_RAW_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_TYPES], customLabelAr: "اكتب نوع الخام" },
      { labelAr: "معامل برم الفرد", defaultValue: "18.5", ltr: true },
      { labelAr: "معامل برم الزوي", defaultValue: "9.2", ltr: true },
      { labelAr: "الشركة المنتجة للغزل", defaultValue: DEMO_YARN_COMPANIES[0]!, ltr: false, type: "select", options: [...DEMO_YARN_COMPANIES], customLabelAr: "اكتب اسم الشركة المنتجة للغزل" },
      { labelAr: "مصنع الزوي", defaultValue: DEMO_TWISTING_FACTORIES[0]!, ltr: false, type: "select", options: [...DEMO_TWISTING_FACTORIES], customLabelAr: "اكتب اسم مصنع الزوي" },
    ],
  },
  {
    titleAr: "الكميات والأوزان",
    fields: [
      { labelAr: "الوزن القائم", defaultValue: "2,800.000", ltr: true, type: "number" },
      { labelAr: "عدد الشكاير", defaultValue: "56", ltr: true, type: "number" },
      { labelAr: "كمية إنتاج", defaultValue: "2,450.000", ltr: true, type: "number" },
      { labelAr: "وزن الخيط المتوقع", defaultValue: "2,600.000", ltr: true, type: "number" },
      { labelAr: "وزن الخيط الزوي الفعلي", defaultValue: "2,450.000", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "التاريخ والملاحظات",
    fields: [
      { labelAr: "تاريخ الإنتاج", defaultValue: "18/06/2026", ltr: true },
      { labelAr: "ملاحظات", defaultValue: "تم التشغيل بنجاح", ltr: false, type: "textarea" },
      { labelAr: "مكان التخزين", defaultValue: DEMO_STORAGE_LOCATIONS[0]!, ltr: false, type: "select", options: [...DEMO_STORAGE_LOCATIONS], customLabelAr: "اكتب مكان التخزين" },
    ],
  },
];

// --- 4. حركة الخيوط (Yarn Movement) ---

export const YARN_MOVEMENT_SECTIONS: ReadonlyArray<DemoFormSection> = [
  {
    titleAr: "بيانات أساسية",
    fields: [
      { labelAr: "الخيط", defaultValue: DEMO_YARN_COUNTS[0]!, ltr: true, type: "select", options: [...DEMO_YARN_COUNTS], customLabelAr: "اكتب نمرة الخيط" },
      { labelAr: "نوع الخام", defaultValue: DEMO_RAW_TYPES[0]!, ltr: false, type: "select", options: [...DEMO_RAW_TYPES], customLabelAr: "اكتب نوع الخام" },
      { labelAr: "معامل برم الفرد", defaultValue: "18.5", ltr: true },
      { labelAr: "معامل برم الزوي", defaultValue: "9.2", ltr: true },
      { labelAr: "الشركة المنتجة للخيط", defaultValue: DEMO_YARN_COMPANIES[0]!, ltr: false, type: "select", options: [...DEMO_YARN_COMPANIES], customLabelAr: "اكتب اسم الشركة المنتجة للخيط" },
      { labelAr: "جهة النقل", defaultValue: DEMO_STORAGE_LOCATIONS[0]!, ltr: false, type: "select", options: [...DEMO_STORAGE_LOCATIONS, ...DEMO_CUSTOMERS.slice(0, 3)], customLabelAr: "اكتب جهة النقل" },
      { labelAr: "التاريخ", defaultValue: "20/06/2026", ltr: true },
    ],
  },
  {
    titleAr: "الكميات والأوزان",
    fields: [
      { labelAr: "وزن قائم", defaultValue: "1,820.000", ltr: true, type: "number" },
      { labelAr: "عدد شكاير", defaultValue: "36", ltr: true, type: "number" },
    ],
  },
  {
    titleAr: "الغرض والملاحظات",
    fields: [
      { labelAr: "الغرض من النقل", defaultValue: DEMO_TRANSFER_PURPOSES[0]!, ltr: false, type: "select", options: [...DEMO_TRANSFER_PURPOSES], customLabelAr: "اكتب الغرض من النقل" },
      { labelAr: "ملاحظات", defaultValue: "نقل داخلي بين المخازن", ltr: false, type: "textarea" },
    ],
  },
];

// ===========================================================================
// User activity history — سجل نشاط المستخدمين (added 2026-07-06)
//
// Fixture data for the executive/accountant "user activity history" page.
// Lets the executive/accountant select a demo user and view everything that
// user has done in the demo. All data is SYNTHETIC — no real audit log.
// ===========================================================================

export interface DemoActivityUser {
  id: string;
  nameAr: string;
  roleLabelAr: string;
}

// Demo users for the activity selector
export const DEMO_ACTIVITY_USERS: ReadonlyArray<DemoActivityUser> = [
  { id: "ahmed-fathy", nameAr: "أحمد فتحي", roleLabelAr: "مسؤول تسجيل البيانات أو المدخلات" },
  { id: "mohamed-abbasi", nameAr: "محمد عباسي", roleLabelAr: "مسؤول تسجيل البيانات أو المدخلات" },
  { id: "accountant", nameAr: "المدير المالي", roleLabelAr: "المدير المالي" },
  { id: "executive", nameAr: "رئيس مجلس الإدارة", roleLabelAr: "رئيس مجلس الإدارة / العضو المنتدب التنفيذي" },
];

export type DemoActivityStatus = "draft" | "submitted" | "needs_edit" | "approved";

export interface DemoUserActivity {
  userId: string;
  dateTime: string;       // DD/MM/YYYY HH:MM
  operationTypeAr: string;
  documentRef: string;    // المستند / الرقم المرجعي
  sectionAr: string;      // القسم
  status: DemoActivityStatus;
  noteAr: string;         // ملاحظة مختصرة
}

export const DEMO_USER_ACTIVITIES: ReadonlyArray<DemoUserActivity> = [
  // أحمد فتحي — مسؤول تسجيل البيانات
  {
    userId: "ahmed-fathy",
    dateTime: "20/06/2026 10:24",
    operationTypeAr: "إنشاء مسودة شراء خامات",
    documentRef: "PR-2026-0042",
    sectionAr: "إدخال الشراء",
    status: "draft",
    noteAr: "مسودة شراء قطن سودانى من المورد أحمد فتحي",
  },
  {
    userId: "ahmed-fathy",
    dateTime: "20/06/2026 11:15",
    operationTypeAr: "إرسال بيانات بيع خيوط للمراجعة",
    documentRef: "SALE-2026-0015",
    sectionAr: "إدخال البيع",
    status: "submitted",
    noteAr: "بيع خيوط 2/24 للعميل محمد عباسي",
  },
  {
    userId: "ahmed-fathy",
    dateTime: "19/06/2026 14:30",
    operationTypeAr: "تعديل حركة خيوط",
    documentRef: "MV-2026-0008",
    sectionAr: "حركة الخيوط",
    status: "needs_edit",
    noteAr: "تعديل وزن قائم من 1,820 إلى 1,850 كجم",
  },
  {
    userId: "ahmed-fathy",
    dateTime: "19/06/2026 09:00",
    operationTypeAr: "إضافة قيمة غير موجودة بالقائمة: مصنع جديد",
    documentRef: "—",
    sectionAr: "إدخال التشغيل",
    status: "submitted",
    noteAr: "إضافة مصنع زوي «مصنع النور» كقيمة جديدة للمراجعة",
  },
  {
    userId: "ahmed-fathy",
    dateTime: "18/06/2026 16:45",
    operationTypeAr: "حفظ مسودة تشغيل خيوط لدى الشركات",
    documentRef: "OP-2026-0011",
    sectionAr: "إدخال التشغيل",
    status: "draft",
    noteAr: "مسودة تشغيل لدى شركة مصر إيران",
  },
  {
    userId: "ahmed-fathy",
    dateTime: "18/06/2026 08:30",
    operationTypeAr: "إرسال إدخال تشغيل للمراجعة",
    documentRef: "OP-2026-0010",
    sectionAr: "إدخال التشغيل",
    status: "submitted",
    noteAr: "تشغيل خيوط لدى مصنع أبو قمر",
  },

  // محمد عباسي — مسؤول تسجيل البيانات
  {
    userId: "mohamed-abbasi",
    dateTime: "20/06/2026 09:10",
    operationTypeAr: "إنشاء مسودة شراء خيوط",
    documentRef: "YPR-2026-0015",
    sectionAr: "إدخال الشراء",
    status: "draft",
    noteAr: "مسودة شراء خيوط 2/24 من شركة الدلتا",
  },
  {
    userId: "mohamed-abbasi",
    dateTime: "19/06/2026 13:20",
    operationTypeAr: "إرسال بيانات بيع خامات للمراجعة",
    documentRef: "SALE-2026-0014",
    sectionAr: "إدخال البيع",
    status: "submitted",
    noteAr: "بيع قطن مصري للعميل محمود الغوطي",
  },
  {
    userId: "mohamed-abbasi",
    dateTime: "18/06/2026 11:00",
    operationTypeAr: "تعديل حركة خيوط",
    documentRef: "MV-2026-0007",
    sectionAr: "حركة الخيوط",
    status: "needs_edit",
    noteAr: "تعديل جهة النقل من مخازن إلى 31اسكندرية",
  },
  {
    userId: "mohamed-abbasi",
    dateTime: "17/06/2026 15:45",
    operationTypeAr: "حفظ مسودة حركة خيوط",
    documentRef: "MV-2026-0006",
    sectionAr: "حركة الخيوط",
    status: "draft",
    noteAr: "نقل داخلي بين المخازن",
  },

  // المدير المالي — accountant
  {
    userId: "accountant",
    dateTime: "20/06/2026 12:00",
    operationTypeAr: "اعتماد طلب بيع خيوط",
    documentRef: "SALE-2026-0012",
    sectionAr: "مركز الاعتماد والمتابعة",
    status: "approved",
    noteAr: "اعتماد بيع خيوط للعميل محمد عباسي",
  },
  {
    userId: "accountant",
    dateTime: "19/06/2026 10:30",
    operationTypeAr: "رفض طلب شراء خامات",
    documentRef: "PR-2026-0040",
    sectionAr: "مركز الاعتماد والمتابعة",
    status: "needs_edit",
    noteAr: "يحتاج مراجعة السعر — سعر الطن غير مطابق",
  },
  {
    userId: "accountant",
    dateTime: "18/06/2026 14:00",
    operationTypeAr: "اعتماد حركة خيوط",
    documentRef: "MV-2026-0005",
    sectionAr: "مركز الاعتماد والمتابعة",
    status: "approved",
    noteAr: "نقل خيوط للبيع معتمد",
  },

  // رئيس مجلس الإدارة — executive
  {
    userId: "executive",
    dateTime: "20/06/2026 08:00",
    operationTypeAr: "مراجعة لوحة التحكم",
    documentRef: "—",
    sectionAr: "لوحة المعلومات",
    status: "approved",
    noteAr: "مراجعة مؤشرات الأداء اليومية",
  },
  {
    userId: "executive",
    dateTime: "19/06/2026 16:00",
    operationTypeAr: "اعتماد مراجعة تكلفة تشغيل",
    documentRef: "OP-2026-0009",
    sectionAr: "مركز الاعتماد والمتابعة",
    status: "approved",
    noteAr: "اعتماد تكلفة تشغيل لدى شركة شبين",
  },
];

// Helper: get activities for a specific user
export function getActivitiesByUser(userId: string): ReadonlyArray<DemoUserActivity> {
  return DEMO_USER_ACTIVITIES.filter((a) => a.userId === userId);
}

// Helper: get summary counts for a specific user
export function getActivitySummaryByUser(userId: string) {
  const userActivities = getActivitiesByUser(userId);
  return {
    total: userActivities.length,
    drafts: userActivities.filter((a) => a.status === "draft").length,
    submitted: userActivities.filter((a) => a.status === "submitted").length,
    needsEdit: userActivities.filter((a) => a.status === "needs_edit").length,
    lastActivity: userActivities[0]?.dateTime ?? "—",
  };
}
