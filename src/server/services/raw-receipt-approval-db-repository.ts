/**
 * Drizzle-backed RawReceiptApprovalRepository — the production DB repository.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §17.1
 *   Raw Receipt Approval and Late-Price Confirmation.
 *
 * This module implements the RawReceiptApprovalRepository interface using
 * Drizzle ORM against the approval_requests table. All methods are
 * tenant-scoped.
 *
 * WP-02-05 scope: raw receipt approval persistence only. The actual stock
 * posting (InventoryLedgerService) and payable posting (SubledgerService)
 * are called by the service, not this repository.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { approvalRequests } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  RawReceiptApprovalRepository,
  NewApprovalRequestInput,
  RawReceiptApprovalRequest,
} from "./raw-receipt-approval-service";

type Db = NonNullable<typeof DbType>;

export class RawReceiptApprovalDbRepository implements RawReceiptApprovalRepository {
  constructor(private readonly db: Db) {}

  async insertApprovalRequest(row: NewApprovalRequestInput): Promise<RawReceiptApprovalRequest> {
    const [result] = await this.db
      .insert(approvalRequests)
      .values({
        tenantId: row.tenantId,
        requestType: row.requestType,
        entityType: row.entityType,
        entityId: row.entityId,
        riskLevel: row.riskLevel as never,
        requestedBy: row.requestedBy,
        reason: row.reason,
        state: "active",
        subjectVersion: row.subjectVersion,
        subjectHash: row.subjectHash,
        createdBy: row.createdBy,
      })
      .returning();

    return this.mapToApproval(result!);
  }

  async findActiveApprovalByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    requestType: string,
  ): Promise<RawReceiptApprovalRequest | null> {
    const [result] = await this.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.tenantId, tenantId),
          eq(approvalRequests.entityType, entityType),
          eq(approvalRequests.entityId, entityId),
          eq(approvalRequests.requestType, requestType),
          eq(approvalRequests.state, "active"),
        ),
      )
      .limit(1);
    return result ? this.mapToApproval(result) : null;
  }

  async findApprovalById(tenantId: string, id: string): Promise<RawReceiptApprovalRequest | null> {
    const [result] = await this.db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id)))
      .limit(1);
    return result ? this.mapToApproval(result) : null;
  }

  async listPendingApprovals(tenantId: string, entityType: string): Promise<RawReceiptApprovalRequest[]> {
    const results = await this.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.tenantId, tenantId),
          eq(approvalRequests.entityType, entityType),
          eq(approvalRequests.state, "active"),
        ),
      );
    return results.map((r) => this.mapToApproval(r));
  }

  async markDecided(
    tenantId: string,
    id: string,
    decidedBy: string,
    decisionNotes: string | null,
    movementId: string | null,
    payableEntryId: string | null,
    payableDeferred: boolean,
  ): Promise<RawReceiptApprovalRequest | null> {
    // Note: movementId, payableEntryId, payableDeferred are stored in the
    // submittedChildVersionSummary JSONB column (or a dedicated column if
    // we add one). For WP-02-05, we store them in the JSONB summary to
    // avoid a schema migration. The decisionNotes goes in the dedicated column.
    const [result] = await this.db
      .update(approvalRequests)
      .set({
        state: "decided",
        decidedBy,
        decidedAt: new Date(),
        decisionNotes,
        submittedChildVersionSummary: {
          movementId,
          payableEntryId,
          payableDeferred,
        },
        updatedAt: new Date(),
        updatedBy: decidedBy,
      })
      .where(and(eq(approvalRequests.tenantId, tenantId), eq(approvalRequests.id, id)))
      .returning();

    return result ? this.mapToApproval(result) : null;
  }

  private mapToApproval(row: typeof approvalRequests.$inferSelect): RawReceiptApprovalRequest {
    const summary = (row.submittedChildVersionSummary ?? {}) as {
      movementId?: string | null;
      payableEntryId?: string | null;
      payableDeferred?: boolean;
    };
    return {
      id: row.id,
      tenantId: row.tenantId,
      requestType: row.requestType,
      entityType: row.entityType,
      entityId: row.entityId,
      riskLevel: row.riskLevel,
      requestedBy: row.requestedBy,
      requestedAt: row.requestedAt,
      reason: row.reason,
      state: row.state as RawReceiptApprovalRequest["state"],
      decidedBy: row.decidedBy ?? null,
      decidedAt: row.decidedAt ?? null,
      decisionNotes: row.decisionNotes ?? null,
      idempotencyKey: row.idempotencyKey ?? null,
      subjectVersion: row.subjectVersion,
      subjectHash: row.subjectHash,
      movementId: summary.movementId ?? null,
      payableEntryId: summary.payableEntryId ?? null,
      payableDeferred: summary.payableDeferred ?? false,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt ?? null,
      updatedBy: row.updatedBy ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  }
}

export function createRawReceiptApprovalDbRepository(db: Db): RawReceiptApprovalDbRepository {
  return new RawReceiptApprovalDbRepository(db);
}
