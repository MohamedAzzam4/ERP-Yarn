/**
 * Sales Repository — WP-03-03 + WP-05-01.
 *
 * WP-03-03: minimal read + status update for submission.
 * WP-05-01: draft creation, line CRUD, commercial-totals persistence.
 */
import "server-only";

import type { SalesOrder, SalesOrderLine } from "@/server/db/schema/sales";

// ---------------------------------------------------------------------------
// WP-05-01: Draft creation inputs.
// ---------------------------------------------------------------------------

export interface NewSalesDraftInput {
  tenantId: string;
  docNo: string;
  customerId: string;
  saleDate: string;
  createdBy: string;
}

export interface NewSalesLineInput {
  tenantId: string;
  salesOrderId: string;
  lineNo: number;
  itemId: string;
  locationId: string;
  quantityKg: string;
  pricePerTon: string | null;
}

export interface CommercialTotalsPatch {
  totalGrossRevenue: string;
  orderDiscountTotal: string;
  documentTotalPosted: string;
}

export interface LineCommercialTotalsPatch {
  lineId: string;
  lineGrossRevenue: string;
  lineAllocatedDiscountPrecise: string;
  lineAllocatedDiscountPosted: string;
  lineNetRevenuePrecise: string;
  lineNetRevenuePosted: string;
  roundingAdjustment: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

export interface SalesRepository {
  // WP-03-03 methods (existing)
  findSaleById(tenantId: string, saleId: string): Promise<SalesOrder | null>;
  findSaleLines(tenantId: string, saleId: string): Promise<SalesOrderLine[]>;
  updateSaleStatus(
    tenantId: string,
    saleId: string,
    patch: {
      saleStatus: string;
      approvalStatus: string;
      reservationStatus: string | null;
    },
  ): Promise<SalesOrder | null>;
  updateSaleStatusConditional(
    tenantId: string,
    saleId: string,
    patch: {
      saleStatus: string;
      approvalStatus: string;
      reservationStatus: string | null;
    },
    expectedCurrentStatuses: string[],
  ): Promise<SalesOrder | null>;

  // WP-05-01 methods (new)
  insertSaleDraft(row: NewSalesDraftInput): Promise<SalesOrder>;
  insertSaleLine(row: NewSalesLineInput): Promise<SalesOrderLine>;
  updateSaleCommercialTotals(
    tenantId: string,
    saleId: string,
    patch: CommercialTotalsPatch,
  ): Promise<SalesOrder | null>;
  updateLineCommercialTotals(
    tenantId: string,
    lineId: string,
    patch: Omit<LineCommercialTotalsPatch, "lineId">,
  ): Promise<SalesOrderLine | null>;

  /**
   * WP-05-01 (audit pass): Atomically update sale header totals AND all line
   * commercial totals in a single repository call. This ensures all-or-nothing
   * semantics — if any line update fails, the entire batch rolls back.
   *
   * The implementation MUST be transaction-aware (either use a DB transaction
   * internally or delegate to a tx-scoped repository).
   *
   * Returns the updated sale, or null if the sale was not found.
   */
  batchUpdateCommercialTotals(
    tenantId: string,
    saleId: string,
    salePatch: CommercialTotalsPatch,
    linePatches: Array<Omit<LineCommercialTotalsPatch, "lineId"> & { lineId: string }>,
  ): Promise<SalesOrder | null>;

  // WP-05-03 methods (new)

  /**
   * Update the sale's subject hash + version.
   * Called when the sale is submitted (transitioning to pending_approval).
   */
  updateSaleSubjectHash(
    tenantId: string,
    saleId: string,
    patch: { subjectHash: string; subjectVersion: number },
  ): Promise<SalesOrder | null>;

  /**
   * Conditionally mark a sale as approved/locked.
   * Only succeeds if current saleStatus is in expectedCurrentStatuses.
   * Sets approvedBy, approvedAt, isLocked=true, reservationStatus="consumed".
   */
  markSaleApproved(
    tenantId: string,
    saleId: string,
    patch: { approvedBy: string; approvedAt: Date },
    expectedCurrentStatuses: string[],
  ): Promise<SalesOrder | null>;

  /**
   * Update a sale line's saleIssueMovementId (links the line to its stock movement).
   */
  updateLineSaleIssueMovementId(
    tenantId: string,
    lineId: string,
    saleIssueMovementId: string,
  ): Promise<SalesOrderLine | null>;
}
