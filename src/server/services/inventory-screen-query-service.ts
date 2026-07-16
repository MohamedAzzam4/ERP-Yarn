/**
 * Inventory Screen Query Service — WP-08-01A.
 *
 * Server-only query/DTO layer for inventory screens.
 * Produces role-safe DTOs with financial field redaction for workers.
 *
 * Contract 11 §8: Worker financial-deny is absolute (DEC-063).
 * Contract 11 §9: Workers enter/receive operational facts only.
 * Contract 04 §17: Reconciliation compares movement totals vs on-hand.
 * Contract 04 §12: Negative stock is a visible alert.
 */
import "server-only";
import { eq, desc, and, or } from "drizzle-orm";
import {
  inventoryBalances,
  inventoryItems,
  locations,
  stockMovements,
} from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type { RoleCode } from "@/server/security/role-codes";
import { isWorkerRole } from "@/server/security/role-codes";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// Role-safe DTO types.
// ---------------------------------------------------------------------------

/** Management balance DTO — full operational quantities. */
export interface ManagementBalanceDto {
  itemId: string;
  itemCode: string;
  itemName: string;
  locationId: string;
  locationCode: string;
  locationName: string;
  onHandQtyKg: string;
  reservedQtyKg: string;
  blockedQtyKg: string;
  returnedQtyKg: string;
  availableQtyKg: string; // computed: on_hand - reserved - blocked
  version: number;
}

/** Worker balance DTO — operational quantities only, no blocked/returned. */
export interface WorkerBalanceDto {
  itemId: string;
  itemCode: string;
  itemName: string;
  locationCode: string;
  locationName: string;
  onHandQtyKg: string;
  reservedQtyKg: string;
  availableQtyKg: string; // computed: on_hand - reserved - blocked
}

/** Management movement DTO. */
export interface ManagementMovementDto {
  docNo: string;
  movementType: string;
  movementTypeAr: string;
  itemCode: string;
  itemName: string;
  quantityKg: string;
  movementDate: string;
  movementStatus: string;
  sourceDocumentType: string | null;
}

/** Management adjustment DTO. */
export interface ManagementAdjustmentDto {
  docNo: string;
  itemCode: string;
  itemName: string;
  locationName: string;
  quantityKg: string;
  movementDate: string;
  sourceDocumentType: string | null;
}

/** Management reconciliation DTO. */
export interface ManagementReconciliationDto {
  itemCode: string;
  itemName: string;
  locationCode: string;
  locationName: string;
  onHandQtyKg: string;
  movementTotal: string;
  difference: string;
  isMismatch: boolean;
  isNegative: boolean;
  movementCount: number;
}

/** Negative stock alert DTO. */
export interface NegativeStockAlertDto {
  itemName: string;
  locationName: string;
  onHandQtyKg: string;
}

// ---------------------------------------------------------------------------
// Arabic label maps.
// ---------------------------------------------------------------------------

export const MOVEMENT_TYPE_LABELS_AR: Record<string, string> = {
  raw_receipt: "استلام خام",
  transfer: "نقل",
  issue_to_production: "صرف للإنتاج",
  receive_from_production: "استلام من الإنتاج",
  production_waste: "هدر إنتاج",
  return_from_wip: "مرتجع من تحت التشغيل",
  sale_issue: "صرف بيع",
  return_receipt: "استلام مرتجع",
  inventory_adjustment: "تسوية مخزون",
  stock_block: "حظر",
  stock_unblock: "رفع حظر",
  reversal: "عكس",
  correction: "تصحيح",
};

// ---------------------------------------------------------------------------
// InventoryScreenQueryService.
// ---------------------------------------------------------------------------

export class InventoryScreenQueryService {
  constructor(private readonly db: Db) {}

  // ---- Balances ----

  /**
   * List all inventory balances for management (Owner/Accountant).
   * Returns full operational quantities including blocked/returned.
   */
  async listManagementBalances(tenantId: string): Promise<ManagementBalanceDto[]> {
    const results = await this.db
      .select({ balance: inventoryBalances, item: inventoryItems, location: locations })
      .from(inventoryBalances)
      .innerJoin(inventoryItems, eq(inventoryBalances.itemId, inventoryItems.id))
      .innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
      .where(eq(inventoryBalances.tenantId, tenantId));

    return results.map((r) => {
      const onHand = parseFloat(r.balance.onHandQtyKg);
      const reserved = parseFloat(r.balance.reservedQtyKg);
      const blocked = parseFloat(r.balance.blockedQtyKg);
      return {
        itemId: r.balance.itemId,
        itemCode: r.item.itemCode,
        itemName: r.item.displayNameEn || "",
        locationId: r.balance.locationId,
        locationCode: r.location.locationCode,
        locationName: r.location.nameEn || "",
        onHandQtyKg: r.balance.onHandQtyKg,
        reservedQtyKg: r.balance.reservedQtyKg,
        blockedQtyKg: r.balance.blockedQtyKg,
        returnedQtyKg: r.balance.returnedQtyKg,
        availableQtyKg: (onHand - reserved - blocked).toFixed(3),
        version: r.balance.version,
      };
    });
  }

  /**
   * List inventory balances for workers (Warehouse/Production).
   * Returns operational quantities ONLY — no blocked/returned/financial.
   * Contract 11 §8/§9: Worker financial-deny is absolute.
   */
  async listWorkerBalances(tenantId: string): Promise<WorkerBalanceDto[]> {
    const results = await this.db
      .select({ balance: inventoryBalances, item: inventoryItems, location: locations })
      .from(inventoryBalances)
      .innerJoin(inventoryItems, eq(inventoryBalances.itemId, inventoryItems.id))
      .innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
      .where(eq(inventoryBalances.tenantId, tenantId));

    return results.map((r) => {
      const onHand = parseFloat(r.balance.onHandQtyKg);
      const reserved = parseFloat(r.balance.reservedQtyKg);
      const blocked = parseFloat(r.balance.blockedQtyKg);
      return {
        itemId: r.balance.itemId,
        itemCode: r.item.itemCode,
        itemName: r.item.displayNameEn || "",
        locationCode: r.location.locationCode,
        locationName: r.location.nameEn || "",
        onHandQtyKg: r.balance.onHandQtyKg,
        reservedQtyKg: r.balance.reservedQtyKg,
        // availableQtyKg is computed: on_hand - reserved - blocked
        // This is safe for workers because it only reveals operational
        // availability, not financial value or cost.
        availableQtyKg: (onHand - reserved - blocked).toFixed(3),
        // NOTE: blocked_qty_kg, returned_qty_kg, and all financial fields
        // are deliberately excluded (DEC-063, Contract 11 §8).
      };
    });
  }

  // ---- Movements ----

  /**
   * List recent stock movements (max 50).
   */
  async listRecentMovements(tenantId: string, limit: number = 50): Promise<ManagementMovementDto[]> {
    const results = await this.db
      .select({ movement: stockMovements, item: inventoryItems })
      .from(stockMovements)
      .innerJoin(inventoryItems, eq(stockMovements.itemId, inventoryItems.id))
      .where(eq(stockMovements.tenantId, tenantId))
      .orderBy(desc(stockMovements.createdAt))
      .limit(limit);

    return results.map((r) => ({
      docNo: r.movement.docNo,
      movementType: r.movement.movementType,
      movementTypeAr: MOVEMENT_TYPE_LABELS_AR[r.movement.movementType as string] || r.movement.movementType,
      itemCode: r.item.itemCode,
      itemName: r.item.displayNameEn || "",
      quantityKg: r.movement.quantityKg,
      movementDate: r.movement.movementDate,
      movementStatus: r.movement.movementStatus,
      sourceDocumentType: r.movement.sourceDocumentType,
    }));
  }

  // ---- Adjustments ----

  /**
   * List posted inventory adjustments and corrections.
   */
  async listAdjustments(tenantId: string, limit: number = 50): Promise<ManagementAdjustmentDto[]> {
    const results = await this.db
      .select({ movement: stockMovements, item: inventoryItems, loc: locations })
      .from(stockMovements)
      .innerJoin(inventoryItems, eq(stockMovements.itemId, inventoryItems.id))
      .leftJoin(locations, eq(stockMovements.toLocationId, locations.id))
      .where(and(
        eq(stockMovements.tenantId, tenantId),
        or(
          eq(stockMovements.movementType, "inventory_adjustment"),
          eq(stockMovements.movementType, "correction"),
        ),
      ))
      .orderBy(desc(stockMovements.createdAt))
      .limit(limit);

    return results.map((r) => ({
      docNo: r.movement.docNo,
      itemCode: r.item.itemCode,
      itemName: r.item.displayNameEn || "",
      locationName: r.loc?.nameEn || "—",
      quantityKg: r.movement.quantityKg,
      movementDate: r.movement.movementDate,
      sourceDocumentType: r.movement.sourceDocumentType,
    }));
  }

  // ---- Reconciliation ----

  /**
   * Reconcile balances against movement totals.
   * Contract 04 §17: Compare movement totals vs on-hand.
   * Contract 04 §12: Negative stock is a visible alert.
   */
  async listReconciliation(tenantId: string): Promise<{
    results: ManagementReconciliationDto[];
    negativeAlerts: NegativeStockAlertDto[];
  }> {
    const balanceRows = await this.db
      .select({ balance: inventoryBalances, item: inventoryItems, location: locations })
      .from(inventoryBalances)
      .innerJoin(inventoryItems, eq(inventoryBalances.itemId, inventoryItems.id))
      .innerJoin(locations, eq(inventoryBalances.locationId, locations.id))
      .where(eq(inventoryBalances.tenantId, tenantId));

    const results: ManagementReconciliationDto[] = [];
    const negativeAlerts: NegativeStockAlertDto[] = [];

    for (const row of balanceRows) {
      // Get all movements for this balance
      const movements = await this.db
        .select()
        .from(stockMovements)
        .where(and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.itemId, row.balance.itemId),
        ));

      // Calculate movement total (to_location adds, from_location subtracts)
      let movementTotal = 0;
      let movementCount = 0;
      for (const m of movements) {
        if (m.toLocationId === row.balance.locationId) {
          movementTotal += parseFloat(m.quantityKg);
          movementCount++;
        }
        if (m.fromLocationId === row.balance.locationId) {
          movementTotal -= parseFloat(m.quantityKg);
          movementCount++;
        }
      }

      const onHand = parseFloat(row.balance.onHandQtyKg);
      const difference = onHand - movementTotal;
      const isMismatch = Math.abs(difference) > 0.001;
      const isNegative = onHand < 0 || movementTotal < 0;

      results.push({
        itemCode: row.item.itemCode,
        itemName: row.item.displayNameEn || "",
        locationCode: row.location.locationCode,
        locationName: row.location.nameEn || "",
        onHandQtyKg: row.balance.onHandQtyKg,
        movementTotal: movementTotal.toFixed(3),
        difference: difference.toFixed(3),
        isMismatch,
        isNegative,
        movementCount,
      });

      if (isNegative) {
        negativeAlerts.push({
          itemName: row.item.displayNameEn || "",
          locationName: row.location.nameEn || "",
          onHandQtyKg: row.balance.onHandQtyKg,
        });
      }
    }

    return { results, negativeAlerts };
  }

  // ---- Role-safe DTO factory ----

  /**
   * Get balances as role-safe DTOs.
   * Worker roles get redacted DTOs (no blocked/returned/financial).
   * Management roles get full operational DTOs.
   */
  async listBalancesForRole(tenantId: string, role: RoleCode): Promise<ManagementBalanceDto[] | WorkerBalanceDto[]> {
    if (isWorkerRole(role)) {
      return this.listWorkerBalances(tenantId);
    }
    return this.listManagementBalances(tenantId);
  }
}
