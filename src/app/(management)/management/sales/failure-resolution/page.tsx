/**
 * Management Sales Failure Resolution page — WP-08-01C.
 *
 * Contract 10 §8.4: Sales failure resolution.
 * Contract 10 §8.1: Approval Center queue categories.
 *
 * Shows the approval queue filtered to sales-related entity types,
 * plus any sales with failure-resolution status.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { ManagementShell } from "@/components/shells/management-shell";
import { isManagementShellRole, getManagementNavForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { SalesScreenQueryService, type ManagementApprovalQueueDto, type ManagementSalesOrderDto } from "@/server/services/sales-screen-query-service";

export default async function ManagementSalesFailureResolutionPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let queueItems: ManagementApprovalQueueDto[] = [];
  let failedOrders: ManagementSalesOrderDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new SalesScreenQueryService(db);
      // Get sales-related approval queue items
      queueItems = await queryService.listManagementApprovalQueue(authResult.tenantId, [
        "sale_order",
        "return_request",
        "transfer_request",
      ]);
      // Get sales orders with failure-resolution status
      const allOrders = await queryService.listManagementSalesOrders(authResult.tenantId);
      failedOrders = allOrders.filter((o) =>
        o.qualityWarningStatus === "quality_risk" ||
        o.saleStatus === "correction_requested" ||
        o.approvalStatus === "rejected"
      );
      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  return (
    <ManagementShell
      userName={authResult.name || authResult.email}
      navCategories={navCategories}
      onSignOut={async () => { "use server"; await signOut(); }}
    >
      <Container>
        <h1 className="text-2xl font-bold mb-6">حل فشل المبيعات</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && (
          <>
            {/* Approval Queue */}
            <Card className="mb-6">
              <CardHeader><CardTitle>قائمة المراجعات المعلقة</CardTitle></CardHeader>
              <CardContent>
                {queueItems.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا توجد طلبات مراجعة معلقة.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">النوع</th>
                          <th className="py-2 px-3">الكيان</th>
                          <th className="py-2 px-3">الحالة</th>
                          <th className="py-2 px-3">السبب</th>
                          <th className="py-2 px-3">تاريخ الطلب</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueItems.map((q) => (
                          <tr key={q.id} className="border-b">
                            <td className="py-2 px-3">{q.entityType}</td>
                            <td className="py-2 px-3"><LtrValue>{q.entityId.substring(0, 8)}</LtrValue></td>
                            <td className="py-2 px-3">{q.state}</td>
                            <td className="py-2 px-3">{q.reason ?? "—"}</td>
                            <td className="py-2 px-3"><LtrValue>{q.requestedAt.toISOString().split("T")[0]}</LtrValue></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Failed/Quality-Risk Orders */}
            <Card>
              <CardHeader><CardTitle>أوامر البيع ذات المشاكل</CardTitle></CardHeader>
              <CardContent>
                {failedOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا توجد أوامر بيع ذات مشاكل.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">رقم المستند</th>
                          <th className="py-2 px-3">العميل</th>
                          <th className="py-2 px-3">الحالة</th>
                          <th className="py-2 px-3">الموافقة</th>
                          <th className="py-2 px-3">تحذير الجودة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failedOrders.map((o) => (
                          <tr key={o.id} className="border-b">
                            <td className="py-2 px-3"><LtrValue>{o.docNo}</LtrValue></td>
                            <td className="py-2 px-3">{o.customerName}</td>
                            <td className="py-2 px-3">{o.saleStatus}</td>
                            <td className="py-2 px-3">{o.approvalStatus}</td>
                            <td className="py-2 px-3">{o.qualityWarningStatus ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </Container>
    </ManagementShell>
  );
}
