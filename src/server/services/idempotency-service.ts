/**
 * Idempotency record lifecycle service.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.8
 * Contract: docs/contracts/06_approval_transaction_contract.md §7
 * Contract: docs/contracts/09_api_contracts.md §5, §7
 *
 * State machine:
 *   in_progress → succeeded           (happy path)
 *   in_progress → business_failed     (business precondition failed — durable)
 *   in_progress → retryable_failed    (technical failure — NOT durable, re-executes)
 *   in_progress (expired) → in_progress (lease reclaimed by retry)
 *
 * Failure distinction (Contract 06 §7.1, §7.2):
 *   - business_failed: durable. Retry with same key+request returns same failure.
 *   - retryable_failed: NOT durable. Retry with same key+request re-executes.
 */
import "server-only";
import { computeRequestHash, requestHashesMatch } from "./request-hash";

export type IdempotencyState = "in_progress" | "succeeded" | "business_failed" | "retryable_failed";

export interface IdempotencyClaimInput {
  tenantId: string;
  operationScope: string;
  idempotencyKey: string;
  requestBody: unknown;
  initiatedBy: string;
  leaseDurationMs: number;
  now?: Date;
}

export type IdempotencyClaimResult =
  | { action: "execute"; record: IdempotencyRecordShape }
  | { action: "replay"; record: IdempotencyRecordShape }
  | { action: "in_progress"; record: IdempotencyRecordShape }
  | { action: "conflict"; record: IdempotencyRecordShape };

export interface IdempotencyRecordShape {
  id: string;
  tenantId: string;
  operationScope: string;
  idempotencyKey: string;
  requestHash: string;
  state: IdempotencyState;
  entityType: string | null;
  entityId: string | null;
  responseCode: number | null;
  responseBody: unknown;
  ownerToken: string | null;
  attemptCount: number;
  leaseHeartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  lastErrorClass: string | null;
  initiatedBy: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface IdempotencyTransactionHandle {
  findByTenantScopeKey(tenantId: string, operationScope: string, idempotencyKey: string): Promise<IdempotencyRecordShape | null>;
  insert(record: Omit<IdempotencyRecordShape, "id" | "createdAt"> & { id?: string }): Promise<IdempotencyRecordShape>;
  claimExpiredLease(id: string, newLeaseExpiresAt: Date, newHeartbeatAt: Date, now: Date): Promise<boolean>;
  updateState(id: string, update: {
    state: IdempotencyState;
    responseCode?: number | null;
    responseBody?: unknown;
    lastErrorClass?: string | null;
    completedAt?: Date | null;
    entityType?: string | null;
    entityId?: string | null;
    expectedOwnerToken: string;
  }): Promise<number>;
  heartbeat(id: string, now: Date): Promise<void>;
}

export async function claimIdempotency(
  tx: IdempotencyTransactionHandle,
  input: IdempotencyClaimInput,
): Promise<IdempotencyClaimResult> {
  const now = input.now ?? new Date();
  const requestHash = computeRequestHash(input.requestBody);
  const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);

  const existing = await tx.findByTenantScopeKey(input.tenantId, input.operationScope, input.idempotencyKey);

  if (!existing) {
    let record;
    try {
      record = await tx.insert({
        tenantId: input.tenantId,
        operationScope: input.operationScope,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        state: "in_progress",
        entityType: null, entityId: null,
        responseCode: null, responseBody: null, ownerToken: null,
        attemptCount: 1,
        leaseHeartbeatAt: now, leaseExpiresAt,
        lastErrorClass: null,
        initiatedBy: input.initiatedBy,
        completedAt: null,
      });
    } catch (e: any) {
      // WP-08-01E: Handle concurrent insert race. If the DB repository
      // uses ON CONFLICT DO NOTHING, a concurrent insert by another caller
      // causes our insert to return null/throw IdempotencyConcurrentInsertError.
      // We retry findByTenantScopeKey to pick up the existing record and
      // run the normal idempotency decision logic.
      if (
        e?.code === "IDEMPOTENCY_CONCURRENT_INSERT" ||
        e?.name === "IdempotencyConcurrentInsertError"
      ) {
        const concurrentRecord = await tx.findByTenantScopeKey(
          input.tenantId, input.operationScope, input.idempotencyKey,
        );
        if (concurrentRecord) {
          // Fall through to the normal existing-record logic below
          return resolveExistingRecord(concurrentRecord, requestHash, now, leaseExpiresAt, tx, input);
        }
        // If still not found, the concurrent insert was rolled back.
        // This should be extremely rare — treat as a transient failure.
        throw new Error(
          "IDEMPOTENCY_RACE: Concurrent insert detected but record not found on retry. The concurrent transaction may have rolled back.",
        );
      }
      // Re-throw unrelated database errors (not concurrent-insert races)
      throw e;
    }
    if (!record.ownerToken) {
      throw new Error("IDEMPOTENCY_INvariant_VIOLATION: insert returned null ownerToken");
    }
    return { action: "execute", record };
  }

  // If we get here, existing was found — resolve it
  return resolveExistingRecord(existing, requestHash, now, leaseExpiresAt, tx, input);
}

/**
 * Resolve an existing idempotency record: check hash, replay/conflict/in_progress,
 * and handle lease reclaim. Used by both the normal path and the concurrent-insert
 * retry path.
 */
async function resolveExistingRecord(
  existing: IdempotencyRecordShape,
  requestHash: string,
  now: Date,
  leaseExpiresAt: Date,
  tx: IdempotencyTransactionHandle,
  input: IdempotencyClaimInput,
): Promise<IdempotencyClaimResult> {
  if (!requestHashesMatch(existing.requestHash, requestHash)) {
    return { action: "conflict", record: existing };
  }

  if (existing.state === "succeeded" || existing.state === "business_failed") {
    return { action: "replay", record: existing };
  }

  if (existing.state === "in_progress") {
    // WP-08-01C legacy NULL owner-token safety:
    // - Modern claim (ownerToken non-null): check lease expiry normally.
    // - Legacy claim (ownerToken null, lease expired): may be safely reclaimed.
    // - Legacy claim (ownerToken null, lease unexpired): FAIL CLOSED — return in_progress.
    //   Do NOT auto-reclaim. The claim may still be actively owned by a legacy caller.
    // - Legacy claim (ownerToken null, leaseExpiresAt null): FAIL CLOSED — no safe
    //   expiry information. Return in_progress. Requires administrative recovery.
    const hasOwnerToken = existing.ownerToken !== null;
    const leaseExpired = existing.leaseExpiresAt !== null && existing.leaseExpiresAt.getTime() < now.getTime();

    if (hasOwnerToken) {
      // Modern claim — check lease normally
      if (!leaseExpired) {
        return { action: "in_progress", record: existing };
      }
      // Lease expired — reclaim
    } else {
      // Legacy NULL ownerToken claim
      if (!leaseExpired) {
        // Legacy claim with unexpired or unknown lease — FAIL CLOSED
        return { action: "in_progress", record: existing };
      }
      // Legacy claim with genuinely expired lease — may be safely reclaimed
      // claimExpiredLease will assign a new non-null ownerToken
    }

    const claimed = await tx.claimExpiredLease(existing.id, leaseExpiresAt, now, now);
    if (!claimed) return { action: "in_progress", record: existing };
    const reclaimed = await tx.findByTenantScopeKey(input.tenantId, input.operationScope, input.idempotencyKey);
    if (reclaimed && reclaimed.ownerToken) {
      return { action: "execute", record: reclaimed };
    }
    throw new Error("IDEMPOTENCY_INvariant_VIOLATION: reclaimed record has null ownerToken");
  }

  // state === "retryable_failed" → re-execute
  const claimedRetry = await tx.claimExpiredLease(existing.id, leaseExpiresAt, now, now);
  if (!claimedRetry) return { action: "in_progress", record: existing };
  const reclaimedRetry = await tx.findByTenantScopeKey(input.tenantId, input.operationScope, input.idempotencyKey);
  if (reclaimedRetry && reclaimedRetry.ownerToken) {
    return { action: "execute", record: reclaimedRetry };
  }
  throw new Error("IDEMPOTENCY_INvariant_VIOLATION: reclaimed retry record has null ownerToken");
}

export async function markSucceeded(
  tx: IdempotencyTransactionHandle,
  recordId: string,
  result: { responseCode: number; responseBody: unknown; entityType?: string; entityId?: string },
  expectedOwnerToken: string,
  now: Date = new Date(),
): Promise<number> {
  const affected = await tx.updateState(recordId, {
    state: "succeeded",
    responseCode: result.responseCode,
    responseBody: result.responseBody,
    completedAt: now,
    entityType: result.entityType ?? null,
    entityId: result.entityId ?? null,
    expectedOwnerToken,
  });
  if (affected === 0) {
    throw new IdempotencyOwnershipLostError(recordId, expectedOwnerToken);
  }
  return affected;
}

export async function markBusinessFailed(
  tx: IdempotencyTransactionHandle,
  recordId: string,
  result: { responseCode: number; responseBody: unknown; lastErrorClass: string; entityType?: string; entityId?: string },
  expectedOwnerToken: string,
  now: Date = new Date(),
): Promise<number> {
  const affected = await tx.updateState(recordId, {
    state: "business_failed",
    responseCode: result.responseCode,
    responseBody: result.responseBody,
    lastErrorClass: result.lastErrorClass,
    completedAt: now,
    entityType: result.entityType ?? null,
    entityId: result.entityId ?? null,
    expectedOwnerToken,
  });
  return affected;
}

export async function markRetryableFailed(
  tx: IdempotencyTransactionHandle,
  recordId: string,
  result: { responseCode?: number; responseBody?: unknown; lastErrorClass: string },
  expectedOwnerToken: string,
  now: Date = new Date(),
): Promise<number> {
  const affected = await tx.updateState(recordId, {
    state: "retryable_failed",
    responseCode: result.responseCode ?? null,
    responseBody: result.responseBody ?? null,
    lastErrorClass: result.lastErrorClass,
    completedAt: now,
    expectedOwnerToken,
  });
  return affected;
}

export async function heartbeatIdempotency(
  tx: IdempotencyTransactionHandle,
  recordId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx.heartbeat(recordId, now);
}

export class InProcessIdempotencyStore implements IdempotencyTransactionHandle {
  private records = new Map<string, IdempotencyRecordShape>();
  private idCounter = 0;

  clear(): void { this.records.clear(); this.idCounter = 0; }

  async findByTenantScopeKey(tenantId: string, operationScope: string, idempotencyKey: string): Promise<IdempotencyRecordShape | null> {
    for (const record of this.records.values()) {
      if (record.tenantId === tenantId && record.operationScope === operationScope && record.idempotencyKey === idempotencyKey) {
        return { ...record };
      }
    }
    return null;
  }

  async insert(record: Omit<IdempotencyRecordShape, "id" | "createdAt"> & { id?: string }): Promise<IdempotencyRecordShape> {
    const id = record.id ?? `idem-${++this.idCounter}`;
    const ownerToken = record.ownerToken ?? `owner-${++this.idCounter}`;
    const fullRecord: IdempotencyRecordShape = { ...record, id, ownerToken, createdAt: new Date() };
    this.records.set(id, fullRecord);
    return { ...fullRecord };
  }

  async claimExpiredLease(id: string, newLeaseExpiresAt: Date, newHeartbeatAt: Date, now: Date): Promise<boolean> {
    const existing = this.records.get(id);
    if (!existing) return false;
    // Match DB predicate: state = 'retryable_failed' OR (state = 'in_progress'
    // AND lease_expires_at IS NOT NULL AND lease_expires_at < now).
    // business_failed and succeeded are NEVER reclaimed (terminal states).
    const isRetryableFailed = existing.state === "retryable_failed";
    const isInProgressExpired = existing.state === "in_progress"
      && existing.leaseExpiresAt !== null
      && existing.leaseExpiresAt.getTime() < now.getTime();
    if (!isRetryableFailed && !isInProgressExpired) return false;
    const newOwnerToken = `owner-${++this.idCounter}`;
    this.records.set(id, {
      ...existing,
      state: "in_progress",
      attemptCount: existing.attemptCount + 1,
      leaseHeartbeatAt: newHeartbeatAt,
      leaseExpiresAt: newLeaseExpiresAt,
      ownerToken: newOwnerToken,
    });
    return true;
  }

  async updateState(id: string, update: {
    state: IdempotencyState;
    responseCode?: number | null;
    responseBody?: unknown;
    lastErrorClass?: string | null;
    completedAt?: Date | null;
    entityType?: string | null;
    entityId?: string | null;
    expectedOwnerToken: string;
  }): Promise<number> {
    const existing = this.records.get(id);
    if (!existing) throw new Error(`Idempotency record '${id}' not found`);
    if (existing.ownerToken !== update.expectedOwnerToken) {
      return 0;
    }
    this.records.set(id, {
      ...existing,
      state: update.state,
      responseCode: update.responseCode ?? existing.responseCode,
      responseBody: update.responseBody ?? existing.responseBody,
      lastErrorClass: update.lastErrorClass ?? existing.lastErrorClass,
      completedAt: update.completedAt ?? existing.completedAt,
      entityType: update.entityType ?? existing.entityType,
      entityId: update.entityId ?? existing.entityId,
    });
    return 1;
  }

  async heartbeat(id: string, now: Date): Promise<void> {
    const existing = this.records.get(id);
    if (!existing) throw new Error(`Idempotency record '${id}' not found`);
    this.records.set(id, { ...existing, leaseHeartbeatAt: now });
  }

  getRecord(id: string): IdempotencyRecordShape | undefined {
    const record = this.records.get(id);
    return record ? { ...record } : undefined;
  }

  getAllRecords(): IdempotencyRecordShape[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }
}

export { IdempotencyConflictError, OperationInProgressError } from "./errors";
export { computeRequestHash, requestHashesMatch } from "./request-hash";

export class IdempotencyOwnershipLostError extends Error {
  readonly code = "IDEMPOTENCY_OWNERSHIP_LOST";
  constructor(recordId: string, expectedOwnerToken: string) {
    super(`Ownership lost for idempotency record '${recordId}': expected ownerToken '${expectedOwnerToken}' no longer matches. Another claimant reclaimed the lease.`);
    this.name = "IdempotencyOwnershipLostError";
  }
}
