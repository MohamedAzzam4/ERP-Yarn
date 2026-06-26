/**
 * Canonical role codes for ERP-Yarn.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §6
 *   role_code: owner, accountant, warehouse_employee,
 *   production_employee, quality_employee
 *
 * Contract: docs/contracts/11_permission_matrix.md §5
 *
 * This module is the single source of truth for the role-code type so
 * that the security policy modules, schema seed, and tests all reference
 * one definition.
 */

export const ROLE_CODES = [
  "owner",
  "accountant",
  "warehouse_employee",
  "production_employee",
  "quality_employee",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

/**
 * Worker-family role codes (DEC-063).
 * Used by `worker-financial-deny.ts` and `worker-scope.ts`.
 */
export const WORKER_ROLE_CODES: ReadonlyArray<RoleCode> = [
  "warehouse_employee",
  "production_employee",
  "quality_employee",
];

export function isWorkerRole(code: RoleCode): boolean {
  return (WORKER_ROLE_CODES as ReadonlyArray<string>).includes(code);
}
