/**
 * Management Direct Cost Review page — WP-08-01D Milestone A.
 *
 * Contract 10 §8.6: Direct Cost Review screen — Owner/Accountant review
 * direct cost drafts submitted by workers, confirm the amount, set the
 * actual payer, decide profitability inclusion, and (for shared
 * responsibility) provide allocations.
 *
 * Contract 07 §18:
 *   - Worker input is restricted to amount (if known), simple responsibility,
 *     and notes. No financial fields.
 *   - Accountant/Owner review confirms amount, actual payer, allocations,
 *     profitability inclusion, and posts subledger entries where applicable.
 *   - "No direct-cost subledger entry before required review, except a
 *     specifically approved simple company-borne configuration."
 *
 * Permission: direct_costs.review (Owner/Accountant only — Workers denied
 * at the financial-deny ceiling per Contract 11 §13).
 *
 * DEC-080: The user who created the draft cannot review/approve it. This
 * is enforced by the service; the screen still shows the row but the form
 * is only valid for non-creators.
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
import {
  AccountingScreenQueryService,
  type ManagementDirectCostDto,
} from "@/server/services/accounting-screen-query-service";
import { reviewDirectCostAction } from "./actions";

export default async function ManagementDirectCostsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    isManagementShellRole(r),
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let costs: ManagementDirectCostDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new AccountingScreenQueryService(db);
      costs = await queryService.listDirectCostsForReview(
        authResult.tenantId,
      );
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  const pendingReview = costs.filter(
    (c) => c.reviewStatus === "needs_accountant_review",
  );
  const reviewedCosts = costs.filter(
    (c) => c.reviewStatus !== "needs_accountant_review",
  );

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
        <h1 className="text-2xl font-bold mb-6">مراجعة التكاليف</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && costs.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد تكاليف مسجلة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && costs.length > 0 && (
          <>
            {/* Costs awaiting review — review form */}
            {pendingReview.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>تكاليف بانتظار المراجعة</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {pendingReview.map((c) => {
                    const isOwn = false; // DEC-080 enforced server-side
                    return (
                      <div key={c.id} className="border rounded p-4">
                        <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                          <div>
                            <span className="font-medium">
                              <LtrValue>{c.costNo}</LtrValue>
                            </span>
                            <span className="text-muted-foreground mr-2">
                              النوع: {c.costType}
                            </span>
                            <span className="text-muted-foreground mr-2">
                              الكيان المرتبط:{" "}
                              <LtrValue>{c.linkedEntityType}</LtrValue> /{" "}
                              <LtrValue>{c.linkedEntityId}</LtrValue>
                            </span>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            المبلغ الحالي:{" "}
                            <LtrValue>{c.amount ?? "—"}</LtrValue>{" "}
                            <LtrValue>{c.currency}</LtrValue> · المسؤولية:{" "}
                            {c.costResponsibilityType}
                          </div>
                        </div>

                        {isOwn && (
                          <p className="text-xs text-amber-600 mb-2">
                            لا يمكنك مراجعة تكلفة أنشأتها (DEC-080).
                          </p>
                        )}

                        <form
                          action={reviewDirectCostAction}
                          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                        >
                          <input
                            type="hidden"
                            name="directCostId"
                            value={c.id}
                          />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`review-${c.id}-${crypto.randomUUID()}`}
                          />

                          <label className="flex flex-col gap-1 text-sm">
                            <span className="text-muted-foreground">
                              المبلغ المؤكد:
                            </span>
                            <input
                              type="text"
                              name="amount"
                              required
                              inputMode="decimal"
                              defaultValue={c.amount ?? ""}
                              placeholder="0.00"
                              className="px-2 py-1 border rounded text-sm"
                              style={{ minHeight: "44px" }}
                            />
                          </label>

                          <label className="flex flex-col gap-1 text-sm">
                            <span className="text-muted-foreground">
                              المسؤولية:
                            </span>
                            <select
                              name="costResponsibilityType"
                              required
                              defaultValue={c.costResponsibilityType}
                              className="px-2 py-1 border rounded text-sm bg-background"
                              style={{ minHeight: "44px" }}
                            >
                              <option value="company">شركة</option>
                              <option value="customer">عميل</option>
                              <option value="factory">مصنع</option>
                              <option value="shared">مشترك</option>
                              <option value="unknown">غير معروف</option>
                              <option value="included_elsewhere">
                                مشمول في مكان آخر
                              </option>
                            </select>
                          </label>

                          <label className="flex flex-col gap-1 text-sm">
                            <span className="text-muted-foreground">
                              الدافع الفعلي:
                            </span>
                            <select
                              name="actualPayerType"
                              required
                              defaultValue={c.actualPayerType}
                              className="px-2 py-1 border rounded text-sm bg-background"
                              style={{ minHeight: "44px" }}
                            >
                              <option value="company">شركة</option>
                              <option value="customer">عميل</option>
                              <option value="factory">مصنع</option>
                              <option value="other">آخر</option>
                              <option value="unknown">غير معروف</option>
                              <option value="not_recorded">غير مسجل</option>
                            </select>
                          </label>

                          <label className="flex flex-col gap-1 text-sm">
                            <span className="text-muted-foreground">
                              تضمين في الربحية:
                            </span>
                            <select
                              name="includedInProfitability"
                              required
                              defaultValue={
                                c.includedInProfitability ? "true" : "false"
                              }
                              className="px-2 py-1 border rounded text-sm bg-background"
                              style={{ minHeight: "44px" }}
                            >
                              <option value="true">نعم</option>
                              <option value="false">لا</option>
                            </select>
                          </label>

                          <label className="flex flex-col gap-1 text-sm">
                            <span className="text-muted-foreground">
                              ملاحظات:
                            </span>
                            <input
                              type="text"
                              name="notes"
                              defaultValue={c.notes ?? ""}
                              placeholder="ملاحظات المراجع"
                              className="px-2 py-1 border rounded text-sm"
                              style={{ minHeight: "44px" }}
                            />
                          </label>

                          <label className="flex flex-col gap-1 text-sm">
                            <span className="text-muted-foreground">
                              تخصيص مشترك (إن وُجد):
                            </span>
                            <input
                              type="text"
                              name="allocationsJson"
                              placeholder='[{"partyType":"customer","partyId":"…","shareAmount":"100.00"}]'
                              className="px-2 py-1 border rounded text-sm font-mono text-xs"
                              style={{ minHeight: "44px" }}
                            />
                          </label>

                          <div className="sm:col-span-2 lg:col-span-3">
                            <button
                              type="submit"
                              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                              style={{ minHeight: "44px" }}
                            >
                              اعتماد المراجعة
                            </button>
                          </div>
                        </form>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* All direct costs table */}
            <Card>
              <CardHeader>
                <CardTitle>جميع التكاليف</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="py-2 px-3">رقم التكلفة</th>
                        <th className="py-2 px-3">النوع</th>
                        <th className="py-2 px-3">الكيان المرتبط</th>
                        <th className="py-2 px-3">المبلغ</th>
                        <th className="py-2 px-3">العملة</th>
                        <th className="py-2 px-3">المسؤولية</th>
                        <th className="py-2 px-3">الدافع الفعلي</th>
                        <th className="py-2 px-3">حالة المراجعة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costs.map((c) => (
                        <tr key={c.id} className="border-b">
                          <td className="py-2 px-3">
                            <LtrValue>{c.costNo}</LtrValue>
                          </td>
                          <td className="py-2 px-3">{c.costType}</td>
                          <td className="py-2 px-3">
                            <LtrValue>{c.linkedEntityType}</LtrValue> /{" "}
                            <LtrValue>{c.linkedEntityId}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            <LtrValue>{c.amount ?? "—"}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            <LtrValue>{c.currency}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            {c.costResponsibilityType}
                          </td>
                          <td className="py-2 px-3">{c.actualPayerType}</td>
                          <td className="py-2 px-3">{c.reviewStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reviewedCosts.length > 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    عدد التكاليف المراجعة:{" "}
                    <LtrValue>{reviewedCosts.length}</LtrValue>
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </Container>
    </ManagementShell>
  );
}
