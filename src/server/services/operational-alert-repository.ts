/**
 * Operational Alert Repository — WP-03-04.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.9
 *   operational_alerts table.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9.4
 *   "Missing/corrupted reservation: mark the reservation failed, reconcile
 *    reserved_qty_kg, create a critical alert, and audit."
 *
 * WP-03-04 scope: alert creation + reads only. Alert resolution/acknowledgment
 * is deferred to a later package.
 */
import "server-only";

import type { OperationalAlert } from "@/server/db/schema/operational-alerts";

// ---------------------------------------------------------------------------
// Input type for inserting a new alert.
// ---------------------------------------------------------------------------

export interface NewOperationalAlertInput {
  tenantId: string;
  severity: "info" | "warning" | "critical";
  alertType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  messageKey: string;
  messageDetails: Record<string, unknown> | null;
  detectedBy: string;
}

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

/**
 * Persistence interface for operational_alerts.
 *
 * Every method is tenant-scoped: it MUST filter by `tenantId` and never
 * return/mutate rows from another tenant.
 */
export interface OperationalAlertRepository {
  /** Insert a new alert row. Returns the inserted row with id. */
  insertAlert(row: NewOperationalAlertInput): Promise<OperationalAlert>;

  /** Find alerts for a source entity (e.g. a sale). */
  findAlertsForSource(
    tenantId: string,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<OperationalAlert[]>;

  /** Find an alert by id. Returns null if not found. */
  findAlertById(tenantId: string, id: string): Promise<OperationalAlert | null>;

  /**
   * Check if a critical alert already exists for a source+type (duplicate guard).
   * Used to prevent duplicate alerts for the same corruption.
   */
  findCriticalAlertForSource(
    tenantId: string,
    sourceEntityType: string,
    sourceEntityId: string,
    alertType: string,
  ): Promise<OperationalAlert | null>;
}
