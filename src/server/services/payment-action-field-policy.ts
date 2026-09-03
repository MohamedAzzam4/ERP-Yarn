/**
 * r26 BLOCKER C: Shared payment-action forbidden-field policy.
 *
 * Extracted from `src/app/(management)/management/accounts/payments/actions.ts`
 * so that BOTH the production server action AND the unit test import the
 * SAME guard definitions — no duplicated policy.
 *
 * Contract 09 §5: "Do not accept authoritative tenant_id, actor, role,
 * approval status, calculated balance, stock delta, cost, payable sign, or
 * profitability total from the request body."
 *
 * Operation-specific policy:
 *   - Draft create: allows ownerType + ownerId (legitimate user-selected
 *     domain references validated against canonical master authority).
 *   - Post/settle/reverse: reject ownerType/ownerId/amount/etc. because
 *     those operations reference an existing payment by ID only.
 */

/** Truly authoritative fields forbidden in ALL payment operations. */
export const FORBIDDEN_AUTHORITY_FIELDS: readonly string[] = [
  // Signed amount / entry type / settlement status are derived server-side
  "amountSigned",
  "entryType",
  "entryNo",
  "settlementStatus",
  "postedEntryId",
  "reversalOfPaymentId",
  "reversalOfEntryId",
  "isLocked",
  // Payment-side authority fields
  "paymentNo",
  "status",
  "accountId",
  "tenantId",
  "createdBy",
  "updatedBy",
  // Audit/idempotency authority fields
  "auditLogId",
  "idempotencyRecordId",
];

/**
 * Additional forbidden fields for post/settle/reverse operations.
 * These operations reference an existing payment by `paymentId` only —
 * the client must NOT submit ownerType/ownerId because the payment already
 * has an account, and mutating the owner would be an authority violation.
 */
export const FORBIDDEN_EXISTING_PAYMENT_FIELDS: readonly string[] = [
  "ownerType",
  "ownerId",
  "amount",
  "paymentDirection",
  "paymentMethod",
  "paymentDate",
];

/**
 * r25 BLOCKER A / r26 BLOCKER C: Draft-create-specific forbidden-field guard.
 *
 * Draft creation legitimately accepts ownerType + ownerId (user-selected
 * domain references validated against canonical master authority), plus
 * amount, paymentDirection, paymentMethod, paymentDate, currency, notes.
 * Only truly authoritative fields (tenantId, paymentNo, status, accountId,
 * etc.) are rejected.
 */
export function rejectForbiddenFieldsForDraftCreate(formData: FormData): void {
  for (const field of FORBIDDEN_AUTHORITY_FIELDS) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in payment draft create.`,
      );
    }
  }
}

/**
 * r25 BLOCKER A / r26 BLOCKER C: Post/settle/reverse forbidden-field guard.
 *
 * These operations reference an existing payment by `paymentId` only. The
 * client must NOT submit ownerType/ownerId/amount/paymentDirection/
 * paymentMethod/paymentDate because the payment already has those fields
 * assigned from draft creation. Mutating them would be an authority
 * violation. Both the shared authority fields AND the existing-payment
 * mutation fields are rejected.
 */
export function rejectForbiddenFieldsForExistingPayment(
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
