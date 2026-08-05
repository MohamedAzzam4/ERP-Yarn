/**
 * Management Return/Replacement Management page — WP-08-01E.
 *
 * Route: /management/quality/returns
 * Contract 10 §8.7: Quality, Complaint, and Return Management.
 *
 * Owner/Accountant can:
 *   - View pending return requests
 *   - Approve returns with financial treatment (returns.approve)
 *   - Reject returns with reason (returns.approve)
 *
 * Forbidden (per Contract 10 §8.7):
 *   - Return above cap
 *   - Unlinked replacement difference
 *   - Automatic refund
 *   - Worker financial decision
 *
 * Workers are denied — redirected to /worker.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { ManagementShell } from "@/components/shells/management-shell";
import {
  isManagementShellRole,
  getManagementNavForRole,
} from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { QualityReturnScreenQueryService } from "@/server/services/quality-return-screen-query-service";
import { approveReturnAction, rejectReturnAction } from "./actions";

export default async function ManagementReturnsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    isManagementShellRole(r),
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let returns: Awaited<
    ReturnType<QualityReturnScreenQueryService["listReturnRequestsForManagement"]>
  > = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new QualityReturnScreenQueryService(db);
      returns = await queryService.listReturnRequestsForManagement(
        authResult.tenantId,
      );
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  const pendingReturns = returns.filter((r) => r.status === "pending_approval");
  const approvedReturns = returns.filter((r) => r.status === "approved");
  const rejectedReturns = returns.filter((r) => r.status === "rejected");

  return (
    <ManagementShell
      userName={authResult.name || authResult.email}
      navCategories={navCategories}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
    >
      <Container>
        <h1 className="text-2xl font-bold mb-6">إدارة المرتجعات</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && returns.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد طلبات مرتجعات.
            </CardContent>
          </Card>
        )}

        {dbAvailable && returns.length > 0 && (
          <>
            {/* Pending returns — approve/reject forms */}
            {pendingReturns.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>
                    مرتجعات بانتظار الموافقة — الموافقة والرفض
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {pendingReturns.map((r) => (
                    <div key={r.id} className="border rounded p-4">
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                        <div>
                          <span className="font-medium">
                            <LtrValue>{r.returnNo}</LtrValue>
                          </span>
                          <span className="text-muted-foreground mr-2">
                            {r.customerName} (
                            <LtrValue>{r.customerCode}</LtrValue>)
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          الطلب: <LtrValue>{r.saleDocNo}</LtrValue> · الكمية:{" "}
                          <LtrValue>{r.totalReturnQuantity}</LtrValue> ·
                          الأسطر: <LtrValue>{r.returnLineCount}</LtrValue>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground mb-3">
                        السبب: {r.returnReason}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        {/* Approve form */}
                        <form
                          action={approveReturnAction}
                          className="inline-flex flex-wrap gap-2 items-center"
                        >
                          <input
                            type="hidden"
                            name="returnId"
                            value={r.id}
                          />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`approve-${r.id}-${crypto.randomUUID()}`}
                          />
                          <label className="text-sm text-muted-foreground">
                            المعالجة المالية:
                          </label>
                          <select
                            name="financialTreatment"
                            required
                            defaultValue="customer_credit"
                            className="px-2 py-1 border rounded text-sm bg-background"
                            style={{ minHeight: "44px" }}
                          >
                            <option value="customer_credit">دائن عميل</option>
                            <option value="refund_due">مبلغ مسترد</option>
                            <option value="replacement">استبدال</option>
                            <option value="no_financial_impact">
                              بدون أثر مالي
                            </option>
                          </select>
                          <label className="text-sm text-muted-foreground">
                            سبب القرار:
                          </label>
                          <input
                            type="text"
                            name="decisionReason"
                            required
                            placeholder="سبب الموافقة"
                            className="px-2 py-1 border rounded text-sm w-48"
                            style={{ minHeight: "44px" }}
                          />
                          <button
                            type="submit"
                            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                            style={{ minHeight: "44px" }}
                          >
                            موافقة
                          </button>
                        </form>

                        {/* Reject form */}
                        <form
                          action={rejectReturnAction}
                          className="inline-flex flex-wrap gap-2 items-center"
                        >
                          <input
                            type="hidden"
                            name="returnId"
                            value={r.id}
                          />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`reject-${r.id}-${crypto.randomUUID()}`}
                          />
                          <label className="text-sm text-muted-foreground">
                            سبب الرفض:
                          </label>
                          <input
                            type="text"
                            name="decisionReason"
                            required
                            placeholder="سبب الرفض"
                            className="px-2 py-1 border rounded text-sm w-48"
                            style={{ minHeight: "44px" }}
                          />
                          <button
                            type="submit"
                            className="px-4 py-2 border border-red-600 text-red-600 rounded text-sm"
                            style={{ minHeight: "44px" }}
                          >
                            رفض
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* All returns table */}
            <Card>
              <CardHeader>
                <CardTitle>جميع المرتجعات</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="py-2 px-3">رقم المرتجع</th>
                        <th className="py-2 px-3">العميل</th>
                        <th className="py-2 px-3">الطلب</th>
                        <th className="py-2 px-3">التاريخ</th>
                        <th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">المعالجة</th>
                        <th className="py-2 px-3">استبدال</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returns.map((r) => (
                        <tr key={r.id} className="border-b">
                          <td className="py-2 px-3">
                            <LtrValue>{r.returnNo}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            {r.customerName} (
                            <LtrValue>{r.customerCode}</LtrValue>)
                          </td>
                          <td className="py-2 px-3">
                            <LtrValue>{r.saleDocNo}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            <LtrValue>{r.returnDate}</LtrValue>
                          </td>
                          <td className="py-2 px-3">{r.status}</td>
                          <td className="py-2 px-3">
                            {r.financialTreatment ?? "—"}
                          </td>
                          <td className="py-2 px-3">
                            {r.isReplacement ? "نعم" : "لا"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {approvedReturns.length > 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                عدد المرتجعات المعتمدة:{" "}
                <LtrValue>{approvedReturns.length}</LtrValue>
              </p>
            )}
            {rejectedReturns.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                عدد المرتجعات المرفوضة:{" "}
                <LtrValue>{rejectedReturns.length}</LtrValue>
              </p>
            )}
          </>
        )}
      </Container>
    </ManagementShell>
  );
}
