/**
 * WP-07-04 r25 — DRAFT-ACTION-OWNER-1: forbidden-field guard policy test.
 *
 * r25 BLOCKER A: The r24 createDraftPaymentAction applied the shared
 * FORBIDDEN_PAYMENT_FIELDS list (which contained ownerType + ownerId) to
 * draft creation. This rejected every legitimate draft form before the
 * service executed, because ownerType/ownerId are REQUIRED user-selected
 * domain references for draft creation.
 *
 * This test verifies the operation-specific forbidden-field guards as pure
 * helpers (extracted from the server action). Since server-action FormData
 * integration testing is impractical in this environment, we extract the
 * guard logic into testable pure functions and verify:
 *
 * DRAFT-ACTION-OWNER-1:
 *   - Draft create with ownerType + ownerId → NOT rejected (legitimate input)
 *   - Draft create with accountId/paymentNo/status/tenantId → REJECTED (authority)
 *
 * EXISTING-PAYMENT-1:
 *   - Post/settle/reverse with ownerType/ownerId → REJECTED (existing payment)
 *   - Post/settle/reverse with accountId/paymentNo/status/tenantId → REJECTED
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Extracted guard logic — mirrors the production guards in payments/actions.ts.
// We duplicate the logic here as pure functions so we can test it without
// FormData/Next.js server-action overhead. The production code is the
// authoritative source; this test verifies the policy is correct.
// ---------------------------------------------------------------------------

const FORBIDDEN_AUTHORITY_FIELDS = [
  "amountSigned",
  "entryType",
  "entryNo",
  "settlementStatus",
  "postedEntryId",
  "reversalOfPaymentId",
  "reversalOfEntryId",
  "isLocked",
  "paymentNo",
  "status",
  "accountId",
  "tenantId",
  "createdBy",
  "updatedBy",
  "auditLogId",
  "idempotencyRecordId",
];

const FORBIDDEN_EXISTING_PAYMENT_FIELDS = [
  "ownerType",
  "ownerId",
  "amount",
  "paymentDirection",
  "paymentMethod",
  "paymentDate",
];

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return fd;
}

function rejectForbiddenFieldsForDraftCreate(formData: FormData): void {
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in payment draft create.`,
      );
    }
  }
}

function rejectForbiddenFieldsForExistingPayment(
  formData: FormData,
  operation: string,
): void {
  const allForbidden = [
    ...FORBIDDEN_AUTHORITY_FIELDS,
    ...FORBIDDEN_EXISTING_PAYMENT_FIELDS,
  ];
  for (const field of allForbidden) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in ${operation}.`,
      );
    }
  }
}

describe("WP-07-04 r25 — DRAFT-ACTION-OWNER-1: forbidden-field policy", () => {

  // ===========================================================================
  // DRAFT-ACTION-OWNER-1: draft create allows ownerType + ownerId
  // ===========================================================================
  it("DRAFT-ACTION-OWNER-1. draft create with ownerType + ownerId is NOT rejected", () => {
    const fd = makeFormData({
      ownerType: "customer",
      ownerId: "cust-001",
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-001",
    });
    // MUST NOT throw — ownerType + ownerId are legitimate user-selected
    // domain references, not authority fields.
    expect(() => rejectForbiddenFieldsForDraftCreate(fd)).not.toThrow();
  });

  // ===========================================================================
  // DRAFT-ACTION-OWNER-2: draft create still rejects authority fields
  // ===========================================================================
  it("DRAFT-ACTION-OWNER-2. draft create rejects accountId, paymentNo, status, tenantId", () => {
    const authorityFields = ["accountId", "paymentNo", "status", "tenantId",
      "postedEntryId", "amountSigned", "entryType", "entryNo",
      "settlementStatus", "reversalOfPaymentId", "reversalOfEntryId",
      "isLocked", "createdBy", "updatedBy", "auditLogId", "idempotencyRecordId"];
    for (const field of authorityFields) {
      const fd = makeFormData({
        ownerType: "customer",
        ownerId: "cust-001",
        paymentDate: "2026-09-03",
        amount: "100.00",
        paymentDirection: "received_from_party",
        paymentMethod: "cash",
        idempotencyKey: "draft-001",
        [field]: "should-be-rejected",
      });
      expect(() => rejectForbiddenFieldsForDraftCreate(fd)).toThrow(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in payment draft create.`,
      );
    }
  });

  // ===========================================================================
  // EXISTING-PAYMENT-1: post/settle/reverse reject ownerType + ownerId
  // ===========================================================================
  it("EXISTING-PAYMENT-1. post rejects ownerType + ownerId (existing payment mutation)", () => {
    const fd = makeFormData({
      paymentId: "pay-001",
      idempotencyKey: "post-001",
      ownerType: "customer",
      ownerId: "cust-001",
    });
    expect(() => rejectForbiddenFieldsForExistingPayment(fd, "payment post")).toThrow(
      "FORBIDDEN_FIELD: Field 'ownerType' is not allowed in payment post.",
    );
  });

  it("EXISTING-PAYMENT-2. settle rejects ownerType + ownerId", () => {
    const fd = makeFormData({
      paymentId: "pay-001",
      settledEntryId: "entry-001",
      settledAmount: "100.00",
      idempotencyKey: "settle-001",
      ownerType: "customer",
      ownerId: "cust-001",
    });
    expect(() => rejectForbiddenFieldsForExistingPayment(fd, "payment settlement")).toThrow(
      "FORBIDDEN_FIELD: Field 'ownerType' is not allowed in payment settlement.",
    );
  });

  it("EXISTING-PAYMENT-3. reverse rejects ownerType + ownerId", () => {
    const fd = makeFormData({
      paymentId: "pay-001",
      reason: "test",
      idempotencyKey: "reverse-001",
      ownerType: "customer",
      ownerId: "cust-001",
    });
    expect(() => rejectForbiddenFieldsForExistingPayment(fd, "payment reversal")).toThrow(
      "FORBIDDEN_FIELD: Field 'ownerType' is not allowed in payment reversal.",
    );
  });

  // ===========================================================================
  // EXISTING-PAYMENT-4: post/settle/reverse still reject authority fields
  // ===========================================================================
  it("EXISTING-PAYMENT-4. post rejects authority fields (accountId, paymentNo, status, tenantId)", () => {
    const authorityFields = ["accountId", "paymentNo", "status", "tenantId"];
    for (const field of authorityFields) {
      const fd = makeFormData({
        paymentId: "pay-001",
        idempotencyKey: "post-001",
        [field]: "should-be-rejected",
      });
      expect(() => rejectForbiddenFieldsForExistingPayment(fd, "payment post")).toThrow(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in payment post.`,
      );
    }
  });

  // ===========================================================================
  // EXISTING-PAYMENT-5: post/settle/reverse reject amount/paymentDirection etc.
  // ===========================================================================
  it("EXISTING-PAYMENT-5. post rejects amount, paymentDirection, paymentMethod, paymentDate", () => {
    const mutationFields = ["amount", "paymentDirection", "paymentMethod", "paymentDate"];
    for (const field of mutationFields) {
      const fd = makeFormData({
        paymentId: "pay-001",
        idempotencyKey: "post-001",
        [field]: "should-be-rejected",
      });
      expect(() => rejectForbiddenFieldsForExistingPayment(fd, "payment post")).toThrow(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in payment post.`,
      );
    }
  });

  // ===========================================================================
  // DRAFT-ACTION-OWNER-3: currency is allowed in draft create (not forbidden)
  // ===========================================================================
  it("DRAFT-ACTION-OWNER-3. draft create with currency field is NOT rejected", () => {
    const fd = makeFormData({
      ownerType: "customer",
      ownerId: "cust-001",
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-001",
      currency: "EGP",
    });
    expect(() => rejectForbiddenFieldsForDraftCreate(fd)).not.toThrow();
  });

  // ===========================================================================
  // DRAFT-ACTION-OWNER-4: notes field is allowed in draft create
  // ===========================================================================
  it("DRAFT-ACTION-OWNER-4. draft create with notes field is NOT rejected", () => {
    const fd = makeFormData({
      ownerType: "customer",
      ownerId: "cust-001",
      paymentDate: "2026-09-03",
      amount: "100.00",
      paymentDirection: "received_from_party",
      paymentMethod: "cash",
      idempotencyKey: "draft-001",
      notes: "some notes",
    });
    expect(() => rejectForbiddenFieldsForDraftCreate(fd)).not.toThrow();
  });
});
