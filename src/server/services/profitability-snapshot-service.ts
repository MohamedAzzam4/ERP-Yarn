/**
 * Profitability Snapshot Service — WP-05-02.
 *
 * Contract: docs/contracts/13_work_packages.md WP-05-02
 *   Goal: Implement the immutable/versioned snapshot service required inside
 *   sales approval before approving any sale.
 *
 * Contract: docs/contracts/07_subledger_and_costs_contract.md §§19-20
 *   §19: profit = net_revenue − raw_material_cost − single_yarn_production_cost
 *        − twisting_cost − reviewed_included_direct_costs − return_impact
 *        net_revenue = SUM(line_net_revenue_posted) — from WP-05-01 posted values
 *        Missing required cost sets missing-cost flags + incomplete status,
 *        never silently zero.
 *   §20: Version 1 at sale approval; new version after approved return/correction;
 *        old active → superseded (row immutable); at most one active; historical
 *        snapshots never silently recalculated.
 *
 * Contract: docs/contracts/06_approval_transaction_contract.md §8
 *   Snapshot creation is one atomic step of sale approval; must roll back with
 *   caller; never create snapshot in failure-resolution tx.
 *
 * DEC-019: MVP profitability approximate, deterministic, versioned; uses net
 *   revenue; snapshots immutable; recalculation creates new version preserving prior.
 * DEC-049: Profitability uses net revenue after allocated discount (not double-subtracted).
 * DEC-063: Worker financial-deny absolute.
 *
 * WP-05-02 SCOPE:
 *   - Create version 1 profitability snapshot using WP-05-01 posted line values
 *   - Support missing-cost flags for unavailable cost components
 *   - Immutable once created (value columns never updated; only is_active + superseded_by)
 *   - Transaction-aware: participates in caller transaction, rolls back with caller
 *   - Source/version-unique: duplicate (tenant, sale, version) rejected by unique index +
 *     explicit pre-check. This is NOT independent idempotency replay — the caller
 *     (WP-05-03 approval) owns the idempotency claim and ensures replay never reaches
 *     this service. If the caller's idempotency returns "replay", the snapshot service
 *     is never invoked a second time.
 *
 * WP-05-02 NON-SCOPE (deferred):
 *   - Sale approval (WP-05-03)
 *   - Receivable posting (WP-05-03)
 *   - Stock movements / sale_issue (WP-05-03)
 *   - Payments / settlements (WP-05-04)
 *   - Direct cost review (WP-05-05)
 *   - Return impact (WP-06-02)
 *   - Review/recalculation UI
 */
import "server-only";

import type { ErpUserContext } from "@/server/auth/erp-context";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { appendAuditLog, type AuditTransactionHandle } from "./audit-service";
import type { ProfitabilitySnapshotRepository } from "./profitability-snapshot-repository";
import type { SalesRepository } from "./sales-repository";
import type { SalesProfitabilitySnapshot } from "@/server/db/schema/sales";
import {
  addMoney,
  subtractMoney,
  normalizeMoney,
  compareMoney,
  isZeroMoney,
} from "./decimal-money";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface CreateSnapshotInput {
  salesOrderId: string;
  /** Cost components available at this stage. NULL = missing (will be flagged). */
  rawCost?: string | null;
  singleProductionCost?: string | null;
  twistingCost?: string | null;
  transportCost?: string | null;
  /** Reviewed+included direct costs. Typically 0 at version 1. */
  reviewedDirectCosts?: string | null;
  /** Profile version identifier. */
  profileVersion?: string | null;
  /** Optional calculation notes. */
  calculationNotes?: string | null;
}

export interface CreateSnapshotResult {
  snapshotId: string;
  salesOrderId: string;
  version: number;
  isActive: boolean;
  revenueSnapshot: string;
  discountSnapshot: string;
  rawCostSnapshot: string | null;
  singleProductionCostSnapshot: string | null;
  twistingCostSnapshot: string | null;
  transportCostSnapshot: string | null;
  returnImpactSnapshot: string;
  profitAmount: string;
  profitMarginPercent: string;
  missingCostFlags: Record<string, boolean>;
  hasMissingCosts: boolean;
  profileVersion: string | null;
}

// ---------------------------------------------------------------------------
// Errors.
// ---------------------------------------------------------------------------

export class ProfitabilitySnapshotError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProfitabilitySnapshotError";
    this.code = code;
  }
}

export class SaleNotFoundForSnapshotError extends ProfitabilitySnapshotError {
  constructor(id: string) {
    super("SALE_NOT_FOUND", `Sale '${id}' not found.`);
    this.name = "SaleNotFoundForSnapshotError";
  }
}

export class CommercialTotalsNotCompletedError extends ProfitabilitySnapshotError {
  constructor(id: string) {
    super("VALIDATION_FAILED", `Sale '${id}' commercial totals not completed — cannot create profitability snapshot.`);
    this.name = "CommercialTotalsNotCompletedError";
  }
}

export class SnapshotVersionAlreadyExistsError extends ProfitabilitySnapshotError {
  constructor(salesOrderId: string, version: number) {
    super("STATE_CONFLICT", `Snapshot version ${version} already exists for sale '${salesOrderId}'.`);
    this.name = "SnapshotVersionAlreadyExistsError";
  }
}

// ---------------------------------------------------------------------------
// Service deps.
// ---------------------------------------------------------------------------

export interface ProfitabilitySnapshotServiceDeps {
  snapshotRepository: ProfitabilitySnapshotRepository;
  salesRepository: SalesRepository;
  audit: AuditTransactionHandle;
}

const SNAPSHOT_ENTITY_TYPE = "sales_profitability_snapshot";

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Calculate profit margin percent: (profit / revenue) × 100, ROUND_HALF_UP to scale 6.
 *
 * Contract 07 §19: profit_margin_percent = profit_amount / revenue_snapshot × 100
 * DEC-047: ROUND_HALF_UP at posted boundary (snapshot is a posted boundary).
 * DEC-042: ratios ≥12 decimals; NUMERIC(18,6) for margin.
 */
function calculateMarginPercent(profit: string, revenue: string): string {
  if (isZeroMoney(revenue)) return "0.000000";
  // Use BigInt: profit and revenue are at scale 2 (× 100)
  // margin = (profit × 100 × 10^6) / (revenue × 10^2) = (profit × 10^8) / revenue
  // But we need ROUND_HALF_UP at scale 6
  const profitScaled = parseToScaledInt(profit, 2);
  const revenueScaled = parseToScaledInt(revenue, 2);
  if (revenueScaled === 0n) return "0.000000";

  // margin_scaled_6 = round_half_up(profit × 100 × 10^6 / revenue)
  // = round_half_up(profit × 10^8 / revenue)
  const numerator = profitScaled * 100000000n; // × 10^8
  const quotient = numerator / revenueScaled;
  const remainder = numerator % revenueScaled;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  let result = quotient;
  if (absRemainder * 2n >= revenueScaled) {
    result = quotient + (quotient < 0n ? -1n : 1n);
  }
  // Format at scale 6
  const isNeg = result < 0n;
  const absStr = (isNeg ? -result : result).toString().padStart(7, "0");
  const intPart = absStr.slice(0, -6) || "0";
  const fracPart = absStr.slice(-6);
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}

function parseToScaledInt(value: string, scale: number): bigint {
  const normalized = value.trim();
  const neg = normalized.startsWith("-");
  const abs = neg ? normalized.slice(1) : normalized;
  const [intPart, fracPart = ""] = abs.split(".");
  const fracPadded = (fracPart + "0".repeat(scale)).slice(0, scale);
  const scaled = BigInt(intPart || "0") * BigInt(10 ** scale) + BigInt(fracPadded);
  return neg ? -scaled : scaled;
}

// ---------------------------------------------------------------------------
// ProfitabilitySnapshotService.
// ---------------------------------------------------------------------------

export class ProfitabilitySnapshotService {
  constructor(private readonly deps: ProfitabilitySnapshotServiceDeps) {}

  /**
   * Create a version 1 profitability snapshot for a sale.
   *
   * This service is designed to be called from within the WP-05-03 sale
   * approval transaction. It reads WP-05-01 posted commercial totals from
   * the sale header + lines, combines with available cost components,
   * computes profit/margin, flags missing costs, and inserts an immutable
   * snapshot row.
   *
   * The service does NOT commit independently — it uses the caller's
   * transaction-scoped repository handles. If the caller transaction rolls
   * back, the snapshot insert rolls back too.
   *
   * Permission: this service is invoked by the approval flow (WP-05-03)
   * which already checks `sales.approve`. The service itself does NOT
   * re-check permission — it trusts the caller. This is consistent with
   * the pattern in InventoryLedgerService (defense-in-depth permission
   * check at the boundary, not at every internal call).
   *
   * DEC-049: Profitability uses net revenue after allocated discount.
   *   revenue_snapshot = document_total_posted (already net of discount)
   *   discount_snapshot = order_discount_total (informational copy, NOT subtracted again)
   *   profit = revenue_snapshot - sum(available costs) - return_impact
   */
  async createVersion1Snapshot(
    user: ErpUserContext,
    input: CreateSnapshotInput,
  ): Promise<CreateSnapshotResult> {
    // Fetch sale
    const sale = await this.deps.salesRepository.findSaleById(user.tenantId, input.salesOrderId);
    if (!sale) throw new SaleNotFoundForSnapshotError(input.salesOrderId);

    // Verify commercial totals are completed
    if (sale.documentTotalPosted === "0" || sale.documentTotalPosted === "0.00") {
      // Check if lines have commercial totals
      const lines = await this.deps.salesRepository.findSaleLines(user.tenantId, sale.id);
      const hasCommercialTotals = lines.length > 0 && lines.every(l => l.lineNetRevenuePosted !== null);
      if (!hasCommercialTotals) {
        throw new CommercialTotalsNotCompletedError(sale.id);
      }
    }

    // Read posted values from WP-05-01
    const revenueSnapshot = normalizeMoney(sale.documentTotalPosted);
    const discountSnapshot = normalizeMoney(sale.orderDiscountTotal);
    const returnImpact = "0.00"; // Version 1: no returns yet

    // Cost components — NULL means missing
    const rawCost = input.rawCost ?? null;
    const singleProductionCost = input.singleProductionCost ?? null;
    const twistingCost = input.twistingCost ?? null;
    const transportCost = input.transportCost ?? null;
    const reviewedDirectCosts = input.reviewedDirectCosts ?? null;

    // Build missing-cost flags
    const missingCostFlags: Record<string, boolean> = {
      raw_material: rawCost === null,
      single_yarn_production: singleProductionCost === null,
      twisting: twistingCost === null,
      transport: transportCost === null,
      direct_costs: reviewedDirectCosts === null,
    };
    const hasMissingCosts = Object.values(missingCostFlags).some(v => v === true);

    // Compute profit: revenue - sum(available costs) - return_impact
    // Missing costs are EXCLUDED from the sum (NOT treated as zero).
    // This means profit is INCOMPLETE when costs are missing — the
    // missing-cost flags signal this to the caller.
    let totalCosts = "0.00";
    if (rawCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(rawCost));
    if (singleProductionCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(singleProductionCost));
    if (twistingCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(twistingCost));
    if (transportCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(transportCost));
    if (reviewedDirectCosts !== null) totalCosts = addMoney(totalCosts, normalizeMoney(reviewedDirectCosts));

    const profitAmount = subtractMoney(revenueSnapshot, addMoney(totalCosts, returnImpact));
    const profitMarginPercent = calculateMarginPercent(profitAmount, revenueSnapshot);

    // Check for existing version 1
    const existing = await this.deps.snapshotRepository.findSnapshotByVersion(
      user.tenantId, sale.id, 1,
    );
    if (existing) {
      throw new SnapshotVersionAlreadyExistsError(sale.id, 1);
    }

    // Insert the snapshot row
    const snapshot = await this.deps.snapshotRepository.insertSnapshot({
      tenantId: user.tenantId,
      salesOrderId: sale.id,
      version: 1,
      profileVersion: input.profileVersion ?? "v1-mvp",
      rawCostSnapshot: rawCost !== null ? normalizeMoney(rawCost) : null,
      singleProductionCostSnapshot: singleProductionCost !== null ? normalizeMoney(singleProductionCost) : null,
      twistingCostSnapshot: twistingCost !== null ? normalizeMoney(twistingCost) : null,
      transportCostSnapshot: transportCost !== null ? normalizeMoney(transportCost) : null,
      discountSnapshot,
      returnImpactSnapshot: returnImpact,
      revenueSnapshot,
      profitAmount,
      profitMarginPercent,
      missingCostFlagsJson: JSON.stringify(missingCostFlags),
      calculationNotes: input.calculationNotes ?? (hasMissingCosts ? "Incomplete profitability — missing cost components flagged." : null),
      calculatedBy: user.userId,
    });

    // Audit (inside the caller transaction — DEC-024)
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: SNAPSHOT_ENTITY_TYPE,
      entityId: snapshot.id,
      actionType: "profitability_snapshot.create_v1",
      newValuesJson: {
        salesOrderId: sale.id,
        version: 1,
        revenueSnapshot,
        discountSnapshot,
        profitAmount,
        profitMarginPercent,
        hasMissingCosts,
        missingCostFlags,
        profileVersion: input.profileVersion ?? "v1-mvp",
      },
    });

    return {
      snapshotId: snapshot.id,
      salesOrderId: sale.id,
      version: 1,
      isActive: true,
      revenueSnapshot,
      discountSnapshot,
      rawCostSnapshot: snapshot.rawCostSnapshot,
      singleProductionCostSnapshot: snapshot.singleProductionCostSnapshot,
      twistingCostSnapshot: snapshot.twistingCostSnapshot,
      transportCostSnapshot: snapshot.transportCostSnapshot,
      returnImpactSnapshot: returnImpact,
      profitAmount,
      profitMarginPercent,
      missingCostFlags,
      hasMissingCosts,
      profileVersion: input.profileVersion ?? "v1-mvp",
    };
  }

  /**
   * Read the active snapshot for a sale.
   *
   * Permission: profitability.view (Owner/Accountant only — workers denied via DEC-063).
   * Worker responses must OMIT all profitability fields (profit_amount, margin,
   * missing_cost_flags, profile_version, cost snapshots).
   */
  async readActiveSnapshot(
    user: ErpUserContext,
    effective: EffectivePermissions,
    salesOrderId: string,
  ): Promise<SalesProfitabilitySnapshot | null> {
    // Permission check for reading profitability
    if (!effective.permissionKeys.has("profitability.view")) {
      return null; // Worker/denied → return null (no disclosure)
    }

    return this.deps.snapshotRepository.findActiveSnapshot(user.tenantId, salesOrderId);
  }

  // =========================================================================
  // WP-05-05: Later snapshot versions (V2+) after approved direct cost.
  // =========================================================================

  /**
   * WP-05-05: Create a later profitability snapshot version (V2+) after an
   * approved direct cost is included.
   *
   * Contract 07 §20:
   *   - New version after approved return, correction or reviewed cost completion.
   *   - Old active version becomes superseded; row remains immutable.
   *   - At most one active version.
   *   - Historical approved snapshots never silently recalculate.
   *
   * This method:
   *   1. Finds the current active snapshot (must exist — V1 from sale approval).
   *   2. Computes the new version number = active.version + 1.
   *   3. Recalculates profit using the prior snapshot's cost components + the
   *      newly included direct costs.
   *   4. Inserts the new immutable snapshot row (is_active = true).
   *   5. Supersedes the prior active snapshot (is_active = 'superseded',
   *      superseded_by_snapshot_id = new snapshot id).
   *
   * Permission: this service is invoked by the DirectCostService approval flow
   * which already checks `direct_costs.review`. The service itself does NOT
   * re-check permission — it trusts the caller (same pattern as V1).
   *
   * The prior snapshot's value columns (raw_cost, single_production_cost, etc.)
   * remain IMMUTABLE — only is_active + superseded_by_snapshot_id are updated.
   */
  async createLaterSnapshot(
    user: ErpUserContext,
    input: {
      salesOrderId: string;
      /** Total reviewed+included direct costs to include in this version. */
      reviewedDirectCosts: string;
      /** Optional profile version label. */
      profileVersion?: string | null;
      /** Optional calculation notes. */
      calculationNotes?: string | null;
    },
  ): Promise<CreateSnapshotResult> {
    // Fetch sale
    const sale = await this.deps.salesRepository.findSaleById(user.tenantId, input.salesOrderId);
    if (!sale) throw new SaleNotFoundForSnapshotError(input.salesOrderId);

    // Find the current active snapshot (must exist — V1 from sale approval)
    const activeSnapshot = await this.deps.snapshotRepository.findActiveSnapshot(user.tenantId, sale.id);
    if (!activeSnapshot) {
      throw new ProfitabilitySnapshotError(
        "NO_ACTIVE_SNAPSHOT",
        `Cannot create later snapshot for sale '${sale.id}' — no active V1 snapshot exists.`,
      );
    }

    // Compute new version number
    const newVersion = activeSnapshot.version + 1;

    // Reuse revenue/discount/return from the prior snapshot (immutable values)
    const revenueSnapshot = activeSnapshot.revenueSnapshot ?? "0.00";
    const discountSnapshot = activeSnapshot.discountSnapshot ?? "0.00";
    const returnImpact = activeSnapshot.returnImpactSnapshot ?? "0.00";

    // Cost components — carry forward from prior snapshot + update direct costs
    const rawCost = activeSnapshot.rawCostSnapshot;
    const singleProductionCost = activeSnapshot.singleProductionCostSnapshot;
    const twistingCost = activeSnapshot.twistingCostSnapshot;
    const transportCost = activeSnapshot.transportCostSnapshot;
    const reviewedDirectCosts = normalizeMoney(input.reviewedDirectCosts);

    // Build missing-cost flags (same logic as V1)
    const missingCostFlags: Record<string, boolean> = {
      raw_material: rawCost === null,
      single_yarn_production: singleProductionCost === null,
      twisting: twistingCost === null,
      transport: transportCost === null,
      direct_costs: false, // We have reviewed direct costs in this version
    };
    const hasMissingCosts = Object.values(missingCostFlags).some(v => v === true);

    // Compute profit: revenue - sum(available costs) - return_impact
    let totalCosts = "0.00";
    if (rawCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(rawCost));
    if (singleProductionCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(singleProductionCost));
    if (twistingCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(twistingCost));
    if (transportCost !== null) totalCosts = addMoney(totalCosts, normalizeMoney(transportCost));
    totalCosts = addMoney(totalCosts, reviewedDirectCosts);

    const profitAmount = subtractMoney(revenueSnapshot, addMoney(totalCosts, returnImpact));
    const profitMarginPercent = calculateMarginPercent(profitAmount, revenueSnapshot);

    // Insert the new snapshot row (is_active = true)
    const newSnapshot = await this.deps.snapshotRepository.insertSnapshot({
      tenantId: user.tenantId,
      salesOrderId: sale.id,
      version: newVersion,
      profileVersion: input.profileVersion ?? `v${newVersion}-direct-cost`,
      rawCostSnapshot: rawCost,
      singleProductionCostSnapshot: singleProductionCost,
      twistingCostSnapshot: twistingCost,
      transportCostSnapshot: transportCost,
      discountSnapshot,
      returnImpactSnapshot: returnImpact,
      revenueSnapshot,
      profitAmount,
      profitMarginPercent,
      missingCostFlagsJson: JSON.stringify(missingCostFlags),
      calculationNotes: input.calculationNotes ?? `Version ${newVersion}: includes ${reviewedDirectCosts} reviewed direct costs.`,
      calculatedBy: user.userId,
    });
    // Supersede the prior active snapshot (immutable values, only is_active + superseded_by updated)
    await this.deps.snapshotRepository.supersedeActiveSnapshot(
      user.tenantId, activeSnapshot.id, newSnapshot.id,
    );

    // Audit
    await appendAuditLog(this.deps.audit, user.tenantId, user.userId, {
      entityType: SNAPSHOT_ENTITY_TYPE,
      entityId: newSnapshot.id,
      actionType: "profitability_snapshot.create_later_version",
      newValuesJson: {
        salesOrderId: sale.id,
        version: newVersion,
        priorSnapshotId: activeSnapshot.id,
        priorVersion: activeSnapshot.version,
        reviewedDirectCosts,
        revenueSnapshot,
        profitAmount,
        profitMarginPercent,
        hasMissingCosts,
        missingCostFlags,
        profileVersion: input.profileVersion ?? `v${newVersion}-direct-cost`,
      },
    });

    return {
      snapshotId: newSnapshot.id,
      salesOrderId: sale.id,
      version: newVersion,
      isActive: true,
      revenueSnapshot,
      discountSnapshot,
      rawCostSnapshot: rawCost,
      singleProductionCostSnapshot: singleProductionCost,
      twistingCostSnapshot: twistingCost,
      transportCostSnapshot: transportCost,
      returnImpactSnapshot: returnImpact,
      profitAmount,
      profitMarginPercent,
      missingCostFlags,
      hasMissingCosts,
      profileVersion: input.profileVersion ?? `v${newVersion}-direct-cost`,
    };
  }
}
