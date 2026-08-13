/**
 * Management Raw Receipt Approvals page (WP-02-05).
 *
 * Route: /management/raw-receipt-approvals
 *
 * WP-02-05: Lists pending raw receipt approval requests and allows
 * management (Owner/Accountant with inventory.receive.approve) to approve
 * them, posting stock + optional payable.
 *
 * Workers are redirected to /worker (management-only route).
 *
 * Field visibility (Contract 11):
 *   - Management (Owner/Accountant) can see price/payable fields — they
 *     have balances.view_supplier_factory permission.
 *   - Workers never see this screen (redirected).
 *   - The approve form includes an optional price field (late-price path
 *     allows approving without price; confirm-late-price allows posting
 *     payable later).
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { getManagementNavForRole, isManagementShellRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RawReceiptApprovalsList } from "@/components/reference-screens/raw-receipt-approvals-list";
import { db } from "@/server/db/client";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { RawReceiptDraftDbRepository } from "@/server/services/raw-receipt-draft-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import {
  RawReceiptApprovalService,
} from "@/server/services/raw-receipt-approval-service";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { SubledgerService } from "@/server/services/subledger-service";
import { SubledgerDbRepository } from "@/server/services/subledger-db-repository";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";

export default async function RawReceiptApprovalsPage() {
  const authResult = await getErpAuthContextWithRoles();

  if (!authResult.authenticated) {
    redirect("/login");
  }

  if (authResult.roles.length === 0) {
    redirect("/login?error=no_role");
  }

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) {
    redirect("/worker");
  }

  const navCategories = getManagementNavForRole(managementRole);

  // Fetch pending raw receipt approvals from the real DB.
  let pendingApprovals: Array<{
    id: string;
    entityId: string;
    requestedBy: string;
    subjectHash: string;
    draft?: {
      batchNo: string;
      netWeightKg: string;
      grossWeightKg: string | null;
      supplierId: string | null;
      storageLocationId: string | null;
      receivedDate: string;
      notes: string | null;
    };
  }> = [];
  let dbAvailable = false;

  if (db) {
    const approvalRepository = new RawReceiptApprovalDbRepository(db);
    const draftRepository = new RawReceiptDraftDbRepository(db);
    const audit = new AuditDbRepository(db);
    const idempotency = new IdempotencyDbRepository(db);
    const documentSequence = new DocumentSequenceDbRepository(db);
    const inventoryLedger = new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(db),
      audit,
      idempotency,
      documentSequence,
    });
    const subledger = new SubledgerService({
      subledger: new SubledgerDbRepository(db),
      audit,
      idempotency,
      documentSequence,
    });
    const service = new RawReceiptApprovalService({
      approvalRepository,
      draftRepository,
      inventoryLedger,
      subledger,
      audit,
      idempotency,
    });
    const effective: EffectivePermissions = resolveEffectivePermissions(
      authResult.roles,
      (await loadRolePermissionMatrixForTenant(authResult.tenantId)),
    );
    try {
      const approvals = await service.listPendingApprovals(authResult, effective);
      // Fetch the draft for each approval (for display).
      for (const a of approvals) {
        const draft = await draftRepository.findDraftById(authResult.tenantId, a.entityId);
        pendingApprovals.push({
          id: a.id,
          entityId: a.entityId,
          requestedBy: a.requestedBy,
          subjectHash: a.subjectHash,
          draft: draft
            ? {
                batchNo: draft.batchNo,
                netWeightKg: draft.netWeightKg,
                grossWeightKg: draft.grossWeightKg,
                supplierId: draft.supplierId,
                storageLocationId: draft.storageLocationId,
                receivedDate: draft.receivedDate,
                notes: draft.notes,
              }
            : undefined,
        });
      }
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
      breadcrumbs={[
        { label: "الرئيسية", href: "/management" },
        { label: "اعتمادات استلام الخامات" },
      ]}
    >
      <Container size="xl" className="py-6">
        <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <div>
              <h1 className="text-heading-2 text-foreground">اعتمادات استلام الخامات</h1>
              <p className="text-sm text-muted-foreground">
                مراجعة واعتماد مسودات استلام الخامات المُرسلة من العمال
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">الطلبات المعلقة</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dbAvailable ? (
              <RawReceiptApprovalsList approvals={pendingApprovals} />
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <p className="text-sm font-medium text-foreground">قاعدة البيانات غير متصلة</p>
                <p className="text-xs text-muted-foreground mt-1">
                  تظهر الطلبات عند اتصال قاعدة البيانات. لا يتم عرض بيانات تجريبية.
                </p>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              هذه شاشة إدارية — يتم تطبيق صلاحيات المالك/المحاسب فقط. لا يمكن للعمال الوصول لهذه الشاشة.
            </p>
          </CardContent>
        </Card>
      </Container>
    </ManagementShell>
  );
}
