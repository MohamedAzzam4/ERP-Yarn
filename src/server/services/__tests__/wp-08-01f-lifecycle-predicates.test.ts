/**
 * WP-08-01F — Migration lifecycle predicate tests.
 *
 * Tests the production predicates from migration-lifecycle-predicates.ts
 * directly. The predicates are the SINGLE SOURCE OF TRUTH shared with
 * the service-side guard module — no local duplicates, no expect(true).toBe(true).
 *
 * Contract 08 §9 — authoritative state transitions:
 *   draft → source_uploaded → normalized → staged → validation_in_progress
 *   → validation_complete → reconciliation_in_progress → review_required
 *   → pending_dual_approval → approved_for_commit → committing → committed
 */
import { describe, it, expect } from "vitest";
import {
  getActionMatrix,
  canRegisterFile,
  canInsertStagingRow,
  canRunValidation,
  canRunReconciliation,
  canRecordReviewDecision,
  canRecordOwnerApproval,
  canRecordAccountantApproval,
  canRecordBackupEvidence,
  canCommitBatch,
  canCreateCorrectionRequest,
  canApproveCorrection,
  canApproveCorrectionWithRole,
  visibleApprovalControls,
  visibleCorrectionApprovalControls,
  isReadOnly,
  isCommitted,
  ALL_BATCH_STATUSES,
  type MigrationBatchState,
} from "../migration-lifecycle-predicates";

function makeState(overrides: Partial<MigrationBatchState> = {}): MigrationBatchState {
  return {
    status: "draft",
    stagedRowCount: 0,
    blockingErrorCount: 0,
    warningCount: 0,
    acceptedWarningCount: 0,
    stagedDataHash: null,
    cutoverManifestHash: null,
    hasOwnerApproval: false,
    hasAccountantApproval: false,
    hasBackupEvidence: false,
    ...overrides,
  };
}

/** A "fully qualified" state — has hashes, no blockers, warnings accepted. */
function makeReadyState(overrides: Partial<MigrationBatchState> = {}): MigrationBatchState {
  return makeState({
    stagedRowCount: 10,
    stagedDataHash: "staged-hash-123",
    cutoverManifestHash: "manifest-hash-123",
    ...overrides,
  });
}

describe("WP-08-01F — Migration lifecycle predicates (Contract 08 §9)", () => {
  describe("Draft state", () => {
    const state = makeState({ status: "draft" });
    const matrix = getActionMatrix(state);
    it("can register file", () => expect(matrix.registerFile).toBe(true));
    it("can insert staging row", () => expect(matrix.insertStagingRow).toBe(true));
    it("cannot run validation (no rows)", () => expect(matrix.runValidation).toBe(false));
    it("cannot run reconciliation", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot record review decision", () => expect(matrix.recordReviewDecision).toBe(false));
    it("cannot approve (no hashes, wrong state)", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("cannot record backup evidence", () => expect(matrix.recordBackupEvidence).toBe(false));
    it("cannot commit", () => expect(matrix.commitBatch).toBe(false));
    it("cannot create correction", () => expect(matrix.createCorrectionRequest).toBe(false));
    it("is not read-only", () => expect(isReadOnly(state)).toBe(false));
  });

  describe("source_uploaded state", () => {
    const state = makeState({ status: "source_uploaded" });
    const matrix = getActionMatrix(state);
    it("can register file", () => expect(matrix.registerFile).toBe(true));
    it("can insert staging row", () => expect(matrix.insertStagingRow).toBe(true));
    it("cannot run validation", () => expect(matrix.runValidation).toBe(false));
    it("cannot run reconciliation", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot approve", () => expect(matrix.recordOwnerApproval).toBe(false));
  });

  describe("normalized state", () => {
    const state = makeState({ status: "normalized" });
    const matrix = getActionMatrix(state);
    it("can register file", () => expect(matrix.registerFile).toBe(true));
    it("can insert staging row", () => expect(matrix.insertStagingRow).toBe(true));
    it("cannot run validation", () => expect(matrix.runValidation).toBe(false));
  });

  describe("staged state with rows", () => {
    const state = makeState({ status: "staged", stagedRowCount: 10 });
    const matrix = getActionMatrix(state);
    // WP-08-01F R1: ordinary initial upload is NOT allowed in `staged` —
    // use replaceMigrationFile instead. insertStagingRow remains allowed
    // because the replacement pipeline reuses it internally.
    it("cannot register file (must use replaceMigrationFile)", () => expect(matrix.registerFile).toBe(false));
    it("can insert staging row", () => expect(matrix.insertStagingRow).toBe(true));
    it("can run validation (has rows)", () => expect(matrix.runValidation).toBe(true));
    it("cannot run reconciliation (validation not complete)", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot approve (wrong state)", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("cannot record backup evidence", () => expect(matrix.recordBackupEvidence).toBe(false));
  });

  describe("staged state without rows", () => {
    const state = makeState({ status: "staged", stagedRowCount: 0 });
    it("cannot run validation (no rows)", () => expect(canRunValidation(state)).toBe(false));
  });

  describe("validation_in_progress state", () => {
    const state = makeState({ status: "validation_in_progress", stagedRowCount: 10 });
    const matrix = getActionMatrix(state);
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot insert staging row", () => expect(matrix.insertStagingRow).toBe(false));
    it("cannot run validation (already in progress)", () => expect(matrix.runValidation).toBe(false));
    it("cannot run reconciliation", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot approve", () => expect(matrix.recordOwnerApproval).toBe(false));
  });

  describe("validation_complete state (TASK 1.1 — NOT approval-eligible)", () => {
    const state = makeReadyState({ status: "validation_complete" });
    const matrix = getActionMatrix(state);
    it("can run reconciliation", () => expect(matrix.runReconciliation).toBe(true));
    it("can re-run validation", () => expect(matrix.runValidation).toBe(true));
    it("CANNOT approve (must reach pending_dual_approval)", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("CANNOT record backup evidence (recon report not final)", () => expect(matrix.recordBackupEvidence).toBe(false));
    it("cannot record review decision", () => expect(matrix.recordReviewDecision).toBe(false));
  });

  describe("reconciliation_in_progress state (TASK 1.1 — NOT approval-eligible)", () => {
    const state = makeReadyState({ status: "reconciliation_in_progress" });
    const matrix = getActionMatrix(state);
    it("can re-run reconciliation", () => expect(matrix.runReconciliation).toBe(true));
    it("CANNOT approve (must reach pending_dual_approval)", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("CANNOT record backup evidence (recon still in progress)", () => expect(matrix.recordBackupEvidence).toBe(false));
    it("cannot record review decision (not in review_required)", () => expect(matrix.recordReviewDecision).toBe(false));
  });

  describe("review_required state", () => {
    const state = makeReadyState({ status: "review_required" });
    const matrix = getActionMatrix(state);
    it("can re-run reconciliation (rework)", () => expect(matrix.runReconciliation).toBe(true));
    it("can record review decision", () => expect(matrix.recordReviewDecision).toBe(true));
    it("CANNOT approve (review not yet resolved)", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("can record backup evidence (post-recon)", () => expect(matrix.recordBackupEvidence).toBe(true));
  });

  describe("review_required state with unresolved review items (TASK 1.1)", () => {
    // Even with hashes and no blockers, review_required is NOT approval-eligible.
    const state = makeReadyState({
      status: "review_required",
      blockingErrorCount: 0,
      warningCount: 0,
      acceptedWarningCount: 0,
    });
    it("CANNOT approve — review items still unresolved", () => {
      expect(canRecordOwnerApproval(state)).toBe(false);
      expect(canRecordAccountantApproval(state)).toBe(false);
    });
  });

  describe("pending_dual_approval state (TASK 1.1 — approval-eligible)", () => {
    const state = makeReadyState({ status: "pending_dual_approval" });
    const matrix = getActionMatrix(state);
    it("can approve (Owner)", () => expect(matrix.recordOwnerApproval).toBe(true));
    it("can approve (Accountant)", () => expect(matrix.recordAccountantApproval).toBe(true));
    it("can record backup evidence", () => expect(matrix.recordBackupEvidence).toBe(true));
    it("cannot commit (missing second approval)", () => expect(matrix.commitBatch).toBe(false));
    it("CANNOT run reconciliation (approvals bound)", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot record review decision", () => expect(matrix.recordReviewDecision).toBe(false));
  });

  describe("approved_for_commit state", () => {
    const state = makeReadyState({
      status: "approved_for_commit",
      hasOwnerApproval: true,
      hasAccountantApproval: true,
      hasBackupEvidence: true,
    });
    const matrix = getActionMatrix(state);
    it("can commit", () => expect(matrix.commitBatch).toBe(true));
    it("can still approve (re-record/replay)", () => expect(matrix.recordOwnerApproval).toBe(true));
    it("can record backup evidence", () => expect(matrix.recordBackupEvidence).toBe(true));
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot insert staging row", () => expect(matrix.insertStagingRow).toBe(false));
    it("CANNOT run reconciliation (approvals bound)", () => expect(matrix.runReconciliation).toBe(false));
  });

  describe("committing state (locked)", () => {
    const state = makeReadyState({ status: "committing" });
    const matrix = getActionMatrix(state);
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
    it("cannot approve", () => expect(canRecordOwnerApproval(state)).toBe(false));
    it("cannot commit (already committing)", () => expect(matrix.commitBatch).toBe(false));
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot run reconciliation", () => expect(matrix.runReconciliation).toBe(false));
  });

  describe("committed (locked)", () => {
    const state = makeState({ status: "committed" });
    const matrix = getActionMatrix(state);
    it("can create correction request", () => expect(matrix.createCorrectionRequest).toBe(true));
    it("can approve correction (committed batch)", () => expect(matrix.approveCorrection).toBe(true));
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot insert staging row", () => expect(matrix.insertStagingRow).toBe(false));
    it("cannot run validation", () => expect(matrix.runValidation).toBe(false));
    it("cannot run reconciliation", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot approve (batch)", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("cannot commit", () => expect(matrix.commitBatch).toBe(false));
    it("cannot record backup evidence", () => expect(matrix.recordBackupEvidence).toBe(false));
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
    it("is committed", () => expect(isCommitted(state)).toBe(true));
  });

  describe("rejected", () => {
    const state = makeState({ status: "rejected" });
    const matrix = getActionMatrix(state);
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot commit", () => expect(matrix.commitBatch).toBe(false));
    it("cannot create correction", () => expect(matrix.createCorrectionRequest).toBe(false));
    it("cannot approve", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("cannot record backup evidence", () => expect(matrix.recordBackupEvidence).toBe(false));
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
  });

  describe("cancelled", () => {
    const state = makeState({ status: "cancelled" });
    const matrix = getActionMatrix(state);
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot commit", () => expect(matrix.commitBatch).toBe(false));
    it("cannot create correction", () => expect(matrix.createCorrectionRequest).toBe(false));
    it("cannot approve", () => expect(matrix.recordOwnerApproval).toBe(false));
    it("cannot record backup evidence", () => expect(matrix.recordBackupEvidence).toBe(false));
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
  });

  describe("Blocking errors prevent approval even in dual-approval state", () => {
    const state = makeReadyState({
      status: "pending_dual_approval",
      blockingErrorCount: 1,
    });
    it("cannot approve with blocking errors", () => expect(canRecordOwnerApproval(state)).toBe(false));
  });

  describe("Unresolved warnings prevent commit", () => {
    const state = makeReadyState({
      status: "approved_for_commit",
      hasOwnerApproval: true,
      hasAccountantApproval: true,
      hasBackupEvidence: true,
      warningCount: 5,
      acceptedWarningCount: 3,
    });
    it("cannot commit with unresolved warnings", () => expect(canCommitBatch(state)).toBe(false));
  });

  describe("Missing backup prevents commit", () => {
    const state = makeReadyState({
      status: "approved_for_commit",
      hasOwnerApproval: true,
      hasAccountantApproval: true,
      hasBackupEvidence: false,
    });
    it("cannot commit without backup", () => expect(canCommitBatch(state)).toBe(false));
  });

  describe("Missing single approval prevents commit", () => {
    const state = makeReadyState({
      status: "approved_for_commit",
      hasOwnerApproval: true,
      hasAccountantApproval: false,
      hasBackupEvidence: true,
    });
    it("cannot commit with only Owner approval", () => expect(canCommitBatch(state)).toBe(false));
  });

  describe("Missing hashes prevent approval", () => {
    const state = makeState({
      status: "pending_dual_approval",
      stagedRowCount: 10,
      stagedDataHash: null,
      cutoverManifestHash: null,
    });
    it("cannot approve without staged data hash", () => expect(canRecordOwnerApproval(state)).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// TASK 3 — Role-specific control visibility tests
// ---------------------------------------------------------------------------

describe("WP-08-01F TASK 3 — Role-specific control visibility", () => {
  const readyPending = makeReadyState({ status: "pending_dual_approval" });

  describe("Owner-only user", () => {
    it("sees only the Owner approval control", () => {
      const v = visibleApprovalControls(["owner"], readyPending);
      expect(v.owner).toBe(true);
      expect(v.accountant).toBe(false);
    });
  });

  describe("Accountant-only user", () => {
    it("sees only the Accountant approval control", () => {
      const v = visibleApprovalControls(["accountant"], readyPending);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(true);
    });
  });

  describe("Unauthorized management/worker roles", () => {
    it("see neither control (no owner/accountant role)", () => {
      const v = visibleApprovalControls([], readyPending);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(false);
    });
  });

  describe("Legitimate multi-role identity", () => {
    it("may see both controls (service still enforces distinct identity)", () => {
      const v = visibleApprovalControls(["owner", "accountant"], readyPending);
      expect(v.owner).toBe(true);
      expect(v.accountant).toBe(true);
    });
  });

  describe("When batch is not in approval-eligible state", () => {
    it("sees neither control regardless of role", () => {
      const v = visibleApprovalControls(["owner", "accountant"], makeState({ status: "validation_complete" }));
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(false);
    });
  });

  describe("Correction approval — Owner-only user", () => {
    it("sees only the Owner correction approval control", () => {
      const v = visibleCorrectionApprovalControls(["owner"], "pending_review", false, false);
      expect(v.owner).toBe(true);
      expect(v.accountant).toBe(false);
    });
  });

  describe("Correction approval — Accountant-only user", () => {
    it("sees only the Accountant correction approval control", () => {
      const v = visibleCorrectionApprovalControls(["accountant"], "pending_review", false, false);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(true);
    });
  });

  describe("Correction approval — existing Owner approval hides Owner control only", () => {
    it("hides Owner control but shows Accountant control", () => {
      const v = visibleCorrectionApprovalControls(["owner", "accountant"], "pending_review", true, false);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(true);
    });
  });

  describe("Correction approval — existing Accountant approval hides Accountant control only", () => {
    it("hides Accountant control but shows Owner control", () => {
      const v = visibleCorrectionApprovalControls(["owner", "accountant"], "pending_review", false, true);
      expect(v.owner).toBe(true);
      expect(v.accountant).toBe(false);
    });
  });

  describe("Correction approval — approved/executed/rejected expose no form", () => {
    it("approved status shows neither control", () => {
      const v = visibleCorrectionApprovalControls(["owner", "accountant"], "approved", false, false);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(false);
    });
    it("rejected status shows neither control", () => {
      const v = visibleCorrectionApprovalControls(["owner", "accountant"], "rejected", false, false);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(false);
    });
    it("executed status shows neither control", () => {
      const v = visibleCorrectionApprovalControls(["owner", "accountant"], "executed", false, false);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(false);
    });
  });

  describe("Correction approval — unauthorized roles see neither", () => {
    it("worker roles see neither control", () => {
      const v = visibleCorrectionApprovalControls([], "pending_review", false, false);
      expect(v.owner).toBe(false);
      expect(v.accountant).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// TASK 2 — Full matrix sweep across every status (parity test prerequisite)
// ---------------------------------------------------------------------------

describe("WP-08-01F TASK 2 — Full action matrix sweep across all statuses", () => {
  // For each status, verify the action matrix matches Contract 08 §9.
  // This is the same matrix the service guards enforce (via the shared
  // state sets in migration-lifecycle-predicates.ts).
  const expectations: Record<string, {
    registerFile?: boolean; insertStagingRow?: boolean;
    runValidation?: boolean; runReconciliation?: boolean;
    recordReviewDecision?: boolean;
    recordOwnerApproval?: boolean; recordBackupEvidence?: boolean;
    commitBatch?: boolean; createCorrectionRequest?: boolean;
  }> = {
    draft: { registerFile: true, insertStagingRow: true, runValidation: false, runReconciliation: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    source_uploaded: { registerFile: true, insertStagingRow: true, runValidation: false, runReconciliation: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    normalized: { registerFile: true, insertStagingRow: true, runValidation: false, runReconciliation: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    staged: { registerFile: false, insertStagingRow: true, runValidation: true, runReconciliation: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    validation_in_progress: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    validation_complete: { registerFile: false, insertStagingRow: false, runValidation: true, runReconciliation: true, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    reconciliation_in_progress: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: true, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    review_required: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: true, recordReviewDecision: true, recordOwnerApproval: false, recordBackupEvidence: true, commitBatch: false, createCorrectionRequest: false },
    pending_dual_approval: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: false, recordReviewDecision: false, recordOwnerApproval: true, recordBackupEvidence: true, commitBatch: false, createCorrectionRequest: false },
    approved_for_commit: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: false, recordReviewDecision: false, recordOwnerApproval: true, recordBackupEvidence: true, commitBatch: true, createCorrectionRequest: false },
    committing: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: false, recordReviewDecision: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    committed: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: false, recordReviewDecision: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: true },
    rejected: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: false, recordReviewDecision: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
    cancelled: { registerFile: false, insertStagingRow: false, runValidation: false, runReconciliation: false, recordReviewDecision: false, recordOwnerApproval: false, recordBackupEvidence: false, commitBatch: false, createCorrectionRequest: false },
  };

  for (const status of ALL_BATCH_STATUSES) {
    describe(`status = ${status}`, () => {
      const state = makeReadyState({
        status,
        hasOwnerApproval: status === "approved_for_commit" || status === "committing" || status === "committed",
        hasAccountantApproval: status === "approved_for_commit" || status === "committing" || status === "committed",
        hasBackupEvidence: status === "approved_for_commit" || status === "committing" || status === "committed",
      });
      const matrix = getActionMatrix(state);
      const exp = expectations[status]!;
      if (exp.registerFile !== undefined) {
        it(`registerFile = ${exp.registerFile}`, () => expect(matrix.registerFile).toBe(exp.registerFile));
      }
      if (exp.insertStagingRow !== undefined) {
        it(`insertStagingRow = ${exp.insertStagingRow}`, () => expect(matrix.insertStagingRow).toBe(exp.insertStagingRow));
      }
      if (exp.runValidation !== undefined) {
        it(`runValidation = ${exp.runValidation}`, () => expect(matrix.runValidation).toBe(exp.runValidation));
      }
      if (exp.runReconciliation !== undefined) {
        it(`runReconciliation = ${exp.runReconciliation}`, () => expect(matrix.runReconciliation).toBe(exp.runReconciliation));
      }
      if (exp.recordReviewDecision !== undefined) {
        it(`recordReviewDecision = ${exp.recordReviewDecision}`, () => expect(matrix.recordReviewDecision).toBe(exp.recordReviewDecision));
      }
      if (exp.recordOwnerApproval !== undefined) {
        it(`recordOwnerApproval = ${exp.recordOwnerApproval}`, () => expect(matrix.recordOwnerApproval).toBe(exp.recordOwnerApproval));
      }
      if (exp.recordBackupEvidence !== undefined) {
        it(`recordBackupEvidence = ${exp.recordBackupEvidence}`, () => expect(matrix.recordBackupEvidence).toBe(exp.recordBackupEvidence));
      }
      if (exp.commitBatch !== undefined) {
        it(`commitBatch = ${exp.commitBatch}`, () => expect(matrix.commitBatch).toBe(exp.commitBatch));
      }
      if (exp.createCorrectionRequest !== undefined) {
        it(`createCorrectionRequest = ${exp.createCorrectionRequest}`, () => expect(matrix.createCorrectionRequest).toBe(exp.createCorrectionRequest));
      }
    });
  }
});
