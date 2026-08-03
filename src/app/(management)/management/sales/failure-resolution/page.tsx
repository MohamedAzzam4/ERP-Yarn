/**
 * Management Sales Failure Resolution page — WP-08-01C.
 *
 * Contract 10 §8.4: Sales failure resolution.
 * Contract 10 §8.1: Approval Center queue categories.
 *
 * Shows the approval queue + failed orders with resolve action form.
 * Uses existing resolveSaleFailureAction from sales-failure-resolution/actions.ts.
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
import { resolveSaleFailureAction } from "../../sales-failure-resolution/actions";
import { SALE_FAILURE_REASONS } from "@/server/services/sales-failure-resolution-types";

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
      queueItems = await queryService.listManagementApprovalQueue(authResult.tenantId, [
        "sale_order", "return_request", "transfer_request",
      ]);
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

            {/* Failed/Quality-Risk Orders with resolve form */}
            <Card>
              <CardHeader><CardTitle>أوامر البيع ذات المشاكل</CardTitle></CardHeader>
              <CardContent>
                {failedOrders.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">لا توجد أوامر بيع ذات مشاكل.</p>
                ) : (
                  <div className="space-y-4">
                    {failedOrders.map((o) => (
                      <div key={o.id} className="border rounded p-4">
                        <div className="flex justify-between items-center mb-3">
                          <div>
                            <span className="font-medium"><LtrValue>{o.docNo}</LtrValue></span>
                            <span className="text-muted-foreground mr-2">{o.customerName}</span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            الحالة: {o.saleStatus} | الموافقة: {o.approvalStatus}
                            {o.qualityWarningStatus && ` | تحذير: ${o.qualityWarningStatus}`}
                          </div>
                        </div>
                        {/* Resolve failure form */}
                        <form action={resolveSaleFailureAction} className="flex flex-wrap gap-2 items-end">
                          <input type="hidden" name="sale_id" value={o.id} />
                          <div>
                            <label htmlFor={`reason-${o.id}`} className="block text-xs text-muted-foreground mb-1">السبب</label>
                            <select id={`reason-${o.id}`} name="reason" required className="p-2 border rounded text-sm" style={{ minHeight: "44px" }}>
                              {SALE_FAILURE_REASONS.map((r) => (
                                <option key={r} value={r}>{r}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`resolution-${o.id}`} className="block text-xs text-muted-foreground mb-1">تفاصيل الحل</label>
                            <input id={`resolution-${o.id}`} name="resolution_reason" type="text" required placeholder="سبب/تفاصيل الحل" className="p-2 border rounded text-sm" style={{ minHeight: "44px" }} />
                          </div>
                          <div>
                            <label htmlFor={`humanType-${o.id}`} className="block text-xs text-muted-foreground mb-1">نوع الحل البشري</label>
                            <select id={`humanType-${o.id}`} name="human_resolution_type" className="p-2 border rounded text-sm" style={{ minHeight: "44px" }}>
                              <option value="rejected">رفض</option>
                              <option value="cancelled">إلغاء</option>
                            </select>
                          </div>
                          <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm" style={{ minHeight: "44px" }}>
                            حل الفشل
                          </button>
                        </form>
                      </div>
                    ))}
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
