/**
 * In-memory QualityTestRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 *
 * Supports snapshot/restore for rollback simulation in atomicity tests.
 */
import type { QualityTest, QualityTestValue } from "@/server/db/schema/quality";
import type {
  QualityTestRepository,
  NewQualityTestInput,
  UpdateQualityTestStatusInput,
  NewQualityTestValueInput,
} from "../quality-test-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryQualityTestRepository implements QualityTestRepository {
  private qualityTests = new Map<string, QualityTest>();
  private qualityTestValues = new Map<string, QualityTestValue>();
  private idempotencyKeyMap = new Map<string, string>();
  private testCounter = 0;
  private valueCounter = 0;

  snapshot(): {
    qualityTests: Map<string, QualityTest>;
    qualityTestValues: Map<string, QualityTestValue>;
    idempotencyKeyMap: Map<string, string>;
    testCounter: number;
    valueCounter: number;
  } {
    return {
      qualityTests: new Map([...this.qualityTests].map(([k, v]) => [k, { ...v }])),
      qualityTestValues: new Map([...this.qualityTestValues].map(([k, v]) => [k, { ...v }])),
      idempotencyKeyMap: new Map(this.idempotencyKeyMap),
      testCounter: this.testCounter,
      valueCounter: this.valueCounter,
    };
  }

  restore(snap: {
    qualityTests: Map<string, QualityTest>;
    qualityTestValues: Map<string, QualityTestValue>;
    idempotencyKeyMap: Map<string, string>;
    testCounter: number;
    valueCounter: number;
  }): void {
    this.qualityTests = new Map([...snap.qualityTests].map(([k, v]) => [k, { ...v }]));
    this.qualityTestValues = new Map([...snap.qualityTestValues].map(([k, v]) => [k, { ...v }]));
    this.idempotencyKeyMap = new Map(snap.idempotencyKeyMap);
    this.testCounter = snap.testCounter;
    this.valueCounter = snap.valueCounter;
  }

  async insertQualityTest(row: NewQualityTestInput): Promise<QualityTest> {
    this.testCounter++;
    const id = nid("qt", this.testCounter);
    const test: QualityTest = {
      id,
      tenantId: row.tenantId,
      testNo: row.testNo,
      testDate: row.testDate,
      linkedEntityType: row.linkedEntityType,
      linkedEntityId: row.linkedEntityId,
      saleId: row.saleId ?? null,
      customerId: row.customerId ?? null,
      testStatus: row.testStatus,
      riskClassification: row.riskClassification,
      testedBy: row.testedBy ?? null,
      testedAt: row.testedAt ?? null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      notes: row.notes ?? null,
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: NOW(),
      updatedBy: row.createdBy,
    };
    this.qualityTests.set(`${row.tenantId}:${id}`, test);
    return test;
  }

  async findQualityTestById(tenantId: string, testId: string): Promise<QualityTest | null> {
    return this.qualityTests.get(`${tenantId}:${testId}`) ?? null;
  }

  async findQualityTestByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<QualityTest | null> {
    const testId = this.idempotencyKeyMap.get(`${tenantId}:${idempotencyKey}`);
    if (!testId) return null;
    return this.qualityTests.get(`${tenantId}:${testId}`) ?? null;
  }

  recordIdempotencyKey(tenantId: string, idempotencyKey: string, testId: string): void {
    this.idempotencyKeyMap.set(`${tenantId}:${idempotencyKey}`, testId);
  }

  async updateQualityTestStatus(
    tenantId: string,
    testId: string,
    patch: UpdateQualityTestStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<QualityTest | null> {
    const key = `${tenantId}:${testId}`;
    const test = this.qualityTests.get(key);
    if (!test) return null;
    if (!expectedCurrentStatuses.includes(test.testStatus)) return null;
    const updated: QualityTest = {
      ...test,
      testStatus: patch.testStatus,
      riskClassification: patch.riskClassification,
      reviewedBy: patch.reviewedBy,
      reviewedAt: patch.reviewedAt,
      reviewNotes: patch.reviewNotes ?? test.reviewNotes,
      updatedAt: NOW(),
      updatedBy: patch.updatedBy,
    };
    this.qualityTests.set(key, updated);
    return updated;
  }

  async listQualityTestsForLinkedEntity(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<QualityTest[]> {
    return [...this.qualityTests.values()].filter(
      (t) => t.tenantId === tenantId && t.linkedEntityType === linkedEntityType && t.linkedEntityId === linkedEntityId,
    );
  }

  async listQualityTestsNeedingReview(tenantId: string): Promise<QualityTest[]> {
    return [...this.qualityTests.values()].filter(
      (t) => t.tenantId === tenantId && t.testStatus === "needs_review",
    );
  }

  async insertQualityTestValue(row: NewQualityTestValueInput): Promise<QualityTestValue> {
    this.valueCounter++;
    const id = nid("qtv", this.valueCounter);
    const value: QualityTestValue = {
      id,
      tenantId: row.tenantId,
      qualityTestId: row.qualityTestId,
      parameterName: row.parameterName,
      parameterCode: row.parameterCode,
      measuredValue: row.measuredValue ?? null,
      valueStatus: row.valueStatus,
      notes: row.notes ?? null,
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: NOW(),
      updatedBy: row.createdBy,
    };
    this.qualityTestValues.set(`${row.tenantId}:${id}`, value);
    return value;
  }

  async listQualityTestValues(tenantId: string, qualityTestId: string): Promise<QualityTestValue[]> {
    return [...this.qualityTestValues.values()].filter(
      (v) => v.tenantId === tenantId && v.qualityTestId === qualityTestId,
    );
  }

  async lockQualityTest(_tenantId: string, _testId: string): Promise<void> {
    // No-op in single-threaded in-memory store
  }
}
