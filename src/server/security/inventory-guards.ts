/**
 * Shared fail-closed authorization guards for WP-08-01A.
 *
 * These guards use EXPLICIT allowlists — unknown/quality roles are denied.
 * They do NOT fall through to any default-allow behavior.
 */
import "server-only";
import type { ErpUserContext } from "@/server/auth/erp-context";
import type { RoleCode } from "@/server/security/role-codes";

const MANAGEMENT_INVENTORY_ROLES: ReadonlySet<string> = new Set(["owner", "accountant"]);
const WAREHOUSE_TASK_ROLES: ReadonlySet<string> = new Set(["warehouse_employee"]);
const WORKER_QUANTITY_ROLES: ReadonlySet<string> = new Set(["warehouse_employee", "production_employee"]);

export class InventoryScreenAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "InventoryScreenAuthError";
    this.code = code;
  }
}

/**
 * Require that the caller is Owner or Accountant.
 * Throws if the caller is a worker, quality, or unknown.
 */
export function requireManagementInventoryActor(user: ErpUserContext, roles: ReadonlyArray<RoleCode>): void {
  const hasManagementRole = roles.some((r) => MANAGEMENT_INVENTORY_ROLES.has(r));
  if (!hasManagementRole) {
    throw new InventoryScreenAuthError(
      "PERMISSION_DENIED",
      `Role(s) [${roles.join(", ")}] are not authorized for management inventory screens. Required: owner or accountant.`,
    );
  }
}

/**
 * Require that the caller is Warehouse Employee.
 * Throws if the caller is management, production, quality, or unknown.
 */
export function requireWarehouseTaskActor(user: ErpUserContext, roles: ReadonlyArray<RoleCode>): void {
  const hasWarehouseRole = roles.some((r) => WAREHOUSE_TASK_ROLES.has(r));
  if (!hasWarehouseRole) {
    throw new InventoryScreenAuthError(
      "PERMISSION_DENIED",
      `Role(s) [${roles.join(", ")}] are not authorized for warehouse task screens. Required: warehouse_employee.`,
    );
  }
}

/**
 * Require that the caller is Warehouse or Production Employee.
 * Throws if the caller is management, quality, or unknown.
 */
export function requireWorkerQuantityActor(user: ErpUserContext, roles: ReadonlyArray<RoleCode>): void {
  const hasQuantityRole = roles.some((r) => WORKER_QUANTITY_ROLES.has(r));
  if (!hasQuantityRole) {
    throw new InventoryScreenAuthError(
      "PERMISSION_DENIED",
      `Role(s) [${roles.join(", ")}] are not authorized for worker quantity screens. Required: warehouse_employee or production_employee.`,
    );
  }
}
