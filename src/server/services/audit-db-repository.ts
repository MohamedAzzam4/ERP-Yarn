/**
 * Drizzle-backed AuditTransactionHandle — the production DB audit store.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.3
 *   audit_logs table (append-only, no update/delete).
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §6
 *   "Audit failure rolls back the entire transaction."
 *
 * This module implements the AuditTransactionHandle interface using
 * Drizzle ORM against the audit_logs table. It is the production
 * equivalent of InProcessAuditStore (which is test-only).
 *
 * WP-03-04: Created to prove that production code writes to persistent
 * audit_logs, not only the in-process test store.
 */
import "server-only";
import { auditLogs } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type { AuditTransactionHandle, AuditLogRowInsert } from "./audit-service";

type Db = NonNullable<typeof DbType>;

export class AuditDbRepository implements AuditTransactionHandle {
  constructor(private readonly db: Db) {}

  async insertAuditLog(row: AuditLogRowInsert): Promise<void> {
    await this.db.insert(auditLogs).values({
      tenantId: row.tenantId,
      userId: row.userId,
      entityType: row.entityType,
      entityId: row.entityId,
      actionType: row.actionType,
      oldValuesJson: row.oldValuesJson,
      newValuesJson: row.newValuesJson,
      reason: row.reason,
      approvalRequestId: row.approvalRequestId,
      idempotencyKey: row.idempotencyKey,
      ipAddress: row.ipAddress,
      deviceInfo: row.deviceInfo,
    });
  }
}

export function createAuditDbRepository(db: Db): AuditDbRepository {
  return new AuditDbRepository(db);
}
