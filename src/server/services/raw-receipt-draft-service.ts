/**
 * Raw Receipt Draft Service — wire the approved worker reference screen to
 * real draft persistence/query safely.
 *
 * Contract: docs/contracts/13_work_packages.md WP-02-04
 *   Goal: Wire the approved worker reference to real draft persistence/query.
 *   Acceptance: Worker can record 1,000kg draft without financial fields and
 *   without stock posting.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §7.1
 *   Worker can create/update own draft, save, submit.
 *   Forbidden: approve/post/reverse, financial treatment.
 *
 * DEC-063: Worker financial-deny is absolute.
 * DEC-067: Workers cannot enter/see purchase price/payable.
 * WP-02-04: No movement/payable before approved transaction.
 *
 * WP-02-04 scope: draft CRUD + submit-for-review only.
 * No stock movement, no balance update, no account entry, no approval command.
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import {
  requirePermission,
  requireTenantMatch,
  rejectBodyClaimsAuthority,
} from "@/server/security/guards";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Domain types.
// ---------------------------------------------------------------------------

export type RawReceiptDraftStatus = "draft" | "submitted";

export interface RawReceiptDraft {
  id: string;
  tenantId: string;
  batchNo: string;
  supplierId: string | null;
  supplierReference: string | null;
  fiberTypeAr: string | null;
  rawGradeAr: string | null;
  originCountry: string | null;
  season: string | null;
  balesCount: string | null;
  grossWeightKg: string | null;
  netWeightKg: string;
  receivedDate: string;
  storageLocationId: string | null;
  storageLocationName: string | null;
  purchaseOrderRef: string | null;
  notes: string | null;
  status: RawReceiptDraftStatus;
  approvalStatus: string;
  subjectVersion: number;
  subjectHash: string | null;
  createdBy: string | null;
  createdAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Service error types.
// ---------------------------------------------------------------------------

export class RawReceiptDraftError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RawReceiptDraftError";
    this.code = code;
  }
}

export class DraftNotFoundError extends RawReceiptDraftError {
  constructor(id: string) {
    super("DRAFT_NOT_FOUND", `Raw receipt draft '${id}' not found.`);
    this.name = "DraftNotFoundError";
  }
}

export class DraftAlreadySubmittedError extends RawReceiptDraftError {
  constructor(id: string) {
    super("DRAFT_ALREADY_SUBMITTED", `Draft '${id}' is already submitted and cannot be modified.`);
    this.name = "DraftAlreadySubmittedError";
  }
}

export class ValidationFailedDraftError extends RawReceiptDraftError {
  constructor(message: string) {
    super("VALIDATION_FAILED", message);
    this.name = "ValidationFailedDraftError";
  }
}

// ---------------------------------------------------------------------------
// Transaction handle — abstract persistence interface.
// ---------------------------------------------------------------------------

export interface RawReceiptDraftRepository {
  insertDraft(row: NewDraftInput): Promise<RawReceiptDraft>;
  updateDraft(tenantId: string, id: string, patch: UpdateDraftInput): Promise<RawReceiptDraft | null>;
  findDraftById(tenantId: string, id: string): Promise<RawReceiptDraft | null>;
  findDraftByBatchNo(tenantId: string, batchNo: string): Promise<RawReceiptDraft | null>;
  listDraftsByTenant(tenantId: string, status?: RawReceiptDraftStatus): Promise<RawReceiptDraft[]>;
  updateDraftStatus(tenantId: string, id: string, status: RawReceiptDraftStatus, approvalStatus: string, subjectVersion: number, subjectHash: string): Promise<RawReceiptDraft | null>;
}

// ---------------------------------------------------------------------------
// Input types.
// ---------------------------------------------------------------------------

export interface NewDraftInput {
  tenantId: string;
  batchNo: string;
  supplierId: string | null;
  supplierReference: string | null;
  fiberTypeAr: string | null;
  rawGradeAr: string | null;
  originCountry: string | null;
  season: string | null;
  balesCount: string | null;
  grossWeightKg: string | null;
  netWeightKg: string;
  receivedDate: string;
  storageLocationId: string | null;
  storageLocationName: string | null;
  purchaseOrderRef: string | null;
  notes: string | null;
  createdBy: string;
}

export interface UpdateDraftInput {
  supplierId?: string | null;
  supplierReference?: string | null;
  fiberTypeAr?: string | null;
  rawGradeAr?: string | null;
  originCountry?: string | null;
  season?: string | null;
  balesCount?: string | null;
  grossWeightKg?: string | null;
  netWeightKg?: string;
  receivedDate?: string;
  storageLocationId?: string | null;
  storageLocationName?: string | null;
  purchaseOrderRef?: string | null;
  notes?: string | null;
  updatedBy: string;
}

export interface CreateDraftInput {
  batchNo: string;
  supplierId?: string | null;
  supplierReference?: string | null;
  fiberTypeAr?: string | null;
  rawGradeAr?: string | null;
  originCountry?: string | null;
  season?: string | null;
  balesCount?: string | null;
  grossWeightKg?: string | null;
  netWeightKg: string;
  receivedDate: string;
  storageLocationId?: string | null;
  storageLocationName?: string | null;
  purchaseOrderRef?: string | null;
  notes?: string | null;
}

export interface SubmitDraftResult {
  draftId: string;
  status: RawReceiptDraftStatus;
  approvalStatus: string;
  subjectVersion: number;
  subjectHash: string;
}

// ---------------------------------------------------------------------------
// Subject hash computation (Contract 03 §7.6).
// ---------------------------------------------------------------------------

/**
 * Compute the subject hash from the approval-relevant operational fields.
 *
 * Contract 03 §7.6: "Approval submission computes the subject hash
 * server-side from the exact approval-relevant persisted fields."
 *
 * The hash covers operational facts ONLY (never financial fields).
 * Any material change to these fields invalidates a pending approval.
 */
export function computeSubjectHash(draft: RawReceiptDraft): string {
  const fields = [
    draft.batchNo,
    draft.supplierId ?? "",
    draft.netWeightKg,
    draft.grossWeightKg ?? "",
    draft.balesCount ?? "",
    draft.receivedDate,
    draft.storageLocationId ?? "",
    draft.fiberTypeAr ?? "",
    draft.rawGradeAr ?? "",
    draft.season ?? "",
  ];
  const json = JSON.stringify(fields);
  return createHash("sha256").update(json).digest("hex");
}

// ---------------------------------------------------------------------------
// Raw Receipt Draft Service.
// ---------------------------------------------------------------------------

export interface RawReceiptDraftServiceDeps {
  repository: RawReceiptDraftRepository;
  audit: AuditTransactionHandle;
}

export class RawReceiptDraftService {
  constructor(private readonly deps: RawReceiptDraftServiceDeps) {}

  /**
   * Create a new raw receipt draft.
   *
   * Permission: inventory.receive.create (warehouse_employee only).
   * Worker redaction: rejectForbiddenWorkerFields is called by the caller
   * (route handler) before invoking the service. The service also validates
   * that no financial fields are present in the input.
   */
  async createDraft(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateDraftInput,
  ): Promise<RawReceiptDraft> {
    requirePermission(effective, "inventory.receive.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Validate operational facts
    if (!input.batchNo || input.batchNo.trim() === "") {
      throw new ValidationFailedDraftError("Batch number is required.");
    }
    if (!input.netWeightKg || parseFloat(input.netWeightKg) <= 0) {
      throw new ValidationFailedDraftError("Net weight must be positive.");
    }
    if (!input.receivedDate) {
      throw new ValidationFailedDraftError("Received date is required.");
    }

    // Check for duplicate batch number within tenant
    const existing = await this.deps.repository.findDraftByBatchNo(user.tenantId, input.batchNo);
    if (existing) {
      throw new ValidationFailedDraftError(`Batch number '${input.batchNo}' already exists in this tenant.`);
    }

    const row: NewDraftInput = {
      tenantId: user.tenantId,
      batchNo: input.batchNo,
      supplierId: input.supplierId ?? null,
      supplierReference: input.supplierReference ?? null,
      fiberTypeAr: input.fiberTypeAr ?? null,
      rawGradeAr: input.rawGradeAr ?? null,
      originCountry: input.originCountry ?? null,
      season: input.season ?? null,
      balesCount: input.balesCount ?? null,
      grossWeightKg: input.grossWeightKg ?? null,
      netWeightKg: input.netWeightKg,
      receivedDate: input.receivedDate,
      storageLocationId: input.storageLocationId ?? null,
      storageLocationName: input.storageLocationName ?? null,
      purchaseOrderRef: input.purchaseOrderRef ?? null,
      notes: input.notes ?? null,
      createdBy: user.userId,
    };

    const draft = await this.deps.repository.insertDraft(row);

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "raw_receipt_draft",
      entityId: draft.id,
      actionType: "raw_receipt_draft.create",
      newValuesJson: {
        batchNo: draft.batchNo,
        netWeightKg: draft.netWeightKg,
        receivedDate: draft.receivedDate,
        status: draft.status,
      },
    });

    return draft;
  }

  /**
   * Update an existing draft.
   *
   * Only drafts with status="draft" can be updated.
   * Submitted drafts are read-only (must cancel/re-submit).
   */
  async updateDraft(
    user: ErpUserContext,
    effective: EffectivePermissions,
    draftId: string,
    input: UpdateDraftInput,
  ): Promise<RawReceiptDraft> {
    requirePermission(effective, "inventory.receive.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    const existing = await this.deps.repository.findDraftById(user.tenantId, draftId);
    if (!existing) {
      throw new DraftNotFoundError(draftId);
    }
    requireTenantMatch(user, existing.tenantId);

    if (existing.status !== "draft") {
      throw new DraftAlreadySubmittedError(draftId);
    }

    const updated = await this.deps.repository.updateDraft(user.tenantId, draftId, {
      ...input,
      updatedBy: user.userId,
    });

    if (!updated) {
      throw new DraftNotFoundError(draftId);
    }

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "raw_receipt_draft",
      entityId: updated.id,
      actionType: "raw_receipt_draft.update",
      oldValuesJson: { status: existing.status },
      newValuesJson: { status: updated.status, netWeightKg: updated.netWeightKg },
    });

    return updated;
  }

  /**
   * Read a draft by ID.
   *
   * Workers can read their own drafts. Management can read any draft.
   * The response DTO must be role-filtered (worker redaction).
   */
  async readDraft(
    user: ErpUserContext,
    effective: EffectivePermissions,
    draftId: string,
  ): Promise<RawReceiptDraft> {
    requirePermission(effective, "inventory.receive.create");

    const draft = await this.deps.repository.findDraftById(user.tenantId, draftId);
    if (!draft) {
      throw new DraftNotFoundError(draftId);
    }
    requireTenantMatch(user, draft.tenantId);
    return draft;
  }

  /**
   * List drafts by tenant.
   */
  async listDrafts(
    user: ErpUserContext,
    effective: EffectivePermissions,
    status?: RawReceiptDraftStatus,
  ): Promise<RawReceiptDraft[]> {
    requirePermission(effective, "inventory.receive.create");
    return this.deps.repository.listDraftsByTenant(user.tenantId, status);
  }

  /**
   * Submit a draft for review.
   *
   * This transitions the draft from "draft" to "submitted" and computes
   * the subject hash + version for approval binding (Contract 03 §7.6).
   *
   * This does NOT:
   * - Post stock movements (that's WP-02-05 InventoryLedgerService)
   * - Create account entries (that's WP-02-05 SubledgerService)
   * - Approve anything (workers cannot approve per DEC-080)
   */
  async submitDraft(
    user: ErpUserContext,
    effective: EffectivePermissions,
    draftId: string,
  ): Promise<SubmitDraftResult> {
    requirePermission(effective, "inventory.receive.create");

    const existing = await this.deps.repository.findDraftById(user.tenantId, draftId);
    if (!existing) {
      throw new DraftNotFoundError(draftId);
    }
    requireTenantMatch(user, existing.tenantId);

    if (existing.status !== "draft") {
      throw new DraftAlreadySubmittedError(draftId);
    }

    // Compute subject hash from approval-relevant operational fields
    const subjectHash = computeSubjectHash(existing);
    const subjectVersion = 1;

    const updated = await this.deps.repository.updateDraftStatus(
      user.tenantId,
      draftId,
      "submitted",
      "pending_approval",
      subjectVersion,
      subjectHash,
    );

    if (!updated) {
      throw new DraftNotFoundError(draftId);
    }

    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: "raw_receipt_draft",
      entityId: updated.id,
      actionType: "raw_receipt_draft.submit",
      oldValuesJson: { status: existing.status, approvalStatus: existing.approvalStatus },
      newValuesJson: {
        status: updated.status,
        approvalStatus: updated.approvalStatus,
        subjectVersion,
        subjectHash,
      },
    });

    return {
      draftId: updated.id,
      status: updated.status,
      approvalStatus: updated.approvalStatus,
      subjectVersion,
      subjectHash,
    };
  }
}
