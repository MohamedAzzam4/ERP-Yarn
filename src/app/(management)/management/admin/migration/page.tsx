/**
 * Migration Batch List page — WP-08-01F.
 *
 * Route: /management/admin/migration
 * Contract 10 §9: Historical Migration Screens.
 *
 * Owner and Accountant can view migration batches.
 * Workers are denied (redirected to /worker by management shell).
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { ManagementShell } from "@/components/shells/management-shell";
import { getManagementNavForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { MigrationScreenQueryService } from "@/server/services/migration-screen-query-service";
import { createMigrationBatchAction } from "./actions";

export default async function MigrationBatchListPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    r === "owner" || r === "accountant",
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let batches: Awaited<
    ReturnType<MigrationScreenQueryService["listBatches"]>
  > = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new MigrationScreenQueryService(db);
      batches = await queryService.listBatches(authResult.tenantId);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  const statusLabels: Record<string, string> = {
    draft: "مسودة",
    source_uploaded: "تم رفع المصدر",
    normalized: "مُطبَّع",
    staged: "مُجهَّز",
    validation_in_progress: "جارٍ التحقق",
    validation_complete: "اكتمل التحقق",
    reconciliation_in_progress: "جارٍ المطابقة",
    review_required: "مطلوب مراجعة",
    pending_dual_approval: "بانتظار اعتماد مزدوج",
    approved_for_commit: "معتمد للترحيل",
    committing: "جارٍ الترحيل",
    committed: "مُرحَّل",
    rejected: "مرفوض",
    cancelled: "ملغى",
  };

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
        <h1 className="text-2xl font-bold mb-6">الترحيل التاريخي</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && batches.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              لا توجد دفعات ترحيل.
            </CardContent>
          </Card>
        )}

        {/* Create batch form — shown when DB is available */}
        {dbAvailable && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>إنشاء دفعة ترحيل جديدة</CardTitle>
            </CardHeader>
            <CardContent>
              <form data-action="create-migration-batch" action={createMigrationBatchAction} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <input type="hidden" name="idempotencyKey" value={`batch-${crypto.randomUUID()}`} />
                <input type="hidden" name="cutoverImportMode" value="opening_balance" />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">وصف المصدر:</span>
                  <input
                    type="text"
                    name="sourceDescription"
                    placeholder="وصف مصدر البيانات"
                    className="px-2 py-1 border rounded text-sm"
                    style={{ minHeight: "44px" }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">اسم القالب:</span>
                  <input
                    type="text"
                    name="templateName"
                    placeholder="اسم القالب"
                    className="px-2 py-1 border rounded text-sm"
                    style={{ minHeight: "44px" }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">إصدار القالب:</span>
                  <input
                    type="text"
                    name="templateVersion"
                    placeholder="إصدار القالب"
                    className="px-2 py-1 border rounded text-sm"
                    style={{ minHeight: "44px" }}
                  />
                </label>
                <div className="sm:col-span-2 lg:col-span-3">
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                    style={{ minHeight: "44px" }}
                  >
                    إنشاء الدفعة
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {dbAvailable && batches.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>دفعات الترحيل</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">رقم الدفعة</th>
                      <th className="py-2 px-3">الحالة</th>
                      <th className="py-2 px-3">القالب</th>
                      <th className="py-2 px-3">الإصدار</th>
                      <th className="py-2 px-3">الصفوف</th>
                      <th className="py-2 px-3">أخطاء</th>
                      <th className="py-2 px-3">تحذيرات</th>
                      <th className="py-2 px-3">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id} className="border-b hover:bg-muted/50">
                        <td className="py-2 px-3">
                          <Link
                            href={`/management/admin/migration/${b.id}`}
                            className="text-primary hover:underline"
                          >
                            <LtrValue>{b.batchNo}</LtrValue>
                          </Link>
                        </td>
                        <td className="py-2 px-3">
                          {statusLabels[b.status] ?? b.status}
                        </td>
                        <td className="py-2 px-3">{b.templateName ?? "—"}</td>
                        <td className="py-2 px-3">
                          {b.templateVersion ? (
                            <LtrValue>{b.templateVersion}</LtrValue>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>{b.stagedRowCount}</LtrValue>
                        </td>
                        <td className="py-2 px-3">
                          {b.blockingErrorCount > 0 ? (
                            <span className="text-destructive font-semibold">
                              <LtrValue>{b.blockingErrorCount}</LtrValue>
                            </span>
                          ) : (
                            <LtrValue>0</LtrValue>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          {b.warningCount > 0 ? (
                            <span className="text-amber-600 font-semibold">
                              <LtrValue>{b.warningCount}</LtrValue>
                            </span>
                          ) : (
                            <LtrValue>0</LtrValue>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <LtrValue>
                            {new Date(b.createdAt).toLocaleDateString("ar")}
                          </LtrValue>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </Container>
    </ManagementShell>
  );
}
