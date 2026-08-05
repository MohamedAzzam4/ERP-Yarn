/**
 * Drizzle-backed QualityTestRepository — the production DB quality-test store.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §13
 *   quality_tests + quality_test_values + quality_holds tables.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §11
 *   Quality records facts; management authorizes risk.
 *
 * This repository owns quality_tests, quality_test_values, and quality_holds.
 * It does NOT create stock movements, account entries, or sale approvals.
 *
 * Tenant isolation: every query filters by tenantId.
 *
 * Conditional updates:
 *   updateQualityTestStatus uses WHERE test_status IN (expectedCurrentStatuses)
 *   to enforce the state machine atomically.
 *
 * Locking:
 *   lockQualityTest uses SELECT ... FOR UPDATE on the quality_tests row.
 */
import "server-only";
import { eq, and, inArray, sql as drizzleSql } from "drizzle-orm";
import {
  qualityTests,
  qualityTestValues,
  qualityHolds,
} from "@/server/db/schema/quality";
import type { db as DbType } from "@/server/db/client";
import type {
  QualityTestRepository,
  NewQualityTestInput,
  UpdateQualityTestStatusInput,
  NewQualityTestValueInput,
  NewQualityHoldInput,
  ClearQualityHoldInput,
} from "./quality-test-repository";
import type {
  QualityTest,
  QualityTestValue,
  QualityHold,
} from "@/server/db/schema/quality";

type Db = NonNullable<typeof DbType>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class QualityTestDbRepository implements QualityTestRepository {
  constructor(private readonly db: DbOrTx) {}

  // -------------------------------------------------------------------------
  // quality_tests
  // -------------------------------------------------------------------------

  async insertQualityTest(row: NewQualityTestInput): Promise<QualityTest> {
    const [result] = await this.db
      .insert(qualityTests)
      .values({
        tenantId: row.tenantId,
        testNo: row.testNo,
        testDate: row.testDate,
        linkedEntityType: row.linkedEntityType,
        linkedEntityId: row.linkedEntityId,
        saleId: row.saleId ?? null,
        customerId: row.customerId ?? null,
        testStatus: row.testStatus as QualityTest["testStatus"],
        riskClassification: row.riskClassification,
        testedBy: row.testedBy ?? null,
        testedAt: row.testedAt ?? null,
        notes: row.notes ?? null,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      })
      .returning();
    if (!result) throw new Error("Failed to insert quality test row.");
    return result;
  }

  async findQualityTestById(
    tenantId: string,
    testId: string,
  ): Promise<QualityTest | null> {
    const [result] = await this.db
      .select()
      .from(qualityTests)
      .where(
        and(
          eq(qualityTests.tenantId, tenantId),
          eq(qualityTests.id, testId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findQualityTestByIdempotencyKey(
    _tenantId: string,
    _idempotencyKey: string,
  ): Promise<QualityTest | null> {
    // quality_tests has no idempotency_key column. The idempotency mapping
    // is tracked via the idempotency_records table by the service.
    return null;
  }

  async updateQualityTestStatus(
    tenantId: string,
    testId: string,
    patch: UpdateQualityTestStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<QualityTest | null> {
    if (expectedCurrentStatuses.length === 0) return null;
    const [result] = await this.db
      .update(qualityTests)
      .set({
        testStatus: patch.testStatus as QualityTest["testStatus"],
        riskClassification: patch.riskClassification,
        reviewedBy: patch.reviewedBy,
        reviewedAt: patch.reviewedAt,
        reviewNotes: patch.reviewNotes ?? null,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(qualityTests.tenantId, tenantId),
          eq(qualityTests.id, testId),
          inArray(
            qualityTests.testStatus,
            expectedCurrentStatuses as QualityTest["testStatus"][],
          ),
        ),
      )
      .returning();
    return result ?? null;
  }

  async listQualityTestsForLinkedEntity(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<QualityTest[]> {
    return this.db
      .select()
      .from(qualityTests)
      .where(
        and(
          eq(qualityTests.tenantId, tenantId),
          eq(qualityTests.linkedEntityType, linkedEntityType),
          eq(qualityTests.linkedEntityId, linkedEntityId),
        ),
      );
  }

  async listQualityTestsNeedingReview(
    tenantId: string,
  ): Promise<QualityTest[]> {
    return this.db
      .select()
      .from(qualityTests)
      .where(
        and(
          eq(qualityTests.tenantId, tenantId),
          eq(qualityTests.testStatus, "needs_review" as QualityTest["testStatus"]),
        ),
      );
  }

  // -------------------------------------------------------------------------
  // quality_test_values
  // -------------------------------------------------------------------------

  async insertQualityTestValue(
    row: NewQualityTestValueInput,
  ): Promise<QualityTestValue> {
    const [result] = await this.db
      .insert(qualityTestValues)
      .values({
        tenantId: row.tenantId,
        qualityTestId: row.qualityTestId,
        parameterName: row.parameterName,
        parameterCode: row.parameterCode,
        measuredValue: row.measuredValue ?? null,
        valueStatus: row.valueStatus,
        notes: row.notes ?? null,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      })
      .returning();
    if (!result) throw new Error("Failed to insert quality test value row.");
    return result;
  }

  async listQualityTestValues(
    tenantId: string,
    qualityTestId: string,
  ): Promise<QualityTestValue[]> {
    return this.db
      .select()
      .from(qualityTestValues)
      .where(
        and(
          eq(qualityTestValues.tenantId, tenantId),
          eq(qualityTestValues.qualityTestId, qualityTestId),
        ),
      );
  }

  // -------------------------------------------------------------------------
  // locking
  // -------------------------------------------------------------------------

  async lockQualityTest(
    tenantId: string,
    testId: string,
  ): Promise<void> {
    await this.db
      .select()
      .from(qualityTests)
      .where(
        and(
          eq(qualityTests.tenantId, tenantId),
          eq(qualityTests.id, testId),
        ),
      )
      .for("update")
      .limit(1);
  }

  // -------------------------------------------------------------------------
  // quality_holds
  // -------------------------------------------------------------------------

  async insertQualityHold(row: NewQualityHoldInput): Promise<QualityHold> {
    const [result] = await this.db
      .insert(qualityHolds)
      .values({
        tenantId: row.tenantId,
        qualityTestId: row.qualityTestId,
        linkedEntityType: row.linkedEntityType,
        linkedEntityId: row.linkedEntityId,
        holdReason: row.holdReason as QualityHold["holdReason"],
        notes: row.notes ?? null,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      })
      .returning();
    if (!result) throw new Error("Failed to insert quality hold row.");
    return result;
  }

  async findQualityHoldById(
    tenantId: string,
    holdId: string,
  ): Promise<QualityHold | null> {
    const [result] = await this.db
      .select()
      .from(qualityHolds)
      .where(
        and(
          eq(qualityHolds.tenantId, tenantId),
          eq(qualityHolds.id, holdId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async listActiveQualityHoldsForEntity(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<QualityHold[]> {
    return this.db
      .select()
      .from(qualityHolds)
      .where(
        and(
          eq(qualityHolds.tenantId, tenantId),
          eq(qualityHolds.linkedEntityType, linkedEntityType),
          eq(qualityHolds.linkedEntityId, linkedEntityId),
          eq(qualityHolds.holdStatus, "active" as QualityHold["holdStatus"]),
        ),
      );
  }

  async clearQualityHold(
    tenantId: string,
    holdId: string,
    patch: ClearQualityHoldInput,
  ): Promise<QualityHold | null> {
    const [result] = await this.db
      .update(qualityHolds)
      .set({
        holdStatus: "cleared" as QualityHold["holdStatus"],
        clearedBy: patch.clearedBy,
        clearanceReason: patch.clearanceReason,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(qualityHolds.tenantId, tenantId),
          eq(qualityHolds.id, holdId),
          eq(qualityHolds.holdStatus, "active" as QualityHold["holdStatus"]),
        ),
      )
      .returning();
    return result ?? null;
  }

  // NOTE: recordIdempotencyKey is intentionally NOT implemented.
  // The DB repository relies on the idempotency_records table (managed by
  // the service layer via IdempotencyDbRepository) for replay semantics.
}

export function createQualityTestDbRepository(
  db: DbOrTx,
): QualityTestDbRepository {
  return new QualityTestDbRepository(db);
}
