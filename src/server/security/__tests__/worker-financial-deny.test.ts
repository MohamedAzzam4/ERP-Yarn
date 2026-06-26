/**
 * WP-00-03A package gate tests — Worker financial-deny policy (DEC-063).
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
 * These tests verify the pure policy module in
 * `src/server/security/worker-financial-deny.ts`. No DB, no I/O.
 */

import { describe, it, expect } from "vitest";
import {
  WORKER_FAMILY_ROLE_CODES,
  WORKER_DENIED_PERMISSION_KEYS,
  WORKER_DENIED_FIELD_KEYS,
  isWorkerFamilyRole,
  triggersWorkerFinancialDeny,
  computeWorkerFinancialDenyDecision,
  isPermissionDeniedByWorkerCeiling,
  isFieldDeniedByWorkerCeiling,
} from "../worker-financial-deny";
import type { RoleCode } from "../role-codes";

describe("WORKER_FAMILY_ROLE_CODES", () => {
  it("contains exactly the three worker-family role codes", () => {
    expect([...WORKER_FAMILY_ROLE_CODES].sort()).toEqual([
      "production_employee",
      "quality_employee",
      "warehouse_employee",
    ]);
  });

  it("does NOT contain owner or accountant", () => {
    expect(WORKER_FAMILY_ROLE_CODES.has("owner")).toBe(false);
    expect(WORKER_FAMILY_ROLE_CODES.has("accountant")).toBe(false);
  });
});

describe("isWorkerFamilyRole", () => {
  it("returns true for warehouse_employee", () => {
    expect(isWorkerFamilyRole("warehouse_employee")).toBe(true);
  });
  it("returns true for production_employee", () => {
    expect(isWorkerFamilyRole("production_employee")).toBe(true);
  });
  it("returns true for quality_employee", () => {
    expect(isWorkerFamilyRole("quality_employee")).toBe(true);
  });
  it("returns false for owner", () => {
    expect(isWorkerFamilyRole("owner")).toBe(false);
  });
  it("returns false for accountant", () => {
    expect(isWorkerFamilyRole("accountant")).toBe(false);
  });
});

describe("triggersWorkerFinancialDeny (DEC-061 + DEC-063)", () => {
  it("returns false for an empty role set", () => {
    expect(triggersWorkerFinancialDeny([])).toBe(false);
  });

  it("returns false for owner-only", () => {
    expect(triggersWorkerFinancialDeny(["owner"])).toBe(false);
  });

  it("returns false for accountant-only", () => {
    expect(triggersWorkerFinancialDeny(["accountant"])).toBe(false);
  });

  it("returns false for owner + accountant (no worker role)", () => {
    expect(triggersWorkerFinancialDeny(["owner", "accountant"])).toBe(false);
  });

  it("returns true for warehouse_employee only", () => {
    expect(triggersWorkerFinancialDeny(["warehouse_employee"])).toBe(true);
  });

  it("returns true for production_employee only", () => {
    expect(triggersWorkerFinancialDeny(["production_employee"])).toBe(true);
  });

  it("returns true for quality_employee only", () => {
    expect(triggersWorkerFinancialDeny(["quality_employee"])).toBe(true);
  });

  it("returns true when a Worker role is combined with Owner (DEC-061 union + DEC-063 ceiling)", () => {
    // DEC-061: effective permissions are the union of allowed actions
    // except where a stricter denial/field ceiling applies.
    // DEC-063: Worker-family financial denial always wins.
    expect(triggersWorkerFinancialDeny(["owner", "warehouse_employee"])).toBe(true);
    expect(triggersWorkerFinancialDeny(["accountant", "production_employee"])).toBe(true);
  });

  it("returns true when all five roles are assigned (any Worker triggers the ceiling)", () => {
    const allFive: ReadonlyArray<RoleCode> = [
      "owner",
      "accountant",
      "warehouse_employee",
      "production_employee",
      "quality_employee",
    ];
    expect(triggersWorkerFinancialDeny(allFive)).toBe(true);
  });
});

describe("WORKER_DENIED_PERMISSION_KEYS (DEC-063 absolute ceiling)", () => {
  it("denies sales.view_price (price)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("sales.view_price")).toBe(true);
  });

  it("denies production.view_cost (cost)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("production.view_cost")).toBe(true);
  });

  it("denies balances.view_customer and balances.view_supplier_factory", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("balances.view_customer")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("balances.view_supplier_factory")).toBe(true);
  });

  it("denies direct_costs.review", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("direct_costs.review")).toBe(true);
  });

  it("denies payments.create, payments.approve, payments.reverse", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("payments.create")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("payments.approve")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("payments.reverse")).toBe(true);
  });

  it("denies profitability.view", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("profitability.view")).toBe(true);
  });

  it("denies audit.view", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("audit.view")).toBe(true);
  });

  it("denies migration.prepare/review/approve/commit (financial warnings)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("migration.prepare")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("migration.review")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("migration.approve")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("migration.commit")).toBe(true);
  });

  it("denies backup.view/run/restore_test (financial evidence)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("backup.view")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("backup.run")).toBe(true);
    expect(WORKER_DENIED_PERMISSION_KEYS.has("backup.restore_test")).toBe(true);
  });

  it("denies exports.internal (financial reports)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("exports.internal")).toBe(true);
  });

  it("does NOT deny inventory.view_quantity (operational, not financial)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("inventory.view_quantity")).toBe(false);
  });

  it("does NOT deny inventory.receive.create (operational draft)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("inventory.receive.create")).toBe(false);
  });

  it("does NOT deny quality_tests.create (operational)", () => {
    expect(WORKER_DENIED_PERMISSION_KEYS.has("quality_tests.create")).toBe(false);
  });
});

describe("WORKER_DENIED_FIELD_KEYS (Contract 11 §8)", () => {
  it("denies purchase_price_per_ton and total_purchase_cost", () => {
    expect(WORKER_DENIED_FIELD_KEYS.has("purchase_price_per_ton")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("total_purchase_cost")).toBe(true);
  });

  it("denies all sales revenue/discount fields", () => {
    expect(WORKER_DENIED_FIELD_KEYS.has("price_per_ton")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("gross_revenue")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("discount_amount")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("net_revenue")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("line_allocated_discount_precise")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("line_allocated_discount_posted")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("line_net_revenue_precise")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("line_net_revenue_posted")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("order_discount_total")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("rounding_adjustment")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("document_total_posted")).toBe(true);
  });

  it("denies return/replacement financial fields", () => {
    expect(WORKER_DENIED_FIELD_KEYS.has("return_credit_value")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("replacement_receivable")).toBe(true);
  });

  it("denies factory rate/payable fields", () => {
    expect(WORKER_DENIED_FIELD_KEYS.has("factory_rate_per_ton_used")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("calculated_factory_cost")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("factory_payable")).toBe(true);
  });

  it("denies direct cost / payer / balance / account fields", () => {
    expect(WORKER_DENIED_FIELD_KEYS.has("actual_payer_type")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("direct_cost_allocations")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("customer_balance")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("supplier_balance")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("factory_balance")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("account_entries")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("payment_settlements")).toBe(true);
  });

  it("denies profitability fields", () => {
    expect(WORKER_DENIED_FIELD_KEYS.has("profit_amount")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("profit_margin_percent")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("profitability_profile_version")).toBe(true);
    expect(WORKER_DENIED_FIELD_KEYS.has("missing_cost_flags")).toBe(true);
  });
});

describe("computeWorkerFinancialDenyDecision", () => {
  it("returns enforced=false for owner-only", () => {
    const d = computeWorkerFinancialDenyDecision(["owner"]);
    expect(d.enforced).toBe(false);
    expect(d.deniedPermissionKeys.size).toBe(0);
    expect(d.deniedFieldKeys.size).toBe(0);
  });

  it("returns enforced=true with full deny sets for warehouse_employee", () => {
    const d = computeWorkerFinancialDenyDecision(["warehouse_employee"]);
    expect(d.enforced).toBe(true);
    expect(d.deniedPermissionKeys).toBe(WORKER_DENIED_PERMISSION_KEYS);
    expect(d.deniedFieldKeys).toBe(WORKER_DENIED_FIELD_KEYS);
  });

  it("returns enforced=true when Worker role is combined with Owner (DEC-063 absolute)", () => {
    const d = computeWorkerFinancialDenyDecision(["owner", "warehouse_employee"]);
    expect(d.enforced).toBe(true);
    // Even though Owner alone would not be denied, the Worker ceiling
    // applies to the entire session.
    expect(d.deniedPermissionKeys.has("sales.view_price")).toBe(true);
    expect(d.deniedPermissionKeys.has("profitability.view")).toBe(true);
  });
});

describe("isPermissionDeniedByWorkerCeiling", () => {
  it("returns false for owner viewing inventory.view_quantity", () => {
    expect(
      isPermissionDeniedByWorkerCeiling(["owner"], "inventory.view_quantity"),
    ).toBe(false);
  });

  it("returns false for warehouse_employee viewing inventory.view_quantity (operational)", () => {
    expect(
      isPermissionDeniedByWorkerCeiling(
        ["warehouse_employee"],
        "inventory.view_quantity",
      ),
    ).toBe(false);
  });

  it("returns true for warehouse_employee viewing sales.view_price (DEC-063)", () => {
    expect(
      isPermissionDeniedByWorkerCeiling(
        ["warehouse_employee"],
        "sales.view_price",
      ),
    ).toBe(true);
  });

  it("returns true for owner+warehouse_employee viewing sales.view_price (DEC-063 absolute)", () => {
    expect(
      isPermissionDeniedByWorkerCeiling(
        ["owner", "warehouse_employee"],
        "sales.view_price",
      ),
    ).toBe(true);
  });

  it("returns true for owner+accountant+production_employee viewing profitability.view", () => {
    expect(
      isPermissionDeniedByWorkerCeiling(
        ["owner", "accountant", "production_employee"],
        "profitability.view",
      ),
    ).toBe(true);
  });

  it("returns false for an unknown permission key (deny-list is explicit)", () => {
    // The ceiling only applies to keys in WORKER_DENIED_PERMISSION_KEYS.
    // Unknown keys are not auto-denied by this policy; the regular
    // permission check decides them.
    expect(
      isPermissionDeniedByWorkerCeiling(
        ["warehouse_employee"],
        "unknown.future.permission",
      ),
    ).toBe(false);
  });
});

describe("isFieldDeniedByWorkerCeiling", () => {
  it("returns false for owner viewing any field", () => {
    expect(
      isFieldDeniedByWorkerCeiling(["owner"], "purchase_price_per_ton"),
    ).toBe(false);
  });

  it("returns true for warehouse_employee viewing purchase_price_per_ton", () => {
    expect(
      isFieldDeniedByWorkerCeiling(
        ["warehouse_employee"],
        "purchase_price_per_ton",
      ),
    ).toBe(true);
  });

  it("returns true for owner+quality_employee viewing profit_amount (DEC-063 absolute)", () => {
    expect(
      isFieldDeniedByWorkerCeiling(["owner", "quality_employee"], "profit_amount"),
    ).toBe(true);
  });

  it("returns false for warehouse_employee viewing an operational field (e.g. quantity_kg)", () => {
    expect(
      isFieldDeniedByWorkerCeiling(["warehouse_employee"], "quantity_kg"),
    ).toBe(false);
  });
});
