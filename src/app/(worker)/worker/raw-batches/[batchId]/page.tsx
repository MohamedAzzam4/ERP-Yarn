/**
 * Worker Raw Batch Detail page — thin traceability for workers.
 *
 * Route: /worker/raw-batches/[batchId]
 *
 * WP-02-07: Read-only raw batch detail timeline for workers.
 * Contract 10 §10.1: "workers task-scoped operational lineage only."
 * Contract 10 §10.1: "Hidden fields: Financial events/values from workers."
 *
 * Workers see operational facts only:
 * - batch identity (batch_no, net_weight, gross_weight, received_date)
 * - fiber type name
 * - storage location name
 * - stock movement (doc_no, quantity, date, location)
 * - current balance (on_hand_qty_kg)
 *
 * Workers do NOT see:
 * - supplier name (operational, but worker may not need it — keep for now if permitted)
 * - price, cost, payable, account entry, balance value, settlement/payment
 *
 * The service's financialFieldsRedacted flag is true for workers.
 * This page does NOT render any financial fields regardless of the flag.
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
import { RawBatchTraceService, RawBatchNotFoundError } from "@/server/services/raw-batch-trace-service";
import { RawReceiptDraftDbRepository } from "@/server/services/raw-receipt-draft-db-repository";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import type { RawBatchTrace } from "@/server/services/raw-batch-trace-service";
import Link from "next/link";

export default async function WorkerRawBatchDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find((r) => isWorkerShellRole(r)) as RoleCode | undefined;
  if (!workerRole) redirect("/management");

  const tasks = getWorkerTasksForRole(workerRole);

  let trace: RawBatchTrace | null = null;
  let error: string | null = null;
  let dbAvailable = false;

  if (db) {
    const traceService = new RawBatchTraceService({
      db,
      draftRepository: new RawReceiptDraftDbRepository(db),
      approvalRepository: new RawReceiptApprovalDbRepository(db),
    });
    const effective: EffectivePermissions = resolveEffectivePermissions(authResult.roles, TEST_ROLE_PERMISSION_MATRIX);
    try {
      trace = await traceService.traceRawBatch({ ...authResult, tenantId: authResult.tenantId } as any, effective, batchId);
      dbAvailable = true;
    } catch (e: any) {
      if (e.name === "RawBatchNotFoundError") {
        error = "الدفعة غير موجودة";
      } else if (e.code === "permission_denied") {
        error = "لا تملك صلاحية لعرض هذه الشاشة";
      } else {
        error = "حدث خطأ";
      }
      dbAvailable = true;
    }
  }

  return (
    <WorkerShell
      userName={authResult.name}
      tasks={tasks}
      onSignOut={async () => { "use server"; await signOut(); }}
    >
      <Container size="lg" className="py-6">
        {!dbAvailable ? (
          <Card><CardContent className="py-16 text-center"><p className="text-sm font-medium text-foreground">قاعدة البيانات غير متصلة</p></CardContent></Card>
        ) : error ? (
          <Card><CardContent className="py-16 text-center">
            <p className="text-sm font-medium text-foreground">{error}</p>
            <Link href="/worker" className="text-primary hover:underline mt-2 inline-block">العودة للرئيسية</Link>
          </CardContent></Card>
        ) : trace ? (
          <>
            {/* Header */}
            <div className="mb-6">
              <h1 className="text-heading-2 text-foreground mb-1">تفاصيل الدفعة</h1>
              <p className="text-sm text-muted-foreground">عرض للقراءة فقط — بيانات تشغيلية</p>
            </div>

            {/* Batch Identity (operational facts only — no financial fields) */}
            <Card className="mb-4">
              <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-muted-foreground">بيانات الدفعة</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <DetailField label="رقم الدفعة" value={trace.batchNo} ltr />
                  <DetailField label="الوزن الصافي (كجم)" value={trace.netWeightKg} ltr />
                  <DetailField label="الوزن القائم (كجم)" value={trace.grossWeightKg ?? "—"} ltr />
                  <DetailField label="تاريخ الاستلام" value={trace.receivedDate} ltr />
                  <DetailField label="نوع الخام" value={trace.fiberTypeNameAr ?? "غير محدد"} />
                  <DetailField label="مكان التخزين" value={trace.storageLocationNameAr ?? "غير محدد"} />
                  <DetailField label="الحالة" value={trace.status === "approved" ? "معتمد" : trace.status === "submitted" ? "مرسل للمراجعة" : "مسودة"} />
                </div>
              </CardContent>
            </Card>

            {/* Stock Movements */}
            {trace.movements.length > 0 && (
              <Card className="mb-4">
                <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-muted-foreground">حركات المخزون</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" role="table">
                      <thead><tr className="border-b border-border bg-primary/5">
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">رقم المستند</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">النوع</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الكمية (كجم)</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">التاريخ</th>
                        <th className="p-3 text-right text-xs font-semibold uppercase text-muted-foreground">الموقع</th>
                      </tr></thead>
                      <tbody>
                        {trace.movements.map((m) => (
                          <tr key={m.id} className="border-b border-border">
                            <td className="p-3"><LtrValue className="font-medium">{m.docNo}</LtrValue></td>
                            <td className="p-3 text-foreground">{m.movementType}</td>
                            <td className="p-3"><LtrValue>{m.quantityKg}</LtrValue></td>
                            <td className="p-3"><LtrValue>{m.movementDate}</LtrValue></td>
                            <td className="p-3 text-foreground">{m.toLocationNameAr ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Current Balance (operational — on_hand_qty_kg only, no value) */}
            {trace.currentBalance && (
              <Card className="mb-4">
                <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-muted-foreground">الرصيد الحالي</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <DetailField label="الرصيد المتاح (كجم)" value={trace.currentBalance.onHandQtyKg} ltr />
                    <DetailField label="الموقع" value={trace.currentBalance.locationNameAr ?? "—"} />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Read-only notice */}
            <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
              <p className="text-info font-medium">عرض للقراءة فقط</p>
              <p className="text-muted-foreground mt-1">هذه شاشة عرض تشغيلي — لا توجد إجراءات تعديل أو اعتماد أو ترحيل.</p>
            </div>

            <div className="mt-4">
              <Link href="/worker" className="text-primary hover:underline min-h-[44px] inline-flex items-center">
                العودة للرئيسية
              </Link>
            </div>
          </>
        ) : (
          <Card><CardContent className="py-16 text-center"><p className="text-sm">حدث خطأ غير متوقع</p></CardContent></Card>
        )}
      </Container>
    </WorkerShell>
  );
}

function DetailField({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground" dir={ltr ? "ltr" : undefined}>{value}</p>
    </div>
  );
}
