/**
 * Drizzle schema barrel for ERP-Yarn.
 *
 * WP-00-03A scope: platform/security foundation only. Domain schemas
 * (inventory, production, sales/returns, payments, migration) land in
 * WP-00-03B–E and will be added to this barrel by those packages.
 *
 * Contract: docs/contracts/03_database_schema_contract.md
 * Contract: docs/contracts/13_work_packages.md WP-00-03A
 */

// Platform tables
export { tenants } from "./tenants";
export type { Tenant, NewTenant } from "./tenants";

export { users } from "./users";
export type { User, NewUser } from "./users";

export { roles, permissions, userRoles, rolePermissions } from "./roles";
export type {
  Role,
  NewRole,
  Permission,
  NewPermission,
  UserRole,
  NewUserRole,
  RolePermission,
  NewRolePermission,
} from "./roles";

export { workerScopeAssignments } from "./worker-scope";
export type {
  WorkerScopeAssignment,
  NewWorkerScopeAssignment,
} from "./worker-scope";

export { tenantSettings } from "./tenant-settings";
export type { TenantSetting, NewTenantSetting } from "./tenant-settings";

export { terminologyLabels } from "./terminology";
export type {
  TerminologyLabel,
  NewTerminationLabel,
} from "./terminology";

export { documentSequences } from "./document-sequences";
export type {
  DocumentSequence,
  NewDocumentSequence,
} from "./document-sequences";

export { approvalRequests } from "./approval-requests";
export type {
  ApprovalRequest,
  NewApprovalRequest,
} from "./approval-requests";

export { auditLogs } from "./audit-logs";
export type { AuditLog, NewAuditLog } from "./audit-logs";

export { idempotencyRecords } from "./idempotency";
export type {
  IdempotencyRecord,
  NewIdempotencyRecord,
} from "./idempotency";

export { operationalAlerts } from "./operational-alerts";
export type {
  OperationalAlert,
  NewOperationalAlert,
} from "./operational-alerts";

// Enums (re-exported for service/test use)
export {
  roleCode,
  approvalStatus,
  recordOrigin,
  recordPeriod,
  approvalRiskLevel,
  approvalRequestState,
  idempotencyState,
  alertSeverity,
  alertState,
  tenantSettingLevel,
  workerScopeType,
  userStatus,
  tenantStatus,
  roleSystemFlag,
} from "./enums";

// ---------------------------------------------------------------------------
// WP-00-03B: Master data + inventory identity + inventory ledger
// ---------------------------------------------------------------------------

// Master data
export {
  suppliers,
  customers,
  locations,
  externalFactories,
  fiberTypes,
  productTypes,
  qualityParameters,
} from "./master-data";
export type {
  Supplier,
  NewSupplier,
  Customer,
  NewCustomer,
  Location,
  NewLocation,
  ExternalFactory,
  NewExternalFactory,
  FiberType,
  NewFiberType,
  ProductType,
  NewProductType,
  QualityParameter,
  NewQualityParameter,
} from "./master-data";

// Inventory identity
export {
  inventoryItems,
  rawMaterialBatches,
  yarnLots,
} from "./inventory-items";
export type {
  InventoryItem,
  NewInventoryItem,
  RawMaterialBatch,
  NewRawMaterialBatch,
  YarnLot,
  NewYarnLot,
} from "./inventory-items";

// Inventory ledger
export {
  stockMovements,
  inventoryBalances,
  stockReservations,
  inventoryAdjustments,
} from "./inventory-ledger";
export type {
  StockMovement,
  NewStockMovement,
  InventoryBalance,
  NewInventoryBalance,
  StockReservation,
  NewStockReservation,
  InventoryAdjustment,
  NewInventoryAdjustment,
} from "./inventory-ledger";

// Inventory enums
export {
  factoryType,
  itemKind,
  locationType,
  qualityStatus,
  movementType,
  movementStatus,
  reservationStatus,
  returnedStockStatus,
  adjustmentDirection,
  masterDataStatus,
} from "./inventory-enums";

// ---------------------------------------------------------------------------
// WP-00-03C: Production and WIP schema
// ---------------------------------------------------------------------------

// Production tables
export {
  productionOrders,
  productionInputs,
  productionOutputs,
  productionWipBalances,
} from "./production-orders";
export type {
  ProductionOrder,
  NewProductionOrder,
  ProductionInput,
  NewProductionInput,
  ProductionOutput,
  NewProductionOutput,
  ProductionWipBalance,
  NewProductionWipBalance,
} from "./production-orders";

export {
  productionReceipts,
  productionReceiptInputAllocations,
  productionWasteEntries,
  productionWipReturns,
} from "./production-receipts";
export type {
  ProductionReceipt,
  NewProductionReceipt,
  ProductionReceiptInputAllocation,
  NewProductionReceiptInputAllocation,
  ProductionWasteEntry,
  NewProductionWasteEntry,
  ProductionWipReturn,
  NewProductionWipReturn,
} from "./production-receipts";

// Production enums
export {
  productionType,
  productionStatus,
  historicalCostBasisSource,
  wipReturnStatus,
} from "./production-enums";

// ---------------------------------------------------------------------------
// WP-00-03D: Sales, Returns, Subledger and Cost Schema
// ---------------------------------------------------------------------------

// Financial enums
export {
  saleStatus, returnStatus, returnFinancialTreatment,
  paymentStatus, paymentDirection, paymentMethod,
  settlementStatus, accountOwnerType, accountEntryType,
  directCostType, costResponsibilityType, actualPayerType,
  reviewStatus, snapshotActiveState,
} from "./financial-enums";

// Sales
export { salesOrders, salesOrderLines, salesProfitabilitySnapshots } from "./sales";
export type {
  SalesOrder, NewSalesOrder,
  SalesOrderLine, NewSalesOrderLine,
  SalesProfitabilitySnapshot, NewSalesProfitabilitySnapshot,
} from "./sales";

// Returns
export { returnRequests, returnLines } from "./returns";
export type {
  ReturnRequest, NewReturnRequest,
  ReturnLine, NewReturnLine,
} from "./returns";

// Subledger
export {
  accounts, accountEntries, payments, paymentSettlements,
  directCosts, directCostAllocations, rawPurchasePriceConfirmations,
} from "./subledger";
export type {
  Account, NewAccount,
  AccountEntry, NewAccountEntry,
  Payment, NewPayment,
  PaymentSettlement, NewPaymentSettlement,
  DirectCost, NewDirectCost,
  DirectCostAllocation, NewDirectCostAllocation,
} from "./subledger";

// ---------------------------------------------------------------------------
// WP-00-03E: Historical Migration Schema
// ---------------------------------------------------------------------------

export {
  importBatchStatus, validationSeverity, cutoverImportMode,
  aliasMappingStatus, migrationApproverRole, correctionRequestStatus,
  reviewItemDecision, reconciliationResultStatus,
} from "./migration-enums";

export {
  importBatches, importFiles, importTemplateVersions,
  importStagingRows, importStagingCells,
  importValidationErrors, importReconciliationResults,
  importHumanReviewItems, importAliasMappings,
  importBatchApprovals, importCutoverManifests,
  historicalCorrectionRequests,
} from "./migration";
export type {
  ImportBatch, NewImportBatch,
  ImportFile, NewImportFile,
  ImportTemplateVersion, NewImportTemplateVersion,
  ImportStagingRow, NewImportStagingRow,
  ImportStagingCell, NewImportStagingCell,
  ImportValidationError, NewImportValidationError,
  ImportReconciliationResult, NewImportReconciliationResult,
  ImportHumanReviewItem, NewImportHumanReviewItem,
  ImportAliasMapping, NewImportAliasMapping,
  ImportBatchApproval, NewImportBatchApproval,
  ImportCutoverManifest, NewImportCutoverManifest,
  HistoricalCorrectionRequest, NewHistoricalCorrectionRequest,
} from "./migration";

// Quality tables (WP-06-01)
export { qualityTests, qualityTestValues, qualityHolds } from "./quality";
export type {
  QualityTest,
  NewQualityTest,
  QualityTestValue,
  NewQualityTestValue,
  QualityHold,
  NewQualityHold,
} from "./quality";
