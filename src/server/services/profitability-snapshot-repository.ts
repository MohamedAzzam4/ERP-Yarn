/**
 * Profitability Snapshot Repository — WP-05-02.
 *
 * Repository interface for sales_profitability_snapshots.
 * WP-05-02 scope: create version 1, find active, supersede prior.
 */
import "server-only";

import type { SalesProfitabilitySnapshot } from "@/server/db/schema/sales";

export interface NewProfitabilitySnapshotInput {
  tenantId: string;
  salesOrderId: string;
  version: number;
  profileVersion: string | null;
  rawCostSnapshot: string | null;
  singleProductionCostSnapshot: string | null;
  twistingCostSnapshot: string | null;
  transportCostSnapshot: string | null;
  discountSnapshot: string | null;
  returnImpactSnapshot: string | null;
  revenueSnapshot: string;
  profitAmount: string;
  profitMarginPercent: string;
  missingCostFlagsJson: string | null;
  calculationNotes: string | null;
  calculatedBy: string;
}

export interface ProfitabilitySnapshotRepository {
  /** Insert a new snapshot row. */
  insertSnapshot(row: NewProfitabilitySnapshotInput): Promise<SalesProfitabilitySnapshot>;

  /** Find the active snapshot for a sale (SELECT FOR UPDATE in DB impl). */
  findActiveSnapshot(tenantId: string, salesOrderId: string): Promise<SalesProfitabilitySnapshot | null>;

  /** Find a snapshot by version. */
  findSnapshotByVersion(tenantId: string, salesOrderId: string, version: number): Promise<SalesProfitabilitySnapshot | null>;

  /**
   * Supersede the prior active snapshot: set is_active='superseded' and
   * superseded_by_snapshot_id = newSnapshotId.
   * Returns the updated row, or null if not found.
   */
  supersedeActiveSnapshot(
    tenantId: string,
    priorSnapshotId: string,
    newSnapshotId: string,
  ): Promise<SalesProfitabilitySnapshot | null>;
}
