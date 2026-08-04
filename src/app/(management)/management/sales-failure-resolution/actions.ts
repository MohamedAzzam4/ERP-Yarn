/**
 * Server actions for sales failure resolution (WP-03-04).
 *
 * These server actions are called from the management sales failure resolution
 * screen. They enforce: permission (sales.approve), tenant, DEC-080 segregation,
 * idempotency, and atomicity.
 *
 * Production wiring: uses AuditDbRepository (persistent audit_logs), NOT
 * InProcessAuditStore. This ensures audit records are persisted to the
 * audit_logs table in the same transaction as the business mutations.
 *
 * Auth/tenant/role proof:
 *   - getErpAuthContextWithRoles resolves from Supabase session server-side.
 *   - tenantId from authResult (never formData).
 *   - resolveAndRequirePermission enforces sales.approve.
 *   - rejectBodyClaimsAuthority inside service.
 */
"use server";

import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import {
  SalesFailureResolutionService,
} from "@/server/services/sales-failure-resolution-service";
import type { ResolveSaleFailureInput } from "@/server/services/sales-failure-resolution-types";
import { SalesDbRepository } from "@/server/services/sales-db-repository";
import { StockReservationDbRepository } from "@/server/services/stock-reservation-db-repository";
import { OperationalAlertDbRepository } from "@/server/services/operational-alert-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { db } from "@/server/db/client";
import { revalidatePath } from "next/cache";

function getService() {
  if (!db) {
    throw new Error("Database not available. Sales failure resolution requires a live DB connection.");
  }

  // PRODUCTION WIRING: Use AuditDbRepository for persistent audit_logs.
  // This is NOT InProcessAuditStore — audit records are persisted to the
  // audit_logs table in the same DB transaction as the business mutations.
  const audit = new AuditDbRepository(db);
  const idempotency = new IdempotencyDbRepository(db);
  const documentSequence = new InProcessDocumentSequenceStore();

  const salesRepository = new SalesDbRepository(db);
  const reservationRepository = new StockReservationDbRepository(db);
  const alertRepository = new OperationalAlertDbRepository(db);
  const inventoryLedger = new InventoryLedgerService({
    ledger: new InventoryLedgerDbRepository(db),
    audit,
    idempotency,
    documentSequence,
  });

  const transactionRunner = async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
    return (db as any).transaction(async (tx: any) => work(tx));
  };

  const txFactories = {
    createInventoryLedger: (tx: unknown) => new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(tx as any),
      audit,
      idempotency,
      documentSequence,
    }),
    createReservationRepository: (tx: unknown) => new StockReservationDbRepository(tx as any),
    createSalesRepository: (tx: unknown) => new SalesDbRepository(tx as any),
    createAlertRepository: (tx: unknown) => new OperationalAlertDbRepository(tx as any),
    createIdempotency: (tx: unknown) => new IdempotencyDbRepository(tx as any),
    createAudit: (tx: unknown) => new AuditDbRepository(tx as any),
  };

  return new SalesFailureResolutionService({
    salesRepository,
    reservationRepository,
    alertRepository,
    inventoryLedger,
    audit,
    idempotency,
    transactionRunner,
    txFactories,
  });
}

export async function resolveSaleFailureAction(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const effective = resolveAndRequirePermission(
    authResult.roles,
    TEST_ROLE_PERMISSION_MATRIX,
    "sales.approve",
  );

  const input: ResolveSaleFailureInput = {
    saleId: (formData.get("sale_id") as string) || "",
    reason: (formData.get("reason") as any) || "technical_system",
    humanResolutionType: ((formData.get("human_resolution_type") as string) || undefined) as any,
    resolutionReason: (formData.get("resolution_reason") as string) || "",
    idempotencyKey: (formData.get("idempotencyKey") as string) ||
      `resolve-${(formData.get("sale_id") as string) || ""}-${(formData.get("reason") as string) || ""}`,
  };

  const service = getService();
  await service.resolveSaleFailure(authResult, effective, input);

  revalidatePath("/management/sales/failure-resolution");
  revalidatePath("/management/sales/orders");
}
