/**
 * Management Traceability Detail page — raw batch thin traceability.
 *
 * Route: /management/traceability/[batchId]
 *
 * WP-02-07: Read-only raw batch detail timeline.
 * Shows: receipt/source → approval/posting → stock movement → current balance.
 *
 * Permission: inventory.view_quantity (workers + management).
 * Financial fields redacted for workers (DEC-063).
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
import { RawBatchTraceService, RawBatchNotFoundError } from "@/server/services/raw-batch-trace-service";
import { RawReceiptDraftDbRepository } from "@/server/services/raw-receipt-draft-db-repository";
import { RawReceiptApprovalDbRepository } from "@/server/services/raw-receipt-approval-db-repository";
import { resolveEffectivePermissions } from "@/server/security/effective-permissions";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import type { EffectivePermissions } from "@/server/security/effective-permissions";
import type { RawBatchTrace, TimelineEvent } from "@/server/services/raw-batch-trace-service";
import Link from "next/link";

export default async function TraceabilityDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) => isManagementShellRole(r)) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

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
        error = e.message ?? "حدث خطأ";
      }
      dbAvailable = true;
    }
  }

  return (
    <ManagementShell
      userName={authResult.name}
      tenantLabel="ERP-Yarn"
      navCategories={navCategories}
      onSignOut={async () => { "use server"; await signOut(); }}
      breadcrumbs={[
        { label: "الرئيسية", href: "/management" },
        { label: "التتبع", href: "/management/traceability" },
        { label: trace?.batchNo ?? "تفاصيل الدفعة" },
      ]}
    >
      <Container size="lg" className="py-6">
        {!dbAvailable ? (
          <Card><CardContent className="py-16 text-center"><p className="text-sm font-medium text-foreground">قاعدة البيانات غير متصلة</p></CardContent></Card>
        ) : error ? (
          <Card><CardContent className="py-16 text-center"><p className="text-sm font-medium text-foreground">{error}</p><Link href="/management/traceability" className="text-primary hover:underline mt-2 inline-block">العودة للقائمة</Link></CardContent></Card>
        ) : trace ? (
          <>
            {/* Header */}
            <div className="mb-6 rounded-2xl border border-primary/20 bg-gradient-to-l from-primary/12 via-primary/5 to-transparent p-5 backdrop-blur-md shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-7 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                  <div>
                    <h1 className="text-heading-2 text-foreground">تتبع الدفعة</h1>
                    <p className="text-sm text-muted-foreground">عرض للقراءة فقط — تسلسل الاستلام والترحيل والرصيد</p>
                  </div>
                </div>
                <LtrValue className="text-heading-4 text-muted-foreground">{trace.batchNo}</LtrValue>
              </div>
            </div>

            {/* Batch Identity */}
            <Card className="mb-4">
              <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-muted-foreground">بيانات الدفعة</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  <DetailField label="رقم الدفعة" value={trace.batchNo} ltr />
                  <DetailField label="الوزن الصافي (كجم)" value={trace.netWeightKg} ltr />
                  <DetailField label="الوزن القائم (كجم)" value={trace.grossWeightKg ?? "—"} ltr />
                  <DetailField label="تاريخ الاستلام" value={trace.receivedDate} ltr />
                  <DetailField label="المورد" value={trace.supplierNameAr ?? "غير محدد"} />
                  <DetailField label="نوع الخام" value={trace.fiberTypeNameAr ?? "غير محدد"} />
                  <DetailField label="مكان التخزين" value={trace.storageLocationNameAr ?? "غير محدد"} />
                  <DetailField label="الحالة" value={trace.status === "approved" ? "معتمد" : trace.status === "submitted" ? "مرسل للمراجعة" : "مسودة"} />
                  <DetailField label="حالة الاعتماد" value={trace.approvalStatus === "approved" ? "معتمد" : trace.approvalStatus === "pending_approval" ? "بانتظار الاعتماد" : "مسودة"} />
                </div>
              </CardContent>
            </Card>

            {/* Timeline */}
            <Card className="mb-4">
              <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-muted-foreground">التسلسل الزمني</CardTitle></CardHeader>
              <CardContent>
                {trace.timeline.length > 0 ? (
                  <ol className="relative border-r-2 border-primary/20 pr-4 space-y-6" role="list">
                    {trace.timeline.map((event, idx) => (
                      <li key={idx} className="relative">
                        <span className="absolute -right-[22px] top-1 flex h-3 w-3 items-center justify-center rounded-full bg-primary" aria-hidden="true" />
                        <div className="ml-2">
                          <h3 className="text-sm font-medium text-foreground">{event.title}</h3>
                          {event.timestamp && <p className="text-xs text-muted-foreground mt-0.5" dir="ltr">{event.timestamp}</p>}
                          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            {Object.entries(event.details).map(([key, val]) => (
                              val && (
                                <div key={key} className="flex gap-1">
                                  <dt className="text-muted-foreground">{key}:</dt>
                                  <dd className="text-foreground font-medium" dir="ltr">{val}</dd>
                                </div>
                              )
                            ))}
                          </dl>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">لا توجد أحداث في التسلسل</p>
                )}
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

            {/* Current Balance */}
            {trace.currentBalance && (
              <Card className="mb-4">
                <CardHeader className="pb-3"><CardTitle className="text-heading-4 text-muted-foreground">الرصيد الحالي</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <DetailField label="الرصيد المتاح (كجم)" value={trace.currentBalance.onHandQtyKg} ltr />
                    <DetailField label="الموقع" value={trace.currentBalance.locationNameAr ?? "—"} />
                    <DetailField label="الإصدار" value={String(trace.currentBalance.version)} ltr />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Redaction notice */}
            {trace.financialFieldsRedacted && (
              <div className="rounded-lg border border-info/30 bg-info/5 p-3 text-sm">
                <p className="text-info font-medium">إخفاء الحقول المالية</p>
                <p className="text-muted-foreground mt-1">تم إخفاء الحقول المالية (السعر، التكلفة، المستحق) بناءً على صلاحياتك.</p>
              </div>
            )}

            <div className="mt-4">
              <Link href="/management/traceability" className="text-primary hover:underline min-h-[44px] inline-flex items-center">
                العودة لقائمة رسائل الخام
              </Link>
            </div>
          </>
        ) : (
          <Card><CardContent className="py-16 text-center"><p className="text-sm">حدث خطأ غير متوقع</p></CardContent></Card>
        )}
      </Container>
    </ManagementShell>
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
