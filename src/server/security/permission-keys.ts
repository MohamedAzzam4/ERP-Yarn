/**
 * Permission key constants and module/action taxonomy.
 *
 * Contract: docs/contracts/11_permission_matrix.md §12 "Required Permission Keys"
 *   "At minimum: [list of 50+ permission keys]. Exact seeds must match API
 *    routes. No worker wildcard permission."
 *
 * Contract: docs/contracts/11_permission_matrix.md §6 "Action Legend"
 *   V view, C create draft/request, U update own/authorized draft before
 *   approval, S submit for review/approval, A approve/reject, X cancel
 *   permitted draft/pending record, R reverse/correct through controlled
 *   workflow, E export internal report, P view price, K view cost/rate,
 *   F view profitability, L view audit, M manage/configure, - prohibited.
 *
 * This module is the single source of truth for:
 *   1. The complete set of MVP permission keys (Contract 11 §12).
 *   2. The action-code taxonomy (Contract 11 §6).
 *   3. The module-name taxonomy derived from permission key prefixes.
 *
 * WP-01-02 scope: pure constants and types. No I/O, no DB.
 *
 * Future packages that add new permission keys MUST add them here AND to
 * the seed file. Adding a key without registering it here would cause the
 * guard helpers to reject it as an unknown permission — fail-safe.
 */
import "server-only";

// ---------------------------------------------------------------------------
// 1. Action codes (Contract 11 §6).
// ---------------------------------------------------------------------------

export const PERMISSION_ACTION_CODES = [
  "V", // view
  "C", // create draft/request
  "U", // update own/authorized draft before approval
  "S", // submit for review/approval
  "A", // approve/reject
  "X", // cancel permitted draft/pending record
  "R", // reverse/correct through controlled workflow
  "E", // export internal report
  "P", // view price
  "K", // view cost/rate
  "F", // view profitability
  "L", // view audit
  "M", // manage/configure
] as const;

export type PermissionActionCode =
  (typeof PERMISSION_ACTION_CODES)[number];

// ---------------------------------------------------------------------------
// 2. Module names (derived from permission key prefixes).
// ---------------------------------------------------------------------------

export const PERMISSION_MODULES = [
  "users",
  "permissions",
  "settings",
  "inventory",
  "sales",
  "production",
  "payments",
  "balances",
  "direct_costs",
  "quality_tests",
  "quality_risk_sales",
  "complaints",
  "returns",
  "profitability",
  "audit",
  "migration",
  "backup",
  "exports",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

// ---------------------------------------------------------------------------
// 3. Complete MVP permission key set (Contract 11 §12).
// ---------------------------------------------------------------------------

/**
 * The authoritative list of MVP permission keys.
 *
 * Source: docs/contracts/11_permission_matrix.md §12 "Required Permission Keys".
 *
 * Every high-risk API endpoint MUST declare exactly one of these keys
 * (Contract 11 §17). Adding a permission key not in this set is a
 * contract violation.
 */
export const PERMISSION_KEYS = [
  // Users / permissions / settings
  "users.view_limited",
  "users.manage",
  "permissions.manage",
  "settings.view_restricted",
  "settings.manage",

  // Inventory
  "inventory.view_quantity",
  "inventory.receive.create",
  "inventory.receive.approve",
  "inventory.transfer.create",
  "inventory.transfer.approve",
  "inventory.adjustment.request",
  "inventory.adjustment.approve",
  "inventory.reverse",
  "inventory.request_correction",
  "inventory.correct",

  // Sales
  "sales.create",
  "sales.submit",
  "sales.approve",
  "sales.cancel",
  "sales.reverse",
  "sales.view_price",
  "sales.request_correction",
  "sales.correct",

  // Production
  "production.create",
  "production.issue_draft.create",
  "production.issue_draft.submit",
  "production.issue.approve",
  "production.receive_draft",
  "production.approve",
  "production.return_from_wip.request",
  "production.return_from_wip.approve",
  "production.view_cost",
  "production.request_correction",
  "production.correct",

  // Payments
  "payments.create",
  "payments.approve",
  "payments.reverse",

  // Balances
  "balances.view_customer",
  "balances.view_supplier_factory",

  // Direct costs
  "direct_costs.review",

  // Quality
  "quality_tests.create",
  "quality_risk_sales.approve",

  // Complaints
  "complaints.investigate",

  // Returns
  "returns.create",
  "returns.approve",
  "returns.request_correction",
  "returns.correct",

  // Profitability
  "profitability.view",

  // Audit
  "audit.view",

  // Migration
  "migration.prepare",
  "migration.review",
  "migration.approve",
  "migration.commit",

  // Backup
  "backup.view",
  "backup.run",
  "backup.restore_test",

  // Exports
  "exports.internal",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * Readonly set of all permission keys for O(1) membership checks.
 */
export const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/**
 * Verify that a string is a valid MVP permission key.
 *
 * Use this to validate permission declarations at module load time
 * (fail-fast if a typo or unknown key is referenced).
 */
export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEY_SET.has(value);
}

/**
 * Assert that a string is a valid MVP permission key. Throws if not.
 *
 * Use in service/route handler code to fail-fast on unknown permissions.
 */
export function assertPermissionKey(value: string): asserts value is PermissionKey {
  if (!isPermissionKey(value)) {
    throw new Error(
      `Unknown permission key: '${value}'. Every permission must be in the MVP permission key set (Contract 11 §12). If this is a new permission, add it to src/server/security/permission-keys.ts first.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Permission key parsing (module + action from key string).
// ---------------------------------------------------------------------------

/**
 * Parse a permission key into its module prefix and action suffix.
 *
 * Permission keys follow the convention `<module>.<action>` where:
 *   - `<module>` is one of PERMISSION_MODULES
 *   - `<action>` is a stable action name (e.g. "create", "approve",
 *     "view_price", "view_cost")
 *
 * Some keys have a sub-module segment, e.g.:
 *   - `production.issue_draft.create` → module=production, action=issue_draft.create
 *   - `production.return_from_wip.request` → module=production, action=return_from_wip.request
 *   - `inventory.receive.create` → module=inventory, action=receive.create
 *
 * For these multi-segment keys, the module is the FIRST segment and the
 * action is everything after the first dot.
 */
export interface ParsedPermissionKey {
  module: PermissionModule;
  action: string;
}

export function parsePermissionKey(key: string): ParsedPermissionKey {
  const dotIndex = key.indexOf(".");
  if (dotIndex === -1) {
    throw new Error(
      `Invalid permission key '${key}': must be in '<module>.<action>' form.`,
    );
  }
  const moduleStr = key.slice(0, dotIndex);
  const action = key.slice(dotIndex + 1);

  if (!isPermissionModule(moduleStr)) {
    throw new Error(
      `Invalid permission key '${key}': unknown module '${moduleStr}'. Allowed modules: ${PERMISSION_MODULES.join(", ")}.`,
    );
  }

  return { module: moduleStr, action };
}

function isPermissionModule(value: string): value is PermissionModule {
  return (PERMISSION_MODULES as ReadonlyArray<string>).includes(value);
}

// ---------------------------------------------------------------------------
// 5. Permission key → action-code mapping (Contract 11 §6 legend).
// ---------------------------------------------------------------------------

/**
 * Map a permission key to its Contract 11 §6 action code.
 *
 * This mapping is derived from the permission key's action suffix.
 * For multi-segment keys (e.g. `production.issue_draft.create`), the
 * action is everything after the first dot, and we test the SUFFIX
 * (last segment) to determine the action code.
 *
 * Suffix → action code:
 *   - "view_*"      → V (view), except view_price → P, view_cost → K
 *   - "create"      → C (create draft/request)
 *   - "submit"      → S (submit for review/approval)
 *   - "approve"     → A (approve/reject)
 *   - "cancel"      → X (cancel)
 *   - "reverse"     → R (reverse/correct)
 *   - "request_correction" → C (request is a create-draft action)
 *   - "correct"     → R (correction is a reverse/correct action)
 *   - "manage"      → M (manage/configure)
 *   - "review"      → A (review is an approve/reject action)
 *   - "run"         → M (backup run is a manage/configure action)
 *   - "restore_test" → M (backup restore-test is a manage/configure action)
 *   - "investigate" → V (investigation is a view action with comment)
 *   - "internal"    → E (export internal report)
 *   - "commit"      → A (migration commit is an approve action)
 *
 * For keys not covered by these patterns, this function returns null and
 * the caller MUST treat it as "Unresolved / requires owner decision" per
 * Contract 14 §1.
 */
export function actionCodeForKey(key: PermissionKey): PermissionActionCode | null {
  const { action } = parsePermissionKey(key);
  // Use the LAST segment of the action as the suffix for matching.
  // e.g. action="issue_draft.create" → suffix="create"
  const lastDot = action.lastIndexOf(".");
  const suffix = lastDot === -1 ? action : action.slice(lastDot + 1);

  // View-family actions (identified by "view_" prefix on the LAST segment,
  // except "view_price" and "view_cost" which map to P and K).
  // For multi-segment actions like "receive.create", the suffix is "create"
  // so this branch only matches single-segment view actions.
  if (suffix.startsWith("view_")) {
    if (suffix === "view_price") return "P";
    if (suffix === "view_cost") return "K";
    return "V";
  }
  // Also handle single-segment "view" (profitability.view, audit.view)
  if (suffix === "view") {
    if (key === "profitability.view") return "F";
    if (key === "audit.view") return "L";
    return "V"; // generic view
  }

  // Create / draft
  if (suffix === "create" || suffix === "request_correction") return "C";

  // Submit
  if (suffix === "submit") return "S";

  // Approve / review
  // NOTE: "review" suffix is context-dependent:
  //   - migration.review → M (manage, per Contract 11 §7 matrix)
  //   - direct_costs.review → A (approve/reject)
  // Handle migration.review specially BEFORE the generic review→A mapping.
  if (key === "migration.review") return "M";
  if (suffix === "approve" || suffix === "review") return "A";

  // Cancel
  if (suffix === "cancel") return "X";

  // Reverse / correct
  if (suffix === "reverse" || suffix === "correct") return "R";

  // Manage / configure
  if (suffix === "manage" || suffix === "run" || suffix === "restore_test") {
    return "M";
  }

  // Investigate (complaints.investigate) — a view-with-comment action
  if (suffix === "investigate") return "V";

  // Export
  if (suffix === "internal") return "E";

  // Commit (migration.commit)
  if (suffix === "commit") return "A";

  // migration.prepare / migration.review — these have suffix "prepare"
  // and "review". "review" → A (handled above). "prepare" → M.
  if (suffix === "prepare") return "M";

  // Unresolved — caller must surface as owner-decision blocker
  return null;
}

// ---------------------------------------------------------------------------
// 6. Field-key taxonomy (Contract 11 §8 "Restricted examples").
// ---------------------------------------------------------------------------

/**
 * The complete set of restricted financial field keys that Workers can
 * NEVER see (DEC-063 + Contract 11 §8).
 *
 * This is re-exported from worker-financial-deny.ts to provide a single
 * import point for guard/redaction modules. The canonical definition
 * lives in worker-financial-deny.ts.
 */
export {
  WORKER_DENIED_FIELD_KEYS,
  WORKER_DENIED_PERMISSION_KEYS,
} from "./worker-financial-deny";

// ---------------------------------------------------------------------------
// 7. Permission-key grouping helpers (for guard composition).
// ---------------------------------------------------------------------------

/**
 * Permission keys that grant user/role/permission management authority.
 *
 * Per DEC-032 and Contract 11 §10: "Owner alone manages users/permissions/
 * security. Accountant cannot escalate privileges through settings/API."
 *
 * Any user requesting one of these keys MUST be the Owner (or an explicitly
 * authorized delegate in a future contract — none exists in MVP).
 */
export const PERMISSION_MANAGEMENT_KEYS: ReadonlySet<string> = new Set([
  "users.manage",
  "permissions.manage",
  "users.view_limited",
]);

/**
 * Permission keys that grant financial visibility or authority.
 *
 * Derived from Contract 11 §8 "Field-Level Permission Matrix" — the keys
 * whose allowed action exposes a financial field group.
 *
 * Workers are DENIED all of these by DEC-063, even if another role would
 * grant them. This set is a subset of WORKER_DENIED_PERMISSION_KEYS and
 * is provided here for guard composition and test assertions.
 */
export const FINANCIAL_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "sales.view_price",
  "production.view_cost",
  "balances.view_customer",
  "balances.view_supplier_factory",
  "direct_costs.review",
  "payments.create",
  "payments.approve",
  "payments.reverse",
  "profitability.view",
  "audit.view",
  "exports.internal",
]);

/**
 * Permission keys that grant approval/reversal authority over financial
 * or operational records.
 *
 * Per Contract 11 §13: "Create does not imply approve; approval does not
 * rewrite." These keys are the approve/reverse/correct actions that must
 * NEVER be granted to Workers (they are in WORKER_DENIED_PERMISSION_KEYS).
 */
export const APPROVAL_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "inventory.receive.approve",
  "inventory.transfer.approve",
  "inventory.adjustment.approve",
  "inventory.reverse",
  "inventory.correct",
  "sales.approve",
  "sales.reverse",
  "sales.correct",
  "production.issue.approve",
  "production.approve",
  "production.return_from_wip.approve",
  "production.correct",
  "payments.approve",
  "payments.reverse",
  "quality_risk_sales.approve",
  "returns.approve",
  "returns.correct",
  "migration.approve",
  "migration.commit",
]);
