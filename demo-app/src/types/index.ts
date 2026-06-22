/**
 * Quick Interactive ERP Showcase — domain types.
 *
 * These types model the synthetic Egyptian yarn-trading demo data only.
 * They are NOT the operational ERP schema and must never be used as a
 * contract for posting, accounting, or migration truth.
 *
 * Source-of-truth documents read before implementation:
 *  - /docs/00_project_context.md
 *  - /docs/contracts/02_design_system_and_ux_contract.md
 *  - /docs/contracts/10_frontend_screen_contracts.md
 *  - /docs/contracts/11_permission_matrix.md
 *  - /docs/demo/01_quick_interactive_showcase_glm_prompt.md
 */

export type Role = "owner" | "accountant" | "warehouse" | "production" | "quality";

export interface RoleInfo {
  id: Role;
  labelAr: string;
  labelEn: string;
  mode: "management" | "worker";
  descriptionAr: string;
}

export const ROLES: RoleInfo[] = [
  {
    id: "owner",
    labelAr: "المالك",
    labelEn: "Owner",
    mode: "management",
    descriptionAr: "رؤية شاملة، اعتمادات، أرصدة، ربحية تقريبية، تنبيهات، تتبّع.",
  },
  {
    id: "accountant",
    labelAr: "محاسب",
    labelEn: "Accountant",
    mode: "management",
    descriptionAr: "قوائم المراجعة، الأرصدة، المدفوعات، مراجعة التكاليف المباشرة، تحذيرات الترحيل.",
  },
  {
    id: "warehouse",
    labelAr: "عامل مخزن",
    labelEn: "Warehouse Worker",
    mode: "worker",
    descriptionAr: "استلام خام، نقل مخزون، استلام مرتجعات — بلا بيانات مالية.",
  },
  {
    id: "production",
    labelAr: "عامل إنتاج",
    labelEn: "Production Worker",
    mode: "worker",
    descriptionAr: "صرف للإنتاج، استلام إنتاج فرد/زوى، مرتجع ودائع — بلا أسعار أو معدلات.",
  },
  {
    id: "quality",
    labelAr: "عامل جودة",
    labelEn: "Quality Worker",
    mode: "worker",
    descriptionAr: "تسجيل نتائج الاختبارات، وضع/رفع HOLD، تحقيقات الشكاوى — بلا بيانات مالية.",
  },
];

/** Worker roles enforce the absolute financial-deny ceiling. */
export const WORKER_ROLES: Role[] = ["warehouse", "production", "quality"];

export type ItemCategory = "raw" | "single_yarn" | "twisted_yarn";

export interface Item {
  id: string;
  code: string;
  nameAr: string;
  category: ItemCategory;
  unitAr: string;
}

export interface Supplier {
  id: string;
  code: string;
  nameAr: string;
  phone: string;
  balanceEgp?: number;
}

export interface Customer {
  id: string;
  code: string;
  nameAr: string;
  phone: string;
  balanceEgp?: number;
}

export interface Factory {
  id: string;
  code: string;
  nameAr: string;
  type: "single_yarn" | "twisting";
  locationId: string;
  balanceEgp?: number;
}

export interface Location {
  id: string;
  code: string;
  nameAr: string;
  type: "internal" | "port" | "factory" | "return";
  factoryId?: string;
}

export type QualityStatus = "accepted" | "needs_review" | "blocked";

export interface RawBatch {
  id: string;
  code: string;
  itemId: string;
  supplierId: string;
  receiptDate: string;
  receiptLocationId: string;
  quantityKg: number;
  baleCount?: number;
  qualityStatus: QualityStatus;
  notes?: string;
  pricePerTonEgp?: number;
  totalCostEgp?: number;
  hasMissingPrice: boolean;
}

export interface YarnLot {
  id: string;
  code: string;
  category: ItemCategory;
  itemId: string;
  factoryId: string;
  productionOrderId: string;
  outputDate: string;
  quantityKg: number;
  wasteKg?: number;
  inputBatchIds: string[];
  qualityStatus: QualityStatus;
  factoryRatePerTonEgp?: number;
  calculatedCostEgp?: number;
  hasMissingCost: boolean;
}

export type InventoryMovementType =
  | "raw_receipt"
  | "transfer"
  | "issue_to_production"
  | "production_receipt"
  | "wip_return"
  | "sale_issue"
  | "return_received"
  | "adjustment";

export interface InventoryMovement {
  id: string;
  date: string;
  type: InventoryMovementType;
  itemId: string;
  batchOrLotId: string;
  fromLocationId?: string;
  toLocationId?: string;
  quantityKg: number;
  reference?: string;
  notes?: string;
  approvalStatus: ApprovalStatus;
}

export interface InventoryBalance {
  locationId: string;
  itemId: string;
  batchOrLotId: string;
  onHandKg: number;
  reservedKg: number;
  blockedKg: number;
  returnedKg: number;
}

export type ApprovalStatus = "draft" | "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalCategory =
  | "raw_receipt"
  | "transfer"
  | "adjustment"
  | "sale"
  | "production_issue"
  | "production_receipt"
  | "wip_return"
  | "payment"
  | "payment_reversal"
  | "quality_risk_sale"
  | "negative_stock"
  | "correction"
  | "migration"
  | "return";

export interface ApprovalItem {
  id: string;
  category: ApprovalCategory;
  titleAr: string;
  reference: string;
  submittedAt: string;
  submittedByAr: string;
  amountEgp?: number;
  quantityKg?: number;
  status: ApprovalStatus;
  reasonAr?: string;
  warningAr?: string;
}

export interface ProductionOrder {
  id: string;
  code: string;
  type: "single_yarn" | "twisted_yarn";
  factoryId: string;
  inputItemIds: string[];
  outputItemId: string;
  status: "draft" | "in_progress" | "completed" | "wip_returned";
  plannedInputKg: number;
  issuedKg: number;
  consumedKg: number;
  wasteKg: number;
  outputKg: number;
  wipRemainingKg: number;
  startDate: string;
  endDate?: string;
  factoryRatePerTonEgp?: number;
  payableEgp?: number;
  hasMissingCost: boolean;
}

export interface SalesLine {
  itemId: string;
  batchOrLotId: string;
  quantityKg: number;
  unitPriceEgp?: number;
  discountPct?: number;
  lineNetEgp?: number;
}

export interface Sale {
  id: string;
  code: string;
  customerId: string;
  date: string;
  status: ApprovalStatus;
  lines: SalesLine[];
  reservationIds: string[];
  grossRevenueEgp?: number;
  discountAmountEgp?: number;
  netRevenueEgp?: number;
  profitEgp?: number;
  profitMarginPct?: number;
  missingCostFlags?: string[];
}

export interface Reservation {
  id: string;
  saleId: string;
  itemId: string;
  batchOrLotId: string;
  locationId: string;
  quantityKg: number;
  status: "active" | "consumed" | "released";
}

export interface Payment {
  id: string;
  code: string;
  direction: "inbound" | "outbound";
  partyType: "customer" | "supplier" | "factory";
  partyId: string;
  date: string;
  amountEgp: number;
  method: "cash" | "bank_transfer" | "cheque";
  status: ApprovalStatus;
  settledAgainst?: string;
  notes?: string;
}

export interface SubledgerEntry {
  id: string;
  date: string;
  partyType: "customer" | "supplier" | "factory";
  partyId: string;
  direction: "debit" | "credit";
  amountEgp: number;
  reference: string;
  sourcePaymentId?: string;
  sourceSaleId?: string;
}

export interface QualityTest {
  id: string;
  code: string;
  batchOrLotId: string;
  testTypeAr: string;
  value: string;
  testDate: string;
  status: QualityStatus;
  technicianAr: string;
  notes?: string;
}

export interface Complaint {
  id: string;
  code: string;
  customerId: string;
  saleId: string;
  itemId: string;
  openedDate: string;
  affectedQuantityKg: number;
  status: "open" | "investigating" | "return_proposed" | "resolved" | "closed";
  qualityFindingsAr?: string;
  treatment?: "no_financial_impact" | "customer_credit" | "refund_due" | "replacement";
  creditValueEgp?: number;
}

export interface ReturnRecord {
  id: string;
  code: string;
  complaintId?: string;
  customerId: string;
  saleId?: string;
  itemId: string;
  date: string;
  quantityKg: number;
  classification:
    | "return_received"
    | "needs_quality_review"
    | "sellable_as_is"
    | "sellable_with_discount"
    | "blocked"
    | "reprocess_required";
  returnLocationId: string;
  status: ApprovalStatus;
  treatment?: "no_financial_impact" | "customer_credit" | "refund_due" | "replacement";
  creditValueEgp?: number;
}

export interface DirectCostItem {
  id: string;
  code: string;
  linkedOperationAr: string;
  amountEgp: number;
  workerSuggestionAr?: string;
  confirmedResponsibilityAr?: string;
  confirmedPayerType?: string;
  allocationTarget?: string;
  status: "pending_review" | "approved" | "rejected";
  profitabilityIncluded: boolean;
}

export interface MigrationBatch {
  id: string;
  code: string;
  fileName: string;
  fileHash: string;
  sourcePeriod: string;
  uploadedAt: string;
  status:
    | "uploaded"
    | "processing"
    | "staged"
    | "validated"
    | "reconciled"
    | "review"
    | "approved"
    | "committed"
    | "rejected"
    | "cancelled";
  rowCount: number;
  validationWarnings: number;
  validationBlockers: number;
  reconciliationDifferenceEgp?: number;
  ownerApproved: boolean;
  accountantApproved: boolean;
  isLocked: boolean;
}

export interface MigrationStagingRow {
  id: string;
  batchId: string;
  rowNumber: number;
  sourceDescriptionAr: string;
  normalizedTypeAr: string;
  amountEgp?: number;
  quantityKg?: number;
  severity: "ok" | "warning" | "blocker";
  aiTransformed: boolean;
  warningAr?: string;
}

export interface TraceabilityEvent {
  id: string;
  batchOrLotId: string;
  date: string;
  typeAr: string;
  descriptionAr: string;
  relatedId?: string;
  quantityKg?: number;
}

export interface BackupRecord {
  id: string;
  environment: "demo_local" | "free_tier";
  lastBackupAt: string;
  lastRestoreTestAt?: string;
  operatorAr: string;
  status: "ok" | "warning" | "failed" | "not_configured";
  checksumRef: string;
  evidenceAr: string;
}

export interface UserRecord {
  id: string;
  nameAr: string;
  email: string;
  phone: string;
  role: Role;
  status: "active" | "inactive";
  lastActiveAt: string;
}

export interface Setting {
  key: string;
  valueAr: string;
  editable: boolean;
  category: "company" | "terminology" | "operations" | "deferred";
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  actorAr: string;
  actionAr: string;
  category: "warehouse" | "production" | "quality" | "sales" | "payment" | "approval" | "migration";
  reference?: string;
}

export interface DemoState {
  version: number;
  currentRole: Role;
  items: Item[];
  suppliers: Supplier[];
  customers: Customer[];
  factories: Factory[];
  locations: Location[];
  rawBatches: RawBatch[];
  yarnLots: YarnLot[];
  movements: InventoryMovement[];
  balances: InventoryBalance[];
  approvals: ApprovalItem[];
  productionOrders: ProductionOrder[];
  sales: Sale[];
  reservations: Reservation[];
  payments: Payment[];
  subledgerEntries: SubledgerEntry[];
  qualityTests: QualityTest[];
  complaints: Complaint[];
  returns: ReturnRecord[];
  directCosts: DirectCostItem[];
  migrationBatches: MigrationBatch[];
  migrationStagingRows: MigrationStagingRow[];
  traceabilityEvents: TraceabilityEvent[];
  backups: BackupRecord[];
  users: UserRecord[];
  settings: Setting[];
  activity: ActivityEntry[];
  storyProgress: {
    step1_rawReceipt: boolean;
    step2_transfer: boolean;
    step3_issue: boolean;
    step4_output: boolean;
    step5_saleDraft: boolean;
    step6_saleApproved: boolean;
    step7_payment: boolean;
    step8_complaintReturn: boolean;
  };
}
