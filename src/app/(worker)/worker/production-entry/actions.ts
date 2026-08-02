/**
 * Server actions for Worker Production Entry — WP-08-01B.
 *
 * Contract 10 §7.2: Production Employee Screens.
 *   Allowed actions: Create/update/submit own drafts; request return from WIP.
 *   Forbidden actions: Issue/receipt financial posting, approve WIP return,
 *   change snapshots/rates, close unexplained WIP.
 *
 * Contract 05: No worker-entered payable, allocation, profitability or accounting entry.
 * Contract 11 §8/§9: Worker financial-deny is absolute.
 *
 * This action file wires ONLY the WIP return request — the one worker action
 * explicitly allowed by Contract 10 §7.2 that requires a server action.
 *
 * Production order draft creation and receipt draft creation are also allowed
 * for workers, but they require complex multi-step forms with allocation
 * previews. The WIP return request is the simplest safe worker action to
 * implement as a form action in WP-08-01B.
 *
 * The action delegates to WipReturnRequestService (existing domain service)
 * which handles: permission check, input validation, tenant isolation,
 * order/input state validation, subject hash computation, idempotency,
 * audit, and persistence.
 */
"use server";

import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { requireProductionTaskActor } from "@/server/security/inventory-guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { WipReturnRequestService } from "@/server/services/wip-return-request-service";
import { WipReturnRequestDbRepository } from "@/server/services/wip-return-request-db-repository";
import { ProductionOrderDbRepository } from "@/server/services/production-order-db-repository";
import { WipBalanceDbRepository } from "@/server/services/wip-balance-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { InProcessDocumentSequenceStore } from "@/server/services/document-sequence-service";
import { db } from "@/server/db/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { FORBIDDEN_PRODUCTION_FIELDS } from "@/server/services/__tests__/__helpers__/production-forbidden-fields";

// Forbidden fields imported from shared helper — see production-forbidden-fields.ts

function getWipReturnRequestService() {
  if (!db) throw new Error("Database not available.");
  const audit = new AuditDbRepository(db);
  const documentSequence = new InProcessDocumentSequenceStore();
  return new WipReturnRequestService({
    requestRepository: new WipReturnRequestDbRepository(db),
    productionOrderRepository: new ProductionOrderDbRepository(db),
    wipBalanceRepository: new WipBalanceDbRepository(db),
    audit,
    documentSequence,
  });
}

/**
 * Create a WIP return request.
 *
 * Worker action — wires to WipReturnRequestService.createRequest.
 * The service validates: permission, input, tenant, order state, input
 * ownership, positive quantity, and computes subject hash + idempotency.
 *
 * The worker CANNOT submit: factory rate, payable, cost basis, or any
 * financial field. The FORBIDDEN_PRODUCTION_FIELDS list rejects them.
 */
export async function createWipReturnRequest(formData: FormData): Promise<void> {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  requireProductionTaskActor(authResult as any, authResult.roles);

  const effective = resolveAndRequirePermission(
    authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "production.return_from_wip.request",
  );

  // Reject forbidden fields in payload
  for (const field of FORBIDDEN_PRODUCTION_FIELDS) {
    if (formData.has(field)) {
      throw new Error(`FORBIDDEN_FIELD: Field '${field}' is not allowed in worker WIP return request.`);
    }
  }

  const productionOrderId = String(formData.get("productionOrderId") ?? "").trim();
  const productionInputId = String(formData.get("productionInputId") ?? "").trim();
  const returnQtyKg = String(formData.get("returnQtyKg") ?? "").trim();
  const returnLocationId = String(formData.get("returnLocationId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const notes = formData.get("notes") ? String(formData.get("notes")) : null;

  if (!productionOrderId || !productionInputId || !returnQtyKg || !returnLocationId || !reason) {
    throw new Error("VALIDATION_FAILED: All fields are required (order, input, quantity, location, reason).");
  }

  const service = getWipReturnRequestService();
  await service.createRequest(authResult as any, effective, {
    productionOrderId,
    productionInputId,
    returnQtyKg,
    returnLocationId,
    reason,
    notes,
  });

  revalidatePath("/worker/production-entry");
}
