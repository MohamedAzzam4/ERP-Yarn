/**
 * In-memory SalesRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { SalesOrder, SalesOrderLine } from "@/server/db/schema/sales";
import type {
  SalesRepository,
  NewSalesDraftInput,
  NewSalesLineInput,
  CommercialTotalsPatch,
} from "../sales-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemorySalesRepository implements SalesRepository {
  private sales = new Map<string, SalesOrder>();
  private lines = new Map<string, SalesOrderLine[]>();
  private saleCounter = 0;
  private lineCounter = 0;

  /**
   * Snapshot the current state for transactional test rollback.
   * TEST-ONLY.
   */
  snapshot(): {
    sales: Map<string, SalesOrder>;
    lines: Map<string, SalesOrderLine[]>;
    saleCounter: number;
    lineCounter: number;
  } {
    return {
      sales: new Map([...this.sales].map(([k, v]) => [k, { ...v }])),
      lines: new Map([...this.lines].map(([k, v]) => [k, v.map((l) => ({ ...l }))])),
      saleCounter: this.saleCounter,
      lineCounter: this.lineCounter,
    };
  }

  /**
   * Restore state from a snapshot. TEST-ONLY.
   */
  restore(snapshot: {
    sales: Map<string, SalesOrder>;
    lines: Map<string, SalesOrderLine[]>;
    saleCounter: number;
    lineCounter: number;
  }): void {
    this.sales = new Map([...snapshot.sales].map(([k, v]) => [k, { ...v }]));
    this.lines = new Map([...snapshot.lines].map(([k, v]) => [k, v.map((l) => ({ ...l }))]));
    this.saleCounter = snapshot.saleCounter;
    this.lineCounter = snapshot.lineCounter;
  }

  /**
   * Insert a sale (test helper). Returns the inserted sale.
   * TEST-ONLY — kept for backward compat with existing WP-03-03 tests.
   */
  async insertSale(row: {
    tenantId: string;
    docNo: string;
    customerId: string;
    saleDate: string;
    saleStatus?: string;
    approvalStatus?: string;
  }): Promise<SalesOrder> {
    return this.insertSaleDraft({
      tenantId: row.tenantId,
      docNo: row.docNo,
      customerId: row.customerId,
      saleDate: row.saleDate,
      createdBy: "",
    }).then((sale) => {
      // Override status if provided (test helper allows non-draft initial state)
      if (row.saleStatus || row.approvalStatus) {
        const updated = { ...sale, saleStatus: (row.saleStatus ?? sale.saleStatus) as SalesOrder["saleStatus"], approvalStatus: (row.approvalStatus ?? sale.approvalStatus) as SalesOrder["approvalStatus"] };
        this.sales.set(`${sale.tenantId}:${sale.id}`, updated);
        return updated;
      }
      return sale;
    });
  }

  // -------------------------------------------------------------------------
  // WP-05-01 interface methods.
  // -------------------------------------------------------------------------

  async insertSaleDraft(row: NewSalesDraftInput): Promise<SalesOrder> {
    this.saleCounter++;
    const id = nid("sale", this.saleCounter);
    const sale: SalesOrder = {
      id,
      tenantId: row.tenantId,
      docNo: row.docNo,
      customerId: row.customerId,
      saleStatus: "draft",
      approvalStatus: "draft",
      saleDate: row.saleDate,
      totalGrossRevenue: "0",
      orderDiscountTotal: "0",
      documentTotalPosted: "0",
      qualityWarningStatus: null,
      reservationStatus: null,
      paymentStatus: null,
      deliveryStatus: null,
      // WP-06-04: Replacement order link fields.
      isReplacementOrder: row.isReplacementOrder ?? false,
      originalReturnRequestId: row.originalReturnRequestId ?? null,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      isLocked: false,
      importBatchId: null,
      reversalOfId: null,
      correctionOfId: null,
      approvedBy: null,
      approvedAt: null,
      subjectHash: null,
      subjectVersion: 1,
      createdBy: row.createdBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.sales.set(`${row.tenantId}:${id}`, sale);
    this.lines.set(`${row.tenantId}:${id}`, []);
    return sale;
  }

  /**
   * Insert a sale line (test helper + WP-05-01 interface method).
   * Returns the inserted line.
   */
  async insertSaleLine(row: NewSalesLineInput): Promise<SalesOrderLine> {
    this.lineCounter++;
    const id = nid("line", this.lineCounter);
    const line: SalesOrderLine = {
      id,
      tenantId: row.tenantId,
      salesOrderId: row.salesOrderId,
      lineNo: row.lineNo,
      itemId: row.itemId,
      locationId: row.locationId,
      quantityKg: row.quantityKg,
      pricePerTon: row.pricePerTon ?? null,
      lineGrossRevenue: null,
      lineAllocatedDiscountPrecise: null,
      lineAllocatedDiscountPosted: null,
      lineNetRevenuePrecise: null,
      lineNetRevenuePosted: null,
      roundingAdjustment: "0",
      reservationId: null,
      saleIssueMovementId: null,
      qualityWarningSnapshotJson: null,
      // WP-06-04: line-level traceability for replacement orders.
      originalReturnLineId: row.originalReturnLineId ?? null,
      createdBy: null,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    const key = `${row.tenantId}:${row.salesOrderId}`;
    const existing = this.lines.get(key) ?? [];
    existing.push(line);
    this.lines.set(key, existing);
    return line;
  }

  async findSaleById(tenantId: string, saleId: string): Promise<SalesOrder | null> {
    return this.sales.get(`${tenantId}:${saleId}`) ?? null;
  }

  async findSaleLines(tenantId: string, saleId: string): Promise<SalesOrderLine[]> {
    const lines = this.lines.get(`${tenantId}:${saleId}`) ?? [];
    return [...lines].sort((a, b) => a.lineNo - b.lineNo);
  }

  async updateSaleStatus(
    tenantId: string,
    saleId: string,
    patch: {
      saleStatus: string;
      approvalStatus: string;
      reservationStatus: string | null;
    },
  ): Promise<SalesOrder | null> {
    const key = `${tenantId}:${saleId}`;
    const sale = this.sales.get(key);
    if (!sale) return null;
    const updated: SalesOrder = {
      ...sale,
      saleStatus: patch.saleStatus as SalesOrder["saleStatus"],
      approvalStatus: patch.approvalStatus as SalesOrder["approvalStatus"],
      reservationStatus: patch.reservationStatus,
      updatedAt: NOW(),
    };
    this.sales.set(key, updated);
    return updated;
  }

  async updateSaleStatusConditional(
    tenantId: string,
    saleId: string,
    patch: {
      saleStatus: string;
      approvalStatus: string;
      reservationStatus: string | null;
    },
    expectedCurrentStatuses: string[],
  ): Promise<SalesOrder | null> {
    const key = `${tenantId}:${saleId}`;
    const sale = this.sales.get(key);
    if (!sale) return null;
    // Conditional: only succeed if current sale_status is in expectedCurrentStatuses.
    if (!expectedCurrentStatuses.includes(sale.saleStatus)) return null;
    const updated: SalesOrder = {
      ...sale,
      saleStatus: patch.saleStatus as SalesOrder["saleStatus"],
      approvalStatus: patch.approvalStatus as SalesOrder["approvalStatus"],
      reservationStatus: patch.reservationStatus,
      updatedAt: NOW(),
    };
    this.sales.set(key, updated);
    return updated;
  }

  async updateSaleCommercialTotals(
    tenantId: string,
    saleId: string,
    patch: CommercialTotalsPatch,
  ): Promise<SalesOrder | null> {
    const key = `${tenantId}:${saleId}`;
    const sale = this.sales.get(key);
    if (!sale) return null;
    const updated: SalesOrder = {
      ...sale,
      totalGrossRevenue: patch.totalGrossRevenue,
      orderDiscountTotal: patch.orderDiscountTotal,
      documentTotalPosted: patch.documentTotalPosted,
      updatedAt: NOW(),
    };
    this.sales.set(key, updated);
    return updated;
  }

  async updateLineCommercialTotals(
    tenantId: string,
    lineId: string,
    patch: {
      lineGrossRevenue: string;
      lineAllocatedDiscountPrecise: string;
      lineAllocatedDiscountPosted: string;
      lineNetRevenuePrecise: string;
      lineNetRevenuePosted: string;
      roundingAdjustment: string;
      pricePerTon?: string | null;
    },
  ): Promise<SalesOrderLine | null> {
    // Find the line across all sales in this tenant
    for (const [key, lines] of this.lines.entries()) {
      if (!key.startsWith(`${tenantId}:`)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.id === lineId) {
          const updated: SalesOrderLine = {
            ...lines[i]!,
            lineGrossRevenue: patch.lineGrossRevenue,
            lineAllocatedDiscountPrecise: patch.lineAllocatedDiscountPrecise,
            lineAllocatedDiscountPosted: patch.lineAllocatedDiscountPosted,
            lineNetRevenuePrecise: patch.lineNetRevenuePrecise,
            lineNetRevenuePosted: patch.lineNetRevenuePosted,
            roundingAdjustment: patch.roundingAdjustment,
            // WP-06-04: persist pricePerTon if provided.
            ...(patch.pricePerTon !== undefined ? { pricePerTon: patch.pricePerTon } : {}),
            updatedAt: NOW(),
          };
          lines[i] = updated;
          this.lines.set(key, lines);
          return updated;
        }
      }
    }
    return null;
  }

  /**
   * WP-05-01 (audit pass): Atomically update sale header + all line totals.
   * Uses snapshot/restore for in-memory atomicity — if any update fails,
   * all prior updates in the batch are rolled back.
   */
  async batchUpdateCommercialTotals(
    tenantId: string,
    saleId: string,
    salePatch: CommercialTotalsPatch,
    linePatches: Array<{
      lineId: string;
      lineGrossRevenue: string;
      lineAllocatedDiscountPrecise: string;
      lineAllocatedDiscountPosted: string;
      lineNetRevenuePrecise: string;
      lineNetRevenuePosted: string;
      roundingAdjustment: string;
      pricePerTon?: string | null;
    }>,
  ): Promise<SalesOrder | null> {
    // Take a snapshot for rollback
    const salesSnapshot = new Map([...this.sales].map(([k, v]) => [k, { ...v }]));
    const linesSnapshot = new Map([...this.lines].map(([k, v]) => [k, v.map((l) => ({ ...l }))]));

    try {
      // Update sale header
      const saleResult = await this.updateSaleCommercialTotals(tenantId, saleId, salePatch);
      if (!saleResult) throw new Error("Sale not found during batch update");

      // Update each line
      for (const lp of linePatches) {
        const lineResult = await this.updateLineCommercialTotals(tenantId, lp.lineId, {
          lineGrossRevenue: lp.lineGrossRevenue,
          lineAllocatedDiscountPrecise: lp.lineAllocatedDiscountPrecise,
          lineAllocatedDiscountPosted: lp.lineAllocatedDiscountPosted,
          lineNetRevenuePrecise: lp.lineNetRevenuePrecise,
          lineNetRevenuePosted: lp.lineNetRevenuePosted,
          roundingAdjustment: lp.roundingAdjustment,
          // WP-06-04: pass pricePerTon through if provided.
          ...(lp.pricePerTon !== undefined ? { pricePerTon: lp.pricePerTon } : {}),
        });
        if (!lineResult) throw new Error(`Line '${lp.lineId}' not found during batch update`);
      }

      return saleResult;
    } catch (e) {
      // Rollback to snapshot
      this.sales = salesSnapshot;
      this.lines = linesSnapshot;
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // WP-05-03 methods.
  // -------------------------------------------------------------------------

  async updateSaleSubjectHash(
    tenantId: string,
    saleId: string,
    patch: { subjectHash: string; subjectVersion: number },
  ): Promise<SalesOrder | null> {
    const key = `${tenantId}:${saleId}`;
    const sale = this.sales.get(key);
    if (!sale) return null;
    const updated = { ...sale, subjectHash: patch.subjectHash, subjectVersion: patch.subjectVersion, updatedAt: NOW() };
    this.sales.set(key, updated);
    return updated;
  }

  async markSaleApproved(
    tenantId: string,
    saleId: string,
    patch: { approvedBy: string; approvedAt: Date },
    expectedCurrentStatuses: string[],
  ): Promise<SalesOrder | null> {
    const key = `${tenantId}:${saleId}`;
    const sale = this.sales.get(key);
    if (!sale) return null;
    if (!expectedCurrentStatuses.includes(sale.saleStatus)) return null;
    const updated: SalesOrder = {
      ...sale,
      saleStatus: "approved" as SalesOrder["saleStatus"],
      approvalStatus: "approved" as SalesOrder["approvalStatus"],
      isLocked: true,
      reservationStatus: "consumed",
      approvedBy: patch.approvedBy,
      approvedAt: patch.approvedAt,
      updatedBy: patch.approvedBy,
      updatedAt: NOW(),
    };
    this.sales.set(key, updated);
    return updated;
  }

  async updateLineSaleIssueMovementId(
    tenantId: string,
    lineId: string,
    saleIssueMovementId: string,
  ): Promise<SalesOrderLine | null> {
    for (const [key, lines] of this.lines.entries()) {
      if (!key.startsWith(`${tenantId}:`)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.id === lineId) {
          const updated = { ...lines[i]!, saleIssueMovementId, updatedAt: NOW() };
          lines[i] = updated;
          this.lines.set(key, lines);
          return updated;
        }
      }
    }
    return null;
  }

  // --- WP-06-04 methods ---

  async findReplacementOrderByReturnRequestId(
    tenantId: string,
    returnRequestId: string,
  ): Promise<SalesOrder | null> {
    for (const sale of this.sales.values()) {
      if (
        sale.tenantId === tenantId &&
        sale.isReplacementOrder &&
        sale.originalReturnRequestId === returnRequestId
      ) {
        return sale;
      }
    }
    return null;
  }

  /**
   * TEST-ONLY: directly mutate a sale line's fields without going through the
   * service layer. Used by subject-hash mismatch tests to simulate a line being
   * edited after submission (which should cause subject-hash mismatch on approval).
   */
  async mutateLineForTest(
    tenantId: string,
    lineId: string,
    patch: Partial<{ quantityKg: string; pricePerTon: string | null; lineNetRevenuePosted: string | null }>,
  ): Promise<void> {
    for (const [key, lines] of this.lines.entries()) {
      if (!key.startsWith(`${tenantId}:`)) continue;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.id === lineId) {
          lines[i] = { ...lines[i]!, ...patch, updatedAt: NOW() };
          this.lines.set(key, lines);
          return;
        }
      }
    }
  }
}
