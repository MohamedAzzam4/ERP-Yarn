/**
 * WP-07-04 r26 — DRAFT-ACTION-OWNER-1: forbidden-field guard policy test.
 *
 * r26 BLOCKER C: This test now imports the PRODUCTION guard from
 * `src/server/services/payment-action-field-policy.ts` — the SAME module
 * that `payments/actions.ts` imports. No duplicated policy.
 *
 * Test identifiers:
 *   DRAFT-ACTION-OWNER-1: draft create allows ownerType + ownerId
 *   DRAFT-ACTION-OWNER-2: draft create rejects authority fields
 *   EXISTING-PAYMENT-1..5: post/settle/reverse reject ownerType + ownerId
 *   DRAFT-ACTION-OWNER-3: currency allowed in draft create
 *   DRAFT-ACTION-OWNER-4: notes allowed in draft create
 */
import { describe, it, expect } from "vitest";
import {
  rejectForbiddenFieldsForDraftCreate,
  rejectForbiddenFieldsForExistingPayment,
  FORBIDDEN_AUTHORITY_FIELDS,
  FORBIDDEN_EXISTING_PAYMENT_FIELDS,
} from "@/server/services/payment-action-field-policy";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v);
  }
  return fd;
}

describe("WP-07-04 r26 — DRAFT-ACTION-OWNER-1: forbidden-field policy (imports production guard)", () => {

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
    for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
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
  // EXISTING-PAYMENT-1: post rejects ownerType + ownerId
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
    for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
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
    for (const field of FORBIDDEN_EXISTING_PAYMENT_FIELDS) {
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
