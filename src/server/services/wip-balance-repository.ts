/**
 * WIP Balance Repository — WP-04-01 + WP-04-04.
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

  /**
   * WP-04-04: Conditionally decrement WIP by `decrementQtyKg` with a
   * sufficiency check + version-bump, in a single atomic UPDATE.
   *
   * Contract 04 §10 + Contract 05 §13 + Contract 06 §12:
   *   - WIP cannot go negative through ordinary posting.
   *   - If `wip_qty_kg < decrementQtyKg` → returns null (WIP_INSUFFICIENT).
   *   - If `version != expectedVersion` → returns null (concurrent modification).
   *
   * This is the concurrency-critical method for WIP-return approval. The
   * production-receipt-vs-WIP-return race (Contract 12 §11.2) is resolved
   * here: exactly one of the two concurrent operations wins the version
   * check; the other gets null and throws WIP_INSUFFICIENT or STATE_CONFLICT.
   *
   * Returns the updated row, or null if the precondition did not match.
   */
  decrementWipQtyConditional(
    tenantId: string,
    productionOrderId: string,
    inputItemId: string,
    factoryLocationId: string,
    patch: { decrementQtyKg: string; expectedVersion: number },
  ): Promise<ProductionWipBalance | null>;
}
