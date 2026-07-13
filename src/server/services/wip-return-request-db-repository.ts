/**
 * Drizzle-backed WipReturnRequestRepository — the production DB repository.
 *
 * WP-04-04: DB-backed implementation for production_wip_returns.
 */
import "server-only";
import { eq, and, inArray } from "drizzle-orm";
import { productionWipReturns } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  WipReturnRequestRepository,
  NewWipReturnRequestInput,
  WipReturnApprovalPatch,
} from "./wip-return-request-repository";
import type { ProductionWipReturn } from "@/server/db/schema/production-receipts";

type Db = NonNullable<typeof DbType>;

export class WipReturnRequestDbRepository implements WipReturnRequestRepository {
  constructor(private readonly db: Db) {}

  async insertRequest(row: NewWipReturnRequestInput): Promise<ProductionWipReturn> {
    const [result] = await this.db
      .insert(productionWipReturns)
      .values({
        tenantId: row.tenantId,
        docNo: row.docNo,
        productionOrderId: row.productionOrderId,
        productionInputId: row.productionInputId,
        returnQtyKg: row.returnQtyKg,
        returnLocationId: row.returnLocationId,
        status: "pending_approval",
        approvalStatus: "pending_approval",
        reason: row.reason,
        notes: row.notes,
        idempotencyKey: row.idempotencyKey,
        financialReviewStatus: "needs_accountant_review",
        subjectHash: row.subjectHash,
        subjectVersion: row.subjectVersion,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findRequestById(tenantId: string, id: string): Promise<ProductionWipReturn | null> {
    const [result] = await this.db
      .select()
      .from(productionWipReturns)
      .where(and(eq(productionWipReturns.tenantId, tenantId), eq(productionWipReturns.id, id)))
      .limit(1);
    return result ?? null;
  }

  async markApprovedConditional(
    tenantId: string,
    requestId: string,
    patch: WipReturnApprovalPatch,
    expectedCurrentStatuses: ReadonlyArray<string>,
  ): Promise<ProductionWipReturn | null> {
    const statusValues = [...expectedCurrentStatuses] as unknown as
      ("draft" | "pending_approval" | "approved" | "rejected" | "cancelled")[];
    const [result] = await this.db
      .update(productionWipReturns)
      .set({
        status: patch.status,
        approvalStatus: patch.approvalStatus,
        isLocked: patch.isLocked,
        confirmedBy: patch.confirmedBy,
        confirmedAt: patch.confirmedAt,
        returnMovementId: patch.returnMovementId,
        updatedBy: patch.confirmedBy,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productionWipReturns.tenantId, tenantId),
          eq(productionWipReturns.id, requestId),
          inArray(productionWipReturns.status, statusValues),
          eq(productionWipReturns.isLocked, false),
        ),
      )
      .returning();
    return result ?? null;
  }
}

export function createWipReturnRequestDbRepository(db: Db): WipReturnRequestDbRepository {
  return new WipReturnRequestDbRepository(db);
}
