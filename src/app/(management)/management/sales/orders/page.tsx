/**
 * Management Sales Orders page — WP-08-01C.
 *
 * Contract 10 §8.4: Sales screens support draft, complete price, submit,
 * approve, reject/cancel, correction/reversal by permission.
 * Contract 10 §8.1: approve/reject only through dedicated commands with
 * reason/idempotency.
 *
 * Shows sales orders with commercial totals + approve/reject forms for
 * pending_approval orders.
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
import { SalesScreenQueryService, type ManagementSalesOrderDto } from "@/server/services/sales-screen-query-service";
import { approveSaleAction, rejectSaleAction } from "./actions";

export default async function ManagementSalesOrdersPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let orders: ManagementSalesOrderDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new SalesScreenQueryService(db);
      orders = await queryService.listManagementSalesOrders(authResult.tenantId);
      dbAvailable = true;
    } catch { dbAvailable = false; }
  }

  const pendingOrders = orders.filter((o) => o.approvalStatus === "pending_approval");

  return (
    <ManagementShell
      userName={authResult.name || authResult.email}
      navCategories={navCategories}
      onSignOut={async () => { "use server"; await signOut(); }}
    >
      <Container>
        <h1 className="text-2xl font-bold mb-6">أوامر البيع</h1>

        {!dbAvailable && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">قاعدة البيانات غير متاحة.</CardContent></Card>
        )}

        {dbAvailable && orders.length === 0 && (
          <Card><CardContent className="py-8 text-center text-muted-foreground">لا توجد أوامر بيع مسجلة.</CardContent></Card>
        )}

        {dbAvailable && orders.length > 0 && (
          <>
            {/* Pending approval orders with action forms */}
            {pendingOrders.length > 0 && (
              <Card className="mb-6">
                <CardHeader><CardTitle>أوامر بانتظار الموافقة</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  {pendingOrders.map((o) => (
                    <div key={o.id} className="border rounded p-4">
                      <div className="flex justify-between items-center mb-3">
                        <div>
                          <span className="font-medium"><LtrValue>{o.docNo}</LtrValue></span>
                          <span className="text-muted-foreground mr-2">{o.customerName} (<LtrValue>{o.customerCode}</LtrValue>)</span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          الإجمالي: <LtrValue>{o.documentTotalPosted}</LtrValue>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {/* Approve form */}
                        <form action={approveSaleAction} className="inline">
                          <input type="hidden" name="saleId" value={o.id} />
                          <input type="hidden" name="idempotencyKey" value={`approve-${o.id}`} />
                          <input type="hidden" name="decisionNotes" value="" />
                          <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm" style={{ minHeight: "44px" }}>
                            موافقة
                          </button>
                        </form>
                        {/* Reject form */}
                        <form action={rejectSaleAction} className="inline flex gap-2">
                          <input type="hidden" name="saleId" value={o.id} />
                          <input type="hidden" name="idempotencyKey" value={`reject-${o.id}`} />
                          <input type="hidden" name="humanResolutionType" value="rejected" />
                          <input type="text" name="resolutionReason" required placeholder="سبب الرفض" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                          <button type="submit" className="px-4 py-2 border border-red-600 text-red-600 rounded text-sm" style={{ minHeight: "44px" }}>
                            رفض
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* All orders table */}
            <Card>
              <CardHeader><CardTitle>جميع الأوامر</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="py-2 px-3">رقم المستند</th>
                        <th className="py-2 px-3">العميل</th>
                        <th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">الموافقة</th>
                        <th className="py-2 px-3">إجمالي الإيراد</th>
                        <th className="py-2 px-3">الخصم</th>
                        <th className="py-2 px-3">الإجمالي المنشور</th>
                        <th className="py-2 px-3">الحجز</th>
                        <th className="py-2 px-3">الدفع</th>
                        <th className="py-2 px-3">التسليم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => (
                        <tr key={o.id} className="border-b">
                          <td className="py-2 px-3"><LtrValue>{o.docNo}</LtrValue></td>
                          <td className="py-2 px-3">{o.customerName} (<LtrValue>{o.customerCode}</LtrValue>)</td>
                          <td className="py-2 px-3">{o.saleStatus}</td>
                          <td className="py-2 px-3">{o.approvalStatus}</td>
                          <td className="py-2 px-3"><LtrValue>{o.totalGrossRevenue}</LtrValue></td>
                          <td className="py-2 px-3"><LtrValue>{o.orderDiscountTotal}</LtrValue></td>
                          <td className="py-2 px-3"><LtrValue>{o.documentTotalPosted}</LtrValue></td>
                          <td className="py-2 px-3">{o.reservationStatus ?? "—"}</td>
                          <td className="py-2 px-3">{o.paymentStatus ?? "—"}</td>
                          <td className="py-2 px-3">{o.deliveryStatus ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </Container>
    </ManagementShell>
  );
}
