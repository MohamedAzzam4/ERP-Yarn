/**
 * Server actions for Management Direct Cost Review — WP-08-01D Milestone A.
 *
 * Contract 10 §8.6: Direct Cost Review screen — Owner/Accountant review
 * direct cost drafts (status='needs_accountant_review'), confirm the
 * amount, set the actual payer, decide profitability inclusion, and (for
 * shared responsibility) provide allocations.
 *
 * Contract 07 §18:
 *   - Worker input is restricted to amount (if known), simple responsibility,
 *     and notes. No financial fields.
 *   - Accountant/Owner review confirms amount, actual payer, allocations,
 *     profitability inclusion, and posts subledger entries where applicable.
 *   - "No direct-cost subledger entry before required review."
 *
 * DEC-080: The user who created the draft cannot review/approve it. This
 * is enforced by the DirectCostService (throws
 * RequesterCannotApproveOwnDirectCostError).
 *
 * Actions:
 * 1. reviewDirectCostAction → DirectCostService.reviewDirectCost
 *    (permission: direct_costs.review)
 *
 * All actions:
 * - Use idempotency keys
 * - Verify state via domain service (stale state rejection)
 * - Enforce RBAC server-side
 * - Preserve tenant isolation
 * - Write audit through AuditDbRepository
 * - Call domain service boundary, not raw table mutation
 *
 * All persistence boundaries are DB-backed:
 *   - DirectCostRepository → DirectCostDbRepository (Drizzle, direct_costs + direct_cost_allocations)
 *   - SubledgerService → SubledgerDbRepository (Drizzle, accounts + account_entries)
 *   - ProfitabilitySnapshotService → ProfitabilitySnapshotDbRepository (Drizzle, snapshots)
 *   - SalesDbRepository (Drizzle, sales_orders)
 *   - AuditDbRepository (Drizzle, audit_logs)
 *   - IdempotencyDbRepository (Drizzle, idempotency_records)
 *
 * NO in-memory test repositories are used in production actions.
 */
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import { DirectCostService } from "@/server/services/direct-cost-service";
import type {
  ReviewDirectCostInput,
  CostResponsibilityType,
  ActualPayerType,
} from "@/server/services/direct-cost-service";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import { ProfitabilitySnapshotService } from "@/server/services/profitability-snapshot-service";
import { ProfitabilitySnapshotDbRepository } from "@/server/services/profitability-snapshot-db-repository";
import { SalesDbRepository } from "@/server/services/sales-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DirectCostDbRepository } from "@/server/services/direct-cost-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { db } from "@/server/db/client";

// ---------------------------------------------------------------------------
// Forbidden fields — client must NEVER submit these.
// ---------------------------------------------------------------------------

/**
 * Financial authority fields that must never be accepted from the client.
 * These are computed/derived server-side by the domain services.
 *
 * Contract 09 §5: "Do not accept authoritative tenant_id, actor, role,
 * approval status, calculated balance, stock delta, cost, payable sign, or
 * profitability total from the request body."
 */
const FORBIDDEN_DIRECT_COST_FIELDS = [
  // Review-state authority fields (server-controlled)
  "reviewStatus",
  "reviewedBy",
  "reviewedAt",
  "subledgerEntryId",
  "snapshotId",
  "snapshotVersion",
  // Document / entity authority fields
  "costNo",
  "tenantId",
  "createdBy",
  "updatedBy",
  // Audit/idempotency authority fields
  "auditLogId",
  "idempotencyRecordId",
];

function rejectForbiddenFields(formData: FormData): void {
  for (const field of FORBIDDEN_DIRECT_COST_FIELDS) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in direct cost review.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Shared deps — DB-backed audit/idempotency/document-sequence.
// ---------------------------------------------------------------------------

function getSharedDeps() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new DocumentSequenceDbRepository(db);
  return { db, audit, idempotency, documentSequence };
}

/**
 * Transaction runner — wraps all DB writes in a single db.transaction().
 * DirectCostService doesn't currently accept a transactionRunner in its
 * deps interface, but we expose it here for symmetry with the WP-08-01C
 * sales-orders pattern and to support future service-internal
 * transactional composition.
 */
function makeTransactionRunner() {
  if (!db) throw new Error("Database not available.");
  const transactionRunner = async <T>(
    work: (tx: unknown) => Promise<T>,
  ): Promise<T> => {
    return (db as any).transaction(async (tx: any) => work(tx));
  };
  return transactionRunner;
}

/**
 * Transaction-scoped factories — used to create repos + services that
 * share the same `tx` instance when composing multi-step writes.
 *
 * `createIdempotency` and `createAudit` are required by the
 * WP-08-01C pattern.
 */
function makeTxFactories(
  _audit: AuditDbRepository,
  _idempotency: IdempotencyDbRepository,
  _documentSequence: DocumentSequenceDbRepository,
) {
  return {
    createIdempotency: (tx: unknown) =>
      new IdempotencyDbRepository(tx as any),
    // r24 BLOCKER B: createAudit MUST be tx-scoped.
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    // r24 BLOCKER B: createSubledger MUST construct its SubledgerService with
    // a tx-scoped AuditDbRepository — same fix as payments/actions.ts.
    createSubledger: (tx: unknown) =>
      new SubledgerService({
        subledger: new SubledgerDbRepository(tx as any),
        audit: new AuditDbRepository(tx as any),
        idempotency: new IdempotencyDbRepository(tx as any),
        documentSequence: new DocumentSequenceDbRepository(tx as any),
      }),
    createSnapshotService: (tx: unknown) =>
      new ProfitabilitySnapshotService({
        snapshotRepository: new ProfitabilitySnapshotDbRepository(tx as any),
        salesRepository: new SalesDbRepository(tx as any),
        // r24 BLOCKER B: snapshot service audit MUST be tx-scoped too.
        audit: new AuditDbRepository(tx as any),
      }),
    createDocumentSequence: (tx: unknown) =>
      new DocumentSequenceDbRepository(tx as any),
    // PRODUCTION: tx-scoped DirectCostDbRepository for service-internal
    // transactional composition.
    createDirectCost: (tx: unknown) => new DirectCostDbRepository(tx as any),
  };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const ALLOWED_RESPONSIBILITY_TYPES: ReadonlySet<CostResponsibilityType> =
  new Set<CostResponsibilityType>([
    "company",
    "customer",
    "factory",
    "shared",
    "unknown",
    "included_elsewhere",
    "needs_accountant_review",
  ]);

const ALLOWED_PAYER_TYPES: ReadonlySet<ActualPayerType> = new Set<ActualPayerType>([
  "company",
  "customer",
  "factory",
  "other",
  "unknown",
  "not_recorded",
]);

function parseResponsibilityType(value: string): CostResponsibilityType {
  if (!ALLOWED_RESPONSIBILITY_TYPES.has(value as CostResponsibilityType)) {
    throw new Error(
      `VALIDATION_FAILED: Invalid costResponsibilityType '${value}'.`,
    );
  }
  return value as CostResponsibilityType;
}

function parsePayerType(value: string): ActualPayerType {
  if (!ALLOWED_PAYER_TYPES.has(value as ActualPayerType)) {
    throw new Error(`VALIDATION_FAILED: Invalid actualPayerType '${value}'.`);
  }
  return value as ActualPayerType;
}

interface AllocationFormInput {
  partyType: "customer" | "supplier" | "factory";
  partyId: string;
  shareAmount: string;
}

/**
 * Parse the optional shared-responsibility allocations JSON.
 * Returns an empty array if no allocations are submitted (the service
 * will validate that shared responsibility requires non-empty
 * allocations).
 */
function parseAllocations(
  raw: string | null | undefined,
): Array<{
  responsiblePartyType: "customer" | "supplier" | "factory";
  responsiblePartyId: string;
  shareAmount: string;
}> {
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "VALIDATION_FAILED: allocationsJson must be valid JSON.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "VALIDATION_FAILED: allocationsJson must be an array.",
    );
  }
  return parsed.map((item, idx) => {
    const a = item as Partial<AllocationFormInput>;
    if (!a || typeof a !== "object") {
      throw new Error(`VALIDATION_FAILED: allocation[${idx}] is not an object.`);
    }
    const partyType = a.partyType;
    const partyId = a.partyId;
    const shareAmount = a.shareAmount;
    if (
      partyType !== "customer" &&
      partyType !== "supplier" &&
      partyType !== "factory"
    ) {
      throw new Error(
        `VALIDATION_FAILED: allocation[${idx}].partyType must be customer|supplier|factory.`,
      );
    }
    if (typeof partyId !== "string" || !partyId.trim()) {
      throw new Error(
        `VALIDATION_FAILED: allocation[${idx}].partyId is required.`,
      );
    }
    if (typeof shareAmount !== "string" || !shareAmount.trim()) {
      throw new Error(
        `VALIDATION_FAILED: allocation[${idx}].shareAmount is required.`,
      );
    }
    return {
      responsiblePartyType: partyType,
      responsiblePartyId: partyId,
      shareAmount,
    };
  });
}

// ---------------------------------------------------------------------------
// Action 1: Review (approve) a direct cost.
// ---------------------------------------------------------------------------

/**
 * Review and approve a direct cost draft.
 *
 * Wires to DirectCostService.reviewDirectCost.
 * Permission: direct_costs.review (Owner/Accountant only).
 *
 * On approval:
 *   1. Service validates shared allocations sum to confirmed amount.
 *   2. Service posts subledger entry (customer-borne → positive
 *      customer_direct_cost_receivable; factory-borne → positive
 *      factory_direct_cost_recovery; other → no entry).
 *   3. Service inserts allocation rows (if shared).
 *   4. If includedInProfitability: service creates later profitability
 *      snapshot version via ProfitabilitySnapshotService.
 *   5. Service updates direct cost review status to 'approved'.
 *
 * DEC-080: The user who created the draft cannot review/approve it.
 */
export async function reviewDirectCostAction(
  formData: FormData,
): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    "direct_costs.review",
  );

  rejectForbiddenFields(formData);

  const directCostId = String(formData.get("directCostId") ?? "").trim();
  const amount = String(formData.get("amount") ?? "").trim();
  const costResponsibilityType = parseResponsibilityType(
    String(formData.get("costResponsibilityType") ?? "").trim(),
  );
  const actualPayerType = parsePayerType(
    String(formData.get("actualPayerType") ?? "").trim(),
  );
  const includedInProfitabilityRaw = String(
    formData.get("includedInProfitability") ?? "false",
  ).trim();
  const includedInProfitability = includedInProfitabilityRaw === "true";
  const allocationsRaw = formData.get("allocationsJson")
    ? String(formData.get("allocationsJson"))
    : null;
  const allocations = parseAllocations(allocationsRaw);
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!directCostId || !amount || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: directCostId, amount, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  // PRODUCTION: DirectCostDbRepository — Drizzle-backed, persists direct_costs
  // + direct_cost_allocations to the live DB. NO in-memory test repositories.
  const directCostRepository = new DirectCostDbRepository(dbInstance);
  const subledger = new SubledgerService({
    subledger: new SubledgerDbRepository(dbInstance),
    audit,
    idempotency,
    documentSequence,
  });
  const snapshotService = new ProfitabilitySnapshotService({
    snapshotRepository: new ProfitabilitySnapshotDbRepository(dbInstance),
    salesRepository: new SalesDbRepository(dbInstance),
    audit,
  });

  // WP-07-04 cutover coordination (r11): wire transaction runner + tx factories
  // so DirectCostService.reviewDirectCost wraps its full flow (subledger entry +
  // allocation + direct cost status + snapshot + audit + idempotency) in a
  // single db.transaction(). This is REQUIRED for the cutover advisory lock
  // to protect the entire direct cost review flow.
  const transactionRunner = makeTransactionRunner();
  const txFactories = makeTxFactories(audit, idempotency, documentSequence);

  const service = new DirectCostService({
    directCostRepository,
    subledger,
    snapshotService,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories: {
      createSubledger: txFactories.createSubledger,
      createDirectCostRepository: txFactories.createDirectCost,
      createAudit: txFactories.createAudit,
      createIdempotency: txFactories.createIdempotency,
      createDocumentSequence: txFactories.createDocumentSequence,
    },
  });

  const input: ReviewDirectCostInput = {
    directCostId,
    amount,
    costResponsibilityType,
    actualPayerType,
    includedInProfitability,
    allocations:
      allocations.length > 0
        ? allocations.map((a) => ({
            responsiblePartyType: a.responsiblePartyType,
            responsiblePartyId: a.responsiblePartyId,
            shareAmount: a.shareAmount,
          }))
        : undefined,
    notes,
    idempotencyKey,
  };

  await service.reviewDirectCost(authResult as any, effective, input);

  revalidatePath("/management/accounts/direct-costs");
}
