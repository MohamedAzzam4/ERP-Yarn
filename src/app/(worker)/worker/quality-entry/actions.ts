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
import type { UpdateComplaintInput, ComplaintPriority } from "@/server/services/complaint-service";
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

  // Production transaction runner + tx-scoped factories (WP-08-01E Milestone A)
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (dbInstance as any).transaction(async (tx: any) => work(tx));
  };
  const txFactories = {
    createQualityTestRepository: (tx: unknown) => new QualityTestDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  const service = new QualityTestService({
    qualityTestRepository,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories,
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
  const linkedEntityType = String(formData.get("linkedEntityType") ?? "").trim();
  // linkedEntityId is submitted as "type:id" from the form's <option> value
  // so the action can validate the type/ID pair without scanning tables.
  const linkedEntityIdRaw = String(formData.get("linkedEntityId") ?? "").trim();

  if (!complaintDate || !subject || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: complaintDate, subject, and idempotencyKey are required.",
    );
  }

  if (!linkedEntityType) {
    throw new Error(
      "VALIDATION_FAILED: linkedEntityType is required.",
    );
  }

  if (!linkedEntityIdRaw) {
    throw new Error(
      "VALIDATION_FAILED: linkedEntityId is required.",
    );
  }

  // Validate linkedEntityType is supported
  const SUPPORTED_ENTITY_TYPES = ["customer", "sale", "item", "quality_test", "yarn_lot"] as const;
  type SupportedEntityType = (typeof SUPPORTED_ENTITY_TYPES)[number];
  if (!SUPPORTED_ENTITY_TYPES.includes(linkedEntityType as SupportedEntityType)) {
    throw new Error(
      `VALIDATION_FAILED: unsupported linkedEntityType '${linkedEntityType}'. Supported: ${SUPPORTED_ENTITY_TYPES.join(", ")}.`,
    );
  }

  // Parse the "type:id" format from the form's <option> value
  const colonIdx = linkedEntityIdRaw.indexOf(":");
  if (colonIdx < 0) {
    throw new Error(
      "VALIDATION_FAILED: linkedEntityId must be in 'type:id' format.",
    );
  }
  const submittedType = linkedEntityIdRaw.substring(0, colonIdx);
  const submittedId = linkedEntityIdRaw.substring(colonIdx + 1);

  // Type/ID mismatch: the submitted linkedEntityType must match the type
  // embedded in the linkedEntityId value
  if (submittedType !== linkedEntityType) {
    throw new Error(
      `VALIDATION_FAILED: linkedEntityType '${linkedEntityType}' does not match the entity ID type '${submittedType}'.`,
    );
  }

  if (!submittedId) {
    throw new Error(
      "VALIDATION_FAILED: linkedEntityId contains an empty ID.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  // Validate that the type/ID pair exists in the tenant scope.
  // This is an ownership validation: cross-tenant or nonexistent IDs are rejected.
  const { QualityReturnScreenQueryService } = await import(
    "@/server/services/quality-return-screen-query-service"
  );
  const queryService = new QualityReturnScreenQueryService(dbInstance);
  const linkedEntities = await queryService.listLinkedEntitiesForWorker(
    authResult.tenantId,
  );
  const matched = linkedEntities.find(
    (e) => e.entityType === submittedType && e.entityId === submittedId,
  );
  if (!matched) {
    throw new Error(
      "VALIDATION_FAILED: linkedEntityId not found in tenant scope for the given type (cross-tenant, nonexistent, or type mismatch).",
    );
  }

  // Map entity type to the ComplaintService input fields
  const complaintInput: {
    complaintDate: string;
    subject: string;
    description: string | null;
    priority: ComplaintPriority;
    idempotencyKey: string;
    customerId?: string;
    saleId?: string;
    itemId?: string;
    qualityTestId?: string;
    yarnLotId?: string;
    rawMaterialBatchId?: string;
  } = {
    complaintDate,
    subject,
    description,
    priority: priority as ComplaintPriority,
    idempotencyKey,
  };

  const entityType = matched.entityType as SupportedEntityType;
  switch (entityType) {
    case "customer":
      complaintInput.customerId = matched.entityId;
      break;
    case "sale":
      complaintInput.saleId = matched.entityId;
      break;
    case "item":
      complaintInput.itemId = matched.entityId;
      break;
    case "quality_test":
      complaintInput.qualityTestId = matched.entityId;
      break;
    case "yarn_lot":
      complaintInput.yarnLotId = matched.entityId;
      break;
    default:
      throw new Error(
        `VALIDATION_FAILED: unsupported linked entity type '${matched.entityType}'.`,
      );
  }

  const complaintRepository = new ComplaintDbRepository(dbInstance);

  // Production transaction runner + tx-scoped factories (WP-08-01E Milestone A)
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (dbInstance as any).transaction(async (tx: any) => work(tx));
  };
  const txFactories = {
    createComplaintRepository: (tx: unknown) => new ComplaintDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  const service = new ComplaintService({
    complaintRepository,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories,
  });

  await service.createComplaint(authResult as any, effective, complaintInput);

  revalidatePath("/worker/quality-entry");
}

// ---------------------------------------------------------------------------
// Action 3: Record a quality test value (worker facts only).
// ---------------------------------------------------------------------------

/**
 * Record a measured value for a quality test parameter.
 *
 * Permission: quality_tests.create (Quality role + Owner + Accountant).
 * Workers record FACTS only — no risk clearance, no financial effect.
 *
 * Contract 10 §7.3: Quality employees record test values and observations.
 * Contract 04 §11: Quality records facts; management authorizes risk.
 */
export async function recordQualityTestValueAction(
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

  rejectForbiddenFields(formData, FORBIDDEN_QUALITY_FIELDS, "quality test value");

  const qualityTestId = String(formData.get("qualityTestId") ?? "").trim();
  const parameterName = String(formData.get("parameterName") ?? "").trim();
  const parameterCode = String(formData.get("parameterCode") ?? "").trim();
  const measuredValue = formData.get("measuredValue")
    ? String(formData.get("measuredValue"))
    : null;
  const valueStatus = String(formData.get("valueStatus") ?? "pending").trim();
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : null;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!qualityTestId || !parameterCode || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: qualityTestId, parameterCode, and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  const qualityTestRepository = new QualityTestDbRepository(dbInstance);

  // Production transaction runner + tx-scoped factories (WP-08-01E Milestone A)
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (dbInstance as any).transaction(async (tx: any) => work(tx));
  };
  const txFactories = {
    createQualityTestRepository: (tx: unknown) => new QualityTestDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  const service = new QualityTestService({
    qualityTestRepository,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories,
  });

  await service.recordQualityTestValue(authResult as any, effective, {
    qualityTestId,
    parameterName,
    parameterCode,
    measuredValue,
    valueStatus: valueStatus as "pending" | "pass" | "fail" | "review",
    notes,
    idempotencyKey,
  });

  revalidatePath("/worker/quality-entry");
}

// ---------------------------------------------------------------------------
// Action 4: Update a complaint (investigation facts only).
// ---------------------------------------------------------------------------

/**
 * Update complaint investigation status, notes, and resolution.
 *
 * Permission: complaints.investigate (Quality + Owner + Accountant).
 * This is a view-with-comment action — NO operational side effects.
 *
 * Contract 10 §7.3: Quality employees record investigation facts.
 * Contract 11 §8: Workers cannot set financial resolution values.
 */
export async function updateComplaintAction(
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
    "complaint update",
  );

  const complaintId = String(formData.get("complaintId") ?? "").trim();
  const status = formData.get("status")
    ? String(formData.get("status"))
    : undefined;
  const priority = formData.get("priority")
    ? String(formData.get("priority"))
    : undefined;
  const investigationNotes = formData.get("investigationNotes")
    ? String(formData.get("investigationNotes"))
    : undefined;
  const resolutionNotes = formData.get("resolutionNotes")
    ? String(formData.get("resolutionNotes"))
    : undefined;
  const resolutionType = formData.get("resolutionType")
    ? String(formData.get("resolutionType"))
    : undefined;
  const notes = formData.get("notes")
    ? String(formData.get("notes"))
    : undefined;
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "").trim();

  if (!complaintId || !idempotencyKey) {
    throw new Error(
      "VALIDATION_FAILED: complaintId and idempotencyKey are required.",
    );
  }

  const { db: dbInstance, audit, idempotency, documentSequence } =
    getSharedDeps();

  const complaintRepository = new ComplaintDbRepository(dbInstance);

  // Production transaction runner + tx-scoped factories (WP-08-01E Milestone A)
  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (dbInstance as any).transaction(async (tx: any) => work(tx));
  };
  const txFactories = {
    createComplaintRepository: (tx: unknown) => new ComplaintDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
    createDocumentSequence: (tx: unknown) => new DocumentSequenceDbRepository(tx as any),
  };

  const service = new ComplaintService({
    complaintRepository,
    audit,
    idempotency,
    documentSequence,
    transactionRunner,
    txFactories,
  });

  const input: UpdateComplaintInput = {
    complaintId,
    idempotencyKey,
  };
  if (status) input.status = status as any;
  if (priority) input.priority = priority as any;
  if (investigationNotes !== undefined) input.investigationNotes = investigationNotes;
  if (resolutionNotes !== undefined) input.resolutionNotes = resolutionNotes;
  if (resolutionType !== undefined) input.resolutionType = resolutionType;
  if (notes !== undefined) input.notes = notes;

  await service.updateComplaint(authResult as any, effective, input);

  revalidatePath("/worker/quality-entry");
}
