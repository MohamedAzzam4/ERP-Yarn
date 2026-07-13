/**
 * Drizzle-backed ProfitabilitySnapshotRepository — the production DB repository.
 *
 * WP-05-02: DB-backed implementation for sales_profitability_snapshots.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { salesProfitabilitySnapshots } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  ProfitabilitySnapshotRepository,
  NewProfitabilitySnapshotInput,
} from "./profitability-snapshot-repository";
import type { SalesProfitabilitySnapshot } from "@/server/db/schema/sales";

type Db = NonNullable<typeof DbType>;

export class ProfitabilitySnapshotDbRepository implements ProfitabilitySnapshotRepository {
  constructor(private readonly db: Db) {}

  async insertSnapshot(row: NewProfitabilitySnapshotInput): Promise<SalesProfitabilitySnapshot> {
    const [result] = await this.db
      .insert(salesProfitabilitySnapshots)
      .values({
        tenantId: row.tenantId,
        salesOrderId: row.salesOrderId,
        version: row.version,
        isActive: "active",
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
        calculatedBy: row.calculatedBy,
        createdBy: row.calculatedBy,
      })
      .returning();
    return result!;
  }

  async findActiveSnapshot(tenantId: string, salesOrderId: string): Promise<SalesProfitabilitySnapshot | null> {
    const [result] = await this.db
      .select()
      .from(salesProfitabilitySnapshots)
      .where(
        and(
          eq(salesProfitabilitySnapshots.tenantId, tenantId),
          eq(salesProfitabilitySnapshots.salesOrderId, salesOrderId),
          eq(salesProfitabilitySnapshots.isActive, "active"),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findSnapshotByVersion(tenantId: string, salesOrderId: string, version: number): Promise<SalesProfitabilitySnapshot | null> {
    const [result] = await this.db
      .select()
      .from(salesProfitabilitySnapshots)
      .where(
        and(
          eq(salesProfitabilitySnapshots.tenantId, tenantId),
          eq(salesProfitabilitySnapshots.salesOrderId, salesOrderId),
          eq(salesProfitabilitySnapshots.version, version),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async supersedeActiveSnapshot(
    tenantId: string,
    priorSnapshotId: string,
    newSnapshotId: string,
  ): Promise<SalesProfitabilitySnapshot | null> {
    const [result] = await this.db
      .update(salesProfitabilitySnapshots)
      .set({
        isActive: "superseded",
        supersededBySnapshotId: newSnapshotId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(salesProfitabilitySnapshots.tenantId, tenantId),
          eq(salesProfitabilitySnapshots.id, priorSnapshotId),
        ),
      )
      .returning();
    return result ?? null;
  }
}

export function createProfitabilitySnapshotDbRepository(db: Db): ProfitabilitySnapshotDbRepository {
  return new ProfitabilitySnapshotDbRepository(db);
}
