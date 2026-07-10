/**
 * Drizzle-backed SalesRepository — the production DB repository.
 *
 * WP-03-03 scope: minimal read + status update for submit flow.
 * Full sale CRUD, approval, rejection, cancellation are deferred.
 */
import "server-only";
import { eq, and, asc, inArray } from "drizzle-orm";
import { salesOrders, salesOrderLines } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  SalesRepository,
} from "./sales-repository";
import type { SalesOrder, SalesOrderLine } from "@/server/db/schema/sales";

type Db = NonNullable<typeof DbType>;

export class SalesDbRepository implements SalesRepository {
  constructor(private readonly db: Db) {}

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
    // Conditional update: only succeed if current sale_status is in expectedCurrentStatuses.
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
}

export function createSalesDbRepository(db: Db): SalesDbRepository {
  return new SalesDbRepository(db);
}
