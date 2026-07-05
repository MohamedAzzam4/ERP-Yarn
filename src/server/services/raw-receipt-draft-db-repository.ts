/**
 * Drizzle-backed RawReceiptDraftRepository — the production DB repository.
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-04
 *   Wire the approved worker reference to real draft persistence/query.
 *
 * This module implements the RawReceiptDraftRepository interface using
 * Drizzle ORM against raw_material_batches + inventory_items tables.
 * All methods are tenant-scoped.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { rawMaterialBatches, inventoryItems } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  RawReceiptDraftRepository,
  NewDraftInput,
  UpdateDraftInput,
  RawReceiptDraft,
  RawReceiptDraftStatus,
} from "./raw-receipt-draft-service";

type Db = NonNullable<typeof DbType>;

export class RawReceiptDraftDbRepository implements RawReceiptDraftRepository {
  constructor(private readonly db: Db) {}

  async insertDraft(row: NewDraftInput): Promise<RawReceiptDraft> {
    // Create inventory_items row first (one-to-one with raw_material_batches)
    const [item] = await this.db
      .insert(inventoryItems)
      .values({
        tenantId: row.tenantId,
        itemKind: "raw_material",
        itemCode: row.batchNo,
        displayNameAr: row.fiberTypeAr ?? row.batchNo,
        qualityStatus: "accepted",
        status: "active",
        createdBy: row.createdBy,
      })
      .returning();

    const [batch] = await this.db
      .insert(rawMaterialBatches)
      .values({
        tenantId: row.tenantId,
        itemId: item!.id,
        batchNo: row.batchNo,
        supplierId: row.supplierId,
        supplierReference: row.supplierReference,
        originCountry: row.originCountry,
        season: row.season,
        balesCount: row.balesCount,
        grossWeightKg: row.grossWeightKg,
        netWeightKg: row.netWeightKg,
        receivedDate: row.receivedDate,
        status: "draft",
        approvalStatus: "draft",
        createdBy: row.createdBy,
      })
      .returning();

    return this.mapToDraft(batch!, row.storageLocationId, row.storageLocationName, row.fiberTypeAr, row.rawGradeAr, row.purchaseOrderRef, row.notes);
  }

  async updateDraft(tenantId: string, id: string, patch: UpdateDraftInput): Promise<RawReceiptDraft | null> {
    const [result] = await this.db
      .update(rawMaterialBatches)
      .set({
        supplierId: patch.supplierId,
        supplierReference: patch.supplierReference,
        originCountry: patch.originCountry,
        season: patch.season,
        balesCount: patch.balesCount,
        grossWeightKg: patch.grossWeightKg,
        netWeightKg: patch.netWeightKg,
        receivedDate: patch.receivedDate,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.id, id)))
      .returning();

    if (!result) return null;
    return this.mapToDraft(result, patch.storageLocationId ?? null, patch.storageLocationName ?? null, patch.fiberTypeAr ?? null, patch.rawGradeAr ?? null, patch.purchaseOrderRef ?? null, patch.notes ?? null);
  }

  async findDraftById(tenantId: string, id: string): Promise<RawReceiptDraft | null> {
    const [result] = await this.db
      .select()
      .from(rawMaterialBatches)
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.id, id)))
      .limit(1);
    return result ? this.mapToDraft(result, null, null, null, null, null, null) : null;
  }

  async findDraftByBatchNo(tenantId: string, batchNo: string): Promise<RawReceiptDraft | null> {
    const [result] = await this.db
      .select()
      .from(rawMaterialBatches)
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.batchNo, batchNo)))
      .limit(1);
    return result ? this.mapToDraft(result, null, null, null, null, null, null) : null;
  }

  async listDraftsByTenant(tenantId: string, status?: RawReceiptDraftStatus): Promise<RawReceiptDraft[]> {
    const conditions = [eq(rawMaterialBatches.tenantId, tenantId)];
    // Note: status filter would need to be applied at the app layer since
    // raw_material_batches.status is free text, not an enum.
    const results = await this.db
      .select()
      .from(rawMaterialBatches)
      .where(and(...conditions));

    const drafts = results.map((r) => this.mapToDraft(r, null, null, null, null, null, null));
    return status ? drafts.filter((d) => d.status === status) : drafts;
  }

  async updateDraftStatus(
    tenantId: string,
    id: string,
    status: RawReceiptDraftStatus,
    approvalStatus: string,
    subjectVersion: number,
    subjectHash: string,
  ): Promise<RawReceiptDraft | null> {
    const [result] = await this.db
      .update(rawMaterialBatches)
      .set({
        status,
        approvalStatus: approvalStatus as never,
        isLocked: status === "submitted",
        updatedBy: null,
        updatedAt: new Date(),
      })
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.id, id)))
      .returning();

    if (!result) return null;
    return this.mapToDraft(result, null, null, null, null, null, null, subjectVersion, subjectHash);
  }

  private mapToDraft(
    batch: Record<string, unknown>,
    storageLocationId: string | null,
    storageLocationName: string | null,
    fiberTypeAr: string | null,
    rawGradeAr: string | null,
    purchaseOrderRef: string | null,
    notes: string | null,
    subjectVersionOverride?: number,
    subjectHashOverride?: string,
  ): RawReceiptDraft {
    return {
      id: batch.id as string,
      tenantId: batch.tenantId as string,
      batchNo: batch.batchNo as string,
      supplierId: (batch.supplierId as string) ?? null,
      supplierReference: (batch.supplierReference as string) ?? null,
      fiberTypeAr,
      rawGradeAr,
      originCountry: (batch.originCountry as string) ?? null,
      season: (batch.season as string) ?? null,
      balesCount: (batch.balesCount as string) ?? null,
      grossWeightKg: (batch.grossWeightKg as string) ?? null,
      netWeightKg: batch.netWeightKg as string,
      receivedDate: batch.receivedDate as string,
      storageLocationId,
      storageLocationName,
      purchaseOrderRef,
      notes,
      status: (batch.status as string) as RawReceiptDraftStatus,
      approvalStatus: batch.approvalStatus as string,
      subjectVersion: subjectVersionOverride ?? 1,
      subjectHash: subjectHashOverride ?? null,
      createdBy: (batch.createdBy as string) ?? null,
      createdAt: (batch.createdAt as Date) ?? null,
      updatedBy: (batch.updatedBy as string) ?? null,
      updatedAt: (batch.updatedAt as Date) ?? null,
    };
  }
}

export function createRawReceiptDraftDbRepository(db: Db): RawReceiptDraftDbRepository {
  return new RawReceiptDraftDbRepository(db);
}
