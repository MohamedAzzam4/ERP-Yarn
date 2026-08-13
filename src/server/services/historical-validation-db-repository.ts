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
      ))
      .limit(1);
    return result ?? null;
  }

  async deleteAliasMappingsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    await this.db.delete(importAliasMappings)
      .where(and(
        eq(importAliasMappings.tenantId, tenantId),
        eq(importAliasMappings.importBatchId, importBatchId),
      ));
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
