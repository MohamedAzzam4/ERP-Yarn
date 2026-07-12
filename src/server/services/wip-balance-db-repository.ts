/**
 * Drizzle-backed WipBalanceRepository — the production DB repository.
 *
 * WP-04-01: DB-backed implementation for production_wip_balances.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { productionWipBalances } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type { WipBalanceRepository } from "./wip-balance-repository";
import type { ProductionWipBalance } from "@/server/db/schema/production-orders";

type Db = NonNullable<typeof DbType>;

export class WipBalanceDbRepository implements WipBalanceRepository {
  constructor(private readonly db: Db) {}

  async findForUpdate(
    tenantId: string,
    productionOrderId: string,
    inputItemId: string,
    factoryLocationId: string,
  ): Promise<ProductionWipBalance | null> {
    const [result] = await this.db
      .select()
      .from(productionWipBalances)
      .where(
        and(
          eq(productionWipBalances.tenantId, tenantId),
          eq(productionWipBalances.productionOrderId, productionOrderId),
          eq(productionWipBalances.inputItemId, inputItemId),
          eq(productionWipBalances.factoryLocationId, factoryLocationId),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async insertBalance(row: {
    tenantId: string;
    productionOrderId: string;
    inputItemId: string;
    factoryLocationId: string;
    wipQtyKg: string;
  }): Promise<ProductionWipBalance> {
    const [result] = await this.db
      .insert(productionWipBalances)
      .values({
        tenantId: row.tenantId,
        productionOrderId: row.productionOrderId,
        inputItemId: row.inputItemId,
        factoryLocationId: row.factoryLocationId,
        wipQtyKg: row.wipQtyKg,
      })
      .returning();
    return result!;
  }

  async updateWipQty(
    tenantId: string,
    productionOrderId: string,
    inputItemId: string,
    factoryLocationId: string,
    patch: { wipQtyKg: string; version: number },
  ): Promise<ProductionWipBalance | null> {
    const [result] = await this.db
      .update(productionWipBalances)
      .set({
        wipQtyKg: patch.wipQtyKg,
        version: patch.version,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productionWipBalances.tenantId, tenantId),
          eq(productionWipBalances.productionOrderId, productionOrderId),
          eq(productionWipBalances.inputItemId, inputItemId),
          eq(productionWipBalances.factoryLocationId, factoryLocationId),
        ),
      )
      .returning();
    return result ?? null;
  }
}

export function createWipBalanceDbRepository(db: Db): WipBalanceDbRepository {
  return new WipBalanceDbRepository(db);
}
