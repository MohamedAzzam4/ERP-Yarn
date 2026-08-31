/**
 * Cutover coordination — tenant/domain mutual exclusion between historical
 * migration cutover and live operational posting.
 *
 * Contract 08 §8.1.1: "During final validation and commit, an audited
 *   tenant/domain cutover lock prevents concurrent live postings in
 *   affected scopes. If the system cannot safely pause or serialize live
 *   writes, commit is blocked."
 * Contract 08 §8.10: "cutover manifest is approved and affected live-write
 *   scopes are locked/paused."
 * Contract 08 §12.4: "Concurrent live posting in an affected cutover scope
 *   is blocked/serialized and cannot cross the approved boundary."
 * Contract 12 §11.4: "Migration commit versus concurrent live posting must
 *   respect the cutover lock/boundary."
 *
 * Implementation: PostgreSQL transaction-scoped advisory lock
 * (pg_advisory_xact_lock) keyed by (tenant_id, domain). The lock is:
 *   - held for the duration of the enclosing transaction
 *   - auto-released on COMMIT or ROLLBACK (zero recovery code needed)
 *   - re-entrant within the same transaction (the migration's own
 *     opening-balance posting can re-acquire the same lock without
 *     self-blocking)
 *   - atomic (no check-then-write TOCTOU window — the lock acquisition
 *     IS the synchronization point)
 *   - tenant/domain-scoped (independent tenants and unaffected domains
 *     remain independent — no global lock)
 *
 * WP-07-04 dependency correction: the prior implementation relied solely on
 * the `import_cutover_locks` table whose unique partial index is
 * (tenant_id, import_batch_id, lock_scope) — that prevented only concurrent
 * historical commits on the same batch and did NOT block live operational
 * posting in the same tenant/domain. This module provides the missing
 * DB-level mutual exclusion.
 *
 * The `import_cutover_locks` table is RETAINED as durable audit evidence
 * (Contract 08 §8.10 audit requirement). The advisory lock provides the
 * actual mutual exclusion; the table row provides the audited proof.
 */
import "server-only";

/**
 * Fixed 32-bit namespace constant for cutover advisory locks.
 *
 * Used as the first int4 argument to pg_advisory_xact_lock(int4, int4)
 * to namespace cutover locks apart from any other advisory locks in the
 * system (e.g. SubledgerService.lockSourceEntry uses hashtext on a string).
 *
 * The value 0x57A704E1 is a stable, arbitrary constant. It is documented
 * here so reviewers can verify the namespace is reserved and consistent.
 */
export const CUTOVER_LOCK_NAMESPACE = 0x57a704e1; // 1471857633

/**
 * The two MVP live-write domains that the historical migration cutover
 * must coordinate with.
 *
 * - "inventory": all live stock movements (raw receipt, sale issue,
 *   transfer, adjustment, return receipt, return-from-WIP, etc.)
 * - "subledger": all live account entries (supplier payable, factory
 *   payable, payment entry, reversal, direct cost, return credit)
 *
 * These match the existing CUTOVER_LOCK_SCOPES in
 * historical-commit-service.ts (minus "batch" which is an audit-only
 * scope, not a live-write domain).
 */
export const CUTOVER_DOMAINS = ["inventory", "subledger"] as const;
export type CutoverDomain = (typeof CUTOVER_DOMAINS)[number];

/**
 * Compute a stable 32-bit hash of (tenantId, domain) for use as the
 * second int4 argument to pg_advisory_xact_lock(int4, int4).
 *
 * Uses FNV-1a (32-bit) — a deterministic, non-cryptographic hash. The
 * same (tenantId, domain) pair always produces the same 32-bit key, so
 * two transactions coordinating the same tenant+domain will collide on
 * the same advisory lock and serialize.
 *
 * The hash is intentionally returned as a signed 32-bit integer because
 * pg_advisory_xact_lock(int4, int4) expects int4 (signed). JavaScript
 * bitwise operations natively produce signed 32-bit results.
 *
 * Collision risk: with ~4 billion possible values and only O(tenants × 2)
 * active locks per cluster at any time, the birthday-paradox collision
 * probability is negligible. A collision would cause two unrelated
 * tenant+domain pairs to serialize unnecessarily — a safe failure mode
 * (over-serialization, not under-serialization).
 */
export function computeCutoverLockKey(tenantId: string, domain: CutoverDomain): number {
  // FNV-1a 32-bit hash over `${tenantId}|${domain}`
  let hash = 0x811c9dc5; // FNV offset basis (2166136261 as signed = -2128831035)
  const input = `${tenantId}|${domain}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime 16777619, applied via Math.imul to stay in 32-bit signed range
    hash = Math.imul(hash, 0x01000193);
  }
  // Force to signed 32-bit (| 0 converts to int32)
  return hash | 0;
}

/**
 * Validate that a domain is one of the supported CUTOVER_DOMAINS.
 * Throws on unsupported values to fail closed.
 */
export function assertCutoverDomain(domain: string): asserts domain is CutoverDomain {
  if (!CUTOVER_DOMAINS.includes(domain as CutoverDomain)) {
    throw new Error(
      `Unsupported cutover domain '${domain}'. Supported: ${CUTOVER_DOMAINS.join(", ")}.`,
    );
  }
}
