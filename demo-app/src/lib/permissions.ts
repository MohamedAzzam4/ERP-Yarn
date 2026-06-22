/**
 * Permission helpers for the showcase. These mirror the role/action/field
 * matrix in /docs/contracts/11_permission_matrix.md for presentation only.
 *
 * Presentation logic is NOT permission enforcement. The real ERP enforces
 * permissions server-side. This module only controls what the showcase
 * renders for each demo role.
 */
import type { Role } from "@/types";
import { WORKER_ROLES } from "@/types";

/** Whether the active role is one of the worker roles. */
export function isWorker(role: Role): boolean {
  return WORKER_ROLES.includes(role);
}

/**
 * Whether the active role may see financial data (prices, costs, balances,
 * payables, receivables, profitability). Workers NEVER see financial data.
 */
export function canSeeFinancials(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may see profitability (Owner + Accountant). */
export function canSeeProfitability(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may approve/reject items. */
export function canApprove(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may manage users/permissions (Owner only). */
export function canManageUsers(role: Role): boolean {
  return role === "owner";
}

/** Whether the active role may manage migration commit (Owner + Accountant dual). */
export function canApproveMigration(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may run/view backups. */
export function canViewBackup(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may export internal reports. */
export function canExport(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may see audit logs. */
export function canViewAudit(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may create draft sales with price + submit. */
export function canSubmitSale(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Whether the active role may manage payments. */
export function canManagePayments(role: Role): boolean {
  return role === "owner" || role === "accountant";
}

/** Helper to redact a financial field for worker roles. */
export function redactIfWorker<T>(role: Role, value: T): T | "—" {
  return isWorker(role) ? ("—" as const) : value;
}
