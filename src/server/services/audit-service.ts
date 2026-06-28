/**
 * Append-only audit service.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.7
 * Contract: docs/02_decision_log_and_scope.md DEC-024
 *   "Audit logs are append-only and transaction-coupled. Application users
 *    cannot update/delete audit; failure to write required audit fails the
 *    business transaction."
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §6 step 10
 *   "records approval decision and success audit in the same transaction"
 *
 * Design principles:
 *   1. APPEND-ONLY: No update or delete helpers exist. Only `appendAuditLog`.
 *   2. TRANSACTION-COUPLED: accepts a `tx` handle; audit write failure throws
 *      AuditWriteFailedError — caller must NOT catch (DEC-024).
 *   3. NO SECRET LOGGING: strips UNIVERSAL_DENIED_FIELD_KEYS from JSON fields.
 */
import "server-only";
import { redactFieldsDeep, UNIVERSAL_DENIED_FIELD_KEYS } from "@/server/security/redaction";
import { AuditWriteFailedError } from "./errors";

export interface AuditLogInput {
  entityType: string;
  entityId?: string;
  actionType: string;
  oldValuesJson?: Record<string, unknown>;
  newValuesJson?: Record<string, unknown>;
  reason?: string;
  approvalRequestId?: string;
  idempotencyKey?: string;
  ipAddress?: string;
  deviceInfo?: string;
}

export interface AuditLogRowInsert {
  tenantId: string;
  userId: string;
  entityType: string;
  entityId: string | null;
  actionType: string;
  oldValuesJson: Record<string, unknown> | null;
  newValuesJson: Record<string, unknown> | null;
  reason: string | null;
  approvalRequestId: string | null;
  idempotencyKey: string | null;
  ipAddress: string | null;
  deviceInfo: string | null;
}

export interface AuditTransactionHandle {
  insertAuditLog: (row: AuditLogRowInsert) => Promise<void>;
}

export async function appendAuditLog(
  tx: AuditTransactionHandle,
  tenantId: string,
  userId: string,
  input: AuditLogInput,
): Promise<void> {
  const safeOld = input.oldValuesJson
    ? redactFieldsDeep(input.oldValuesJson, UNIVERSAL_DENIED_FIELD_KEYS)
    : null;
  const safeNew = input.newValuesJson
    ? redactFieldsDeep(input.newValuesJson, UNIVERSAL_DENIED_FIELD_KEYS)
    : null;

  const row: AuditLogRowInsert = {
    tenantId, userId,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    actionType: input.actionType,
    oldValuesJson: safeOld,
    newValuesJson: safeNew,
    reason: input.reason ?? null,
    approvalRequestId: input.approvalRequestId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    ipAddress: input.ipAddress ?? null,
    deviceInfo: input.deviceInfo ?? null,
  };

  try {
    await tx.insertAuditLog(row);
  } catch (e) {
    throw new AuditWriteFailedError({ cause: e });
  }
}

// NO updateAuditLog, NO deleteAuditLog, NO softDeleteAuditLog exported (DEC-024).

export class InProcessAuditStore implements AuditTransactionHandle {
  private rows: AuditLogRowInsert[] = [];
  private shouldFail = false;

  setShouldFail(shouldFail: boolean): void { this.shouldFail = shouldFail; }
  getRows(): ReadonlyArray<AuditLogRowInsert> { return [...this.rows]; }
  count(): number { return this.rows.length; }
  clear(): void { this.rows = []; this.shouldFail = false; }

  async insertAuditLog(row: AuditLogRowInsert): Promise<void> {
    if (this.shouldFail) throw new Error("Simulated audit write failure");
    this.rows.push(row);
  }
}

export { AuditWriteFailedError } from "./errors";
