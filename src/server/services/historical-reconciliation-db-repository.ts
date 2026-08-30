/**
 * Drizzle-backed HistoricalReconciliationRepository — WP-07-03.
 * Non-operational — no stock/account/sales effects.
 */
import "server-only";
import { and, eq, sql as drizzleSql } from "drizzle-orm";
import {
  importReconciliationResults,
  importHumanReviewItems,
  importStagingRows,
  importBatches,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  HistoricalReconciliationRepository,
  NewReconciliationResultInput,
  NewReconciliationReviewItemInput,
} from "./historical-reconciliation-repository";
import type {
  ImportReconciliationResult,
  ImportHumanReviewItem,
  ImportStagingRow,
  ImportBatch,
} from "@/server/db/schema/migration";

type Db = NonNullable<typeof DbType>;
/**
 * WP-08-01F R1 — The repository accepts either the root Db or a Drizzle
 * transaction. This lets the reconciliation service run all reads/writes
 * inside ONE PostgreSQL transaction with tx-scoped idempotency/audit.
 */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class HistoricalReconciliationDbRepository implements HistoricalReconciliationRepository {
  constructor(private readonly db: DbOrTx) {}

  async insertReconciliationResult(row: NewReconciliationResultInput): Promise<ImportReconciliationResult> {
    const [result] = await this.db.insert(importReconciliationResults).values({
      tenantId: row.tenantId,
      importBatchId: row.importBatchId,
      reportVersion: row.reportVersion,
      metricKey: row.metricKey,
      expectedValue: row.expectedValue,
      stagedValue: row.stagedValue,
      committedValue: row.committedValue,
      differenceValue: row.differenceValue,
      status: row.status as any,
      notes: row.notes,
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findReconciliationResultsForBatch(tenantId: string, importBatchId: string): Promise<ImportReconciliationResult[]> {
    return this.db.select().from(importReconciliationResults)
      .where(and(eq(importReconciliationResults.tenantId, tenantId), eq(importReconciliationResults.importBatchId, importBatchId)));
  }

  async findReconciliationResultsForBatchVersion(tenantId: string, importBatchId: string, reportVersion: number): Promise<ImportReconciliationResult[]> {
    return this.db.select().from(importReconciliationResults)
      .where(and(
        eq(importReconciliationResults.tenantId, tenantId),
        eq(importReconciliationResults.importBatchId, importBatchId),
        eq(importReconciliationResults.reportVersion, reportVersion),
      ));
  }

  async findLatestReportVersion(tenantId: string, importBatchId: string): Promise<number> {
    const results = await this.db.select().from(importReconciliationResults)
      .where(and(eq(importReconciliationResults.tenantId, tenantId), eq(importReconciliationResults.importBatchId, importBatchId)));
    if (results.length === 0) return 0;
    return Math.max(...results.map(r => r.reportVersion));
  }

  // WP-08-01F Milestone C Task 4: markVersionAsSuperseded has been REMOVED.
  // Old reconciliation-result rows are NEVER mutated. The report_version
  // column itself is the supersession mechanism.

  async insertReviewItem(row: NewReconciliationReviewItemInput): Promise<ImportHumanReviewItem> {
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

  async findReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return this.db.select().from(importHumanReviewItems)
      .where(and(eq(importHumanReviewItems.tenantId, tenantId), eq(importHumanReviewItems.importBatchId, importBatchId)));
  }

  async findReviewItemsForBatchVersion(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    // Review items don't have a report_version column in the schema.
    // They are associated with the batch, not the version. All review items
    // for the batch are returned — this is intentional: old review items
    // from previous versions remain for audit trail (same as recon results).
    return this.db.select().from(importHumanReviewItems)
      .where(and(eq(importHumanReviewItems.tenantId, tenantId), eq(importHumanReviewItems.importBatchId, importBatchId)));
  }

  async findReviewItemById(tenantId: string, id: string): Promise<ImportHumanReviewItem | null> {
    const [result] = await this.db.select().from(importHumanReviewItems)
      .where(and(eq(importHumanReviewItems.tenantId, tenantId), eq(importHumanReviewItems.id, id))).limit(1);
    return result ?? null;
  }

  async updateReviewItemDecision(tenantId: string, id: string, patch: {
    status: string; decision: string | null; decisionNotes: string | null; decidedBy: string;
  }): Promise<ImportHumanReviewItem | null> {
    const [result] = await this.db.update(importHumanReviewItems)
      .set({
        status: patch.status as any,
        decision: patch.decision as any,
        decisionNotes: patch.decisionNotes,
        decidedBy: patch.decidedBy,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(importHumanReviewItems.tenantId, tenantId), eq(importHumanReviewItems.id, id)))
      .returning();
    return result ?? null;
  }

  async invalidatePendingReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<number> {
    // WP-08-01F DEFECT 2: This method is kept for backward compatibility but
    // now delegates to supersedeReviewItemsForBatch. Pending items are
    // superseded (is_current=false), not deleted.
    return this.supersedeReviewItemsForBatch(tenantId, importBatchId, "system", "rework invalidation");
  }

  async supersedeReviewItemsForBatch(
    tenantId: string,
    importBatchId: string,
    supersededBy: string,
    supersededReason: string,
  ): Promise<number> {
    const result = await this.db.update(importHumanReviewItems)
      .set({
        isCurrent: false,
        supersededAt: new Date(),
        supersededBy,
        supersededReason,
        updatedAt: new Date(),
      })
      .where(and(
        eq(importHumanReviewItems.tenantId, tenantId),
        eq(importHumanReviewItems.importBatchId, importBatchId),
        eq(importHumanReviewItems.isCurrent, true),
      ));
    return (result as any)?.length ?? (result as any)?.rowCount ?? 0;
  }

  async findCurrentReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<ImportHumanReviewItem[]> {
    return this.db.select().from(importHumanReviewItems)
      .where(and(
        eq(importHumanReviewItems.tenantId, tenantId),
        eq(importHumanReviewItems.importBatchId, importBatchId),
        eq(importHumanReviewItems.isCurrent, true),
      ));
  }

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.db.select().from(importStagingRows)
      .where(and(eq(importStagingRows.tenantId, tenantId), eq(importStagingRows.importBatchId, importBatchId)));
  }

  /**
   * WP-08-01F R1 — Find ONLY current (non-superseded) staging rows for a
   * batch. Filters `is_current = true`. Used by runReconciliation's metric
   * computation and submitForApproval's alias-group derivation — both bind
   * to the CURRENT staging snapshot. Superseded staging rows remain as
   * immutable historical evidence and do NOT contribute to the snapshot.
   */
  async findCurrentStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.db.select().from(importStagingRows)
      .where(and(
        eq(importStagingRows.tenantId, tenantId),
        eq(importStagingRows.importBatchId, importBatchId),
        eq(importStagingRows.isCurrent, true),
      ));
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [result] = await this.db.select().from(importBatches)
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, id))).limit(1);
    return result ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    // WP-08-01F R3/R5 QA FIX: Use raw SQL without RETURNING for Supabase pooler.
    await this.db.execute(drizzleSql`
      UPDATE import_batches
      SET status = ${status}::import_batch_status, updated_at = NOW()
      WHERE tenant_id = ${tenantId} AND id = ${batchId}
    `);
    const verifyResult = await this.db.execute(drizzleSql`
      SELECT 1 FROM import_batches
      WHERE tenant_id = ${tenantId} AND id = ${batchId} AND status = ${status}::import_batch_status
    `);
    return (verifyResult as unknown as unknown[]).length > 0
      ? ({ id: batchId, status } as unknown as ImportBatch)
      : null;
  }

  async resetBatchValidationAndReconciliationStatuses(
    tenantId: string,
    batchId: string,
  ): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({
        validationStatus: null,
        reconciliationStatus: null,
        updatedAt: new Date(),
      })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }

  async updateBatchReconciliationStatus(
    tenantId: string,
    batchId: string,
    reconciliationStatus: string,
    updatedBy: string,
  ): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ reconciliationStatus, updatedBy, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId)))
      .returning();
    return result ?? null;
  }
}

export function createHistoricalReconciliationDbRepository(db: Db): HistoricalReconciliationDbRepository {
  return new HistoricalReconciliationDbRepository(db);
}
