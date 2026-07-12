/**
 * Drizzle-backed ProductionOrderRepository — the production DB repository.
 *
 * WP-04-01: DB-backed implementation for production_orders + production_inputs.
 */
import "server-only";
import { eq, and, inArray } from "drizzle-orm";
import { productionOrders, productionInputs } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  ProductionOrderRepository,
  NewProductionOrderInput,
  NewProductionInputRow,
} from "./production-order-repository";
import type { ProductionOrder, ProductionInput } from "@/server/db/schema/production-orders";

type Db = NonNullable<typeof DbType>;

export class ProductionOrderDbRepository implements ProductionOrderRepository {
  constructor(private readonly db: Db) {}

  async insertOrder(row: NewProductionOrderInput): Promise<ProductionOrder> {
    const [result] = await this.db
      .insert(productionOrders)
      .values({
        tenantId: row.tenantId,
        docNo: row.docNo,
        productionType: row.productionType,
        factoryId: row.factoryId,
        factoryLocationId: row.factoryLocationId,
        status: "draft",
        approvalStatus: "draft",
        createdBy: row.createdBy,
      })
      .returning();
    return result!;
  }

  async insertInput(row: NewProductionInputRow): Promise<ProductionInput> {
    const [result] = await this.db
      .insert(productionInputs)
      .values({
        tenantId: row.tenantId,
        productionOrderId: row.productionOrderId,
        inputItemId: row.inputItemId,
        inputLocationId: row.inputLocationId,
        plannedInputQtyKg: row.plannedInputQtyKg,
      })
      .returning();
    return result!;
  }

  async findOrderById(tenantId: string, id: string): Promise<ProductionOrder | null> {
    const [result] = await this.db
      .select()
      .from(productionOrders)
      .where(and(eq(productionOrders.tenantId, tenantId), eq(productionOrders.id, id)))
      .limit(1);
    return result ?? null;
  }

  async findInputsByOrder(tenantId: string, orderId: string): Promise<ProductionInput[]> {
    const results = await this.db
      .select()
      .from(productionInputs)
      .where(and(eq(productionInputs.tenantId, tenantId), eq(productionInputs.productionOrderId, orderId)));
    return results;
  }

  async findInputById(tenantId: string, id: string): Promise<ProductionInput | null> {
    const [result] = await this.db
      .select()
      .from(productionInputs)
      .where(and(eq(productionInputs.tenantId, tenantId), eq(productionInputs.id, id)))
      .limit(1);
    return result ?? null;
  }

  async updateOrderStatus(
    tenantId: string,
    orderId: string,
    patch: { status: string; approvalStatus: string },
  ): Promise<ProductionOrder | null> {
    const [result] = await this.db
      .update(productionOrders)
      .set({
        status: patch.status as ProductionOrder["status"],
        approvalStatus: patch.approvalStatus as ProductionOrder["approvalStatus"],
        updatedAt: new Date(),
      })
      .where(and(eq(productionOrders.tenantId, tenantId), eq(productionOrders.id, orderId)))
      .returning();
    return result ?? null;
  }

  async updateInputIssuedQty(
    tenantId: string,
    inputId: string,
    patch: { issuedQtyKg: string; issueMovementId: string | null },
  ): Promise<ProductionInput | null> {
    const [result] = await this.db
      .update(productionInputs)
      .set({
        issuedQtyKg: patch.issuedQtyKg,
        issueMovementId: patch.issueMovementId,
        updatedAt: new Date(),
      })
      .where(and(eq(productionInputs.tenantId, tenantId), eq(productionInputs.id, inputId)))
      .returning();
    return result ?? null;
  }

  async updateOrderStatusConditional(
    tenantId: string,
    orderId: string,
    patch: { status: string; approvalStatus: string },
    expectedCurrentStatuses: string[],
  ): Promise<ProductionOrder | null> {
    const [result] = await this.db
      .update(productionOrders)
      .set({
        status: patch.status as ProductionOrder["status"],
        approvalStatus: patch.approvalStatus as ProductionOrder["approvalStatus"],
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productionOrders.tenantId, tenantId),
          eq(productionOrders.id, orderId),
          inArray(productionOrders.status, expectedCurrentStatuses as any[]),
        ),
      )
      .returning();
    return result ?? null;
  }
}

export function createProductionOrderDbRepository(db: Db): ProductionOrderDbRepository {
  return new ProductionOrderDbRepository(db);
}
