/**
 * WIP Balance Repository — WP-04-01.
 *
 * Repository for production_wip_balances table.
 * WIP is a materialized balance per (tenant, production_order, input_item, factory_location).
 */
import "server-only";

import type { ProductionWipBalance } from "@/server/db/schema/production-orders";

export interface WipBalanceRepository {
  findForUpdate(
    tenantId: string,
    productionOrderId: string,
    inputItemId: string,
    factoryLocationId: string,
  ): Promise<ProductionWipBalance | null>;
  insertBalance(row: {
    tenantId: string;
    productionOrderId: string;
    inputItemId: string;
    factoryLocationId: string;
    wipQtyKg: string;
  }): Promise<ProductionWipBalance>;
  updateWipQty(
    tenantId: string,
    productionOrderId: string,
    inputItemId: string,
    factoryLocationId: string,
    patch: { wipQtyKg: string; version: number },
  ): Promise<ProductionWipBalance | null>;
}
