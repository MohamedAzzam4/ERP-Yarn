/**
 * Drizzle-backed HistoricalCorrectionRepository — WP-07-05.
 *
 * Production path: uses persistent DB via Drizzle ORM.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md §8.11
 * DEC-070: Post-commit historical correction requires renewed dual approval.
 */
import "server-only";
import { and, eq } from "drizzle-orm";
import {
  historicalCorrectionRequests,
  importBatches,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  HistoricalCorrectionRepository,
  NewCorrectionRequestInput,
  UpdateCorrectionApprovalInput,
  UpdateCorrectionAccountantApprovalInput,
  UpdateCorrectionStatusInput,
  UpdateCorrectionResultInput,
} from "./historical-correction-repository";
import type {
  HistoricalCorrectionRequest,
  ImportBatch,
} from "@/server/db/schema/migration";

type Db = NonNullable<typeof DbType>;

export class HistoricalCorrectionDbRepository implements HistoricalCorrectionRepository {
  constructor(private readonly db: Db) {}

  async insertCorrectionRequest(row: NewCorrectionRequestInput): Promise<HistoricalCorrectionRequest> {
    const [result] = await this.db.insert(historicalCorrectionRequests).values({
      tenantId: row.tenantId,
      docNo: row.docNo,
      importBatchId: row.importBatchId,
      originalEntityType: row.originalEntityType,
      originalEntityId: row.originalEntityId,
      correctionType: row.correctionType,
      reason: row.reason,
      proposedCorrectionJson: row.proposedCorrectionJson,
      impactAnalysisJson: row.impactAnalysisJson,
      status: "draft" as any,
      createdBy: row.createdBy,
    }).returning();
    return result!;
  }

  async findCorrectionRequestById(tenantId: string, id: string): Promise<HistoricalCorrectionRequest | null> {
    const [result] = await this.db.select().from(historicalCorrectionRequests)
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.id, id),
      ));
    return result ?? null;
  }

  async findCorrectionRequestByDocNo(tenantId: string, docNo: string): Promise<HistoricalCorrectionRequest | null> {
    const [result] = await this.db.select().from(historicalCorrectionRequests)
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.docNo, docNo),
      ));
    return result ?? null;
  }

  async findCorrectionRequestsForBatch(tenantId: string, importBatchId: string): Promise<HistoricalCorrectionRequest[]> {
    return this.db.select().from(historicalCorrectionRequests)
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.importBatchId, importBatchId),
      ));
  }

  async findCorrectionRequestsForOriginal(
    tenantId: string,
    originalEntityType: string,
    originalEntityId: string,
  ): Promise<HistoricalCorrectionRequest[]> {
    return this.db.select().from(historicalCorrectionRequests)
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.originalEntityType, originalEntityType),
        eq(historicalCorrectionRequests.originalEntityId, originalEntityId),
      ));
  }

  async updateCorrectionOwnerApproval(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionApprovalInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const [result] = await this.db.update(historicalCorrectionRequests)
      .set({
        ownerApprovedBy: patch.ownerApprovedBy,
        ownerApprovedAt: patch.ownerApprovedAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.id, id),
      ))
      .returning();
    return result ?? null;
  }

  async updateCorrectionAccountantApproval(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionAccountantApprovalInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const [result] = await this.db.update(historicalCorrectionRequests)
      .set({
        accountantApprovedBy: patch.accountantApprovedBy,
        accountantApprovedAt: patch.accountantApprovedAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.id, id),
      ))
      .returning();
    return result ?? null;
  }

  async updateCorrectionStatus(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionStatusInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const [result] = await this.db.update(historicalCorrectionRequests)
      .set({
        status: patch.status as any,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.id, id),
      ))
      .returning();
    return result ?? null;
  }

  async updateCorrectionResult(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionResultInput,
  ): Promise<HistoricalCorrectionRequest | null> {
    const [result] = await this.db.update(historicalCorrectionRequests)
      .set({
        correctedEntityType: patch.correctedEntityType,
        correctedEntityId: patch.correctedEntityId,
        status: patch.status as any,
        updatedBy: patch.updatedBy,
        updatedAt: new Date(),
      })
      .where(and(
        eq(historicalCorrectionRequests.tenantId, tenantId),
        eq(historicalCorrectionRequests.id, id),
      ))
      .returning();
    return result ?? null;
  }

  async findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null> {
    const [batch] = await this.db.select().from(importBatches)
      .where(and(eq(importBatches.tenantId, tenantId), eq(importBatches.id, id)));
    return batch ?? null;
  }
}
