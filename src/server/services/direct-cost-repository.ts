/**
 * Direct Cost Repository — WP-05-05.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §18
 *   direct_costs store type, linked entity, nullable amount, currency,
 *   responsibility, payer, profitability inclusion, review and notes.
 *   Allocations store responsible party/share/subledger entry.
 *
 * This is the persistence boundary for direct_costs + direct_cost_allocations.
 * Account entries themselves go through SubledgerService (sole owner per
 * Contract 14 §4).
 */
import "server-only";

import type { DirectCost, DirectCostAllocation } from "@/server/db/schema/subledger";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewDirectCostInput {
  tenantId: string;
  costNo: string;
  costType: string;
  linkedEntityType: string;
  linkedEntityId: string;
  amount: string | null;
  currency: string;
  costResponsibilityType: string;
  actualPayerType: string;
  includedInProfitability: boolean;
  reviewStatus: string;
  notes?: string | null;
  createdBy: string;
}

export interface UpdateDirectCostReviewInput {
  amount?: string | null;
  costResponsibilityType?: string;
  actualPayerType?: string;
  includedInProfitability?: boolean;
  reviewStatus: string;
  reviewedBy: string;
  reviewedAt: Date;
  notes?: string | null;
  updatedBy: string;
}

export interface NewDirectCostAllocationInput {
  tenantId: string;
  directCostId: string;
  responsiblePartyType: string;
  responsiblePartyId: string;
  shareAmount: string;
  sharePercent: string | null;
  subledgerEntryId?: string | null;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface DirectCostRepository {
  insertDirectCost(row: NewDirectCostInput): Promise<DirectCost>;
  findDirectCostById(tenantId: string, directCostId: string): Promise<DirectCost | null>;
  findDirectCostByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<DirectCost | null>;
  updateDirectCostReview(
    tenantId: string,
    directCostId: string,
    patch: UpdateDirectCostReviewInput,
    expectedCurrentStatuses: string[],
  ): Promise<DirectCost | null>;
  listDirectCostsForLinkedEntity(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<DirectCost[]>;
  listApprovedIncludedDirectCosts(
    tenantId: string,
    linkedEntityType: string,
    linkedEntityId: string,
  ): Promise<DirectCost[]>;
  insertAllocation(row: NewDirectCostAllocationInput): Promise<DirectCostAllocation>;
  listAllocationsForDirectCost(tenantId: string, directCostId: string): Promise<DirectCostAllocation[]>;
  lockDirectCost(tenantId: string, directCostId: string): Promise<void>;
  /**
   * Test helper: associate idempotency key with a direct cost ID.
   * Optional — in-memory repos implement this; DB repos use the idempotency_records table.
   */
  recordIdempotencyKey?(tenantId: string, idempotencyKey: string, directCostId: string): void;
}

export type { DirectCost, DirectCostAllocation } from "@/server/db/schema/subledger";
