/**
 * Worker Raw Batches list page — thin traceability for workers.
 *
 * Route: /worker/raw-batches
 *
 * WP-02-07: Read-only list of raw batches for workers.
 * Contract 10 §10.1: "workers task-scoped operational lineage only."
 * Workers see operational facts only (batch_no, net_weight, status, date).
 * No financial fields shown.
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { isWorkerShellRole, getWorkerTasksForRole } from "@/components/shells/nav-config";
import { WorkerShell } from "@/components/shells/worker-shell";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { RawBatchTraceService } from "@/server/services/raw-batch-trace-service";
import { RawReceiptDraftDbRepository } from "@/server/services/raw-receipt-draft-db-repository";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import Link from "next/link";

export default async function WorkerRawBatchesPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find((r) => isWorkerShellRole(r)) as RoleCode | undefined;
  if (!workerRole) redirect("/management");

  const tasks = getWorkerTasksForRole(workerRole);

  let batches: Array<{ id: string; batchNo: string; netWeightKg: string; status: string; approvalStatus: string; receivedDate: string }> = [];
  let dbAvailable = false;

  if (db) {
    const traceService = new RawBatchTraceService({
      db,
      draftRepository: new RawReceiptDraftDbRepository(db),
      approvalRepository: new RawReceiptApprovalDbRepository(db),
    });
    const effective: EffectivePermissions = resolveEffectivePermissions(authResult.roles, TEST_ROLE_PERMISSION_MATRIX);
    try {
      batches = await traceService.listBatches({ ...authResult, tenantId: authResult.tenantId } as any, effective);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  return (
    <WorkerShell
      userName={authResult.name}
      tasks={tasks}
      onSignOut={async () => { "use server"; await signOut(); }}
    >
      <Container size="xl" className="py-6">
        <div className="mb-6">
          <h1 className="text-heading-2 text-foreground mb-1">رسائل الخام</h1>
          <p className="text-sm text-muted-foreground">عرض للقراءة فقط — بيانات تشغيلية</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-heading-4 text-foreground">قائمة رسائل الخام</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dbAvailable ? (
              batches.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" role="table">
                    <thead>
                      <tr className="border-b border-border bg-primary/5">
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">رقم الدفعة</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الوزن الصافي (كجم)</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">تاريخ الاستلام</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">الحالة</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map((batch) => (
                        <tr key={batch.id} className="border-b border-border transition-colors duration-150 hover:bg-primary/5">
                          <td className="p-3"><LtrValue className="font-medium text-foreground">{batch.batchNo}</LtrValue></td>
                          <td className="p-3"><LtrValue className="text-foreground">{batch.netWeightKg}</LtrValue></td>
                          <td className="p-3"><LtrValue className="text-foreground">{batch.receivedDate}</LtrValue></td>
                          <td className="p-3 text-foreground">{batch.status === "approved" ? "معتمد" : batch.status === "submitted" ? "مرسل للمراجعة" : "مسودة"}</td>
                          <td className="p-3">
                            <Link href={`/worker/raw-batches/${batch.id}`} className="text-primary hover:underline min-h-[44px] inline-flex items-center" aria-label={`عرض تفاصيل الدفعة ${batch.batchNo}`}>
                              عرض
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <p className="text-sm font-medium text-foreground">لا توجد دفعات</p>
                  <p className="text-xs text-muted-foreground mt-1">ستظهر رسائل الخام هنا عند إنشاء مسودات الاستلام.</p>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <p className="text-sm font-medium text-foreground">قاعدة البيانات غير متصلة</p>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              عرض للقراءة فقط — لا توجد إجراءات تعديل أو اعتماد
            </p>
          </CardContent>
        </Card>
      </Container>
    </WorkerShell>
  );
}
