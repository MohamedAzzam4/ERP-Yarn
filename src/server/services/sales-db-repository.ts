/**
 * Drizzle-backed SalesRepository — the production DB repository.
 *
 * WP-03-03: minimal read + status update for submit flow.
 * WP-05-01: draft creation, line CRUD, commercial-totals persistence.
 */
import "server-only";
import { eq, and, asc, inArray } from "drizzle-orm";
import { salesOrders, salesOrderLines } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  SalesRepository,
  NewSalesDraftInput,
  NewSalesLineInput,
  CommercialTotalsPatch,
} from "./sales-repository";
import type { SalesOrder, SalesOrderLine } from "@/server/db/schema/sales";

type Db = NonNullable<typeof DbType>;

export class SalesDbRepository implements SalesRepository {
  constructor(private readonly db: Db) {}

  // --- WP-03-03 methods ---

  async findSaleById(tenantId: string, saleId: string): Promise<SalesOrder | null> {
    const [result] = await this.db
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, saleId)))
      .limit(1);
    return result ?? null;
  }

  async findSaleLines(tenantId: string, saleId: string): Promise<SalesOrderLine[]> {
    const results = await this.db
      .select()
      .from(salesOrderLines)
      .where(
        and(
          eq(salesOrderLines.tenantId, tenantId),
          eq(salesOrderLines.salesOrderId, saleId),
        ),
      )
      .orderBy(asc(salesOrderLines.lineNo));
    return results;
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
    const [result] = await this.db
      .update(salesOrders)
      .set({
        saleStatus: patch.saleStatus as SalesOrder["saleStatus"],
        approvalStatus: patch.approvalStatus as SalesOrder["approvalStatus"],
        reservationStatus: patch.reservationStatus,
        updatedAt: new Date(),
      })
      .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, saleId)))
      .returning();
    return result ?? null;
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
    const [result] = await this.db
      .update(salesOrders)
      .set({
        saleStatus: patch.saleStatus as SalesOrder["saleStatus"],
        approvalStatus: patch.approvalStatus as SalesOrder["approvalStatus"],
        reservationStatus: patch.reservationStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(salesOrders.tenantId, tenantId),
          eq(salesOrders.id, saleId),
          inArray(salesOrders.saleStatus, expectedCurrentStatuses as any[]),
        ),
      )
      .returning();
    return result ?? null;
  }

  // --- WP-05-01 methods ---

  async insertSaleDraft(row: NewSalesDraftInput): Promise<SalesOrder> {
    const [result] = await this.db
      .insert(salesOrders)
      .values({
        tenantId: row.tenantId,
        docNo: row.docNo,
        customerId: row.customerId,
        saleDate: row.saleDate,
        saleStatus: "draft",
        approvalStatus: "draft",
        totalGrossRevenue: "0",
        orderDiscountTotal: "0",
        documentTotalPosted: "0",
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async insertSaleLine(row: NewSalesLineInput): Promise<SalesOrderLine> {
    const [result] = await this.db
      .insert(salesOrderLines)
      .values({
        tenantId: row.tenantId,
        salesOrderId: row.salesOrderId,
        lineNo: row.lineNo,
        itemId: row.itemId,
        locationId: row.locationId,
        quantityKg: row.quantityKg,
        pricePerTon: row.pricePerTon,
        createdBy: null,
      })
      .returning();
    return result!;
  }

  async updateSaleCommercialTotals(
    tenantId: string,
    saleId: string,
    patch: CommercialTotalsPatch,
  ): Promise<SalesOrder | null> {
    const [result] = await this.db
      .update(salesOrders)
      .set({
        totalGrossRevenue: patch.totalGrossRevenue,
        orderDiscountTotal: patch.orderDiscountTotal,
        documentTotalPosted: patch.documentTotalPosted,
        updatedAt: new Date(),
      })
      .where(and(eq(salesOrders.tenantId, tenantId), eq(salesOrders.id, saleId)))
      .returning();
    return result ?? null;
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
    },
  ): Promise<SalesOrderLine | null> {
    const [result] = await this.db
      .update(salesOrderLines)
      .set({
        lineGrossRevenue: patch.lineGrossRevenue,
        lineAllocatedDiscountPrecise: patch.lineAllocatedDiscountPrecise,
        lineAllocatedDiscountPosted: patch.lineAllocatedDiscountPosted,
        lineNetRevenuePrecise: patch.lineNetRevenuePrecise,
        lineNetRevenuePosted: patch.lineNetRevenuePosted,
        roundingAdjustment: patch.roundingAdjustment,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(salesOrderLines.tenantId, tenantId),
          eq(salesOrderLines.id, lineId),
        ),
      )
      .returning();
    return result ?? null;
  }
}

export function createSalesDbRepository(db: Db): SalesDbRepository {
  return new SalesDbRepository(db);
}
