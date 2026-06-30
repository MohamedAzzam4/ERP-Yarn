/**
 * Reference screen fixtures v1.
 *
 * Source: docs/design/01_reference_screen_terms_and_fixtures.md
 * Version: reference-fixtures-v1
 *
 * DEC-077: Arabic terminology from owner-provided client workbook + this fixture.
 * DEC-078: Canonical synthetic and prohibited-data fixture for the three
 *   Phase 1 reference screens.
 *
 * All data is SYNTHETIC. No real client data.
 * Fixture version: reference-fixtures-v1
 */

export const FIXTURE_VERSION = "reference-fixtures-v1" as const;

// --- Global fixture assumptions ---

export const FIXTURE_TENANT = "tenant-demo-yarn";
export const FIXTURE_DATE_FORMAT = "DD/MM/YYYY";
export const FIXTURE_TIMEZONE = "Africa/Cairo";
export const FIXTURE_CURRENCY = "جنيه";

// --- Users ---

export interface FixtureUser {
  email: string;
  role: string;
  displayNameAr: string;
}

export const FIXTURE_USERS: ReadonlyArray<FixtureUser> = [
  { email: "owner.demo@example.com", role: "owner", displayNameAr: "مالك النظام" },
  { email: "accountant.demo@example.com", role: "accountant", displayNameAr: "محاسب المراجعة" },
  { email: "warehouse.demo@example.com", role: "warehouse_employee", displayNameAr: "عامل مخزن 1" },
  { email: "production.demo@example.com", role: "production_employee", displayNameAr: "عامل إنتاج 1" },
  { email: "quality.demo@example.com", role: "quality_employee", displayNameAr: "مسؤول جودة 1" },
];

// --- Locations ---

export interface FixtureLocation {
  code: string;
  nameAr: string;
  type: "warehouse" | "external_factory";
}

export const FIXTURE_LOCATIONS: ReadonlyArray<FixtureLocation> = [
  { code: "WH-ALX-31", nameAr: "31اسكندرية", type: "warehouse" },
  { code: "WH-MISR-01", nameAr: "مخزن مصر ايران", type: "warehouse" },
  { code: "FAC-SPIN-01", nameAr: "مصر ايران", type: "external_factory" },
  { code: "FAC-TWIST-01", nameAr: "زوى عبدالحميد", type: "external_factory" },
  { code: "FAC-TWIST-02", nameAr: "زوى ابوقمر", type: "external_factory" },
];

// --- Parties ---

export interface FixtureParty {
  code: string;
  nameAr: string;
  type: "supplier" | "customer" | "factory";
}

export const FIXTURE_PARTIES: ReadonlyArray<FixtureParty> = [
  { code: "SUP-001", nameAr: "عثمان", type: "supplier" },
  { code: "SUP-002", nameAr: "كارجيل", type: "supplier" },
  { code: "CUS-001", nameAr: "عميل النسيج", type: "customer" },
  { code: "FAC-001", nameAr: "مصر ايران", type: "factory" },
  { code: "FAC-002", nameAr: "زوى عبدالحميد", type: "factory" },
];

// --- WP-01-05: Worker Raw-Material Receipt Fixture ---

export interface WorkerReceiptFixture {
  screenTitle: string;
  fields: ReadonlyArray<{ labelAr: string; value: string; ltr: boolean }>;
  allowedActions: ReadonlyArray<string>;
  states: ReadonlyArray<{ state: string; expectedBehavior: string }>;
  expectedTotals: {
    netEnteredQuantityKg: string;
    balesCount: number;
    stockPosted: boolean;
    financialFieldsVisible: boolean;
  };
  prohibitedData: ReadonlyArray<string>;
}

export const WORKER_RECEIPT_FIXTURE: WorkerReceiptFixture = {
  screenTitle: "استلام خام جديد",
  fields: [
    { labelAr: "رقم عملية الشراء", value: "PR-2026-0007", ltr: true },
    { labelAr: "تاريخ استلام الخامات", value: "20/06/2026", ltr: true },
    { labelAr: "نوع الخام", value: "قطن سودانى", ltr: false },
    { labelAr: "صنف الخام", value: "السودان", ltr: false },
    { labelAr: "مورد الخام", value: "عثمان", ltr: false },
    { labelAr: "رسالة الخام", value: "1002", ltr: true },
    { labelAr: "موسم", value: "2024/2025", ltr: true },
    { labelAr: "عدد بال الرسالة", value: "25", ltr: true },
    { labelAr: "وزن قائم الرسالة", value: "1,250.000 كجم", ltr: true },
    { labelAr: "مكان التخزين", value: "31اسكندرية", ltr: false },
    { labelAr: "ملاحظات", value: "تم الاستلام ظاهرياً، يحتاج مراجعة الجودة", ltr: false },
  ],
  allowedActions: [
    "حفظ كمسودة",
    "إرسال للمراجعة",
    "إضافة ملاحظة",
  ],
  states: [
    { state: "Initial", expectedBehavior: "Empty form with safe default date and clear labels." },
    { state: "Draft saved", expectedBehavior: "Status chip مسودة; row/activity highlight." },
    { state: "Submitted", expectedBehavior: "Status chip مرسل للمراجعة; no stock posting claim." },
    { state: "Missing option", expectedBehavior: "Temporary text captured and routed for review; official master data is not created." },
    { state: "Permission denied", expectedBehavior: "Arabic denial without financial detail." },
  ],
  expectedTotals: {
    netEnteredQuantityKg: "1,250.000",
    balesCount: 25,
    stockPosted: false,
    financialFieldsVisible: false,
  },
  prohibitedData: [
    "سعر",
    "تكلفة",
    "رصيد",
    "مستحقات",
    "مدفوعات",
    "ربحية",
    "قيد محاسبي",
  ],
};

// --- WP-01-06: Accountant Review Queue Fixture ---

export interface ReviewQueueFixture {
  screenTitle: string;
  summaryCounts: ReadonlyArray<{ categoryAr: string; count: number }>;
  queueRows: ReadonlyArray<{
    document: string;
    typeAr: string;
    submittedByAr: string;
    date: string;
    severity: "low" | "medium" | "high";
    stateAr: string;
  }>;
  actionBehavior: {
    detailDrawerMayOpen: boolean;
    approveRejectArePlaceholders: boolean;
    placeholderActionsDisabled: boolean;
    noToastImpliesRealStatusChange: boolean;
  };
}

export const REVIEW_QUEUE_FIXTURE: ReviewQueueFixture = {
  screenTitle: "مركز المراجعات",
  summaryCounts: [
    { categoryAr: "كل المراجعات المطلوبة", count: 8 },
    { categoryAr: "استلام خام بدون سعر", count: 3 },
    { categoryAr: "مراجعة تكلفة تشغيل", count: 2 },
    { categoryAr: "مراجعة تحويل مخزون", count: 1 },
    { categoryAr: "تكلفة مباشرة", count: 1 },
    { categoryAr: "تحذير ترحيل تاريخي", count: 1 },
  ],
  queueRows: [
    { document: "RR-2026-0007", typeAr: "استلام خام بدون سعر", submittedByAr: "عامل مخزن 1", date: "20/06/2026", severity: "medium", stateAr: "يحتاج مراجعة" },
    { document: "PR-2026-0003", typeAr: "مراجعة تكلفة تشغيل", submittedByAr: "عامل إنتاج 1", date: "19/06/2026", severity: "high", stateAr: "يحتاج مراجعة" },
    { document: "TR-2026-0004", typeAr: "مراجعة تحويل مخزون", submittedByAr: "عامل مخزن 1", date: "19/06/2026", severity: "medium", stateAr: "يحتاج مراجعة" },
    { document: "DC-2026-0002", typeAr: "تكلفة مباشرة", submittedByAr: "محاسب المراجعة", date: "18/06/2026", severity: "low", stateAr: "مسودة مراجعة" },
    { document: "MIG-2026-OPEN", typeAr: "تحذير ترحيل تاريخي", submittedByAr: "مالك النظام", date: "18/06/2026", severity: "high", stateAr: "يحتاج مراجعة" },
  ],
  actionBehavior: {
    detailDrawerMayOpen: true,
    approveRejectArePlaceholders: true,
    placeholderActionsDisabled: true,
    noToastImpliesRealStatusChange: true,
  },
};

// --- WP-01-07: Owner Dashboard Fixture ---

export interface OwnerDashboardFixture {
  screenTitle: string;
  kpiCards: ReadonlyArray<{
    labelAr: string;
    value: string;
    clickTarget: string;
    isFinancial: boolean;
  }>;
  charts: ReadonlyArray<{
    titleAr: string;
    dataPoints: ReadonlyArray<{ label: string; value: string }>;
  }>;
  recentActivity: ReadonlyArray<{
    document: string;
    summaryAr: string;
  }>;
  prohibitedKpis: ReadonlyArray<string>;
  inventoryComposition: ReadonlyArray<{ labelAr: string; valueKg: string; color: string }>;
  attentionItems: ReadonlyArray<{ labelAr: string; count: number; severity: "high" | "medium" | "low" }>;
  factoryBalances: ReadonlyArray<{ factoryNameAr: string; stockKg: string; payableEgp: string }>;
}

export const OWNER_DASHBOARD_FIXTURE: OwnerDashboardFixture = {
  screenTitle: "لوحة التحكم",
  kpiCards: [
    { labelAr: "إجمالي المخزون", value: "18,450.000 كجم", clickTarget: "Inventory balances", isFinancial: false },
    { labelAr: "مخزون لدى مصانع التشغيل", value: "6,200.000 كجم", clickTarget: "Inventory balances filtered to external factories", isFinancial: false },
    { labelAr: "مبيعات الشهر الحالي", value: "320,000.00 جنيه", clickTarget: "Sales list filtered to current month", isFinancial: true },
    { labelAr: "مراجعات مطلوبة", value: "8", clickTarget: "Review Center", isFinancial: false },
    { labelAr: "تحذيرات مهمة", value: "3", clickTarget: "Warning-filtered Review Center", isFinancial: false },
    { labelAr: "شكاوى مفتوحة", value: "2", clickTarget: "Quality and complaints", isFinancial: false },
    { labelAr: "ربحية تقريبية", value: "48,750.00 جنيه", clickTarget: "Profitability summary", isFinancial: true },
    { labelAr: "مستحقات مصانع", value: "92,000.00 جنيه", clickTarget: "Factory statements", isFinancial: true },
  ],
  charts: [
    {
      titleAr: "المخزون حسب الموقع",
      dataPoints: [
        { label: "31اسكندرية", value: "12,250.000 كجم" },
        { label: "مخزن مصر ايران", value: "3,800.000 كجم" },
        { label: "زوى عبدالحميد", value: "2,400.000 كجم" },
      ],
    },
    {
      titleAr: "اتجاه المراجعات",
      dataPoints: [
        { label: "16/06", value: "4" },
        { label: "17/06", value: "6" },
        { label: "18/06", value: "5" },
        { label: "19/06", value: "7" },
        { label: "20/06", value: "8" },
      ],
    },
    {
      titleAr: "الشكاوى حسب الحالة",
      dataPoints: [
        { label: "مفتوحة", value: "2" },
        { label: "قيد التحقيق", value: "1" },
        { label: "مغلقة", value: "5" },
      ],
    },
  ],
  recentActivity: [
    { document: "RR-2026-0007", summaryAr: "استلام خام مرسل للمراجعة" },
    { document: "PR-2026-0003", summaryAr: "استلام إنتاج يحتاج مراجعة تكلفة" },
    { document: "SALE-2026-0012", summaryAr: "بيع معتمد خلال الشهر الحالي" },
  ],
  prohibitedKpis: [
    "كفاءة الإنتاج",
    "إنتاجية العامل",
    "تشغيل الماكينات",
    "عدد الأوامر النشطة",
  ],
  inventoryComposition: [
    { labelAr: "خام", valueKg: "10,200.000", color: "var(--color-primary)" },
    { labelAr: "لدى مصانع التشغيل", valueKg: "6,200.000", color: "var(--color-accent)" },
    { labelAr: "خيط جاهز", valueKg: "2,050.000", color: "var(--color-success)" },
  ],
  attentionItems: [
    { labelAr: "استلام خام بدون سعر", count: 3, severity: "high" },
    { labelAr: "مراجعة تكلفة تشغيل", count: 2, severity: "high" },
    { labelAr: "مراجعة تحويل مخزون", count: 1, severity: "medium" },
    { labelAr: "شكوى مفتوحة", count: 2, severity: "medium" },
  ],
  factoryBalances: [
    { factoryNameAr: "مصر ايران", stockKg: "3,800.000", payableEgp: "45,000.00" },
    { factoryNameAr: "زوى عبدالحميد", stockKg: "1,600.000", payableEgp: "28,000.00" },
    { factoryNameAr: "زوى ابوقمر", stockKg: "800.000", payableEgp: "19,000.00" },
  ],
};
