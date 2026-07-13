/**
 * WIP Return Request Repository — WP-04-04.
 *
 * Repository interface for production_wip_returns.
 * WP-04-04 scope: create return requests, find, conditionally mark approved.
 */
import "server-only";

import type { ProductionWipReturn } from "@/server/db/schema/production-receipts";

export interface NewWipReturnRequestInput {
  tenantId: string;
  docNo: string;
  productionOrderId: string;
  productionInputId: string;
  returnQtyKg: string;
  returnLocationId: string;
  reason: string;
  notes: string | null;
  idempotencyKey: string;
  createdBy: string;
  subjectHash: string;
  subjectVersion: number;
}

/**
 * Patch applied to production_wip_returns when the return is approved.
 * All fields are server-computed; the orchestrator populates them.
 */
export interface WipReturnApprovalPatch {
  status: "approved";
  approvalStatus: "approved";
  isLocked: true;
  confirmedBy: string;
  confirmedAt: Date;
  returnMovementId: string;
}

export interface WipReturnRequestRepository {
  /** Insert a new return request row (status=pending_approval, zero effect). */
  insertRequest(row: NewWipReturnRequestInput): Promise<ProductionWipReturn>;

  /** Find a return request by ID (tenant-scoped). */
  findRequestById(tenantId: string, id: string): Promise<ProductionWipReturn | null>;

  /**
   * Conditionally mark a return request as approved/locked.
   *
   * Contract 06 §6 step 8: "recheck all business preconditions under lock."
   * The conditional WHERE clause ensures the request is still in an
   * approvable state (`status = 'pending_approval'` AND `is_locked = false`).
   * If a concurrent approval already locked it, returns null → STATE_CONFLICT.
   */
  markApprovedConditional(
    tenantId: string,
    requestId: string,
    patch: WipReturnApprovalPatch,
    expectedCurrentStatuses: ReadonlyArray<string>,
  ): Promise<ProductionWipReturn | null>;
}
