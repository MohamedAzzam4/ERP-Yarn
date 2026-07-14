/**
 * Quality Test Repository — WP-06-01.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §13
 *   quality_tests + quality_test_values tables.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §11
 *   Quality records facts; management authorizes risk.
 *   Worker quality input does not authorize discount or risky sale.
 *
 * This is the persistence boundary for quality_tests + quality_test_values.
 * The service does NOT create stock movements, account entries, payments, or
 * sale approvals.
 */
import "server-only";

import type { QualityTest, QualityTestValue } from "@/server/db/schema/quality";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export type QualityStatus = "accepted" | "needs_review" | "blocked";
export type RiskClassification =
  | "none"
  | "needs_review"
  | "sellable_with_discount"
  | "blocked"
  | "reprocess_required";

export interface NewQualityTestInput {
  tenantId: string;
  testNo: string;
  testDate: string;
  linkedEntityType: string; // inventory_item | raw_material_batch | yarn_lot
  linkedEntityId: string;
  saleId?: string | null;
  customerId?: string | null;
  testStatus: QualityStatus;
  riskClassification: RiskClassification;
  testedBy?: string | null;
  testedAt?: Date | null;
  notes?: string | null;
  createdBy: string;
}

export interface UpdateQualityTestStatusInput {
  testStatus: QualityStatus;
  riskClassification: RiskClassification;
  reviewedBy: string;
  reviewedAt: Date;
  reviewNotes?: string | null;
  updatedBy: string;
}

export interface NewQualityTestValueInput {
  tenantId: string;
  qualityTestId: string;
  parameterName: string;
  parameterCode: string;
  measuredValue?: string | null;
  valueStatus: "pending" | "pass" | "fail" | "review";
  notes?: string | null;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface QualityTestRepository {
  /** Insert a new quality test row. */
  insertQualityTest(row: NewQualityTestInput): Promise<QualityTest>;

  /** Find a quality test by id. */
  findQualityTestById(tenantId: string, testId: string): Promise<QualityTest | null>;

  /** Find a quality test by idempotency key. */
  findQualityTestByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<QualityTest | null>;

  /**
   * Conditionally update quality test status. Only succeeds if current
   * testStatus matches one of expectedCurrentStatuses.
   */
  updateQualityTestStatus(
    tenantId: string,
    testId: string,
    patch: UpdateQualityTestStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<QualityTest | null>;

  /** List quality tests for a linked entity (item/batch/lot). */
  listQualityTestsForLinkedEntity(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<QualityTest[]>;

  /** List quality tests needing review (testStatus = needs_review). */
  listQualityTestsNeedingReview(tenantId: string): Promise<QualityTest[]>;

  /** Insert a quality test value. */
  insertQualityTestValue(row: NewQualityTestValueInput): Promise<QualityTestValue>;

  /** List values for a quality test. */
  listQualityTestValues(tenantId: string, qualityTestId: string): Promise<QualityTestValue[]>;

  /**
   * Acquire a transaction-scoped advisory lock on a quality test.
   * Required before status updates to prevent concurrent modifications.
   */
  lockQualityTest(tenantId: string, testId: string): Promise<void>;

  /**
   * Test helper: associate idempotency key with a quality test ID.
   * Optional — in-memory repos implement this; DB repos use the idempotency_records table.
   */
  recordIdempotencyKey?(tenantId: string, idempotencyKey: string, testId: string): void;
}

// ---------------------------------------------------------------------------
// Re-export domain types.
// ---------------------------------------------------------------------------

export type { QualityTest, QualityTestValue } from "@/server/db/schema/quality";
