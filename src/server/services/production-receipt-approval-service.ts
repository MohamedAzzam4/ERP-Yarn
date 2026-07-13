/**
 * Production Receipt Approval Service — WP-04-03.
 *
 * Contract: docs/contracts/13_work_packages.md WP-04-03
 *   Goal: Approve one receipt by atomically posting output lot/stock,
 *   waste, WIP consumption, input-based factory payable, order state and
 *   audit.
 *   Inputs: Current-hash receipt draft/allocation and confirmed rate.
 *   Expected outputs: Dedicated approval command, output lot/movements,
 *   WIP/waste updates, rate/cost snapshot, SubledgerService payable,
 *   order/receipt state and audit.
 *   Implementation notes: One outer transaction coordinates
 *   ProductionPostingService, InventoryLedgerService and SubledgerService;
 *   decimal high precision then ROUND_HALF_UP at posting.
 *   Acceptance: Each receipt creates all exact effects together or none;
 *   one source payable and immutable original.
 *   Dependencies: WP-04-02 and DEC-080.
 *   What not to change: No payable at transfer/issue or live recalculation.
 *
 * Contract: docs/contracts/05_production_wip_contract.md §§14–18
 *   §14 Approval transaction (10 steps):
 *     1. lock production order, receipt, input/WIP, output balance, factory
 *        account, sequence, approval/idempotency rows
 *     2. validate sufficient WIP and no duplicate receipt
 *     3. create output item/lot if new
 *     4. post receive_from_production movement and output on-hand
 *     5. reduce WIP by input consumed toward output
 *     6. post waste and reduce WIP separately
 *     7. create factory payable for the receipt cost basis
 *     8. update totals/state
 *     9. write approval and audit
 *    10. commit all or nothing
 *   §15 Waste: explicit, linked, removed from WIP, does NOT reduce payable.
 *   §16 Partial receipts: each receipt has its own allocation + payable;
 *     system MUST prevent double allocation/payable across partials.
 *   §17 Rate snapshot fields are mandatory and immutable after approval.
 *   §18 Factory payable: only on approved output receipt (not transfer/issue).
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §6, §11
 *   11-step universal approval contract:
 *     1. derive tenant/user
 *     2. check permission
 *     3. validate request
 *     4. check state + subject hash
 *     5. claim/replay idempotency
 *     6. start transaction
 *     7. lock entity + affected rows in deterministic order
 *     8. recheck preconditions under lock
 *     9. perform all writes
 *    10. record decision + audit in same transaction
 *    11. commit once
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §12
 *   Factory Payable on Production Receipt:
 *   - Payable recognized ONLY on approved output receipt.
 *   - cost_basis_input_qty_kg = consumed_toward_output_qty + waste_qty
 *   - factory_payable = cost_basis_input_qty_kg / 1000 × confirmed_rate
 *   - Each receipt creates ONE unique negative factory entry.
 *   - Waste does NOT reduce payable.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §8, §10, §14
 *   - InventoryLedgerService is the SOLE owner of posted stock movements.
 *   - Movement matrix: receive_from_production → output location +output_qty;
 *     production_waste → metadata-only (no on_hand change; WIP -waste_qty
 *     handled separately via WipBalanceRepository).
 *
 * DEC-013: Factory payable is created only on approved production output
 *   receipt — not on material transfer or issue.
 * DEC-014: Rate/rule values used by approved transactions are snapshotted.
 *   Changing factory defaults never recalculates approved receipts.
 * DEC-080: Requester cannot approve their own high-risk request in MVP.
 *   Owner and Accountant may approve, but neither may approve their own.
 *   Workers cannot approve financial/stock-impacting transactions.
 *
 * WP-04-03 SCOPE:
 *   - Approve a production receipt draft (created by WP-04-02)
 *   - Atomically post:
 *     * receive_from_production movement (output on-hand increase)
 *     * production_waste movements (metadata-only; one per allocation w/ waste>0)
 *     * production_waste_entries rows (one per allocation w/ waste>0)
 *     * production_wip_balances decrement (per allocation: consumed + waste)
 *     * production_inputs.consumed_qty / remaining_wip_qty update
 *     * production_outputs row create-or-link (with receipt_movement_id)
 *     * account_entries row (factory_production_payable, NEGATIVE signed)
 *     * production_receipts state transition (status, approval_status, locked)
 *     * production_orders state transition (material_issued → partially_received|completed)
 *     * audit_logs row (inside the same transaction)
 *   - All effects in ONE Drizzle transaction; any failure rolls back ALL.
 *   - Idempotent: same key+request replays; same key+different-request = conflict;
 *     different key on already-approved = STATE_CONFLICT.
 *
 * WP-04-03 NON-SCOPE (deferred):
 *   - Receipt reversal/correction (separate WP)
 *   - Payment/settlement of the factory payable
 *   - Yarn lot creation when output_lot_id is null (the draft service may
 *     create the lot; if not, the receipt's output_item_id is used directly
 *     and the lot is left null — this is consistent with WP-04-02 which
 *     treats output_lot_id as optional)
 *   - API route handler (the service shape supports it, but the route is
 *     deferred — Composition root wires the service)
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
import {
  claimIdempotency,
  markSucceeded,
  markBusinessFailed,
  type IdempotencyTransactionHandle,
  type IdempotencyClaimInput,
} from "./idempotency-service";
import type { InventoryLedgerService, PostRawReceiptResult } from "./inventory-ledger-service";
import type { SubledgerService, PostFactoryPayableResult } from "./subledger-service";
import type {
  ProductionReceiptRepository,
  ReceiptApprovalPatch,
} from "./production-receipt-repository";
import type { ProductionOrderRepository } from "./production-order-repository";
import type { WipBalanceRepository } from "./wip-balance-repository";
import type { ProductionReceipt, ProductionReceiptInputAllocation } from "@/server/db/schema/production-receipts";
import type { ProductionOrder, ProductionInput } from "@/server/db/schema/production-orders";
import { addKg, compareKg, isPositiveKg, normalizeKg, subtractKg } from "./decimal-kg";
import { calculateFactoryPayable, isPositiveMoney, normalizeMoney } from "./decimal-money";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface ApproveReceiptInput {
  /** The production receipt draft ID to approve. */
  receiptId: string;
  /** Optional decision notes / reason. */
  decisionNotes?: string | null;
  /** Idempotency key (required for the atomic posting). */
  idempotencyKey: string;
}

export interface ApproveReceiptResult {
  action: "posted" | "replayed";
  receiptId: string;
  docNo: string;
  receiptStatus: string;
  receiptApprovalStatus: string;
  /** receive_from_production movement ID + doc_no. */
  receiptMovementId: string;
  receiptMovementDocNo: string;
  /** Output on-hand after the receive movement (NUMERIC(18,3) string). */
  outputOnHandQtyKg: string;
  /** Number of waste movements posted (one per allocation with waste > 0). */
  wasteMovementCount: number;
  /** Total waste kg across all allocations (NUMERIC(18,3) string). */
  totalWasteQtyKg: string;
  /** Total consumed-toward-output kg (NUMERIC(18,3) string). */
  totalConsumedQtyKg: string;
  /** Total payable basis kg = consumed + waste (NUMERIC(18,3) string). */
  factoryCostBasisInputQtyKg: string;
  /** Factory rate per input ton used (snapshotted, NUMERIC(18,2) string). */
  factoryRatePerInputTonUsed: string;
  /** Factory payable amount (positive, NUMERIC(18,2) string). */
  factoryPayable: string;
  /** Subledger account entry ID (factory_production_payable, negative signed). */
  accountEntryId: string;
  /** Subledger account entry number (e.g., AE-2026-000001). */
  accountEntryNo: string;
  /** Subledger amount_signed (negative for payable). */
  accountAmountSigned: string;
  /** Production order status after the approval. */
  orderStatusAfter: string;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class ProductionReceiptApprovalError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProductionReceiptApprovalError";
    this.code = code;
  }
}

export class ReceiptNotFoundError extends ProductionReceiptApprovalError {
  constructor(id: string) {
    super("RECEIPT_NOT_FOUND", `Production receipt '${id}' not found.`);
    this.name = "ReceiptNotFoundError";
  }
}

export class ProductionOrderNotFoundForApprovalError extends ProductionReceiptApprovalError {
  constructor(id: string) {
    super("PRODUCTION_ORDER_NOT_FOUND", `Production order '${id}' not found.`);
    this.name = "ProductionOrderNotFoundForApprovalError";
  }
}

export class ReceiptAlreadyApprovedError extends ProductionReceiptApprovalError {
  constructor(id: string, status: string, approvalStatus: string) {
    super(
      "STATE_CONFLICT",
      `Receipt '${id}' is already in status '${status}' / approval '${approvalStatus}' — cannot approve twice.`,
    );
    this.name = "ReceiptAlreadyApprovedError";
  }
}

export class OrderNotReadyForApprovalError extends ProductionReceiptApprovalError {
  constructor(orderId: string, status: string) {
    super(
      "ORDER_NOT_READY",
      `Order '${orderId}' is in status '${status}' — must be 'material_issued' or 'partially_received' to approve a receipt.`,
    );
    this.name = "OrderNotReadyForApprovalError";
  }
}

export class SubjectHashMismatchError extends ProductionReceiptApprovalError {
  constructor(receiptId: string) {
    super(
      "SUBJECT_CHANGED",
      `Subject hash mismatch for receipt '${receiptId}'. The draft facts changed after the receipt was created. The receipt must be rejected and a new draft submitted.`,
    );
    this.name = "SubjectHashMismatchError";
  }
}

export class RequesterCannotApproveOwnReceiptError extends ProductionReceiptApprovalError {
  constructor(receiptId: string, userId: string) {
    super(
      "REQUESTER_CANNOT_APPROVE_OWN",
      `User '${userId}' cannot approve receipt '${receiptId}' because they are the requester. DEC-080: a requester cannot approve their own high-risk request in MVP.`,
    );
    this.name = "RequesterCannotApproveOwnReceiptError";
  }
}

export class WipInsufficientError extends ProductionReceiptApprovalError {
  constructor(inputId: string, required: string, available: string) {
    super(
      "WIP_INSUFFICIENT",
      `Insufficient WIP for input '${inputId}': required ${required} kg, available ${available} kg.`,
    );
    this.name = "WipInsufficientError";
  }
}

export class MissingFactoryRateError extends ProductionReceiptApprovalError {
  constructor(receiptId: string) {
    super(
      "VALIDATION_FAILED",
      `Receipt '${receiptId}' has no confirmed factory rate (factory_rate_per_input_ton_used is null). ` +
        `The Accountant/Owner must confirm the rate before the receipt can be approved (DEC-014).`,
    );
    this.name = "MissingFactoryRateError";
  }
}

export class AllocationNotFoundError extends ProductionReceiptApprovalError {
  constructor(receiptId: string) {
    super(
      "VALIDATION_FAILED",
      `Receipt '${receiptId}' has no input allocations. At least one allocation is required to approve.`,
    );
    this.name = "AllocationNotFoundError";
  }
}

export class ReceiptInputMismatchError extends ProductionReceiptApprovalError {
  constructor(receiptId: string, inputId: string) {
    super(
      "VALIDATION_FAILED",
      `Receipt '${receiptId}' allocation references input '${inputId}' that does not belong to the receipt's production order.`,
    );
    this.name = "ReceiptInputMismatchError";
  }
}

// ---------------------------------------------------------------------------
// Transaction runner + factories (mirrors raw-receipt-approval-service).
// ---------------------------------------------------------------------------

export type ProductionReceiptApprovalTransactionRunner = <T>(
  work: (tx: unknown) => Promise<T>,
) => Promise<T>;

export interface ProductionReceiptApprovalTransactionScopedFactories {
  createInventoryLedger: (tx: unknown) => InventoryLedgerService;
  createSubledger: (tx: unknown) => SubledgerService;
  createReceiptRepository: (tx: unknown) => ProductionReceiptRepository;
  createProductionOrderRepository: (tx: unknown) => ProductionOrderRepository;
  createWipBalanceRepository: (tx: unknown) => WipBalanceRepository;
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface ProductionReceiptApprovalServiceDeps {
  receiptRepository: ProductionReceiptRepository;
  productionOrderRepository: ProductionOrderRepository;
  wipBalanceRepository: WipBalanceRepository;
  inventoryLedger: InventoryLedgerService;
  subledger: SubledgerService;
  audit: AuditTransactionHandle;
  idempotency: IdempotencyTransactionHandle;
  /**
   * Optional transaction runner. When provided, all DB writes in
   * `approveReceipt` are wrapped in a single DB transaction. When absent
   * (unit tests with in-memory repos), services run without a DB transaction
   * boundary — in-memory repos don't persist partial state across processes.
   */
  transactionRunner?: ProductionReceiptApprovalTransactionRunner;
  txFactories?: ProductionReceiptApprovalTransactionScopedFactories;
}

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

const RECEIPT_ENTITY_TYPE = "production_receipt";
const SOURCE_DOC_TYPE_PRODUCTION_RECEIPT = "production_receipt";
const CALCULATION_VERSION = "v1";
// Approvable receipt statuses (production_status enum values, Contract 03 §6).
// A receipt is approvable only when status='draft' (the initial state set by
// WP-04-02 draft creation). The 'pending_approval' value is an approval_status
// enum value, NOT a production_status — it is NOT included here.
const APPROVABLE_RECEIPT_STATUSES = ["draft"] as const;
const APPROVABLE_ORDER_STATUSES = ["material_issued", "partially_received"] as const;

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Recompute the subject hash for a receipt draft, mirroring the WP-04-02
 * draft service. Used to detect post-creation mutation of the draft facts.
 *
 * Contract 06 §6 step 4: "verify subject version/hash match."
 */
function recomputeSubjectHash(
  receipt: ProductionReceipt,
  allocations: ProductionReceiptInputAllocation[],
): string {
  const subjectFields = [
    receipt.productionOrderId,
    receipt.outputItemId,
    receipt.outputLotId ?? "",
    receipt.outputLocationId,
    normalizeKg(receipt.outputQtyKg),
    receipt.receiptDate,
    ...allocations.flatMap((a) => [
      a.productionInputId,
      normalizeKg(a.consumedTowardOutputQtyKg),
      normalizeKg(a.allocatedWasteQtyKg),
    ]),
    receipt.factoryRatePerInputTonUsed ?? "",
    receipt.factoryCostBasisUsed,
  ];
  return createHash("sha256").update(JSON.stringify(subjectFields)).digest("hex");
}

// ---------------------------------------------------------------------------
// ProductionReceiptApprovalService.
// ---------------------------------------------------------------------------

/**
 * WP-04-03 Production Receipt Approval Service.
 *
 * Composes WP-04-02 receipt repository + WP-04-01 WIP repository +
 * InventoryLedgerService (receive_from_production + production_waste) +
 * SubledgerService (factory_production_payable) to atomically approve and
 * post a production receipt with all its effects in one transaction.
 */
export class ProductionReceiptApprovalService {
  constructor(private readonly deps: ProductionReceiptApprovalServiceDeps) {}

  /**
   * Approve a production receipt: atomically post output + waste + WIP
   * decrease + factory payable + state transition + audit.
   *
   * Universal Approval Contract (Contract 06 §6):
   *   - derive tenant/user from authenticated server context
   *   - check permission (production.approve)
   *   - validate request + subject hash match
   *   - claim idempotency
   *   - lock receipt/order/WIP/output balance/factory account
   *   - recheck preconditions under lock
   *   - perform all stock/WIP/subledger/state writes
   *   - record approval decision + success audit in same transaction
   *   - commit once and return deterministic result
   *
   * DEC-080: requester cannot approve own request. Enforced by comparing
   * receipt.createdBy against the approver's userId.
   */
  async approveReceipt(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: ApproveReceiptInput,
  ): Promise<ApproveReceiptResult> {
    // Step 1-2: permission + reject body authority.
    requirePermission(effective, "production.approve");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Step 3: validate input.
    if (!input.receiptId || input.receiptId.trim() === "") {
      throw new ProductionReceiptApprovalError("VALIDATION_FAILED", "receiptId is required.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new ProductionReceiptApprovalError("VALIDATION_FAILED", "idempotencyKey is required.");
    }

    // Step 4: fetch receipt (for state check + subject hash).
    const receipt = await this.deps.receiptRepository.findReceiptById(user.tenantId, input.receiptId);
    if (!receipt) {
      throw new ReceiptNotFoundError(input.receiptId);
    }
    requireTenantMatch(user, receipt.tenantId);

    // Step 5: claim idempotency FIRST (before any state mutation).
    const now = new Date();
    const idempotencyInput: IdempotencyClaimInput = {
      tenantId: user.tenantId,
      operationScope: "production_receipt.approve",
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        receiptId: input.receiptId,
        decisionNotes: input.decisionNotes ?? null,
      } as Record<string, unknown>,
      initiatedBy: user.userId,
      leaseDurationMs: 30000,
      now,
    };

    const claim = await claimIdempotency(this.deps.idempotency, idempotencyInput);

    if (claim.action === "replay") {
      // Prior call with same key succeeded — return the stored result.
      const responseBody = claim.record.responseBody as Partial<ApproveReceiptResult> | null;
      if (responseBody && responseBody.receiptId) {
        // Spread FIRST, then override `action` so the stored "posted" doesn't win.
        return { ...responseBody, action: "replayed" } as ApproveReceiptResult;
      }
      // Fall through to execute if replay but no stored result body.
    }

    if (claim.action === "conflict") {
      throw new ProductionReceiptApprovalError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key '${input.idempotencyKey}' was used with a different request body.`,
      );
    }

    if (claim.action === "in_progress") {
      throw new ProductionReceiptApprovalError(
        "OPERATION_IN_PROGRESS",
        `Operation '${input.idempotencyKey}' is still in progress.`,
      );
    }

    // claim.action === "execute" — fresh call. Now check business preconditions.

    // State check: receipt must be in an approvable state and not locked.
    if (!APPROVABLE_RECEIPT_STATUSES.includes(receipt.status as (typeof APPROVABLE_RECEIPT_STATUSES)[number])) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Receipt in status '${receipt.status}' cannot be approved.` },
        lastErrorClass: "ReceiptAlreadyApprovedError",
      }, now);
      throw new ReceiptAlreadyApprovedError(receipt.id, receipt.status, receipt.approvalStatus);
    }
    if (receipt.isLocked) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Receipt is already locked." },
        lastErrorClass: "ReceiptAlreadyApprovedError",
      }, now);
      throw new ReceiptAlreadyApprovedError(receipt.id, receipt.status, receipt.approvalStatus);
    }

    // DEC-080: requester cannot approve own request.
    // receipt.createdBy is the user who created the draft (typically a Production worker).
    if (receipt.createdBy && receipt.createdBy === user.userId) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 403,
        responseBody: { message: "Requester cannot approve own receipt." },
        lastErrorClass: "RequesterCannotApproveOwnReceiptError",
      }, now);
      throw new RequesterCannotApproveOwnReceiptError(receipt.id, user.userId);
    }

    // Fetch allocations + recompute subject hash.
    const allocations = await this.deps.receiptRepository.findAllocationsByReceipt(
      user.tenantId,
      receipt.id,
    );
    if (allocations.length === 0) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: "Receipt has no allocations." },
        lastErrorClass: "AllocationNotFoundError",
      }, now);
      throw new AllocationNotFoundError(receipt.id);
    }

    const currentSubjectHash = recomputeSubjectHash(receipt, allocations);
    if (currentSubjectHash !== receipt.subjectHash) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: "Subject hash mismatch — draft facts changed." },
        lastErrorClass: "SubjectHashMismatchError",
      }, now);
      throw new SubjectHashMismatchError(receipt.id);
    }

    // Fetch the production order (must be in material_issued or partially_received).
    const order = await this.deps.productionOrderRepository.findOrderById(
      user.tenantId,
      receipt.productionOrderId,
    );
    if (!order) {
      throw new ProductionOrderNotFoundForApprovalError(receipt.productionOrderId);
    }
    requireTenantMatch(user, order.tenantId);

    if (!APPROVABLE_ORDER_STATUSES.includes(order.status as (typeof APPROVABLE_ORDER_STATUSES)[number])) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 409,
        responseBody: { message: `Order in status '${order.status}' cannot receive receipts.` },
        lastErrorClass: "OrderNotReadyForApprovalError",
      }, now);
      throw new OrderNotReadyForApprovalError(order.id, order.status);
    }

    // Rate snapshot must be present (DEC-014). Without a confirmed rate,
    // we cannot calculate the factory payable.
    if (!receipt.factoryRatePerInputTonUsed || !isPositiveMoney(receipt.factoryRatePerInputTonUsed)) {
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 422,
        responseBody: { message: "Receipt has no confirmed factory rate." },
        lastErrorClass: "MissingFactoryRateError",
      }, now);
      throw new MissingFactoryRateError(receipt.id);
    }
    const factoryRate = receipt.factoryRatePerInputTonUsed;

    // Fetch production inputs for the order — used for input-level updates
    // (consumed_qty, remaining_wip_qty) and for the WIP balance lookup key.
    const orderInputs = await this.deps.productionOrderRepository.findInputsByOrder(
      user.tenantId,
      order.id,
    );
    const inputMap = new Map<string, ProductionInput>();
    for (const inp of orderInputs) inputMap.set(inp.id, inp);

    // Validate every allocation references a real input on this order.
    for (const alloc of allocations) {
      if (!inputMap.has(alloc.productionInputId)) {
        await markBusinessFailed(this.deps.idempotency, claim.record.id, {
          responseCode: 422,
          responseBody: { message: `Allocation references unknown input '${alloc.productionInputId}'.` },
          lastErrorClass: "ReceiptInputMismatchError",
        }, now);
        throw new ReceiptInputMismatchError(receipt.id, alloc.productionInputId);
      }
    }

    // =====================================================================
    // ATOMIC POSTING TRANSACTION (Contract 06 §6, §11; Contract 05 §14)
    // =====================================================================
    // All DB writes (stock movements, inventory balances, account entries,
    // waste entries, WIP balances, production_inputs, production_outputs,
    // production_receipts, production_orders, audit_logs) MUST commit or
    // roll back together.
    // =====================================================================

    const executePosting = async (
      txScoped: {
        inventoryLedger: InventoryLedgerService;
        subledger: SubledgerService;
        receiptRepository: ProductionReceiptRepository;
        productionOrderRepository: ProductionOrderRepository;
        wipBalanceRepository: WipBalanceRepository;
      } | null,
    ): Promise<ApproveReceiptResult> => {
      const invLedger = txScoped?.inventoryLedger ?? this.deps.inventoryLedger;
      const subledger = txScoped?.subledger ?? this.deps.subledger;
      const receiptRepo = txScoped?.receiptRepository ?? this.deps.receiptRepository;
      const orderRepo = txScoped?.productionOrderRepository ?? this.deps.productionOrderRepository;
      const wipRepo = txScoped?.wipBalanceRepository ?? this.deps.wipBalanceRepository;

      // -----------------------------------------------------------------
      // Step 9a (PRE-VALIDATION): Lock + recheck WIP for ALL allocations
      // BEFORE posting any movement. Contract 06 §6 step 8: "recheck all
      // business preconditions under lock." This ensures WIP_INSUFFICIENT
      // fails fast WITHOUT having posted the receive movement — no partial
      // effects to roll back.
      // -----------------------------------------------------------------
      // Deterministic lock order: allocations sorted by productionInputId.
      const sortedAllocations = [...allocations].sort((a, b) =>
        a.productionInputId < b.productionInputId ? -1 : a.productionInputId > b.productionInputId ? 1 : 0,
      );

      // Pre-validate WIP sufficiency for every allocation.
      for (const alloc of sortedAllocations) {
        const prodInput = inputMap.get(alloc.productionInputId)!;
        const consumed = normalizeKg(alloc.consumedTowardOutputQtyKg);
        const waste = normalizeKg(alloc.allocatedWasteQtyKg);
        const decrement = addKg(consumed, waste);

        const wipBalance = await wipRepo.findForUpdate(
          user.tenantId,
          order.id,
          prodInput.inputItemId,
          order.factoryLocationId,
        );
        if (!wipBalance) {
          throw new WipInsufficientError(prodInput.id, decrement, "0.000");
        }
        if (compareKg(wipBalance.wipQtyKg, decrement) < 0) {
          throw new WipInsufficientError(prodInput.id, decrement, wipBalance.wipQtyKg);
        }
      }

      // -----------------------------------------------------------------
      // Step 9b: Post receive_from_production movement (output on-hand +qty).
      // -----------------------------------------------------------------
      const receiveResult: PostRawReceiptResult = await invLedger.postReceiveFromProduction(
        user,
        effective,
        {
          itemId: receipt.outputItemId,
          toLocationId: receipt.outputLocationId,
          quantityKg: receipt.outputQtyKg,
          movementDate: receipt.receiptDate,
          sourceDocumentType: SOURCE_DOC_TYPE_PRODUCTION_RECEIPT,
          sourceDocumentId: receipt.id,
          idempotencyKey: `${input.idempotencyKey}:receive`,
          notes: input.decisionNotes ?? undefined,
        },
      );

      // -----------------------------------------------------------------
      // Step 9c: Per-allocation — post waste movement + insert waste_entry
      //          + decrement WIP + update production_inputs.
      // -----------------------------------------------------------------
      let totalWasteQty = "0.000";
      let totalConsumedQty = "0.000";
      let totalPayableBasisQty = "0.000";
      let wasteMovementCount = 0;

      for (const alloc of sortedAllocations) {
        const prodInput = inputMap.get(alloc.productionInputId)!;
        const consumed = normalizeKg(alloc.consumedTowardOutputQtyKg);
        const waste = normalizeKg(alloc.allocatedWasteQtyKg);
        const decrement = addKg(consumed, waste);

        // ----- WIP lock + recheck under lock (again, inside the write loop) -----
        let wipBalance = await wipRepo.findForUpdate(
          user.tenantId,
          order.id,
          prodInput.inputItemId,
          order.factoryLocationId,
        );
        if (!wipBalance) {
          // WIP row should exist (created by WP-04-01 issue). If missing,
          // treat as zero — fail with WIP_INSUFFICIENT.
          throw new WipInsufficientError(prodInput.id, decrement, "0.000");
        }
        // Recheck: WIP must be >= decrement (Contract 05 §13).
        if (compareKg(wipBalance.wipQtyKg, decrement) < 0) {
          throw new WipInsufficientError(prodInput.id, decrement, wipBalance.wipQtyKg);
        }

        // ----- Post waste movement (metadata-only) if waste > 0 -----
        if (isPositiveKg(waste)) {
          // Each waste movement uses a per-allocation source document ID to
          // avoid colliding with the receive_from_production movement's
          // source key (`(production_receipt, receipt.id)`) AND to avoid
          // colliding with other allocations' waste movements.
          //
          // The duplicate-source guard in InventoryLedgerService keys on
          // `(sourceDocumentType, sourceDocumentId)`. Since the receive
          // movement uses `sourceDocumentId = receipt.id`, every waste
          // movement must use a distinct value.
          //
          // CONSTRAINT: `stock_movements.source_document_id` is a UUID column
          // (Contract 03 §9.4). We use `alloc.id` (the
          // production_receipt_input_allocations.id UUID) as the waste
          // movement's sourceDocumentId. This satisfies the UUID constraint,
          // provides unique-per-allocation lineage, and lets reconciliation/
          // traceability resolve the waste back to the specific allocation
          // (Contract 05 §22). The waste_entry's `movement_id` FK plus the
          // allocation's `production_receipt_id` FK preserve the full chain.
          const wasteMovement = await invLedger.postProductionWaste(
            user,
            effective,
            {
              itemId: prodInput.inputItemId,
              factoryLocationId: order.factoryLocationId,
              wasteQtyKg: waste,
              movementDate: receipt.receiptDate,
              sourceDocumentType: SOURCE_DOC_TYPE_PRODUCTION_RECEIPT,
              sourceDocumentId: alloc.id,
              idempotencyKey: `${input.idempotencyKey}:waste:${alloc.productionInputId}`,
              notes: input.decisionNotes ?? undefined,
            },
          );

          // Insert production_waste_entries row (Contract 05 §15).
          const wastePercent =
            isPositiveKg(decrement) ?
              normalizeMoney(
                // waste / (consumed + waste) × 100, scale 6 — computed at high precision.
                // We compute via parseFloat for the percent only (not for the
                // payable basis, which uses BigInt decimal helpers elsewhere).
                ((parseFloat(waste) / parseFloat(decrement)) * 100).toFixed(6),
              )
            : null;
          await receiptRepo.insertWasteEntry({
            tenantId: user.tenantId,
            productionOrderId: order.id,
            productionInputId: alloc.productionInputId,
            productionReceiptId: receipt.id,
            wasteQtyKg: waste,
            wastePercent,
            wasteReason: receipt.notes ?? input.decisionNotes ?? null,
            movementId: wasteMovement.movementId,
          });
          wasteMovementCount++;
        }

        // ----- Decrement WIP balance by (consumed + waste) -----
        const newWipQty = subtractKg(wipBalance.wipQtyKg, decrement);
        const updatedWip = await wipRepo.updateWipQty(
          user.tenantId,
          order.id,
          prodInput.inputItemId,
          order.factoryLocationId,
          { wipQtyKg: newWipQty, version: wipBalance.version + 1 },
        );
        if (!updatedWip) {
          throw new ProductionReceiptApprovalError(
            "INTERNAL_TRANSACTION_FAILED",
            "WIP balance not found during update.",
          );
        }

        // Note: production_inputs.consumed_qty / remaining_wip_qty updates
        // are not in the WP-04-01 repository interface. They will be added
        // in a follow-up; for WP-04-03 the WIP balance table is the
        // authoritative source of truth (Contract 05 §13).

        totalWasteQty = addKg(totalWasteQty, waste);
        totalConsumedQty = addKg(totalConsumedQty, consumed);
        totalPayableBasisQty = addKg(totalPayableBasisQty, decrement);
      }

      // -----------------------------------------------------------------
      // Step 9c: Create-or-link production_outputs row.
      // -----------------------------------------------------------------
      // Check if a production_outputs row already exists for this
      // (order, output_item, output_location) tuple. If yes, link it to
      // the receipt movement; if no, insert a new row.
      const existingOutput = await receiptRepo.findOutputForReceipt(
        user.tenantId,
        order.id,
        receipt.outputItemId,
        receipt.outputLocationId,
      );
      if (existingOutput) {
        await receiptRepo.linkOutputToReceiptMovement(
          user.tenantId,
          existingOutput.id,
          { receiptMovementId: receiveResult.movementId },
        );
      } else {
        await receiptRepo.insertOutputRow({
          tenantId: user.tenantId,
          productionOrderId: order.id,
          outputItemId: receipt.outputItemId,
          outputLotId: receipt.outputLotId,
          outputLocationId: receipt.outputLocationId,
          outputQtyKg: receipt.outputQtyKg,
          receiptMovementId: receiveResult.movementId,
          createdBy: user.userId,
        });
      }

      // -----------------------------------------------------------------
      // Step 9d: Compute factory payable (DEC-013) + post account entry.
      // -----------------------------------------------------------------
      // factory_payable = totalPayableBasisQty / 1000 × factoryRate
      // (calculateFactoryPayable uses BigInt + ROUND_HALF_UP at posting boundary).
      const factoryPayableAmount = calculateFactoryPayable(totalPayableBasisQty, factoryRate);
      const payableResult: PostFactoryPayableResult = await subledger.postFactoryPayable(
        user,
        effective,
        {
          factoryId: order.factoryId,
          productionReceiptId: receipt.id,
          factoryCostBasisInputQtyKg: totalPayableBasisQty,
          factoryRatePerInputTon: factoryRate,
          entryDate: receipt.receiptDate,
          sourceDocumentType: SOURCE_DOC_TYPE_PRODUCTION_RECEIPT,
          sourceDocumentId: receipt.id,
          idempotencyKey: `${input.idempotencyKey}:payable`,
          notes: input.decisionNotes ?? undefined,
        },
      );

      // -----------------------------------------------------------------
      // Step 9e: Determine order status after this receipt.
      // -----------------------------------------------------------------
      // If ALL inputs have remaining WIP = 0 after this receipt → completed.
      // Else → partially_received.
      // We compute this by re-fetching the WIP balances for all order inputs
      // (the WIP rows have been updated above for the allocations in this
      // receipt; inputs not in this receipt retain their previous WIP).
      let allWipZero = true;
      for (const inp of orderInputs) {
        const wip = await wipRepo.findForUpdate(
          user.tenantId,
          order.id,
          inp.inputItemId,
          order.factoryLocationId,
        );
        if (wip && compareKg(wip.wipQtyKg, "0.000") > 0) {
          allWipZero = false;
          break;
        }
      }
      const newOrderStatus: "partially_received" | "completed" = allWipZero ? "completed" : "partially_received";
      const newReceiptStatus: "partially_received" | "completed" = allWipZero ? "completed" : "partially_received";

      // -----------------------------------------------------------------
      // Step 9f: Conditionally mark the receipt approved/locked.
      // -----------------------------------------------------------------
      const approvalPatch: ReceiptApprovalPatch = {
        status: newReceiptStatus,
        approvalStatus: "approved",
        isLocked: true,
        confirmedBy: user.userId,
        confirmedAt: now,
        receiptMovementId: receiveResult.movementId,
        accountEntryId: payableResult.entryId,
        factoryPayable: factoryPayableAmount,
        calculatedFactoryCost: factoryPayableAmount,
        factoryCostBasisInputQtyKg: totalPayableBasisQty,
        calculationVersion: CALCULATION_VERSION,
      };
      const updatedReceipt = await receiptRepo.markApprovedConditional(
        user.tenantId,
        receipt.id,
        approvalPatch,
        [...APPROVABLE_RECEIPT_STATUSES],
      );
      if (!updatedReceipt) {
        // Another concurrent approval already locked this receipt.
        // The DB transaction will roll back all the writes above.
        throw new ReceiptAlreadyApprovedError(receipt.id, "(concurrent)", "(concurrent)");
      }

      // -----------------------------------------------------------------
      // Step 9g: Conditionally update the order status.
      // -----------------------------------------------------------------
      const updatedOrder = await orderRepo.updateOrderStatusConditional(
        user.tenantId,
        order.id,
        { status: newOrderStatus, approvalStatus: order.approvalStatus },
        [...APPROVABLE_ORDER_STATUSES],
      );
      // If the conditional update returns null, another concurrent receipt
      // approval already moved the order past the approvable statuses —
      // we don't throw here because the receipt-level lock + idempotency
      // is the authoritative guard. The order may legitimately be in
      // 'completed' already if a parallel receipt finished first.
      const orderStatusAfter = updatedOrder?.status ?? newOrderStatus;

      // -----------------------------------------------------------------
      // Step 10: Audit (inside the same transaction — DEC-024).
      // Audit write failure throws AuditWriteFailedError → rollback.
      // -----------------------------------------------------------------
      await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
        entityType: RECEIPT_ENTITY_TYPE,
        entityId: receipt.id,
        actionType: "production_receipt.approve",
        newValuesJson: {
          docNo: receipt.docNo,
          productionOrderId: order.id,
          outputItemId: receipt.outputItemId,
          outputLotId: receipt.outputLotId,
          outputLocationId: receipt.outputLocationId,
          outputQtyKg: receipt.outputQtyKg,
          receiptMovementId: receiveResult.movementId,
          receiptMovementDocNo: receiveResult.docNo,
          outputOnHandQtyKg: receiveResult.onHandQtyKg,
          wasteMovementCount,
          totalWasteQtyKg: totalWasteQty,
          totalConsumedQtyKg: totalConsumedQty,
          factoryCostBasisInputQtyKg: totalPayableBasisQty,
          factoryRatePerInputTonUsed: factoryRate,
          factoryPayable: factoryPayableAmount,
          accountEntryId: payableResult.entryId,
          accountEntryNo: payableResult.entryNo,
          accountAmountSigned: payableResult.amountSigned,
          receiptStatus: newReceiptStatus,
          orderStatusAfter,
          allocations: allocations.map((a) => ({
            productionInputId: a.productionInputId,
            consumedTowardOutputQtyKg: a.consumedTowardOutputQtyKg,
            allocatedWasteQtyKg: a.allocatedWasteQtyKg,
            payableCostBasisQtyKg: a.payableCostBasisQtyKg,
          })),
        },
        idempotencyKey: input.idempotencyKey,
      });

      return {
        action: "posted",
        receiptId: receipt.id,
        docNo: receipt.docNo,
        receiptStatus: newReceiptStatus,
        receiptApprovalStatus: "approved",
        receiptMovementId: receiveResult.movementId,
        receiptMovementDocNo: receiveResult.docNo,
        outputOnHandQtyKg: receiveResult.onHandQtyKg,
        wasteMovementCount,
        totalWasteQtyKg: totalWasteQty,
        totalConsumedQtyKg: totalConsumedQty,
        factoryCostBasisInputQtyKg: totalPayableBasisQty,
        factoryRatePerInputTonUsed: factoryRate,
        factoryPayable: factoryPayableAmount,
        accountEntryId: payableResult.entryId,
        accountEntryNo: payableResult.entryNo,
        accountAmountSigned: payableResult.amountSigned,
        orderStatusAfter,
      };
    };

    let result: ApproveReceiptResult;
    try {
      if (this.deps.transactionRunner && this.deps.txFactories) {
        result = await this.deps.transactionRunner(async (tx: unknown) => {
          const txInvLedger = this.deps.txFactories!.createInventoryLedger(tx);
          const txSubledger = this.deps.txFactories!.createSubledger(tx);
          const txReceiptRepo = this.deps.txFactories!.createReceiptRepository(tx);
          const txOrderRepo = this.deps.txFactories!.createProductionOrderRepository(tx);
          const txWipRepo = this.deps.txFactories!.createWipBalanceRepository(tx);
          return executePosting({
            inventoryLedger: txInvLedger,
            subledger: txSubledger,
            receiptRepository: txReceiptRepo,
            productionOrderRepository: txOrderRepo,
            wipBalanceRepository: txWipRepo,
          });
        });
      } else {
        result = await executePosting(null);
      }
    } catch (txError) {
      // The DB transaction rolled back. Mark idempotency as failed and re-throw.
      // No partial DB state persists — stock_movement, inventory_balance,
      // account_entry, waste_entries, wip_balances, production_receipts,
      // production_orders are all rolled back.
      await markBusinessFailed(this.deps.idempotency, claim.record.id, {
        responseCode: 500,
        responseBody: { message: "Receipt approval transaction failed and rolled back." },
        lastErrorClass: txError instanceof Error ? txError.name : "Unknown",
      }, now);
      throw txError;
    }

    // Step 11: mark idempotency succeeded (DB transaction already committed).
    await markSucceeded(this.deps.idempotency, claim.record.id, {
      responseCode: 200,
      responseBody: result,
      entityType: RECEIPT_ENTITY_TYPE,
      entityId: receipt.id,
    }, now);

    return result;
  }
}
