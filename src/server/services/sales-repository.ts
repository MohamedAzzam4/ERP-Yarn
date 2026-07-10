/**
 * Sales Repository — WP-03-03.
 *
 * Minimal repository for reading sales orders + lines and updating sale
 * status. WP-03-03 scope: submit (draft → pending_approval) only.
 * Full sale CRUD, approval, rejection, cancellation are deferred to
 * later packages.
 *
 * Contract: docs/contracts/04_inventory_posting_contract.md §9
 *   "Draft sale does not reserve. Submission locks sale/balances,
 *    validates available stock and state, inserts reservations per line,
 *    increases reserved quantity, sets pending approval, creates approval
 *    request and audit."
 *
 * Contract: docs/contracts/09_api_contracts.md §8
 *   "Submit Sale for Approval"
 */
import "server-only";

import type { SalesOrder, SalesOrderLine } from "@/server/db/schema/sales";

// ---------------------------------------------------------------------------
// Repository interface.
// ---------------------------------------------------------------------------

/**
 * Persistence interface for sales orders + lines (WP-03-03 minimal scope).
 *
 * Every method is tenant-scoped: it MUST filter by `tenantId` and never
 * return/mutate rows from another tenant.
 */
export interface SalesRepository {
  /** Find a sale by id. Returns null if not found. */
  findSaleById(tenantId: string, saleId: string): Promise<SalesOrder | null>;

  /** Find all lines for a sale, ordered by lineNo. */
  findSaleLines(tenantId: string, saleId: string): Promise<SalesOrderLine[]>;

  /**
   * Update sale status (e.g. draft → pending_approval).
   * Used by SalesSubmissionService.submitSale after reservations are created.
   * Returns the updated sale, or null if not found.
   */
  updateSaleStatus(
    tenantId: string,
    saleId: string,
    patch: {
      saleStatus: string;
      approvalStatus: string;
      reservationStatus: string | null;
    },
  ): Promise<SalesOrder | null>;

  /**
   * Conditionally update sale status ONLY IF the current sale_status is one
   * of the `expectedCurrentStatuses` (WP-03-04).
   *
   * Used by SalesFailureResolutionService to prevent concurrent double-resolution:
   * if two concurrent resolutions race, only the first one transitions the sale
   * out of `pending_approval`/`approval_failed`/`needs_review`. The second one
   * gets null and throws SaleAlreadyResolvedError.
   *
   * Returns the updated sale, or null if the current state doesn't match.
   */
  updateSaleStatusConditional(
    tenantId: string,
    saleId: string,
    patch: {
      saleStatus: string;
      approvalStatus: string;
      reservationStatus: string | null;
    },
    expectedCurrentStatuses: string[],
  ): Promise<SalesOrder | null>;
}
