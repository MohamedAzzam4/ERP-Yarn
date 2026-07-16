/**
 * Historical Correction Repository — WP-07-05.
 *
 * Contract: docs/contracts/08_historical_migration_contract.md §8.11
 *   "Historical Locking and Correction"
 *
 * DEC-070: Post-commit historical correction requires renewed dual approval.
 *
 * Repository interface for historical_correction_requests table.
 * Non-operational for request creation/approval — operational effects only
 * during correction execution (through domain services).
 */
import "server-only";

import type {
  HistoricalCorrectionRequest,
  ImportBatch,
} from "@/server/db/schema/migration";

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewCorrectionRequestInput {
  tenantId: string;
  docNo: string;
  importBatchId: string;
  originalEntityType: string;
  originalEntityId: string;
  correctionType: "reversal" | "adjustment" | "new_corrected";
  reason: string;
  proposedCorrectionJson: Record<string, unknown> | null;
  impactAnalysisJson: Record<string, unknown> | null;
  createdBy: string;
}

export interface UpdateCorrectionApprovalInput {
  ownerApprovedBy: string;
  ownerApprovedAt: Date;
}

export interface UpdateCorrectionAccountantApprovalInput {
  accountantApprovedBy: string;
  accountantApprovedAt: Date;
}

export interface UpdateCorrectionStatusInput {
  status: string;
  updatedBy: string;
}

export interface UpdateCorrectionResultInput {
  correctedEntityType: string;
  correctedEntityId: string;
  status: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface HistoricalCorrectionRepository {
  // ---- Correction request CRUD ----
  insertCorrectionRequest(row: NewCorrectionRequestInput): Promise<HistoricalCorrectionRequest>;
  findCorrectionRequestById(tenantId: string, id: string): Promise<HistoricalCorrectionRequest | null>;
  findCorrectionRequestByDocNo(tenantId: string, docNo: string): Promise<HistoricalCorrectionRequest | null>;
  findCorrectionRequestsForBatch(tenantId: string, importBatchId: string): Promise<HistoricalCorrectionRequest[]>;
  findCorrectionRequestsForOriginal(
    tenantId: string,
    originalEntityType: string,
    originalEntityId: string,
  ): Promise<HistoricalCorrectionRequest[]>;
  updateCorrectionOwnerApproval(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionApprovalInput,
  ): Promise<HistoricalCorrectionRequest | null>;
  updateCorrectionAccountantApproval(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionAccountantApprovalInput,
  ): Promise<HistoricalCorrectionRequest | null>;
  updateCorrectionStatus(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionStatusInput,
  ): Promise<HistoricalCorrectionRequest | null>;
  updateCorrectionResult(
    tenantId: string,
    id: string,
    patch: UpdateCorrectionResultInput,
  ): Promise<HistoricalCorrectionRequest | null>;

  // ---- Batch access (read-only, for immutability checks) ----
  findImportBatchById(tenantId: string, id: string): Promise<ImportBatch | null>;
}

export type {
  HistoricalCorrectionRequest,
  ImportBatch,
} from "@/server/db/schema/migration";
