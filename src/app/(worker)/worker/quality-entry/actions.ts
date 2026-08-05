/**
 * Server actions for Worker Quality Entry — WP-08-01E.
 *
 * Contract 10 §7.3: Quality Employee Screens.
 * Contract 11 §8: Workers redacted from financial fields.
 *
 * Actions:
 * 1. createQualityTestAction → QualityTestService.createQualityTest
 *    (permission: quality_tests.create)
 * 2. createComplaintAction → ComplaintService.createComplaint
 *    (permission: complaints.investigate)
 *
 * Both actions record FACTS only — no financial treatment, stock posting,
 * refund, credit, or replacement authorization.
 *
 * All persistence is DB-backed:
 *   - QualityTestDbRepository / ComplaintDbRepository (Drizzle)
 *   - SubledgerDbRepository (Drizzle, if needed)
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
import { ComplaintService } from "@/server/services/complaint-service";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import {
  QualityTestDbRepository,
} from "@/server/services/quality-test-db-repository";
import {
  ComplaintDbRepository,
} from "@/server/services/complaint-db-repository";
import { db } from "@/server/db/client";

// ---------------------------------------------------------------------------
// Forbidden fields — client must NEVER submit these.
// ---------------------------------------------------------------------------

const FORBIDDEN_QUALITY_FIELDS = [
  "testNo",
  "tenantId",
  "createdBy",
  "updatedBy",
  "auditLogId",
  "idempotencyRecordId",
];

const FORBIDDEN_COMPLAINT_FIELDS = [
  "complaintNo",
  "tenantId",
  "createdBy",
  "updatedBy",
  "auditLogId",
  "idempotencyRecordId",
];

function rejectForbiddenFields(
  formData: FormData,
  fields: string[],
  operation: string,
): void {
  for (const field of fields) {
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
// Action 1: Create a quality test (worker facts only).
// ---------------------------------------------------------------------------

export async function createQualityTestAction(
  formData: FormData,
): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "quality_tests.create",
  );

  rejectForbiddenFields(formData, FORBIDDEN_QUALITY_FIELDS, "quality test");

  const testDate = String(formData.get("testDate") ?? "").trim();
  const linkedEntityType = String(
    formData.get("linkedEntityType") ?? "",
  ).trim();
  const linkedEntityId = String(formData.get("linkedEntityId") ?? "").trim();
  const testStatus = String(formData.get("testStatus") ?? "needs_review").trim();
  const riskClassification = String(
    formData.get("riskClassification") ?? "none",
  ).trim();
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!testDate || !linkedEntityId || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: testDate, linkedEntityId, and idempotencyKey are required.",
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

  await service.createQualityTest(authResult as any, effective, {
    testDate,
    linkedEntityType: linkedEntityType as any,
    linkedEntityId,
    testStatus: testStatus as any,
    riskClassification: riskClassification as any,
    notes,
    idempotencyKey,
  });

  revalidatePath("/worker/quality-entry");
}

// ---------------------------------------------------------------------------
// Action 2: Create a complaint (worker facts only).
// ---------------------------------------------------------------------------

export async function createComplaintAction(
  formData: FormData,
): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "complaints.investigate",
  );

  rejectForbiddenFields(
    formData,
    FORBIDDEN_COMPLAINT_FIELDS,
    "complaint create",
  );

  const complaintDate = String(formData.get("complaintDate") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const priority = String(formData.get("priority") ?? "normal").trim();
  const description = formData.get("description")
    ? String(formData.get("description"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!complaintDate || !subject || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: complaintDate, subject, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  const complaintRepository = new ComplaintDbRepository(dbInstance);

  const service = new ComplaintService({
    complaintRepository,
    audit,
    idempotency,
    documentSequence,
  });

  await service.createComplaint(authResult as any, effective, {
    complaintDate,
    subject,
    description,
    priority: priority as any,
    idempotencyKey,
  });

  revalidatePath("/worker/quality-entry");
}
