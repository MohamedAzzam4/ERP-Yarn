/**
 * Quality Test Service — WP-06-01.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §13
 *   quality_tests + quality_test_values tables.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §11
 *   "Quality records facts; management authorizes risk."
 *   "Worker quality input does not authorize discount or risky sale."
 *   Quality status: accepted, needs_review, blocked.
 *   Classification changes are approved/audited.
 *
 * Contract: docs/contracts/13_work_packages.md WP-06-01
 *   Goal: Record quality facts and enforce sale availability/risk approvals.
 *   Implementation notes: Quality records facts; management authorizes risk.
 *   Acceptance: Blocked/review stock cannot ordinary-sell.
 *   What not to change: No Quality financial/stock approval.
 *
 * DEC-065: MVP sale reservation supports ONLY accepted/sellable stock.
 *   needs_review, blocked, discounted-return or other quality-risk stock
 *   must go through review/disposition before reservation.
 *
 * WP-06-01 SCOPE:
 *   - Create quality test draft/record (worker-safe: facts only)
 *   - Record test values per quality parameter
 *   - Set test status + risk classification (FACTS, not authorizations)
 *   - Review/update quality test status (quality role + management)
 *   - Read/query support: list tests needing review
 *   - Tenant isolation, idempotency, audit
 *
 * WP-06-01 NON-SCOPE:
 *   - Stock movements (Contract 04)
 *   - Account entries / payments / settlements (Contract 07)
 *   - Sale approval (WP-05-03)
 *   - Return approval (WP-06-03)
 *   - Replacement flow (WP-06-04)
 *   - Making risky stock sellable (DEC-065 guard remains in SalesSubmissionService)
 *   - Authorizing discount sales (sellable_with_discount is a REVIEW FLAG only)
 *
 * CORE RULE:
 *   Quality can mark risk/review state. It cannot itself make risky stock
 *   sellable, reserve it, discount it, or approve financial/stock treatment.
 *   The item's `qualityStatus` (on inventory_items/yarn_lots) is the
 *   authoritative status that gates reservation per DEC-065. This service
 *   records quality test FACTS but does NOT update the item's qualityStatus
 *   — that requires a separate management disposition (later WP).
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
  PermissionDeniedError,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  IdempotencyOwnershipLostError,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import {
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { QualityTestRepository } from "./quality-test-repository";
import type { QualityTest } from "@/server/db/schema/quality";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type QualityStatus = "accepted" | "needs_review" | "blocked";
export type RiskClassification =
  | "none"
  | "needs_review"
  | "sellable_with_discount"
  | "blocked"
  | "reprocess_required";

export interface CreateQualityTestInput {
  testDate: string;
  linkedEntityType: string; // inventory_item | raw_material_batch | yarn_lot
  linkedEntityId: string;
  saleId?: string | null;
  customerId?: string | null;
  /** Initial test status (FACT, not authorization). Default: needs_review. */
  testStatus?: QualityStatus;
  /** Risk classification (REVIEW FLAG, not authorization). Default: none. */
  riskClassification?: RiskClassification;
  notes?: string | null;
  idempotencyKey: string;
}

export interface RecordQualityTestValueInput {
  qualityTestId: string;
  parameterName: string;
  parameterCode: string;
  measuredValue?: string | null;
  valueStatus: "pending" | "pass" | "fail" | "review";
  notes?: string | null;
  idempotencyKey: string;
}

export interface ReviewQualityTestInput {
  qualityTestId: string;
  testStatus: QualityStatus;
  riskClassification: RiskClassification;
  reviewNotes?: string | null;
  idempotencyKey: string;
}

export interface CreateQualityTestResult {
  action: "created" | "replayed";
  qualityTestId: string;
  testNo: string;
  testStatus: QualityStatus;
  riskClassification: RiskClassification;
}

export interface ReviewQualityTestResult {
  action: "reviewed" | "replayed";
  qualityTestId: string;
  testStatus: QualityStatus;
  riskClassification: RiskClassification;
  reviewedBy: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class QualityTestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "QualityTestError"; this.code = code; }
}

export class QualityTestNotFoundError extends QualityTestError {
  constructor(id: string) { super("QUALITY_TEST_NOT_FOUND", `Quality test '${id}' not found.`); this.name = "QualityTestNotFoundError"; }
}

export class QualityTestAlreadyReviewedError extends QualityTestError {
  constructor(id: string, status: string) { super("STATE_CONFLICT", `Quality test '${id}' is in status '${status}' — cannot review.`); this.name = "QualityTestAlreadyReviewedError"; }
}

export class InvalidRiskClassificationError extends QualityTestError {
  constructor(classification: string) {
    super("VALIDATION_FAILED", `Invalid risk classification '${classification}'. Allowed: none, needs_review, sellable_with_discount, blocked, reprocess_required.`);
    this.name = "InvalidRiskClassificationError";
  }
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const QUALITY_TEST_ENTITY_TYPE = "quality_test";

const ALLOWED_LINKED_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "inventory_item", "raw_material_batch", "yarn_lot",
]);

const ALLOWED_RISK_CLASSIFICATIONS: ReadonlySet<RiskClassification> = new Set([
  "none", "needs_review", "sellable_with_discount", "blocked", "reprocess_required",
]);

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transaction composition types (WP-08-01E Milestone A transaction correction).
// Follows the established WP-08-01C/D pattern from SalesApprovalService.
// ---------------------------------------------------------------------------

export type QualityTestTransactionRunner = <T>(work: (tx: unknown) => Promise<T>) => Promise<T>;

export interface QualityTestTransactionScopedFactories {
  createQualityTestRepository: (tx: unknown) => QualityTestRepository;
  createIdempotency: (tx: unknown) => IdempotencyTransactionHandle;
  createAudit: (tx: unknown) => AuditTransactionHandle;
  createDocumentSequence: (tx: unknown) => DocumentSequenceTransactionHandle;
}

export interface QualityTestServiceDeps {
  qualityTestRepository: QualityTestRepository;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /** Optional transaction runner for atomic business writes + markSucceeded. */
  transactionRunner?: QualityTestTransactionRunner;
  /** Optional tx-scoped factories for creating transaction-scoped repos/handles. */
  txFactories?: QualityTestTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// QualityTestService.
// ---------------------------------------------------------------------------

export class QualityTestService {
  constructor(private readonly deps: QualityTestServiceDeps) {
    // WP-08-01E Task A: fail-closed validation — reject partial transaction
    // configuration. If transactionRunner is provided without txFactories
    // (or vice versa), throw immediately.
    if (!!this.deps.transactionRunner !== !!this.deps.txFactories) {
      throw new Error(
        "CONFIGURATION_ERROR: transactionRunner and txFactories must both be provided or both be absent.",
      );
    }
  }

  /**
   * Fail-closed helper: throws if a mutating command is called without
   * transaction configuration. Production mutation commands must NOT
   * silently fall back to root repositories.
   */
  private requireTransactionConfig(): {
    transactionRunner: QualityTestTransactionRunner;
    txFactories: QualityTestTransactionScopedFactories;
  } {
    if (!this.deps.transactionRunner || !this.deps.txFactories) {
      throw new Error(
        "CONFIGURATION_ERROR: transactionRunner and txFactories are required for production mutation commands. " +
        "Unit tests must explicitly provide a simulated transaction runner.",
      );
    }
    return {
      transactionRunner: this.deps.transactionRunner,
      txFactories: this.deps.txFactories,
    };
  }

  /**
   * Create a quality test record.
   *
   * Permission: quality_tests.create (Quality role + Owner + Accountant).
   * Workers can create tests if they have quality_tests.create permission.
   *
   * The test records FACTS about a quality measurement. It does NOT:
   *   - Create stock movements
   *   - Create account entries
   *   - Authorize discount sales
   *   - Make risky stock sellable
   *   - Approve sales or returns
   *
   * The test's `testStatus` + `riskClassification` are FACTS/review flags,
   * not authorizations. The item's `qualityStatus` (on inventory_items/yarn_lots)
   * remains the authoritative status that gates reservation per DEC-065.
   */
  async createQualityTest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateQualityTestInput,
  ): Promise<CreateQualityTestResult> {
    // Step 1: permission
    requirePermission(effective, "quality_tests.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Step 2: validate inputs
    if (!input.linkedEntityId?.trim()) throw new QualityTestError("VALIDATION_FAILED", "linkedEntityId is required.");
    if (!input.testDate?.trim()) throw new QualityTestError("VALIDATION_FAILED", "testDate is required.");
    if (!input.idempotencyKey?.trim()) throw new QualityTestError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!ALLOWED_LINKED_ENTITY_TYPES.has(input.linkedEntityType)) {
      throw new QualityTestError("VALIDATION_FAILED", `Invalid linkedEntityType '${input.linkedEntityType}'. Allowed: inventory_item, raw_material_batch, yarn_lot.`);
    }
    const testStatus: QualityStatus = input.testStatus ?? "needs_review";
    const riskClassification: RiskClassification = input.riskClassification ?? "none";
    if (!ALLOWED_RISK_CLASSIFICATIONS.has(riskClassification)) {
      throw new InvalidRiskClassificationError(riskClassification);
    }

    // Step 3: claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "quality_test.create",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        testDate: input.testDate,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
        saleId: input.saleId ?? null,
        customerId: input.customerId ?? null,
        testStatus,
        riskClassification,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<CreateQualityTestResult> | null;
      if (responseBody?.qualityTestId) {
        return { ...responseBody, action: "replayed" } as CreateQualityTestResult;
      }
    }
    if (claim.action === "conflict") {
      throw new QualityTestError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new QualityTestError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Step 4: Execute business writes + markSucceeded inside a single
    // transaction (WP-08-01E Milestone A transaction correction).
    // When transactionRunner + txFactories are provided (production path),
    // all writes share the same tx connection, so:
    //   - SELECT ... FOR UPDATE locks are tx-scoped
    //   - markSucceeded uses tx-scoped idempotency (atomic with business writes)
    //   - If markSucceeded affects 0 rows (ownership lost), throws
    //     IdempotencyOwnershipLostError → tx rolls back ALL business/audit effects
    //   - Audit uses tx-scoped audit handle (rolls back with tx)
    // When not provided (unit tests), runs without a DB transaction boundary.
    const executeCreate = async (
      txScoped: {
        qualityTestRepository: QualityTestRepository;
        idempotency: IdempotencyTransactionHandle;
        audit: AuditTransactionHandle;
        documentSequence: DocumentSequenceTransactionHandle;
      } | null,
    ): Promise<CreateQualityTestResult> => {
      const repo = txScoped?.qualityTestRepository ?? this.deps.qualityTestRepository;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;
      const auditHandle = txScoped?.audit ?? this.deps.audit;
      const docSeqHandle = txScoped?.documentSequence ?? this.deps.documentSequence;

      // Step 4a: allocate test number + insert quality test row
      const year = now.getUTCFullYear();
      const docNoResult = await allocateDocumentNumber(docSeqHandle, {
        tenantId: user.tenantId, documentType: "quality_test", year, entityType: QUALITY_TEST_ENTITY_TYPE,
      });

      const qualityTest = await repo.insertQualityTest({
        tenantId: user.tenantId,
        testNo: docNoResult.docNo,
        testDate: input.testDate,
        linkedEntityType: input.linkedEntityType,
        linkedEntityId: input.linkedEntityId,
        saleId: input.saleId ?? null,
        customerId: input.customerId ?? null,
        testStatus,
        riskClassification,
        testedBy: user.userId,
        testedAt: now,
        notes: input.notes ?? null,
        createdBy: user.userId,
      });

      // Record idempotency key for replay
      repo.recordIdempotencyKey?.(user.tenantId, input.idempotencyKey, qualityTest.id);

      // Step 4b: If the test status is restrictive (needs_review/blocked), create a
      // quality hold that SalesSubmissionService will check before reservation.
      const holdReason = this.deriveHoldReason(testStatus, riskClassification);
      let qualityHoldId: string | null = null;
      if (holdReason) {
        const hold = await repo.insertQualityHold({
          tenantId: user.tenantId,
          qualityTestId: qualityTest.id,
          linkedEntityType: qualityTest.linkedEntityType,
          linkedEntityId: qualityTest.linkedEntityId,
          holdReason,
          notes: `Auto-created from quality test ${qualityTest.testNo}`,
          createdBy: user.userId,
        });
        qualityHoldId = hold.id;
      }

      // Step 5: audit (tx-scoped — rolls back with tx on failure)
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: QUALITY_TEST_ENTITY_TYPE,
        entityId: qualityTest.id,
        actionType: "quality_test.create",
        newValuesJson: {
          testNo: qualityTest.testNo,
          testDate: qualityTest.testDate,
          linkedEntityType: qualityTest.linkedEntityType,
          linkedEntityId: qualityTest.linkedEntityId,
          saleId: qualityTest.saleId,
          customerId: qualityTest.customerId,
          testStatus: qualityTest.testStatus,
          riskClassification: qualityTest.riskClassification,
          testedBy: user.userId,
          qualityHoldId,
        },
        idempotencyKey: input.idempotencyKey,
      });

      // Step 6: mark idempotency succeeded (tx-scoped — atomic with business writes)
      const result: CreateQualityTestResult = {
        action: "created",
        qualityTestId: qualityTest.id,
        testNo: qualityTest.testNo,
        testStatus: qualityTest.testStatus as QualityStatus,
        riskClassification: qualityTest.riskClassification as RiskClassification,
      };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: QUALITY_TEST_ENTITY_TYPE,
        entityId: qualityTest.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    let result: CreateQualityTestResult;
    try {
      const { transactionRunner, txFactories } = this.requireTransactionConfig();
      result = await transactionRunner(async (tx: unknown) => {
        const txRepo = txFactories.createQualityTestRepository(tx);
        const txIdem = txFactories.createIdempotency(tx);
        const txAudit = txFactories.createAudit(tx);
        const txDocSeq = txFactories.createDocumentSequence(tx);
        return executeCreate({
          qualityTestRepository: txRepo,
          idempotency: txIdem,
          audit: txAudit,
          documentSequence: txDocSeq,
        });
      });
    } catch (txError) {
      // If ownership was lost during markSucceeded, the tx rolled back.
      // Mark business_failed outside the tx using the root idempotency handle.
      if (txError instanceof IdempotencyOwnershipLostError) {
        try {
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 409, responseBody: { message: "Ownership lost during create." },
            lastErrorClass: "IdempotencyOwnershipLostError",
          }, claim.record.ownerToken!, now);
        } catch (markError) {
          console.error("Failed to mark idempotency as business_failed after ownership loss:", markError);
        }
      }
      throw txError;
    }

    return result;
  }

  /**
   * Record a measured value for a quality parameter on a quality test.
   *
   * Permission: quality_tests.create (same as create — recording values is
   * part of the test creation flow).
   */
  async recordQualityTestValue(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: RecordQualityTestValueInput,
  ): Promise<{ valueId: string; valueStatus: string }> {
    requirePermission(effective, "quality_tests.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.qualityTestId?.trim()) throw new QualityTestError("VALIDATION_FAILED", "qualityTestId is required.");
    if (!input.parameterCode?.trim()) throw new QualityTestError("VALIDATION_FAILED", "parameterCode is required.");
    if (!input.idempotencyKey?.trim()) throw new QualityTestError("VALIDATION_FAILED", "idempotencyKey is required.");

    // Fetch + verify quality test exists
    const test = await this.deps.qualityTestRepository.findQualityTestById(user.tenantId, input.qualityTestId);
    if (!test) throw new QualityTestNotFoundError(input.qualityTestId);
    requireTenantMatch(user, test.tenantId);

    // Claim idempotency (WP-08-01E Milestone A: add persistent DB-backed
    // idempotency to recordQualityTestValue — was missing entirely, causing
    // duplicate values on replay and concurrent execution).
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "quality_test.value.record",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        qualityTestId: input.qualityTestId,
        parameterName: input.parameterName,
        parameterCode: input.parameterCode,
        measuredValue: input.measuredValue ?? null,
        valueStatus: input.valueStatus,
        notes: input.notes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as { valueId?: string; valueStatus?: string } | null;
      if (responseBody?.valueId) {
        return { valueId: responseBody.valueId, valueStatus: responseBody.valueStatus! };
      }
    }
    if (claim.action === "conflict") {
      throw new QualityTestError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new QualityTestError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Execute business writes + markSucceeded inside a single transaction
    // (WP-08-01E Milestone A transaction correction).
    const executeRecord = async (
      txScoped: {
        qualityTestRepository: QualityTestRepository;
        idempotency: IdempotencyTransactionHandle;
        audit: AuditTransactionHandle;
      } | null,
    ): Promise<{ valueId: string; valueStatus: string }> => {
      const repo = txScoped?.qualityTestRepository ?? this.deps.qualityTestRepository;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;
      const auditHandle = txScoped?.audit ?? this.deps.audit;

      const value = await repo.insertQualityTestValue({
        tenantId: user.tenantId,
        qualityTestId: input.qualityTestId,
        parameterName: input.parameterName,
        parameterCode: input.parameterCode,
        measuredValue: input.measuredValue ?? null,
        valueStatus: input.valueStatus,
        notes: input.notes ?? null,
        createdBy: user.userId,
      });

      // Audit (tx-scoped)
      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: QUALITY_TEST_ENTITY_TYPE,
        entityId: test.id,
        actionType: "quality_test.value.record",
        newValuesJson: {
          testNo: test.testNo,
          valueId: value.id,
          parameterName: value.parameterName,
          parameterCode: value.parameterCode,
          measuredValue: value.measuredValue,
          valueStatus: value.valueStatus,
        },
        idempotencyKey: input.idempotencyKey,
      });

      // Mark idempotency succeeded (tx-scoped — atomic with business writes)
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200,
        responseBody: { valueId: value.id, valueStatus: value.valueStatus },
        entityType: QUALITY_TEST_ENTITY_TYPE,
        entityId: test.id,
      }, claim.record.ownerToken!, now);

      return { valueId: value.id, valueStatus: value.valueStatus };
    };

    let result: { valueId: string; valueStatus: string };
    try {
      const { transactionRunner, txFactories } = this.requireTransactionConfig();
      result = await transactionRunner(async (tx: unknown) => {
        const txRepo = txFactories.createQualityTestRepository(tx);
        const txIdem = txFactories.createIdempotency(tx);
        const txAudit = txFactories.createAudit(tx);
        return executeRecord({
          qualityTestRepository: txRepo,
          idempotency: txIdem,
          audit: txAudit,
        });
      });
    } catch (txError) {
      if (txError instanceof IdempotencyOwnershipLostError) {
        try {
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 409, responseBody: { message: "Ownership lost during value record." },
            lastErrorClass: "IdempotencyOwnershipLostError",
          }, claim.record.ownerToken!, now);
        } catch (markError) {
          console.error("Failed to mark idempotency as business_failed after ownership loss:", markError);
        }
      }
      throw txError;
    }

    return result;
  }

  /**
   * Review/update a quality test's status + risk classification.
   *
   * Permission: quality_tests.create (Quality role + Owner + Accountant).
   * This is a FACT update, not a financial/stock authorization.
   *
   * DEC-080 is NOT applicable here — this is not an approval-style flow.
   * Quality test review is a fact-recording action, not a financial approval.
   *
   * The testStatus + riskClassification are FACTS/review flags. They do NOT:
   *   - Update the item's qualityStatus (requires separate disposition)
   *   - Make risky stock sellable
   *   - Authorize discount sales
   *   - Create stock movements or account entries
   */
  async reviewQualityTest(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ReviewQualityTestInput,
  ): Promise<ReviewQualityTestResult> {
    // Contract 11 §7: Quality-risk sale approval = Owner/Accountant only.
    // This review can clear holds, classify stock as sellable, authorize
    // sellable_with_discount, or otherwise permit risky sale — therefore
    // it requires quality_risk_sales.approve, NOT quality_tests.create.
    // Workers (Quality/Warehouse) retain quality_tests.create for fact
    // recording only.
    requirePermission(effective, "quality_risk_sales.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.qualityTestId?.trim()) throw new QualityTestError("VALIDATION_FAILED", "qualityTestId is required.");
    if (!input.idempotencyKey?.trim()) throw new QualityTestError("VALIDATION_FAILED", "idempotencyKey is required.");
    if (!ALLOWED_RISK_CLASSIFICATIONS.has(input.riskClassification)) {
      throw new InvalidRiskClassificationError(input.riskClassification);
    }

    // Fetch + lock quality test
    const test = await this.deps.qualityTestRepository.findQualityTestById(user.tenantId, input.qualityTestId);
    if (!test) throw new QualityTestNotFoundError(input.qualityTestId);
    requireTenantMatch(user, test.tenantId);

    await this.deps.qualityTestRepository.lockQualityTest(user.tenantId, test.id);

    // Claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "quality_test.review",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        qualityTestId: input.qualityTestId,
        testStatus: input.testStatus,
        riskClassification: input.riskClassification,
        reviewNotes: input.reviewNotes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as Partial<ReviewQualityTestResult> | null;
      if (responseBody?.qualityTestId) {
        return { ...responseBody, action: "replayed" } as ReviewQualityTestResult;
      }
    }
    if (claim.action === "conflict") {
      throw new QualityTestError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new QualityTestError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Execute business writes + markSucceeded inside a single transaction
    // (WP-08-01E Task B: reviewQualityTest has multiple writes — updateStatus,
    // insertHold, audit, markSucceeded — must be atomic).
    const executeReview = async (
      txScoped: {
        qualityTestRepository: QualityTestRepository;
        idempotency: IdempotencyTransactionHandle;
        audit: AuditTransactionHandle;
      } | null,
    ): Promise<ReviewQualityTestResult> => {
      const repo = txScoped?.qualityTestRepository ?? this.deps.qualityTestRepository;
      const idemHandle = txScoped?.idempotency ?? this.deps.idempotency;
      const auditHandle = txScoped?.audit ?? this.deps.audit;

      const updated = await repo.updateQualityTestStatus(
        user.tenantId, test.id,
        {
          testStatus: input.testStatus,
          riskClassification: input.riskClassification,
          reviewedBy: user.userId,
          reviewedAt: now,
          reviewNotes: input.reviewNotes ?? null,
          updatedBy: user.userId,
        },
        ["accepted", "needs_review", "blocked"],
      );
      if (!updated) {
        throw new QualityTestError("INTERNAL_TRANSACTION_FAILED", `Quality test '${test.id}' could not be updated.`);
      }

      const newHoldReason = this.deriveHoldReason(input.testStatus, input.riskClassification);
      let newQualityHoldId: string | null = null;
      if (newHoldReason) {
        const hold = await repo.insertQualityHold({
          tenantId: user.tenantId,
          qualityTestId: test.id,
          linkedEntityType: test.linkedEntityType,
          linkedEntityId: test.linkedEntityId,
          holdReason: newHoldReason,
          notes: `Auto-created from quality test review ${test.testNo}`,
          createdBy: user.userId,
        });
        newQualityHoldId = hold.id;
      }

      await appendAuditLog(auditHandle, user.tenantId, user.userId, {
        entityType: QUALITY_TEST_ENTITY_TYPE,
        entityId: test.id,
        actionType: "quality_test.review",
        newValuesJson: {
          testNo: test.testNo,
          previousTestStatus: test.testStatus,
          previousRiskClassification: test.riskClassification,
          newTestStatus: input.testStatus,
          newRiskClassification: input.riskClassification,
          reviewedBy: user.userId,
          reviewNotes: input.reviewNotes ?? null,
          newQualityHoldId,
        },
        idempotencyKey: input.idempotencyKey,
      });

      const result: ReviewQualityTestResult = {
        action: "reviewed",
        qualityTestId: test.id,
        testStatus: input.testStatus,
        riskClassification: input.riskClassification,
        reviewedBy: user.userId,
      };
      await markSucceeded(idemHandle, claim.record.id, {
        responseCode: 200,
        responseBody: result,
        entityType: QUALITY_TEST_ENTITY_TYPE,
        entityId: test.id,
      }, claim.record.ownerToken!, now);

      return result;
    };

    let result: ReviewQualityTestResult;
    try {
      const { transactionRunner, txFactories } = this.requireTransactionConfig();
      result = await transactionRunner(async (tx: unknown) => {
        const txRepo = txFactories.createQualityTestRepository(tx);
        const txIdem = txFactories.createIdempotency(tx);
        const txAudit = txFactories.createAudit(tx);
        return executeReview({
          qualityTestRepository: txRepo,
          idempotency: txIdem,
          audit: txAudit,
        });
      });
    } catch (txError) {
      if (txError instanceof IdempotencyOwnershipLostError) {
        try {
          await markBusinessFailed(this.deps.idempotency, claim.record.id, {
            responseCode: 409, responseBody: { message: "Ownership lost during review." },
            lastErrorClass: "IdempotencyOwnershipLostError",
          }, claim.record.ownerToken!, now);
        } catch (markError) {
          console.error("Failed to mark idempotency as business_failed after ownership loss:", markError);
        }
      }
      throw txError;
    }

    return result;
  }

  /**
   * List quality tests needing review.
   *
   * Permission: quality_tests.create (Quality role + Owner + Accountant).
   * Workers without quality_tests.create are denied.
   */
  async listQualityTestsNeedingReview(
    user: ErpUserContext,
    effective: EffectivePermissions,
  ): Promise<QualityTest[]> {
    requirePermission(effective, "quality_tests.create");
    return this.deps.qualityTestRepository.listQualityTestsNeedingReview(user.tenantId);
  }

  /**
   * Clear a quality hold (management disposition).
   *
   * Permission: quality_risk_sales.approve (Owner/Accountant ONLY).
   * Quality workers CANNOT clear holds — they can only create them.
   *
   * This is the ONLY way to unblock stock that has a quality hold.
   * An accepted quality test does NOT clear existing holds — only this
   * explicit management disposition can.
   *
   * DEC-080: Not applicable here — this is a management disposition, not
   * an approval of a request the user created. The management user clearing
   * the hold is authorizing the stock to be sellable again.
   */
  async clearQualityHold(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: {
      qualityHoldId: string;
      clearanceReason: string;
      idempotencyKey: string;
    },
  ): Promise<{ action: "cleared" | "replayed"; qualityHoldId: string; holdStatus: string }> {
    // Permission: quality_risk_sales.approve — Owner/Accountant ONLY
    requirePermission(effective, "quality_risk_sales.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.qualityHoldId?.trim()) throw new QualityTestError("VALIDATION_FAILED", "qualityHoldId is required.");
    if (!input.clearanceReason?.trim()) throw new QualityTestError("VALIDATION_FAILED", "clearanceReason is required.");
    if (!input.idempotencyKey?.trim()) throw new QualityTestError("VALIDATION_FAILED", "idempotencyKey is required.");

    // Fetch hold
    const hold = await this.deps.qualityTestRepository.findQualityHoldById(user.tenantId, input.qualityHoldId);
    if (!hold) throw new QualityTestError("QUALITY_HOLD_NOT_FOUND", `Quality hold '${input.qualityHoldId}' not found.`);
    requireTenantMatch(user, hold.tenantId);

    // Claim idempotency
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "quality_hold.clear",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        qualityHoldId: input.qualityHoldId,
        clearanceReason: input.clearanceReason,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };
    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      const responseBody = claim.record.responseBody as { qualityHoldId?: string; holdStatus?: string } | null;
      if (responseBody?.qualityHoldId) {
        return { action: "replayed", qualityHoldId: responseBody.qualityHoldId, holdStatus: responseBody.holdStatus! };
      }
    }
    if (claim.action === "conflict") {
      throw new QualityTestError("IDEMPOTENCY_CONFLICT", `Idempotency key '${input.idempotencyKey}' was used with a different request body.`);
    }
    if (claim.action === "in_progress") {
      throw new QualityTestError("OPERATION_IN_PROGRESS", `Operation '${input.idempotencyKey}' is still in progress.`);
    }

    // Clear the hold
    const cleared = await this.deps.qualityTestRepository.clearQualityHold(
      user.tenantId, input.qualityHoldId,
      {
        clearedBy: user.userId,
        clearanceReason: input.clearanceReason,
        updatedBy: user.userId,
      },
    );
    if (!cleared) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409, responseBody: { message: "Hold already cleared or not found." },
        lastErrorClass: "QualityTestError",
      }, claim.record.ownerToken!, now);
      throw new QualityTestError("STATE_CONFLICT", `Quality hold '${input.qualityHoldId}' is already cleared or not found.`);
    }

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "quality_hold",
      entityId: hold.id,
      actionType: "quality_hold.clear",
      newValuesJson: {
        qualityTestId: hold.qualityTestId,
        linkedEntityType: hold.linkedEntityType,
        linkedEntityId: hold.linkedEntityId,
        previousHoldReason: hold.holdReason,
        clearanceReason: input.clearanceReason,
        clearedBy: user.userId,
      },
      idempotencyKey: input.idempotencyKey,
    });

    const result = { action: "cleared" as const, qualityHoldId: hold.id, holdStatus: "cleared" as const };
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: result,
      entityType: "quality_hold",
      entityId: hold.id,
    }, claim.record.ownerToken!, now);

    return result;
  }

  // -------------------------------------------------------------------------
  // Helpers.
  // -------------------------------------------------------------------------

  /**
   * Derive the hold reason from a quality test's status + risk classification.
   * Returns null if no hold is needed (accepted + none/none).
   *
   * Restrictive statuses that create holds:
   *   - testStatus = needs_review → hold_reason = needs_review
   *   - testStatus = blocked → hold_reason = blocked
   *   - riskClassification = needs_review → hold_reason = needs_review
   *   - riskClassification = blocked → hold_reason = blocked
   *   - riskClassification = reprocess_required → hold_reason = reprocess_required
   *   - riskClassification = sellable_with_discount → hold_reason = sellable_with_discount
   *
   * Non-restrictive (no hold):
   *   - testStatus = accepted AND riskClassification = none
   *
   * NOTE: sellable_with_discount creates an active hold because DEC-065
   * requires discounted/risky stock to go through review/disposition before
   * ordinary reservation/sale. The hold can only be cleared by
   * Owner/Accountant management disposition (quality_risk_sales.approve).
   */
  private deriveHoldReason(
    testStatus: QualityStatus,
    riskClassification: RiskClassification,
  ): "needs_review" | "blocked" | "reprocess_required" | "sellable_with_discount" | null {
    // blocked test status always creates a blocked hold
    if (testStatus === "blocked") return "blocked";
    // needs_review test status creates a needs_review hold
    if (testStatus === "needs_review") return "needs_review";
    // accepted test status: check risk classification
    if (testStatus === "accepted") {
      if (riskClassification === "needs_review") return "needs_review";
      if (riskClassification === "blocked") return "blocked";
      if (riskClassification === "reprocess_required") return "reprocess_required";
      if (riskClassification === "sellable_with_discount") return "sellable_with_discount";
      // none → no hold
      return null;
    }
    return null;
  }
}
