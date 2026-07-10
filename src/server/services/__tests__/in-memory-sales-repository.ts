/**
 * In-memory SalesRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { SalesOrder, SalesOrderLine } from "@/server/db/schema/sales";
import type {
  SalesRepository,
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
   * TEST-ONLY — production sales are created via a different path (future WP).
   */
  async insertSale(row: {
    tenantId: string;
    docNo: string;
    customerId: string;
    saleDate: string;
    saleStatus?: string;
    approvalStatus?: string;
  }): Promise<SalesOrder> {
    this.saleCounter++;
    const id = nid("sale", this.saleCounter);
    const sale: SalesOrder = {
      id,
      tenantId: row.tenantId,
      docNo: row.docNo,
      customerId: row.customerId,
      saleStatus: (row.saleStatus ?? "draft") as SalesOrder["saleStatus"],
      approvalStatus: (row.approvalStatus ?? "draft") as SalesOrder["approvalStatus"],
      saleDate: row.saleDate,
      totalGrossRevenue: "0",
      orderDiscountTotal: "0",
      documentTotalPosted: "0",
      qualityWarningStatus: null,
      reservationStatus: null,
      paymentStatus: null,
      deliveryStatus: null,
      isReplacementOrder: false,
      originalReturnRequestId: null,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      isLocked: false,
      importBatchId: null,
      reversalOfId: null,
      correctionOfId: null,
      approvedBy: null,
      approvedAt: null,
      createdBy: null,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.sales.set(`${row.tenantId}:${id}`, sale);
    this.lines.set(`${row.tenantId}:${id}`, []);
    return sale;
  }

  /**
   * Insert a sale line (test helper). Returns the inserted line.
   * TEST-ONLY.
   */
  async insertSaleLine(row: {
    tenantId: string;
    salesOrderId: string;
    lineNo: number;
    itemId: string;
    locationId: string;
    quantityKg: string;
    pricePerTon?: string | null;
  }): Promise<SalesOrderLine> {
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
}
