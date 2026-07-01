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

export const DEMO_USERS: ReadonlyArray<DemoUser> = [
  { role: "owner", displayNameAr: "مالك النظام", landingRoute: "/demo/owner/dashboard" },
  { role: "accountant", displayNameAr: "محاسب المراجعة", landingRoute: "/demo/owner/reviews" },
  { role: "warehouse_employee", displayNameAr: "عامل مخزن 1", landingRoute: "/demo/worker/raw-receipt" },
  { role: "production_employee", displayNameAr: "عامل إنتاج 1", landingRoute: "/demo/owner/production" },
  { role: "quality_employee", displayNameAr: "مسؤول جودة 1", landingRoute: "/demo/owner/reviews" },
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
  { code: "FAC-SPIN-01", nameAr: "مصر ايران", type: "external_factory", totalStockKg: "3,800.000", rawKg: "1,200.000", wipKg: "1,400.000", finishedKg: "1,200.000", status: "active" },
  { code: "FAC-TWIST-01", nameAr: "زوى عبدالحميد", type: "external_factory", totalStockKg: "1,600.000", rawKg: "500.000", wipKg: "700.000", finishedKg: "400.000", status: "active" },
  { code: "FAC-TWIST-02", nameAr: "زوى ابوقمر", type: "external_factory", totalStockKg: "800.000", rawKg: "300.000", wipKg: "-50.000", finishedKg: "550.000", status: "negative_stock" },
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
  { code: "SUP-001", nameAr: "عثمان", type: "supplier", categoryAr: "مورد قطن", balanceEgp: "−45,200.00", activeOrders: 2, relationshipStart: "12/03/2023", status: "active", lastTransactionDate: "20/06/2026" },
  { code: "SUP-002", nameAr: "كارجيل", type: "supplier", categoryAr: "مورد قطن مستورد", balanceEgp: "−120,800.00", activeOrders: 1, relationshipStart: "05/11/2022", status: "active", lastTransactionDate: "18/06/2026" },
  { code: "SUP-003", nameAr: "النيل للتجارة", type: "supplier", categoryAr: "مورد قطن", balanceEgp: "0.00", activeOrders: 0, relationshipStart: "22/01/2024", status: "inactive", lastTransactionDate: "15/02/2026" },
  { code: "CUS-001", nameAr: "عميل النسيج", type: "customer", categoryAr: "عميل مصنّع", balanceEgp: "+85,400.00", activeOrders: 3, relationshipStart: "10/05/2023", status: "active", lastTransactionDate: "20/06/2026" },
  { code: "CUS-002", nameAr: "مصنع الغزال", type: "customer", categoryAr: "عميل مصنّع", balanceEgp: "+12,300.00", activeOrders: 1, relationshipStart: "18/09/2024", status: "active", lastTransactionDate: "19/06/2026" },
  { code: "CUS-003", nameAr: "شركة الأطلس", type: "customer", categoryAr: "عميل تاجر", balanceEgp: "0.00", activeOrders: 0, relationshipStart: "03/07/2023", status: "inactive", lastTransactionDate: "30/04/2026" },
  { code: "FAC-001", nameAr: "مصر ايران", type: "factory", categoryAr: "مصنع حلج/غزل", balanceEgp: "−45,000.00", activeOrders: 2, relationshipStart: "01/01/2022", status: "active", lastTransactionDate: "20/06/2026" },
  { code: "FAC-002", nameAr: "زوى عبدالحميد", type: "factory", categoryAr: "مصنع برم", balanceEgp: "−28,000.00", activeOrders: 1, relationshipStart: "14/06/2022", status: "active", lastTransactionDate: "19/06/2026" },
  { code: "FAC-003", nameAr: "زوى ابوقمر", type: "factory", categoryAr: "مصنع برم", balanceEgp: "−19,000.00", activeOrders: 1, relationshipStart: "20/02/2024", status: "active", lastTransactionDate: "18/06/2026" },
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
  { document: "TR-2026-0004", date: "19/06/2026", typeAr: "نقل مخزون", locationAr: "مخزن مصر ايران", quantityKg: "320.000", direction: "transfer", stateAr: "مرسل للمراجعة" },
  { document: "PR-2026-0003", date: "19/06/2026", typeAr: "استلام إنتاج من مصنع", locationAr: "زوى عبدالحميد", quantityKg: "640.000", direction: "in", stateAr: "مرسل للمراجعة" },
  { document: "ISS-2026-0011", date: "18/06/2026", typeAr: "صرف خام لمصنع", locationAr: "مصر ايران", quantityKg: "800.000", direction: "out", stateAr: "معتمد" },
  { document: "SALE-2026-0012", date: "18/06/2026", typeAr: "صرف بيع", locationAr: "31اسكندرية", quantityKg: "410.000", direction: "out", stateAr: "معتمد" },
  { document: "ADJ-2026-0005", date: "17/06/2026", typeAr: "تسوية مخزون", locationAr: "31اسكندرية", quantityKg: "−12.500", direction: "out", stateAr: "معتمد" },
  { document: "RR-2026-0006", date: "16/06/2026", typeAr: "استلام خام", locationAr: "مخزن مصر ايران", quantityKg: "980.000", direction: "in", stateAr: "معتمد" },
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
  { order: "PO-2026-0014", factoryNameAr: "مصر ايران", factoryCode: "FAC-001", rawMaterialAr: "قطن سودانى", rawIssuedKg: "5,000.000", wipKg: "1,400.000", finishedReceivedKg: "2,800.000", yieldPct: "84.0%", stageAr: "غزل", startDate: "05/06/2026", expectedFinishDate: "25/06/2026", stateAr: "جاري التشغيل" },
  { order: "PO-2026-0013", factoryNameAr: "زوى عبدالحميد", factoryCode: "FAC-002", rawMaterialAr: "قطن مصري", rawIssuedKg: "1,800.000", wipKg: "700.000", finishedReceivedKg: "900.000", yieldPct: "88.9%", stageAr: "برم", startDate: "08/06/2026", expectedFinishDate: "22/06/2026", stateAr: "جاري التشغيل" },
  { order: "PO-2026-0012", factoryNameAr: "زوى ابوقمر", factoryCode: "FAC-003", rawMaterialAr: "قطن سودانى", rawIssuedKg: "1,200.000", wipKg: "−50.000", finishedReceivedKg: "1,150.000", yieldPct: "95.8%", stageAr: "برم", startDate: "01/06/2026", expectedFinishDate: "20/06/2026", stateAr: "يحتاج مراجعة" },
  { order: "PO-2026-0011", factoryNameAr: "مصر ايران", factoryCode: "FAC-001", rawMaterialAr: "قطن مصري", rawIssuedKg: "3,000.000", wipKg: "0.000", finishedReceivedKg: "2,580.000", yieldPct: "86.0%", stageAr: "غزل", startDate: "20/05/2026", expectedFinishDate: "10/06/2026", stateAr: "مكتمل" },
  { order: "PO-2026-0010", factoryNameAr: "زوى عبدالحميد", factoryCode: "FAC-002", rawMaterialAr: "قطن سودانى", rawIssuedKg: "2,200.000", wipKg: "0.000", finishedReceivedKg: "1,920.000", yieldPct: "87.3%", stageAr: "برم", startDate: "12/05/2026", expectedFinishDate: "02/06/2026", stateAr: "مكتمل" },
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
  { factoryCode: "FAC-001", factoryNameAr: "مصر ايران", rawKg: "1,200.000", wipKg: "1,400.000", finishedKg: "1,200.000", totalKg: "3,800.000", payableEgp: "45,000.00" },
  { factoryCode: "FAC-002", factoryNameAr: "زوى عبدالحميد", rawKg: "500.000", wipKg: "700.000", finishedKg: "400.000", totalKg: "1,600.000", payableEgp: "28,000.00" },
  { factoryCode: "FAC-003", factoryNameAr: "زوى ابوقمر", rawKg: "300.000", wipKg: "−50.000", finishedKg: "550.000", totalKg: "800.000", payableEgp: "19,000.00" },
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
  { order: "SALE-2026-0012", customerCode: "CUS-001", customerNameAr: "عميل النسيج", date: "18/06/2026", quantityKg: "410.000", amountEgp: "82,000.00", reservationStatusAr: "محجوز بالكامل", stateAr: "معتمد" },
  { order: "SALE-2026-0011", customerCode: "CUS-002", customerNameAr: "مصنع الغزال", date: "17/06/2026", quantityKg: "180.000", amountEgp: "36,400.00", reservationStatusAr: "محجوز جزئياً", stateAr: "معتمد" },
  { order: "SALE-2026-0010", customerCode: "CUS-001", customerNameAr: "عميل النسيج", date: "15/06/2026", quantityKg: "320.000", amountEgp: "67,200.00", reservationStatusAr: "محجوز بالكامل", stateAr: "معتمد" },
  { order: "SALE-2026-0009", customerCode: "CUS-002", customerNameAr: "مصنع الغزال", date: "14/06/2026", quantityKg: "95.000", amountEgp: "18,050.00", reservationStatusAr: "بانتظار التحقق", stateAr: "مرسل للمراجعة" },
  { order: "SALE-2026-0008", customerCode: "CUS-001", customerNameAr: "عميل النسيج", date: "12/06/2026", quantityKg: "260.000", amountEgp: "54,600.00", reservationStatusAr: "محجوز بالكامل", stateAr: "معتمد" },
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
  { customerCode: "CUS-001", customerNameAr: "عميل النسيج", totalSalesEgp: "203,800.00", paidEgp: "118,400.00", outstandingEgp: "85,400.00", statusAr: "مستحق" },
  { customerCode: "CUS-002", customerNameAr: "مصنع الغزال", totalSalesEgp: "54,450.00", paidEgp: "42,150.00", outstandingEgp: "12,300.00", statusAr: "مستحق" },
  { customerCode: "CUS-003", customerNameAr: "شركة الأطلس", totalSalesEgp: "0.00", paidEgp: "0.00", outstandingEgp: "0.00", statusAr: "—" },
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
  { id: "act-2", document: "PR-2026-0003", date: "19/06/2026", timeAr: "15:42", categoryAr: "استلام إنتاج", summaryAr: "تم استلام إنتاج من مصنع زوى عبدالحميد — يحتاج مراجعة تكلفة التشغيل قبل الاعتماد.", actorAr: "عامل إنتاج 1", severity: "warning" },
  { id: "act-3", document: "PO-2026-0012", date: "18/06/2026", timeAr: "09:10", categoryAr: "إنتاج خارجي", summaryAr: "تنبيه: أمر إنتاج PO-2026-0012 لدى مصنع زوى ابوقمر يظهر مخزون تحت التشغيل بالسالب — يحتاج تحقق فوري.", actorAr: "النظام", severity: "danger" },
  { id: "act-4", document: "SALE-2026-0012", date: "18/06/2026", timeAr: "11:30", categoryAr: "مبيعات", summaryAr: "تم اعتماد أمر البيع SALE-2026-0012 للعميل عميل النسيج بقيمة 82,000.00 جنيه وحجز المخزون بالكامل.", actorAr: "محاسب المراجعة", severity: "success" },
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
  { id: "n-2", titleAr: "مخزون سالب", bodyAr: "موقع زوى ابوقمر يظهر رصيد تحت التشغيل بالسالب — تحقق من حركات الإصدار والاستلام.", date: "20/06/2026", severity: "danger", read: false },
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
  { labelAr: "مخزون لدى مصانع التشغيل", value: "6,200.000 كجم", accent: "accent", chipText: "تشغيل", href: "/demo/owner/production" },
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
  { labelAr: "مركز المراجعات", href: "/demo/owner/reviews", groupAr: "لوحة المعلومات", keywords: ["reviews", "مراجعات", "اعتماد"] },
  { labelAr: "نظرة عامة على المخزون", href: "/demo/owner/inventory", groupAr: "المخزون", keywords: ["inventory", "مخزون", "رصيد"] },
  { labelAr: "الإنتاج لدى مصانع التشغيل", href: "/demo/owner/production", groupAr: "الإنتاج", keywords: ["production", "إنتاج", "مصنع", "تشغيل"] },
  { labelAr: "نظرة عامة على المبيعات", href: "/demo/owner/sales", groupAr: "المبيعات", keywords: ["sales", "مبيعات", "أمر بيع"] },
  { labelAr: "الموردون والعملاء والمصانع", href: "/demo/owner/parties", groupAr: "الإدارة", keywords: ["parties", "suppliers", "customers", "موردين", "عملاء", "مصانع"] },
  { labelAr: "النشاطات والإشعارات", href: "/demo/owner/activity", groupAr: "التقارير", keywords: ["activity", "notifications", "نشاط", "إشعارات"] },
  { labelAr: "استلام خام جديد", href: "/demo/worker/raw-receipt", groupAr: "مهام العامل", keywords: ["raw", "receipt", "استلام", "خام"] },
];

// ---------------------------------------------------------------------------
// Dashboard chart data (reused from reference-fixtures patterns but with
// demo-specific emphasis)
// ---------------------------------------------------------------------------

export const DEMO_DASHBOARD_INVENTORY_COMPOSITION = [
  { labelAr: "خام", valueKg: "10,200.000", color: "var(--color-primary)" },
  { labelAr: "لدى مصانع التشغيل", valueKg: "6,200.000", color: "var(--color-accent)" },
  { labelAr: "خيط جاهز", valueKg: "2,050.000", color: "var(--color-success)" },
] as const;

export const DEMO_DASHBOARD_ATTENTION_ITEMS = [
  { labelAr: "استلام خام بدون سعر", count: 3, severity: "high" as const },
  { labelAr: "مراجعة تكلفة تشغيل", count: 2, severity: "high" as const },
  { labelAr: "مراجعة تحويل مخزون", count: 1, severity: "medium" as const },
  { labelAr: "شكوى مفتوحة", count: 2, severity: "medium" as const },
];

export const DEMO_DASHBOARD_FACTORY_BALANCES = [
  { factoryNameAr: "مصر ايران", stockKg: "3,800.000", payableEgp: "45,000.00" },
  { factoryNameAr: "زوى عبدالحميد", stockKg: "1,600.000", payableEgp: "28,000.00" },
  { factoryNameAr: "زوى ابوقمر", stockKg: "800.000", payableEgp: "19,000.00" },
];

export const DEMO_DASHBOARD_INVENTORY_BY_LOCATION = [
  { label: "31اسكندرية", value: "12,250.000 كجم" },
  { label: "مخزن مصر ايران", value: "3,800.000 كجم" },
  { label: "زوى عبدالحميد", value: "1,600.000 كجم" },
  { label: "زوى ابوقمر", value: "800.000 كجم" },
];

export const DEMO_DASHBOARD_REVIEW_TREND = [
  { label: "16/06", value: "4" },
  { label: "17/06", value: "6" },
  { label: "18/06", value: "5" },
  { label: "19/06", value: "7" },
  { label: "20/06", value: "8" },
];

export const DEMO_DASHBOARD_COMPLAINTS = [
  { label: "مفتوحة", value: "2" },
  { label: "قيد التحقيق", value: "1" },
  { label: "مغلقة", value: "5" },
];
