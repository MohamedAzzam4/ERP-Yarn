/**
 * Historical migration enums.
 * Contract 03 §6 + Contract 08.
 */
import { pgEnum } from "drizzle-orm/pg-core";

// Contract 03 §6 + Contract 08 §9
export const importBatchStatus = pgEnum("import_batch_status", [
  "draft", "source_uploaded", "normalized", "staged",
  "validation_in_progress", "validation_complete",
  "reconciliation_in_progress", "review_required",
  "pending_dual_approval", "approved_for_commit",
  "committing", "committed", "rejected", "cancelled",
]);

// Contract 08 §8.5
export const validationSeverity = pgEnum("validation_severity", [
  "blocking_error", "review_required_warning", "informational",
]);

// Contract 08 §8.1.1 — DEC-071: opening_balance only for MVP
export const cutoverImportMode = pgEnum("cutover_import_mode", [
  "opening_balance", "transaction_history", "hybrid",
]);

// Contract 08 §8.4 — alias/master mapping status
export const aliasMappingStatus = pgEnum("alias_mapping_status", [
  "candidate", "needs_review", "approved", "rejected",
]);

// Contract 08 §8.9 — dual approval role type
export const migrationApproverRole = pgEnum("migration_approver_role", [
  "owner", "accountant",
]);

// Contract 08 §8.11 — correction request status
export const correctionRequestStatus = pgEnum("correction_request_status", [
  "draft", "pending_review", "approved", "rejected", "cancelled",
]);

// Review item decision status
export const reviewItemDecision = pgEnum("review_item_decision", [
  "pending", "accepted", "rejected", "resolved",
]);

// Reconciliation result status
export const reconciliationResultStatus = pgEnum("reconciliation_result_status", [
  "pending", "matched", "difference", "accepted_difference", "blocking",
]);
