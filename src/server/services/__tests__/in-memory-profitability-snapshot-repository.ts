/**
 * In-memory ProfitabilitySnapshotRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { SalesProfitabilitySnapshot } from "@/server/db/schema/sales";
import type {
  ProfitabilitySnapshotRepository,
  NewProfitabilitySnapshotInput,
} from "../profitability-snapshot-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryProfitabilitySnapshotRepository implements ProfitabilitySnapshotRepository {
  private snapshots = new Map<string, SalesProfitabilitySnapshot>();
  private counter = 0;

  snapshot() {
    return {
      snapshots: new Map([...this.snapshots].map(([k, v]) => [k, { ...v }])),
      counter: this.counter,
    };
  }

  restore(s: { snapshots: Map<string, SalesProfitabilitySnapshot>; counter: number }) {
    this.snapshots = new Map([...s.snapshots].map(([k, v]) => [k, { ...v }]));
    this.counter = s.counter;
  }

  async insertSnapshot(row: NewProfitabilitySnapshotInput): Promise<SalesProfitabilitySnapshot> {
    this.counter++;
    const id = nid("snap", this.counter);
    const snapshot: SalesProfitabilitySnapshot = {
      id,
      tenantId: row.tenantId,
      salesOrderId: row.salesOrderId,
      version: row.version,
      isActive: "active",
      supersededBySnapshotId: null,
      profileVersion: row.profileVersion,
      rawCostSnapshot: row.rawCostSnapshot,
      singleProductionCostSnapshot: row.singleProductionCostSnapshot,
      twistingCostSnapshot: row.twistingCostSnapshot,
      transportCostSnapshot: row.transportCostSnapshot,
      discountSnapshot: row.discountSnapshot,
      returnImpactSnapshot: row.returnImpactSnapshot,
      revenueSnapshot: row.revenueSnapshot,
      profitAmount: row.profitAmount,
      profitMarginPercent: row.profitMarginPercent,
      missingCostFlagsJson: row.missingCostFlagsJson,
      calculationNotes: row.calculationNotes,
      calculatedAt: NOW(),
      calculatedBy: row.calculatedBy,
      createdBy: row.calculatedBy,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    // Check unique constraint: (tenantId, salesOrderId, version)
    for (const existing of this.snapshots.values()) {
      if (existing.tenantId === row.tenantId && existing.salesOrderId === row.salesOrderId && existing.version === row.version) {
        const err = new Error("duplicate key value violates unique constraint");
        (err as any).code = "23505";
        throw err;
      }
    }
    this.snapshots.set(`${row.tenantId}:${id}`, snapshot);
    return { ...snapshot };
  }

  async findActiveSnapshot(tenantId: string, salesOrderId: string): Promise<SalesProfitabilitySnapshot | null> {
    for (const s of this.snapshots.values()) {
      if (s.tenantId === tenantId && s.salesOrderId === salesOrderId && s.isActive === "active") {
        return { ...s };
      }
    }
    return null;
  }

  async findSnapshotByVersion(tenantId: string, salesOrderId: string, version: number): Promise<SalesProfitabilitySnapshot | null> {
    for (const s of this.snapshots.values()) {
      if (s.tenantId === tenantId && s.salesOrderId === salesOrderId && s.version === version) {
        return { ...s };
      }
    }
    return null;
  }

  async supersedeActiveSnapshot(
    tenantId: string,
    priorSnapshotId: string,
    newSnapshotId: string,
  ): Promise<SalesProfitabilitySnapshot | null> {
    const key = `${tenantId}:${priorSnapshotId}`;
    const snapshot = this.snapshots.get(key);
    if (!snapshot) return null;
    const updated = { ...snapshot, isActive: "superseded" as const, supersededBySnapshotId: newSnapshotId, updatedAt: NOW() };
    this.snapshots.set(key, updated);
    return { ...updated };
  }
}
