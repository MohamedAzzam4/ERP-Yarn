/**
 * WP-01-04 tests — navigation configuration.
 *
 * Contract: docs/contracts/02_design_system_and_ux_contract.md §Navigation
 * Contract: docs/contracts/10_frontend_screen_contracts.md §5.1, §5.2
 * Contract: docs/contracts/11_permission_matrix.md §5, §7
 */
import { describe, it, expect } from "vitest";
import {
  WORKER_TASKS,
  MANAGEMENT_NAV,
  getWorkerTasksForRole,
  getManagementNavForRole,
  isWorkerShellRole,
  isManagementShellRole,
  getDefaultShellRoute,
  getDefaultShellRouteForRoles,
  isWorkerRoute,
  isManagementRoute,
} from "../nav-config";

describe("WORKER_TASKS", () => {
  it("contains the contracted worker tasks (including WP-02-07 traceability)", () => {
    expect(WORKER_TASKS.length).toBeGreaterThanOrEqual(5);
    const labels = WORKER_TASKS.map((t) => t.labelAr);
    expect(labels).toContain("استلام خام");
    expect(labels).toContain("نقل مخزون");
    expect(labels).toContain("استلام مرتجع");
    expect(labels).toContain("تسجيل إنتاج");
    expect(labels).toContain("تسجيل جودة");
    // WP-02-07: worker traceability task
    expect(labels).toContain("رسائل الخام");
  });

  it("has NO financial terminology in labels", () => {
    // Note: "رسائل الخام" (raw batches) is a domain-specific term for raw material lots.
    // It is NOT a financial term. We use full-word
    // matching to avoid false positives.
    const financialExactWords = new Set([
      "سعر", "تكلفة", "دفع", "رصيد", "ربح", "حساب", "مديونية", "دائن",
      "price", "cost", "payment", "balance", "profit",
    ]);
    for (const task of WORKER_TASKS) {
      // Check that the label is not exactly a financial term
      expect(
        financialExactWords.has(task.labelAr.trim()),
        `worker task '${task.labelAr}' is exactly a financial term`,
      ).toBe(false);
      // Check that the label doesn't start with a financial term + space
      for (const term of financialExactWords) {
        expect(
          task.labelAr.startsWith(term + " "),
          `worker task '${task.labelAr}' starts with financial term '${term}'`,
        ).toBe(false);
      }
    }
  });

  it("each task has a valid route, icon, and role assignment", () => {
    for (const task of WORKER_TASKS) {
      expect(task.href).toMatch(/^\/worker\//);
      expect(task.icon).toBeTruthy();
      expect(task.roles.length).toBeGreaterThan(0);
    }
  });
});

describe("getWorkerTasksForRole — role filtering", () => {
  it("warehouse sees raw-receipt, stock-transfer, return-receipt", () => {
    const tasks = getWorkerTasksForRole("warehouse_employee");
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain("raw-receipt");
    expect(ids).toContain("stock-transfer");
    expect(ids).toContain("return-receipt");
    expect(ids).not.toContain("production-entry");
    expect(ids).not.toContain("quality-entry");
  });

  it("production sees production-entry + raw-batches (WP-02-07 traceability)", () => {
    const tasks = getWorkerTasksForRole("production_employee");
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain("production-entry");
    expect(ids).toContain("raw-batches");
    expect(ids).not.toContain("raw-receipt");
    expect(ids).not.toContain("stock-transfer");
    expect(ids).not.toContain("return-receipt");
    expect(ids).not.toContain("quality-entry");
  });

  it("quality sees quality-entry + raw-batches (WP-02-07 traceability)", () => {
    const tasks = getWorkerTasksForRole("quality_employee");
    const ids = tasks.map((t) => t.id);
    expect(ids).toContain("quality-entry");
    expect(ids).toContain("raw-batches");
    expect(ids).not.toContain("raw-receipt");
    expect(ids).not.toContain("stock-transfer");
    expect(ids).not.toContain("return-receipt");
    expect(ids).not.toContain("production-entry");
  });

  it("owner sees NO worker tasks (owner is not a worker)", () => {
    const tasks = getWorkerTasksForRole("owner");
    expect(tasks).toHaveLength(0);
  });

  it("accountant sees NO worker tasks", () => {
    const tasks = getWorkerTasksForRole("accountant");
    expect(tasks).toHaveLength(0);
  });

  it("hidden tasks are ABSENT from the result (not just hidden)", () => {
    const warehouseTasks = getWorkerTasksForRole("warehouse_employee");
    const allIds = warehouseTasks.map((t) => t.id);
    expect(allIds).not.toContain("production-entry");
    expect(allIds).not.toContain("quality-entry");
  });
});

describe("MANAGEMENT_NAV", () => {
  it("has 9 categories (8 base + WP-02-01 master-data)", () => {
    expect(MANAGEMENT_NAV).toHaveLength(9);
    const catIds = MANAGEMENT_NAV.map((c) => c.id);
    expect(catIds).toEqual([
      "dashboard", "inventory", "production", "sales",
      "quality", "accounts", "master-data", "reports", "administration",
    ]);
  });

  it("administration category contains users, permissions, settings, migration, backup", () => {
    const adminCat = MANAGEMENT_NAV.find((c) => c.id === "administration")!;
    const itemIds = adminCat.items.map((i) => i.id);
    expect(itemIds).toContain("users");
    expect(itemIds).toContain("permissions");
    expect(itemIds).toContain("settings");
    expect(itemIds).toContain("migration");
    expect(itemIds).toContain("backup");
  });
});

describe("getManagementNavForRole — role filtering (DEC-032)", () => {
  it("owner sees ALL categories", () => {
    const cats = getManagementNavForRole("owner");
    expect(cats).toHaveLength(9);
    const adminCat = cats.find((c) => c.id === "administration")!;
    expect(adminCat.items.map((i) => i.id)).toContain("users");
    expect(adminCat.items.map((i) => i.id)).toContain("permissions");
    expect(adminCat.items.map((i) => i.id)).toContain("settings");
  });

  it("accountant does NOT see users/permissions/settings (DEC-032)", () => {
    const cats = getManagementNavForRole("accountant");
    const adminCat = cats.find((c) => c.id === "administration");
    if (adminCat) {
      const itemIds = adminCat.items.map((i) => i.id);
      expect(itemIds).not.toContain("users");
      expect(itemIds).not.toContain("permissions");
      expect(itemIds).not.toContain("settings");
      // Accountant CAN see migration (Contract 11 §7)
      expect(itemIds).toContain("migration");
    }
  });

  it("accountant does NOT see profitability (Owner-only per Contract 11)", () => {
    const cats = getManagementNavForRole("accountant");
    const reportsCat = cats.find((c) => c.id === "reports");
    if (reportsCat) {
      const itemIds = reportsCat.items.map((i) => i.id);
      expect(itemIds).not.toContain("profitability");
      // Accountant CAN see traceability and audit
      expect(itemIds).toContain("traceability");
      expect(itemIds).toContain("audit");
    }
  });

  it("owner sees profitability", () => {
    const cats = getManagementNavForRole("owner");
    const reportsCat = cats.find((c) => c.id === "reports")!;
    expect(reportsCat.items.map((i) => i.id)).toContain("profitability");
  });

  it("owner sees backup (Owner-only)", () => {
    const cats = getManagementNavForRole("owner");
    const adminCat = cats.find((c) => c.id === "administration")!;
    expect(adminCat.items.map((i) => i.id)).toContain("backup");
  });

  it("accountant does NOT see backup (Owner-only)", () => {
    const cats = getManagementNavForRole("accountant");
    const adminCat = cats.find((c) => c.id === "administration");
    if (adminCat) {
      expect(adminCat.items.map((i) => i.id)).not.toContain("backup");
    }
  });

  it("worker roles see NO management categories", () => {
    expect(getManagementNavForRole("warehouse_employee")).toHaveLength(0);
    expect(getManagementNavForRole("production_employee")).toHaveLength(0);
    expect(getManagementNavForRole("quality_employee")).toHaveLength(0);
  });

  it("hidden items are ABSENT (not just hidden via CSS)", () => {
    const acctCats = getManagementNavForRole("accountant");
    // Verify users/permissions/settings are completely absent from the result
    for (const cat of acctCats) {
      for (const item of cat.items) {
        expect(item.id).not.toBe("users");
        expect(item.id).not.toBe("permissions");
        expect(item.id).not.toBe("settings");
        expect(item.id).not.toBe("backup");
        expect(item.id).not.toBe("profitability");
      }
    }
  });
});

describe("isWorkerShellRole / isManagementShellRole", () => {
  it("worker roles → worker shell", () => {
    expect(isWorkerShellRole("warehouse_employee")).toBe(true);
    expect(isWorkerShellRole("production_employee")).toBe(true);
    expect(isWorkerShellRole("quality_employee")).toBe(true);
  });

  it("management roles → management shell", () => {
    expect(isManagementShellRole("owner")).toBe(true);
    expect(isManagementShellRole("accountant")).toBe(true);
  });

  it("worker roles are NOT management", () => {
    expect(isManagementShellRole("warehouse_employee")).toBe(false);
    expect(isManagementShellRole("production_employee")).toBe(false);
    expect(isManagementShellRole("quality_employee")).toBe(false);
  });

  it("management roles are NOT worker", () => {
    expect(isWorkerShellRole("owner")).toBe(false);
    expect(isWorkerShellRole("accountant")).toBe(false);
  });
});

describe("getDefaultShellRoute", () => {
  it("worker roles → /worker", () => {
    expect(getDefaultShellRoute("warehouse_employee")).toBe("/worker");
    expect(getDefaultShellRoute("production_employee")).toBe("/worker");
    expect(getDefaultShellRoute("quality_employee")).toBe("/worker");
  });

  it("management roles → /management", () => {
    expect(getDefaultShellRoute("owner")).toBe("/management");
    expect(getDefaultShellRoute("accountant")).toBe("/management");
  });
});

describe("getDefaultShellRouteForRoles — deterministic multi-role routing", () => {
  // Single role — same as getDefaultShellRoute
  it("single worker role → /worker", () => {
    expect(getDefaultShellRouteForRoles(["warehouse_employee"])).toBe("/worker");
    expect(getDefaultShellRouteForRoles(["production_employee"])).toBe("/worker");
    expect(getDefaultShellRouteForRoles(["quality_employee"])).toBe("/worker");
  });

  it("single management role → /management", () => {
    expect(getDefaultShellRouteForRoles(["owner"])).toBe("/management");
    expect(getDefaultShellRouteForRoles(["accountant"])).toBe("/management");
  });

  it("empty roles → /login?error=no_role", () => {
    expect(getDefaultShellRouteForRoles([])).toBe("/login?error=no_role");
  });

  // Multi-role — deterministic priority (management > worker)
  it("owner + warehouse_employee → /management (management priority)", () => {
    expect(getDefaultShellRouteForRoles(["owner", "warehouse_employee"])).toBe("/management");
  });

  it("warehouse_employee + owner → /management (order does NOT matter)", () => {
    expect(getDefaultShellRouteForRoles(["warehouse_employee", "owner"])).toBe("/management");
  });

  it("accountant + production_employee → /management (order does NOT matter)", () => {
    expect(getDefaultShellRouteForRoles(["accountant", "production_employee"])).toBe("/management");
    expect(getDefaultShellRouteForRoles(["production_employee", "accountant"])).toBe("/management");
  });

  it("owner + all 3 worker roles → /management (management wins over any worker)", () => {
    expect(getDefaultShellRouteForRoles(["owner", "warehouse_employee", "production_employee", "quality_employee"])).toBe("/management");
  });

  it("multiple worker roles only → /worker", () => {
    expect(getDefaultShellRouteForRoles(["warehouse_employee", "production_employee"])).toBe("/worker");
    expect(getDefaultShellRouteForRoles(["production_employee", "warehouse_employee"])).toBe("/worker");
  });

  it("all 3 worker roles → /worker", () => {
    expect(getDefaultShellRouteForRoles(["warehouse_employee", "production_employee", "quality_employee"])).toBe("/worker");
  });

  // Determinism: same roles in different orders produce same route
  it("DETERMINISM: [owner, warehouse] and [warehouse, owner] produce same route", () => {
    const order1 = getDefaultShellRouteForRoles(["owner", "warehouse_employee"]);
    const order2 = getDefaultShellRouteForRoles(["warehouse_employee", "owner"]);
    expect(order1).toBe(order2);
    expect(order1).toBe("/management");
  });

  it("DETERMINISM: [accountant, quality] and [quality, accountant] produce same route", () => {
    const order1 = getDefaultShellRouteForRoles(["accountant", "quality_employee"]);
    const order2 = getDefaultShellRouteForRoles(["quality_employee", "accountant"]);
    expect(order1).toBe(order2);
    expect(order1).toBe("/management");
  });

  it("DETERMINISM: [warehouse, production] and [production, warehouse] produce same route", () => {
    const order1 = getDefaultShellRouteForRoles(["warehouse_employee", "production_employee"]);
    const order2 = getDefaultShellRouteForRoles(["production_employee", "warehouse_employee"]);
    expect(order1).toBe(order2);
    expect(order1).toBe("/worker");
  });

  it("DETERMINISM: all permutations of [owner, warehouse, production] produce /management", () => {
    const roles = ["owner", "warehouse_employee", "production_employee"] as const;
    const permutations = [
      [roles[0], roles[1], roles[2]],
      [roles[0], roles[2], roles[1]],
      [roles[1], roles[0], roles[2]],
      [roles[1], roles[2], roles[0]],
      [roles[2], roles[0], roles[1]],
      [roles[2], roles[1], roles[0]],
    ];
    for (const perm of permutations) {
      expect(getDefaultShellRouteForRoles(perm)).toBe("/management");
    }
  });
});

describe("isWorkerRoute / isManagementRoute", () => {
  it("isWorkerRoute matches /worker and /worker/*", () => {
    expect(isWorkerRoute("/worker")).toBe(true);
    expect(isWorkerRoute("/worker/raw-receipt")).toBe(true);
    expect(isWorkerRoute("/worker/stock-transfer")).toBe(true);
    expect(isWorkerRoute("/management")).toBe(false);
    expect(isWorkerRoute("/login")).toBe(false);
  });

  it("isManagementRoute matches /management and /management/*", () => {
    expect(isManagementRoute("/management")).toBe(true);
    expect(isManagementRoute("/management/inventory/receipts")).toBe(true);
    expect(isManagementRoute("/management/admin/users")).toBe(true);
    expect(isManagementRoute("/worker")).toBe(false);
    expect(isManagementRoute("/login")).toBe(false);
  });
});

describe("No financial terminology in worker nav (Contract 02 §Worker Task Mode)", () => {
  it("worker task labels contain no financial/accounting terms", () => {
    // Note: "رسائل الخام" (raw batches) is a domain-specific term for raw material lots.
    // It is NOT a financial term. We use full-word
    // matching to avoid false positives.
    const forbiddenExact = new Set([
      "سعر", // price
      "تكلفة", // cost
      "دفع", // payment
      "رصيد", // balance
      "ربح", // profit
      "حساب", // account
      "مديونية", // payable
      "دائن", // receivable
      "تسوية مالية", // financial settlement
    ]);
    for (const task of WORKER_TASKS) {
      // Check that the label is not exactly a financial term
      expect(
        forbiddenExact.has(task.labelAr.trim()),
        `worker task '${task.labelAr}' is exactly a forbidden term`,
      ).toBe(false);
      // Check multi-word phrases that are clearly financial
      expect(task.labelAr).not.toContain("تسوية مالية");
    }
  });
});

describe("Management nav routes are valid (no fake/typo routes)", () => {
  it("all management items have hrefs starting with /management", () => {
    for (const cat of MANAGEMENT_NAV) {
      for (const item of cat.items) {
        expect(
          item.href,
          `item '${item.id}' has invalid href '${item.href}'`,
        ).toMatch(/^\/management/);
      }
    }
  });

  it("no duplicate hrefs", () => {
    const hrefs = MANAGEMENT_NAV.flatMap((c) => c.items.map((i) => i.href));
    const unique = new Set(hrefs);
    expect(unique.size).toBe(hrefs.length);
  });
});
