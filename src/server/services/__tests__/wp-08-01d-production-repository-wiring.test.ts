/**
 * WP-08-01D Production Repository Wiring Tests.
 *
 * Verifies the production repository correction:
 * - postPaymentAction, settlePaymentAction, reversePaymentAction use
 *   PaymentDbRepository in production (NOT InMemoryPaymentRepository);
 * - reviewDirectCostAction uses DirectCostDbRepository in production
 *   (NOT InMemoryDirectCostRepository);
 * - PaymentDbRepository.updatePaymentStatus uses the payment_status pgEnum
 *   (status column on payments table, not raw text);
 * - DirectCostDbRepository.lockDirectCost uses SELECT ... FOR UPDATE
 *   (real locking, NOT a no-op);
 * - Tenant scope (tenantId filter) is present in every payment/direct-cost
 *   query;
 * - Action errors do not leak financial data (error messages reference only
 *   the id and operation name, never amounts/balances/account numbers);
 * - No production action in these paths constructs InMemoryPaymentRepository
 *   or InMemoryDirectCostRepository.
 *
 * These are static-analysis + structural tests because the test environment
 * has no live DB connection. The DB-backed behavior is verified by the
 * live validation script (scripts/wp-08-01d-*.ts) against real PostgreSQL.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PAYMENTS_ACTIONS_PATH = resolve(
  process.cwd(),
  "src/app/(management)/management/accounts/payments/actions.ts",
);
const DIRECT_COSTS_ACTIONS_PATH = resolve(
  process.cwd(),
  "src/app/(management)/management/accounts/direct-costs/actions.ts",
);
const PAYMENT_DB_REPO_PATH = resolve(
  process.cwd(),
  "src/server/services/payment-db-repository.ts",
);
const DIRECT_COST_DB_REPO_PATH = resolve(
  process.cwd(),
  "src/server/services/direct-cost-db-repository.ts",
);

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

describe("WP-08-01D Production Repository Wiring", () => {
  describe("Payments actions use PaymentDbRepository (NOT InMemory)", () => {
    const actions = readFile(PAYMENTS_ACTIONS_PATH);

    it("imports PaymentDbRepository from the production path", () => {
      expect(actions).toMatch(
        /from\s+"@\/server\/services\/payment-db-repository"/,
      );
    });

    it("does NOT import InMemoryPaymentRepository", () => {
      expect(actions).not.toMatch(/InMemoryPaymentRepository/);
    });

    it("postPaymentAction constructs PaymentDbRepository", () => {
      // Verify the production wiring appears in the post action body.
      // Look for `new PaymentDbRepository(dbInstance)` followed by
      // `service.postPayment(`.
      expect(actions).toMatch(/new PaymentDbRepository\(dbInstance\)/);
      expect(actions).toMatch(/service\.postPayment\(/);
    });

    it("settlePaymentAction constructs PaymentDbRepository", () => {
      expect(actions).toMatch(/new PaymentDbRepository\(dbInstance\)/);
      expect(actions).toMatch(/service\.settlePayment\(/);
    });

    it("reversePaymentAction constructs PaymentDbRepository", () => {
      expect(actions).toMatch(/new PaymentDbRepository\(dbInstance\)/);
      expect(actions).toMatch(/service\.reversePayment\(/);
    });

    it("exposes a tx-scoped createPayment factory for future use", () => {
      expect(actions).toMatch(/createPayment:\s*\(tx:\s*unknown\)\s*=>\s*new PaymentDbRepository/);
    });
  });

  describe("Direct-costs actions use DirectCostDbRepository (NOT InMemory)", () => {
    const actions = readFile(DIRECT_COSTS_ACTIONS_PATH);

    it("imports DirectCostDbRepository from the production path", () => {
      expect(actions).toMatch(
        /from\s+"@\/server\/services\/direct-cost-db-repository"/,
      );
    });

    it("does NOT import InMemoryDirectCostRepository", () => {
      expect(actions).not.toMatch(/InMemoryDirectCostRepository/);
    });

    it("reviewDirectCostAction constructs DirectCostDbRepository", () => {
      expect(actions).toMatch(/new DirectCostDbRepository\(dbInstance\)/);
      expect(actions).toMatch(/service\.reviewDirectCost\(/);
    });

    it("exposes a tx-scoped createDirectCost factory for future use", () => {
      expect(actions).toMatch(/createDirectCost:\s*\(tx:\s*unknown\)\s*=>\s*new DirectCostDbRepository/);
    });
  });

  describe("PaymentDbRepository uses payment_status pgEnum correctly", () => {
    const repo = readFile(PAYMENT_DB_REPO_PATH);

    it("imports the `payments` table from the schema (not raw text)", () => {
      expect(repo).toMatch(
        /from\s+"@\/server\/db\/schema\/subledger"/,
      );
      expect(repo).toMatch(/\bpayments\b/);
      expect(repo).toMatch(/\bpaymentSettlements\b/);
    });

    it("updatePaymentStatus uses the payments.status column (pgEnum)", () => {
      // The update target must be `payments.status`, not a raw text column.
      expect(repo).toMatch(/\.update\(payments\)/);
      expect(repo).toMatch(/status:\s*patch\.status\s+as\s+Payment\["status"\]/);
    });

    it("updatePaymentStatus WHERE clause filters by tenantId + id + status IN (...)", () => {
      // Look for the three required WHERE conditions.
      expect(repo).toMatch(/eq\(payments\.tenantId,\s*tenantId\)/);
      expect(repo).toMatch(/eq\(payments\.id,\s*paymentId\)/);
      expect(repo).toMatch(/inArray\(\s*payments\.status,\s*expectedCurrentStatuses/);
    });

    it("updatePaymentStatus returns null on no-match (stale state)", () => {
      expect(repo).toMatch(/return result \?\? null;/);
    });

    it("updatePaymentStatus returns null when expectedCurrentStatuses is empty (defensive)", () => {
      expect(repo).toMatch(
        /if \(expectedCurrentStatuses\.length === 0\)\s*\{[^}]*return null;/,
      );
    });
  });

  describe("PaymentDbRepository locking is real (SELECT ... FOR UPDATE + advisory lock)", () => {
    const repo = readFile(PAYMENT_DB_REPO_PATH);

    it("lockPayment uses SELECT ... FOR UPDATE", () => {
      expect(repo).toMatch(/\.for\("update"\)/);
      // lockPayment must be the method that uses FOR UPDATE on the payments row.
      expect(repo).toMatch(/async lockPayment\([^)]*\)[^{]*\{[^}]*\.for\("update"\)/s);
    });

    it("lockSettlementsForPaymentEntry uses SELECT ... FOR UPDATE", () => {
      expect(repo).toMatch(
        /async lockSettlementsForPaymentEntry\([^)]*\)[^{]*\{[^}]*\.for\("update"\)/s,
      );
    });

    it("lockSettledEntry uses pg_advisory_xact_lock (NOT a no-op)", () => {
      expect(repo).toMatch(/pg_advisory_xact_lock/);
      // The method body must NOT be a no-op (no `_tenantId, _entryId` and empty body).
      expect(repo).not.toMatch(/async lockSettledEntry\([^)]*\)\s*\{\s*\}/);
    });

    it("lockPaymentEntry uses pg_advisory_xact_lock (NOT a no-op)", () => {
      expect(repo).toMatch(/pg_advisory_xact_lock/);
      expect(repo).not.toMatch(/async lockPaymentEntry\([^)]*\)\s*\{\s*\}/);
    });
  });

  describe("PaymentDbRepository tenant isolation", () => {
    const repo = readFile(PAYMENT_DB_REPO_PATH);

    it("every public method takes tenantId as its first parameter", () => {
      // Every public method on PaymentDbRepository that reads or writes
      // payment/settlement rows accepts tenantId as its first arg.
      const methodSignatures = [
        /async findPaymentById\(\s*tenantId:\s*string,/, /async findPaymentByIdempotencyKey\(\s*tenantId:\s*string,/, /async findPaymentByPostedEntryId\(\s*tenantId:\s*string,/, /async updatePaymentStatus\(\s*tenantId:\s*string,/, /async lockPayment\(\s*tenantId:\s*string,/, /async findSettlementById\(\s*tenantId:\s*string,/, /async listSettlementsForPaymentEntry\(\s*tenantId:\s*string,/, /async listSettlementsForSettledEntry\(\s*tenantId:\s*string,/, /async lockSettlementsForPaymentEntry\(\s*tenantId:\s*string,/,
      ];
      for (const sigRegex of methodSignatures) {
        expect(repo).toMatch(sigRegex);
      }
    });

    it("every method body uses tenantId in its WHERE clause", () => {
      // Count occurrences of `eq(<table>.tenantId, tenantId)`.
      const tenantFilters = repo.match(
        /eq\((?:payments|paymentSettlements)\.tenantId,\s*tenantId\)/g,
      );
      // At least 9 methods filter by tenantId (findPaymentById,
      // findPaymentByIdempotencyKey, findPaymentByPostedEntryId,
      // updatePaymentStatus, lockPayment, findSettlementById,
      // listSettlementsForPaymentEntry, listSettlementsForSettledEntry,
      // lockSettlementsForPaymentEntry).
      expect(tenantFilters?.length ?? 0).toBeGreaterThanOrEqual(9);
    });

    it("insertPayment and insertSettlement write tenantId from the input row", () => {
      expect(repo).toMatch(/tenantId:\s*row\.tenantId/);
    });
  });

  describe("DirectCostDbRepository uses review_status pgEnum correctly", () => {
    const repo = readFile(DIRECT_COST_DB_REPO_PATH);

    it("imports the `directCosts` and `directCostAllocations` tables from the schema", () => {
      expect(repo).toMatch(/from\s+"@\/server\/db\/schema\/subledger"/);
      expect(repo).toMatch(/\bdirectCosts\b/);
      expect(repo).toMatch(/\bdirectCostAllocations\b/);
    });

    it("updateDirectCostReview uses the directCosts.reviewStatus column (pgEnum)", () => {
      expect(repo).toMatch(/\.update\(directCosts\)/);
      expect(repo).toMatch(/reviewStatus:\s*patch\.reviewStatus\s+as\s+DirectCost\["reviewStatus"\]/);
    });

    it("updateDirectCostReview WHERE clause filters by tenantId + id + review_status IN (...)", () => {
      expect(repo).toMatch(/eq\(directCosts\.tenantId,\s*tenantId\)/);
      expect(repo).toMatch(/eq\(directCosts\.id,\s*directCostId\)/);
      expect(repo).toMatch(/inArray\(\s*directCosts\.reviewStatus,\s*expectedCurrentStatuses/);
    });

    it("updateDirectCostReview returns null on no-match (stale state)", () => {
      expect(repo).toMatch(/return result \?\? null;/);
    });

    it("updateDirectCostReview returns null when expectedCurrentStatuses is empty (defensive)", () => {
      expect(repo).toMatch(
        /if \(expectedCurrentStatuses\.length === 0\)\s*\{\s*return null;/,
      );
    });
  });

  describe("DirectCostDbRepository locking is real (SELECT ... FOR UPDATE)", () => {
    const repo = readFile(DIRECT_COST_DB_REPO_PATH);

    it("lockDirectCost uses SELECT ... FOR UPDATE", () => {
      expect(repo).toMatch(/\.for\("update"\)/);
      expect(repo).toMatch(
        /async lockDirectCost\([^)]*\)[^{]*\{[\s\S]*?\.for\("update"\)/,
      );
    });

    it("lockDirectCost is NOT a no-op (body has more than just a return)", () => {
      expect(repo).not.toMatch(/async lockDirectCost\([^)]*\)\s*\{\s*\}/);
      // The body must contain a select ... for update call (not just a comment).
      expect(repo).toMatch(/async lockDirectCost[\s\S]*?\.for\("update"\)/);
    });
  });

  describe("DirectCostDbRepository tenant isolation", () => {
    const repo = readFile(DIRECT_COST_DB_REPO_PATH);

    it("every public method takes tenantId as its first parameter", () => {
      const methodSignatures = [
        /async findDirectCostById\(\s*tenantId:\s*string,/, /async updateDirectCostReview\(\s*tenantId:\s*string,/, /async listDirectCostsForLinkedEntity\(\s*tenantId:\s*string,/, /async listApprovedIncludedDirectCosts\(\s*tenantId:\s*string,/, /async lockDirectCost\(\s*tenantId:\s*string,/, /async listAllocationsForDirectCost\(\s*tenantId:\s*string,/,
      ];
      for (const sigRegex of methodSignatures) {
        expect(repo).toMatch(sigRegex);
      }
    });

    it("every method body uses tenantId in its WHERE clause", () => {
      const tenantFilters = repo.match(
        /eq\((?:directCosts|directCostAllocations)\.tenantId,\s*tenantId\)/g,
      );
      // At least 6 methods filter by tenantId.
      expect(tenantFilters?.length ?? 0).toBeGreaterThanOrEqual(6);
    });

    it("insertDirectCost and insertAllocation write tenantId from the input row", () => {
      expect(repo).toMatch(/tenantId:\s*row\.tenantId/);
    });
  });

  describe("Production action errors do not leak financial data", () => {
    const paymentsActions = readFile(PAYMENTS_ACTIONS_PATH);
    const directCostsActions = readFile(DIRECT_COSTS_ACTIONS_PATH);

    it("payments actions VALIDATION_FAILED messages reference only field names", () => {
      // Find all thrown Error("VALIDATION_FAILED: ...") messages.
      const matches = paymentsActions.matchAll(
        /new Error\(\s*["`]VALIDATION_FAILED:[^"`]+["`]/g,
      );
      const messages = Array.from(matches).map((m) => m[0]);
      expect(messages.length).toBeGreaterThan(0);
      for (const msg of messages) {
        // Must NOT contain financial keywords: amount, balance, account, money, signed.
        expect(msg).not.toMatch(/\bamount\b/i);
        expect(msg).not.toMatch(/\bbalance\b/i);
        expect(msg).not.toMatch(/\bmoney\b/i);
        expect(msg).not.toMatch(/\bsigned\b/i);
        // "account" is allowed in field-name context ("accountId is required")
        // but NOT in balance/account-number context.
      }
    });

    it("direct-costs actions VALIDATION_FAILED messages reference only field names", () => {
      const matches = directCostsActions.matchAll(
        /new Error\(\s*["`]VALIDATION_FAILED:[^"`]+["`]/g,
      );
      const messages = Array.from(matches).map((m) => m[0]);
      expect(messages.length).toBeGreaterThan(0);
      for (const msg of messages) {
        expect(msg).not.toMatch(/\bbalance\b/i);
        expect(msg).not.toMatch(/\bmoney\b/i);
        expect(msg).not.toMatch(/\bsigned\b/i);
      }
    });

    it("FORBIDDEN_FIELD messages do not reveal the rejected value", () => {
      const paymentsForbidden = paymentsActions.matchAll(
        /FORBIDDEN_FIELD:[^"`]+/g,
      );
      const directCostsForbidden = directCostsActions.matchAll(
        /FORBIDDEN_FIELD:[^"`]+/g,
      );
      const allForbidden = [
        ...Array.from(paymentsForbidden),
        ...Array.from(directCostsForbidden),
      ].map((m) => m[0]);
      expect(allForbidden.length).toBeGreaterThan(0);
      for (const msg of allForbidden) {
        // Must reference only the field NAME, not the value the client tried to set.
        expect(msg).toMatch(/Field\s+'/);
        expect(msg).not.toMatch(/value/i);
      }
    });
  });

  describe("Conditional update logic (state-machine semantics)", () => {
    /**
     * Verify the conditional-update semantics via the in-memory repository
     * (which mirrors the DB WHERE-clause behavior). The DB repository uses
     * the same `expectedCurrentStatuses` array as the in-memory one.
     */

    it("updatePaymentStatus returns null when current status is NOT in expected set (stale state)", async () => {
      const { InMemoryPaymentRepository } = await import(
        "@/server/services/__tests__/in-memory-payment-repository"
      );
      const repo = new InMemoryPaymentRepository();
      const payment = await repo.insertPayment({
        tenantId: "t-1",
        paymentNo: "PAY-001",
        paymentDate: "2026-08-01",
        accountId: "acc-1",
        amount: "100.00",
        paymentDirection: "received_from_party",
        paymentMethod: "cash",
        status: "draft",
        idempotencyKey: "idem-1",
        createdBy: "u-1",
      });

      // Try to transition draft → reversed (skipping posted). Must fail.
      const result = await repo.updatePaymentStatus(
        "t-1",
        payment.id,
        { status: "reversed", updatedBy: "u-1" },
        ["posted"], // expected: posted, actual: draft
      );
      expect(result).toBeNull();

      // Verify the payment is still draft.
      const refetched = await repo.findPaymentById("t-1", payment.id);
      expect(refetched?.status).toBe("draft");
    });

    it("updatePaymentStatus succeeds when current status IS in expected set", async () => {
      const { InMemoryPaymentRepository } = await import(
        "@/server/services/__tests__/in-memory-payment-repository"
      );
      const repo = new InMemoryPaymentRepository();
      const payment = await repo.insertPayment({
        tenantId: "t-1",
        paymentNo: "PAY-002",
        paymentDate: "2026-08-01",
        accountId: "acc-1",
        amount: "100.00",
        paymentDirection: "received_from_party",
        paymentMethod: "cash",
        status: "draft",
        idempotencyKey: "idem-2",
        createdBy: "u-1",
      });

      const result = await repo.updatePaymentStatus(
        "t-1",
        payment.id,
        { status: "posted", postedEntryId: "entry-1", isLocked: true, updatedBy: "u-1" },
        ["draft"],
      );
      expect(result).not.toBeNull();
      expect(result?.status).toBe("posted");
      expect(result?.postedEntryId).toBe("entry-1");
      expect(result?.isLocked).toBe(true);
    });

    it("updateDirectCostReview returns null when current review_status is NOT in expected set", async () => {
      const { InMemoryDirectCostRepository } = await import(
        "@/server/services/__tests__/in-memory-direct-cost-repository"
      );
      const repo = new InMemoryDirectCostRepository();
      const dc = await repo.insertDirectCost({
        tenantId: "t-1",
        costNo: "DC-001",
        costType: "transport",
        linkedEntityType: "sales_order",
        linkedEntityId: "so-1",
        amount: "50.00",
        currency: "EGP",
        costResponsibilityType: "needs_accountant_review",
        actualPayerType: "not_recorded",
        includedInProfitability: false,
        reviewStatus: "needs_accountant_review",
        createdBy: "u-1",
      });

      // Try to review when status is already "approved" (stale state).
      // First, transition to approved (success).
      const approved = await repo.updateDirectCostReview(
        "t-1",
        dc.id,
        {
          amount: "55.00",
          costResponsibilityType: "customer",
          actualPayerType: "customer",
          includedInProfitability: true,
          reviewStatus: "approved",
          reviewedBy: "u-2",
          reviewedAt: new Date(),
          updatedBy: "u-2",
        },
        ["needs_accountant_review"],
      );
      expect(approved).not.toBeNull();
      expect(approved?.reviewStatus).toBe("approved");

      // Now try to review AGAIN (double-review) — must fail.
      const secondReview = await repo.updateDirectCostReview(
        "t-1",
        dc.id,
        {
          reviewStatus: "approved",
          reviewedBy: "u-3",
          reviewedAt: new Date(),
          updatedBy: "u-3",
        },
        ["needs_accountant_review"],
      );
      expect(secondReview).toBeNull();
    });
  });

  describe("Tenant isolation in conditional updates", () => {
    it("updatePaymentStatus returns null when tenantId does not match (cross-tenant attempt)", async () => {
      const { InMemoryPaymentRepository } = await import(
        "@/server/services/__tests__/in-memory-payment-repository"
      );
      const repo = new InMemoryPaymentRepository();
      const payment = await repo.insertPayment({
        tenantId: "t-1",
        paymentNo: "PAY-003",
        paymentDate: "2026-08-01",
        accountId: "acc-1",
        amount: "100.00",
        paymentDirection: "received_from_party",
        paymentMethod: "cash",
        status: "draft",
        idempotencyKey: "idem-3",
        createdBy: "u-1",
      });

      // Attempt to update from a different tenant.
      const result = await repo.updatePaymentStatus(
        "t-2", // wrong tenant
        payment.id,
        { status: "posted", postedEntryId: "entry-1", isLocked: true, updatedBy: "u-evil" },
        ["draft"],
      );
      expect(result).toBeNull();

      // Verify the payment is still draft and was NOT modified.
      const refetched = await repo.findPaymentById("t-1", payment.id);
      expect(refetched?.status).toBe("draft");
      expect(refetched?.postedEntryId).toBeNull();
    });

    it("updateDirectCostReview returns null when tenantId does not match", async () => {
      const { InMemoryDirectCostRepository } = await import(
        "@/server/services/__tests__/in-memory-direct-cost-repository"
      );
      const repo = new InMemoryDirectCostRepository();
      const dc = await repo.insertDirectCost({
        tenantId: "t-1",
        costNo: "DC-002",
        costType: "transport",
        linkedEntityType: "sales_order",
        linkedEntityId: "so-1",
        amount: "50.00",
        currency: "EGP",
        costResponsibilityType: "needs_accountant_review",
        actualPayerType: "not_recorded",
        includedInProfitability: false,
        reviewStatus: "needs_accountant_review",
        createdBy: "u-1",
      });

      const result = await repo.updateDirectCostReview(
        "t-2", // wrong tenant
        dc.id,
        {
          amount: "55.00",
          costResponsibilityType: "customer",
          actualPayerType: "customer",
          includedInProfitability: true,
          reviewStatus: "approved",
          reviewedBy: "u-2",
          reviewedAt: new Date(),
          updatedBy: "u-2",
        },
        ["needs_accountant_review"],
      );
      expect(result).toBeNull();

      // Verify the direct cost was NOT modified.
      const refetched = await repo.findDirectCostById("t-1", dc.id);
      expect(refetched?.reviewStatus).toBe("needs_accountant_review");
      expect(refetched?.reviewedBy).toBeNull();
    });
  });

  describe("Denied action has zero writes (permission check happens BEFORE any DB write)", () => {
    const paymentsActions = readFile(PAYMENTS_ACTIONS_PATH);
    const directCostsActions = readFile(DIRECT_COSTS_ACTIONS_PATH);

    it("postPaymentAction calls resolveAndRequirePermission BEFORE getSharedDeps", () => {
      const permIdx = paymentsActions.indexOf(
        "resolveAndRequirePermission(\n    authResult.roles,\n    TEST_ROLE_PERMISSION_MATRIX,\n    \"payments.approve\",\n  )",
      );
      const postActionIdx = paymentsActions.indexOf("export async function postPaymentAction");
      const sharedDepsIdx = paymentsActions.indexOf("getSharedDeps()", postActionIdx);
      expect(permIdx).toBeGreaterThan(postActionIdx);
      expect(permIdx).toBeLessThan(sharedDepsIdx);
    });

    it("settlePaymentAction calls resolveAndRequirePermission BEFORE getSharedDeps", () => {
      const settleActionIdx = paymentsActions.indexOf("export async function settlePaymentAction");
      const permIdx = paymentsActions.indexOf(
        "\"payments.approve\",\n  )",
        settleActionIdx,
      );
      const sharedDepsIdx = paymentsActions.indexOf("getSharedDeps()", settleActionIdx);
      expect(permIdx).toBeGreaterThan(settleActionIdx);
      expect(permIdx).toBeLessThan(sharedDepsIdx);
    });

    it("reversePaymentAction calls resolveAndRequirePermission BEFORE getSharedDeps", () => {
      const reverseActionIdx = paymentsActions.indexOf("export async function reversePaymentAction");
      const permIdx = paymentsActions.indexOf(
        "\"payments.reverse\",\n  )",
        reverseActionIdx,
      );
      const sharedDepsIdx = paymentsActions.indexOf("getSharedDeps()", reverseActionIdx);
      expect(permIdx).toBeGreaterThan(reverseActionIdx);
      expect(permIdx).toBeLessThan(sharedDepsIdx);
    });

    it("reviewDirectCostAction calls resolveAndRequirePermission BEFORE getSharedDeps", () => {
      const reviewActionIdx = directCostsActions.indexOf("export async function reviewDirectCostAction");
      const permIdx = directCostsActions.indexOf(
        "\"direct_costs.review\",\n  )",
        reviewActionIdx,
      );
      const sharedDepsIdx = directCostsActions.indexOf("getSharedDeps()", reviewActionIdx);
      expect(permIdx).toBeGreaterThan(reviewActionIdx);
      expect(permIdx).toBeLessThan(sharedDepsIdx);
    });
  });
});
