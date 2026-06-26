/**
 * Worker financial-deny policy (DEC-063).
 *
 * Contract: docs/02_decision_log_and_scope.md DEC-063
 *   "Worker financial-deny is absolute and non-overridable in MVP. If any
 *    assigned role is a Worker-family role, cost, price,
 *    supplier/customer/factory balance, profitability, direct-cost,
 *    payment, settlement and other financial/accounting fields remain
 *    denied across UI, API, nested data, exports, logs and errors, even
 *    if another role or custom grant would otherwise allow them."
 *
 * Contract: docs/contracts/11_permission_matrix.md §6
 *   "a worker role code always enforces the worker financial-deny ceiling
 *    even if the same user is assigned another role"
 *
 * Contract: docs/contracts/11_permission_matrix.md §8
 *   Field-level matrix: Workers are redacted on every financial field
 *   group.
 *
 * This module is the single source of truth for:
 *   1. The set of Worker-family role codes.
 *   2. The set of financial permission keys that Workers can NEVER hold.
 *   3. The set of financial field keys that Workers can NEVER see.
 *   4. The policy function that decides whether a given user-role set
 *      triggers the Worker financial-deny ceiling.
 *
 * This module is pure (no I/O, no DB). It is imported by:
 *   - Backend permission guards (WP-01-02) to reject financial fields in
 *     worker requests and redact them from worker responses.
 *   - Tests (this package) to verify the policy.
 *
 * Future packages that add new financial permission/field keys MUST add
 * them to the sets below. Adding a key without registering it here would
 * silently bypass the Worker financial-deny ceiling — a critical
 * permission leak.
 */

import type { RoleCode } from "./role-codes";

// ---------------------------------------------------------------------------
// 1. Worker-family role codes (DEC-063: "Worker-family role").
// ---------------------------------------------------------------------------

export const WORKER_FAMILY_ROLE_CODES: ReadonlySet<RoleCode> = new Set([
  "warehouse_employee",
  "production_employee",
  "quality_employee",
]);

export function isWorkerFamilyRole(roleCode: RoleCode): boolean {
  return WORKER_FAMILY_ROLE_CODES.has(roleCode);
}

/**
 * DEC-063 trigger: if ANY assigned role is a Worker-family role, the
 * financial-deny ceiling applies to the entire user session.
 */
export function triggersWorkerFinancialDeny(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
): boolean {
  return assignedRoleCodes.some((rc) => isWorkerFamilyRole(rc));
}

// ---------------------------------------------------------------------------
// 2. Financial permission keys Workers can NEVER hold (DEC-063).
// ---------------------------------------------------------------------------

/**
 * The absolute Worker financial-deny set. These permission keys are
 * denied to any user with at least one Worker-family role, regardless of
 * other roles or custom grants.
 *
 * Source: Contract 11 §12 "Required Permission Keys" filtered to
 * financial/price/cost/balance/payment/profitability keys.
 */
export const WORKER_DENIED_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  // Pricing
  "sales.view_price",
  // Cost
  "production.view_cost",
  // Balances
  "balances.view_customer",
  "balances.view_supplier_factory",
  // Direct costs (financial review)
  "direct_costs.review",
  // Payments
  "payments.create",
  "payments.approve",
  "payments.reverse",
  // Profitability
  "profitability.view",
  // Audit (financial visibility)
  "audit.view",
  // Migration (financial warnings)
  "migration.prepare",
  "migration.review",
  "migration.approve",
  "migration.commit",
  // Backup (financial evidence)
  "backup.view",
  "backup.run",
  "backup.restore_test",
  // Settings (financial config)
  "settings.view_restricted",
  "settings.manage",
  // User management (could grant financial roles)
  "users.view_limited",
  "users.manage",
  "permissions.manage",
  // Exports (financial reports)
  "exports.internal",
]);

// ---------------------------------------------------------------------------
// 3. Financial field keys Workers can NEVER see (DEC-063 + Contract 11 §8).
// ---------------------------------------------------------------------------

/**
 * The absolute Worker field-redaction set. These field keys are redacted
 * from any user with at least one Worker-family role, regardless of other
 * roles or custom grants.
 *
 * Source: Contract 11 §8 "Field-Level Permission Matrix" — Worker column
 * is "redacted" for all financial field groups.
 * Source: Contract 11 §8 "Restricted examples" list.
 */
export const WORKER_DENIED_FIELD_KEYS: ReadonlySet<string> = new Set([
  "purchase_price_per_ton",
  "total_purchase_cost",
  "price_per_ton",
  "gross_revenue",
  "discount_amount",
  "net_revenue",
  "line_allocated_discount_precise",
  "line_allocated_discount_posted",
  "line_net_revenue_precise",
  "line_net_revenue_posted",
  "order_discount_total",
  "rounding_adjustment",
  "document_total_posted",
  "return_credit_value",
  "replacement_receivable",
  "factory_rate_per_ton_used",
  "calculated_factory_cost",
  "factory_payable",
  "actual_payer_type",
  "direct_cost_allocations",
  "customer_balance",
  "supplier_balance",
  "factory_balance",
  "account_entries",
  "payment_settlements",
  "profit_amount",
  "profit_margin_percent",
  "profitability_profile_version",
  "missing_cost_flags",
]);

// ---------------------------------------------------------------------------
// 4. Policy entry points.
// ---------------------------------------------------------------------------

export interface WorkerFinancialDenyDecision {
  /** True when DEC-063 ceiling applies (user has a Worker-family role). */
  enforced: boolean;
  /** Permission keys denied by the ceiling (only populated when enforced). */
  deniedPermissionKeys: ReadonlySet<string>;
  /** Field keys denied by the ceiling (only populated when enforced). */
  deniedFieldKeys: ReadonlySet<string>;
}

/**
 * Compute the Worker financial-deny decision for a given user-role set.
 *
 * Pure function. No I/O.
 */
export function computeWorkerFinancialDenyDecision(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
): WorkerFinancialDenyDecision {
  if (!triggersWorkerFinancialDeny(assignedRoleCodes)) {
    return {
      enforced: false,
      deniedPermissionKeys: new Set(),
      deniedFieldKeys: new Set(),
    };
  }
  return {
    enforced: true,
    deniedPermissionKeys: WORKER_DENIED_PERMISSION_KEYS,
    deniedFieldKeys: WORKER_DENIED_FIELD_KEYS,
  };
}

/**
 * Check whether a specific permission is denied to a user by the Worker
 * financial-deny ceiling.
 *
 * Returns true when:
 *   - the user has at least one Worker-family role AND
 *   - the permission key is in WORKER_DENIED_PERMISSION_KEYS.
 */
export function isPermissionDeniedByWorkerCeiling(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  permissionKey: string,
): boolean {
  const decision = computeWorkerFinancialDenyDecision(assignedRoleCodes);
  if (!decision.enforced) return false;
  return decision.deniedPermissionKeys.has(permissionKey);
}

/**
 * Check whether a specific field is denied to a user by the Worker
 * financial-deny ceiling.
 *
 * Returns true when:
 *   - the user has at least one Worker-family role AND
 *   - the field key is in WORKER_DENIED_FIELD_KEYS.
 */
export function isFieldDeniedByWorkerCeiling(
  assignedRoleCodes: ReadonlyArray<RoleCode>,
  fieldKey: string,
): boolean {
  const decision = computeWorkerFinancialDenyDecision(assignedRoleCodes);
  if (!decision.enforced) return false;
  return decision.deniedFieldKeys.has(fieldKey);
}
