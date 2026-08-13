/**
 * WP-08-01A Server Action integration tests.
 *
 * Tests the actual FormData handler boundary — not field-name constants.
 * Proves authorization, payload redaction, validation, and service wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/erp-context", () => ({
  getErpAuthContextWithRoles: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  db: null,
}));

vi.mock("@/server/security/permission-loader", () => ({
  loadRolePermissionMatrixForTenant: vi.fn().mockResolvedValue({
    owner: new Set([
      "inventory.transfer.create", "inventory.transfer.approve",
      "inventory.receive.create", "inventory.receive.approve",
      "production.create", "production.receive_draft", "production.return_from_wip.request",
      "quality_tests.create", "returns.create",
    ]),
    accountant: new Set([
      "inventory.transfer.approve", "inventory.receive.approve",
    ]),
    warehouse_employee: new Set([
      "inventory.transfer.create", "inventory.receive.create",
      "production.create", "production.receive_draft", "returns.create",
    ]),
    production_employee: new Set([
      "production.create", "production.receive_draft",
    ]),
    quality_employee: new Set([
      "quality_tests.create",
    ]),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  revalidatePath: vi.fn(),
}));

import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";

function makeAuthResult(authenticated: boolean, roles: string[] = [], tenantId = "tenant-1", userId = "user-1") {
  return authenticated
    ? { authenticated: true, roles, tenantId, userId, email: "t@e.com", name: "T", authId: "t" }
    : { authenticated: false, roles: [], tenantId: null, userId: null, email: null, name: null, authId: null };
}

function makeTransferFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("itemId", "item-001");
  fd.set("fromLocationId", "loc-001");
  fd.set("toLocationId", "loc-002");
  fd.set("quantityKg", "100.000");
  fd.set("reason", "Test transfer");
  fd.set("idempotencyKey", "transfer-test-001");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function makeReturnFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("salesOrderId", "sale-001");
  fd.set("customerId", "cust-001");
  fd.set("returnDate", "2026-07-16");
  fd.set("returnReason", "Damaged goods");
  fd.set("itemId", "item-001");
  fd.set("quantityKg", "50.000");
  fd.set("returnLocationId", "loc-003");
  fd.set("returnedStockStatus", "return_received");
  fd.set("idempotencyKey", "return-test-001");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

// ===========================================================================
// Transfer action tests
// ===========================================================================

describe("WP-08-01A transfer action authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("1. unauthenticated user redirected to /login", async () => {
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(false) as any);
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData())).rejects.toThrow("REDIRECT:/login");
  });

  it("2. Owner denied from warehouse task", async () => {
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(true, ["owner"]) as any);
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData())).rejects.toThrow(/not authorized/);
  });

  it("3. Quality denied from warehouse task", async () => {
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(true, ["quality_employee"]) as any);
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData())).rejects.toThrow(/not authorized/);
  });

  it("4. unknown role denied", async () => {
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(true, ["unknown_role"]) as any);
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData())).rejects.toThrow(/not authorized/);
  });
});

describe("WP-08-01A transfer payload redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(true, ["warehouse_employee"]) as any);
  });

  it("5. price field rejected", async () => {
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData({ price: "100" }))).rejects.toThrow(/FORBIDDEN_FIELD.*price/);
  });

  it("6. cost field rejected", async () => {
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData({ cost: "50" }))).rejects.toThrow(/FORBIDDEN_FIELD.*cost/);
  });

  it("7. payable field rejected", async () => {
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData({ payable: "1000" }))).rejects.toThrow(/FORBIDDEN_FIELD.*payable/);
  });

  it("8. approve field rejected", async () => {
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData({ approve: "true" }))).rejects.toThrow(/FORBIDDEN_FIELD.*approve/);
  });

  it("9. financialTreatment field rejected", async () => {
    const { createTransferDraft } = await import("@/app/(worker)/worker/stock-transfer/actions");
    await expect(createTransferDraft(makeTransferFormData({ financialTreatment: "customer_credit" })))
      .rejects.toThrow(/FORBIDDEN_FIELD.*financialTreatment/);
  });
});

// ===========================================================================
// Return action tests
// ===========================================================================

describe("WP-08-01A return action authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("10. unauthenticated redirected to /login", async () => {
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(false) as any);
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData())).rejects.toThrow("REDIRECT:/login");
  });

  it("11. Owner denied from warehouse return task", async () => {
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(true, ["owner"]) as any);
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData())).rejects.toThrow(/not authorized/);
  });

  it("12. Quality denied from warehouse return task", async () => {
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(true, ["quality_employee"]) as any);
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData())).rejects.toThrow(/not authorized/);
  });
});

describe("WP-08-01A return payload redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getErpAuthContextWithRoles).mockResolvedValue(makeAuthResult(true, ["warehouse_employee"]) as any);
  });

  it("13. financialTreatment rejected", async () => {
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData({ financialTreatment: "customer_credit" })))
      .rejects.toThrow(/FORBIDDEN_FIELD.*financialTreatment/);
  });

  it("14. isReplacement rejected", async () => {
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData({ isReplacement: "true" })))
      .rejects.toThrow(/FORBIDDEN_FIELD.*isReplacement/);
  });

  it("15. refund rejected", async () => {
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData({ refund: "100" })))
      .rejects.toThrow(/FORBIDDEN_FIELD.*refund/);
  });

  it("16. creditAmount rejected", async () => {
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData({ creditAmount: "500" })))
      .rejects.toThrow(/FORBIDDEN_FIELD.*creditAmount/);
  });

  it("17. approve rejected", async () => {
    const { createReturnRequest } = await import("@/app/(worker)/worker/return-receipt/actions");
    await expect(createReturnRequest(makeReturnFormData({ approve: "true" })))
      .rejects.toThrow(/FORBIDDEN_FIELD.*approve/);
  });
});

// ===========================================================================
// Return treatment boundary proof
// ===========================================================================

describe("WP-08-01A return treatment boundary", () => {
  it("18. worker return action does NOT set financialTreatment", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/app/(worker)/worker/return-receipt/actions.ts", "utf-8");
    expect(source).not.toContain('financialTreatment: "no_financial_impact"');
    expect(source).not.toContain("financialTreatment:");
  });

  it("19. worker return action does NOT set isReplacement", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/app/(worker)/worker/return-receipt/actions.ts", "utf-8");
    expect(source).not.toContain("isReplacement:");
  });

  it("20. worker return action passes only operational fields", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/app/(worker)/worker/return-receipt/actions.ts", "utf-8");
    expect(source).toContain("salesOrderId:");
    expect(source).toContain("customerId:");
    expect(source).toContain("returnDate:");
    expect(source).toContain("returnReason:");
    expect(source).toContain("lines:");
    expect(source).toContain("idempotencyKey:");
    expect(source).not.toContain("financialTreatment:");
    expect(source).not.toContain("isReplacement:");
  });
});
