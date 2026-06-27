/**
 * Historical migration schema.
 * Contract 03 §14 + Contract 08.
 * DEC-069/070/071/072.
 */
import {
  text, uuid, numeric, timestamp, boolean, integer, jsonb, date,
  pgTable, uniqueIndex, index, check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";
import {
  importBatchStatus, validationSeverity, cutoverImportMode,
  aliasMappingStatus, migrationApproverRole, correctionRequestStatus,
  reviewItemDecision, reconciliationResultStatus,
} from "./migration-enums";

const usersId = users.id!;

// ---------------------------------------------------------------------------
// import_batches
// ---------------------------------------------------------------------------

export const importBatches = pgTable("import_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  batchNo: text("batch_no").notNull(),
  status: importBatchStatus("status").notNull().default("draft"),
  sourceDescription: text("source_description"),
  // Template/mapping versions
  templateName: text("template_name"),
  templateVersion: text("template_version"),
  mappingVersion: text("mapping_version"),
  // Cutover manifest (DEC-071)
  cutoverManifestHash: text("cutover_manifest_hash"),
  cutoverImportMode: cutoverImportMode("cutover_import_mode").notNull().default("opening_balance"),
  // Staged-data hash (binds validation/reconciliation/approvals)
  stagedDataHash: text("staged_data_hash"),
  // Counts
  stagedRowCount: integer("staged_row_count").notNull().default(0),
  blockingErrorCount: integer("blocking_error_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  acceptedWarningCount: integer("accepted_warning_count").notNull().default(0),
  // Validation/reconciliation status
  validationStatus: text("validation_status"),
  reconciliationStatus: text("reconciliation_status"),
  warningSummary: text("warning_summary"),
  // Commit metadata
  committedAt: timestamp("committed_at", { withTimezone: true, mode: "date" }),
  commitEffectCounts: jsonb("commit_effect_counts"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("import_batches_tenant_batch_no_unique_idx").on(t.tenantId, t.batchNo),
  index("import_batches_tenant_status_idx").on(t.tenantId, t.status),
  check("import_batches_staged_count_check", sql`staged_row_count >= 0`),
  check("import_batches_blocking_count_check", sql`blocking_error_count >= 0`),
  check("import_batches_warning_count_check", sql`warning_count >= 0`),
]);

export type ImportBatch = typeof importBatches.$inferSelect;
export type NewImportBatch = typeof importBatches.$inferInsert;

// ---------------------------------------------------------------------------
// import_files
// ---------------------------------------------------------------------------

export const importFiles = pgTable("import_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  originalFileName: text("original_file_name").notNull(),
  storagePath: text("storage_path").notNull(),
  fileHash: text("file_hash").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  contentType: text("content_type"),
  fileType: text("file_type").notNull(), // 'source' | 'normalized' | 'mapping' | 'report'
  supersededById: uuid("superseded_by_id"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_files_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_files_tenant_hash_idx").on(t.tenantId, t.fileHash),
  uniqueIndex("import_files_tenant_batch_hash_type_unique_idx").on(t.tenantId, t.importBatchId, t.fileHash, t.fileType),
]);

export type ImportFile = typeof importFiles.$inferSelect;
export type NewImportFile = typeof importFiles.$inferInsert;

// ---------------------------------------------------------------------------
// import_template_versions
// ---------------------------------------------------------------------------

export const importTemplateVersions = pgTable("import_template_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  templateName: text("template_name").notNull(),
  templateVersion: text("template_version").notNull(),
  schemaJson: jsonb("schema_json").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("import_template_versions_tenant_name_version_unique_idx").on(t.tenantId, t.templateName, t.templateVersion),
  index("import_template_versions_tenant_active_idx").on(t.tenantId, t.isActive),
]);

export type ImportTemplateVersion = typeof importTemplateVersions.$inferSelect;
export type NewImportTemplateVersion = typeof importTemplateVersions.$inferInsert;

// ---------------------------------------------------------------------------
// import_staging_rows
// ---------------------------------------------------------------------------

export const importStagingRows = pgTable("import_staging_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  importFileId: uuid("import_file_id").references(() => importFiles.id),
  templateName: text("template_name"),
  sourceSheetName: text("source_sheet_name"),
  sourceRowNumber: integer("source_row_number"),
  rawRowJson: jsonb("raw_row_json"),
  transformedRowJson: jsonb("transformed_row_json"),
  validationStatus: text("validation_status").notNull().default("pending"),
  reviewStatus: text("review_status").notNull().default("not_required"),
  aiConfidence: numeric("ai_confidence", { precision: 18, scale: 6 }),
  transformationNotes: text("transformation_notes"),
  // Post-commit link to the operational record created from this staging row
  committedEntityType: text("committed_entity_type"),
  committedEntityId: uuid("committed_entity_id"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_staging_rows_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_staging_rows_tenant_status_idx").on(t.tenantId, t.validationStatus),
  index("import_staging_rows_tenant_committed_idx").on(t.tenantId, t.committedEntityType, t.committedEntityId),
  check("import_staging_rows_source_row_check", sql`source_row_number IS NULL OR source_row_number >= 0`),
]);

export type ImportStagingRow = typeof importStagingRows.$inferSelect;
export type NewImportStagingRow = typeof importStagingRows.$inferInsert;

// ---------------------------------------------------------------------------
// import_staging_cells
// ---------------------------------------------------------------------------

export const importStagingCells = pgTable("import_staging_cells", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  stagingRowId: uuid("staging_row_id").notNull().references(() => importStagingRows.id),
  sourceColumn: text("source_column").notNull(),
  originalCellValue: text("original_cell_value"),
  formulaText: text("formula_text"),
  calculatedValue: text("calculated_value"),
  transformedValue: text("transformed_value"),
  mappedField: text("mapped_field"),
  transformationType: text("transformation_type"),
  transformationVersion: text("transformation_version"),
  confidenceLevel: numeric("confidence_level", { precision: 18, scale: 6 }),
  warningCode: text("warning_code"),
  reviewStatus: text("review_status").notNull().default("not_required"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_staging_cells_tenant_row_idx").on(t.tenantId, t.stagingRowId),
]);

export type ImportStagingCell = typeof importStagingCells.$inferSelect;
export type NewImportStagingCell = typeof importStagingCells.$inferInsert;

// ---------------------------------------------------------------------------
// import_validation_errors
// ---------------------------------------------------------------------------

export const importValidationErrors = pgTable("import_validation_errors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  stagingRowId: uuid("staging_row_id").references(() => importStagingRows.id),
  severity: validationSeverity("severity").notNull(),
  errorCode: text("error_code").notNull(),
  message: text("message").notNull(),
  fieldName: text("field_name"),
  isBlocking: boolean("is_blocking").notNull().default(false),
  resolutionStatus: text("resolution_status").notNull().default("open"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
  resolutionNotes: text("resolution_notes"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_validation_errors_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_validation_errors_tenant_severity_idx").on(t.tenantId, t.severity),
  index("import_validation_errors_tenant_blocking_idx").on(t.tenantId, t.isBlocking),
  // Severity blocking_error implies is_blocking = true
  check("import_validation_errors_blocking_check",
    sql`severity <> 'blocking_error' OR is_blocking = true`),
]);

export type ImportValidationError = typeof importValidationErrors.$inferSelect;
export type NewImportValidationError = typeof importValidationErrors.$inferInsert;

// ---------------------------------------------------------------------------
// import_reconciliation_results
// ---------------------------------------------------------------------------

export const importReconciliationResults = pgTable("import_reconciliation_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  reportVersion: integer("report_version").notNull().default(1),
  metricKey: text("metric_key").notNull(),
  expectedValue: text("expected_value"),
  stagedValue: text("staged_value"),
  committedValue: text("committed_value"),
  differenceValue: text("difference_value"),
  status: reconciliationResultStatus("status").notNull().default("pending"),
  // DEC-072: accepted differences require explicit metadata
  acceptedByOwner: uuid("accepted_by_owner").references(() => users.id),
  acceptedByAccountant: uuid("accepted_by_accountant").references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  acceptanceReason: text("acceptance_reason"),
  notes: text("notes"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_reconciliation_results_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_reconciliation_results_tenant_status_idx").on(t.tenantId, t.status),
  index("import_reconciliation_results_tenant_metric_idx").on(t.tenantId, t.metricKey),
  check("import_reconciliation_results_version_check", sql`report_version >= 1`),
  // DEC-072: accepted_difference requires both approvers + reason
  check("import_reconciliation_results_accepted_check",
    sql`status <> 'accepted_difference' OR (accepted_by_owner IS NOT NULL AND accepted_by_accountant IS NOT NULL AND acceptance_reason IS NOT NULL)`),
]);

export type ImportReconciliationResult = typeof importReconciliationResults.$inferSelect;
export type NewImportReconciliationResult = typeof importReconciliationResults.$inferInsert;

// ---------------------------------------------------------------------------
// import_human_review_items
// ---------------------------------------------------------------------------

export const importHumanReviewItems = pgTable("import_human_review_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  stagingRowId: uuid("staging_row_id").references(() => importStagingRows.id),
  reviewReason: text("review_reason").notNull(),
  assignedTo: uuid("assigned_to").references(() => users.id),
  status: reviewItemDecision("status").notNull().default("pending"),
  decision: reviewItemDecision("decision"),
  decisionNotes: text("decision_notes"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_human_review_items_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_human_review_items_tenant_status_idx").on(t.tenantId, t.status),
]);

export type ImportHumanReviewItem = typeof importHumanReviewItems.$inferSelect;
export type NewImportHumanReviewItem = typeof importHumanReviewItems.$inferInsert;

// ---------------------------------------------------------------------------
// import_alias_mappings
// ---------------------------------------------------------------------------

export const importAliasMappings = pgTable("import_alias_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  entityType: text("entity_type").notNull(), // 'supplier' | 'customer' | 'factory' | etc.
  sourceLabel: text("source_label").notNull(),
  normalizedName: text("normalized_name").notNull(),
  targetMasterId: uuid("target_master_id"),
  mappingVersion: text("mapping_version"),
  confidenceScore: numeric("confidence_score", { precision: 18, scale: 6 }),
  status: aliasMappingStatus("status").notNull().default("candidate"),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  notes: text("notes"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_alias_mappings_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_alias_mappings_tenant_status_idx").on(t.tenantId, t.status),
  index("import_alias_mappings_tenant_entity_source_idx").on(t.tenantId, t.entityType, t.sourceLabel),
]);

export type ImportAliasMapping = typeof importAliasMappings.$inferSelect;
export type NewImportAliasMapping = typeof importAliasMappings.$inferInsert;

// ---------------------------------------------------------------------------
// import_batch_approvals (DEC-069: dual distinct user identity)
// ---------------------------------------------------------------------------

export const importBatchApprovals = pgTable("import_batch_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  approverRole: migrationApproverRole("approver_role").notNull(),
  approverUserId: uuid("approver_user_id").notNull().references(() => users.id),
  // Bind to exact versions/hashes at approval time
  stagedDataHash: text("staged_data_hash").notNull(),
  cutoverManifestHash: text("cutover_manifest_hash").notNull(),
  templateVersion: text("template_version"),
  mappingVersion: text("mapping_version"),
  validationStatus: text("validation_status").notNull(),
  reconciliationStatus: text("reconciliation_status").notNull(),
  warningSummary: text("warning_summary"),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  reason: text("reason"),
  // DEC-069: one approval per role per batch — unique constraint
  // The distinct-user requirement is enforced by: (a) unique (batch, role)
  // preventing two Owner approvals, and (b) a CHECK that owner_approver ≠
  // accountant_approver which would require a cross-row constraint. The
  // service layer enforces distinct user identities; the DB enforces one
  // approval per role.
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  // DEC-069: one approval per role per batch
  uniqueIndex("import_batch_approvals_tenant_batch_role_unique_idx")
    .on(t.tenantId, t.importBatchId, t.approverRole),
  index("import_batch_approvals_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_batch_approvals_tenant_approver_idx").on(t.tenantId, t.approverUserId),
]);

export type ImportBatchApproval = typeof importBatchApprovals.$inferSelect;
export type NewImportBatchApproval = typeof importBatchApprovals.$inferInsert;

// ---------------------------------------------------------------------------
// import_cutover_manifests (DEC-071: opening balances only for MVP)
// ---------------------------------------------------------------------------

export const importCutoverManifests = pgTable("import_cutover_manifests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  domain: text("domain").notNull(), // 'inventory' | 'customer_balances' | etc.
  importMode: cutoverImportMode("import_mode").notNull().default("opening_balance"),
  cutoffDate: date("cutoff_date"),
  sourceCoverage: text("source_coverage"),
  openingBalanceBasis: text("opening_balance_basis"),
  liveSystemStartBoundary: date("live_system_start_boundary"),
  reconciliationOwner: uuid("reconciliation_owner").references(() => users.id),
  manifestHash: text("manifest_hash").notNull(),
  isApproved: boolean("is_approved").notNull().default(false),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_cutover_manifests_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_cutover_manifests_tenant_domain_idx").on(t.tenantId, t.domain),
  uniqueIndex("import_cutover_manifests_tenant_batch_domain_unique_idx").on(t.tenantId, t.importBatchId, t.domain),
]);

export type ImportCutoverManifest = typeof importCutoverManifests.$inferSelect;
export type NewImportCutoverManifest = typeof importCutoverManifests.$inferInsert;

// ---------------------------------------------------------------------------
// historical_correction_requests (DEC-070: renewed dual approval)
// ---------------------------------------------------------------------------

export const historicalCorrectionRequests = pgTable("historical_correction_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  docNo: text("doc_no").notNull(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  // Link to the original committed record
  originalEntityType: text("original_entity_type").notNull(),
  originalEntityId: uuid("original_entity_id").notNull(),
  correctionType: text("correction_type").notNull(), // 'reversal' | 'adjustment' | 'new_corrected'
  reason: text("reason").notNull(),
  proposedCorrectionJson: jsonb("proposed_correction_json"),
  impactAnalysisJson: jsonb("impact_analysis_json"),
  status: correctionRequestStatus("status").notNull().default("draft"),
  // DEC-070: renewed dual approval metadata
  ownerApprovedBy: uuid("owner_approved_by").references(() => users.id),
  ownerApprovedAt: timestamp("owner_approved_at", { withTimezone: true, mode: "date" }),
  accountantApprovedBy: uuid("accountant_approved_by").references(() => users.id),
  accountantApprovedAt: timestamp("accountant_approved_at", { withTimezone: true, mode: "date" }),
  // Linked corrected record (created after approval)
  correctedEntityType: text("corrected_entity_type"),
  correctedEntityId: uuid("corrected_entity_id"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  uniqueIndex("historical_correction_requests_tenant_doc_no_unique_idx").on(t.tenantId, t.docNo),
  index("historical_correction_requests_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("historical_correction_requests_tenant_original_idx").on(t.tenantId, t.originalEntityType, t.originalEntityId),
  index("historical_correction_requests_tenant_status_idx").on(t.tenantId, t.status),
]);

export type HistoricalCorrectionRequest = typeof historicalCorrectionRequests.$inferSelect;
export type NewHistoricalCorrectionRequest = typeof historicalCorrectionRequests.$inferInsert;
