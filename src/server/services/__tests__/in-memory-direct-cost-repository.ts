/**
 * In-memory DirectCostRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 *
 * Supports snapshot/restore for rollback simulation in atomicity tests.
 */
import type { DirectCost, DirectCostAllocation } from "@/server/db/schema/subledger";
import type {
  DirectCostRepository,
  NewDirectCostInput,
  UpdateDirectCostReviewInput,
  NewDirectCostAllocationInput,
} from "../direct-cost-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryDirectCostRepository implements DirectCostRepository {
  private directCosts = new Map<string, DirectCost>();
  private allocations = new Map<string, DirectCostAllocation>();
  private idempotencyKeyMap = new Map<string, string>(); // tenantId:idemKey → directCostId
  private directCostCounter = 0;
  private allocationCounter = 0;

  snapshot(): {
    directCosts: Map<string, DirectCost>;
    allocations: Map<string, DirectCostAllocation>;
    idempotencyKeyMap: Map<string, string>;
    directCostCounter: number;
    allocationCounter: number;
  } {
    return {
      directCosts: new Map([...this.directCosts].map(([k, v]) => [k, { ...v }])),
      allocations: new Map([...this.allocations].map(([k, v]) => [k, { ...v }])),
      idempotencyKeyMap: new Map(this.idempotencyKeyMap),
      directCostCounter: this.directCostCounter,
      allocationCounter: this.allocationCounter,
    };
  }

  restore(snap: {
    directCosts: Map<string, DirectCost>;
    allocations: Map<string, DirectCostAllocation>;
    idempotencyKeyMap: Map<string, string>;
    directCostCounter: number;
    allocationCounter: number;
  }): void {
    this.directCosts = new Map([...snap.directCosts].map(([k, v]) => [k, { ...v }]));
    this.allocations = new Map([...snap.allocations].map(([k, v]) => [k, { ...v }]));
    this.idempotencyKeyMap = new Map(snap.idempotencyKeyMap);
    this.directCostCounter = snap.directCostCounter;
    this.allocationCounter = snap.allocationCounter;
  }

  async insertDirectCost(row: NewDirectCostInput): Promise<DirectCost> {
    this.directCostCounter++;
    const id = nid("dc", this.directCostCounter);
    const directCost: DirectCost = {
      id,
      tenantId: row.tenantId,
      costNo: row.costNo,
      costType: row.costType as DirectCost["costType"],
      linkedEntityType: row.linkedEntityType,
      linkedEntityId: row.linkedEntityId,
      amount: row.amount,
      currency: row.currency,
      costResponsibilityType: row.costResponsibilityType as DirectCost["costResponsibilityType"],
      actualPayerType: row.actualPayerType as DirectCost["actualPayerType"],
      includedInProfitability: row.includedInProfitability,
      reviewStatus: row.reviewStatus as DirectCost["reviewStatus"],
      notes: row.notes ?? null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: NOW(),
      updatedBy: row.createdBy,
    };
    this.directCosts.set(`${row.tenantId}:${id}`, directCost);
    return directCost;
  }

  async findDirectCostById(tenantId: string, directCostId: string): Promise<DirectCost | null> {
    return this.directCosts.get(`${tenantId}:${directCostId}`) ?? null;
  }

  async findDirectCostByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<DirectCost | null> {
    const directCostId = this.idempotencyKeyMap.get(`${tenantId}:${idempotencyKey}`);
    if (!directCostId) return null;
    return this.directCosts.get(`${tenantId}:${directCostId}`) ?? null;
  }

  /** Test helper: associate idempotency key with a direct cost ID. */
  recordIdempotencyKey(tenantId: string, idempotencyKey: string, directCostId: string): void {
    this.idempotencyKeyMap.set(`${tenantId}:${idempotencyKey}`, directCostId);
  }

  async updateDirectCostReview(
    tenantId: string,
    directCostId: string,
    patch: UpdateDirectCostReviewInput,
    expectedCurrentStatuses: string[],
  ): Promise<DirectCost | null> {
    const key = `${tenantId}:${directCostId}`;
    const directCost = this.directCosts.get(key);
    if (!directCost) return null;
    if (!expectedCurrentStatuses.includes(directCost.reviewStatus)) return null;
    const updated: DirectCost = {
      ...directCost,
      amount: patch.amount !== undefined ? patch.amount : directCost.amount,
      costResponsibilityType: (patch.costResponsibilityType ?? directCost.costResponsibilityType) as DirectCost["costResponsibilityType"],
      actualPayerType: (patch.actualPayerType ?? directCost.actualPayerType) as DirectCost["actualPayerType"],
      includedInProfitability: patch.includedInProfitability ?? directCost.includedInProfitability,
      reviewStatus: patch.reviewStatus as DirectCost["reviewStatus"],
      notes: patch.notes ?? directCost.notes,
      reviewedBy: patch.reviewedBy,
      reviewedAt: patch.reviewedAt,
      updatedAt: NOW(),
      updatedBy: patch.updatedBy,
    };
    this.directCosts.set(key, updated);
    return updated;
  }

  async listDirectCostsForLinkedEntity(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<DirectCost[]> {
    return [...this.directCosts.values()].filter(
      (dc) => dc.tenantId === tenantId && dc.linkedEntityType === linkedEntityType && dc.linkedEntityId === linkedEntityId,
    );
  }

  async listApprovedIncludedDirectCosts(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<DirectCost[]> {
    return [...this.directCosts.values()].filter(
      (dc) =>
        dc.tenantId === tenantId &&
        dc.linkedEntityType === linkedEntityType &&
        dc.linkedEntityId === linkedEntityId &&
        dc.reviewStatus === "approved" &&
        dc.includedInProfitability &&
        dc.amount !== null,
    );
  }

  async insertAllocation(row: NewDirectCostAllocationInput): Promise<DirectCostAllocation> {
    this.allocationCounter++;
    const id = nid("dca", this.allocationCounter);
    const allocation: DirectCostAllocation = {
      id,
      tenantId: row.tenantId,
      directCostId: row.directCostId,
      responsiblePartyType: row.responsiblePartyType,
      responsiblePartyId: row.responsiblePartyId,
      shareAmount: row.shareAmount,
      sharePercent: row.sharePercent,
      subledgerEntryId: row.subledgerEntryId ?? null,
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: NOW(),
      updatedBy: row.createdBy,
    };
    this.allocations.set(`${row.tenantId}:${id}`, allocation);
    return allocation;
  }

  async listAllocationsForDirectCost(tenantId: string, directCostId: string): Promise<DirectCostAllocation[]> {
    return [...this.allocations.values()].filter(
      (a) => a.tenantId === tenantId && a.directCostId === directCostId,
    );
  }

  async lockDirectCost(_tenantId: string, _directCostId: string): Promise<void> {
    // No-op in single-threaded in-memory store
  }
}
