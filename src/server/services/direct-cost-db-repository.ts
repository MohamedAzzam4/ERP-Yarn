/**
 * Drizzle-backed DirectCostRepository — the production DB persistence boundary.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §18
 *   direct_costs store type, linked entity, nullable amount, currency,
 *   responsibility, payer, profitability inclusion, review and notes.
 *   Allocations store responsible party/share/subledger entry.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §12.3
 *   direct_costs table with direct_cost_type, cost_responsibility_type,
 *   actual_payer_type, review_status enums.
 *   direct_cost_allocations table for shared-responsibility allocations.
 *
 * This repository owns the `direct_costs` and `direct_cost_allocations`
 * tables only. Account entries are persisted via SubledgerService (sole
 * owner of account_entry creation per Contract 14 §4).
 *
 * Concurrency (DEC-080 + Contract 07 §18):
 *   - lockDirectCost uses SELECT ... FOR UPDATE on the direct-cost row inside
 *     the caller's transaction. Review MUST call this BEFORE reading/modifying
 *     review state. This prevents two concurrent reviewers from both approving
 *     the same draft, and prevents a worker from editing the draft while a
 *     review is in flight.
 *
 * Tenant isolation: every query filters by tenantId. No query reads or writes
 * cross-tenant data.
 *
 * Conditional updates:
 *   updateDirectCostReview uses WHERE review_status IN (expectedCurrentStatuses)
 *   to enforce the review state-machine atomically. Returns null if the
 *   condition fails (stale state).
 */
import "server-only";
import { eq, and, inArray } from "drizzle-orm";
import {
  directCosts,
  directCostAllocations,
} from "@/server/db/schema/subledger";
import type { db as DbType } from "@/server/db/client";
import type {
  DirectCostRepository,
  NewDirectCostInput,
  UpdateDirectCostReviewInput,
  NewDirectCostAllocationInput,
} from "./direct-cost-repository";
import type { DirectCost, DirectCostAllocation } from "@/server/db/schema/subledger";

type Db = NonNullable<typeof DbType>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Drizzle-backed DirectCostRepository.
 *
 * Accepts either the root `db` instance or a `tx` from a db.transaction()
 * callback. When constructed with a `tx`, all queries run on the same
 * transaction connection, so SELECT ... FOR UPDATE is transaction-scoped.
 */
export class DirectCostDbRepository implements DirectCostRepository {
  constructor(private readonly db: DbOrTx) {}

  // -------------------------------------------------------------------------
  // direct_costs
  // -------------------------------------------------------------------------

  async insertDirectCost(row: NewDirectCostInput): Promise<DirectCost> {
    const [result] = await this.db
      .insert(directCosts)
      .values({
        tenantId: row.tenantId,
        costNo: row.costNo,
        costType: row.costType as DirectCost["costType"],
        linkedEntityType: row.linkedEntityType,
        linkedEntityId: row.linkedEntityId,
        amount: row.amount ?? null,
        currency: row.currency,
        costResponsibilityType:
          row.costResponsibilityType as DirectCost["costResponsibilityType"],
        actualPayerType: row.actualPayerType as DirectCost["actualPayerType"],
        includedInProfitability: row.includedInProfitability,
        reviewStatus: row.reviewStatus as DirectCost["reviewStatus"],
        notes: row.notes ?? null,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      })
      .returning();
    if (!result) {
      throw new Error("Failed to insert direct cost row.");
    }
    return result;
  }

  async findDirectCostById(
    tenantId: string,
    directCostId: string,
  ): Promise<DirectCost | null> {
    const [result] = await this.db
      .select()
      .from(directCosts)
      .where(
        and(
          eq(directCosts.tenantId, tenantId),
          eq(directCosts.id, directCostId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  /**
   * Find a direct cost by idempotency key.
   *
   * NOTE: direct_costs has no idempotency_key column. The idempotency
   * mapping is tracked via the idempotency_records table by the service.
   * The InMemory test repository uses a separate map. The DB repository
   * returns null — the service uses the idempotency record's responseBody
   * for replay instead.
   */
  async findDirectCostByIdempotencyKey(
    _tenantId: string,
    _idempotencyKey: string,
  ): Promise<DirectCost | null> {
    return null;
  }

  /**
   * Conditionally update direct cost review state.
   *
   * WHERE clause enforces:
   *   - tenantId match (tenant isolation)
   *   - id match
   *   - review_status IN (expectedCurrentStatuses) (state-machine guard)
   *
   * Returns the updated row, or null if no row matched the conditions.
   *
   * The review_status column is a pgEnum, so patch.reviewStatus is sent as
   * the enum string. Drizzle handles the cast.
   */
  async updateDirectCostReview(
    tenantId: string,
    directCostId: string,
    patch: UpdateDirectCostReviewInput,
    expectedCurrentStatuses: string[],
  ): Promise<DirectCost | null> {
    if (expectedCurrentStatuses.length === 0) {
      return null;
    }
    const updateSet: Record<string, unknown> = {
      reviewStatus: patch.reviewStatus as DirectCost["reviewStatus"],
      reviewedBy: patch.reviewedBy,
      reviewedAt: patch.reviewedAt,
      updatedBy: patch.updatedBy,
      updatedAt: new Date(),
    };
    if (patch.amount !== undefined) {
      updateSet.amount = patch.amount;
    }
    if (patch.costResponsibilityType !== undefined) {
      updateSet.costResponsibilityType =
        patch.costResponsibilityType as DirectCost["costResponsibilityType"];
    }
    if (patch.actualPayerType !== undefined) {
      updateSet.actualPayerType =
        patch.actualPayerType as DirectCost["actualPayerType"];
    }
    if (patch.includedInProfitability !== undefined) {
      updateSet.includedInProfitability = patch.includedInProfitability;
    }
    if (patch.notes !== undefined) {
      updateSet.notes = patch.notes;
    }
    const [result] = await this.db
      .update(directCosts)
      .set(updateSet)
      .where(
        and(
          eq(directCosts.tenantId, tenantId),
          eq(directCosts.id, directCostId),
          inArray(
            directCosts.reviewStatus,
            expectedCurrentStatuses as DirectCost["reviewStatus"][],
          ),
        ),
      )
      .returning();
    return result ?? null;
  }

  async listDirectCostsForLinkedEntity(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<DirectCost[]> {
    return this.db
      .select()
      .from(directCosts)
      .where(
        and(
          eq(directCosts.tenantId, tenantId),
          eq(directCosts.linkedEntityType, linkedEntityType),
          eq(directCosts.linkedEntityId, linkedEntityId),
        ),
      );
  }

  async listApprovedIncludedDirectCosts(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<DirectCost[]> {
    return this.db
      .select()
      .from(directCosts)
      .where(
        and(
          eq(directCosts.tenantId, tenantId),
          eq(directCosts.linkedEntityType, linkedEntityType),
          eq(directCosts.linkedEntityId, linkedEntityId),
          eq(directCosts.reviewStatus, "approved"),
          eq(directCosts.includedInProfitability, true),
        ),
      );
  }

  /**
   * Lock a direct-cost row for the duration of the transaction.
   * Uses SELECT ... FOR UPDATE. Caller MUST be inside a db.transaction().
   * Review MUST call this BEFORE reading/modifying review state — this is
   * the concurrency primitive that enforces DEC-080 self-review safety
   * (the locked row reads include `created_by`, so the reviewer can check
   * self-review under the lock) and prevents concurrent reviewers from
   * both approving the same draft.
   */
  async lockDirectCost(
    tenantId: string,
    directCostId: string,
  ): Promise<void> {
    await this.db
      .select()
      .from(directCosts)
      .where(
        and(
          eq(directCosts.tenantId, tenantId),
          eq(directCosts.id, directCostId),
        ),
      )
      .for("update")
      .limit(1);
  }

  // -------------------------------------------------------------------------
  // direct_cost_allocations
  // -------------------------------------------------------------------------

  async insertAllocation(
    row: NewDirectCostAllocationInput,
  ): Promise<DirectCostAllocation> {
    const [result] = await this.db
      .insert(directCostAllocations)
      .values({
        tenantId: row.tenantId,
        directCostId: row.directCostId,
        responsiblePartyType: row.responsiblePartyType,
        responsiblePartyId: row.responsiblePartyId,
        shareAmount: row.shareAmount,
        sharePercent: row.sharePercent,
        subledgerEntryId: row.subledgerEntryId ?? null,
        createdBy: row.createdBy,
        updatedBy: row.createdBy,
      })
      .returning();
    if (!result) {
      throw new Error("Failed to insert direct cost allocation row.");
    }
    return result;
  }

  async listAllocationsForDirectCost(
    tenantId: string,
    directCostId: string,
  ): Promise<DirectCostAllocation[]> {
    return this.db
      .select()
      .from(directCostAllocations)
      .where(
        and(
          eq(directCostAllocations.tenantId, tenantId),
          eq(directCostAllocations.directCostId, directCostId),
        ),
      );
  }

  // NOTE: recordIdempotencyKey is intentionally NOT implemented.
  // The InMemory test repository uses it as a test-only helper. The DB
  // repository relies on the idempotency_records table (managed by the
  // service layer via IdempotencyDbRepository) for replay semantics.
  // The interface marks this method optional with `?`.
}

/**
 * Factory: create a DirectCostDbRepository bound to the root db or a tx.
 * Used by server actions and by tx-scoped factory closures.
 */
export function createDirectCostDbRepository(
  db: DbOrTx,
): DirectCostDbRepository {
  return new DirectCostDbRepository(db);
}
