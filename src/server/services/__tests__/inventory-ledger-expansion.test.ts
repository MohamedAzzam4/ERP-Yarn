/**
 * WP-03-01 Full Reconciliation Service tests.
 *
 * Contract: docs/contracts/13_work_packages.md WP-03-01
 *   Tests: Every base movement, balance atomicity, concurrency, idempotency,
 *   reconciliation mismatch.
 *   Acceptance: No direct balance write and fixture ledger reconciles.
 *
 * Contract 04 §17: Mismatch is a critical alert, never silently repaired.
 */
import { describe, it, expect } from "vitest";
import {
  FullReconciliationService,
  type FullReconciliationServiceDeps,
} from "../inventory-ledger-expansion";
import { InMemoryInventoryLedgerRepository } from "./in-memory-inventory-ledger-repository";
import { InProcessAuditStore } from "../audit-service";
import { InProcessIdempotencyStore } from "../idempotency-service";
import { InProcessDocumentSequenceStore } from "../document-sequence-service";
import {
  InventoryLedgerService,
  type InventoryLedgerTransactionHandle,
  type NewMovementInput,
  type NewBalanceInput,
  type StockMovement,
  type InventoryBalance,
} from "../inventory-ledger-service";
import { addKg, subtractKg } from "../decimal-kg";
import {
  TEST_USERS,
  FOREIGN_TENANT_ID,
  getTestEffectivePermissions,
} from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const TEST_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_ITEM_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const TEST_LOCATION_A = "bbbbbbbb-0000-4000-8000-000000000001";
const TEST_LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000002";

function makeReconcileDeps() {
  const ledger = new InMemoryInventoryLedgerRepository();
  const deps: FullReconciliationServiceDeps = { ledger };
  const service = new FullReconciliationService(deps);
  return { ledger, service, deps };
}

function makeUserContext(userId: string, tenantId: string = TEST_TENANT_ID) {
  return {
    authenticated: true as const, userId, tenantId,
    email: "test@example.com", name: "Test", authId: "test-auth",
  };
}

// Helper: insert a movement directly into the ledger for reconciliation testing.
async function insertMovement(
  ledger: InMemoryInventoryLedgerRepository,
  overrides: Partial<NewMovementInput>,
): Promise<StockMovement> {
  const input: NewMovementInput = {
    tenantId: TEST_TENANT_ID,
    docNo: `RC-2026-${Math.random().toString(36).slice(2, 6)}`,
    movementType: "raw_receipt",
    movementStatus: "posted",
    itemId: TEST_ITEM_ID,
    fromLocationId: null,
    toLocationId: TEST_LOCATION_A,
    quantityKg: "1000.000",
    movementDate: "2026-07-06",
    sourceDocumentType: "raw_material_batch",
    sourceDocumentId: `src-${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: `idem-${Math.random().toString(36).slice(2, 8)}`,
    postedBy: "user-1",
    postedAt: new Date(),
    ...overrides,
  };
  return ledger.insertMovement(input);
}

async function setBalance(
  ledger: InMemoryInventoryLedgerRepository,
  itemId: string,
  locationId: string,
  onHandQtyKg: string,
): Promise<InventoryBalance> {
  const existing = await ledger.findBalanceForUpdate(TEST_TENANT_ID, itemId, locationId);
  if (existing) {
    return ledger.updateBalance(TEST_TENANT_ID, itemId, locationId, {
      onHandQtyKg, lastMovementId: existing.lastMovementId ?? "00000000-0000-0000-0000-000000000000",
      version: existing.version + 1,
    }) as Promise<InventoryBalance>;
  }
  return ledger.insertBalance({
    tenantId: TEST_TENANT_ID, itemId, locationId, onHandQtyKg,
    lastMovementId: "00000000-0000-0000-0000-000000000000",
  });
}

// ---------------------------------------------------------------------------
// 1. Reconciliation — matching balance.
// ---------------------------------------------------------------------------

describe("WP-03-01 FullReconciliationService — matching balance", () => {
  it("reconciles raw_receipt movements correctly (sum = balance)", async () => {
    const { ledger, service } = makeReconcileDeps();
    await insertMovement(ledger, { quantityKg: "500.000" });
    await insertMovement(ledger, { quantityKg: "300.000" });
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "800.000");

    const result = await service.reconcile(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);

    expect(result.matches).toBe(true);
    expect(result.movementSumKg).toBe("800.000");
    expect(result.balanceOnHandKg).toBe("800.000");
    expect(result.isNegative).toBe(false);
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0]!.movementType).toBe("raw_receipt");
    expect(result.breakdown[0]!.count).toBe(2);
  });

  it("reconciles with no movements and zero balance", async () => {
    const { ledger, service } = makeReconcileDeps();
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "0.000");

    const result = await service.reconcile(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);

    expect(result.matches).toBe(true);
    expect(result.movementSumKg).toBe("0.000");
    expect(result.balanceOnHandKg).toBe("0.000");
  });

  it("reconciles with no balance row (treats as 0)", async () => {
    const { ledger, service } = makeReconcileDeps();

    const result = await service.reconcile(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);

    expect(result.matches).toBe(true);
    expect(result.movementSumKg).toBe("0.000");
    expect(result.balanceOnHandKg).toBe("0.000");
  });
});

// ---------------------------------------------------------------------------
// 2. Reconciliation — mismatch detection.
// ---------------------------------------------------------------------------

describe("WP-03-01 FullReconciliationService — mismatch detection", () => {
  it("detects mismatch when balance > movement sum", async () => {
    const { ledger, service } = makeReconcileDeps();
    await insertMovement(ledger, { quantityKg: "500.000" });
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "800.000"); // wrong: should be 500

    const result = await service.reconcile(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);

    expect(result.matches).toBe(false);
    expect(result.movementSumKg).toBe("500.000");
    expect(result.balanceOnHandKg).toBe("800.000");
  });

  it("detects mismatch when balance < movement sum", async () => {
    const { ledger, service } = makeReconcileDeps();
    await insertMovement(ledger, { quantityKg: "1000.000" });
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "500.000"); // wrong: should be 1000

    const result = await service.reconcile(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);

    expect(result.matches).toBe(false);
    expect(result.movementSumKg).toBe("1000.000");
    expect(result.balanceOnHandKg).toBe("500.000");
  });

  it("does NOT auto-fix the mismatch (no silent repair)", async () => {
    const { ledger, service } = makeReconcileDeps();
    await insertMovement(ledger, { quantityKg: "1000.000" });
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "500.000");

    const result = await service.reconcile(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);

    expect(result.matches).toBe(false);

    // Verify the balance was NOT changed by the reconciliation.
    const balanceAfter = await ledger.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);
    expect(balanceAfter!.onHandQtyKg).toBe("500.000"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 3. Reconciliation — negative balance alert.
// ---------------------------------------------------------------------------

describe("WP-03-01 FullReconciliationService — negative alert", () => {
  it("flags negative balance as alert (not silently fixed)", async () => {
    const { ledger, service } = makeReconcileDeps();
    // Simulate a negative balance (e.g., over-issuance without receipt)
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "-100.000");

    const result = await service.reconcile(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);

    expect(result.isNegative).toBe(true);
    expect(result.balanceOnHandKg).toBe("-100.000");
    // Balance is NOT auto-corrected to 0
    const balanceAfter = await ledger.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);
    expect(balanceAfter!.onHandQtyKg).toBe("-100.000"); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 4. Batch reconciliation.
// ---------------------------------------------------------------------------

describe("WP-03-01 FullReconciliationService — batch reconciliation", () => {
  it("reconciles all balances for a tenant", async () => {
    const { ledger, service } = makeReconcileDeps();

    // Location A: 2 receipts = 800, balance = 800 → match
    await insertMovement(ledger, { toLocationId: TEST_LOCATION_A, quantityKg: "500.000" });
    await insertMovement(ledger, { toLocationId: TEST_LOCATION_A, quantityKg: "300.000" });
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "800.000");

    // Location B: 1 receipt = 500, balance = 400 → mismatch
    await insertMovement(ledger, { toLocationId: TEST_LOCATION_B, quantityKg: "500.000" });
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_B, "400.000");

    const ownerUser = makeUserContext(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    const result = await service.reconcileAll(ownerUser as any, ownerEff);

    expect(result.totalChecked).toBe(2);
    expect(result.totalMatched).toBe(1);
    expect(result.totalMismatched).toBe(1);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]!.locationId).toBe(TEST_LOCATION_B);
    expect(result.mismatches[0]!.movementSumKg).toBe("500.000");
    expect(result.mismatches[0]!.balanceOnHandKg).toBe("400.000");
  });

  it("does NOT auto-fix any mismatches in batch reconciliation", async () => {
    const { ledger, service } = makeReconcileDeps();
    await insertMovement(ledger, { toLocationId: TEST_LOCATION_A, quantityKg: "1000.000" });
    await setBalance(ledger, TEST_ITEM_ID, TEST_LOCATION_A, "500.000");

    const ownerUser = makeUserContext(TEST_USERS.owner.userId);
    const ownerEff = getTestEffectivePermissions(TEST_USERS.owner.userId);

    await service.reconcileAll(ownerUser as any, ownerEff);

    // Balance unchanged
    const balance = await ledger.findBalanceForUpdate(TEST_TENANT_ID, TEST_ITEM_ID, TEST_LOCATION_A);
    expect(balance!.onHandQtyKg).toBe("500.000");
  });
});

// ---------------------------------------------------------------------------
// 5. Read-only / no mutation.
// ---------------------------------------------------------------------------

describe("WP-03-01 FullReconciliationService — read-only", () => {
  it("service has no mutation methods", () => {
    const { service } = makeReconcileDeps();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(methods).not.toContain("create");
    expect(methods).not.toContain("update");
    expect(methods).not.toContain("delete");
    expect(methods).not.toContain("post");
    expect(methods).not.toContain("repair");
    expect(methods).not.toContain("fix");
    expect(methods).toContain("reconcile");
    expect(methods).toContain("reconcileAll");
  });
});

// ---------------------------------------------------------------------------
// 6. Permission check.
// ---------------------------------------------------------------------------

describe("WP-03-01 FullReconciliationService — permission", () => {
  it("reconcileAll requires inventory.view_quantity", async () => {
    const { service } = makeReconcileDeps();
    // production_employee has inventory.view_quantity — should pass
    const prodUser = makeUserContext(TEST_USERS.production.userId);
    const prodEff = getTestEffectivePermissions(TEST_USERS.production.userId);

    // Should not throw
    const result = await service.reconcileAll(prodUser as any, prodEff);
    expect(result.totalChecked).toBe(0); // no balances
  });
});

// ---------------------------------------------------------------------------
// 7. subtractKg unit tests.
// ---------------------------------------------------------------------------

describe("WP-03-01 decimal-kg — subtractKg", () => {
  it("subtracts correctly", async () => {
    const { subtractKg } = await import("../decimal-kg");
    expect(subtractKg("1500.000", "500.000")).toBe("1000.000");
    expect(subtractKg("500.000", "1500.000")).toBe("-1000.000");
    expect(subtractKg("0.000", "0.000")).toBe("0.000");
    expect(subtractKg("1000", "500")).toBe("500.000");
  });
});
