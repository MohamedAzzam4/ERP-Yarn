/**
 * WP-08-01F TASK 2 — UI/service parity test.
 *
 * Proves that every UI predicate returns the SAME result as the corresponding
 * service guard for every batch status. The UI predicates and service guards
 * share the SAME state sets exported from migration-lifecycle-predicates.ts,
 * so they cannot diverge.
 *
 * For each (status, action) pair:
 *   - Run the UI predicate from migration-lifecycle-predicates.
 *   - Run the corresponding service guard from migration-lifecycle-guard
 *     against an ImportBatch seeded with that status.
 *   - Assert they agree: predicate true ⇔ guard does NOT throw,
 *     predicate false ⇔ guard DOES throw MigrationLifecycleError.
 */
import { describe, it, expect } from "vitest";
import {
  canRegisterFile,
  canInsertStagingRow,
  canRunValidation,
  canRunReconciliation,
  canRecordReviewDecision,
  canRecordOwnerApproval,
  canRecordAccountantApproval,
  canRecordBackupEvidence,
  canCommitBatch,
  ALL_BATCH_STATUSES,
  type MigrationBatchState,
  type MigrationBatchStatus,
} from "../migration-lifecycle-predicates";
import {
  guardRegisterFileInitial,
  guardInsertStagingRow,
  guardRunValidation,
  guardRunReconciliation,
  guardRecordReviewDecision,
  guardRecordApproval,
  guardRecordBackupEvidence,
  guardCommitBatch,
  MigrationLifecycleError,
} from "../migration-lifecycle-guard";
import type { ImportBatch } from "../../db/schema/migration";

const TENANT_A = "00000000-0000-0000-0000-000000081f01";
const OWNER_USER = "00000000-0000-0000-0000-000000081f11";

function makeBatch(status: MigrationBatchStatus): ImportBatch {
  return {
    id: `batch-${status}`,
    tenantId: TENANT_A,
    batchNo: `MIG-${status}`,
    status: status as any,
    sourceDescription: "test",
    templateName: "test-template",
    templateVersion: "1.0",
    mappingVersion: "1.0",
    cutoverManifestHash: "manifest-hash",
    cutoverImportMode: "opening_balance",
    stagedDataHash: "staged-hash",
    stagedRowCount: 10,
    blockingErrorCount: 0,
    warningCount: 0,
    acceptedWarningCount: 0,
    validationStatus: "passed",
    reconciliationStatus: "matched",
    warningSummary: null,
    committedAt: null,
    commitEffectCounts: null,
    createdAt: new Date(),
    createdBy: OWNER_USER,
    updatedAt: null,
    updatedBy: null,
  };
}

function makeReadyState(status: MigrationBatchStatus): MigrationBatchState {
  return {
    status,
    stagedRowCount: 10,
    blockingErrorCount: 0,
    warningCount: 0,
    acceptedWarningCount: 0,
    stagedDataHash: "staged-hash",
    cutoverManifestHash: "manifest-hash",
    hasOwnerApproval: true,
    hasAccountantApproval: true,
    hasBackupEvidence: true,
  };
}

/**
 * Helper: assert that a UI predicate and a service guard agree for a status.
 * - If predicate returns true → guard must NOT throw.
 * - If predicate returns false → guard MUST throw MigrationLifecycleError.
 */
function expectParity(
  predicate: () => boolean,
  guard: () => void,
  status: MigrationBatchStatus,
  action: string,
): void {
  const predicateResult = predicate();
  let guardThrew = false;
  let guardError: unknown = null;
  try {
    guard();
  } catch (e) {
    guardThrew = true;
    guardError = e;
  }

  if (predicateResult && guardThrew) {
    throw new Error(
      `PARITY MISMATCH (status=${status}, action=${action}): ` +
      `UI predicate allowed (${predicateResult}) but service guard REJECTED ` +
      `with: ${(guardError as Error)?.message ?? guardError}.`,
    );
  }
  if (!predicateResult && !guardThrew) {
    throw new Error(
      `PARITY MISMATCH (status=${status}, action=${action}): ` +
      `UI predicate denied (${predicateResult}) but service guard ALLOWED.`,
    );
  }
  // Also verify the guard threw the RIGHT error class.
  if (guardThrew && !(guardError instanceof MigrationLifecycleError)) {
    throw new Error(
      `PARITY MISMATCH (status=${status}, action=${action}): ` +
      `Guard threw ${(guardError as Error)?.name ?? "unknown"} instead of MigrationLifecycleError.`,
    );
  }
}

describe("WP-08-01F TASK 2 — UI predicates match service guards exactly", () => {
  describe("registerFile — UI canRegisterFile vs service guardRegisterFileInitial", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canRegisterFile(state),
          () => guardRegisterFileInitial(batch),
          status,
          "registerFile",
        );
      });
    }
  });

  describe("insertStagingRow — UI canInsertStagingRow vs service guardInsertStagingRow", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canInsertStagingRow(state),
          () => guardInsertStagingRow(batch),
          status,
          "insertStagingRow",
        );
      });
    }
  });

  describe("runValidation — UI canRunValidation vs service guardRunValidation", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canRunValidation(state),
          () => guardRunValidation(batch),
          status,
          "runValidation",
        );
      });
    }
  });

  describe("runReconciliation — UI canRunReconciliation vs service guardRunReconciliation", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canRunReconciliation(state),
          () => guardRunReconciliation(batch),
          status,
          "runReconciliation",
        );
      });
    }
  });

  describe("recordReviewDecision — UI canRecordReviewDecision vs service guardRecordReviewDecision", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canRecordReviewDecision(state),
          () => guardRecordReviewDecision(batch),
          status,
          "recordReviewDecision",
        );
      });
    }
  });

  describe("recordApproval (Owner) — UI canRecordOwnerApproval vs service guardRecordApproval", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canRecordOwnerApproval(state),
          () => guardRecordApproval(batch),
          status,
          "recordApproval (Owner)",
        );
      });
    }
  });

  describe("recordApproval (Accountant) — UI canRecordAccountantApproval vs service guardRecordApproval", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canRecordAccountantApproval(state),
          () => guardRecordApproval(batch),
          status,
          "recordApproval (Accountant)",
        );
      });
    }
  });

  describe("recordBackupEvidence — UI canRecordBackupEvidence vs service guardRecordBackupEvidence", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canRecordBackupEvidence(state),
          () => guardRecordBackupEvidence(batch),
          status,
          "recordBackupEvidence",
        );
      });
    }
  });

  describe("commitBatch — UI canCommitBatch vs service guardCommitBatch", () => {
    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: UI and service agree`, () => {
        const state = makeReadyState(status);
        const batch = makeBatch(status);
        expectParity(
          () => canCommitBatch(state),
          () => guardCommitBatch(batch),
          status,
          "commitBatch",
        );
      });
    }
  });
});
