/**
 * In-memory WipBalanceRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { ProductionWipBalance } from "@/server/db/schema/production-orders";
import type { WipBalanceRepository } from "../wip-balance-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryWipBalanceRepository implements WipBalanceRepository {
  private balances = new Map<string, ProductionWipBalance>();
  private counter = 0;

  snapshot() {
    return {
      balances: new Map([...this.balances].map(([k, v]) => [k, { ...v }])),
      counter: this.counter,
    };
  }

  restore(s: any) {
    this.balances = new Map([...s.balances].map(([k, v]: any) => [k, { ...v }]));
    this.counter = s.counter;
  }

  private key(t: string, o: string, i: string, l: string) {
    return `${t}:${o}:${i}:${l}`;
  }

  async findForUpdate(
    tenantId: string,
    productionOrderId: string,
    inputItemId: string,
    factoryLocationId: string,
  ): Promise<ProductionWipBalance | null> {
    return this.balances.get(this.key(tenantId, productionOrderId, inputItemId, factoryLocationId)) ?? null;
  }

  async insertBalance(row: {
    tenantId: string; productionOrderId: string;
    inputItemId: string; factoryLocationId: string; wipQtyKg: string;
  }): Promise<ProductionWipBalance> {
    this.counter++;
    const id = nid("wip", this.counter);
    const bal: ProductionWipBalance = {
      id, tenantId: row.tenantId,
      productionOrderId: row.productionOrderId,
      inputItemId: row.inputItemId,
      factoryLocationId: row.factoryLocationId,
      wipQtyKg: row.wipQtyKg, version: 1,
      updatedAt: null, updatedBy: null, createdAt: NOW(),
    };
    this.balances.set(this.key(row.tenantId, row.productionOrderId, row.inputItemId, row.factoryLocationId), bal);
    return bal;
  }

  async updateWipQty(
    tenantId: string,
    productionOrderId: string,
    inputItemId: string,
    factoryLocationId: string,
    patch: { wipQtyKg: string; version: number },
  ): Promise<ProductionWipBalance | null> {
    const k = this.key(tenantId, productionOrderId, inputItemId, factoryLocationId);
    const bal = this.balances.get(k);
    if (!bal) return null;
    const updated = { ...bal, wipQtyKg: patch.wipQtyKg, version: patch.version, updatedAt: NOW() };
    this.balances.set(k, updated);
    return updated;
  }
}
