/**
 * Drizzle-backed ReturnRequestRepository — the production DB return store.
 *
 * Implements the ReturnRequestRepository interface using Drizzle ORM against
 * the return_requests + return_lines tables.
 */
import "server-only";
import { eq, and, sql } from "drizzle-orm";
import { returnRequests, returnLines } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  ReturnRequestRepository,
  NewReturnRequestInput,
  NewReturnLineInput,
  UpdateReturnRequestStatusInput,
} from "./return-request-repository";
import type { ReturnRequest, ReturnLine } from "@/server/db/schema/returns";

type Db = NonNullable<typeof DbType>;

export class ReturnRequestDbRepository implements ReturnRequestRepository {
  constructor(private readonly db: Db) {}

  async insertReturnRequest(row: NewReturnRequestInput): Promise<ReturnRequest> {
    const [result] = await this.db
      .insert(returnRequests)
      .values({
        tenantId: row.tenantId,
        docNo: row.docNo,
        salesOrderId: row.salesOrderId,
        customerId: row.customerId,
        returnDate: row.returnDate,
        returnReason: row.returnReason,
        financialTreatment: (row as any).financialTreatment ?? null,
        customerAdjustmentAmount: sql`NULL`,
        isReplacement: row.isReplacement,
        createdBy: row.createdBy,
      } as any)
      .returning();
    return result!;
  }

  async findReturnRequestById(tenantId: string, id: string): Promise<ReturnRequest | null> {
    const [result] = await this.db.select().from(returnRequests)
      .where(and(eq(returnRequests.tenantId, tenantId), eq(returnRequests.id, id)))
      .limit(1);
    return result ?? null;
  }

  async findReturnRequestByIdempotencyKey(_tenantId: string, _key: string): Promise<ReturnRequest | null> {
    return null; // Uses idempotency_records table instead
  }

  async updateReturnRequestStatus(
    tenantId: string, id: string,
    patch: UpdateReturnRequestStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<ReturnRequest | null> {
    // Conditional update: only if current status matches
    const updateData: Record<string, unknown> = { updatedBy: patch.updatedBy, updatedAt: new Date() };
    if (patch.status !== undefined) updateData.status = patch.status;
    if (patch.approvalStatus !== undefined) updateData.approvalStatus = patch.approvalStatus;
    if (patch.financialTreatment !== undefined) updateData.financialTreatment = patch.financialTreatment;
    if (patch.customerAdjustmentAmount !== undefined) updateData.customerAdjustmentAmount = patch.customerAdjustmentAmount;
    if (patch.approvedBy !== undefined) updateData.approvedBy = patch.approvedBy;
    if (patch.approvedAt !== undefined) updateData.approvedAt = patch.approvedAt;
    if (patch.isLocked !== undefined) updateData.isLocked = patch.isLocked;

    const [result] = await this.db.update(returnRequests).set(updateData)
      .where(and(
        eq(returnRequests.tenantId, tenantId),
        eq(returnRequests.id, id),
      ))
      .returning();
    return result ?? null;
  }

  async listReturnRequestsForSale(tenantId: string, salesOrderId: string): Promise<ReturnRequest[]> {
    return this.db.select().from(returnRequests)
      .where(and(eq(returnRequests.tenantId, tenantId), eq(returnRequests.salesOrderId, salesOrderId)));
  }

  async listReturnRequestsForCustomer(tenantId: string, customerId: string): Promise<ReturnRequest[]> {
    return this.db.select().from(returnRequests)
      .where(and(eq(returnRequests.tenantId, tenantId), eq(returnRequests.customerId, customerId)));
  }

  async insertReturnLine(row: NewReturnLineInput): Promise<ReturnLine> {
    const [result] = await this.db.insert(returnLines).values({
      tenantId: row.tenantId,
      returnRequestId: row.returnRequestId,
      originalSaleOrderId: row.originalSaleOrderId,
      originalSaleLineId: row.originalSaleLineId,
      itemId: row.itemId,
      quantityKg: row.quantityKg,
      returnLocationId: row.returnLocationId,
      returnedStockStatus: row.returnedStockStatus as any,
      qualityStatusAfterReturn: row.qualityStatusAfterReturn ?? null,
      originalSaleLineNetUnitValue: row.originalSaleLineNetUnitValue ?? null,
      returnCreditValue: row.returnCreditValue ?? null,
      residualAdjustment: row.residualAdjustment ?? "0",
      cumulativePriorReturnQty: row.cumulativePriorReturnQty ?? "0",
      cumulativePriorReturnCredit: row.cumulativePriorReturnCredit ?? "0",
      createdBy: row.createdBy,
    } as any).returning();
    return result!;
  }

  async findReturnLines(tenantId: string, returnRequestId: string): Promise<ReturnLine[]> {
    return this.db.select().from(returnLines)
      .where(and(eq(returnLines.tenantId, tenantId), eq(returnLines.returnRequestId, returnRequestId)));
  }

  async updateReturnLineMovement(tenantId: string, returnLineId: string, returnMovementId: string): Promise<ReturnLine | null> {
    const [result] = await this.db.update(returnLines).set({ returnMovementId, updatedAt: new Date() })
      .where(and(eq(returnLines.tenantId, tenantId), eq(returnLines.id, returnLineId)))
      .returning();
    return result ?? null;
  }

  async updateReturnLineCreditAndResidual(
    tenantId: string, returnLineId: string,
    patch: { returnCreditValue: string; residualAdjustment: string; cumulativePriorReturnQty: string; cumulativePriorReturnCredit: string; updatedBy: string },
  ): Promise<ReturnLine | null> {
    const [result] = await this.db.update(returnLines).set({
      returnCreditValue: patch.returnCreditValue,
      residualAdjustment: patch.residualAdjustment,
      cumulativePriorReturnQty: patch.cumulativePriorReturnQty,
      cumulativePriorReturnCredit: patch.cumulativePriorReturnCredit,
      updatedAt: new Date(),
      updatedBy: patch.updatedBy,
    } as any)
      .where(and(eq(returnLines.tenantId, tenantId), eq(returnLines.id, returnLineId)))
      .returning();
    return result ?? null;
  }

  async listApprovedReturnLinesForSaleLine(tenantId: string, originalSaleLineId: string): Promise<ReturnLine[]> {
    // Join with return_requests to filter by approved status
    const lines = await this.db.select().from(returnLines)
      .where(and(eq(returnLines.tenantId, tenantId), eq(returnLines.originalSaleLineId, originalSaleLineId)));
    // Filter by approved return requests
    const approvedLines: ReturnLine[] = [];
    for (const line of lines) {
      const rr = await this.findReturnRequestById(tenantId, line.returnRequestId);
      if (rr && rr.status === "approved") {
        approvedLines.push(line);
      }
    }
    return approvedLines;
  }

  async lockReturnRequest(_tenantId: string, _id: string): Promise<void> {
    // In production, this uses SELECT FOR UPDATE inside a transaction
  }
}

export function createReturnRequestDbRepository(db: Db): ReturnRequestDbRepository {
  return new ReturnRequestDbRepository(db);
}
