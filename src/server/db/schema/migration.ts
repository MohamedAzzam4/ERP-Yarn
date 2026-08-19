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
  // WP-08-01F R1 — Immutable file-version supersession fields.
  // Prior file versions are preserved (append-only) and marked is_current=false
  // when a replacement file is registered. New files create new rows with
  // is_current=true. The partial unique index below permits only one current
  // file per tenant/batch/fileType.
  fileVersion: integer("file_version").notNull().default(1),
  isCurrent: boolean("is_current").notNull().default(true),
  supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  supersededBy: uuid("superseded_by"),
  supersededReason: text("superseded_reason"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_files_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_files_tenant_hash_idx").on(t.tenantId, t.fileHash),
  uniqueIndex("import_files_tenant_batch_hash_type_unique_idx").on(t.tenantId, t.importBatchId, t.fileHash, t.fileType),
  // WP-08-01F R1 — One current file per tenant/batch/fileType. Partial unique
  // index allows historical (superseded) rows to coexist with the current row.
  uniqueIndex("import_files_tenant_batch_type_current_unique_idx")
    .on(t.tenantId, t.importBatchId, t.fileType)
    .where(sql`${t.isCurrent} = true`),
  index("import_files_tenant_batch_current_idx").on(t.tenantId, t.importBatchId, t.isCurrent),
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
  // WP-08-01F R1 — Immutable staging-row version supersession.
  // When a replacement file is registered, the old staging rows are marked
  // is_current=false (NOT deleted) and new staging rows are inserted for
  // the new file. This preserves exact lineage for old-version findings.
  stagingVersion: integer("staging_version").notNull().default(1),
  isCurrent: boolean("is_current").notNull().default(true),
  supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  supersededByFileId: uuid("superseded_by_file_id"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_staging_rows_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_staging_rows_tenant_status_idx").on(t.tenantId, t.validationStatus),
  index("import_staging_rows_tenant_committed_idx").on(t.tenantId, t.committedEntityType, t.committedEntityId),
  index("import_staging_rows_tenant_batch_current_idx").on(t.tenantId, t.importBatchId, t.isCurrent),
  index("import_staging_rows_tenant_file_idx").on(t.tenantId, t.importFileId),
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
  // WP-08-01F R1 — Immutable validation-finding version supersession.
  // Old-version findings are preserved (is_current=false) when a replacement
  // file is registered and re-validation produces new findings. This ensures
  // old-version findings never display values from the new version.
  findingVersion: integer("finding_version").notNull().default(1),
  isCurrent: boolean("is_current").notNull().default(true),
  supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_validation_errors_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_validation_errors_tenant_severity_idx").on(t.tenantId, t.severity),
  index("import_validation_errors_tenant_blocking_idx").on(t.tenantId, t.isBlocking),
  index("import_validation_errors_tenant_batch_current_idx").on(t.tenantId, t.importBatchId, t.isCurrent),
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
  // WP-08-01F DEFECT 2: Immutable review-item supersession fields.
  // Review items are bound to a reconciliation report version. When rework
  // invalidates a report version, the associated review items are marked
  // is_current=false (not deleted). New reconciliation creates new items.
  reportVersion: integer("report_version"),
  isCurrent: boolean("is_current").notNull().default(true),
  supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  supersededBy: uuid("superseded_by"),
  supersededReason: text("superseded_reason"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_human_review_items_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_human_review_items_tenant_status_idx").on(t.tenantId, t.status),
  index("import_human_review_items_tenant_batch_current_idx").on(t.tenantId, t.importBatchId, t.isCurrent),
  index("import_human_review_items_tenant_batch_version_idx").on(t.tenantId, t.importBatchId, t.reportVersion),
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
  // WP-08-01G (A1) — Immutable alias-mapping version supersession fields.
  // When an approved alias mapping is re-approved against a different target
  // master (material remap), the old row is preserved (append-only) and
  // marked is_current=false. New approvals create new rows with
  // is_current=true. The partial unique index below permits only one current
  // mapping per (tenant, batch, entityType, sourceLabel).
  //
  // Re-validation also supersedes existing candidate/needs_review mappings
  // rather than hard-deleting them — old evidence is preserved per
  // Contract 08 §7.1 (DEC-019 principle: older versions are retained as
  // superseded audit history). Already-approved mappings are NOT superseded
  // on re-validation: their approval is preserved (the same source label
  // already maps to the same master; re-validation is a no-op for that key).
  isCurrent: boolean("is_current").notNull().default(true),
  supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  supersededBy: uuid("superseded_by"),
  supersededReason: text("superseded_reason"),
  // Stable group identity for repeated occurrences of the same source label
  // across multiple staging rows. All staging rows sharing the same
  // (tenant, batch, entityType, normalizedName) get the same groupId so the
  // UI can group them. Re-validation reuses the same groupId if the alias
  // still exists.
  groupId: uuid("group_id"),
  // How many staging rows share this group. Updated when staging rows are
  // added/removed/replaced and on re-validation. For approved mappings this
  // lets the submission prerequisite check quickly verify that every required
  // alias has a resolved target.
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  // Array of source row numbers that are explicitly split from the default
  // group (e.g. one row in a group of "Same Name" rows was remapped to a
  // different master). The remaining rows stay with the group's default
  // mapping. JSONB array of integers.
  exceptionSourceRowIds: jsonb("exception_source_row_ids"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_alias_mappings_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_alias_mappings_tenant_status_idx").on(t.tenantId, t.status),
  index("import_alias_mappings_tenant_entity_source_idx").on(t.tenantId, t.entityType, t.sourceLabel),
  // WP-08-01G (A1) — current-row lookup indexes (one per tenant+batch+isCurrent,
  // one per tenant+groupId+isCurrent). Without these, every list/approval
  // query degrades to a full scan as supersession history grows.
  index("import_alias_mappings_tenant_batch_current_idx").on(t.tenantId, t.importBatchId, t.isCurrent),
  index("import_alias_mappings_tenant_group_current_idx").on(t.tenantId, t.groupId, t.isCurrent),
  // WP-08-01G (A1) — Partial unique index: only one CURRENT mapping per
  // (tenant, batch, entityType, sourceLabel). Superseded (is_current=false)
  // rows may coexist with the current row for the same key, providing
  // append-only audit history. Re-approval to a different target supersedes
  // the old current row before inserting the new one, preserving this
  // invariant at the DB level.
  uniqueIndex("import_alias_mappings_tenant_batch_entity_source_current_unique_idx")
    .on(t.tenantId, t.importBatchId, t.entityType, t.sourceLabel)
    .where(sql`${t.isCurrent} = true`),
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
  // WP-08-01F DEFECT 2: Immutable approval supersession fields.
  // Prior approvals are preserved (append-only) and marked is_current=false
  // when invalidated by rework. New approvals create new rows with
  // is_current=true. The partial unique index below permits only one current
  // approval per tenant/batch/role.
  approvalVersion: integer("approval_version").notNull().default(1),
  isCurrent: boolean("is_current").notNull().default(true),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "date" }),
  invalidatedBy: uuid("invalidated_by"),
  invalidationReason: text("invalidation_reason"),
  supersededByApprovalId: uuid("superseded_by_approval_id"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  // DEC-069: one CURRENT approval per role per batch (partial unique index).
  // Prior invalidated approvals remain in the table with is_current=false.
  // This replaces the old non-partial unique index.
  uniqueIndex("import_batch_approvals_tenant_batch_role_current_unique_idx")
    .on(t.tenantId, t.importBatchId, t.approverRole)
    .where(sql`${t.isCurrent} = true`),
  index("import_batch_approvals_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_batch_approvals_tenant_approver_idx").on(t.tenantId, t.approverUserId),
  index("import_batch_approvals_tenant_batch_current_idx").on(t.tenantId, t.importBatchId, t.isCurrent),
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
  // WP-08-01F R5: Immutable manifest version supersession fields.
  // Old manifests are preserved (append-only) and marked is_current=false
  // when a replacement file triggers re-finalization. New manifests create
  // new rows with is_current=true. The partial unique index permits only
  // one current manifest per tenant/batch/domain.
  manifestVersion: integer("manifest_version").notNull().default(1),
  isCurrent: boolean("is_current").notNull().default(true),
  supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "date" }),
  supersededBy: uuid("superseded_by"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_cutover_manifests_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_cutover_manifests_tenant_domain_idx").on(t.tenantId, t.domain),
  // WP-08-01F R5: Partial unique index — one CURRENT manifest per batch+domain.
  // Old (superseded) manifests remain in the table with is_current=false.
  uniqueIndex("import_cutover_manifests_tenant_batch_domain_current_unique_idx")
    .on(t.tenantId, t.importBatchId, t.domain)
    .where(sql`${t.isCurrent} = true`),
  index("import_cutover_manifests_tenant_batch_current_idx").on(t.tenantId, t.importBatchId, t.isCurrent),
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

// ---------------------------------------------------------------------------
// import_backup_evidence (WP-07-04: backup evidence before commit)
// Contract 08 §8.10: "backup exists for real migration data"
// ---------------------------------------------------------------------------

export const importBackupEvidence = pgTable("import_backup_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  // Backup artifact metadata — NO secrets/credentials stored
  backupType: text("backup_type").notNull(), // 'database_snapshot' | 'file_export' | 'external_backup'
  backupLocation: text("backup_location").notNull(), // Non-secret reference (e.g. "s3://bucket/path" without credentials)
  backupHash: text("backup_hash").notNull(), // Checksum of backup artifact
  backupSizeBytes: integer("backup_size_bytes"),
  backupCreatedAt: timestamp("backup_created_at", { withTimezone: true, mode: "date" }).notNull(),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  verificationNotes: text("verification_notes"),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  index("import_backup_evidence_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_backup_evidence_tenant_hash_idx").on(t.tenantId, t.backupHash),
]);

export type ImportBackupEvidence = typeof importBackupEvidence.$inferSelect;
export type NewImportBackupEvidence = typeof importBackupEvidence.$inferInsert;

// ---------------------------------------------------------------------------
// import_cutover_locks (WP-07-04: cutover lock for concurrent commit prevention)
// Contract 08 §8.10: "cutover manifest is approved and affected live-write
//   scopes are locked/paused"
// Contract 06 §15: "Locks: Import batch/approvals/idempotency, affected
//   sequences/master records/balances/accounts in deterministic import order"
// ---------------------------------------------------------------------------

export const importCutoverLocks = pgTable("import_cutover_locks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdColumn(),
  importBatchId: uuid("import_batch_id").notNull().references(() => importBatches.id),
  // Lock scope — domain or entity type being locked
  lockScope: text("lock_scope").notNull(), // 'batch' | 'inventory' | 'subledger' | 'sales' | 'production'
  // Lock state
  acquiredBy: uuid("acquired_by").notNull().references(() => users.id),
  acquiredAt: timestamp("acquired_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
  releasedBy: uuid("released_by").references(() => users.id),
  releaseReason: text("release_reason"),
  // Idempotency key of the commit that acquired the lock
  commitIdempotencyKey: text("commit_idempotency_key").notNull(),
  ...makeTenantOwnedRow(usersId),
}, (t) => [
  // One active lock per batch+scope — prevents concurrent commits
  // Partial unique index on (tenant, batch, scope) WHERE released_at IS NULL
  // is created via raw SQL in migration for active-lock enforcement.
  index("import_cutover_locks_tenant_batch_idx").on(t.tenantId, t.importBatchId),
  index("import_cutover_locks_tenant_scope_idx").on(t.tenantId, t.lockScope),
  index("import_cutover_locks_tenant_active_idx").on(t.tenantId, t.releasedAt),
]);

export type ImportCutoverLock = typeof importCutoverLocks.$inferSelect;
export type NewImportCutoverLock = typeof importCutoverLocks.$inferInsert;
