/**
 * Server actions for Management Quality Tests — WP-08-01E.
 *
 * Contract 10 §8.7: Management review of quality tests.
 * Contract 04 §11: Quality records facts; management authorizes risk.
 *
 * Actions:
 * 1. reviewQualityTestAction → QualityTestService.reviewQualityTest
 *    (permission: quality_tests.create — management-level review)
 *
 * Quality holds/risky-sale clearance remains management-authorized only.
 * Workers are denied.
 *
 * All persistence is DB-backed:
 *   - QualityTestDbRepository (Drizzle)
 *   - AuditDbRepository (Drizzle)
 *   - IdempotencyDbRepository (Drizzle)
 *   - DocumentSequenceDbRepository (Drizzle)
 *
 * NO in-memory test repositories are used in production actions.
 */
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { QualityTestService } from "@/server/services/quality-test-service";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import {
  QualityTestDbRepository,
} from "@/server/services/quality-test-db-repository";
import { db } from "@/server/db/client";

// ---------------------------------------------------------------------------
// Forbidden fields — client must NEVER submit these.
// ---------------------------------------------------------------------------

const FORBIDDEN_REVIEW_FIELDS = [
  "testNo",
  "tenantId",
  "createdBy",
  "updatedBy",
  "reviewedBy",
  "reviewedAt",
  "auditLogId",
  "idempotencyRecordId",
];

function rejectForbiddenFields(
  formData: FormData,
  operation: string,
): void {
  for (const field of FORBIDDEN_REVIEW_FIELDS) {
    if (formData.has(field)) {
      throw new Error(
        `FORBIDDEN_FIELD: Field '${field}' is not allowed in ${operation}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Shared deps — DB-backed, no in-memory stores.
// ---------------------------------------------------------------------------

function getSharedDeps() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new DocumentSequenceDbRepository(db);
  return { db, audit, idempotency, documentSequence };
}

// ---------------------------------------------------------------------------
// Action 1: Review a quality test (management risk authorization).
// ---------------------------------------------------------------------------

/**
 * Review a quality test — set test status + risk classification.
 *
 * Permission: quality_risk_sales.approve (Owner/Accountant ONLY).
 *
 * Contract 11 §7 (Role/Action Matrix):
 *   Quality-risk sale approval: Owner = A, Accountant = A,
 *   Warehouse = -, Quality = investigation/comment only.
 *
 * This is the management-level review that authorizes risk disposition:
 *   - accepted → stock is sellable
 *   - needs_review → stock held for further review
 *   - blocked → stock blocked from sale
 *   - sellable_with_discount → REVIEW FLAG that permits risky sale
 *
 * The service creates/clears quality holds based on the risk classification.
 * This action can clear a hold, classify stock as sellable, authorize
 * sellable_with_discount, or otherwise permit risky sale — therefore it
 * requires the exact management authorization quality_risk_sales.approve
 * and denies Quality/Warehouse users server-side.
 *
 * Workers (Quality/Warehouse) retain quality_tests.create for fact recording
 * only (createQualityTestAction, recordQualityTestValueAction) — they cannot
 * perform this management risk-clearance review.
 *
 * This does NOT:
 *   - Create stock movements
 *   - Create account entries
 *   - Approve sales or returns directly
 *
 * Contract 04 §11: Quality records facts; management authorizes risk.
 * Contract 10 §8.7: Management review of quality tests.
 * Contract 11 §7: Quality-risk sale approval = Owner/Accountant only.
 */
export async function reviewQualityTestAction(
  formData: FormData,
): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "quality_risk_sales.approve",
  );

  rejectForbiddenFields(formData, "quality test review");

  const qualityTestId = String(formData.get("qualityTestId") ?? "").trim();
  const testStatus = String(formData.get("testStatus") ?? "").trim();
  const riskClassification = String(
    formData.get("riskClassification") ?? "",
  ).trim();
  const reviewNotes = formData.get("reviewNotes")
    ? String(formData.get("reviewNotes"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!qualityTestId || !testStatus || !riskClassification || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: qualityTestId, testStatus, riskClassification, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  const qualityTestRepository = new QualityTestDbRepository(dbInstance);

  const service = new QualityTestService({
    qualityTestRepository,
    audit,
    idempotency,
    documentSequence,
  });

  await service.reviewQualityTest(authResult as any, effective, {
    qualityTestId,
    testStatus: testStatus as any,
    riskClassification: riskClassification as any,
    reviewNotes,
    idempotencyKey,
  });

  revalidatePath("/management/quality/tests");
}
