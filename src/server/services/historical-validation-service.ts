/**
 * Historical Validation Service — WP-07-02.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md
 *   §8.5 Validation Severity (blocking_error, review_required_warning, informational)
 *   §8.6 Required Validation Rules (required fields, dates, duplicates, masters, quantities)
 *   §8.4 Master Data Extraction and Alias Mapping
 *
 * WP-07-02 SCOPE:
 *   - Run validation rules on staging rows
 *   - Create validation findings (errors/warnings/info)
 *   - Extract master-data candidates from staging rows
 *   - Create alias-review records for ambiguous matches
 *   - Update batch validation status
 *
 * WP-07-02 NON-SCOPE:
 *   - No commit (WP-07-04)
 *   - No reconciliation (WP-07-03)
 *   - No automatic master creation or alias merge
 *   - No operational effects
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  markRetryableFailed,
  type IdempotencyTransactionHandle,
} from "./idempotency-service";
import type { HistoricalValidationRepository } from "./historical-validation-repository";
import type {
  MasterDataRepository,
} from "./master-data-service";
import type {
  ImportValidationError,
  ImportAliasMapping,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";
import { guardRunValidation } from "./migration-lifecycle-guard";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface RunValidationInput {
  importBatchId: string;
  idempotencyKey: string;
}

export interface RunValidationResult {
  action: "executed" | "replayed";
  batchId: string;
  totalFindings: number;
  blockingErrors: number;
  warnings: number;
  informational: number;
  masterCandidates: number;
  reviewItems: number;
}

export interface ExtractMastersInput {
  importBatchId: string;
  idempotencyKey: string;
}

export interface ExtractMastersResult {
  action: "executed" | "replayed";
  batchId: string;
  candidatesExtracted: number;
  reviewItemsCreated: number;
}

// ---------------------------------------------------------------------------
// WP-08-01G (A4) — approveAliasMapping input/result types.
//
// Contract 08 §8.4.1-§8.4.8: alias approval workflow. An Owner or Accountant
// selects a target master (or rejects the candidate) for each alias mapping
// extracted by runValidation. The approval is idempotent, audit-logged, and
// material-remap-aware (re-approval to a different target supersedes the
// old current row instead of overwriting it).
// ---------------------------------------------------------------------------

export interface ApproveAliasMappingInput {
  aliasMappingId: string;
  /** The target master to link this alias to. NULL only when status='rejected'. */
  targetMasterId: string | null;
  /** 'approved' or 'rejected'. */
  status: "approved" | "rejected";
  /** Optional notes the approver attaches to the decision. */
  notes: string | null;
  /** Optional mapping version label (e.g. 'v1', '2026-01-01'). */
  mappingVersion: string | null;
  idempotencyKey: string;
}

export interface ApproveAliasMappingResult {
  action: "approved" | "rejected" | "replayed" | "remapped";
  aliasMappingId: string;
  /** The current alias mapping row id after the operation. For remap this
   * is the NEW row id (the old row was superseded). */
  currentAliasMappingId: string;
  status: string;
  targetMasterId: string | null;
  /** Present when the operation triggered a material remap that
   * invalidated downstream evidence (reconciliation results, review items,
   * batch approvals). */
  invalidatedDownstream?: {
    reportVersion: number | null;
    invalidatedApprovals: number;
    supersededReviewItems: number;
    batchStatusChangedTo: string | null;
  };
}

// ---------------------------------------------------------------------------
// WP-08-01F DEFECT 3 — createAliasException input/result types.
//
// Contract 08 §8.4.6: a separate alias mapping row with the same groupId
// as the default group but a different targetMasterId and explicit
// exceptionSourceRowIds. The exception is approved by the same
// Owner/Accountant permission as a regular alias approval.
//
// The default group alias and the exception alias are independent rows
// in import_alias_mappings. They share groupId (so the UI can group them)
// but differ in sourceLabel (the partial unique index on
// (tenant, batch, entity, sourceLabel) WHERE is_current=true requires
// distinct source labels). The exception row carries the
// exceptionSourceRowIds list (JSONB array of integers) telling the
// system which staging row numbers are split off from the default group.
//
// Group approval does NOT override an exception — the exception row is
// separately approved (or rejected). submitForApproval checks that all
// current alias mappings (including exceptions) are approved with
// non-null targetMasterId before the batch can transition to
// pending_dual_approval.
// ---------------------------------------------------------------------------

export interface CreateAliasExceptionInput {
  /** The default group alias mapping id to derive the groupId and
   * entityType from. Must be the current mapping for its key. */
  defaultAliasMappingId: string;
  /** A distinct source label for the exception. Must differ from the
   * default alias's sourceLabel (the partial unique index requires it). */
  exceptionSourceLabel: string;
  /** Optional normalized name for the exception (defaults to the lowercased
   * exceptionSourceLabel). */
  exceptionNormalizedName?: string | null;
  /** The target master id for the exception. Must exist, belong to the
   * caller's tenant, and match the default alias's entityType. */
  targetMasterId: string;
  /** The staging row numbers (source_row_number values) split off from
   * the default group to use the exception's target master. */
  exceptionSourceRowIds: number[];
  /** Optional notes the operator attaches. */
  notes: string | null;
  /** Optional mapping version label. */
  mappingVersion: string | null;
  idempotencyKey: string;
}

export interface CreateAliasExceptionResult {
  action: "executed" | "replayed";
  exceptionAliasMappingId: string;
  defaultAliasMappingId: string;
  groupId: string | null;
  entityType: string;
  targetMasterId: string;
  exceptionSourceRowIds: number[];
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class HistoricalValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HistoricalValidationError";
    this.code = code;
  }
}

export class BatchNotFoundError extends HistoricalValidationError {
  constructor(id: string) {
    super("BATCH_NOT_FOUND", `Import batch '${id}' not found.`);
    this.name = "BatchNotFoundError";
  }
}

export class BatchNotStagedError extends HistoricalValidationError {
  constructor(id: string, status: string) {
    super("STATE_CONFLICT", `Batch '${id}' is in status '${status}' — must be 'staged' to validate.`);
    this.name = "BatchNotStagedError";
  }
}

// ---------------------------------------------------------------------------
// WP-08-01G (A4) — alias approval errors.
// ---------------------------------------------------------------------------

export class AliasMappingNotFoundError extends HistoricalValidationError {
  constructor(id: string) {
    super("ALIAS_MAPPING_NOT_FOUND", `Alias mapping '${id}' not found in caller's tenant.`);
    this.name = "AliasMappingNotFoundError";
  }
}

export class AliasAlreadyApprovedError extends HistoricalValidationError {
  constructor(id: string, currentTarget: string | null) {
    super(
      "ALIAS_ALREADY_APPROVED",
      `Alias mapping '${id}' is already approved with targetMasterId='${currentTarget ?? "null"}'. Use a new idempotency key with the new target to remap.`,
    );
    this.name = "AliasAlreadyApprovedError";
  }
}

export class InvalidAliasTargetError extends HistoricalValidationError {
  constructor(aliasMappingId: string, targetMasterId: string, entityType: string) {
    super(
      "INVALID_ALIAS_TARGET",
      `INVALID_ALIAS_TARGET: Target master '${targetMasterId}' for alias '${aliasMappingId}' not found or does not match entity type '${entityType}' in the caller's tenant.`,
    );
    this.name = "InvalidAliasTargetError";
  }
}

export class AliasApprovalStateError extends HistoricalValidationError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "AliasApprovalStateError";
  }
}

export class AliasMappingNotCurrentError extends AliasApprovalStateError {
  constructor(id: string) {
    super(
      "ALIAS_NOT_CURRENT",
      `Alias mapping '${id}' is not the current mapping (is_current=false). It has been superseded; load the current mapping for this source label instead.`,
    );
    this.name = "AliasMappingNotCurrentError";
  }
}

export class MasterDataRepositoryNotConfiguredError extends HistoricalValidationError {
  constructor() {
    super(
      "CONFIGURATION_ERROR",
      "approveAliasMapping requires masterDataRepository to be configured for target master validation.",
    );
    this.name = "MasterDataRepositoryNotConfiguredError";
  }
}

// ---------------------------------------------------------------------------
// WP-08-01F DEFECT 3 — exception/subgroup errors.
// ---------------------------------------------------------------------------

export class AliasExceptionInputError extends HistoricalValidationError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
    this.name = "AliasExceptionInputError";
  }
}

export class AliasExceptionSourceLabelConflictError extends HistoricalValidationError {
  constructor(defaultAliasMappingId: string, sourceLabel: string) {
    super(
      "ALIAS_EXCEPTION_SOURCE_LABEL_CONFLICT",
      `Cannot create alias exception — the exception source label '${sourceLabel}' must differ from the default group alias '${defaultAliasMappingId}' source label (the partial unique index on (tenant, batch, entity, sourceLabel) WHERE is_current=true requires distinct source labels).`,
    );
    this.name = "AliasExceptionSourceLabelConflictError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalValidationServiceDeps {
  repository: HistoricalValidationRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /** WP-08-01F R7: Transaction runner — MANDATORY for production validation.
   * Missing transactionRunner causes runValidation to throw before any write. */
  transactionRunner: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
  createRepository: (tx: unknown) => HistoricalValidationRepository;
  createAudit: (tx: unknown) => AuditTransactionHandle;
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
  /**
   * WP-08-01G (A4): Optional master-data repository used by
   * approveAliasMapping to validate that the target master exists, belongs
   * to the same tenant, and has the correct entity type. Production wiring
   * supplies a MasterDataDbRepository. Unit tests supply an in-memory
   * implementation. If absent, approveAliasMapping refuses to approve
   * (fail-closed — the master cannot be validated).
   */
  masterDataRepository?: MasterDataRepository;
  /**
   * WP-08-01G (A4): Optional tx-scoped factory for the master-data
   * repository. Used inside the approval transaction to validate the
   * target master against the transaction's snapshot of the master-data
   * tables (prevents a race where a master is inactivated between the
   * read and the write).
   */
  createMasterDataRepository?: (tx: unknown) => MasterDataRepository;
  /**
   * WP-08-01G (A5): Optional tx-scoped callback to invalidate current
   * approvals for a batch. Used by the material remap path
   * (re-approval to a different target). The callback is the same shape
   * as `HistoricalCommitRepository.invalidateCurrentApprovalsForBatch`
   * — it marks current approvals is_current=false, preserving rows as
   * audit history. If absent, approval invalidation is skipped (the
   * remap still supersedes the old alias row + inserts the new one).
   */
  invalidateCurrentApprovals?: (tx: unknown, tenantId: string, batchId: string, invalidatedBy: string, reason: string, now: Date) => Promise<number>;
  /**
   * WP-08-01G (A5): Optional tx-scoped callback to supersede current
   * review items for a batch. Used by the material remap path.
   * Mirrors `HistoricalReconciliationRepository.supersedeReviewItemsForBatch`.
   * If absent, review-item supersession is skipped.
   */
  supersedeReviewItemsForBatch?: (tx: unknown, tenantId: string, batchId: string, supersededBy: string, reason: string) => Promise<number>;
  /**
   * WP-08-01G (A5): Optional tx-scoped callback to reset the batch's
   * validationStatus and reconciliationStatus to null (forces re-validation
   * and re-reconciliation after a material remap). Mirrors
   * `HistoricalReconciliationRepository.resetBatchValidationAndReconciliationStatuses`.
   * If absent, the batch statuses are not reset.
   */
  resetBatchValidationAndReconciliationStatuses?: (tx: unknown, tenantId: string, batchId: string) => Promise<ImportBatch | null>;
  /**
   * WP-08-01G (A5): Optional tx-scoped callback to fetch the latest
   * reconciliation report version for the batch. Used for audit metadata
   * on the material remap (records which report version was invalidated).
   */
  findLatestReportVersion?: (tx: unknown, tenantId: string, batchId: string) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Validation rule definitions (Contract 08 §8.6).
// ---------------------------------------------------------------------------

interface ValidationRule {
  code: string;
  check: (row: ImportStagingRow, allRows: ImportStagingRow[]) => ValidationFinding[];
}

interface ValidationFinding {
  severity: "blocking_error" | "review_required_warning" | "informational";
  errorCode: string;
  message: string;
  fieldName: string | null;
  isBlocking: boolean;
}

// ---------------------------------------------------------------------------
// WP-08-01G (A2) / WP-08-01F DEFECT 4: Flexible entity-type detection.
//
// The validation service must detect the entity type per row, not assume
// "customer". Different migration templates use different field names:
//   - data.entity_type, data.type, data.entityType, data.record_type
//   - data.customer_id, data.supplier_id, data.factory_id, data.location_id
//   - data.party_type (e.g. "customer" / "supplier")
//
// The detection order is:
//   1. Explicit entity_type/type/entityType/record_type field
//   2. Explicit master-id field (customer_id → "customer", etc.)
//   3. party_type field
//   4. If nothing can be established safely, return "unknown" — the alias
//      is then created with status="needs_review". We NEVER guess
//      "customer" because that would silently misroute supplier/factory/
//      location rows to the customer master table at commit time.
//
// DEFECT 4 fix: previously the fallback returned "customer" which made
// the alias look resolved enough to proceed. The fallback now returns
// "unknown" and the caller (runValidation) creates the alias with
// status="needs_review" so a human must explicitly classify it before
// submission.
// ---------------------------------------------------------------------------

function detectEntityType(data: Record<string, unknown> | null): string {
  if (!data) return "unknown";
  // Explicit type fields
  const typeValue =
    data.entity_type ?? data.type ?? data.entityType ?? data.record_type;
  if (typeof typeValue === "string" && typeValue.trim()) {
    return typeValue.trim().toLowerCase();
  }
  // Master-id fields → infer entity type
  if (data.supplier_id !== undefined && data.supplier_id !== null && data.supplier_id !== "") return "supplier";
  if (data.customer_id !== undefined && data.customer_id !== null && data.customer_id !== "") return "customer";
  if (data.factory_id !== undefined && data.factory_id !== null && data.factory_id !== "") return "factory";
  if (data.location_id !== undefined && data.location_id !== null && data.location_id !== "") return "location";
  if (data.item_id !== undefined && data.item_id !== null && data.item_id !== "") return "item";
  if (data.batch_id !== undefined && data.batch_id !== null && data.batch_id !== "") return "batch";
  if (data.lot_id !== undefined && data.lot_id !== null && data.lot_id !== "") return "lot";
  // Party-type field (e.g. for subledger/balance rows)
  if (typeof data.party_type === "string" && data.party_type.trim()) {
    return data.party_type.trim().toLowerCase();
  }
  // DEFECT 4 fix: cannot establish the entity type safely from the staging
  // row data. Return "unknown" — the caller will mark the alias as
  // needs_review so a human must classify it before submission. We never
  // guess "customer" because that would silently route non-customer rows
  // to the customer master table at commit time.
  return "unknown";
}

const VALIDATION_RULES: ValidationRule[] = [
  // §8.6.1 Required field validation
  {
    code: "REQUIRED_FIELD_MISSING",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data) {
        findings.push({ severity: "blocking_error", errorCode: "REQUIRED_FIELD_MISSING", message: "Row has no data (raw or transformed).", fieldName: null, isBlocking: true });
        return findings;
      }
      const requiredFields = ["name", "code", "quantity", "date"];
      for (const field of requiredFields) {
        if (!(field in data) || data[field] === null || data[field] === undefined || data[field] === "") {
          findings.push({ severity: "blocking_error", errorCode: "REQUIRED_FIELD_MISSING", message: `Required field '${field}' is missing or empty.`, fieldName: field, isBlocking: true });
        }
      }
      return findings;
    },
  },
  // §8.6.1 Invalid data type
  {
    code: "INVALID_DATA_TYPE",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data) return findings;
      if (data.quantity !== undefined && data.quantity !== null && data.quantity !== "") {
        const qty = parseFloat(String(data.quantity));
        if (isNaN(qty)) {
          findings.push({ severity: "blocking_error", errorCode: "INVALID_DATA_TYPE", message: `Quantity '${data.quantity}' is not a valid number.`, fieldName: "quantity", isBlocking: true });
        }
      }
      if (data.price !== undefined && data.price !== null && data.price !== "") {
        const price = parseFloat(String(data.price));
        if (isNaN(price)) {
          findings.push({ severity: "blocking_error", errorCode: "INVALID_DATA_TYPE", message: `Price '${data.price}' is not a valid number.`, fieldName: "price", isBlocking: true });
        }
      }
      return findings;
    },
  },
  // §8.6.1 Invalid date format
  {
    code: "INVALID_DATE_FORMAT",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.date) return findings;
      const dateStr = String(data.date);
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) {
        findings.push({ severity: "blocking_error", errorCode: "INVALID_DATE_FORMAT", message: `Date '${dateStr}' is not a valid date.`, fieldName: "date", isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.1 Unsupported unit
  {
    code: "UNSUPPORTED_UNIT",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.unit) return findings;
      const unit = String(data.unit).toLowerCase();
      const supportedUnits = ["kg", "kilogram", "kilograms", "ton", "tons", "tonne", "tonnes"];
      if (!supportedUnits.includes(unit)) {
        findings.push({ severity: "blocking_error", errorCode: "UNSUPPORTED_UNIT", message: `Unit '${unit}' is not supported. Supported: kg, ton.`, fieldName: "unit", isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.1 Unsupported currency
  {
    code: "UNSUPPORTED_CURRENCY",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.currency) return findings;
      const currency = String(data.currency).toUpperCase();
      if (currency !== "EGP") {
        findings.push({ severity: "blocking_error", errorCode: "UNSUPPORTED_CURRENCY", message: `Currency '${currency}' is not supported. Only EGP is allowed for MVP.`, fieldName: "currency", isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.2 Future date
  {
    code: "FUTURE_DATE",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.date) return findings;
      const dateStr = String(data.date);
      const date = new Date(dateStr);
      if (!isNaN(date.getTime()) && date > new Date()) {
        findings.push({ severity: "blocking_error", errorCode: "FUTURE_DATE", message: `Date '${dateStr}' is in the future.`, fieldName: "date", isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.2 Logical date inconsistency — payment before sale date
  {
    code: "PAYMENT_BEFORE_SALE_DATE",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.payment_date || !data.sale_date) return findings;
      const paymentDate = new Date(String(data.payment_date));
      const saleDate = new Date(String(data.sale_date));
      if (!isNaN(paymentDate.getTime()) && !isNaN(saleDate.getTime()) && paymentDate < saleDate) {
        findings.push({ severity: "review_required_warning", errorCode: "PAYMENT_BEFORE_SALE_DATE", message: `Payment date '${data.payment_date}' is before sale date '${data.sale_date}'.`, fieldName: "payment_date", isBlocking: false });
      }
      return findings;
    },
  },
  // §8.6.2 Logical date inconsistency — return before sale date
  {
    code: "RETURN_BEFORE_SALE_DATE",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.return_date || !data.sale_date) return findings;
      const returnDate = new Date(String(data.return_date));
      const saleDate = new Date(String(data.sale_date));
      if (!isNaN(returnDate.getTime()) && !isNaN(saleDate.getTime()) && returnDate < saleDate) {
        findings.push({ severity: "review_required_warning", errorCode: "RETURN_BEFORE_SALE_DATE", message: `Return date '${data.return_date}' is before sale date '${data.sale_date}'.`, fieldName: "return_date", isBlocking: false });
      }
      return findings;
    },
  },
  // §8.6.3 Duplicate source row
  {
    code: "DUPLICATE_SOURCE_ROW",
    check: (row, allRows) => {
      const findings: ValidationFinding[] = [];
      if (row.sourceRowNumber === null) return findings;
      const duplicates = allRows.filter(r => r.sourceRowNumber === row.sourceRowNumber && r.sourceSheetName === row.sourceSheetName && r.id !== row.id);
      if (duplicates.length > 0) {
        findings.push({ severity: "blocking_error", errorCode: "DUPLICATE_SOURCE_ROW", message: `Duplicate source row ${row.sourceSheetName ?? ""}:${row.sourceRowNumber}.`, fieldName: null, isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.3 Duplicate document number within batch
  {
    code: "DUPLICATE_DOCUMENT_NUMBER",
    check: (row, allRows) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.doc_no) return findings;
      const docNo = String(data.doc_no);
      const duplicates = allRows.filter(r => {
        const d = (r.transformedRowJson ?? r.rawRowJson) as Record<string, unknown> | null;
        return d?.doc_no === docNo && r.id !== row.id;
      });
      if (duplicates.length > 0) {
        findings.push({ severity: "blocking_error", errorCode: "DUPLICATE_DOCUMENT_NUMBER", message: `Duplicate document number '${docNo}' within batch.`, fieldName: "doc_no", isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.4 Missing master reference
  {
    code: "MISSING_MASTER_REFERENCE",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data) return findings;
      // Missing = field absent, null, or empty string
      if (!("customer_id" in data) || data.customer_id === "" || data.customer_id === null || data.customer_id === undefined) {
        findings.push({ severity: "review_required_warning", errorCode: "MISSING_MASTER_REFERENCE", message: `Customer reference is missing or empty — needs master extraction.`, fieldName: "customer_id", isBlocking: false });
      }
      if (!("item_id" in data) || data.item_id === "" || data.item_id === null || data.item_id === undefined) {
        findings.push({ severity: "review_required_warning", errorCode: "MISSING_MASTER_REFERENCE", message: `Item reference is missing or empty — needs master extraction.`, fieldName: "item_id", isBlocking: false });
      }
      return findings;
    },
  },
  // §8.6.4 Unresolved alias (name exists but no resolved master)
  {
    code: "UNRESOLVED_ALIAS",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.name) return findings;
      // If name exists but customer_id is missing, alias is unresolved
      if (data.name && !data.customer_id) {
        findings.push({ severity: "review_required_warning", errorCode: "UNRESOLVED_ALIAS", message: `Entity name '${data.name}' has no resolved master reference — alias review needed.`, fieldName: "name", isBlocking: false });
      }
      return findings;
    },
  },
  // §8.6.5 Negative quantity
  {
    code: "NEGATIVE_QUANTITY",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.quantity) return findings;
      const qty = parseFloat(String(data.quantity));
      if (!isNaN(qty) && qty < 0) {
        findings.push({ severity: "blocking_error", errorCode: "NEGATIVE_QUANTITY", message: `Quantity '${qty}' is negative.`, fieldName: "quantity", isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.5 Zero/negative value where prohibited
  {
    code: "ZERO_OR_NEGATIVE_VALUE",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.price) return findings;
      const price = parseFloat(String(data.price));
      if (!isNaN(price) && price <= 0) {
        findings.push({ severity: "blocking_error", errorCode: "ZERO_OR_NEGATIVE_VALUE", message: `Price '${price}' is zero or negative.`, fieldName: "price", isBlocking: true });
      }
      return findings;
    },
  },
  // §8.6.5 Invalid money/cost format
  {
    code: "INVALID_MONEY_FORMAT",
    check: (row) => {
      const findings: ValidationFinding[] = [];
      const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
      if (!data || !data.cost) return findings;
      const cost = parseFloat(String(data.cost));
      if (isNaN(cost)) {
        findings.push({ severity: "blocking_error", errorCode: "INVALID_MONEY_FORMAT", message: `Cost '${data.cost}' is not a valid money value.`, fieldName: "cost", isBlocking: true });
      }
      return findings;
    },
  },
];

// ---------------------------------------------------------------------------
// HistoricalValidationService.
// ---------------------------------------------------------------------------

export class HistoricalValidationService {
  constructor(private readonly deps: HistoricalValidationServiceDeps) {}

  /**
   * Run validation rules on all staging rows in a batch.
   *
   * Permission: migration.review (Owner/Accountant).
   * Idempotent: replay deletes old findings and re-runs.
   * Non-operational: no stock/account/sales effects.
   */
  async runValidation(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: RunValidationInput,
  ): Promise<RunValidationResult> {
    requirePermission(effective, "migration.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.importBatchId?.trim()) throw new HistoricalValidationError("VALIDATION_FAILED", "importBatchId is required.");
    if (!input.idempotencyKey?.trim()) throw new HistoricalValidationError("VALIDATION_FAILED", "idempotencyKey is required.");

    const batch = await this.deps.repository.findImportBatchById(user.tenantId, input.importBatchId);
    if (!batch) throw new BatchNotFoundError(input.importBatchId);
    requireTenantMatch(user, batch.tenantId);

    // WP-08-01F DEFECT 1: Enforce lifecycle state before any write
    guardRunValidation(batch);

    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_validation.run",
      idempotencyKey: input.idempotencyKey,
      requestBody: { importBatchId: input.importBatchId } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<RunValidationResult> | null;
      if (responseBody?.batchId) return { ...responseBody, action: "replayed" } as RunValidationResult;
    }
    if (claim.action === "conflict") throw new HistoricalValidationError("IDEMPOTENCY_CONFLICT", `Idempotency key conflict.`);
    if (claim.action === "in_progress") throw new HistoricalValidationError("OPERATION_IN_PROGRESS", `Operation in progress.`);

    // WP-08-01F R7: Transaction is MANDATORY — no silent fallback.
    // If transactionRunner or factories are missing, throw before any write.
    if (!this.deps.transactionRunner || !this.deps.createRepository || !this.deps.createAudit || !this.deps.createIdempotency) {
      throw new HistoricalValidationError(
        "VALIDATION_FAILED",
        "Validation requires transactionRunner + tx-scoped factories. Missing transaction configuration.",
      );
    }

    const executeValidation = async (repo: HistoricalValidationRepository, auditHandle: AuditTransactionHandle, idemHandle: IdempotencyTransactionHandle): Promise<RunValidationResult> => {
      // WP-08-01G (A2): NEVER hard-delete alias mappings on re-validation.
      //
      // Validation errors and review items are delete-and-recreate — they
      // are derived findings that should match the current staged data
      // exactly. Alias mappings are different: they carry human approval
      // state (targetMasterId, approvedBy, approvedAt, mappingVersion) that
      // MUST survive a re-validation run. Re-running validation against a
      // freshly-replaced file should not silently wipe the operator's
      // approval work.
      //
      // Strategy:
      //   - Validation errors: delete only CURRENT findings (existing
      //     behavior — superseded findings are preserved as audit history).
      //   - Review items: hard-delete current items (existing behavior —
      //     review items have no approval state to preserve).
      //   - Alias mappings: supersede only non-approved current mappings
      //     (candidate/needs_review/rejected). Approved mappings are NEVER
      //     superseded by re-validation — their approval is preserved and
      //     the same source label is NOT re-created. If the source label
      //     still exists in the new file, the approved mapping remains
      //     active. If it has disappeared from the new file, the approved
      //     mapping remains as audit history but is no longer required for
      //     submission (the prerequisite check counts only the source
      //     labels that appear in the current staging rows).
      //
      // The new alias-mapping insert path below uses
      // `findAliasMappingBySourceLabel` (which now filters is_current=true)
      // to detect existing current mappings and skip re-creation. This
      // preserves approved mappings and prevents duplicate inserts that
      // would violate the partial unique index.
      await repo.deleteValidationErrorsForBatch(user.tenantId, input.importBatchId);
      // Supersede non-approved current alias mappings before re-extraction.
      // Approved mappings are preserved as-is.
      const existingAliases = await repo.findAliasMappingsForBatch(user.tenantId, input.importBatchId);
      for (const alias of existingAliases) {
        if (alias.isCurrent && alias.status !== "approved") {
          // Supersede the non-approved current mapping so a new one can be
          // inserted (preserves the partial unique index invariant). Use
          // the in-place supersedeAliasMapping method.
          await repo.supersedeAliasMapping(
            user.tenantId, alias.id, user.userId, "re-validation (non-approved alias superseded)",
          );
        }
      }
      await repo.deleteHumanReviewItemsForBatch(user.tenantId, input.importBatchId);

      // Fetch all staging rows
      const rows = await repo.findStagingRowsForBatch(user.tenantId, input.importBatchId);

      let blockingErrors = 0;
      let warnings = 0;
      let informational = 0;
      let masterCandidates = 0;
      let reviewItems = 0;

      // WP-08-01G (A2): Group tracker for repeated occurrences of the same
      // source label. Maps `${entityType}|${normalizedName}` to a stable
      // groupId (random UUID generated on first occurrence) and the count
      // of staging rows sharing this group. The groupId is per-batch and
      // per-validation-run; approved mappings from prior runs preserve
      // their original groupId (they are not re-created here).
      const groupTracker = new Map<string, { groupId: string; occurrences: number }>();

      // Run validation rules on each row
      for (const row of rows) {
        for (const rule of VALIDATION_RULES) {
          const findings = rule.check(row, rows);
          for (const finding of findings) {
            const errorRecord = await repo.insertValidationError({
              tenantId: user.tenantId,
              importBatchId: input.importBatchId,
              stagingRowId: row.id,
              severity: finding.severity,
              errorCode: finding.errorCode,
              message: finding.message,
              fieldName: finding.fieldName,
              isBlocking: finding.isBlocking,
              createdBy: user.userId,
            });

            // Audit each finding creation
            await appendAuditLog(auditHandle, user.tenantId, user.userId, {
              entityType: "import_validation_error",
              entityId: errorRecord.id,
              actionType: "historical_finding.create",
              newValuesJson: {
                importBatchId: input.importBatchId,
                stagingRowId: row.id,
                severity: finding.severity,
                errorCode: finding.errorCode,
                fieldName: finding.fieldName,
                isBlocking: finding.isBlocking,
                message: finding.message,
              },
              idempotencyKey: input.idempotencyKey,
            });

            if (finding.severity === "blocking_error") blockingErrors++;
            else if (finding.severity === "review_required_warning") warnings++;
            else informational++;
          }
        }

        // Master extraction: extract entity names as candidates
        // Contract 08 §8.4: no fuzzy auto-merge; candidates are candidates only.
        const data = (row.transformedRowJson ?? row.rawRowJson) as Record<string, unknown> | null;
        if (data?.name) {
          const sourceLabel = String(data.name);
          const normalizedName = sourceLabel.trim().toLowerCase();
          // WP-08-01G (A2) / DEFECT 4: flexible entity-type detection —
          // check data.entity_type, data.type, master-id fields, party_type.
          // Returns "unknown" when none of those signals are present so a
          // human must classify the alias before submission. We NEVER
          // silently guess "customer".
          const entityType = detectEntityType(data);
          const isUnknownEntityType = entityType === "unknown";

          // Check if alias already exists for this source label (deduplication).
          // WP-08-01G (A1): findAliasMappingBySourceLabel now filters by
          // is_current=true. After the supersede loop above, only the
          // approved current mappings (if any) remain. If this source label
          // has an approved mapping, we skip the insert — its approval is
          // preserved across re-validation.
          const existing = await repo.findAliasMappingBySourceLabel(
            user.tenantId, input.importBatchId, entityType, sourceLabel,
          );
          if (!existing) {
            // WP-08-01G (A2): Group tracker. Generate a stable groupId for
            // this (entityType, normalizedName) on the first occurrence;
            // reuse it for subsequent occurrences. This lets the UI group
            // repeated source labels together (e.g. 50 rows with the same
            // customer name → one group with occurrenceCount=50).
            const groupKey = `${entityType}|${normalizedName}`;
            let groupEntry = groupTracker.get(groupKey);
            if (!groupEntry) {
              groupEntry = { groupId: randomUUID(), occurrences: 0 };
              groupTracker.set(groupKey, groupEntry);
            }
            groupEntry.occurrences++;

            // Determine confidence score deterministically.
            // High confidence: exact match on normalized name (no variations).
            // Low confidence: name has potential variations (Arabic chars, extra spaces, etc.)
            // DEFECT 4: an "unknown" entity type is ALWAYS needs_review
            // regardless of the name formatting score — the entity-type
            // signal is the dominant confidence indicator.
            const hasArabic = /[\u0600-\u06FF]/.test(sourceLabel);
            const hasExtraSpaces = sourceLabel !== sourceLabel.trim();
            const hasMixedCase = sourceLabel !== sourceLabel.toLowerCase() && sourceLabel !== sourceLabel.toUpperCase();
            const isLowConfidence = isUnknownEntityType || hasArabic || hasExtraSpaces || hasMixedCase;
            const confidenceScore = isLowConfidence ? "0.500000" : "1.000000";

            // Create as candidate — NOT a live master record
            const aliasMapping = await repo.insertAliasMapping({
              tenantId: user.tenantId,
              importBatchId: input.importBatchId,
              entityType,
              sourceLabel,
              normalizedName,
              targetMasterId: null, // No automatic master linking
              mappingVersion: null,
              confidenceScore, // Deterministic confidence score
              status: isLowConfidence ? "needs_review" : "candidate",
              notes: isUnknownEntityType
                ? "Entity type could not be determined from the staging row — needs human classification."
                : isLowConfidence ? "Low confidence — needs human review" : null,
              createdBy: user.userId,
              // WP-08-01G (A1/A2) — group identity / occurrence metadata.
              groupId: groupEntry.groupId,
              occurrenceCount: groupEntry.occurrences,
              exceptionSourceRowIds: null,
            });
            masterCandidates++;

            // Audit each alias mapping creation
            await appendAuditLog(auditHandle, user.tenantId, user.userId, {
              entityType: "import_alias_mapping",
              entityId: aliasMapping.id,
              actionType: "historical_alias.create",
              newValuesJson: {
                importBatchId: input.importBatchId,
                stagingRowId: row.id,
                entityType,
                sourceLabel,
                normalizedName,
                confidenceScore,
                status: isLowConfidence ? "needs_review" : "candidate",
                targetMasterId: null,
                groupId: groupEntry.groupId,
                occurrenceCount: groupEntry.occurrences,
              },
              idempotencyKey: input.idempotencyKey,
            });

            // Create human review item for ALL candidates (Contract 08 §8.4:
            // all candidates require human review before approval)
            const reviewReason = isUnknownEntityType
              ? `Master candidate '${sourceLabel}' has unknown entity type — needs human classification before approval.`
              : isLowConfidence
                ? `Low-confidence master candidate '${sourceLabel}' (confidence=${confidenceScore}) needs review.`
                : `Master candidate '${sourceLabel}' needs review.`;
            const reviewItem = await repo.insertHumanReviewItem({
              tenantId: user.tenantId,
              importBatchId: input.importBatchId,
              stagingRowId: row.id,
              reviewReason,
              createdBy: user.userId,
            });
            reviewItems++;

            // Audit each review item creation
            await appendAuditLog(auditHandle, user.tenantId, user.userId, {
              entityType: "import_human_review_item",
              entityId: reviewItem.id,
              actionType: "historical_review.create",
              newValuesJson: {
                importBatchId: input.importBatchId,
                stagingRowId: row.id,
                aliasMappingId: aliasMapping.id,
                reviewReason: reviewItem.reviewReason,
                status: "pending",
              },
              idempotencyKey: input.idempotencyKey,
            });
          } else {
            // WP-08-01G (A2): existing approved mapping for this source
            // label. We do NOT re-create it. We DO update the
            // occurrenceCount on the existing current mapping if it has
            // the same groupId (so the count reflects the current staged
            // data, not the count at approval time). We only update the
            // count — never the status, targetMasterId, approvedBy, or
            // approvedAt. We do this lazily (only on the second+ occurrence
            // in the same group) to avoid hammering the DB on every row.
            const groupKey = `${entityType}|${normalizedName}`;
            let groupEntry = groupTracker.get(groupKey);
            if (!groupEntry) {
              groupEntry = { groupId: existing.groupId ?? randomUUID(), occurrences: 0 };
              groupTracker.set(groupKey, groupEntry);
            }
            groupEntry.occurrences++;
          }
        }
      }

      // WP-08-01F DEFECT 2 — Persist the final occurrenceCount per group.
      //
      // During the row loop above, the group tracker accumulates the
      // occurrence count in memory but the DB row was only set to the
      // current count at insert time. For groups with >1 occurrence,
      // that means the DB row's occurrenceCount lags behind the actual
      // count. We now persist the final count per group back to the
      // current alias mapping row.
      //
      // Idempotency: the update OVERWRITES occurrence_count with the
      // recomputed value (it does NOT increment). Re-running validation
      // against the same source data produces the same final count,
      // not a doubled count. This is also true for approved mappings:
      // the existing approved current mapping has its occurrenceCount
      // updated to reflect the current staged data, but its status,
      // targetMasterId, approvedBy, approvedAt are NEVER touched.
      if (groupTracker.size > 0) {
        const currentAliases = await repo.findCurrentAliasMappingsForBatch(
          user.tenantId, input.importBatchId,
        );
        for (const currentAlias of currentAliases) {
          const groupKey = `${currentAlias.entityType}|${currentAlias.normalizedName}`;
          const groupEntry = groupTracker.get(groupKey);
          if (!groupEntry) continue;
          await repo.updateAliasMappingOccurrenceCount(
            user.tenantId, input.importBatchId,
            currentAlias.entityType, currentAlias.sourceLabel,
            groupEntry.occurrences,
          );
        }
      }

      // Update batch status based on findings.
      // WP-08-01F DEFECT 1A / R2 QA FIX: Set validationStatus = "passed" (no
      // blocking errors) or "failed" (blocking errors > 0). ALWAYS transition
      // to validation_complete — the validation HAS completed, it just found
      // errors. The blocking errors prevent progression to reconciliation/
      // submission (checked by canRunReconciliation and canSubmitForApproval),
      // but they should NOT prevent file replacement (the user needs to
      // replace the file to fix the errors). Keeping the batch in
      // validation_in_progress when validation has actually completed is
      // incorrect — it blocks the replacement form which is the exact
      // mechanism the user needs to fix the errors.
      const newValidationStatus = blockingErrors > 0 ? "failed" : "passed";
      const newBatchStatus = "validation_complete";
      await repo.updateBatchValidationStatus(user.tenantId, input.importBatchId, newValidationStatus, user.userId);
      await repo.updateBatchErrorCounts(user.tenantId, input.importBatchId, blockingErrors, warnings, user.userId);
      await repo.updateBatchStatus(user.tenantId, input.importBatchId, newBatchStatus);

      // Audit
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: "import_batch",
        entityId: input.importBatchId,
        actionType: "historical_validation.run",
        newValuesJson: {
          importBatchId: input.importBatchId,
          totalRows: rows.length,
          totalFindings: blockingErrors + warnings + informational,
          blockingErrors,
          warnings,
          informational,
          masterCandidates,
          reviewItems,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: RunValidationResult = {
        action: "executed",
        batchId: input.importBatchId,
        totalFindings: blockingErrors + warnings + informational,
        blockingErrors,
        warnings,
        informational,
        masterCandidates,
        reviewItems,
      };

      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200, responseBody: result,
        entityType: "import_batch", entityId: input.importBatchId,
      }, claim.record.ownerToken!, now);

      return result;
    }; // end executeValidation

    // WP-08-01F R7: Execute ALL validation writes in a single transaction.
    // No fallback — transactionRunner is mandatory.
    return await this.deps.transactionRunner(async (tx: unknown) => {
      const txRepo = this.deps.createRepository(tx);
      const txAudit = this.deps.createAudit(tx);
      const txIdem = this.deps.createIdempotency(tx);
      return executeValidation(txRepo, txAudit, txIdem);
    });
  }

  /**
   * List validation findings for a batch.
   */
  async listFindings(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<ImportValidationError[]> {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findValidationErrorsForBatch(user.tenantId, batchId);
  }

  // ===========================================================================
  // WP-08-01G (A4) — approveAliasMapping
  //
  // Contract 08 §8.4.1-§8.4.8: alias approval workflow.
  //
  // An Owner or Accountant selects a target master (or rejects the
  // candidate) for an alias mapping extracted by runValidation. The
  // approval is idempotent, audit-logged, and material-remap-aware.
  //
  // Permission: migration.review (Owner OR Accountant). Worker rejected.
  //
  // DEC-080 (separation of duties) does NOT apply — the same person may
  // both select the target and approve the mapping. There is no second
  // approval slot for alias mappings; the approval is a single-step
  // decision (unlike the post-commit correction dual approval in DEC-070).
  //
  // Idempotency:
  //   - Same key + same request → replay (returns the cached result).
  //   - Same key + different request → conflict (IDEMPOTENCY_CONFLICT).
  //   - Technical failure → retryable_failed (the next retry re-executes).
  //   - Business rejection (invalid target, not current, etc.) →
  //     business_failed (durable; same key + same request returns the
  //     same failure; the operator must use a new key after fixing the
  //     precondition).
  //
  // Material remap (A5):
  //   - If the alias is already approved with the SAME target and the
  //     request is identical, the idempotency claim returns "replay"
  //     before any write. No mutation.
  //   - If the alias is already approved with a DIFFERENT target, this
  //     operation supersedes the old current row (is_current=false) and
  //     inserts a new current row with the new target. The old row is
  //     preserved as audit history. Downstream evidence (validation/
  //     reconciliation statuses, current approvals, current review items)
  //     is invalidated atomically via the optional tx-scoped callbacks in
  //     HistoricalValidationServiceDeps. This mirrors the reopenBatchForRework
  //     invalidation pattern.
  // ===========================================================================

  async approveAliasMapping(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveAliasMappingInput,
  ): Promise<ApproveAliasMappingResult> {
    // 1. Permission: migration.review (Owner/Accountant). Worker rejected.
    requirePermission(effective, "migration.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // 2. Input validation — fail closed before any read.
    if (!input.aliasMappingId?.trim()) {
      throw new HistoricalValidationError("VALIDATION_FAILED", "aliasMappingId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new HistoricalValidationError("VALIDATION_FAILED", "idempotencyKey is required.");
    }
    if (input.status !== "approved" && input.status !== "rejected") {
      throw new HistoricalValidationError("VALIDATION_FAILED", "status must be 'approved' or 'rejected'.");
    }
    if (input.status === "approved" && !input.targetMasterId?.trim()) {
      throw new HistoricalValidationError("VALIDATION_FAILED", "targetMasterId is required when status='approved'.");
    }
    if (input.status === "rejected" && input.targetMasterId) {
      throw new HistoricalValidationError("VALIDATION_FAILED", "targetMasterId must be null when status='rejected'.");
    }

    // 3. Load alias + tenant check. We use the root (non-tx) repository
    //    here for the initial read. The authoritative re-read happens
    //    inside the transaction after the alias-mapping row is locked.
    const alias = await this.deps.repository.findAliasMappingById(user.tenantId, input.aliasMappingId);
    if (!alias) throw new AliasMappingNotFoundError(input.aliasMappingId);
    requireTenantMatch(user, alias.tenantId);
    // WP-08-01G (A1): The alias must be the CURRENT mapping for its key.
    // Superseded mappings are immutable audit history — they cannot be
    // re-approved. The operator must load the current mapping for the
    // same source label instead (it's a different row id).
    //
    // Note: target-master validation is performed INSIDE the transaction
    // (step 6b) so that a master that exists at pre-claim time but is
    // inactivated before the transaction lock produces a durable
    // business_failed record (the operator sees the same failure on
    // replay, then can re-approve with a new target after fixing the
    // master data). Doing the validation pre-claim would create no
    // idempotency record on failure, which would make business_failed
    // replay semantics impossible to test or verify.
    if (!alias.isCurrent) throw new AliasMappingNotCurrentError(input.aliasMappingId);

    // 5. Idempotency claim — persistent, owner-token-fenced.
    //    The request body captures the exact decision: aliasMappingId,
    //    targetMasterId, status, notes, mappingVersion. Same key + same
    //    request → replay. Same key + different request → conflict.
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_alias_mapping.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        aliasMappingId: input.aliasMappingId,
        targetMasterId: input.targetMasterId,
        status: input.status,
        notes: input.notes,
        mappingVersion: input.mappingVersion,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      // WP-08-01G (A4): Durable business failure replay. If the cached
      // record is business_failed, re-throw the original business error
      // so the operator sees the same failure message.
      if (claim.record.state === "business_failed") {
        const errorBody = claim.record.responseBody as { code?: string; message?: string } | null;
        throw new HistoricalValidationError(
          errorBody?.code ?? "BUSINESS_FAILED",
          errorBody?.message ?? "Previous business failure (durable).",
        );
      }
      const responseBody = claim.record.responseBody as Partial<ApproveAliasMappingResult> | null;
      if (responseBody?.aliasMappingId) {
        return { ...responseBody, action: "replayed" } as ApproveAliasMappingResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalValidationError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict — same key with different request body.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalValidationError("OPERATION_IN_PROGRESS", "Alias approval in progress.");
    }

    // 6. Execute the approval in a transaction. All writes (alias-mapping
    //    mutation/insert + downstream invalidation + audit + markSucceeded)
    //    commit or roll back together.
    //    WP-08-01G (A4): transactionRunner + tx-scoped factories are
    //    mandatory for production approvals. The in-memory test wiring
    //    supplies them via a no-op transactionRunner.
    if (!this.deps.transactionRunner || !this.deps.createRepository || !this.deps.createAudit || !this.deps.createIdempotency) {
      throw new HistoricalValidationError(
        "VALIDATION_FAILED",
        "approveAliasMapping requires transactionRunner + tx-scoped factories. Missing transaction configuration.",
      );
    }

    const executeApprovalAtomically = async (
      repo: HistoricalValidationRepository,
      masterDataRepo: MasterDataRepository | undefined,
      auditHandle: AuditTransactionHandle,
      idemHandle: IdempotencyTransactionHandle,
      nonTxIdemHandle: IdempotencyTransactionHandle,
      lockedAlias: ImportAliasMapping,
      tx: unknown,
    ): Promise<ApproveAliasMappingResult> => {
      try {
        // 6a. Re-check isCurrent against the locked row.
        if (!lockedAlias.isCurrent) {
          throw new AliasMappingNotCurrentError(input.aliasMappingId);
        }

        // 6b. Re-validate the target master (for approval) against the
        //     tx-scoped master data repo (prevents race where master was
        //     inactivated between the pre-claim read and the lock).
        if (input.status === "approved") {
          if (!masterDataRepo) {
            throw new MasterDataRepositoryNotConfiguredError();
          }
          await this.validateTargetMaster(masterDataRepo, user.tenantId, lockedAlias.entityType, input.targetMasterId!);
        }

        // 6c. Determine the operation: in-place approval, material remap,
        //     in-place rejection, or no-op (already in the requested state).
        const alreadyApproved = lockedAlias.status === "approved";
        const sameTarget = lockedAlias.targetMasterId === input.targetMasterId;
        const isMaterialRemap = input.status === "approved" && alreadyApproved && !sameTarget;
        const isNoOpApprove = input.status === "approved" && alreadyApproved && sameTarget;
        const isNoOpReject = input.status === "rejected" && lockedAlias.status === "rejected";

        // 6d. No-op: the alias is already in the requested state with the
        //     requested target. Return an "approved"/"rejected" result (not
        //     "replayed" — that's only for idempotency replays). The audit
        //     still records the operator's confirmation.
        if (isNoOpApprove || isNoOpReject) {
          await appendAuditLog(auditHandle, user.tenantId, user.userId, {
            entityType: "import_alias_mapping",
            entityId: lockedAlias.id,
            actionType: "historical_alias.approve_noop",
            newValuesJson: {
              aliasMappingId: lockedAlias.id,
              status: lockedAlias.status,
              targetMasterId: lockedAlias.targetMasterId,
              note: "Alias already in requested state — no mutation.",
            },
            idempotencyKey: input.idempotencyKey,
          });

          const result: ApproveAliasMappingResult = {
            action: input.status === "approved" ? "approved" : "rejected",
            aliasMappingId: input.aliasMappingId,
            currentAliasMappingId: lockedAlias.id,
            status: lockedAlias.status,
            targetMasterId: lockedAlias.targetMasterId,
          };

          await markSucceeded(idemHandle, claim.record.id, {
            responseCode: 200, responseBody: result,
            entityType: "import_alias_mapping", entityId: lockedAlias.id,
          }, claim.record.ownerToken!, now);

          return result;
        }

        // 6e. Material remap (A5): supersede the old current row, insert a
        //     new current row with the new target. Then invalidate
        //     downstream evidence atomically.
        if (isMaterialRemap) {
          const remapReason = `Material remap: targetMasterId changed from '${lockedAlias.targetMasterId}' to '${input.targetMasterId}'.`;
          // 6e.i. Supersede the old current row (preserves it as audit
          //       history). The partial unique index on
          //       (tenant, batch, entityType, sourceLabel) WHERE
          //       is_current=true frees up the slot for the new row.
          const supersededOld = await repo.supersedeAliasMapping(
            user.tenantId, lockedAlias.id, user.userId, remapReason,
          );
          if (!supersededOld) {
            // Another concurrent remap won the race — the old row is
            // already non-current. Fail-closed: business_failed.
            throw new AliasMappingNotCurrentError(input.aliasMappingId);
          }

          // 6e.ii. Insert the new current row with the new target. The
          //        groupId is preserved (same source label group). The
          //        occurrenceCount is preserved (same group of staging
          //        rows). The exceptionSourceRowIds is preserved.
          const newAlias = await repo.insertAliasMapping({
            tenantId: user.tenantId,
            importBatchId: lockedAlias.importBatchId,
            entityType: lockedAlias.entityType,
            sourceLabel: lockedAlias.sourceLabel,
            normalizedName: lockedAlias.normalizedName,
            targetMasterId: input.targetMasterId,
            mappingVersion: input.mappingVersion,
            confidenceScore: lockedAlias.confidenceScore,
            status: "approved",
            notes: input.notes,
            createdBy: user.userId,
            groupId: lockedAlias.groupId,
            occurrenceCount: lockedAlias.occurrenceCount,
            exceptionSourceRowIds: Array.isArray(lockedAlias.exceptionSourceRowIds)
              ? (lockedAlias.exceptionSourceRowIds as number[])
              : null,
          });

          // 6e.iii. Set the approval metadata on the new row.
          const approvedAlias = await repo.updateAliasMappingStatus(
            user.tenantId, newAlias.id, {
              status: "approved",
              targetMasterId: input.targetMasterId,
              approvedBy: user.userId,
              approvedAt: now,
              mappingVersion: input.mappingVersion,
              notes: input.notes,
            },
          );

          // 6e.iv. Invalidate downstream evidence atomically.
          //   - Reset batch validation/reconciliation statuses (forces
          //     re-validation and re-reconciliation against the new
          //     alias mapping).
          //   - Invalidate current approvals (mark is_current=false).
          //   - Supersede current review items (mark is_current=false).
          let invalidatedReportVersion: number | null = null;
          let invalidatedApprovals = 0;
          let supersededReviewItems = 0;
          let batchStatusChangedTo: string | null = null;
          if (this.deps.findLatestReportVersion) {
            invalidatedReportVersion = await this.deps.findLatestReportVersion(tx, user.tenantId, lockedAlias.importBatchId);
          }
          if (this.deps.resetBatchValidationAndReconciliationStatuses) {
            const updatedBatch = await this.deps.resetBatchValidationAndReconciliationStatuses(tx, user.tenantId, lockedAlias.importBatchId);
            if (updatedBatch) {
              // If the batch was in pending_dual_approval or
              // approved_for_commit, the remap invalidates that state.
              // Move it back to review_required so a fresh submission is
              // required after re-validation + re-reconciliation.
              const statusBefore = lockedAlias; // not used; we use the
              // updatedBatch.status here.
              const currentBatchStatus = updatedBatch.status;
              if (currentBatchStatus === "pending_dual_approval" || currentBatchStatus === "approved_for_commit") {
                await repo.updateBatchStatus(user.tenantId, lockedAlias.importBatchId, "review_required");
                batchStatusChangedTo = "review_required";
              }
              void statusBefore;
            }
          }
          if (this.deps.invalidateCurrentApprovals) {
            invalidatedApprovals = await this.deps.invalidateCurrentApprovals(tx, user.tenantId, lockedAlias.importBatchId, user.userId, remapReason, now);
          }
          if (this.deps.supersedeReviewItemsForBatch) {
            supersededReviewItems = await this.deps.supersedeReviewItemsForBatch(tx, user.tenantId, lockedAlias.importBatchId, user.userId, remapReason);
          }

          // 6e.v. Audit the remap (records the old/new row ids + target +
          //       downstream invalidation counts).
          await appendAuditLog(auditHandle, user.tenantId, user.userId, {
            entityType: "import_alias_mapping",
            entityId: newAlias.id,
            actionType: "historical_alias.remap",
            oldValuesJson: {
              previousAliasMappingId: lockedAlias.id,
              previousTargetMasterId: lockedAlias.targetMasterId,
              previousStatus: lockedAlias.status,
              previousApprovedBy: lockedAlias.approvedBy,
            },
            newValuesJson: {
              aliasMappingId: newAlias.id,
              supersededAliasMappingId: lockedAlias.id,
              importBatchId: lockedAlias.importBatchId,
              entityType: lockedAlias.entityType,
              sourceLabel: lockedAlias.sourceLabel,
              targetMasterId: input.targetMasterId,
              mappingVersion: input.mappingVersion,
              approvedBy: user.userId,
              approvedAt: now.toISOString(),
              groupId: lockedAlias.groupId,
              occurrenceCount: lockedAlias.occurrenceCount,
              remapReason,
              invalidatedDownstream: {
                reportVersion: invalidatedReportVersion,
                invalidatedApprovals,
                supersededReviewItems,
                batchStatusChangedTo,
              },
            },
            idempotencyKey: input.idempotencyKey,
          });

          const result: ApproveAliasMappingResult = {
            action: "remapped",
            aliasMappingId: input.aliasMappingId,
            currentAliasMappingId: newAlias.id,
            status: "approved",
            targetMasterId: input.targetMasterId,
            invalidatedDownstream: {
              reportVersion: invalidatedReportVersion,
              invalidatedApprovals,
              supersededReviewItems,
              batchStatusChangedTo,
            },
          };

          await markSucceeded(idemHandle, claim.record.id, {
            responseCode: 200, responseBody: result,
            entityType: "import_alias_mapping", entityId: newAlias.id,
          }, claim.record.ownerToken!, now);

          return result;
        }

        // 6f. Standard in-place approval/rejection: update the existing
        //     current row's status, targetMasterId, approvedBy,
        //     approvedAt, mappingVersion, notes. No row is created or
        //     superseded — the row was a candidate/needs_review and is
        //     being approved/rejected for the first time.
        const updatedAlias = await repo.updateAliasMappingStatus(
          user.tenantId, lockedAlias.id, {
            status: input.status,
            targetMasterId: input.status === "approved" ? input.targetMasterId : null,
            approvedBy: user.userId,
            approvedAt: now,
            mappingVersion: input.mappingVersion,
            notes: input.notes,
          },
        );
        if (!updatedAlias) {
          // Lost the row between read and write — fail closed.
          throw new AliasMappingNotFoundError(input.aliasMappingId);
        }

        // 6g. Audit.
        await appendAuditLog(auditHandle, user.tenantId, user.userId, {
          entityType: "import_alias_mapping",
          entityId: updatedAlias.id,
          actionType: input.status === "approved"
            ? "historical_alias.approve"
            : "historical_alias.reject",
          oldValuesJson: {
            previousStatus: lockedAlias.status,
            previousTargetMasterId: lockedAlias.targetMasterId,
          },
          newValuesJson: {
            aliasMappingId: updatedAlias.id,
            importBatchId: updatedAlias.importBatchId,
            entityType: updatedAlias.entityType,
            sourceLabel: updatedAlias.sourceLabel,
            status: updatedAlias.status,
            targetMasterId: updatedAlias.targetMasterId,
            mappingVersion: input.mappingVersion,
            approvedBy: user.userId,
            approvedAt: now.toISOString(),
            notes: input.notes,
          },
          idempotencyKey: input.idempotencyKey,
        });

        const result: ApproveAliasMappingResult = {
          action: input.status === "approved" ? "approved" : "rejected",
          aliasMappingId: input.aliasMappingId,
          currentAliasMappingId: updatedAlias.id,
          status: updatedAlias.status,
          targetMasterId: updatedAlias.targetMasterId,
        };

        await markSucceeded(idemHandle, claim.record.id, {
          responseCode: 200, responseBody: result,
          entityType: "import_alias_mapping", entityId: updatedAlias.id,
        }, claim.record.ownerToken!, now);

        return result;
      } catch (e) {
        // WP-08-01G (A4): Classify approval failures.
        //
        // A) BUSINESS PRECONDITION failures (alias not current, invalid
        //    target, missing master data repo, etc.) → business_failed
        //    (durable). Same key + same request returns the same failure.
        //
        // B) TECHNICAL/SYSTEM failures (unexpected repository/DB/infra
        //    errors) → do NOT mark business_failed here. The outer catch
        //    block marks them as retryable_failed.
        const isBusinessError =
          e instanceof AliasMappingNotFoundError ||
          e instanceof AliasMappingNotCurrentError ||
          e instanceof InvalidAliasTargetError ||
          e instanceof MasterDataRepositoryNotConfiguredError ||
          e instanceof AliasApprovalStateError ||
          (e instanceof HistoricalValidationError && e.code !== "IDEMPOTENCY_CONFLICT" && e.code !== "OPERATION_IN_PROGRESS");

        if (isBusinessError) {
          // Use the NON-tx handle so the mark commits independently of
          // the rolling-back transaction.
          await markBusinessFailed(nonTxIdemHandle, claim.record.id, {
            responseCode: 400,
            responseBody: { code: (e as any)?.code ?? "ALIAS_APPROVAL_FAILED", message: (e as Error).message },
            lastErrorClass: (e as Error).name ?? "Error",
          }, claim.record.ownerToken!, now);
        }
        throw e;
      }
    };

    try {
      return await this.deps.transactionRunner!(async (tx: unknown) => {
        // Lock the alias-mapping row and re-read it inside the
        // transaction. This is the authoritative state for the
        // remap/no-op/in-place decision.
        const lockedAlias = await this.deps.repository.findAliasMappingById(user.tenantId, input.aliasMappingId);
        if (!lockedAlias) throw new AliasMappingNotFoundError(input.aliasMappingId);

        const txRepo = this.deps.createRepository(tx);
        const txMasterData = this.deps.createMasterDataRepository ? this.deps.createMasterDataRepository(tx) : this.deps.masterDataRepository;
        const txAudit = this.deps.createAudit(tx);
        const txIdem = this.deps.createIdempotency(tx);
        return executeApprovalAtomically(txRepo, txMasterData, txAudit, txIdem, this.deps.idempotency, lockedAlias, tx);
      });
    } catch (error) {
      // Technical/system failure → mark as retryable_failed.
      const isOwnerLoss = error instanceof Error && error.constructor.name === "IdempotencyOwnershipLostError";
      const isBusiness =
        error instanceof AliasMappingNotFoundError ||
        error instanceof AliasMappingNotCurrentError ||
        error instanceof InvalidAliasTargetError ||
        error instanceof MasterDataRepositoryNotConfiguredError ||
        error instanceof AliasApprovalStateError ||
        (error instanceof HistoricalValidationError && error.code !== "IDEMPOTENCY_CONFLICT" && error.code !== "OPERATION_IN_PROGRESS");
      if (!isOwnerLoss && !isBusiness) {
        try {
          await markRetryableFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 500,
            responseBody: { message: error instanceof Error ? error.message : String(error) },
            lastErrorClass: error instanceof Error ? error.constructor.name : "Unknown",
          }, claim.record.ownerToken!, now);
        } catch {
          // Fallback: record stays in_progress, expires via lease.
        }
      }
      throw error;
    }
  }

  /**
   * WP-08-01G (A4) / WP-08-01F DEFECT 5: Validate that the target master
   * exists, belongs to the caller's tenant, and matches the alias's
   * entityType.
   *
   * Supported entity types (DEFECT 5 — complete master type support):
   *   - supplier (suppliers table)
   *   - customer (customers table)
   *   - location (locations table)
   *   - factory (external_factories table)
   *   - fiber_type (fiber_types table)
   *   - product_type (product_types table)
   *   - quality_parameter (quality_parameters table)
   *   - item / batch / lot (inventory_items table — item_kind
   *     distinguishes them; for 'batch'/'lot' the caller MUST supply an
   *     inventory_items.id and we only verify existence + tenant scope)
   *
   * For other entity types (e.g. 'unknown', 'party', custom strings),
   * approval fails with INVALID_ALIAS_TARGET — the operator must use a
   * supported master-data entity type, or extend the MasterDataRepository
   * with the missing findById method.
   *
   * Throws InvalidAliasTargetError if the master is not found.
   */
  private async validateTargetMaster(
    repo: MasterDataRepository,
    tenantId: string,
    entityType: string,
    targetMasterId: string,
  ): Promise<void> {
    switch (entityType) {
      case "supplier": {
        const supplier = await repo.findSupplierById(tenantId, targetMasterId);
        if (!supplier) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      case "customer": {
        const customer = await repo.findCustomerById(tenantId, targetMasterId);
        if (!customer) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      case "location": {
        const location = await repo.findLocationById(tenantId, targetMasterId);
        if (!location) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      case "factory": {
        const factory = await repo.findExternalFactoryById(tenantId, targetMasterId);
        if (!factory) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      // WP-08-01F DEFECT 5 — fiber/product/quality/inventory masters.
      case "fiber_type":
      case "fiber": {
        const fiberType = await repo.findFiberTypeById(tenantId, targetMasterId);
        if (!fiberType) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      case "product_type":
      case "product": {
        const productType = await repo.findProductTypeById(tenantId, targetMasterId);
        if (!productType) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      case "quality_parameter": {
        const qp = await repo.findQualityParameterById(tenantId, targetMasterId);
        if (!qp) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      case "item":
      case "batch":
      case "lot": {
        // inventory_items is the canonical stock identity (Contract 03
        // §9.1). For 'batch'/'lot' entity types, the caller resolves
        // through the same inventory_items table — the item_kind
        // column distinguishes raw_material_batch vs. yarn_lot. We
        // only verify existence + tenant scope here.
        const item = await repo.findInventoryItemById(tenantId, targetMasterId);
        if (!item) throw new InvalidAliasTargetError("", targetMasterId, entityType);
        return;
      }
      default:
        // Unsupported entity type — no findById method exists on
        // MasterDataRepository. Fail closed.
        throw new InvalidAliasTargetError("", targetMasterId, entityType);
    }
  }

  /**
   * List master candidates (alias mappings) for a batch.
   */
  async listMasterCandidates(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<ImportAliasMapping[]> {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findAliasMappingsForBatch(user.tenantId, batchId);
  }

  /**
   * List human review items for a batch.
   */
  async listReviewItems(
    user: ErpUserContext,
    effective: EffectivePermissions,
    batchId: string,
  ): Promise<ImportHumanReviewItem[]> {
    requirePermission(effective, "migration.review");
    return this.deps.repository.findHumanReviewItemsForBatch(user.tenantId, batchId);
  }

  // ===========================================================================
  // WP-08-01F DEFECT 3 — createAliasException
  //
  // Contract 08 §8.4.6: a separate alias mapping row with the same groupId
  // as the default group but a different targetMasterId and explicit
  // exceptionSourceRowIds. The exception is approved by the same
  // Owner/Accountant permission as a regular alias approval.
  //
  // The exception row is INSERTED (not updated in place) with:
  //   - same tenantId + importBatchId + entityType + groupId as the default
  //   - different sourceLabel (the partial unique index on
  //     (tenant, batch, entity, sourceLabel) WHERE is_current=true
  //     requires distinct source labels)
  //   - different targetMasterId (the exception's target)
  //   - status='approved' (the operator explicitly approves the exception)
  //   - exceptionSourceRowIds=[row1, row2, ...] (the staging row numbers
  //     split off from the default group)
  //
  // The default group alias is NOT modified — group approval does NOT
  // override an exception. The exception row is independently tracked by
  // submitForApproval's prerequisite check (it appears in
  // findCurrentAliasMappingsForBatch's result and must be approved).
  //
  // Idempotent: same idempotency key + same request → replay (returns the
  // cached result). Same key + different request → conflict. Technical
  // failure → retryable_failed. Business precondition failure →
  // business_failed (durable).
  // ===========================================================================

  async createAliasException(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateAliasExceptionInput,
  ): Promise<CreateAliasExceptionResult> {
    // 1. Permission: migration.review (Owner/Accountant). Worker rejected.
    requirePermission(effective, "migration.review");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // 2. Input validation — fail closed before any read.
    if (!input.defaultAliasMappingId?.trim()) {
      throw new AliasExceptionInputError("defaultAliasMappingId is required.");
    }
    if (!input.exceptionSourceLabel?.trim()) {
      throw new AliasExceptionInputError("exceptionSourceLabel is required.");
    }
    if (!input.targetMasterId?.trim()) {
      throw new AliasExceptionInputError("targetMasterId is required.");
    }
    if (!input.idempotencyKey?.trim()) {
      throw new AliasExceptionInputError("idempotencyKey is required.");
    }
    if (!Array.isArray(input.exceptionSourceRowIds) || input.exceptionSourceRowIds.length === 0) {
      throw new AliasExceptionInputError("exceptionSourceRowIds must be a non-empty array of staging row numbers.");
    }
    // All row ids must be positive integers.
    for (const r of input.exceptionSourceRowIds) {
      if (typeof r !== "number" || !Number.isFinite(r) || r <= 0 || !Number.isInteger(r)) {
        throw new AliasExceptionInputError(`exceptionSourceRowIds must contain positive integers; got '${String(r)}'.`);
      }
    }

    // 3. Load the default alias mapping. Must be current + tenant-scoped.
    const defaultAlias = await this.deps.repository.findAliasMappingById(
      user.tenantId, input.defaultAliasMappingId,
    );
    if (!defaultAlias) {
      throw new AliasMappingNotFoundError(input.defaultAliasMappingId);
    }
    requireTenantMatch(user, defaultAlias.tenantId);
    if (!defaultAlias.isCurrent) {
      throw new AliasMappingNotCurrentError(input.defaultAliasMappingId);
    }

    // 4. Validate that the exception source label differs from the
    //    default's source label — the partial unique index requires it.
    if (input.exceptionSourceLabel === defaultAlias.sourceLabel) {
      throw new AliasExceptionSourceLabelConflictError(defaultAlias.id, input.exceptionSourceLabel);
    }

    // 5. Idempotency claim.
    const now = new Date();
    const claim = await claimIdempotency(this.deps.idempotency, {
      tenantId: user.tenantId,
      operationScope: "historical_alias_mapping.create_exception",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        defaultAliasMappingId: input.defaultAliasMappingId,
        exceptionSourceLabel: input.exceptionSourceLabel,
        targetMasterId: input.targetMasterId,
        exceptionSourceRowIds: input.exceptionSourceRowIds,
        notes: input.notes,
        mappingVersion: input.mappingVersion,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    });

    if (claim.action === "replay") {
      // Durable business failure replay.
      if (claim.record.state === "business_failed") {
        const errorBody = claim.record.responseBody as { code?: string; message?: string } | null;
        throw new HistoricalValidationError(
          errorBody?.code ?? "BUSINESS_FAILED",
          errorBody?.message ?? "Previous business failure (durable).",
        );
      }
      const responseBody = claim.record.responseBody as Partial<CreateAliasExceptionResult> | null;
      if (responseBody?.exceptionAliasMappingId) {
        return { ...responseBody, action: "replayed" } as CreateAliasExceptionResult;
      }
    }
    if (claim.action === "conflict") {
      throw new HistoricalValidationError("IDEMPOTENCY_CONFLICT", "Idempotency key conflict — same key with different request body.");
    }
    if (claim.action === "in_progress") {
      throw new HistoricalValidationError("OPERATION_IN_PROGRESS", "Alias exception creation in progress.");
    }

    // 6. Transaction runner + factories are mandatory for production.
    if (!this.deps.transactionRunner || !this.deps.createRepository || !this.deps.createAudit || !this.deps.createIdempotency) {
      throw new HistoricalValidationError(
        "VALIDATION_FAILED",
        "createAliasException requires transactionRunner + tx-scoped factories. Missing transaction configuration.",
      );
    }

    const executeAtomically = async (
      repo: HistoricalValidationRepository,
      masterDataRepo: MasterDataRepository | undefined,
      auditHandle: AuditTransactionHandle,
      idemHandle: IdempotencyTransactionHandle,
      nonTxIdemHandle: IdempotencyTransactionHandle,
    ): Promise<CreateAliasExceptionResult> => {
      try {
        // 6a. Validate the target master against the alias's entityType.
        if (!masterDataRepo) {
          throw new MasterDataRepositoryNotConfiguredError();
        }
        await this.validateTargetMaster(masterDataRepo, user.tenantId, defaultAlias.entityType, input.targetMasterId);

        // 6b. Check for an existing current alias mapping for this
        //     (entityType, exceptionSourceLabel) — if one exists, this
        //     is a duplicate exception creation. Fail closed.
        const existing = await repo.findAliasMappingBySourceLabel(
          user.tenantId, defaultAlias.importBatchId,
          defaultAlias.entityType, input.exceptionSourceLabel,
        );
        if (existing) {
          throw new AliasAlreadyApprovedError(existing.id, existing.targetMasterId);
        }

        // 6c. Insert the new exception alias mapping row with the same
        //     groupId as the default. status='approved' (the operator
        //     explicitly approves the exception). exceptionSourceRowIds
        //     is set on the new row.
        const exceptionNormalizedName = input.exceptionNormalizedName?.trim()
          ? input.exceptionNormalizedName.trim().toLowerCase()
          : input.exceptionSourceLabel.trim().toLowerCase();
        const newAlias = await repo.insertAliasMapping({
          tenantId: user.tenantId,
          importBatchId: defaultAlias.importBatchId,
          entityType: defaultAlias.entityType,
          sourceLabel: input.exceptionSourceLabel,
          normalizedName: exceptionNormalizedName,
          targetMasterId: input.targetMasterId,
          mappingVersion: input.mappingVersion,
          confidenceScore: "1.000000", // operator-approved — full confidence
          status: "approved",
          notes: input.notes,
          createdBy: user.userId,
          groupId: defaultAlias.groupId,
          occurrenceCount: input.exceptionSourceRowIds.length,
          exceptionSourceRowIds: input.exceptionSourceRowIds,
        });

        // 6d. Set the approval metadata on the new row.
        await repo.updateAliasMappingStatus(
          user.tenantId, newAlias.id, {
            status: "approved",
            targetMasterId: input.targetMasterId,
            approvedBy: user.userId,
            approvedAt: now,
            mappingVersion: input.mappingVersion,
            notes: input.notes,
          },
        );

        // 6e. Audit.
        await appendAuditLog(auditHandle, user.tenantId, user.userId, {
          entityType: "import_alias_mapping",
          entityId: newAlias.id,
          actionType: "historical_alias.create_exception",
          oldValuesJson: {
            defaultAliasMappingId: defaultAlias.id,
            defaultSourceLabel: defaultAlias.sourceLabel,
            defaultTargetMasterId: defaultAlias.targetMasterId,
          },
          newValuesJson: {
            exceptionAliasMappingId: newAlias.id,
            importBatchId: defaultAlias.importBatchId,
            entityType: defaultAlias.entityType,
            exceptionSourceLabel: input.exceptionSourceLabel,
            exceptionNormalizedName,
            targetMasterId: input.targetMasterId,
            mappingVersion: input.mappingVersion,
            groupId: defaultAlias.groupId,
            exceptionSourceRowIds: input.exceptionSourceRowIds,
            approvedBy: user.userId,
            approvedAt: now.toISOString(),
            notes: input.notes,
          },
          idempotencyKey: input.idempotencyKey,
        });

        const result: CreateAliasExceptionResult = {
          action: "executed",
          exceptionAliasMappingId: newAlias.id,
          defaultAliasMappingId: defaultAlias.id,
          groupId: defaultAlias.groupId,
          entityType: defaultAlias.entityType,
          targetMasterId: input.targetMasterId,
          exceptionSourceRowIds: input.exceptionSourceRowIds,
        };

        await markSucceeded(idemHandle, claim.record.id, {
          responseCode: 200, responseBody: result,
          entityType: "import_alias_mapping", entityId: newAlias.id,
        }, claim.record.ownerToken!, now);

        return result;
      } catch (e) {
        // Classify failures the same way as approveAliasMapping.
        const isBusinessError =
          e instanceof AliasMappingNotFoundError ||
          e instanceof AliasMappingNotCurrentError ||
          e instanceof InvalidAliasTargetError ||
          e instanceof MasterDataRepositoryNotConfiguredError ||
          e instanceof AliasAlreadyApprovedError ||
          e instanceof AliasExceptionInputError ||
          e instanceof AliasExceptionSourceLabelConflictError ||
          (e instanceof HistoricalValidationError && e.code !== "IDEMPOTENCY_CONFLICT" && e.code !== "OPERATION_IN_PROGRESS");

        if (isBusinessError) {
          await markBusinessFailed(nonTxIdemHandle, claim.record.id, {
            responseCode: 400,
            responseBody: { code: (e as any)?.code ?? "ALIAS_EXCEPTION_FAILED", message: (e as Error).message },
            lastErrorClass: (e as Error).name ?? "Error",
          }, claim.record.ownerToken!, now);
        }
        throw e;
      }
    };

    try {
      return await this.deps.transactionRunner!(async (tx: unknown) => {
        const txRepo = this.deps.createRepository(tx);
        const txMasterData = this.deps.createMasterDataRepository ? this.deps.createMasterDataRepository(tx) : this.deps.masterDataRepository;
        const txAudit = this.deps.createAudit(tx);
        const txIdem = this.deps.createIdempotency(tx);
        return executeAtomically(txRepo, txMasterData, txAudit, txIdem, this.deps.idempotency);
      });
    } catch (error) {
      const isOwnerLoss = error instanceof Error && error.constructor.name === "IdempotencyOwnershipLostError";
      const isBusiness =
        error instanceof AliasMappingNotFoundError ||
        error instanceof AliasMappingNotCurrentError ||
        error instanceof InvalidAliasTargetError ||
        error instanceof MasterDataRepositoryNotConfiguredError ||
        error instanceof AliasAlreadyApprovedError ||
        error instanceof AliasExceptionInputError ||
        error instanceof AliasExceptionSourceLabelConflictError ||
        (error instanceof HistoricalValidationError && error.code !== "IDEMPOTENCY_CONFLICT" && error.code !== "OPERATION_IN_PROGRESS");
      if (!isOwnerLoss && !isBusiness) {
        try {
          await markRetryableFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 500,
            responseBody: { message: error instanceof Error ? error.message : String(error) },
            lastErrorClass: error instanceof Error ? error.constructor.name : "Unknown",
          }, claim.record.ownerToken!, now);
        } catch {
          // Fallback: record stays in_progress, expires via lease.
        }
      }
      throw error;
    }
  }
}
