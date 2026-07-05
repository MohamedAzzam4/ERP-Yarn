/**
 * Drizzle-backed RawReceiptDraftRepository — the production DB repository.
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-04
 *   Wire the approved worker reference to real draft persistence/query.
 *
 * Draft persistence semantics (Risk #1 documentation):
 *   - insertDraft creates ONE inventory_items row (canonical stock identity)
 *     and ONE raw_material_batches row (draft operational facts).
 *   - The inventory_items row is IDENTITY ONLY — it does NOT represent
 *     stock on hand. Stock only appears when InventoryLedgerService.postRawReceipt
 *     inserts a stock_movements row + updates inventory_balances, which
 *     requires the `inventory.receive.approve` permission (Worker does
 *     NOT have it — see role-fixtures.ts).
 *   - The raw_material_batches row is created with status='draft',
 *     approval_status='draft', is_locked=false. Price/cost columns are
 *     left NULL (DEC-067: price may be unknown at receipt time).
 *   - storage_location_id is the INTENDED to_location for the future
 *     stock movement (posted at WP-02-05 approval time). It does NOT
 *     create an inventory_balances row.
 *
 * Contract 03 §9.2 explicitly endorses this: "Price may be null; stock
 * can post while payable waits for Accountant Review."
 *
 * All methods are tenant-scoped.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { rawMaterialBatches, inventoryItems, locations, fiberTypes } from "@/server/db/schema";
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
    // Create inventory_items row first (one-to-one with raw_material_batches).
    // This is the canonical stock-tracking IDENTITY — no stock is posted.
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
        fiberTypeId: row.fiberTypeId ?? null,
        originCountry: row.originCountry ?? row.rawGradeAr ?? null,
        season: row.season,
        balesCount: row.balesCount,
        grossWeightKg: row.grossWeightKg,
        netWeightKg: row.netWeightKg,
        receivedDate: row.receivedDate,
        storageLocationId: row.storageLocationId,
        purchaseOrderRef: row.purchaseOrderRef,
        notes: row.notes,
        status: "draft",
        approvalStatus: "draft",
        isLocked: false,
        createdBy: row.createdBy,
      })
      .returning();

    return this.mapToDraft(batch!, row.fiberTypeAr ?? null, row.storageLocationName ?? null);
  }

  async updateDraft(tenantId: string, id: string, patch: UpdateDraftInput): Promise<RawReceiptDraft | null> {
    const [result] = await this.db
      .update(rawMaterialBatches)
      .set({
        supplierId: patch.supplierId,
        supplierReference: patch.supplierReference,
        fiberTypeId: patch.fiberTypeId ?? undefined,
        originCountry: patch.originCountry ?? patch.rawGradeAr ?? undefined,
        season: patch.season,
        balesCount: patch.balesCount,
        grossWeightKg: patch.grossWeightKg,
        netWeightKg: patch.netWeightKg,
        receivedDate: patch.receivedDate,
        storageLocationId: patch.storageLocationId,
        purchaseOrderRef: patch.purchaseOrderRef,
        notes: patch.notes,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.id, id)))
      .returning();

    if (!result) return null;
    return this.mapToDraft(result, patch.fiberTypeAr ?? null, patch.storageLocationName ?? null);
  }

  async findDraftById(tenantId: string, id: string): Promise<RawReceiptDraft | null> {
    // Join with locations + fiber_types to resolve names for display.
    const [result] = await this.db
      .select({
        batch: rawMaterialBatches,
        locationNameAr: locations.nameAr,
        fiberTypeNameAr: fiberTypes.nameAr,
      })
      .from(rawMaterialBatches)
      .leftJoin(locations, eq(rawMaterialBatches.storageLocationId, locations.id))
      .leftJoin(fiberTypes, eq(rawMaterialBatches.fiberTypeId, fiberTypes.id))
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.id, id)))
      .limit(1);

    if (!result) return null;
    return this.mapToDraft(
      result.batch,
      result.fiberTypeNameAr ?? null,
      result.locationNameAr ?? null,
    );
  }

  async findDraftByBatchNo(tenantId: string, batchNo: string): Promise<RawReceiptDraft | null> {
    const [result] = await this.db
      .select({
        batch: rawMaterialBatches,
        locationNameAr: locations.nameAr,
        fiberTypeNameAr: fiberTypes.nameAr,
      })
      .from(rawMaterialBatches)
      .leftJoin(locations, eq(rawMaterialBatches.storageLocationId, locations.id))
      .leftJoin(fiberTypes, eq(rawMaterialBatches.fiberTypeId, fiberTypes.id))
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.batchNo, batchNo)))
      .limit(1);

    if (!result) return null;
    return this.mapToDraft(
      result.batch,
      result.fiberTypeNameAr ?? null,
      result.locationNameAr ?? null,
    );
  }

  async listDraftsByTenant(tenantId: string, status?: RawReceiptDraftStatus): Promise<RawReceiptDraft[]> {
    const results = await this.db
      .select({
        batch: rawMaterialBatches,
        locationNameAr: locations.nameAr,
        fiberTypeNameAr: fiberTypes.nameAr,
      })
      .from(rawMaterialBatches)
      .leftJoin(locations, eq(rawMaterialBatches.storageLocationId, locations.id))
      .leftJoin(fiberTypes, eq(rawMaterialBatches.fiberTypeId, fiberTypes.id))
      .where(eq(rawMaterialBatches.tenantId, tenantId));

    const drafts = results.map((r) =>
      this.mapToDraft(r.batch, r.fiberTypeNameAr ?? null, r.locationNameAr ?? null),
    );
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
        updatedAt: new Date(),
      })
      .where(and(eq(rawMaterialBatches.tenantId, tenantId), eq(rawMaterialBatches.id, id)))
      .returning();

    if (!result) return null;
    // Status updates don't need joined names — caller already has the draft.
    return this.mapToDraft(result, null, null, subjectVersion, subjectHash);
  }

  /**
   * Map a raw_material_batches row to the RawReceiptDraft domain type.
   *
   * `fiberTypeAr` and `storageLocationName` are resolved via JOIN when
   * reading (findDraftById/findDraftByBatchNo/listDraftsByTenant), or
   * passed through from the input on insert/update (where we don't yet
   * have the joined name).
   */
  private mapToDraft(
    batch: typeof rawMaterialBatches.$inferSelect,
    fiberTypeAr: string | null,
    storageLocationName: string | null,
    subjectVersionOverride?: number,
    subjectHashOverride?: string,
  ): RawReceiptDraft {
    return {
      id: batch.id,
      tenantId: batch.tenantId,
      batchNo: batch.batchNo,
      supplierId: batch.supplierId ?? null,
      supplierReference: batch.supplierReference ?? null,
      fiberTypeId: batch.fiberTypeId ?? null,
      fiberTypeAr,
      rawGradeAr: batch.originCountry ?? null,
      originCountry: batch.originCountry ?? null,
      season: batch.season ?? null,
      balesCount: batch.balesCount ?? null,
      grossWeightKg: batch.grossWeightKg ?? null,
      netWeightKg: batch.netWeightKg,
      receivedDate: batch.receivedDate,
      storageLocationId: batch.storageLocationId ?? null,
      storageLocationName,
      purchaseOrderRef: batch.purchaseOrderRef ?? null,
      notes: batch.notes ?? null,
      status: batch.status as RawReceiptDraftStatus,
      approvalStatus: batch.approvalStatus as string,
      subjectVersion: subjectVersionOverride ?? 1,
      subjectHash: subjectHashOverride ?? null,
      itemId: batch.itemId, // canonical stock identity for WP-02-05 posting
      createdBy: batch.createdBy ?? null,
      createdAt: batch.createdAt ?? null,
      updatedBy: batch.updatedBy ?? null,
      updatedAt: batch.updatedAt ?? null,
    };
  }
}

export function createRawReceiptDraftDbRepository(db: Db): RawReceiptDraftDbRepository {
  return new RawReceiptDraftDbRepository(db);
}
