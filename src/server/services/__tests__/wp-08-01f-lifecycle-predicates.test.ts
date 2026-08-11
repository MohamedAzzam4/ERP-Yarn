/**
 * WP-08-01F — Migration lifecycle predicate tests.
 *
 * Tests the production predicates from migration-lifecycle-predicates.ts
 * directly — no local duplicates, no expect(true).toBe(true).
 */
import { describe, it, expect } from "vitest";
import {
  getActionMatrix,
  canRegisterFile,
  canInsertStagingRow,
  canRunValidation,
  canRunReconciliation,
  canRecordOwnerApproval,
  canRecordAccountantApproval,
  canRecordBackupEvidence,
  canCommitBatch,
  canCreateCorrectionRequest,
  isReadOnly,
  isCommitted,
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

describe("WP-08-01F — Migration lifecycle predicates", () => {
  describe("Draft state", () => {
    const state = makeState({ status: "draft" });
    const matrix = getActionMatrix(state);
    it("can register file", () => expect(matrix.registerFile).toBe(true));
    it("can insert staging row", () => expect(matrix.insertStagingRow).toBe(true));
    it("cannot run validation (no rows)", () => expect(matrix.runValidation).toBe(false));
    it("cannot run reconciliation", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot commit", () => expect(matrix.commitBatch).toBe(false));
    it("cannot create correction", () => expect(matrix.createCorrectionRequest).toBe(false));
    it("is not read-only", () => expect(isReadOnly(state)).toBe(false));
  });

  describe("Staged state with rows", () => {
    const state = makeState({ status: "staged", stagedRowCount: 10 });
    const matrix = getActionMatrix(state);
    it("can register file", () => expect(matrix.registerFile).toBe(true));
    it("can insert staging row", () => expect(matrix.insertStagingRow).toBe(true));
    it("can run validation (has rows)", () => expect(matrix.runValidation).toBe(true));
    it("cannot run reconciliation", () => expect(matrix.runReconciliation).toBe(false));
    it("cannot approve (no hashes)", () => expect(matrix.recordOwnerApproval).toBe(false));
  });

  describe("Validation complete", () => {
    const state = makeState({
      status: "validation_complete",
      stagedRowCount: 10,
      stagedDataHash: "hash123",
      cutoverManifestHash: "manifest123",
    });
    const matrix = getActionMatrix(state);
    it("can run reconciliation", () => expect(matrix.runReconciliation).toBe(true));
    it("can register backup evidence", () => expect(matrix.recordBackupEvidence).toBe(true));
    it("can approve (hashes set, no blockers)", () => expect(matrix.recordOwnerApproval).toBe(true));
  });

  describe("Approved for commit", () => {
    const state = makeState({
      status: "approved_for_commit",
      stagedRowCount: 10,
      stagedDataHash: "hash123",
      cutoverManifestHash: "manifest123",
      hasOwnerApproval: true,
      hasAccountantApproval: true,
      hasBackupEvidence: true,
    });
    const matrix = getActionMatrix(state);
    it("can commit", () => expect(matrix.commitBatch).toBe(true));
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot insert staging row", () => expect(matrix.insertStagingRow).toBe(false));
  });

  describe("Committed (locked)", () => {
    const state = makeState({ status: "committed" });
    const matrix = getActionMatrix(state);
    it("can create correction request", () => expect(matrix.createCorrectionRequest).toBe(true));
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot insert staging row", () => expect(matrix.insertStagingRow).toBe(false));
    it("cannot run validation", () => expect(matrix.runValidation).toBe(false));
    it("cannot commit", () => expect(matrix.commitBatch).toBe(false));
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
    it("is committed", () => expect(isCommitted(state)).toBe(true));
  });

  describe("Rejected", () => {
    const state = makeState({ status: "rejected" });
    const matrix = getActionMatrix(state);
    it("cannot register file", () => expect(matrix.registerFile).toBe(false));
    it("cannot commit", () => expect(matrix.commitBatch).toBe(false));
    it("cannot create correction", () => expect(matrix.createCorrectionRequest).toBe(false));
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
  });

  describe("Cancelled", () => {
    const state = makeState({ status: "cancelled" });
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
  });

  describe("Committing", () => {
    const state = makeState({ status: "committing" });
    it("is read-only", () => expect(isReadOnly(state)).toBe(true));
    it("cannot approve", () => expect(canRecordOwnerApproval(state)).toBe(false));
  });

  describe("Blocking errors prevent approval", () => {
    const state = makeState({
      status: "validation_complete",
      stagedRowCount: 10,
      stagedDataHash: "hash",
      cutoverManifestHash: "manifest",
      blockingErrorCount: 1,
    });
    it("cannot approve with blocking errors", () => expect(canRecordOwnerApproval(state)).toBe(false));
  });

  describe("Unresolved warnings prevent commit", () => {
    const state = makeState({
      status: "approved_for_commit",
      stagedRowCount: 10,
      stagedDataHash: "hash",
      cutoverManifestHash: "manifest",
      hasOwnerApproval: true,
      hasAccountantApproval: true,
      hasBackupEvidence: true,
      warningCount: 5,
      acceptedWarningCount: 3,
    });
    it("cannot commit with unresolved warnings", () => expect(canCommitBatch(state)).toBe(false));
  });

  describe("Missing backup prevents commit", () => {
    const state = makeState({
      status: "approved_for_commit",
      stagedRowCount: 10,
      stagedDataHash: "hash",
      cutoverManifestHash: "manifest",
      hasOwnerApproval: true,
      hasAccountantApproval: true,
      hasBackupEvidence: false,
    });
    it("cannot commit without backup", () => expect(canCommitBatch(state)).toBe(false));
  });
});
