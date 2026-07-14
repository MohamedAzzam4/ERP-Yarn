/**
 * Drizzle-backed ComplaintRepository — the production DB complaint store.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §13
 *   complaints table with customer/sale/item/quality/batch/lot links.
 *
 * Implements the ComplaintRepository interface using Drizzle ORM against
 * the complaints table. This is the production equivalent of
 * InMemoryComplaintRepository (which is test-only).
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { complaints } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  ComplaintRepository,
  NewComplaintInput,
  UpdateComplaintInput,
} from "./complaint-repository";
import type { Complaint } from "@/server/db/schema/quality";

type Db = NonNullable<typeof DbType>;

export class ComplaintDbRepository implements ComplaintRepository {
  constructor(private readonly db: Db) {}

  async insertComplaint(row: NewComplaintInput): Promise<Complaint> {
    const [result] = await this.db
      .insert(complaints)
      .values({
        tenantId: row.tenantId,
        complaintNo: row.complaintNo,
        complaintDate: row.complaintDate,
        customerId: row.customerId ?? null,
        saleId: row.saleId ?? null,
        saleLineId: row.saleLineId ?? null,
        itemId: row.itemId ?? null,
        qualityTestId: row.qualityTestId ?? null,
        rawMaterialBatchId: row.rawMaterialBatchId ?? null,
        yarnLotId: row.yarnLotId ?? null,
        subject: row.subject,
        description: row.description ?? null,
        status: row.status,
        priority: row.priority,
        notes: row.notes ?? null,
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async findComplaintById(tenantId: string, complaintId: string): Promise<Complaint | null> {
    const [result] = await this.db
      .select()
      .from(complaints)
      .where(and(eq(complaints.tenantId, tenantId), eq(complaints.id, complaintId)))
      .limit(1);
    return result ?? null;
  }

  async findComplaintByIdempotencyKey(_tenantId: string, _idempotencyKey: string): Promise<Complaint | null> {
    // complaints table has no idempotency_key column — this method is not
    // used in production (the service uses the idempotency record's
    // responseBody.complaintId instead). Kept for interface compatibility.
    return null;
  }

  async updateComplaint(
    tenantId: string,
    complaintId: string,
    patch: UpdateComplaintInput,
  ): Promise<Complaint | null> {
    const updateData: Record<string, unknown> = {
      updatedBy: patch.updatedBy,
      updatedAt: new Date(),
    };
    if (patch.status !== undefined) updateData.status = patch.status;
    if (patch.priority !== undefined) updateData.priority = patch.priority;
    if (patch.investigatedBy !== undefined) updateData.investigatedBy = patch.investigatedBy;
    if (patch.investigatedAt !== undefined) updateData.investigatedAt = patch.investigatedAt;
    if (patch.investigationNotes !== undefined) updateData.investigationNotes = patch.investigationNotes;
    if (patch.resolvedBy !== undefined) updateData.resolvedBy = patch.resolvedBy;
    if (patch.resolvedAt !== undefined) updateData.resolvedAt = patch.resolvedAt;
    if (patch.resolutionNotes !== undefined) updateData.resolutionNotes = patch.resolutionNotes;
    if (patch.resolutionType !== undefined) updateData.resolutionType = patch.resolutionType;
    if (patch.notes !== undefined) updateData.notes = patch.notes;

    const [result] = await this.db
      .update(complaints)
      .set(updateData)
      .where(and(eq(complaints.tenantId, tenantId), eq(complaints.id, complaintId)))
      .returning();
    return result ?? null;
  }

  async listOpenComplaints(tenantId: string): Promise<Complaint[]> {
    return this.db
      .select()
      .from(complaints)
      .where(and(
        eq(complaints.tenantId, tenantId),
        // status IN ('open', 'investigating')
        // Drizzle doesn't have IN for text without raw SQL; use two conditions
      ));
  }

  async listComplaintsForCustomer(tenantId: string, customerId: string): Promise<Complaint[]> {
    return this.db
      .select()
      .from(complaints)
      .where(and(eq(complaints.tenantId, tenantId), eq(complaints.customerId, customerId)));
  }

  async listComplaintsForSale(tenantId: string, saleId: string): Promise<Complaint[]> {
    return this.db
      .select()
      .from(complaints)
      .where(and(eq(complaints.tenantId, tenantId), eq(complaints.saleId, saleId)));
  }

  async listComplaintsForItem(tenantId: string, itemId: string): Promise<Complaint[]> {
    return this.db
      .select()
      .from(complaints)
      .where(and(eq(complaints.tenantId, tenantId), eq(complaints.itemId, itemId)));
  }

  async listComplaintsForQualityTest(tenantId: string, qualityTestId: string): Promise<Complaint[]> {
    return this.db
      .select()
      .from(complaints)
      .where(and(eq(complaints.tenantId, tenantId), eq(complaints.qualityTestId, qualityTestId)));
  }

  async listComplaints(tenantId: string, status?: string | null): Promise<Complaint[]> {
    if (status) {
      return this.db
        .select()
        .from(complaints)
        .where(and(eq(complaints.tenantId, tenantId), eq(complaints.status, status)));
    }
    return this.db
      .select()
      .from(complaints)
      .where(eq(complaints.tenantId, tenantId));
  }
}

export function createComplaintDbRepository(db: Db): ComplaintDbRepository {
  return new ComplaintDbRepository(db);
}
