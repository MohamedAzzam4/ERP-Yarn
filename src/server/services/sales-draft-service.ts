/**
 * Sales Draft Service — WP-05-01.
 *
 * Contract: docs/contracts/13_work_packages.md WP-05-01
 *   Goal: Create multi-line-capable sale with exact server-calculated
 *   commercial totals and reservation submission.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §11.1
 *   Commercial total calculation rules, residual allocation, invariants.
 *
 * Contract: docs/contracts/09_api_contracts.md §8
 *   Submit Sale for Approval — delegates to SalesSubmissionService.
 *
 * DEC-035: Multi-line capable from the beginning.
 * DEC-042/047/048/049: Decimal precision, ROUND_HALF_UP, residual allocation.
 * DEC-063: Worker financial-deny absolute — request schemas reject commercial
 *   fields from workers; responses omit them server-side.
 * DEC-065: Quality-risk stock reservation only for accepted/sellable stock.
 *
 * WP-05-01 SCOPE:
 *   - Create sales draft (multi-line)
 *   - Complete commercial totals (server-calculated, BigInt-based)
 *   - Submit for approval (delegates to SalesSubmissionService.submitSale)
 *
 * WP-05-01 NON-SCOPE (deferred):
 *   - Sales approval (WP-05-03)
 *   - Receivable posting / subledger entries (WP-05-03)
 *   - Profitability snapshots (WP-05-02)
 *   - Payments / settlements (WP-05-04)
 *   - Stock movements (posted at approval, not at submit)
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
  allocateDocumentNumber,
  type DocumentSequenceTransactionHandle,
} from "./document-sequence-service";
import type { SalesRepository } from "./sales-repository";
import type { InventoryLedgerService } from "./inventory-ledger-service";
import type { SalesSubmissionService } from "./sales-submission-service";
import {
  calculateCommercialTotals,
  type CalculatorLineInput,
  type CalculatorResult,
} from "./sales-commercial-calculator";
import { isPositiveKg, normalizeKg } from "./decimal-kg";
import { isPositiveMoney, normalizeMoney, addMoney, compareMoney, isZeroMoney } from "./decimal-money";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateSalesDraftInput {
  customerId: string;
  saleDate: string;
  lines: Array<{
    itemId: string;
    locationId: string;
    quantityKg: string;
    /** Price per ton (NUMERIC(18,2)). NULL for warehouse operational drafts. */
    pricePerTon?: string | null;
  }>;
  /** Order-level discount total (NUMERIC(18,2)). Workers cannot set this. */
  orderDiscountTotal?: string | null;
  notes?: string | null;
}

export interface CreateSalesDraftResult {
  saleId: string;
  docNo: string;
  saleStatus: string;
  lineCount: number;
}

export interface CompleteCommercialTotalsInput {
  saleId: string;
  /** Order-level discount total (NUMERIC(18,2)). Server-validated: 0 <= discount <= gross. */
  orderDiscountTotal: string;
  /** Per-line prices (NUMERIC(18,2)). Must cover all lines. Workers cannot set these. */
  linePrices: Array<{
    lineId: string;
    pricePerTon: string;
  }>;
}

export interface CompleteCommercialTotalsResult {
  saleId: string;
  totalGrossRevenue: string;
  orderDiscountTotal: string;
  documentTotalPosted: string;
  lines: Array<{
    lineNo: number;
    lineGrossRevenue: string;
    lineAllocatedDiscountPosted: string;
    lineNetRevenuePosted: string;
    roundingAdjustment: string;
  }>;
}

export interface SubmitSaleInput {
  saleId: string;
  idempotencyKey: string;
  decisionNotes?: string | null;
}

// Re-export the submission result type for convenience
export type SubmitSaleResult = Awaited<ReturnType<SalesSubmissionService["submitSale"]>>;

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class SalesDraftError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SalesDraftError";
    this.code = code;
  }
}

export class SaleNotFoundError extends SalesDraftError {
  constructor(id: string) {
    super("SALE_NOT_FOUND", `Sale '${id}' not found.`);
    this.name = "SaleNotFoundError";
  }
}

export class SaleNotDraftError extends SalesDraftError {
  constructor(id: string, status: string) {
    super("STATE_CONFLICT", `Sale '${id}' is in status '${status}' — must be 'draft'.`);
    this.name = "SaleNotDraftError";
  }
}

export class SaleHasNoLinesError extends SalesDraftError {
  constructor(id: string) {
    super("SALE_HAS_NO_LINES", `Sale '${id}' has no lines.`);
    this.name = "SaleHasNoLinesError";
  }
}

export class CommercialNotCompletedError extends SalesDraftError {
  constructor(id: string) {
    super("VALIDATION_FAILED", `Sale '${id}' commercial totals not completed — cannot submit.`);
    this.name = "CommercialNotCompletedError";
  }
}

export class PriceRequiredError extends SalesDraftError {
  constructor(lineId: string) {
    super("VALIDATION_FAILED", `Line '${lineId}' has no price — commercial completion requires all lines to have prices.`);
    this.name = "PriceRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface SalesDraftServiceDeps {
  salesRepository: SalesRepository;
  audit: AuditTransactionHandle;
  documentSequence: DocumentSequenceTransactionHandle;
  /** The existing WP-03-03 submission service — used for submit delegation. */
  submissionService: SalesSubmissionService;
}

const SALES_ENTITY_TYPE = "sales_order";

// ---------------------------------------------------------------------------
// SalesDraftService.
// ---------------------------------------------------------------------------

export class SalesDraftService {
  constructor(private readonly deps: SalesDraftServiceDeps) {}

  /**
   * Create a multi-line sales draft.
   *
   * Permission: sales.create (Owner/Accountant/Warehouse).
   * DEC-063: Workers cannot set price fields. If a worker sends pricePerTon
   * or orderDiscountTotal, those fields are SILENTLY IGNORED (the request
   * schema should also reject them at the route layer, but the service
   * enforces it defense-in-depth).
   *
   * The draft has ZERO operational effect: no stock movement, no reservation,
   * no account entry. Commercial totals are NULL until completeCommercialTotals
   * is called.
   */
  async createDraft(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CreateSalesDraftInput,
  ): Promise<CreateSalesDraftResult> {
    requirePermission(effective, "sales.create");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Validate input
    if (!input.customerId) {
      throw new SalesDraftError("VALIDATION_FAILED", "customerId is required.");
    }
    if (!input.saleDate) {
      throw new SalesDraftError("VALIDATION_FAILED", "saleDate is required.");
    }
    if (input.lines.length === 0) {
      throw new SalesDraftError("VALIDATION_FAILED", "At least one sale line is required.");
    }
    for (let i = 0; i < input.lines.length; i++) {
      const line = input.lines[i]!;
      if (!line.itemId || !line.locationId) {
        throw new SalesDraftError("VALIDATION_FAILED", `Line ${i + 1}: itemId and locationId are required.`);
      }
      if (!isPositiveKg(line.quantityKg)) {
        throw new SalesDraftError("VALIDATION_FAILED", `Line ${i + 1}: quantity must be positive, got '${line.quantityKg}'.`);
      }
    }

    // DEC-063: Workers cannot set price/commercial fields.
    // If the user does NOT have sales.view_price, silently strip price fields.
    const hasPricePermission = effective.permissionKeys.has("sales.view_price");
    const sanitizedLines = input.lines.map((line) => ({
      itemId: line.itemId,
      locationId: line.locationId,
      quantityKg: normalizeKg(line.quantityKg),
      pricePerTon: hasPricePermission ? (line.pricePerTon ?? null) : null,
    }));

    // Allocate doc_no (SO-YYYY-NNNNNN)
    const year = new Date().getUTCFullYear();
    const docNoResult = await allocateDocumentNumber(this.deps.documentSequence, {
      tenantId: user.tenantId,
      documentType: "sales_order",
      year,
      entityType: SALES_ENTITY_TYPE,
    });

    // Create the sale draft
    const sale = await this.deps.salesRepository.insertSaleDraft({
      tenantId: user.tenantId,
      docNo: docNoResult.docNo,
      customerId: input.customerId,
      saleDate: input.saleDate,
      createdBy: user.userId,
    });

    // Create sale lines
    let lineNo = 1;
    for (const line of sanitizedLines) {
      await this.deps.salesRepository.insertSaleLine({
        tenantId: user.tenantId,
        salesOrderId: sale.id,
        lineNo,
        itemId: line.itemId,
        locationId: line.locationId,
        quantityKg: line.quantityKg,
        pricePerTon: line.pricePerTon,
      });
      lineNo++;
    }

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: SALES_ENTITY_TYPE,
      entityId: sale.id,
      actionType: "sales_draft.create",
      newValuesJson: {
        docNo: sale.docNo,
        customerId: input.customerId,
        saleDate: input.saleDate,
        lineCount: sanitizedLines.length,
        hasPricePermission,
      },
    });

    return {
      saleId: sale.id,
      docNo: sale.docNo,
      saleStatus: sale.saleStatus,
      lineCount: sanitizedLines.length,
    };
  }

  /**
   * Complete commercial totals for a draft sale.
   *
   * Permission: sales.view_price (Owner/Accountant only — workers denied).
   *
   * Server-calculated using BigInt-based decimal helpers. Client-provided
   * totals are IGNORED — only pricePerTon and orderDiscountTotal are accepted
   * as inputs; all gross/discount/net/document totals are computed server-side.
   *
   * The calculation follows Contract 03 §11.1 + DEC-048/049:
   * 1. Per line: line_gross_revenue = ROUND_HALF_UP((qty / 1000) × price, scale=2)
   * 2. total_gross_revenue = sum(line_gross_revenue)
   * 3. Validate: 0 <= order_discount_total <= total_gross_revenue
   * 4. Allocate discount proportionally by line gross
   * 5. Apply residual to largest gross line (tie: lowest line_no)
   * 6. document_total_posted = sum(line_net_revenue_posted)
   *
   * Persists all 6 line columns + 3 order columns atomically.
   * No stock movement, no reservation, no account entry.
   */
  async completeCommercialTotals(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: CompleteCommercialTotalsInput,
  ): Promise<CompleteCommercialTotalsResult> {
    requirePermission(effective, "sales.view_price");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    // Fetch sale
    const sale = await this.deps.salesRepository.findSaleById(user.tenantId, input.saleId);
    if (!sale) throw new SaleNotFoundError(input.saleId);
    requireTenantMatch(user, sale.tenantId);

    // Must be draft
    if (sale.saleStatus !== "draft") {
      throw new SaleNotDraftError(sale.id, sale.saleStatus);
    }

    // Fetch lines
    const lines = await this.deps.salesRepository.findSaleLines(user.tenantId, sale.id);
    if (lines.length === 0) {
      throw new SaleHasNoLinesError(sale.id);
    }

    // Validate: all lines must have a price provided
    const priceMap = new Map<string, string>();
    for (const lp of input.linePrices) {
      if (!isPositiveMoney(lp.pricePerTon)) {
        throw new SalesDraftError("VALIDATION_FAILED", `Price for line '${lp.lineId}' must be positive, got '${lp.pricePerTon}'.`);
      }
      priceMap.set(lp.lineId, normalizeMoney(lp.pricePerTon));
    }
    for (const line of lines) {
      if (!priceMap.has(line.id)) {
        throw new PriceRequiredError(line.id);
      }
    }

    // Build calculator inputs
    const calculatorInputs: CalculatorLineInput[] = lines.map((line) => ({
      lineNo: line.lineNo,
      quantityKg: line.quantityKg,
      pricePerTon: priceMap.get(line.id)!,
    }));

    // Calculate commercial totals (pure function, BigInt-based)
    const calculated: CalculatorResult = calculateCommercialTotals(
      calculatorInputs,
      normalizeMoney(input.orderDiscountTotal),
    );

    // Persist order-level totals
    await this.deps.salesRepository.updateSaleCommercialTotals(
      user.tenantId,
      sale.id,
      {
        totalGrossRevenue: calculated.totalGrossRevenue,
        orderDiscountTotal: calculated.orderDiscountTotal,
        documentTotalPosted: calculated.documentTotalPosted,
      },
    );

    // Persist per-line totals
    for (const calcLine of calculated.lines) {
      const dbLine = lines.find((l) => l.lineNo === calcLine.lineNo);
      if (!dbLine) continue;
      await this.deps.salesRepository.updateLineCommercialTotals(
        user.tenantId,
        dbLine.id,
        {
          lineGrossRevenue: calcLine.lineGrossRevenue,
          lineAllocatedDiscountPrecise: calcLine.lineAllocatedDiscountPrecise,
          lineAllocatedDiscountPosted: calcLine.lineAllocatedDiscountPosted,
          lineNetRevenuePrecise: calcLine.lineNetRevenuePrecise,
          lineNetRevenuePosted: calcLine.lineNetRevenuePosted,
          roundingAdjustment: calcLine.roundingAdjustment,
        },
      );
    }

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: SALES_ENTITY_TYPE,
      entityId: sale.id,
      actionType: "sales_commercial_totals.complete",
      newValuesJson: {
        totalGrossRevenue: calculated.totalGrossRevenue,
        orderDiscountTotal: calculated.orderDiscountTotal,
        documentTotalPosted: calculated.documentTotalPosted,
        lineCount: calculated.lines.length,
      },
    });

    return {
      saleId: sale.id,
      totalGrossRevenue: calculated.totalGrossRevenue,
      orderDiscountTotal: calculated.orderDiscountTotal,
      documentTotalPosted: calculated.documentTotalPosted,
      lines: calculated.lines.map((l) => ({
        lineNo: l.lineNo,
        lineGrossRevenue: l.lineGrossRevenue,
        lineAllocatedDiscountPosted: l.lineAllocatedDiscountPosted,
        lineNetRevenuePosted: l.lineNetRevenuePosted,
        roundingAdjustment: l.roundingAdjustment,
      })),
    };
  }

  /**
   * Submit a draft sale for approval.
   *
   * Permission: sales.submit (Owner/Accountant only — workers denied).
   *
   * Precondition: commercial totals must be completed (all lines have
   * non-null line_gross_revenue and the sale has non-zero total_gross_revenue
   * unless all prices are zero).
   *
   * Delegates to SalesSubmissionService.submitSale (WP-03-03) which handles:
   * - Idempotency claim
   * - Sale state check (must be draft)
   * - Line fetch + validation
   * - Atomic reservation creation per line (balance lock + reserved_qty increase)
   * - Sale status transition to pending_approval
   * - Audit
   *
   * WP-05-01 adds the commercial-totals precondition check BEFORE delegating.
   * No stock movement, no account entry, no profitability snapshot.
   */
  async submitSale(
    user: ErpUserContext,
    effective: EffectivePermissions,
    input: SubmitSaleInput,
  ): Promise<SubmitSaleResult> {
    requirePermission(effective, "sales.submit");
    rejectBodyClaimsAuthority(input as unknown as Record<string, unknown>);

    if (!input.saleId || input.saleId.trim() === "") {
      throw new SalesDraftError("VALIDATION_FAILED", "saleId is required.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim() === "") {
      throw new SalesDraftError("VALIDATION_FAILED", "idempotencyKey is required.");
    }

    // Precondition: commercial totals must be completed
    const sale = await this.deps.salesRepository.findSaleById(user.tenantId, input.saleId);
    if (!sale) throw new SaleNotFoundError(input.saleId);
    requireTenantMatch(user, sale.tenantId);

    if (sale.saleStatus !== "draft") {
      throw new SaleNotDraftError(sale.id, sale.saleStatus);
    }

    // Check that commercial totals are completed
    const lines = await this.deps.salesRepository.findSaleLines(user.tenantId, sale.id);
    if (lines.length === 0) {
      throw new SaleHasNoLinesError(sale.id);
    }

    for (const line of lines) {
      if (line.lineGrossRevenue === null || line.pricePerTon === null) {
        throw new CommercialNotCompletedError(sale.id);
      }
    }

    // Delegate to the existing WP-03-03 SalesSubmissionService
    return this.deps.submissionService.submitSale(user, effective, {
      saleId: input.saleId,
      decisionNotes: input.decisionNotes ?? null,
      idempotencyKey: input.idempotencyKey,
    });
  }
}
