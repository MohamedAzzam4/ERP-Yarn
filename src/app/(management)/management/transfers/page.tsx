/**
 * Management Transfers page — transfer workflow UI.
 *
 * Route: /management/transfers
 *
 * WP-03-02: List pending transfer requests + approve/reverse actions.
 * Read-only list with approve action (Owner/Accountant only).
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isManagementShellRole, getManagementNavForRole } from "@/components/shells/nav-config";
import { ManagementShell } from "@/components/shells/management-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { TransferWorkflowService } from "@/server/services/transfer-workflow-service";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { DbTenantOwnershipValidator } from "@/server/services/db-tenant-ownership-validator";
import { InventoryLedgerService } from "@/server/services/inventory-ledger-service";
import { InventoryLedgerDbRepository } from "@/server/services/inventory-ledger-db-repository";
import { AuditDbRepository } from "@/server/services/audit-db-repository";
import { IdempotencyDbRepository } from "@/server/services/idempotency-db-repository";
import { DocumentSequenceDbRepository } from "@/server/services/document-sequence-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import type { EffectivePermissions } from "@/server/security/effective-permissions";

export default async function TransfersPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let pendingTransfers: any[] = [];
  let dbAvailable = false;

  if (db) {
    const audit = new AuditDbRepository(db);
    const idempotency = new IdempotencyDbRepository(db);
    const documentSequence = new DocumentSequenceDbRepository(db);
    const inventoryLedger = new InventoryLedgerService({
      ledger: new InventoryLedgerDbRepository(db),
      audit, idempotency, documentSequence,
    });
    const service = new TransferWorkflowService({
      approvalRepository: new RawReceiptApprovalDbRepository(db),
      inventoryLedger, audit, idempotency,
      tenantOwnershipValidator: new DbTenantOwnershipValidator(db),
    });
    const effective: EffectivePermissions = resolveEffectivePermissions(authResult.roles, (await loadRolePermissionMatrixForTenant(authResult.tenantId)));
    try {
      pendingTransfers = await service.listPendingTransfers({ ...authResult, tenantId: authResult.tenantId } as any, effective);
      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => { "use server"; await signOut(); }}
      breadcrumbs={[{ label: "الرئيسية", href: "/management" }, { label: "طلبات النقل" }]}
    >
      <Container size="xl" className="py-6">
        <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            <div>
              <h1 className="text-heading-2 text-foreground">طلبات النقل</h1>
              <p className="text-sm text-muted-foreground">مراجعة واعتماد طلبات نقل المخزون بين المواقع</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">الطلبات المعلقة</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dbAvailable ? (
              pendingTransfers.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="border-b border-border bg-primary/5">
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الصنف</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">من موقع</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">إلى موقع</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الكمية (كجم)</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الطلب بواسطة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingTransfers.map((t) => (
                        <tr key={t.id} className="border-b border-border hover:bg-primary/5">
                          <td className="p-3"><LtrValue className="font-medium">{t.itemId.slice(0, 8)}…</LtrValue></td>
                          <td className="p-3"><LtrValue>{t.fromLocationId.slice(0, 8)}…</LtrValue></td>
                          <td className="p-3"><LtrValue>{t.toLocationId.slice(0, 8)}…</LtrValue></td>
                          <td className="p-3"><LtrValue>{t.quantityKg}</LtrValue></td>
                          <td className="p-3"><LtrValue>{t.requestedBy.slice(0, 8)}…</LtrValue></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <p className="text-sm font-medium text-foreground">لا توجد طلبات نقل معلقة</p>
                  <p className="text-xs text-muted-foreground mt-1">ستظهر الطلبات هنا عند إنشاء عمال المخزون طلبات نقل.</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <p className="text-sm font-medium text-foreground">قاعدة البيانات غير متصلة</p>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              شاشة إدارية — صلاحيات المالك/المحاسب فقط
            </p>
          </CardContent>
        </Card>
      </Container>
    </ManagementShell>
  );
}
