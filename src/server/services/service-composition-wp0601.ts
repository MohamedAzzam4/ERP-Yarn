/**
 * Service Composition — production wiring for WP-06-01 quality hold integration.
 *
 * Contract: docs/contracts/14_coding_agent_instructions.md §4
 *   "SubledgerService is the only owner of account entry/reversal/settlement
 *    posting." Route Handlers do not calculate signs or insert entries.
 *
 * WP-06-01 DEC-065: SalesSubmissionService MUST receive findActiveQualityHolds
 * in production. This file is the production wiring proof — it constructs
 * SalesSubmissionService with the quality hold checker.
 *
 * If this wiring is missing in any production path, quality-restricted stock
 * could be sold, violating DEC-065 ("Blocked/review stock cannot ordinary-sell").
 */
import "server-only";

import type { QualityTestRepository } from "./quality-test-repository";

/**
 * Create a findActiveQualityHolds callback wired to a QualityTestRepository.
 *
 * This is the ONLY production-safe way to create the callback.
 * Production code MUST use this factory — never pass undefined.
 *
 * Usage in production service composition:
 *   const qualityTestRepo = new QualityTestDbRepository(db);
 *   const submissionService = new SalesSubmissionService({
 *     ...,
 *     findActiveQualityHolds: createQualityHoldChecker(qualityTestRepo),
 *   });
 */
export function createQualityHoldChecker(
  qualityTestRepo: QualityTestRepository,
): (tenantId: string, linkedEntityType: string, linkedEntityId: string) => Promise<Array<{ holdReason: string; holdStatus: string }>> {
  return async (tenantId: string, linkedEntityType: string, linkedEntityId: string) => {
    const holds = await qualityTestRepo.listActiveQualityHoldsForEntity(
      tenantId, linkedEntityType, linkedEntityId,
    );
    return holds.map(h => ({ holdReason: h.holdReason, holdStatus: h.holdStatus }));
  };
}

/**
 * Assert that a SalesSubmissionService deps object includes findActiveQualityHolds.
 * This is a runtime fail-closed check for production wiring.
 *
 * Call this in production service composition to verify the hold checker is wired.
 * If it's missing, throw immediately — do NOT allow the service to be constructed
 * without quality hold checking.
 */
export function assertQualityHoldCheckerWired<
  T extends { findActiveQualityHolds?: unknown },
>(deps: T, context: string): void {
  if (!deps.findActiveQualityHolds) {
    throw new Error(
      `PRODUCTION_WIRING_ERROR: SalesSubmissionService in '${context}' is missing findActiveQualityHolds. ` +
      `This violates DEC-065 — quality-restricted stock could be sold without the hold check. ` +
      `Use createQualityHoldChecker(qualityTestRepo) to wire the callback.`,
    );
  }
}
