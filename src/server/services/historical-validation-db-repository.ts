/**
 * Drizzle-backed HistoricalValidationRepository — WP-07-02.
 *
 * Production DB repository for import_validation_errors, import_alias_mappings,
 * import_human_review_items, and staging row/batch reads.
 *
 * Contract 08 §8.1: Non-operational — no stock/account/sales effects.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  importValidationErrors,
  importAliasMappings,
  importHumanReviewItems,
  importStagingRows,
  importBatches,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  HistoricalValidationRepository,
  NewValidationErrorInput,
  NewAliasMappingInput,
  NewHumanReviewItemInput,
} from "./historical-validation-repository";
import type {
  ImportValidationError,
  ImportAliasMapping,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";

type Db = NonNullable<typeof DbType>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class HistoricalValidationDbRepository implements HistoricalValidationRepository {
  constructor(private readonly db: DbOrTx) {}

  // --- Validation error methods ---

  async insertValidationError(row: NewValidationErrorInput): Promise<ImportValidationError> {
    const [result] = await this.db.insert(importValidationErrors).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      stagingRowId: row.stagingRowId,
      severity: row.severity as any,
      errorCode: row.errorCode,
      message: row.message,
      fieldName: row.fieldName,
      isBlocking: row.isBlocking,
      resolutionStatus: "open",
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findValidationErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    return this.db.select().from(importValidationErrors)
      .where(and(
        eq(importValidationErrors.tenantId, tenantId),
        eq(importValidationErrors.importBatchId, importBatchId),
      ));
  }

  async findBlockingErrorsForBatch(tenantId: string, importBatchId: string): Promise<ImportValidationError[]> {
    return this.db.select().from(importValidationErrors)
      .where(and(
        eq(importValidationErrors.tenantId, tenantId),
        eq(importValidationErrors.importBatchId, importBatchId),
        eq(importValidationErrors.isBlocking, true),
      ));
  }

  async deleteValidationErrorsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    // WP-08-01F R6 FIX: Only delete CURRENT findings.
    // Old non-current findings (from superseded file versions) are preserved
    // as historical evidence per Contract 08 §7.1.
    await this.db.delete(importValidationErrors)
      .where(and(
        eq(importValidationErrors.tenantId, tenantId),
        eq(importValidationErrors.importBatchId, importBatchId),
        eq(importValidationErrors.isCurrent, true),
      ));
  }

  // --- Alias mapping methods ---

  async insertAliasMapping(row: NewAliasMappingInput): Promise<ImportAliasMapping> {
    const [result] = await this.db.insert(importAliasMappings).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      entityType: row.entityType,
      sourceLabel: row.sourceLabel,
      normalizedName: row.normalizedName,
      targetMasterId: row.targetMasterId,
      mappingVersion: row.mappingVersion,
      confidenceScore: row.confidenceScore,
      status: row.status as any,
      notes: row.notes,
      createdBy: row.createdBy,
      // WP-08-01F (A1/A2) — group identity / occurrence metadata.
      groupId: row.groupId ?? null,
      occurrenceCount: row.occurrenceCount ?? 1,
      exceptionSourceRowIds: row.exceptionSourceRowIds ?? null,
    }).returning();
    return result!;
  }

  async findAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
      ));
  }

  async findAliasMappingBySourceLabel(tenantId: string, importBatchId: string, entityType: string, sourceLabel: string): Promise<ImportAliasMapping | null> {
    const [result] = await this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        eq(importAliasMappings.entityType, entityType),
        eq(importAliasMappings.sourceLabel, sourceLabel),
        // WP-08-01F (A1): Only consider the CURRENT mapping. Superseded
        // rows are preserved as audit history but are not active.
        eq(importAliasMappings.isCurrent, true),
      ))
      .limit(1);
    return result ?? null;
  }

  async deleteAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    // WP-08-01F (A2): NEVER hard-delete alias mappings. The validation
    // service is responsible for superseding (mark is_current=false) any
    // existing CURRENT mappings before creating new ones — but it does
    // NOT call this method on already-approved mappings, so approved
    // mappings are preserved here too. This method is retained for the
    // non-alias paths (validation errors, review items) that legitimately
    // hard-delete on re-validation. For alias mappings the service calls
    // supersedeAliasMappingsForBatch instead.
    //
    // For backwards compatibility with any caller that still hits this
    // method (e.g. an in-memory test), we hard-delete only the
    // non-current rows — current rows are protected. The service is the
    // authority on which rows to supersede.
    await this.db.delete(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        // Only delete non-current rows (already superseded) — current
        // rows are protected. This preserves approved mappings.
        eq(importAliasMappings.isCurrent, false),
      ));
  }

  // WP-08-01F (A3) — Approve (or reject) a single alias mapping in place.
  async updateAliasMappingStatus(
    tenantId: string,
    aliasMappingId: string,
    update: {
      status: string;
      targetMasterId: string | null;
      approvedBy: string;
      approvedAt: Date;
      mappingVersion: string | null;
      notes: string | null;
    },
  ): Promise<ImportAliasMapping | null> {
    const [result] = await this.db.update(importAliasMappings)
      .set({
        status: update.status as any,
        targetMasterId: update.targetMasterId,
        approvedBy: update.approvedBy,
        approvedAt: update.approvedAt,
        mappingVersion: update.mappingVersion,
        notes: update.notes,
        updatedBy: update.approvedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.id, aliasMappingId),
      ))
      .returning();
    return result ?? null;
  }

  // WP-08-01F (A3) — Find a single alias mapping by primary key.
  async findAliasMappingById(tenantId: string, aliasMappingId: string): Promise<ImportAliasMapping | null> {
    const [result] = await this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.id, aliasMappingId),
      ))
      .limit(1);
    return result ?? null;
  }

  // WP-08-01F (A3) — Find only CURRENT alias mappings for a batch.
  async findCurrentAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<ImportAliasMapping[]> {
    return this.db.select().from(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        eq(importAliasMappings.isCurrent, true),
      ));
  }

  // WP-08-01F (A3/A5) — Supersede a single alias mapping by id.
  async supersedeAliasMapping(
    tenantId: string,
    aliasMappingId: string,
    supersededBy: string,
    supersededReason: string,
  ): Promise<ImportAliasMapping | null> {
    const [result] = await this.db.update(importAliasMappings)
      .set({
        isCurrent: false,
        supersededAt: new Date(),
        supersededBy,
        supersededReason,
        updatedBy: supersededBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.id, aliasMappingId),
        // Only supersede the current row — already-superseded rows are
        // immutable audit history.
        eq(importAliasMappings.isCurrent, true),
      ))
      .returning();
    return result ?? null;
  }

  // WP-08-01F DEFECT 2 — Update occurrenceCount on the CURRENT alias mapping
  // for a (tenant, batch, entityType, sourceLabel) key. Persists the final
  // occurrence count computed by the group tracker after iterating all
  // staging rows. Only touches occurrence_count — never status, target,
  // approval metadata. Idempotent: overwrites with the recomputed value.
  async updateAliasMappingOccurrenceCount(
    tenantId: string,
    importBatchId: string,
    entityType: string,
    sourceLabel: string,
    occurrenceCount: number,
  ): Promise<ImportAliasMapping | null> {
    const [result] = await this.db.update(importAliasMappings)
      .set({
        occurrenceCount,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
        eq(importAliasMappings.entityType, entityType),
        eq(importAliasMappings.sourceLabel, sourceLabel),
        // Only update the CURRENT mapping — superseded rows are immutable
        // audit history.
        eq(importAliasMappings.isCurrent, true),
      ))
      .returning();
    return result ?? null;
  }

  // --- Human review item methods ---

  async insertHumanReviewItem(row: NewHumanReviewItemInput): Promise<ImportHumanReviewItem> {
    const [result] = await this.db.insert(importHumanReviewItems).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      stagingRowId: row.stagingRowId,
      reviewReason: row.reviewReason,
      status: "pending" as any,
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findHumanReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return this.db.select().from(importHumanReviewItems)
      .where(and(
        eq(importHumanReviewItems.tenantId, tenantId),
        eq(importHumanReviewItems.importBatchId, importBatchId),
      ));
  }

  async deleteHumanReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    await this.db.delete(importHumanReviewItems)
      .where(and(
        eq(importHumanReviewItems.tenantId, tenantId),
        eq(importHumanReviewItems.importBatchId, importBatchId),
      ));
  }

  // --- Staging row access (read-only) ---

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    // WP-08-01F R6 FIX: Only validate CURRENT staging rows.
    // Old non-current rows (from superseded file versions) must NOT be validated.
    return this.db.select().from(importStagingRows)
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.importBatchId, importBatchId),
        eq(importStagingRows.isCurrent, true),
      ));
  }

  // --- Batch access ---

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [result] = await this.db.select().from(importBatches)
      .where(and(
        eq(importBatches.tenantId, tenantId),
        eq(importBatches.id, id),
      ))
      .limit(1);
    return result ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    // WP-08-01F R3/R5 QA FIX: Use raw SQL with explicit enum cast.
    // Don't use RETURNING — Drizzle's execute() with postgres-js in
    // prepare:false mode doesn't reliably return rows from UPDATE...RETURNING.
    // Instead, execute the UPDATE and verify with a separate SELECT.
    await this.db.execute(sql`
      UPDATE import_batches
      SET status = ${status}::import_batch_status, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND id = ${batchId}
    `);
    // Verify the update matched
    const verifyResult = await this.db.execute(sql`
      SELECT 1 FROM import_batches
      WHERE tenant_id = ${tenantId} AND id = ${batchId} AND status = ${status}::import_batch_status
    `);
    return (verifyResult as unknown as unknown[]).length > 0
      ? ({ id: batchId, status } as unknown as ImportBatch)
      : null;
  }

  // WP-08-01F DEFECT 1A: lifecycle transition support

  async updateBatchValidationStatus(tenantId: string, batchId: string, validationStatus: string, updatedBy: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ validationStatus, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }

  async updateBatchErrorCounts(tenantId: string, batchId: string, blockingErrorCount: number, warningCount: number, updatedBy: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ blockingErrorCount, warningCount, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }
}

export function createHistoricalValidationDbRepository(db: Db): HistoricalValidationDbRepository {
  return new HistoricalValidationDbRepository(db);
}
