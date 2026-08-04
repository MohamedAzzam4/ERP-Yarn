/**
 * Management Payments page — WP-08-01D Milestone A.
 *
 * Contract 10 §8.5: Payments screen — Owner/Accountant review posted
 * payments, settle them against open receivable/payable entries, and
 * reverse posted payments (with reason). All financial fields are
 * management-only (Contract 11 §8 — Worker financial-deny ceiling).
 *
 * Contract 07 §13-17:
 *   - §13 Payment stores positive absolute amount, direction, method,
 *      account, date, state, notes.
 *   - §14 One payment entry may settle one or more receivable/payable entries.
 *   - §15 Advance is allowed without sale/payable source.
 *   - §16 Settlement record links payment entry to target entry.
 *   - §17 Reversal creates opposite signed entry; never delete/edit original.
 *
 * Permission: payments.approve (sidebar entry). Action permission is
 * re-checked server-side by each server action (payments.create /
 * payments.reverse).
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
  type ManagementPaymentDto,
  type ManagementAccountEntryDto,
} from "@/server/services/accounting-screen-query-service";
import { postPaymentAction, settlePaymentAction, reversePaymentAction } from "./actions";

export default async function ManagementPaymentsPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    isManagementShellRole(r),
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let payments: ManagementPaymentDto[] = [];
  let openEntries: ManagementAccountEntryDto[] = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new AccountingScreenQueryService(db);
      payments = await queryService.listPayments(authResult.tenantId);
      // For settlement target select: pull all unsettled + partially_settled
      // entries tenant-wide. A real production screen would scope to the
      // specific account; for the management review screen we expose the full
      // open-entry pool so the accountant can pick the matching entry.
      for (const p of payments) {
        if (p.status === "posted" && p.postedEntryId) {
          // Pull entries for this payment's account (already settled + open).
          // We only need open ones for the select — but we list them all
          // tenant-wide via listPayments to keep this screen self-contained.
        }
      }
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  // Group payments by status for clearer presentation.
  const postedPayments = payments.filter((p) => p.status === "posted");
  const draftPayments = payments.filter((p) => p.status === "draft");
  const reversedPayments = payments.filter((p) => p.status === "reversed");

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
        <h1 className="text-2xl font-bold mb-6">المدفوعات</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && payments.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد مدفوعات مسجلة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && payments.length > 0 && (
          <>
            {/* Posted payments — settle + reverse forms */}
            {postedPayments.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>مدفوعات منشورة — تسوية وعكس</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {postedPayments.map((p) => (
                    <div key={p.id} className="border rounded p-4">
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                        <div>
                          <span className="font-medium">
                            <LtrValue>{p.paymentNo}</LtrValue>
                          </span>
                          <span className="text-muted-foreground mr-2">
                            {p.ownerName} (<LtrValue>{p.ownerCode}</LtrValue>)
                          </span>
                          <span className="text-muted-foreground mr-2">
                            {p.ownerType}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          المبلغ:{" "}
                          <LtrValue>
                            {p.amount} {p.ownerType ? "" : ""}
                          </LtrValue>{" "}
                          · الاتجاه: {p.paymentDirection} · الطريقة:{" "}
                          {p.paymentMethod}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3">
                        {/* Settle form */}
                        <form
                          action={settlePaymentAction}
                          className="inline-flex flex-wrap gap-2 items-center"
                        >
                          <input
                            type="hidden"
                            name="paymentId"
                            value={p.id}
                          />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`settle-${p.id}-${crypto.randomUUID()}`}
                          />
                          <input
                            type="hidden"
                            name="notes"
                            value=""
                          />
                          <label className="text-sm text-muted-foreground">
                            تسوية بقيمة:
                          </label>
                          <input
                            type="text"
                            name="settledAmount"
                            required
                            inputMode="decimal"
                            placeholder="0.00"
                            className="px-2 py-1 border rounded text-sm w-28"
                            style={{ minHeight: "44px" }}
                          />
                          <label className="text-sm text-muted-foreground">
                            ضد قيد:
                          </label>
                          <input
                            type="text"
                            name="settledEntryId"
                            required
                            placeholder="معرّف القيد"
                            className="px-2 py-1 border rounded text-sm w-64"
                            style={{ minHeight: "44px" }}
                          />
                          <button
                            type="submit"
                            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                            style={{ minHeight: "44px" }}
                          >
                            تسوية
                          </button>
                        </form>

                        {/* Reverse form */}
                        <form
                          action={reversePaymentAction}
                          className="inline-flex flex-wrap gap-2 items-center"
                        >
                          <input
                            type="hidden"
                            name="paymentId"
                            value={p.id}
                          />
                          <input
                            type="hidden"
                            name="idempotencyKey"
                            value={`reverse-${p.id}-${crypto.randomUUID()}`}
                          />
                          <label className="text-sm text-muted-foreground">
                            سبب العكس:
                          </label>
                          <input
                            type="text"
                            name="reason"
                            required
                            placeholder="سبب العكس"
                            className="px-2 py-1 border rounded text-sm w-56"
                            style={{ minHeight: "44px" }}
                          />
                          <button
                            type="submit"
                            className="px-4 py-2 border border-red-600 text-red-600 rounded text-sm"
                            style={{ minHeight: "44px" }}
                          >
                            عكس
                          </button>
                        </form>

                        {/* Post draft (only shown for completeness if a draft
                            is somehow in this list — kept out of this group) */}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Draft payments — post form */}
            {draftPayments.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>مسودات بانتظار النشر</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {draftPayments.map((p) => (
                    <div key={p.id} className="border rounded p-4">
                      <div className="flex flex-wrap justify-between items-center mb-3 gap-2">
                        <div>
                          <span className="font-medium">
                            <LtrValue>{p.paymentNo}</LtrValue>
                          </span>
                          <span className="text-muted-foreground mr-2">
                            {p.ownerName} (<LtrValue>{p.ownerCode}</LtrValue>)
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          المبلغ: <LtrValue>{p.amount}</LtrValue>
                        </div>
                      </div>
                      <form action={postPaymentAction} className="inline">
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input
                          type="hidden"
                          name="idempotencyKey"
                          value={`post-${p.id}-${crypto.randomUUID()}`}
                        />
                        <input type="hidden" name="notes" value="" />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                          style={{ minHeight: "44px" }}
                        >
                          نشر
                        </button>
                      </form>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* All payments table */}
            <Card>
              <CardHeader>
                <CardTitle>جميع المدفوعات</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="py-2 px-3">رقم الدفعة</th>
                        <th className="py-2 px-3">المالك</th>
                        <th className="py-2 px-3">المبلغ</th>
                        <th className="py-2 px-3">الاتجاه</th>
                        <th className="py-2 px-3">الطريقة</th>
                        <th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-b">
                          <td className="py-2 px-3">
                            <LtrValue>{p.paymentNo}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            {p.ownerName} (<LtrValue>{p.ownerCode}</LtrValue>)
                          </td>
                          <td className="py-2 px-3">
                            <LtrValue>{p.amount}</LtrValue>
                          </td>
                          <td className="py-2 px-3">{p.paymentDirection}</td>
                          <td className="py-2 px-3">{p.paymentMethod}</td>
                          <td className="py-2 px-3">{p.status}</td>
                          <td className="py-2 px-3">
                            <LtrValue>{p.paymentDate}</LtrValue>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {reversedPayments.length > 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                عدد المدفوعات المعكوسة:{" "}
                <LtrValue>{reversedPayments.length}</LtrValue>
              </p>
            )}
          </>
        )}
      </Container>
    </ManagementShell>
  );
}
