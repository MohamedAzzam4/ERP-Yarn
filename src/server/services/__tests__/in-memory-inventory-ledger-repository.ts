/**
 * In-memory InventoryLedgerTransactionHandle for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type {
  StockMovement,
  InventoryBalance,
} from "@/server/db/schema/inventory-ledger";
import type {
  InventoryLedgerTransactionHandle,
  NewMovementInput,
  NewBalanceInput,
} from "../inventory-ledger-service";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryInventoryLedgerRepository implements InventoryLedgerTransactionHandle {
  private movements = new Map<string, StockMovement>();
  private balances = new Map<string, InventoryBalance>();
  private movementCounter = 0;
  private balanceCounter = 0;

  async insertMovement(row: NewMovementInput): Promise<StockMovement> {
    this.movementCounter++;
    const id = nid("mv", this.movementCounter);
    const movement: StockMovement = {
      id,
      tenantId: row.tenantId,
      docNo: row.docNo,
      movementType: row.movementType as StockMovement["movementType"],
      movementStatus: row.movementStatus as StockMovement["movementStatus"],
      itemId: row.itemId,
      fromLocationId: row.fromLocationId,
      toLocationId: row.toLocationId,
      quantityKg: row.quantityKg,
      movementDate: row.movementDate,
      sourceDocumentType: row.sourceDocumentType,
      sourceDocumentId: row.sourceDocumentId,
      approvalRequestId: null,
      reversalOfMovementId: null,
      idempotencyKey: row.idempotencyKey,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      importBatchId: null,
      notes: null,
      createdBy: null,
      postedBy: row.postedBy,
      postedAt: row.postedAt,
      createdAt: NOW(),
      updatedAt: null,
      updatedBy: null,
    };
    this.movements.set(`${row.tenantId}:${id}`, movement);
    return movement;
  }

  async findMovementByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<StockMovement | null> {
    for (const m of this.movements.values()) {
      if (m.tenantId === tenantId && m.idempotencyKey === idempotencyKey) return m;
    }
    return null;
  }

  async findMovementBySource(tenantId: string, sourceDocumentType: string, sourceDocumentId: string): Promise<StockMovement | null> {
    for (const m of this.movements.values()) {
      if (m.tenantId === tenantId && m.sourceDocumentType === sourceDocumentType && m.sourceDocumentId === sourceDocumentId) return m;
    }
    return null;
  }

  async findMovementById(tenantId: string, id: string): Promise<StockMovement | null> {
    return this.movements.get(`${tenantId}:${id}`) ?? null;
  }

  async findBalanceForUpdate(tenantId: string, itemId: string, locationId: string): Promise<InventoryBalance | null> {
    const key = `${tenantId}:${itemId}:${locationId}`;
    return this.balances.get(key) ?? null;
  }

  async insertBalance(row: NewBalanceInput): Promise<InventoryBalance> {
    this.balanceCounter++;
    const id = nid("bal", this.balanceCounter);
    const balance: InventoryBalance = {
      id,
      tenantId: row.tenantId,
      itemId: row.itemId,
      locationId: row.locationId,
      onHandQtyKg: row.onHandQtyKg,
      reservedQtyKg: "0",
      blockedQtyKg: "0",
      returnedQtyKg: "0",
      lastMovementId: row.lastMovementId,
      version: 1,
      updatedAt: null,
      updatedBy: null,
      createdAt: NOW(),
    };
    this.balances.set(`${row.tenantId}:${row.itemId}:${row.locationId}`, balance);
    return balance;
  }

  async updateBalance(
    tenantId: string,
    itemId: string,
    locationId: string,
    patch: { onHandQtyKg: string; lastMovementId: string; version: number },
  ): Promise<InventoryBalance | null> {
    const key = `${tenantId}:${itemId}:${locationId}`;
    const balance = this.balances.get(key);
    if (!balance) return null;
    const updated: InventoryBalance = {
      ...balance,
      onHandQtyKg: patch.onHandQtyKg,
      lastMovementId: patch.lastMovementId,
      version: patch.version,
      updatedAt: NOW(),
    };
    this.balances.set(key, updated);
    return updated;
  }

  async listMovementsForBalance(tenantId: string, itemId: string, locationId: string): Promise<StockMovement[]> {
    return [...this.movements.values()].filter(
      (m) =>
        m.tenantId === tenantId &&
        m.itemId === itemId &&
        (m.toLocationId === locationId || m.fromLocationId === locationId),
    );
  }

  async listAllBalances(tenantId: string): Promise<InventoryBalance[]> {
    return [...this.balances.values()].filter((b) => b.tenantId === tenantId);
  }
}
