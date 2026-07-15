/**
 * Drizzle-backed HistoricalReconciliationRepository — WP-07-03.
 * Non-operational — no stock/account/sales effects.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
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

export class HistoricalReconciliationDbRepository implements HistoricalReconciliationRepository {
  constructor(private readonly db: Db) {}

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

  async deleteReconciliationResultsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    await this.db.delete(importReconciliationResults)
      .where(and(eq(importReconciliationResults.tenantId, tenantId), eq(importReconciliationResults.importBatchId, importBatchId)));
  }

  async findLatestReportVersion(tenantId: string, importBatchId: string): Promise<number> {
    const results = await this.db.select().from(importReconciliationResults)
      .where(and(eq(importReconciliationResults.tenantId, tenantId), eq(importReconciliationResults.importBatchId, importBatchId)));
    if (results.length === 0) return 0;
    return Math.max(...results.map(r => r.reportVersion));
  }

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

  async deleteReviewItemsForBatch(tenantId: string, importBatchId: string): Promise<void> {
    await this.db.delete(importHumanReviewItems)
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

  async findStagingRowsForBatch(tenantId: string, importBatchId: string): Promise<ImportStagingRow[]> {
    return this.db.select().from(importStagingRows)
      .where(and(eq(importStagingRows.tenantId, tenantId), eq(importStagingRows.importBatchId, importBatchId)));
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [result] = await this.db.select().from(importBatches)
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, id))).limit(1);
    return result ?? null;
  }

  async updateBatchStatus(tenantId: string, batchId: string, status: string): Promise<ImportBatch | null> {
    const [result] = await this.db.update(importBatches)
      .set({ status: status as any, updatedAt: new Date() })
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, batchId))).returning();
    return result ?? null;
  }
}

export function createHistoricalReconciliationDbRepository(db: Db): HistoricalReconciliationDbRepository {
  return new HistoricalReconciliationDbRepository(db);
}
