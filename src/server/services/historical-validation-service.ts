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
  type IdempotencyTransactionHandle,
} from "./idempotency-service";
import type { HistoricalValidationRepository } from "./historical-validation-repository";
import type {
  ImportValidationError,
  ImportAliasMapping,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";
import { guardRunValidation } from "./migration-lifecycle-guard";

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
// Service deps.
// ---------------------------------------------------------------------------

export interface HistoricalValidationServiceDeps {
  repository: HistoricalValidationRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /** WP-08-01F R6: Transaction runner for atomic validation writes. */
  transactionRunner?: <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;
  createRepository?: (tx: unknown) => HistoricalValidationRepository;
  createAudit?: (tx: unknown) => AuditTransactionHandle;
  createIdempotency?: (tx: unknown) => IdempotencyTransactionHandle;
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

    // WP-08-01F R6: Wrap ALL validation writes in a single transaction.
    // This ensures atomicity: if updateBatchStatus fails, all findings,
    // alias mappings, review items, and status updates roll back.
    // The idempotency claim is made BEFORE the transaction (root DB).
    // markSucceeded is called INSIDE the transaction (tx-scoped).
    const useTx = this.deps.transactionRunner && this.deps.createRepository && this.deps.createAudit && this.deps.createIdempotency;

    const executeValidation = async (repo: HistoricalValidationRepository, auditHandle: AuditTransactionHandle, idemHandle: IdempotencyTransactionHandle): Promise<RunValidationResult> => {
    // Delete old findings (re-run is safe — old findings are replaced)
    await repo.deleteValidationErrorsForBatch(user.tenantId, input.importBatchId);
    await repo.deleteAliasMappingsForBatch(user.tenantId, input.importBatchId);
    await repo.deleteHumanReviewItemsForBatch(user.tenantId, input.importBatchId);

    // Fetch all staging rows
    const rows = await repo.findStagingRowsForBatch(user.tenantId, input.importBatchId);

    let blockingErrors = 0;
    let warnings = 0;
    let informational = 0;
    let masterCandidates = 0;
    let reviewItems = 0;

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

        // Check if alias already exists for this source label (deduplication)
        const existing = await repo.findAliasMappingBySourceLabel(
          user.tenantId, input.importBatchId, "customer", sourceLabel,
        );
        if (!existing) {
          // Determine confidence score deterministically.
          // High confidence: exact match on normalized name (no variations).
          // Low confidence: name has potential variations (Arabic chars, extra spaces, etc.)
          const hasArabic = /[\u0600-\u06FF]/.test(sourceLabel);
          const hasExtraSpaces = sourceLabel !== sourceLabel.trim();
          const hasMixedCase = sourceLabel !== sourceLabel.toLowerCase() && sourceLabel !== sourceLabel.toUpperCase();
          const confidenceScore = hasArabic || hasExtraSpaces || hasMixedCase ? "0.500000" : "1.000000";
          const isLowConfidence = confidenceScore !== "1.000000";

          // Create as candidate — NOT a live master record
          const aliasMapping = await repo.insertAliasMapping({
            tenantId: user.tenantId,
            importBatchId: input.importBatchId,
            entityType: "customer",
            sourceLabel,
            normalizedName,
            targetMasterId: null, // No automatic master linking
            mappingVersion: null,
            confidenceScore, // Deterministic confidence score
            status: isLowConfidence ? "needs_review" : "candidate",
            notes: isLowConfidence ? "Low confidence — needs human review" : null,
            createdBy: user.userId,
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
              entityType: "customer",
              sourceLabel,
              normalizedName,
              confidenceScore,
              status: isLowConfidence ? "needs_review" : "candidate",
              targetMasterId: null,
            },
            idempotencyKey: input.idempotencyKey,
          });

          // Create human review item for ALL candidates (Contract 08 §8.4:
          // all candidates require human review before approval)
          const reviewItem = await repo.insertHumanReviewItem({
            tenantId: user.tenantId,
            importBatchId: input.importBatchId,
            stagingRowId: row.id,
            reviewReason: isLowConfidence
              ? `Low-confidence master candidate '${sourceLabel}' (confidence=${confidenceScore}) needs review.`
              : `Master candidate '${sourceLabel}' needs review.`,
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
        }
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

    // Execute with or without transaction
    if (useTx) {
      return await this.deps.transactionRunner!(async (tx: unknown) => {
        const txRepo = this.deps.createRepository!(tx);
        const txAudit = this.deps.createAudit!(tx);
        const txIdem = this.deps.createIdempotency!(tx);
        return executeValidation(txRepo, txAudit, txIdem);
      });
    } else {
      // Backward-compatible non-transactional path (for in-memory tests)
      return executeValidation(this.deps.repository, this.deps.audit, this.deps.idempotency);
    }
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
}
